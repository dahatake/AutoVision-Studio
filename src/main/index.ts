import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { app, BrowserWindow } from 'electron';

import { initializeAppLifecycle } from './app-lifecycle.js';

const rendererEntryPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../renderer/index.html',
);

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow();

  void window.loadFile(rendererEntryPath).catch((error: unknown) => {
    console.error('Failed to load the renderer entry.', error);
    app.quit();
  });

  return window;
}

initializeAppLifecycle({
  app: {
    requestSingleInstanceLock: () => app.requestSingleInstanceLock(),
    quit: () => app.quit(),
    whenReady: () => app.whenReady(),
    onSecondInstance: (listener) => {
      app.on('second-instance', () => listener());
    },
    onActivate: (listener) => {
      app.on('activate', () => listener());
    },
    onWindowAllClosed: (listener) => {
      app.on('window-all-closed', () => listener());
    },
  },
  createWindow: createMainWindow,
  getWindows: () => BrowserWindow.getAllWindows(),
  platform: process.platform,
});