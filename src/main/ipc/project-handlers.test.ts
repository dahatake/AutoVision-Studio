// @vitest-environment node
import type {
  BaseWindow, Dialog, IpcMain, IpcMainInvokeEvent, OpenDialogOptions, OpenDialogReturnValue,
  WebContents, WebContentsDidStartNavigationEventParams, WebFrameMain,
} from 'electron';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import asyncFs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, parse } from 'node:path';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import type { Project } from '../../shared/contracts/project.js';
import {
  PROJECT_CREATE_CHANNEL, PROJECT_GET_CHANNEL, PROJECT_LIST_CHANNEL, PROJECT_MOVE_CHANNEL,
  PROJECT_PICK_PARENT_CHANNEL, PROJECT_RECOVER_CHANNEL, PROJECT_SOURCE_CLEANUP_FAILED_MESSAGE, PROJECT_UPDATE_CHANNEL,
  projectCreateResponseSchema, projectGetResponseSchema, projectListResponseSchema, projectMoveResponseSchema,
  projectPickParentResponseSchema, projectRecoverResponseSchema, projectUpdateResponseSchema,
  type ProjectIpcErrorCode, type ProjectPickParentInput, type ProjectUpdateInput,
} from '../../shared/contracts/project-ipc.js';
import { openDatabase, type DatabaseConnection } from '../db/database.js';
import { migrateDatabase } from '../db/migrate.js';
import { verifyProjectDirectory } from '../projects/project-directory.js';
import { insertProject, lockProjectTaskType } from '../projects/project-repository.js';
import { createProject, getProject, getProjects } from '../projects/project-service.js';
import { registerProjectHandlers } from './project-handlers.js';

const sql = fs.readFileSync(new URL('../db/migrations/001_core.sql', import.meta.url), 'utf8');
const rendererURL = 'file:///C:/Synthetic/app/index.html';
const unusedId = 'ae45cf74-c9f9-4c49-88b9-0523b1ac7383';
const unusedToken = 'd0b79d8d-61bc-47f0-a6bf-b2e65a48be91';
const markerName = '.autovision-project.json';
const metadata = { name: 'Project 日本語', taskType: 'classification' } as const;
const failure = (code: ProjectIpcErrorCode) => ({ ok: false, error: { code } });
const requests = [
  { channel: PROJECT_LIST_CHANNEL, args: [] },
  { channel: PROJECT_GET_CHANNEL, args: [{ projectId: unusedId }] },
  { channel: PROJECT_CREATE_CHANNEL, args: [{ ...metadata, parentToken: unusedToken }] },
  { channel: PROJECT_UPDATE_CHANNEL, args: [{ ...metadata, id: unusedId, description: '' }] },
  { channel: PROJECT_PICK_PARENT_CHANNEL, args: [{ purpose: 'create' }] },
  { channel: PROJECT_MOVE_CHANNEL, args: [{ projectId: unusedId, parentToken: unusedToken }] },
  { channel: PROJECT_RECOVER_CHANNEL, args: [{ projectId: unusedId }] },
] as const;
let directory: string;
let parent: string;
let destination: string;
let original: string;
let receiptDirectory: string;
let database: DatabaseConnection;
let bindings: ReturnType<typeof registerProjectHandlers>[];

function newFrame(url = rendererURL) {
  const state = { url };
  return { state, frame: state as WebFrameMain };
}
function harness(expectedURL = rendererURL) {
  // Only native Electron boundaries are asserted. Services and filesystem/SQLite
  // stay real; no native dialog, BrowserWindow or app startup runs in this suite.
  const { state: frameState, frame } = newFrame();
  const getURL = vi.fn(() => rendererURL);
  const isDestroyed = vi.fn(() => false);
  const contentsState = Object.assign(new EventEmitter(), { id: 7, mainFrame: frame, getURL, isDestroyed });
  const contents = contentsState as unknown as WebContents;
  const eventState: { sender: WebContents; senderFrame: WebFrameMain | null } = { sender: contents, senderFrame: frame };
  const event = eventState as IpcMainInvokeEvent;
  const handlers = new Map<string, Parameters<IpcMain['handle']>[1]>();
  const handle = vi.fn<IpcMain['handle']>((channel, listener) => {
    if (handlers.has(channel)) throw new Error('already registered');
    handlers.set(channel, listener);
  });
  const removeHandler = vi.fn<IpcMain['removeHandler']>((channel) => { handlers.delete(channel); });
  // Accept both Electron 44 overloads without casting the mock to Dialog.
  const showOpenDialog = vi.fn<(options: OpenDialogOptions | BaseWindow, secondary?: OpenDialogOptions) => Promise<OpenDialogReturnValue>>()
    .mockResolvedValue({ canceled: false, filePaths: [parent] });
  const nativeDialog: Pick<Dialog, 'showOpenDialog'> = { showOpenDialog };
  const trustedMain = { receiptDirectory, protectedRoots: [original] };
  const ipcMain = { handle, removeHandler };
  const binding = registerProjectHandlers(ipcMain, contents, expectedURL, database, trustedMain, nativeDialog);
  bindings.push(binding);
  // Retain callbacks separately to test that even an already-captured callback
  // is inert after disposal, not merely absent from the mock's registration map.
  const captured = new Map(handlers);
  const dispatch = (channel: string, ...args: unknown[]): Promise<unknown> => {
    const listener = captured.get(channel);
    if (!listener) throw new Error('Unknown test channel');
    return Promise.resolve(listener(event, ...args));
  };
  return { frame, frameState, contents, contentsState, eventState, getURL, isDestroyed,
    handlers, handle, removeHandler, ipcMain, showOpenDialog, nativeDialog, trustedMain, binding, dispatch };
}
type Harness = ReturnType<typeof harness>;
function navigation(h: Harness, isSameDocument = false, isMainFrame = true): void {
  const details: WebContentsDidStartNavigationEventParams = { url: h.frameState.url, isSameDocument, isMainFrame, frame: h.frame };
  h.contentsState.emit('did-start-navigation', details);
}
async function pick(h: Harness, input: ProjectPickParentInput = { purpose: 'create' }) {
  const response = projectPickParentResponseSchema.parse(await h.dispatch(PROJECT_PICK_PARENT_CHANNEL, input));
  if (!response.ok || response.value.status !== 'selected') throw new Error('Expected a selected test parent');
  return response.value;
}
async function pickMove(h: Harness, project: Project) {
  h.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [destination] });
  return pick(h, { purpose: 'move', projectId: project.id });
}
function seed(name = '既存Project'): Project {
  return createProject(database, { name, taskType: 'classification', workspacePath: parent });
}
function edit(project: Project, overrides: Partial<ProjectUpdateInput> = {}): ProjectUpdateInput {
  return { id: project.id, name: project.name, description: project.description, taskType: project.taskType, ...overrides };
}
function lock(project: Project): void {
  database.exec('BEGIN IMMEDIATE');
  lockProjectTaskType(database, project.id);
  database.exec('COMMIT');
}

