import { randomUUID } from 'node:crypto';
import { win32 } from 'node:path';

import { createProjectSchema, projectIdSchema, updateProjectSchema, type Project } from '../../shared/contracts/project.js';
import type { DatabaseConnection } from '../db/database.js';
import { cleanupNewProjectDirectory, createProjectDirectory, type ProjectDirectoryReceipt } from './project-directory.js';
import { assertProjectNotMoving, moveProjectDirectory, recoverProjectMove, snapshotProjectMoveParent, type ProjectMoveRecoveryResult, type ProjectMoveSelectedParent } from './project-move.js';
import { beginProjectMoveActivity } from './project-operation-lock.js';
import { findProject, insertProject, listProjects, replaceProject } from './project-repository.js';

function validateWorkspacePath(path: string): void {
  // Lexical validation only; create additionally verifies the existing parent.
  const segments = path.replaceAll('/', '\\').split('\\');
  const names = /^[a-z]:/i.test(path) ? segments.slice(1) : segments.slice(2);
  const invalidName = names.some((name) => name !== '' && name !== '.' && name !== '..' && (
    /[<>:"|?*]/.test(name) || /[ .]$/.test(name)
    || /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name)
  ));
  if (!/^(?:[a-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+[\\/])/i.test(path)
    || invalidName
    || /[\u0000-\u001f\u007f]/.test(path)
    || path.startsWith('\\\\?\\') || path.startsWith('\\\\.\\')
    || path.slice(/^[a-z]:/i.test(path) ? 2 : 0).includes(':')
    || win32.resolve(path) === win32.parse(win32.resolve(path)).root) {
    throw new TypeError('Project保存場所にはドライブまたは共有配下の絶対フォルダーパスを指定してください。');
  }
}

/** Main-only protection from explicit configuration, never Renderer input.
 * Omission preserves the trusted internal two-argument API; no roots are inferred.
 */
export function createProject(database: DatabaseConnection, input: unknown, protectedRoots: readonly string[] = []): Project {
  const editable = createProjectSchema.parse(input);
  validateWorkspacePath(editable.workspacePath);
  if (!Array.isArray(protectedRoots)) throw new TypeError('Mainが構成した保護対象フォルダーの配列を指定してください。');
  const roots = [...protectedRoots];
  for (const root of roots) {
    if (typeof root !== 'string') throw new TypeError('Mainが構成した保護対象フォルダーのパスを指定してください。');
    validateWorkspacePath(root);
  }
  // A caller's later rollback cannot undo filesystem creation. Refuse nesting
  // before any I/O, and commit our own write before returning the owned root.
  if (database.inTransaction) throw new Error('Project作成は既存のtransaction内では実行できません。');
  database.exec('BEGIN IMMEDIATE');
  let directory: ProjectDirectoryReceipt | undefined;
  let committing = false;
  try {
    const existingRoots = listProjects(database).map((project) => project.workspacePath);
    const id = randomUUID();
    directory = createProjectDirectory(editable.workspacePath, id, [...existingRoots, ...roots]);
    const timestamp = new Date().toISOString();
    const project: Project = {
      ...editable, id, workspacePath: directory.rootPath, createdAt: timestamp, updatedAt: timestamp,
    };
    insertProject(database, project);
    committing = true;
    database.exec('COMMIT');
    return project;
  } catch (error) {
    if (database.inTransaction) {
      try {
        database.exec('ROLLBACK');
      } catch (rollbackError) {
        // Do not remove the root when the database outcome is uncertain.
        throw new AggregateError([error, rollbackError], 'Project作成のDB rollbackに失敗しました。残存フォルダーは回収していません。');
      }
    } else if (committing) {
      // COMMIT may have succeeded before its acknowledgement failed. A DB row
      // can already reference this root; never delete it on an uncertain result.
      throw new AggregateError([error], 'Project作成のDB結果が不確実なため保存フォルダーは回収していません。一覧を再取得してください。');
    }
    if (directory && !cleanupNewProjectDirectory(directory)) {
      throw new AggregateError([error], 'Project作成に失敗しました。同一性または内容を確認できないため残存フォルダーは回収していません。');
    }
    throw error;
  }
}

export function getProject(database: DatabaseConnection, id: unknown): Project {
  const project = findProject(database, projectIdSchema.parse(id));
  if (!project) throw new Error('Projectが見つかりません。');
  return project;
}

export function getProjects(database: DatabaseConnection): Project[] {
  return listProjects(database);
}

export function updateProject(database: DatabaseConnection, input: unknown): Project {
  const editable = updateProjectSchema.parse(input);
  assertProjectNotBusy(database, editable.id);
  validateWorkspacePath(editable.workspacePath);
  const existing = getProject(database, editable.id);
  // Metadata edits never relabel existing data; Main must explicitly move it.
  if (editable.workspacePath !== existing.workspacePath) {
    throw new Error('保存場所の変更にはデータ移動の検証が必要です。明示的な移動操作を使用してください。');
  }
  const updated: Project = { ...existing, ...editable, updatedAt: new Date().toISOString() };
  if (!replaceProject(database, updated)) {
    throw new Error('初回Training Run作成後はタスク種別を変更できません。');
  }
  return updated;
}

export interface ProjectMoveServiceResult {
  /** Fresh DB values, never a receipt root adopted as metadata. */
  readonly project: Project;
  /** none means no receipt, NOT proof of cleanup. Only E2 completion is completed.
   * source-retained also covers unconfirmed/partial cleanup requiring attention.
   */
  readonly cleanupStatus: ProjectMoveRecoveryResult['status'];
  readonly cleanupError?: {
    readonly code: 'PROJECT_SOURCE_CLEANUP_FAILED';
    readonly message: string;
  };
}

// D/E2 each release their own exclusion. Keep this Project busy across BOTH
// awaits, including the gap between them; unrelated Projects remain available.
// This is per connection, not a path lock or an OS-/cross-connection atomicity claim.
const serviceMoves = new WeakMap<DatabaseConnection, Set<string>>();

function assertProjectNotBusy(database: DatabaseConnection, projectId: string): void {
  assertProjectNotMoving(database, projectId); // Also respect direct D/E2 callers.
  if (serviceMoves.get(database)?.has(projectId)) {
    throw new Error('Projectは移動中です。完了後に再試行してください。');
  }
}

function beginServiceMove(database: DatabaseConnection, projectId: string): () => void {
  assertProjectNotBusy(database, projectId);
  if (database.inTransaction) throw new Error('Project移動・回復は既存のtransaction内では実行できません。');
  const releaseActivity = beginProjectMoveActivity(database, projectId);
  const active = serviceMoves.get(database) ?? new Set<string>();
  serviceMoves.set(database, active);
  active.add(projectId);
  return () => {
    active.delete(projectId);
    if (active.size === 0) serviceMoves.delete(database);
    releaseActivity();
  };
}

function validateMovePath(path: string): void {
  // v1 receipts require local, canonical Windows paths. Reject unsafe original
  // components BEFORE DB/filesystem I/O, rather than normalizing them away.
  if (typeof path !== 'string' || !/^[a-z]:\\/i.test(path) || path.length > 32_767
    || !path.isWellFormed() || path !== win32.normalize(path)
    || path.slice(3).split('\\').some((name) => name.length === 0 || name.length > 255 || /^(?:conin\$|conout\$)(?:\.|$)/i.test(name))) {
    throw new TypeError('Project移動には通常のローカル絶対フォルダーパスを指定してください。');
  }
  validateWorkspacePath(path);
}

function validateReceiptDirectory(receiptDirectory: string): void {
  validateMovePath(receiptDirectory);
  if (win32.basename(receiptDirectory).toLowerCase() !== 'project-moves') {
    throw new TypeError('Mainが構成したproject-movesフォルダーを指定してください。');
  }
}

async function recoverWithStatus(database: DatabaseConnection, projectId: string,
  receiptDirectory: string): Promise<ProjectMoveServiceResult> {
  // Missing Projects / failed DB reads are not cleanup results. Never fabricate
  // a Project or fall back to the pre-move snapshot when the DB is unavailable.
  getProject(database, projectId);
  let recovered: ProjectMoveRecoveryResult;
  try {
    recovered = await recoverProjectMove(database, projectId, receiptDirectory);
  } catch {
    // An E2 write/unlink can succeed before its acknowledgement fails. Do not
    // roll back, retry the move, or claim the old root is necessarily intact.
    // Do not expose native exception paths/stacks through a future UI response.
    return Object.freeze({ project: getProject(database, projectId), cleanupStatus: 'source-retained',
      cleanupError: Object.freeze({ code: 'PROJECT_SOURCE_CLEANUP_FAILED',
        message: '旧保存場所の回収を確認できませんでした。現在の保存先を保持しています。移動をやり直さず、明示的な復旧で確認してください。' }) });
  }
  return Object.freeze({ project: getProject(database, projectId), cleanupStatus: recovered.status });
}

/** Main only: destinationParent is the explicitly selected parent, while
 * receiptDirectory/protectedRoots come from Main configuration, NOT Renderer.
 * Startup provisions receiptDirectory; no default, mkdir or DB-path inference.
 * D failures propagate; after its commit, E2 failures return a cleanup warning
 * with current DB values instead of presenting the whole move as failed.
 * Picker calls must pass their retained selectedParent. Only trusted Main
 * nonpicker calls may omit it; D independently snapshots even our frozen copy.
 */
export async function moveProject(database: DatabaseConnection, id: unknown, destinationParent: string,
  receiptDirectory: string, protectedRoots: readonly string[], selectedParent?: ProjectMoveSelectedParent): Promise<ProjectMoveServiceResult> {
  const projectId = projectIdSchema.parse(id);
  validateMovePath(destinationParent);
  validateReceiptDirectory(receiptDirectory);
  if (!Array.isArray(protectedRoots)) throw new TypeError('Mainが構成した保護対象フォルダーの配列を指定してください。');
  const roots = [...protectedRoots];
  for (const root of roots) validateMovePath(root);
  const parentSnapshot = snapshotProjectMoveParent(selectedParent, destinationParent);
  const release = beginServiceMove(database, projectId);
  try {
    await moveProjectDirectory(database, projectId, destinationParent, roots, receiptDirectory, parentSnapshot);
    return await recoverWithStatus(database, projectId, receiptDirectory);
  } finally { release(); }
}

/** Explicit Main startup/recovery entry for CORE-07/UIR-019. Disk receipt and
 * CURRENT DB decide the outcome; no automatic adoption, move or background retry.
 */
export async function recoverProject(database: DatabaseConnection, id: unknown,
  receiptDirectory: string): Promise<ProjectMoveServiceResult> {
  const projectId = projectIdSchema.parse(id);
  validateReceiptDirectory(receiptDirectory);
  const release = beginServiceMove(database, projectId);
  try {
    return await recoverWithStatus(database, projectId, receiptDirectory);
  } finally { release(); }
}