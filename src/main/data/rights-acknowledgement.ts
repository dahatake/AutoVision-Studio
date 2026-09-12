import { z } from 'zod';

import { projectIdSchema } from '../../shared/contracts/project.js';
import type { DatabaseConnection } from '../db/database.js';

export interface ImportRightsAcknowledgement {
  readonly projectId: string;
  readonly acknowledgedAt: string;
}

const storedSchema = z.strictObject({
  projectId: z.string(),
  acknowledgedAt: z.iso.datetime(),
});

function canonicalProjectId(projectId: string): string {
  if (typeof projectId !== 'string' || projectId.length !== 36) {
    throw new TypeError('Project ID must be a UUID string.');
  }
  return projectIdSchema.parse(projectId);
}

/** Read-only: an unknown Project is an error, not an unacknowledged Project. */
export function getImportRightsAcknowledgement(database: DatabaseConnection,
  projectId: string): ImportRightsAcknowledgement | undefined {
  const id = canonicalProjectId(projectId);
  if (database.prepare('SELECT id FROM projects WHERE id = ?').get(id) === undefined) {
    throw new Error('Project not found.');
  }
  const raw = database.prepare(`SELECT project_id AS projectId, acknowledged_at AS acknowledgedAt
    FROM project_import_rights WHERE project_id = ?`).get(id);
  if (raw === undefined) return undefined;
  const parsed = storedSchema.safeParse(raw);
  if (!parsed.success || parsed.data.projectId !== id) {
    throw new Error('Stored import rights acknowledgement is corrupt.');
  }
  const timestamp = Date.parse(parsed.data.acknowledgedAt);
  // 005 checks the shape only. Require a real calendar date and exact Main ISO spelling.
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== parsed.data.acknowledgedAt) {
    throw new Error('Stored import rights acknowledgement is corrupt.');
  }
  return Object.freeze(parsed.data);
}

/**
 * FR-LIC-009: records explicit first-import confirmation, not a legal guarantee.
 * Project metadata only; excluded from settings/setting.txt (FR-UI-006).
 * Even repeats require the caller's transaction. The caller owns the action batch,
 * COMMIT/ROLLBACK and must not treat this snapshot as committed before COMMIT succeeds.
 */
export function acknowledgeImportRights(database: DatabaseConnection,
  projectId: string, accepted: boolean): ImportRightsAcknowledgement {
  if (accepted !== true) throw new TypeError('Import rights acknowledgement requires accepted === true.');
  const id = canonicalProjectId(projectId);
  if (!database.inTransaction) throw new Error('Import rights acknowledgement requires the caller transaction.');
  const existing = getImportRightsAcknowledgement(database, id);
  if (existing !== undefined) return existing;
  // No Renderer timestamp input, upsert or retry: 005 rejects competing inserts.
  const value = Object.freeze({ projectId: id, acknowledgedAt: new Date().toISOString() });
  const inserted = database.prepare(`INSERT INTO project_import_rights(project_id, acknowledged_at)
    VALUES (?, ?)`).run(id, value.acknowledgedAt);
  if (inserted.changes !== 1) throw new Error('Import rights acknowledgement insert did not create exactly one row.');
  return value;
}