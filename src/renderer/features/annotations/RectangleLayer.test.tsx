import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MIN_RECTANGLE_SIZE_PX, RectangleLayer, draftRectangle } from './RectangleLayer';
import { annotationRectangleSchema, type AnnotationRectangle } from '../../../shared/contracts/annotation';
import type { Point, Viewport } from './canvas-coordinates';

/** Konva needs a real 2D context that jsdom does not provide, and the optional
 * `canvas` package is deliberately not adopted (node-phase-c.md). The nodes are
 * recorded instead, so these tests check the geometry and handlers this layer
 * gives Konva, in image pixel coordinates. */
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
  // Only the newest render pass counts: the layer's root group is recorded
  // first, so entries after its last occurrence describe the current tree.
  const start = konva.nodes.map((entry) => entry.props.name).lastIndexOf('rectangle-layer');
  return konva.nodes.slice(start).filter((entry) => entry.props.name === name).at(-1)?.props;
}
function handler(name: string, key: string): (event: unknown) => void {
  const found = node(name)?.[key];
  if (typeof found !== 'function') throw new Error(`${name}.${key} is not wired`);
  return found as (event: unknown) => void;
}
function pointerEvent(display: Point): { cancelBubble: boolean; target: { getStage: () => unknown } } {
  return { cancelBubble: false, target: { getStage: () => ({ getPointerPosition: () => display }) } };
}

const viewport: Viewport = { scale: 0.5, offsetX: 100, offsetY: 50 };
const imageSize = { width: 800, height: 600 };
const createdId = '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed';
const classId = '2c1d7ade-ccfe-4c3e-8c6e-bc9efccd5cfe';
const existing: AnnotationRectangle = {
  id: '3d2e8bef-ddaf-4d4f-9d7f-cdaf0ddf6daf', classId, x: 100, y: 80, width: 200, height: 120,
};

function drag(from: Point, to: Point): void {
  act(() => handler('draw-surface', 'onMouseDown')(pointerEvent(from)));
  act(() => handler('draw-surface', 'onMouseMove')(pointerEvent(to)));
  act(() => handler('draw-surface', 'onMouseUp')(pointerEvent(to)));
}

function setup(overrides: Partial<{ rectangles: readonly AnnotationRectangle[]; selectedId: string | null; activeClassId: string | null }> = {}) {
  const handlers = {
    onSelect: vi.fn<(id: string | null) => void>(),
    onCreate: vi.fn<(rectangle: AnnotationRectangle) => void>(),
    onDelete: vi.fn<(id: string) => void>(),
  };
  render(<RectangleLayer
    rectangles={overrides.rectangles ?? []} imageSize={imageSize} viewport={viewport}
    selectedId={overrides.selectedId ?? null}
    activeClassId={overrides.activeClassId === undefined ? classId : overrides.activeClassId}
    onSelect={handlers.onSelect} onCreate={handlers.onCreate} onDelete={handlers.onDelete} />);
  return handlers;
}

beforeEach(() => {
  konva.nodes.length = 0;
  vi.stubGlobal('crypto', { ...globalThis.crypto, randomUUID: () => createdId });
});

