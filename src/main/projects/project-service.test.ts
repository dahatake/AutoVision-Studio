// @vitest-environment node
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import asyncFs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, parse } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Project } from '../../shared/contracts/project.js';
import { openDatabase, type DatabaseConnection } from '../db/database.js';
import { migrateDatabase } from '../db/migrate.js';
import { verifyProjectDirectory } from './project-directory.js';
import * as projectMove from './project-move.js';
import * as receiptStorage from './project-move-receipt.js';
import { insertProject, lockProjectTaskType } from './project-repository.js';
import { createProject, getProject, getProjects, moveProject, recoverProject, updateProject, type ProjectMoveServiceResult } from './project-service.js';

const sql = fs.readFileSync(join(fileURLToPath(new URL('../db/', import.meta.url)), 'migrations', '001_core.sql'), 'utf8');
const markerName = '.autovision-project.json';
const failInsertSql = `CREATE TRIGGER fail_project_insert AFTER INSERT ON projects
  BEGIN SELECT RAISE(FAIL, 'injected project insert failure'); END;`;
let directory: string;
let database: DatabaseConnection;
const input = { name: '教師データ', taskType: 'classification', workspacePath: '' };
beforeEach(() => {
  directory = fs.realpathSync.native(fs.mkdtempSync(join(tmpdir(), 'autovision-core06-')));
  input.workspacePath = join(directory, 'Parent 日本語');
  fs.mkdirSync(input.workspacePath);
  database = openDatabase(join(directory, 'metadata.sqlite3'));
  migrateDatabase(database, [{ version: 1, sql }]);
});
afterEach(() => {
  vi.restoreAllMocks();
  if (database.open) database.close();
  fs.rmSync(directory, { recursive: true, force: true });
});
const edit = (project: ReturnType<typeof createProject>, overrides = {}) => ({
  id: project.id, name: project.name, description: project.description,
  taskType: project.taskType, workspacePath: project.workspacePath, ...overrides,
});
const insertLegacy = (workspacePath: string): Project => {
  const project: Project = {
    id: 'b66a587d-619c-4cc8-850b-c677f0698311', name: '旧Project', description: '旧metadata',
    taskType: 'classification', workspacePath,
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
  };
  insertProject(database, project);
  return project;
};

