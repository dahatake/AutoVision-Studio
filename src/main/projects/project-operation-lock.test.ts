// @vitest-environment node
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import asyncFs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Project } from '../../shared/contracts/project.js';
import { openDatabase, type DatabaseConnection } from '../db/database.js';
import { migrateDatabase } from '../db/migrate.js';
import * as projectMove from './project-move.js';
import * as receiptStorage from './project-move-receipt.js';
import { assertProjectNotImporting, beginProjectImport, beginProjectMoveActivity } from './project-operation-lock.js';
import { insertProject } from './project-repository.js';
import { createProject, getProject, moveProject, recoverProject, updateProject } from './project-service.js';

const sql = fs.readFileSync(new URL('../db/migrations/001_core.sql', import.meta.url), 'utf8');
let directory: string;
let database: DatabaseConnection;
const id = 'b66a587d-619c-4cc8-850b-c677f0698311';
const edit = (project: Project) => ({ id: project.id.toUpperCase(), name: '更新', description: project.description,
  taskType: project.taskType, workspacePath: project.workspacePath });
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => { resolve = complete; });
  return { promise, resolve };
};

beforeEach(() => {
  directory = fs.realpathSync.native(fs.mkdtempSync(join(tmpdir(), 'autovision-dat08a-')));
  database = openDatabase(join(directory, 'metadata.sqlite3'));
  migrateDatabase(database, [{ version: 1, sql }]);
});
afterEach(() => {
  vi.restoreAllMocks();
  if (database.open) database.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

describe('DAT08A shared Project activity', () => {
  it('normalizes IDs, guards metadata without DB I/O, and keeps stale import releases harmless', () => {
    const project: Project = { id, name: 'Project', description: '', taskType: 'classification',
      workspacePath: `C:\\Projects\\${id}`, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' };
    insertProject(database, project);
    const query = vi.spyOn(database, 'prepare');
    const command = vi.spyOn(database, 'exec');
    const release = beginProjectImport(database, id.toUpperCase());
    expect(() => assertProjectNotImporting(database, id)).toThrow(/取り込み中/);
    expect(() => projectMove.assertProjectNotMoving(database, id)).toThrow(/取り込み中/);
    expect(() => beginProjectImport(database, id)).toThrow(/取り込み中/);
    expect(() => beginProjectMoveActivity(database, id)).toThrow(/取り込み中/);
    expect(() => updateProject(database, edit(project))).toThrow(/取り込み中/);
    expect(query).not.toHaveBeenCalled();
    expect(command).not.toHaveBeenCalled();
    release();
    const next = beginProjectImport(database, id);
    release();
    expect(() => assertProjectNotImporting(database, id)).toThrow(/取り込み中/);
    next();
    expect(updateProject(database, edit(project)).name).toBe('更新');
  });

  it('counts nested moves without duplicating move exclusion, including the high/low gap', () => {
    const high = beginProjectMoveActivity(database, id.toUpperCase());
    const low = beginProjectMoveActivity(database, id);
    expect(() => projectMove.assertProjectNotMoving(database, id)).not.toThrow();
    expect(() => beginProjectImport(database, id)).toThrow(/移動/);
    low();
    low();
    expect(() => beginProjectImport(database, id)).toThrow(/移動/);
    const recovery = beginProjectMoveActivity(database, id);
    high();
    expect(() => beginProjectImport(database, id)).toThrow(/移動/);
    recovery();
    const nextMove = beginProjectMoveActivity(database, id);
    low(); high(); recovery();
    expect(() => beginProjectImport(database, id)).toThrow(/移動/);
    nextMove();
    const importing = beginProjectImport(database, id);
    nextMove();
    expect(() => assertProjectNotImporting(database, id)).toThrow(/取り込み中/);
    importing();
    beginProjectImport(database, id)();
  });

  it('isolates different Projects and real connections, without reading Project rows', () => {
    const otherConnection = openDatabase(join(directory, 'metadata.sqlite3'));
    const query = vi.spyOn(database, 'prepare');
    const command = vi.spyOn(database, 'exec');
    const release = beginProjectMoveActivity(database, id);
    try {
      beginProjectImport(database, randomUUID())();
      beginProjectImport(otherConnection, id)();
      expect(() => beginProjectImport(database, id)).toThrow(/移動/);
      expect(query).not.toHaveBeenCalled();
      expect(command).not.toHaveBeenCalled();
    } finally { release(); otherConnection.close(); }
  });

  it.each([undefined, null, 42, '', 'not-a-uuid', `${id} `])('rejects invalid ID %j without retaining activity', (value) => {
    expect(() => beginProjectImport(database, value)).toThrow();
    expect(() => beginProjectMoveActivity(database, value)).toThrow();
    expect(() => assertProjectNotImporting(database, value)).toThrow();
    beginProjectImport(database, id)();
  });

  it.each(['idle', 'import', 'move'] as const)('rejects foreign transactions before the %s busy cache', (state) => {
    const release = state === 'import' ? beginProjectImport(database, id)
      : state === 'move' ? beginProjectMoveActivity(database, id) : () => {};
    database.exec('BEGIN DEFERRED');
    const query = vi.spyOn(database, 'prepare');
    const command = vi.spyOn(database, 'exec');
    try {
      expect(() => beginProjectImport(database, id)).toThrow(/transaction/);
      expect(database.inTransaction).toBe(true);
      expect(query).not.toHaveBeenCalled();
      expect(command).not.toHaveBeenCalled();
    } finally { database.exec('ROLLBACK'); release(); }
    beginProjectImport(database, id)();
  });
});

describe.skipIf(process.platform !== 'win32')('DAT08A real local move integration', () => {
  let project: Project;
  let other: Project;
  let destination: string;
  let receiptDirectory: string;
  beforeEach(() => {
    const parent = join(directory, 'Projects');
    destination = join(directory, 'Destination');
    receiptDirectory = join(directory, 'app-data', 'project-moves');
    for (const path of [parent, destination, receiptDirectory]) fs.mkdirSync(path, { recursive: true });
    project = createProject(database, { name: '移動', taskType: 'classification', workspacePath: parent });
    other = createProject(database, { name: '独立', taskType: 'classification', workspacePath: parent });
    fs.writeFileSync(join(project.workspacePath, 'data.bin'), 'actual payload');
  });

  it('rejects both move/recovery layers and normal updates before DB/filesystem I/O during import', async () => {
    const release = beginProjectImport(database, project.id.toUpperCase());
    const operations = [vi.spyOn(database, 'prepare'), vi.spyOn(database, 'exec'),
      vi.spyOn(fs, 'lstatSync'), vi.spyOn(fs, 'openSync'), vi.spyOn(fs, 'mkdirSync'),
      vi.spyOn(fs, 'unlinkSync'), vi.spyOn(fs, 'rmdirSync'), vi.spyOn(asyncFs, 'lstat'),
      vi.spyOn(asyncFs, 'open'), vi.spyOn(asyncFs, 'mkdir')];
    try {
      expect(() => updateProject(database, edit(project))).toThrow(/取り込み中/);
      await expect(projectMove.moveProjectDirectory(database, project.id, destination, [], receiptDirectory)).rejects.toThrow(/取り込み中/);
      await expect(projectMove.recoverProjectMove(database, project.id, receiptDirectory)).rejects.toThrow(/取り込み中/);
      await expect(moveProject(database, project.id, destination, receiptDirectory, [])).rejects.toThrow(/取り込み中/);
      await expect(recoverProject(database, project.id, receiptDirectory)).rejects.toThrow(/取り込み中/);
      for (const operation of operations) expect(operation).not.toHaveBeenCalled();
      expect(updateProject(database, edit(other)).name).toBe('更新');
      beginProjectImport(database, other.id)();
      await expect(recoverProject(database, other.id, receiptDirectory)).resolves.toMatchObject({ cleanupStatus: 'none' });
    } finally { release(); }
    expect(getProject(database, project.id)).toEqual(project);
    expect(updateProject(database, edit(project)).name).toBe('更新');
  });

  it('blocks import while a direct move awaits its actual opened writer, then releases', async () => {
    const reached = deferred();
    const gate = deferred();
    const open = asyncFs.open;
    vi.spyOn(asyncFs, 'open').mockImplementation(async (...args) => {
      const handle = await open(...args);
      if (args[0] === join(destination, project.id, 'data.bin') && args[1] === 'wx') {
        reached.resolve();
        await gate.promise;
      }
      return handle;
    });
    const pending = projectMove.moveProjectDirectory(database, project.id, destination, [], receiptDirectory);
    const outcome = pending.then((value) => ({ value, error: undefined }), (error: unknown) => ({ value: undefined, error }));
    try {
      await Promise.race([reached.promise, outcome.then(() => { throw new Error('Move settled before writer gate'); })]);
      expect(() => beginProjectImport(database, project.id.toUpperCase())).toThrow(/移動/);
      beginProjectImport(database, other.id)();
    } finally { gate.resolve(); await outcome; }
    expect((await outcome).error).toBeUndefined();
    expect((await outcome).value?.project.workspacePath).toBe(join(destination, project.id));
    expect(fs.readFileSync(join(destination, project.id, 'data.bin'), 'utf8')).toBe('actual payload');
    beginProjectImport(database, project.id)();
  });

  it.each(['between-steps', 'receipt-write', 'direct-recovery'] as const)('blocks import across %s and releases on completion', async (stage) => {
    if (stage === 'direct-recovery') await projectMove.moveProjectDirectory(database, project.id, destination, [], receiptDirectory);
    const reached = deferred();
    const gate = deferred();
    if (stage === 'between-steps') {
      const actualMove = projectMove.moveProjectDirectory;
      vi.spyOn(projectMove, 'moveProjectDirectory').mockImplementation(async (...args) => {
        const result = await actualMove(...args);
        reached.resolve();
        await gate.promise;
        return result;
      });
    } else {
      const actualUpdate = receiptStorage.updateProjectMoveProgress;
      let fired = false;
      vi.spyOn(receiptStorage, 'updateProjectMoveProgress').mockImplementation(async (...args) => {
        const result = await actualUpdate(...args);
        if (!fired) { fired = true; reached.resolve(); await gate.promise; }
        return result;
      });
    }
    const pending = stage === 'direct-recovery' ? projectMove.recoverProjectMove(database, project.id, receiptDirectory)
      : moveProject(database, project.id, destination, receiptDirectory, []);
    const outcome = pending.then((value) => ({ value, error: undefined }), (error: unknown) => ({ value: undefined, error }));
    try {
      await Promise.race([reached.promise, outcome.then(() => { throw new Error('Operation settled before activity gate'); })]);
      if (stage === 'between-steps') expect(() => projectMove.assertProjectNotMoving(database, project.id)).not.toThrow();
      expect(() => beginProjectImport(database, project.id.toUpperCase())).toThrow(/移動/);
      beginProjectImport(database, other.id)();
    } finally { gate.resolve(); await outcome; }
    expect((await outcome).error).toBeUndefined();
    expect((await outcome).value).toMatchObject(stage === 'direct-recovery' ? { status: 'completed' } : { cleanupStatus: 'completed' });
    expect(fs.existsSync(project.workspacePath)).toBe(false);
    expect(fs.readFileSync(join(destination, project.id, 'data.bin'), 'utf8')).toBe('actual payload');
    beginProjectImport(database, project.id)();
  });
});