import type {
  BrowserWindowConstructorOptions,
  WebContents,
} from 'electron';
import { describe, expect, it, vi } from 'vitest';

import { createMainWindow } from './window.js';

class TestBrowserWindow {
  readonly options: BrowserWindowConstructorOptions;
  readonly webContents = {
    on: vi.fn(),
    setWindowOpenHandler: vi.fn(),
  } as unknown as WebContents;
  readonly loadFile = vi
    .fn<(filePath: string) => Promise<void>>()
    .mockResolvedValue(undefined);

  constructor(options: BrowserWindowConstructorOptions) {
    this.options = options;
  }
}

describe('createMainWindow bounds', () => {
  it.each([
    {
      name: 'large work area',
      workArea: { x: 0, y: 0, width: 1920, height: 1040 },
      expected: { x: 280, y: 120, width: 1360, height: 800 },
    },
    {
      name: 'small work area',
      workArea: { x: 0, y: 0, width: 1024, height: 600 },
      expected: { x: 0, y: 0, width: 1024, height: 600 },
    },
    {
      name: 'negative monitor origin',
      workArea: { x: -1920, y: -1080, width: 1920, height: 1040 },
      expected: { x: -1640, y: -960, width: 1360, height: 800 },
    },
    {
      name: 'offset monitor work area',
      workArea: { x: 1920, y: 40, width: 1600, height: 900 },
      expected: { x: 2040, y: 90, width: 1360, height: 800 },
    },
    {
      name: 'narrow work area with an odd vertical remainder',
      workArea: { x: 40, y: 10, width: 1024, height: 1001 },
      expected: { x: 40, y: 110, width: 1024, height: 800 },
    },
    {
      name: 'short work area with an odd horizontal remainder',
      workArea: { x: -1601, y: 30, width: 1601, height: 600 },
      expected: { x: -1481, y: 30, width: 1360, height: 600 },
    },
    {
      name: 'exact target size',
      workArea: { x: 25, y: -800, width: 1360, height: 800 },
      expected: { x: 25, y: -800, width: 1360, height: 800 },
    },
  ])('fits and centers outer bounds in $name without resize limits', ({
    workArea,
    expected,
  }) => {
    const window = createMainWindow({
      BrowserWindow: TestBrowserWindow,
      onLoadError: vi.fn(),
      rendererEntryPath: 'C:\\app\\dist\\renderer\\index.html',
      workArea,
    });
    const { width, height, x, y } = window.options;

    expect({ width, height, x, y }).toEqual(expected);
    expect(width).toBeLessThanOrEqual(workArea.width);
    expect(height).toBeLessThanOrEqual(workArea.height);
    expect(x).toBeGreaterThanOrEqual(workArea.x);
    expect(y).toBeGreaterThanOrEqual(workArea.y);
    expect(x! + width!).toBeLessThanOrEqual(workArea.x + workArea.width);
    expect(y! + height!).toBeLessThanOrEqual(workArea.y + workArea.height);

    for (const property of [
      'minWidth',
      'minHeight',
      'maxWidth',
      'maxHeight',
      'resizable',
      'useContentSize',
    ]) {
      expect(window.options).not.toHaveProperty(property);
    }
  });

  it('preserves existing calls without a work area', () => {
    const window = createMainWindow({
      BrowserWindow: TestBrowserWindow,
      onLoadError: vi.fn(),
      rendererEntryPath: 'C:\\app\\dist\\renderer\\index.html',
    });

    expect(window).toBeInstanceOf(TestBrowserWindow);
    expect(Object.keys(window.options)).toEqual(['webPreferences']);
    expect(window.loadFile).toHaveBeenCalledWith(
      'C:\\app\\dist\\renderer\\index.html',
    );
  });
});