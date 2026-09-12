import { createHash } from 'node:crypto';
import native, { constants, type BigIntStats } from 'node:fs';
import fs from 'node:fs/promises';
import { win32 } from 'node:path';
import { TextDecoder } from 'node:util';

import { sampleManifestSchema, type SampleManifest } from '../../shared/contracts/sample.js';

export type SampleId = SampleManifest['id'];

/** Main startup data only, never an IPC payload. appPath is app.getAppPath(),
 * i.e. the repository root in development, NOT dist/main or process.cwd().
 * Packaged assets are extraResources beside app.asar, not inside it.
 */
export interface SampleAssetsLocation {
  readonly isPackaged: boolean;
  readonly appPath: string;
  readonly resourcesPath: string;
}

export interface SampleAssetNotice {
  readonly kind: 'license' | 'attribution';
  readonly license: 'MIT' | 'CC-BY-4.0';
  readonly path: string;
  readonly byteSize: number;
  readonly sha256: string;
}

type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;
type AssetsFor<M extends SampleManifest> = {
  readonly id: M['id'];
  readonly taskType: M['taskType'];
  readonly readOnly: true;
  readonly rootPath: string;
  readonly imagesRoot: string;
  readonly manifestPath: string;
  readonly manifest: DeepReadonly<M>;
  readonly notices: readonly SampleAssetNotice[];
};
export type SampleAssets =
  | (AssetsFor<Extract<SampleManifest, { id: 'beans' }>> & { readonly annotationPath?: never })
  | (AssetsFor<Extract<SampleManifest, { id: 'gwhd-2021' }>> & { readonly annotationPath: string });

const errorMessages = {
  SAMPLE_ID: 'サンプルIDが不正です。',
  SAMPLE_LOCATION: 'サンプル素材のMain配置設定が不正です。',
  SAMPLE_ASSET_IO: '同梱サンプル素材を読み取れません。',
  SAMPLE_ASSET_UNSAFE: '同梱サンプル素材のパスまたはファイル同一性を確認できません。',
  SAMPLE_ASSET_INTEGRITY: '同梱サンプル素材が承認済みの構成・内容と一致しません。',
  SAMPLE_ASSET_LIMIT: '同梱サンプル素材の合計が96 MiBの上限を超えています。',
  SAMPLE_ASSET_CHANGED: '検証中に同梱サンプル素材の実体または内容が変更されました。',
} as const;
export type SampleAssetsErrorCode = keyof typeof errorMessages;
export class SampleAssetsError extends Error {
  constructor(readonly code: SampleAssetsErrorCode) {
    super(errorMessages[code]);
    this.name = 'SampleAssetsError';
  }
}
function fail(code: SampleAssetsErrorCode): never { throw new SampleAssetsError(code); }

const ids = ['beans', 'gwhd-2021'] as const satisfies readonly SampleId[];
const inventoryLimit = 96 * 1024 * 1024;
const chunkSize = 64 * 1024;
const fileCount = 87;
// Reviewed raw-byte pins: scripts/samples/verify_samples.py (SP-08), with
// sizes/totals from the approved 2026-09-11 plan §2.1. Never derive trust from
// installed JSON, invoke the developer script, or offer runtime pin overrides.
const approved = {
  beans: {
    byteSize: 17_572,
    sha256: '29f0c7225ed4bcb7e79cfcb135088fd65662ac244654caec78dd2a4a5024c47d',
    totalBytes: 8_281_151,
  },
  'gwhd-2021': {
    byteSize: 10_156,
    sha256: 'b4e5ba7653a4ca8b23e913e0864e39d422b0e9470bf7cc6ef527560f1a91a94b',
    totalBytes: 36_660_961,
  },
} as const;
const directoryNames = [
  '', 'beans', 'beans/images', 'beans/images/angular_leaf_spot',
  'beans/images/bean_rust', 'beans/images/healthy', 'gwhd-2021', 'gwhd-2021/images',
] as const;

