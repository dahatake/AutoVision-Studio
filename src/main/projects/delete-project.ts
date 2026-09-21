import fs from 'node:fs';
import { win32 } from 'node:path';

import { projectIdSchema } from '../../shared/contracts/project.js';
import type { DatabaseConnection } from '../db/database.js';
import { collectProjectDeleteBlockers, type ProjectDeleteBlocker } from './delete-preview.js';
import { verifyProjectDirectory, type ProjectDirectoryReceipt } from './project-directory.js';
import { assertProjectNotMoving } from './project-move.js';
import { assertProjectNotImporting } from './project-operation-lock.js';
import { findProject } from './project-repository.js';

export class ProjectDeleteBlockedError extends Error {
  readonly code = 'PROJECT_DELETE_BLOCKED' as const;
  constructor(readonly blockers: readonly ProjectDeleteBlocker[]) {
    super('このProjectには削除できないデータが残っています。');
    this.name = 'ProjectDeleteBlockedError';
  }
}

export interface ProjectDeleteResult {
  readonly projectId: string;
  /** Rows actually removed in the single delete transaction. */
  readonly deletedRows: Readonly<Record<string, number>>;
  /** removed: the owned root no longer exists. missing: nothing was there.
   * retained: FR-SEC-012 reporting; some owned files could not be removed.
   */
  readonly directory: 'removed' | 'missing' | 'retained';
  /** Owned paths left behind, reported instead of being claimed as deleted. */
  readonly retainedPaths: readonly string[];
}

// Children before parents. Reference originals are NOT listed: deletion removes
// only the Project's own rows, never the external files they point at.
const deletions: readonly [string, string][] = [
  ['annotation_provenance', `DELETE FROM annotation_provenance WHERE item_id IN
    (SELECT id FROM annotation_items WHERE workspace_id IN
      (SELECT id FROM annotation_workspaces WHERE project_id=?))`],
  ['annotation_items', `DELETE FROM annotation_items WHERE workspace_id IN
    (SELECT id FROM annotation_workspaces WHERE project_id=?)`],
  ['annotation_workspaces', 'DELETE FROM annotation_workspaces WHERE project_id=?'],
  ['label_classes', `DELETE FROM label_classes WHERE schema_id IN
    (SELECT id FROM label_schemas WHERE project_id=?)`],
  ['label_schemas', 'DELETE FROM label_schemas WHERE project_id=?'],
  ['import_sources', `DELETE FROM import_sources WHERE import_id IN
    (SELECT id FROM data_imports WHERE project_id=?)`],
  ['data_imports', 'DELETE FROM data_imports WHERE project_id=?'],
  ['project_import_rights', 'DELETE FROM project_import_rights WHERE project_id=?'],
  ['jobs', 'DELETE FROM jobs WHERE project_id=?'],
];

/** Never follows a link out of the Project: a junction or symlink is removed as
 * the link itself, so Reference originals it points at stay untouched.
 */
function removeTree(path: string, retained: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(path, { withFileTypes: true });
  } catch {
    retained.push(path);
    return;
  }
  for (const entry of entries) {
    const child = win32.join(path, entry.name);
    try {
      const stat = fs.lstatSync(child);
      if (stat.isSymbolicLink()) {
        // Windows directory junctions/symlinks require rmdir, files require unlink.
        try { fs.unlinkSync(child); } catch { fs.rmdirSync(child); }
      } else if (stat.isDirectory()) removeTree(child, retained);
      else fs.unlinkSync(child);
    } catch {
      retained.push(child);
    }
  }
  try {
    fs.rmdirSync(path);
  } catch {
    retained.push(path);
  }
}

function currentReceipt(path: string, projectId: string): ProjectDirectoryReceipt | 'missing' {
  try {
    fs.lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing';
    throw new Error('Projectの保存フォルダーを確認できないため削除しません。');
  }
  try {
    return verifyProjectDirectory(path, projectId);
  } catch {
    // An existing but unverifiable folder may hold someone else's data.
    throw new Error('Projectの保存フォルダーの所有を確認できないため削除しません。');
  }
}

/** REL-04 / FR-SEC-012. Owned rows are removed in ONE transaction, so the
 * database never keeps a half-deleted Project. Filesystem removal follows the
 * committed database result and reports every path it could not remove;
 * Reference originals outside the Project are never touched.
 */
export function deleteProject(database: DatabaseConnection, id: unknown): ProjectDeleteResult {
  const projectId = projectIdSchema.parse(id);
  assertProjectNotImporting(database, projectId);
  assertProjectNotMoving(database, projectId);
  if (database.inTransaction) throw new Error('Project削除は既存のtransaction内では実行できません。');
  const project = findProject(database, projectId);
  if (!project) throw new Error('Projectが見つかりません。');
  const blockers = collectProjectDeleteBlockers(database, projectId);
  if (blockers.length > 0) throw new ProjectDeleteBlockedError(blockers);
  // Ownership is established BEFORE any write: an unverifiable folder must not
  // cost the user their metadata rows.
  const receipt = currentReceipt(project.workspacePath, projectId);

  const deletedRows: Record<string, number> = {};
  database.exec('BEGIN IMMEDIATE');
  try {
    const remaining = collectProjectDeleteBlockers(database, projectId);
    if (remaining.length > 0) throw new ProjectDeleteBlockedError(remaining);
    for (const [table, sql] of deletions) {
      deletedRows[table] = database.prepare(sql).run(projectId).changes;
    }
    if (database.prepare('DELETE FROM projects WHERE id=?').run(projectId).changes !== 1) {
      throw new Error('Projectが見つかりません。');
    }
    deletedRows.projects = 1;
    database.exec('COMMIT');
  } catch (error) {
    if (database.inTransaction) database.exec('ROLLBACK');
    throw error;
  }

  if (receipt === 'missing') {
    return Object.freeze({ projectId, deletedRows: Object.freeze(deletedRows), directory: 'missing' as const,
      retainedPaths: Object.freeze([]) });
  }
  const retained: string[] = [];
  try {
    // Re-verify: the folder must still be the same owned directory we checked.
    const current = verifyProjectDirectory(receipt.rootPath, projectId);
    if (current.rootIdentity.dev !== receipt.rootIdentity.dev
      || current.rootIdentity.ino !== receipt.rootIdentity.ino
      || current.rootIdentity.birthtimeNs !== receipt.rootIdentity.birthtimeNs) {
      throw new Error('Projectの保存フォルダーの実体が変更されました。');
    }
    removeTree(receipt.rootPath, retained);
  } catch {
    retained.push(receipt.rootPath);
  }
  return Object.freeze({
    projectId, deletedRows: Object.freeze(deletedRows),
    directory: retained.length === 0 ? 'removed' as const : 'retained' as const,
    retainedPaths: Object.freeze([...retained]),
  });
}
