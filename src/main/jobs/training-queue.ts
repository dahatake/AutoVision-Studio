import { randomUUID } from 'node:crypto';

import { jobSchema, type Job } from '../../shared/contracts/job.js';
import { annotationIdSchema } from '../../shared/contracts/annotation.js';
import type { DatabaseConnection } from '../db/database.js';
import { insertJob, listJobs } from './job-repository.js';

export interface TrainingQueueEntry {
  readonly job: Job;
  readonly revisionId: string;
}

export function enqueueTrainingRun(database: DatabaseConnection, projectId: string,
  revisionId: string, now = new Date().toISOString()): TrainingQueueEntry {
  if (database.inTransaction) throw new Error('Training queue requires no caller transaction.');
  const parent = annotationIdSchema.parse(projectId);
  const revision = annotationIdSchema.parse(revisionId);
  const exists = database.prepare('SELECT id FROM dataset_revisions WHERE id=? AND project_id=?')
    .get(revision, parent);
  if (!exists) throw new Error('Training revision not found.');
  const active = listJobs(database, parent).find((job) => job.kind === 'train'
    && !['Succeeded', 'Failed', 'Cancelled', 'Interrupted'].includes(job.status));
  if (active && active.status !== 'Queued') throw new Error('A training run is already active.');
  const job = jobSchema.parse({ id: randomUUID(), projectId: parent, kind: 'train', status: 'Queued',
    createdAt: now, updatedAt: now });
  insertJob(database, job);
  return Object.freeze({ job: Object.freeze(job), revisionId: revision });
}