interface Metadata { readonly byteSize: number; readonly sha256: string }
interface Stamp {
  readonly dev: bigint;
  readonly ino: bigint;
  readonly birthtimeNs: bigint;
  readonly mode: bigint;
  readonly nlink: bigint;
  readonly size: bigint;
  readonly mtimeNs: bigint;
  readonly ctimeNs: bigint;
}
interface Ancestor { readonly path: string; readonly stamp: Stamp }
interface Tree {
  readonly rootPath: string;
  readonly ancestors: readonly Ancestor[];
  readonly directories: Map<string, Stamp>;
}

function safeName(name: string): boolean {
  return name.length > 0 && name.length <= 255 && name !== '.' && name !== '..' && name.isWellFormed()
    && !/[\u0000-\u001f\u007f<>:"/\\|?*]/u.test(name) && !/[ .]$/u.test(name)
    && !/^(?:con|conin\$|conout\$|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/iu.test(name);
}

function localPath(input: unknown): string {
  // Version 1 is Windows-only. Reject dot segments BEFORE normalization, as
  // normalization could hide a junction in "link/../resources". No UNC/device,
  // drive-relative, URL, ADS or malformed Windows name is a local asset base.
  if (process.platform !== 'win32' || typeof input !== 'string' || input.length > 32_767
    || !/^[a-z]:[\\/]/iu.test(input)) fail('SAMPLE_LOCATION');
  const path = input.replaceAll('/', '\\');
  const parts = path.slice(3).split('\\');
  if (parts.at(-1) === '') parts.pop();
  if (parts.length === 0 || parts.some((part) => !safeName(part))) fail('SAMPLE_LOCATION');
  return win32.normalize(path).replace(/\\$/u, '');
}

function configuredRoot(input: SampleAssetsLocation): string {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)) fail('SAMPLE_LOCATION');
    const keys = ['isPackaged', 'appPath', 'resourcesPath'] as const;
    if (Reflect.ownKeys(input).length !== keys.length) fail('SAMPLE_LOCATION');
    const values = keys.map((key) => {
      const field = Object.getOwnPropertyDescriptor(input, key);
      if (!field || !Object.hasOwn(field, 'value')) fail('SAMPLE_LOCATION');
      return field.value as unknown;
    });
    const [isPackaged, app, resources] = values;
    if (typeof isPackaged !== 'boolean') fail('SAMPLE_LOCATION');
    // Snapshot all required values before the first await; never retain the
    // caller's object, read getters, guess cwd, or fall back to the other base.
    const appPath = localPath(app);
    const resourcesPath = localPath(resources);
    return win32.join(isPackaged ? resourcesPath : win32.join(appPath, 'resources'), 'samples');
  } catch { return fail('SAMPLE_LOCATION'); }
}

function stamp(stat: BigIntStats, directory: boolean): Stamp {
  if (stat.isSymbolicLink() || stat.ino === 0n || stat.size < 0n
    || (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1n)) fail('SAMPLE_ASSET_UNSAFE');
  return Object.freeze({ dev: stat.dev, ino: stat.ino, birthtimeNs: stat.birthtimeNs,
    mode: stat.mode, nlink: stat.nlink, size: stat.size, mtimeNs: stat.mtimeNs, ctimeNs: stat.ctimeNs });
}
function sameIdentity(a: Stamp, b: Stamp): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.birthtimeNs === b.birthtimeNs && a.mode === b.mode;
}
function sameContent(a: Stamp, b: Stamp): boolean {
  return sameIdentity(a, b) && a.nlink === b.nlink && a.size === b.size && a.mtimeNs === b.mtimeNs;
}
function sameStamp(a: Stamp, b: Stamp): boolean { return sameContent(a, b) && a.ctimeNs === b.ctimeNs; }
function requireSame(expected: Stamp, actual: Stamp): void {
  if (!sameStamp(expected, actual)) fail('SAMPLE_ASSET_CHANGED');
}
function pathKey(path: string): string { return path.replace(/[A-Z]/g, (letter) => letter.toLowerCase()); }
function at(tree: Tree, relative: string): string { return win32.join(tree.rootPath, ...relative.split('/')); }

