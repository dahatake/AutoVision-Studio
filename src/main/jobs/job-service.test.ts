// @vitest-environment node
import childProcess from 'node:child_process';
import type { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Job } from '../../shared/contracts/job.js';
import { parseWorkerCancelLine, parseWorkerRequest } from '../../shared/contracts/worker.js';
import { openDatabase, type DatabaseConnection } from '../db/database.js';
import { migrateDatabase } from '../db/migrate.js';
import { insertJob } from './job-repository.js';
import { createJobService, type JobLaunchConfiguration, type JobService, type JobSnapshot } from './job-service.js';

const projectId = 'ae45cf74-c9f9-4c49-88b9-0523b1ac7383';
const otherProjectId = '49a97b8c-3cb7-4717-a06b-7323175d80d8';
const jobId = 'b27f8095-3a62-4e01-b839-5db1b7028a10';
const createdAt = '2026-09-12T00:00:00.000Z';
const payload = { taskType: 'classification', mode: 'copy', source: { format: 'folder', root: 'C:\\scan-input' } };
const nativeSpawn = childProcess.spawn.bind(childProcess);
// Fixed Main argv to real Node; fixture only, never a production command/model.
const prelude = `
const fs = require('node:fs'); const path = require('node:path');
const request = JSON.parse(fs.readFileSync(process.argv[4], 'utf8'));
if (process.argv.length !== 5 || process.argv[2] !== 'scan-dataset' || process.argv[3] !== '--request') process.exit(93);
const root = path.dirname(process.argv[4]);
const send = fields => process.stdout.write(JSON.stringify({schemaVersion:1,jobId:request.jobId,projectId:request.projectId,...fields})+'\\n');
const begin = () => send({type:'started'});
const progress = () => send({type:'progress',source:'actual',processed:1,total:1});
const complete = () => { fs.writeFileSync(path.join(root,'result.json'),'{"opaque":true}',{flag:'wx'}); send({type:'completed',resultManifest:'result.json'}); };
setTimeout(()=>process.exit(94),4000).unref();
`;
const waitForCancel = `
let control=''; process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk=>control+=chunk);
process.stdin.on('end',()=>{fs.writeFileSync(path.join(root,'cancel.ndjson'),control);send({type:'warning',code:'CANCELLED'});});
begin(); progress();
`;
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('JOB05A test deadline exceeded.')), 6_000);
    })]);
  } finally { clearTimeout(timer); }
}

