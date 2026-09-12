import type { IpcRenderer } from 'electron';
import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

const electronMocks = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn<(apiKey: string, api: unknown) => void>(),
  invoke: vi.fn<(channel: string, ...args: unknown[]) => Promise<unknown>>(),
  on: vi.fn<IpcRenderer['on']>(),
  removeListener: vi.fn<IpcRenderer['removeListener']>(),
}));

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: electronMocks.exposeInMainWorld,
  },
  ipcRenderer: {
    invoke: electronMocks.invoke,
    on: electronMocks.on,
    removeListener: electronMocks.removeListener,
  },
}));

import {
  APP_API_CONTRACT_VERSION,
  APP_BRIDGE_KEY,
  type AppApi,
} from '../shared/contracts/app.js';
import { hardwareDiagnosticsSchema, type HardwareDiagnostics } from '../shared/contracts/diagnostics.js';
import type { DiagnosticExportResult } from '../shared/contracts/diagnostic-export.js';
import type { ImportApi } from '../shared/contracts/import-ipc.js';
import type { JobApi, JobSnapshot } from '../shared/contracts/job-ipc.js';
import type { ProjectApi } from '../shared/contracts/project-ipc.js';

// Synthetic DTOs only; the real factory talks solely to the mocked Electron boundary.
function diagnosticsReport(): HardwareDiagnostics {
  const unchecked = { status: 'not_checked', data: null, error: null } as const;
  return hardwareDiagnosticsSchema.parse({
    schemaVersion: 1, command: 'probe-hardware', status: 'partial',
    os: { status: 'ok', data: { name: 'Windows', major: 10, minor: 0, build: 1,
      productType: 1, architecture: 'synthetic' }, error: null },
    cpu: unchecked, memory: unchecked, disk: unchecked, gpu: unchecked, onnxRuntime: unchecked, cuda: unchecked,
    camera: { status: 'deferred', streamOpened: false, reasonCode: 'check-on-inference-start' },
  });
}
const diagnosticsFailure = { message: 'Hardware diagnostics unavailable.', code: 'DIAGNOSTICS_UNAVAILABLE' };
const projectId = 'ae45cf74-c9f9-4c49-88b9-0523b1ac7383';
const parentToken = 'd0b79d8d-61bc-47f0-a6bf-b2e65a48be91';
const snapshot = {
  project: {
    id: projectId,
    name: 'Project fixture',
    description: '',
    taskType: 'classification',
    workspacePath: `C:\\Synthetic\\Projects\\${projectId}`,
    createdAt: '2026-09-12T00:00:00.000Z',
    updatedAt: '2026-09-12T00:00:00.000Z',
  },
  taskTypeLocked: false,
} as const;
const operations = [
  {
    name: 'list', channel: 'project:list', args: [],
    response: { ok: true, value: [snapshot] },
    call: (api: ProjectApi) => api.list(),
  },
  {
    name: 'get', channel: 'project:get', args: [{ projectId }],
    response: { ok: true, value: snapshot },
    call: (api: ProjectApi) => api.get({ projectId: projectId.toUpperCase() }),
  },
  {
    name: 'create', channel: 'project:create',
    args: [{ name: snapshot.project.name, description: '', taskType: 'classification', parentToken }],
    response: { ok: true, value: snapshot },
    call: (api: ProjectApi) => api.create({
      name: '  Project fixture  ', taskType: 'classification', parentToken: parentToken.toUpperCase(),
    }),
  },
  {
    name: 'update', channel: 'project:update',
    args: [{ id: projectId, name: '更新後', description: '説明', taskType: 'detection' }],
    response: { ok: true, value: {
      ...snapshot, project: { ...snapshot.project, name: '更新後', description: '説明', taskType: 'detection' },
    } },
    call: (api: ProjectApi) => api.update({
      id: projectId.toUpperCase(), name: '  更新後  ', description: '説明', taskType: 'detection',
    }),
  },
  {
    name: 'pickParent', channel: 'project:pick-parent', args: [{ purpose: 'create' }],
    response: { ok: true, value: { status: 'selected', token: parentToken, displayPath: 'C:\\Synthetic\\Parent' } },
    call: (api: ProjectApi) => api.pickParent({ purpose: 'create' }),
  },
  {
    name: 'move', channel: 'project:move', args: [{ projectId, parentToken }],
    response: { ok: true, value: {
      ...snapshot, project: { ...snapshot.project, workspacePath: `D:\\Synthetic\\Projects\\${projectId}` },
      cleanupStatus: 'completed',
    } },
    call: (api: ProjectApi) => api.move({
      projectId: projectId.toUpperCase(), parentToken: parentToken.toUpperCase(),
    }),
  },
  {
    name: 'recover', channel: 'project:recover', args: [{ projectId }],
    response: { ok: true, value: { ...snapshot, cleanupStatus: 'none' } },
    call: (api: ProjectApi) => api.recover({ projectId: projectId.toUpperCase() }),
  },
] as const;

