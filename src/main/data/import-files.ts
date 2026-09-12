import native, { type BigIntStats } from 'node:fs';
import { win32 } from 'node:path';

import { parseScanResult, type ScanResult } from '../../shared/contracts/import.js';
import { projectIdSchema } from '../../shared/contracts/project.js';
import { verifyProjectDirectory, type ProjectDirectoryReceipt, type ProjectFileIdentity } from '../projects/project-directory.js';
import { copySourceFile } from './copy-source.js';
import { importJsonObjectSchema, type CopyImportSource, type ImportSourceManifest, type ReferenceImportSource } from './import-source-manifest.js';
import { assertCapturedReferenceSourcesCurrent, captureReferenceSource } from './reference-access.js';

const intentName = '.autovision-import.json';
const projectMarkerName = '.autovision-project.json';
const intentLimit = 512;

/** Main-only location evidence; neither serialization nor a matching marker grants authority. */
export interface ImportFilesLocation {
  readonly rootPath: string;
  readonly relativeRoot: string;
  readonly rootIdentity: ProjectFileIdentity;
  readonly markerIdentity: ProjectFileIdentity;
}

export interface PreparedImportFiles {
  readonly projectId: string;
  readonly importId: string;
  readonly scanJobId: string;
  readonly mode: ScanResult['mode'];
  readonly sourceManifest: ImportSourceManifest;
  readonly location: ImportFilesLocation;
}

/** Never forward this Main-only diagnostic locator or raw filesystem errors over IPC. */
export class ImportFilesAttentionError extends Error {
  readonly code = 'ERR_IMPORT_FILES_ATTENTION';
  constructor(readonly retainedRelativeRoot: string | null, cause?: unknown) {
    super('ERR_IMPORT_FILES_ATTENTION: inspect retained import files; do not automatically retry.', { cause });
    this.name = 'ImportFilesAttentionError';
  }
}

interface Directory { readonly path: string; readonly identity: ProjectFileIdentity }
interface Stamp {
  readonly identity: ProjectFileIdentity;
  readonly size: bigint;
  readonly mtimeNs: bigint;
  readonly ctimeNs: bigint;
  readonly nlink: bigint;
}
interface OwnedDirectory extends Directory { readonly children: Set<string> }
interface Marker { readonly path: string; readonly bytes: Buffer; readonly stamp: Stamp }
interface State {
  readonly project: ProjectDirectoryReceipt;
  readonly relativeRoot: string;
  readonly base: readonly Directory[];
  readonly projectMarker: Stamp;
  readonly directories: Map<string, OwnedDirectory>;
  readonly sourceDirectories: Map<string, Directory>;
  readonly proofs: ReferenceImportSource[];
  datasets?: Directory;
  marker?: Marker;
}
const issued = new WeakMap<PreparedImportFiles, State>();

