import type {
  WebContents,
  WebPreferences,
  WindowOpenHandlerResponse,
} from 'electron';

export function createSecureWebPreferences(
  preloadPath?: string,
): WebPreferences {
  const webPreferences: WebPreferences = {
    allowRunningInsecureContent: false,
    contextIsolation: true,
    navigateOnDragDrop: false,
    nodeIntegration: false,
    nodeIntegrationInSubFrames: false,
    nodeIntegrationInWorker: false,
    sandbox: true,
    webSecurity: true,
    webviewTag: false,
  };

  if (preloadPath !== undefined) {
    webPreferences.preload = preloadPath;
  }

  return webPreferences;
}

export function applyWindowSecurity(webContents: WebContents): void {
  webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });

  webContents.on('will-frame-navigate', (event) => {
    event.preventDefault();
  });

  webContents.setWindowOpenHandler(
    (): WindowOpenHandlerResponse => ({ action: 'deny' }),
  );
}