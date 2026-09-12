import { randomUUID } from 'node:crypto';

import { jobSchema, type Job } from '../../shared/contracts/job.js';
import type { DatabaseConnection } from '../db/database.js';
import { findJob, transitionJob } from './job-repository.js';
import { assertJobTransition } from './job-state.js';

const failureMessage = 'Job restart recovery failed; database outcome may be uncertain.';
const columns = 'id, project_id AS projectId, kind, status, created_at AS createdAt, updated_at AS updatedAt';

/**
 * Main startup ONLY: after migration, before creating any job service or queue.
 * The caller must enforce that ordering; this primitive does not own Main's DB.
 * ADR-0001 §2.6: Running -> Interrupted (all kinds), training export/evaluation
 * -> Failed. JOB06A design: Preparing -> Failed, without inventing a checkpoint.
 * Interrupted means stopped, NOT checkpoint availability or permission to resume.
 * All projects are inspected, including unchanged states. No request/artifact
 * reads, cleanup, worker launch, auto-resume, queue registration or new job IDs.
 * Returns only actually updated snapshots, with both objects and array frozen.
 * Any exception blocks startup; COMMIT acknowledgement loss is NOT success and
 * the fixed error deliberately does not claim that rollback was confirmed.
 */
export function recoverJobs(database: DatabaseConnection): readonly Job[] {
  // Refuse the caller's transaction before preparing or reading any SQL.
  if (database.inTransaction) throw new Error('Job restart recovery requires no existing transaction.');
  try {
    if (!database.open) throw new Error(failureMessage);
    const savepoint = `job_recovery_${randomUUID().replaceAll('-', '')}`;
    // Failure (including a wrapper losing BEGIN acknowledgement) cannot establish
    // ownership. Never run an unguarded rollback from this outer catch.
    database.exec('BEGIN IMMEDIATE');
    try {
      database.exec(`SAVEPOINT ${savepoint}`);
      const jobs = database.prepare(`SELECT ${columns} FROM jobs ORDER BY id`).all()
        .map((row) => jobSchema.parse(row));
      const changes: { previous: Job; next: Job }[] = [];
      // Preflight the COMPLETE set, including every next timestamp, before writes.
      for (const previous of jobs) {
        if (previous.kind !== 'train'
          && (previous.status === 'Exporting' || previous.status === 'Evaluating')) {
          throw new Error(failureMessage);
        }
        const status = previous.status === 'Running' ? 'Interrupted'
          : previous.status === 'Preparing' || previous.status === 'Exporting'
            || previous.status === 'Evaluating' ? 'Failed' : undefined;
        if (status === undefined) continue;
        assertJobTransition(previous.kind, previous.status, status);
        // +1 ms also exceeds any sub-millisecond ISO fraction truncated by parse.
        // Date/toISOString AND the schema reject overflow beyond valid ISO years.
        const time = Math.max(Date.now(), Date.parse(previous.updatedAt) + 1);
        if (!Number.isSafeInteger(time)) throw new Error(failureMessage);
        const next = jobSchema.parse({ ...previous, status, updatedAt: new Date(time).toISOString() });
        changes.push({ previous, next });
      }
      for (const { previous, next } of changes) {
        if (!transitionJob(database, previous, next.status, next.updatedAt)) throw new Error(failureMessage);
      }
      // Read back and verify exact committed candidates, not imagined snapshots.
      const result = Object.freeze(changes.map(({ next }) => {
        const actual = findJob(database, next.projectId, next.id);
        if (!actual || actual.id !== next.id || actual.projectId !== next.projectId
          || actual.kind !== next.kind || actual.status !== next.status
          || actual.createdAt !== next.createdAt || actual.updatedAt !== next.updatedAt) {
          throw new Error(failureMessage);
        }
        return Object.freeze(actual);
      }));
      database.exec('COMMIT');
      if (database.inTransaction) throw new Error(failureMessage);
      return result;
    } catch {
      // One exec stops at a missing PRIVATE marker: COMMIT may already have
      // succeeded and a wrapper may have begun a different, caller-owned TX.
      try { database.exec(`ROLLBACK TO ${savepoint}; ROLLBACK`); }
      catch { /* Uncertain ownership/outcome: do not guess, close, or retry. */ }
      throw new Error(failureMessage);
    }
  } catch {
    // Never leak SQL, stored data, filesystem paths, or arbitrary wrapper errors.
    throw new Error(failureMessage);
  }
}