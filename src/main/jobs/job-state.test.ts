// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { jobSchema, jobStatusSchema, type Job, type JobKind, type JobStatus } from '../../shared/contracts/job.js';
import { openDatabase, type DatabaseConnection } from '../db/database.js';
import { migrateDatabase } from '../db/migrate.js';
import { findJob, insertJob, listJobs, transitionJob } from './job-repository.js';
import { assertJobTransition, canTransitionJob, isTerminalJobStatus } from './job-state.js';

// Fixed production migrations only: no directory discovery or CORE-06 services.
const migrations = [
  { version: 1, sql: readFileSync(new URL('../db/migrations/001_core.sql', import.meta.url), 'utf8') },
  { version: 2, sql: readFileSync(new URL('../db/migrations/002_jobs.sql', import.meta.url), 'utf8') },
];
const projectId = 'ae45cf74-c9f9-4c49-88b9-0523b1ac7383';
const otherProjectId = '49a97b8c-3cb7-4717-a06b-7323175d80d8';
const jobId = 'b27f8095-3a62-4e01-b839-5db1b7028a10';
const otherJobId = 'c83d6390-4b71-41c8-93ed-c65e856b8e49';
const absentId = 'd83d6390-4b71-41c8-93ed-c65e856b8e49';
const kinds = ['scan-dataset', 'assist', 'train'] as const;
const statuses = ['Queued', 'Preparing', 'Running', 'Exporting', 'Evaluating', 'Succeeded', 'Failed', 'Cancelled', 'Interrupted'] as const;
// Independent test oracle: RD §10, with conditional resume deliberately closed.
const commonEdges = [
  'Queued:Preparing', 'Queued:Cancelled', 'Preparing:Running',
  'Preparing:Failed', 'Preparing:Cancelled', 'Running:Interrupted',
  'Running:Failed', 'Running:Cancelled', 'Interrupted:Cancelled',
];
function allowed(kind: JobKind, from: JobStatus, to: JobStatus): boolean {
  const edges = kind === 'train'
    ? [...commonEdges, 'Running:Exporting', 'Exporting:Evaluating', 'Exporting:Failed', 'Evaluating:Succeeded', 'Evaluating:Failed']
    : [...commonEdges, 'Running:Succeeded'];
  return edges.includes(`${from}:${to}`);
}

describe.each(kinds)('JOB-02 %s ordinary transition matrix', (kind) => {
  it.each(statuses.flatMap((from) => statuses.map((to) => ({ from, to }))))('$from -> $to', ({ from, to }) => {
    expect(canTransitionJob(kind, from, to)).toBe(allowed(kind, from, to));
    if (allowed(kind, from, to)) expect(() => assertJobTransition(kind, from, to)).not.toThrow();
    else expect(() => assertJobTransition(kind, from, to)).toThrow('Job transition is not allowed.');
  });
});

describe('JOB-02 state membership versus permission', () => {
  it.each(statuses)('classifies %s without making Interrupted terminal or resumable', (status) => {
    expect(jobStatusSchema.safeParse(status).success).toBe(true);
    expect(isTerminalJobStatus(status)).toBe(['Succeeded', 'Failed', 'Cancelled'].includes(status));
    for (const kind of kinds) {
      expect(canTransitionJob(kind, 'Interrupted', 'Running')).toBe(false);
      expect(canTransitionJob(kind, 'Cancelled', status)).toBe(false);
    }
  });
  it.each([null, undefined, '', 'queued', 'Paused', 'constructor', '__proto__', 1, {}, []])('rejects unknown membership %j', (value) => {
    expect(isTerminalJobStatus(value)).toBe(false);
    expect(canTransitionJob(value, 'Queued', 'Preparing')).toBe(false);
    expect(canTransitionJob('train', value, 'Preparing')).toBe(false);
    expect(canTransitionJob('train', 'Queued', value)).toBe(false);
  });
});

