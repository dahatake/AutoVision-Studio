import { createHash, randomUUID } from 'node:crypto';
import native, { type BigIntStats } from 'node:fs';
import fs from 'node:fs/promises';
import { win32 } from 'node:path';

import { projectIdSchema, type Project } from '../../shared/contracts/project.js';
import type { DatabaseConnection } from '../db/database.js';
import { cleanupNewProjectDirectory, createProjectDirectory, verifyProjectDirectory, type ProjectDirectoryReceipt, type ProjectFileIdentity } from './project-directory.js';
import {
  abortProjectMoveReceipt, assertProjectMoveReceiptCanPrepare, assertProjectMoveReceiptCurrent,
  assertProjectMoveSnapshotWritable, consolidateProjectMoveReceipt, createProjectMoveReceipt, finishProjectMoveReceipt,
  getProjectMoveRemovalOrder, readProjectMoveReceipt, updateProjectMoveReceipt,
  updateProjectMoveProgress,
  type MoveReceipt, type ProjectMoveRemoval, type StoredMoveReceipt,
} from './project-move-receipt.js';
import { assertProjectNotImporting, beginProjectMoveActivity } from './project-operation-lock.js';
import { findProject, listProjects, replaceProject } from './project-repository.js';

export interface ProjectMoveSnapshot {
  readonly identity: ProjectFileIdentity;
  readonly sizeBytes: bigint;
  readonly mtimeNs: bigint;
  readonly ctimeNs: bigint;
  readonly nlink: bigint;
}

export interface ProjectMoveDirectory {
  /** Canonical root-relative '/' separators; '' denotes the owned root. */
  readonly relativePath: string;
  readonly pathSnapshot: ProjectMoveSnapshot;
}

export interface ProjectMoveFile extends ProjectMoveDirectory {
  readonly sizeBytes: bigint;
  readonly sha256: string;
  /** fstat and lstat ctime are deliberately kept in separate snapshots. */
  readonly handleSnapshot: ProjectMoveSnapshot;
}

export interface ProjectMoveInventory {
  readonly source: ProjectDirectoryReceipt;
  /** Caller-known original/sample/other-Project roots, never inferred from JSON. */
  readonly protectedRoots: readonly string[];
  readonly directories: readonly ProjectMoveDirectory[];
  readonly files: readonly ProjectMoveFile[];
  readonly totalBytes: bigint;
}

export interface ProjectMoveCapacity {
  readonly destinationBytes: bigint;
  readonly temporaryBytes: bigint;
  readonly generatedBytes: bigint;
  readonly safetyBytes: bigint;
  readonly requiredBytes: bigint;
  readonly availableBytes: bigint;
  readonly sufficient: boolean;
}

export interface ProjectMovePreflight {
  readonly destinationParent: string;
  readonly destinationRoot: string;
  readonly parentIdentity: ProjectFileIdentity;
  readonly capacity: ProjectMoveCapacity;
}

/** Main's retained picker data, never a Renderer-supplied selection authority. */
export interface ProjectMoveSelectedParent {
  readonly canonicalPath: string;
  readonly chain: readonly {
    readonly path: string;
    readonly identity: ProjectFileIdentity;
  }[];
}

function snapshot(stat: BigIntStats): ProjectMoveSnapshot {
  if (stat.ino === 0n || stat.size < 0n) throw new Error('Projectのファイル同一性またはサイズを確認できません。');
  const value = Object.freeze({
    identity: Object.freeze({ dev: String(stat.dev), ino: String(stat.ino), birthtimeNs: String(stat.birthtimeNs) }),
    sizeBytes: stat.size, mtimeNs: stat.mtimeNs, ctimeNs: stat.ctimeNs, nlink: stat.nlink,
  });
  assertProjectMoveSnapshotWritable(value);
  return value;
}

function sameIdentity(a: ProjectFileIdentity, b: ProjectFileIdentity): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.birthtimeNs === b.birthtimeNs;
}

function sameContentStat(a: ProjectMoveSnapshot, b: ProjectMoveSnapshot): boolean {
  return sameIdentity(a.identity, b.identity) && a.sizeBytes === b.sizeBytes && a.mtimeNs === b.mtimeNs && a.nlink === b.nlink;
}

function sameSnapshot(a: ProjectMoveSnapshot, b: ProjectMoveSnapshot): boolean {
  return sameContentStat(a, b) && a.ctimeNs === b.ctimeNs;
}

function changed(): never { throw new Error('Projectの実体または内容が変更されました。'); }

function ordinary(stat: BigIntStats, directory: boolean): void {
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1n)) {
    throw new Error('Project移動ではリンク・非通常ファイル・hardlinkを使用できません。');
  }
}

