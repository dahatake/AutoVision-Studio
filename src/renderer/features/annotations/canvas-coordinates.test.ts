import { describe, expect, it } from 'vitest';
import {
  MAX_DISPLAY_COORDINATE, MAX_IMAGE_DIMENSION, MAX_SCALE, MIN_SCALE,
  clampPointToImage, createViewport, displayToImage, fitViewport, imageToDisplay,
  isPoint, isSize, isViewport, panViewport, zoomViewportAt,
  type Point, type Viewport,
} from './canvas-coordinates';

const nonFinite = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
const viewports: readonly Viewport[] = [
  { scale: 1, offsetX: 0, offsetY: 0 },
  { scale: 0.25, offsetX: -137.5, offsetY: 64.25 },
  { scale: 3.75, offsetX: 512, offsetY: -1024.5 },
  { scale: MIN_SCALE, offsetX: 0.5, offsetY: -0.5 },
  { scale: MAX_SCALE, offsetX: -8192, offsetY: 8192 },
];
const points: readonly Point[] = [
  { x: 0, y: 0 }, { x: 1, y: 1 }, { x: 3840, y: 2160 }, { x: 1920.5, y: 0.25 }, { x: 7, y: 4095 },
];

function roundTrip(point: Point, viewport: Viewport): Point {
  const display = imageToDisplay(point, viewport);
  expect(display).not.toBeNull();
  const back = displayToImage(display!, viewport);
  expect(back).not.toBeNull();
  return back!;
}