describe.skipIf(process.platform !== 'win32')('Windows Project owned-root service', () => {
  it('creates independent owned UUID roots under the same parent and persists real roots after reopen', () => {
    fs.writeFileSync(join(input.workspacePath, 'parent-only.txt'), 'parent data');
    const first = createProject(database, input);
    const second = createProject(database, input);
    expect(first.id).not.toBe(second.id);
    expect(first.description).toBe('');
    expect(database.inTransaction).toBe(false);
    for (const project of [first, second]) {
      expect(project.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(project.workspacePath).toBe(join(input.workspacePath, project.id));
      expect(project.workspacePath).toBe(fs.realpathSync.native(project.workspacePath));
      expect(fs.readdirSync(project.workspacePath)).toEqual([markerName]);
      expect(fs.readFileSync(join(project.workspacePath, markerName), 'utf8'))
        .toBe(`${JSON.stringify({ schemaVersion: 1, projectId: project.id })}\n`);
      expect(verifyProjectDirectory(project.workspacePath, project.id).rootPath).toBe(project.workspacePath);
    }
    fs.writeFileSync(join(first.workspacePath, 'data.txt'), 'first');
    fs.writeFileSync(join(second.workspacePath, 'data.txt'), 'second');
    expect(fs.readFileSync(join(first.workspacePath, 'data.txt'), 'utf8')).toBe('first');
    expect(fs.readFileSync(join(second.workspacePath, 'data.txt'), 'utf8')).toBe('second');
    expect(fs.readFileSync(join(input.workspacePath, 'parent-only.txt'), 'utf8')).toBe('parent data');
    expect(fs.readdirSync(input.workspacePath).sort()).toEqual([first.id, second.id, 'parent-only.txt'].sort());
    expect(getProjects(database)).toHaveLength(2);
    database.close();
    database = openDatabase(join(directory, 'metadata.sqlite3'));
    expect(getProject(database, first.id.toUpperCase())).toEqual(first);
    expect(getProject(database, second.id)).toEqual(second);
    for (const project of [first, second]) {
      expect(database.prepare('SELECT workspace_path FROM projects WHERE id=?').get(project.id))
        .toEqual({ workspace_path: project.workspacePath });
    }
  });
  it('updates only the selected metadata and preserves its identity/creation time', () => {
    const first = createProject(database, input);
    const second = createProject(database, input);
    const updated = updateProject(database, edit(first, { name: ' 更新 ', description: '詳細', taskType: 'detection' }));
    expect(updated).toMatchObject({ id: first.id, createdAt: first.createdAt, workspacePath: first.workspacePath, name: '更新', description: '詳細', taskType: 'detection' });
    expect(getProject(database, first.id)).toEqual(updated);
    expect(getProject(database, second.id)).toEqual(second);
    expect(fs.readdirSync(input.workspacePath).sort()).toEqual([first.id, second.id].sort());
  });
  it('locks task type in the Run transaction and retains the lock after reopen', () => {
    const project = createProject(database, input);
    expect(() => lockProjectTaskType(database, project.id)).toThrow(/transaction/);
    database.exec('BEGIN IMMEDIATE');
    lockProjectTaskType(database, project.id);
    database.exec('COMMIT');
    database.close();
    database = openDatabase(join(directory, 'metadata.sqlite3'));
    expect(() => updateProject(database, edit(project, { taskType: 'detection' }))).toThrow(/タスク種別/);
    expect(updateProject(database, edit(project, { name: '名前だけ更新' })).name).toBe('名前だけ更新');
    expect(getProject(database, project.id).taskType).toBe('classification');
  });
  it('rolls the lock back when Run creation fails', () => {
    const project = createProject(database, input);
    database.exec('BEGIN IMMEDIATE');
    lockProjectTaskType(database, project.id);
    database.exec('ROLLBACK');
    expect(updateProject(database, edit(project, { taskType: 'detection' })).taskType).toBe('detection');
  });
  it('rejects a missing or malformed Project without changing existing rows', () => {
    const project = createProject(database, input);
    expect(() => getProject(database, 'not-a-uuid')).toThrow();
    expect(() => getProject(database, 'b66a587d-619c-4cc8-850b-c677f0698311')).toThrow(/見つかりません/);
    expect(() => createProject(database, { ...input, name: '\u3000' })).toThrow();
    expect(getProjects(database)).toEqual([project]);
  });
  it('preserves a legacy UNC path as metadata without accessing the share', () => {
    const workspacePath = '\\\\server\\share\\folder';
    const legacy = insertLegacy(workspacePath);
    const inspect = vi.spyOn(fs, 'lstatSync').mockImplementation(() => { throw new Error('Unexpected filesystem access'); });
    expect(getProject(database, legacy.id)).toEqual(legacy);
    expect(getProjects(database)).toEqual([legacy]);
    expect(updateProject(database, edit(legacy, { name: '更新' })).workspacePath).toBe(workspacePath);
    expect(inspect).not.toHaveBeenCalled();
  });
  it('resolves legal dot segments to the real root but rejects a path resolving to a drive root', () => {
    fs.mkdirSync(join(input.workspacePath, 'nested'));
    const project = createProject(database, { ...input, workspacePath: `${input.workspacePath}\\.\\nested\\..` });
    expect(project.workspacePath).toBe(join(input.workspacePath, project.id));
    expect(getProject(database, project.id)).toEqual(project);
    expect(() => createProject(database, { ...input, workspacePath: `${parse(directory).root}Projects\\..` })).toThrow(TypeError);
  });
  it('does not silently change the location of existing Project data', () => {
    const project = createProject(database, input);
    const other = join(directory, 'Other');
    expect(() => updateProject(database, edit(project, { workspacePath: other }))).toThrow(/データ移動/);
    expect(getProject(database, project.id)).toEqual(project);
    expect(fs.existsSync(other)).toBe(false);
    expect(verifyProjectDirectory(project.workspacePath, project.id).rootPath).toBe(project.workspacePath);
  });
  it('binds metadata as parameters rather than executing it as SQL', () => {
    const name = "Project'); DROP TABLE projects; --";
    const project = createProject(database, { ...input, name });
    expect(getProject(database, project.id).name).toBe(name);
    expect(getProjects(database)).toHaveLength(1);
  });

  it('requires an existing ordinary parent and never creates missing ancestors', () => {
    fs.writeFileSync(join(input.workspacePath, 'not-directory'), 'keep');
    for (const workspacePath of [join(input.workspacePath, 'missing', 'child'), join(input.workspacePath, 'not-directory')]) {
      expect(() => createProject(database, { ...input, workspacePath })).toThrow();
      expect(database.inTransaction).toBe(false);
    }
    expect(fs.readdirSync(input.workspacePath)).toEqual(['not-directory']);
    expect(getProjects(database)).toEqual([]);
  });

  it('checks every registered root and rejects an equal-root parent or its descendant', () => {
    createProject(database, input);
    createProject(database, input);
    const projects = getProjects(database);
    // Target the last repository row, not merely the first registered root.
    const root = projects[projects.length - 1]!.workspacePath;
    const nested = join(root, 'nested');
    fs.mkdirSync(nested);
    for (const workspacePath of [root, nested]) {
      expect(() => createProject(database, { ...input, workspacePath })).toThrow(/重複/);
      expect(database.inTransaction).toBe(false);
    }
    expect(fs.readdirSync(root).sort()).toEqual([markerName, 'nested'].sort());
    expect(fs.readdirSync(nested)).toEqual([]);
    expect(getProjects(database)).toEqual(projects);
  });

  it.each([true, false])('preserves legacy metadata without adopting or moving its root (exists=%s)', (exists) => {
    const root = join(directory, 'Legacy 日本語');
    if (exists) {
      fs.mkdirSync(root);
      fs.writeFileSync(join(root, 'keep.txt'), 'legacy data');
    }
    const legacy = insertLegacy(root);
    database.close();
    database = openDatabase(join(directory, 'metadata.sqlite3'));
    const inspect = vi.spyOn(fs, 'lstatSync').mockImplementation(() => { throw new Error('Unexpected filesystem access'); });
    expect(getProject(database, legacy.id)).toEqual(legacy);
    expect(getProjects(database)).toEqual([legacy]);
    const updated = updateProject(database, edit(legacy, { name: '更新', taskType: 'detection' }));
    expect(updated).toMatchObject({ id: legacy.id, createdAt: legacy.createdAt, workspacePath: root, name: '更新', taskType: 'detection' });
    expect(() => updateProject(database, edit(updated, { workspacePath: input.workspacePath }))).toThrow(/データ移動/);
    expect(getProject(database, legacy.id)).toEqual(updated);
    expect(inspect).not.toHaveBeenCalled();
    inspect.mockRestore();
    expect(fs.existsSync(root)).toBe(exists);
    expect(fs.existsSync(join(root, markerName))).toBe(false);
    if (exists) expect(fs.readFileSync(join(root, 'keep.txt'), 'utf8')).toBe('legacy data');
    expect(fs.readdirSync(input.workspacePath)).toEqual([]);
  });

  it.each([true, false])('does not filter legacy roots out of overlap checks (exists=%s)', (exists) => {
    const root = exists ? input.workspacePath : join(directory, 'missing-legacy-root');
    const legacy = insertLegacy(root);
    expect(() => createProject(database, input)).toThrow();
    expect(database.inTransaction).toBe(false);
    expect(getProject(database, legacy.id)).toEqual(legacy);
    expect(getProjects(database)).toEqual([legacy]);
    expect(fs.readdirSync(input.workspacePath)).toEqual([]);
    expect(fs.existsSync(root)).toBe(exists);
  });

  it.each(['BEGIN DEFERRED', 'BEGIN IMMEDIATE', 'SAVEPOINT caller'])('rejects create before I/O inside %s without ending the caller transaction', (begin) => {
    const project = createProject(database, input);
    database.exec(begin);
    updateProject(database, edit(project, { name: 'uncommitted' }));
    const query = vi.spyOn(database, 'prepare');
    const command = vi.spyOn(database, 'exec');
    const inspect = vi.spyOn(fs, 'lstatSync').mockImplementation(() => { throw new Error('Unexpected filesystem access'); });
    expect(() => createProject(database, input)).toThrow(/transaction/);
    expect(query).not.toHaveBeenCalled();
    expect(command).not.toHaveBeenCalled();
    expect(inspect).not.toHaveBeenCalled();
    expect(database.inTransaction).toBe(true);
    database.exec('ROLLBACK');
    expect(getProject(database, project.id)).toEqual(project);
    expect(fs.readdirSync(input.workspacePath)).toEqual([project.id]);
  });

  it('rolls back partial marker write failure before attempting any insert', () => {
    const write = fs.writeFileSync;
    const query = vi.spyOn(database, 'prepare');
    vi.spyOn(fs, 'writeFileSync').mockImplementationOnce((file, data) => {
      write(file, Buffer.from(data as Uint8Array).subarray(0, 5));
      throw new Error('injected marker write failure');
    });
    expect(() => createProject(database, input)).toThrow(/injected marker write failure/);
    expect(query.mock.calls.filter(([statement]) => statement.startsWith('INSERT INTO projects('))).toHaveLength(0);
    expect(database.inTransaction).toBe(false);
    expect(fs.readdirSync(input.workspacePath)).toEqual([]);
    expect(getProjects(database)).toEqual([]);
  });

  it.each(['ABORT', 'FAIL', 'ROLLBACK'])('rolls back a real AFTER INSERT RAISE(%s) and removes only the new marker-only root', (action) => {
    const existing = createProject(database, input);
    fs.writeFileSync(join(existing.workspacePath, 'keep.txt'), 'existing project data');
    fs.writeFileSync(join(input.workspacePath, 'keep.txt'), 'parent data');
    const before = fs.readdirSync(input.workspacePath);
    database.exec(`CREATE TRIGGER fail_project_insert AFTER INSERT ON projects
      BEGIN SELECT RAISE(${action}, 'injected project insert failure'); END;`);
    expect(() => createProject(database, input)).toThrow(/injected project insert failure/);
    expect(database.inTransaction).toBe(false);
    expect(fs.readdirSync(input.workspacePath)).toEqual(before);
    expect(fs.readFileSync(join(existing.workspacePath, 'keep.txt'), 'utf8')).toBe('existing project data');
    expect(fs.readFileSync(join(input.workspacePath, 'keep.txt'), 'utf8')).toBe('parent data');
    expect(verifyProjectDirectory(existing.workspacePath, existing.id).rootPath).toBe(existing.workspacePath);
    expect(getProjects(database)).toEqual([existing]);
    database.close();
    database = openDatabase(join(directory, 'metadata.sqlite3'));
    expect(getProjects(database)).toEqual([existing]);
  });

  it.each(['unknown file', 'replacement root', 'replacement marker', 'changed marker'])('preserves %s at the native INSERT boundary when the real SQL trigger fails', (change) => {
    database.exec(failInsertSql);
    const prepare = database.prepare.bind(database);
    let rootPath = '';
    let originalContents = '';
    let retainedContents = '';
    let retainedRoot: fs.BigIntStats | undefined;
    let retainedMarker: fs.BigIntStats | undefined;
    // Spy on the actual native connection, not an immutable ESM namespace.
    // The insert and its failure still execute in SQLite, with no service DI.
    vi.spyOn(database, 'prepare').mockImplementation((statement) => {
      if (statement.startsWith('INSERT INTO projects(')) {
        const children = fs.readdirSync(input.workspacePath);
        expect(children).toHaveLength(1);
        rootPath = join(input.workspacePath, children[0]!);
        verifyProjectDirectory(rootPath, children[0]!);
        const marker = join(rootPath, markerName);
        originalContents = fs.readFileSync(marker, 'utf8');
        if (change === 'unknown file') {
          fs.writeFileSync(join(rootPath, 'unknown.txt'), 'keep');
        } else if (change === 'replacement root') {
          fs.renameSync(rootPath, join(directory, 'original-root'));
          fs.mkdirSync(rootPath);
          fs.writeFileSync(marker, originalContents);
        } else if (change === 'replacement marker') {
          fs.renameSync(marker, join(directory, 'original-marker'));
          fs.writeFileSync(marker, originalContents);
        } else {
          fs.writeFileSync(marker, 'external marker content\n');
        }
        retainedContents = fs.readFileSync(marker, 'utf8');
        retainedRoot = fs.lstatSync(rootPath, { bigint: true });
        retainedMarker = fs.lstatSync(marker, { bigint: true });
      }
      return prepare(statement);
    });
    let failure: unknown;
    try { createProject(database, input); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toHaveLength(1);
    expect((failure as AggregateError).errors[0]).toMatchObject({ code: 'SQLITE_CONSTRAINT_TRIGGER', message: 'injected project insert failure' });
    expect(database.inTransaction).toBe(false);
    expect(getProjects(database)).toEqual([]);
    expect(rootPath).not.toBe('');
    expect(fs.readdirSync(input.workspacePath)).toEqual([basename(rootPath)]);
    expect(fs.lstatSync(rootPath, { bigint: true })).toMatchObject({ dev: retainedRoot!.dev, ino: retainedRoot!.ino, birthtimeNs: retainedRoot!.birthtimeNs });
    const marker = join(rootPath, markerName);
    expect(fs.lstatSync(marker, { bigint: true })).toMatchObject({ dev: retainedMarker!.dev, ino: retainedMarker!.ino, birthtimeNs: retainedMarker!.birthtimeNs });
    expect(fs.readFileSync(marker, 'utf8')).toBe(retainedContents);
    if (change === 'unknown file') expect(fs.readFileSync(join(rootPath, 'unknown.txt'), 'utf8')).toBe('keep');
    if (change === 'replacement root') expect(fs.readFileSync(join(directory, 'original-root', markerName), 'utf8')).toBe(originalContents);
    if (change === 'replacement marker') expect(fs.readFileSync(join(directory, 'original-marker'), 'utf8')).toBe(originalContents);
  });

  it('retains the root if database rollback itself fails instead of deleting data with an uncertain DB outcome', () => {
    database.exec(failInsertSql);
    const exec = database.exec.bind(database);
    const rollbackError = new Error('injected rollback failure');
    const command = vi.spyOn(database, 'exec').mockImplementation((statement) => {
      if (statement === 'ROLLBACK') throw rollbackError;
      return exec(statement);
    });
    let failure: unknown;
    try { createProject(database, input); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toHaveLength(2);
    expect((failure as AggregateError).errors[0]).toMatchObject({ code: 'SQLITE_CONSTRAINT_TRIGGER' });
    expect((failure as AggregateError).errors[1]).toBe(rollbackError);
    expect(database.inTransaction).toBe(true);
    const projects = getProjects(database);
    expect(projects).toHaveLength(1);
    const project = projects[0]!;
    expect(verifyProjectDirectory(project.workspacePath, project.id).rootPath).toBe(project.workspacePath);
    command.mockRestore();
    database.exec('ROLLBACK');
    expect(getProjects(database)).toEqual([]);
    expect(fs.readdirSync(input.workspacePath)).toEqual([project.id]);
  });

  it.each(['before', 'after'] as const)('preserves the correct DB/root outcome when COMMIT throws %s execution', (timing) => {
    const exec = database.exec.bind(database);
    const command = vi.spyOn(database, 'exec').mockImplementation((statement) => {
      if (statement !== 'COMMIT') return exec(statement);
      if (timing === 'after') exec(statement);
      throw new Error('injected commit acknowledgement failure');
    });
    expect(() => createProject(database, input)).toThrow(timing === 'after' ? AggregateError : Error);
    expect(database.inTransaction).toBe(false);
    command.mockRestore();
    database.close();
    database = openDatabase(join(directory, 'metadata.sqlite3'));
    const projects = getProjects(database);
    expect(projects).toHaveLength(timing === 'after' ? 1 : 0);
    expect(fs.readdirSync(input.workspacePath)).toEqual(projects.map((project) => project.id));
    for (const project of projects) {
      expect(verifyProjectDirectory(project.workspacePath, project.id).rootPath).toBe(project.workspacePath);
    }
  });
});

describe.skipIf(process.platform !== 'win32')('CORE-06F Main-only move and recovery service', () => {
  let project: Project;
  let other: Project;
  let destination: string;
  let target: string;
  let original: string;
  let receiptDirectory: string;
  let receiptPath: string;
  let progressPath: string;
  let bytes: Map<string, Buffer>;

  beforeEach(() => {
    project = createProject(database, { ...input, name: '移動するProject' });
    other = createProject(database, { ...input, name: '独立Project', taskType: 'detection' });
    destination = join(directory, 'Destination 日本語');
    original = join(directory, 'Original');
    receiptDirectory = join(directory, 'app-data', 'project-moves');
    // Main configuration is simulated entirely inside this test's mkdtemp.
    for (const path of [destination, original, receiptDirectory]) fs.mkdirSync(path, { recursive: true });
    target = join(destination, project.id);
    receiptPath = join(receiptDirectory, `${project.id}.json`);
    progressPath = join(receiptDirectory, `${project.id}.progress.json`);
    fs.writeFileSync(join(original, 'external.bin'), 'original bytes');
    fs.writeFileSync(join(other.workspacePath, 'keep'), 'other project bytes');
    fs.mkdirSync(join(project.workspacePath, 'images', 'empty'), { recursive: true });
    bytes = new Map([
      [markerName, fs.readFileSync(join(project.workspacePath, markerName))],
      ['images/data.bin', Buffer.from('AAAA')],
      ['manifest.json', Buffer.from(JSON.stringify({ imagePath: 'images/data.bin', referencePath: join(original, 'external.bin') }))],
    ]);
    for (const [relative, content] of bytes) if (relative !== markerName) fs.writeFileSync(join(project.workspacePath, relative), content);
  });

  const move = () => moveProject(database, project.id, destination, receiptDirectory, [original]);
  const recover = () => recoverProject(database, project.id, receiptDirectory);
  const disk = (): receiptStorage.MoveReceipt => {
    const base = receiptStorage.decodeProjectMoveReceipt(fs.readFileSync(receiptPath));
    if (!fs.existsSync(progressPath)) return base;
    const envelope = JSON.parse(fs.readFileSync(progressPath, 'utf8')) as {
      payload: { cursor: number; pendingDelete: number | null };
    };
    return { ...base, cursor: envelope.payload.cursor, pendingDelete: envelope.payload.pendingDelete };
  };
  const reopen = () => {
    database.close();
    database = openDatabase(join(directory, 'metadata.sqlite3'));
  };
  const assertBytes = (root: string) => {
    for (const [relative, content] of bytes) expect(fs.readFileSync(join(root, relative))).toEqual(content);
    expect(fs.readdirSync(join(root, 'images', 'empty'))).toEqual([]);
  };
  const assertUnrelated = () => {
    expect(fs.readFileSync(join(original, 'external.bin'), 'utf8')).toBe('original bytes');
    expect(fs.readFileSync(join(other.workspacePath, 'keep'), 'utf8')).toBe('other project bytes');
  };
  const assertPending = (result: ProjectMoveServiceResult, current: Project) => {
    expect(result).toEqual({ project: current, cleanupStatus: 'source-retained',
      cleanupError: { code: 'PROJECT_SOURCE_CLEANUP_FAILED', message: expect.any(String) } });
    expect(result.cleanupError!.message).toMatch(/移動をやり直さず/);
    expect(result.cleanupError!.message).not.toContain(directory);
  };
  const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((complete) => { resolve = complete; });
    return { promise, resolve };
  };
  const afterReceiptUpdate = (matches: (receipt: receiptStorage.MoveReceipt) => boolean, effect: () => Promise<void>) => {
    const updateReceipt = receiptStorage.updateProjectMoveReceipt;
    const updateProgress = receiptStorage.updateProjectMoveProgress;
    let fired = false;
    vi.spyOn(receiptStorage, 'updateProjectMoveReceipt').mockImplementation(async (...args) => {
      const stored = await updateReceipt(...args); // Actual disk update and issued capability, not a fake receipt.
      if (!fired && matches(stored.receipt)) { fired = true; await effect(); }
      return stored;
    });
    vi.spyOn(receiptStorage, 'updateProjectMoveProgress').mockImplementation(async (...args) => {
      const stored = await updateProgress(...args);
      if (!fired && matches(stored.receipt)) { fired = true; await effect(); }
      return stored;
    });
    return () => fired;
  };

  it('moves then reclaims the source, returns saved metadata and preserves raw bytes and the task lock after reopen', async () => {
    database.exec('BEGIN IMMEDIATE');
    lockProjectTaskType(database, project.id);
    database.exec('COMMIT');
    const open = vi.spyOn(asyncFs, 'open');
    const result = await moveProject(database, project.id.toUpperCase(), destination, receiptDirectory, [original]);
    const current = getProject(database, project.id);
    expect(result).toEqual({ project: current, cleanupStatus: 'completed' });
    expect(current).toEqual({ ...project, workspacePath: target, updatedAt: current.updatedAt });
    expect(verifyProjectDirectory(target, project.id).rootPath).toBe(target);
    expect(fs.existsSync(project.workspacePath)).toBe(false);
    expect(fs.existsSync(receiptPath)).toBe(false);
    expect(fs.readdirSync(receiptDirectory)).toEqual([]);
    expect(open.mock.calls.some(([path]) => String(path).startsWith(`${original}\\`) || String(path).startsWith(`${other.workspacePath}\\`))).toBe(false);
    expect(database.inTransaction).toBe(false);
    assertBytes(target);
    assertUnrelated();
    reopen();
    expect(getProject(database, project.id)).toEqual(result.project);
    expect(getProject(database, other.id)).toEqual(other);
    await expect(recover()).resolves.toEqual({ project: current, cleanupStatus: 'none' });
    expect(() => updateProject(database, edit(current, { taskType: 'detection' }))).toThrow(/タスク種別/);
    expect(updateProject(database, edit(current, { name: '移動後の更新' })).name).toBe('移動後の更新');
  });

  it.each(['source-unlink', 'progress-write', 'receipt-unlink', 'receipt-ack'] as const)
    ('returns committed DB values and a cleanup warning on %s, then explicitly rechecks disk after reopen', async (stage) => {
      const failure = Object.assign(new Error(`injected private native failure: ${join(directory, 'private-details')}`), { code: 'EPERM' });
      const first = join(project.workspacePath, 'images/data.bin');
      let injected = false;
      const unlink = fs.unlinkSync.bind(fs);
      const blockedUnlink = vi.spyOn(fs, 'unlinkSync').mockImplementation((path) => {
        const selected = stage === 'source-unlink' ? first : receiptPath;
        if (stage !== 'progress-write' && path === selected && !injected) {
          injected = true;
          if (stage === 'receipt-ack') unlink(path);
          throw failure;
        }
        unlink(path);
      });
      const rename = fs.renameSync.bind(fs);
      const blockedWrite = vi.spyOn(fs, 'renameSync').mockImplementation((...args) => {
        const progress = stage === 'progress-write' && args[1] === progressPath
          ? JSON.parse(fs.readFileSync(String(args[0]), 'utf8')) as { payload: { cursor: number } } : undefined;
        if (progress?.payload.cursor === 1 && !injected) {
          injected = true;
          throw failure;
        }
        rename(...args);
      });
      const result = await move();
      expect(injected).toBe(true);
      const current = getProject(database, project.id);
      expect(current.workspacePath).toBe(target);
      assertPending(result, current);
      expect(JSON.stringify(result.cleanupError)).not.toContain(failure.message);
      expect(database.inTransaction).toBe(false);
      assertBytes(target);
      if (stage === 'source-unlink') {
        assertBytes(project.workspacePath);
        expect(disk()).toMatchObject({ cursor: 0, pendingDelete: 0 });
      } else if (stage === 'progress-write') {
        expect(fs.existsSync(first)).toBe(false);
        expect(disk()).toMatchObject({ cursor: 0, pendingDelete: 0 });
        expect(fs.readFileSync(join(project.workspacePath, 'manifest.json'))).toEqual(bytes.get('manifest.json'));
        expect(fs.readFileSync(join(project.workspacePath, markerName))).toEqual(bytes.get(markerName));
      } else {
        expect(fs.existsSync(project.workspacePath)).toBe(false);
        if (stage === 'receipt-unlink') expect(disk()).toMatchObject({
          cursor: receiptStorage.getProjectMoveRemovalOrder(disk()).length, pendingDelete: null,
        });
      }
      expect(fs.existsSync(receiptPath)).toBe(stage !== 'receipt-ack');
      blockedUnlink.mockRestore();
      blockedWrite.mockRestore();
      const latest = updateProject(database, edit(current, { name: '回収警告後のmetadata更新' }));
      reopen();
      // A lost finish ACK is unconfirmed, not completed. Once the record is gone,
      // explicit recovery says none; it must not manufacture a completion proof.
      await expect(recoverProject(database, project.id.toUpperCase(), receiptDirectory)).resolves.toEqual({
        project: latest, cleanupStatus: stage === 'receipt-ack' ? 'none' : 'completed',
      });
      expect(fs.existsSync(project.workspacePath)).toBe(false);
      expect(fs.existsSync(receiptPath)).toBe(false);
      expect(getProject(database, project.id)).toEqual(latest);
      assertBytes(target);
      assertUnrelated();
    });

  it('distinguishes an absent record from an unprovisioned Main receipt directory without creating a fallback', async () => {
    await expect(recover()).resolves.toEqual({ project, cleanupStatus: 'none' });
    const missing = join(directory, 'missing-app-data', 'project-moves');
    assertPending(await recoverProject(database, project.id, missing), project);
    expect(fs.existsSync(join(directory, 'missing-app-data'))).toBe(false);
    expect(fs.readdirSync(receiptDirectory)).toEqual([]);
    expect(getProject(database, project.id)).toEqual(project);
    assertBytes(project.workspacePath);
    assertUnrelated();
  });

  it('reports corrupt preexisting receipts as requiring attention, retaining both trees and the reopened current DB snapshot', async () => {
    await projectMove.moveProjectDirectory(database, project.id, destination, [original], receiptDirectory);
    const current = updateProject(database, edit(getProject(database, project.id), { name: '現在のmetadata' }));
    reopen();
    const corrupt = 'partial receipt: keep for manual inspection';
    fs.writeFileSync(receiptPath, corrupt);
    const unlink = vi.spyOn(fs, 'unlinkSync');
    const rmdir = vi.spyOn(fs, 'rmdirSync');
    const rename = vi.spyOn(asyncFs, 'rename');
    assertPending(await recover(), current);
    expect(unlink).not.toHaveBeenCalled();
    expect(rmdir).not.toHaveBeenCalled();
    expect(rename).not.toHaveBeenCalled();
    expect(fs.readFileSync(receiptPath, 'utf8')).toBe(corrupt);
    expect(getProject(database, project.id)).toEqual(current);
    assertBytes(project.workspacePath);
    assertBytes(target);
    assertUnrelated();
  });

  it.each(['copying', 'prepared-at-source'] as const)('ends only an unstarted %s receipt without claiming source reclamation', async (phase) => {
    if (phase === 'copying') {
      const inventory = await projectMove.inventoryProjectMove(verifyProjectDirectory(project.workspacePath, project.id), [original, other.workspacePath]);
      await receiptStorage.createProjectMoveReceipt(receiptDirectory, randomUUID(), inventory, target);
    } else {
      await projectMove.moveProjectDirectory(database, project.id, destination, [original], receiptDirectory);
      database.prepare('UPDATE projects SET workspace_path=? WHERE id=?').run(project.workspacePath, project.id);
    }
    const current = getProject(database, project.id);
    const retained = fs.readFileSync(receiptPath);
    reopen();
    const unlink = vi.spyOn(fs, 'unlinkSync');
    const rmdir = vi.spyOn(fs, 'rmdirSync');
    const rename = vi.spyOn(asyncFs, 'rename');
    await expect(recover()).resolves.toEqual({ project: current, cleanupStatus: phase === 'copying' ? 'none' : 'source-retained' });
    if (phase === 'copying') expect(unlink).toHaveBeenCalledExactlyOnceWith(receiptPath);
    else expect(unlink).not.toHaveBeenCalled();
    expect(rmdir).not.toHaveBeenCalled();
    expect(rename).not.toHaveBeenCalled();
    if (phase === 'copying') expect(fs.existsSync(receiptPath)).toBe(false);
    else expect(fs.readFileSync(receiptPath)).toEqual(retained);
    assertBytes(project.workspacePath);
    if (phase === 'prepared-at-source') assertBytes(target);
    else expect(fs.existsSync(target)).toBe(false);
    assertUnrelated();
  });

  it.each([true, false])('rejects an unowned legacy source without adoption, writes or relabeling (exists=%s)', async (exists) => {
    const legacyId = 'b66a587d-619c-4cc8-850b-c677f0698311';
    const root = join(directory, legacyId);
    if (exists) {
      fs.mkdirSync(root);
      fs.writeFileSync(join(root, 'keep'), 'legacy bytes');
    }
    const legacy = insertLegacy(root);
    const mkdir = vi.spyOn(fs, 'mkdirSync');
    const write = vi.spyOn(fs, 'writeFileSync');
    const unlink = vi.spyOn(fs, 'unlinkSync');
    const rmdir = vi.spyOn(fs, 'rmdirSync');
    const open = vi.spyOn(asyncFs, 'open');
    const exec = vi.spyOn(database, 'exec');
    await expect(moveProject(database, legacy.id, destination, receiptDirectory, [original])).rejects.toThrow();
    for (const operation of [mkdir, write, unlink, rmdir, open, exec]) expect(operation).not.toHaveBeenCalled();
    expect(getProject(database, legacy.id)).toEqual(legacy);
    expect(fs.existsSync(root)).toBe(exists);
    expect(fs.existsSync(join(root, markerName))).toBe(false);
    if (exists) expect(fs.readFileSync(join(root, 'keep'), 'utf8')).toBe('legacy bytes');
    expect(fs.readdirSync(destination)).toEqual([]);
    expect(fs.readdirSync(receiptDirectory)).toEqual([]);
    expect(updateProject(database, edit(legacy, { name: '旧metadataの編集' })).workspacePath).toBe(root);
    assertBytes(project.workspacePath);
    assertUnrelated();
  });

  it.each(['prepared-write', 'between-steps', 'pending-delete-write'] as const)
    ('holds service exclusion across %s while permitting unrelated updates', async (stage) => {
      const reached = deferred();
      const gate = deferred();
      if (stage === 'between-steps') {
        const actualMove = projectMove.moveProjectDirectory;
        vi.spyOn(projectMove, 'moveProjectDirectory').mockImplementation(async (...args) => {
          const result = await actualMove(...args); // D committed and released its own guard.
          reached.resolve();
          await gate.promise;
          return result;
        });
      } else {
        afterReceiptUpdate((receipt) => stage === 'prepared-write'
          ? receipt.phase === 'prepared' && receipt.pendingDelete === null : receipt.pendingDelete === 0,
        async () => { reached.resolve(); await gate.promise; });
      }
      const pending = move();
      const outcome = pending.then((value) => ({ value, error: undefined }), (error: unknown) => ({ value: undefined, error }));
      let unrelated: Project | undefined;
      let created: Project | undefined;
      try {
        await Promise.race([reached.promise, outcome.then(() => { throw new Error('move settled before service gate'); })]);
        const current = getProject(database, project.id);
        expect(current.workspacePath).toBe(stage === 'prepared-write' ? project.workspacePath : target);
        expect(disk()).toMatchObject({ phase: 'prepared', cursor: 0, pendingDelete: stage === 'pending-delete-write' ? 0 : null });
        expect(fs.existsSync(project.workspacePath)).toBe(true);
        if (stage === 'between-steps') expect(() => projectMove.assertProjectNotMoving(database, project.id)).not.toThrow();
        else expect(() => projectMove.assertProjectNotMoving(database, project.id)).toThrow(/移動中/);
        const query = vi.spyOn(database, 'prepare');
        const exec = vi.spyOn(database, 'exec');
        const open = vi.spyOn(asyncFs, 'open');
        expect(() => updateProject(database, edit(current, { id: project.id.toUpperCase(), name: 'blocked update' }))).toThrow(/移動中/);
        await expect(moveProject(database, project.id.toUpperCase(), destination, receiptDirectory, [original])).rejects.toThrow(/移動中/);
        await expect(recoverProject(database, project.id.toUpperCase(), receiptDirectory)).rejects.toThrow(/移動中/);
        expect(query).not.toHaveBeenCalled();
        expect(exec).not.toHaveBeenCalled();
        expect(open).not.toHaveBeenCalled();
        expect(getProject(database, project.id)).toEqual(current);
        unrelated = updateProject(database, edit(other, { name: 'unrelated update' }));
        if (stage === 'between-steps') {
          // A sibling UUID, not a creation inside the moving source/target. D
          // is done and E2 will read the new bindings; no global create lock.
          created = createProject(database, { ...input, name: 'unrelated creation' });
        }
      } finally { gate.resolve(); await outcome; }
      expect((await outcome).error).toBeUndefined();
      expect((await outcome).value).toMatchObject({ cleanupStatus: 'completed', project: { workspacePath: target } });
      expect(getProject(database, other.id)).toEqual(unrelated);
      if (stage === 'between-steps') expect(getProject(database, created!.id)).toEqual(created);
      expect(fs.existsSync(project.workspacePath)).toBe(false);
      expect(fs.existsSync(receiptPath)).toBe(false);
      const current = getProject(database, project.id);
      expect(updateProject(database, edit(current, { name: 'released update' })).name).toBe('released update');
      await expect(recover()).resolves.toMatchObject({ cleanupStatus: 'none' });
      assertBytes(target);
      assertUnrelated();
    });

  it.each(['move', 'recover'] as const)('respects an already active direct low-level %s, without wrapping busy as a cleanup warning', async (stage) => {
    if (stage === 'recover') await projectMove.moveProjectDirectory(database, project.id, destination, [original], receiptDirectory);
    const reached = deferred();
    const gate = deferred();
    afterReceiptUpdate((receipt) => stage === 'move'
      ? receipt.phase === 'prepared' && receipt.pendingDelete === null : receipt.pendingDelete === 0,
    async () => { reached.resolve(); await gate.promise; });
    const pending = stage === 'move' ? projectMove.moveProjectDirectory(database, project.id, destination, [original], receiptDirectory)
      : projectMove.recoverProjectMove(database, project.id, receiptDirectory);
    const outcome = pending.then((value) => ({ value, error: undefined }), (error: unknown) => ({ value: undefined, error }));
    try {
      await Promise.race([reached.promise, outcome.then(() => { throw new Error('low-level operation settled before gate'); })]);
      expect(() => updateProject(database, edit(getProject(database, project.id), { name: 'blocked' }))).toThrow(/移動中/);
      await expect(move()).rejects.toThrow(/移動中/);
      await expect(recover()).rejects.toThrow(/移動中/);
    } finally { gate.resolve(); await outcome; }
    expect((await outcome).error).toBeUndefined();
    expect((await outcome).value).toMatchObject({ project: { workspacePath: target } });
    await expect(recover()).resolves.toMatchObject({ cleanupStatus: stage === 'move' ? 'completed' : 'none' });
    expect(fs.existsSync(project.workspacePath)).toBe(false);
    expect(fs.existsSync(receiptPath)).toBe(false);
    assertBytes(target);
  });

  it('rereads current DB metadata after E2 rejects an external change instead of returning D\'s stale Project', async () => {
    const fired = afterReceiptUpdate((receipt) => receipt.pendingDelete === 0, async () => {
      const current = getProject(database, project.id);
      expect(() => updateProject(database, edit(current, { name: 'blocked service change' }))).toThrow(/移動中/);
      database.prepare('UPDATE projects SET name=?,updated_at=? WHERE id=?').run('external latest metadata', new Date().toISOString(), project.id);
    });
    const result = await move();
    expect(fired()).toBe(true);
    const current = getProject(database, project.id);
    expect(current).toMatchObject({ name: 'external latest metadata', workspacePath: target });
    assertPending(result, current);
    expect(disk()).toMatchObject({ cursor: 0, pendingDelete: 0 });
    assertBytes(project.workspacePath);
    assertBytes(target);
    await expect(recover()).resolves.toEqual({ project: current, cleanupStatus: 'completed' });
    assertUnrelated();
  });

  it('validates IDs and every explicit path/configuration before DB or filesystem I/O', async () => {
    const query = vi.spyOn(database, 'prepare');
    const exec = vi.spyOn(database, 'exec');
    const inspect = vi.spyOn(fs, 'lstatSync').mockImplementation(() => { throw new Error('Unexpected filesystem access'); });
    const asynchronous = vi.spyOn(asyncFs, 'lstat').mockRejectedValue(new Error('Unexpected filesystem access'));
    const open = vi.spyOn(asyncFs, 'open');
    for (const value of [undefined, null, 42, 'not-a-uuid', `${project.id} `]) {
      await expect(moveProject(database, value, destination, receiptDirectory, [original])).rejects.toThrow();
      await expect(recoverProject(database, value, receiptDirectory)).rejects.toThrow();
    }
    const paths: unknown[] = [undefined, null, 42, '', 'relative', 'C:relative', '\\root-relative', parse(directory).root,
      `${destination}\\..\\${basename(destination)}`, `${destination}\\.`, `${destination}\\`, destination.replaceAll('\\', '/'),
      `${destination}\\bad*name`, `${destination}\\NUL`, `${destination}\\CONIN$`, `${destination}\\bad:stream`, `${destination} `,
      `\\\\?\\${destination}`, '\\\\server\\share\\folder', `${destination}\\bad\0name`, `${destination}\\\ud800`, `${destination}\\${'x'.repeat(256)}`];
    for (const value of paths) {
      await expect(moveProject(database, project.id, value as never, receiptDirectory, [original])).rejects.toBeInstanceOf(TypeError);
      await expect(moveProject(database, project.id, destination, value as never, [original])).rejects.toBeInstanceOf(TypeError);
      await expect(recoverProject(database, project.id, value as never)).rejects.toBeInstanceOf(TypeError);
      await expect(moveProject(database, project.id, destination, receiptDirectory, [original, value as never])).rejects.toBeInstanceOf(TypeError);
    }
    for (const value of [destination, join(directory, 'app-data')]) {
      await expect(moveProject(database, project.id, destination, value, [original])).rejects.toBeInstanceOf(TypeError);
      await expect(recoverProject(database, project.id, value)).rejects.toBeInstanceOf(TypeError);
    }
    for (const value of [undefined, null, original, { roots: [original] }]) {
      await expect(moveProject(database, project.id, destination, receiptDirectory, value as never)).rejects.toBeInstanceOf(TypeError);
    }
    for (const operation of [query, exec, inspect, asynchronous, open]) expect(operation).not.toHaveBeenCalled();
  });

  it('does not turn missing Projects or a closed real DB into a fabricated cleanup result', async () => {
    const missingId = 'b66a587d-619c-4cc8-850b-c677f0698311';
    const inspect = vi.spyOn(fs, 'lstatSync');
    const asynchronous = vi.spyOn(asyncFs, 'lstat');
    const open = vi.spyOn(asyncFs, 'open');
    await expect(moveProject(database, missingId, destination, receiptDirectory, [original])).rejects.toThrow(/見つかりません/);
    await expect(recoverProject(database, missingId, receiptDirectory)).rejects.toThrow(/見つかりません/);
    database.close();
    await expect(move()).rejects.toThrow();
    await expect(recover()).rejects.toThrow();
    for (const operation of [inspect, asynchronous, open]) expect(operation).not.toHaveBeenCalled();
    expect(() => projectMove.assertProjectNotMoving(database, project.id)).not.toThrow();
  });

  it.each(['BEGIN DEFERRED', 'BEGIN IMMEDIATE', 'SAVEPOINT caller'])('rejects move/recover inside %s before I/O without ending the caller transaction', async (begin) => {
    database.exec(begin);
    updateProject(database, edit(project, { name: 'caller uncommitted' }));
    const query = vi.spyOn(database, 'prepare');
    const exec = vi.spyOn(database, 'exec');
    const inspect = vi.spyOn(fs, 'lstatSync');
    const asynchronous = vi.spyOn(asyncFs, 'lstat');
    await expect(move()).rejects.toThrow(/transaction/);
    await expect(recover()).rejects.toThrow(/transaction/);
    for (const operation of [query, exec, inspect, asynchronous]) expect(operation).not.toHaveBeenCalled();
    expect(database.inTransaction).toBe(true);
    expect(getProject(database, project.id).name).toBe('caller uncommitted');
    database.exec('ROLLBACK');
    expect(getProject(database, project.id)).toEqual(project);
    expect(fs.readdirSync(destination)).toEqual([]);
    expect(fs.readdirSync(receiptDirectory)).toEqual([]);
  });
});

describe('Project lexical input validation', () => {
  it('validates the complete metadata before any database or filesystem I/O', () => {
    const query = vi.spyOn(database, 'prepare');
    const command = vi.spyOn(database, 'exec');
    const inspect = vi.spyOn(fs, 'lstatSync').mockImplementation(() => { throw new Error('Unexpected filesystem access'); });
    for (const overrides of [{ name: '\u3000' }, { taskType: 'other' }, { description: 42 }, { workspacePath: '' }, { extra: true }]) {
      expect(() => createProject(database, { ...input, ...overrides })).toThrow();
    }
    expect(query).not.toHaveBeenCalled();
    expect(command).not.toHaveBeenCalled();
    expect(inspect).not.toHaveBeenCalled();
  });

  it.each(['relative', 'C:relative', '\\root-relative', 'C:\\', 'C:\\a:stream', '\\\\?\\C:\\folder', 'C:\\line\nfeed'])('rejects unsafe metadata workspace %j', (workspacePath) => {
    const inspect = vi.spyOn(fs, 'lstatSync').mockImplementation(() => { throw new Error('Unexpected filesystem access'); });
    expect(() => createProject(database, { ...input, workspacePath })).toThrow(TypeError);
    expect(inspect).not.toHaveBeenCalled();
    expect(getProjects(database)).toEqual([]);
  });

  it.each(['bad*name', 'bad?name', 'bad"name', 'NUL', 'con.txt', 'COM1', 'LPT².txt', 'trailing.', 'trailing '])('rejects Windows-invalid directory component %j', (name) => {
    const inspect = vi.spyOn(fs, 'lstatSync').mockImplementation(() => { throw new Error('Unexpected filesystem access'); });
    for (const workspacePath of [`C:\\Projects\\${name}`, `\\\\server\\share\\${name}`]) {
      expect(() => createProject(database, { ...input, workspacePath })).toThrow(TypeError);
    }
    expect(inspect).not.toHaveBeenCalled();
    expect(getProjects(database)).toEqual([]);
  });
});