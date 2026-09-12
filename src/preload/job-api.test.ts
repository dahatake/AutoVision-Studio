// @vitest-environment node
import type { IpcRenderer } from 'electron';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';

vi.mock('electron', () => { throw new Error('No Electron runtime in the Job API factory.'); });

import * as ipc from '../shared/contracts/job-ipc.js';
import { createJobApi } from './job-api.js';

const projectId = 'ae45cf74-c9f9-4c49-88b9-0523b1ac7383';
const jobId = 'd0b79d8d-61bc-47f0-a6bf-b2e65a48be91';
const other = 'aa45cf74-c9f9-4c49-88b9-0523b1ac7383';
const token = 'bb45cf74-c9f9-4c49-88b9-0523b1ac7383';
const token2 = 'cc45cf74-c9f9-4c49-88b9-0523b1ac7383';
const token3 = 'dd45cf74-c9f9-4c49-88b9-0523b1ac7383';
const privateError = () => Object.assign(new Error('C:\\PRIVATE\\worker'), { path: 'PRIVATE', supervisor: {} });
function snapshot(processed = 0, project = projectId, id = jobId): ipc.JobSnapshot {
  return {
    job: { id, projectId: project, kind: 'train', status: 'Running', createdAt: '2026-09-12T00:00:00Z', updatedAt: '2026-09-12T00:00:00Z' },
    progress: { schemaVersion: 1, type: 'progress', source: 'actual', projectId: project, jobId: id, processed, total: null },
    workerCompleted: false,
  };
}
function ack(subscriptionId = token, snapshots: readonly ipc.JobSnapshot[] = []) { return { ok: true, value: { subscriptionId, snapshots } }; }
const failure = (code = 'OPERATION_FAILED') => ({ ok: false, error: { code } });
type NativeListener = (event: unknown, raw: unknown) => void;
function harness(response: unknown = ack()) {
  const handlers = new Set<NativeListener>();
  const invoke = vi.fn<(channel: string, ...args: unknown[]) => Promise<unknown>>(async (channel) =>
    channel === ipc.JOB_UNSUBSCRIBE_CHANNEL ? { ok: true, value: null } : response);
  const on = vi.fn((_channel: string, handler: NativeListener) => { handlers.add(handler); });
  const removeListener = vi.fn((_channel: string, handler: NativeListener) => { handlers.delete(handler); });
  const transport = { invoke, on, removeListener };
  const api = createJobApi(transport as unknown as Pick<IpcRenderer, 'invoke' | 'on' | 'removeListener'>);
  function emit(raw: unknown) { for (const handler of [...handlers]) handler({ sender: 'PRIVATE', supervisor: {} }, raw); }
  return { api, transport, invoke, on, removeListener, handlers, emit,
    change: (subscriptionId: string, value: ipc.JobSnapshot) => emit({ subscriptionId, snapshot: value }) };
}
function call(api: Readonly<ipc.JobApi>, name: keyof ipc.JobApi, args: unknown[]): Promise<unknown> {
  return Reflect.apply(api[name], { channel: 'unsafe', supervisor: {} }, args) as Promise<unknown>;
}
const operations = [
  { name: 'list', channel: ipc.JOB_LIST_CHANNEL, args: [projectId], value: [snapshot().job] },
  { name: 'get', channel: ipc.JOB_GET_CHANNEL, args: [projectId, jobId], value: snapshot() },
  { name: 'cancel', channel: ipc.JOB_CANCEL_CHANNEL, args: [projectId, jobId], value: snapshot().job },
] as const;