function safeName(name: string): void {
  if (!name || name === '.' || name === '..' || !name.isWellFormed()
    || /[\u0000-\u001f\u007f<>:"/\\|?*]/.test(name) || /[ .]$/.test(name)
    || /^(?:con|conin\$|conout\$|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name)) {
    throw new Error('Project移動に安全でないWindowsパスがあります。');
  }
}

function absolutePath(input: string): string {
  if (process.platform !== 'win32' || typeof input !== 'string'
    || !/^(?:[a-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+[\\/])/i.test(input)
    || input.startsWith('\\\\?\\') || input.startsWith('\\\\.\\')) {
    throw new Error('通常のWindows絶対フォルダーパスが必要です。');
  }
  const path = input.replaceAll('/', '\\');
  const parts = /^[a-z]:/i.test(path) ? path.split('\\').slice(1) : path.split('\\').slice(2);
  for (const part of parts) if (part !== '') safeName(part);
  return win32.normalize(path);
}

interface DirectoryIdentity { readonly path: string; readonly identity: ProjectFileIdentity }

async function checkChain(chain: readonly DirectoryIdentity[]): Promise<void> {
  for (const entry of chain) {
    const stat = await fs.lstat(entry.path, { bigint: true });
    ordinary(stat, true);
    if (!sameIdentity(entry.identity, snapshot(stat).identity)) changed();
  }
}

function checkChainSync(chain: readonly DirectoryIdentity[]): void {
  for (const entry of chain) {
    const stat = native.lstatSync(entry.path, { bigint: true });
    ordinary(stat, true);
    if (!sameIdentity(entry.identity, snapshot(stat).identity)) changed();
  }
}

function invalidSelectedParent(): never { throw new TypeError('Project移動の選択親snapshotが不正です。'); }

function selectedParentFields(input: unknown, keys: readonly string[]): unknown[] {
  if (typeof input !== 'object' || input === null || Array.isArray(input)
    || (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)) invalidSelectedParent();
  return keys.map((key) => {
    const field = Object.getOwnPropertyDescriptor(input, key);
    if (!field || !Object.hasOwn(field, 'value')) invalidSelectedParent();
    return field.value as unknown;
  });
}

function selectedParentPath(input: unknown): string {
  if (typeof input !== 'string' || input.length > 32_767 || !input.isWellFormed()) invalidSelectedParent();
  try {
    // Entries are H's already-expanded walk, not raw '..' components that could
    // hide an ancestor. Keep case/short-name spellings; never realpath here.
    const path = absolutePath(input);
    if (path.split('\\').some((part) => part.length > 255)) invalidSelectedParent();
    return win32.resolve(path);
  } catch { return invalidSelectedParent(); }
}

function selectedParentPaths(path: string): string[] {
  let cursor = win32.parse(path).root;
  const paths = [cursor];
  for (const part of path.slice(cursor.length).split('\\').filter(Boolean)) {
    cursor = win32.join(cursor, part);
    paths.push(cursor);
  }
  return paths;
}

/** Data-only validation and independent deep clone/freeze, before either entry's
 * first await or I/O. Undefined alone is the trusted nonpicker case. Additional
 * Main fields (notably H's selectedPath) are neither read nor retained.
 */
export function snapshotProjectMoveParent(input: unknown, destinationParent: string): ProjectMoveSelectedParent | undefined {
  if (input === undefined) return undefined;
  const [canonical, entries] = selectedParentFields(input, ['canonicalPath', 'chain']);
  const canonicalPath = selectedParentPath(canonical);
  if (canonicalPath === win32.parse(canonicalPath).root
    || canonicalPath.toUpperCase() !== selectedParentPath(destinationParent).toUpperCase()
    || !Array.isArray(entries) || Object.getPrototypeOf(entries) !== Array.prototype || entries.length === 0) invalidSelectedParent();
  const chain: DirectoryIdentity[] = [];
  const identities = new Map<string, ProjectFileIdentity>();
  for (let index = 0; index < entries.length; index += 1) {
    const entry = Object.getOwnPropertyDescriptor(entries, String(index));
    if (!entry || !Object.hasOwn(entry, 'value')) invalidSelectedParent();
    const [pathInput, identityInput] = selectedParentFields(entry.value, ['path', 'identity']);
    const path = selectedParentPath(pathInput);
    const [dev, ino, birthtimeNs] = selectedParentFields(identityInput, ['dev', 'ino', 'birthtimeNs']);
    if (typeof dev !== 'string' || !/^(?:0|[1-9][0-9]*)(?![\s\S])/u.test(dev)
      || typeof ino !== 'string' || !/^[1-9][0-9]*(?![\s\S])/u.test(ino)
      || typeof birthtimeNs !== 'string' || !/^(?:0|-?[1-9][0-9]*)(?![\s\S])/u.test(birthtimeNs)) invalidSelectedParent();
    const identity = Object.freeze({ dev, ino, birthtimeNs });
    const previous = identities.get(path);
    if (previous && !sameIdentity(previous, identity)) invalidSelectedParent();
    identities.set(path, identity);
    chain.push(Object.freeze({ path, identity }));
  }
  const canonicalPaths = selectedParentPaths(canonicalPath);
  const originalLength = chain.length - canonicalPaths.length;
  if (originalLength < 0 || canonicalPaths.some((path, index) => chain[originalLength + index]!.path !== path)) invalidSelectedParent();
  // One complete chain can represent both spellings when they are identical.
  // H instead concatenates original + canonical, including their repeated root.
  if (originalLength > 0) {
    const original = chain.slice(0, originalLength);
    if (original.length < 2 || original[0]!.path !== win32.parse(original[0]!.path).root
      || original.at(-1)!.path === win32.parse(original.at(-1)!.path).root
      || !sameIdentity(original.at(-1)!.identity, chain.at(-1)!.identity)) invalidSelectedParent();
    for (let index = 1; index < original.length; index += 1) {
      const previous = original[index - 1]!.path;
      const path = original[index]!.path;
      // An original '..' step goes back exactly one parent, including at root.
      if (win32.dirname(previous) !== path && (path === previous || win32.dirname(path) !== previous)) invalidSelectedParent();
    }
  }
  return Object.freeze({ canonicalPath, chain: Object.freeze(chain) });
}

function checkSelectedParentSync(parent: ProjectMoveSelectedParent | undefined, destinationParent: string): void {
  if (parent === undefined) return;
  checkChainSync(parent.chain);
  const originalLength = parent.chain.length - selectedParentPaths(parent.canonicalPath).length;
  const original = parent.chain[originalLength === 0 ? parent.chain.length - 1 : originalLength - 1]!;
  const identity = parent.chain.at(-1)!.identity;
  for (const path of [original.path, parent.canonicalPath, destinationParent]) {
    // Folded path equality alone is insufficient for case-sensitive Windows
    // directories. Check the actual directory entry against the selected ID too.
    if (selectedParentPath(native.realpathSync.native(path)).toUpperCase() !== parent.canonicalPath.toUpperCase()) changed();
    const stat = native.lstatSync(path, { bigint: true });
    ordinary(stat, true);
    if (!sameIdentity(identity, snapshot(stat).identity)) changed();
  }
}

async function inspectDirectory(input: string) {
  const path = absolutePath(input);
  let cursor = win32.parse(path).root;
  const chain: DirectoryIdentity[] = [];
  for (const part of ['', ...path.slice(cursor.length).split('\\').filter(Boolean)]) {
    if (part) cursor = win32.join(cursor, part);
    const stat = await fs.lstat(cursor, { bigint: true });
    ordinary(stat, true);
    chain.push({ path: cursor, identity: snapshot(stat).identity });
  }
  const rootPath = absolutePath(await fs.realpath(path));
  const stat = await fs.lstat(rootPath, { bigint: true });
  ordinary(stat, true);
  await checkChain(chain);
  if (!sameIdentity(chain[chain.length - 1]!.identity, snapshot(stat).identity)) changed();
  return { rootPath, chain, stat };
}

function contains(parent: string, child: string): boolean {
  const relative = win32.relative(parent.toUpperCase(), child.toUpperCase());
  return relative === '' || (relative !== '..' && !relative.startsWith('..\\') && !win32.isAbsolute(relative));
}

async function disjoint(root: string, protectedRoots: readonly string[]): Promise<readonly string[]> {
  const own = await inspectDirectory(root);
  const canonical: string[] = [];
  for (const protectedRoot of protectedRoots) {
    const other = await inspectDirectory(protectedRoot);
    if (contains(own.rootPath, other.rootPath) || contains(other.rootPath, own.rootPath)
      || own.chain.some((entry) => sameIdentity(entry.identity, snapshot(other.stat).identity))
      || other.chain.some((entry) => sameIdentity(entry.identity, snapshot(own.stat).identity))) {
      throw new Error('Projectの保存領域が保護された原本または他Projectと重複しています。');
    }
    canonical.push(other.rootPath);
  }
  return Object.freeze(canonical);
}

function verified(source: ProjectDirectoryReceipt): ProjectDirectoryReceipt {
  // A's bounded marker check is synchronous; payload hashing remains asynchronous.
  const current = verifyProjectDirectory(source.rootPath, source.projectId);
  if (current.projectId !== source.projectId || !sameIdentity(current.rootIdentity, source.rootIdentity)
    || !sameIdentity(current.markerIdentity, source.markerIdentity)) changed();
  return current;
}

async function namesAt(path: string): Promise<string[]> {
  const names = (await fs.readdir(path)).sort();
  const folded = new Set<string>();
  for (const name of names) {
    safeName(name);
    const key = name.toUpperCase();
    if (folded.has(key)) throw new Error('Project内のWindowsパスが大文字小文字違いで重複しています。');
    folded.add(key);
  }
  return names;
}

async function hashFile(path: string, relativePath: string, before: BigIntStats, chain: readonly DirectoryIdentity[]): Promise<ProjectMoveFile> {
  ordinary(before, false);
  await checkChain(chain);
  const handle = await fs.open(path, 'r');
  try {
    const opened = await handle.stat({ bigint: true });
    ordinary(opened, false);
    const handleSnapshot = snapshot(opened);
    if (!sameContentStat(snapshot(before), handleSnapshot)) changed();
    // Windows can settle a new marker's path ctime on open. Never compare lstat ctime to fstat ctime.
    const openedPath = await fs.lstat(path, { bigint: true });
    ordinary(openedPath, false);
    const pathSnapshot = snapshot(openedPath);
    if (!sameContentStat(handleSnapshot, pathSnapshot)) changed();
    await checkChain(chain);
    const hash = createHash('sha256');
    let sizeBytes = 0n;
    for await (const chunk of handle.createReadStream({ autoClose: false, highWaterMark: 64 * 1024 })) {
      if (!Buffer.isBuffer(chunk)) throw new Error('Project読取りがバイナリではありません。');
      sizeBytes += BigInt(chunk.length);
      if (sizeBytes > handleSnapshot.sizeBytes) changed();
      hash.update(chunk);
    }
    const after = await handle.stat({ bigint: true });
    const pathAfter = await fs.lstat(path, { bigint: true });
    ordinary(after, false);
    ordinary(pathAfter, false);
    if (sizeBytes !== handleSnapshot.sizeBytes || !sameSnapshot(handleSnapshot, snapshot(after))
      || !sameSnapshot(pathSnapshot, snapshot(pathAfter))) changed();
    await checkChain(chain);
    return Object.freeze({ relativePath, sizeBytes, sha256: hash.digest('hex'), pathSnapshot, handleSnapshot });
  } finally {
    await handle.close();
  }
}

/**
 * CORE-06C only: read an A-verified, caller-known owned root, including its marker.
 * protectedRoots must contain all known original/sample/other-Project roots (not this source).
 * JSON is opaque bytes: Reference paths are neither parsed nor opened.
 * This is not an OS-atomic snapshot or deletion authority. D must hold the Project lock,
 * revalidate immediately before commit, and use createProjectDirectory with ALL known roots.
 */
export async function inventoryProjectMove(source: ProjectDirectoryReceipt, protectedRoots: readonly string[]): Promise<ProjectMoveInventory> {
  const receipt = verified(source);
  const protectedPaths = await disjoint(receipt.rootPath, [...protectedRoots]);
  const root = await inspectDirectory(receipt.rootPath);
  if (!sameIdentity(snapshot(root.stat).identity, receipt.rootIdentity)) changed();
  const directories: ProjectMoveDirectory[] = [];
  const files: ProjectMoveFile[] = [];
  const listings = new Map<string, readonly string[]>();
  const walk = async (path: string, relativePath: string, chain: readonly DirectoryIdentity[]): Promise<void> => {
    await checkChain(chain);
    const before = await fs.lstat(path, { bigint: true });
    ordinary(before, true);
    const pathSnapshot = snapshot(before);
    const children = await namesAt(path);
    directories.push(Object.freeze({ relativePath, pathSnapshot }));
    listings.set(relativePath, children);
    const descendants = [...chain, { path, identity: pathSnapshot.identity }];
    for (const name of children) {
      await checkChain(descendants);
      const child = win32.join(path, name);
      const relative = relativePath ? `${relativePath}/${name}` : name;
      const stat = await fs.lstat(child, { bigint: true });
      if (stat.isSymbolicLink()) ordinary(stat, false);
      if (stat.isDirectory()) await walk(child, relative, descendants);
      else files.push(await hashFile(child, relative, stat, descendants));
    }
  };
  await walk(receipt.rootPath, '', root.chain);
  // Recheck earlier files too: mutations while hashing later files must fail closed.
  for (const entry of [...directories, ...files]) {
    const path = win32.join(receipt.rootPath, entry.relativePath);
    await checkChain(root.chain);
    // Inspect every ancestor again, before reading any descendant path.
    const parent = await inspectDirectory(win32.dirname(path));
    await checkChain(parent.chain);
    const stat = await fs.lstat(path, { bigint: true });
    ordinary(stat, listings.has(entry.relativePath));
    if (!sameSnapshot(entry.pathSnapshot, snapshot(stat))) changed();
    const expectedNames = listings.get(entry.relativePath);
    if (expectedNames) {
      const actual = await namesAt(path);
      if (actual.length !== expectedNames.length || actual.some((name, index) => name !== expectedNames[index])) changed();
    }
  }
  verified(receipt);
  await disjoint(receipt.rootPath, protectedPaths);
  return Object.freeze({ source: receipt, protectedRoots: protectedPaths,
    directories: Object.freeze(directories), files: Object.freeze(files),
    totalBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0n) });
}

/** Read-only full rescan; also catches same-length content changes with restored mtime. */
export async function revalidateProjectMoveInventory(previous: ProjectMoveInventory): Promise<void> {
  const current = await inventoryProjectMove(previous.source, previous.protectedRoots);
  if (current.totalBytes !== previous.totalBytes || current.files.length !== previous.files.length
    || current.directories.length !== previous.directories.length) changed();
  for (let i = 0; i < previous.directories.length; i += 1) {
    const a = previous.directories[i]!;
    const b = current.directories[i]!;
    if (a.relativePath !== b.relativePath || !sameSnapshot(a.pathSnapshot, b.pathSnapshot)) changed();
  }
  for (let i = 0; i < previous.files.length; i += 1) {
    const a = previous.files[i]!;
    const b = current.files[i]!;
    if (a.relativePath !== b.relativePath || a.sha256 !== b.sha256 || a.sizeBytes !== b.sizeBytes
      || !sameSnapshot(a.pathSnapshot, b.pathSnapshot) || !sameSnapshot(a.handleSnapshot, b.handleSnapshot)) changed();
  }
}

/** NFR-STO-001: reserve one destination tree PLUS one full temporary tree; no new derived data.
 * Existing source space is already occupied, not added to destination free-space demand.
 * ceil((destination + temporary + generated) / 5) is the fixed 20% margin.
 */
export function calculateProjectMoveCapacity(totalBytes: bigint, bavail: bigint, bsize: bigint): ProjectMoveCapacity {
  if ([totalBytes, bavail, bsize].some((value) => typeof value !== 'bigint' || value < 0n) || bsize === 0n) {
    throw new Error('移動容量を正確に取得できません。');
  }
  const destinationBytes = totalBytes;
  const temporaryBytes = totalBytes;
  const generatedBytes = 0n;
  const base = destinationBytes + temporaryBytes + generatedBytes;
  const safetyBytes = (base + 4n) / 5n;
  const requiredBytes = base + safetyBytes;
  const availableBytes = bavail * bsize;
  return Object.freeze({ destinationBytes, temporaryBytes, generatedBytes, safetyBytes, requiredBytes, availableBytes,
    sufficient: availableBytes >= requiredBytes });
}

/** Capacity is advisory, not a reservation. D must exclusively create the UUID child with A. */
export async function preflightProjectMove(inventory: ProjectMoveInventory, destinationParent: string): Promise<ProjectMovePreflight> {
  await revalidateProjectMoveInventory(inventory);
  const parent = await inspectDirectory(destinationParent);
  const destinationRoot = win32.join(parent.rootPath, inventory.source.projectId);
  for (const root of [inventory.source.rootPath, ...inventory.protectedRoots]) {
    const protectedRoot = await inspectDirectory(root);
    if (contains(protectedRoot.rootPath, destinationRoot) || contains(destinationRoot, protectedRoot.rootPath)
      || parent.chain.some((entry) => sameIdentity(entry.identity, snapshot(protectedRoot.stat).identity))) {
      throw new Error('移動先が元Projectまたは保護された領域と重複しています。');
    }
  }
  try {
    await fs.lstat(destinationRoot, { bigint: true });
    throw new Error('移動先のUUIDフォルダーは既に存在します。');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const disk = await fs.statfs(parent.rootPath, { bigint: true });
  const capacity = calculateProjectMoveCapacity(inventory.totalBytes, disk.bavail, disk.bsize);
  await checkChain(parent.chain);
  if (!capacity.sufficient) throw new Error('Project移動に必要な空き容量が不足しています。');
  assertProjectMoveReceiptCanPrepare(inventory, destinationRoot);
  return Object.freeze({ destinationParent: parent.rootPath, destinationRoot,
    parentIdentity: snapshot(parent.stat).identity, capacity });
}

export interface ProjectMoveResult {
  readonly project: Project;
  readonly sourceInventory: ProjectMoveInventory;
  readonly targetReceipt: ProjectDirectoryReceipt;
  readonly targetInventory: ProjectMoveInventory;
  readonly storedReceipt: StoredMoveReceipt;
  /** E2 must revalidate the retained receipt and both trees before source reclamation. */
  readonly sourceRetained: true;
}

const activeMoves = new WeakMap<DatabaseConnection, Set<string>>();
const markerName = '.autovision-project.json';

/** CORE-06F must call this before normal synchronous Project updates. */
export function assertProjectNotMoving(database: DatabaseConnection, id: string): void {
  assertProjectNotImporting(database, id);
  if (activeMoves.get(database)?.has(projectIdSchema.parse(id))) {
    throw new Error('Projectは移動中です。完了後に再試行してください。');
  }
}

/** D and E2 share exactly the same per-connection Project exclusion. */
function beginProjectMove(database: DatabaseConnection, projectId: string): () => void {
  assertProjectNotMoving(database, projectId);
  const releaseActivity = beginProjectMoveActivity(database, projectId);
  const active = activeMoves.get(database) ?? new Set<string>();
  activeMoves.set(database, active);
  active.add(projectId);
  return () => {
    active.delete(projectId);
    if (active.size === 0) activeMoves.delete(database);
    releaseActivity();
  };
}

interface CreatedMoveFile {
  readonly relativePath: string;
  readonly identity: ProjectFileIdentity;
  sizeBytes?: bigint;
  sha256?: string;
}

function entryChain(root: string, ancestors: readonly DirectoryIdentity[], directories: ReadonlyMap<string, ProjectFileIdentity>, relative: string): DirectoryIdentity[] {
  const chain = [...ancestors];
  let prefix = '';
  for (const part of relative.split('/').slice(0, -1)) {
    prefix = prefix ? `${prefix}/${part}` : part;
    const identity = directories.get(prefix);
    if (!identity) changed();
    chain.push({ path: win32.join(root, prefix), identity });
  }
  return chain;
}

/** Final known-entry metadata/listings only, not another synchronous payload hash. */
function checkInventorySnapshot(inventory: ProjectMoveInventory, ancestors: readonly DirectoryIdentity[]): void {
  const root = inventory.source.rootPath;
  checkChainSync(ancestors);
  verified(inventory.source);
  const directories = new Map(inventory.directories.map((entry) => [entry.relativePath, entry.pathSnapshot.identity]));
  const listings = new Map<string, string[]>(inventory.directories.map((entry) => [entry.relativePath, []]));
  const entries = [...inventory.directories, ...inventory.files];
  for (const entry of entries) {
    if (entry.relativePath === '') continue;
    const slash = entry.relativePath.lastIndexOf('/');
    const siblings = listings.get(slash < 0 ? '' : entry.relativePath.slice(0, slash));
    if (!siblings) changed();
    siblings.push(entry.relativePath.slice(slash + 1));
  }
  for (const entry of entries) {
    checkChainSync(entryChain(root, ancestors, directories, entry.relativePath));
    const path = win32.join(root, entry.relativePath);
    const stat = native.lstatSync(path, { bigint: true });
    const names = listings.get(entry.relativePath);
    ordinary(stat, names !== undefined);
    if (!sameSnapshot(entry.pathSnapshot, snapshot(stat))) changed();
    if (names && JSON.stringify(native.readdirSync(path).sort()) !== JSON.stringify(names.sort())) changed();
  }
}

async function copyInventoryFile(sourceRoot: string, targetRoot: string, file: ProjectMoveFile,
  sourceChain: readonly DirectoryIdentity[], targetChain: readonly DirectoryIdentity[], created: Map<string, CreatedMoveFile>): Promise<void> {
  const sourcePath = win32.join(sourceRoot, file.relativePath);
  const targetPath = win32.join(targetRoot, file.relativePath);
  await checkChain(sourceChain);
  const before = await fs.lstat(sourcePath, { bigint: true });
  ordinary(before, false);
  if (!sameSnapshot(file.pathSnapshot, snapshot(before))) changed();
  const reader = await fs.open(sourcePath, 'r');
  let writer: Awaited<ReturnType<typeof fs.open>> | undefined;
  let record: CreatedMoveFile | undefined;
  const hash = createHash('sha256');
  let written = 0n;
  let pending: Buffer | undefined;
  try {
    const opened = await reader.stat({ bigint: true });
    ordinary(opened, false);
    if (!sameSnapshot(file.handleSnapshot, snapshot(opened))) changed();
    await checkChain(sourceChain);
    await checkChain(targetChain);
    writer = await fs.open(targetPath, 'wx');
    const targetStat = await writer.stat({ bigint: true });
    ordinary(targetStat, false);
    record = { relativePath: file.relativePath, identity: snapshot(targetStat).identity };
    created.set(file.relativePath, record);
    await checkChain(targetChain);
    for await (const chunk of reader.createReadStream({ autoClose: false, highWaterMark: 64 * 1024 })) {
      if (!Buffer.isBuffer(chunk) || written + BigInt(chunk.length) > file.sizeBytes) changed();
      pending = chunk;
      while (pending.length > 0) {
        const { bytesWritten } = await writer.write(pending);
        if (!Number.isSafeInteger(bytesWritten) || bytesWritten <= 0 || bytesWritten > pending.length) changed();
        hash.update(pending.subarray(0, bytesWritten));
        written += BigInt(bytesWritten);
        pending = pending.subarray(bytesWritten);
      }
    }
    if (written !== file.sizeBytes || hash.copy().digest('hex') !== file.sha256) changed();
    await writer.sync();
    const after = await reader.stat({ bigint: true });
    const pathAfter = await fs.lstat(sourcePath, { bigint: true });
    ordinary(after, false);
    ordinary(pathAfter, false);
    if (!sameSnapshot(file.handleSnapshot, snapshot(after)) || !sameSnapshot(file.pathSnapshot, snapshot(pathAfter))) changed();
    await checkChain(sourceChain);
    await checkChain(targetChain);
  } finally {
    // A rejected write may have written a prefix. Authorize cleanup only for
    // acknowledged bytes plus that bounded pending prefix, never arbitrary data.
    if (writer && record) {
      try {
        const stat = await writer.stat({ bigint: true });
        ordinary(stat, false);
        const extra = stat.size - written;
        if (!sameIdentity(record.identity, snapshot(stat).identity) || extra < 0n || extra > BigInt(pending?.length ?? 0)) changed();
        record.sizeBytes = stat.size;
        record.sha256 = hash.copy().update(pending?.subarray(0, Number(extra)) ?? Buffer.alloc(0)).digest('hex');
      } catch {
        // Missing proof is intentional: cleanup will retain the entire target.
        if (record) { delete record.sizeBytes; delete record.sha256; }
      }
    }
    try { await writer?.close(); } finally { await reader.close(); }
  }
}

function rootBindings(projects: readonly Project[]): string {
  return JSON.stringify(projects.map(({ id, workspacePath }) => [id, workspacePath]).sort((a, b) => a[0]!.localeCompare(b[0]!)));
}

function sameProject(a: Project | undefined, b: Project): boolean {
  return a !== undefined && a.id === b.id && a.name === b.name && a.description === b.description
    && a.taskType === b.taskType && a.workspacePath === b.workspacePath && a.createdAt === b.createdAt && a.updatedAt === b.updatedAt;
}

function assertTargetUnreferenced(database: DatabaseConnection, target: ProjectDirectoryReceipt): void {
  if (database.inTransaction || listProjects(database).some((project) =>
    contains(project.workspacePath, target.rootPath) || contains(target.rootPath, project.workspacePath))) {
    throw new Error('移動先のDB参照またはtransactionの状態を確認できないため回収しません。');
  }
}

async function cleanupCopiedTarget(database: DatabaseConnection, target: ProjectDirectoryReceipt,
  directories: ReadonlyMap<string, ProjectFileIdentity>, files: ReadonlyMap<string, CreatedMoveFile>,
  selectedParent: ProjectMoveSelectedParent | undefined): Promise<void> {
  checkSelectedParentSync(selectedParent, win32.dirname(target.rootPath));
  assertTargetUnreferenced(database, target);
  verified(target);
  const root = await inspectDirectory(target.rootPath);
  if (!sameIdentity(snapshot(root.stat).identity, target.rootIdentity)) changed();
  const checkFile = async (file: CreatedMoveFile) => {
    const path = win32.join(target.rootPath, file.relativePath);
    const chain = entryChain(target.rootPath, root.chain, directories, file.relativePath);
    await checkChain(chain);
    const current = await hashFile(path, file.relativePath, await fs.lstat(path, { bigint: true }), chain);
    if (!sameIdentity(current.pathSnapshot.identity, file.identity) || current.sizeBytes !== file.sizeBytes || current.sha256 !== file.sha256) changed();
    return current;
  };
  // Validate ALL known entries before deleting any. Unknown entries preserve the
  // whole target, including successful copies. No recursive rm, even on failure.
  for (const [relative, identity] of directories) {
    const path = win32.join(target.rootPath, relative);
    await checkChain(entryChain(target.rootPath, root.chain, directories, relative));
    const stat = await fs.lstat(path, { bigint: true });
    ordinary(stat, true);
    if (!sameIdentity(snapshot(stat).identity, identity)) changed();
    const expected = [...directories.keys(), ...files.keys()].filter((name) => name !== ''
      && (name.includes('/') ? name.slice(0, name.lastIndexOf('/')) : '') === relative)
      .map((name) => name.slice(name.lastIndexOf('/') + 1)).sort();
    const actual = await namesAt(path);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) changed();
  }
  for (const file of files.values()) await checkFile(file);
  for (const file of files.values()) {
    if (file.relativePath === markerName) continue;
    const current = await checkFile(file);
    // hashFile also awaits close. Recheck that exact hashed entry after the last
    // await, and keep all guards and unlink synchronous (not OS-atomic).
    const path = win32.join(target.rootPath, file.relativePath);
    checkSelectedParentSync(selectedParent, win32.dirname(target.rootPath));
    checkChainSync(entryChain(target.rootPath, root.chain, directories, file.relativePath));
    verified(target);
    assertTargetUnreferenced(database, target);
    const stat = native.lstatSync(path, { bigint: true });
    ordinary(stat, false);
    if (!sameSnapshot(current.pathSnapshot, snapshot(stat))) changed();
    native.unlinkSync(path);
  }
  for (const [relative, identity] of [...directories].reverse()) {
    if (relative === '') continue;
    const path = win32.join(target.rootPath, relative);
    checkSelectedParentSync(selectedParent, win32.dirname(target.rootPath));
    checkChainSync([...entryChain(target.rootPath, root.chain, directories, relative), { path, identity }]);
    verified(target);
    assertTargetUnreferenced(database, target);
    if (native.readdirSync(path).length !== 0) changed();
    native.rmdirSync(path);
  }
  checkSelectedParentSync(selectedParent, win32.dirname(target.rootPath));
  checkChainSync(root.chain);
  assertTargetUnreferenced(database, target);
  if (!cleanupNewProjectDirectory(target)) changed();
}

/** Non-destructive CORE-06D/E1b. Both volumes use this exact copy path, not rename.
 * protectedRoots are caller-known originals/samples; every DB Project is added here.
 * Main supplies an existing app-data/project-moves receiptDirectory, provisioned
 * by startup, never a Renderer payload or a fallback inferred from the database.
 * F blocks ordinary updates through assertProjectNotMoving; the final full DB
 * snapshot is also checked under the SQLite write lock before replacement.
 * Picker callers must retain selectedParent; omission is only for trusted Main
 * nonpicker calls using D's existing current-path checks, not selection proof.
 * Final synchronous guards close in-process await gaps, not hostile OS-user races.
 */
export async function moveProjectDirectory(database: DatabaseConnection, id: unknown, destinationParent: string,
  protectedRoots: readonly string[], receiptDirectory: string, selectedParent?: ProjectMoveSelectedParent): Promise<ProjectMoveResult> {
  // Must precede even ownership-marker reads, and never end a caller transaction.
  if (database.inTransaction) throw new Error('Project移動は既存のtransaction内では実行できません。');
  const projectId = projectIdSchema.parse(id);
  const parentSnapshot = snapshotProjectMoveParent(selectedParent, destinationParent);
  const release = beginProjectMove(database, projectId);
  let target: ProjectDirectoryReceipt | undefined;
  const directories = new Map<string, ProjectFileIdentity>();
  const files = new Map<string, CreatedMoveFile>();
  let uncertain = false;
  try {
    checkSelectedParentSync(parentSnapshot, destinationParent);
    const initial = findProject(database, projectId);
    if (!initial) throw new Error('Projectが見つかりません。');
    const registered = listProjects(database);
    const sourceInventory = await inventoryProjectMove(verifyProjectDirectory(initial.workspacePath, projectId),
      [...protectedRoots, ...registered.filter((project) => project.id !== projectId).map((project) => project.workspacePath)]);
    const preflight = await preflightProjectMove(sourceInventory, destinationParent);
    // An existing unresolved record blocks even the first target mkdir (EEXIST).
    const intent = await createProjectMoveReceipt(receiptDirectory, randomUUID(), sourceInventory, preflight.destinationRoot);
    const parent = await inspectDirectory(preflight.destinationParent);
    if (!sameIdentity(snapshot(parent.stat).identity, preflight.parentIdentity)) changed();
    checkSelectedParentSync(parentSnapshot, destinationParent);
    target = createProjectDirectory(preflight.destinationParent, projectId, [sourceInventory.source.rootPath, ...sourceInventory.protectedRoots]);
    directories.set('', target.rootIdentity);
    const marker = sourceInventory.files.find((file) => file.relativePath === markerName);
    if (!marker) changed();
    files.set(markerName, { relativePath: markerName, identity: target.markerIdentity, sizeBytes: marker.sizeBytes, sha256: marker.sha256 });
    await checkChain(parent.chain);
    if (target.rootPath !== preflight.destinationRoot) changed();
    const targetProtected = [sourceInventory.source.rootPath, ...sourceInventory.protectedRoots];
    const empty = await inventoryProjectMove(target, targetProtected);
    if (empty.directories.length !== 1 || empty.files.length !== 1
      || empty.files[0]!.relativePath !== markerName || empty.files[0]!.sha256 !== marker.sha256) changed();
    const sourceRoot = await inspectDirectory(sourceInventory.source.rootPath);
    const targetRoot = await inspectDirectory(target.rootPath);
    if (!sameIdentity(snapshot(sourceRoot.stat).identity, sourceInventory.source.rootIdentity)
      || !sameIdentity(snapshot(targetRoot.stat).identity, target.rootIdentity)) changed();
    const sourceDirectories = new Map(sourceInventory.directories.map((entry) => [entry.relativePath, entry.pathSnapshot.identity]));
    for (const directory of sourceInventory.directories) {
      if (directory.relativePath === '') continue;
      const chain = entryChain(target.rootPath, targetRoot.chain, directories, directory.relativePath);
      await checkChain(chain);
      const path = win32.join(target.rootPath, directory.relativePath);
      await fs.mkdir(path);
      const stat = await fs.lstat(path, { bigint: true });
      ordinary(stat, true);
      directories.set(directory.relativePath, snapshot(stat).identity);
      await checkChain(chain);
    }
    for (const file of sourceInventory.files) {
      if (file.relativePath === markerName) continue; // A generated canonical bytes; new identity is expected.
      await copyInventoryFile(sourceRoot.rootPath, target.rootPath, file,
        entryChain(sourceRoot.rootPath, sourceRoot.chain, sourceDirectories, file.relativePath),
        entryChain(target.rootPath, targetRoot.chain, directories, file.relativePath), files);
    }
    const targetInventory = await inventoryProjectMove(target, targetProtected);
    if (targetInventory.source.rootPath !== preflight.destinationRoot
      || JSON.stringify(targetInventory.protectedRoots) !== JSON.stringify(targetProtected)) changed();
    if (targetInventory.totalBytes !== sourceInventory.totalBytes || targetInventory.directories.length !== directories.size
      || targetInventory.files.length !== files.size) changed();
    for (const directory of targetInventory.directories) {
      const identity = directories.get(directory.relativePath);
      if (!identity || !sameIdentity(identity, directory.pathSnapshot.identity)) changed();
    }
    for (const file of targetInventory.files) {
      const created = files.get(file.relativePath);
      const original = sourceInventory.files.find((entry) => entry.relativePath === file.relativePath);
      if (!created || !original || !sameIdentity(created.identity, file.pathSnapshot.identity)
        || file.sha256 !== original.sha256 || file.sizeBytes !== original.sizeBytes) changed();
    }
    const storedReceipt = await updateProjectMoveReceipt(intent,
      { ...intent.receipt, phase: 'prepared', target: targetInventory }, initial.workspacePath);
    // Receipt persistence adds awaits: both final full scans MUST follow it.
    await revalidateProjectMoveInventory(sourceInventory);
    await revalidateProjectMoveInventory(targetInventory);
    if (database.inTransaction) throw new Error('Project移動中に別のtransactionが開始されました。');
    const project: Project = { ...initial, workspacePath: target.rootPath, updatedAt: new Date().toISOString() };
    database.exec('BEGIN IMMEDIATE');
    let committing = false;
    try {
      if (!sameProject(findProject(database, projectId), initial) || rootBindings(listProjects(database)) !== rootBindings(registered)) {
        throw new Error('Projectのmetadataまたは登録済み保存先が移動中に変更されました。');
      }
      // Both full hash scans have finished. No await from these two complete
      // metadata/listing checks through the synchronous SQLite COMMIT.
      checkSelectedParentSync(parentSnapshot, destinationParent);
      checkInventorySnapshot(sourceInventory, sourceRoot.chain);
      checkInventorySnapshot(targetInventory, targetRoot.chain);
      if (!replaceProject(database, project) || !sameProject(findProject(database, projectId), project)) {
        throw new Error('Projectの保存先を更新できませんでした。');
      }
      committing = true;
      database.exec('COMMIT');
    } catch (error) {
      if (database.inTransaction) {
        try { database.exec('ROLLBACK'); } catch (rollbackError) {
          uncertain = true;
          throw new AggregateError([error, rollbackError], 'Project移動のDB rollbackに失敗しました。移動先は保持しています。');
        }
      } else if (committing) uncertain = true;
      throw error;
    }
    return Object.freeze({ project, sourceInventory, targetReceipt: target, targetInventory, storedReceipt, sourceRetained: true });
  } catch (error) {
    // Never clear a failed/incomplete receipt, even if D removes its own copies.
    // copying/prepared is NOT proof of COMMIT or readiness to delete; E2/manual
    // recovery must check the current DB anchor and the remaining real bytes.
    if (target) {
      if (uncertain) throw new AggregateError([error], 'Project移動のDB結果が不確実なため移動先は回収していません。');
      try { await cleanupCopiedTarget(database, target, directories, files, parentSnapshot); } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Project移動に失敗しました。同一性・内容・DB参照を確認できない移動先は保持しています。');
      }
    }
    throw error;
  } finally { release(); }
}

