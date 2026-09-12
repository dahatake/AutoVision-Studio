import type {
  BrowserWindowConstructorOptions,
  Rectangle,
  WebContents,
} from 'electron';

import {
  applyWindowSecurity,
  createSecureWebPreferences,
} from './security.js';

export interface MainWindow {
  readonly webContents: WebContents;
  loadFile(filePath: string): Promise<void>;
}

export type BrowserWindowConstructor<TWindow extends MainWindow> = new (
  options: BrowserWindowConstructorOptions,
) => TWindow;

export interface CreateMainWindowOptions<TWindow extends MainWindow> {
  BrowserWindow: BrowserWindowConstructor<TWindow>;
  onLoadError: (error: unknown) => void;
  preloadPath?: string;
  rendererEntryPath: string;
  workArea?: Rectangle;
}

export function createMainWindow<TWindow extends MainWindow>({
  BrowserWindow,
  onLoadError,
  preloadPath,
  rendererEntryPath,
  workArea,
}: CreateMainWindowOptions<TWindow>): TWindow {
  const options: BrowserWindowConstructorOptions = {
    webPreferences: createSecureWebPreferences(preloadPath),
  };

  if (workArea !== undefined) {
    // Outer-window bounds in DIP, not guaranteed renderer content dimensions.
    options.width = Math.min(1360, workArea.width);
    options.height = Math.min(800, workArea.height);
    options.x = workArea.x + Math.floor((workArea.width - options.width) / 2);
    options.y = workArea.y + Math.floor((workArea.height - options.height) / 2);
  }

  const mainWindow = new BrowserWindow(options);

  applyWindowSecurity(mainWindow.webContents);

  void mainWindow.loadFile(rendererEntryPath).catch(onLoadError);

  return mainWindow;
}