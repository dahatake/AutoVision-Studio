import { useEffect, useRef } from 'react';
import type { KonvaEventObject } from 'konva/lib/Node';
import type { Rect as KonvaRect } from 'konva/lib/shapes/Rect';
import type { Box, Transformer as KonvaTransformer } from 'konva/lib/shapes/Transformer';
import { Rect, Transformer } from 'react-konva';
import type { AnnotationRectangle } from '../../../shared/contracts/annotation';
import type { Size, Viewport } from './canvas-coordinates';
import { MIN_RECTANGLE_SIZE_PX } from './RectangleLayer';

export interface RectangleTransformerProps {
  /** `null` while nothing is selected: the transformer then renders nothing. */
  readonly rectangle: AnnotationRectangle | null;
  readonly imageSize: Size;
  readonly viewport: Viewport;
  readonly onChange: (rectangle: AnnotationRectangle) => void;
}

interface Geometry {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Fits a moved or resized box inside the image without ever producing a box
 * below the minimum size. Refuses (returns `null`) rather than inventing a
 * rectangle when the request is non-finite or too small to be an annotation. */
export function clampRectangleToImage(box: Geometry, imageSize: Size): Geometry | null {
  if (!finite(box.x) || !finite(box.y) || !finite(box.width) || !finite(box.height)) return null;
  if (!finite(imageSize.width) || !finite(imageSize.height)) return null;
  if (box.width < MIN_RECTANGLE_SIZE_PX || box.height < MIN_RECTANGLE_SIZE_PX) return null;
  if (imageSize.width < MIN_RECTANGLE_SIZE_PX || imageSize.height < MIN_RECTANGLE_SIZE_PX) return null;
  const x = Math.min(Math.max(box.x, 0), Math.max(0, imageSize.width - Math.min(box.width, imageSize.width)));
  const y = Math.min(Math.max(box.y, 0), Math.max(0, imageSize.height - Math.min(box.height, imageSize.height)));
  // Re-derive the extent by the same subtraction annotationItemSchema uses
  // (`width <= imageWidth - x`): rounding in `imageWidth - width` can otherwise
  // leave an edge-clamped rectangle one ulp outside the stored bound.
  const width = Math.min(box.width, imageSize.width - x);
  const height = Math.min(box.height, imageSize.height - y);
  if (width < MIN_RECTANGLE_SIZE_PX || height < MIN_RECTANGLE_SIZE_PX) return null;
  return { x, y, width, height };
}

function toImageGeometry(box: Box, viewport: Viewport): Geometry {
  return {
    x: (box.x - viewport.offsetX) / viewport.scale,
    y: (box.y - viewport.offsetY) / viewport.scale,
    width: box.width / viewport.scale,
    height: box.height / viewport.scale,
  };
}

/** Konva hands the transformer boxes in display coordinates, so the image-pixel
 * limits are applied after converting and the accepted box is converted back.
 * A refused box keeps the previous one: the handle stops instead of snapping. */
export function boundBoxLimiter(viewport: Viewport, imageSize: Size): (oldBox: Box, newBox: Box) => Box {
  return (oldBox, newBox) => {
    if (newBox.rotation !== 0) return oldBox;
    const clamped = clampRectangleToImage(toImageGeometry(newBox, viewport), imageSize);
    if (clamped === null) return oldBox;
    return {
      x: clamped.x * viewport.scale + viewport.offsetX,
      y: clamped.y * viewport.scale + viewport.offsetY,
      width: clamped.width * viewport.scale,
      height: clamped.height * viewport.scale,
      rotation: 0,
    };
  };
}

/** W2-12: move and resize the selected rectangle. Every emitted value is in
 * image pixels; nothing here changes which rectangle is selected, and no
 * rectangle is created or deleted (W2-11 owns that). */
export function RectangleTransformer({ rectangle, imageSize, viewport, onChange }: RectangleTransformerProps) {
  const target = useRef<KonvaRect | null>(null);
  const transformer = useRef<KonvaTransformer | null>(null);
  const selectedId = rectangle?.id ?? null;

  useEffect(() => {
    const node = target.current, tool = transformer.current;
    if (node === null || tool === null) return;
    tool.nodes([node]);
    tool.getLayer()?.batchDraw();
  }, [selectedId]);

  if (rectangle === null) return null;
  const selected: AnnotationRectangle = rectangle;

  function restore(node: KonvaRect, current: AnnotationRectangle) {
    node.scaleX(1); node.scaleY(1);
    node.x(current.x); node.y(current.y);
    node.width(current.width); node.height(current.height);
  }

  function commit(node: KonvaRect, box: Geometry, current: AnnotationRectangle) {
    const next = clampRectangleToImage(box, imageSize);
    if (next === null) { restore(node, current); return; }
    restore(node, { ...current, ...next });
    onChange({ ...current, ...next });
  }

  function onTransformEnd(event: KonvaEventObject<Event>) {
    const node = event.target as KonvaRect;
    commit(node, {
      x: node.x(), y: node.y(),
      width: node.width() * node.scaleX(), height: node.height() * node.scaleY(),
    }, selected);
  }

  function onDragEnd(event: KonvaEventObject<DragEvent>) {
    const node = event.target as KonvaRect;
    commit(node, { x: node.x(), y: node.y(), width: selected.width, height: selected.height }, selected);
  }

  return (
    <>
      <Rect
        ref={target} name={`transform-target-${selected.id}`}
        x={selected.x} y={selected.y} width={selected.width} height={selected.height}
        fillEnabled={false} draggable
        dragBoundFunc={(position) => {
          const clamped = clampRectangleToImage(
            {
              ...toImageGeometry({ ...position, width: 0, height: 0, rotation: 0 }, viewport),
              width: selected.width, height: selected.height,
            },
            imageSize,
          );
          if (clamped === null) return position;
          return { x: clamped.x * viewport.scale + viewport.offsetX, y: clamped.y * viewport.scale + viewport.offsetY };
        }}
        onDragEnd={onDragEnd} onTransformEnd={onTransformEnd}
      />
      <Transformer
        ref={transformer} name="rectangle-transformer"
        rotateEnabled={false} keepRatio={false} flipEnabled={false} ignoreStroke
        boundBoxFunc={boundBoxLimiter(viewport, imageSize)}
      />
    </>
  );
}
