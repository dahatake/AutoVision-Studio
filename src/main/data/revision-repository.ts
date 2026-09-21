import { randomUUID } from 'node:crypto';

import { annotationIdSchema } from '../../shared/contracts/annotation.js';
import type { DatabaseConnection } from '../db/database.js';
import type { RevisionManifest, RevisionManifestItem } from './revision-manifest.js';

export interface DatasetRevision {
  readonly id: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly revisionNo: number;
  readonly mode: 'copy' | 'reference';
  readonly manifestJson: string;
  readonly manifestSha256: string;
  readonly manifestRelativePath: string;
  readonly schemaSnapshotJson: string;
  readonly splitSeed: number;
  readonly createdBy: string;
  readonly confirmedAt: string;
  readonly lastVerifiedAt: string | null;
}

function parseRevision(row: unknown): DatasetRevision {
  const value = row as Record<string, unknown>;
  return Object.freeze({
    id: annotationIdSchema.parse(value.id),
    projectId: annotationIdSchema.parse(value.projectId),
    workspaceId: annotationIdSchema.parse(value.workspaceId),
    revisionNo: Number(value.revisionNo),
    mode: value.mode === 'reference' ? 'reference' : 'copy',
    manifestJson: String(value.manifestJson),
    manifestSha256: String(value.manifestSha256),
    manifestRelativePath: String(value.manifestRelativePath),
    schemaSnapshotJson: String(value.schemaSnapshotJson),
    splitSeed: Number(value.splitSeed),
    createdBy: String(value.createdBy),
    confirmedAt: String(value.confirmedAt),
    lastVerifiedAt: value.lastVerifiedAt === null ? null : String(value.lastVerifiedAt),
  });
}

const revisionColumns = `id,project_id AS projectId,workspace_id AS workspaceId,revision_no AS revisionNo,
  mode,manifest_json AS manifestJson,manifest_sha256 AS manifestSha256,
  manifest_relative_path AS manifestRelativePath,schema_snapshot_json AS schemaSnapshotJson,
  split_seed AS splitSeed,created_by AS createdBy,confirmed_at AS confirmedAt,last_verified_at AS lastVerifiedAt`;

export function getNextRevisionNo(database: DatabaseConnection, projectId: string): number {
  const parent = annotationIdSchema.parse(projectId);
  const row = database.prepare('SELECT COALESCE(MAX(revision_no),0)+1 AS revisionNo FROM dataset_revisions WHERE project_id=?')
    .get(parent) as { revisionNo: number };
  if (!Number.isSafeInteger(row.revisionNo) || row.revisionNo < 1) throw new Error('Next revision number is invalid.');
  return row.revisionNo;
}

export function findDatasetRevision(database: DatabaseConnection, projectId: string, revisionId: string): DatasetRevision | undefined {
  const row = database.prepare(`SELECT ${revisionColumns} FROM dataset_revisions WHERE project_id=? AND id=?`)
    .get(annotationIdSchema.parse(projectId), annotationIdSchema.parse(revisionId));
  return row === undefined ? undefined : parseRevision(row);
}

export function listWorkspaceSourceRevisionIds(database: DatabaseConnection, workspaceId: string): string[] {
  return database.prepare(`SELECT source_revision_id AS id FROM workspace_revision_sources
    WHERE workspace_id=? ORDER BY source_revision_id`).all(annotationIdSchema.parse(workspaceId))
    .map((row) => annotationIdSchema.parse((row as { id: unknown }).id));
}

export function readWorkspaceRoot(database: DatabaseConnection, projectId: string): string {
  const row = database.prepare('SELECT workspace_path AS workspacePath FROM projects WHERE id=?')
    .get(annotationIdSchema.parse(projectId)) as { workspacePath?: unknown } | undefined;
  if (typeof row?.workspacePath !== 'string' || row.workspacePath.length === 0) throw new Error('Project workspace path not found.');
  return row.workspacePath;
}

export function readSchemaSnapshotJson(database: DatabaseConnection, workspaceId: string): string {
  const raw = database.prepare(`SELECT s.snapshot_json AS snapshotJson FROM annotation_workspaces w
    JOIN annotation_schema_snapshots s ON s.schema_id=w.schema_id WHERE w.id=?`).get(annotationIdSchema.parse(workspaceId));
  const row = raw as { snapshotJson?: unknown } | undefined;
  if (typeof row?.snapshotJson !== 'string') throw new Error('Revision schema snapshot not found.');
  return row.snapshotJson;
}

export function insertDatasetRevision(database: DatabaseConnection, input: {
  readonly manifest: RevisionManifest;
  readonly manifestJson: string;
  readonly manifestSha256: string;
  readonly manifestRelativePath: string;
  readonly schemaSnapshotJson: string;
}): DatasetRevision {
  if (!database.inTransaction) throw new Error('Dataset revision insertion requires caller transaction.');
  const insertItem = database.prepare(`INSERT INTO dataset_items
    (id,revision_id,source_item_id,import_id,image_key,image_sha256,width,height,
     source_snapshot_json,annotation_json,annotation_sha256,provenance_json,disposition,exclusion_reason,split)
    SELECT ?,?,?,?,?,?,?,?,?,a.annotation_json,a.annotation_sha256,?,?,a.exclusion_reason,?
    FROM annotation_items a WHERE a.id=?`);
  for (const item of input.manifest.items) {
    const entry = item as RevisionManifestItem;
    insertItem.run(randomUUID(), input.manifest.revisionId, entry.sourceItemId, entry.importId,
      entry.imageKey, entry.imageSha256, entry.width, entry.height, entry.sourceSnapshotJson,
      entry.provenanceJson, entry.disposition, entry.split, entry.sourceItemId);
  }
  database.prepare(`INSERT INTO dataset_revisions
    (id,project_id,workspace_id,revision_no,mode,manifest_json,manifest_sha256,manifest_relative_path,
     schema_snapshot_json,split_seed,created_by,confirmed_at,last_verified_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(input.manifest.revisionId, input.manifest.projectId, input.manifest.workspaceId,
      input.manifest.revisionNo, input.manifest.mode, input.manifestJson, input.manifestSha256,
      input.manifestRelativePath, input.schemaSnapshotJson, input.manifest.splitSeed,
      input.manifest.createdBy, input.manifest.confirmedAt, null);
  const saved = findDatasetRevision(database, input.manifest.projectId, input.manifest.revisionId);
  if (!saved) throw new Error('Dataset revision insert failed.');
  return saved;
}

export function updateDatasetRevisionManifest(): never {
  throw new Error('Finalized dataset revisions are immutable.');
}
