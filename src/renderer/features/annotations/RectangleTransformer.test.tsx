import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RectangleTransformer, boundBoxLimiter, clampRectangleToImage } from './RectangleTransformer';
import { MIN_RECTANGLE_SIZE_PX } from './RectangleLayer';
import { annotationRectangleSchema, type AnnotationRectangle } from '../../../shared/contracts/annotation';
import type { Viewport } from './canvas-coordinates';

/** Konva rasterises through a 2D context jsdom does not provide and whose
 * optional `canvas` package is deliberately not adopted (node-phase-c.md), so
 * the nodes are recorded and driven with the events Konva would deliver. */
const konva = vi.hoisted(() => ({ nodes: [] as { props: Record<string, unknown> }[] }));
vi.mock('react-konva', async () => {
  const { createElement } = await import('react');
  const recorder = () => function KonvaNode({ children, ...props }: Record<string, unknown> & { children?: unknown }) {
    konva.nodes.push({ props });
    return createElement('div', {}, children as never);
  };
  return {
    Stage: recorder(), Layer: recorder(), Image: recorder(),
    Rect: recorder(), Group: recorder(), Text: recorder(), Transformer: recorder(),
  };
});

function node(name: string): Record<string, unknown> | undefined {
  return konva.nodes.filter((entry) => entry.props.name === name).at(-1)?.props;
}

/** Minimal stand-in for the Konva.Rect the handlers receive and write back. */
function fakeNode(initial: { x: number; y: number; width: number; height: number; scaleX?: number; scaleY?: number }) {
  const state: Record<string, number> = { scaleX: 1, scaleY: 1, ...initial };
  const accessor = (key: string) => (value?: number) => {
    if (value === undefined) return state[key]!;
    state[key] = value;
    return undefined as never;
  };
  return {
    state,
    node: {
      x: accessor('x'), y: accessor('y'), width: accessor('width'), height: accessor('height'),
      scaleX: accessor('scaleX'), scaleY: accessor('scaleY'),
    },
  };
}

const viewport: Viewport = { scale: 0.5, offsetX: 100, offsetY: 50 };
const imageSize = { width: 800, height: 600 };
const rectangle: AnnotationRectangle = {
  id: '3d2e8bef-ddaf-4d4f-9d7f-cdaf0ddf6daf',
  classId: '2c1d7ade-ccfe-4c3e-8c6e-bc9efccd5cfe',
  x: 100, y: 80, width: 200, height: 120,
};
const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height, rotation: 0 });

function setup(current: AnnotationRectangle | null = rectangle) {
  const onChange = vi.fn<(next: AnnotationRectangle) => void>();
  render(<RectangleTransformer rectangle={current} imageSize={imageSize} viewport={viewport} onChange={onChange} />);
  return onChange;
}

beforeEach(() => { konva.nodes.length = 0; });