export interface ProjectMoveRecoveryResult {
  /** source-retained requires attention; neither copying nor DB-at-source authorizes cleanup. */
  readonly status: 'none' | 'source-retained' | 'completed';
  /** Always the current DB snapshot, never an adopted/rolled-back receipt root. */
  readonly project: Project;
}

interface RecoveryRoot {
  readonly path: string;
  readonly identity: ProjectFileIdentity;
  readonly chain: readonly DirectoryIdentity[];
}

interface RecoveryLocation {
  readonly path: string;
  readonly chain: readonly DirectoryIdentity[];
  /** First missing component, never an ENOENT from an unchecked ancestor. */
  readonly missing: string | null;
}

function checkRecoveryLocation(location: RecoveryLocation): void {
  checkChainSync(location.chain);
  if (location.missing !== null) {
    const parent = location.chain.at(-1)!.path;
    const name = win32.basename(location.missing).toUpperCase();
    if (native.readdirSync(parent).some((entry) => entry.toUpperCase() === name)
      || !absentNow(location.missing)) changed();
  }
}

/** Recovery-only inspection. Missing tails do not grant ownership or permission
 * to follow a subsequently introduced entry. The first absence stays pinned.
 */
async function recoveryLocation(input: string, allowMissing: boolean): Promise<RecoveryLocation> {
  const path = absolutePath(input);
  let cursor = win32.parse(path).root;
  const chain: DirectoryIdentity[] = [];
  let missing: string | null = null;
  for (const part of ['', ...path.slice(cursor.length).split('\\').filter(Boolean)]) {
    if (part) cursor = win32.join(cursor, part);
    let stat: BigIntStats;
    try { stat = await fs.lstat(cursor, { bigint: true }); } catch (error) {
      if (!allowMissing || chain.length === 0 || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      missing = cursor;
      break;
    }
    ordinary(stat, true);
    chain.push({ path: cursor, identity: snapshot(stat).identity });
  }
  const last = chain.at(-1)!;
  if (absolutePath(await fs.realpath(last.path)).toUpperCase() !== last.path.toUpperCase()) changed();
  const location = { path, chain, missing };
  checkRecoveryLocation(location);
  return location;
}

function separateRecoveryLocation(root: RecoveryRoot, location: RecoveryLocation): void {
  if (contains(root.path, location.path) || contains(location.path, root.path)
    || location.chain.some((entry) => sameIdentity(entry.identity, root.identity))
    || (location.missing === null && root.chain.some((entry) => sameIdentity(entry.identity, location.chain.at(-1)!.identity)))) {
    throw new Error('Project回復の保存領域が元/先・保護された原本または他Projectと重複しています。');
  }
}

interface RecoveryTrees {
  readonly source: ProjectMoveInventory;
  readonly target: ProjectMoveInventory;
  readonly sourceParent: readonly DirectoryIdentity[];
  readonly sourceChain: readonly DirectoryIdentity[];
  readonly targetChain: readonly DirectoryIdentity[];
  readonly managedChain: readonly DirectoryIdentity[];
  readonly protectedLocations: readonly RecoveryLocation[];
  readonly directories: ReadonlyMap<string, ProjectFileIdentity>;
  readonly positions: ReadonlyMap<string, number>;
  readonly order: readonly ProjectMoveRemoval[];
}

function checkRecoveryDatabase(database: DatabaseConnection, initial: Project, bindings: string): void {
  if (database.inTransaction) throw new Error('Project回復中に別のtransactionが開始されました。');
  if (!sameProject(findProject(database, initial.id), initial) || rootBindings(listProjects(database)) !== bindings) {
    throw new Error('Projectのmetadataまたは登録済み保存先が回復中に変更されました。');
  }
}

function separateRecoveryRoots(a: RecoveryRoot, b: RecoveryRoot): void {
  if (contains(a.path, b.path) || contains(b.path, a.path)
    || a.chain.some((entry) => sameIdentity(entry.identity, b.identity))
    || b.chain.some((entry) => sameIdentity(entry.identity, a.identity))) {
    throw new Error('Project回復の保存領域が元/先・保護された原本または他Projectと重複しています。');
  }
}

async function recoveryRoot(path: string): Promise<RecoveryRoot> {
  const root = await inspectDirectory(path);
  // Do not accept a short-name/other root alias supplied by a record or DB row.
  if (root.rootPath.toUpperCase() !== path.toUpperCase()) changed();
  return { path: root.rootPath, identity: snapshot(root.stat).identity, chain: root.chain };
}

async function abortUnstartedCopy(database: DatabaseConnection, initial: Project, registered: readonly Project[],
  bindings: string, stored: StoredMoveReceipt, receiptDirectory: string): Promise<boolean> {
  const receipt = stored.receipt;
  if (receipt.phase !== 'copying' || receipt.target !== null || receipt.cursor !== 0 || receipt.pendingDelete !== null
    || initial.workspacePath.toUpperCase() !== receipt.source.source.rootPath.toUpperCase()) return false;
  const source = await recoveryRoot(initial.workspacePath);
  if (!sameIdentity(source.identity, receipt.source.source.rootIdentity)) changed();
  const target = await recoveryLocation(receipt.targetPath, true);
  if (target.missing === null) return false; // Unknown/partial targets are never inferred from a marker.
  separateRecoveryLocation(source, target);
  const managed = await recoveryRoot(receiptDirectory);
  separateRecoveryRoots(source, managed);
  separateRecoveryLocation(managed, target);
  const protectedPaths = [...new Set([...receipt.source.protectedRoots,
    ...registered.filter((project) => project.id !== initial.id).map((project) => project.workspacePath)])];
  const protectedRoots: RecoveryRoot[] = [];
  for (const path of protectedPaths) {
    const other = await recoveryRoot(path);
    separateRecoveryRoots(source, other);
    separateRecoveryRoots(managed, other);
    separateRecoveryLocation(other, target);
    protectedRoots.push(other);
  }
  await revalidateProjectMoveInventory(receipt.source);
  // No await between these guards and unlink of the exact issued receipt.
  checkRecoveryDatabase(database, initial, bindings);
  checkChainSync(managed.chain);
  for (const other of protectedRoots) checkChainSync(other.chain);
  checkRecoveryLocation(target);
  checkInventorySnapshot(receipt.source, source.chain);
  abortProjectMoveReceipt(stored, initial.workspacePath);
  return true;
}

async function prepareRecoveryTrees(receipt: MoveReceipt, currentProjectRoot: string, registered: readonly Project[],
  receiptDirectory: string): Promise<RecoveryTrees> {
  if (receipt.phase !== 'prepared' || !receipt.target) changed();
  const source = receipt.source;
  const parent = await recoveryRoot(win32.dirname(source.source.rootPath));
  const sourceRoot: RecoveryRoot = { path: source.source.rootPath, identity: source.source.rootIdentity,
    chain: [...parent.chain, { path: source.source.rootPath, identity: source.source.rootIdentity }] };
  // Pin the DB spelling too: folded lexical equality alone is not proof on a
  // Windows directory with case sensitivity enabled. C verifies the record path.
  const targetRoot = await recoveryRoot(currentProjectRoot);
  if (targetRoot.path.toUpperCase() !== receipt.targetPath.toUpperCase()
    || !sameIdentity(targetRoot.identity, receipt.target.source.rootIdentity)) changed();
  // Keep the OLD geometry and identity even when the old root/marker is gone.
  // C's target rescan must not try to inspect that removed root as a protection.
  separateRecoveryRoots(sourceRoot, targetRoot);
  const managed = await recoveryRoot(receiptDirectory);
  separateRecoveryRoots(sourceRoot, managed);
  separateRecoveryRoots(targetRoot, managed);
  const currentPaths = registered.filter((project) => project.id !== receipt.projectId).map((project) => project.workspacePath);
  const requiredPaths = new Set(currentPaths.map((path) => path.toUpperCase()));
  // Distinct spellings can be distinct entries in case-sensitive directories.
  // Never drop a CURRENT binding before checking its own actual path.
  const protectedPaths = [...new Set([...source.protectedRoots, ...currentPaths])];
  const protectedLocations: RecoveryLocation[] = [];
  for (const path of protectedPaths) {
    // A recorded protection is historical geometry, not proof that another
    // Project's old root still exists. CURRENT DB roots remain mandatory.
    const other = await recoveryLocation(path, !requiredPaths.has(path.toUpperCase()));
    separateRecoveryLocation(sourceRoot, other);
    separateRecoveryLocation(targetRoot, other);
    separateRecoveryLocation(managed, other);
    protectedLocations.push(other);
  }
  const order = getProjectMoveRemovalOrder(receipt);
  return { source, target: { ...receipt.target, protectedRoots: protectedLocations.filter((entry) => entry.missing === null).map((entry) => entry.path) },
    sourceParent: parent.chain, sourceChain: sourceRoot.chain, targetChain: targetRoot.chain,
    managedChain: managed.chain, protectedLocations,
    directories: new Map(source.directories.map((entry) => [entry.relativePath, entry.pathSnapshot.identity])),
    positions: new Map(order.map((entry, index) => [entry.relativePath, index])), order };
}

function absentNow(path: string): boolean {
  try { native.lstatSync(path, { bigint: true }); return false; } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return true;
  }
}