function invalid(): never { throw new TypeError('ERR_IMPORT_FILES_INVALID_INPUT'); }
function changed(): never { throw new Error('ERR_IMPORT_FILES_CHANGED'); }
function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function absolute(value: string): string {
  if (process.platform !== 'win32' || typeof value !== 'string' || value.length > 32_767
    || !value.isWellFormed() || !/^[a-z]:[\\/]/iu.test(value)) invalid();
  const path = value.replaceAll('/', '\\');
  if (path !== win32.normalize(path) || path.slice(3).split('\\').some((part) => !part || part.length > 255
    || /[\u0000-\u001f\u007f<>:"/\\|?*]/u.test(part) || /[ .]$/u.test(part)
    || /^(?:con|conin\$|conout\$|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/iu.test(part))) invalid();
  return path;
}
function contains(parent: string, child: string): boolean {
  const relative = win32.relative(parent.toUpperCase(), child.toUpperCase());
  return relative === '' || (relative !== '..' && !relative.startsWith('..\\') && !win32.isAbsolute(relative));
}
function identity(stat: BigIntStats): ProjectFileIdentity {
  if (stat.dev < 0n || stat.ino <= 0n) changed();
  return Object.freeze({ dev: String(stat.dev), ino: String(stat.ino), birthtimeNs: String(stat.birthtimeNs) });
}
function sameIdentity(a: ProjectFileIdentity, b: ProjectFileIdentity): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.birthtimeNs === b.birthtimeNs;
}
function stamp(stat: BigIntStats): Stamp {
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n || stat.size < 0n) changed();
  return { identity: identity(stat), size: stat.size, mtimeNs: stat.mtimeNs, ctimeNs: stat.ctimeNs, nlink: stat.nlink };
}
function sameContent(a: Stamp, b: Stamp): boolean {
  return sameIdentity(a.identity, b.identity) && a.size === b.size && a.mtimeNs === b.mtimeNs && a.nlink === b.nlink;
}
function sameStamp(a: Stamp, b: Stamp): boolean { return sameContent(a, b) && a.ctimeNs === b.ctimeNs; }
function fileNow(path: string): Stamp { return stamp(native.lstatSync(path, { bigint: true })); }
function directory(path: string): Directory {
  const stat = native.lstatSync(path, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink() || native.realpathSync.native(path) !== path) changed();
  return { path, identity: identity(stat) };
}
function checkDirectory(entry: Directory): void {
  if (!sameIdentity(directory(entry.path).identity, entry.identity)) changed();
}
function chain(path: string): Directory[] {
  let cursor = win32.parse(path).root;
  const result = [directory(cursor)];
  for (const part of path.slice(cursor.length).split('\\')) {
    if (!part) continue;
    cursor = win32.join(cursor, part);
    result.push(directory(cursor));
  }
  return result;
}
function exactChild(parent: string, name: string): boolean {
  const names = native.readdirSync(parent).filter((entry) => entry.toUpperCase() === name.toUpperCase());
  if (names.length > 1 || (names.length === 1 && names[0] !== name)) changed();
  return names.length === 1;
}
function missing(parent: string, name: string): void {
  if (exactChild(parent, name)) changed();
  try { native.lstatSync(win32.join(parent, name)); }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
    throw error;
  }
  changed();
}

/** Read fixed canonical bytes, bounding even a racing growth; compare ctime only within each API. */
function readMarker(path: string, bytes: Buffer, expected?: Stamp, expectedIdentity?: ProjectFileIdentity): Stamp {
  const before = fileNow(path);
  if (before.size !== BigInt(bytes.length) || bytes.length > intentLimit
    || (expected && !sameStamp(before, expected))
    || (expectedIdentity && !sameIdentity(before.identity, expectedIdentity))) changed();
  const fd = native.openSync(path, 'r');
  try {
    const opened = stamp(native.fstatSync(fd, { bigint: true }));
    const pathOpened = fileNow(path);
    if (!sameContent(before, opened) || !sameContent(opened, pathOpened)) changed();
    const buffer = Buffer.alloc(intentLimit + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = native.readSync(fd, buffer, length, buffer.length - length, length);
      if (count === 0) break;
      length += count;
    }
    if (!buffer.subarray(0, length).equals(bytes)
      || !sameStamp(opened, stamp(native.fstatSync(fd, { bigint: true })))
      || !sameStamp(pathOpened, fileNow(path))) changed();
  } finally { close(fd); }
  const after = fileNow(path);
  if (!sameContent(before, after) || (expected && !sameStamp(expected, after))) changed();
  return after;
}
function close(fd: number): void {
  try { native.closeSync(fd); }
  catch (error) {
    // One descriptor-release recovery attempt; still report the first failure.
    try { native.closeSync(fd); } catch { /* may already be closed */ }
    throw error;
  }
}