describe('canvas-coordinates W2-09', () => {
  it('round-trips image pixels through display coordinates under every zoom and pan', () => {
    let checked = 0;
    for (const viewport of viewports) {
      for (const point of points) {
        const back = roundTrip(point, viewport);
        expect(back.x).toBeCloseTo(point.x, 6);
        expect(back.y).toBeCloseTo(point.y, 6);
        checked += 1;
      }
    }
    expect(checked).toBe(viewports.length * points.length);
  });

  it('applies zoom and pan as display = image * scale + offset', () => {
    const viewport = { scale: 2, offsetX: 40, offsetY: -10 };
    expect(imageToDisplay({ x: 100, y: 50 }, viewport)).toEqual({ x: 240, y: 90 });
    expect(displayToImage({ x: 240, y: 90 }, viewport)).toEqual({ x: 100, y: 50 });
    const panned = panViewport(viewport, 15, -5);
    expect(panned).toEqual({ scale: 2, offsetX: 55, offsetY: -15 });
    expect(imageToDisplay({ x: 100, y: 50 }, panned!)).toEqual({ x: 255, y: 85 });
  });

  it('keeps the image pixel under the zoom focus anchored after zooming', () => {
    const viewport = { scale: 1, offsetX: 0, offsetY: 0 };
    const focus = { x: 300, y: 200 };
    const anchor = displayToImage(focus, viewport)!;
    for (const scale of [0.5, 2, 8, MIN_SCALE, MAX_SCALE]) {
      const zoomed = zoomViewportAt(viewport, focus, scale);
      expect(zoomed).not.toBeNull();
      expect(zoomed!.scale).toBe(scale);
      const moved = imageToDisplay(anchor, zoomed!)!;
      expect(moved.x).toBeCloseTo(focus.x, 6);
      expect(moved.y).toBeCloseTo(focus.y, 6);
    }
  });

  it('rejects zoom outside the supported scale range instead of snapping', () => {
    const viewport = { scale: 1, offsetX: 0, offsetY: 0 };
    const focus = { x: 10, y: 10 };
    expect(zoomViewportAt(viewport, focus, MIN_SCALE / 2)).toBeNull();
    expect(zoomViewportAt(viewport, focus, MAX_SCALE + 0.0001)).toBeNull();
    expect(zoomViewportAt(viewport, focus, 0)).toBeNull();
    expect(zoomViewportAt(viewport, focus, -1)).toBeNull();
    for (const value of nonFinite) {
      expect(zoomViewportAt(viewport, focus, value)).toBeNull();
      expect(zoomViewportAt(viewport, { x: value, y: 0 }, 2)).toBeNull();
      expect(panViewport(viewport, value, 0)).toBeNull();
      expect(panViewport(viewport, 0, value)).toBeNull();
    }
  });

  it('rejects non-finite coordinates and viewports in both conversions', () => {
    const viewport = { scale: 1, offsetX: 0, offsetY: 0 };
    for (const value of nonFinite) {
      expect(imageToDisplay({ x: value, y: 0 }, viewport)).toBeNull();
      expect(imageToDisplay({ x: 0, y: value }, viewport)).toBeNull();
      expect(displayToImage({ x: value, y: 0 }, viewport)).toBeNull();
      expect(displayToImage({ x: 0, y: value }, viewport)).toBeNull();
      expect(imageToDisplay({ x: 0, y: 0 }, { scale: value, offsetX: 0, offsetY: 0 })).toBeNull();
      expect(imageToDisplay({ x: 0, y: 0 }, { scale: 1, offsetX: value, offsetY: 0 })).toBeNull();
      expect(displayToImage({ x: 0, y: 0 }, { scale: 1, offsetX: 0, offsetY: value })).toBeNull();
    }
    expect(isPoint({ x: 0, y: Number.NaN })).toBe(false);
    expect(isPoint(null)).toBe(false);
    expect(isViewport(null)).toBe(false);
    expect(isPoint({ x: 0, y: 0 })).toBe(true);
  });

  it('rejects boundary values outside the supported scale, size and display range', () => {
    expect(createViewport(MIN_SCALE, 0, 0)).toEqual({ scale: MIN_SCALE, offsetX: 0, offsetY: 0 });
    expect(createViewport(MAX_SCALE, 0, 0)).toEqual({ scale: MAX_SCALE, offsetX: 0, offsetY: 0 });
    expect(createViewport(MIN_SCALE - Number.EPSILON, 0, 0)).toBeNull();
    expect(createViewport(MAX_SCALE * 2, 0, 0)).toBeNull();
    expect(createViewport(1, MAX_DISPLAY_COORDINATE + 1e6, 0)).toBeNull();
    expect(imageToDisplay({ x: MAX_IMAGE_DIMENSION, y: 0 }, { scale: MAX_SCALE, offsetX: 0, offsetY: 0 })).toBeNull();
    expect(isSize({ width: 0, height: 10 })).toBe(false);
    expect(isSize({ width: 10, height: 0 })).toBe(false);
    expect(isSize({ width: -1, height: 10 })).toBe(false);
    expect(isSize({ width: MAX_IMAGE_DIMENSION + 1, height: 10 })).toBe(false);
    expect(isSize({ width: 1, height: 1 })).toBe(true);
    expect(isSize({ width: MAX_IMAGE_DIMENSION, height: MAX_IMAGE_DIMENSION })).toBe(true);
  });

  it('fits an image into its container centred, and refuses degenerate containers', () => {
    const fitted = fitViewport({ width: 4000, height: 2000 }, { width: 1000, height: 1000 });
    expect(fitted).toEqual({ scale: 0.25, offsetX: 0, offsetY: 250 });
    expect(imageToDisplay({ x: 0, y: 0 }, fitted!)).toEqual({ x: 0, y: 250 });
    expect(imageToDisplay({ x: 4000, y: 2000 }, fitted!)).toEqual({ x: 1000, y: 750 });
    expect(fitViewport({ width: 100, height: 100 }, { width: 1, height: 1 })).toBeNull();
    expect(fitViewport({ width: 4000, height: 4000 }, { width: 10, height: 10 })).toBeNull();
    expect(fitViewport({ width: 10, height: 10 }, { width: 0, height: 100 })).toBeNull();
    expect(fitViewport({ width: 0, height: 10 }, { width: 100, height: 100 })).toBeNull();
    expect(fitViewport({ width: 10, height: 10 }, { width: 100_000, height: 100_000 })?.scale).toBe(MAX_SCALE);
  });

  it('clamps points to the image rectangle without inventing coordinates', () => {
    const image = { width: 640, height: 480 };
    expect(clampPointToImage({ x: -12, y: -3 }, image)).toEqual({ x: 0, y: 0 });
    expect(clampPointToImage({ x: 1000, y: 1000 }, image)).toEqual({ x: 640, y: 480 });
    expect(clampPointToImage({ x: 12.5, y: 33.25 }, image)).toEqual({ x: 12.5, y: 33.25 });
    expect(clampPointToImage({ x: Number.NaN, y: 0 }, image)).toBeNull();
    expect(clampPointToImage({ x: 0, y: 0 }, { width: 0, height: 480 })).toBeNull();
  });
});
