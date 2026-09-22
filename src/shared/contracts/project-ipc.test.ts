import { describe, expect, expectTypeOf, it } from 'vitest';

import { createProjectSchema, projectIdSchema, projectSchema, updateProjectSchema, type Project, type UpdateProject } from './project.js';
import * as ipc from './project-ipc.js';

// Synthetic DTOs only: no filesystem, Main service, IPC transport or UI execution.
const projectId = 'ae45cf74-c9f9-4c49-88b9-0523b1ac7383';
const parentToken = 'd0b79d8d-61bc-47f0-a6bf-b2e65a48be91';
const parentPath = 'C:\\Projects\\親';
const saved: Project = {
  id: projectId, name: 'Project 日本語', description: '説明', taskType: 'classification',
  workspacePath: `${parentPath}\\${projectId}`,
  createdAt: '2026-09-11T00:00:00.000Z', updatedAt: '2026-09-11T00:00:00.000Z',
};
const snapshot = { project: saved, taskTypeLocked: false };
const createInput = { name: saved.name, description: saved.description, taskType: saved.taskType, parentToken };
const updateInput = { id: projectId, name: '更新後', description: '更新', taskType: 'detection' } as const;
const selected = { status: 'selected', token: parentToken, displayPath: parentPath } as const;
const moved = { ...saved, workspacePath: `D:\\Moved\\${projectId}`, updatedAt: '2026-09-11T01:00:00.000Z' };
const cleanupError = { code: 'PROJECT_SOURCE_CLEANUP_FAILED', message: ipc.PROJECT_SOURCE_CLEANUP_FAILED_MESSAGE } as const;

const objectInputs = [
  { name: 'get', schema: ipc.projectGetInputSchema, value: { projectId }, required: ['projectId'] },
  { name: 'create', schema: ipc.projectCreateInputSchema, value: createInput, required: ['name', 'taskType', 'parentToken'] },
  { name: 'update', schema: ipc.projectUpdateInputSchema, value: updateInput, required: ['id', 'name', 'description', 'taskType'] },
  { name: 'pick/create', schema: ipc.projectPickParentInputSchema, value: { purpose: 'create' }, required: ['purpose'] },
  { name: 'pick/move', schema: ipc.projectPickParentInputSchema, value: { purpose: 'move', projectId }, required: ['purpose', 'projectId'] },
  { name: 'move', schema: ipc.projectMoveInputSchema, value: { projectId, parentToken }, required: ['projectId', 'parentToken'] },
  { name: 'recover', schema: ipc.projectRecoverInputSchema, value: { projectId }, required: ['projectId'] },
] as const;
const responses = [
  { name: 'list', schema: ipc.projectListResponseSchema, value: [snapshot] },
  { name: 'get', schema: ipc.projectGetResponseSchema, value: snapshot },
  { name: 'create', schema: ipc.projectCreateResponseSchema, value: snapshot },
  { name: 'update', schema: ipc.projectUpdateResponseSchema, value: snapshot },
  { name: 'pickParent', schema: ipc.projectPickParentResponseSchema, value: selected },
  { name: 'move', schema: ipc.projectMoveResponseSchema, value: { ...snapshot, project: moved, cleanupStatus: 'completed' } },
  { name: 'recover', schema: ipc.projectRecoverResponseSchema, value: { ...snapshot, cleanupStatus: 'none' } },
] as const;

function expectInvalidSnapshot(value: Record<string, unknown>): void {
  for (const schema of [ipc.projectGetResponseSchema, ipc.projectCreateResponseSchema, ipc.projectUpdateResponseSchema]) {
    expect(schema.safeParse({ ok: true, value }).success).toBe(false);
  }
  expect(ipc.projectListResponseSchema.safeParse({ ok: true, value: [value] }).success).toBe(false);
  for (const schema of [ipc.projectMoveResponseSchema, ipc.projectRecoverResponseSchema]) {
    expect(schema.safeParse({ ok: true, value: { ...value, cleanupStatus: 'completed' } }).success).toBe(false);
  }
}