function baseNow(state: State): void {
  for (const entry of state.base) checkDirectory(entry);
  const current = verifyProjectDirectory(state.project.rootPath, state.project.projectId);
  if (current.rootPath !== state.project.rootPath || !sameIdentity(current.rootIdentity, state.project.rootIdentity)
    || !sameIdentity(current.markerIdentity, state.project.markerIdentity)
    || !sameStamp(fileNow(win32.join(current.rootPath, projectMarkerName)), state.projectMarker)) changed();
  if (state.datasets) {
    if (!exactChild(current.rootPath, 'datasets')) changed();
    checkDirectory(state.datasets);
  }
}
function pathNow(state: State, relative: string): void {
  baseNow(state);
  let prefix = '';
  for (const part of relative.split('/')) {
    prefix = prefix ? `${prefix}/${part}` : part;
    if (prefix === 'datasets') continue;
    const entry = state.directories.get(prefix);
    if (!entry || !exactChild(win32.dirname(entry.path), part)) changed();
    checkDirectory(entry);
  }
  if (state.marker) {
    if (!exactChild(win32.dirname(state.marker.path), intentName)) changed();
    readMarker(state.marker.path, state.marker.bytes, state.marker.stamp);
  }
}
function createDirectory(state: State, relative: string): OwnedDirectory {
  const parentRelative = relative.slice(0, relative.lastIndexOf('/'));
  pathNow(state, parentRelative);
  const path = win32.join(state.project.rootPath, relative);
  const name = win32.basename(path);
  missing(win32.dirname(path), name);
  native.mkdirSync(path); // Exclusive: no recursive mkdir, no adoption, no rollback.
  const entry = { ...directory(path), children: new Set<string>() };
  state.directories.set(relative, entry);
  state.directories.get(parentRelative)?.children.add(name);
  pathNow(state, relative);
  if (native.readdirSync(path).length !== 0) changed();
  return entry;
}
function writeIntent(state: State, scan: ScanResult, importId: string): void {
  pathNow(state, state.relativeRoot);
  const parent = win32.join(state.project.rootPath, state.relativeRoot);
  missing(parent, intentName);
  const path = win32.join(parent, intentName);
  const bytes = Buffer.from(`${JSON.stringify({ version: 1, projectId: scan.projectId, importId,
    scanJobId: scan.jobId, mode: scan.mode, phase: 'materializing' })}\n`, 'utf8');
  const fd = native.openSync(path, 'wx', 0o600);
  let created: ProjectFileIdentity;
  try {
    created = stamp(native.fstatSync(fd, { bigint: true })).identity;
    pathNow(state, state.relativeRoot);
    if (!sameIdentity(fileNow(path).identity, created)) changed();
    native.writeFileSync(fd, bytes);
    native.fsyncSync(fd);
  } finally { close(fd); }
  state.marker = { path, bytes, stamp: readMarker(path, bytes, undefined, created) };
  state.directories.get(state.relativeRoot)!.children.add(intentName);
  pathNow(state, state.relativeRoot);
}
function current(state: State): void {
  pathNow(state, state.relativeRoot);
  // Walk known directories only, parent first. Unknown children are rejected,
  // never recursively followed or granted ownership, including on finish.
  for (const entry of state.directories.values()) {
    checkDirectory(entry);
    const names = native.readdirSync(entry.path);
    if (names.length !== entry.children.size || names.some((name) => !entry.children.has(name))) changed();
  }
  for (const entry of state.sourceDirectories.values()) checkDirectory(entry);
  assertCapturedReferenceSourcesCurrent(state.proofs); // One volume query per drive for this phase.
  pathNow(state, state.relativeRoot);
}

/**
 * DAT-08D leaf, Windows/Main only. Caller MUST preflight rights, capacity, scan
 * artifact authenticity/currentness, worker/DB state and hold the Project lock.
 * A ScanResult is a schema-checked deep snapshot, NOT a genuine ScanArtifact.
 * No DB, workspace, IPC, image decoding, implicit root selection or resume.
 *
 * Both modes reserve datasets/<UUID> and fsync an exclusive intent before payload
 * work, AFTER capturing and batch-validating all original sources on local volume
 * GUID paths. Preflight rejection creates no output. Later failures retain the
 * batch, including partial intent writes. DAT-06 may
 * reclaim its own uncommitted single-file temp; this layer removes nothing.
 * Reference entries remain the EXACT issued capture objects, never JSON clones.
 * Manifest persistence belongs to DAT-07; no second physical manifest is written.
 *
 * source/<hi hex>/<lo hex>/<global ordinal 6 digits>.<ext> has <=256 final files
 * per leaf (one additional transient DAT-06 temp), <=256 low buckets per high
 * bucket and <=2 high buckets at 100k images. Existing datasets/import counts,
 * Project/source ancestors and capture volume probes remain unbounded-by-layout
 * costs. No measured O(N) or 100k performance claim. File hashing uses DAT-06/
 * Reference's 64 KiB reads, not whole-image buffering. Final synchronous guards
 * close in-process await gaps, not hostile OS-writer races or power-loss windows.
 */
