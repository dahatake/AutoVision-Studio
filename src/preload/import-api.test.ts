// @vitest-environment node
import type { IpcRenderer } from 'electron';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';

vi.mock('electron', () => { throw new Error('Import API must not load Electron.'); });

import * as ipc from '../shared/contracts/import-ipc.js';
import { createImportApi } from './import-api.js';

// Synthetic boundary DTOs only: no Main, services, filesystem or native picker.
const projectId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const jobId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const token = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const importId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const privatePath = 'C:\\PRIVATE\\source.png';
const start = { projectId, mode: 'reference', sourceKind: 'folder' } as const;
const selection = { projectId, jobId, token };
const commit = { ...selection, rightsAccepted: true } as const;
const job = { id: jobId, projectId, kind: 'scan-dataset', status: 'Running',
  createdAt: '2026-09-13T00:00:00.000Z', updatedAt: '2026-09-13T00:00:00.000Z' } as const;
const started = { status: 'started', token, job } as const;
const preview = { projectId, jobId, taskType: 'classification', mode: 'reference', itemCount: 1,
  sourceBytes: '900719925474099312345', classes: [{ key: '犬', name: '犬', sourceCategoryId: null }],
  files: [{ key: 'image:犬/1', displayName: '犬 🐕.png' }],
  issues: [{ severity: 'warning', code: 'DUPLICATE', imageKey: 'image:犬/1', row: 1, itemId: null }],
} as const;
const completed = { status: 'completed', projectId, importId, workspaceId: importId, itemCount: 1, cleanupWarning: true } as const;
const operations = [
  { name: 'start', channel: 'import:start', input: start, value: started },
  { name: 'preview', channel: 'import:preview', input: selection, value: preview },
  { name: 'commit', channel: 'import:commit', input: commit, value: completed },
  { name: 'discard', channel: 'import:discard', input: selection, value: null },
] as const;
function harness(response: unknown = undefined) {
  const invoke = vi.fn<(channel: string, ...args: unknown[]) => Promise<unknown>>(async () => response);
  const transport = { invoke };
  return { invoke, transport, api: createImportApi(transport) };
}
function call(api: Readonly<ipc.ImportApi>, name: keyof ipc.ImportApi, args: readonly unknown[]): Promise<unknown> {
  return Reflect.apply(api[name], { channel: 'arbitrary', transport: {}, mode: 'copy' }, args) as Promise<unknown>;
}
function frozen(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) frozen(child);
}
function expectFailure(value: unknown, code: ipc.ImportIpcErrorCode): void {
  expect(value).toStrictEqual({ ok: false, error: { code } }); frozen(value);
  expect(JSON.stringify(value)).not.toContain('PRIVATE');
}

