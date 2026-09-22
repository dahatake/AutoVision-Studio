// @vitest-environment node
import type { IpcRenderer } from 'electron';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';

// The factory must work in Node without loading Electron or registering a bridge.
vi.mock('electron', () => { throw new Error('Project API must not load the Electron runtime.'); });

import { APP_API_CONTRACT_VERSION, APP_BRIDGE_KEY, type AppApi } from '../shared/contracts/app.js';
import type { Project } from '../shared/contracts/project.js';
import * as ipc from '../shared/contracts/project-ipc.js';
import { createProjectApi } from './project-api.js';

// Synthetic transport/DTO fixtures only; no Main service, filesystem or picker.
const projectId = 'ae45cf74-c9f9-4c49-88b9-0523b1ac7383';
const parentToken = 'd0b79d8d-61bc-47f0-a6bf-b2e65a48be91';
const privatePath = 'C:\\Synthetic\\PRIVATE';
const saved: Project = {
  id: projectId, name: 'Project 日本語', description: '説明', taskType: 'classification',
  workspacePath: `C:\\Projects\\${projectId}`,
  createdAt: '2026-09-11T00:00:00.000Z', updatedAt: '2026-09-11T00:00:00.000Z',
};
const current: Project = { ...saved, workspacePath: `D:\\Current\\${projectId}`, updatedAt: '2026-09-11T01:00:00.000Z' };
const createInput = { name: '  Project 日本語  ', taskType: 'classification', parentToken: parentToken.toUpperCase() } as const;
const updateInput = { id: projectId.toUpperCase(), name: '  更新後  ', description: '  説明\n  ', taskType: 'detection' } as const;
const selected = { status: 'selected', token: parentToken, displayPath: 'C:\\Display-only\\親' } as const;
const cleanupError = { code: 'PROJECT_SOURCE_CLEANUP_FAILED', message: ipc.PROJECT_SOURCE_CLEANUP_FAILED_MESSAGE } as const;
function snapshot(project = saved, taskTypeLocked = false) { return { project: { ...project }, taskTypeLocked }; }

const objectOperations = [
  { name: 'get', channel: 'project:get', args: [{ projectId: projectId.toUpperCase() }], forwarded: [{ projectId }],
    schema: ipc.projectGetResponseSchema, response: { ok: true, value: snapshot() },
    invalid: [{ projectId: 'invalid' }, { projectId: 1 }, { id: projectId }] },
  { name: 'create', channel: 'project:create', args: [createInput],
    forwarded: [{ name: saved.name, description: '', taskType: 'classification', parentToken }],
    schema: ipc.projectCreateResponseSchema, response: { ok: true, value: snapshot(current) },
    invalid: [{ ...createInput, name: '\u3000' }, { ...createInput, taskType: 'segmentation' },
      { ...createInput, parentToken: privatePath }, { ...createInput, parentToken: { token: parentToken, path: privatePath } },
      { ...createInput, description: null }, { name: saved.name, parentToken }] },
  { name: 'update', channel: 'project:update', args: [updateInput],
    forwarded: [{ ...updateInput, id: projectId, name: '更新後' }],
    schema: ipc.projectUpdateResponseSchema, response: { ok: true, value: snapshot(current, true) },
    invalid: [{ id: projectId, name: 'partial' }, { ...updateInput, id: 'invalid' },
      { ...updateInput, name: ' ' }, { ...updateInput, description: undefined }, { ...updateInput, taskType: 'segmentation' }] },
  { name: 'pickParent', channel: 'project:pick-parent', args: [{ purpose: 'create' }], forwarded: [{ purpose: 'create' }],
    schema: ipc.projectPickParentResponseSchema, response: { ok: true, value: selected },
    invalid: [{ purpose: 'move' }, { purpose: 'move', projectId: 'invalid' }, { purpose: 'create', projectId },
      { purpose: 'create', projectId: undefined }, { purpose: 'recover' }, { purpose: 'CREATE' }] },
  { name: 'move', channel: 'project:move', args: [{ projectId: projectId.toUpperCase(), parentToken: parentToken.toUpperCase() }],
    forwarded: [{ projectId, parentToken }],
    schema: ipc.projectMoveResponseSchema, response: { ok: true, value: { ...snapshot(current, true), cleanupStatus: 'completed' } },
    invalid: [{ projectId }, { parentToken }, { projectId: 'invalid', parentToken }, { projectId, parentToken: privatePath },
      { projectId, parentToken: { token: parentToken, path: privatePath } }] },
  { name: 'recover', channel: 'project:recover', args: [{ projectId: projectId.toUpperCase() }], forwarded: [{ projectId }],
    schema: ipc.projectRecoverResponseSchema, response: { ok: true, value: { ...snapshot(current), cleanupStatus: 'none' } },
    invalid: [{ projectId: 'invalid' }, { projectId: null }, { id: projectId }] },
] as const;
const operations = [
  { name: 'list', channel: 'project:list', args: [], forwarded: [],
    schema: ipc.projectListResponseSchema, response: { ok: true, value: [snapshot()] } },
  ...objectOperations,
] as const;

