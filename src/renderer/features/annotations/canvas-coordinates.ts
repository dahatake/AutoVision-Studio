/** W2-09: pure image-pixel <-> display-coordinate math for the detection
 * canvas leaves. Rendering, pointer handling and rectangle editing belong to
 * W2-10 and later; this module owns no state and touches no DOM.
 *
 * Model: display = image * scale + offset. `offsetX`/`offsetY` are display
 * pixels, so a viewport is exactly what Konva's Stage consumes.
 *
 * Every entry point returns `null` for input it refuses instead of throwing or
 * silently producing NaN: a non-finite or out-of-range coordinate must never
 * reach a stored annotation rectangle. */

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Viewport {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

/** Below this the 1 image pixel granularity required by rectangle editing is
 * no longer addressable on screen; above it a 4K image exceeds the display
 * coordinate bound below. Both are refusals, not clamps, at the API surface. */
export const MIN_SCALE = 0.02;
export const MAX_SCALE = 64;
/** Image dimensions follow the stored contract bound (`dimension`, 1..2^31-1). */
export const MAX_IMAGE_DIMENSION = 2_147_483_647;
/** No physical viewport addresses beyond this many display pixels; refusing
 * larger results keeps a degenerate zoom from producing unusable geometry. */
export const MAX_DISPLAY_COORDINATE = 2_147_483_648;

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function displayCoordinate(value: unknown): value is number {
  return finite(value) && Math.abs(value) <= MAX_DISPLAY_COORDINATE;
}

export function isSize(value: unknown): value is Size {
  if (typeof value !== 'object' || value === null) return false;
  const { width, height } = value as Partial<Size>;
  return finite(width) && finite(height)
    && width >= 1 && height >= 1
    && width <= MAX_IMAGE_DIMENSION && height <= MAX_IMAGE_DIMENSION;
}

export function isPoint(value: unknown): value is Point {
  if (typeof value !== 'object' || value === null) return false;
  const { x, y } = value as Partial<Point>;
  return finite(x) && finite(y);
}

export function isViewport(value: unknown): value is Viewport {
  if (typeof value !== 'object' || value === null) return false;
  const { scale, offsetX, offsetY } = value as Partial<Viewport>;
  return finite(scale) && scale >= MIN_SCALE && scale <= MAX_SCALE
    && displayCoordinate(offsetX) && displayCoordinate(offsetY);
}

export function createViewport(scale: number, offsetX: number, offsetY: number): Viewport | null {
  const candidate = { scale, offsetX, offsetY };
  return isViewport(candidate) ? candidate : null;
}

/** Scale that shows the whole image inside `container`, centred. Never enlarges
 * past MAX_SCALE and refuses containers too small to hold a single scaled pixel. */
export function fitViewport(image: Size, container: Size): Viewport | null {
  if (!isSize(image) || !isSize(container)) return null;
  const scale = Math.min(container.width / image.width, container.height / image.height);
  if (!finite(scale) || scale < MIN_SCALE) return null;
  const bounded = Math.min(scale, MAX_SCALE);
  return createViewport(
    bounded,
    (container.width - image.width * bounded) / 2,
    (container.height - image.height * bounded) / 2,
  );
}

export function imageToDisplay(point: Point, viewport: Viewport): Point | null {
  if (!isPoint(point) || !isViewport(viewport)) return null;
  const x = point.x * viewport.scale + viewport.offsetX;
  const y = point.y * viewport.scale + viewport.offsetY;
  return displayCoordinate(x) && displayCoordinate(y) ? { x, y } : null;
}

export function displayToImage(point: Point, viewport: Viewport): Point | null {
  if (!isPoint(point) || !isViewport(viewport)) return null;
  const x = (point.x - viewport.offsetX) / viewport.scale;
  const y = (point.y - viewport.offsetY) / viewport.scale;
  return finite(x) && finite(y) ? { x, y } : null;
}

/** Keeps a point inside the image rectangle. Callers converting a pointer
 * position outside the image use this instead of storing outside coordinates. */
export function clampPointToImage(point: Point, image: Size): Point | null {
  if (!isPoint(point) || !isSize(image)) return null;
  return {
    x: Math.min(Math.max(point.x, 0), image.width),
    y: Math.min(Math.max(point.y, 0), image.height),
  };
}

/** Zoom keeping the image pixel currently under `focus` (display coordinates)
 * under the same display position. Refuses a scale outside [MIN_SCALE, MAX_SCALE]
 * rather than snapping, so callers decide what a rejected zoom step means. */
export function zoomViewportAt(viewport: Viewport, focus: Point, nextScale: number): Viewport | null {
  if (!isViewport(viewport) || !isPoint(focus) || !finite(nextScale)) return null;
  if (nextScale < MIN_SCALE || nextScale > MAX_SCALE) return null;
  const anchor = displayToImage(focus, viewport);
  if (anchor === null) return null;
  return createViewport(nextScale, focus.x - anchor.x * nextScale, focus.y - anchor.y * nextScale);
}

export function panViewport(viewport: Viewport, deltaX: number, deltaY: number): Viewport | null {
  if (!isViewport(viewport) || !finite(deltaX) || !finite(deltaY)) return null;
  return createViewport(viewport.scale, viewport.offsetX + deltaX, viewport.offsetY + deltaY);
}