describe('Project IPC fixed API and inputs', () => {
  it('exposes nine literal channels and a readonly API without generic invoke', () => {
    expect(ipc.PROJECT_LIST_CHANNEL).toBe('project:list');
    expect(ipc.PROJECT_GET_CHANNEL).toBe('project:get');
    expect(ipc.PROJECT_CREATE_CHANNEL).toBe('project:create');
    expect(ipc.PROJECT_UPDATE_CHANNEL).toBe('project:update');
    expect(ipc.PROJECT_PICK_PARENT_CHANNEL).toBe('project:pick-parent');
    expect(ipc.PROJECT_MOVE_CHANNEL).toBe('project:move');
    expect(ipc.PROJECT_RECOVER_CHANNEL).toBe('project:recover');
    // CORE-10/REL-04 wiring: preview and delete are two separate operations.
    expect(ipc.PROJECT_DELETE_PREVIEW_CHANNEL).toBe('project:delete-preview');
    expect(ipc.PROJECT_DELETE_CHANNEL).toBe('project:delete');
    expectTypeOf<keyof ipc.ProjectApi>().toEqualTypeOf<
      'list' | 'get' | 'create' | 'update' | 'pickParent' | 'move' | 'recover' | 'deletePreview' | 'delete'>();
    expectTypeOf<ipc.ProjectApi>().toEqualTypeOf<Readonly<ipc.ProjectApi>>();
    expectTypeOf<Parameters<ipc.ProjectApi['list']>>().toEqualTypeOf<[]>();
    expectTypeOf<ipc.ProjectApi['get']>().toEqualTypeOf<(input: ipc.ProjectGetInput) => Promise<ipc.ProjectGetResponse>>();
    expectTypeOf<ipc.ProjectUpdateInput>().toEqualTypeOf<Readonly<Omit<UpdateProject, 'workspacePath'>>>();
    expectTypeOf<ipc.ProjectCreateInput['description']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<ipc.ProjectSnapshot['project']>().toEqualTypeOf<Readonly<Project>>();
    expectTypeOf<Extract<ipc.ProjectListResponse, { ok: true }>['value']>().toEqualTypeOf<readonly ipc.ProjectSnapshot[]>();
  });

  it('list takes no payload, not a path, filter or arbitrary command', () => {
    expect(ipc.projectListInputSchema.parse(undefined)).toBeUndefined();
    for (const value of [null, {}, [], parentPath, { projectId }, { command: 'delete' }]) {
      expect(ipc.projectListInputSchema.safeParse(value).success).toBe(false);
    }
  });

  it.each(objectInputs)('$name accepts only its required fields and returns a readonly copy', ({ schema, value, required }) => {
    const parsed = schema.parse(value);
    expect(parsed).toEqual(value);
    expect(parsed).not.toBe(value);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(value)).toBe(false);
    for (const field of required) {
      const missing: Record<string, unknown> = { ...value };
      delete missing[field];
      expect(schema.safeParse(missing).success).toBe(false);
    }
    for (const invalid of [null, undefined, [], parentPath, 1, false]) {
      expect(schema.safeParse(invalid).success).toBe(false);
    }
  });

  it.each(objectInputs)('$name rejects unknown fields, raw paths, directory grants and snapshots', ({ schema, value }) => {
    for (const field of [
      'unknown', 'workspacePath', 'parentPath', 'rootPath', 'destinationParent', 'receiptDirectory', 'protectedRoots',
      'directoryToken', 'token', 'displayPath', 'snapshot', 'project', 'taskTypeLocked', 'currentJob', 'selectedModel', 'capacityBytes',
    ]) {
      expect(schema.safeParse({ ...value, [field]: parentPath }).success).toBe(false);
    }
    expect(schema.safeParse({ ...value, snapshot: saved }).success).toBe(false);
    expect(schema.safeParse({ ...value, directoryToken: { token: parentToken, path: parentPath } }).success).toBe(false);
  });

  it.each(['classification', 'detection'])('reuses Unicode metadata and the description default for %s', (taskType) => {
    const name = '  Ｐroject 日本語 e\u0301 🧪\u3000';
    const legacy = createProjectSchema.parse({ name, taskType, workspacePath: parentPath });
    expect(ipc.projectCreateInputSchema.parse({ name, taskType, parentToken })).toEqual({
      name: legacy.name, description: legacy.description, taskType: legacy.taskType, parentToken,
    });
    const longName = '日本語🧪'.repeat(512);
    const description = '  説明\n改行\t  ';
    expect(ipc.projectCreateInputSchema.parse({ name: longName, description, taskType, parentToken })).toMatchObject({
      name: longName, description,
    });
    expect(ipc.projectUpdateInputSchema.parse({ ...updateInput, name: longName, description })).toMatchObject({ name: longName, description });
  });

  it.each(['', ' ', '\t\n', '\u3000', '\u00a0', null, 1])('rejects empty/non-string name %j without new limits', (name) => {
    expect(ipc.projectCreateInputSchema.safeParse({ ...createInput, name }).success).toBe(false);
    expect(ipc.projectUpdateInputSchema.safeParse({ ...updateInput, name }).success).toBe(false);
  });

  it('keeps the existing metadata validators and full-update requirement', () => {
    expect(ipc.projectCreateInputSchema.unwrap().shape.name).toBe(createProjectSchema.shape.name);
    expect(ipc.projectCreateInputSchema.unwrap().shape.description).toBe(createProjectSchema.shape.description);
    expect(ipc.projectCreateInputSchema.unwrap().shape.taskType).toBe(createProjectSchema.shape.taskType);
    expect(ipc.projectUpdateInputSchema.unwrap().shape.name).toBe(updateProjectSchema.shape.name);
    expect(ipc.projectUpdateInputSchema.unwrap().shape.description).toBe(updateProjectSchema.shape.description);
    for (const fields of [{ description: null }, { description: 1 }, { taskType: 'segmentation' }, { taskType: null }]) {
      expect(ipc.projectCreateInputSchema.safeParse({ ...createInput, ...fields }).success).toBe(false);
      expect(ipc.projectUpdateInputSchema.safeParse({ ...updateInput, ...fields }).success).toBe(false);
    }
    expect(ipc.projectUpdateInputSchema.safeParse({ id: projectId, name: 'partial' }).success).toBe(false);
    for (const fields of [{ id: projectId }, { createdAt: saved.createdAt }, { updatedAt: saved.updatedAt }]) {
      expect(ipc.projectCreateInputSchema.safeParse({ ...createInput, ...fields }).success).toBe(false);
    }
    expect(ipc.projectUpdateInputSchema.safeParse({ ...updateInput, updatedAt: saved.updatedAt }).success).toBe(false);
    const metadata = ipc.projectUpdateInputSchema.parse(updateInput);
    expect(updateProjectSchema.parse({ ...metadata, workspacePath: saved.workspacePath })).toEqual({
      ...updateInput, workspacePath: saved.workspacePath,
    });
  });

  it.each([
    { label: 'uppercase v4', id: projectId.toUpperCase() },
    { label: 'NIL', id: '00000000-0000-0000-0000-000000000000' },
    { label: 'uppercase MAX', id: 'FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF' },
    { label: 'lowercase MAX', id: 'ffffffff-ffff-ffff-ffff-ffffffffffff' },
  ])('normalizes $label consistently before legacy UUID validation', ({ id }) => {
    const canonical = projectIdSchema.parse(id.toLowerCase());
    expect(ipc.projectIpcIdSchema.parse(id)).toBe(canonical);
    expect(ipc.projectGetInputSchema.parse({ projectId: id }).projectId).toBe(canonical);
    expect(ipc.projectRecoverInputSchema.parse({ projectId: id }).projectId).toBe(canonical);
    expect(ipc.projectMoveInputSchema.parse({ projectId: id, parentToken }).projectId).toBe(canonical);
    expect(ipc.projectUpdateInputSchema.parse({ ...updateInput, id }).id).toBe(canonical);
    expect(ipc.projectPickParentInputSchema.parse({ purpose: 'move', projectId: id })).toEqual({ purpose: 'move', projectId: canonical });
    expect(ipc.projectSnapshotSchema.parse({ ...snapshot, project: { ...saved, id } }).project.id).toBe(canonical);
    expect(ipc.projectCreateInputSchema.parse({ ...createInput, parentToken: id }).parentToken).toBe(canonical);
    expect(ipc.projectParentSelectionSchema.parse({ ...selected, token: id })).toEqual({ ...selected, token: canonical });
  });

  it.each(['', 'not-a-uuid', ` ${projectId}`, `${projectId} `, 'ae45cf74-c9f9-0c49-08b9-0523b1ac7383', parentPath, null, 1])(
    'rejects invalid project identity %j', (id) => {
      expect(ipc.projectGetInputSchema.safeParse({ projectId: id }).success).toBe(false);
      expect(ipc.projectRecoverInputSchema.safeParse({ projectId: id }).success).toBe(false);
      expect(ipc.projectMoveInputSchema.safeParse({ projectId: id, parentToken }).success).toBe(false);
      expect(ipc.projectUpdateInputSchema.safeParse({ ...updateInput, id }).success).toBe(false);
      expect(ipc.projectPickParentInputSchema.safeParse({ purpose: 'move', projectId: id }).success).toBe(false);
    },
  );

  it.each(['', 'not-a-token', parentPath, null, 1, {}, { token: parentToken, path: parentPath }])(
    'rejects non-UUID parent capability %j', (token) => {
      expect(ipc.projectCreateInputSchema.safeParse({ ...createInput, parentToken: token }).success).toBe(false);
      expect(ipc.projectMoveInputSchema.safeParse({ projectId, parentToken: token }).success).toBe(false);
      expect(ipc.projectParentSelectionSchema.safeParse({ ...selected, token }).success).toBe(false);
    },
  );

  it('rejects wrong picker purposes and project bindings rather than stripping them', () => {
    for (const value of [
      {}, { purpose: 'create', projectId }, { purpose: 'create', projectId: undefined }, { purpose: 'move' },
      { purpose: 'move', projectId: null }, { purpose: 'recover', projectId }, { purpose: 'delete', projectId }, { purpose: 'CREATE' },
    ]) expect(ipc.projectPickParentInputSchema.safeParse(value).success).toBe(false);
    // A UUID-shaped token is not proof of a native selection. Actual sender,
    // purpose, snapshot, expiry and single-use checks are H's stateful tests.
    expect(ipc.projectParentTokenSchema.parse(parentToken)).toBe(parentToken);
  });
});

