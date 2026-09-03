import { describe, expect, it } from 'vitest';

import {
  IMAGE_HEIGHT,
  IMAGE_WIDTH,
  clampBox,
  createInitialCanvasState,
  reduceCanvasState,
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

    expect(duplicate).toBe(initial);
    expect(tiny).toBe(initial);
    expect(unknown.selectedId).toBeNull();
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
  });
});