describe('JOB05C fixed preload boundary', () => {
  it('has exactly four frozen methods, no transport/inherited vocabulary, and no creation I/O', () => {
    const h = harness();
    expectTypeOf(h.api).toEqualTypeOf<Readonly<ipc.JobApi>>();
    expect(Reflect.ownKeys(h.api)).toEqual(['list', 'get', 'cancel', 'subscribe']);
    expect(Object.isFrozen(h.api)).toBe(true); expect(Object.getPrototypeOf(h.api)).toBeNull();
    expect(h.invoke).not.toHaveBeenCalled(); expect(h.on).not.toHaveBeenCalled(); expect(h.removeListener).not.toHaveBeenCalled();
    for (const name of ['invoke', 'on', 'transport', 'supervisor', 'start', 'constructor', '__proto__']) expect(name in h.api).toBe(false);
    const unread = new Proxy({}, { get() { throw privateError(); } });
    expect(() => createJobApi(unread as Pick<IpcRenderer, 'invoke' | 'on' | 'removeListener'>)).not.toThrow();
  });
  it.each(operations)('$name sends only normalized explicit DTOs on its fixed channel', async (op) => {
    const raw = { ok: true, value: op.value }; const h = harness(raw);
    const result = await call(h.api, op.name, op.args.map((value) => value.toUpperCase()));
    expect(result).toEqual(raw); expect(result).not.toBe(raw); expect(Object.isFrozen(result)).toBe(true);
    expect(h.invoke.mock.calls).toEqual([[op.channel, op.name === 'list' ? { projectId } : { projectId, jobId }]]);
    expect(h.on).not.toHaveBeenCalled();
  });
  it.each(operations)('$name rejects unknown/missing/extra input without I/O', async (op) => {
    const getter = Object.defineProperty({}, 'projectId', { get() { throw privateError(); } });
    for (const args of [[], [...op.args, undefined], [null], [{ projectId, path: 'PRIVATE' }],
      ...[undefined, {}, getter, Symbol(), 1, () => undefined].map((value) => [value, ...op.args.slice(1)])]) {
      const h = harness(); expect(await call(h.api, op.name, args)).toEqual(failure('INVALID_REQUEST'));
      expect(h.invoke).not.toHaveBeenCalled(); expect(h.on).not.toHaveBeenCalled();
    }
  });
  it.each(operations)('$name sanitizes malformed responses, native throws and rejections', async (op) => {
    const throwing = Object.defineProperty({}, 'ok', { enumerable: true, get() { throw privateError(); } });
    for (const raw of [null, {}, throwing, { ok: true, value: op.value, path: 'PRIVATE' },
      { ok: false, error: { code: 'BUSY', message: 'PRIVATE' } }, failure('ENOENT')]) {
      expect(await call(harness(raw).api, op.name, [...op.args])).toEqual(failure());
    }
    for (const sync of [false, true]) {
      const h = harness(); h.invoke.mockImplementation(() => { if (sync) throw privateError(); return Promise.reject(privateError()); });
      expect(await call(h.api, op.name, [...op.args])).toEqual(failure());
    }
    for (const code of ipc.jobIpcErrorCodeSchema.options) {
      expect(await call(harness(failure(code)).api, op.name, [...op.args])).toEqual(failure(code));
    }
  });
  it('rejects project/job/progress correlation mismatches', async () => {
    expect(await harness({ ok: true, value: [snapshot(0, other).job] }).api.list(projectId)).toEqual(failure());
    for (const value of [snapshot(0, other), snapshot(0, projectId, other), { ...snapshot(), progress: snapshot(0, other).progress }]) {
      expect(await harness({ ok: true, value }).api.get(projectId, jobId)).toEqual(failure());
    }
    for (const value of [snapshot(0, other).job, snapshot(0, projectId, other).job]) {
      expect(await harness({ ok: true, value }).api.cancel(projectId, jobId)).toEqual(failure());
    }
  });
});

