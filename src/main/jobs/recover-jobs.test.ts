// @vitest-environment node
import childProcess from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { jobKindSchema, jobSchema, jobStatusSchema, type Job } from '../../shared/contracts/job.js';
import { openDatabase, type DatabaseConnection } from '../db/database.js';
import { migrateDatabase } from '../db/migrate.js';
import { insertJob } from './job-repository.js';
import { recoverJobs } from './recover-jobs.js';

const projectId = 'ae45cf74-c9f9-4c49-88b9-0523b1ac7383';
const otherProjectId = '49a97b8c-3cb7-4717-a06b-7323175d80d8';
const createdAt = '2026-09-12T00:00:00.000Z';
const updatedAt = '2026-09-12T00:00:01.123456Z';
const failureMessage = 'Job restart recovery failed; database outcome may be uncertain.';

describe('JOB06A restart recovery: real STRICT migration 1/2 SQLite', () => {
  let directory: string;
  let path: string;
  let database: DatabaseConnection;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'autovision-job06a-TEST-'));
    path = join(directory, 'metadata.sqlite3');
    database = openDatabase(path);
    const migrations = fileURLToPath(new URL('../db/migrations/', import.meta.url));
    migrateDatabase(database, [1, 2].map((version) => ({ version,
      sql: readFileSync(join(migrations, version === 1 ? '001_core.sql' : '002_jobs.sql'), 'utf8') })));
    for (const id of [projectId, otherProjectId]) {
      database.prepare('INSERT INTO projects(id,name,task_type,workspace_path,created_at,updated_at) VALUES (?,?,?,?,?,?)')
        .run(id, 'TEST', 'classification', join(directory, id), createdAt, createdAt);
    }
    vi.spyOn(childProcess, 'spawn').mockImplementation(() => { throw new Error('Unexpected spawn'); });
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse(createdAt)); // Clock went backwards.
  });
  afterEach(() => {
    expect(childProcess.spawn).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    // Only the test owns fixture transaction cleanup and connection shutdown.
    if (database.open) {
      if (database.inTransaction) database.exec('ROLLBACK');
      database.close();
    }
    rmSync(directory, { recursive: true, force: true });
  });
  function seed(status: Job['status'], kind: Job['kind'] = 'train', parent = projectId): Job {
    const job: Job = { id: randomUUID(), projectId: parent, kind, status: 'Queued', createdAt, updatedAt };
    insertJob(database, job);
    database.prepare('UPDATE jobs SET status=? WHERE id=?').run(status, job.id);
    return { ...job, status };
  }
  function rows(): unknown[] { return database.prepare('SELECT * FROM jobs ORDER BY id').all(); }
  function metadata(): unknown[] { return database.prepare('SELECT * FROM projects ORDER BY id').all(); }

  it('recovers every valid kind/state across two projects after reopen; retains exact fields, freezes, is idempotent', () => {
    const seeded: Job[] = [];
    for (const parent of [projectId, otherProjectId]) {
      for (const kind of jobKindSchema.options) {
        for (const status of jobStatusSchema.options) {
          if (kind !== 'train' && (status === 'Exporting' || status === 'Evaluating')) continue;
          seeded.push(seed(status, kind, parent));
        }
      }
    }
    const original = rows(); const projects = metadata();
    const raw = '{"jobId":"not-a-job","status":"Succeeded","checkpoint":"DO-NOT-OPEN","payload":false}';
    writeFileSync(join(directory, 'request.json'), raw);
    // No per-job request/artifact directories exist. Recovery must not require them.
    database.close(); database = openDatabase(path);
    const result = recoverJobs(database);
    expect(result).toHaveLength(16); // Per project: 3 Running + 3 Preparing + 2 train phases.
    expect(Object.isFrozen(result)).toBe(true);
    for (const job of result) {
      expect(Object.isFrozen(job)).toBe(true);
      const before = seeded.find((value) => value.id === job.id)!;
      expect(job).toEqual({ ...before, status: before.status === 'Running' ? 'Interrupted' : 'Failed',
        updatedAt: '2026-09-12T00:00:01.124Z' });
      expect(Date.parse(job.updatedAt)).toBeGreaterThan(Date.parse(before.updatedAt));
      expect(() => { job.status = 'Succeeded'; }).toThrow(TypeError);
    }
    expect(() => { (result as Job[]).push(seeded[0]); }).toThrow(TypeError);
    const expected = original.map((value) => {
      const row = value as Record<string, unknown>;
      const changed = result.find((job) => job.id === row.id);
      return changed ? { ...row, status: changed.status, updated_at: changed.updatedAt } : row;
    });
    expect(rows()).toEqual(expected); expect(metadata()).toEqual(projects);
    expect(readFileSync(join(directory, 'request.json'), 'utf8')).toBe(raw);
    database.close(); database = openDatabase(path);
    expect(rows()).toEqual(expected);
    const second = recoverJobs(database);
    expect(second).toEqual([]); expect(Object.isFrozen(second)).toBe(true);
    expect(rows()).toEqual(expected); expect(metadata()).toEqual(projects);
    expect(database.inTransaction).toBe(false); expect(database.open).toBe(true);
    expect(database.pragma('user_version', { simple: true })).toBe(2);
  });

  it('returns a frozen empty result without touching metadata for an empty database', () => {
    const projects = metadata(); const result = recoverJobs(database);
    expect(result).toEqual([]); expect(Object.isFrozen(result)).toBe(true);
    expect(metadata()).toEqual(projects); expect(database.inTransaction).toBe(false);
  });

  it.each(['id', 'created_at', 'updated_at'])('rejects malformed stored %s even on an unchanged row, before any UPDATE', (column) => {
    seed('Running'); const bad = seed('Succeeded');
    database.prepare(`UPDATE jobs SET ${column}=? WHERE id=?`).run('PRIVATE_INVALID', bad.id);
    const before = rows(); const nativePrepare = database.prepare.bind(database); const updates = vi.fn();
    vi.spyOn(database, 'prepare').mockImplementation((sql) => {
      if (/^UPDATE jobs/u.test(sql)) updates();
      return nativePrepare(sql);
    });
    expect(() => recoverJobs(database)).toThrow(failureMessage);
    expect(updates).not.toHaveBeenCalled(); expect(rows()).toEqual(before);
    expect(database.inTransaction).toBe(false);
  });

  it.each(['scan-dataset', 'assist'] as const)('rejects both inconsistent %s training-only phases before all writes', (kind) => {
    seed('Running'); seed('Exporting', kind); seed('Evaluating', kind);
    const before = rows();
    expect(() => recoverJobs(database)).toThrow(failureMessage);
    expect(rows()).toEqual(before); expect(database.inTransaction).toBe(false);
  });

  it.each(['9999-12-31T23:59:59.999Z', '9999-12-31T23:59:59.999999Z'])('rejects ISO overflow %s before any UPDATE', (time) => {
    seed('Running'); const last = seed('Preparing');
    database.prepare('UPDATE jobs SET updated_at=? WHERE id=?').run(time, last.id);
    const before = rows(); const nativePrepare = database.prepare.bind(database); const updates = vi.fn();
    vi.spyOn(database, 'prepare').mockImplementation((sql) => {
      if (/^UPDATE jobs/u.test(sql)) updates();
      return nativePrepare(sql);
    });
    expect(() => recoverJobs(database)).toThrow(failureMessage);
    expect(updates).not.toHaveBeenCalled(); expect(rows()).toEqual(before);
  });

  it('rolls back the entire batch when a real SQL trigger aborts its second UPDATE', () => {
    seed('Running'); seed('Preparing'); seed('Evaluating'); const before = rows();
    database.exec(`CREATE TEMP TABLE recovery_counter(n INTEGER) STRICT;
      INSERT INTO recovery_counter VALUES (0);
      CREATE TEMP TRIGGER recovery_abort BEFORE UPDATE ON jobs BEGIN
        UPDATE recovery_counter SET n=n+1;
        SELECT CASE WHEN (SELECT n FROM recovery_counter)=2 THEN RAISE(ABORT,'PRIVATE_SQL') END;
      END;`);
    expect(() => recoverJobs(database)).toThrow(failureMessage);
    expect(rows()).toEqual(before); expect(database.inTransaction).toBe(false);
    expect(database.prepare('SELECT n FROM recovery_counter').get()).toEqual({ n: 0 });
  });

  it('rejects a real CAS miss and rolls back earlier writes', () => {
    seed('Running'); seed('Preparing'); const before = rows();
    database.exec(`CREATE TEMP TRIGGER recovery_ignore BEFORE UPDATE ON jobs
      WHEN OLD.status='Preparing' BEGIN SELECT RAISE(IGNORE); END;`);
    expect(() => recoverJobs(database)).toThrow(failureMessage);
    expect(rows()).toEqual(before); expect(database.inTransaction).toBe(false);
  });

  it('never reports success after COMMIT loses acknowledgement; committed rows survive reopen without autorun', () => {
    seed('Running'); seed('Exporting'); const nativeExec = database.exec.bind(database);
    const spy = vi.spyOn(database, 'exec').mockImplementation((sql) => {
      const result = nativeExec(sql);
      if (sql === 'COMMIT') throw new Error('PRIVATE_COMMIT_ACK');
      return result;
    });
    expect(() => recoverJobs(database)).toThrow(failureMessage);
    expect(database.inTransaction).toBe(false); expect(database.open).toBe(true);
    spy.mockRestore(); database.close(); database = openDatabase(path);
    expect(database.prepare('SELECT status FROM jobs ORDER BY status').all())
      .toEqual([{ status: 'Failed' }, { status: 'Interrupted' }]);
    expect(recoverJobs(database)).toEqual([]);
  });

  it.each(['COMMIT', 'SAVEPOINT', 'BEGIN'] as const)('preserves a foreign BEGIN during the %s wrapper', (point) => {
    seed('Running'); const nativeExec = database.exec.bind(database);
    const spy = vi.spyOn(database, 'exec').mockImplementation((sql) => {
      const result = nativeExec(sql);
      if (sql === point || (point === 'SAVEPOINT' && sql.startsWith('SAVEPOINT '))
        || (point === 'BEGIN' && sql === 'BEGIN IMMEDIATE')) {
        if (point !== 'COMMIT') nativeExec('COMMIT');
        nativeExec('BEGIN IMMEDIATE');
        database.prepare('INSERT INTO settings(key,value) VALUES (?,?)').run('caller-owned', 'retained');
        throw new Error('PRIVATE_FOREIGN_TX');
      }
      return result;
    });
    expect(() => recoverJobs(database)).toThrow(failureMessage);
    expect(database.inTransaction).toBe(true);
    expect(database.prepare('SELECT value FROM settings WHERE key=?').get('caller-owned')).toEqual({ value: 'retained' });
    expect(database.prepare('SELECT status FROM jobs').get()).toEqual({ status: point === 'COMMIT' ? 'Interrupted' : 'Running' });
    spy.mockRestore(); nativeExec('COMMIT');
    expect(database.prepare('SELECT value FROM settings WHERE key=?').get('caller-owned')).toEqual({ value: 'retained' });
  });

  it('refuses a caller transaction before any SQL query or exec and leaves it intact', () => {
    seed('Running'); database.exec('BEGIN IMMEDIATE');
    database.prepare("UPDATE projects SET name='caller-owned' WHERE id=?").run(projectId);
    const prepare = vi.spyOn(database, 'prepare'); const exec = vi.spyOn(database, 'exec');
    const pragma = vi.spyOn(database, 'pragma');
    expect(() => recoverJobs(database)).toThrow('Job restart recovery requires no existing transaction.');
    expect(prepare).not.toHaveBeenCalled(); expect(exec).not.toHaveBeenCalled(); expect(pragma).not.toHaveBeenCalled();
    expect(database.inTransaction).toBe(true);
    expect(database.prepare('SELECT name FROM projects WHERE id=?').get(projectId)).toEqual({ name: 'caller-owned' });
  });

  it('does not guess ownership when savepoint creation fails', () => {
    seed('Running'); const before = rows(); const nativeExec = database.exec.bind(database);
    vi.spyOn(database, 'exec').mockImplementation((sql) => {
      if (sql.startsWith('SAVEPOINT ')) throw new Error('PRIVATE_SAVEPOINT');
      return nativeExec(sql);
    });
    expect(() => recoverJobs(database)).toThrow(failureMessage);
    expect(database.inTransaction).toBe(true); expect(rows()).toEqual(before);
  });

  it('fails safely on a real read-only connection without inventing a DatabaseConnection readonly property', () => {
    seed('Running'); const before = rows(); database.close();
    const NativeDatabase = createRequire(import.meta.url)('better-sqlite3') as new (
      filename: string, options: { readonly: boolean; fileMustExist: boolean }
    ) => DatabaseConnection;
    database = new NativeDatabase(path, { readonly: true, fileMustExist: true });
    expect(() => recoverJobs(database)).toThrow(failureMessage);
    expect(rows()).toEqual(before); expect(database.open).toBe(true);
  });

  it('confirms the persisted contract is strict but does not itself reject kind/state inconsistency', () => {
    const job = seed('Exporting', 'assist');
    expect(jobSchema.safeParse(job).success).toBe(true);
    expect(jobSchema.safeParse({ ...job, checkpoint: 'fake' }).success).toBe(false);
    expect(() => recoverJobs(database)).toThrow(failureMessage);
  });
});