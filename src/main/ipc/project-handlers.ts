import type {
  Dialog, Event as ElectronEvent, IpcMain, IpcMainInvokeEvent, WebContents,
  WebContentsDidStartNavigationEventParams, WebFrameMain,
} from 'electron';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

import type { Project } from '../../shared/contracts/project.js';
import {
  PROJECT_CREATE_CHANNEL, PROJECT_DELETE_CHANNEL, PROJECT_DELETE_PREVIEW_CHANNEL, PROJECT_GET_CHANNEL,
  PROJECT_LIST_CHANNEL, PROJECT_MOVE_CHANNEL,
  PROJECT_PICK_PARENT_CHANNEL, PROJECT_RECOVER_CHANNEL, PROJECT_UPDATE_CHANNEL,
  projectCreateInputSchema, projectCreateResponseSchema,
  projectDeleteInputSchema, projectDeletePreviewInputSchema, projectDeletePreviewResponseSchema,
  projectDeleteResponseSchema, projectGetInputSchema, projectGetResponseSchema,
  projectListInputSchema, projectListResponseSchema, projectMoveInputSchema, projectMoveResponseSchema,
  projectPickParentInputSchema, projectPickParentResponseSchema, projectRecoverInputSchema, projectRecoverResponseSchema,
  projectSnapshotSchema, projectUpdateInputSchema, projectUpdateResponseSchema,
  type ProjectCreateResponse, type ProjectDeletePreviewResponse, type ProjectDeleteResponse,
  type ProjectGetResponse, type ProjectIpcErrorCode, type ProjectListResponse,
  type ProjectMoveResponse, type ProjectPickParentResponse, type ProjectRecoverResponse,
  type ProjectSnapshot, type ProjectUpdateResponse,
} from '../../shared/contracts/project-ipc.js';
import type { DatabaseConnection } from '../db/database.js';
import { deleteProject } from '../projects/delete-project.js';
import { previewProjectDeletion } from '../projects/delete-preview.js';
import type { ProjectFileIdentity } from '../projects/project-directory.js';
import { assertProjectNotMoving } from '../projects/project-move.js';
import { findProject, listProjects } from '../projects/project-repository.js';
import { createProject, moveProject, recoverProject, updateProject } from '../projects/project-service.js';

class RequestFailure extends Error {
  constructor(readonly code: ProjectIpcErrorCode) { super(code); }
}

const lockRowSchema = z.strictObject({ task_type_locked: z.union([z.literal(0), z.literal(1)]) });
type RequestDocument = Readonly<{ frame: WebFrameMain; generation: number }>;
type DirectoryEntry = Readonly<{ path: string; identity: ProjectFileIdentity }>;
type SelectedParent = Readonly<{ selectedPath: string; canonicalPath: string; chain: readonly DirectoryEntry[] }>;
type ParentCapability = Readonly<{ token: string; document: RequestDocument; parent: SelectedParent }> & (
  | Readonly<{ purpose: 'create' }>
  | Readonly<{ purpose: 'move'; projectId: string; originalProject: ProjectSnapshot }>
);

function fileUrl(value: string): string | undefined {
  try {
    const base = value.split('#', 1)[0];
    const url = new URL(value);
    url.hash = '';
    if (url.protocol !== 'file:' || url.host !== '' || url.search !== ''
      || base?.includes('?') || url.href !== base || fileURLToPath(url).includes('\0')) return undefined;
    return url.href;
  } catch { return undefined; }
}

function sameIdentity(a: ProjectFileIdentity, b: ProjectFileIdentity): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.birthtimeNs === b.birthtimeNs;
}

function directoryIdentity(path: string): ProjectFileIdentity {
  const stat = fs.lstatSync(path, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.ino === 0n) {
    throw new Error('Selected parent is not an identifiable ordinary directory.');
  }
  return Object.freeze({ dev: String(stat.dev), ino: String(stat.ino), birthtimeNs: String(stat.birthtimeNs) });
}

