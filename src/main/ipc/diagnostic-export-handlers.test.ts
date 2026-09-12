// @vitest-environment node
import type { IpcMain, IpcMainInvokeEvent, MessageBoxOptions, WebContents, WebFrameMain } from 'electron';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { DIAGNOSTIC_EXPORT_CHANNEL, type DiagnosticExportResult } from '../../shared/contracts/diagnostic-export.js';
import type { HardwareDiagnostics } from '../../shared/contracts/diagnostics.js';
import { createDiagnosticExporter } from '../logging/diagnostic-export.js';
import { registerDiagnosticExportHandler } from './diagnostics-handlers.js';

const url = 'file:///C:/Synthetic/app/index.html';
const failed = { status: 'failed', code: 'DIAGNOSTIC_EXPORT_FAILED' } as const;
const saved: DiagnosticExportResult = { status: 'saved', path: 'C:\\Synthetic\\logs\\diagnostics.txt', byteLength: 880, sha256: 'a'.repeat(64) };
function report(): HardwareDiagnostics {
  const unchecked = { status: 'not_checked', data: null, error: null } as const;
  return { schemaVersion: 1, command: 'probe-hardware', status: 'error',
    os: { status: 'error', data: null, error: { code: 'unsupported-os', causeType: null } },
    cpu: unchecked, memory: unchecked, disk: unchecked, gpu: unchecked, onnxRuntime: unchecked, cuda: unchecked,
    camera: { status: 'deferred', streamOpened: false, reasonCode: 'check-on-inference-start' } };
}
function harness() {
  const emitter = new EventEmitter(), frameState = { url }, frame = frameState as WebFrameMain;
  const contentsState = Object.assign(emitter, { mainFrame: frame, getURL: vi.fn(() => url), isDestroyed: vi.fn(() => false) });
  const contents = contentsState as unknown as WebContents;
  const eventState: { sender: WebContents; senderFrame: WebFrameMain | null } = { sender: contents, senderFrame: frame };
  const event = eventState as IpcMainInvokeEvent;
  const pending = Promise.withResolvers<HardwareDiagnostics>();
  const collect = vi.fn(() => pending.promise);
  const beganSave = Promise.withResolvers<void>();
  const save = vi.fn<(value: HardwareDiagnostics, signal: AbortSignal) => Promise<DiagnosticExportResult>>().mockImplementation(async () => { beganSave.resolve(); return saved; });
  const service = { collect }, exporter = { export: save };
  const handle = vi.fn<IpcMain['handle']>(), removeHandler = vi.fn<IpcMain['removeHandler']>();
  const binding = registerDiagnosticExportHandler({ handle, removeHandler }, contents, url, service, exporter);
  const listener = handle.mock.calls[0][1];
  const dispatch = (...args: unknown[]): Promise<unknown> => Promise.resolve(listener(event, ...args));
  return { emitter, frameState, frame, contentsState, contents, eventState, pending, collect, beganSave, save,
    service, exporter, handle, removeHandler, binding, dispatch };
}

