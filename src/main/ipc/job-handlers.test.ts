// @vitest-environment node
import type { IpcMain, IpcMainInvokeEvent, WebContents, WebFrameMain } from 'electron';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  JOB_LIST_CHANNEL, JOB_GET_CHANNEL, JOB_CANCEL_CHANNEL, JOB_SUBSCRIBE_CHANNEL,
  JOB_UNSUBSCRIBE_CHANNEL, JOB_CHANGED_CHANNEL, jobSubscribeResponseSchema,
  type JobSnapshot,
} from '../../shared/contracts/job-ipc.js';
import type { JobService } from '../jobs/job-service.js';
import { registerJobHandlers } from './job-handlers.js';

const projectId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const jobId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const otherId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const rendererURL = 'file:///C:/Synthetic/app/index.html';
const job = { id: jobId, projectId, kind: 'scan-dataset', status: 'Running',
  createdAt: '2026-09-12T00:00:00.000Z', updatedAt: '2026-09-12T00:00:00.000Z' } as const;
const snapshot: JobSnapshot = { job, progress: null, workerCompleted: false };
const progress = (processed: number): JobSnapshot => ({ ...snapshot, progress: {
  schemaVersion: 1, type: 'progress', source: 'actual', projectId, jobId, processed, total: 10,
} });
const failure = (code: string) => ({ ok: false, error: { code } });
const requests = [
  [JOB_LIST_CHANNEL, { projectId }], [JOB_GET_CHANNEL, { projectId, jobId }],
  [JOB_CANCEL_CHANNEL, { projectId, jobId }], [JOB_SUBSCRIBE_CHANNEL, { projectId }],
  [JOB_UNSUBSCRIBE_CHANNEL, { projectId, subscriptionId: otherId }],
] as const;
const bindings: { dispose(): void }[] = [];

function harness() {
  // Only Electron boundaries and the narrow service port are fake. No worker,
  // database, Electron runtime, startup, terminal, or generic renderer bridge.
  const frameState = { url: rendererURL };
  const frame = frameState as WebFrameMain;
  const getURL = vi.fn(() => rendererURL); const isDestroyed = vi.fn(() => false);
  const send = vi.fn<WebContents['send']>();
  const state = Object.assign(new EventEmitter(), { mainFrame: frame, getURL, isDestroyed, send });
  const contents = state as unknown as WebContents;
  const eventState: { sender: WebContents; senderFrame: WebFrameMain | null } = { sender: contents, senderFrame: frame };
  const event = eventState as IpcMainInvokeEvent;
  const handlers = new Map<string, Parameters<IpcMain['handle']>[1]>();
  const handle = vi.fn<IpcMain['handle']>((channel, listener) => {
    if (handlers.has(channel)) throw new Error('Already registered');
    handlers.set(channel, listener);
  });
  const removeHandler = vi.fn<IpcMain['removeHandler']>((channel) => { handlers.delete(channel); });
  const registrations: { listener: Parameters<JobService['subscribe']>[1]; off: ReturnType<typeof vi.fn> }[] = [];
  const service = {
    list: vi.fn<JobService['list']>(() => [job]),
    get: vi.fn<JobService['get']>(() => job),
    getSnapshot: vi.fn<JobService['getSnapshot']>(() => snapshot),
    cancel: vi.fn<JobService['cancel']>(() => job),
    subscribe: vi.fn<JobService['subscribe']>((_id, listener) => {
      const off = vi.fn(); registrations.push({ listener, off }); return off;
    }),
  };
  const ipc = { handle, removeHandler };
  const binding = registerJobHandlers(ipc, contents, rendererURL, service); bindings.push(binding);
  const captured = new Map(handlers);
  const dispatch = (channel: string, ...args: unknown[]): unknown => {
    const listener = captured.get(channel);
    if (!listener) throw new Error('Unknown test channel');
    return listener(event, ...args);
  };
  const watch = () => {
    const reply = jobSubscribeResponseSchema.parse(dispatch(JOB_SUBSCRIBE_CHANNEL, { projectId }));
    if (!reply.ok) throw new Error('Expected subscription');
    return reply.value;
  };
  const navigate = () => state.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
  return { state, contents, frameState, frame, eventState, isDestroyed, getURL, send, handlers, captured,
    handle, removeHandler, ipc, service, registrations, binding, dispatch, watch, navigate };
}
afterEach(() => { for (const binding of bindings.splice(0)) binding.dispose(); vi.restoreAllMocks(); });