describe('RectangleLayer W2-11', () => {
  it('creates a rectangle from a drag, in image pixel coordinates the contract accepts', () => {
    const { onCreate } = setup();
    drag({ x: 200, y: 100 }, { x: 400, y: 250 });
    expect(onCreate).toHaveBeenCalledOnce();
    const created = onCreate.mock.calls[0]![0] as AnnotationRectangle;
    expect(created).toEqual({ id: createdId, classId, x: 200, y: 100, width: 400, height: 300 });
    expect(annotationRectangleSchema.parse(created)).toEqual(created);
    expect(node('draw-preview')).toBeUndefined();
  });

  it('shows the pending rectangle while dragging and clamps it to the image', () => {
    const { onCreate } = setup();
    act(() => handler('draw-surface', 'onMouseDown')(pointerEvent({ x: 200, y: 100 })));
    act(() => handler('draw-surface', 'onMouseMove')(pointerEvent({ x: 400, y: 250 })));
    expect(node('draw-preview')).toMatchObject({ x: 200, y: 100, width: 400, height: 300 });
    act(() => handler('draw-surface', 'onMouseMove')(pointerEvent({ x: 2000, y: 2000 })));
    expect(node('draw-preview')).toMatchObject({ x: 200, y: 100, width: 600, height: 500 });
    act(() => handler('draw-surface', 'onMouseUp')(pointerEvent({ x: 2000, y: 2000 })));
    expect(onCreate).toHaveBeenCalledExactlyOnceWith({
      id: createdId, classId, x: 200, y: 100, width: 600, height: 500,
    });
    act(() => handler('draw-surface', 'onMouseDown')(pointerEvent({ x: -400, y: -400 })));
    act(() => handler('draw-surface', 'onMouseUp')(pointerEvent({ x: 300, y: 200 })));
    expect(onCreate.mock.calls[1]![0]).toMatchObject({ x: 0, y: 0, width: 400, height: 300 });
  });

  it('refuses a mis-click sized rectangle and deselects instead of creating one', () => {
    const { onCreate, onSelect } = setup({ rectangles: [existing], selectedId: existing.id });
    drag({ x: 200, y: 100 }, { x: 201, y: 101 });
    expect(onCreate).not.toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(null);
    expect(draftRectangle({ x: 0, y: 0 }, { x: MIN_RECTANGLE_SIZE_PX - 0.5, y: 100 }, imageSize)).toBeNull();
    expect(draftRectangle({ x: 0, y: 0 }, { x: MIN_RECTANGLE_SIZE_PX, y: MIN_RECTANGLE_SIZE_PX }, imageSize))
      .toEqual({ x: 0, y: 0, width: MIN_RECTANGLE_SIZE_PX, height: MIN_RECTANGLE_SIZE_PX });
  });

  it('does not draw at all when no class is active', () => {
    const { onCreate, onSelect } = setup({ activeClassId: null });
    drag({ x: 200, y: 100 }, { x: 400, y: 250 });
    expect(onCreate).not.toHaveBeenCalled();
    expect(node('draw-preview')).toBeUndefined();
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('claims the pointer while drawing so the stage cannot pan instead', () => {
    setup({ rectangles: [existing], selectedId: existing.id });
    const down = pointerEvent({ x: 200, y: 100 });
    act(() => handler('draw-surface', 'onMouseDown')(down));
    expect(down.cancelBubble).toBe(true);
    // Stored rectangles and the delete handle stop listening mid-draw: Konva
    // would otherwise switch the pointer target and cut the pending rectangle.
    expect(node(`rectangle-${existing.id}`)).toMatchObject({ listening: false });
    expect(node('delete-handle')).toMatchObject({ listening: false });
    act(() => handler('draw-surface', 'onMouseUp')(pointerEvent({ x: 400, y: 250 })));
    expect(node(`rectangle-${existing.id}`)).toMatchObject({ listening: true });
    expect(node('delete-handle')).toMatchObject({ listening: true });
    expect(node('draw-surface')).not.toHaveProperty('onMouseLeave');
  });

  it('leaves panning alone when no class is active', () => {
    setup({ activeClassId: null });
    const down = pointerEvent({ x: 200, y: 100 });
    act(() => handler('draw-surface', 'onMouseDown')(down));
    expect(down.cancelBubble).toBe(false);
  });

  it('selects a rectangle on click without starting a new one', () => {
    const { onSelect, onCreate } = setup({ rectangles: [existing] });
    const event = pointerEvent({ x: 210, y: 110 });
    act(() => handler(`rectangle-${existing.id}`, 'onMouseDown')(event));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(existing.id);
    expect(event.cancelBubble).toBe(true);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('names the selected rectangle and deletes it from its handle', () => {
    const { onDelete } = setup({ rectangles: [existing], selectedId: existing.id });
    expect(node('selection-label')).toMatchObject({ text: `選択中 ${existing.id}`, x: existing.x });
    expect(node(`rectangle-${existing.id}`)).toMatchObject({
      x: 100, y: 80, width: 200, height: 120, stroke: '#f2a900', strokeWidth: (2 / viewport.scale) * 2,
    });
    const event = pointerEvent({ x: 0, y: 0 });
    act(() => handler('delete-handle', 'onMouseDown')(event));
    expect(onDelete).toHaveBeenCalledExactlyOnceWith(existing.id);
    expect(event.cancelBubble).toBe(true);
  });

  it('leaves unselected rectangles visually distinct and keeps stroke width independent of zoom', () => {
    setup({ rectangles: [existing], selectedId: null });
    expect(node(`rectangle-${existing.id}`)).toMatchObject({ stroke: '#1c6fd6', strokeWidth: 2 / viewport.scale });
    expect(node('selection-label')).toBeUndefined();
    expect(node('delete-handle')).toBeUndefined();
  });
});