function harness(response: unknown = undefined) {
  const invoke = vi.fn<(channel: string, ...args: unknown[]) => Promise<unknown>>(async () => response);
  const transport = { invoke };
  return { invoke, transport, api: createProjectApi(transport) };
}
function call(api: Readonly<ipc.ProjectApi>, name: keyof ipc.ProjectApi, args: readonly unknown[]): Promise<unknown> {
  // Bypass static signatures to exercise hostile JS calls, including a fake receiver.
  return Reflect.apply(api[name], { channel: 'project:delete', path: privatePath }, args) as Promise<unknown>;
}
function nativeFailure() {
  return Object.assign(new Error(`PRIVATE ${privatePath}`, { cause: { path: privatePath } }), { code: 'NOT_FOUND', path: privatePath });
}
function expectFailure(value: unknown, code: ipc.ProjectIpcErrorCode): asserts value is Extract<ipc.ProjectGetResponse, { ok: false }> {
  expect(value).toStrictEqual({ ok: false, error: { code } });
  expect(Object.isFrozen(value)).toBe(true);
  if (typeof value !== 'object' || value === null || !('error' in value)) throw new Error('Expected a code-only failure');
  expect(Object.isFrozen(value.error)).toBe(true);
}

describe('Project preload fixed surface and inputs', () => {
  it('is lazy, frozen, has no inherited API and exposes exactly nine methods', () => {
    const h = harness();
    expectTypeOf(createProjectApi).toEqualTypeOf<(transport: Pick<IpcRenderer, 'invoke'>) => Readonly<ipc.ProjectApi>>();
    expectTypeOf(h.api).toEqualTypeOf<Readonly<ipc.ProjectApi>>();
    expect(Reflect.ownKeys(h.api)).toEqual(['list', 'get', 'create', 'update', 'pickParent', 'move', 'recover',
      'deletePreview', 'delete']);
    expect(Object.getPrototypeOf(h.api)).toBeNull(); expect(Object.isFrozen(h.api)).toBe(true);
    expect(Object.isFrozen(h.transport)).toBe(false); expect(h.invoke).not.toHaveBeenCalled();
    for (const key of ['constructor', '__proto__', 'toString', 'transport', 'ipcRenderer', 'invoke', 'send', 'on', 'once',
      'removeListener', 'event', 'channel', 'path', 'identity', 'preview', 'request', 'contextBridge']) {
      expect(key in h.api).toBe(false);
    }
    expect(Reflect.set(h.api, 'get', h.invoke)).toBe(false);
  });

  it('preserves the Project portion of the version-1 AppApi contract', () => {
    expect(APP_API_CONTRACT_VERSION).toBe(1); expect(APP_BRIDGE_KEY).toBe('autoVision');
    // The entry test owns the complete bridge allowlist. Independent diagnostics
    // must not change or expand the seven-method Project factory surface here.
    expectTypeOf<Pick<AppApi, 'contractVersion' | 'projects'>>()
      .toEqualTypeOf<Readonly<{ contractVersion: 1; projects: ipc.ProjectApi }>>();
    expectTypeOf<AppApi['projects']>().toEqualTypeOf<ipc.ProjectApi>();
  });

  it.each(operations)('$name invokes only its literal channel and parsed arguments, returning its exact response', async (op) => {
    const h = harness(op.response); const pending = call(h.api, op.name, op.args);
    expect(pending).toBeInstanceOf(Promise);
    expect(h.invoke.mock.calls).toEqual([[op.channel, ...op.forwarded]]);
    const result = await pending;
    expect(result).toEqual(op.response); expect(result).not.toBe(op.response);
    expect(Object.isFrozen(result)).toBe(true); expect(op.schema.safeParse(result).success).toBe(true);
    expect(h.invoke).toHaveBeenCalledOnce();
  });

  it.each(operations)('$name rejects missing/extra arguments, including explicit undefined, without invoking', async (op) => {
    const invalidArgs: readonly unknown[][] = op.name === 'list'
      ? [[undefined], [null], [{}], [privatePath], [undefined, undefined]]
      : [[], [op.args[0], undefined], [op.args[0], null], [op.args[0], {}], [op.args[0], op.args[0]]];
    for (const args of invalidArgs) {
      const h = harness(op.response); const result = await call(h.api, op.name, args);
      expectFailure(result, 'INVALID_REQUEST'); expect(op.schema.safeParse(result).success).toBe(true);
      expect(h.invoke).not.toHaveBeenCalled();
    }
  });

  it.each(objectOperations)('$name rejects wrong types and operation-specific schema failures before invoking', async (op) => {
    for (const input of [undefined, null, false, 1, 1n, Symbol('PRIVATE'), privatePath, [], {}, () => undefined, ...op.invalid]) {
      const h = harness(op.response); const result = await call(h.api, op.name, [input]);
      expectFailure(result, 'INVALID_REQUEST'); expect(op.schema.safeParse(result).success).toBe(true);
      expect(h.invoke).not.toHaveBeenCalled();
    }
  });

  it.each(objectOperations)('$name rejects injected paths, identities, channels and snapshots rather than stripping them', async (op) => {
    for (const field of ['workspacePath', 'parentPath', 'rootPath', 'destinationParent', 'path', 'displayPath', 'identity',
      'directoryToken', 'receiptDirectory', 'protectedRoots', 'snapshot', 'project', 'taskTypeLocked',
      'channel', 'event', 'sender', 'transport', '__proto__', 'constructor', 'unknown']) {
      for (const value of [privatePath, undefined]) {
        const input = { ...op.args[0], [field]: value }; const h = harness(op.response);
        expectFailure(await call(h.api, op.name, [input]), 'INVALID_REQUEST');
        expect(h.invoke).not.toHaveBeenCalled(); expect(Object.isFrozen(input)).toBe(false);
        expect(Object.hasOwn(input, field)).toBe(true);
      }
    }
  });

  it.each(objectOperations)('$name snapshots its parsed payload and tokens before any await without changing the original', async (op) => {
    const input: Record<string, unknown> = { ...op.args[0] }; const before = { ...input };
    const deferred = Promise.withResolvers<unknown>(); const h = harness(); h.invoke.mockReturnValue(deferred.promise);
    const pending = call(h.api, op.name, [input]);
    expect(h.invoke.mock.calls).toEqual([[op.channel, ...op.forwarded]]);
    const forwarded = h.invoke.mock.calls[0]![1];
    expect(forwarded).not.toBe(input); expect(Object.isFrozen(forwarded)).toBe(true);
    expect(input).toEqual(before); expect(Object.isFrozen(input)).toBe(false);
    for (const key of Object.keys(input)) input[key] = 'CHANGED';
    input.workspacePath = privatePath;
    expect(h.invoke.mock.calls).toEqual([[op.channel, ...op.forwarded]]);
    deferred.resolve(op.response); await expect(pending).resolves.toEqual(op.response);
    expect(h.invoke).toHaveBeenCalledOnce();
  });

  it.each(objectOperations)('$name sanitizes a throwing input getter as INVALID_REQUEST without invoking', async (op) => {
    const input = { ...op.args[0] };
    Object.defineProperty(input, Object.keys(input)[0]!, { enumerable: true, get() { throw nativeFailure(); } });
    const h = harness(op.response);
    expectFailure(await call(h.api, op.name, [input]), 'INVALID_REQUEST'); expect(h.invoke).not.toHaveBeenCalled();
  });

  it.each(['create', 'move'] as const)('forwards only the parsed native-picker token for %s, never displayPath as authority', async (purpose) => {
    const nativeSelection: { status: 'selected'; token: string; displayPath: string } = { ...selected, token: parentToken.toUpperCase() };
    const h = harness();
    h.invoke.mockResolvedValueOnce({ ok: true, value: nativeSelection }).mockResolvedValueOnce({ ok: false, error: { code: 'STALE_SELECTION' } });
    const choice = await h.api.pickParent(purpose === 'create' ? { purpose } : { purpose, projectId: projectId.toUpperCase() });
    expect(choice).toEqual({ ok: true, value: selected });
    if (!choice.ok || choice.value.status !== 'selected') throw new Error('Expected a native-selection fixture');
    expect(choice.value).not.toBe(nativeSelection); expect(Object.isFrozen(choice.value)).toBe(true);
    expect(nativeSelection.token).toBe(parentToken.toUpperCase()); expect(Object.isFrozen(nativeSelection)).toBe(false);
    nativeSelection.displayPath = privatePath; nativeSelection.token = projectId;
    expect(choice.value).toEqual(selected);
    const result = purpose === 'create'
      ? await h.api.create({ ...createInput, parentToken: choice.value.token })
      : await h.api.move({ projectId, parentToken: choice.value.token });
    expectFailure(result, 'STALE_SELECTION');
    expect(h.invoke.mock.calls).toEqual([
      ['project:pick-parent', purpose === 'create' ? { purpose } : { purpose, projectId }],
      purpose === 'create' ? ['project:create', { name: saved.name, description: '', taskType: 'classification', parentToken }]
        : ['project:move', { projectId, parentToken }],
    ]);
  });

  it('preserves picker cancellation as its own success value, without selection or automatic work', async () => {
    const raw = { ok: true, value: { status: 'cancelled' } }; const h = harness(raw);
    const result = await h.api.pickParent({ purpose: 'create' });
    expect(result).toEqual(raw); if (!result.ok) throw new Error('Expected cancellation');
    expect(Object.isFrozen(result.value)).toBe(true); expect(result.value).not.toBe(raw.value);
    expect(h.invoke.mock.calls).toEqual([['project:pick-parent', { purpose: 'create' }]]);
  });
});