describe('JOB05A Main scan lifecycle with native SQLite and Node transport', () => {
  let directory: string;
  let database: DatabaseConnection;
  let service: JobService | undefined;
  let config: JobLaunchConfiguration;
  let closes: Promise<void>[];
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'autovision-job05a-TEST-'));
    database = openDatabase(join(directory, 'metadata.sqlite3'));
    const migrations = fileURLToPath(new URL('../db/migrations/', import.meta.url));
    migrateDatabase(database, [1, 2].map((version) => ({ version,
      sql: readFileSync(join(migrations, version === 1 ? '001_core.sql' : '002_jobs.sql'), 'utf8') })));
    for (const id of [projectId, otherProjectId]) {
      database.prepare('INSERT INTO projects(id,name,task_type,workspace_path,created_at,updated_at) VALUES (?,?,?,?,?,?)')
        .run(id, 'TEST', 'classification', join(directory, id), createdAt, createdAt);
    }
    mkdirSync(join(directory, 'tasks'));
    config = { executablePath: process.execPath, argsPrefix: [join(directory, 'fixture.cjs')],
      taskRoot: join(directory, 'tasks'), policy: { timeoutMs: 3_000, cancelGraceMs: 250,
        closeTimeoutMs: 1_000, maxStdoutBytes: 65_536, maxManifestBytes: 65_536 } };
    service = undefined; closes = [];
    vi.spyOn(childProcess, 'spawn').mockImplementation((file, args, options) => {
      const child = nativeSpawn(file, args, options);
      closes.push(new Promise<void>((resolve) => child.once('close', () => resolve())));
      return child;
    });
  });
  afterEach(async () => {
    // Tests alone own their fixture DB/TX/files. Never clean up before native close.
    if (database.inTransaction) database.exec('ROLLBACK');
    if (service) await bounded(service.shutdown()).catch(() => undefined);
    await bounded(Promise.all(closes));
    database.close(); rmSync(directory, { recursive: true, force: true }); vi.restoreAllMocks();
  });
  function create(body = 'begin(); progress(); complete();'): JobService {
    writeFileSync(config.argsPrefix[0], prelude + body, 'utf8');
    service = createJobService(database, config);
    return service;
  }
  function seed(status: Job['status'] = 'Queued', kind: Job['kind'] = 'scan-dataset'): Job {
    const job: Job = { id: jobId, projectId, kind, status: 'Queued', createdAt, updatedAt: createdAt };
    insertJob(database, job);
    database.prepare('UPDATE jobs SET status=? WHERE id=?').run(status, job.id);
    return { ...job, status };
  }

  it('persists Preparing before async spawn; real started/progress; opaque manifest never auto-succeeds', async () => {
    const jobs = create(); const events: JobSnapshot[] = [];
    jobs.subscribe(projectId, (value) => events.push(value));
    const foreign = vi.fn(); jobs.subscribe(otherProjectId, foreign);
    const run = jobs.startScan(projectId.toUpperCase(), payload);
    expect(run.job.status).toBe('Preparing'); expect(childProcess.spawn).not.toHaveBeenCalled();
    expect(database.inTransaction).toBe(false);
    expect(() => jobs.completeScan(projectId, run.job.id)).toThrow(expect.objectContaining({ code: 'JOB_STATE' }));
    expect(jobs.get(otherProjectId, run.job.id)).toBeUndefined(); expect(jobs.list(otherProjectId)).toEqual([]);
    const result = await bounded(run.donePromise);
    expect(result).toEqual({ type: 'completed', manifestPath: join(config.taskRoot, run.job.id, 'result.json') });
    expect(jobs.get(projectId, run.job.id)?.status).toBe('Running');
    expect(events.map((value) => value.job.status)).toEqual(['Preparing', 'Running', 'Running', 'Running']);
    expect(jobs.getSnapshot(projectId, run.job.id)).toMatchObject({ workerCompleted: true,
      progress: { source: 'actual', processed: 1, total: 1, projectId, jobId: run.job.id } });
    expect(events.every((value) => Object.isFrozen(value) && Object.isFrozen(value.job)
      && (value.progress === null || Object.isFrozen(value.progress)))).toBe(true);
    expect(JSON.stringify(events)).not.toContain(directory); expect(foreign).not.toHaveBeenCalled();
    expect(parseWorkerRequest(readFileSync(join(config.taskRoot, run.job.id, 'request.json'))))
      .toMatchObject({ jobId: run.job.id, projectId, kind: 'scan-dataset', payload });
    expect(jobs.completeScan(projectId, run.job.id).status).toBe('Succeeded');
    expect(jobs.cancel(projectId, run.job.id).status).toBe('Succeeded');
    expect(jobs.getSnapshot(projectId, run.job.id)?.progress).toBeNull();
    expect(() => jobs.completeScan(projectId, run.job.id)).toThrow(expect.objectContaining({ code: 'JOB_STATE' }));
  }, 10_000);

  it.each([
    { name: 'no started', body: 'complete();' },
    { name: 'wrong correlation', body: 'send({type:"started",jobId:request.projectId});' },
    { name: 'fake counts', body: 'begin();send({type:"progress",source:"estimated",processed:1,total:1});' },
    { name: 'exit zero alone', body: '' },
  ])('rejects $name and marks Failed only after supervisor confirms termination', async ({ name, body }) => {
    const jobs = create(body); const events: JobSnapshot[] = [];
    jobs.subscribe(projectId, (value) => events.push(value));
    const run = jobs.startScan(projectId, payload);
    await expect(bounded(run.donePromise)).rejects.toMatchObject({ code: 'WORKER_PROTOCOL', terminationConfirmed: true });
    expect(jobs.get(projectId, run.job.id)?.status).toBe('Failed');
    expect(events.every((value) => value.progress === null)).toBe(true);
    if (name !== 'fake counts') expect(events.some((value) => value.job.status === 'Running')).toBe(false);
  }, 10_000);

  it('cancels Queued without spawn; terminal is idempotent; foreign/unowned/train phases are refused', () => {
    const jobs = create(); seed();
    expect(() => jobs.cancel(otherProjectId, jobId)).toThrow(expect.objectContaining({ code: 'JOB_NOT_FOUND' }));
    expect(jobs.cancel(projectId, jobId).status).toBe('Cancelled');
    expect(jobs.cancel(projectId, jobId).status).toBe('Cancelled');
    for (const status of ['Preparing', 'Running', 'Interrupted']) {
      database.prepare('UPDATE jobs SET status=? WHERE id=?').run(status, jobId);
      expect(() => jobs.cancel(projectId, jobId)).toThrow(expect.objectContaining({ code: 'JOB_NOT_OWNED' }));
    }
    for (const status of ['Exporting', 'Evaluating']) {
      database.prepare("UPDATE jobs SET kind='train',status=? WHERE id=?").run(status, jobId);
      expect(() => jobs.cancel(projectId, jobId)).toThrow(expect.objectContaining({ code: 'JOB_STATE' }));
    }
    expect(childProcess.spawn).not.toHaveBeenCalled();
  });

  it('cancels Preparing before spawn and Running twice with exactly one correlated control line', async () => {
    const jobs = create(waitForCancel);
    const preparing = jobs.startScan(projectId, payload);
    expect(jobs.cancel(projectId, preparing.job.id).status).toBe('Preparing');
    jobs.cancel(projectId, preparing.job.id);
    await expect(bounded(preparing.donePromise)).resolves.toEqual({ type: 'cancelled' });
    expect(childProcess.spawn).not.toHaveBeenCalled();
    const progressed = Promise.withResolvers<string>();
    const unsubscribe = jobs.subscribe(projectId, (value) => { if (value.progress) progressed.resolve(value.job.id); });
    const running = jobs.startScan(projectId, payload);
    expect(await bounded(progressed.promise)).toBe(running.job.id);
    expect(jobs.cancel(projectId, running.job.id).status).toBe('Running'); jobs.cancel(projectId, running.job.id);
    await expect(bounded(running.donePromise)).resolves.toEqual({ type: 'cancelled' });
    const control = readFileSync(join(config.taskRoot, running.job.id, 'cancel.ndjson'));
    expect(parseWorkerCancelLine(control, { projectId, jobId: running.job.id }).type).toBe('cancel');
    expect(jobs.get(projectId, running.job.id)?.status).toBe('Cancelled'); unsubscribe(); unsubscribe();
  }, 10_000);

  it('rejects strict payload/config injection, missing mode, mismatched task and foreign TX without writes/spawn', () => {
    const jobs = create();
    for (const invalid of [null, {}, { ...payload, executablePath: 'C:\\injected.exe' },
      { ...payload, argsPrefix: ['--eval'] }, { ...payload, mode: undefined },
      { ...payload, source: { format: 'unlabeled', selection: 'directory', root: 'C:\\scan-input' }, taskType: 'detection' }]) {
      expect(() => jobs.startScan(projectId, invalid)).toThrow(expect.objectContaining({ code: 'JOB_INPUT' }));
    }
    expect(jobs.list(projectId)).toEqual([]); seed();
    database.exec('BEGIN IMMEDIATE');
    database.prepare("UPDATE projects SET name='caller-owned' WHERE id=?").run(projectId);
    expect(() => jobs.startScan(projectId, payload)).toThrow(expect.objectContaining({ code: 'JOB_TRANSACTION' }));
    expect(() => jobs.cancel(projectId, jobId)).toThrow(expect.objectContaining({ code: 'JOB_TRANSACTION' }));
    expect(() => jobs.completeScan(projectId, jobId)).toThrow(expect.objectContaining({ code: 'JOB_TRANSACTION' }));
    expect(() => jobs.get(projectId, jobId)).toThrow(expect.objectContaining({ code: 'JOB_TRANSACTION' }));
    expect(() => jobs.list(projectId)).toThrow(expect.objectContaining({ code: 'JOB_TRANSACTION' }));
    expect(() => jobs.getSnapshot(projectId, jobId)).toThrow(expect.objectContaining({ code: 'JOB_TRANSACTION' }));
    expect(database.inTransaction).toBe(true);
    expect(database.prepare('SELECT name FROM projects WHERE id=?').get(projectId)).toEqual({ name: 'caller-owned' });
    database.exec('ROLLBACK'); expect(childProcess.spawn).not.toHaveBeenCalled();
  });

  it('snapshots fixed startup and payload; isolates sync/async throwing listeners and duplicate registrations', async () => {
    const jobs = create();
    const bad = vi.fn(() => { throw new Error('PRIVATE_CALLBACK'); });
    jobs.subscribe(projectId, bad); jobs.subscribe(projectId, async () => { throw new Error('PRIVATE_ASYNC'); });
    const listener = vi.fn(); const off1 = jobs.subscribe(projectId, listener); const off2 = jobs.subscribe(projectId, listener);
    off1(); off1();
    const mutable = structuredClone(payload);
    const run = jobs.startScan(projectId, mutable);
    mutable.source.root = 'C:\\changed'; (config.argsPrefix as string[])[0] = 'C:\\injected'; config.policy.timeoutMs = 1;
    await expect(bounded(run.donePromise)).resolves.toMatchObject({ type: 'completed' });
    expect(listener).toHaveBeenCalledTimes(4); expect(bad).toHaveBeenCalledTimes(4); off2(); off2();
    jobs.completeScan(projectId, run.job.id); expect(listener).toHaveBeenCalledTimes(4);
    expect(parseWorkerRequest(readFileSync(join(config.taskRoot, run.job.id, 'request.json'))).payload).toEqual(payload);
  }, 10_000);

  it.each([
    { trigger: 'started', close: 'COMMIT' }, { trigger: 'started', close: 'ROLLBACK' },
    { trigger: 'progress', close: 'COMMIT' }, { trigger: 'progress', close: 'ROLLBACK' },
  ])('hides caller TX opened at $trigger until $close, including transport completion', async ({ trigger, close }) => {
    const jobs = create(trigger === 'started' ? 'begin(); complete();' : undefined);
    const events: JobSnapshot[] = []; let opened = false;
    jobs.subscribe(projectId, (value) => {
      if (!opened && value.job.status === 'Running' && (trigger === 'started' || value.progress !== null)) {
        database.exec('BEGIN IMMEDIATE');
        database.prepare("UPDATE jobs SET status='Succeeded' WHERE id=?").run(value.job.id);
        opened = true;
      }
    });
    jobs.subscribe(projectId, (value) => events.push(value));
    const run = jobs.startScan(projectId, payload);
    await expect(bounded(run.donePromise)).resolves.toMatchObject({ type: 'completed' });
    expect(opened).toBe(true); expect(database.inTransaction).toBe(true);
    for (const read of [() => jobs.get(projectId, run.job.id), () => jobs.list(projectId),
      () => jobs.getSnapshot(projectId, run.job.id)]) {
      expect(read).toThrow(expect.objectContaining({ code: 'JOB_TRANSACTION' }));
    }
    expect(events.map((value) => value.job.status)).toEqual(trigger === 'started'
      ? ['Preparing', 'Running'] : ['Preparing', 'Running', 'Running']);
    expect(events.every((value) => !value.workerCompleted)).toBe(true);
    database.exec(close);
    const status = close === 'COMMIT' ? 'Succeeded' : 'Running';
    expect(jobs.get(projectId, run.job.id)?.status).toBe(status);
    expect(jobs.list(projectId).map((job) => job.status)).toEqual([status]);
    expect(jobs.getSnapshot(projectId, run.job.id)).toMatchObject({ job: { status }, workerCompleted: close === 'ROLLBACK' });
  }, 10_000);

  it.each(['cancel', 'completeScan'] as const)('nested %s notifications never regress either listener', async (action) => {
    const jobs = create(); const a: JobSnapshot[] = []; const b: JobSnapshot[] = [];
    jobs.subscribe(projectId, (value) => {
      a.push(value);
      if (value.workerCompleted) jobs[action](projectId, value.job.id);
    });
    jobs.subscribe(projectId, () => { throw new Error('PRIVATE_CALLBACK'); });
    jobs.subscribe(projectId, (value) => b.push(value));
    const run = jobs.startScan(projectId, payload); await bounded(run.donePromise);
    const terminal = action === 'cancel' ? 'Cancelled' : 'Succeeded';
    expect(a.map((value) => value.job.status)).toEqual(['Preparing', 'Running', 'Running', 'Running', terminal]);
    expect(b.map((value) => value.job.status)).toEqual(['Preparing', 'Running', 'Running', terminal]);
    expect(jobs.get(projectId, run.job.id)?.status).toBe(terminal);
  }, 10_000);

  it('keeps unrelated job notifications and snapshot registration semantics during nested emission', async () => {
    const jobs = create(); seed(); const b: JobSnapshot[] = []; const late: JobSnapshot[] = [];
    const removed = vi.fn(); let remove = () => {};
    jobs.subscribe(projectId, (value) => {
      if (value.workerCompleted) {
        remove(); jobs.subscribe(projectId, (next) => late.push(next));
        jobs.cancel(projectId, jobId);
      }
    });
    remove = jobs.subscribe(projectId, removed);
    jobs.subscribe(projectId, (value) => b.push(value));
    const run = jobs.startScan(projectId, payload); await bounded(run.donePromise);
    expect(removed).toHaveBeenCalledTimes(3);
    expect(b.slice(-2).map((value) => [value.job.id, value.job.status, value.workerCompleted]))
      .toEqual([[jobId, 'Cancelled', false], [run.job.id, 'Running', true]]);
    expect(late.map((value) => value.job.id)).toEqual([jobId]);
    jobs.completeScan(projectId, run.job.id);
    expect(late.map((value) => value.job.status)).toEqual(['Cancelled', 'Succeeded']);
  }, 10_000);

  it.each(['COMMIT', 'SAVEPOINT'] as const)('preserves a real foreign TX after native %s loses acknowledgement', async (point) => {
    const jobs = create(); const events = vi.fn(); jobs.subscribe(projectId, events);
    const nativeExec = database.exec.bind(database);
    vi.spyOn(database, 'exec').mockImplementation((sql) => {
      const result = nativeExec(sql);
      if (sql === 'COMMIT' || (point === 'SAVEPOINT' && sql.startsWith('SAVEPOINT '))) {
        if (point === 'SAVEPOINT') nativeExec('COMMIT');
        nativeExec('BEGIN IMMEDIATE');
        database.prepare('INSERT INTO settings(key,value) VALUES (?,?)').run('caller-owned', 'retained');
        throw new Error('Lost acknowledgement');
      }
      return result;
    });
    expect(() => jobs.startScan(projectId, payload)).toThrow(expect.objectContaining({ code: 'JOB_DATABASE' }));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(database.inTransaction).toBe(true);
    expect(database.prepare('SELECT value FROM settings WHERE key=?').get('caller-owned')).toEqual({ value: 'retained' });
    expect(database.prepare('SELECT status FROM jobs').all()).toEqual(point === 'COMMIT' ? [{ status: 'Preparing' }] : []);
    expect(childProcess.spawn).not.toHaveBeenCalled(); expect(events).not.toHaveBeenCalled();
    nativeExec('ROLLBACK');
    expect(jobs.list(projectId)).toHaveLength(point === 'COMMIT' ? 1 : 0);
  });

  it('fails closed without destructive rollback when the private savepoint cannot be created', async () => {
    const jobs = create(); const nativeExec = database.exec.bind(database);
    vi.spyOn(database, 'exec').mockImplementation((sql) => {
      if (sql.startsWith('SAVEPOINT ')) throw new Error('Savepoint unavailable');
      return nativeExec(sql);
    });
    expect(() => jobs.startScan(projectId, payload)).toThrow(expect.objectContaining({ code: 'JOB_DATABASE' }));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(database.inTransaction).toBe(true);
    expect(database.prepare('SELECT * FROM jobs').all()).toEqual([]);
    expect(childProcess.spawn).not.toHaveBeenCalled();
    expect(() => jobs.startScan(projectId, payload)).toThrow(expect.objectContaining({ code: 'JOB_TRANSACTION' }));
    nativeExec('ROLLBACK');
  });

  it('rolls back its private transaction after a start validation failure', () => {
    const jobs = create();
    database.prepare("UPDATE projects SET task_type='detection' WHERE id=?").run(projectId);
    expect(() => jobs.startScan(projectId, payload)).toThrow(expect.objectContaining({ code: 'JOB_INPUT' }));
    expect(database.inTransaction).toBe(false); expect(jobs.list(projectId)).toEqual([]);
    expect(childProcess.spawn).not.toHaveBeenCalled();
  });

  it('does not overwrite a late DB edit when completing a transport result', async () => {
    const jobs = create(); const run = jobs.startScan(projectId, payload); await bounded(run.donePromise);
    database.prepare('UPDATE jobs SET updated_at=? WHERE id=?').run('2026-09-13T00:00:00.000Z', run.job.id);
    const changed = jobs.get(projectId, run.job.id);
    expect(() => jobs.completeScan(projectId, run.job.id)).toThrow(expect.objectContaining({ code: 'JOB_STATE' }));
    expect(jobs.get(projectId, run.job.id)).toEqual(changed);
    await expect(bounded(jobs.shutdown())).rejects.toMatchObject({ code: 'JOB_STATE' });
    expect(database.open).toBe(true);
  }, 10_000);

  it('rejects stale started CAS instead of claiming Running or overwriting recovery', async () => {
    const jobs = create(); const events: JobSnapshot[] = []; jobs.subscribe(projectId, (value) => events.push(value));
    const run = jobs.startScan(projectId, payload);
    database.prepare("UPDATE jobs SET status='Cancelled' WHERE id=?").run(run.job.id);
    await expect(bounded(run.donePromise)).rejects.toMatchObject({ code: 'WORKER_CALLBACK', terminationConfirmed: true });
    expect(jobs.get(projectId, run.job.id)?.status).toBe('Cancelled');
    expect(events.some((value) => value.job.status === 'Running')).toBe(false);
    expect(events.at(-1)?.job.status).toBe('Cancelled');
  }, 10_000);

  it('allows distinct concurrent scans; shared shutdown is finite, cancels once, blocks new starts and keeps DB open', async () => {
    const jobs = create(waitForCancel);
    const runs = [jobs.startScan(projectId, payload), jobs.startScan(projectId, payload)];
    expect(runs[0].job.id).not.toBe(runs[1].job.id);
    const shutdown = jobs.shutdown(); expect(jobs.shutdown()).toBe(shutdown);
    expect(() => jobs.startScan(projectId, payload)).toThrow(expect.objectContaining({ code: 'JOB_SHUTDOWN' }));
    await bounded(shutdown);
    expect(jobs.list(projectId).map((job) => job.status)).toEqual(['Cancelled', 'Cancelled']);
    expect(database.open).toBe(true);
    expect(() => jobs.subscribe(projectId, vi.fn())).toThrow(expect.objectContaining({ code: 'JOB_SHUTDOWN' }));
  }, 10_000);

  it('retains exclusion after unconfirmed close, even after late real close; shutdown never reports safe cleanup', async () => {
    config.policy.closeTimeoutMs = 40;
    const observed = vi.mocked(childProcess.spawn).getMockImplementation();
    if (!observed) throw new Error('Missing native spawn observer.');
    vi.mocked(childProcess.spawn).mockImplementation((file, args, options) => {
      const child = observed(file, args, options); const emitter: EventEmitter = child; const emit = emitter.emit.bind(emitter);
      vi.spyOn(emitter, 'emit').mockImplementation((event, ...values) => {
        if (event !== 'close') return emit(event, ...values);
        setTimeout(() => emit(event, ...values), 200); return true;
      });
      return child;
    });
    const jobs = create(); const run = jobs.startScan(projectId, payload);
    await expect(bounded(run.donePromise)).rejects.toMatchObject({ code: 'WORKER_CLOSE_TIMEOUT', terminationConfirmed: false });
    expect(jobs.get(projectId, run.job.id)?.status).toBe('Running');
    expect(() => jobs.startScan(projectId, payload)).toThrow(expect.objectContaining({ code: 'JOB_SHUTDOWN' }));
    expect(() => jobs.cancel(projectId, run.job.id)).toThrow(expect.objectContaining({ code: 'JOB_TERMINATION_UNCONFIRMED' }));
    await expect(bounded(jobs.shutdown())).rejects.toMatchObject({ code: 'JOB_TERMINATION_UNCONFIRMED' });
    await bounded(Promise.all(closes));
    await expect(jobs.shutdown()).rejects.toMatchObject({ code: 'JOB_TERMINATION_UNCONFIRMED' });
    expect(database.open).toBe(true); expect(readFileSync(join(config.taskRoot, run.job.id, 'result.json'), 'utf8')).toContain('opaque');
  }, 10_000);
});