import { createHash } from 'node:crypto';
import childProcess from 'node:child_process';
import native, { constants, type BigIntStats } from 'node:fs';
import fs, { type FileHandle } from 'node:fs/promises';
import { win32 } from 'node:path';

import { MAX_IMAGE_BYTES, type ScanImage } from '../../shared/contracts/import.js';
import {
  importSourceManifestSchema,
  type ReferenceFileIdentity,
  type ReferenceImportSource,
} from './import-source-manifest.js';

const chunkBytes = 64 * 1024;
const volumeProbeBytes = 4 * 1024;
const volumeGuidPattern = /^\\\\\?\\Volume\{[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}\\(?![\s\S])/iu;
const signedDecimalPattern = /^(?:0|-?[1-9][0-9]*)(?![\s\S])/u;
const sha256Pattern = /^[a-f0-9]{64}(?![\s\S])/u;

/** The scan fields whose bytes and metadata are revalidated before persistence. */
export type ReferenceSourceImage = Readonly<Pick<
  ScanImage,
  'key' | 'sourcePath' | 'byteSize' | 'mtimeNs' | 'sha256'
>>;

export type ReferenceRelinkReason =
  | 'missing'
  | 'inaccessible'
  | 'unsafe'
  | 'read-failed'
  | 'changed'
  | 'identity-changed'
  | 'size-changed'
  | 'mtime-changed'
  | 'hash-changed';

export type ReferenceVerification =
  | Readonly<{ status: 'verified'; source: ReferenceImportSource }>
  | Readonly<{ status: 'relink-required'; imageKey: string; sourcePath: string; reason: ReferenceRelinkReason }>;

interface FileStamp {
  readonly identity: ReferenceFileIdentity;
  readonly size: bigint;
  readonly mtimeNs: bigint;
  readonly ctimeNs: bigint;
  readonly nlink: bigint;
}

interface DirectoryGuard {
  readonly path: string;
  readonly identity: ReferenceFileIdentity;
}

interface VolumeGuard {
  readonly driveRoot: string;
  readonly volumeGuid: string;
  readonly executable: string;
}

interface CapturedSource {
  readonly entry: ReferenceImportSource;
  readonly path: string;
  readonly name: string;
  readonly parent: string;
  readonly volume: VolumeGuard;
  readonly directories: readonly DirectoryGuard[];
  readonly syncStamp: FileStamp;
}

// Only this module's successful read-only captures can issue a proof. Schema
// clones and persisted JSON deliberately carry no process-local authority.
const capturedSources = new WeakMap<ReferenceImportSource, CapturedSource>();
const verifiedStamps = new WeakMap<CapturedSource, FileStamp>();

class ReferenceAccessFailure extends Error {
  constructor(readonly reason: Extract<ReferenceRelinkReason, 'missing' | 'inaccessible' | 'unsafe' | 'read-failed' | 'changed'>) {
    super('Reference source could not be safely read.');
    this.name = 'ReferenceAccessFailure';
  }
}

function invalid(): never {
  throw new TypeError('Reference sourceには検証済み画像または保存済みmanifestの安全な絶対パスが必要です。');
}

function access(reason: ReferenceAccessFailure['reason']): never {
  throw new ReferenceAccessFailure(reason);
}

function scalar(value: string): boolean {
  return value.isWellFormed() && !value.includes('\0');
}

function directField(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) invalid();
  const field = Object.getOwnPropertyDescriptor(value, key);
  if (!field || !Object.hasOwn(field, 'value')) invalid();
  return field.value as unknown;
}