describe('RectangleTransformer W2-12', () => {
  it('clamps a moved or resized box into the image instead of storing outside coordinates', () => {
    expect(clampRectangleToImage({ x: -40, y: -10, width: 200, height: 120 }, imageSize))
      .toEqual({ x: 0, y: 0, width: 200, height: 120 });
    expect(clampRectangleToImage({ x: 700, y: 560, width: 200, height: 120 }, imageSize))
      .toEqual({ x: 600, y: 480, width: 200, height: 120 });
    expect(clampRectangleToImage({ x: -50, y: -50, width: 5000, height: 5000 }, imageSize))
      .toEqual({ x: 0, y: 0, width: 800, height: 600 });
    expect(clampRectangleToImage({ x: 10.5, y: 20.25, width: 30, height: 40 }, imageSize))
      .toEqual({ x: 10.5, y: 20.25, width: 30, height: 40 });
  });

  it('keeps an edge-clamped rectangle inside the bound the stored contract checks', () => {
    // annotationItemSchema tests `width <= imageWidth - x`; a fractional width
    // from a zoomed resize must not land one ulp outside it.
    for (const width of [644.9612712688387, 123.45678901234567, 799.9999999999999, 0.1 + 0.2 + 4]) {
      const clamped = clampRectangleToImage({ x: 1e9, y: 1e9, width, height: width }, imageSize)!;
      expect(clamped).not.toBeNull();
      expect(clamped.width).toBeLessThanOrEqual(imageSize.width - clamped.x);
      expect(clamped.height).toBeLessThanOrEqual(imageSize.height - clamped.y);
      expect(clamped.x).toBeGreaterThanOrEqual(0);
      expect(clamped.y).toBeGreaterThanOrEqual(0);
      const stored = { ...rectangle, ...clamped };
      expect(annotationRectangleSchema.parse(stored)).toEqual(stored);
    }
  });

  it('refuses boxes below the minimum size and non-finite geometry', () => {
    expect(clampRectangleToImage({ x: 0, y: 0, width: MIN_RECTANGLE_SIZE_PX - 0.001, height: 100 }, imageSize)).toBeNull();
    expect(clampRectangleToImage({ x: 0, y: 0, width: 100, height: 0 }, imageSize)).toBeNull();
    expect(clampRectangleToImage({ x: 0, y: 0, width: -100, height: 100 }, imageSize)).toBeNull();
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(clampRectangleToImage({ x: value, y: 0, width: 100, height: 100 }, imageSize)).toBeNull();
      expect(clampRectangleToImage({ x: 0, y: 0, width: value, height: 100 }, imageSize)).toBeNull();
    }
    expect(clampRectangleToImage({ x: 0, y: 0, width: MIN_RECTANGLE_SIZE_PX, height: MIN_RECTANGLE_SIZE_PX }, imageSize))
      .toEqual({ x: 0, y: 0, width: MIN_RECTANGLE_SIZE_PX, height: MIN_RECTANGLE_SIZE_PX });
  });

  it('keeps the transformer handles inside the image and above the minimum size, in display coordinates', () => {
    const limit = boundBoxLimiter(viewport, imageSize);
    const old = box(150, 90, 100, 60);
    // Display box covering image pixels (-100, -100)..(300, 200) is pulled back to the image edge.
    expect(limit(old, box(50, 0, 200, 150))).toEqual(box(100, 50, 200, 150));
    expect(limit(old, box(50, 0, 2000, 2000))).toEqual(box(100, 50, 400, 300));
    // 3 image pixels wide is below the minimum, so the previous box survives.
    expect(limit(old, box(200, 100, 1.5, 60))).toEqual(old);
    expect(limit(old, box(200, 100, Number.NaN, 60))).toEqual(old);
    expect(limit(old, { ...box(200, 100, 100, 60), rotation: 15 })).toEqual(old);
  });

  it('saves a resize in image pixel coordinates and resets the node scale', () => {
    const onChange = setup();
    const target = node(`transform-target-${rectangle.id}`)!;
    expect(target).toMatchObject({ x: 100, y: 80, width: 200, height: 120, draggable: true });
    const { node: fake, state } = fakeNode({ x: 100, y: 80, width: 200, height: 120, scaleX: 2, scaleY: 1.5 });
    act(() => (target.onTransformEnd as (event: unknown) => void)({ target: fake }));
    const saved = onChange.mock.calls[0]![0];
    expect(saved).toEqual({ ...rectangle, x: 100, y: 80, width: 400, height: 180 });
    expect(annotationRectangleSchema.parse(saved)).toEqual(saved);
    expect(state).toMatchObject({ scaleX: 1, scaleY: 1, width: 400, height: 180 });
  });

  it('clamps a resize that overflows the image and never emits display coordinates', () => {
    const onChange = setup();
    const target = node(`transform-target-${rectangle.id}`)!;
    const { node: fake } = fakeNode({ x: 700, y: 500, width: 200, height: 120, scaleX: 3, scaleY: 3 });
    act(() => (target.onTransformEnd as (event: unknown) => void)({ target: fake }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...rectangle, x: 200, y: 240, width: 600, height: 360 });
  });

  it('rejects a resize below the minimum size and restores the stored geometry', () => {
    const onChange = setup();
    const target = node(`transform-target-${rectangle.id}`)!;
    const { node: fake, state } = fakeNode({ x: 100, y: 80, width: 200, height: 120, scaleX: 0.01, scaleY: 0.01 });
    act(() => (target.onTransformEnd as (event: unknown) => void)({ target: fake }));
    expect(onChange).not.toHaveBeenCalled();
    expect(state).toMatchObject({ x: 100, y: 80, width: 200, height: 120, scaleX: 1, scaleY: 1 });
  });

  it('clamps a drag to the image on release and while dragging', () => {
    const onChange = setup();
    const target = node(`transform-target-${rectangle.id}`)!;
    const { node: fake } = fakeNode({ x: 780, y: -40, width: 200, height: 120 });
    act(() => (target.onDragEnd as (event: unknown) => void)({ target: fake }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...rectangle, x: 600, y: 0, width: 200, height: 120 });
    const bound = target.dragBoundFunc as (position: { x: number; y: number }) => { x: number; y: number };
    // Display (100, 50) is image (0, 0); pulling further up-left stops at the edge.
    expect(bound({ x: -400, y: -400 })).toEqual({ x: 100, y: 50 });
    expect(bound({ x: 100_000, y: 100_000 })).toEqual({ x: 100 + 600 * 0.5, y: 50 + 480 * 0.5 });
    expect(bound({ x: 150, y: 75 })).toEqual({ x: 150, y: 75 });
  });

  it('renders no transform tools when nothing is selected', () => {
    setup(null);
    expect(node('rectangle-transformer')).toBeUndefined();
    expect(konva.nodes).toHaveLength(0);
  });

  it('disables rotation and keeps aspect ratio free', () => {
    setup();
    expect(node('rectangle-transformer')).toMatchObject({ rotateEnabled: false, keepRatio: false, flipEnabled: false });
    expect(typeof node('rectangle-transformer')!.boundBoxFunc).toBe('function');
  });
});
