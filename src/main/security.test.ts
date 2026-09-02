import type {
  BrowserWindowConstructorOptions,
  WebContents,
  WindowOpenHandlerResponse,
} from 'electron';
import { describe, expect, it, vi } from 'vitest';

import {
  applyWindowSecurity,
  createSecureWebPreferences,
} from './security.js';
import { createMainWindow } from './window.js';

type NavigationListener = (event: { preventDefault: () => void }) => void;
type WindowOpenHandler = () => WindowOpenHandlerResponse;

function createWebContentsHarness() {
  const on = vi.fn<(event: string, listener: NavigationListener) => void>();
  const setWindowOpenHandler = vi.fn<
    (handler: WindowOpenHandler) => void
  >();
  const webContents = {
    on,
    setWindowOpenHandler,
  } as unknown as WebContents;

  return { on, setWindowOpenHandler, webContents };
}

describe('secure window', () => {
  it('uses explicit isolation, sandbox, and Node integration restrictions', () => {
    expect(createSecureWebPreferences()).toEqual({
      allowRunningInsecureContent: false,
      contextIsolation: true,
      navigateOnDragDrop: false,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
    });
  });

  it('adds only a supplied preload path to the secure preferences', () => {
    const preferences = createSecureWebPreferences(
      'C:\\app\\dist\\preload\\index.js',
    );

    expect(preferences).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      preload: 'C:\\app\\dist\\preload\\index.js',
      sandbox: true,
    });
  });

  it('prevents renderer-initiated main-frame and subframe navigation', () => {
    const { on, webContents } = createWebContentsHarness();

    applyWindowSecurity(webContents);

    expect(on.mock.calls.map(([event]) => event)).toEqual([
      'will-navigate',
      'will-frame-navigate',
    ]);

    for (const [, listener] of on.mock.calls) {
      const preventDefault = vi.fn();

      listener({ preventDefault });

      expect(preventDefault).toHaveBeenCalledOnce();
    }
  });

  it('denies every renderer request for another window', () => {
    const { setWindowOpenHandler, webContents } =
      createWebContentsHarness();

    applyWindowSecurity(webContents);

    expect(setWindowOpenHandler).toHaveBeenCalledOnce();
    const [[handler]] = setWindowOpenHandler.mock.calls;
    expect(handler()).toEqual({ action: 'deny' });
  });

  it('creates and loads a window with the security policy installed', () => {
    const { on, setWindowOpenHandler, webContents } =
      createWebContentsHarness();
    const loadFile = vi.fn<(filePath: string) => Promise<void>>();
    loadFile.mockResolvedValue(undefined);
    let receivedOptions: BrowserWindowConstructorOptions | undefined;

    class TestBrowserWindow {
      readonly webContents = webContents;
      readonly loadFile = loadFile;

      constructor(options: BrowserWindowConstructorOptions) {
        receivedOptions = options;
      }
    }

    const window = createMainWindow({
      BrowserWindow: TestBrowserWindow,
      onLoadError: vi.fn(),
      rendererEntryPath: 'C:\\app\\dist\\renderer\\index.html',
    });

    expect(window).toBeInstanceOf(TestBrowserWindow);
    expect(receivedOptions?.webPreferences).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    });
    expect(on).toHaveBeenCalledTimes(2);
    expect(setWindowOpenHandler).toHaveBeenCalledOnce();
    expect(loadFile).toHaveBeenCalledWith(
      'C:\\app\\dist\\renderer\\index.html',
    );
  });

  it('reports a renderer load failure to the caller', async () => {
    const { webContents } = createWebContentsHarness();
    const failure = new Error('renderer unavailable');
    const loadFile = vi
      .fn<(filePath: string) => Promise<void>>()
      .mockRejectedValue(failure);
    const onLoadError = vi.fn<(error: unknown) => void>();

    class TestBrowserWindow {
      readonly webContents = webContents;
      readonly loadFile = loadFile;
    }

    createMainWindow({
      BrowserWindow: TestBrowserWindow,
      onLoadError,
      rendererEntryPath: 'C:\\app\\dist\\renderer\\index.html',
    });
    await Promise.resolve();

    expect(onLoadError).toHaveBeenCalledWith(failure);
  });
});