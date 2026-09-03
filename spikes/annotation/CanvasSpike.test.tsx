import { describe, expect, it } from 'vitest';

import {
  IMAGE_HEIGHT,
  IMAGE_WIDTH,
  clampBox,
  clampDragPosition,
  clampTransformBox,
  createInitialCanvasState,
  reduceCanvasState,
  summarizeOperationSamples,
} from './CanvasSpike';

describe('SPI-10 canvas state', () => {
  it('starts with 100 distinct boxes inside the 4K image', () => {
    const state = createInitialCanvasState();

    expect(state.boxes).toHaveLength(100);
    expect(new Set(state.boxes.map((box) => box.id)).size).toBe(100);
    expect(
      state.boxes.every(
        (box) =>
          box.x >= 0 &&
          box.y >= 0 &&
          box.x + box.width <= IMAGE_WIDTH &&
          box.y + box.height <= IMAGE_HEIGHT,
      ),
    ).toBe(true);
  });

  it('creates a reverse-dragged box in image coordinates and selects it', () => {
    const initial = createInitialCanvasState();
    const next = reduceCanvasState(initial, {
      type: 'create',
      id: 'created',
      start: { x: 300, y: 220 },
      end: { x: 100, y: 80 },
    });

    expect(next.boxes.at(-1)).toEqual({ id: 'created', x: 100, y: 80, width: 200, height: 140 });
    expect(next.selectedId).toBe('created');
    expect(initial.boxes).toHaveLength(100);
  });

  it('ignores duplicate IDs, tiny drafts, and unknown selections', () => {
    const initial = createInitialCanvasState();
    const duplicate = reduceCanvasState(initial, {
      type: 'create',
      id: 'box-0',
      start: { x: 0, y: 0 },
      end: { x: 100, y: 100 },
    });
    const tiny = reduceCanvasState(initial, {
      type: 'create',
      id: 'tiny',
      start: { x: 10, y: 10 },
      end: { x: 12, y: 13 },
    });
    const unknown = reduceCanvasState(initial, { type: 'select', id: 'missing' });
    const outside = reduceCanvasState(initial, {
      type: 'create',
      id: 'outside',
      start: { x: IMAGE_WIDTH + 10, y: 20 },
      end: { x: IMAGE_WIDTH + 100, y: 120 },
    });
    const invalidResize = reduceCanvasState(initial, {
      type: 'resize',
      id: 'box-0',
      box: { x: 0, y: 0, width: -10, height: 20 },
    });

    expect(duplicate).toBe(initial);
    expect(tiny).toBe(initial);
    expect(unknown.selectedId).toBeNull();
    expect(outside).toBe(initial);
    expect(invalidResize).toBe(initial);
  });

  it('clamps move and resize results to finite in-image bounds', () => {
    const initial = createInitialCanvasState();
    const moved = reduceCanvasState(initial, {
      type: 'move',
      id: 'box-0',
      x: IMAGE_WIDTH + 100,
      y: -50,
    });
    const resized = reduceCanvasState(moved, {
      type: 'resize',
      id: 'box-0',
      box: { x: IMAGE_WIDTH - 10, y: IMAGE_HEIGHT - 10, width: 500, height: 400 },
    });
    const box = resized.boxes[0];

    expect(box).toEqual({
      id: 'box-0',
      x: IMAGE_WIDTH - 500,
      y: IMAGE_HEIGHT - 400,
      width: 500,
      height: 400,
    });
    expect(() => clampBox({ x: Number.NaN, y: 0, width: 10, height: 10 })).toThrow(
      'x must be finite',
    );
    expect(() => clampBox({ x: 0, y: 0, width: 0, height: 10 })).toThrow(
      'box dimensions must be at least 4 image pixels',
    );
  });

  it('clips a partially outside create gesture to the image intersection', () => {
    const initial = createInitialCanvasState();
    const next = reduceCanvasState(initial, {
      type: 'create',
      id: 'clipped',
      start: { x: -20, y: -30 },
      end: { x: 50, y: 60 },
    });

    expect(next.boxes.at(-1)).toEqual({ id: 'clipped', x: 0, y: 0, width: 50, height: 60 });
  });

  it('zooms around the pointer while preserving its image coordinate', () => {
    const initial = createInitialCanvasState();
    const pointer = { x: 480, y: 270 };
    const before = {
      x: (pointer.x - initial.viewport.x) / initial.viewport.scale,
      y: (pointer.y - initial.viewport.y) / initial.viewport.scale,
    };
    const zoomed = reduceCanvasState(initial, { type: 'zoom', pointer, factor: 1.5 });
    const after = {
      x: (pointer.x - zoomed.viewport.x) / zoomed.viewport.scale,
      y: (pointer.y - zoomed.viewport.y) / zoomed.viewport.scale,
    };

    expect(zoomed.viewport.scale).toBe(0.375);
    expect(after).toEqual(before);
    expect(reduceCanvasState(initial, { type: 'zoom', pointer, factor: 0 })).toBe(initial);
    expect(() =>
      reduceCanvasState(initial, { type: 'zoom', pointer, factor: Number.POSITIVE_INFINITY }),
    ).toThrow('zoom factor must be finite');
    expect(() =>
      reduceCanvasState(initial, {
        type: 'zoom',
        pointer: { x: Number.NaN, y: pointer.y },
        factor: 1.1,
      }),
    ).toThrow('zoom pointer x must be finite');
  });

  it('pans in viewport coordinates and rejects non-finite deltas', () => {
    const initial = createInitialCanvasState();
    const panned = reduceCanvasState(initial, { type: 'pan', delta: { x: 25, y: -10 } });

    expect(panned.viewport).toEqual({ x: 25, y: -10, scale: 0.25 });
    expect(() =>
      reduceCanvasState(initial, { type: 'pan', delta: { x: Number.NaN, y: 0 } }),
    ).toThrow('pan delta x must be finite');
  });

  it('clamps absolute drag and transform boxes in image coordinates after zooming', () => {
    const box = createInitialCanvasState().boxes[0];
    if (box === undefined) throw new Error('missing initial box');
    const viewport = { x: -48, y: -27, scale: 0.275 };
    const absolutePosition = {
      x: viewport.x + (box.x + 5) * viewport.scale,
      y: viewport.y + (box.y + 7) * viewport.scale,
    };

    expect(clampDragPosition(absolutePosition, box, viewport)).toEqual(absolutePosition);
    expect(clampDragPosition({ x: -1_000, y: -1_000 }, box, viewport)).toEqual({
      x: viewport.x,
      y: viewport.y,
    });

    const oldTransform = { x: -26, y: -10.5, width: 66, height: 33, rotation: 0 };
    expect(
      clampTransformBox(
        oldTransform,
        { ...oldTransform, width: 3 * viewport.scale },
        viewport,
      ),
    ).toBe(oldTransform);
    expect(
      clampTransformBox(
        oldTransform,
        { ...oldTransform, width: 4 * viewport.scale },
        viewport,
      ).width,
    ).toBeCloseTo(4 * viewport.scale);
  });

  it('computes p95 from finite non-negative benchmark samples', () => {
    expect(summarizeOperationSamples([5, 1, 4, 2, 3])).toEqual({
      meanMs: 3,
      p95Ms: 5,
      maxMs: 5,
    });
    expect(() => summarizeOperationSamples([])).toThrow('operation samples');
    expect(() => summarizeOperationSamples([Number.NaN])).toThrow('operation samples');
  });
});
