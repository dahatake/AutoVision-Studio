import { createHash } from 'node:crypto';
import native, { constants, type BigIntStats } from 'node:fs';
import fs, { type FileHandle } from 'node:fs/promises';
import { win32 } from 'node:path';

import { decodeScanResult, MAX_SCAN_RESULT_BYTES, type ScanContext, type ScanResult } from '../../shared/contracts/import.js';
import { jobIdSchema } from '../../shared/contracts/job.js';
import { projectIdSchema, taskTypeSchema } from '../../shared/contracts/project.js';

interface Identity { readonly dev: string; readonly ino: string; readonly birthtimeNs: string }
interface Stamp {
  readonly identity: Identity;
  readonly size: bigint;
  readonly mtimeNs: bigint;
  readonly ctimeNs: bigint;
  readonly nlink: bigint;
}
interface Directory { readonly path: string; readonly identity: Identity }

/** Main-only evidence, not an IPC DTO or permission to access result.sourcePath. */
export interface ScanArtifact {
  readonly result: ScanResult;
  /** SHA-256 of the original UTF-8 file, including whitespace, NOT canonical JSON. */
  readonly sha256: string;
  readonly byteSize: number;
  readonly identity: Identity;
  readonly manifestPath: string;
}

interface Evidence {
  readonly bytes: Buffer;
  readonly expected: Readonly<ScanContext>;
  readonly sha256: string;
  readonly path: string;
  readonly directories: readonly Directory[];
  readonly handleStamp: Stamp;
  readonly pathStamp: Stamp;
  readonly syncStamp: Stamp;
}
const issued = new WeakMap<ScanArtifact, Evidence>();
const chunkBytes = 64 * 1024;
const readFlags = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;

function invalid(): never { throw new TypeError('Invalid scan artifact input.'); }
function changed(): never { throw new Error('Scan artifact changed or is unsafe.'); }

function contextSnapshot(input: ScanContext): Readonly<ScanContext> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)
    || (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)
    || Reflect.ownKeys(input).length !== 4) invalid();
  const values: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const key of ['projectId', 'jobId', 'taskType', 'mode']) {
    const field = Object.getOwnPropertyDescriptor(input, key);
    if (!field || !field.enumerable || !Object.hasOwn(field, 'value') || typeof field.value !== 'string') invalid();
    values[key] = field.value as string;
  }
  try {
    const projectId = projectIdSchema.parse(values.projectId!.toLowerCase());
    const jobId = jobIdSchema.parse(values.jobId!.toLowerCase());
    const taskType = taskTypeSchema.parse(values.taskType);
    const mode = values.mode;
    if (projectId.length !== 36 || jobId.length !== 36 || (mode !== 'copy' && mode !== 'reference')) invalid();
    return Object.freeze({ projectId, jobId, taskType, mode });
  } catch { return invalid(); }
}

function safeName(name: string): boolean {
  return name.length > 0 && name.length <= 255 && name !== '.' && name !== '..' && name.isWellFormed()
    && !/[\u0000-\u001f\u007f<>:"/\\|?*]/u.test(name) && !/[ .]$/u.test(name)
    && !/^(?:con|conin\$|conout\$|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/iu.test(name);
}
function absolute(path: string): string {
  if (typeof path !== 'string' || path.length > 32_767 || !/^[a-z]:\\/iu.test(path)
    || path !== win32.normalize(path) || !path.slice(3).split('\\').every(safeName)) invalid();
  return path;
}
function identity(stat: BigIntStats): Identity {
  if (stat.dev < 0n || stat.ino <= 0n) changed();
  return Object.freeze({ dev: String(stat.dev), ino: String(stat.ino), birthtimeNs: String(stat.birthtimeNs) });
}
function directoryIdentity(stat: BigIntStats): Identity {
  if (!stat.isDirectory() || stat.isSymbolicLink()) changed();
  return identity(stat);
}
function stamp(stat: BigIntStats): Stamp {
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n
    || stat.size <= 0n || stat.size > BigInt(MAX_SCAN_RESULT_BYTES)) changed();
  return Object.freeze({ identity: identity(stat), size: stat.size, mtimeNs: stat.mtimeNs,
    ctimeNs: stat.ctimeNs, nlink: stat.nlink });
}
function sameIdentity(a: Identity, b: Identity): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.birthtimeNs === b.birthtimeNs;
}
function sameContent(a: Stamp, b: Stamp): boolean {
  return sameIdentity(a.identity, b.identity) && a.size === b.size && a.mtimeNs === b.mtimeNs && a.nlink === b.nlink;
}
function sameStamp(a: Stamp, b: Stamp): boolean { return sameContent(a, b) && a.ctimeNs === b.ctimeNs; }
function exactName(entries: readonly string[], name: string): void {
  const aliases = entries.filter((entry) => entry.toUpperCase() === name.toUpperCase());
  if (aliases.length !== 1 || aliases[0] !== name) changed();
}