async function captureAncestors(path: string): Promise<Ancestor[]> {
  let cursor = win32.parse(path).root;
  const result: Ancestor[] = [];
  for (const part of ['', ...path.slice(cursor.length).split('\\')]) {
    if (part) cursor = win32.join(cursor, part);
    result.push({ path: cursor, stamp: stamp(await fs.lstat(cursor, { bigint: true }), true) });
  }
  return result;
}
async function checkAncestors(ancestors: readonly Ancestor[]): Promise<void> {
  for (const entry of ancestors) {
    const current = stamp(await fs.lstat(entry.path, { bigint: true }), true);
    // Unrelated siblings outside samples may change: pin ancestor identity,
    // not the directory mtime of e.g. the system temporary directory.
    if (!sameIdentity(entry.stamp, current)) fail('SAMPLE_ASSET_CHANGED');
  }
}
function parentNames(relative: string): string[] {
  const parents = [''];
  let prefix = '';
  for (const part of relative.split('/').slice(0, -1)) {
    prefix = prefix ? `${prefix}/${part}` : part;
    parents.push(prefix);
  }
  return parents;
}
async function checkParents(tree: Tree, relative: string): Promise<void> {
  await checkAncestors(tree.ancestors);
  for (const parent of parentNames(relative)) {
    const expected = tree.directories.get(parent);
    if (!expected) fail('SAMPLE_ASSET_INTEGRITY');
    if (!sameIdentity(expected, stamp(await fs.lstat(at(tree, parent), { bigint: true }), true))) fail('SAMPLE_ASSET_CHANGED');
  }
}

async function captureTree(root: string): Promise<Tree> {
  const original = await captureAncestors(root);
  const canonical = localPath(await fs.realpath(root));
  // Allow spelling/case/separator differences, not a short-name or relocated
  // root silently adopted by realpath. Check actual IDs as well as spelling.
  if (pathKey(root) !== pathKey(canonical)) fail('SAMPLE_ASSET_UNSAFE');
  const resolved = canonical === root ? original : await captureAncestors(canonical);
  if (!sameIdentity(original.at(-1)!.stamp, resolved.at(-1)!.stamp)) fail('SAMPLE_ASSET_CHANGED');
  const tree: Tree = { rootPath: canonical, ancestors: canonical === root ? original : [...original, ...resolved],
    directories: new Map([['', resolved.at(-1)!.stamp]]) };
  await checkAncestors(tree.ancestors);
  // These eight directories are fixed independently of filesystem contents.
  for (const relative of directoryNames.slice(1)) {
    await checkParents(tree, relative);
    tree.directories.set(relative, stamp(await fs.lstat(at(tree, relative), { bigint: true }), true));
  }
  return tree;
}

function expectedListings(files: ReadonlyMap<string, Metadata>): Map<string, Set<string>> {
  const listings = new Map<string, Set<string>>(directoryNames.map((name) => [name, new Set<string>()]));
  for (const relative of [...directoryNames.slice(1), ...files.keys()]) {
    const parts = relative.split('/');
    if (parts.some((part) => !safeName(part))) fail('SAMPLE_ASSET_UNSAFE');
    const name = parts.pop()!;
    const children = listings.get(parts.join('/'));
    if (!children || children.has(name)) fail('SAMPLE_ASSET_INTEGRITY');
    children.add(name);
  }
  return listings;
}
function acceptName(name: string, expected: ReadonlySet<string>, found: Set<string>): void {
  if (!safeName(name) || found.size >= expected.size || !expected.has(name) || found.has(name)) fail('SAMPLE_ASSET_INTEGRITY');
  found.add(name);
}
async function checkListing(path: string, expected: ReadonlySet<string>): Promise<void> {
  const found = new Set<string>();
  // readdir would allocate an unbounded array before checking its length.
  // Read at most the expected children plus one, never descend into extras.
  const directory = await fs.opendir(path, { bufferSize: 1 });
  try {
    for (;;) {
      const entry = await directory.read();
      if (entry === null) break;
      acceptName(entry.name, expected, found);
    }
    if (found.size !== expected.size) fail('SAMPLE_ASSET_INTEGRITY');
  } finally { await directory.close(); }
}