describe('Project IPC responses', () => {
  it.each(responses)('$name validates and freezes the success envelope and value', ({ schema, value }) => {
    const parsed = schema.parse({ ok: true, value });
    expect(parsed).toEqual({ ok: true, value });
    expect(Object.isFrozen(parsed)).toBe(true);
    if (!parsed.ok) throw new Error('Expected a success fixture');
    expect(Object.isFrozen(parsed.value)).toBe(true);
    expect(parsed.value).not.toBe(value);
  });

  it.each(responses)('$name shares code-only failures and rejects mixed or malformed envelopes', ({ schema, value }) => {
    for (const code of ['INVALID_REQUEST', 'NOT_FOUND', 'BUSY', 'OPERATION_FAILED', 'STALE_SELECTION']) {
      const result = schema.parse({ ok: false, error: { code } });
      expect(result).toEqual({ ok: false, error: { code } });
      expect(Object.isFrozen(result)).toBe(true);
      if (result.ok) throw new Error('Expected a failure fixture');
      expect(Object.isFrozen(result.error)).toBe(true);
    }
    for (const invalid of [
      null, undefined, [], {}, { value }, { ok: true }, { ok: 'true', value }, { ok: 1, value },
      { ok: true, value, extra: true }, { ok: true, value, error: { code: 'OPERATION_FAILED' } },
      { ok: false, value, error: { code: 'OPERATION_FAILED' } }, { ok: false }, { ok: false, error: null },
      { ok: false, error: {} }, { ok: false, error: { code: 'ENOENT' } }, { ok: false, error: { code: 1 } },
      { ok: false, error: { code: 'PROJECT_SOURCE_CLEANUP_FAILED' } },
      { ok: false, error: { code: 'OPERATION_FAILED', message: 'native error C:\\private' } },
      { ok: false, error: { code: 'OPERATION_FAILED', stack: 'native stack' } },
      { ok: false, error: { code: 'OPERATION_FAILED', cause: { path: parentPath } } },
      { ok: false, error: { code: 'OPERATION_FAILED' }, snapshot },
    ]) expect(schema.safeParse(invalid).success).toBe(false);
  });

  it.each([false, true])('requires the actual taskTypeLocked boolean %s in every Project response', (taskTypeLocked) => {
    const value = { project: saved, taskTypeLocked };
    for (const schema of [ipc.projectGetResponseSchema, ipc.projectCreateResponseSchema, ipc.projectUpdateResponseSchema]) {
      expect(schema.parse({ ok: true, value })).toEqual({ ok: true, value });
    }
    expect(ipc.projectListResponseSchema.parse({ ok: true, value: [value] })).toEqual({ ok: true, value: [value] });
    for (const schema of [ipc.projectMoveResponseSchema, ipc.projectRecoverResponseSchema]) {
      const moveValue = { ...value, cleanupStatus: 'none' };
      expect(schema.parse({ ok: true, value: moveValue })).toEqual({ ok: true, value: moveValue });
    }
  });

  it('rejects missing/coerced lock values, unprovided fields and malformed legacy DTOs', () => {
    expectInvalidSnapshot({ project: saved });
    expectInvalidSnapshot({ snapshot: saved, taskTypeLocked: false });
    for (const taskTypeLocked of [undefined, null, 0, 1, 'false', 'true', {}, []]) {
      expectInvalidSnapshot({ project: saved, taskTypeLocked });
    }
    for (const field of ['currentJob', 'selectedModel', 'capacityBytes', 'parentToken', 'receiptDirectory', 'snapshot', 'unknown']) {
      expectInvalidSnapshot({ ...snapshot, [field]: null });
      expectInvalidSnapshot({ ...snapshot, project: { ...saved, [field]: null } });
    }
    for (const project of [
      null, undefined, {}, { ...saved, id: 'invalid' }, { ...saved, name: '\u3000' }, { ...saved, description: null },
      { ...saved, taskType: 'segmentation' }, { ...saved, workspacePath: '' }, { ...saved, workspacePath: 'C:\\bad\0path' },
      { ...saved, createdAt: 'yesterday' }, { ...saved, updatedAt: 123 }, { ...saved, taskTypeLocked: false },
    ]) expectInvalidSnapshot({ project, taskTypeLocked: false });
  });

  it('list preserves zero or multiple real-shaped rows without accepting bare DTOs', () => {
    expect(ipc.projectListResponseSchema.parse({ ok: true, value: [] })).toEqual({ ok: true, value: [] });
    const second = { project: { ...saved, id: parentToken, workspacePath: `${parentPath}\\${parentToken}` }, taskTypeLocked: true };
    expect(ipc.projectListResponseSchema.parse({ ok: true, value: [snapshot, second] })).toEqual({ ok: true, value: [snapshot, second] });
    for (const value of [null, {}, snapshot, [saved], [snapshot, null]]) {
      expect(ipc.projectListResponseSchema.safeParse({ ok: true, value }).success).toBe(false);
    }
  });

  it('keeps native picker cancellation distinct from selection and failure', () => {
    expect(ipc.projectPickParentResponseSchema.parse({ ok: true, value: { status: 'cancelled' } })).toEqual({
      ok: true, value: { status: 'cancelled' },
    });
    expect(ipc.projectPickParentResponseSchema.parse({ ok: true, value: selected })).toEqual({ ok: true, value: selected });
    for (const value of [
      {}, { status: 'canceled' }, { status: 'cancelled', token: parentToken }, { status: 'cancelled', displayPath: parentPath },
      { status: 'selected', token: parentToken }, { status: 'selected', displayPath: parentPath },
      { ...selected, displayPath: '' }, { ...selected, displayPath: '\u3000' }, { ...selected, displayPath: 'C:\\bad\0path' },
      { ...selected, projectId }, { ...selected, purpose: 'move' }, { ...selected, snapshot: saved },
      { ...selected, directoryToken: {} }, { ...selected, path: parentPath }, { canceled: false, filePaths: [parentPath] },
    ]) expect(ipc.projectPickParentResponseSchema.safeParse({ ok: true, value }).success).toBe(false);
  });

  it.each([
    { name: 'move', schema: ipc.projectMoveResponseSchema },
    { name: 'recover', schema: ipc.projectRecoverResponseSchema },
  ])('$name preserves all F cleanup outcomes and rejects contradictory cleanup states', ({ schema }) => {
    for (const cleanupStatus of ['none', 'source-retained', 'completed']) {
      const value = { project: moved, taskTypeLocked: true, cleanupStatus };
      expect(schema.parse({ ok: true, value })).toEqual({ ok: true, value });
    }
    for (const warning of [cleanupError, { code: cleanupError.code }]) {
      const value = { project: moved, taskTypeLocked: true, cleanupStatus: 'source-retained', cleanupError: warning };
      expect(schema.parse({ ok: true, value })).toEqual({ ok: true, value });
    }
    for (const cleanupStatus of [undefined, null, 'copying', 'prepared', 'failed', 'rolled-back', true]) {
      expect(schema.safeParse({ ok: true, value: { ...snapshot, cleanupStatus } }).success).toBe(false);
    }
    for (const cleanupStatus of ['none', 'completed']) {
      for (const warning of [undefined, null, cleanupError]) {
        expect(schema.safeParse({ ok: true, value: { ...snapshot, cleanupStatus, cleanupError: warning } }).success).toBe(false);
      }
    }
    for (const warning of [
      null, {}, { code: 'ENOENT' }, { ...cleanupError, message: 'native path/stack' },
      { ...cleanupError, stack: 'native stack' }, { ...cleanupError, cause: { path: parentPath } },
    ]) {
      expect(schema.safeParse({ ok: true, value: { ...snapshot, cleanupStatus: 'source-retained', cleanupError: warning } }).success).toBe(false);
    }
    expect(schema.safeParse({ ok: true, value: { ...snapshot, cleanupStatus: 'completed', oldRoot: parentPath } }).success).toBe(false);
  });

  it('does not attach an old root to an uncertain failure or turn a cleanup warning into failure', () => {
    const uncertain = { ok: false, error: { code: 'OPERATION_FAILED' } };
    expect(ipc.projectMoveResponseSchema.parse(uncertain)).toEqual(uncertain);
    expect(ipc.projectMoveResponseSchema.safeParse({ ...uncertain, value: snapshot }).success).toBe(false);
    const current = { project: moved, taskTypeLocked: false };
    expect(ipc.projectGetResponseSchema.parse({ ok: true, value: current })).toEqual({ ok: true, value: current });
    const warning = { ...current, cleanupStatus: 'source-retained', cleanupError };
    expect(ipc.projectMoveResponseSchema.parse({ ok: true, value: warning })).toEqual({ ok: true, value: warning });
    expect(moved.workspacePath).not.toBe(parentPath);
    expect(moved.workspacePath).not.toBe(saved.workspacePath);
  });

  it('makes nested readonly copies without mutating or freezing the old DTO or its schemas', () => {
    const oldProject = { ...saved, name: '  旧Project  ' };
    const oldSnapshot = { project: oldProject, taskTypeLocked: false };
    const oldRows = [oldSnapshot];
    const result = ipc.projectListResponseSchema.parse({ ok: true, value: oldRows });
    if (!result.ok) throw new Error('Expected a success fixture');
    const row = result.value[0];
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen(row)).toBe(true);
    expect(Object.isFrozen(row.project)).toBe(true);
    expect(row.project).not.toBe(oldProject);
    expect(row.project.name).toBe('旧Project');
    expect(oldProject.name).toBe('  旧Project  ');
    expect(Object.isFrozen(oldRows)).toBe(false);
    expect(Object.isFrozen(oldSnapshot)).toBe(false);
    expect(Object.isFrozen(oldProject)).toBe(false);
    expect(Reflect.set(result.value, '0', oldSnapshot)).toBe(false);
    expect(Reflect.set(row, 'taskTypeLocked', true)).toBe(false);
    expect(Reflect.set(row.project, 'name', 'injected')).toBe(false);
    oldProject.name = 'ローカルだけ変更';
    expect(row.project.name).toBe('旧Project');

    const warning = ipc.projectMoveValueSchema.parse({ ...snapshot, cleanupStatus: 'source-retained', cleanupError });
    if (warning.cleanupStatus !== 'source-retained') throw new Error('Expected a cleanup warning fixture');
    expect(Object.isFrozen(warning.cleanupError)).toBe(true);
    expect(Object.isFrozen(cleanupError)).toBe(false);
    expect(Object.isFrozen(projectSchema.parse(saved))).toBe(false);
    expect(projectSchema.safeParse({ ...saved, taskTypeLocked: true }).success).toBe(false);
    expect(createProjectSchema.safeParse(createInput).success).toBe(false);
    expect(updateProjectSchema.safeParse(updateInput).success).toBe(false);
  });
});