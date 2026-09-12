import { randomUUID } from 'node:crypto';
import { isAbsolute, join, resolve } from 'node:path';

import { parseScanPayload } from '../../shared/contracts/import.js';
import { jobIdSchema, type Job, type JobStatus } from '../../shared/contracts/job.js';
import { projectIdSchema } from '../../shared/contracts/project.js';
import {
  encodeWorkerEvent, encodeWorkerRequest, parseWorkerEventLine, parseWorkerRequest,
  WORKER_SCHEMA_VERSION, type WorkerEvent,
} from '../../shared/contracts/worker.js';
import type { DatabaseConnection } from '../db/database.js';
import { findJob, insertJob, listJobs, transitionJob } from './job-repository.js';
import { canTransitionJob, isTerminalJobStatus } from './job-state.js';
import {
  startWorkerJob, type WorkerResult, type WorkerRun, type WorkerSupervisorOptions,
} from './worker-supervisor.js';

export type JobLaunchConfiguration = Pick<WorkerSupervisorOptions,
  'executablePath' | 'argsPrefix' | 'taskRoot' | 'env' | 'policy'>;
export type JobProgress = Readonly<Extract<WorkerEvent, { type: 'progress' }>>;
export interface JobSnapshot {
  readonly job: Readonly<Job>;
  readonly progress: JobProgress | null;
  readonly workerCompleted: boolean;
}
export type JobListener = (snapshot: JobSnapshot) => void;
export type JobServiceErrorCode = 'JOB_INPUT' | 'JOB_CONFIG' | 'JOB_DATABASE'
  | 'JOB_NOT_FOUND' | 'JOB_STATE' | 'JOB_NOT_OWNED' | 'JOB_TRANSACTION'
  | 'JOB_SHUTDOWN' | 'JOB_TERMINATION_UNCONFIRMED';
export class JobServiceError extends Error {
  constructor(readonly code: JobServiceErrorCode) { super('Job service operation failed.'); }
}
export interface JobService {
  get(projectId: string, jobId: string): Job | undefined;
  list(projectId: string): Job[];
  getSnapshot(projectId: string, jobId: string): JobSnapshot | undefined;
  startScan(projectId: string, payload: unknown): { job: Job; donePromise: Promise<WorkerResult> };
  completeScan(projectId: string, jobId: string): Job;
  cancel(projectId: string, jobId: string): Job;
  subscribe(projectId: string, listener: JobListener): () => void;
  shutdown(): Promise<void>;
}
type Active = {
  job: Job;
  progress: JobProgress | null;
  phase: 'active' | 'completed' | 'closed' | 'unconfirmed';
  cancelRequested: boolean;
  run?: WorkerRun;
  donePromise: Promise<WorkerResult>;
};
function fail(code: JobServiceErrorCode): never { throw new JobServiceError(code); }
function input<T>(parse: () => T): T {
  try { return parse(); } catch { return fail('JOB_INPUT'); }
}
function storage<T>(operation: () => T): T {
  try { return operation(); }
  catch (error) { if (error instanceof JobServiceError) throw error; return fail('JOB_DATABASE'); }
}
function sameJob(a: Job, b: Job): boolean {
  return a.id === b.id && a.projectId === b.projectId && a.kind === b.kind
    && a.status === b.status && a.createdAt === b.createdAt && a.updatedAt === b.updatedAt;
}
function timestamp(previous: Job): string {
  return new Date(Math.max(Date.now(), Date.parse(previous.updatedAt) + 1)).toISOString();
}
function snapshot(job: Job, entry?: Active): JobSnapshot {
  return Object.freeze({ job: Object.freeze({ ...job }), progress: entry?.progress ?? null,
    workerCompleted: entry?.phase === 'completed' });
}
function launchConfiguration(value: JobLaunchConfiguration): JobLaunchConfiguration {
  try {
    const local = (path: string) => typeof path === 'string' && isAbsolute(path)
      && !/[\x00-\x1f]/u.test(path) && !/^[\\/]{2}/u.test(path);
    if (!local(value.executablePath) || !local(value.taskRoot) || !Array.isArray(value.argsPrefix)
      || !value.argsPrefix.every((arg) => typeof arg === 'string' && !arg.includes('\0'))) fail('JOB_CONFIG');
    const policy = { ...value.policy };
    if (![policy.timeoutMs, policy.cancelGraceMs, policy.closeTimeoutMs]
      .every((n) => Number.isSafeInteger(n) && n > 0 && n <= 2_147_483_647)
      || ![policy.maxStdoutBytes, policy.maxManifestBytes].every((n) => Number.isSafeInteger(n) && n > 0)) fail('JOB_CONFIG');
    return Object.freeze({ executablePath: value.executablePath, argsPrefix: Object.freeze([...value.argsPrefix]),
      taskRoot: resolve(value.taskRoot), env: Object.freeze({ ...process.env, ...value.env }), policy: Object.freeze(policy) });
  } catch { return fail('JOB_CONFIG'); }
}