describe('JOB05C subscription lifetime', () => {
  it('validates subscribe arguments before any registration or invoke', async () => {
    for (const args of [[], [projectId], [projectId, null], [{ projectId }, vi.fn()], [projectId, vi.fn(), undefined]]) {
      const h = harness(); await expect(call(h.api, 'subscribe', args)).rejects.toThrow('INVALID_REQUEST');
      expect(h.on).not.toHaveBeenCalled(); expect(h.invoke).not.toHaveBeenCalled();
    }
  });
  it('installs before invoke, delivers initial then latest-per-job matching-token events only', async () => {
    const h = harness(); const deferred = Promise.withResolvers<unknown>(); const listener = vi.fn();
    h.invoke.mockImplementationOnce(() => {
      expect(h.handlers.size).toBe(1);
      h.change(token, snapshot(1)); h.change(token, snapshot(2));
      h.change(token2, snapshot(99)); h.change(token, snapshot(99, other)); h.emit({ snapshot: snapshot() });
      return deferred.promise;
    });
    const pending = h.api.subscribe(projectId.toUpperCase(), listener);
    expect(listener).not.toHaveBeenCalled(); deferred.resolve(ack(token, [snapshot()]));
    const stop = await pending;
    expect(listener.mock.calls).toEqual([[snapshot()], [snapshot(2)]]);
    expect(listener.mock.calls[0]).toHaveLength(1); expect(Object.isFrozen(listener.mock.calls[0]![0])).toBe(true);
    h.change(token2, snapshot(5)); h.change(token, snapshot(3));
    expect(listener.mock.calls.at(-1)).toEqual([snapshot(3)]);
    const native = h.on.mock.calls[0]![1]; stop(); stop();
    expect(h.handlers.size).toBe(0); expect(h.removeListener.mock.calls).toEqual([[ipc.JOB_CHANGED_CHANNEL, native]]);
    expect(h.invoke.mock.calls).toEqual([[ipc.JOB_SUBSCRIBE_CHANNEL, { projectId }], [ipc.JOB_UNSUBSCRIBE_CHANNEL, { projectId, subscriptionId: token }]]);
    native({}, { subscriptionId: token, snapshot: snapshot(4) }); expect(listener).toHaveBeenCalledTimes(3);
  });
  it.each([false, true])('isolates overlapping acknowledgements in both orders (new first: %s)', async (newFirst) => {
    const h = harness(); const a = Promise.withResolvers<unknown>(); const b = Promise.withResolvers<unknown>();
    h.invoke.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const oldListener = vi.fn(); const listener = vi.fn();
    const first = h.api.subscribe(projectId, oldListener); const second = h.api.subscribe(projectId, listener);
    h.change(token, snapshot(1)); h.change(token2, snapshot(2));
    if (newFirst) { b.resolve(ack(token2)); await second; a.resolve(ack(token)); }
    else { a.resolve(ack(token)); await first; b.resolve(ack(token2)); }
    const [oldStop, stop] = await Promise.all([first, second]); oldStop();
    expect(oldListener).not.toHaveBeenCalled(); expect(listener.mock.calls).toEqual([[snapshot(2)]]);
    expect(h.handlers.size).toBe(1);
    expect(h.invoke.mock.calls.filter(([channel]) => channel === ipc.JOB_UNSUBSCRIBE_CHANNEL))
      .toEqual([[ipc.JOB_UNSUBSCRIBE_CHANNEL, { projectId, subscriptionId: token }]]);
    stop(); expect(h.handlers.size).toBe(0);
  });
  it('A-B-A never mistakes an old A acknowledgement for the newest A', async () => {
    const h = harness(); const requests = [Promise.withResolvers<unknown>(), Promise.withResolvers<unknown>(), Promise.withResolvers<unknown>()];
    for (const request of requests) h.invoke.mockReturnValueOnce(request.promise);
    const old = vi.fn(); const middle = vi.fn(); const latest = vi.fn();
    const a = h.api.subscribe(projectId, old); const b = h.api.subscribe(other, middle); const c = h.api.subscribe(projectId, latest);
    requests[2]!.resolve(ack(token3, [snapshot(3)])); const stop = await c;
    requests[0]!.resolve(ack(token, [snapshot(1)])); requests[1]!.resolve(ack(token2, [snapshot(2, other)]));
    (await a)(); (await b)(); h.change(token3, snapshot(4));
    expect(old).not.toHaveBeenCalled(); expect(middle).not.toHaveBeenCalled(); expect(latest).toHaveBeenCalledTimes(2);
    expect(h.handlers.size).toBe(1);
    expect(h.invoke.mock.calls.slice(3)).toEqual([
      [ipc.JOB_UNSUBSCRIBE_CHANNEL, { projectId, subscriptionId: token }],
      [ipc.JOB_UNSUBSCRIBE_CHANNEL, { projectId: other, subscriptionId: token2 }],
    ]); stop();
  });
  it.each(['sync', 'async'])('isolates %s callback failure and continues delivery', async (mode) => {
    const h = harness(ack(token, [snapshot(), snapshot(0, projectId, other)]));
    const listener = vi.fn(() => { if (mode === 'sync') throw privateError(); return Promise.reject(privateError()); });
    const stop = await h.api.subscribe(projectId, listener); h.change(token, snapshot(3));
    await Promise.resolve(); expect(listener).toHaveBeenCalledTimes(3); stop();
  });
  it('checks generation between initial callbacks when a callback subscribes again', async () => {
    const h = harness(ack(token, [snapshot(), snapshot(0, projectId, other)])); const latest = vi.fn();
    let next: Promise<() => void> | undefined;
    const listener = vi.fn(() => { next = h.api.subscribe(projectId, latest); });
    const oldStop = await h.api.subscribe(projectId, listener); oldStop();
    expect(listener).toHaveBeenCalledOnce(); expect(latest).toHaveBeenCalledTimes(2);
    (await next!)(); expect(h.handlers.size).toBe(0);
  });
  it('stops immediately on reentrant unsubscribe, including retained native callbacks', async () => {
    const h = harness(); let stop: () => void = () => undefined;
    const listener = vi.fn(() => { stop(); h.change(token, snapshot(2)); });
    stop = await h.api.subscribe(projectId, listener); h.change(token, snapshot(1));
    expect(listener).toHaveBeenCalledOnce(); expect(h.handlers.size).toBe(0);
  });
  it('removes the exact listener on denial/malformed ack/lost ack without guessing tokens', async () => {
    for (const raw of [failure('BUSY'), {}, ack(token, [snapshot(), snapshot()])]) {
      const h = harness(raw); await expect(h.api.subscribe(projectId, vi.fn())).rejects.toThrow(/BUSY|OPERATION_FAILED/u);
      expect(h.handlers.size).toBe(0); expect(h.removeListener.mock.calls[0]).toEqual([ipc.JOB_CHANGED_CHANNEL, h.on.mock.calls[0]![1]]);
      expect(h.invoke).toHaveBeenCalledOnce();
    }
    const h = harness(); h.invoke.mockRejectedValueOnce(privateError());
    await expect(h.api.subscribe(projectId, vi.fn())).rejects.toThrow('OPERATION_FAILED');
    expect(h.handlers.size).toBe(0); expect(h.invoke).toHaveBeenCalledOnce();
  });
  it('cleans its known token on an acknowledgement with the wrong project', async () => {
    const h = harness(ack(token, [snapshot(0, other)]));
    await expect(h.api.subscribe(projectId, vi.fn())).rejects.toThrow('OPERATION_FAILED');
    expect(h.invoke.mock.calls.at(-1)).toEqual([ipc.JOB_UNSUBSCRIBE_CHANNEL, { projectId, subscriptionId: token }]);
    expect(h.handlers.size).toBe(0);
  });
  it.each(['reject', 'throw', 'malformed', 'stale', 'getter'])('observes unsubscribe %s without leaking or rejecting', async (mode) => {
    const h = harness(); const stop = await h.api.subscribe(projectId, vi.fn());
    h.invoke.mockImplementation(() => {
      if (mode === 'throw') throw privateError();
      if (mode === 'reject') return Promise.reject(privateError());
      if (mode === 'getter') return Promise.resolve(Object.defineProperty({}, 'ok', { get() { throw privateError(); } }));
      return Promise.resolve(mode === 'stale' ? failure('STALE_SUBSCRIPTION') : { ok: true, value: 'PRIVATE' });
    });
    expect(stop()).toBeUndefined(); stop(); await Promise.resolve(); await Promise.resolve();
    expect(h.handlers.size).toBe(0); expect(h.invoke).toHaveBeenCalledTimes(2);
  });
  it('sanitizes registration and cleanup property-read errors while invalidating locally', async () => {
    const h = harness(); Object.defineProperty(h.transport, 'on', { get() { throw privateError(); } });
    await expect(h.api.subscribe(projectId, vi.fn())).rejects.toThrow('OPERATION_FAILED'); expect(h.invoke).not.toHaveBeenCalled();
    const live = harness(); const listener = vi.fn(); const stop = await live.api.subscribe(projectId, listener);
    Object.defineProperty(live.transport, 'removeListener', { get() { throw privateError(); } });
    Object.defineProperty(live.transport, 'invoke', { get() { throw privateError(); } });
    expect(stop).not.toThrow(); live.change(token, snapshot()); await Promise.resolve(); expect(listener).not.toHaveBeenCalled();
  });
});