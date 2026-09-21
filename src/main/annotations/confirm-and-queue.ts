import type { DatabaseConnection } from '../db/database.js';
import { createDatasetRevision, type CreateRevisionResult } from '../data/revision-service.js';
import { enqueueTrainingRun, type TrainingQueueEntry } from '../jobs/training-queue.js';

export interface ConfirmAndQueueResult {
  readonly revision: CreateRevisionResult;
  readonly training: TrainingQueueEntry;
}

export function confirmDatasetAndQueueTraining(database: DatabaseConnection, input: {
  readonly projectId: string;
  readonly workspaceId: string;
  readonly splitSeed: number;
  readonly createdBy: string;
}): ConfirmAndQueueResult {
  const revision = createDatasetRevision(database, input);
  const training = enqueueTrainingRun(database, input.projectId, revision.revision.id);
  return Object.freeze({ revision, training });
}