function removalChain(trees: RecoveryTrees, relativePath: string): readonly DirectoryIdentity[] {
  return relativePath === '' ? trees.sourceParent
    : entryChain(trees.source.source.rootPath, trees.sourceChain, trees.directories, relativePath);
}

/** Only the recorded prefix and the ONE pending position can explain absence. */
function resumedRemovalCount(trees: RecoveryTrees, receipt: MoveReceipt): number {
  if (receipt.pendingDelete === null) return receipt.cursor;
  const entry = trees.order[receipt.cursor]!;
  checkChainSync(removalChain(trees, entry.relativePath));
  return receipt.cursor + (absentNow(win32.join(trees.source.source.rootPath, entry.relativePath)) ? 1 : 0);
}

function checkRecoverySource(trees: RecoveryTrees, removed: number): readonly ProjectMoveFile[] {
  const root = trees.source.source.rootPath;
  checkChainSync(trees.sourceParent);
  const aliases = native.readdirSync(win32.dirname(root)).filter((name) => name.toUpperCase() === win32.basename(root).toUpperCase());
  if (removed === trees.order.length) {
    if (!absentNow(root) || aliases.length !== 0) changed();
    return [];
  }
  if (aliases.length !== 1 || aliases[0] !== win32.basename(root)) changed();
  checkChainSync(trees.sourceChain);
  if (native.realpathSync.native(root).toUpperCase() !== root.toUpperCase()) changed();
  const directories = trees.source.directories.filter((entry) => trees.positions.get(entry.relativePath)! >= removed);
  const files = trees.source.files.filter((entry) => trees.positions.get(entry.relativePath)! >= removed);
  const listings = new Map<string, string[]>(directories.map((entry) => [entry.relativePath, []]));
  for (const entry of [...directories, ...files]) {
    if (entry.relativePath === '') continue;
    const slash = entry.relativePath.lastIndexOf('/');
    const names = listings.get(slash < 0 ? '' : entry.relativePath.slice(0, slash));
    if (!names) changed();
    names.push(entry.relativePath.slice(slash + 1));
  }
  // Completed paths must STAY absent: the exact remaining listings also reject
  // reintroduced entries, including anything inside a supposedly removed child.
  for (const directory of directories) {
    const path = win32.join(root, directory.relativePath);
    checkChainSync(removalChain(trees, directory.relativePath));
    const stat = native.lstatSync(path, { bigint: true });
    ordinary(stat, true);
    // Own deletes change directory size/mtime/ctime/nlink, NOT its identity.
    if (!sameIdentity(snapshot(stat).identity, directory.pathSnapshot.identity)
      || JSON.stringify(native.readdirSync(path).sort()) !== JSON.stringify(listings.get(directory.relativePath)!.sort())) changed();
  }
  for (const file of files) {
    checkChainSync(removalChain(trees, file.relativePath));
    const stat = native.lstatSync(win32.join(root, file.relativePath), { bigint: true });
    ordinary(stat, false);
    if (!sameSnapshot(file.pathSnapshot, snapshot(stat))) changed();
  }
  return files;
}

