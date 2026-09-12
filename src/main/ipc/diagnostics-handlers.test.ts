// @vitest-environment node
import type { IpcMain, IpcMainInvokeEvent, WebContents, WebFrameMain } from 'electron';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import { createDiagnosticsApi } from '../../preload/diagnostics-api.js';
import type { HardwareDiagnostics } from '../../shared/contracts/diagnostics.js';
import { registerDiagnosticsHandlers } from './diagnostics-handlers.js';

const rendererUrl = 'file:///C:/Synthetic/app/index.html';
function report(): HardwareDiagnostics {
  const unchecked = { status: 'not_checked', data: null, error: null } as const;
  return {
    schemaVersion: 1, command: 'probe-hardware', status: 'error',
    os: { status: 'error', data: null, error: { code: 'unsupported-os', causeType: null } },
    cpu: unchecked, memory: unchecked, disk: unchecked, gpu: unchecked, onnxRuntime: unchecked, cuda: unchecked,
    camera: { status: 'deferred', streamOpened: false, reasonCode: 'check-on-inference-start' },
  };
}
function harness(expectedUrl = rendererUrl) {
  // Assertions are confined to native Electron object boundaries; production
  // uses the real objects and compares their identity, not these structural picks.
  const frameState: { url: string } = { url: rendererUrl };
  const frame = frameState as WebFrameMain;
  const isDestroyed = vi.fn(() => false); const getURL = vi.fn(() => rendererUrl);
  const contentsState: Pick<WebContents, 'mainFrame' | 'isDestroyed' | 'getURL'> = { mainFrame: frame, isDestroyed, getURL };
  const contents = contentsState as WebContents;
  const eventState: { sender: WebContents; senderFrame: WebFrameMain | null } = { sender: contents, senderFrame: frame };
  const event = eventState as IpcMainInvokeEvent;
  const pending = Promise.withResolvers<HardwareDiagnostics>();
  const collect = vi.fn(() => pending.promise);
  const handle = vi.fn<IpcMain['handle']>(); const removeHandler = vi.fn<IpcMain['removeHandler']>();
  const binding = registerDiagnosticsHandlers({ handle, removeHandler }, contents, expectedUrl, { collect });
  const listener = handle.mock.calls[0]?.[1];
  if (!listener) throw new Error('Expected explicit handler registration');
  const dispatch = (...args: unknown[]): Promise<unknown> => Promise.resolve(listener(event, ...args));
  return { frame, frameState, contents, contentsState, eventState, pending, collect, handle, removeHandler,
    binding, dispatch, isDestroyed, getURL };
}
const safeError = { message: 'Hardware diagnostics unavailable.', code: 'DIAGNOSTICS_UNAVAILABLE' };

