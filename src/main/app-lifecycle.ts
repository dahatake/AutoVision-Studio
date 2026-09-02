export interface WindowPort {
  isMinimized(): boolean;
  restore(): void;
  focus(): void;
}

export interface AppPort {
  requestSingleInstanceLock(): boolean;
  quit(): void;
  whenReady(): Promise<void>;
  onSecondInstance(listener: () => void): void;
  onActivate(listener: () => void): void;
  onWindowAllClosed(listener: () => void): void;
}

export interface AppLifecycleOptions {
  app: AppPort;
  createWindow(): WindowPort;
  getWindows(): readonly WindowPort[];
  platform: string;
}

export function initializeAppLifecycle({
  app,
  createWindow,
  getWindows,
  platform,
}: AppLifecycleOptions): void {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  const ensureWindow = (): WindowPort => getWindows()[0] ?? createWindow();

  app.onSecondInstance(() => {
    const window = ensureWindow();

    if (window.isMinimized()) {
      window.restore();
    }

    window.focus();
  });

  app.onActivate(() => {
    ensureWindow();
  });

  app.onWindowAllClosed(() => {
    if (platform !== 'darwin') {
      app.quit();
    }
  });

  void app.whenReady().then(() => {
    ensureWindow();
  });
}