describe('JOB-05B IPC boundary', () => {
  it('registers only fixed invokes, has no initial service calls, and disposes captured handlers', () => {
    const h = harness();
    expect([...h.handlers.keys()]).toEqual(requests.map(([channel]) => channel));
    for (const operation of Object.values(h.service)) expect(operation).not.toHaveBeenCalled();
    const observer = vi.fn(); h.state.on('did-start-navigation', observer);
    h.binding.dispose(); h.binding.dispose();
    expect(h.removeHandler.mock.calls).toEqual(requests.map(([channel]) => [channel]));
    expect(h.state.listeners('did-start-navigation')).toEqual([observer]);
    for (const [channel, input] of requests) expect(h.dispatch(channel, input)).toEqual(failure('INVALID_REQUEST'));
  });

  it.each(requests)('%s rejects invalid direct inputs and extra arguments before any service call', (channel, input) => {
    const h = harness(); const getter = vi.fn(() => projectId);
    const accessor = Object.defineProperty({}, 'projectId', { enumerable: true, get: getter });
    const hidden = Object.defineProperty({ ...input }, 'hidden', { value: true });
    for (const value of [null, [], new Array(1), [input], undefined, Object.create(input), accessor, hidden,
      { ...input, projectId: 'bad' }, { ...input, jobId: 'bad' }, { ...input, [Symbol('hidden')]: true },
      ...['kind', 'exe', 'executablePath', 'env', 'path', 'channel', 'payload'].map((key) => ({ ...input, [key]: 'PRIVATE' }))]) {
      expect(h.dispatch(channel, value)).toEqual(failure('INVALID_REQUEST'));
    }
    expect(h.dispatch(channel)).toEqual(failure('INVALID_REQUEST'));
    expect(h.dispatch(channel, input, undefined)).toEqual(failure('INVALID_REQUEST'));
    expect(getter).not.toHaveBeenCalled();
    for (const operation of Object.values(h.service)) expect(operation).not.toHaveBeenCalled();
  });

  it.each(['foreign-window', 'subframe', 'null-frame', 'destroyed', 'url-throws'])(
    'denies %s across all operations without touching the service', (scenario) => {
      const h = harness();
      if (scenario === 'foreign-window') h.eventState.sender = {} as WebContents;
      if (scenario === 'subframe') h.eventState.senderFrame = { url: rendererURL } as WebFrameMain;
      if (scenario === 'null-frame') h.eventState.senderFrame = null;
      if (scenario === 'destroyed') h.isDestroyed.mockReturnValue(true);
      if (scenario === 'url-throws') h.getURL.mockImplementation(() => { throw new Error('PRIVATE'); });
      for (const [channel, input] of requests) expect(h.dispatch(channel, input)).toEqual(failure('INVALID_REQUEST'));
      for (const operation of Object.values(h.service)) expect(operation).not.toHaveBeenCalled();
    },
  );

  it('checks both canonical URLs and never grants universal file: or origin access', () => {
    const h = harness();
    for (const url of ['https://example.invalid', 'file://server/app.html', 'file:///C:/Other/index.html',
      `${rendererURL}?`, `${rendererURL}?x=1`, 'file:///C:/%ZZ.html', 'file:///C:/%00.html', 'file:///C:/Synthetic/app/../app/index.html']) {
      for (const target of ['frame', 'contents']) {
        h.frameState.url = target === 'frame' ? url : rendererURL;
        h.getURL.mockReturnValue(target === 'contents' ? url : rendererURL);
        for (const [channel, input] of requests) expect(h.dispatch(channel, input)).toEqual(failure('INVALID_REQUEST'));
      }
    }
    for (const operation of Object.values(h.service)) expect(operation).not.toHaveBeenCalled();
  });

  it('returns scoped headers/snapshots/cancellation and normalizes UUID input', () => {
    const h = harness();
    expect(h.dispatch(JOB_LIST_CHANNEL, { projectId: projectId.toUpperCase() })).toEqual({ ok: true, value: [job] });
    expect(h.dispatch(JOB_GET_CHANNEL, { projectId, jobId: jobId.toUpperCase() })).toEqual({ ok: true, value: snapshot });
    expect(h.dispatch(JOB_CANCEL_CHANNEL, { projectId, jobId })).toEqual({ ok: true, value: job });
    expect(h.service.list).toHaveBeenCalledWith(projectId);
    expect(h.service.getSnapshot).toHaveBeenCalledWith(projectId, jobId);
    expect(h.service.cancel).toHaveBeenCalledWith(projectId, jobId);
    expect(h.service.get).not.toHaveBeenCalled(); expect(h.send).not.toHaveBeenCalled();
  });

  it('never crosses request project/job boundaries in any outbound DTO', () => {
    const h = harness();
    h.service.list.mockReturnValue([{ ...job, projectId: otherId }]);
    h.service.cancel.mockReturnValue({ ...job, id: otherId });
    h.service.getSnapshot.mockReturnValue({ ...snapshot, job: { ...job, projectId: otherId } });
    for (const [channel, input] of requests.slice(0, 4)) expect(h.dispatch(channel, input)).toEqual(failure('OPERATION_FAILED'));
    expect(h.send).not.toHaveBeenCalled(); expect(h.registrations[0]!.off).toHaveBeenCalledOnce();
  });

  it('maps only fixed not-found/state/busy codes and hides even hostile exceptions', () => {
    const h = harness(); h.service.getSnapshot.mockReturnValue(undefined);
    expect(h.dispatch(JOB_GET_CHANNEL, { projectId, jobId })).toEqual(failure('NOT_FOUND'));
    for (const [code, expected] of [['JOB_NOT_FOUND', 'NOT_FOUND'], ['JOB_STATE', 'INVALID_STATE'],
      ['JOB_NOT_OWNED', 'INVALID_STATE'], ['JOB_TRANSACTION', 'BUSY'], ['JOB_DATABASE', 'OPERATION_FAILED'],
      ['JOB_TERMINATION_UNCONFIRMED', 'OPERATION_FAILED']]) {
      h.service.cancel.mockImplementationOnce(() => { throw Object.assign(new Error('PRIVATE manifest/path'), { code }); });
      expect(h.dispatch(JOB_CANCEL_CHANNEL, { projectId, jobId })).toEqual(failure(expected!));
    }
    const getter = vi.fn(() => { throw new Error('PRIVATE'); });
    h.service.cancel.mockImplementationOnce(() => { throw Object.defineProperty({}, 'code', { get: getter }); });
    expect(h.dispatch(JOB_CANCEL_CHANNEL, { projectId, jobId })).toEqual(failure('OPERATION_FAILED'));
    expect(getter).not.toHaveBeenCalled();
  });

  it('subscribes before initial reads and coalesces synchronous progress without sending before ack', () => {
    const h = harness();
    h.service.getSnapshot.mockImplementationOnce(() => {
      h.registrations[0]!.listener(progress(1)); h.registrations[0]!.listener(progress(2)); return snapshot;
    });
    const watch = h.watch();
    expect(watch.snapshots).toEqual([progress(2)]); expect(h.send).not.toHaveBeenCalled();
    expect(h.service.subscribe.mock.invocationCallOrder[0]!).toBeLessThan(h.service.list.mock.invocationCallOrder[0]!);
    h.registrations[0]!.listener(progress(3));
    expect(h.send.mock.calls).toEqual([[JOB_CHANGED_CHANNEL, { subscriptionId: watch.subscriptionId, snapshot: progress(3) }]]);
    expect(h.dispatch(JOB_UNSUBSCRIBE_CHANNEL, { projectId, subscriptionId: watch.subscriptionId })).toEqual({ ok: true, value: null });
    h.registrations[0]!.listener(progress(4)); expect(h.send).toHaveBeenCalledOnce();
  });

  it('replaces one window subscription and old/wrong-project/foreign-window tokens cannot cancel the new one', () => {
    const h = harness(); const first = h.watch(); const second = h.watch(); const other = harness();
    expect(second.subscriptionId).not.toBe(first.subscriptionId); expect(h.registrations[0]!.off).toHaveBeenCalledOnce();
    for (const input of [{ projectId, subscriptionId: first.subscriptionId },
      { projectId: otherId, subscriptionId: second.subscriptionId }]) {
      expect(h.dispatch(JOB_UNSUBSCRIBE_CHANNEL, input)).toEqual(failure('STALE_SUBSCRIPTION'));
    }
    expect(other.dispatch(JOB_UNSUBSCRIBE_CHANNEL, { projectId, subscriptionId: second.subscriptionId })).toEqual(failure('STALE_SUBSCRIPTION'));
    h.registrations[0]!.listener(progress(1)); expect(h.send).not.toHaveBeenCalled();
    h.registrations[1]!.listener(progress(2)); expect(h.send).toHaveBeenCalledOnce();
    expect(h.registrations[1]!.off).not.toHaveBeenCalled();
  });

  it.each(['navigate', 'destroy', 'process-gone', 'dispose', 'silent-destroy', 'frame-replaced'])(
    'invalidates and releases on %s and suppresses late progress', (scenario) => {
      const h = harness(); h.watch();
      if (scenario === 'navigate') h.navigate();
      if (scenario === 'destroy') { h.isDestroyed.mockReturnValue(true); h.state.emit('destroyed'); }
      if (scenario === 'process-gone') h.state.emit('render-process-gone');
      if (scenario === 'dispose') h.binding.dispose();
      if (scenario === 'silent-destroy') h.isDestroyed.mockReturnValue(true);
      if (scenario === 'frame-replaced') h.state.mainFrame = { url: rendererURL } as WebFrameMain;
      h.registrations[0]!.listener(progress(1)); h.registrations[0]!.listener(progress(2));
      expect(h.send).not.toHaveBeenCalled(); expect(h.registrations[0]!.off).toHaveBeenCalledOnce();
    },
  );

  it('allows hash routes/subframe navigation but expires a same-URL reload token', () => {
    const h = harness(); const first = h.watch();
    h.frameState.url = `${rendererURL}#jobs`; h.getURL.mockReturnValue(`${rendererURL}#jobs`);
    h.state.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true });
    h.state.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false });
    h.registrations[0]!.listener(progress(1)); expect(h.send).toHaveBeenCalledOnce();
    h.navigate(); const second = h.watch();
    expect(h.dispatch(JOB_UNSUBSCRIBE_CHANNEL, { projectId, subscriptionId: first.subscriptionId })).toEqual(failure('STALE_SUBSCRIPTION'));
    expect(second.subscriptionId).not.toBe(first.subscriptionId);
  });

  it('handles initial-list navigation before any following snapshot reads', () => {
    const h = harness(); h.service.list.mockImplementationOnce(() => { h.navigate(); return [job]; });
    expect(h.dispatch(JOB_SUBSCRIBE_CHANNEL, { projectId })).toEqual(failure('STALE_SUBSCRIPTION'));
    expect(h.service.getSnapshot).not.toHaveBeenCalled(); expect(h.registrations[0]!.off).toHaveBeenCalledOnce();
  });

  it('cleans a late service unsubscribe when subscribe itself reenters navigation', () => {
    const h = harness(); const off = vi.fn();
    h.service.subscribe.mockImplementationOnce((_id, listener) => { h.navigate(); listener(snapshot); return off; });
    expect(h.dispatch(JOB_SUBSCRIBE_CHANNEL, { projectId })).toEqual(failure('STALE_SUBSCRIPTION'));
    expect(off).toHaveBeenCalledOnce(); expect(h.service.list).not.toHaveBeenCalled(); expect(h.send).not.toHaveBeenCalled();
  });

  it('does not let reentrant replacement cleanup clobber a newer watch', () => {
    const h = harness(); h.watch(); let newest: ReturnType<typeof h.watch> | undefined;
    h.registrations[0]!.off.mockImplementationOnce(() => { newest = h.watch(); });
    expect(h.dispatch(JOB_SUBSCRIBE_CHANNEL, { projectId })).toEqual(failure('STALE_SUBSCRIPTION'));
    expect(newest).toBeDefined(); expect(h.registrations).toHaveLength(2);
    h.registrations[1]!.listener(progress(1));
    expect(h.send).toHaveBeenCalledWith(JOB_CHANGED_CHANNEL, { subscriptionId: newest!.subscriptionId, snapshot: progress(1) });
  });

  it('revokes only the failing old subscription if send reenters a new subscribe and then throws', () => {
    const h = harness(); h.watch(); let newest: ReturnType<typeof h.watch> | undefined;
    h.send.mockImplementationOnce(() => { newest = h.watch(); throw new Error('PRIVATE send'); });
    expect(() => h.registrations[0]!.listener(progress(1))).not.toThrow();
    h.registrations[1]!.listener(progress(2));
    expect(h.send).toHaveBeenLastCalledWith(JOB_CHANGED_CHANNEL, { subscriptionId: newest!.subscriptionId, snapshot: progress(2) });
    expect(h.registrations[1]!.off).not.toHaveBeenCalled();
  });

  it('fails closed for corrupt initial/progress DTOs without leaking exception or manifest details', () => {
    const h = harness(); const invalid = { ...progress(1), progress: { ...progress(1).progress, projectId: otherId, resultManifest: 'PRIVATE' } };
    h.service.getSnapshot.mockReturnValueOnce(invalid as never);
    expect(h.dispatch(JOB_SUBSCRIBE_CHANNEL, { projectId })).toEqual(failure('OPERATION_FAILED'));
    expect(h.registrations[0]!.off).toHaveBeenCalledOnce(); h.watch();
    h.registrations[1]!.listener(invalid as never); h.registrations[1]!.listener(progress(2));
    expect(h.send).not.toHaveBeenCalled(); expect(h.registrations[1]!.off).toHaveBeenCalledOnce();
  });

  it('unwinds partial registration while preserving conflicting handler identity and foreign observers', () => {
    const h = harness(); h.binding.dispose();
    const foreign = vi.fn<Parameters<IpcMain['handle']>[1]>(); const observer = vi.fn();
    h.state.on('did-start-navigation', observer);
    for (const index of [0, 2, 4]) {
      h.handlers.clear(); h.removeHandler.mockClear();
      const channel = requests[index]![0]; h.handlers.set(channel, foreign); h.handlers.set('foreign:channel', foreign);
      expect(() => registerJobHandlers(h.ipc, h.contents, rendererURL, h.service)).toThrow('Already registered');
      expect(h.removeHandler.mock.calls).toEqual(requests.slice(0, index).map(([name]) => [name]));
      expect([...h.handlers.keys()]).toEqual([channel, 'foreign:channel']);
      expect(h.handlers.get(channel)).toBe(foreign); expect(h.handlers.get('foreign:channel')).toBe(foreign);
      expect(h.state.listeners('did-start-navigation')).toEqual([observer]);
      expect(h.state.listenerCount('destroyed')).toBe(0);
    }
  });

  it('rejects malformed expected URLs before registration', () => {
    const h = harness(); h.binding.dispose(); h.handle.mockClear();
    for (const url of ['', 'https://example.invalid', 'file://server/share/app.html', `${rendererURL}?`, 'file:///C:/%00.html']) {
      expect(() => registerJobHandlers(h.ipc, h.contents, url, h.service)).toThrow('INVALID_REQUEST');
    }
    expect(h.handle).not.toHaveBeenCalled();
  });
});