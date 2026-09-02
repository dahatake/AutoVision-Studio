import type {
  BrowserWindowConstructorOptions,
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
}

export function createMainWindow<TWindow extends MainWindow>({
  BrowserWindow,
  onLoadError,
  preloadPath,
  rendererEntryPath,
}: CreateMainWindowOptions<TWindow>): TWindow {
  const mainWindow = new BrowserWindow({
    webPreferences: createSecureWebPreferences(preloadPath),
  });

  applyWindowSecurity(mainWindow.webContents);

  void mainWindow.loadFile(rendererEntryPath).catch(onLoadError);

  return mainWindow;
}