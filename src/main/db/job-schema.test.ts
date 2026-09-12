// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { jobIdSchema, jobKindSchema, jobSchema, jobStatusSchema, type Job } from '../../shared/contracts/job.js';
import { openDatabase, type DatabaseConnection } from './database.js';
import { migrateDatabase, type Migration } from './migrate.js';

const migrationsDirectory = join(fileURLToPath(new URL('.', import.meta.url)), 'migrations');
const coreMigration = { version: 1, sql: readFileSync(join(migrationsDirectory, '001_core.sql'), 'utf8') };
const jobsMigration = { version: 2, sql: readFileSync(join(migrationsDirectory, '002_jobs.sql'), 'utf8') };
const history: readonly Migration[] = [coreMigration, jobsMigration];
const projectId = 'ae45cf74-c9f9-4c49-88b9-0523b1ac7383';
const otherProjectId = '49a97b8c-3cb7-4717-a06b-7323175d80d8';
const jobId = 'b27f8095-3a62-4e01-b839-5db1b7028a10';
const otherJobId = 'c83d6390-4b71-41c8-93ed-c65e856b8e49';
const createdAt = '2026-09-11T00:00:00.000Z';
const updatedAt = '2026-09-11T00:01:00.000Z';
const statuses = [
  'Queued', 'Preparing', 'Running', 'Exporting', 'Evaluating',
  'Succeeded', 'Failed', 'Cancelled', 'Interrupted',
] as const;
const kinds = ['scan-dataset', 'assist', 'train'] as const;
const saved: Job = { id: jobId, projectId, kind: 'train', status: 'Queued', createdAt, updatedAt: createdAt };

// Direct, parameterized fixtures: do not use the concurrently edited CORE-06
// createProject service or create any real Project directories/ownership markers.
function insertProject(database: DatabaseConnection, id: string, workspacePath: string) {
  database.prepare('INSERT INTO projects(id,name,task_type,workspace_path,created_at,updated_at) VALUES (?,?,?,?,?,?)')
    .run(id, 'Project 日本語', 'classification', workspacePath, createdAt, createdAt);
}
function insertJob(database: DatabaseConnection, id: string, parentId: string, kind: unknown = 'train', status: unknown = 'Queued') {
  return database.prepare('INSERT INTO jobs(id,project_id,kind,status,created_at,updated_at) VALUES (?,?,?,?,?,?)')
    .run(id, parentId, kind, status, createdAt, createdAt);
}
function readJob(database: DatabaseConnection, id: string): unknown {
  return database.prepare(`SELECT id, project_id AS projectId, kind, status,
    created_at AS createdAt, updated_at AS updatedAt FROM jobs WHERE id=?`).get(id);
}