async function scanTree(tree: Tree, expected: ReadonlyMap<string, Metadata>, listings: ReadonlyMap<string, ReadonlySet<string>>): Promise<Map<string, Stamp>> {
  const files = new Map<string, Stamp>();
  let total = 0n;
  for (const relative of directoryNames) {
    await checkParents(tree, relative);
    if (!sameIdentity(tree.directories.get(relative)!, stamp(await fs.lstat(at(tree, relative), { bigint: true }), true))) fail('SAMPLE_ASSET_CHANGED');
    const children = listings.get(relative)!;
    await checkListing(at(tree, relative), children);
    for (const name of children) {
      const child = relative ? `${relative}/${name}` : name;
      if (!expected.has(child)) continue; // A known directory, checked in its own iteration.
      await checkParents(tree, child);
      const current = stamp(await fs.lstat(at(tree, child), { bigint: true }), false);
      total += current.size;
      if (total > BigInt(inventoryLimit)) fail('SAMPLE_ASSET_LIMIT');
      files.set(child, current);
    }
  }
  if (files.size !== fileCount || files.size !== expected.size) fail('SAMPLE_ASSET_INTEGRITY');
  // Check the actual BOTH-root budget before rejecting individual mismatches.
  for (const [relative, current] of files) {
    if (current.size !== BigInt(expected.get(relative)!.byteSize)) fail('SAMPLE_ASSET_INTEGRITY');
  }
  return files;
}

async function readPinned(tree: Tree, relative: string, expected: Metadata, budget: { bytes: number },
  capture: boolean, scanned?: Stamp): Promise<{ stamp: Stamp; raw: Buffer }> {
  await checkParents(tree, relative);
  const path = at(tree, relative);
  const before = stamp(await fs.lstat(path, { bigint: true }), false);
  // A pre-open ctime-only difference is ambiguous. Keep the inventory or
  // earlier hash's identity/size/mtime fixed and authenticate ALL bytes against
  // the independent pin. Each API's after-open checks remain exact.
  if (scanned && !sameContent(scanned, before)) fail('SAMPLE_ASSET_CHANGED');
  if (before.size !== BigInt(expected.byteSize) || expected.byteSize <= 0) fail('SAMPLE_ASSET_INTEGRITY');
  const handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = stamp(await handle.stat({ bigint: true }), false);
    const pathOpened = stamp(await fs.lstat(path, { bigint: true }), false);
    // Path/descriptor ctime observations can differ, including across opening.
    // Keep identity/content fixed, then compare each API to its OWN after-open
    // snapshot. The final guard never adopts a new stamp without pinned bytes.
    if (!sameContent(before, opened) || !sameContent(opened, pathOpened)) fail('SAMPLE_ASSET_CHANGED');
    await checkParents(tree, relative);
    const hash = createHash('sha256');
    const chunks: Buffer[] = [];
    const buffer = Buffer.allocUnsafe(chunkSize);
    let size = 0;
    // Read the approved bytes, then probe the inclusive end for one overrun byte.
    for (;;) {
      const length = Math.min(chunkSize, Math.max(1, expected.byteSize - size));
      const { bytesRead } = await handle.read(buffer, 0, length, size);
      if (!Number.isInteger(bytesRead) || bytesRead < 0 || bytesRead > length) fail('SAMPLE_ASSET_IO');
      if (bytesRead === 0) break;
      size += bytesRead;
      budget.bytes += bytesRead;
      if (budget.bytes > inventoryLimit) fail('SAMPLE_ASSET_LIMIT');
      if (size > expected.byteSize) fail('SAMPLE_ASSET_INTEGRITY');
      const chunk = buffer.subarray(0, bytesRead);
      hash.update(chunk);
      if (capture) chunks.push(Buffer.from(chunk));
    }
    requireSame(opened, stamp(await handle.stat({ bigint: true }), false));
    await checkParents(tree, relative);
    requireSame(pathOpened, stamp(await fs.lstat(path, { bigint: true }), false));
    if (size !== expected.byteSize || hash.digest('hex') !== expected.sha256) fail('SAMPLE_ASSET_INTEGRITY');
    return { stamp: pathOpened, raw: capture ? Buffer.concat(chunks, size) : Buffer.alloc(0) };
  } finally { await handle.close(); }
}