function checkRecoveryNow(database: DatabaseConnection, initial: Project, bindings: string,
  stored: StoredMoveReceipt, trees: RecoveryTrees, removed: number): void {
  checkRecoveryDatabase(database, initial, bindings);
  checkChainSync(trees.managedChain);
  for (const location of trees.protectedLocations) checkRecoveryLocation(location);
  checkRecoverySource(trees, removed);
  checkInventorySnapshot(trees.target, trees.targetChain);
  assertProjectMoveReceiptCurrent(stored);
}

/** CORE-06E2, Main only. Load from the trusted app-data location and CURRENT DB
 * root; never import a returned move result, change DB state or roll back a move.
 * D retains its source; F invokes this recovery after a successful move and
 * reports unconfirmed cleanup separately from the committed DB destination.
 * A checksum/marker is evidence, not authentication against a hostile OS user.
 * After any rejection Main must reread current DB/receipt status: a write/unlink
 * can have succeeded before its acknowledgement failed. No background work or
 * implicit retry is left running, and unknown remaining bytes are never removed.
 */
export async function recoverProjectMove(database: DatabaseConnection, id: unknown,
  receiptDirectory: string): Promise<ProjectMoveRecoveryResult> {
  if (database.inTransaction) throw new Error('Project回復は既存のtransaction内では実行できません。');
  const projectId = projectIdSchema.parse(id);
  const release = beginProjectMove(database, projectId);
  try {
    const initial = findProject(database, projectId);
    if (!initial) throw new Error('Projectが見つかりません。');
    const registered = listProjects(database);
    const bindings = rootBindings(registered);
    let stored = await readProjectMoveReceipt(receiptDirectory, projectId, initial.workspacePath);
    checkRecoveryDatabase(database, initial, bindings);
    if (!stored) return Object.freeze({ status: 'none', project: initial });
    assertProjectMoveReceiptCurrent(stored);
    if (await abortUnstartedCopy(database, initial, registered, bindings, stored, receiptDirectory)) {
      return Object.freeze({ status: 'none', project: initial });
    }
    if (stored.receipt.phase === 'copying'
      || initial.workspacePath.toUpperCase() === stored.receipt.source.source.rootPath.toUpperCase()) {
      return Object.freeze({ status: 'source-retained', project: initial });
    }
    const trees = await prepareRecoveryTrees(stored.receipt, initial.workspacePath, registered, receiptDirectory);
    let removed = resumedRemovalCount(trees, stored.receipt);
    // Preflight ALL remaining source files/listings before any progress write.
    const remaining = checkRecoverySource(trees, removed);
    for (const file of remaining) {
      const path = win32.join(trees.source.source.rootPath, file.relativePath);
      const current = await hashFile(path, file.relativePath, await fs.lstat(path, { bigint: true }), removalChain(trees, file.relativePath));
      if (current.sizeBytes !== file.sizeBytes || current.sha256 !== file.sha256
        || !sameSnapshot(current.pathSnapshot, file.pathSnapshot) || !sameSnapshot(current.handleSnapshot, file.handleSnapshot)) changed();
    }
    // Target payload parity is checked against its immutable prepared inventory,
    // including files whose source was already removed. Never trust fake fields.
    await revalidateProjectMoveInventory(trees.target);
    checkRecoveryNow(database, initial, bindings, stored, trees, removed);
    while (stored.receipt.cursor < trees.order.length) {
      const cursor = stored.receipt.cursor;
      if (stored.receipt.pendingDelete === null) {
        stored = await updateProjectMoveProgress(stored, cursor, cursor, initial.workspacePath);
        checkRecoveryNow(database, initial, bindings, stored, trees, removed);
      }
      if (removed === cursor) {
        const entry = trees.order[cursor]!;
        const path = win32.join(trees.source.source.rootPath, entry.relativePath);
        // No await from the complete pinned metadata/DB/receipt guard to removal.
        // The source marker may already be gone: never invoke A on that root.
        if (entry.kind === 'file') native.unlinkSync(path);
        else {
          if (native.readdirSync(path).length !== 0) changed();
          native.rmdirSync(path);
        }
        removed += 1;
      }
      // If this write fails, the disk pending entry explains exactly ONE absent
      // path on the next invocation. Original full inventories are never rebased.
      stored = await updateProjectMoveProgress(stored, cursor + 1, null, initial.workspacePath);
      checkRecoveryNow(database, initial, bindings, stored, trees, removed);
    }
    // Progress stays bounded while deleting. Consolidate the completed cursor
    // into the full receipt exactly once before the final await/finish guards.
    stored = await consolidateProjectMoveReceipt(stored, initial.workspacePath);
    await revalidateProjectMoveInventory(trees.target);
    checkRecoveryNow(database, initial, bindings, stored, trees, removed);
    finishProjectMoveReceipt(stored, initial.workspacePath); // synchronous, exact managed file only
    return Object.freeze({ status: 'completed', project: initial });
  } finally { release(); }
}