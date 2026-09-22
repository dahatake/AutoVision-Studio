import { describe, expect, it, vi } from 'vitest';

import { createReferenceApi } from './reference-api.js';
import {
  REFERENCE_RELINK_CHANNEL, REFERENCE_STATUS_CHANNEL,
} from '../shared/contracts/reference-ipc.js';

const projectId = '2f1b2c8e-0c3f-4a1e-9e2f-4b8f6a1d2c3e';
const importId = '9a3c7d51-6b21-4f0e-8c7a-1d2e3f4a5b6c';
const relinkInput = { projectId, importId, imageKey: 'image:0' } as const;

function harness(response: unknown = { ok: true, value: { projectId, inspectedImports: 0, checked: 0, broken: [] } }) {
  const invoke = vi.fn<(channel: string, ...args: unknown[]) => Promise<unknown>>()
    .mockResolvedValue(response);
  return { invoke, api: createReferenceApi({ invoke }) };
}

describe('Reference preload fixed surface', () => {
  it('is frozen, prototype-less and exposes exactly two methods', () => {
    const h = harness();
    expect(Reflect.ownKeys(h.api)).toEqual(['status', 'relink']);
    expect(Object.getPrototypeOf(h.api)).toBeNull();
    expect(Object.isFrozen(h.api)).toBe(true);
    expect(h.invoke).not.toHaveBeenCalled();
    for (const key of ['invoke', 'transport', 'channel', 'ipcRenderer', 'contextBridge', 'path', 'on', 'send']) {
      expect(key in h.api).toBe(false);
    }
    expect(Reflect.set(h.api, 'status', h.invoke)).toBe(false);
  });

  it('sends the validated payload on the fixed channels only', async () => {
    const h = harness();
    await h.api.status({ projectId });
    expect(h.invoke).toHaveBeenCalledWith(REFERENCE_STATUS_CHANNEL, { projectId });

    const relink = harness({ ok: true, value: { status: 'relinked', importId, imageKey: 'image:0' } });
    await relink.api.relink(relinkInput);
    expect(relink.invoke).toHaveBeenCalledWith(REFERENCE_RELINK_CHANNEL, relinkInput);
  });

  it('refuses an invalid or extra-key input without touching the transport', async () => {
    const h = harness();
    for (const value of [undefined, null, { projectId, path: 'C:\\x' }, { projectId: 'nope' }]) {
      const result = await h.api.status(value as never);
      expect(result).toEqual({ ok: false, error: { code: 'INVALID_REQUEST' } });
    }
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it('refuses extra arguments', async () => {
    const h = harness();
    const call = h.api.status as unknown as (...args: unknown[]) => Promise<unknown>;
    expect(await call({ projectId }, { projectId })).toEqual({ ok: false, error: { code: 'INVALID_REQUEST' } });
    expect(await call()).toEqual({ ok: false, error: { code: 'INVALID_REQUEST' } });
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it('reports an unacknowledged transport as uncertain, never as a benign result', async () => {
    const rejected = { invoke: vi.fn().mockRejectedValue(new Error('EPIPE')) };
    const api = createReferenceApi(rejected);
    expect(await api.status({ projectId })).toEqual({ ok: false, error: { code: 'OPERATION_FAILED' } });
    expect(await api.relink(relinkInput)).toEqual({ ok: false, error: { code: 'OPERATION_FAILED' } });
  });

  it('rejects a response that does not correlate with the request', async () => {
    const wrong = harness({ ok: true, value: { projectId: importId, inspectedImports: 0, checked: 0, broken: [] } });
    expect(await wrong.api.status({ projectId })).toEqual({ ok: false, error: { code: 'OPERATION_FAILED' } });

    const mismatched = harness({ ok: true, value: { status: 'relinked', importId, imageKey: 'image:9' } });
    expect(await mismatched.api.relink(relinkInput)).toEqual({ ok: false, error: { code: 'OPERATION_FAILED' } });
  });
});