describe('Project preload response boundary', () => {
  it.each(operations)('$name preserves all code-only failures, including BUSY/NOT_FOUND, without raising or faking success', async (op) => {
    for (const code of ['INVALID_REQUEST', 'NOT_FOUND', 'BUSY', 'OPERATION_FAILED', 'STALE_SELECTION'] as const) {
      const raw = { ok: false, error: { code } }; const h = harness(raw);
      const result = await call(h.api, op.name, op.args);
      expectFailure(result, code); expect(op.schema.safeParse(result).success).toBe(true);
      expect(result).not.toBe(raw); expect(result.error).not.toBe(raw.error);
      expect(Object.isFrozen(raw)).toBe(false); expect(Object.isFrozen(raw.error)).toBe(false);
      expect(h.invoke).toHaveBeenCalledOnce();
    }
  });

  it.each(operations)('$name sanitizes synchronous throws and promise rejections, ignoring native codes/messages/causes', async (op) => {
    for (const error of [nativeFailure(), { code: 'BUSY', message: privatePath, stack: 'PRIVATE stack', cause: { path: privatePath } }, privatePath, null]) {
      for (const synchronous of [false, true]) {
        const h = harness();
        if (synchronous) h.invoke.mockImplementation(() => { throw error; }); else h.invoke.mockRejectedValue(error);
        const result = await call(h.api, op.name, op.args);
        expectFailure(result, 'OPERATION_FAILED'); expect(op.schema.safeParse(result).success).toBe(true);
        expect(JSON.stringify(result)).not.toContain('PRIVATE');
        expect(h.invoke.mock.calls).toEqual([[op.channel, ...op.forwarded]]);
      }
    }
  });

  it.each(operations)('$name sanitizes malformed/mixed envelopes and throwing responses without leaking validation data', async (op) => {
    const throwing = Object.defineProperty({}, 'ok', { enumerable: true, get() { throw nativeFailure(); } });
    const invalid: unknown[] = [null, undefined, [], {}, privatePath, false, 1, { ok: true }, { ok: false },
      { ok: 'true', value: op.response.value }, { ok: false, error: null }, { ok: false, error: {} },
      { ok: false, error: { code: 'ENOENT' } }, { ok: false, error: { code: 1 } },
      { ok: false, error: { code: 'PROJECT_SOURCE_CLEANUP_FAILED' } },
      { ...op.response, unknown: undefined }, { ...op.response, error: { code: 'BUSY' } },
      { ok: false, error: { code: 'NOT_FOUND' }, value: op.response.value },
      { ok: false, error: { code: 'OPERATION_FAILED' }, snapshot: snapshot() }, throwing];
    for (const field of ['message', 'stack', 'cause', 'path', 'identity']) {
      invalid.push({ ok: false, error: { code: 'NOT_FOUND', [field]: privatePath } });
    }
    for (const raw of invalid) {
      const h = harness(raw); const result = await call(h.api, op.name, op.args);
      expectFailure(result, 'OPERATION_FAILED'); expect(JSON.stringify(result)).not.toContain('PRIVATE');
      expect(h.invoke).toHaveBeenCalledOnce();
    }
  });

  it.each(operations)('$name uses its own success codec and rejects missing, extra or malformed nested fields', async (op) => {
    const badSnapshots = [{ project: saved }, { ...snapshot(), taskTypeLocked: 0 }, { ...snapshot(), taskTypeLocked: 'false' },
      { ...snapshot(), unknown: undefined }, { ...snapshot(), identity: privatePath },
      { ...snapshot(), project: { ...saved, identity: privatePath } }, { ...snapshot(), project: { ...saved, id: 'invalid' } },
      { ...snapshot(), project: { ...saved, workspacePath: '' } }, { ...snapshot(), project: { ...saved, description: null } },
      { ...snapshot(), project: { ...saved, taskType: 'segmentation' } }, { ...snapshot(), project: { ...saved, createdAt: 'yesterday' } }];
    let values: unknown[];
    if (op.name === 'list') {
      values = [snapshot(), [saved], [snapshot(), null], ...badSnapshots.map((value) => [value])];
    } else if (op.name === 'pickParent') {
      values = [snapshot(), [snapshot()], { status: 'canceled' }, { status: 'selected', token: parentToken },
        { status: 'selected', displayPath: selected.displayPath }, { status: 'cancelled', token: parentToken },
        { status: 'cancelled', displayPath: selected.displayPath }, { ...selected, token: privatePath },
        ...['', '\u3000', 'C:\\bad\0path'].map((displayPath) => ({ ...selected, displayPath })),
        ...['path', 'identity', 'directoryToken', 'snapshot', 'purpose', 'projectId', 'filePaths'].map((field) => ({ ...selected, [field]: privatePath }))];
    } else {
      const moving = op.name === 'move' || op.name === 'recover';
      values = [[snapshot()], saved, selected, ...badSnapshots.map((value) => moving ? { ...value, cleanupStatus: 'completed' } : value),
        moving ? snapshot() : { ...snapshot(), cleanupStatus: 'completed' }];
    }
    for (const value of [null, undefined, {}, ...values]) {
      const h = harness({ ok: true, value });
      expectFailure(await call(h.api, op.name, op.args), 'OPERATION_FAILED'); expect(h.invoke).toHaveBeenCalledOnce();
    }
  });

  it.each(['move', 'recover'] as const)('%s preserves every cleanup outcome, warning and current DB root without changing native objects', async (name) => {
    const outcomes = [{ cleanupStatus: 'none' }, { cleanupStatus: 'completed' }, { cleanupStatus: 'source-retained' },
      { cleanupStatus: 'source-retained', cleanupError: { code: 'PROJECT_SOURCE_CLEANUP_FAILED' } },
      { cleanupStatus: 'source-retained', cleanupError: { ...cleanupError } }] as const;
    for (const outcome of outcomes) {
      const raw = { ok: true, value: { ...snapshot(current, true), ...outcome } }; const h = harness(raw);
      const result = name === 'move' ? await h.api.move({ projectId, parentToken }) : await h.api.recover({ projectId });
      expect(result).toEqual(raw); if (!result.ok) throw new Error('Expected a cleanup success fixture');
      expect(result.value.project.workspacePath).toBe(current.workspacePath);
      expect(result.value.taskTypeLocked).toBe(true); expect(result.value.cleanupStatus).toBe(outcome.cleanupStatus);
      expect(Object.isFrozen(result.value)).toBe(true); expect(Object.isFrozen(result.value.project)).toBe(true);
      expect(result.value.project).not.toBe(raw.value.project); expect(Object.isFrozen(raw.value.project)).toBe(false);
      if (result.value.cleanupStatus === 'source-retained' && result.value.cleanupError !== undefined && 'cleanupError' in outcome) {
        expect(Object.isFrozen(result.value.cleanupError)).toBe(true); expect(result.value.cleanupError).not.toBe(outcome.cleanupError);
        expect(Object.isFrozen(outcome.cleanupError)).toBe(false);
        expect(Reflect.set(result.value.cleanupError, 'message', privatePath)).toBe(false);
      }
      raw.value.project.workspacePath = privatePath;
      expect(result.value.project.workspacePath).toBe(current.workspacePath); expect(h.invoke).toHaveBeenCalledOnce();
    }
  });

  it.each(['move', 'recover'] as const)('%s rejects contradictory cleanup states and native warning extras instead of stripping them', async (name) => {
    const values = [{ ...snapshot(current), cleanupStatus: 'failed' },
      { ...snapshot(current), cleanupStatus: 'none', cleanupError: undefined },
      { ...snapshot(current), cleanupStatus: 'completed', cleanupError },
      ...[null, {}, { code: 'ENOENT' }, { ...cleanupError, message: privatePath }, { ...cleanupError, stack: privatePath },
        { ...cleanupError, cause: { path: privatePath } }].map((warning) => ({ ...snapshot(current), cleanupStatus: 'source-retained', cleanupError: warning }))];
    for (const value of values) {
      const h = harness({ ok: true, value });
      const result = name === 'move' ? await h.api.move({ projectId, parentToken }) : await h.api.recover({ projectId });
      expectFailure(result, 'OPERATION_FAILED'); expect(h.invoke).toHaveBeenCalledOnce();
    }
  });

  it('returns detached readonly list/row/Project copies without freezing or normalizing the transport originals', async () => {
    const project = { ...saved, id: projectId.toUpperCase(), name: '  元の名前  ' };
    const row = { project, taskTypeLocked: true }; const rows = [row]; const raw = { ok: true, value: rows };
    const result = await harness(raw).api.list();
    if (!result.ok) throw new Error('Expected a list fixture');
    const returned = result.value[0]!;
    expect(returned).toEqual({ project: { ...saved, name: '元の名前' }, taskTypeLocked: true });
    expect(result.value).not.toBe(rows); expect(returned).not.toBe(row); expect(returned.project).not.toBe(project);
    for (const value of [result, result.value, returned, returned.project]) expect(Object.isFrozen(value)).toBe(true);
    for (const value of [raw, rows, row, project]) expect(Object.isFrozen(value)).toBe(false);
    expect(project.id).toBe(projectId.toUpperCase()); expect(project.name).toBe('  元の名前  ');
    expect(Reflect.set(result, 'ok', false)).toBe(false); expect(Reflect.set(result.value, '0', row)).toBe(false);
    expect(Reflect.set(returned, 'taskTypeLocked', false)).toBe(false); expect(Reflect.set(returned.project, 'name', 'injected')).toBe(false);
    project.name = 'CHANGED'; project.workspacePath = privatePath; row.taskTypeLocked = false; rows.length = 0; raw.ok = false;
    expect(result.ok).toBe(true); expect(result.value).toHaveLength(1);
    expect(returned).toEqual({ project: { ...saved, name: '元の名前' }, taskTypeLocked: true });
  });

  it.each(['get', 'create', 'update', 'move', 'recover'] as const)('%s detaches and freezes nested Project fields, not just the envelope', async (name) => {
    const op = objectOperations.find((operation) => operation.name === name)!;
    const project = { ...current, name: '  現在の名前  ' };
    const raw = { ok: true, value: { project, taskTypeLocked: true,
      ...(name === 'move' || name === 'recover' ? { cleanupStatus: 'none' } : {}) } };
    const result = await call(harness(raw).api, name, op.args) as ipc.ProjectGetResponse;
    if (!result.ok) throw new Error('Expected a Project fixture');
    expect(result.value.project).toEqual({ ...current, name: '現在の名前' });
    expect(result.value).not.toBe(raw.value); expect(result.value.project).not.toBe(project);
    expect(Object.isFrozen(result.value)).toBe(true); expect(Object.isFrozen(result.value.project)).toBe(true);
    expect(Object.isFrozen(raw.value)).toBe(false); expect(Object.isFrozen(project)).toBe(false);
    expect(project.name).toBe('  現在の名前  '); expect(Reflect.set(result.value.project, 'workspacePath', privatePath)).toBe(false);
    project.name = 'CHANGED'; project.workspacePath = privatePath; raw.value.taskTypeLocked = false;
    expect(result.value.project).toEqual({ ...current, name: '現在の名前' }); expect(result.value.taskTypeLocked).toBe(true);
  });

  it('returns an empty list only when received, and preserves multiple rows and actual lock states', async () => {
    const rows = [snapshot(), snapshot({ ...current, id: parentToken, workspacePath: `D:\\Current\\${parentToken}` }, true)];
    const h = harness();
    h.invoke.mockResolvedValueOnce({ ok: true, value: [] }).mockResolvedValueOnce({ ok: true, value: rows });
    await expect(h.api.list()).resolves.toEqual({ ok: true, value: [] });
    await expect(h.api.list()).resolves.toEqual({ ok: true, value: rows });
    expect(h.invoke.mock.calls).toEqual([['project:list'], ['project:list']]);
  });

  it('does not cache, coalesce or cross-wire concurrent requests with out-of-order results', async () => {
    const first = Promise.withResolvers<unknown>(); const second = Promise.withResolvers<unknown>(); const h = harness();
    h.invoke.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const oldRead = h.api.get({ projectId }); const newRead = h.api.get({ projectId });
    expect(oldRead).not.toBe(newRead); expect(h.invoke.mock.calls).toEqual([['project:get', { projectId }], ['project:get', { projectId }]]);
    second.resolve({ ok: true, value: snapshot(current, true) });
    await expect(newRead).resolves.toEqual({ ok: true, value: snapshot(current, true) });
    first.resolve({ ok: true, value: snapshot() });
    await expect(oldRead).resolves.toEqual({ ok: true, value: snapshot() }); expect(h.invoke).toHaveBeenCalledTimes(2);
  });

  it('does not retry an unacknowledged create or infer rollback; list is a separate explicit call', async () => {
    const h = harness(); h.invoke.mockRejectedValueOnce(nativeFailure()).mockResolvedValueOnce({ ok: true, value: [snapshot(current)] });
    expectFailure(await h.api.create(createInput), 'OPERATION_FAILED');
    expect(h.invoke.mock.calls).toEqual([['project:create', { name: saved.name, description: '', taskType: 'classification', parentToken }]]);
    await expect(h.api.list()).resolves.toEqual({ ok: true, value: [snapshot(current)] });
    expect(h.invoke).toHaveBeenCalledTimes(2); expect(h.invoke.mock.calls[1]).toEqual(['project:list']);
  });

  it.each(['move', 'recover'] as const)('does not substitute an old snapshot after uncertain %s; get remains explicit', async (name) => {
    const h = harness(); h.invoke.mockResolvedValueOnce({ ok: true, value: snapshot() })
      .mockResolvedValueOnce({ ok: false, error: { code: 'OPERATION_FAILED' } })
      .mockResolvedValueOnce({ ok: true, value: snapshot(current, true) });
    await expect(h.api.get({ projectId })).resolves.toEqual({ ok: true, value: snapshot() });
    const result = name === 'move' ? await h.api.move({ projectId, parentToken }) : await h.api.recover({ projectId });
    expectFailure(result, 'OPERATION_FAILED'); expect(h.invoke).toHaveBeenCalledTimes(2);
    await expect(h.api.get({ projectId })).resolves.toEqual({ ok: true, value: snapshot(current, true) });
    expect(h.invoke.mock.calls).toEqual([['project:get', { projectId }],
      name === 'move' ? ['project:move', { projectId, parentToken }] : ['project:recover', { projectId }], ['project:get', { projectId }]]);
  });
});