/**
 * Main creates/owns ONE instance and its database for the application lifetime.
 * No module singleton, scheduler, startup side effects, resume, assist/train or IPC
 * launch configuration. Main must authorize scan source selection before calling.
 * Independent scans may run concurrently; UUID directories are never reused.
 *
 * donePromise is transport completion, NOT import success. A Main task consumer
 * validates the manifest/content/identity, then calls completeScan outside its DB
 * transaction. This service cannot attest task validation or atomically commit
 * DAT-08 data. Pending completion retains ownership; terminal progress is emitted
 * once, not retained as unbounded history. getSnapshot then returns progress:null.
 * subscribe delivers future changes only; use getSnapshot for the current value.
 *
 * All reads/writes reject foreign transactions. Only start owns BEGIN/COMMIT/ROLLBACK,
 * synchronously, without callbacks/await; all subsequent writes are exact CAS.
 * shutdown never closes the database or deletes task files, even on success.
 */
export function createJobService(database: DatabaseConnection, startup: JobLaunchConfiguration): JobService {
  const config = launchConfiguration(startup);
  const active = new Map<string, Active>();
  const notificationGenerations = new WeakMap<Active, number>();
  const listeners = new Map<string, Set<{ listener: JobListener }>>();
  let stopping = false;
  let shutdownPromise: Promise<void> | undefined;
  function writable(): void {
    if (!database.open) fail('JOB_DATABASE');
    if (database.inTransaction) fail('JOB_TRANSACTION');
  }
  function get(projectId: string, jobId: string): Job | undefined {
    writable();
    const parent = input(() => projectIdSchema.parse(projectId));
    const id = input(() => jobIdSchema.parse(jobId));
    const job = storage(() => findJob(database, parent, id));
    return job === undefined ? undefined : Object.freeze(job);
  }
  function requireJob(projectId: string, jobId: string): Job { return get(projectId, jobId) ?? fail('JOB_NOT_FOUND'); }
  function emit(entry: Active): void {
    const generation = (notificationGenerations.get(entry) ?? 0) + 1;
    notificationGenerations.set(entry, generation);
    let current: Job | undefined;
    try { current = get(entry.job.projectId, entry.job.id); } catch { return; }
    if (!current) return;
    // A recovery/caller edit must not be followed by stale lifecycle notifications.
    const value = snapshot(current, sameJob(current, entry.job) ? entry : undefined);
    const registrations = listeners.get(entry.job.projectId);
    for (const registration of [...registrations ?? []]) {
      if (notificationGenerations.get(entry) !== generation) break;
      if (!registrations?.has(registration)) continue;
      try {
        // Async listeners are also isolated, although the public callback is void.
        void Promise.resolve(registration.listener(value)).catch(() => undefined);
      } catch { /* Consumers cannot fail the worker or expose callback messages. */ }
    }
  }
  function move(entry: Active, status: JobStatus): void {
    writable();
    const updatedAt = timestamp(entry.job);
    if (!storage(() => transitionJob(database, entry.job, status, updatedAt))) fail('JOB_STATE');
    entry.job = Object.freeze({ ...entry.job, status, updatedAt });
  }
  function finish(entry: Active, status: 'Succeeded' | 'Cancelled'): Job {
    move(entry, status);
    entry.phase = 'closed'; active.delete(entry.job.id); emit(entry);
    return entry.job;
  }
  function requestCancel(entry: Active): void {
    if (entry.cancelRequested || entry.phase !== 'active') return;
    entry.cancelRequested = true; entry.run?.cancel();
  }
  function cancel(projectId: string, jobId: string): Job {
    writable();
    const job = requireJob(projectId, jobId);
    if (isTerminalJobStatus(job.status)) return job;
    if (!canTransitionJob(job.kind, job.status, 'Cancelled')) fail('JOB_STATE');
    const entry = active.get(job.id);
    if (job.status === 'Queued' && entry === undefined) {
      const queued: Active = { job, progress: null, phase: 'closed', cancelRequested: false,
        donePromise: Promise.resolve({ type: 'cancelled' }) };
      return finish(queued, 'Cancelled');
    }
    if (!entry) fail('JOB_NOT_OWNED');
    if (entry.phase === 'unconfirmed') fail('JOB_TERMINATION_UNCONFIRMED');
    if (!sameJob(job, entry.job)) fail('JOB_STATE');
    if (entry.phase === 'completed') return finish(entry, 'Cancelled');
    if (entry.phase !== 'active') fail('JOB_STATE');
    requestCancel(entry);
    return job; // No Cancelled until confirmed transport termination.
  }
  return Object.freeze({
    get,
    list(projectId: string): Job[] {
      writable();
      const id = input(() => projectIdSchema.parse(projectId));
      return storage(() => listJobs(database, id)).map((job) => Object.freeze(job));
    },
    getSnapshot(projectId: string, jobId: string): JobSnapshot | undefined {
      const job = get(projectId, jobId);
      if (!job) return undefined;
      const entry = active.get(job.id);
      return snapshot(job, entry && sameJob(job, entry.job) ? entry : undefined);
    },
    startScan(projectId: string, payload: unknown): { job: Job; donePromise: Promise<WorkerResult> } {
      if (stopping) fail('JOB_SHUTDOWN');
      writable();
      const parent = input(() => projectIdSchema.parse(projectId));
      const parsed = input(() => parseScanPayload(payload));
      const request = input(() => parseWorkerRequest(encodeWorkerRequest({
        schemaVersion: WORKER_SCHEMA_VERSION, jobId: randomUUID(), projectId: parent,
        kind: 'scan-dataset', payload: parsed,
      })));
      const createdAt = new Date().toISOString();
      let job: Job = { id: request.jobId, projectId: parent, kind: 'scan-dataset', status: 'Queued', createdAt, updatedAt: createdAt };
      storage(() => {
        const savepoint = `job_start_${randomUUID().replaceAll('-', '')}`;
        // BEGIN outside try: failure to acquire ownership must never roll back a caller.
        database.exec('BEGIN IMMEDIATE');
        try {
          database.exec(`SAVEPOINT ${savepoint}`);
          const project = database.prepare('SELECT task_type FROM projects WHERE id=?').get(parent) as { task_type: string } | undefined;
          if (!project) fail('JOB_NOT_FOUND');
          if (project.task_type !== parsed.taskType) fail('JOB_INPUT');
          insertJob(database, job);
          const updatedAt = timestamp(job);
          if (!transitionJob(database, job, 'Preparing', updatedAt)) fail('JOB_STATE');
          job = Object.freeze({ ...job, status: 'Preparing', updatedAt });
          database.exec('COMMIT');
        } catch (error) {
          // One exec: a missing private marker stops before ROLLBACK. COMMIT may
          // have succeeded and a caller may already own a different transaction.
          try { database.exec(`ROLLBACK TO ${savepoint}; ROLLBACK`); }
          catch { /* Missing marker/creation failure: fail closed, never guess ownership. */ }
          throw error;
        }
      });
      const deferred = Promise.withResolvers<WorkerResult>();
      const entry: Active = { job, progress: null, phase: 'active', cancelRequested: false, donePromise: deferred.promise };
      active.set(job.id, entry);
      // Observe internally without changing the rejection delivered to Main.
      void deferred.promise.catch(() => undefined);
      function failed(error: unknown): void {
        const confirmed = error !== null && typeof error === 'object'
          && 'terminationConfirmed' in error && error.terminationConfirmed === true;
        if (!confirmed) { entry.phase = 'unconfirmed'; stopping = true; emit(entry); }
        else {
          try { move(entry, 'Failed'); } catch { /* Never overwrite stale/foreign transaction state. */ }
          entry.phase = 'closed'; active.delete(entry.job.id); emit(entry);
        }
        deferred.reject(error);
      }
      try {
        entry.run = startWorkerJob({ ...config, request, jobDirectory: join(config.taskRoot, job.id),
          onStarted() {
            if (entry.cancelRequested) return;
            if (entry.phase !== 'active' || entry.job.status !== 'Preparing') fail('JOB_STATE');
            move(entry, 'Running'); emit(entry);
          },
          onProgress(event) {
            if (entry.cancelRequested) return;
            const value = parseWorkerEventLine(encodeWorkerEvent(event), { projectId: parent, jobId: job.id });
            if (value.type !== 'progress' || entry.phase !== 'active' || entry.job.status !== 'Running'
              || (entry.progress !== null && (value.processed < entry.progress.processed
                || (entry.progress.total !== null && value.total !== entry.progress.total)))) fail('JOB_STATE');
            writable();
            if (!sameJob(requireJob(parent, job.id), entry.job)) fail('JOB_STATE');
            entry.progress = Object.freeze(value); emit(entry);
          },
        });
        void entry.run.donePromise.then((result) => {
          try {
            if (result.type === 'cancelled' || entry.cancelRequested) finish(entry, 'Cancelled');
            else { entry.phase = 'completed'; emit(entry); }
            deferred.resolve(result);
          } catch (error) {
            // Worker is closed, but stale CAS/foreign TX cannot be treated as a commit.
            entry.phase = 'closed'; active.delete(entry.job.id); deferred.reject(error);
          }
        }, failed);
      } catch (error) { failed(error); }
      if (entry.phase === 'active') emit(entry);
      return Object.freeze({ job, donePromise: deferred.promise });
    },
    completeScan(projectId: string, jobId: string): Job {
      writable();
      const job = requireJob(projectId, jobId);
      const entry = active.get(job.id);
      if (!entry || entry.phase !== 'completed' || entry.cancelRequested || job.kind !== 'scan-dataset'
        || job.status !== 'Running' || !sameJob(job, entry.job)) fail('JOB_STATE');
      return finish(entry, 'Succeeded');
    },
    cancel,
    subscribe(projectId: string, listener: JobListener): () => void {
      if (stopping) fail('JOB_SHUTDOWN');
      const id = input(() => projectIdSchema.parse(projectId));
      if (typeof listener !== 'function') fail('JOB_INPUT');
      let registrations = listeners.get(id);
      if (!registrations) { registrations = new Set(); listeners.set(id, registrations); }
      const registration = { listener }; registrations.add(registration);
      let subscribed = true;
      return () => {
        if (!subscribed) return;
        subscribed = false; registrations.delete(registration);
        if (registrations.size === 0 && listeners.get(id) === registrations) listeners.delete(id);
      };
    },
    shutdown(): Promise<void> {
      if (shutdownPromise) return shutdownPromise;
      try { writable(); } catch (error) { return Promise.reject(error); }
      stopping = true;
      const entries = [...active.values()];
      // Defer work until the shared promise is assigned (listener reentrancy).
      shutdownPromise = Promise.resolve().then(async () => {
        let stateError = false;
        for (const entry of entries) {
          if (entry.phase === 'completed') {
            try { finish(entry, 'Cancelled'); } catch { stateError = true; }
          } else requestCancel(entry);
        }
        await Promise.allSettled(entries.map((entry) => entry.donePromise));
        listeners.clear();
        if (entries.some((entry) => entry.phase === 'unconfirmed')) fail('JOB_TERMINATION_UNCONFIRMED');
        if (stateError) fail('JOB_STATE');
      });
      void shutdownPromise.catch(() => undefined);
      return shutdownPromise;
    },
  });
}