const jobId = 'd0b79d8d-61bc-47f0-a6bf-b2e65a48be91';
const subscriptionId = 'bb45cf74-c9f9-4c49-88b9-0523b1ac7383';
function jobSnapshot(processed = 0): JobSnapshot {
  return {
    job: { id: jobId, projectId, kind: 'train', status: 'Running',
      createdAt: '2026-09-12T00:00:00Z', updatedAt: '2026-09-12T00:00:00Z' },
    progress: { schemaVersion: 1, type: 'progress', source: 'actual', projectId, jobId, processed, total: null },
    workerCompleted: false,
  };
}
const jobOperations = [
  { name: 'list', channel: 'jobs:list', args: [projectId], input: { projectId }, value: [jobSnapshot().job],
    call: (api: JobApi) => api.list(projectId.toUpperCase()) },
  { name: 'get', channel: 'jobs:get', args: [projectId, jobId], input: { projectId, jobId }, value: jobSnapshot(),
    call: (api: JobApi) => api.get(projectId.toUpperCase(), jobId.toUpperCase()) },
  { name: 'cancel', channel: 'jobs:cancel', args: [projectId, jobId], input: { projectId, jobId }, value: jobSnapshot().job,
    call: (api: JobApi) => api.cancel(projectId.toUpperCase(), jobId.toUpperCase()) },
] as const;

const importToken = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const importId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const importStart = { projectId, mode: 'reference', sourceKind: 'folder' } as const;
const importSelection = { projectId, jobId, token: importToken };
const importCommit = { ...importSelection, rightsAccepted: true } as const;
const importOperations = [
  { name: 'start', channel: 'import:start', input: importStart,
    value: { status: 'started', token: importToken, job: { ...jobSnapshot().job, kind: 'scan-dataset' } },
    call: (api: ImportApi) => api.start({ ...importStart, projectId: projectId.toUpperCase() }) },
  { name: 'preview', channel: 'import:preview', input: importSelection,
    value: { projectId, jobId, taskType: 'classification', mode: 'reference', itemCount: 1,
      sourceBytes: '900719925474099312345', classes: [{ key: '犬', name: '犬', sourceCategoryId: null }],
      files: [{ key: 'image:犬/1', displayName: '犬.png' }], issues: [] },
    call: (api: ImportApi) => api.preview({ ...importSelection, projectId: projectId.toUpperCase() }) },
  { name: 'commit', channel: 'import:commit', input: importCommit,
    value: { status: 'completed', projectId, importId, workspaceId: importId, itemCount: 1, cleanupWarning: true },
    call: (api: ImportApi) => api.commit({ ...importCommit, projectId: projectId.toUpperCase() }) },
  { name: 'discard', channel: 'import:discard', input: importSelection, value: null,
    call: (api: ImportApi) => api.discard({ ...importSelection, projectId: projectId.toUpperCase() }) },
] as const;

function exposedAppApi(): AppApi {
  const exposure = electronMocks.exposeInMainWorld.mock.calls[0];
  if (exposure === undefined) throw new Error('Expected an app bridge exposure.');
  return exposure[1] as AppApi;
}

