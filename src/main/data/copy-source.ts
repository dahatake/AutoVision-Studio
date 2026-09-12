import crypto from 'node:crypto';
import native, { constants, type BigIntStats } from 'node:fs';
import fs, { type FileHandle } from 'node:fs/promises';
import { win32 } from 'node:path';

import { MAX_IMAGE_BYTES, type ScanImage } from '../../shared/contracts/import.js';
import {
  verifyProjectDirectory,
  type ProjectDirectoryReceipt,
  type ProjectFileIdentity,
} from '../projects/project-directory.js';

const chunkBytes = 64 * 1024;
const markerName = '.autovision-project.json';
const temporaryPrefix = '.autovision-copy-';

/** The scan fields that DAT-06 revalidates. A full ScanImage is assignable. */
export type CopySourceImage = Readonly<Pick<
  ScanImage,
  'key' | 'sourcePath' | 'byteSize' | 'mtimeNs' | 'sha256'
>>;

/**
 * Immutable proof of the published Project-owned copy.
 *
 * fileIdentity is immediate publication evidence, not a stable manifest key:
 * moving a Project across volumes legitimately changes file identities. DAT-07
 * persists imageKey/relativePath/byteSize/sha256 as the portable source manifest.
 */
export interface CopiedSourceFile {
  readonly imageKey: string;
  readonly relativePath: string;
  readonly byteSize: number;
  readonly sha256: string;
  readonly fileIdentity: ProjectFileIdentity;
}

interface FileStamp {
  readonly identity: ProjectFileIdentity;
  readonly size: bigint;
  readonly mtimeNs: bigint;
  readonly ctimeNs: bigint;
  readonly nlink: bigint;
}

interface DirectoryGuard {
  readonly path: string;
  readonly identity: ProjectFileIdentity;
}

interface SourceSnapshot {
  readonly imageKey: string;
  readonly sourcePath: string;
  readonly byteSize: number;
  readonly mtimeNs: bigint;
  readonly sha256: string;
}

interface PublicationState {
  finalOwned: boolean;
  tempRemoved: boolean;
  committed: boolean;
}

function invalidInput(): never {
  throw new TypeError('コピー元には検証済みscan画像と安全なProject内相対パスが必要です。');
}

function unsafeSource(): never {
  throw new Error('コピー元にはリンク・hardlink・非通常ファイルを含まないローカル画像が必要です。');
}

function sourceChanged(): never {
  throw new Error('scan後またはコピー中に元画像の実体または内容が変更されました。');
}

function unsafeDestination(): never {
  throw new Error('コピー先は既存Project内のリンクを含まない通常フォルダーでなければなりません。');
}

function destinationExists(): never {
  throw new Error('コピー先には既存ファイルまたは大文字小文字違いの名前があります。');
}

function projectChanged(): never {
  throw new Error('コピー中にProjectの実体または所有markerが変更されました。');
}

function integrityFailed(): never {
  throw new Error('Project内の一時コピーのサイズまたはSHA-256が一致しません。');
}

function directField(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    return invalidInput();
  }
  const field = Object.getOwnPropertyDescriptor(value, key);
  if (!field || !Object.hasOwn(field, 'value')) return invalidInput();
  return field.value as unknown;
}

function snapshotIdentity(value: unknown): ProjectFileIdentity {
  const dev = directField(value, 'dev');
  const ino = directField(value, 'ino');
  const birthtimeNs = directField(value, 'birthtimeNs');
  if (typeof dev !== 'string' || typeof ino !== 'string' || typeof birthtimeNs !== 'string') {
    return invalidInput();
  }
  return Object.freeze({ dev, ino, birthtimeNs });
}

function snapshotReceipt(value: ProjectDirectoryReceipt): ProjectDirectoryReceipt {
  const rootPath = directField(value, 'rootPath');
  const projectId = directField(value, 'projectId');
  if (typeof rootPath !== 'string' || typeof projectId !== 'string') return invalidInput();
  return Object.freeze({
    rootPath,
    projectId,
    rootIdentity: snapshotIdentity(directField(value, 'rootIdentity')),
    markerIdentity: snapshotIdentity(directField(value, 'markerIdentity')),
  });
}