function finalSnapshot(tree: Tree, listings: ReadonlyMap<string, ReadonlySet<string>>, files: ReadonlyMap<string, Stamp>): readonly string[] {
  // No awaits or payload reads here: bounded metadata/listings only, after ALL
  // asynchronous hashes and closes. Reject file geometry changes; collect only
  // ctime differences for byte confirmation, without adopting any new stamp.
  // This is not an OS-atomic/hostile-user filesystem lock.
  for (const entry of tree.ancestors) {
    if (!sameIdentity(entry.stamp, stamp(native.lstatSync(entry.path, { bigint: true }), true))) fail('SAMPLE_ASSET_CHANGED');
  }
  for (const relative of directoryNames) {
    const path = at(tree, relative);
    // Directory timestamps/size are not content evidence. Pin the real object
    // and compare EVERY expected child; file metadata and hashes remain strict.
    if (!sameIdentity(tree.directories.get(relative)!, stamp(native.lstatSync(path, { bigint: true }), true))) fail('SAMPLE_ASSET_CHANGED');
    const expected = listings.get(relative)!;
    const found = new Set<string>();
    const directory = native.opendirSync(path, { bufferSize: 1 });
    try {
      for (;;) {
        const entry = directory.readSync();
        if (entry === null) break;
        acceptName(entry.name, expected, found);
      }
      if (found.size !== expected.size) fail('SAMPLE_ASSET_INTEGRITY');
    } finally { directory.closeSync(); }
  }
  const ctimeChanged: string[] = [];
  for (const [relative, expected] of files) {
    const current = stamp(native.lstatSync(at(tree, relative), { bigint: true }), false);
    if (!sameContent(expected, current)) fail('SAMPLE_ASSET_CHANGED');
    if (expected.ctimeNs !== current.ctimeNs) ctimeChanged.push(relative);
  }
  return Object.freeze(ctimeChanged);
}

function freezeDeep<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

/** SP-09 / APP-01. Revalidate all 87 installed files on EVERY call, even when
 * returning just one sample. No cache, writes, downloads, decoding, Python,
 * Project/DB work or user-consent bypass. Source URLs in the
 * pinned manifest are passive provenance, never filesystem/network inputs.
 *
 * Main must supply its own location, keep installed assets quiescent and call
 * again at use time. Returned paths/freeze are not a permanent I/O capability
 * or protection against subsequent external OS changes (SP-10 owns use).
 */