export async function materializeImportSources(projectInput: ProjectDirectoryReceipt, importIdInput: string,
  scanInput: ScanResult, protectedRoots: readonly string[]): Promise<PreparedImportFiles> {
  let project: ProjectDirectoryReceipt, scan: ScanResult, importId: string, roots: string[];
  try {
    // Reject accessors, cycles, sparse/custom arrays before cloning or any I/O.
    importJsonObjectSchema.parse({ project: projectInput, protectedRoots });
    project = freeze(structuredClone(projectInput));
    scan = freeze(parseScanResult(scanInput));
    importId = projectIdSchema.parse(importIdInput);
    if (!Array.isArray(protectedRoots) || Object.getPrototypeOf(protectedRoots) !== Array.prototype) invalid();
    roots = [];
    for (let index = 0; index < protectedRoots.length; index += 1) {
      roots.push(absolute(Object.getOwnPropertyDescriptor(protectedRoots, String(index))!.value as string));
    }
    absolute(project.rootPath);
    if (scan.projectId !== project.projectId) invalid();
    // Geometry is pure: do not probe any protected path before source preflight.
    for (const root of roots) {
      if (contains(root, project.rootPath) || contains(project.rootPath, root)) invalid();
    }
    for (const image of scan.images) {
      absolute(image.sourcePath);
      if (contains(project.rootPath, image.sourcePath)) invalid();
    }
  } catch { return invalid(); }

  let retained: string | null = null;
  try {
    const verified = verifyProjectDirectory(project.rootPath, project.projectId);
    if (verified.rootPath !== project.rootPath || !sameIdentity(verified.rootIdentity, project.rootIdentity)
      || !sameIdentity(verified.markerIdentity, project.markerIdentity)) changed();
    // The Project is Main-owned. All other source/protected-path I/O must wait
    // until genuine captures have rejected mapped/network drives. Keep the exact
    // issued objects: their private GUID/ancestor/sync-ctime guards span later awaits.
    const references: ReferenceImportSource[] = [];
    for (const image of scan.images) references.push(await captureReferenceSource(image));
    assertCapturedReferenceSourcesCurrent(references);
    const projectChain = chain(project.rootPath);
    const base = [...projectChain];
    // Main-owned protected-root identity checks remain ordinary-path checks.
    // This preflight ordering does not pin those paths against later remapping.
    for (const root of roots) {
      const other = chain(root);
      if (contains(root, project.rootPath) || contains(project.rootPath, root)
        || projectChain.some((entry) => sameIdentity(entry.identity, other.at(-1)!.identity))
        || other.some((entry) => sameIdentity(entry.identity, project.rootIdentity))) changed();
      base.push(...other);
    }
    const relativeRoot = `datasets/${importId}`;
    const state: State = { project, relativeRoot, base,
      projectMarker: fileNow(win32.join(project.rootPath, projectMarkerName)),
      directories: new Map(), sourceDirectories: new Map(), proofs: scan.mode === 'reference' ? [...references] : [] };
    // DAT-06's ordinary-path checks remain Copy-only and follow local preflight.
    // Reference source evidence comes exclusively from the issued GUID proofs.
    const originals = scan.mode === 'copy' ? scan.images.map((image, index) => {
      const path = absolute(image.sourcePath);
      for (const entry of chain(win32.dirname(path))) {
        const previous = state.sourceDirectories.get(entry.path);
        if (previous && !sameIdentity(previous.identity, entry.identity)) changed();
        state.sourceDirectories.set(entry.path, entry);
      }
      const before = fileNow(path);
      if (before.size !== BigInt(image.byteSize) || before.mtimeNs !== BigInt(image.mtimeNs)
        || !sameIdentity(before.identity, references[index]!.identity)) changed();
      return before;
    }) : [];
    baseNow(state);
    const datasets = win32.join(project.rootPath, 'datasets');
    if (!exactChild(project.rootPath, 'datasets')) {
      missing(project.rootPath, 'datasets');
      retained = 'datasets';
      native.mkdirSync(datasets);
    }
    state.datasets = directory(datasets); // Shared parent is checked, never deletion-owned.
    retained = relativeRoot;
    createDirectory(state, relativeRoot); // Existing UUID root ALWAYS requires attention.
    writeIntent(state, scan, importId);

    const copies: CopyImportSource[] = [];
    if (scan.mode === 'copy') {
      createDirectory(state, `${relativeRoot}/source`);
      for (let index = 0; index < scan.images.length; index += 1) {
        const image = scan.images[index]!;
        const bucket = Math.floor(index / 256);
        const high = `${relativeRoot}/source/${Math.floor(bucket / 256).toString(16).padStart(2, '0')}`;
        const low = `${high}/${(bucket % 256).toString(16).padStart(2, '0')}`;
        for (const relative of [high, low]) if (!state.directories.has(relative)) createDirectory(state, relative);
        const extension = image.format === 'jpeg' ? 'jpg' : image.format;
        const relativePath = `${low}/${String(index).padStart(6, '0')}.${extension}`;
        pathNow(state, low);
        const copied = await copySourceFile(project, image, relativePath);
        pathNow(state, low);
        const originalAfterCopy = fileNow(absolute(image.sourcePath));
        if (!sameContent(originals[index]!, originalAfterCopy)) changed();
        // DAT-06 has closed its reader: pin this sync-API ctime across subsequent
        // unrelated copies, without comparing it with pre-open/handle ctime.
        originals[index] = originalAfterCopy;
        const path = win32.join(project.rootPath, relativePath);
        const before = fileNow(path);
        if (copied.imageKey !== image.key || copied.relativePath !== relativePath
          || copied.byteSize !== image.byteSize || copied.sha256 !== image.sha256
          || before.size !== BigInt(image.byteSize) || !sameIdentity(before.identity, copied.fileIdentity)) changed();
        state.directories.get(low)!.children.add(win32.basename(path));
        // Independent target rehash closes the copy-return/first-stat gap. Keep
        // its private sync ctime/parent proof across ALL later awaits.
        const proof = await captureReferenceSource({ ...image, sourcePath: path, mtimeNs: String(before.mtimeNs) });
        pathNow(state, low);
        if (!sameContent(before, fileNow(path)) || !sameIdentity(proof.identity, copied.fileIdentity)) changed();
        state.proofs.push(proof);
        copies.push(Object.freeze({ imageKey: image.key, relativePath, byteSize: image.byteSize, sha256: image.sha256 }));
      }
    }
    if (scan.mode === 'copy') {
      for (let index = 0; index < scan.images.length; index += 1) {
        const image = scan.images[index]!;
        if (!sameContent(originals[index]!, fileNow(absolute(image.sourcePath)))) changed();
        // Copy opens the source through its own read handle. Windows may settle
        // ctime on that open/close; the pre-copy local-volume proof is not a
        // post-copy byte proof. Re-hash against the ORIGINAL scan and identity,
        // then retain only this final proof through all remaining awaits.
        const proof = await captureReferenceSource(image);
        if (!sameIdentity(proof.identity, originals[index]!.identity)
          || !sameContent(originals[index]!, fileNow(absolute(image.sourcePath)))) changed();
        state.proofs.push(proof);
      }
    }
    current(state);
    const sourceManifest: ImportSourceManifest = scan.mode === 'copy'
      ? { formatVersion: 1, mode: 'copy', entries: copies }
      : { formatVersion: 1, mode: 'reference', entries: references };
    const prepared: PreparedImportFiles = freeze({ projectId: project.projectId, importId,
      scanJobId: scan.jobId, mode: scan.mode, sourceManifest,
      location: { rootPath: win32.join(project.rootPath, relativeRoot), relativeRoot,
        rootIdentity: state.directories.get(relativeRoot)!.identity, markerIdentity: state.marker!.stamp.identity } });
    issued.set(prepared, state);
    return prepared;
  } catch (error) { throw new ImportFilesAttentionError(retained, error); }
}

/** Synchronous final guard; a ctime-only settlement requires a fresh bounded hash. */
export function assertImportFilesCurrent(prepared: PreparedImportFiles): void {
  const state = issued.get(prepared);
  if (!state) throw new TypeError('ERR_IMPORT_FILES_INVALID_RECEIPT');
  try { current(state); }
  catch (error) { throw new ImportFilesAttentionError(state.relativeRoot, error); }
}

/** POST-DB-COMMIT only. Validate everything, unlink ONLY the exact intent, keep all payloads.
 * An unlink attempt consumes authority even on lost acknowledgement. Report a
 * service warning on failure, never undo DB, auto-retry, adopt or delete the root.
 */
export function finishImportFiles(prepared: PreparedImportFiles): void {
  const state = issued.get(prepared);
  if (!state) throw new TypeError('ERR_IMPORT_FILES_INVALID_RECEIPT');
  try {
    current(state);
    issued.delete(prepared);
    native.unlinkSync(state.marker!.path);
  } catch (error) { throw new ImportFilesAttentionError(state.relativeRoot, error); }
}