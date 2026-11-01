import { randomUUID } from 'node:crypto';

import { annotationIdSchema } from '../../shared/contracts/annotation.js';
import type { DatabaseConnection } from '../db/database.js';
import {
  getNextRevisionNo, insertDatasetRevision, listWorkspaceSourceRevisionIds,
  readSchemaSnapshotJson, readWorkspaceRoot, type DatasetRevision,
} from './revision-repository.js';
import { assessClassCoverage, countManifestClassImages, type CoverageAssessment } from './class-coverage-policy.js';
import { removeRevisionManifestFile, writeRevisionManifestAtomic } from './revision-manifest.js';

export interface CreateRevisionInput {
  readonly projectId: string;
  readonly workspaceId: string;
  readonly splitSeed: number;
  readonly createdBy: string;
}

export interface CreateRevisionResult {
  readonly revision: DatasetRevision;
  readonly manifestPath: string;
  /** FR-CVP-001: warnings only (errors reject the revision). */
  readonly coverage: CoverageAssessment;
}

/** FR-CVP-001: fixed code, never carries a filesystem path. */
export class CoverageGuardError extends Error {
  readonly code = 'CLASS_COVERAGE_ERROR' as const;
  constructor(readonly assessment: CoverageAssessment) { super('CLASS_COVERAGE_ERROR'); }
}

function timestamp(): string {
  return new Date().toISOString();
}

export function createDatasetRevision(database: DatabaseConnection, input: CreateRevisionInput): CreateRevisionResult {
  if (database.inTransaction) throw new Error('Dataset revision requires no caller transaction.');
  const projectId = annotationIdSchema.parse(input.projectId);
  const workspaceId = annotationIdSchema.parse(input.workspaceId);
  if (!Number.isSafeInteger(input.splitSeed) || input.splitSeed < 0 || input.splitSeed > Number.MAX_SAFE_INTEGER) {
    throw new Error('Invalid split seed.');
  }
  if (input.createdBy.trim().length === 0 || input.createdBy.length > 256) throw new Error('Invalid revision creator.');
  const workspaceRoot = readWorkspaceRoot(database, projectId);
  const revisionId = randomUUID();
  const revisionNo = getNextRevisionNo(database, projectId);
  const confirmedAt = timestamp();
  const lineage = listWorkspaceSourceRevisionIds(database, workspaceId);
  const manifest = writeRevisionManifestAtomic(database, projectId, workspaceId, workspaceRoot, {
    revisionId,
    revisionNo,
    splitSeed: input.splitSeed,
    createdBy: input.createdBy,
    confirmedAt,
    lineage,
  });
  const coverage = assessClassCoverage(manifest.manifest.taskType, countManifestClassImages(manifest.manifest));
  if (coverage.errors.length !== 0) {
    removeRevisionManifestFile(manifest.absolutePath);
    throw new CoverageGuardError(coverage);
  }
  try {
    database.exec('BEGIN IMMEDIATE');
    try {
      const revision = insertDatasetRevision(database, {
        manifest: manifest.manifest,
        manifestJson: manifest.manifestJson,
        manifestSha256: manifest.manifestSha256,
        manifestRelativePath: manifest.relativePath,
        schemaSnapshotJson: readSchemaSnapshotJson(database, workspaceId),
      });
      database.exec('COMMIT');
      return Object.freeze({ revision, manifestPath: manifest.absolutePath, coverage });
    } catch (error) {
      try { database.exec('ROLLBACK'); } catch { /* transaction outcome remains failed */ }
      throw error;
    }
  } catch (error) {
    removeRevisionManifestFile(manifest.absolutePath);
    throw error;
  }
}