async function captureDirectories(parent: string): Promise<readonly Directory[]> {
  let cursor = win32.parse(parent).root;
  const directories: Directory[] = [];
  for (const part of ['', ...parent.slice(cursor.length).split('\\')]) {
    if (part) {
      exactName(await fs.readdir(cursor), part);
      cursor = win32.join(cursor, part);
    }
    const id = directoryIdentity(await fs.lstat(cursor, { bigint: true }));
    if (await fs.realpath(cursor) !== cursor) changed();
    directories.push(Object.freeze({ path: cursor, identity: id }));
  }
  return Object.freeze(directories);
}

function directoriesNow(directories: readonly Directory[]): void {
  for (const entry of directories) {
    const id = directoryIdentity(native.lstatSync(entry.path, { bigint: true }));
    if (!sameIdentity(id, entry.identity) || native.realpathSync(entry.path) !== entry.path) changed();
    if (entry.path !== win32.parse(entry.path).root) {
      exactName(native.readdirSync(win32.dirname(entry.path)), win32.basename(entry.path));
    }
  }
}
function fileNow(path: string): Stamp {
  exactName(native.readdirSync(win32.dirname(path)), win32.basename(path));
  const current = stamp(native.lstatSync(path, { bigint: true }));
  if (native.realpathSync(path) !== path) changed();
  return current;
}
function current(evidence: Evidence): void {
  directoriesNow(evidence.directories);
  if (!sameStamp(fileNow(evidence.path), evidence.syncStamp)) changed();
  // Filesystem timestamps are not a content proof (including a same-tick
  // overwrite with restored mtime). Compare the bounded managed artifact with
  // the privately retained raw bytes before issuing/using authority.
  const fd = native.openSync(evidence.path, readFlags);
  try {
    const opened = stamp(native.fstatSync(fd, { bigint: true }));
    const pathOpened = fileNow(evidence.path);
    if (!sameContent(opened, evidence.syncStamp) || !sameStamp(pathOpened, evidence.syncStamp)) changed();
    const buffer = Buffer.allocUnsafe(chunkBytes);
    let position = 0;
    while (position < evidence.bytes.length) {
      const length = Math.min(buffer.length, evidence.bytes.length - position);
      const count = native.readSync(fd, buffer, 0, length, position);
      if (count <= 0 || count > length || !buffer.subarray(0, count)
        .equals(evidence.bytes.subarray(position, position + count))) changed();
      position += count;
    }
    if (native.readSync(fd, buffer, 0, 1, position) !== 0
      || !sameStamp(opened, stamp(native.fstatSync(fd, { bigint: true })))
      || !sameStamp(pathOpened, fileNow(evidence.path))) changed();
  } finally { native.closeSync(fd); }
  directoriesNow(evidence.directories);
  if (!sameStamp(fileNow(evidence.path), evidence.syncStamp)) changed();
}

async function closeWithRecovery(handle: FileHandle, errors: unknown[]): Promise<void> {
  try { await handle.close(); }
  catch (error) {
    errors.push(error);
    // A failed close before release is retried ONCE, never hidden as success.
    if (handle.fd !== -1) {
      try { await handle.close(); } catch (retryError) { errors.push(retryError); }
    }
  }
}
function deepFreeze(value: object): void {
  const pending = [value];
  while (pending.length > 0) {
    const item = pending.pop()!;
    Object.freeze(item);
    for (const child of Object.values(item)) {
      if (child !== null && typeof child === 'object') pending.push(child as object);
    }
  }
}

/**
 * DAT-08 leaf. Caller supplies Main's configured, trusted local cache UUID child,
 * NOT Renderer input. A WorkerResult locator remains opaque until this read.
 * No mount probing or source-image I/O: result path allowlisting belongs to the
 * later DAT-08 service. This does not authenticate a worker or lock out OS writers.
 */