describe('JOB-01 SQLite lifecycle storage', () => {
  let directory: string;
  let database: DatabaseConnection;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'autovision-job01-'));
    database = openDatabase(join(directory, 'metadata.sqlite3'));
    migrateDatabase(database, [coreMigration]);
  });
  afterEach(() => {
    if (database?.open) database.close();
    rmSync(directory, { recursive: true, force: true });
  });
  function seedProject(id = projectId) {
    insertProject(database, id, join(directory, id));
  }

  it('upgrades 001 to 002 with only empty tables and no automatic jobs/settings', () => {
    expect(database.pragma('user_version', { simple: true })).toBe(1);
    expect(migrateDatabase(database, history)).toBe(2);
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all())
      .toEqual([{ name: 'jobs' }, { name: 'projects' }, { name: 'settings' }]);
    for (const table of ['jobs', 'projects', 'settings']) {
      expect(database.prepare(`SELECT * FROM ${table}`).all()).toEqual([]);
    }
    expect(database.pragma('table_list')).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'jobs', ncol: 6, strict: 1 }),
    ]));
    expect(database.inTransaction).toBe(false);
  });

  it('preserves existing core rows and caller metadata through migration and reopen', () => {
    seedProject();
    database.prepare('INSERT INTO settings(key,value) VALUES (?,?)').run('fixture-setting', '保存値');
    const project = database.prepare('SELECT * FROM projects WHERE id=?').get(projectId);
    migrateDatabase(database, history);
    insertJob(database, jobId, projectId);
    database.close();
    database = openDatabase(join(directory, 'metadata.sqlite3'));
    expect(migrateDatabase(database, history)).toBe(2);
    expect(database.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(database.pragma('user_version', { simple: true })).toBe(2);
    expect(database.prepare('SELECT * FROM projects WHERE id=?').get(projectId)).toEqual(project);
    expect(database.prepare('SELECT * FROM settings').all()).toEqual([{ key: 'fixture-setting', value: '保存値' }]);
    expect(jobSchema.parse(readJob(database, jobId))).toEqual(saved);
    expect(database.prepare('SELECT id FROM jobs').all()).toEqual([{ id: jobId }]);
  });

  it('defaults a new row to Queued without inventing time, progress or task locks', () => {
    migrateDatabase(database, history);
    seedProject();
    database.prepare('INSERT INTO jobs(id,project_id,kind,created_at,updated_at) VALUES (?,?,?,?,?)')
      .run(jobId, projectId, 'train', createdAt, createdAt);
    expect(readJob(database, jobId)).toEqual(saved);
    expect(database.prepare('SELECT task_type_locked FROM projects WHERE id=?').get(projectId))
      .toEqual({ task_type_locked: 0 });
  });

  // Vocabulary checks only, not legal-transition tests (JOB-02).
  it.each(statuses)('stores status %s on inserts and updates', (status) => {
    migrateDatabase(database, history);
    seedProject();
    insertJob(database, jobId, projectId);
    insertJob(database, otherJobId, projectId, 'train', status);
    database.prepare('UPDATE jobs SET status=?,updated_at=? WHERE id=? AND project_id=?')
      .run(status, updatedAt, jobId, projectId);
    expect(jobSchema.parse(readJob(database, jobId))).toEqual({ ...saved, status, updatedAt });
    expect(readJob(database, otherJobId)).toEqual({ ...saved, id: otherJobId, status });
  });

  it.each(kinds)('stores only the planned %s kind without automatically locking Project task type', (kind) => {
    migrateDatabase(database, history);
    seedProject();
    insertJob(database, jobId, projectId, kind);
    expect(jobSchema.parse(readJob(database, jobId))).toEqual({ ...saved, kind });
    expect(database.prepare('SELECT task_type_locked FROM projects WHERE id=?').get(projectId))
      .toEqual({ task_type_locked: 0 });
  });

  it.each(['Pending', 'queued', 'Paused', 'Canceled', '', null])('rejects invalid status %j without changing the stored row', (status) => {
    migrateDatabase(database, history);
    seedProject();
    insertJob(database, jobId, projectId);
    expect(() => insertJob(database, otherJobId, projectId, 'train', status)).toThrow(/CHECK|NOT NULL/);
    expect(() => database.prepare('UPDATE jobs SET status=? WHERE id=?').run(status, jobId)).toThrow(/CHECK|NOT NULL/);
    expect(readJob(database, jobId)).toEqual(saved);
    expect(readJob(database, otherJobId)).toBeUndefined();
  });

  it.each(['scan', 'inference', 'export', 'evaluate', 'schedule', '', null])('rejects unplanned kind %j on insert and update', (kind) => {
    migrateDatabase(database, history);
    seedProject();
    insertJob(database, jobId, projectId);
    expect(() => insertJob(database, otherJobId, projectId, kind)).toThrow(/CHECK|NOT NULL/);
    expect(() => database.prepare('UPDATE jobs SET kind=? WHERE id=?').run(kind, jobId)).toThrow(/CHECK|NOT NULL/);
    expect(readJob(database, jobId)).toEqual(saved);
  });

  it.each(['id', 'project_id', 'kind', 'created_at', 'updated_at'])('requires explicit %s rather than generating it', (missing) => {
    migrateDatabase(database, history);
    seedProject();
    const values: Record<string, string> = { id: jobId, project_id: projectId, kind: 'train', created_at: createdAt, updated_at: createdAt };
    const columns = Object.keys(values).filter((column) => column !== missing);
    expect(() => database.prepare(`INSERT INTO jobs(${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`)
      .run(...columns.map((column) => values[column]))).toThrow(/NOT NULL/);
    expect(database.prepare('SELECT * FROM jobs').all()).toEqual([]);
  });

  it.each(['id', 'created_at', 'updated_at'])('rejects empty %s without replacing valid metadata', (column) => {
    migrateDatabase(database, history);
    seedProject();
    insertJob(database, jobId, projectId);
    expect(() => database.prepare(`UPDATE jobs SET ${column}=? WHERE id=?`).run('', jobId)).toThrow(/CHECK/);
    expect(readJob(database, jobId)).toEqual(saved);
  });

  it('rejects duplicate identities and missing parents, and requires explicit child deletion', () => {
    migrateDatabase(database, history);
    seedProject();
    insertJob(database, jobId, projectId);
    expect(() => insertJob(database, jobId, projectId, 'assist')).toThrow(/UNIQUE/);
    expect(() => insertJob(database, otherJobId, otherProjectId)).toThrow(/FOREIGN KEY/);
    expect(() => database.prepare('UPDATE jobs SET project_id=? WHERE id=?').run(otherProjectId, jobId)).toThrow(/FOREIGN KEY/);
    expect(() => database.prepare('DELETE FROM projects WHERE id=?').run(projectId)).toThrow(/FOREIGN KEY/);
    expect(readJob(database, jobId)).toEqual(saved);
    expect(database.pragma('foreign_key_check')).toEqual([]);
  });

  it('isolates project-scoped reads, updates and explicit deletion', () => {
    migrateDatabase(database, history);
    seedProject();
    seedProject(otherProjectId);
    insertJob(database, jobId, projectId);
    insertJob(database, otherJobId, otherProjectId, 'assist');
    const otherProject = database.prepare('SELECT * FROM projects WHERE id=?').get(otherProjectId);
    const select = database.prepare('SELECT id FROM jobs WHERE project_id=?');
    expect(select.all(projectId)).toEqual([{ id: jobId }]);
    expect(select.all(otherProjectId)).toEqual([{ id: otherJobId }]);
    expect(database.prepare('UPDATE jobs SET status=? WHERE id=? AND project_id=?')
      .run('Cancelled', jobId, otherProjectId).changes).toBe(0);
    expect(readJob(database, jobId)).toEqual(saved);
    database.prepare('DELETE FROM jobs WHERE project_id=?').run(projectId);
    database.prepare('DELETE FROM projects WHERE id=?').run(projectId);
    expect(select.all(projectId)).toEqual([]);
    expect(readJob(database, otherJobId)).toEqual({ ...saved, id: otherJobId, projectId: otherProjectId, kind: 'assist' });
    expect(database.prepare('SELECT * FROM projects WHERE id=?').get(otherProjectId)).toEqual(otherProject);
  });

  it('allows the later Run handoff to commit job creation and Project task lock together', () => {
    migrateDatabase(database, history);
    seedProject();
    database.exec('BEGIN IMMEDIATE');
    try {
      insertJob(database, jobId, projectId);
      database.prepare('UPDATE projects SET task_type_locked=1,updated_at=? WHERE id=?').run(updatedAt, projectId);
      database.exec('COMMIT');
    } finally {
      if (database.inTransaction) database.exec('ROLLBACK');
    }
    expect(readJob(database, jobId)).toEqual(saved);
    expect(database.prepare('SELECT task_type_locked,updated_at FROM projects WHERE id=?').get(projectId))
      .toEqual({ task_type_locked: 1, updated_at: updatedAt });
    expect(database.inTransaction).toBe(false);
  });

  it('rolls back job creation and the caller task lock together on a constraint failure', () => {
    migrateDatabase(database, history);
    seedProject();
    const originalProject = database.prepare('SELECT * FROM projects WHERE id=?').get(projectId);
    expect(() => {
      database.exec('BEGIN IMMEDIATE');
      try {
        database.prepare('UPDATE projects SET task_type_locked=1,updated_at=? WHERE id=?').run(updatedAt, projectId);
        insertJob(database, jobId, projectId);
        insertJob(database, jobId, projectId);
        database.exec('COMMIT');
      } catch (error) {
        if (database.inTransaction) database.exec('ROLLBACK');
        throw error;
      }
    }).toThrow(/UNIQUE/);
    expect(database.inTransaction).toBe(false);
    expect(database.prepare('SELECT * FROM jobs').all()).toEqual([]);
    expect(database.prepare('SELECT * FROM projects WHERE id=?').get(projectId)).toEqual(originalProject);
  });

  it('rolls back migration 002 DDL/indexes/version on failure and can retry after reopening', () => {
    seedProject();
    const originalProject = database.prepare('SELECT * FROM projects WHERE id=?').get(projectId);
    expect(() => migrateDatabase(database, [coreMigration, {
      version: 2, sql: `${jobsMigration.sql}\nCREATE TABLE jobs(id TEXT);`,
    }])).toThrow(/already exists/);
    expect(database.inTransaction).toBe(false);
    database.close();
    database = openDatabase(join(directory, 'metadata.sqlite3'));
    expect(database.pragma('user_version', { simple: true })).toBe(1);
    expect(database.prepare("SELECT name FROM sqlite_master WHERE tbl_name='jobs'").all()).toEqual([]);
    expect(database.prepare('SELECT * FROM projects WHERE id=?').get(projectId)).toEqual(originalProject);
    expect(migrateDatabase(database, history)).toBe(2);
    expect(database.prepare('SELECT * FROM jobs').all()).toEqual([]);
  });
});

