import type {
  Protocol,
  WebContents,
  WebPreferences,
  WindowOpenHandlerResponse,
} from 'electron';

/** Explicit primary-Main call before app.whenReady(); importing this module is inert. */
export function registerImageScheme(protocol: Pick<Protocol, 'registerSchemesAsPrivileged'>): void {
  protocol.registerSchemesAsPrivileged([{ scheme: 'av-image', privileges: {
    standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, bypassCSP: false,
  } }]);
}

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