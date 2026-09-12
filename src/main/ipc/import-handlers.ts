import type { Dialog, Event as ElectronEvent, IpcMain, IpcMainInvokeEvent, OpenDialogOptions,
  WebContents, WebContentsDidStartNavigationEventParams, WebFrameMain } from 'electron';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual, types } from 'node:util';
import type { z } from 'zod';

import { MAX_ANNOTATION_BYTES, MAX_INPUT_ITEMS, type ScanSource } from '../../shared/contracts/import.js';
import { IMPORT_START_CHANNEL, IMPORT_PREVIEW_CHANNEL, IMPORT_COMMIT_CHANNEL, IMPORT_DISCARD_CHANNEL,
  importStartInputSchema, importPreviewInputSchema, importCommitInputSchema, importDiscardInputSchema,
  importStartResponseSchema, importPreviewResponseSchema, importCommitResponseSchema, importDiscardResponseSchema,
  importIpcErrorSchema, type ImportIpcErrorCode, type ImportPreviewInput } from '../../shared/contracts/import-ipc.js';
import type { Project } from '../../shared/contracts/project.js';
import { ImportServiceError, type ImportService } from '../data/import-service.js';
import type { DatabaseConnection } from '../db/database.js';
import { getProject, getProjects } from '../projects/project-service.js';

class RequestFailure extends Error {
  constructor(readonly code: ImportIpcErrorCode) { super(code); }
}
type Document = { frame: WebFrameMain; generation: number };
type Capability = { token: string; projectId: string; jobId: string; mode: 'copy' | 'reference';
  taskType: Project['taskType']; project: Project; document: Document; revoked: boolean; committing: boolean };