describe('JOB-01 strict snapshot contract', () => {
  it('defines exactly the requested statuses and planned command kinds', () => {
    expect(jobStatusSchema.options).toEqual(statuses);
    expect(jobKindSchema.options).toEqual(kinds);
    expect(jobSchema.parse(saved)).toEqual(saved);
  });
  it.each(statuses)('accepts the persisted %s status without implying transition permission', (status) => {
    expect(jobSchema.parse({ ...saved, status })).toEqual({ ...saved, status });
  });
  it.each(kinds)('accepts the %s command kind', (kind) => {
    expect(jobSchema.parse({ ...saved, kind })).toEqual({ ...saved, kind });
  });
  it('normalizes caller UUID case without generating identities', () => {
    expect(jobIdSchema.parse(jobId.toUpperCase())).toBe(jobId);
    expect(jobSchema.parse({ ...saved, id: jobId.toUpperCase(), projectId: projectId.toUpperCase() })).toEqual(saved);
  });
  it.each(['id', 'projectId', 'kind', 'status', 'createdAt', 'updatedAt'])('requires snapshot field %s', (field) => {
    const value: Record<string, unknown> = { ...saved };
    delete value[field];
    expect(jobSchema.safeParse(value).success).toBe(false);
  });
  it.each([
    { id: 'not-a-uuid' }, { id: null }, { id: 42 }, { projectId: 'not-a-uuid' },
    { kind: 'inference' }, { status: 'Paused' }, { status: 'queued' },
    { createdAt: 'yesterday' }, { updatedAt: 123 }, { updatedAt: '2026-02-30T00:00:00.000Z' },
  ])('rejects invalid structural metadata %j', (invalid) => {
    expect(jobSchema.safeParse({ ...saved, ...invalid }).success).toBe(false);
  });
  it.each(['progress', 'request', 'priority', 'retryCount', 'stdout', 'artifactPath', 'modelId'])('rejects unowned field %s rather than silently stripping it', (field) => {
    expect(jobSchema.safeParse({ ...saved, [field]: 'unused' }).success).toBe(false);
  });
  it.each([null, undefined, [], 'job'])('rejects non-object snapshots %j', (value) => {
    expect(jobSchema.safeParse(value).success).toBe(false);
  });
});