import native, { type BigIntStats } from 'node:fs';
import { win32 } from 'node:path';
import { types } from 'node:util';

import { MAX_IMAGE_BYTES } from '../../shared/contracts/import.js';
import { importSourceManifestSchema, type CopyImportSource } from '../data/import-source-manifest.js';
import {
  assertCapturedReferenceSourceCurrent, captureReferenceSource, readVerifiedReferenceImage,
} from '../data/reference-access.js';
import {
  verifyProjectDirectory, type ProjectDirectoryReceipt, type ProjectFileIdentity,
} from '../projects/project-directory.js';

function invalid(): never { throw new TypeError('A safe Project Copy source is required.'); }
function changed(): never { throw new Error('Project image path or identity changed.'); }

// Inspect descriptors only after rejecting proxies, including nested identities.
// Do not pass caller objects to a schema that might invoke proxy traps.
function fields(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || types.isProxy(value) || Array.isArray(value)) invalid();
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid();
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || own.some((key) => typeof key !== 'string' || !keys.includes(key))) invalid();
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) invalid();
    result[key] = descriptor.value as unknown;
  }
  return result;
}

function snapshotIdentity(value: unknown): ProjectFileIdentity {
  const data = fields(value, ['dev', 'ino', 'birthtimeNs']);
  if (typeof data.dev !== 'string' || !/^(?:0|[1-9][0-9]*)(?![\s\S])/u.test(data.dev)
    || typeof data.ino !== 'string' || !/^[1-9][0-9]*(?![\s\S])/u.test(data.ino)
    || typeof data.birthtimeNs !== 'string' || !/^(?:0|-?[1-9][0-9]*)(?![\s\S])/u.test(data.birthtimeNs)) invalid();
  return { dev: data.dev, ino: data.ino, birthtimeNs: data.birthtimeNs };
}

function snapshotProject(value: ProjectDirectoryReceipt): ProjectDirectoryReceipt {
  const data = fields(value, ['rootPath', 'projectId', 'rootIdentity', 'markerIdentity']);
  if (typeof data.rootPath !== 'string' || typeof data.projectId !== 'string'
    || process.platform !== 'win32' || !/^[a-z]:\\/iu.test(data.rootPath)
    || data.rootPath.includes('/') || win32.normalize(data.rootPath) !== data.rootPath) invalid();
  return { rootPath: data.rootPath, projectId: data.projectId,
    rootIdentity: snapshotIdentity(data.rootIdentity), markerIdentity: snapshotIdentity(data.markerIdentity) };
}

function snapshotSource(value: CopyImportSource): CopyImportSource {
  const data = fields(value, ['imageKey', 'relativePath', 'byteSize', 'sha256']);
  if (typeof data.imageKey !== 'string' || typeof data.relativePath !== 'string'
    || typeof data.byteSize !== 'number' || typeof data.sha256 !== 'string') invalid();
  const manifest = importSourceManifestSchema.parse({ formatVersion: 1, mode: 'copy', entries: [data] });
  if (manifest.mode !== 'copy') invalid();
  return manifest.entries[0]!;
}

function identity(stat: BigIntStats): ProjectFileIdentity {
  if (stat.dev < 0n || stat.ino <= 0n) changed();
  return { dev: String(stat.dev), ino: String(stat.ino), birthtimeNs: String(stat.birthtimeNs) };
}

function same(left: ProjectFileIdentity, right: ProjectFileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.birthtimeNs === right.birthtimeNs;
}

function projectCurrent(project: ProjectDirectoryReceipt): void {
  const current = verifyProjectDirectory(project.rootPath, project.projectId);
  if (current.rootPath !== project.rootPath || !same(current.rootIdentity, project.rootIdentity)
    || !same(current.markerIdentity, project.markerIdentity)) changed();
}

function ordinaryFile(path: string, size: number): BigIntStats {
  const stat = native.lstatSync(path, { bigint: true });
  identity(stat);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n
    || stat.size !== BigInt(size) || stat.size <= 0n || stat.size > BigInt(MAX_IMAGE_BYTES)) changed();
  return stat;
}

function sameContent(before: BigIntStats, after: BigIntStats): boolean {
  return same(identity(before), identity(after)) && before.size === after.size
    && before.mtimeNs === after.mtimeNs && before.nlink === after.nlink;
}

function chain(target: string): { path: string; identity: ProjectFileIdentity }[] {
  let cursor = win32.parse(target).root;
  const guards: { path: string; identity: ProjectFileIdentity }[] = [];
  const inspect = () => {
    const stat = native.lstatSync(cursor, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink()) changed();
    guards.push({ path: cursor, identity: identity(stat) });
  };
  inspect();
  const parts = target.slice(cursor.length).split('\\');
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]!;
    const aliases = native.readdirSync(cursor).filter((name) => name.toUpperCase() === part.toUpperCase());
    if (aliases.length !== 1 || aliases[0] !== part) changed();
    cursor = win32.join(cursor, part);
    if (index < parts.length - 1) inspect();
  }
  if (native.realpathSync.native(target) !== target) changed();
  return guards;
}

/** Main-only leaf: the caller must assert genuine DB Copy capability before and
 * after this call. This function issues no DB/write authority and accepts no URL.
 * It returns the reader's exact hash-verified allocation (1..128 MiB), without
 * decoding or MIME sniffing. The reader uses 64 KiB reads, EOF and close guards.
 * A ctime-only settlement uses a bounded read-only recapture; that exceptional
 * phase checks cancellation before/after, but cannot interrupt recapture itself.
 */
export async function readProjectImage(project: ProjectDirectoryReceipt, source: CopyImportSource,
  signal?: AbortSignal): Promise<Buffer> {
  const savedProject = snapshotProject(project);
  const saved = snapshotSource(source);
  if (signal !== undefined && (types.isProxy(signal) || !(signal instanceof AbortSignal))) invalid();
  signal?.throwIfAborted();
  projectCurrent(savedProject);
  const target = win32.join(savedProject.rootPath, ...saved.relativePath.split('/'));
  if (win32.relative(savedProject.rootPath, target) !== saved.relativePath.replaceAll('/', '\\')) invalid();
  const directories = chain(target);
  const before = ordinaryFile(target, saved.byteSize);
  const assertCurrent = (): BigIntStats => {
    projectCurrent(savedProject);
    const current = chain(target);
    if (current.length !== directories.length || current.some((entry, index) =>
      entry.path !== directories[index]!.path || !same(entry.identity, directories[index]!.identity))) changed();
    const after = ordinaryFile(target, saved.byteSize);
    if (!sameContent(before, after)) changed();
    return after;
  };
  // Identity is captured from the CURRENT Copy target, never persisted from the
  // original import: a legitimate cross-volume Project move can change its inode.
  const expected = { imageKey: saved.imageKey, sourcePath: target, identity: identity(before),
    byteSize: saved.byteSize, mtimeNs: String(before.mtimeNs), sha256: saved.sha256 };
  const bytes = await readVerifiedReferenceImage(expected, signal);
  signal?.throwIfAborted();
  const after = assertCurrent();
  if (after.ctimeNs !== before.ctimeNs) {
    const proof = await captureReferenceSource({ key: saved.imageKey, sourcePath: target,
      byteSize: saved.byteSize, mtimeNs: expected.mtimeNs, sha256: saved.sha256 });
    signal?.throwIfAborted();
    assertCurrent();
    if (!same(proof.identity, expected.identity)) changed();
    assertCapturedReferenceSourceCurrent(proof);
    assertCurrent();
  }
  signal?.throwIfAborted();
  return bytes;
}