export async function getSampleAssets(id: unknown, location: SampleAssetsLocation): Promise<SampleAssets> {
  if (id !== 'beans' && id !== 'gwhd-2021') fail('SAMPLE_ID');
  const root = configuredRoot(location);
  try {
    const tree = await captureTree(root);
    const budget = { bytes: 0 };
    const expected = new Map<string, Metadata>();
    const hashed = new Map<string, Stamp>();
    const manifests = new Map<SampleId, SampleManifest>();
    let declared = 0;
    for (const sampleId of ids) {
      const relative = `${sampleId}/manifest.json`;
      const pin = approved[sampleId];
      const read = await readPinned(tree, relative, pin, budget, true);
      // Exact raw SHA-256 MUST precede JSON.parse/schema parsing. Duplicate
      // members, BOM/encoding/whitespace changes and rehashed replacement
      // notices cannot silently inherit approval from parsed JSON equivalence.
      let manifest: SampleManifest;
      try { manifest = sampleManifestSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(read.raw))); }
      catch { return fail('SAMPLE_ASSET_INTEGRITY'); }
      if (manifest.id !== sampleId) fail('SAMPLE_ASSET_INTEGRITY');
      manifests.set(sampleId, manifest);
      expected.set(relative, pin);
      hashed.set(relative, read.stamp);
      let total: number = pin.byteSize;
      for (const entry of [...manifest.images, ...manifest.files]) {
        const name = `${sampleId}/${entry.path}`;
        if (expected.has(name)) fail('SAMPLE_ASSET_INTEGRITY');
        expected.set(name, { byteSize: entry.byteSize, sha256: entry.sha256 });
        total += entry.byteSize;
      }
      declared += total;
      if (declared > inventoryLimit) fail('SAMPLE_ASSET_LIMIT');
      if (total !== pin.totalBytes) fail('SAMPLE_ASSET_INTEGRITY');
    }
    if (expected.size !== fileCount) fail('SAMPLE_ASSET_INTEGRITY');
    const listings = expectedListings(expected);
    const scanned = await scanTree(tree, expected, listings);
    for (const [relative, metadata] of expected) {
      const previous = hashed.get(relative);
      if (previous) requireSame(previous, scanned.get(relative)!);
      else hashed.set(relative, (await readPinned(tree, relative, metadata, budget, false, scanned.get(relative)!)).stamp);
    }
    if (budget.bytes !== declared || hashed.size !== fileCount) fail('SAMPLE_ASSET_INTEGRITY');
    const ctimeChanged = finalSnapshot(tree, listings, hashed);
    // ctime alone is not proof of changed bytes. Before returning, confirm only
    // these files once against the ORIGINAL pins and identity/content stamps.
    // All bytes share the same budget; only a byte-confirmed ctime is adopted.
    for (const relative of ctimeChanged) {
      const previous = hashed.get(relative)!;
      const confirmed = await readPinned(tree, relative, expected.get(relative)!, budget, false, previous);
      hashed.set(relative, Object.freeze({ ...previous, ctimeNs: confirmed.stamp.ctimeNs }));
    }
    // After the last await, recheck every guard. No third pass or retry after an
    // error; another ctime difference fails closed, not an OS-atomicity claim.
    if (ctimeChanged.length > 0 && finalSnapshot(tree, listings, hashed).length > 0) fail('SAMPLE_ASSET_CHANGED');
    const manifest = manifests.get(id)!;
    const rootPath = at(tree, id);
    const notices: SampleAssetNotice[] = (['LICENSE.txt', 'ATTRIBUTION.txt'] as const).map((name) => {
      const metadata = expected.get(`${id}/${name}`)!;
      return { kind: name === 'LICENSE.txt' ? 'license' : 'attribution', license: manifest.licenses.images,
        path: win32.join(rootPath, name), byteSize: metadata.byteSize, sha256: metadata.sha256 };
    });
    const common = { rootPath, imagesRoot: win32.join(rootPath, 'images'), manifestPath: win32.join(rootPath, 'manifest.json'),
      readOnly: true as const, notices };
    if (manifest.id === 'beans') return freezeDeep({ ...common, id: manifest.id, taskType: manifest.taskType, manifest });
    return freezeDeep({ ...common, id: manifest.id, taskType: manifest.taskType, manifest,
      annotationPath: win32.join(rootPath, 'annotations.coco.json') });
  } catch (error) {
    if (error instanceof SampleAssetsError) throw error;
    // No native exception text, OS paths, raw JSON, URLs, causes or logs escape.
    return fail('SAMPLE_ASSET_IO');
  }
}