function fileUrl(value: string): string | undefined {
  try {
    const base = value.split('#', 1)[0], url = new URL(value); url.hash = '';
    if (url.protocol !== 'file:' || url.host !== '' || url.search !== '' || base?.includes('?')
      || url.href !== base || fileURLToPath(url).includes('\0')) return undefined;
    return url.href;
  } catch { return undefined; }
}
// No realpath/stat/open on selections. Preserve native spelling (including drive
// case); reject slash/dot aliases rather than normalizing away a junction.
function sourcePath(value: unknown): string {
  if (typeof value !== 'string' || !value.isWellFormed() || value.length > 32_767
    || !/^[a-z]:\\/iu.test(value) || value !== win32.normalize(value)
    || value.slice(3).split('\\').some((name) => !name || name.length > 255
      || /[\u0000-\u001f\u007f<>:"/\\|?*]/u.test(name) || /[ .]$/u.test(name)
      || /^(?:con|conin\$|conout\$|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/iu.test(name))) {
    throw new RequestFailure('IMPORT_INPUT');
  }
  return value;
}
function own(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object' || types.isProxy(value)) return undefined;
  const field = Object.getOwnPropertyDescriptor(value, key);
  return field && 'value' in field ? field.value : undefined;
}
function safeError(error: unknown) {
  let code: ImportIpcErrorCode = 'OPERATION_FAILED';
  try {
    const raw = own(error, 'code');
    if (error instanceof RequestFailure) code = raw as ImportIpcErrorCode;
    else if (error instanceof ImportServiceError) {
      const parsed = importIpcErrorSchema.safeParse({ code: raw });
      if (parsed.success) {
        code = parsed.data.code;
        if (code === 'IMPORT_CAPACITY') {
          const capacity = own(error, 'capacity');
          const detailed = importIpcErrorSchema.safeParse({ code, capacity: {
            requiredBytes: own(capacity, 'requiredBytes'), availableBytes: own(capacity, 'availableBytes'),
          } });
          if (detailed.success) return { ok: false as const, error: detailed.data };
        }
      }
    } else if (typeof raw === 'string') {
      if (/^SQLITE_(?:BUSY|LOCKED)(?:_|$)/u.test(raw)
        || ['JOB_TRANSACTION', 'JOB_SHUTDOWN', 'IMPORT_BUSY', 'PROJECT_BUSY'].includes(raw)) code = 'IMPORT_BUSY';
      else if (raw === 'JOB_NOT_FOUND') code = 'IMPORT_NOT_FOUND';
      else if (raw === 'JOB_INPUT') code = 'IMPORT_INPUT';
      else if (raw === 'JOB_STATE' || raw === 'JOB_NOT_OWNED') code = 'IMPORT_ATTENTION';
    }
  } catch { code = 'OPERATION_FAILED'; }
  return { ok: false as const, error: { code } };
}
// Reject nested/revoked proxies BEFORE shared JSON validation can inspect them.
function assertNoProxy(value: unknown, seen = new WeakSet<object>(), depth = 0): void {
  if (!value || typeof value !== 'object') return;
  if (types.isProxy(value) || depth > 4) throw new RequestFailure('INVALID_REQUEST');
  if (seen.has(value)) return; seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const field = Object.getOwnPropertyDescriptor(value, key);
    if (field && 'value' in field) assertNoProxy(field.value, seen, depth + 1);
  }
}

/** Main-only DAT-08H. Main provisions a dedicated existing selectionDirectory
 * under its protected metadata/task root, outside every Project. No startup,
 * source browsing, mkdir, worker launch on registration, or automatic cleanup.
 * Retain each <=64 MiB UUID JSON (<=100k entries) for future STO-02 cleanup:
 * discard's void return is NOT proof that the worker stopped reading it.
 * Native OS pickers themselves may browse network locations; this boundary
 * guarantees only lexical rejection before application source I/O.
 */
export function registerImportHandlers(
  ipc: Pick<IpcMain, 'handle' | 'removeHandler'>, contents: WebContents, expectedURL: string,
  database: DatabaseConnection, service: ImportService,
  trusted: Readonly<{ selectionDirectory: string }>, nativeDialog: Pick<Dialog, 'showOpenDialog'>,
): { dispose(): void } {
  const expected = fileUrl(expectedURL);
  if (expected === undefined || typeof nativeDialog.showOpenDialog !== 'function') throw new RequestFailure('INVALID_REQUEST');
  const selectionDirectory = sourcePath(trusted.selectionDirectory);
  function identity(path: string) {
    const stat = fs.lstatSync(path, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.ino === 0n) throw new RequestFailure('IMPORT_ATTENTION');
    return { dev: stat.dev, ino: stat.ino, birthtimeNs: stat.birthtimeNs };
  }
  const chain: { path: string; identity: ReturnType<typeof identity> }[] = [];
  let cursor = win32.parse(selectionDirectory).root;
  chain.push({ path: cursor, identity: identity(cursor) });
  for (const name of selectionDirectory.slice(3).split('\\')) {
    cursor = win32.join(cursor, name); chain.push({ path: cursor, identity: identity(cursor) });
  }
  // Canonicality applies to Main's managed configuration, never to a selection.
  if (fs.realpathSync.native(selectionDirectory) !== selectionDirectory) throw new RequestFailure('IMPORT_ATTENTION');
  const registered: string[] = [];
  let disposed = false, generation = 0, sequence = 0;
  let active: Capability | undefined;
  // Keep a revoked in-flight commit busy until it settles, including navigation.
  let commitInFlight = false;
  function revoke(): void {
    const old = active;
    if (!old) return;
    old.revoked = true;
    if (!old.committing) {
      // Preserve a failed cleanup context so subsequent start cannot accumulate
      // abandoned jobs; no invented cancellation acknowledgement.
      service.discard(old.jobId);
      if (active === old) active = undefined;
    }
  }
  function invalidate(): void {
    generation += 1; sequence += 1;
    try { revoke(); } catch { /* Remains revoked; never cancel a commit. */ }
  }
  function onNavigation(details: ElectronEvent<WebContentsDidStartNavigationEventParams>): void {
    if (details.isMainFrame && !details.isSameDocument) invalidate();
  }
  function isTrusted(event: IpcMainInvokeEvent): boolean {
    try {
      return !disposed && event.sender === contents && !contents.isDestroyed() && event.senderFrame !== null
        && event.senderFrame === contents.mainFrame && fileUrl(event.senderFrame.url) === expected
        && fileUrl(contents.getURL()) === expected;
    } catch { return false; }
  }
  function current(event: IpcMainInvokeEvent, document: Document): boolean {
    try { return isTrusted(event) && document.generation === generation && document.frame === event.senderFrame; }
    catch { return false; }
  }
  function assertCurrent(event: IpcMainInvokeEvent, document: Document): void {
    if (!current(event, document)) throw new RequestFailure('STALE_SELECTION');
  }
  function project(id: string): Project {
    if (database.inTransaction) throw new RequestFailure('IMPORT_BUSY');
    // Distinguish missing from broken DB/schema without inspecting error text.
    const present = database.prepare('SELECT id FROM projects WHERE id=?').get(id);
    if (!present) throw new RequestFailure('IMPORT_NOT_FOUND');
    return Object.freeze(getProject(database, id));
  }
  function checkPicker(event: IpcMainInvokeEvent, document: Document, ticket: number, original: Project): void {
    assertCurrent(event, document);
    if (ticket !== sequence) throw new RequestFailure('STALE_SELECTION');
    assertProject(original);
    assertCurrent(event, document);
    if (ticket !== sequence) throw new RequestFailure('STALE_SELECTION');
  }
  function assertProject(original: Project): void {
    let saved: Project;
    try { saved = project(original.id); }
    catch (error) {
      if (error instanceof RequestFailure && error.code === 'IMPORT_NOT_FOUND') throw new RequestFailure('IMPORT_PROJECT_CHANGED');
      throw error;
    }
    if (!isDeepStrictEqual(saved, original)) throw new RequestFailure('IMPORT_PROJECT_CHANGED');
  }
  function capability(input: ImportPreviewInput, document: Document): Capability {
    const cap = active;
    if (!cap || cap.revoked || cap.token !== input.token || cap.projectId !== input.projectId || cap.jobId !== input.jobId
      || cap.document.frame !== document.frame || cap.document.generation !== document.generation) throw new RequestFailure('STALE_SELECTION');
    return cap;
  }
  function assertCap(cap: Capability, event: IpcMainInvokeEvent, requireProjectSnapshot = true): void {
    assertCurrent(event, cap.document);
    if (cap.revoked || active !== cap) throw new RequestFailure('STALE_SELECTION');
    if (requireProjectSnapshot) assertProject(cap.project);
    assertCurrent(event, cap.document);
    if (cap.revoked || active !== cap) throw new RequestFailure('STALE_SELECTION');
  }
  function writeSelection(files: string[]): string {
    // Bound incrementally BEFORE concatenating potentially huge JSON strings.
    const parts: string[] = []; let bytes = Buffer.byteLength('{"formatVersion":1,"files":[]}');
    for (const file of files) {
      const part = JSON.stringify(file); bytes += Buffer.byteLength(part) + (parts.length ? 1 : 0);
      if (bytes > MAX_ANNOTATION_BYTES) throw new RequestFailure('IMPORT_INPUT');
      parts.push(part);
    }
    const raw = Buffer.from(`{"formatVersion":1,"files":[${parts.join(',')}]}`, 'utf8');
    if (raw.length > MAX_ANNOTATION_BYTES) throw new RequestFailure('IMPORT_INPUT');
    if (database.inTransaction) throw new RequestFailure('IMPORT_BUSY');
    for (const item of getProjects(database)) {
      const relative = win32.relative(item.workspacePath.toUpperCase(), selectionDirectory.toUpperCase());
      const reverse = win32.relative(selectionDirectory.toUpperCase(), item.workspacePath.toUpperCase());
      const within = (value: string) => value === '' || (!win32.isAbsolute(value) && value !== '..' && !value.startsWith('..\\'));
      if (within(relative) || within(reverse)) throw new RequestFailure('IMPORT_ATTENTION');
    }
    function assertChain(): void {
      try {
        for (const entry of chain) if (!isDeepStrictEqual(entry.identity, identity(entry.path))) throw new RequestFailure('IMPORT_ATTENTION');
      } catch { throw new RequestFailure('IMPORT_ATTENTION'); }
    }
    assertChain();
    const filename = win32.join(selectionDirectory, `${randomUUID()}.json`);
    const fd = fs.openSync(filename, 'wx', 0o600);
    let created: { dev: bigint; ino: bigint; birthtimeNs: bigint } | undefined;
    function assertFile(size: bigint, opened: boolean): void {
      try {
        // Never inspect the named file through an unexpected parent chain.
        assertChain();
        const handle = opened ? fs.fstatSync(fd, { bigint: true }) : undefined;
        const named = fs.lstatSync(filename, { bigint: true });
        for (const stat of handle ? [handle, named] : [named]) {
          if (!stat.isFile() || stat.isSymbolicLink() || stat.ino === 0n || stat.nlink !== 1n || stat.size !== size) {
            throw new RequestFailure('IMPORT_ATTENTION');
          }
          const actual = { dev: stat.dev, ino: stat.ino, birthtimeNs: stat.birthtimeNs };
          if (created && !isDeepStrictEqual(created, actual)) throw new RequestFailure('IMPORT_ATTENTION');
          created ??= actual;
        }
        assertChain();
      } catch { throw new RequestFailure('IMPORT_ATTENTION'); }
    }
    let failed = false;
    try {
      assertFile(0n, true); // openSync itself can race with parent replacement.
      fs.writeFileSync(fd, raw);
      assertFile(BigInt(raw.length), true);
      fs.fsyncSync(fd);
      assertFile(BigInt(raw.length), true);
    } catch (error) { failed = true; throw error; }
    finally {
      try { fs.closeSync(fd); } catch (error) { if (!failed) throw error; }
    }
    // Failure retains the artifact, never unlink by pathname after replacement.
    assertFile(BigInt(raw.length), false);
    return filename;
  }
  function register<Input, Output>(channel: string, inputSchema: z.ZodType<Input>, outputSchema: z.ZodType<Output>,
    operation: (input: Input, event: IpcMainInvokeEvent, document: Document) => Promise<unknown>): void {
    ipc.handle(channel, async (event, ...args: unknown[]) => {
      let document: Document | undefined;
      let ticket: number | undefined;
      try {
        if (!isTrusted(event) || args.length !== 1) throw new RequestFailure('INVALID_REQUEST');
        document = { frame: event.senderFrame!, generation };
        assertNoProxy(args[0]);
        const input = inputSchema.safeParse(args[0]);
        if (!input.success) throw new RequestFailure('INVALID_REQUEST');
        assertCurrent(event, document);
        const pending = operation(input.data, event, document);
        ticket = sequence;
        const value = await pending;
        assertCurrent(event, document);
        if (ticket !== sequence) throw new RequestFailure('STALE_SELECTION');
        assertNoProxy(value);
        return outputSchema.parse(value);
      } catch (error) {
        return outputSchema.parse(safeError((document && !current(event, document))
          || (ticket !== undefined && ticket !== sequence) ? new RequestFailure('STALE_SELECTION') : error));
      }
    });
    registered.push(channel);
  }
  function dispose(): void {
    if (disposed) return;
    disposed = true; invalidate();
    contents.removeListener('did-start-navigation', onNavigation);
    contents.removeListener('render-process-gone', invalidate);
    contents.removeListener('destroyed', dispose);
    for (const channel of registered.splice(0)) ipc.removeHandler(channel);
  }
  try {
    contents.on('did-start-navigation', onNavigation);
    contents.on('render-process-gone', invalidate);
    contents.on('destroyed', dispose);
    register(IMPORT_START_CHANNEL, importStartInputSchema, importStartResponseSchema, async (input, event, document) => {
      if (commitInFlight) throw new RequestFailure('IMPORT_BUSY');
      const ticket = ++sequence; revoke();
      const original = project(input.projectId);
      if ((input.sourceKind === 'coco' && original.taskType !== 'detection')
        || (['folder', 'csv'].includes(input.sourceKind) && original.taskType !== 'classification')) throw new RequestFailure('IMPORT_INPUT');
      async function pick(options: OpenDialogOptions, multiple = false): Promise<string[] | null> {
        checkPicker(event, document, ticket, original);
        const result = await nativeDialog.showOpenDialog(options);
        checkPicker(event, document, ticket, original);
        if (result.canceled === true) return null;
        if (result.canceled !== false || !Array.isArray(result.filePaths) || result.filePaths.length < 1
          || result.filePaths.length > (multiple ? MAX_INPUT_ITEMS : 1)) throw new RequestFailure('IMPORT_INPUT');
        return Array.from(result.filePaths, sourcePath);
      }
      let source: ScanSource;
      if (input.sourceKind === 'unlabeled-files') {
        const files = await pick({ title: '画像を選択', properties: ['openFile', 'multiSelections'] }, true);
        checkPicker(event, document, ticket, original);
        if (!files) return { ok: true, value: { status: 'cancelled' } };
        source = { format: 'unlabeled', selection: 'files', selectionManifestPath: writeSelection(files) };
      } else {
        const roots = await pick({ title: '画像フォルダーを選択', properties: ['openDirectory'] });
        checkPicker(event, document, ticket, original);
        if (!roots) return { ok: true, value: { status: 'cancelled' } };
        const root = roots[0]!;
        if (input.sourceKind === 'csv' || input.sourceKind === 'coco') {
          const annotations = await pick({ title: '注釈ファイルを選択', properties: ['openFile'],
            filters: [{ name: input.sourceKind === 'csv' ? 'CSV' : 'COCO JSON', extensions: [input.sourceKind === 'csv' ? 'csv' : 'json'] }] });
          checkPicker(event, document, ticket, original);
          if (!annotations) return { ok: true, value: { status: 'cancelled' } };
          source = { format: input.sourceKind, root, annotationPath: annotations[0]! };
        } else source = input.sourceKind === 'folder' ? { format: 'folder', root } : { format: 'unlabeled', selection: 'directory', root };
      }
      checkPicker(event, document, ticket, original);
      const job = service.scan(original.id, { taskType: original.taskType, mode: input.mode, source });
      const cap: Capability = { token: randomUUID(), jobId: job.id, projectId: original.id, mode: input.mode,
        taskType: original.taskType, project: original, document, revoked: false, committing: false };
      try {
        checkPicker(event, document, ticket, original);
        const response = importStartResponseSchema.parse({ ok: true, value: { status: 'started', token: cap.token, job } });
        if (job.projectId !== original.id) throw new RequestFailure('OPERATION_FAILED');
        active = cap;
        return response;
      } catch (error) { try { service.discard(job.id); } catch { /* Never erase the primary failure. */ } throw error; }
    });
    register(IMPORT_PREVIEW_CHANNEL, importPreviewInputSchema, importPreviewResponseSchema, async (input, event, document) => {
      const cap = capability(input, document);
      assertCap(cap, event);
      const value = await service.preview(cap.projectId, cap.jobId);
      assertCap(cap, event);
      if (value.projectId !== cap.projectId || value.jobId !== cap.jobId || value.taskType !== cap.taskType || value.mode !== cap.mode) {
        throw new RequestFailure('OPERATION_FAILED');
      }
      return { ok: true, value };
    });
    register(IMPORT_COMMIT_CHANNEL, importCommitInputSchema, importCommitResponseSchema, async (input, event, document) => {
      const cap = capability(input, document);
      if (commitInFlight || cap.committing) throw new RequestFailure('IMPORT_BUSY');
      assertCap(cap, event);
      commitInFlight = true; cap.committing = true;
      try {
        const value = await service.commit(cap.projectId, cap.jobId, { mode: cap.mode, rightsAccepted: true,
          ...(input.classNames === undefined ? {} : { classNames: input.classNames }) });
        assertCap(cap, event); // Stale is NOT a rollback claim, even on success.
        if (value.projectId !== cap.projectId) throw new RequestFailure('IMPORT_OUTCOME_UNCERTAIN');
        const parsed = importCommitResponseSchema.safeParse({ ok: true, value });
        if (!parsed.success) throw new RequestFailure('IMPORT_OUTCOME_UNCERTAIN');
        return parsed.data;
      } finally {
        commitInFlight = false; cap.committing = false;
        // Keep a live capability for explicit idempotent/uncertain retry. The
        // real service verifies persisted DB state; no automatic retry here.
        if (cap.revoked && active === cap) active = undefined;
      }
    });
    register(IMPORT_DISCARD_CHANNEL, importDiscardInputSchema, importDiscardResponseSchema, async (input, event, document) => {
      const cap = capability(input, document);
      if (cap.committing) throw new RequestFailure('IMPORT_BUSY');
      // Cancellation consumes only this document/project/job token; changed
      // metadata must block execution, not trap the user in an unusable scan.
      assertCap(cap, event, false);
      sequence += 1;
      try {
        service.discard(cap.jobId);
        assertCap(cap, event, false);
        cap.revoked = true;
        if (active === cap) active = undefined;
      } catch (error) { cap.revoked = true; throw error; }
      return { ok: true, value: null };
    });
  } catch (error) { dispose(); throw error; }
  return Object.freeze({ dispose });
}