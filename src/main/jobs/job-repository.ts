import { jobIdSchema, jobSchema, type Job, type JobStatus } from '../../shared/contracts/job.js';
import { projectIdSchema } from '../../shared/contracts/project.js';
import type { DatabaseConnection } from '../db/database.js';
import { assertJobTransition } from './job-state.js';

const columns = 'id, project_id AS projectId, kind, status, created_at AS createdAt, updated_at AS updatedAt';

// Sort keys have fixed-width seconds and fractions with trailing zeros removed.
function compareTimestamp(left: readonly [string, string], right: readonly [string, string]): number {
  if (left[0] !== right[0]) return left[0] < right[0] ? -1 : 1;
  return left[1] < right[1] ? -1 : left[1] > right[1] ? 1 : 0;
}

/** Missing and foreign jobs are indistinguishable; malformed input/rows throw. */
export function findJob(database: DatabaseConnection, projectId: string, id: string): Job | undefined {
  const parentId = projectIdSchema.parse(projectId);
  const jobId = jobIdSchema.parse(id);
  const row = database.prepare(`SELECT ${columns} FROM jobs WHERE project_id=? AND id=?`).get(parentId, jobId);
  return row === undefined ? undefined : jobSchema.parse(row);
}

/** Project history in stable chronological createdAt/id order, not a worker/training queue. */
export function listJobs(database: DatabaseConnection, projectId: string): Job[] {
  const parentId = projectIdSchema.parse(projectId);
  return database.prepare(`SELECT ${columns} FROM jobs WHERE project_id=? ORDER BY created_at, id`).all(parentId)
    .map((row) => {
      const job = jobSchema.parse(row);
      const [time = '', fraction = ''] = job.createdAt.slice(0, -1).split('.');
      // Normalize only the comparison key; snapshots retain their exact CAS timestamps.
      const timestamp: readonly [string, string] = [
        time.length === 16 ? `${time}:00` : time, fraction.replace(/0+$/, ''),
      ];
      return { job, timestamp };
    })
    .sort((left, right) => compareTimestamp(left.timestamp, right.timestamp)
      || (left.job.id < right.job.id ? -1 : left.job.id > right.job.id ? 1 : 0))
    .map(({ job }) => job);
}

/**
 * Stores a caller-created Queued snapshot without generating IDs or timestamps.
 * Does not start/commit/roll back the caller's transaction or mutate projects.
 * ANN-22 must wrap train creation and task-type locking in the SAME transaction;
 * this repository is not the Run handoff, worker service or scheduler.
 */
export function insertJob(database: DatabaseConnection, input: Job): void {
  const job = jobSchema.parse(input);
  if (job.status !== 'Queued') throw new Error('New jobs must be Queued.');
  database.prepare('INSERT INTO jobs(id,project_id,kind,status,created_at,updated_at) VALUES (?,?,?,?,?,?)')
    .run(job.id, job.projectId, job.kind, job.status, job.createdAt, job.updatedAt);
}

/**
 * One finite SQL CAS. False means missing/foreign/stale snapshot (including kind
 * or timestamps); invalid snapshots/edges throw. No retry, upsert or resume.
 * Only status and caller-supplied updatedAt change. The additional timestamp
 * predicates reject stale snapshots even if a later recovery revisits a status.
 */
export function transitionJob(database: DatabaseConnection, expected: Job, status: JobStatus, updatedAt: string): boolean {
  const previous = jobSchema.parse(expected);
  const next = jobSchema.parse({ ...previous, status, updatedAt });
  assertJobTransition(previous.kind, previous.status, next.status);
  return database.prepare(`UPDATE jobs SET status=?,updated_at=?
    WHERE id=? AND project_id=? AND kind=? AND status=? AND created_at=? AND updated_at=?`)
    .run(next.status, next.updatedAt, previous.id, previous.projectId, previous.kind,
      previous.status, previous.createdAt, previous.updatedAt).changes === 1;
}