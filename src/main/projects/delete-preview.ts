import fs from 'node:fs';
import { join } from 'node:path';

import { projectIdSchema } from '../../shared/contracts/project.js';
import type { DatabaseConnection } from '../db/database.js';
import { verifyProjectDirectory } from './project-directory.js';
import { findProject } from './project-repository.js';

/** Categories FR-PRJ-007 lists whose storage does not exist in this version.
 * Reporting 0 for a table that was never created would state a count we cannot
 * measure; the dialog must show these as "未実装" instead of "0 件".
 */
export const PROJECT_DELETE_UNMEASURED_CATEGORIES = Object.freeze([
  'model-suggestions', 'model-versions', 'reports', 'derived-caches',
] as const);

/** Each code names an existing schema rule that refuses the delete outright.
 * They are detected here so the dialog can refuse before any write is attempted.
 */
export type ProjectDeleteBlockerCode =
  | 'DATASET_REVISION_IMMUTABLE'
  | 'ANNOTATION_HISTORY_IMMUTABLE'
  | 'FROZEN_WORKSPACE_IMMUTABLE'
  | 'CONFIRMED_PROVENANCE_IMMUTABLE'
  | 'LOCKED_LABEL_SCHEMA_IMMUTABLE'
  | 'ACTIVE_JOB';

export interface ProjectDeleteBlocker {
  readonly code: ProjectDeleteBlockerCode;
  readonly count: number;
  readonly message: string;
}

/** measured/partial carry what was actually walked; missing/unreadable carry no
 * numbers at all, because an unmeasured directory must not be reported as 0.
 */
export type ProjectDirectoryUsage =
  | { readonly status: 'measured'; readonly files: number; readonly bytes: number;
    readonly ownership: 'verified' | 'unverified' }
  | { readonly status: 'partial'; readonly files: number; readonly bytes: number;
    readonly ownership: 'verified' | 'unverified' }
  | { readonly status: 'missing' }
  | { readonly status: 'unreadable' };

export interface ProjectDeletePreview {
  readonly projectId: string;
  readonly name: string;
  readonly workspacePath: string;
  readonly owned: {
    readonly labelSchemas: number;
    readonly annotationWorkspaces: number;
    readonly annotationItems: number;
    readonly datasetRevisions: number;
    readonly datasetItems: number;
    readonly trainingRuns: number;
    readonly otherJobs: number;
    readonly copyImports: number;
    /** Registered inside the Project folder; already part of `directory` bytes. */
    readonly copiedImages: { readonly count: number; readonly bytes: number };
    readonly directory: ProjectDirectoryUsage;
  };
  readonly referenced: {
    readonly imports: number;
    /** Original files outside the Project. Never deleted or modified. */
    readonly images: { readonly count: number; readonly bytes: number };
  };
  readonly blockers: readonly ProjectDeleteBlocker[];
  readonly unmeasuredCategories: readonly string[];
}

const blockerMessages: Readonly<Record<ProjectDeleteBlockerCode, string>> = Object.freeze({
  DATASET_REVISION_IMMUTABLE: '確定済みDataset Revisionは変更できないため、このProjectは削除できません。',
  ANNOTATION_HISTORY_IMMUTABLE: '編集履歴の記録が残っているため、このProjectは削除できません。',
  FROZEN_WORKSPACE_IMMUTABLE: '確定済みAnnotation Workspaceは変更できないため、このProjectは削除できません。',
  CONFIRMED_PROVENANCE_IMMUTABLE: '確認済みの由来記録が残っているため、このProjectは削除できません。',
  LOCKED_LABEL_SCHEMA_IMMUTABLE: '確定済みLabel Schemaは変更できないため、このProjectは削除できません。',
  ACTIVE_JOB: '実行中または待機中の処理があるため、このProjectは削除できません。',
});

function count(database: DatabaseConnection, sql: string, ...parameters: unknown[]): number {
  const row = database.prepare(sql).get(...parameters);
  const value = (row as { value?: unknown } | undefined)?.value;
  // A count/sum must be an exact non-negative integer; never coerce or guess.
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('Projectの削除対象件数を取得できませんでした。');
  }
  return value;
}

function measureDirectory(path: string, projectId: string): ProjectDirectoryUsage {
  let files = 0;
  let bytes = 0;
  let partial = false;
  // lstat only: a link inside the Project is counted as the link itself so that
  // Reference originals outside the Project are never measured as owned data.
  const walk = (directory: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      partial = true;
      return;
    }
    for (const entry of entries) {
      const child = join(directory, entry.name);
      if (entry.isSymbolicLink()) { files += 1; continue; }
      if (entry.isDirectory()) { walk(child); continue; }
      try {
        const stat = fs.lstatSync(child);
        files += 1;
        if (stat.isFile()) bytes += stat.size;
      } catch { partial = true; }
    }
  };
  let root: fs.Stats;
  try {
    root = fs.lstatSync(path);
  } catch {
    return Object.freeze({ status: 'missing' as const });
  }
  if (!root.isDirectory() || root.isSymbolicLink()) return Object.freeze({ status: 'unreadable' as const });
  let ownership: 'verified' | 'unverified' = 'unverified';
  try {
    verifyProjectDirectory(path, projectId);
    ownership = 'verified';
  } catch { ownership = 'unverified'; }
  walk(path);
  return partial
    ? Object.freeze({ status: 'partial' as const, files, bytes, ownership })
    : Object.freeze({ status: 'measured' as const, files, bytes, ownership });
}

