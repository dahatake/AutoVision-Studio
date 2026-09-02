import { describe, expect, it, vi } from 'vitest';

import {
  initializeAppLifecycle,
  type AppLifecycleOptions,
  type WindowPort,
} from './app-lifecycle.js';

function createWindowStub() {
  return {
    isMinimized: vi.fn(() => false),
    restore: vi.fn(),
    focus: vi.fn(),
  } satisfies WindowPort;
}

function createHarness({
  lockGranted = true,
  platform = 'win32',
}: {
  lockGranted?: boolean;
  platform?: string;
} = {}) {
  let resolveReady = (): void => undefined;
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  const handlers: {
    secondInstance?: () => void;
    activate?: () => void;
    windowAllClosed?: () => void;
  } = {};
  const windows: ReturnType<typeof createWindowStub>[] = [];
  const createdWindows: ReturnType<typeof createWindowStub>[] = [];
  const createWindow = vi.fn(() => {
    const window = createWindowStub();

    windows.push(window);
    createdWindows.push(window);

    return window;
  });
  const requestSingleInstanceLock = vi.fn(() => lockGranted);
  const quit = vi.fn();
  const whenReady = vi.fn(() => ready);
  const onSecondInstance = vi.fn((listener: () => void) => {
    handlers.secondInstance = listener;
  });
  const onActivate = vi.fn((listener: () => void) => {
    handlers.activate = listener;
  });
  const onWindowAllClosed = vi.fn((listener: () => void) => {
    handlers.windowAllClosed = listener;
  });
  const getWindows = vi.fn(() => windows);
  const options: AppLifecycleOptions = {
    app: {
      requestSingleInstanceLock,
      quit,
      whenReady,
      onSecondInstance,
      onActivate,
      onWindowAllClosed,
    },
    createWindow,
    getWindows,
    platform,
  };

  return {
    options,
    requestSingleInstanceLock,
    quit,
    whenReady,
    onSecondInstance,
    onActivate,
    onWindowAllClosed,
    createWindow,
    getWindows,
    windows,
    createdWindows,
    handlers,
    ready,
    resolveReady,
  };
}

async function resolveReadyAndFlush(
  harness: ReturnType<typeof createHarness>,
): Promise<void> {
  harness.resolveReady();
  await harness.ready;
  await Promise.resolve();
}

describe('initializeAppLifecycle', () => {
  it('quits without ready, event, or window processing when the lock is denied', () => {
    const harness = createHarness({ lockGranted: false });

    initializeAppLifecycle(harness.options);

    expect(harness.requestSingleInstanceLock).toHaveBeenCalledOnce();
    expect(harness.quit).toHaveBeenCalledOnce();
    expect(harness.whenReady).not.toHaveBeenCalled();
    expect(harness.onSecondInstance).not.toHaveBeenCalled();
    expect(harness.onActivate).not.toHaveBeenCalled();
    expect(harness.onWindowAllClosed).not.toHaveBeenCalled();
    expect(harness.getWindows).not.toHaveBeenCalled();
    expect(harness.createWindow).not.toHaveBeenCalled();
  });

  it('creates one window only after the primary app is ready', async () => {
    const harness = createHarness();

    initializeAppLifecycle(harness.options);

    expect(harness.requestSingleInstanceLock).toHaveBeenCalledOnce();
    expect(harness.whenReady).toHaveBeenCalledOnce();
    expect(harness.createWindow).not.toHaveBeenCalled();

    await resolveReadyAndFlush(harness);

    expect(harness.createWindow).toHaveBeenCalledOnce();
    expect(harness.windows).toHaveLength(1);
  });

  it('restores a minimized window and focuses it for a second instance', async () => {
    const harness = createHarness();

    initializeAppLifecycle(harness.options);
    await resolveReadyAndFlush(harness);

    const window = harness.createdWindows[0];
    expect(window).toBeDefined();
    window!.isMinimized.mockReturnValue(true);

    harness.handlers.secondInstance?.();

    expect(window!.restore).toHaveBeenCalledOnce();
    expect(window!.focus).toHaveBeenCalledOnce();
    expect(harness.createWindow).toHaveBeenCalledOnce();
  });

  it('creates and focuses a window for a second instance when none exists', async () => {
    const harness = createHarness();

    initializeAppLifecycle(harness.options);
    await resolveReadyAndFlush(harness);
    harness.windows.splice(0);

    harness.handlers.secondInstance?.();

    expect(harness.createWindow).toHaveBeenCalledTimes(2);
    expect(harness.createdWindows[1]?.focus).toHaveBeenCalledOnce();
  });

  it('recreates a window on activate only when no window exists', async () => {
    const harness = createHarness();

    initializeAppLifecycle(harness.options);
    await resolveReadyAndFlush(harness);

    harness.handlers.activate?.();
    expect(harness.createWindow).toHaveBeenCalledOnce();

    harness.windows.splice(0);
    harness.handlers.activate?.();
    expect(harness.createWindow).toHaveBeenCalledTimes(2);
  });

  it('quits after all windows close on Windows', () => {
    const harness = createHarness({ platform: 'win32' });

    initializeAppLifecycle(harness.options);
    harness.handlers.windowAllClosed?.();

    expect(harness.quit).toHaveBeenCalledOnce();
  });

  it('keeps running after all windows close on macOS', () => {
    const harness = createHarness({ platform: 'darwin' });

    initializeAppLifecycle(harness.options);
    harness.handlers.windowAllClosed?.();

    expect(harness.quit).not.toHaveBeenCalled();
  });
});