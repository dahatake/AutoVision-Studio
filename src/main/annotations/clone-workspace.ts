import { randomUUID } from 'node:crypto';

import { annotationIdSchema } from '../../shared/contracts/annotation.js';
import type { DatabaseConnection } from '../db/database.js';

export interface CloneWorkspaceResult {
  readonly workspaceId: string;
  readonly itemCount: number;
}

export function cloneWorkspaceFromRevision(database: DatabaseConnection, projectId: string,
  revisionId: string): CloneWorkspaceResult {
  if (database.inTransaction) throw new Error('Workspace clone requires no caller transaction.');
  const parent = annotationIdSchema.parse(projectId), revision = annotationIdSchema.parse(revisionId);
  const header = database.prepare(`SELECT r.id,r.workspace_id AS sourceWorkspaceId,w.schema_id AS schemaId,
    w.task_type AS taskType,w.mode FROM dataset_revisions r
    JOIN annotation_workspaces w ON w.id=r.workspace_id WHERE r.id=? AND r.project_id=?`)
    .get(revision, parent) as { sourceWorkspaceId: string; schemaId: string; taskType: string; mode: string } | undefined;
  if (!header) throw new Error('Source revision not found.');
  const workspaceId = randomUUID();
  const now = new Date().toISOString();
  const sourceRows = database.prepare(`SELECT d.source_item_id AS sourceItemId,d.import_id AS importId,
    d.image_key AS imageKey,d.image_sha256 AS imageSha256,d.width,d.height,d.annotation_json AS annotationJson,
    d.annotation_sha256 AS annotationSha256,d.provenance_json AS provenanceJson,d.disposition,d.exclusion_reason AS exclusionReason
    FROM dataset_items d WHERE d.revision_id=?
    AND NOT EXISTS (
      SELECT 1 FROM dataset_items other WHERE other.revision_id=d.revision_id
      AND other.image_sha256=d.image_sha256 AND other.source_item_id<d.source_item_id
    ) ORDER BY d.source_item_id`).all(revision);
  database.exec('BEGIN IMMEDIATE');
  try {
    database.prepare(`INSERT INTO annotation_workspaces
      (id,project_id,schema_id,task_type,mode,state,edit_version,created_at,updated_at)
      VALUES (?,?,?,?,?,'editing',0,?,?)`)
      .run(workspaceId, parent, header.schemaId, header.taskType, header.mode, now, now);
    database.prepare('INSERT INTO workspace_revision_sources(workspace_id,source_revision_id) VALUES (?,?)')
      .run(workspaceId, revision);
    const insertItem = database.prepare(`INSERT INTO annotation_items
      (id,workspace_id,import_id,image_key,image_sha256,width,height,annotation_json,annotation_sha256,
       state,negative_confirmed,exclusion_reason,edit_version,confirmed_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const insertProvenance = database.prepare(`INSERT INTO annotation_provenance
      (item_id,target_key,kind,source_import_id,source_image_key,source_annotation_key,source_suggestion_id,original_json,changes_json)
      VALUES (?,?,?,?,?,?,?,?,?)`);
    for (const row of sourceRows as Record<string, unknown>[]) {
      const itemId = randomUUID();
      const state = row.disposition === 'excluded' ? 'excluded' : 'editing';
      insertItem.run(itemId, workspaceId, row.importId, row.imageKey, row.imageSha256, row.width, row.height,
        row.annotationJson, row.annotationSha256, state, 0, row.exclusionReason, 0, null, now);
      if (state !== 'excluded' && typeof row.provenanceJson === 'string') {
        const provenance = JSON.parse(row.provenanceJson) as Record<string, {
          kind: string; sourceImportId: string | null; sourceImageKey: string | null;
          sourceAnnotationKey: string | null; sourceSuggestionId: string | null;
          original: unknown; changes: unknown;
        }>;
        for (const [targetKey, value] of Object.entries(provenance)) {
          insertProvenance.run(itemId, targetKey, value.kind, value.sourceImportId, value.sourceImageKey,
            value.sourceAnnotationKey, value.sourceSuggestionId, JSON.stringify(value.original), JSON.stringify(value.changes));
        }
      }
    }
    database.exec('COMMIT');
    return Object.freeze({ workspaceId, itemCount: sourceRows.length });
  } catch (error) {
    try { database.exec('ROLLBACK'); } catch { /* failed clone remains failed */ }
    throw error;
  }
}