function directoryPath(input: string): string {
  if (process.platform !== 'win32' || typeof input !== 'string' || !input.isWellFormed() || input.length > 32_767
    || !/^(?:[a-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+[\\/])/i.test(input)
    || input.startsWith('\\\\?\\') || input.startsWith('\\\\.\\') || /[\u0000-\u001f\u007f]/.test(input)) {
    throw new Error('Selected parent requires an ordinary Windows absolute path.');
  }
  const path = input.replaceAll('/', '\\');
  const names = /^[a-z]:/i.test(path) ? path.split('\\').slice(1) : path.split('\\').slice(2);
  if (names.some((name) => name !== '' && name !== '.' && name !== '..' && (
    name.length > 255 || /[<>:"|?*]/.test(name) || /[ .]$/.test(name)
    || /^(?:con|conin\$|conout\$|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name)
  )) || win32.resolve(path) === win32.parse(win32.resolve(path)).root) {
    throw new Error('Selected parent is not a supported directory path.');
  }
  return path;
}

function directoryChain(path: string): DirectoryEntry[] {
  let cursor = win32.parse(path).root;
  const chain: DirectoryEntry[] = [{ path: cursor, identity: directoryIdentity(cursor) }];
  // Check the native selection's original components BEFORE normalizing dot
  // segments. A junction followed by '..' must not disappear from inspection.
  for (const part of path.slice(cursor.length).split('\\')) {
    if (part === '' || part === '.') continue;
    cursor = part === '..' ? win32.dirname(cursor) : win32.join(cursor, part);
    chain.push({ path: cursor, identity: directoryIdentity(cursor) });
  }
  return chain;
}

function inspectParent(input: string): SelectedParent {
  const selectedPath = directoryPath(input);
  const original = directoryChain(selectedPath);
  const canonicalPath = directoryPath(fs.realpathSync.native(selectedPath));
  const canonical = directoryChain(canonicalPath);
  const chain = [...original, ...canonical];
  for (const entry of chain) {
    if (!sameIdentity(entry.identity, directoryIdentity(entry.path))) throw new Error('Selected parent changed.');
  }
  if (!sameIdentity(original[original.length - 1]!.identity, canonical[canonical.length - 1]!.identity)
    || fs.realpathSync.native(selectedPath) !== canonicalPath) throw new Error('Selected parent changed.');
  return { selectedPath, canonicalPath, chain };
}

function revalidateParent(parent: SelectedParent): string {
  try {
    const current = inspectParent(parent.selectedPath);
    if (current.canonicalPath !== parent.canonicalPath || current.chain.length !== parent.chain.length
      || current.chain.some((entry, index) => entry.path !== parent.chain[index]!.path
        || !sameIdentity(entry.identity, parent.chain[index]!.identity))) throw new Error('Selected parent changed.');
    return current.canonicalPath;
  } catch { throw new RequestFailure('STALE_SELECTION'); }
}

function sameProjectSnapshot(a: ProjectSnapshot, b: ProjectSnapshot): boolean {
  const left = a.project; const right = b.project;
  return a.taskTypeLocked === b.taskTypeLocked && left.id === right.id && left.name === right.name
    && left.description === right.description && left.taskType === right.taskType
    && left.workspacePath === right.workspacePath && left.createdAt === right.createdAt && left.updatedAt === right.updatedAt;
}

/** Explicit CORE-07H registration only; no app startup or generic RPC surface.
 * Main must pass Electron's real dialog at startup. Requiring this narrow native
 * dependency lets Node tests supply a picker without importing/launching Electron;
 * project services, SQLite and filesystem operations are never injected.
 * Main also provisions receiptDirectory; this function does not create it.
 */
export function registerProjectHandlers(
  ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>,
  trustedWebContents: WebContents,
  expectedRendererURL: string,
  database: DatabaseConnection,
  trustedMain: Readonly<{ receiptDirectory: string; protectedRoots: readonly string[] }>,
  nativeDialog: Pick<Dialog, 'showOpenDialog'>,
): { dispose(): void } {
  const expected = fileUrl(expectedRendererURL);
  if (expected === undefined || typeof trustedMain.receiptDirectory !== 'string'
    || !Array.isArray(trustedMain.protectedRoots) || trustedMain.protectedRoots.some((root) => typeof root !== 'string')
    || typeof nativeDialog.showOpenDialog !== 'function') throw new RequestFailure('INVALID_REQUEST');
  const receiptDirectory = trustedMain.receiptDirectory;
  const protectedRoots = Object.freeze([...trustedMain.protectedRoots]);
  const registered: string[] = [];
  const activeWrites = new Set<string>();
  let disposed = false;
  let generation = 0;
  let pickerSequence = 0;
  // This registration serves exactly one trusted WebContents: at most one
  // outstanding capability across BOTH purposes, with no Renderer-owned paths.
  let selection: ParentCapability | undefined;

  function invalidate(): void { generation += 1; pickerSequence += 1; selection = undefined; }
  function onNavigation(details: ElectronEvent<WebContentsDidStartNavigationEventParams>): void {
    if (details.isMainFrame && !details.isSameDocument) invalidate();
  }
  function trusted(event: IpcMainInvokeEvent): boolean {
    try {
      const frame = event.senderFrame;
      return !disposed && event.sender === trustedWebContents && !trustedWebContents.isDestroyed()
        && frame !== null && frame === trustedWebContents.mainFrame
        && fileUrl(frame.url) === expected && fileUrl(trustedWebContents.getURL()) === expected;
    } catch { return false; }
  }
  function begin(event: IpcMainInvokeEvent, args: unknown[], count: number): RequestDocument {
    if (!trusted(event) || args.length !== count) throw new RequestFailure('INVALID_REQUEST');
    const frame = event.senderFrame;
    if (frame === null) throw new RequestFailure('INVALID_REQUEST');
    return { frame, generation };
  }
  function current(event: IpcMainInvokeEvent, document: RequestDocument): boolean {
    try { return trusted(event) && generation === document.generation && event.senderFrame === document.frame; }
    catch { return false; }
  }
  function assertCurrent(event: IpcMainInvokeEvent, document: RequestDocument): void {
    if (!current(event, document)) throw new RequestFailure('STALE_SELECTION');
  }
  function failure(event: IpcMainInvokeEvent, document: RequestDocument | undefined, error: unknown) {
    let code: ProjectIpcErrorCode = 'OPERATION_FAILED';
    try {
      if (document && !current(event, document)) code = 'STALE_SELECTION';
      else if (error instanceof RequestFailure) code = error.code;
      else if (error instanceof Error && (error.message === 'Projectは移動中です。完了後に再試行してください。'
        || ('code' in error && typeof error.code === 'string' && /^SQLITE_(?:BUSY|LOCKED)(?:_|$)/.test(error.code)))) code = 'BUSY';
    } catch { code = 'OPERATION_FAILED'; }
    // Existing services do not export a typed busy error. Match only their exact
    // exclusion signal / SQLite busy codes; never copy any native error fields.
    return { ok: false as const, error: { code } };
  }

  function readConsistently<T>(read: () => T): T {
    // DTO and lock SELECTs share a SQLite snapshot, not two autocommit reads.
    // Never expose uncommitted values or end another Main caller's transaction.
    if (database.inTransaction) throw new RequestFailure('BUSY');
    database.exec('BEGIN DEFERRED');
    try {
      const value = read();
      database.exec('COMMIT');
      return value;
    } catch (error) {
      if (database.inTransaction) database.exec('ROLLBACK');
      throw error;
    }
  }
  function snapshot(project: Project): ProjectSnapshot {
    const row = lockRowSchema.parse(database.prepare('SELECT task_type_locked FROM projects WHERE id=?').get(project.id));
    return projectSnapshotSchema.parse({ project, taskTypeLocked: row.task_type_locked === 1 });
  }
  function readProject(projectId: string): ProjectSnapshot {
    return readConsistently(() => {
      const project = findProject(database, projectId);
      if (!project) throw new RequestFailure('NOT_FOUND');
      return snapshot(project);
    });
  }
  function readAfterOperation(projectId: string): ProjectSnapshot {
    // A failed post-service read is an unacknowledged outcome, not evidence
    // that the operation was a missing-project no-op or was rolled back.
    try { return readProject(projectId); }
    catch { throw new RequestFailure('OPERATION_FAILED'); }
  }
  function assertOriginal(original: ProjectSnapshot): void {
    let saved: ProjectSnapshot;
    try { saved = readProject(original.project.id); } catch (error) {
      if (error instanceof RequestFailure && error.code === 'NOT_FOUND') throw new RequestFailure('STALE_SELECTION');
      throw error;
    }
    if (!sameProjectSnapshot(original, saved)) throw new RequestFailure('STALE_SELECTION');
  }
  function assertNotBusy(projectId: string): void {
    if (activeWrites.has(projectId)) throw new RequestFailure('BUSY');
    assertProjectNotMoving(database, projectId);
  }
  function beginWrite(projectId: string): () => void {
    assertNotBusy(projectId);
    activeWrites.add(projectId);
    return () => { activeWrites.delete(projectId); };
  }
  function assertCanAwait(): void {
    if (database.inTransaction) throw new RequestFailure('BUSY');
  }
  function consume(document: RequestDocument, token: string, purpose: 'create' | 'move', projectId?: string): ParentCapability {
    const capability = selection;
    if (!capability || capability.token !== token) throw new RequestFailure('STALE_SELECTION');
    // Burn before ANY service call, including busy, failed and uncertain writes.
    selection = undefined;
    if (capability.document.generation !== document.generation || capability.document.frame !== document.frame
      || capability.purpose !== purpose || (capability.purpose === 'move' && capability.projectId !== projectId)) {
      throw new RequestFailure('STALE_SELECTION');
    }
    return capability;
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    invalidate();
    trustedWebContents.removeListener('did-start-navigation', onNavigation);
    trustedWebContents.removeListener('render-process-gone', invalidate);
    trustedWebContents.removeListener('destroyed', dispose);
    for (const channel of registered.splice(0)) ipcMain.removeHandler(channel);
    // Already-started service work keeps its own exclusion and recovery rules.
    // Disposal suppresses its outbound value; it is NOT filesystem rollback.
  }

  try {
    trustedWebContents.on('did-start-navigation', onNavigation);
    trustedWebContents.on('render-process-gone', invalidate);
    trustedWebContents.on('destroyed', dispose);

    ipcMain.handle(PROJECT_LIST_CHANNEL, (event, ...args: unknown[]): ProjectListResponse => {
      let document: RequestDocument | undefined;
      try {
        document = begin(event, args, 0);
        if (!projectListInputSchema.safeParse(args[0]).success) throw new RequestFailure('INVALID_REQUEST');
        const response = projectListResponseSchema.parse({ ok: true, value: readConsistently(() => listProjects(database).map(snapshot)) });
        assertCurrent(event, document);
        return response;
      } catch (error) { return projectListResponseSchema.parse(failure(event, document, error)); }
    });
    registered.push(PROJECT_LIST_CHANNEL);

    ipcMain.handle(PROJECT_GET_CHANNEL, (event, ...args: unknown[]): ProjectGetResponse => {
      let document: RequestDocument | undefined;
      try {
        document = begin(event, args, 1);
        const input = projectGetInputSchema.safeParse(args[0]);
        if (!input.success) throw new RequestFailure('INVALID_REQUEST');
        const response = projectGetResponseSchema.parse({ ok: true, value: readProject(input.data.projectId) });
        assertCurrent(event, document);
        return response;
      } catch (error) { return projectGetResponseSchema.parse(failure(event, document, error)); }
    });
    registered.push(PROJECT_GET_CHANNEL);

    ipcMain.handle(PROJECT_CREATE_CHANNEL, (event, ...args: unknown[]): ProjectCreateResponse => {
      let document: RequestDocument | undefined;
      try {
        document = begin(event, args, 1);
        const input = projectCreateInputSchema.safeParse(args[0]);
        if (!input.success) throw new RequestFailure('INVALID_REQUEST');
        const parent = consume(document, input.data.parentToken, 'create').parent;
        assertCanAwait(); // create owns its synchronous filesystem/DB transaction too.
        const workspacePath = revalidateParent(parent);
        assertCurrent(event, document);
        const { name, description, taskType } = input.data;
        const created = createProject(database, { name, description, taskType, workspacePath }, [...protectedRoots, receiptDirectory]);
        const response = projectCreateResponseSchema.parse({ ok: true, value: readAfterOperation(created.id) });
        assertCurrent(event, document);
        return response;
      } catch (error) { return projectCreateResponseSchema.parse(failure(event, document, error)); }
    });
    registered.push(PROJECT_CREATE_CHANNEL);

    ipcMain.handle(PROJECT_UPDATE_CHANNEL, (event, ...args: unknown[]): ProjectUpdateResponse => {
      let document: RequestDocument | undefined;
      let release: (() => void) | undefined;
      try {
        document = begin(event, args, 1);
        const input = projectUpdateInputSchema.safeParse(args[0]);
        if (!input.success) throw new RequestFailure('INVALID_REQUEST');
        assertCanAwait();
        release = beginWrite(input.data.id);
        const saved = readProject(input.data.id);
        assertCurrent(event, document);
        // No await between the fresh Main read and the real service's busy/lock
        // checks. Renderer metadata cannot relabel a root or submit a snapshot.
        updateProject(database, { ...input.data, workspacePath: saved.project.workspacePath });
        const response = projectUpdateResponseSchema.parse({ ok: true, value: readAfterOperation(input.data.id) });
        assertCurrent(event, document);
        return response;
      } catch (error) { return projectUpdateResponseSchema.parse(failure(event, document, error)); }
      finally { release?.(); }
    });
    registered.push(PROJECT_UPDATE_CHANNEL);

    ipcMain.handle(PROJECT_PICK_PARENT_CHANNEL, async (event, ...args: unknown[]): Promise<ProjectPickParentResponse> => {
      let document: RequestDocument | undefined;
      try {
        document = begin(event, args, 1);
        const input = projectPickParentInputSchema.safeParse(args[0]);
        if (!input.success) throw new RequestFailure('INVALID_REQUEST');
        const ticket = ++pickerSequence;
        selection = undefined;
        assertCanAwait();
        if (input.data.purpose === 'move') assertNotBusy(input.data.projectId);
        const original = input.data.purpose === 'move' ? readProject(input.data.projectId) : undefined;
        assertCurrent(event, document);
        const result = await nativeDialog.showOpenDialog({
          properties: ['openDirectory'],
          title: input.data.purpose === 'create' ? 'Projectの親フォルダーを選択' : 'Project移動先の親フォルダーを選択',
        });
        assertCurrent(event, document);
        if (ticket !== pickerSequence) throw new RequestFailure('STALE_SELECTION');
        assertCanAwait();
        if (original) assertOriginal(original);
        if (result.canceled === true) {
          const response = projectPickParentResponseSchema.parse({ ok: true, value: { status: 'cancelled' } });
          assertCurrent(event, document);
          return response;
        }
        if (result.canceled !== false || !Array.isArray(result.filePaths) || result.filePaths.length !== 1) {
          throw new RequestFailure('OPERATION_FAILED');
        }
        const parent = inspectParent(result.filePaths[0]!);
        const token = randomUUID();
        const response = projectPickParentResponseSchema.parse({ ok: true, value: { status: 'selected', token, displayPath: parent.canonicalPath } });
        assertCurrent(event, document);
        selection = original === undefined ? { token, document, parent, purpose: 'create' }
          : { token, document, parent, purpose: 'move', projectId: original.project.id, originalProject: original };
        return response;
      } catch (error) { return projectPickParentResponseSchema.parse(failure(event, document, error)); }
    });
    registered.push(PROJECT_PICK_PARENT_CHANNEL);

    ipcMain.handle(PROJECT_MOVE_CHANNEL, async (event, ...args: unknown[]): Promise<ProjectMoveResponse> => {
      let document: RequestDocument | undefined;
      let release: (() => void) | undefined;
      try {
        document = begin(event, args, 1);
        const input = projectMoveInputSchema.safeParse(args[0]);
        if (!input.success) throw new RequestFailure('INVALID_REQUEST');
        const capability = consume(document, input.data.parentToken, 'move', input.data.projectId);
        if (capability.purpose !== 'move') throw new RequestFailure('STALE_SELECTION');
        release = beginWrite(input.data.projectId);
        assertCanAwait();
        assertOriginal(capability.originalProject);
        const parent = revalidateParent(capability.parent);
        assertCurrent(event, document);
        const moved = await moveProject(
          database, input.data.projectId, parent, receiptDirectory, protectedRoots, capability.parent,
        );
        assertCurrent(event, document);
        // A post-commit cleanup warning stays ok:true. Read CURRENT DB metadata
        // and its actual lock; no receipt root, old snapshot or rollback claim.
        const response = projectMoveResponseSchema.parse({ ok: true, value: { ...moved, ...readAfterOperation(input.data.projectId) } });
        assertCurrent(event, document);
        return response;
      } catch (error) { return projectMoveResponseSchema.parse(failure(event, document, error)); }
      finally { release?.(); }
    });
    registered.push(PROJECT_MOVE_CHANNEL);

    ipcMain.handle(PROJECT_RECOVER_CHANNEL, async (event, ...args: unknown[]): Promise<ProjectRecoverResponse> => {
      let document: RequestDocument | undefined;
      let release: (() => void) | undefined;
      try {
        document = begin(event, args, 1);
        const input = projectRecoverInputSchema.safeParse(args[0]);
        if (!input.success) throw new RequestFailure('INVALID_REQUEST');
        release = beginWrite(input.data.projectId);
        assertCanAwait();
        readProject(input.data.projectId);
        assertCurrent(event, document);
        const recovered = await recoverProject(database, input.data.projectId, receiptDirectory);
        assertCurrent(event, document);
        const response = projectRecoverResponseSchema.parse({ ok: true, value: { ...recovered, ...readAfterOperation(input.data.projectId) } });
        assertCurrent(event, document);
        return response;
      } catch (error) { return projectRecoverResponseSchema.parse(failure(event, document, error)); }
      finally { release?.(); }
    });
    registered.push(PROJECT_RECOVER_CHANNEL);

    // CORE-10/REL-04: preview never writes, and delete requires a separate,
    // explicitly confirmed call. Blockers are reported, not bypassed.
    ipcMain.handle(PROJECT_DELETE_PREVIEW_CHANNEL, (event, ...args: unknown[]): ProjectDeletePreviewResponse => {
      let document: RequestDocument | undefined;
      try {
        document = begin(event, args, 1);
        const input = projectDeletePreviewInputSchema.safeParse(args[0]);
        if (!input.success) throw new RequestFailure('INVALID_REQUEST');
        assertCanAwait();
        readProject(input.data.projectId);
        const preview = previewProjectDeletion(database, input.data.projectId);
        const response = projectDeletePreviewResponseSchema.parse({ ok: true, value: preview });
        assertCurrent(event, document);
        return response;
      } catch (error) { return projectDeletePreviewResponseSchema.parse(failure(event, document, error)); }
    });
    registered.push(PROJECT_DELETE_PREVIEW_CHANNEL);

    ipcMain.handle(PROJECT_DELETE_CHANNEL, (event, ...args: unknown[]): ProjectDeleteResponse => {
      let document: RequestDocument | undefined;
      let release: (() => void) | undefined;
      try {
        document = begin(event, args, 1);
        const input = projectDeleteInputSchema.safeParse(args[0]);
        if (!input.success) throw new RequestFailure('INVALID_REQUEST');
        assertCanAwait();
        release = beginWrite(input.data.projectId);
        readProject(input.data.projectId);
        assertCurrent(event, document);
        const result = deleteProject(database, input.data.projectId);
        // Retained owned paths are reported as a count: Main never hands the
        // Renderer a filesystem path.
        const response = projectDeleteResponseSchema.parse({ ok: true, value: {
          projectId: result.projectId, deletedRows: result.deletedRows,
          directory: result.directory, retainedPathCount: result.retainedPaths.length,
        } });
        assertCurrent(event, document);
        return response;
      } catch (error) { return projectDeleteResponseSchema.parse(failure(event, document, error)); }
      finally { release?.(); }
    });
    registered.push(PROJECT_DELETE_CHANNEL);
  } catch (error) {
    // Push only AFTER handle succeeds. An existing conflicting channel belongs
    // to someone else and must never be removed by partial registration cleanup.
    dispose();
    throw error;
  }
  return Object.freeze({ dispose });
}