describe('DAT08P fixed import preload boundary', () => {
  it('is lazy, frozen, null-prototype, typed and has exactly four methods', () => {
    const h = harness();
    expectTypeOf(createImportApi).toEqualTypeOf<(transport: Pick<IpcRenderer, 'invoke'>) => Readonly<ipc.ImportApi>>();
    expect(Reflect.ownKeys(h.api)).toEqual(['start', 'preview', 'commit', 'discard']);
    expect(Object.getPrototypeOf(h.api)).toBeNull(); expect(Object.isFrozen(h.api)).toBe(true);
    expect(Object.isFrozen(h.transport)).toBe(false); expect(h.invoke).not.toHaveBeenCalled();
    for (const key of ['constructor', '__proto__', 'invoke', 'transport', 'channel', 'capacity', 'config', 'subscribe', 'on', 'send']) {
      expect(key in h.api).toBe(false);
    }
  });

  it.each(operations)('$name forwards only a detached readonly request on its fixed channel', async (op) => {
    const input = { ...op.input, projectId: projectId.toUpperCase() };
    const raw = { ok: true, value: structuredClone(op.value) }; const h = harness(raw);
    const pending = call(h.api, op.name, [input]);
    expect(h.invoke.mock.calls).toEqual([[op.channel, op.input]]);
    const payload = h.invoke.mock.calls[0]![1]; expect(payload).not.toBe(input); frozen(payload);
    expect(Object.isFrozen(input)).toBe(false); expect(input.projectId).toBe(projectId.toUpperCase());
    const result = await pending; expect(result).toEqual(raw); expect(result).not.toBe(raw); frozen(result);
    expect(Object.isFrozen(raw)).toBe(false);
    if (raw.value !== null) expect(Object.isFrozen(raw.value)).toBe(false);
    expect(h.invoke).toHaveBeenCalledOnce();
  });

  it.each(operations)('$name rejects missing/extra arguments and hostile inputs without invoking or executing getters', async (op) => {
    const getter = vi.fn(() => projectId); const toJSON = vi.fn(() => op.input);
    const accessor = Object.defineProperty({ ...op.input }, 'projectId', { enumerable: true, get: getter });
    const revoked = Proxy.revocable({}, {}); revoked.revoke();
    const invalid = [undefined, null, false, 1, privatePath, [], {}, revoked.proxy, accessor,
      { ...op.input, toJSON }, { ...op.input, unknown: undefined }, { ...op.input, path: privatePath },
      { ...op.input, ['__proto__']: {} }, { ...op.input, [Symbol('hidden')]: true }];
    for (const args of [[], [op.input, undefined], [op.input, op.input], ...invalid.map((input) => [input])]) {
      const h = harness(); expectFailure(await call(h.api, op.name, args), 'INVALID_REQUEST');
      expect(h.invoke).not.toHaveBeenCalled();
    }
    expect(getter).not.toHaveBeenCalled(); expect(toJSON).not.toHaveBeenCalled();
    expect(Object.isFrozen(accessor)).toBe(false); expect(Object.isFrozen(op.input)).toBe(false);
  });

  it('rejects false/missing rights and unknown modes, without defaulting to copy', async () => {
    const h = harness();
    for (const input of [selection, { ...commit, rightsAccepted: false }, { ...commit, rightsAccepted: 'true' }]) {
      expectFailure(await call(h.api, 'commit', [input]), 'INVALID_REQUEST');
    }
    for (const mode of [undefined, 'auto', '', null]) {
      expectFailure(await call(h.api, 'start', [{ ...start, mode }]), 'INVALID_REQUEST');
    }
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it('passes cancellation, every declared source kind, and explicit copy/reference through without follow-up', async () => {
    const response = { ok: true, value: { status: 'cancelled' } }; const h = harness(response);
    for (const mode of ['copy', 'reference'] as const) {
      for (const sourceKind of ipc.importSourceKindSchema.options) {
        await expect(h.api.start({ ...start, mode, sourceKind })).resolves.toEqual(response);
        expect(h.invoke).toHaveBeenLastCalledWith('import:start', { ...start, mode, sourceKind });
      }
    }
    expect(h.invoke).toHaveBeenCalledTimes(10);
  });

  it.each(operations)('$name preserves only parsed public errors and capacity, never retrying uncertainty', async (op) => {
    for (const code of ipc.importIpcErrorCodeSchema.options) {
      const h = harness({ ok: false, error: { code } });
      expectFailure(await call(h.api, op.name, [op.input]), code); expect(h.invoke).toHaveBeenCalledOnce();
    }
    const raw = { ok: false, error: { code: 'IMPORT_CAPACITY', capacity: { requiredBytes: '900719925474099312345', availableBytes: '0' } } };
    const h = harness(raw); const result = await call(h.api, op.name, [op.input]);
    expect(result).toEqual(raw); frozen(result); expect(Object.isFrozen(raw.error.capacity)).toBe(false);
    expect(h.invoke).toHaveBeenCalledOnce();
  });

  it.each(operations)('$name maps synchronous/native/rejected failures to code-only OPERATION_FAILED', async (op) => {
    for (const error of [Object.assign(new Error(privatePath, { cause: { path: privatePath } }), { code: 'IMPORT_OUTCOME_UNCERTAIN' }),
      { code: 'IMPORT_CAPACITY', path: privatePath }, null, privatePath]) {
      for (const synchronous of [true, false]) {
        const h = harness();
        if (synchronous) h.invoke.mockImplementation(() => { throw error; }); else h.invoke.mockRejectedValue(error);
        expectFailure(await call(h.api, op.name, [op.input]), 'OPERATION_FAILED'); expect(h.invoke).toHaveBeenCalledOnce();
      }
    }
  });

  it.each(operations)('$name rejects malformed outcomes, unsafe extras and response getters', async (op) => {
    const getter = vi.fn(() => true);
    const revoked = Proxy.revocable({}, {}); revoked.revoke();
    const invalid = [undefined, null, [], {}, { ok: true }, { ok: false },
      { ok: false, error: { code: 'UNKNOWN' } }, { ok: false, error: { code: 'IMPORT_OUTCOME_UNCERTAIN', cause: privatePath } },
      { ok: false, error: { code: 'OPERATION_FAILED', capacity: { requiredBytes: '1', availableBytes: '0' } } },
      { ok: false, error: { code: 'IMPORT_CAPACITY', capacity: { requiredBytes: '01', availableBytes: '0' } } },
      { ok: true, value: op.value, extra: privatePath }, { ok: true, value: op.value, error: { code: 'IMPORT_INPUT' } },
      Object.defineProperty({}, 'ok', { enumerable: true, get: getter })];
    const h = harness();
    for (const raw of invalid) {
      h.invoke.mockResolvedValueOnce(raw);
      expectFailure(await call(h.api, op.name, [op.input]), 'OPERATION_FAILED');
    }
    // Nest the revoked proxy so Promise resolution cannot inspect its `then` first.
    h.invoke.mockResolvedValueOnce({ ok: true, value: revoked.proxy });
    expectFailure(await call(h.api, op.name, [op.input]), 'OPERATION_FAILED');
    expect(getter).not.toHaveBeenCalled(); expect(h.invoke).toHaveBeenCalledTimes(invalid.length + 1);
  });

  it('rejects crossed project/job correlations, wrong job kinds, workspace mismatches and path-bearing previews', async () => {
    const cases: { name: keyof ipc.ImportApi; input: unknown; value: unknown }[] = [
      { name: 'start', input: start, value: { ...started, job: { ...job, projectId: token } } },
      { name: 'start', input: start, value: { ...started, job: { ...job, kind: 'train' } } },
      { name: 'preview', input: selection, value: { ...preview, projectId: token } },
      { name: 'preview', input: selection, value: { ...preview, jobId: token } },
      { name: 'preview', input: selection, value: { ...preview, files: [{ ...preview.files[0], displayName: privatePath }] } },
      { name: 'preview', input: selection, value: { ...preview, files: [{ ...preview.files[0], sourcePath: privatePath }] } },
      { name: 'preview', input: selection, value: completed },
      { name: 'commit', input: commit, value: { ...completed, projectId: token } },
      { name: 'commit', input: commit, value: { ...completed, workspaceId: token } },
      { name: 'commit', input: commit, value: { ...completed, status: 'started' } },
      { name: 'commit', input: commit, value: preview },
      { name: 'discard', input: selection, value: {} },
    ];
    for (const test of cases) {
      const h = harness({ ok: true, value: test.value });
      expectFailure(await call(h.api, test.name, [test.input]), 'OPERATION_FAILED'); expect(h.invoke).toHaveBeenCalledOnce();
    }
  });

  it('detaches nested class names, including special keys, and isolates out-of-order concurrent callers', async () => {
    const names = { ['__proto__']: '特殊', constructor: '名前', 犬: '犬' };
    const input = { ...commit, classNames: names };
    const first = Promise.withResolvers<unknown>(); const second = Promise.withResolvers<unknown>(); const h = harness();
    h.invoke.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const pendingCommit = h.api.commit(input);
    const other = { ...selection, projectId: token, jobId: importId };
    const pendingPreview = h.api.preview(other);
    const sent = h.invoke.mock.calls[0]![1] as ipc.ImportCommitInput;
    frozen(sent); expect(sent.classNames).not.toBe(names); expect(Object.getPrototypeOf(sent.classNames)).toBeNull();
    expect(sent.classNames).toEqual(names); expect(Object.isFrozen(names)).toBe(false); expect(Object.isFrozen(input)).toBe(false);
    input.projectId = token; names['犬'] = 'changed'; other.projectId = projectId; other.jobId = jobId;
    expect(sent.projectId).toBe(projectId); expect(sent.classNames!['犬']).toBe('犬');
    const otherResponse = { ok: true, value: { ...preview, projectId: token, jobId: importId } };
    second.resolve(otherResponse); await expect(pendingPreview).resolves.toEqual(otherResponse);
    first.resolve({ ok: true, value: completed }); await expect(pendingCommit).resolves.toEqual({ ok: true, value: completed });
    expect(h.invoke).toHaveBeenCalledTimes(2);
  });
});