// The retained-parent race stops before copy. All files, SQLite and receipts
// live in one mkdtemp.
describe.skipIf(process.platform !== 'win32')('CORE-07H Project IPC boundary', () => {
  beforeEach(() => {
    bindings = [];
    directory = fs.realpathSync.native(fs.mkdtempSync(join(tmpdir(), 'autovision-core07h-')));
    parent = join(directory, 'Parent 日本語');
    destination = join(directory, 'Destination');
    original = join(directory, 'Original');
    receiptDirectory = join(directory, 'app-data', 'project-moves');
    for (const path of [parent, destination, original, receiptDirectory]) fs.mkdirSync(path, { recursive: true });
    database = openDatabase(join(directory, 'metadata.sqlite3'));
    migrateDatabase(database, [{ version: 1, sql }]);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    for (const binding of bindings) binding.dispose();
    if (database.open) database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('explicitly registers exactly seven operations and disposes only its handlers/listeners once', async () => {
    const query = vi.spyOn(database, 'prepare');
    const h = harness();
    expectTypeOf<ReturnType<typeof registerProjectHandlers>>().toEqualTypeOf<{ dispose(): void }>();
    expectTypeOf<Parameters<typeof registerProjectHandlers>[5]>().toEqualTypeOf<Pick<Dialog, 'showOpenDialog'>>();
    expectTypeOf<Parameters<typeof createProject>[2]>().toEqualTypeOf<readonly string[] | undefined>();
    expect(h.handle.mock.calls.map(([channel]) => channel)).toEqual(requests.map(({ channel }) => channel));
    expect(query).not.toHaveBeenCalled();
    expect(h.showOpenDialog).not.toHaveBeenCalled();
    expect(Object.isFrozen(h.binding)).toBe(true);
    for (const event of ['did-start-navigation', 'render-process-gone', 'destroyed']) expect(h.contentsState.listenerCount(event)).toBe(1);
    const observer = vi.fn();
    h.contentsState.on('did-start-navigation', observer);
    h.binding.dispose(); h.binding.dispose();
    expect(h.removeHandler.mock.calls).toEqual(requests.map(({ channel }) => [channel]));
    expect(h.handlers.size).toBe(0);
    expect(h.contentsState.listeners('did-start-navigation')).toEqual([observer]);
    expect(h.contentsState.listenerCount('render-process-gone')).toBe(0);
    expect(h.contentsState.listenerCount('destroyed')).toBe(0);
    for (const { channel, args } of requests) await expect(h.dispatch(channel, ...args)).resolves.toEqual(failure('INVALID_REQUEST'));
    expect(query).not.toHaveBeenCalled();
    expect(h.showOpenDialog).not.toHaveBeenCalled();
  });

  it('adversarial review: validates Main-only create protected roots before I/O and accepts readonly configuration', () => {
    const input = { ...metadata, workspacePath: parent };
    const before = fs.readdirSync(directory, { recursive: true }).sort();
    const query = vi.spyOn(database, 'prepare'); const exec = vi.spyOn(database, 'exec');
    const inspect = vi.spyOn(fs, 'lstatSync'); const mkdir = vi.spyOn(fs, 'mkdirSync');
    for (const value of [null, false, 42, original, { roots: [original] }, { 0: original, length: 1 }, new Array<string>(1)]) {
      expect(() => createProject(database, input, value as never)).toThrow(TypeError);
    }
    for (const value of [undefined, null, 42, {}, [], '', 'relative', 'C:relative', '\\root-relative', parse(directory).root,
      `${original}\\bad\0name`, `${original}\\NUL`, `${original}\\bad*name`, `${original}\\bad:stream`, `${original} `, `\\\\?\\${original}`]) {
      expect(() => createProject(database, input, Object.freeze([original, value]) as never)).toThrow(TypeError);
    }
    for (const operation of [query, exec, inspect, mkdir]) expect(operation).not.toHaveBeenCalled();
    expect(database.inTransaction).toBe(false);
    expect(getProjects(database)).toEqual([]);
    expect(fs.readdirSync(directory, { recursive: true }).sort()).toEqual(before);

    const protectedRoots: readonly string[] = Object.freeze([original, receiptDirectory]);
    const created = createProject(database, input, protectedRoots);
    expect(created.workspacePath).toBe(join(parent, created.id));
    expect(verifyProjectDirectory(created.workspacePath, created.id).rootPath).toBe(created.workspacePath);
    expect(getProjects(database)).toEqual([created]);
    expect(protectedRoots).toEqual([original, receiptDirectory]);
    for (const root of protectedRoots) expect(fs.readdirSync(root, { recursive: true })).toEqual([]);
    expect(database.inTransaction).toBe(false);
  });

  it('unwinds a partial registration but never removes the conflicting or unrelated owner', () => {
    const h = harness(); h.binding.dispose();
    const observer = vi.fn(); h.contentsState.on('did-start-navigation', observer);
    const foreign = vi.fn<Parameters<IpcMain['handle']>[1]>();
    for (const index of [0, 3, 6]) {
      h.handlers.clear(); h.handle.mockClear(); h.removeHandler.mockClear();
      const conflict = requests[index]!.channel;
      h.handlers.set(conflict, foreign); h.handlers.set('unrelated:owned', foreign);
      expect(() => registerProjectHandlers(h.ipcMain, h.contents, rendererURL, database, h.trustedMain, h.nativeDialog)).toThrow('already registered');
      expect(h.removeHandler.mock.calls).toEqual(requests.slice(0, index).map(({ channel }) => [channel]));
      expect([...h.handlers.keys()]).toEqual([conflict, 'unrelated:owned']);
      expect(h.handlers.get(conflict)).toBe(foreign);
      expect(h.contentsState.listeners('did-start-navigation')).toEqual([observer]);
      expect(h.contentsState.listenerCount('render-process-gone')).toBe(0);
      expect(h.contentsState.listenerCount('destroyed')).toBe(0);
    }
  });

  it('refuses invalid expected file URLs before registering anything', () => {
    const h = harness(); h.binding.dispose(); h.handle.mockClear(); h.removeHandler.mockClear();
    for (const url of ['', 'not a URL', 'https://example.invalid', 'file://server/share/app.html',
      `${rendererURL}?`, `${rendererURL}?query=1`, 'file:///C:/%ZZ.html', 'file:///C:/%00.html']) {
      expect(() => registerProjectHandlers(h.ipcMain, h.contents, url, database, h.trustedMain, h.nativeDialog)).toThrow('INVALID_REQUEST');
    }
    expect(h.handle).not.toHaveBeenCalled(); expect(h.removeHandler).not.toHaveBeenCalled();
    expect(h.contentsState.eventNames()).toEqual([]);
  });

  it.each(requests)('$channel rejects bad arity and unknown/raw-path payloads before DB, filesystem or dialog access', async ({ channel, args }) => {
    const h = harness(); const query = vi.spyOn(database, 'prepare'); const inspect = vi.spyOn(fs, 'lstatSync');
    const invalidArgs: unknown[][] = channel === PROJECT_LIST_CHANNEL
      ? [[undefined], [null], [{}], [undefined, undefined]] : [[], [undefined], [null], [...args, undefined]];
    if (channel !== PROJECT_LIST_CHANNEL) {
      const input = args[0];
      if (typeof input !== 'object' || input === null) throw new Error('Expected object test input');
      for (const field of ['workspacePath', 'displayPath', 'receiptDirectory', 'protectedRoots', 'snapshot',
        'taskTypeLocked', 'currentJob', 'selectedModel', 'capacityBytes', 'command', 'unknown']) {
        invalidArgs.push([{ ...input, [field]: parent }]);
      }
    }
    for (const payload of invalidArgs) await expect(h.dispatch(channel, ...payload)).resolves.toEqual(failure('INVALID_REQUEST'));
    expect(query).not.toHaveBeenCalled(); expect(inspect).not.toHaveBeenCalled(); expect(h.showOpenDialog).not.toHaveBeenCalled();
  });

  it.each(['other-window', 'subframe', 'null-frame', 'destroyed', 'url-error'] as const)(
    'rejects %s for every operation even with correct payloads', async (scenario) => {
      const h = harness();
      if (scenario === 'other-window') h.eventState.sender = harness().contents; // Same synthetic numeric id and URL, different object.
      if (scenario === 'subframe') h.eventState.senderFrame = newFrame().frame;
      if (scenario === 'null-frame') h.eventState.senderFrame = null;
      if (scenario === 'destroyed') h.isDestroyed.mockReturnValue(true);
      if (scenario === 'url-error') h.getURL.mockImplementation(() => { throw new Error(`PRIVATE ${directory}`); });
      const query = vi.spyOn(database, 'prepare'); const inspect = vi.spyOn(fs, 'lstatSync');
      for (const { channel, args } of requests) await expect(h.dispatch(channel, ...args)).resolves.toEqual(failure('INVALID_REQUEST'));
      expect(query).not.toHaveBeenCalled(); expect(inspect).not.toHaveBeenCalled(); expect(h.showOpenDialog).not.toHaveBeenCalled();
    },
  );

  it('checks both current frame and WebContents URLs, rejecting queries, external content and other documents', async () => {
    const h = harness(); const query = vi.spyOn(database, 'prepare');
    for (const url of ['', 'not a URL', 'https://example.invalid/app', 'file://server/share/app.html',
      'file:///C:/Synthetic/app/other.html', `${rendererURL}?`, `${rendererURL}?x=1#route`,
      'file:///C:/Synthetic/app/%ZZ.html', 'file:///C:/Synthetic/app/%00.html']) {
      for (const target of ['frame', 'contents']) {
        h.frameState.url = target === 'frame' ? url : rendererURL;
        h.getURL.mockReturnValue(target === 'contents' ? url : rendererURL);
        await expect(h.dispatch(PROJECT_LIST_CHANNEL)).resolves.toEqual(failure('INVALID_REQUEST'));
        await expect(h.dispatch(PROJECT_PICK_PARENT_CHANNEL, { purpose: 'create' })).resolves.toEqual(failure('INVALID_REQUEST'));
      }
    }
    expect(query).not.toHaveBeenCalled(); expect(h.showOpenDialog).not.toHaveBeenCalled();
  });

  it('allows trusted hash routes and subframe navigation without expiring the main document selection', async () => {
    const h = harness(`${rendererURL}#start`); const selected = await pick(h);
    h.frameState.url = `${rendererURL}#projects?inside-fragment`; h.getURL.mockReturnValue(`${rendererURL}#projects`);
    navigation(h, true); navigation(h, false, false);
    const response = projectCreateResponseSchema.parse(await h.dispatch(PROJECT_CREATE_CHANNEL, { ...metadata, parentToken: selected.token }));
    expect(response.ok).toBe(true);
    expect(h.showOpenDialog.mock.calls).toEqual([[{ properties: ['openDirectory'], title: 'Projectの親フォルダーを選択' }]]);
  });

  it('adversarial review: ordinary parent creates, lists, gets and updates real owned roots with normalized IDs and actual lock values', async () => {
    const h = harness();
    expect(projectListResponseSchema.parse(await h.dispatch(PROJECT_LIST_CHANNEL))).toEqual({ ok: true, value: [] });
    const selected = await pick(h);
    expect(Object.keys(selected)).toEqual(['status', 'token', 'displayPath']);
    expect(selected.displayPath).toBe(parent);
    const created = projectCreateResponseSchema.parse(await h.dispatch(PROJECT_CREATE_CHANNEL, {
      name: '  Project 日本語  ', taskType: 'classification', parentToken: selected.token.toUpperCase(),
    }));
    if (!created.ok) throw new Error('Expected real create');
    const project = created.value.project;
    expect(created.value.taskTypeLocked).toBe(false);
    expect(project).toMatchObject({ name: metadata.name, description: '', workspacePath: join(parent, project.id) });
    expect(verifyProjectDirectory(project.workspacePath, project.id).rootPath).toBe(project.workspacePath);
    expect(fs.readdirSync(project.workspacePath)).toEqual([markerName]);
    expect(projectGetResponseSchema.parse(await h.dispatch(PROJECT_GET_CHANNEL, { projectId: project.id.toUpperCase() })))
      .toEqual({ ok: true, value: created.value });
    const other = seed('独立Project');
    const updated = projectUpdateResponseSchema.parse(await h.dispatch(PROJECT_UPDATE_CHANNEL,
      edit(project, { id: project.id.toUpperCase(), name: ' 更新 ', description: '詳細', taskType: 'detection' })));
    if (!updated.ok) throw new Error('Expected metadata update');
    expect(updated.value).toEqual({ project: getProject(database, project.id), taskTypeLocked: false });
    expect(updated.value.project).toMatchObject({ workspacePath: project.workspacePath, createdAt: project.createdAt, name: '更新', taskType: 'detection' });
    expect(getProject(database, other.id)).toEqual(other);
    const listed = projectListResponseSchema.parse(await h.dispatch(PROJECT_LIST_CHANNEL));
    if (!listed.ok) throw new Error('Expected real list');
    expect(listed.value).toEqual(getProjects(database).map((saved) => ({ project: saved, taskTypeLocked: false })));
    expect(Object.isFrozen(listed)).toBe(true); expect(Object.isFrozen(listed.value)).toBe(true);
    expect(Object.isFrozen(listed.value[0]!.project)).toBe(true);
    expect(Object.keys(updated.value).sort()).toEqual(['project', 'taskTypeLocked']);
    expect(fs.readdirSync(parent).sort()).toEqual([project.id, other.id].sort());
    for (const root of [original, receiptDirectory]) expect(fs.readdirSync(root, { recursive: true })).toEqual([]);
    expect(database.inTransaction).toBe(false);
  });

  it('reads the persisted task lock, permits same-type metadata edits and leaves other projects unlocked', async () => {
    const project = seed(); const other = seed('Other'); lock(project);
    const h = harness();
    expect(await h.dispatch(PROJECT_GET_CHANNEL, { projectId: project.id })).toEqual({ ok: true, value: { project, taskTypeLocked: true } });
    await expect(h.dispatch(PROJECT_UPDATE_CHANNEL, edit(project, { taskType: 'detection' }))).resolves.toEqual(failure('OPERATION_FAILED'));
    const response = projectUpdateResponseSchema.parse(await h.dispatch(PROJECT_UPDATE_CHANNEL, edit(project, { name: 'Locked metadata' })));
    if (!response.ok) throw new Error('Expected locked metadata update');
    expect(response.value.taskTypeLocked).toBe(true); expect(response.value.project.taskType).toBe('classification');
    expect(await h.dispatch(PROJECT_GET_CHANNEL, { projectId: other.id })).toEqual({ ok: true, value: { project: other, taskTypeLocked: false } });
    database.close(); database = openDatabase(join(directory, 'metadata.sqlite3'));
    expect(await harness().dispatch(PROJECT_GET_CHANNEL, { projectId: project.id })).toEqual({ ok: true, value: response.value });
  });

  it.each(['invalid-integer', 'null-value', 'missing-row'] as const)('never defaults/coerces an actual %s lock read', async (scenario) => {
    const project = seed(); const h = harness();
    if (scenario === 'invalid-integer') {
      database.pragma('ignore_check_constraints = ON');
      database.prepare('UPDATE projects SET task_type_locked=2 WHERE id=?').run(project.id);
    } else {
      const prepare = database.prepare.bind(database);
      // Still execute native SQLite; substitute only this SELECT to exercise an
      // unavailable/invalid DB column without a fake repository or service.
      vi.spyOn(database, 'prepare').mockImplementation((statement) => prepare(statement === 'SELECT task_type_locked FROM projects WHERE id=?'
        ? scenario === 'null-value' ? 'SELECT NULL AS task_type_locked WHERE ? IS NOT NULL'
          : 'SELECT task_type_locked FROM projects WHERE id=? AND 0' : statement));
    }
    await expect(h.dispatch(PROJECT_GET_CHANNEL, { projectId: project.id })).resolves.toEqual(failure('OPERATION_FAILED'));
    await expect(h.dispatch(PROJECT_LIST_CHANNEL)).resolves.toEqual(failure('OPERATION_FAILED'));
    expect(database.inTransaction).toBe(false);
  });

  it('rejects malformed DB DTOs instead of returning unchecked outbound metadata', async () => {
    const project = seed(); const h = harness();
    database.prepare('UPDATE projects SET updated_at=? WHERE id=?').run('PRIVATE invalid date', project.id);
    await expect(h.dispatch(PROJECT_GET_CHANNEL, { projectId: project.id })).resolves.toEqual(failure('OPERATION_FAILED'));
    await expect(h.dispatch(PROJECT_LIST_CHANNEL)).resolves.toEqual(failure('OPERATION_FAILED'));
    await expect(h.dispatch(PROJECT_UPDATE_CHANNEL, edit(project))).resolves.toEqual(failure('OPERATION_FAILED'));
  });

  it('reads DTO and task lock in one SQLite snapshot even when another connection commits between SELECTs', async () => {
    const project = seed(); const h = harness(); const foreign = openDatabase(join(directory, 'metadata.sqlite3'));
    const prepare = database.prepare.bind(database); let changed = false;
    const query = vi.spyOn(database, 'prepare').mockImplementation((statement) => {
      if (!changed && statement === 'SELECT task_type_locked FROM projects WHERE id=?') {
        expect(database.inTransaction).toBe(true); changed = true;
        foreign.prepare('UPDATE projects SET name=?,task_type_locked=1 WHERE id=?').run('Other connection', project.id);
      }
      return prepare(statement);
    });
    try {
      expect(await h.dispatch(PROJECT_GET_CHANNEL, { projectId: project.id })).toEqual({ ok: true, value: { project, taskTypeLocked: false } });
      expect(changed).toBe(true); expect(database.inTransaction).toBe(false);
      query.mockRestore();
      expect(await h.dispatch(PROJECT_GET_CHANNEL, { projectId: project.id })).toEqual({
        ok: true, value: { project: { ...project, name: 'Other connection' }, taskTypeLocked: true },
      });
    } finally { foreign.close(); }
  });

  // RV-CREATE changes the public IPC contract, not legitimate service updates
  // made by trusted Main code inside its own transaction.
  it.each(['IMMEDIATE', 'DEFERRED'] as const)(
    'adversarial review: public update returns BUSY inside BEGIN %s without changing caller data', async (mode) => {
      const project = seed(); const other = seed('Other'); const h = harness();
      const committed = database.prepare('SELECT * FROM projects ORDER BY id').all();
      const input = edit(project, { name: 'Rejected public update', description: 'No provisional success' });
      const exec = vi.spyOn(database, 'exec');
      try {
        database.exec(`BEGIN ${mode}`); exec.mockClear();
        database.prepare('UPDATE projects SET name=? WHERE id=?').run('PRIVATE caller uncommitted', project.id);
        const callerRows = database.prepare('SELECT * FROM projects ORDER BY id').all();
        const query = vi.spyOn(database, 'prepare');
        const response = await h.dispatch(PROJECT_UPDATE_CHANNEL, input);
        expect(query).not.toHaveBeenCalled(); query.mockRestore();
        expect({ response, rows: database.prepare('SELECT * FROM projects ORDER BY id').all(),
          inTransaction: database.inTransaction, commands: exec.mock.calls })
          .toEqual({ response: failure('BUSY'), rows: callerRows, inTransaction: true, commands: [] });
      } finally {
        exec.mockRestore();
        if (database.inTransaction) database.exec('ROLLBACK');
      }
      expect(database.inTransaction).toBe(false);
      expect(database.prepare('SELECT * FROM projects ORDER BY id').all()).toEqual(committed);
      // The rejected request must also release its public write exclusion.
      const updated = projectUpdateResponseSchema.parse(await h.dispatch(PROJECT_UPDATE_CHANNEL, input));
      if (!updated.ok) throw new Error('Expected public update after caller rollback');
      expect(updated.value).toMatchObject({ project: { ...input, workspacePath: project.workspacePath }, taskTypeLocked: false });
      expect(getProject(database, other.id)).toEqual(other);
      expect(database.inTransaction).toBe(false);
    },
  );

  it.each([
    [PROJECT_GET_CHANNEL, 'IMMEDIATE'], [PROJECT_GET_CHANNEL, 'DEFERRED'],
    [PROJECT_LIST_CHANNEL, 'IMMEDIATE'], [PROJECT_LIST_CHANNEL, 'DEFERRED'],
  ] as const)(
    'adversarial review: public %s returns BUSY instead of uncommitted data inside BEGIN %s', async (channel, mode) => {
      const project = seed(); const h = harness();
      const committed = database.prepare('SELECT * FROM projects ORDER BY id').all();
      const exec = vi.spyOn(database, 'exec');
      try {
        database.exec(`BEGIN ${mode}`); exec.mockClear();
        database.prepare('UPDATE projects SET name=?,task_type_locked=1 WHERE id=?').run('PRIVATE caller uncommitted', project.id);
        const callerRows = database.prepare('SELECT * FROM projects ORDER BY id').all();
        const query = vi.spyOn(database, 'prepare');
        const response = channel === PROJECT_LIST_CHANNEL ? await h.dispatch(channel)
          : await h.dispatch(channel, { projectId: project.id });
        expect(query).not.toHaveBeenCalled(); query.mockRestore();
        expect({ response, rows: database.prepare('SELECT * FROM projects ORDER BY id').all(),
          inTransaction: database.inTransaction, commands: exec.mock.calls })
          .toEqual({ response: failure('BUSY'), rows: callerRows, inTransaction: true, commands: [] });
      } finally {
        exec.mockRestore();
        if (database.inTransaction) database.exec('ROLLBACK');
      }
      expect(database.inTransaction).toBe(false);
      expect(database.prepare('SELECT * FROM projects ORDER BY id').all()).toEqual(committed);
      const snapshot = { project, taskTypeLocked: false };
      const response = channel === PROJECT_LIST_CHANNEL ? await h.dispatch(channel)
        : await h.dispatch(channel, { projectId: project.id });
      expect(response).toEqual({ ok: true, value: channel === PROJECT_LIST_CHANNEL ? [snapshot] : snapshot });
      expect(database.inTransaction).toBe(false);
    },
  );

  it('returns NOT_FOUND only for absent project lookups, before native I/O', async () => {
    const h = harness(); const inspect = vi.spyOn(fs, 'lstatSync'); const open = vi.spyOn(asyncFs, 'open');
    for (const [channel, input] of [
      [PROJECT_GET_CHANNEL, { projectId: unusedId }], [PROJECT_RECOVER_CHANNEL, { projectId: unusedId }],
      [PROJECT_PICK_PARENT_CHANNEL, { purpose: 'move', projectId: unusedId }],
      [PROJECT_UPDATE_CHANNEL, { ...metadata, id: unusedId, description: '' }],
    ] as const) await expect(h.dispatch(channel, input)).resolves.toEqual(failure('NOT_FOUND'));
    expect(inspect).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled(); expect(h.showOpenDialog).not.toHaveBeenCalled();
  });

  it('returns code-only failures for sync/async native errors and a closed DB, never messages, paths or stacks', async () => {
    const h = harness(); const secret = Object.assign(new Error(`PRIVATE ${directory}`), { code: 'ENOENT', cause: { path: parent } });
    h.showOpenDialog.mockImplementationOnce(() => { throw secret; });
    await expect(h.dispatch(PROJECT_PICK_PARENT_CHANNEL, { purpose: 'create' })).resolves.toEqual(failure('OPERATION_FAILED'));
    h.showOpenDialog.mockRejectedValueOnce(secret);
    await expect(h.dispatch(PROJECT_PICK_PARENT_CHANNEL, { purpose: 'create' })).resolves.toEqual(failure('OPERATION_FAILED'));
    const unreadable = new Error('PRIVATE native exception');
    Object.defineProperty(unreadable, 'message', { get: () => { throw secret; } });
    h.showOpenDialog.mockRejectedValueOnce(unreadable);
    await expect(h.dispatch(PROJECT_PICK_PARENT_CHANNEL, { purpose: 'create' })).resolves.toEqual(failure('OPERATION_FAILED'));
    database.close();
    for (const channel of [PROJECT_GET_CHANNEL, PROJECT_RECOVER_CHANNEL]) {
      await expect(h.dispatch(channel, { projectId: unusedId })).resolves.toEqual(failure('OPERATION_FAILED'));
    }
    await expect(h.dispatch(PROJECT_LIST_CHANNEL)).resolves.toEqual(failure('OPERATION_FAILED'));
  });

  it('maps actual SQLite write contention to BUSY and burns the attempted create token', async () => {
    const h = harness(); const selected = await pick(h); database.pragma('busy_timeout = 0');
    const foreign = openDatabase(join(directory, 'metadata.sqlite3')); foreign.exec('BEGIN IMMEDIATE');
    try {
      await expect(h.dispatch(PROJECT_CREATE_CHANNEL, { ...metadata, parentToken: selected.token })).resolves.toEqual(failure('BUSY'));
      expect(database.inTransaction).toBe(false); expect(fs.readdirSync(parent)).toEqual([]);
    } finally { foreign.exec('ROLLBACK'); foreign.close(); }
    await expect(h.dispatch(PROJECT_CREATE_CHANNEL, { ...metadata, parentToken: selected.token })).resolves.toEqual(failure('STALE_SELECTION'));
    expect(getProjects(database)).toEqual([]);
  });

  it('keeps native cancellation distinct from failure and revokes the previous selection', async () => {
    const h = harness(); const selected = await pick(h);
    h.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
    expect(await h.dispatch(PROJECT_PICK_PARENT_CHANNEL, { purpose: 'create' })).toEqual({ ok: true, value: { status: 'cancelled' } });
    await expect(h.dispatch(PROJECT_CREATE_CHANNEL, { ...metadata, parentToken: selected.token })).resolves.toEqual(failure('STALE_SELECTION'));
    expect(fs.readdirSync(parent)).toEqual([]); expect(getProjects(database)).toEqual([]);
  });

  it('refuses malformed native selections and nonexistent/non-directory/unsupported selected paths without creating anything', async () => {
    const h = harness(); const file = join(directory, 'ordinary-file'); fs.writeFileSync(file, 'keep');
    for (const filePaths of [[], [parent, destination], [file], [join(parent, 'missing')], [parse(directory).root],
      ['relative'], [`${parent}\\bad\0name`]]) {
      h.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths });
      await expect(h.dispatch(PROJECT_PICK_PARENT_CHANNEL, { purpose: 'create' })).resolves.toEqual(failure('OPERATION_FAILED'));
    }
    expect(fs.readFileSync(file, 'utf8')).toBe('keep'); expect(fs.readdirSync(parent)).toEqual([]);
    expect(getProjects(database)).toEqual([]);
  });

  it('does not treat UUID syntax or a different trusted WebContents selection as permission', async () => {
    const h = harness(); const other = harness(); const selected = await pick(h);
    const inspect = vi.spyOn(fs, 'lstatSync'); const query = vi.spyOn(database, 'prepare');
    for (const parentToken of [randomUUID(), '00000000-0000-0000-0000-000000000000']) {
      await expect(h.dispatch(PROJECT_CREATE_CHANNEL, { ...metadata, parentToken })).resolves.toEqual(failure('STALE_SELECTION'));
      await expect(h.dispatch(PROJECT_MOVE_CHANNEL, { projectId: unusedId, parentToken })).resolves.toEqual(failure('STALE_SELECTION'));
    }
    await expect(other.dispatch(PROJECT_CREATE_CHANNEL, { ...metadata, parentToken: selected.token })).resolves.toEqual(failure('STALE_SELECTION'));
    expect(inspect).not.toHaveBeenCalled(); expect(query).not.toHaveBeenCalled();
    await expect(h.dispatch(PROJECT_CREATE_CHANNEL, { ...metadata, parentToken: selected.token })).resolves.toMatchObject({ ok: true });
  });

  it('burns wrong-purpose and wrong-project tokens rather than repurposing or replaying them', async () => {
    const project = seed(); const other = seed('Other'); const before = getProjects(database); const h = harness();
    const mkdir = vi.spyOn(fs, 'mkdirSync');
    const creating = await pick(h);
    await expect(h.dispatch(PROJECT_MOVE_CHANNEL, { projectId: project.id, parentToken: creating.token })).resolves.toEqual(failure('STALE_SELECTION'));
    await expect(h.dispatch(PROJECT_CREATE_CHANNEL, { ...metadata, parentToken: creating.token })).resolves.toEqual(failure('STALE_SELECTION'));
    const moving = await pickMove(h, project);
    await expect(h.dispatch(PROJECT_CREATE_CHANNEL, { ...metadata, parentToken: moving.token })).resolves.toEqual(failure('STALE_SELECTION'));
    await expect(h.dispatch(PROJECT_MOVE_CHANNEL, { projectId: project.id, parentToken: moving.token })).resolves.toEqual(failure('STALE_SELECTION'));
    const bound = await pickMove(h, project);
    await expect(h.dispatch(PROJECT_MOVE_CHANNEL, { projectId: other.id, parentToken: bound.token })).resolves.toEqual(failure('STALE_SELECTION'));
    await expect(h.dispatch(PROJECT_MOVE_CHANNEL, { projectId: project.id, parentToken: bound.token })).resolves.toEqual(failure('STALE_SELECTION'));
    expect(mkdir).not.toHaveBeenCalled(); expect(getProjects(database)).toEqual(before); expect(fs.readdirSync(destination)).toEqual([]);
  });

  it('retains only the latest selection across purposes, ignores edited display text and consumes success once', async () => {
    const project = seed(); const h = harness(); const first = await pick(h); const second = await pickMove(h, project);
    await expect(h.dispatch(PROJECT_CREATE_CHANNEL, { ...metadata, parentToken: first.token })).resolves.toEqual(failure('STALE_SELECTION'));
    h.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [destination] });
    const third = await pick(h);
    await expect(h.dispatch(PROJECT_MOVE_CHANNEL, { projectId: project.id, parentToken: second.token })).resolves.toEqual(failure('STALE_SELECTION'));
    const rendererCopy = { ...third, displayPath: parent };
    const result = projectCreateResponseSchema.parse(await h.dispatch(PROJECT_CREATE_CHANNEL, { ...metadata, parentToken: rendererCopy.token }));
    if (!result.ok) throw new Error('Expected latest selection create');
    expect(result.value.project.workspacePath).toBe(join(destination, result.value.project.id));
    await expect(h.dispatch(PROJECT_CREATE_CHANNEL, { ...metadata, parentToken: third.token })).resolves.toEqual(failure('STALE_SELECTION'));
  });

  it('consumes before creation and never restores a token after failure or an unavailable post-write snapshot', async () => {
    const existing = seed(); const h = harness(); const selected = await pick(h);
    const input = { ...metadata, parentToken: selected.token };
    database.exec("CREATE TRIGGER fail_insert AFTER INSERT ON projects BEGIN SELECT RAISE(FAIL, 'PRIVATE insert failure'); END;");
    const exec = database.exec.bind(database); let repeated: Promise<unknown> | undefined;
    vi.spyOn(database, 'exec').mockImplementation((statement) => {
      if (statement === 'BEGIN IMMEDIATE' && !repeated) repeated = h.dispatch(PROJECT_CREATE_CHANNEL, input);
      return exec(statement);
    });
    await expect(h.dispatch(PROJECT_CREATE_CHANNEL, input)).resolves.toEqual(failure('OPERATION_FAILED'));
    if (!repeated) throw new Error('Expected native service entry');
    await expect(repeated).resolves.toEqual(failure('STALE_SELECTION'));
    await expect(h.dispatch(PROJECT_CREATE_CHANNEL, input)).resolves.toEqual(failure('STALE_SELECTION'));
    expect(getProjects(database)).toEqual([existing]); expect(fs.readdirSync(parent)).toEqual([existing.id]);
    expect(database.inTransaction).toBe(false);

    // The service can complete while a native trigger removes the inserted DB
    // row. A failed outbound snapshot does NOT prove filesystem rollback.
    database.exec('DROP TRIGGER fail_insert');
    database.exec('CREATE TRIGGER remove_insert AFTER INSERT ON projects BEGIN DELETE FROM projects WHERE id=NEW.id; END;');
    const next = await pick(h);
    await expect(h.dispatch(PROJECT_CREATE_CHANNEL, { ...metadata, parentToken: next.token })).resolves.toEqual(failure('OPERATION_FAILED'));
    const retained = fs.readdirSync(parent).filter((name) => name !== existing.id);
    expect(retained).toHaveLength(1);
    expect(verifyProjectDirectory(join(parent, retained[0]!), retained[0]!).rootPath).toBe(join(parent, retained[0]!));
    expect(getProjects(database)).toEqual([existing]);
    await expect(h.dispatch(PROJECT_CREATE_CHANNEL, { ...metadata, parentToken: next.token })).resolves.toEqual(failure('STALE_SELECTION'));
  });

  it('reports a lost real create COMMIT acknowledgement without removing the persisted owned root', async () => {
    const existing = seed(); const h = harness(); const selected = await pick(h);
    const input = { ...metadata, description: 'Committed despite lost acknowledgement', parentToken: selected.token };
    const exec = database.exec.bind(database); let injected = false;
    const command = vi.spyOn(database, 'exec').mockImplementation((statement) => {
      const result = exec(statement); // Execute COMMIT before throwing, not a simulated rollback.
      if (!injected && statement === 'COMMIT') {
        injected = true;
        throw new Error(`PRIVATE create commit acknowledgement ${parent}`);
      }
      return result;
    });
    await expect(h.dispatch(PROJECT_CREATE_CHANNEL, input)).resolves.toEqual(failure('OPERATION_FAILED'));
    expect(injected).toBe(true); expect(database.inTransaction).toBe(false);
    await expect(h.dispatch(PROJECT_CREATE_CHANNEL, input)).resolves.toEqual(failure('STALE_SELECTION'));
    expect(command.mock.calls).toEqual([['BEGIN IMMEDIATE'], ['COMMIT']]);
    const persisted = getProjects(database).filter((project) => project.id !== existing.id);
    expect(persisted).toHaveLength(1);
    const created = persisted[0]!;
    expect(created).toMatchObject({ name: metadata.name, description: input.description, taskType: metadata.taskType,
      workspacePath: join(parent, created.id) });
    const owned = verifyProjectDirectory(created.workspacePath, created.id);
    const marker = fs.readFileSync(join(created.workspacePath, markerName));
    expect(fs.readdirSync(created.workspacePath)).toEqual([markerName]);

    command.mockRestore();
    database.close(); database = openDatabase(join(directory, 'metadata.sqlite3'));
    const reopened = harness();
    expect(projectGetResponseSchema.parse(await reopened.dispatch(PROJECT_GET_CHANNEL, { projectId: created.id })))
      .toEqual({ ok: true, value: { project: created, taskTypeLocked: false } });
    const listed = projectListResponseSchema.parse(await reopened.dispatch(PROJECT_LIST_CHANNEL));
    if (!listed.ok) throw new Error('Expected persisted projects after lost create acknowledgement');
    expect(listed.value).toHaveLength(2);
    expect(listed.value).toEqual(expect.arrayContaining([
      { project: existing, taskTypeLocked: false }, { project: created, taskTypeLocked: false },
    ]));
    expect(verifyProjectDirectory(created.workspacePath, created.id)).toEqual(owned);
    expect(fs.readFileSync(join(created.workspacePath, markerName))).toEqual(marker);
    expect(fs.readdirSync(parent).sort()).toEqual([existing.id, created.id].sort());
    expect(database.inTransaction).toBe(false);
  }, 20_000);

  it('delegates create overlap checks to the real service for every registered root, not just the first row', async () => {
    seed('First'); seed('Second'); const before = getProjects(database); const last = before[before.length - 1]!;
    const nested = join(last.workspacePath, 'nested'); fs.mkdirSync(nested);
    const h = harness();
    for (const selectedPath of [last.workspacePath, nested]) {
      h.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [selectedPath] }); const selected = await pick(h);
      await expect(h.dispatch(PROJECT_CREATE_CHANNEL, { ...metadata, parentToken: selected.token })).resolves.toEqual(failure('OPERATION_FAILED'));
      await expect(h.dispatch(PROJECT_CREATE_CHANNEL, { ...metadata, parentToken: selected.token })).resolves.toEqual(failure('STALE_SELECTION'));
    }
    expect(getProjects(database)).toEqual(before); expect(fs.readdirSync(nested)).toEqual([]);
    expect(fs.readdirSync(last.workspacePath).sort()).toEqual([markerName, 'nested'].sort());
  });

  it.each(['protected-root', 'protected-resources-child', 'receipt-root', 'receipt-child'] as const)(
    'adversarial review: create rejects native-selected %s without protected artifacts or DB rows', async (scenario) => {
      // These resources/receipts are synthetic children of this test's mkdtemp,
      // never repository resources, Electron userData or a Renderer path input.
      const resources = join(original, 'resources'); const receiptChild = join(receiptDirectory, 'retained');
      fs.mkdirSync(resources); fs.mkdirSync(receiptChild);
      fs.writeFileSync(join(original, 'keep.txt'), 'original bytes');
      fs.writeFileSync(join(resources, 'keep.bin'), Buffer.from([0, 255, 1, 128, 42]));
      fs.writeFileSync(join(receiptDirectory, 'keep.txt'), 'managed receipt bytes');
      fs.writeFileSync(join(receiptChild, 'keep.bin'), Buffer.from([42, 128, 1, 255, 0]));
      const protectedContents = () => [original, receiptDirectory].map((root) => ({
        root,
        entries: fs.readdirSync(root, { recursive: true }).sort().map((name) => {
          if (typeof name !== 'string') throw new Error('Expected a UTF-8 fixture entry');
          const path = join(root, name); const stat = fs.lstatSync(path);
          return { name, directory: stat.isDirectory(), bytes: stat.isFile() ? fs.readFileSync(path) : undefined };
        }),
      }));
      const before = protectedContents();
      const selectedPath = {
        'protected-root': original, 'protected-resources-child': resources,
        'receipt-root': receiptDirectory, 'receipt-child': receiptChild,
      }[scenario];
      const h = harness();
      // receiptDirectory must be protected independently of protectedRoots.
      expect(h.trustedMain.protectedRoots).toEqual([original]);
      h.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [selectedPath] });
      const selected = await pick(h);
      expect(selected.displayPath).toBe(selectedPath);
      const input = { ...metadata, parentToken: selected.token };
      const response = await h.dispatch(PROJECT_CREATE_CHANNEL, input);
      // Compare the whole trees, not just the selected folder or a guessed UUID.
      expect({ response, protectedContents: protectedContents(),
        rows: database.prepare('SELECT * FROM projects ORDER BY id').all(), inTransaction: database.inTransaction })
        .toEqual({ response: failure('OPERATION_FAILED'), protectedContents: before, rows: [], inTransaction: false });
      await expect(h.dispatch(PROJECT_CREATE_CHANNEL, input)).resolves.toEqual(failure('STALE_SELECTION'));
      expect(protectedContents()).toEqual(before);
      expect(getProjects(database)).toEqual([]);
      expect(database.inTransaction).toBe(false);
    },
  );

  it.each(['older-first', 'newer-first'] as const)('issues only the latest overlapping native picker result (%s)', async (order) => {
    const h = harness(); const older = Promise.withResolvers<OpenDialogReturnValue>(); const newer = Promise.withResolvers<OpenDialogReturnValue>();
    h.showOpenDialog.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const first = h.dispatch(PROJECT_PICK_PARENT_CHANNEL, { purpose: 'create' });
    const second = h.dispatch(PROJECT_PICK_PARENT_CHANNEL, { purpose: 'create' });
    expect(database.inTransaction).toBe(false);
    if (order === 'older-first') {
      older.resolve({ canceled: false, filePaths: [parent] });
      await expect(first).resolves.toEqual(failure('STALE_SELECTION'));
      newer.resolve({ canceled: false, filePaths: [destination] });
    } else {
      newer.resolve({ canceled: false, filePaths: [destination] }); await second;
      older.resolve({ canceled: false, filePaths: [parent] });
    }
    await expect(first).resolves.toEqual(failure('STALE_SELECTION'));
    const response = projectPickParentResponseSchema.parse(await second);
    if (!response.ok || response.value.status !== 'selected') throw new Error('Expected newest picker');
    const created = projectCreateResponseSchema.parse(await h.dispatch(PROJECT_CREATE_CHANNEL, { ...metadata, parentToken: response.value.token }));
    if (!created.ok) throw new Error('Older completion must not revoke newest token');
    expect(created.value.project.workspacePath).toBe(join(destination, created.value.project.id));
  });

  it.each(['during-picker', 'after-selection'] as const)('invalidates every changed Main snapshot field and deletion %s', async (when) => {
    const project = seed(); const h = harness();
    const changes = [
      ['name', 'changed'], ['description', 'changed'], ['task_type', 'detection'], ['workspace_path', destination],
      ['created_at', new Date(Date.parse(project.createdAt) + 1000).toISOString()],
      ['updated_at', new Date(Date.parse(project.updatedAt) + 1000).toISOString()], ['task_type_locked', 1], ['deleted', null],
    ] as const;
    for (const [column, value] of changes) {
      database.prepare('DELETE FROM projects WHERE id=?').run(project.id); insertProject(database, project);
      let request: Promise<unknown>; let complete: (() => void) | undefined; let selectedToken: string | undefined;
      if (when === 'during-picker') {
        const pending = Promise.withResolvers<OpenDialogReturnValue>(); h.showOpenDialog.mockReturnValueOnce(pending.promise);
        request = h.dispatch(PROJECT_PICK_PARENT_CHANNEL, { purpose: 'move', projectId: project.id });
        complete = () => pending.resolve({ canceled: false, filePaths: [destination] });
      } else {
        selectedToken = (await pickMove(h, project)).token;
      }
      // Column names are this finite test table, not Renderer data.
      if (column === 'deleted') database.prepare('DELETE FROM projects WHERE id=?').run(project.id);
      else database.prepare(`UPDATE projects SET ${column}=? WHERE id=?`).run(value, project.id);
      const inspect = vi.spyOn(fs, 'lstatSync');
      if (when === 'after-selection') request = h.dispatch(PROJECT_MOVE_CHANNEL, { projectId: project.id, parentToken: selectedToken });
      complete?.();
      await expect(request!).resolves.toEqual(failure('STALE_SELECTION'));
      expect(inspect).not.toHaveBeenCalled(); inspect.mockRestore();
      if (selectedToken) await expect(h.dispatch(PROJECT_MOVE_CHANNEL, { projectId: project.id, parentToken: selectedToken })).resolves.toEqual(failure('STALE_SELECTION'));
    }
    expect(fs.readdirSync(destination)).toEqual([]);
  });

  it.each(['selected-folder', 'ancestor', 'junction'] as const)('rejects a replaced %s before the create service touches disk', async (scenario) => {
    const h = harness(); const ancestor = join(directory, 'ancestor');
    const selectedPath = scenario === 'ancestor' ? join(ancestor, 'selected') : parent;
    if (scenario === 'ancestor') fs.mkdirSync(selectedPath, { recursive: true });
    fs.writeFileSync(join(selectedPath, 'keep'), 'keep');
    h.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [selectedPath] }); const selected = await pick(h);
    const leaf = fs.lstatSync(selectedPath, { bigint: true });
    let retained = join(directory, 'retained');
    if (scenario === 'ancestor') {
      fs.renameSync(ancestor, retained); fs.mkdirSync(ancestor);
      fs.renameSync(join(retained, 'selected'), selectedPath); retained = selectedPath;
      expect(fs.lstatSync(selectedPath, { bigint: true })).toMatchObject({ dev: leaf.dev, ino: leaf.ino, birthtimeNs: leaf.birthtimeNs });
    } else {
      fs.renameSync(selectedPath, retained);
      if (scenario === 'junction') fs.symlinkSync(retained, selectedPath, 'junction'); else fs.mkdirSync(selectedPath);
    }
    const mkdir = vi.spyOn(fs, 'mkdirSync');
    await expect(h.dispatch(PROJECT_CREATE_CHANNEL, { ...metadata, parentToken: selected.token })).resolves.toEqual(failure('STALE_SELECTION'));
    await expect(h.dispatch(PROJECT_CREATE_CHANNEL, { ...metadata, parentToken: selected.token })).resolves.toEqual(failure('STALE_SELECTION'));
    expect(mkdir).not.toHaveBeenCalled(); expect(getProjects(database)).toEqual([]);
    expect(fs.readFileSync(join(retained, 'keep'), 'utf8')).toBe('keep');
  });

  it('rejects a native-selected junction in any original component, including one hidden by dot normalization', async () => {
    const alias = join(directory, 'alias'); fs.symlinkSync(parent, alias, 'junction'); fs.mkdirSync(join(parent, 'child'));
    const h = harness();
    for (const path of [alias, join(alias, 'child'), `${alias}\\..\\${basename(parent)}`]) {
      h.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [path] });
      await expect(h.dispatch(PROJECT_PICK_PARENT_CHANNEL, { purpose: 'create' })).resolves.toEqual(failure('OPERATION_FAILED'));
    }
    expect(fs.readdirSync(parent)).toEqual(['child']); expect(getProjects(database)).toEqual([]);
  });

  it('expires a token on same-URL main-frame reload even when the frame object is reused', async () => {
    const h = harness(); const selected = await pick(h); navigation(h);
    expect(h.contentsState.mainFrame).toBe(h.frame); expect(h.getURL()).toBe(rendererURL);
    const inspect = vi.spyOn(fs, 'lstatSync');
    await expect(h.dispatch(PROJECT_CREATE_CHANNEL, { ...metadata, parentToken: selected.token })).resolves.toEqual(failure('STALE_SELECTION'));
    expect(inspect).not.toHaveBeenCalled();
    const next = await pick(h); expect(next.token).not.toBe(selected.token);
  });

  it('withholds pending picker results after document loss, disposal or a failing native frame getter', async () => {
    for (const scenario of ['reload', 'foreign-navigation', 'frame-replaced', 'disposed', 'destroyed', 'process-gone', 'frame-read-error']) {
      const h = harness(); const pending = Promise.withResolvers<OpenDialogReturnValue>(); h.showOpenDialog.mockReturnValueOnce(pending.promise);
      const response = h.dispatch(PROJECT_PICK_PARENT_CHANNEL, { purpose: 'create' });
      if (scenario === 'reload') navigation(h);
      if (scenario === 'foreign-navigation') { h.frameState.url = 'file:///C:/other.html'; h.getURL.mockReturnValue(h.frameState.url); navigation(h); }
      if (scenario === 'frame-replaced') { const replacement = newFrame().frame; h.contentsState.mainFrame = replacement; h.eventState.senderFrame = replacement; }
      if (scenario === 'disposed') h.binding.dispose();
      if (scenario === 'destroyed') { h.isDestroyed.mockReturnValue(true); h.contentsState.emit('destroyed'); }
      if (scenario === 'process-gone') h.contentsState.emit('render-process-gone', {}, { reason: 'crashed' });
      if (scenario === 'frame-read-error') h.getURL.mockImplementationOnce(() => {
        Object.defineProperty(h.eventState, 'senderFrame', { configurable: true, get: () => { throw new Error(`PRIVATE frame ${directory}`); } });
        return rendererURL;
      });
      const inspect = vi.spyOn(fs, 'lstatSync');
      if (scenario === 'frame-read-error') pending.reject(new Error(`PRIVATE dialog ${directory}`));
      else pending.resolve({ canceled: false, filePaths: [parent] });
      await expect(response).resolves.toEqual(failure('STALE_SELECTION'));
      expect(inspect).not.toHaveBeenCalled(); inspect.mockRestore(); h.binding.dispose();
    }
  });

  it('refuses awaiting inside a caller transaction and holds no transaction or write exclusion during the picker', async () => {
    const project = seed(); const other = seed('Other'); const h = harness(); database.exec('BEGIN IMMEDIATE');
    const exec = vi.spyOn(database, 'exec'); const inspect = vi.spyOn(fs, 'lstatSync');
    await expect(h.dispatch(PROJECT_PICK_PARENT_CHANNEL, { purpose: 'move', projectId: project.id })).resolves.toEqual(failure('BUSY'));
    await expect(h.dispatch(PROJECT_RECOVER_CHANNEL, { projectId: project.id })).resolves.toEqual(failure('BUSY'));
    expect(exec).not.toHaveBeenCalled(); expect(inspect).not.toHaveBeenCalled(); expect(h.showOpenDialog).not.toHaveBeenCalled();
    expect(database.inTransaction).toBe(true); exec.mockRestore(); inspect.mockRestore(); database.exec('ROLLBACK');
    const pending = Promise.withResolvers<OpenDialogReturnValue>(); h.showOpenDialog.mockReturnValueOnce(pending.promise);
    const response = h.dispatch(PROJECT_PICK_PARENT_CHANNEL, { purpose: 'move', projectId: project.id });
    expect(h.showOpenDialog).toHaveBeenCalledOnce(); expect(database.inTransaction).toBe(false);
    await expect(h.dispatch(PROJECT_UPDATE_CHANNEL, edit(other, { name: 'Unrelated remains available' }))).resolves.toMatchObject({ ok: true });
    expect(database.inTransaction).toBe(false);
    pending.resolve({ canceled: false, filePaths: [destination] });
    await expect(response).resolves.toMatchObject({ ok: true, value: { status: 'selected', displayPath: destination } });
  });

  it('rejects a parent replaced during real source hashing without writing to either parent or changing the DB', async () => {
    const project = seed(); seed('Other'); lock(project);
    const before = database.prepare('SELECT * FROM projects ORDER BY id').all();
    const payload = join(project.workspacePath, 'payload.bin'); const bytes = Buffer.from([0, 255, 1, 128, 42]);
    fs.writeFileSync(payload, bytes);
    const marker = fs.readFileSync(join(project.workspacePath, markerName));
    const source = verifyProjectDirectory(project.workspacePath, project.id);
    const h = harness(); const selected = await pickMove(h, project);
    const retained = join(directory, 'Retained selected parent'); // Sibling, never inside the source inventory.
    const target = join(destination, project.id); const retainedTarget = join(retained, project.id);
    const selectedIdentity = fs.lstatSync(destination, { bigint: true });
    const reached = Promise.withResolvers<void>(); const gate = Promise.withResolvers<void>(); const open = asyncFs.open.bind(asyncFs);
    let sourceHandle: Awaited<ReturnType<typeof asyncFs.open>> | undefined;
    vi.spyOn(asyncFs, 'open').mockImplementation(async (...args) => {
      const handle = await open(...args);
      if (!sourceHandle && args[0] === payload && args[1] === 'r') {
        sourceHandle = handle; reached.resolve(); await gate.promise;
      }
      return handle;
    });
    const mkdir = vi.spyOn(fs, 'mkdirSync'); const asyncMkdir = vi.spyOn(asyncFs, 'mkdir');
    const input = { projectId: project.id, parentToken: selected.token };
    const pending = h.dispatch(PROJECT_MOVE_CHANNEL, input);
    try {
      await Promise.race([reached.promise, pending.then(() => { throw new Error('Move settled before source hash gate'); })]);
      expect(sourceHandle?.fd).toBeGreaterThanOrEqual(0);
      expect(database.inTransaction).toBe(false);
      expect(fs.existsSync(target)).toBe(false); expect(fs.existsSync(retained)).toBe(false);
      expect(fs.readdirSync(destination)).toEqual([]);
      await expect(h.dispatch(PROJECT_MOVE_CHANNEL, input)).resolves.toEqual(failure('STALE_SELECTION'));
      fs.renameSync(destination, retained); fs.mkdirSync(destination);
      expect(fs.lstatSync(retained, { bigint: true })).toMatchObject({
        dev: selectedIdentity.dev, ino: selectedIdentity.ino, birthtimeNs: selectedIdentity.birthtimeNs,
      });
      expect(fs.lstatSync(destination, { bigint: true }).ino).not.toBe(selectedIdentity.ino);
    } finally { gate.resolve(); await pending; }
    await expect(pending).resolves.toEqual(failure('OPERATION_FAILED'));
    expect(sourceHandle?.fd).toBe(-1);
    for (const root of [target, retainedTarget]) {
      expect(mkdir.mock.calls.some(([path]) => path === root)).toBe(false);
      expect(fs.existsSync(root)).toBe(false);
    }
    expect(asyncMkdir).not.toHaveBeenCalled();
    expect(fs.readdirSync(retained)).toEqual([]); expect(fs.readdirSync(destination)).toEqual([]);
    expect(fs.readFileSync(payload)).toEqual(bytes);
    expect(fs.readFileSync(join(project.workspacePath, markerName))).toEqual(marker);
    expect(fs.readdirSync(project.workspacePath).sort()).toEqual([markerName, 'payload.bin'].sort());
    expect(verifyProjectDirectory(project.workspacePath, project.id)).toEqual(source);
    await expect(h.dispatch(PROJECT_MOVE_CHANNEL, input)).resolves.toEqual(failure('STALE_SELECTION'));
    expect(database.prepare('SELECT * FROM projects ORDER BY id').all()).toEqual(before);
    expect(database.inTransaction).toBe(false);
  }, 20_000);

  it('moves actual bytes, keeps writes selectively busy, uses captured Main configuration and reports current DB cleanup status', async () => {
    const project = seed(); const other = seed('Other'); lock(project);
    fs.writeFileSync(join(project.workspacePath, 'payload.bin'), 'project bytes'); fs.writeFileSync(join(original, 'keep'), 'original bytes');
    const h = harness(); const anotherMainBinding = harness(); const selected = await pickMove(h, project);
    h.trustedMain.receiptDirectory = join(directory, 'unprovisioned', 'project-moves'); h.trustedMain.protectedRoots.push(destination);
    const reached = Promise.withResolvers<void>(); const gate = Promise.withResolvers<void>(); const open = asyncFs.open.bind(asyncFs); let paused = false;
    vi.spyOn(asyncFs, 'open').mockImplementation(async (...args) => {
      const handle = await open(...args);
      if (!paused && args[0] === join(project.workspacePath, markerName) && args[1] === 'r') {
        paused = true; reached.resolve(); await gate.promise;
      }
      return handle;
    });
    const pending = h.dispatch(PROJECT_MOVE_CHANNEL, { projectId: project.id.toUpperCase(), parentToken: selected.token });
    try {
      await Promise.race([reached.promise, pending.then(() => { throw new Error('Move settled before native gate'); })]);
      await expect(h.dispatch(PROJECT_UPDATE_CHANNEL, edit(project, { name: 'Blocked' }))).resolves.toEqual(failure('BUSY'));
      await expect(h.dispatch(PROJECT_RECOVER_CHANNEL, { projectId: project.id })).resolves.toEqual(failure('BUSY'));
      // A separate handler set has no local busy flag; it must respect the real
      // existing low-level/service exclusion rather than inventing job fields.
      await expect(anotherMainBinding.dispatch(PROJECT_UPDATE_CHANNEL, edit(project))).resolves.toEqual(failure('BUSY'));
      await expect(h.dispatch(PROJECT_GET_CHANNEL, { projectId: project.id })).resolves.toMatchObject({ ok: true, value: { taskTypeLocked: true } });
      await expect(h.dispatch(PROJECT_LIST_CHANNEL)).resolves.toMatchObject({ ok: true });
      await expect(h.dispatch(PROJECT_UPDATE_CHANNEL, edit(other, { name: 'Independent update' }))).resolves.toMatchObject({ ok: true });
      expect(database.inTransaction).toBe(false);
    } finally { gate.resolve(); await pending; }
    const result = projectMoveResponseSchema.parse(await pending);
    if (!result.ok) throw new Error('Expected real move completion');
    const target = join(destination, project.id);
    expect(result.value).toEqual({ project: getProject(database, project.id), taskTypeLocked: true, cleanupStatus: 'completed' });
    expect(result.value.project.workspacePath).toBe(target); expect(fs.readFileSync(join(target, 'payload.bin'), 'utf8')).toBe('project bytes');
    expect(verifyProjectDirectory(target, project.id).rootPath).toBe(target);
    expect(fs.existsSync(project.workspacePath)).toBe(false); expect(fs.readdirSync(receiptDirectory)).toEqual([]);
    expect(fs.readFileSync(join(original, 'keep'), 'utf8')).toBe('original bytes'); expect(getProject(database, other.id).name).toBe('Independent update');
    await expect(h.dispatch(PROJECT_MOVE_CHANNEL, { projectId: project.id, parentToken: selected.token })).resolves.toEqual(failure('STALE_SELECTION'));
    const recovered = projectRecoverResponseSchema.parse(await h.dispatch(PROJECT_RECOVER_CHANNEL, { projectId: project.id }));
    expect(recovered).toEqual({ ok: true, value: { project: result.value.project, taskTypeLocked: true, cleanupStatus: 'none' } });
    // An old Renderer metadata draft cannot restore the old root after movement.
    const updated = projectUpdateResponseSchema.parse(await h.dispatch(PROJECT_UPDATE_CHANNEL, edit(project, { name: 'After move' })));
    expect(updated).toMatchObject({ ok: true, value: { project: { workspacePath: target, name: 'After move' }, taskTypeLocked: true } });
  });

  it('preserves a real E2 cleanup warning as success, then explicitly recovers with fresh DB metadata', async () => {
    const project = seed(); const payload = join(project.workspacePath, 'payload.bin'); fs.writeFileSync(payload, 'keep bytes');
    const h = harness(); const selected = await pickMove(h, project); const unlink = fs.unlinkSync.bind(fs);
    const blocked = vi.spyOn(fs, 'unlinkSync').mockImplementation((path) => {
      if (path === payload) throw Object.assign(new Error(`PRIVATE ${path}`), { code: 'EPERM' });
      unlink(path);
    });
    const result = projectMoveResponseSchema.parse(await h.dispatch(PROJECT_MOVE_CHANNEL, { projectId: project.id, parentToken: selected.token }));
    if (!result.ok) throw new Error('Cleanup failure is not a failed move');
    expect(result.value).toEqual({ project: getProject(database, project.id), taskTypeLocked: false, cleanupStatus: 'source-retained',
      cleanupError: { code: 'PROJECT_SOURCE_CLEANUP_FAILED', message: PROJECT_SOURCE_CLEANUP_FAILED_MESSAGE } });
    expect(result.value.project.workspacePath).toBe(join(destination, project.id)); expect(fs.readFileSync(payload, 'utf8')).toBe('keep bytes');
    expect(fs.readFileSync(join(destination, project.id, 'payload.bin'), 'utf8')).toBe('keep bytes');
    blocked.mockRestore();
    await h.dispatch(PROJECT_UPDATE_CHANNEL, edit(result.value.project, { name: 'Latest recovery metadata' }));
    const recovered = projectRecoverResponseSchema.parse(await h.dispatch(PROJECT_RECOVER_CHANNEL, { projectId: project.id }));
    expect(recovered).toEqual({ ok: true, value: { project: getProject(database, project.id), taskTypeLocked: false, cleanupStatus: 'completed' } });
    expect(getProject(database, project.id).name).toBe('Latest recovery metadata');
    expect(fs.existsSync(project.workspacePath)).toBe(false); expect(fs.readdirSync(receiptDirectory)).toEqual([]);
    await expect(h.dispatch(PROJECT_MOVE_CHANNEL, { projectId: project.id, parentToken: selected.token })).resolves.toEqual(failure('STALE_SELECTION'));
  });

  it('reports a lost real move COMMIT acknowledgement as OPERATION_FAILED without old-root or rollback claims', async () => {
    const project = seed(); const h = harness(); const selected = await pickMove(h, project); const target = join(destination, project.id);
    const exec = database.exec.bind(database); let injected = false;
    vi.spyOn(database, 'exec').mockImplementation((statement) => {
      const loseAck = !injected && statement === 'COMMIT' && getProject(database, project.id).workspacePath === target;
      const result = exec(statement);
      if (loseAck) { injected = true; throw new Error(`PRIVATE commit acknowledgement ${target}`); }
      return result;
    });
    await expect(h.dispatch(PROJECT_MOVE_CHANNEL, { projectId: project.id, parentToken: selected.token })).resolves.toEqual(failure('OPERATION_FAILED'));
    expect(injected).toBe(true); expect(database.inTransaction).toBe(false);
    expect(getProject(database, project.id).workspacePath).toBe(target);
    expect(fs.existsSync(project.workspacePath)).toBe(true); expect(fs.existsSync(target)).toBe(true);
    expect(fs.existsSync(join(receiptDirectory, `${project.id}.json`))).toBe(true);
    const current = projectGetResponseSchema.parse(await h.dispatch(PROJECT_GET_CHANNEL, { projectId: project.id }));
    expect(current).toEqual({ ok: true, value: { project: getProject(database, project.id), taskTypeLocked: false } });
    await expect(h.dispatch(PROJECT_MOVE_CHANNEL, { projectId: project.id, parentToken: selected.token })).resolves.toEqual(failure('STALE_SELECTION'));
  });

  it('suppresses an asynchronous recovery result after same-URL reload and allows only fresh document snapshots', async () => {
    const project = seed(); const h = harness(); const receipt = join(receiptDirectory, `${project.id}.json`);
    fs.writeFileSync(receipt, 'corrupt receipt retained for explicit recovery');
    const reached = Promise.withResolvers<void>(); const gate = Promise.withResolvers<void>(); const open = asyncFs.open.bind(asyncFs); let paused = false;
    vi.spyOn(asyncFs, 'open').mockImplementation(async (...args) => {
      const handle = await open(...args);
      if (!paused && args[0] === receipt) { paused = true; reached.resolve(); await gate.promise; }
      return handle;
    });
    const pending = h.dispatch(PROJECT_RECOVER_CHANNEL, { projectId: project.id });
    try {
      await Promise.race([reached.promise, pending.then(() => { throw new Error('Recovery settled before native gate'); })]);
      navigation(h); // URL and WebFrameMain object deliberately unchanged.
      database.prepare('UPDATE projects SET name=?,task_type_locked=1 WHERE id=?').run('Current document metadata', project.id);
    } finally { gate.resolve(); await pending; }
    await expect(pending).resolves.toEqual(failure('STALE_SELECTION'));
    expect(await h.dispatch(PROJECT_GET_CHANNEL, { projectId: project.id })).toEqual({ ok: true, value: { project: getProject(database, project.id), taskTypeLocked: true } });
    const recovered = projectRecoverResponseSchema.parse(await h.dispatch(PROJECT_RECOVER_CHANNEL, { projectId: project.id }));
    expect(recovered).toEqual({ ok: true, value: { project: getProject(database, project.id), taskTypeLocked: true, cleanupStatus: 'source-retained',
      cleanupError: { code: 'PROJECT_SOURCE_CLEANUP_FAILED', message: PROJECT_SOURCE_CLEANUP_FAILED_MESSAGE } } });
    expect(fs.readFileSync(receipt, 'utf8')).toBe('corrupt receipt retained for explicit recovery');
    expect(fs.existsSync(project.workspacePath)).toBe(true);
  });
});
