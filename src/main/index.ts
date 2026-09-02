import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { app, BrowserWindow } from 'electron';

import { initializeAppLifecycle } from './app-lifecycle.js';
import { createMainWindow as createSecureMainWindow } from './window.js';

const mainBundleDirectory = dirname(fileURLToPath(import.meta.url));
const preloadPath = resolve(mainBundleDirectory, '../preload/index.cjs');
const rendererEntryPath = resolve(mainBundleDirectory, '../renderer/index.html');

function createAppWindow(): BrowserWindow {
  return createSecureMainWindow({
    BrowserWindow,
    preloadPath,
    rendererEntryPath,
    onLoadError: (error: unknown) => {
      console.error('Failed to load the renderer entry.', error);
      app.quit();
    },
  });
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
  createWindow: createAppWindow,
  getWindows: () => BrowserWindow.getAllWindows(),
  platform: process.platform,
});