describe('diagnostics IPC boundary', () => {
  it('registers only the fixed channel, invokes after validation, and removes it once', async () => {
    const h = harness(); expect(h.handle).toHaveBeenCalledExactlyOnceWith('diagnostics:collect', expect.any(Function));
    expect(h.collect).not.toHaveBeenCalled(); const response = h.dispatch(); expect(h.collect).toHaveBeenCalledOnce();
    h.pending.resolve(report()); await expect(response).resolves.toEqual(report());
    h.binding.dispose(); h.binding.dispose(); expect(h.removeHandler).toHaveBeenCalledExactlyOnceWith('diagnostics:collect');
    await expect(h.dispatch()).rejects.toMatchObject(safeError); expect(h.collect).toHaveBeenCalledOnce();
  });
  it.each([[undefined], [null], ['PRIVATE'], [{}], [{ __proto__: { diskPath: 'PRIVATE' } }], ['constructor'], [1, 2]])(
    'rejects every supplied argument including undefined/prototypes %#', async (...args) => {
      const h = harness(); await expect(h.dispatch(...args)).rejects.toMatchObject(safeError); expect(h.collect).not.toHaveBeenCalled();
    },
  );
  it.each(['foreign-window', 'foreign-frame', 'null-frame', 'destroyed', 'throwing-url'])(
    'rejects %s before calling service', async (scenario) => {
      const h = harness();
      if (scenario === 'foreign-window') h.eventState.sender = { ...h.contentsState } as WebContents;
      if (scenario === 'foreign-frame') h.eventState.senderFrame = { ...h.frameState } as WebFrameMain;
      if (scenario === 'null-frame') h.eventState.senderFrame = null;
      if (scenario === 'destroyed') h.isDestroyed.mockReturnValue(true);
      if (scenario === 'throwing-url') h.getURL.mockImplementation(() => { throw new Error('PRIVATE'); });
      await expect(h.dispatch()).rejects.toMatchObject(safeError); expect(h.collect).not.toHaveBeenCalled();
    },
  );
  it.each(['not a url', '', 'https://example.invalid/app', 'file://server/share/app/index.html',
    'file:///C:/Synthetic/app/other.html', `${rendererUrl}?query=1`, `${rendererUrl}?`,
    'file:///C:/Synthetic/app/%ZZ.html', 'file:///C:/Synthetic/app/%00.html'])(
    'rejects nonmatching frame and contents URL %s', async (url) => {
      for (const target of ['frame', 'contents']) {
        const h = harness(); if (target === 'frame') h.frameState.url = url; else h.getURL.mockReturnValue(url);
        await expect(h.dispatch()).rejects.toMatchObject(safeError); expect(h.collect).not.toHaveBeenCalled();
      }
    },
  );
  it.each(['not a url', 'https://example.invalid', 'file://server/share/app.html', `${rendererUrl}?`, 'file:///C:/%ZZ.html'])(
    'fails closed on invalid expected URL %s', (url) => {
      const h = harness(); const handle = vi.fn<IpcMain['handle']>();
      expect(() => registerDiagnosticsHandlers({ handle, removeHandler: h.removeHandler }, h.contents, url, { collect: h.collect })).toThrow(safeError.message);
      expect(handle).not.toHaveBeenCalled();
    },
  );
  it('allows only fragment changes, including a skip link during collection', async () => {
    const h = harness(`${rendererUrl}#start`); const response = h.dispatch();
    h.frameState.url = `${rendererUrl}#main?inside-fragment`; h.getURL.mockReturnValue(`${rendererUrl}#main`);
    h.pending.resolve(report()); await expect(response).resolves.toEqual(report());
  });
  it.each(['destroyed', 'navigation', 'main-frame-replaced', 'event-frame-gone', 'disposed'])(
    'withholds a pending result after %s', async (scenario) => {
      const h = harness(); const response = h.dispatch();
      if (scenario === 'destroyed') h.isDestroyed.mockReturnValue(true);
      if (scenario === 'navigation') h.getURL.mockReturnValue('file:///C:/other.html');
      if (scenario === 'main-frame-replaced') Object.defineProperty(h.contentsState, 'mainFrame', { value: { ...h.frameState } });
      if (scenario === 'event-frame-gone') h.eventState.senderFrame = null;
      if (scenario === 'disposed') h.binding.dispose();
      h.pending.resolve(report()); await expect(response).rejects.toMatchObject(safeError);
    },
  );
  it('validates every event even when another request is already pending', async () => {
    const h = harness(); const first = h.dispatch(); await expect(h.dispatch(undefined)).rejects.toMatchObject(safeError);
    expect(h.collect).toHaveBeenCalledOnce(); h.pending.resolve(report()); await first;
  });
  it.each([false, true])('sanitizes synchronous/asynchronous service failure (%s)', async (sync) => {
    const h = harness();
    if (sync) h.collect.mockImplementation(() => { throw new Error('PRIVATE path'); });
    const response = h.dispatch(); if (!sync) h.pending.reject(new Error('PRIVATE command stderr'));
    await expect(response).rejects.toMatchObject(safeError);
  });
  it('does not unregister an existing handler when registration fails', () => {
    const h = harness(); const handle = vi.fn<IpcMain['handle']>(() => { throw new Error('already registered'); });
    expect(() => registerDiagnosticsHandlers({ handle, removeHandler: h.removeHandler }, h.contents, rendererUrl, { collect: h.collect })).toThrow('already registered');
    expect(h.removeHandler).not.toHaveBeenCalled();
  });
});

describe('diagnostics preload factory (no sixth test file)', () => {
  it('is lazy, frozen, has no inherited API, and invokes the fixed channel with zero args', async () => {
    const h = harness(); const invoke = vi.fn<(channel: string) => Promise<unknown>>(() => h.dispatch());
    const api = createDiagnosticsApi({ invoke });
    expectTypeOf(api.collect).toEqualTypeOf<() => Promise<HardwareDiagnostics>>();
    expect(Reflect.ownKeys(api)).toEqual(['collect', 'exportSummary']); expect(Object.getPrototypeOf(api)).toBeNull(); expect(Object.isFrozen(api)).toBe(true);
    expect('constructor' in api).toBe(false); expect('__proto__' in api).toBe(false); expect(invoke).not.toHaveBeenCalled();
    const response = Reflect.apply(api.collect, { diskPath: 'PRIVATE' }, ['PRIVATE', undefined]);
    expect(invoke.mock.calls).toEqual([['diagnostics:collect']]); h.pending.resolve(report());
    await expect(response).resolves.toEqual(report());
  });
  it.each([null, [], {}, 'PRIVATE', { ...report(), supportLevel: 'invented' },
    JSON.parse('{"__proto__":{"collect":"PRIVATE"}}') as unknown])('rejects invalid responses %# without exposing schema input', async (value) => {
    const api = createDiagnosticsApi({ invoke: async () => value }); await expect(api.collect()).rejects.toMatchObject(safeError);
  });
  it.each([false, true])('sanitizes invoke rejection/throw (%s)', async (sync) => {
    const invoke = (): Promise<unknown> => {
      if (sync) throw new Error('PRIVATE');
      return Promise.reject(new Error('PRIVATE'));
    };
    await expect(createDiagnosticsApi({ invoke }).collect()).rejects.toMatchObject(safeError);
  });
});