export async function readScanArtifact(jobDirectory: string, manifestPath: string,
  expected: ScanContext): Promise<ScanArtifact> {
  const context = contextSnapshot(expected); // Detached and validated before ANY await/I/O.
  absolute(jobDirectory);
  absolute(manifestPath);
  if (process.platform !== 'win32' || win32.basename(jobDirectory) !== context.jobId
    || !manifestPath.startsWith(`${jobDirectory}\\`)
    || win32.basename(manifestPath).toLowerCase() === 'request.json') invalid();
  try {
    const directories = await captureDirectories(win32.dirname(manifestPath));
    directoriesNow(directories);
    const before = stamp(await fs.lstat(manifestPath, { bigint: true }));
    // Includes exact filename and all ancestors immediately before opening.
    directoriesNow(directories);
    if (!sameContent(before, fileNow(manifestPath))) changed();
    const handle = await fs.open(manifestPath, readFlags);
    const errors: unknown[] = [];
    let opened: Stamp | undefined;
    let pathOpened: Stamp | undefined;
    let pathAfter: Stamp | undefined;
    let syncStamp: Stamp | undefined;
    let bytes: Buffer | undefined;
    try {
      opened = stamp(await handle.stat({ bigint: true }));
      pathOpened = stamp(await fs.lstat(manifestPath, { bigint: true }));
      if (!sameContent(before, opened) || !sameContent(opened, pathOpened)) changed();
      directoriesNow(directories);
      if (!sameContent(fileNow(manifestPath), pathOpened)) changed();
      // Exactly the prechecked size, not size+1 or a concatenated second buffer.
      bytes = Buffer.alloc(Number(opened.size));
      let position = 0;
      while (position < bytes.length) {
        const length = Math.min(chunkBytes, bytes.length - position);
        const { bytesRead } = await handle.read(bytes, position, length, position);
        if (!Number.isSafeInteger(bytesRead) || bytesRead <= 0 || bytesRead > length) changed();
        position += bytesRead;
      }
      // Reuse one byte of the same buffer for EOF probing. A nonempty probe
      // rejects the whole buffer; a real EOF leaves the retained bytes intact.
      const end = await handle.read(bytes, 0, 1, position);
      if (end.bytesRead !== 0) changed();
      syncStamp = fileNow(manifestPath);
      if (!sameContent(pathOpened, syncStamp)) changed();
      const after = stamp(await handle.stat({ bigint: true }));
      pathAfter = stamp(await fs.lstat(manifestPath, { bigint: true }));
      // lstat and fstat ctime are NEVER compared to each other.
      if (!sameStamp(opened, after) || !sameStamp(pathOpened, pathAfter)) changed();
      // Pin the sync API's own stamp BEFORE close can yield; never adopt a
      // post-close ctime for bytes retained from the reader.
      if (!sameContent(pathAfter, syncStamp) || !sameStamp(syncStamp, fileNow(manifestPath))) changed();
    } catch (error) { errors.push(error); }
    await closeWithRecovery(handle, errors);
    if (errors.length > 0 || !bytes || !opened || !pathOpened || !pathAfter || !syncStamp) changed();
    const closed = stamp(await fs.lstat(manifestPath, { bigint: true }));
    // Same-API ctime changes across close fail closed, including metadata
    // settling; cross-API ctime differences are still never compared.
    if (!sameStamp(pathAfter, closed)) changed();
    directoriesNow(directories);
    if (!sameStamp(syncStamp, fileNow(manifestPath))) changed();
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const result = decodeScanResult(bytes, context); // Strict shared codec, no reserialization.
    deepFreeze(result);
    if (await fs.realpath(manifestPath) !== manifestPath) changed();
    const evidence: Evidence = Object.freeze({ bytes, expected: context, sha256, path: manifestPath,
      directories, handleStamp: opened, pathStamp: pathOpened, syncStamp });
    // All ancestor identities, exact names, realpaths and same-API ctime are
    // checked synchronously AFTER the last await, before evidence is issued.
    current(evidence);
    const artifact: ScanArtifact = Object.freeze({ result, sha256, manifestPath,
      byteSize: bytes.length, identity: syncStamp.identity });
    issued.set(artifact, evidence);
    return artifact;
  } catch { throw new Error('Scan artifact could not be safely read.'); }
}

/**
 * Invoke after the caller's last await, immediately before synchronous commit.
 * Bounded raw-byte and metadata revalidation of the privately retained file; not an
 * OS-atomic lock. A clone/serialized DTO or caller-supplied hash grants no proof.
 */
export function assertScanArtifactCurrent(artifact: ScanArtifact): void {
  const evidence = issued.get(artifact);
  if (!evidence) throw new TypeError('An issued scan artifact is required.');
  try { current(evidence); }
  catch { throw new Error('Scan artifact changed or is unsafe.'); }
}