/** Read-only, no filesystem access: REL-04 also re-checks this inside its write
 * transaction, where measuring the folder would be inappropriate.
 */
export function collectProjectDeleteBlockers(database: DatabaseConnection, id: unknown): readonly ProjectDeleteBlocker[] {
  const projectId = projectIdSchema.parse(id);
  const counted: readonly [ProjectDeleteBlockerCode, number][] = [
    ['DATASET_REVISION_IMMUTABLE',
      count(database, 'SELECT COUNT(*) AS value FROM dataset_revisions WHERE project_id=?', projectId)],
    ['ANNOTATION_HISTORY_IMMUTABLE', count(database, `SELECT COUNT(*) AS value FROM annotation_target_history
      WHERE item_id IN (SELECT id FROM annotation_items WHERE workspace_id IN
        (SELECT id FROM annotation_workspaces WHERE project_id=?))`, projectId)],
    ['FROZEN_WORKSPACE_IMMUTABLE', count(database, `SELECT COUNT(*) AS value FROM annotation_workspaces
      WHERE project_id=? AND state='frozen'`, projectId)],
    ['CONFIRMED_PROVENANCE_IMMUTABLE', count(database, `SELECT COUNT(*) AS value FROM annotation_provenance
      WHERE item_id IN (SELECT id FROM annotation_items WHERE state='confirmed' AND workspace_id IN
        (SELECT id FROM annotation_workspaces WHERE project_id=?))`, projectId)],
    ['LOCKED_LABEL_SCHEMA_IMMUTABLE', count(database, `SELECT COUNT(*) AS value FROM label_schemas
      WHERE project_id=? AND locked_at IS NOT NULL`, projectId)],
    ['ACTIVE_JOB', count(database, `SELECT COUNT(*) AS value FROM jobs WHERE project_id=?
      AND status NOT IN ('Succeeded', 'Failed', 'Cancelled', 'Interrupted')`, projectId)],
  ];
  return Object.freeze(counted.filter(([, total]) => total > 0)
    .map(([code, total]) => Object.freeze({ code, count: total, message: blockerMessages[code] })));
}

/** Read-only. CORE-10 / FR-PRJ-007: report what deletion would remove and what
 * it would keep, without deleting anything and without inventing unknown values.
 */
export function previewProjectDeletion(database: DatabaseConnection, id: unknown): ProjectDeletePreview {
  const projectId = projectIdSchema.parse(id);
  const project = findProject(database, projectId);
  if (!project) throw new Error('Projectが見つかりません。');

  const workspaces = 'SELECT COUNT(*) AS value FROM annotation_workspaces WHERE project_id=?';
  const items = `SELECT COUNT(*) AS value FROM annotation_items WHERE workspace_id IN
    (SELECT id FROM annotation_workspaces WHERE project_id=?)`;
  const owned = {
    labelSchemas: count(database, 'SELECT COUNT(*) AS value FROM label_schemas WHERE project_id=?', projectId),
    annotationWorkspaces: count(database, workspaces, projectId),
    annotationItems: count(database, items, projectId),
    datasetRevisions: count(database, 'SELECT COUNT(*) AS value FROM dataset_revisions WHERE project_id=?', projectId),
    datasetItems: count(database, `SELECT COUNT(*) AS value FROM dataset_items WHERE revision_id IN
      (SELECT id FROM dataset_revisions WHERE project_id=?)`, projectId),
    trainingRuns: count(database, "SELECT COUNT(*) AS value FROM jobs WHERE project_id=? AND kind='train'", projectId),
    otherJobs: count(database, "SELECT COUNT(*) AS value FROM jobs WHERE project_id=? AND kind<>'train'", projectId),
    copyImports: count(database, "SELECT COUNT(*) AS value FROM data_imports WHERE project_id=? AND mode='copy'", projectId),
    copiedImages: Object.freeze({
      count: count(database, `SELECT COUNT(*) AS value FROM import_sources WHERE mode='copy' AND import_id IN
        (SELECT id FROM data_imports WHERE project_id=?)`, projectId),
      bytes: count(database, `SELECT COALESCE(SUM(byte_size), 0) AS value FROM import_sources WHERE mode='copy'
        AND import_id IN (SELECT id FROM data_imports WHERE project_id=?)`, projectId),
    }),
    directory: measureDirectory(project.workspacePath, projectId),
  };
  const referenced = Object.freeze({
    imports: count(database, "SELECT COUNT(*) AS value FROM data_imports WHERE project_id=? AND mode='reference'", projectId),
    images: Object.freeze({
      count: count(database, `SELECT COUNT(*) AS value FROM import_sources WHERE mode='reference' AND import_id IN
        (SELECT id FROM data_imports WHERE project_id=?)`, projectId),
      bytes: count(database, `SELECT COALESCE(SUM(byte_size), 0) AS value FROM import_sources WHERE mode='reference'
        AND import_id IN (SELECT id FROM data_imports WHERE project_id=?)`, projectId),
    }),
  });

  const counted: readonly [ProjectDeleteBlockerCode, number][] = [
    ['DATASET_REVISION_IMMUTABLE', owned.datasetRevisions],
  ];

  return Object.freeze({
    projectId, name: project.name, workspacePath: project.workspacePath,
    owned: Object.freeze(owned),
    referenced,
    blockers: collectProjectDeleteBlockers(database, projectId),
    unmeasuredCategories: PROJECT_DELETE_UNMEASURED_CATEGORIES,
  });
}