function scalar(value: string): boolean {
  return value.isWellFormed() && !value.includes('\0');
}

function snapshotSource(value: CopySourceImage): SourceSnapshot {
  const imageKey = directField(value, 'key');
  const sourcePath = directField(value, 'sourcePath');
  const byteSize = directField(value, 'byteSize');
  const mtimeNs = directField(value, 'mtimeNs');
  const sha256 = directField(value, 'sha256');
  if (typeof imageKey !== 'string' || imageKey.length === 0 || imageKey.length > 4096 || !scalar(imageKey)
    || typeof sourcePath !== 'string'
    || typeof byteSize !== 'number' || !Number.isSafeInteger(byteSize) || byteSize <= 0 || byteSize > MAX_IMAGE_BYTES
    || typeof mtimeNs !== 'string' || !/^(?:0|-?[1-9][0-9]*)(?![\s\S])/u.test(mtimeNs)
    || typeof sha256 !== 'string' || !/^[a-f0-9]{64}(?![\s\S])/u.test(sha256)) {
    return invalidInput();
  }
  return Object.freeze({ imageKey, sourcePath: localFilePath(sourcePath), byteSize,
    mtimeNs: BigInt(mtimeNs), sha256 });
}

function safeName(name: string): boolean {
  return name.length > 0 && name.length <= 255 && name !== '.' && name !== '..' && scalar(name)
    && !/[\u0000-\u001f\u007f<>:"/\\|?*]/u.test(name) && !/[ .]$/u.test(name)
    && !/^(?:con|conin\$|conout\$|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/iu.test(name);
}

function localFilePath(input: string): string {
  if (process.platform !== 'win32' || input.length > 32_767 || !scalar(input)
    || !/^[a-z]:[\\/]/iu.test(input)) return invalidInput();
  const path = input.replaceAll('/', '\\');
  if (path.endsWith('\\')) return invalidInput();
  const parts = path.slice(3).split('\\');
  if (parts.length === 0 || parts.some((part) => !safeName(part))) return invalidInput();
  return win32.normalize(path);
}

function relativeFilePath(input: string): { readonly path: string; readonly parts: readonly string[] } {
  if (typeof input !== 'string' || input.length === 0 || input.length > 32_767 || !scalar(input)
    || input.includes('\\') || input.startsWith('/') || input.endsWith('/')) return invalidInput();
  const parts = input.split('/');
  if (parts.some((part) => !safeName(part))) return invalidInput();
  const basename = parts.at(-1)!;
  if ((parts.length === 1 && basename.toUpperCase() === markerName.toUpperCase())
    || (basename.toLowerCase().startsWith(temporaryPrefix) && basename.toLowerCase().endsWith('.tmp'))) {
    return invalidInput();
  }
  return Object.freeze({ path: parts.join('/'), parts: Object.freeze(parts) });
}

function identity(stat: BigIntStats): ProjectFileIdentity {
  if (stat.ino === 0n) unsafeDestination();
  return Object.freeze({ dev: String(stat.dev), ino: String(stat.ino), birthtimeNs: String(stat.birthtimeNs) });
}

function stamp(stat: BigIntStats, links?: bigint): FileStamp {
  if (!stat.isFile() || stat.isSymbolicLink() || stat.ino === 0n || stat.size < 0n
    || (links !== undefined && stat.nlink !== links)) unsafeSource();
  return Object.freeze({ identity: identity(stat), size: stat.size, mtimeNs: stat.mtimeNs,
    ctimeNs: stat.ctimeNs, nlink: stat.nlink });
}

function directoryIdentity(stat: BigIntStats): ProjectFileIdentity {
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.ino === 0n) unsafeDestination();
  return identity(stat);
}

function sameIdentity(left: ProjectFileIdentity, right: ProjectFileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.birthtimeNs === right.birthtimeNs;
}

function sameContent(left: FileStamp, right: FileStamp): boolean {
  return sameIdentity(left.identity, right.identity) && left.size === right.size
    && left.mtimeNs === right.mtimeNs && left.nlink === right.nlink;
}

function sameStamp(left: FileStamp, right: FileStamp): boolean {
  return sameContent(left, right) && left.ctimeNs === right.ctimeNs;
}

function enoent(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function folded(value: string): string {
  return value.toUpperCase();
}

function assertProject(receipt: ProjectDirectoryReceipt): ProjectDirectoryReceipt {
  const current = verifyProjectDirectory(receipt.rootPath, receipt.projectId);
  if (current.rootPath !== receipt.rootPath || current.projectId !== receipt.projectId
    || !sameIdentity(current.rootIdentity, receipt.rootIdentity)
    || !sameIdentity(current.markerIdentity, receipt.markerIdentity)) projectChanged();
  return current;
}

async function captureSourceParents(path: string): Promise<readonly DirectoryGuard[]> {
  let cursor = win32.parse(path).root;
  const result: DirectoryGuard[] = [];
  const parents = path.slice(cursor.length).split('\\').slice(0, -1);
  for (const part of ['', ...parents]) {
    if (part) cursor = win32.join(cursor, part);
    const stat = await fs.lstat(cursor, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.ino === 0n) unsafeSource();
    result.push(Object.freeze({ path: cursor, identity: identity(stat) }));
  }
  return Object.freeze(result);
}

async function checkDirectories(guards: readonly DirectoryGuard[], source: boolean): Promise<void> {
  for (const guard of guards) {
    const stat = await fs.lstat(guard.path, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.ino === 0n
      || !sameIdentity(guard.identity, identity(stat))) {
      if (source) sourceChanged(); else projectChanged();
    }
  }
}

function checkDirectoriesNow(guards: readonly DirectoryGuard[], source: boolean): void {
  for (const guard of guards) {
    if (!source && !exactChildNow(win32.dirname(guard.path), win32.basename(guard.path))) projectChanged();
    const stat = native.lstatSync(guard.path, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.ino === 0n
      || !sameIdentity(guard.identity, identity(stat))) {
      if (source) sourceChanged(); else projectChanged();
    }
  }
}

async function exactChild(parent: string, name: string): Promise<boolean> {
  const aliases = (await fs.readdir(parent)).filter((entry) => folded(entry) === folded(name));
  if (aliases.length > 1 || (aliases.length === 1 && aliases[0] !== name)) unsafeDestination();
  return aliases.length === 1;
}

function exactChildNow(parent: string, name: string): boolean {
  const aliases = native.readdirSync(parent).filter((entry) => folded(entry) === folded(name));
  if (aliases.length > 1 || (aliases.length === 1 && aliases[0] !== name)) unsafeDestination();
  return aliases.length === 1;
}

function captureDestinationParents(root: string, parts: readonly string[], rootIdentity: ProjectFileIdentity): readonly DirectoryGuard[] {
  let cursor = root;
  const rootStat = native.lstatSync(cursor, { bigint: true });
  const actualRoot = directoryIdentity(rootStat);
  if (!sameIdentity(actualRoot, rootIdentity)) projectChanged();
  const guards: DirectoryGuard[] = [Object.freeze({ path: cursor, identity: actualRoot })];
  for (const name of parts.slice(0, -1)) {
    if (!exactChildNow(cursor, name)) unsafeDestination();
    cursor = win32.join(cursor, name);
    guards.push(Object.freeze({ path: cursor, identity: directoryIdentity(native.lstatSync(cursor, { bigint: true })) }));
  }
  return Object.freeze(guards);
}

async function assertMissing(parent: string, name: string): Promise<void> {
  if (await exactChild(parent, name)) destinationExists();
  try {
    await fs.lstat(win32.join(parent, name), { bigint: true });
  } catch (error) {
    if (enoent(error)) return;
    throw error;
  }
  destinationExists();
}

function assertMissingNow(parent: string, name: string): void {
  if (exactChildNow(parent, name)) destinationExists();
  try {
    native.lstatSync(win32.join(parent, name), { bigint: true });
  } catch (error) {
    if (enoent(error)) return;
    throw error;
  }
  destinationExists();
}

function assertExactFileNow(path: string, parent: string, name: string, expected: FileStamp, links: bigint): FileStamp {
  if (!exactChildNow(parent, name)) sourceChanged();
  const current = stamp(native.lstatSync(path, { bigint: true }), links);
  if (!sameStamp(current, expected)) sourceChanged();
  return current;
}

function beginFileSyncGuard(path: string, expected: FileStamp, links: bigint,
  mismatch: () => never): FileStamp {
  const current = stamp(native.lstatSync(path, { bigint: true }), links);
  // Async lstat and sync lstat may expose different ctime values for the same
  // Windows file. Bind identity/content across APIs, then compare this exact
  // sync-API ctime after every remaining await.
  if (!sameContent(current, expected)) mismatch();
  return current;
}

function checkFileSyncGuard(path: string, expected: FileStamp, links: bigint,
  mismatch: () => never, expectedHash: string, guards: readonly DirectoryGuard[],
  source: boolean, project: ProjectDirectoryReceipt): FileStamp {
  const checkChain = (): void => {
    checkDirectoriesNow(guards, source);
    assertProject(project);
  };
  checkChain();
  const current = stamp(native.lstatSync(path, { bigint: true }), links);
  if (!sameContent(current, expected)) mismatch();
  if (sameStamp(current, expected)) return current;

  // A ctime-only change is not proof of unchanged bytes. Rehash against the
  // ORIGINAL scan, keeping path and handle ctime baselines independent.
  checkChain();
  const fd = native.openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const handleBefore = stamp(native.fstatSync(fd, { bigint: true }), links);
    const pathBefore = stamp(native.lstatSync(path, { bigint: true }), links);
    if (!sameContent(current, handleBefore) || !sameStamp(current, pathBefore)) mismatch();
    const hash = crypto.createHash('sha256');
    const buffer = Buffer.allocUnsafe(chunkBytes);
    const expectedSize = Number(expected.size);
    let position = 0;
    for (;;) {
      const length = Math.min(buffer.length, expectedSize - position + 1);
      const bytesRead = native.readSync(fd, buffer, 0, length, position);
      if (!Number.isSafeInteger(bytesRead) || bytesRead < 0 || bytesRead > length) mismatch();
      if (bytesRead === 0) break;
      position += bytesRead;
      if (position > expectedSize) mismatch();
      hash.update(buffer.subarray(0, bytesRead));
    }
    if (position !== expectedSize || hash.digest('hex') !== expectedHash) mismatch();
    const handleAfter = stamp(native.fstatSync(fd, { bigint: true }), links);
    const pathAfter = stamp(native.lstatSync(path, { bigint: true }), links);
    if (!sameStamp(handleBefore, handleAfter) || !sameStamp(pathBefore, pathAfter)) mismatch();
    checkChain();
  } finally {
    try { native.closeSync(fd); }
    catch (error) {
      // A failed close may already have released fd. No await/reuse window:
      // retry once only if fstat proves this descriptor still owns this file.
      try {
        const stillOpen = native.fstatSync(fd, { bigint: true });
        if (sameIdentity(identity(stillOpen), current.identity)) native.closeSync(fd);
      } catch { /* preserve the original close failure */ }
      throw error;
    }
  }
  checkChain();
  const closed = stamp(native.lstatSync(path, { bigint: true }), links);
  if (!sameStamp(current, closed)) mismatch();
  checkChain();
  return closed;
}

async function hashOpenedFile(handle: FileHandle, expectedSize: number): Promise<{ readonly hash: string; readonly stamp: FileStamp }> {
  const before = stamp(await handle.stat({ bigint: true }), 1n);
  if (before.size !== BigInt(expectedSize)) integrityFailed();
  const hash = crypto.createHash('sha256');
  const buffer = Buffer.allocUnsafe(chunkBytes);
  let position = 0;
  for (;;) {
    const length = Math.min(buffer.length, expectedSize - position + 1);
    const { bytesRead } = await handle.read(buffer, 0, length, position);
    if (!Number.isSafeInteger(bytesRead) || bytesRead < 0 || bytesRead > length) integrityFailed();
    if (bytesRead === 0) break;
    position += bytesRead;
    if (position > expectedSize) integrityFailed();
    hash.update(buffer.subarray(0, bytesRead));
  }
  const after = stamp(await handle.stat({ bigint: true }), 1n);
  if (position !== expectedSize || !sameStamp(before, after)) integrityFailed();
  return Object.freeze({ hash: hash.digest('hex'), stamp: before });
}

function combined(primary: unknown, additional: readonly unknown[], message: string): unknown {
  if (additional.length === 0) return primary;
  return new AggregateError([primary, ...additional], message, { cause: primary });
}

function ownedPair(tempPath: string, finalPath: string, expected: FileStamp): boolean {
  try {
    const temp = stamp(native.lstatSync(tempPath, { bigint: true }), 2n);
    const final = stamp(native.lstatSync(finalPath, { bigint: true }), 2n);
    return sameIdentity(temp.identity, expected.identity) && sameIdentity(final.identity, expected.identity)
      && temp.size === expected.size && final.size === expected.size
      && temp.mtimeNs === expected.mtimeNs && final.mtimeNs === expected.mtimeNs;
  } catch {
    return false;
  }
}

function publishNoClobber(project: ProjectDirectoryReceipt, destinationGuards: readonly DirectoryGuard[],
  tempPath: string, tempName: string, finalPath: string, finalName: string, expected: FileStamp,
  state: PublicationState): FileStamp {
  const parent = destinationGuards.at(-1)!.path;
  assertProject(project);
  checkDirectoriesNow(destinationGuards, false);
  assertMissingNow(parent, finalName);
  assertExactFileNow(tempPath, parent, tempName, expected, 1n);
  let linkError: unknown;
  try {
    native.linkSync(tempPath, finalPath);
  } catch (error) {
    linkError = error;
  }
  // Also recognizes an acknowledgement-loss injection where linkSync linked and
  // then threw. Only an exact two-name pair grants rollback authority.
  state.finalOwned = ownedPair(tempPath, finalPath, expected);
  if (linkError !== undefined) throw linkError;
  if (!state.finalOwned) sourceChanged();
  assertProject(project);
  checkDirectoriesNow(destinationGuards, false);
  if (!exactChildNow(parent, tempName) || !exactChildNow(parent, finalName)) sourceChanged();
  native.unlinkSync(tempPath);
  state.tempRemoved = true;
  const installed = stamp(native.lstatSync(finalPath, { bigint: true }), 1n);
  if (!sameIdentity(installed.identity, expected.identity) || installed.size !== expected.size
    || installed.mtimeNs !== expected.mtimeNs) sourceChanged();
  assertProject(project);
  checkDirectoriesNow(destinationGuards, false);
  if (!exactChildNow(parent, finalName)) sourceChanged();
  state.committed = true;
  return installed;
}

function cleanupOwnedFiles(destinationGuards: readonly DirectoryGuard[], tempPath: string, finalPath: string, expectedIdentity: ProjectFileIdentity | undefined,
  state: PublicationState): unknown[] {
  if (!expectedIdentity || state.committed) return [];
  // A matching file behind a replaced parent is no longer our owned path.
  try { checkDirectoriesNow(destinationGuards, false); }
  catch (error) { return [error]; }
  const errors: unknown[] = [];
  if (state.finalOwned) {
    try {
      const final = stamp(native.lstatSync(finalPath, { bigint: true }));
      if (!sameIdentity(final.identity, expectedIdentity) || (final.nlink !== 1n && final.nlink !== 2n)) sourceChanged();
      if (final.nlink === 2n) {
        const temp = stamp(native.lstatSync(tempPath, { bigint: true }), 2n);
        if (!sameIdentity(temp.identity, expectedIdentity)) sourceChanged();
      }
      native.unlinkSync(finalPath);
      state.finalOwned = false;
    } catch (error) { errors.push(error); }
  }
  if (!state.tempRemoved) {
    try {
      const temp = stamp(native.lstatSync(tempPath, { bigint: true }), 1n);
      if (!sameIdentity(temp.identity, expectedIdentity)) sourceChanged();
      native.unlinkSync(tempPath);
      state.tempRemoved = true;
    } catch (error) {
      if (enoent(error)) state.tempRemoved = true;
      else errors.push(error);
    }
  }
  return errors;
}

/**
 * DAT-06 / FR-DAT-011 / NFR-REL-003: copy one already-scanned local image into
 * an existing Project directory. The caller supplies a canonical '/' relative
 * destination, holds the Project write lock, and performs DAT-07 persistence.
 * Parent directories must already exist; this primitive never creates/adopts
 * directories, edits the source, overwrites a final path, updates SQLite, or
 * retries an I/O failure.
 *
 * Bytes are streamed into an exclusive same-directory temporary file, hashed
 * against the scan snapshot, fsynced, independently re-read/hashed, and closed.
 * After the final asynchronous checks, a synchronous hard-link publication plus
 * removal of the temporary name provides an atomic no-clobber commit on Windows.
 * This closes in-process await gaps; it is not an ACL or hostile-OS-user lock.
 */
export async function copySourceFile(projectInput: ProjectDirectoryReceipt, imageInput: CopySourceImage,
  destinationRelativePath: string): Promise<CopiedSourceFile> {
  // Clone every caller-controlled field before the first await or filesystem I/O.
  const suppliedProject = snapshotReceipt(projectInput);
  const source = snapshotSource(imageInput);
  const relative = relativeFilePath(destinationRelativePath);
  const project = assertProject(suppliedProject);
  // Pin the caller's just-created leaf and every Project parent before yielding.
  // Later asynchronous checks verify these identities; they must never adopt new ones.
  const destinationGuards = captureDestinationParents(project.rootPath, relative.parts, project.rootIdentity);
  const finalName = relative.parts.at(-1)!;
  const sourceParents = await captureSourceParents(source.sourcePath);
  await checkDirectories(sourceParents, true);
  const before = stamp(await fs.lstat(source.sourcePath, { bigint: true }), 1n);
  if (before.size !== BigInt(source.byteSize) || before.mtimeNs !== source.mtimeNs) sourceChanged();
  await checkDirectories(destinationGuards, false);
  const parent = destinationGuards.at(-1)!.path;
  const finalPath = win32.join(parent, finalName);
  await assertMissing(parent, finalName);
  assertProject(project);

  const tempName = `${temporaryPrefix}${crypto.randomUUID()}.tmp`;
  const tempPath = win32.join(parent, tempName);
  if (folded(tempPath) === folded(finalPath)) return invalidInput();
  await assertMissing(parent, tempName);

  let reader: FileHandle | undefined;
  let writer: FileHandle | undefined;
  let verifier: FileHandle | undefined;
  let tempIdentity: ProjectFileIdentity | undefined;
  let sourcePathStamp: FileStamp | undefined;
  let sourceHandleStamp: FileStamp | undefined;
  let verifiedTemp: FileStamp | undefined;
  const state: PublicationState = { finalOwned: false, tempRemoved: false, committed: false };

  const closeHandle = async (kind: 'reader' | 'writer' | 'verifier'): Promise<unknown | undefined> => {
    const handle = kind === 'reader' ? reader : kind === 'writer' ? writer : verifier;
    if (!handle) return undefined;
    try {
      await handle.close();
      if (kind === 'reader') reader = undefined;
      else if (kind === 'writer') writer = undefined;
      else verifier = undefined;
      return undefined;
    } catch (error) {
      // A close implementation may report failure after releasing the native
      // descriptor. Drop only a definitely closed handle; otherwise retain it
      // so the outer failure path can make one explicit second close attempt.
      if (handle.fd === -1) {
        if (kind === 'reader') reader = undefined;
        else if (kind === 'writer') writer = undefined;
        else verifier = undefined;
      }
      return error;
    }
  };
  const closeHandles = async (): Promise<unknown[]> => {
    const errors: unknown[] = [];
    for (const kind of ['verifier', 'writer', 'reader'] as const) {
      const error = await closeHandle(kind);
      if (error !== undefined) errors.push(error);
    }
    return errors;
  };

  try {
    reader = await fs.open(source.sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const opened = stamp(await reader.stat({ bigint: true }), 1n);
    if (!sameContent(before, opened)) sourceChanged();
    const openedPath = stamp(await fs.lstat(source.sourcePath, { bigint: true }), 1n);
    if (!sameContent(opened, openedPath)) sourceChanged();
    sourceHandleStamp = opened;
    sourcePathStamp = openedPath;
    // Keep the source baseline from BEFORE streaming, not from after the
    // original hash was accepted: writer sync/close can yield to a source edit.
    let sourceSyncGuard = beginFileSyncGuard(source.sourcePath, openedPath, 1n, sourceChanged);
    const checkSource = (): void => {
      sourceSyncGuard = checkFileSyncGuard(source.sourcePath, sourceSyncGuard, 1n, sourceChanged,
        source.sha256, sourceParents, true, project);
    };
    await checkDirectories(sourceParents, true);

    await checkDirectories(destinationGuards, false);
    await assertMissing(parent, finalName);
    // No await between these synchronous guards and exclusive open invocation.
    assertProject(project);
    checkDirectoriesNow(sourceParents, true);
    checkDirectoriesNow(destinationGuards, false);
    assertMissingNow(parent, finalName);
    assertMissingNow(parent, tempName);
    writer = await fs.open(tempPath, 'wx+', 0o600);
    tempIdentity = stamp(native.fstatSync(writer.fd, { bigint: true }), 1n).identity;
    const checkWriterNow = (): void => {
      assertProject(project);
      checkDirectoriesNow(destinationGuards, false);
      if (!exactChildNow(parent, tempName)) sourceChanged();
      const handleNow = stamp(native.fstatSync(writer!.fd, { bigint: true }), 1n);
      const pathNow = stamp(native.lstatSync(tempPath, { bigint: true }), 1n);
      if (!sameIdentity(handleNow.identity, tempIdentity!) || !sameContent(handleNow, pathNow)) integrityFailed();
    };
    // open itself yielded: prove the returned descriptor still owns this path
    // before any further await, and again after reads/short writes before payload.
    checkWriterNow();
    const created = stamp(await writer.stat({ bigint: true }), 1n);
    if (created.size !== 0n || !sameIdentity(created.identity, tempIdentity)) integrityFailed();

    const sourceHash = crypto.createHash('sha256');
    const buffer = Buffer.allocUnsafe(chunkBytes);
    let readPosition = 0;
    let writePosition = 0;
    for (;;) {
      const length = Math.min(buffer.length, source.byteSize - readPosition + 1);
      const { bytesRead } = await reader.read(buffer, 0, length, readPosition);
      if (!Number.isSafeInteger(bytesRead) || bytesRead < 0 || bytesRead > length) sourceChanged();
      if (bytesRead === 0) break;
      readPosition += bytesRead;
      if (readPosition > source.byteSize) sourceChanged();
      sourceHash.update(buffer.subarray(0, bytesRead));
      let offset = 0;
      while (offset < bytesRead) {
        checkWriterNow();
        const { bytesWritten } = await writer.write(buffer, offset, bytesRead - offset, writePosition);
        if (!Number.isSafeInteger(bytesWritten) || bytesWritten <= 0 || bytesWritten > bytesRead - offset) integrityFailed();
        offset += bytesWritten;
        writePosition += bytesWritten;
      }
    }
    if (readPosition !== source.byteSize || writePosition !== source.byteSize
      || sourceHash.digest('hex') !== source.sha256) sourceChanged();
    await writer.sync();
    const writtenHandle = stamp(await writer.stat({ bigint: true }), 1n);
    const writtenPath = stamp(await fs.lstat(tempPath, { bigint: true }), 1n);
    if (writtenHandle.size !== BigInt(source.byteSize) || !sameContent(writtenHandle, writtenPath)) integrityFailed();
    const writerCloseError = await closeHandle('writer');
    if (writerCloseError !== undefined) throw writerCloseError;
    const writerClosedPath = stamp(await fs.lstat(tempPath, { bigint: true }), 1n);
    if (!sameStamp(writtenPath, writerClosedPath)) integrityFailed();

    // Reopen through a distinct read-only descriptor. This verifies bytes that
    // reached the path after writer close, rather than trusting the write handle.
    verifier = await fs.open(tempPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const verifierOpened = stamp(await verifier.stat({ bigint: true }), 1n);
    const verifierPath = stamp(await fs.lstat(tempPath, { bigint: true }), 1n);
    if (!sameContent(writerClosedPath, verifierOpened) || !sameContent(verifierOpened, verifierPath)) integrityFailed();
    assertProject(project);
    checkDirectoriesNow(destinationGuards, false);
    checkDirectoriesNow(sourceParents, true);
    let tempSyncGuard = beginFileSyncGuard(tempPath, verifierPath, 1n, integrityFailed);
    const checkTemp = (): void => {
      tempSyncGuard = checkFileSyncGuard(tempPath, tempSyncGuard, 1n, integrityFailed,
        source.sha256, destinationGuards, false, project);
    };
    const verified = await hashOpenedFile(verifier, source.byteSize);
    if (verified.hash !== source.sha256 || !sameContent(verifierOpened, verified.stamp)) integrityFailed();
    // Only a complete synchronous rehash may advance a per-copy sync baseline.
    checkTemp();
    checkSource();
    const verifierPathAfter = stamp(await fs.lstat(tempPath, { bigint: true }), 1n);
    checkTemp();
    if (verified.hash !== source.sha256 || !sameContent(verifierOpened, verified.stamp)
      || !sameContent(verifierPath, verifierPathAfter)) integrityFailed();
    const verifierCloseError = await closeHandle('verifier');
    if (verifierCloseError !== undefined) throw verifierCloseError;
    const verifierClosedPath = stamp(await fs.lstat(tempPath, { bigint: true }), 1n);
    if (!sameContent(verifierPathAfter, verifierClosedPath)) integrityFailed();
    checkTemp();
    verifiedTemp = verifierClosedPath;

    const sourceAfter = stamp(await reader.stat({ bigint: true }), 1n);
    const pathAfter = stamp(await fs.lstat(source.sourcePath, { bigint: true }), 1n);
    // Source bytes have already matched the scan hash. Same-API sync guards
    // below rehash ctime changes rather than trusting an async stale snapshot.
    if (!sameContent(sourceHandleStamp, sourceAfter) || !sameContent(sourcePathStamp, pathAfter)) sourceChanged();
    checkSource();
    await checkDirectories(sourceParents, true);
    await checkDirectories(destinationGuards, false);
    await assertMissing(parent, finalName);

    const closeErrors = await closeHandles();
    if (closeErrors.length === 1) throw closeErrors[0];
    if (closeErrors.length > 1) throw new AggregateError(closeErrors, 'コピー元と一時コピーのcloseに失敗しました。');

    await checkDirectories(sourceParents, true);
    const sourceClosed = stamp(await fs.lstat(source.sourcePath, { bigint: true }), 1n);
    if (!sameContent(sourcePathStamp, sourceClosed)) sourceChanged();
    checkSource();
    await checkDirectories(destinationGuards, false);
    if (!await exactChild(parent, tempName)) sourceChanged();
    const tempClosed = stamp(await fs.lstat(tempPath, { bigint: true }), 1n);
    if (!sameContent(verifiedTemp, tempClosed)) integrityFailed();
    checkTemp();
    await assertMissing(parent, finalName);

    // Last-await boundary: all following guards and publication are synchronous.
    assertProject(project);
    checkDirectoriesNow(sourceParents, true);
    checkSource();
    checkDirectoriesNow(destinationGuards, false);
    assertMissingNow(parent, finalName);
    checkTemp();
    const tempNow = assertExactFileNow(tempPath, parent, tempName, tempSyncGuard, 1n);
    const installed = publishNoClobber(project, destinationGuards, tempPath, tempName,
      finalPath, finalName, tempNow, state);
    return Object.freeze({ imageKey: source.imageKey, relativePath: relative.path,
      byteSize: source.byteSize, sha256: source.sha256, fileIdentity: installed.identity });
  } catch (error) {
    const closeErrors = await closeHandles();
    const cleanupErrors = cleanupOwnedFiles(destinationGuards, tempPath, finalPath, tempIdentity, state);
    throw combined(combined(error, closeErrors, 'コピー失敗後のhandle closeにも失敗しました。'), cleanupErrors,
      'コピー失敗後にProject内の一時成果物を安全に回収できませんでした。');
  }
}