describe('JOB-02 real SQLite repository', () => {
  let directory: string;
  let database: DatabaseConnection;
  let saved: Job;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'autovision-job02-'));
    database = openDatabase(join(directory, 'metadata.sqlite3'));
    migrateDatabase(database, migrations);
    const now = new Date().toISOString(); // caller-supplied real clock, no fake timers
    saved = { id: jobId, projectId, kind: 'train', status: 'Queued', createdAt: now, updatedAt: now };
    for (const id of [projectId, otherProjectId]) {
      database.prepare('INSERT INTO projects(id,name,task_type,workspace_path,created_at,updated_at) VALUES (?,?,?,?,?,?)')
        .run(id, 'Job fixture 日本語', 'classification', join(directory, id), now, now);
    }
  });
  afterEach(() => {
    if (database?.open) database.close();
    rmSync(directory, { recursive: true, force: true });
  });
  function rawRows(): unknown[] {
    return database.prepare('SELECT * FROM jobs ORDER BY id').all();
  }
  function rawProjects(): unknown[] {
    return database.prepare('SELECT * FROM projects ORDER BY id').all();
  }
  function reopen() {
    database.close();
    database = openDatabase(join(directory, 'metadata.sqlite3'));
  }

  it.each(kinds)('round-trips %s snapshots without changing Project locks or caller timestamps', (kind) => {
    const projects = rawProjects();
    const input = { ...saved, kind };
    insertJob(database, input);
    expect(findJob(database, projectId, jobId)).toEqual(input);
    expect(rawProjects()).toEqual(projects);
    expect(database.inTransaction).toBe(false);
    const updatedAt = new Date().toISOString();
    expect(transitionJob(database, input, 'Preparing', updatedAt)).toBe(true);
    expect(findJob(database, projectId, jobId)).toEqual({ ...input, status: 'Preparing', updatedAt });
    expect(rawProjects()).toEqual(projects);
    reopen();
    expect(database.pragma('user_version', { simple: true })).toBe(2);
    expect(findJob(database, projectId, jobId)).toEqual({ ...input, status: 'Preparing', updatedAt });
  });

  it.each(kinds)('enforces every %s transition in SQL without side effects on rejection', (kind) => {
    insertJob(database, { ...saved, kind });
    const projects = rawProjects();
    for (const from of statuses) {
      for (const to of statuses) {
        // Simulate any JOB-01 persisted status, including unreachable kind/status
        // combinations. Snapshot acceptance must not grant transition permission.
        database.prepare('UPDATE jobs SET status=?,updated_at=? WHERE id=? AND project_id=?')
          .run(from, saved.updatedAt, jobId, projectId);
        const expected = { ...saved, kind, status: from };
        expect(findJob(database, projectId, jobId)).toEqual(expected);
        const before = rawRows();
        const now = new Date().toISOString();
        if (allowed(kind, from, to)) {
          expect(transitionJob(database, expected, to, now)).toBe(true);
          expect(findJob(database, projectId, jobId)).toEqual({ ...expected, status: to, updatedAt: now });
        } else {
          expect(() => transitionJob(database, expected, to, now)).toThrow('Job transition is not allowed.');
          expect(rawRows()).toEqual(before);
        }
      }
    }
    expect(rawProjects()).toEqual(projects);
  });

  it.each(statuses.filter((status) => status !== 'Queued'))('rejects %s creation instead of bypassing the state machine', (status) => {
    expect(() => insertJob(database, { ...saved, status })).toThrow('New jobs must be Queued.');
    expect(rawRows()).toEqual([]);
  });

  it('rejects duplicate IDs and absent parents without replacing existing jobs', () => {
    insertJob(database, saved);
    const before = rawRows();
    expect(() => insertJob(database, { ...saved, kind: 'assist' })).toThrow();
    expect(() => insertJob(database, { ...saved, id: otherJobId, projectId: absentId })).toThrow();
    expect(rawRows()).toEqual(before);
  });

  it('normalizes UUID case, isolates Projects, and rejects missing/foreign/wrong-kind CAS', () => {
    insertJob(database, { ...saved, id: jobId.toUpperCase(), projectId: projectId.toUpperCase() });
    const other = { ...saved, id: otherJobId, projectId: otherProjectId, kind: 'assist' as const };
    insertJob(database, other);
    const before = rawRows();
    expect(findJob(database, projectId.toUpperCase(), jobId.toUpperCase())).toEqual(saved);
    expect(findJob(database, otherProjectId, jobId)).toBeUndefined();
    expect(findJob(database, projectId, absentId)).toBeUndefined();
    expect(listJobs(database, otherProjectId)).toEqual([other]);
    expect(listJobs(database, absentId)).toEqual([]);
    for (const expected of [
      { ...saved, projectId: otherProjectId }, { ...saved, id: absentId },
      { ...saved, kind: 'assist' as const },
    ]) expect(transitionJob(database, expected, 'Preparing', new Date().toISOString())).toBe(false);
    expect(rawRows()).toEqual(before);
  });

  it('gives only one competing SQLite connection the expected-status CAS', () => {
    insertJob(database, saved);
    const second = openDatabase(join(directory, 'metadata.sqlite3'));
    try {
      // Both readers observe the same version before either writer changes it.
      const firstExpected = jobSchema.parse(findJob(database, projectId, jobId));
      const secondExpected = jobSchema.parse(findJob(second, projectId, jobId));
      const now = new Date().toISOString();
      expect(transitionJob(database, firstExpected, 'Preparing', now)).toBe(true);
      const before = rawRows();
      expect(transitionJob(second, secondExpected, 'Cancelled', now)).toBe(false);
      expect(rawRows()).toEqual(before);
      const current = jobSchema.parse(findJob(second, projectId, jobId));
      expect(transitionJob(second, current, 'Cancelled', now)).toBe(true);
      expect(() => transitionJob(database, { ...current, status: 'Cancelled' }, 'Running', now)).toThrow();
    } finally {
      second.close();
    }
  });

  it('compares both persisted timestamps, not just a status that happens to match', () => {
    insertJob(database, saved);
    const before = rawRows();
    // Alternate ISO spelling is a deliberately stale snapshot, not a new clock.
    const different = saved.createdAt.replace(/\.\d{3}Z$/, 'Z');
    for (const expected of [{ ...saved, createdAt: different }, { ...saved, updatedAt: different }]) {
      expect(transitionJob(database, expected, 'Preparing', new Date().toISOString())).toBe(false);
    }
    expect(rawRows()).toEqual(before);
  });

  it('keeps equal-time history deterministic by ID across updates and reopen', () => {
    insertJob(database, { ...saved, id: otherJobId });
    insertJob(database, saved);
    expect(listJobs(database, projectId).map((job) => job.id)).toEqual([jobId, otherJobId]);
    expect(transitionJob(database, saved, 'Preparing', new Date().toISOString())).toBe(true);
    reopen();
    expect(listJobs(database, projectId).map((job) => job.id)).toEqual([jobId, otherJobId]);
  });

  describe('adversarial A3-03 listJobs history timestamp ordering', () => {
    // This is the history API only, not a worker scheduling or FIFO claim.
    function expectHistoryOrder(expected: readonly [Job, Job]): void {
      for (const snapshot of expected) {
        // Prove both timestamp spellings are accepted without normalization.
        expect(jobSchema.safeParse(snapshot)).toEqual({ success: true, data: snapshot });
      }
      // Reverse insertion prevents insertion order from satisfying the oracle.
      insertJob(database, expected[1]);
      insertJob(database, expected[0]);
      const expectedById = [...expected].sort((a, b) => a.id.localeCompare(b.id));
      const rawTimestamps = expectedById.map(({ id, createdAt, updatedAt }) => ({
        id, created_at: createdAt, updated_at: updatedAt,
      }));
      function readHistory(): string[] {
        const history = listJobs(database, projectId);
        // Compare a copy by ID so the actual history order remains observable.
        expect([...history].sort((a, b) => a.id.localeCompare(b.id))).toEqual(expectedById);
        expect(database.prepare('SELECT id,created_at,updated_at FROM jobs ORDER BY id').all())
          .toEqual(rawTimestamps);
        return history.map((job) => job.id);
      }
      const beforeReopen = readHistory();
      reopen();
      const afterReopen = readHistory();
      // Check preservation on both reads before asserting chronological ordering.
      const expectedIds = expected.map((job) => job.id);
      expect(beforeReopen).toEqual(expectedIds);
      expect(afterReopen).toEqual(expectedIds);
    }

    it('orders Z before .100Z despite opposite lexical order', () => {
      const a = '2026-09-12T10:00:00Z';
      const b = '2026-09-12T10:00:00.100Z';
      expect(a > b).toBe(true); // Lexical order is the opposite of chronological order.
      expectHistoryOrder([
        { ...saved, id: jobId, createdAt: a, updatedAt: a },
        { ...saved, id: otherJobId, createdAt: b, updatedAt: b },
      ]);
    });

    it('distinguishes .000001Z from .000002Z without a false millisecond tie', () => {
      const earlier = '2026-09-12T10:00:00.000001Z';
      const later = '2026-09-12T10:00:00.000002Z';
      // Earlier has the larger ID: millisecond truncation plus ID sorting is wrong.
      expectHistoryOrder([
        { ...saved, id: otherJobId, createdAt: earlier, updatedAt: earlier },
        { ...saved, id: jobId, createdAt: later, updatedAt: later },
      ]);
    });

    it('breaks the .1Z/.100Z same-instant tie by ID', () => {
      const a = '2026-09-12T10:00:00.1Z';
      const b = '2026-09-12T10:00:00.100Z';
      // Equal instants retain distinct spellings; the smaller ID must win.
      expect(a > b).toBe(true);
      expectHistoryOrder([
        { ...saved, id: jobId, createdAt: a, updatedAt: a },
        { ...saved, id: otherJobId, createdAt: b, updatedAt: b },
      ]);
    });

    it('orders accepted minute-only timestamps before fractional seconds', () => {
      const earlier = '2026-09-12T10:00Z';
      const later = '2026-09-12T10:00:00.100Z';
      expectHistoryOrder([
        { ...saved, id: otherJobId, createdAt: earlier, updatedAt: earlier },
        { ...saved, id: jobId, createdAt: later, updatedAt: later },
      ]);
    });

    it.each(['2026-09-12T10:00:00Z', '2026-09-12T10:00:00.000Z'])(
      'breaks accepted minute-only/%s same-instant ties by ID', (withSeconds) => {
        const minuteOnly = '2026-09-12T10:00Z';
        expectHistoryOrder([
          { ...saved, id: jobId, createdAt: minuteOnly, updatedAt: minuteOnly },
          { ...saved, id: otherJobId, createdAt: withSeconds, updatedAt: withSeconds },
        ]);
      },
    );

    it('keeps original list timestamps for exact snapshot CAS', () => {
      const input = { ...saved, createdAt: '2026-09-12T10:00Z', updatedAt: '2026-09-12T10:00:00.1Z' };
      insertJob(database, input);
      const [snapshot] = listJobs(database, projectId);
      expect(snapshot).toEqual(input);
      const before = rawRows();
      const updatedAt = '2026-09-12T10:00:00.100001Z';
      for (const stale of [
        { ...input, createdAt: '2026-09-12T10:00:00Z' },
        { ...input, updatedAt: '2026-09-12T10:00:00.100Z' },
      ]) expect(transitionJob(database, stale, 'Preparing', updatedAt)).toBe(false);
      expect(rawRows()).toEqual(before);
      expect(transitionJob(database, jobSchema.parse(snapshot), 'Preparing', updatedAt)).toBe(true);
      const current = { ...input, status: 'Preparing', updatedAt };
      expect(listJobs(database, projectId)).toEqual([current]);
      reopen();
      expect(findJob(database, projectId, jobId)).toEqual(current);
    });
  });

  it.each([
    { id: "' OR 1=1 --" }, { projectId: "'; DROP TABLE jobs; --" },
    { kind: 'constructor' }, { status: 'Paused' }, { createdAt: 'yesterday' },
    { updatedAt: '2026-02-30T00:00:00Z' }, { updatedAt: null },
    { progress: 100 }, { request: {} },
  ])('rejects bad snapshot %j before insert or CAS writes', (invalid) => {
    insertJob(database, saved);
    const before = rawRows();
    const projects = rawProjects();
    const input = { ...saved, id: otherJobId, ...invalid } as unknown as Job;
    expect(() => insertJob(database, input)).toThrow();
    expect(() => transitionJob(database, input, 'Preparing', new Date().toISOString())).toThrow();
    expect(rawRows()).toEqual(before);
    expect(rawProjects()).toEqual(projects);
  });

  it.each([null, undefined, [], 'job', {}])('rejects non-snapshots and missing fields %j', (input) => {
    expect(() => insertJob(database, input as unknown as Job)).toThrow();
    expect(() => transitionJob(database, input as unknown as Job, 'Preparing', new Date().toISOString())).toThrow();
    expect(rawRows()).toEqual([]);
  });

  it('rejects injection in read scopes, expected status, next status and updatedAt', () => {
    insertJob(database, saved);
    const before = rawRows();
    const attack = "' OR 1=1; DROP TABLE jobs; --";
    expect(() => findJob(database, attack, jobId)).toThrow();
    expect(() => findJob(database, projectId, attack)).toThrow();
    expect(() => listJobs(database, attack)).toThrow();
    expect(() => transitionJob(database, { ...saved, status: attack as JobStatus }, 'Preparing', saved.updatedAt)).toThrow();
    expect(() => transitionJob(database, saved, attack as JobStatus, saved.updatedAt)).toThrow();
    expect(() => transitionJob(database, saved, 'Preparing', attack)).toThrow();
    expect(rawRows()).toEqual(before);
  });

  it('rejects corrupt stored timestamps instead of filling them with the current time', () => {
    insertJob(database, saved);
    database.prepare('UPDATE jobs SET updated_at=? WHERE id=? AND project_id=?').run('not-a-date', jobId, projectId);
    const before = rawRows();
    expect(() => findJob(database, projectId, jobId)).toThrow();
    expect(() => listJobs(database, projectId)).toThrow();
    expect(transitionJob(database, saved, 'Preparing', new Date().toISOString())).toBe(false);
    expect(rawRows()).toEqual(before);
  });

  it('joins the caller transaction for atomic train insertion/lock and does not commit it', () => {
    database.exec('BEGIN IMMEDIATE');
    try {
      insertJob(database, saved);
      database.prepare('UPDATE projects SET task_type_locked=1 WHERE id=?').run(projectId);
      expect(database.inTransaction).toBe(true);
      database.exec('COMMIT');
    } finally {
      if (database.inTransaction) database.exec('ROLLBACK');
    }
    reopen();
    expect(findJob(database, projectId, jobId)).toEqual(saved);
    expect(database.prepare('SELECT task_type_locked FROM projects WHERE id=?').get(projectId)).toEqual({ task_type_locked: 1 });
    expect(database.prepare('SELECT task_type_locked FROM projects WHERE id=?').get(otherProjectId)).toEqual({ task_type_locked: 0 });
  });

  it('leaves rollback ownership to the caller after a failed insert, preserving core rows on reopen', () => {
    const projects = rawProjects();
    database.exec('BEGIN IMMEDIATE');
    try {
      database.prepare('UPDATE projects SET task_type_locked=1 WHERE id=?').run(projectId);
      insertJob(database, saved);
      expect(() => insertJob(database, saved)).toThrow();
      expect(database.inTransaction).toBe(true);
    } finally {
      database.exec('ROLLBACK');
    }
    reopen();
    expect(rawRows()).toEqual([]);
    expect(rawProjects()).toEqual(projects);
  });

  it('rolls back a successful CAS with the enclosing transaction', () => {
    insertJob(database, saved);
    database.exec('BEGIN IMMEDIATE');
    try {
      expect(transitionJob(database, saved, 'Preparing', new Date().toISOString())).toBe(true);
      expect(database.inTransaction).toBe(true);
    } finally {
      database.exec('ROLLBACK');
    }
    reopen();
    expect(findJob(database, projectId, jobId)).toEqual(saved);
  });
});