beforeEach(async () => {
  vi.resetModules();
  electronMocks.exposeInMainWorld.mockReset();
  electronMocks.invoke.mockReset();
  electronMocks.on.mockReset();
  electronMocks.removeListener.mockReset();
  // Reset before import, never after it: eager IPC must remain observable.
  await import('./index.js');
});

describe('preload app bridge', () => {
  it('exposes one frozen version-1 API through the isolated context bridge', () => {
    expect(electronMocks.exposeInMainWorld).toHaveBeenCalledOnce();

    expect(electronMocks.exposeInMainWorld.mock.calls[0]![0]).toBe(APP_BRIDGE_KEY);
    expect(APP_BRIDGE_KEY).toBe('autoVision');
    expect(APP_API_CONTRACT_VERSION).toBe(1);
    const api = exposedAppApi();
    expect(Reflect.ownKeys(api)).toEqual([
      'contractVersion', 'projects', 'labelSchemas', 'annotations',
      'diagnostics', 'jobs', 'imports',
    ]);
    expect(api.contractVersion).toBe(APP_API_CONTRACT_VERSION);
    expect(Object.isFrozen(api)).toBe(true);
    expect(Reflect.set(api, 'contractVersion', 2)).toBe(false);
    expect(Reflect.set(api, 'projects', {})).toBe(false);
    expect(Reflect.set(api, 'labelSchemas', {})).toBe(false);
    expect(Reflect.set(api, 'annotations', {})).toBe(false);
    expect(Reflect.set(api, 'diagnostics', {})).toBe(false);
    expect(Reflect.set(api, 'jobs', {})).toBe(false);
    expect(Reflect.set(api, 'imports', {})).toBe(false);
  });

  it('exposes exactly seven frozen Project methods without inherited or raw capabilities', () => {
    const api = exposedAppApi();
    expect(Reflect.ownKeys(api.projects)).toEqual(['list', 'get', 'create', 'update', 'pickParent', 'move', 'recover']);
    expect(Object.getPrototypeOf(api.projects)).toBeNull();
    expect(Object.isFrozen(api.projects)).toBe(true);
    for (const method of Object.values(api.projects)) expect(typeof method).toBe('function');
    expect(Reflect.set(api.projects, 'get', electronMocks.invoke)).toBe(false);

    for (const surface of [api, api.projects, api.diagnostics, api.jobs]) {
      for (const key of ['ipcRenderer', 'contextBridge', 'invoke', 'send', 'on', 'once', 'removeListener',
        'require', 'process', 'filesystem', 'childProcess', 'transport', 'channel',
        'fs', 'exec', 'execFile', 'spawn', 'executablePath', 'argsPrefix', 'cwd', 'diskPath', 'dispose',
        'start', 'supervisor', 'subscriptionId', 'unsubscribe', 'removeAllListeners', 'sender',
        'mediaDevices', 'getUserMedia', 'enumerateDevices', 'preview', 'delete']) {
        expect(key in surface).toBe(false);
      }
    }
  });

  it('does not invoke or register any operation on import, bridge reads or a repeated import', async () => {
    expect(electronMocks.invoke).not.toHaveBeenCalled();
    expect(electronMocks.on).not.toHaveBeenCalled();
    expect(electronMocks.removeListener).not.toHaveBeenCalled();
    const api = exposedAppApi();
    expect(api.contractVersion).toBe(1);
    expect(Object.values(api.projects)).toHaveLength(7);
    expect(Object.values(api.diagnostics)).toHaveLength(2);
    expect(Object.values(api.jobs)).toHaveLength(4);
    expect(Object.values(api.imports)).toHaveLength(4);
    await import('./index.js');
    expect(electronMocks.exposeInMainWorld).toHaveBeenCalledOnce();
    expect(electronMocks.invoke).not.toHaveBeenCalled();
    expect(electronMocks.on).not.toHaveBeenCalled();
    expect(electronMocks.removeListener).not.toHaveBeenCalled();
  });

  it('exposes exactly four typed Import methods on a frozen API without inherited or raw capabilities', () => {
    const api = exposedAppApi().imports;
    expectTypeOf(api).toEqualTypeOf<ImportApi>();
    expect(Reflect.ownKeys(api)).toEqual(['start', 'preview', 'commit', 'discard']);
    expect(Object.getPrototypeOf(api)).toBeNull(); expect(Object.isFrozen(api)).toBe(true);
    for (const name of ['start', 'preview', 'commit', 'discard'] as const) {
      expect(typeof api[name]).toBe('function');
      expect(Reflect.set(api, name, electronMocks.invoke)).toBe(false);
    }
    for (const key of ['constructor', '__proto__', 'toString', 'ipcRenderer', 'contextBridge', 'invoke',
      'send', 'on', 'subscribe', 'removeListener', 'transport', 'channel', 'require', 'process', 'fs',
      'filesystem', 'childProcess', 'exec', 'execFile', 'spawn', 'launch', 'path', 'sourcePath',
      'executablePath', 'argsPrefix', 'cwd', 'diskPath']) expect(key in api).toBe(false);
    expect(electronMocks.invoke).not.toHaveBeenCalled();
  });

  it.each(importOperations)('uses the actual Import factory for $name with validated DTOs and the native receiver', async (operation) => {
    const { ipcRenderer } = await import('electron');
    const response = { ok: true, value: operation.value };
    electronMocks.invoke.mockResolvedValueOnce(response);
    const result = await operation.call(exposedAppApi().imports);
    expect(electronMocks.invoke.mock.calls).toEqual([[operation.channel, operation.input]]);
    expect(electronMocks.invoke.mock.contexts).toEqual([ipcRenderer]);
    expect(Object.isFrozen(electronMocks.invoke.mock.calls[0]![1])).toBe(true);
    expect(result).toStrictEqual(response); expect(result).not.toBe(response); expect(Object.isFrozen(result)).toBe(true);
    if (!result.ok) throw new Error('Expected a validated Import result.');
    if (result.value !== null) {
      expect(result.value).not.toBe(response.value); expect(Object.isFrozen(result.value)).toBe(true);
    }
    expect(electronMocks.on).not.toHaveBeenCalled(); expect(electronMocks.removeListener).not.toHaveBeenCalled();
  });

  it.each(importOperations)('preserves Import $name uncertainty without retrying or following up', async (operation) => {
    const failure = { ok: false, error: { code: 'IMPORT_OUTCOME_UNCERTAIN' } } as const;
    electronMocks.invoke.mockResolvedValueOnce(failure);
    const result = await operation.call(exposedAppApi().imports);
    expect(result).toStrictEqual(failure); expect(result).not.toBe(failure); expect(Object.isFrozen(result)).toBe(true);
    if (result.ok) throw new Error('Expected a code-only failure.');
    expect(Object.isFrozen(result.error)).toBe(true);
    expect(electronMocks.invoke.mock.calls).toEqual([[operation.channel, operation.input]]);
    expect(electronMocks.on).not.toHaveBeenCalled(); expect(electronMocks.removeListener).not.toHaveBeenCalled();
  });

  it('rejects missing/false rights and missing/invalid modes without forwarding or defaulting to copy', async () => {
    const api = exposedAppApi().imports;
    for (const input of [importSelection, { ...importCommit, rightsAccepted: false }, { ...importCommit, rightsAccepted: 'true' }]) {
      await expect(Reflect.apply(api.commit, null, [input]))
        .resolves.toStrictEqual({ ok: false, error: { code: 'INVALID_REQUEST' } });
    }
    for (const input of [{ projectId, sourceKind: 'folder' },
      ...[undefined, null, '', 'auto'].map((mode) => ({ ...importStart, mode }))]) {
      await expect(Reflect.apply(api.start, null, [input]))
        .resolves.toStrictEqual({ ok: false, error: { code: 'INVALID_REQUEST' } });
    }
    expect(electronMocks.invoke).not.toHaveBeenCalled(); expect(electronMocks.on).not.toHaveBeenCalled();
  });

  it.each(importOperations)('rejects invalid Import $name arguments and sanitizes malformed responses', async (operation) => {
    const api = exposedAppApi().imports;
    for (const args of [[], [operation.input, undefined], [{ ...operation.input, projectId: 'invalid' }],
      [{ ...operation.input, channel: 'PRIVATE', path: 'PRIVATE', executablePath: 'PRIVATE' }]]) {
      await expect(Reflect.apply(api[operation.name], { invoke: electronMocks.invoke }, args))
        .resolves.toStrictEqual({ ok: false, error: { code: 'INVALID_REQUEST' } });
    }
    expect(electronMocks.invoke).not.toHaveBeenCalled();
    electronMocks.invoke.mockResolvedValueOnce({ ok: true, value: operation.value, path: 'PRIVATE' });
    await expect(operation.call(api)).resolves.toStrictEqual({ ok: false, error: { code: 'OPERATION_FAILED' } });
    expect(electronMocks.invoke.mock.calls).toEqual([[operation.channel, operation.input]]);
  });

  it('exposes exactly four frozen typed Job methods without inherited capabilities', () => {
    const api = exposedAppApi().jobs;
    expectTypeOf(api).toEqualTypeOf<JobApi>();
    expect(Reflect.ownKeys(api)).toEqual(['list', 'get', 'cancel', 'subscribe']);
    expect(Object.getPrototypeOf(api)).toBeNull(); expect(Object.isFrozen(api)).toBe(true);
    for (const method of Object.values(api)) expect(typeof method).toBe('function');
    for (const name of ['list', 'get', 'cancel', 'subscribe']) expect(Reflect.set(api, name, electronMocks.invoke)).toBe(false);
    for (const key of ['constructor', '__proto__', 'toString']) expect(key in api).toBe(false);
  });

  it.each(jobOperations)('uses the actual Job factory for $name with normalized DTOs and the native receiver', async (operation) => {
    const { ipcRenderer } = await import('electron');
    const response = { ok: true, value: operation.value };
    electronMocks.invoke.mockResolvedValueOnce(response);
    const result = await operation.call(exposedAppApi().jobs);
    expect(electronMocks.invoke.mock.calls).toEqual([[operation.channel, operation.input]]);
    expect(electronMocks.invoke.mock.contexts[0]).toBe(ipcRenderer);
    expect(result).toStrictEqual(response); expect(result).not.toBe(response); expect(Object.isFrozen(result)).toBe(true);
    if (!result.ok) throw new Error('Expected a validated Job result.');
    expect(result.value).not.toBe(response.value); expect(Object.isFrozen(result.value)).toBe(true);
    expect(electronMocks.on).not.toHaveBeenCalled(); expect(electronMocks.removeListener).not.toHaveBeenCalled();
  });

  it.each(jobOperations)('rejects invalid Job $name requests before Electron and sanitizes malformed responses', async (operation) => {
    const method = exposedAppApi().jobs[operation.name];
    for (const args of [[], ['invalid', ...operation.args.slice(1)],
      [{ projectId, channel: 'PRIVATE', path: 'PRIVATE' }, ...operation.args.slice(1)], [...operation.args, undefined]]) {
      await expect(Reflect.apply(method, { invoke: electronMocks.invoke }, args))
        .resolves.toStrictEqual({ ok: false, error: { code: 'INVALID_REQUEST' } });
    }
    expect(electronMocks.invoke).not.toHaveBeenCalled();
    electronMocks.invoke.mockResolvedValueOnce({ ok: true, value: operation.value, path: 'PRIVATE' });
    await expect(operation.call(exposedAppApi().jobs)).resolves.toStrictEqual({ ok: false, error: { code: 'OPERATION_FAILED' } });
    expect(electronMocks.invoke.mock.calls).toEqual([[operation.channel, operation.input]]);
    expect(electronMocks.on).not.toHaveBeenCalled();
  });

  it('unwraps Job events and removes exactly its native listener and wire token on idempotent unsubscribe', async () => {
    const { ipcRenderer } = await import('electron');
    const initial = jobSnapshot(), updated = jobSnapshot(1), listener = vi.fn<(snapshot: JobSnapshot) => void>();
    electronMocks.invoke.mockResolvedValueOnce({ ok: true, value: { subscriptionId, snapshots: [initial] } })
      .mockResolvedValueOnce({ ok: true, value: null });
    const stop = await exposedAppApi().jobs.subscribe(projectId.toUpperCase(), listener);
    expect(electronMocks.on).toHaveBeenCalledOnce();
    expect(electronMocks.on.mock.calls[0]![0]).toBe('jobs:changed');
    expect(electronMocks.on.mock.contexts[0]).toBe(ipcRenderer);
    expect(electronMocks.on.mock.invocationCallOrder[0]!).toBeLessThan(electronMocks.invoke.mock.invocationCallOrder[0]!);
    const nativeListener = electronMocks.on.mock.calls[0]![1];
    expect(nativeListener).not.toBe(listener);
    const electronEvent = { sender: ipcRenderer, privateData: 'PRIVATE' };
    Reflect.apply(nativeListener, ipcRenderer, [electronEvent, { subscriptionId, snapshot: updated }]);
    expect(listener.mock.calls).toEqual([[initial], [updated]]);
    expect(listener.mock.calls[1]![0]).not.toBe(updated); expect(Object.isFrozen(listener.mock.calls[1]![0])).toBe(true);
    Reflect.apply(nativeListener, ipcRenderer, [electronEvent, { subscriptionId, snapshot: updated, path: 'PRIVATE' }]);
    Reflect.apply(nativeListener, ipcRenderer, [electronEvent, { subscriptionId: jobId, snapshot: updated }]);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(stop()).toBeUndefined(); stop();
    expect(electronMocks.removeListener.mock.calls).toEqual([['jobs:changed', nativeListener]]);
    expect(electronMocks.removeListener.mock.contexts[0]).toBe(ipcRenderer);
    expect(electronMocks.invoke.mock.calls).toEqual([
      ['jobs:subscribe', { projectId }], ['jobs:unsubscribe', { projectId, subscriptionId }],
    ]);
    expect(electronMocks.invoke.mock.contexts).toEqual([ipcRenderer, ipcRenderer]);
    Reflect.apply(nativeListener, ipcRenderer, [electronEvent, { subscriptionId, snapshot: jobSnapshot(2) }]);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('exposes only typed collect/exportSummary methods with no inherited diagnostic capabilities', () => {
    const api = exposedAppApi().diagnostics;
    expectTypeOf(api.collect).toEqualTypeOf<() => Promise<HardwareDiagnostics>>();
    expectTypeOf(api.exportSummary).toEqualTypeOf<(() => Promise<DiagnosticExportResult>) | undefined>();
    expect(typeof api.exportSummary).toBe('function');
    expect(Reflect.ownKeys(api)).toEqual(['collect', 'exportSummary']);
    expect(Object.getPrototypeOf(api)).toBeNull(); expect(Object.isFrozen(api)).toBe(true);
    for (const key of ['constructor', '__proto__', 'toString']) expect(key in api).toBe(false);
    expect(Reflect.set(api, 'collect', electronMocks.invoke)).toBe(false);
    expect(Reflect.set(api, 'exportSummary', electronMocks.invoke)).toBe(false);
    expect(electronMocks.invoke).not.toHaveBeenCalled();
  });

  it.each([
    { status: 'saved', path: 'C:\\Synthetic\\logs\\diagnostics.txt', byteLength: 880, sha256: 'a'.repeat(64) },
    { status: 'cancelled' }, { status: 'failed', code: 'DIAGNOSTIC_EXPORT_FAILED' },
    { status: 'failed', code: 'DIAGNOSTIC_EXPORT_BUSY' },
  ])('exposes the current export capability and returns only its validated detached result %#', async (response) => {
    const { ipcRenderer } = await import('electron');
    electronMocks.invoke.mockResolvedValueOnce(response);
    const api = exposedAppApi().diagnostics;
    if (!api.exportSummary) throw new Error('Current Preload must expose exportSummary');
    const result = await api.exportSummary();
    expect(electronMocks.invoke.mock.calls).toEqual([['diagnostics:export']]);
    expect(electronMocks.invoke.mock.contexts[0]).toBe(ipcRenderer);
    expect(result).toEqual(response); expect(result).not.toBe(response); expect(Object.isFrozen(result)).toBe(true);
  });

  it.each([[undefined], [null], ['PRIVATE'], [{ path: 'PRIVATE', confirmed: true }], [{ report: diagnosticsReport() }], [1, 2]])(
    'refuses any supplied export argument %# without invoking a write-capable operation', async (...args) => {
      const method = exposedAppApi().diagnostics.exportSummary;
      if (!method) throw new Error('Current Preload must expose exportSummary');
      const result = await Reflect.apply(method, { invoke: electronMocks.invoke }, args);
      expect(result).toEqual({ status: 'failed', code: 'DIAGNOSTIC_EXPORT_FAILED' });
      expect(electronMocks.invoke).not.toHaveBeenCalled();
    },
  );

  it.each([null, {}, 'PRIVATE', { status: 'saved' }, { status: 'failed', code: 'ENOENT' },
    { status: 'cancelled', report: 'PRIVATE' }, { status: 'cancelled', ['__proto__']: 'PRIVATE' }])(
    'sanitizes an invalid export response %#', async (response) => {
      electronMocks.invoke.mockResolvedValueOnce(response);
      const method = exposedAppApi().diagnostics.exportSummary;
      if (!method) throw new Error('Current Preload must expose exportSummary');
      await expect(method()).resolves.toEqual({ status: 'failed', code: 'DIAGNOSTIC_EXPORT_FAILED' });
      expect(electronMocks.invoke.mock.calls).toEqual([['diagnostics:export']]);
    },
  );

  it.each([false, true])('sanitizes export invoke failure without collecting or retrying (sync=%s)', async (sync) => {
    if (sync) electronMocks.invoke.mockImplementationOnce(() => { throw new Error('PRIVATE'); });
    else electronMocks.invoke.mockRejectedValueOnce(new Error('PRIVATE'));
    const method = exposedAppApi().diagnostics.exportSummary;
    if (!method) throw new Error('Current Preload must expose exportSummary');
    await expect(method()).resolves.toEqual({ status: 'failed', code: 'DIAGNOSTIC_EXPORT_FAILED' });
    expect(electronMocks.invoke.mock.calls).toEqual([['diagnostics:export']]);
  });

  it('uses the actual diagnostic factory to invoke the fixed channel lazily and parse a detached report', async () => {
    const { ipcRenderer } = await import('electron');
    const report = diagnosticsReport();
    electronMocks.invoke.mockResolvedValueOnce(report);
    expect(electronMocks.invoke).not.toHaveBeenCalled();
    const result = await exposedAppApi().diagnostics.collect();
    expect(electronMocks.invoke.mock.calls).toEqual([['diagnostics:collect']]);
    expect(electronMocks.invoke.mock.contexts[0]).toBe(ipcRenderer);
    expect(result).toStrictEqual(report); expect(result).not.toBe(report); expect(result.os).not.toBe(report.os);
  });

  it('never forwards diagnostic paths, arguments, channels or a forged receiver from the Renderer', async () => {
    const report = diagnosticsReport(); electronMocks.invoke.mockResolvedValueOnce(report);
    const response: Promise<HardwareDiagnostics> = Reflect.apply(exposedAppApi().diagnostics.collect,
      { invoke: electronMocks.invoke, diskPath: 'PRIVATE' },
      [{ channel: 'PRIVATE', executablePath: 'PRIVATE', argsPrefix: ['health'], cwd: 'PRIVATE', diskPath: 'PRIVATE' }, undefined]);
    await expect(response).resolves.toStrictEqual(report);
    expect(electronMocks.invoke.mock.calls).toEqual([['diagnostics:collect']]);
  });

  it.each(['null', 'non-report', 'extra-field', 'inconsistent-summary'] as const)(
    'rejects a malformed diagnostic %s without exposing the schema input or substituting health', async (mode) => {
      const report = diagnosticsReport();
      const response: unknown = mode === 'null' ? null : mode === 'non-report' ? 'PRIVATE'
        : mode === 'extra-field' ? { ...report, executablePath: 'PRIVATE' } : { ...report, status: 'ok' };
      electronMocks.invoke.mockResolvedValueOnce(response);
      await expect(exposedAppApi().diagnostics.collect()).rejects.toMatchObject(diagnosticsFailure);
      expect(electronMocks.invoke.mock.calls).toEqual([['diagnostics:collect']]);
    },
  );

  it.each(['synchronous throw', 'rejected invoke'] as const)(
    'sanitizes a diagnostic %s without native details or retries', async (mode) => {
      const failure = Object.assign(new Error('PRIVATE diagnostic failure'), { path: 'PRIVATE', code: 'ENOENT' });
      if (mode === 'synchronous throw') electronMocks.invoke.mockImplementationOnce(() => { throw failure; });
      else electronMocks.invoke.mockRejectedValueOnce(failure);
      await expect(exposedAppApi().diagnostics.collect()).rejects.toMatchObject(diagnosticsFailure);
      expect(electronMocks.invoke.mock.calls).toEqual([['diagnostics:collect']]);
    },
  );

  it.each(operations)('forwards only the explicitly selected $name operation with validated arguments', async (operation) => {
    const { ipcRenderer } = await import('electron');
    electronMocks.invoke.mockResolvedValueOnce(operation.response);
    expect(electronMocks.invoke).not.toHaveBeenCalled();

    const result = await operation.call(exposedAppApi().projects);

    expect(electronMocks.invoke.mock.calls).toEqual([[operation.channel, ...operation.args]]);
    expect(electronMocks.invoke.mock.contexts[0]).toBe(ipcRenderer);
    expect(result).toStrictEqual(operation.response);
    expect(result).not.toBe(operation.response);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('rejects invalid IDs and injected channels or paths before invoking Electron', async () => {
    const api = exposedAppApi();
    for (const input of [
      { projectId: 'invalid' },
      { projectId, channel: 'project:delete' },
      { projectId, path: 'C:\\Synthetic\\PRIVATE' },
    ]) {
      await expect(api.projects.get(input)).resolves.toStrictEqual({ ok: false, error: { code: 'INVALID_REQUEST' } });
      expect(electronMocks.invoke).not.toHaveBeenCalled();
    }
  });

  it('preserves a validated code-only failure for an explicit get', async () => {
    const failure = { ok: false, error: { code: 'NOT_FOUND' } } as const;
    electronMocks.invoke.mockResolvedValueOnce(failure);

    const result = await exposedAppApi().projects.get({ projectId });

    expect(result).toStrictEqual(failure);
    expect(result).not.toBe(failure);
    expect(Object.isFrozen(result)).toBe(true);
    if (result.ok) throw new Error('Expected a code-only failure.');
    expect(Object.isFrozen(result.error)).toBe(true);
    expect(electronMocks.invoke.mock.calls).toEqual([['project:get', { projectId }]]);
  });

  it.each(['synchronous throw', 'rejected invoke', 'malformed response'] as const)(
    'returns only OPERATION_FAILED for a %s without leaking native data or retrying', async (mode) => {
      const nativeFailure = Object.assign(new Error('PRIVATE native failure'), {
        code: 'NOT_FOUND', path: 'C:\\Synthetic\\PRIVATE',
      });
      if (mode === 'synchronous throw') {
        electronMocks.invoke.mockImplementationOnce(() => { throw nativeFailure; });
      } else if (mode === 'rejected invoke') {
        electronMocks.invoke.mockRejectedValueOnce(nativeFailure);
      } else {
        electronMocks.invoke.mockResolvedValueOnce({
          ok: false, error: { code: 'NOT_FOUND', message: nativeFailure.message, path: nativeFailure.path },
        });
      }

      const result = await exposedAppApi().projects.get({ projectId });

      expect(result).toStrictEqual({ ok: false, error: { code: 'OPERATION_FAILED' } });
      expect(Object.isFrozen(result)).toBe(true);
      if (result.ok) throw new Error('Expected a code-only failure.');
      expect(Object.isFrozen(result.error)).toBe(true);
      expect(JSON.stringify(result)).not.toContain('PRIVATE');
      expect(electronMocks.invoke.mock.calls).toEqual([['project:get', { projectId }]]);
    },
  );
});
