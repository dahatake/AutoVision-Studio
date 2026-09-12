import type {
  BrowserWindowConstructorOptions,
  Protocol,
  WebContents,
  WindowOpenHandlerResponse,
} from 'electron';
import { describe, expect, it, vi } from 'vitest';
import rendererHtml from '../renderer/index.html?raw';

import {
  applyWindowSecurity,
  createSecureWebPreferences,
  registerImageScheme,
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
  it('registers only the explicit image privileges without CSP bypass or streaming privileges', () => {
    const registerSchemesAsPrivileged = vi.fn<Protocol['registerSchemesAsPrivileged']>();
    expect(registerSchemesAsPrivileged).not.toHaveBeenCalled();
    registerImageScheme({ registerSchemesAsPrivileged });
    expect(registerSchemesAsPrivileged.mock.calls).toEqual([[ [{ scheme: 'av-image', privileges: {
      standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, bypassCSP: false,
    } }] ]]);
  });

  it('places a restrictive file-renderer CSP before scripts, preserving inline styles and camera media only', () => {
    const html = rendererHtml;
    const meta = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"\s*\/>/u.exec(html)!;
    expect(meta).not.toBeNull();
    expect(html.indexOf(meta[0])).toBeLessThan(html.indexOf('<script'));
    expect(meta[1]!.split('; ')).toEqual([
      "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: av-image:", "connect-src 'self' av-image:", "font-src 'self' data:",
      "object-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-src 'none'",
      "worker-src 'self'", "media-src 'self' blob:",
    ]);
    expect(meta[1]).not.toMatch(/unsafe-eval|https?:|file:|\*/u);
  });

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