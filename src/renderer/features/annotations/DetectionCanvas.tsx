import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { KonvaEventObject } from 'konva/lib/Node';
import { Image as KonvaImage, Layer, Stage } from 'react-konva';
import { AnnotationInstructions } from './AnnotationInstructions';
import {
  MAX_SCALE, MIN_SCALE, createViewport, fitViewport, panViewport, zoomViewportAt,
  type Size, type Viewport,
} from './canvas-coordinates';

export interface DetectionCanvasProps {
  readonly imageUrl: string;
  readonly imageSize: Size;
  /** Caller owns layout measurement; this leaf never reads the DOM box. */
  readonly containerSize: Size;
  readonly onViewportChange?: (viewport: Viewport | null) => void;
  /** Project の Label Schema の作業指示（W2-15）。読み取り専用でそのまま渡す。 */
  readonly instructions: string;
  /** Konva nodes drawn in image pixel space above the image (W2-11 and later). */
  readonly children?: ReactNode;
}

/** Zoom steps stay coarse enough to reach 1:1 and back with few keystrokes. */
const ZOOM_STEP = 1.25;
const PAN_STEP_PX = 48;

/** W2-10: image display with zoom and pan only. Rectangle creation, selection
 * and transformation are W2-11/W2-12 leaves and are deliberately absent here;
 * this component just hands a viewport to whatever is rendered as children. */
export function DetectionCanvas({
  imageUrl, imageSize, containerSize, onViewportChange, instructions, children,
}: DetectionCanvasProps) {
  const fit = useMemo(
    () => fitViewport(imageSize, containerSize),
    [imageSize.width, imageSize.height, containerSize.width, containerSize.height],
  );
  const [viewport, setViewport] = useState<Viewport | null>(fit);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => { setViewport(fit); setNotice(null); }, [fit]);
  useEffect(() => { onViewportChange?.(viewport); }, [viewport, onViewportChange]);

  useEffect(() => {
    let active = true;
    const element = new window.Image();
    setImage(null);
    setLoadState('loading');
    element.onload = () => { if (active) { setImage(element); setLoadState('ready'); } };
    element.onerror = () => { if (active) { setImage(null); setLoadState('failed'); } };
    element.src = imageUrl;
    return () => { active = false; element.onload = null; element.onerror = null; };
  }, [imageUrl]);

  // A refused viewport keeps the current view and says so, instead of snapping
  // to a limit and pretending the requested zoom or pan was applied.
  function apply(next: Viewport | null, refusal: string) {
    if (next === null) { setNotice(refusal); return; }
    setNotice(null);
    setViewport(next);
  }

  function zoom(factor: number) {
    if (viewport === null) return;
    const focus = { x: containerSize.width / 2, y: containerSize.height / 2 };
    apply(
      zoomViewportAt(viewport, focus, viewport.scale * factor),
      factor > 1 ? `これ以上拡大できません（上限 ${Math.round(MAX_SCALE * 100)}%）`
        : `これ以上縮小できません（下限 ${Math.round(MIN_SCALE * 100)}%）`,
    );
  }

  function pan(deltaX: number, deltaY: number) {
    if (viewport === null) return;
    apply(panViewport(viewport, deltaX, deltaY), '表示位置をこれ以上移動できません');
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const moves: Record<string, [number, number]> = {
      ArrowRight: [-PAN_STEP_PX, 0], ArrowLeft: [PAN_STEP_PX, 0],
      ArrowDown: [0, -PAN_STEP_PX], ArrowUp: [0, PAN_STEP_PX],
    };
    const move = moves[event.key];
    if (move) { event.preventDefault(); pan(move[0], move[1]); return; }
    if (event.key === '+') { event.preventDefault(); zoom(ZOOM_STEP); }
    else if (event.key === '-') { event.preventDefault(); zoom(1 / ZOOM_STEP); }
  }

  function onDragEnd(event: KonvaEventObject<DragEvent>) {
    // Konva bubbles `dragend` from every draggable descendant (a rectangle
    // being moved reports image pixels); only the stage's own drag pans.
    const stage = event.target.getStage();
    if (stage === null || event.target !== stage) return;
    if (viewport === null) return;
    const next = createViewport(viewport.scale, stage.x(), stage.y());
    if (next !== null) setViewport(next);
  }

  const status = viewport === null ? '表示領域が小さすぎて画像を表示できません'
    : loadState === 'failed' ? '画像を読み込めません'
      : loadState === 'loading' ? '画像を読み込み中'
        : `表示倍率 ${Math.round(viewport.scale * 100)}% ／ 表示位置 X ${Math.round(viewport.offsetX)}, Y ${Math.round(viewport.offsetY)}`;

  return (
    <section aria-label="検出キャンバス">
      <AnnotationInstructions instructions={instructions} />
      <div role="group" aria-label="表示操作">
        <button type="button" onClick={() => zoom(ZOOM_STEP)} disabled={viewport === null}>拡大</button>
        <button type="button" onClick={() => zoom(1 / ZOOM_STEP)} disabled={viewport === null}>縮小</button>
        <button type="button" onClick={() => { setNotice(null); setViewport(fit); }} disabled={fit === null}>全体表示</button>
      </div>
      <p role="status">{status}</p>
      {notice !== null && <p role="alert">{notice}</p>}
      <div
        tabIndex={0}
        aria-label="画像表示領域（矢印キーで移動、プラスとマイナスで拡大縮小）"
        onKeyDown={onKeyDown}
      >
        {viewport !== null && (
          <Stage
            width={containerSize.width} height={containerSize.height}
            scaleX={viewport.scale} scaleY={viewport.scale}
            x={viewport.offsetX} y={viewport.offsetY}
            draggable onDragEnd={onDragEnd}
          >
            <Layer>
              {image !== null && (
                <KonvaImage image={image} x={0} y={0}
                  width={imageSize.width} height={imageSize.height} listening={false} />
              )}
              {children}
            </Layer>
          </Stage>
        )}
      </div>
    </section>
  );
}
