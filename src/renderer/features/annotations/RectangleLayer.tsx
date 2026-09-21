import { useState } from 'react';
import type { KonvaEventObject } from 'konva/lib/Node';
import { Group, Rect, Text } from 'react-konva';
import type { AnnotationRectangle } from '../../../shared/contracts/annotation';
import {
  clampPointToImage, displayToImage, type Point, type Size, type Viewport,
} from './canvas-coordinates';

/** A rectangle smaller than this in image pixels is a mis-click, not an
 * annotation. Creation refuses it; W2-12 refuses to shrink past it. */
export const MIN_RECTANGLE_SIZE_PX = 4;

export interface RectangleLayerProps {
  readonly rectangles: readonly AnnotationRectangle[];
  readonly imageSize: Size;
  readonly viewport: Viewport;
  readonly selectedId: string | null;
  /** Class applied to a newly drawn rectangle; `null` disables drawing. */
  readonly activeClassId: string | null;
  readonly onSelect: (id: string | null) => void;
  readonly onCreate: (rectangle: AnnotationRectangle) => void;
  readonly onDelete: (id: string) => void;
}

/** Box from two image-pixel corners, clamped to the image and refused when it
 * is below the minimum size. Coordinates stay in image pixels: the stage is
 * scaled, so nothing here multiplies by the zoom factor. */
export function draftRectangle(start: Point, end: Point, imageSize: Size):
{ x: number; y: number; width: number; height: number } | null {
  const first = clampPointToImage(start, imageSize);
  const second = clampPointToImage(end, imageSize);
  if (first === null || second === null) return null;
  const x = Math.min(first.x, second.x), y = Math.min(first.y, second.y);
  const width = Math.abs(second.x - first.x), height = Math.abs(second.y - first.y);
  if (width < MIN_RECTANGLE_SIZE_PX || height < MIN_RECTANGLE_SIZE_PX) return null;
  return { x, y, width, height };
}

function pointerImagePoint(event: KonvaEventObject<MouseEvent>, viewport: Viewport, imageSize: Size): Point | null {
  const position = event.target.getStage()?.getPointerPosition() ?? null;
  if (position === null) return null;
  const image = displayToImage(position, viewport);
  return image === null ? null : clampPointToImage(image, imageSize);
}

/** W2-11: create, select and delete axis-aligned rectangles on the detection
 * canvas, and name the selected one. Moving and resizing an existing rectangle
 * is W2-12; this leaf never mutates a stored rectangle's geometry. */
export function RectangleLayer({
  rectangles, imageSize, viewport, selectedId, activeClassId, onSelect, onCreate, onDelete,
}: RectangleLayerProps) {
  const [draft, setDraft] = useState<{ start: Point; current: Point } | null>(null);
  // Konva scales strokes with the stage; divide so outlines stay readable
  // at every zoom level without changing stored geometry.
  const stroke = 2 / viewport.scale;
  const handle = 16 / viewport.scale;
  const selected = rectangles.find((rectangle) => rectangle.id === selectedId) ?? null;
  const box = draft === null ? null : draftRectangle(draft.start, draft.current, imageSize);

  function onSurfaceDown(event: KonvaEventObject<MouseEvent>) {
    onSelect(null);
    if (activeClassId === null) return;
    const point = pointerImagePoint(event, viewport, imageSize);
    if (point === null) return;
    // Drawing wins over stage panning: without this the draggable stage would
    // swallow the pointer stream and Konva would stop delivering move events.
    event.cancelBubble = true;
    setDraft({ start: point, current: point });
  }

  function onSurfaceMove(event: KonvaEventObject<MouseEvent>) {
    if (draft === null) return;
    const point = pointerImagePoint(event, viewport, imageSize);
    if (point !== null) setDraft({ start: draft.start, current: point });
  }

  function onSurfaceUp(event: KonvaEventObject<MouseEvent>) {
    if (draft === null) return;
    // The release position is authoritative: a fast drag can end without a
    // matching move event, and dropping it would silently shrink the rectangle.
    const point = pointerImagePoint(event, viewport, imageSize) ?? draft.current;
    const created = draftRectangle(draft.start, point, imageSize);
    setDraft(null);
    if (created !== null && activeClassId !== null) {
      onCreate({ id: crypto.randomUUID(), classId: activeClassId, ...created });
    }
  }

  return (
    <Group name="rectangle-layer">
      <Rect
        name="draw-surface" x={0} y={0} width={imageSize.width} height={imageSize.height}
        fillEnabled={false} listening
        onMouseDown={onSurfaceDown} onMouseMove={onSurfaceMove} onMouseUp={onSurfaceUp}
      />
      {rectangles.map((rectangle) => (
        <Rect
          key={rectangle.id} name={`rectangle-${rectangle.id}`}
          x={rectangle.x} y={rectangle.y} width={rectangle.width} height={rectangle.height}
          fillEnabled={false} stroke={rectangle.id === selectedId ? '#f2a900' : '#1c6fd6'}
          strokeWidth={rectangle.id === selectedId ? stroke * 2 : stroke}
          dash={rectangle.id === selectedId ? [handle / 2, handle / 2] : undefined}
          // While drawing, stored rectangles must not take over the pointer:
          // Konva would fire leave/enter on them and cut the pending rectangle.
          listening={draft === null}
          onMouseDown={(event: KonvaEventObject<MouseEvent>) => { event.cancelBubble = true; onSelect(rectangle.id); }}
        />
      ))}
      {box !== null && (
        <Rect name="draw-preview" x={box.x} y={box.y} width={box.width} height={box.height}
          fillEnabled={false} stroke="#f2a900" strokeWidth={stroke} dash={[handle / 2, handle / 2]} listening={false} />
      )}
      {selected !== null && (
        <>
          <Text name="selection-label" x={selected.x} y={Math.max(0, selected.y - handle)}
            fontSize={handle} fill="#f2a900" listening={false}
            text={`選択中 ${selected.id}`} />
          <Group name="delete-handle" x={selected.x + selected.width} y={selected.y}
            listening={draft === null}
            onMouseDown={(event: KonvaEventObject<MouseEvent>) => { event.cancelBubble = true; onDelete(selected.id); }}>
            <Rect x={-handle} y={0} width={handle} height={handle} fill="#b3261e" />
            <Text x={-handle} y={0} width={handle} height={handle} align="center"
              fontSize={handle} fill="#ffffff" text="×" listening={false} />
          </Group>
        </>
      )}
    </Group>
  );
}