describe('diagnostic export IPC boundary (SEC-07C2)', () => {
  it('registers one lazy channel and uses only detached Main observations and a Main signal', async () => {
    const h = harness(), value = report();
    expect(h.handle).toHaveBeenCalledExactlyOnceWith(DIAGNOSTIC_EXPORT_CHANNEL, expect.any(Function));
    expect(h.collect).not.toHaveBeenCalled(); expect(h.save).not.toHaveBeenCalled();
    const response = h.dispatch(); expect(h.collect.mock.calls).toEqual([[]]); expect(h.save).not.toHaveBeenCalled();
    h.pending.resolve(value); await expect(response).resolves.toEqual(saved);
    expect(h.save.mock.calls[0][0]).toEqual(value); expect(h.save.mock.calls[0][0]).not.toBe(value);
    expect(h.save.mock.calls[0][1]).toBeInstanceOf(AbortSignal); expect(h.save.mock.calls[0][1].aborted).toBe(false);
    expect(h.collect.mock.contexts).toEqual([h.service]); expect(h.save.mock.contexts).toEqual([h.exporter]);
    h.binding.dispose(); h.binding.dispose();
    expect(h.removeHandler).toHaveBeenCalledExactlyOnceWith(DIAGNOSTIC_EXPORT_CHANNEL);
    expect(h.emitter.eventNames()).toEqual([]); await expect(h.dispatch()).resolves.toEqual(failed);
  });

  it.each([[undefined], [null], [{}], [{ confirmed: true }], [{ path: 'PRIVATE', report: report() }], ['PRIVATE'], [1, 2]])(
    'rejects supplied argument %# before collection or dialog', async (...args) => {
      const h = harness(); await expect(h.dispatch(...args)).resolves.toEqual(failed);
      expect(h.collect).not.toHaveBeenCalled(); expect(h.save).not.toHaveBeenCalled();
    },
  );

  it.each(['foreign-window', 'foreign-frame', 'null-frame', 'destroyed', 'throwing-url'])('rejects %s before side effects', async (kind) => {
    const h = harness();
    if (kind === 'foreign-window') h.eventState.sender = { ...h.contentsState } as unknown as WebContents;
    if (kind === 'foreign-frame') h.eventState.senderFrame = { ...h.frameState } as WebFrameMain;
    if (kind === 'null-frame') h.eventState.senderFrame = null;
    if (kind === 'destroyed') h.contentsState.isDestroyed.mockReturnValue(true);
    if (kind === 'throwing-url') h.contentsState.getURL.mockImplementation(() => { throw new Error('PRIVATE'); });
    await expect(h.dispatch()).resolves.toEqual(failed); expect(h.collect).not.toHaveBeenCalled(); expect(h.save).not.toHaveBeenCalled();
  });

  it.each(['', 'PRIVATE', 'https://example.invalid', 'file://server/share/app.html', `${url}?q=1`, `${url}?`,
    'file:///C:/Synthetic/app/other.html', 'file:///C:/%00.html', 'file:///C:/%ZZ.html'])('rejects frame and contents URL %s', async (changed) => {
    for (const target of ['frame', 'contents']) {
      const h = harness(); if (target === 'frame') h.frameState.url = changed; else h.contentsState.getURL.mockReturnValue(changed);
      await expect(h.dispatch()).resolves.toEqual(failed); expect(h.collect).not.toHaveBeenCalled();
    }
  });

  it.each(['', 'https://example.invalid', 'file://server/share/app.html', `${url}?`, 'file:///C:/%ZZ.html'])('rejects invalid configured URL %s without registration', (expected) => {
    const h = harness(), handle = vi.fn<IpcMain['handle']>(); h.binding.dispose();
    expect(() => registerDiagnosticExportHandler({ handle, removeHandler: h.removeHandler }, h.contents, expected, h.service, h.exporter)).toThrow();
    expect(handle).not.toHaveBeenCalled(); expect(h.emitter.eventNames()).toEqual([]);
  });

  it.each(['navigation', 'render-gone', 'destroyed', 'disposed', 'frame-gone', 'frame-replaced'])('does not open a save prompt after %s while collecting', async (kind) => {
    const h = harness(), response = h.dispatch();
    if (kind === 'navigation') h.emitter.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
    if (kind === 'render-gone') h.emitter.emit('render-process-gone');
    if (kind === 'destroyed') h.emitter.emit('destroyed');
    if (kind === 'disposed') h.binding.dispose();
    if (kind === 'frame-gone') h.eventState.senderFrame = null;
    if (kind === 'frame-replaced') h.contentsState.mainFrame = { url } as WebFrameMain;
    h.pending.resolve(report()); await expect(response).resolves.toEqual(failed); expect(h.save).not.toHaveBeenCalled();
  });

  it.each(['navigation', 'render-gone', 'destroyed', 'disposed'])('aborts the save prompt after %s without treating a late save response as current', async (kind) => {
    const h = harness(), gate = Promise.withResolvers<DiagnosticExportResult>();
    h.save.mockImplementationOnce(() => { h.beganSave.resolve(); return gate.promise; });
    const response = h.dispatch(); h.pending.resolve(report()); await h.beganSave.promise;
    const signal = h.save.mock.calls[0][1];
    if (kind === 'navigation') h.emitter.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
    if (kind === 'render-gone') h.emitter.emit('render-process-gone');
    if (kind === 'destroyed') h.emitter.emit('destroyed');
    if (kind === 'disposed') h.binding.dispose();
    expect(signal.aborted).toBe(true); gate.resolve(saved); await expect(response).resolves.toEqual(failed);
    expect(h.save).toHaveBeenCalledTimes(1);
  });

  it('does not invalidate same-document navigation or a subframe, and does not cancel the shared collector', async () => {
    const h = harness(), response = h.dispatch();
    h.emitter.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true, url: `${url}#main` });
    h.emitter.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false });
    h.frameState.url = `${url}#main`; h.contentsState.getURL.mockReturnValue(`${url}#main`);
    h.pending.resolve(report()); await expect(response).resolves.toEqual(saved);
    expect(h.collect).toHaveBeenCalledTimes(1); expect(h.save.mock.calls[0][1].aborted).toBe(false);
  });

  it.each([false, true])('prevents a real write after same-document query change, including return to the original URL (%s)', async (restoreUrl) => {
    const directory = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'autovision-export-query-')));
    const answer = Promise.withResolvers<{ response: number; checkboxChecked: boolean }>();
    const prompted = Promise.withResolvers<AbortSignal>();
    const actualExporter = createDiagnosticExporter(directory, {
      showMessageBox(options: MessageBoxOptions) { prompted.resolve(options.signal!); return answer.promise; },
    });
    const h = harness(); h.save.mockImplementation((value, signal) => actualExporter.export(value, signal));
    const response = h.dispatch(); h.pending.resolve(report());
    try {
      const signal = await prompted.promise;
      h.frameState.url = `${url}?changed=1`; h.contentsState.getURL.mockReturnValue(h.frameState.url);
      h.emitter.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true, url: h.frameState.url });
      if (restoreUrl) {
        h.frameState.url = url; h.contentsState.getURL.mockReturnValue(url);
        h.emitter.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true, url });
      }
      answer.resolve({ response: 1, checkboxChecked: false });
      await expect(response).resolves.toEqual(failed);
      expect(signal.aborted).toBe(true); expect(fs.readdirSync(directory)).toEqual([]);
    } finally {
      h.binding.dispose(); actualExporter.dispose(); answer.resolve({ response: 0, checkboxChecked: false });
      await Promise.allSettled([response]); fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('does not bypass invalid-argument checks when busy and admits only one request until settlement', async () => {
    const h = harness(), first = h.dispatch();
    await expect(h.dispatch(undefined)).resolves.toEqual(failed);
    await expect(h.dispatch()).resolves.toEqual({ status: 'failed', code: 'DIAGNOSTIC_EXPORT_BUSY' });
    h.emitter.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
    await expect(h.dispatch()).resolves.toEqual({ status: 'failed', code: 'DIAGNOSTIC_EXPORT_BUSY' });
    expect(h.collect).toHaveBeenCalledTimes(1); h.pending.resolve(report()); await expect(first).resolves.toEqual(failed);
    await expect(h.dispatch()).resolves.toEqual(saved); expect(h.collect).toHaveBeenCalledTimes(2);
  });

  it.each(['collect-throw', 'collect-reject', 'collect-invalid', 'save-throw', 'save-reject', 'save-invalid'])('sanitizes %s without retry or success substitution', async (kind) => {
    const h = harness();
    if (kind === 'collect-throw') h.collect.mockImplementationOnce(() => { throw new Error('PRIVATE'); });
    if (kind === 'collect-reject') h.collect.mockRejectedValueOnce(new Error('PRIVATE'));
    if (kind === 'collect-invalid') h.collect.mockResolvedValueOnce({} as HardwareDiagnostics);
    if (kind === 'save-throw') h.save.mockImplementationOnce(() => { throw new Error('PRIVATE'); });
    if (kind === 'save-reject') h.save.mockRejectedValueOnce(new Error('PRIVATE'));
    if (kind === 'save-invalid') h.save.mockResolvedValueOnce({ ...saved, message: 'PRIVATE' } as DiagnosticExportResult);
    h.pending.resolve(report()); await expect(h.dispatch()).resolves.toEqual(failed);
    expect(h.collect).toHaveBeenCalledTimes(1); expect(h.save).toHaveBeenCalledTimes(kind.startsWith('collect') ? 0 : 1);
  });

  it.each([{ status: 'cancelled' }, { status: 'failed', code: 'DIAGNOSTIC_EXPORT_BUSY' }, failed] as const)('preserves the exact exporter result %#', async (result) => {
    const h = harness(); h.save.mockResolvedValueOnce(result); h.pending.resolve(report());
    const response = await h.dispatch(); expect(response).toEqual(result); expect(Object.isFrozen(response)).toBe(true);
  });

  it('cleans listeners without unregistering a conflicting foreign channel', () => {
    const h = harness(); h.binding.dispose(); const removeHandler = vi.fn();
    const handle = vi.fn<IpcMain['handle']>(() => { throw new Error('conflict'); });
    expect(() => registerDiagnosticExportHandler({ handle, removeHandler }, h.contents, url, h.service, h.exporter)).toThrow('conflict');
    expect(removeHandler).not.toHaveBeenCalled(); expect(h.emitter.eventNames()).toEqual([]);
  });
});