function safeName(name: string): boolean {
  return name.length > 0 && name.length <= 255 && name !== '.' && name !== '..' && scalar(name)
    && !/[\u0000-\u001f\u007f<>:"/\\|?*]/u.test(name) && !/[ .]$/u.test(name)
    && !/^(?:con|conin\$|conout\$|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/iu.test(name);
}

function windowsFilePath(value: unknown): { readonly stored: string; readonly io: string } {
  if (process.platform !== 'win32' || typeof value !== 'string' || value.length > 32_767 || !scalar(value)
    || !/^[a-z]:[\\/]/iu.test(value) || value.endsWith('\\') || value.endsWith('/')) invalid();
  const path = value.replaceAll('/', '\\');
  const parts = path.slice(3).split('\\');
  if (parts.length === 0 || parts.some((part) => !safeName(part))) invalid();
  return Object.freeze({ stored: value, io: win32.normalize(path) });
}

function mountvolExecutable(): string {
  const value = process.env.SystemRoot;
  if (process.platform !== 'win32' || typeof value !== 'string' || value.length > 32_767 || !scalar(value)) access('unsafe');
  const path = value.replaceAll('/', '\\');
  const root = win32.parse(path).root;
  const parts = path.slice(root.length).split('\\');
  if (!/^[a-z]:\\$/iu.test(root) || parts.length === 0 || parts.some((part) => !safeName(part))) access('unsafe');
  return win32.join(path, 'System32', 'mountvol.exe');
}

/**
 * `C:\\...` is only a lexical shape: a Windows drive letter can be mapped to
 * SMB/WebDAV. Query the mount manager before touching the source path and
 * accept only a drive backed by a local volume GUID. The command is a fixed OS
 * executable with fixed argv, no shell, one attempt and strict finite bounds.
 */
async function captureLocalVolume(path: string): Promise<VolumeGuard> {
  const root = win32.parse(path).root;
  if (!/^[a-z]:\\$/iu.test(root)) access('unsafe');
  const executable = mountvolExecutable();
  return new Promise<VolumeGuard>((resolve, reject) => {
    let completed = false;
    const rejectUnsafe = (): void => {
      if (completed) return;
      completed = true;
      reject(new ReferenceAccessFailure('unsafe'));
    };
    try {
      childProcess.execFile(executable, [root, '/L'], {
        shell: false,
        windowsHide: true,
        encoding: 'utf8',
        timeout: 5_000,
        maxBuffer: volumeProbeBytes,
      }, (error, stdout, stderr) => {
        if (completed) return;
        const volumeGuid = localVolumeGuid(stdout);
        if (error !== null || typeof stdout !== 'string' || typeof stderr !== 'string'
          || stderr.length !== 0 || volumeGuid === undefined) {
          rejectUnsafe();
          return;
        }
        completed = true;
        resolve(Object.freeze({ driveRoot: root, volumeGuid, executable }));
      });
    } catch { rejectUnsafe(); }
  });
}

function localVolumeGuid(stdout: unknown): string | undefined {
  if (typeof stdout !== 'string' || Buffer.byteLength(stdout, 'utf8') > volumeProbeBytes) return undefined;
  const value = stdout.trim();
  return volumeGuidPattern.test(value) ? value : undefined;
}

function assertVolumeCurrent(volume: VolumeGuard): void {
  const result = childProcess.spawnSync(volume.executable, [volume.driveRoot, '/L'], {
    shell: false,
    windowsHide: true,
    encoding: 'utf8',
    timeout: 5_000,
    maxBuffer: volumeProbeBytes,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const current = localVolumeGuid(result.stdout);
  if (result.status !== 0 || result.error !== undefined || result.signal !== null
    || result.stderr !== '' || current === undefined) access('unsafe');
  if (current.toLowerCase() !== volume.volumeGuid.toLowerCase()) access('changed');
}

function imageKey(value: unknown): string {
  if (typeof value !== 'string' || !scalar(value)
    || !/[^\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]/u.test(value)) invalid();
  return value;
}

function snapshotImage(value: ReferenceSourceImage): {
  readonly key: string;
  readonly sourcePath: string;
  readonly byteSize: number;
  readonly mtimeNs: bigint;
  readonly sha256: string;
} {
  const key = imageKey(directField(value, 'key'));
  const sourcePath = windowsFilePath(directField(value, 'sourcePath')).stored;
  const byteSize = directField(value, 'byteSize');
  const mtimeNs = directField(value, 'mtimeNs');
  const sha256 = directField(value, 'sha256');
  if (typeof byteSize !== 'number' || !Number.isSafeInteger(byteSize) || byteSize <= 0 || byteSize > MAX_IMAGE_BYTES
    || typeof mtimeNs !== 'string' || !signedDecimalPattern.test(mtimeNs)
    || typeof sha256 !== 'string' || !sha256Pattern.test(sha256)) invalid();
  return Object.freeze({ key, sourcePath, byteSize, mtimeNs: BigInt(mtimeNs), sha256 });
}

function snapshotReference(value: ReferenceImportSource): ReferenceImportSource {
  try {
    const entry = (importSourceManifestSchema.parse({
      formatVersion: 1,
      mode: 'reference',
      entries: [value],
    }) as Extract<ReturnType<typeof importSourceManifestSchema.parse>, { mode: 'reference' }>).entries[0]!;
    Object.freeze(entry.identity);
    return Object.freeze(entry);
  } catch { return invalid(); }
}

function identity(stat: BigIntStats): ReferenceFileIdentity {
  if (stat.dev < 0n || stat.ino <= 0n) access('unsafe');
  return Object.freeze({ dev: String(stat.dev), ino: String(stat.ino), birthtimeNs: String(stat.birthtimeNs) });
}

function fileStamp(stat: BigIntStats): FileStamp {
  if (!stat.isFile() || stat.isSymbolicLink() || stat.dev < 0n || stat.ino <= 0n
    || stat.nlink !== 1n || stat.size <= 0n || stat.size > BigInt(MAX_IMAGE_BYTES)) access('unsafe');
  return Object.freeze({ identity: identity(stat), size: stat.size, mtimeNs: stat.mtimeNs,
    ctimeNs: stat.ctimeNs, nlink: stat.nlink });
}

function directoryIdentity(stat: BigIntStats): ReferenceFileIdentity {
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.dev < 0n || stat.ino <= 0n) access('unsafe');
  return identity(stat);
}

function sameIdentity(left: ReferenceFileIdentity, right: ReferenceFileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.birthtimeNs === right.birthtimeNs;
}

function sameContent(left: FileStamp, right: FileStamp): boolean {
  return sameIdentity(left.identity, right.identity) && left.size === right.size
    && left.mtimeNs === right.mtimeNs && left.nlink === right.nlink;
}

function sameStamp(left: FileStamp, right: FileStamp): boolean {
  return sameContent(left, right) && left.ctimeNs === right.ctimeNs;
}

function errno(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

function mapFailure(error: unknown): never {
  if (error instanceof ReferenceAccessFailure) throw error;
  if (errno(error, 'ENOENT') || errno(error, 'ENOTDIR')) access('missing');
  if (errno(error, 'EACCES') || errno(error, 'EPERM')) access('inaccessible');
  if (errno(error, 'ELOOP')) access('unsafe');
  access('read-failed');
}

function exactChild(entries: readonly string[], name: string): boolean {
  const aliases = entries.filter((entry) => entry.toUpperCase() === name.toUpperCase());
  if (aliases.length > 1 || (aliases.length === 1 && aliases[0] !== name)) access('unsafe');
  return aliases.length === 1;
}

async function captureDirectories(path: string, signal?: AbortSignal): Promise<readonly DirectoryGuard[]> {
  const root = win32.parse(path).root;
  const parts = path.slice(root.length).split('\\');
  if (!volumeGuidPattern.test(root) || parts.length < 1) invalid();
  let cursor = root;
  const result: DirectoryGuard[] = [];
  // Windows/libuv cannot stat the bare volume-GUID root (EISDIR). Its
  // identity is the OS-issued GUID, not a caller-controlled directory alias.
  // Enumerate that fixed root and pin every ordinary ancestor below it; do
  // not fall back to the mutable drive letter just to obtain a root inode.
  for (const part of parts.slice(0, -1)) {
    signal?.throwIfAborted();
    if (!exactChild(await fs.readdir(cursor), part)) access('changed');
    cursor = win32.join(cursor, part);
    signal?.throwIfAborted();
    result.push(Object.freeze({ path: cursor, identity: directoryIdentity(await fs.lstat(cursor, { bigint: true })) }));
  }
  return Object.freeze(result);
}

async function checkDirectories(guards: readonly DirectoryGuard[], signal?: AbortSignal): Promise<void> {
  for (const guard of guards) {
    signal?.throwIfAborted();
    const stat = await fs.lstat(guard.path, { bigint: true });
    if (!sameIdentity(guard.identity, directoryIdentity(stat))) access('changed');
  }
}

function checkDirectoriesNow(guards: readonly DirectoryGuard[]): void {
  for (const guard of guards) {
    const stat = native.lstatSync(guard.path, { bigint: true });
    if (!sameIdentity(guard.identity, directoryIdentity(stat))) access('changed');
  }
}

async function exactSource(path: string): Promise<void> {
  const parent = win32.dirname(path);
  if (!exactChild(await fs.readdir(parent), win32.basename(path))) access('missing');
}

function exactSourceNow(path: string): void {
  if (!exactChild(native.readdirSync(win32.dirname(path)), win32.basename(path))) access('missing');
}

async function closeWithRecovery(handle: FileHandle): Promise<unknown | undefined> {
  try {
    await handle.close();
    return undefined;
  } catch (first) {
    if (handle.fd !== -1) {
      try { await handle.close(); }
      catch (second) { return new AggregateError([first, second], 'Reference source descriptor close failed.'); }
    }
    return first;
  }
}

async function capture(pathInput: unknown, keyInput: unknown, signal?: AbortSignal): Promise<CapturedSource> {
  const validatedPath = windowsFilePath(pathInput);
  const key = imageKey(keyInput);
  try {
    signal?.throwIfAborted();
    const volume = await captureLocalVolume(validatedPath.io);
    // Only a validated drive path supplies the suffix. Every source operation,
    // including the root/ancestor chain, stays on this local volume across awaits.
    const path = volume.volumeGuid + validatedPath.io.slice(volume.driveRoot.length);
    signal?.throwIfAborted();
    const directories = await captureDirectories(path, signal);
    signal?.throwIfAborted();
    await checkDirectories(directories, signal);
    signal?.throwIfAborted();
    await exactSource(path);
    signal?.throwIfAborted();
    const before = fileStamp(await fs.lstat(path, { bigint: true }));
    let handle: FileHandle | undefined;
    let failure: unknown;
    let opened: FileStamp | undefined;
    let pathOpened: FileStamp | undefined;
    let syncBeforeClose: FileStamp | undefined;
    let digest = '';
    try {
      signal?.throwIfAborted();
      handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      signal?.throwIfAborted();
      opened = fileStamp(await handle.stat({ bigint: true }));
      signal?.throwIfAborted();
      pathOpened = fileStamp(await fs.lstat(path, { bigint: true }));
      if (!sameContent(before, opened) || !sameContent(opened, pathOpened)) access('changed');
      signal?.throwIfAborted();
      await checkDirectories(directories, signal);
      signal?.throwIfAborted();
      await exactSource(path);
      signal?.throwIfAborted();
      const hash = createHash('sha256');
      const buffer = Buffer.allocUnsafe(chunkBytes);
      let position = 0;
      for (;;) {
        const length = Math.min(buffer.length, MAX_IMAGE_BYTES - position + 1);
        signal?.throwIfAborted();
        const { bytesRead } = await handle.read(buffer, 0, length, position);
        signal?.throwIfAborted();
        if (!Number.isSafeInteger(bytesRead) || bytesRead < 0 || bytesRead > length) access('read-failed');
        if (bytesRead === 0) break;
        position += bytesRead;
        if (position > MAX_IMAGE_BYTES) access('unsafe');
        hash.update(buffer.subarray(0, bytesRead));
      }
      // Pin the synchronous API's own ctime BEFORE any final stat/close await:
      // an async stat may return an old snapshot after the file has changed.
      // Keep the separate opened handle/path stamps protecting the hashed read.
      syncBeforeClose = fileStamp(native.lstatSync(path, { bigint: true }));
      if (!sameContent(opened, syncBeforeClose)) access('changed');
      signal?.throwIfAborted();
      const after = fileStamp(await handle.stat({ bigint: true }));
      signal?.throwIfAborted();
      const pathAfter = fileStamp(await fs.lstat(path, { bigint: true }));
      if (BigInt(position) !== opened.size || !sameStamp(opened, after)
        || !sameStamp(pathOpened, pathAfter) || !sameContent(after, pathAfter)) access('changed');
      signal?.throwIfAborted();
      digest = hash.digest('hex');
    } catch (error) { failure = error; }
    if (handle) {
      const closeError = await closeWithRecovery(handle);
      if (closeError !== undefined) {
        failure = failure === undefined ? closeError
          : new AggregateError([failure, closeError], 'Reference source read and close both failed.');
      }
    }
    if (failure !== undefined) throw failure;
    if (!opened || !pathOpened || !syncBeforeClose) access('read-failed');
    signal?.throwIfAborted();
    const closed = fileStamp(await fs.lstat(path, { bigint: true }));
    // Cross-API ctime need not agree on Windows; never adopt a new baseline
    // across close. The original synchronous stamp must survive every await.
    if (!sameContent(pathOpened, closed)) access('changed');
    checkDirectoriesNow(directories);
    exactSourceNow(path);
    signal?.throwIfAborted();
    await checkDirectories(directories, signal);
    signal?.throwIfAborted();
    await exactSource(path);

    // Recheck that same synchronous baseline after the final await. Consumers
    // can keep this private guard through synchronous DB CAS and COMMIT.
    checkDirectoriesNow(directories);
    exactSourceNow(path);
    const syncStamp = fileStamp(native.lstatSync(path, { bigint: true }));
    if (!sameStamp(syncBeforeClose, syncStamp)) access('changed');
    signal?.throwIfAborted();
    const entry = snapshotReference({
      imageKey: key,
      sourcePath: validatedPath.stored,
      identity: syncStamp.identity,
      byteSize: Number(syncStamp.size),
      mtimeNs: String(syncStamp.mtimeNs),
      sha256: digest,
    });
    return Object.freeze({ entry, path, name: win32.basename(path), parent: win32.dirname(path),
      volume, directories, syncStamp });
  } catch (error) { return mapFailure(error); }
}

function assertCapturedMetadataNow(captured: CapturedSource): void {
  checkDirectoriesNow(captured.directories);
  exactSourceNow(captured.path);
  const expected = verifiedStamps.get(captured) ?? captured.syncStamp;
  const current = fileStamp(native.lstatSync(captured.path, { bigint: true }));
  if (!sameContent(current, expected)) access('changed');
  if (sameStamp(current, expected)) return;

  // Windows can settle ctime after another read handle was opened/closed.
  // Never rebase on metadata alone: re-hash the exact pinned local-volume file
  // against the ORIGINAL scan hash before accepting a ctime-only settlement.
  // This finite synchronous read keeps identity/size/mtime/nlink unchanged and
  // compares each API's ctime to itself. No retry or source write is performed.
  const fd = native.openSync(captured.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let pathOpened: FileStamp | undefined;
  try {
    const opened = fileStamp(native.fstatSync(fd, { bigint: true }));
    pathOpened = fileStamp(native.lstatSync(captured.path, { bigint: true }));
    if (!sameContent(expected, opened) || !sameContent(expected, pathOpened)) access('changed');
    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(chunkBytes);
    let position = 0;
    while (position < captured.entry.byteSize) {
      const length = Math.min(buffer.length, captured.entry.byteSize - position);
      const count = native.readSync(fd, buffer, 0, length, position);
      if (!Number.isSafeInteger(count) || count <= 0 || count > length) access('read-failed');
      hash.update(buffer.subarray(0, count));
      position += count;
    }
    if (native.readSync(fd, buffer, 0, 1, position) !== 0
      || hash.digest('hex') !== captured.entry.sha256
      || !sameStamp(opened, fileStamp(native.fstatSync(fd, { bigint: true })))
      || !sameStamp(pathOpened, fileStamp(native.lstatSync(captured.path, { bigint: true })))) access('changed');
  } finally {
    try { native.closeSync(fd); }
    catch (error) {
      // One finite release attempt only; retain the original failure and never
      // promote an uncertain close to successful verification.
      try { native.closeSync(fd); } catch { /* It may already have been closed. */ }
      throw error;
    }
  }
  checkDirectoriesNow(captured.directories);
  exactSourceNow(captured.path);
  const settled = fileStamp(native.lstatSync(captured.path, { bigint: true }));
  if (!pathOpened || !sameStamp(pathOpened, settled)) access('changed');
  verifiedStamps.set(captured, settled);
}

function assertCapturedNow(captured: CapturedSource): void {
  try {
    // One bounded local-manager query per issuance/current-authority guard,
    // never per ancestor or read chunk, and before any pinned source guard.
    assertVolumeCurrent(captured.volume);
    assertCapturedMetadataNow(captured);
  } catch (error) { return mapFailure(error); }
}

/** Pure membership check: no filesystem or database access. */
export function assertCapturedReferenceSource(source: ReferenceImportSource): void {
  if (!capturedSources.has(source)) throw new TypeError('A captured Reference source is required.');
}

/** Rechecks the original capture's file metadata and directory identities, without writes. */
export function assertCapturedReferenceSourceCurrent(source: ReferenceImportSource): void {
  assertCapturedReferenceSourcesCurrent([source]);
}

/** One bounded query per drive for this call, followed by every pinned file guard. */
export function assertCapturedReferenceSourcesCurrent(sources: readonly ReferenceImportSource[]): void {
  if (!Array.isArray(sources)) throw new TypeError('An array of captured Reference sources is required.');
  // Copy own entries before any guard calls. Do not trust caller iterators,
  // invoke accessors, or silently skip holes/inherited array entries.
  const snapshot: ReferenceImportSource[] = [];
  for (let index = 0, length = sources.length; index < length; index += 1) {
    const field = Object.getOwnPropertyDescriptor(sources, String(index));
    if (!field || !Object.hasOwn(field, 'value')) throw new TypeError('A captured Reference source is required.');
    snapshot.push(field.value as ReferenceImportSource);
  }
  const captures = snapshot.map((source) => {
    assertCapturedReferenceSource(source);
    return capturedSources.get(source)!;
  });
  try {
    const volumes = new Map<string, VolumeGuard>();
    for (const captured of captures) {
      const volume = captured.volume;
      const root = volume.driveRoot.toLowerCase();
      const previous = volumes.get(root);
      if (previous && (previous.volumeGuid.toLowerCase() !== volume.volumeGuid.toLowerCase()
        || previous.executable !== volume.executable)) access('changed');
      if (!previous) volumes.set(root, volume);
    }
    for (const volume of volumes.values()) assertVolumeCurrent(volume);
    for (const captured of captures) assertCapturedMetadataNow(captured);
  } catch (error) { return mapFailure(error); }
}

function mismatch(saved: ReferenceImportSource, current: ReferenceImportSource): ReferenceRelinkReason | undefined {
  if (!sameIdentity(saved.identity, current.identity)) return 'identity-changed';
  if (saved.byteSize !== current.byteSize) return 'size-changed';
  if (saved.mtimeNs !== current.mtimeNs) return 'mtime-changed';
  if (saved.sha256 !== current.sha256) return 'hash-changed';
  return undefined;
}

/**
 * Reopens and re-hashes one scan result using read-only operations. The returned
 * entry is suitable for a DAT-07 Reference source manifest only if the exact
 * scan size, mtime and SHA-256 still match.
 */
export async function captureReferenceSource(imageInput: ReferenceSourceImage): Promise<ReferenceImportSource> {
  const expected = snapshotImage(imageInput);
  let captured: CapturedSource;
  try { captured = await capture(expected.sourcePath, expected.key); }
  catch (error) {
    if (error instanceof ReferenceAccessFailure) throw new Error('Reference sourceを安全に再読込できませんでした。');
    throw error;
  }
  if (captured.entry.byteSize !== expected.byteSize
    || BigInt(captured.entry.mtimeNs) !== expected.mtimeNs
    || captured.entry.sha256 !== expected.sha256) {
    throw new Error('scan後にReference sourceの内容またはmetadataが変更されました。');
  }
  assertCapturedNow(captured);
  capturedSources.set(captured.entry, captured);
  return captured.entry;
}

/**
 * Process-independent read-only verification. Missing, inaccessible, unsafe or
 * changed sources become an explicit stop result; invalid manifest input still
 * throws because it must never be presented as an ordinary relink condition.
 */
export async function verifyReferenceSource(sourceInput: ReferenceImportSource, signal?: AbortSignal): Promise<ReferenceVerification> {
  const saved = snapshotReference(sourceInput);
  let captured: CapturedSource;
  signal?.throwIfAborted();
  try { captured = await capture(saved.sourcePath, saved.imageKey, signal); }
  catch (error) {
    signal?.throwIfAborted();
    if (error instanceof ReferenceAccessFailure) {
      return Object.freeze({ status: 'relink-required', imageKey: saved.imageKey,
        sourcePath: saved.sourcePath, reason: error.reason });
    }
    throw error;
  }
  signal?.throwIfAborted();
  const reason = mismatch(saved, captured.entry);
  if (reason !== undefined) return Object.freeze({ status: 'relink-required',
    imageKey: saved.imageKey, sourcePath: saved.sourcePath, reason });
  try { assertCapturedNow(captured); }
  catch (error) {
    if (error instanceof ReferenceAccessFailure) return Object.freeze({ status: 'relink-required',
      imageKey: saved.imageKey, sourcePath: saved.sourcePath, reason: error.reason });
    throw error;
  }
  capturedSources.set(captured.entry, captured);
  signal?.throwIfAborted();
  return Object.freeze({ status: 'verified', source: captured.entry });
}

/** Main-only: callers supply a genuine stored index entry, never Renderer paths.
 * Returns the exact hashed allocation, not a URL or a newly rebound source.
 */
export async function readVerifiedReferenceImage(source: ReferenceImportSource,
  signal?: AbortSignal): Promise<Buffer> {
  const saved = snapshotReference(source);
  if (signal !== undefined && !(signal instanceof AbortSignal)) throw new TypeError('AbortSignal is required.');
  signal?.throwIfAborted();
  try {
    const verified = await verifyReferenceSource(saved, signal);
    signal?.throwIfAborted();
    if (verified.status !== 'verified') access('changed');
    const captured = capturedSources.get(verified.source);
    if (!captured || mismatch(saved, captured.entry) !== undefined) access('changed');
    signal?.throwIfAborted();
    const volume = await captureLocalVolume(captured.volume.driveRoot);
    signal?.throwIfAborted();
    if (volume.volumeGuid.toLowerCase() !== captured.volume.volumeGuid.toLowerCase()
      || volume.executable !== captured.volume.executable) access('changed');
    assertCapturedMetadataNow(captured);
    const expected = verifiedStamps.get(captured) ?? captured.syncStamp;
    let handle: FileHandle | undefined;
    let failure: unknown;
    let failed = false;
    let bytes: Buffer | undefined;
    try {
      signal?.throwIfAborted();
      handle = await fs.open(captured.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      signal?.throwIfAborted();
      const opened = fileStamp(await handle.stat({ bigint: true }));
      signal?.throwIfAborted();
      const pathOpened = fileStamp(await fs.lstat(captured.path, { bigint: true }));
      if (!sameContent(expected, opened) || !sameContent(expected, pathOpened)) access('changed');
      signal?.throwIfAborted();
      await checkDirectories(captured.directories, signal);
      signal?.throwIfAborted();
      await exactSource(captured.path);
      signal?.throwIfAborted();
      bytes = Buffer.allocUnsafe(saved.byteSize);
      let position = 0;
      while (position < bytes.length) {
        const length = Math.min(chunkBytes, bytes.length - position);
        signal?.throwIfAborted();
        const { bytesRead } = await handle.read(bytes, position, length, position);
        signal?.throwIfAborted();
        if (!Number.isSafeInteger(bytesRead) || bytesRead <= 0 || bytesRead > length) access('read-failed');
        position += bytesRead;
      }
      signal?.throwIfAborted();
      if ((await handle.read(Buffer.allocUnsafe(1), 0, 1, position)).bytesRead !== 0) access('changed');
      signal?.throwIfAborted();
      // Hash the allocation that is actually returned, not another filesystem read.
      if (createHash('sha256').update(bytes).digest('hex') !== saved.sha256) access('changed');
      signal?.throwIfAborted();
      const after = fileStamp(await handle.stat({ bigint: true }));
      signal?.throwIfAborted();
      const pathAfter = fileStamp(await fs.lstat(captured.path, { bigint: true }));
      if (!sameStamp(opened, after) || !sameStamp(pathOpened, pathAfter)
        || !sameContent(expected, after) || !sameContent(after, pathAfter)) access('changed');
      signal?.throwIfAborted();
    } catch (error) { failed = true; failure = error; }
    // Cleanup is deliberately uncancellable, including an abort during open/read.
    if (handle) {
      const closeError = await closeWithRecovery(handle);
      if (closeError !== undefined) {
        failure = failed ? new AggregateError([failure, closeError], 'Reference read and close failed.') : closeError;
        failed = true;
      }
    }
    if (failed) throw failure;
    signal?.throwIfAborted();
    const closed = fileStamp(await fs.lstat(captured.path, { bigint: true }));
    signal?.throwIfAborted();
    if (!sameContent(expected, closed) || !bytes) access('changed');
    // No await follows: ctime settlement can only rehash against the ORIGINAL hash.
    assertCapturedNow(captured);
    signal?.throwIfAborted();
    return bytes;
  } catch {
    signal?.throwIfAborted();
    throw new Error('Reference imageを安全に読込めませんでした。relinkが必要です。');
  }
}

/** Captures a selected candidate against saved expectations snapshotted before any await. */
export async function captureReferenceCandidate(savedEntry: ReferenceImportSource,
  selectedPath: string): Promise<ReferenceImportSource> {
  const saved = snapshotReference(savedEntry);
  const candidatePath = windowsFilePath(selectedPath);
  let candidate: CapturedSource;
  try { candidate = await capture(candidatePath.stored, saved.imageKey); }
  catch (error) {
    if (error instanceof ReferenceAccessFailure) throw new Error('選択したrelink候補を安全に読込めませんでした。');
    throw error;
  }
  if (candidate.entry.byteSize !== saved.byteSize || candidate.entry.sha256 !== saved.sha256) {
    throw new Error('選択したrelink候補のサイズまたはSHA-256が保存値と一致しません。');
  }
  assertCapturedNow(candidate);
  capturedSources.set(candidate.entry, candidate);
  return candidate.entry;
}