import { createHash, randomUUID } from 'node:crypto';
import native, { type BigIntStats } from 'node:fs';
import fs from 'node:fs/promises';
import { win32 } from 'node:path';
import { z } from 'zod';

import { projectIdSchema } from '../../shared/contracts/project.js';
import type { ProjectFileIdentity } from './project-directory.js';
import type { ProjectMoveInventory, ProjectMoveSnapshot } from './project-move.js';

/** Fixed E1a format, not a general journal or authority to delete a Project. */
export interface MoveReceipt {
  readonly schemaVersion: 1;
  readonly operationId: string;
  readonly projectId: string;
  readonly phase: 'copying' | 'prepared';
  readonly source: ProjectMoveInventory;
  readonly targetPath: string;
  readonly target: ProjectMoveInventory | null;
  readonly cursor: number;
  readonly pendingDelete: number | null;
}

export interface StoredMoveReceipt {
  readonly receipt: MoveReceipt;
  /** Hash of the original FILE bytes, distinct from the envelope's payload hash. */
  readonly sha256: string;
  readonly pathSnapshot: ProjectMoveSnapshot;
  readonly handleSnapshot: ProjectMoveSnapshot;
}

interface MoveProgress {
  readonly schemaVersion: 1;
  readonly projectId: string;
  readonly operationId: string;
  /** Raw-byte hash of the immutable prepared base receipt. */
  readonly baseSha256: string;
  /** Canonical raw-byte hash after the one final cursor consolidation. */
  readonly completedBaseSha256: string;
  readonly cursor: number;
  readonly pendingDelete: number | null;
}

export interface ProjectMoveRemoval {
  readonly kind: 'file' | 'directory';
  /** '' is the owned root; no absolute deletion paths are issued here. */
  readonly relativePath: string;
}

export const MAX_MOVE_RECEIPT_BYTES = 16 * 1024 * 1024;
export const MAX_MOVE_PROGRESS_BYTES = 2 * 1024;
const U64_MAX = (1n << 64n) - 1n;
const U128_MAX = (1n << 128n) - 1n;
const I128_MIN = -(1n << 127n);
const I128_MAX = (1n << 127n) - 1n;
// Required keys plus even a minimal directory snapshot exceed 128 UTF-8 bytes.
const maxEntries = Math.floor(MAX_MOVE_RECEIPT_BYTES / 128);
const maxProtectedRoots = Math.floor(MAX_MOVE_RECEIPT_BYTES / 6);
const maxPathLength = 32_767;
const markerName = '.autovision-project.json';
const unsignedDecimal = /^(?:0|[1-9][0-9]*)(?![\s\S])/u;
const signedDecimal = /^(?:0|-?[1-9][0-9]*)(?![\s\S])/u;
const hashSchema = z.string().regex(/^[0-9a-f]{64}(?![\s\S])/u);
const uuidSchema = z.string().toLowerCase().pipe(projectIdSchema);
const indexSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
  .refine((value) => !Object.is(value, -0));

function invalid(): never { throw new Error('Project移動receiptが不正です。'); }
function changed(): never { throw new Error('Project移動receiptまたは保存先が変更されました。'); }
const hash = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const folded = (path: string): string => path.toUpperCase();

function safeName(name: string): boolean {
  return name.length > 0 && name.length <= 255 && name !== '.' && name !== '..' && name.isWellFormed()
    && !/[\u0000-\u001f\u007f<>:"/\\|?*]/u.test(name) && !/[ .]$/u.test(name)
    && !/^(?:con|conin\$|conout\$|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(name);
}

function safeAbsolute(path: string): boolean {
  // Validate original components BEFORE normalization. No UNC/device/drive-relative
  // paths, separator aliases or disappearing '..'. Native names are never URL-decoded.
  if (!/^[a-z]:\\/iu.test(path) || path.length > maxPathLength || path !== win32.normalize(path)) return false;
  if (path.length === 3) return true;
  return path.slice(3).split('\\').every(safeName);
}

function absolute(input: string): string {
  if (typeof input !== 'string' || !safeAbsolute(input)) invalid();
  return input;
}

const absoluteSchema = z.string().max(maxPathLength).refine(safeAbsolute);
const relativeSchema = z.string().max(maxPathLength)
  .refine((path) => path === '' || path.split('/').every(safeName));
const identitySchema = z.strictObject({
  dev: z.string().regex(unsignedDecimal),
  ino: z.string().regex(/^[1-9][0-9]*(?![\s\S])/u),
  birthtimeNs: z.string().regex(signedDecimal),
}).readonly();

// Only these known fields are BigInts. Identity fields deliberately remain strings.
// Separate runtime/wire schemas reject e.g. a string size in a caller's inventory,
// or a JSON number / guessed numeric string in any other field.
function receiptSchema(size: z.ZodType<bigint>, timestamp: z.ZodType<bigint>) {
  const snapshot = z.strictObject({
    identity: identitySchema, sizeBytes: size, mtimeNs: timestamp, ctimeNs: timestamp,
    nlink: size.refine((value) => value > 0n),
  }).readonly();
  const directory = z.strictObject({ relativePath: relativeSchema, pathSnapshot: snapshot }).readonly();
  const file = z.strictObject({
    relativePath: relativeSchema, pathSnapshot: snapshot, handleSnapshot: snapshot,
    sizeBytes: size, sha256: hashSchema,
  }).readonly();
  const inventory = z.strictObject({
    source: z.strictObject({
      rootPath: absoluteSchema, projectId: uuidSchema,
      rootIdentity: identitySchema, markerIdentity: identitySchema,
    }).readonly(),
    protectedRoots: z.array(absoluteSchema).max(maxProtectedRoots).readonly(),
    directories: z.array(directory).min(1).max(maxEntries).readonly(),
    files: z.array(file).min(1).max(maxEntries).readonly(),
    totalBytes: size,
  }).readonly();
  return z.strictObject({
    schemaVersion: z.literal(1), operationId: uuidSchema, projectId: uuidSchema,
    phase: z.enum(['copying', 'prepared']), source: inventory, targetPath: absoluteSchema,
    target: inventory.nullable(), cursor: indexSchema, pendingDelete: indexSchema.nullable(),
  }).readonly();
}

const runtimeSchema = receiptSchema(z.bigint().nonnegative(), z.bigint());
const wireSchema = receiptSchema(
  z.string().regex(unsignedDecimal).transform((value) => BigInt(value)),
  z.string().regex(signedDecimal).transform((value) => BigInt(value)),
);
const envelopeSchema = z.strictObject({ checksum: hashSchema, payload: z.unknown() });
const progressSchema = z.strictObject({
  schemaVersion: z.literal(1), projectId: uuidSchema, operationId: uuidSchema,
  baseSha256: hashSchema, completedBaseSha256: hashSchema,
  cursor: indexSchema, pendingDelete: indexSchema.nullable(),
}).readonly();

function sameIdentity(a: ProjectFileIdentity, b: ProjectFileIdentity): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.birthtimeNs === b.birthtimeNs;
}
function sameFileId(a: ProjectFileIdentity, b: ProjectFileIdentity): boolean {
  return a.dev === b.dev && a.ino === b.ino;
}
function sameContent(a: ProjectMoveSnapshot, b: ProjectMoveSnapshot): boolean {
  return sameIdentity(a.identity, b.identity) && a.sizeBytes === b.sizeBytes && a.mtimeNs === b.mtimeNs && a.nlink === b.nlink;
}
function sameSnapshot(a: ProjectMoveSnapshot, b: ProjectMoveSnapshot): boolean {
  return sameContent(a, b) && a.ctimeNs === b.ctimeNs;
}
function contains(parent: string, child: string): boolean {
  const relative = win32.relative(folded(parent), folded(child));
  return relative === '' || (relative !== '..' && !relative.startsWith('..\\') && !win32.isAbsolute(relative));
}
function intersects(a: string, b: string): boolean { return contains(a, b) || contains(b, a); }

function disjoint(paths: readonly string[]): void {
  // Trailing separators make every descendant adjacent to its ancestor's range;
  // a sibling such as 'root-backup' cannot hide 'root\\child' from this check.
  const keys = paths.map((path) => `${folded(path).replace(/\\$/u, '')}\\`).sort();
  for (let i = 1; i < keys.length; i += 1) if (keys[i]!.startsWith(keys[i - 1]!)) invalid();
}

function validateInventory(inventory: ProjectMoveInventory, projectId: string): void {
  const { source, directories, files } = inventory;
  if (source.projectId !== projectId || win32.basename(source.rootPath).toLowerCase() !== projectId
    || directories[0]!.relativePath !== '' || !sameIdentity(directories[0]!.pathSnapshot.identity, source.rootIdentity)) invalid();
  disjoint([source.rootPath, ...inventory.protectedRoots]);
  const paths = new Set<string>();
  const identities = new Set<string>();
  const children = new Map<string, { relativePath: string; kind: 'directory' | 'file' }[]>();
  for (const entry of directories) children.set(entry.relativePath, []);
  for (const [entries, kind] of [[directories, 'directory'], [files, 'file']] as const) {
    for (const entry of entries) {
      const relative = entry.relativePath;
      const key = folded(relative);
      const identity = `${entry.pathSnapshot.identity.dev}:${entry.pathSnapshot.identity.ino}`;
      if (paths.has(key) || identities.has(identity) || (kind === 'file' && relative === '')) invalid();
      paths.add(key);
      identities.add(identity);
      if (relative === '') continue;
      const child = absolute(win32.join(source.rootPath, relative));
      if (win32.relative(source.rootPath, child).replaceAll('\\', '/') !== relative) invalid();
      const slash = relative.lastIndexOf('/');
      const siblings = children.get(slash < 0 ? '' : relative.slice(0, slash));
      if (!siblings) invalid(); // Exact parent spelling, not merely a folded match.
      siblings.push({ relativePath: relative, kind });
    }
  }
  // C's sorted-name depth-first order, without recursive path traversal. This
  // also proves parent-before-child directory order for E2's reverse deletion.
  const stack: { relativePath: string; kind: 'directory' | 'file' }[] = [{ relativePath: '', kind: 'directory' }];
  let directoryIndex = 0;
  let fileIndex = 0;
  while (stack.length > 0) {
    const entry = stack.pop()!;
    if (entry.kind === 'file') {
      if (files[fileIndex++]?.relativePath !== entry.relativePath) invalid();
    } else {
      if (directories[directoryIndex++]?.relativePath !== entry.relativePath) invalid();
      const descendants = children.get(entry.relativePath)!;
      descendants.sort((a, b) => a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0);
      for (let i = descendants.length - 1; i >= 0; i -= 1) stack.push(descendants[i]!);
    }
  }
  if (directoryIndex !== directories.length || fileIndex !== files.length) invalid();
  let total = 0n;
  for (const file of files) {
    if (file.sizeBytes !== file.pathSnapshot.sizeBytes || !sameContent(file.pathSnapshot, file.handleSnapshot)
      || file.pathSnapshot.nlink !== 1n || file.handleSnapshot.nlink !== 1n) invalid();
    total += file.sizeBytes;
  }
  const marker = files.find((file) => file.relativePath === markerName);
  const markerBytes = Buffer.from(`${JSON.stringify({ schemaVersion: 1, projectId })}\n`, 'utf8');
  if (total !== inventory.totalBytes || !marker || !sameIdentity(marker.pathSnapshot.identity, source.markerIdentity)
    || marker.sizeBytes !== BigInt(markerBytes.length) || marker.sha256 !== hash(markerBytes)) invalid();
}

function validateReceipt(receipt: MoveReceipt): MoveReceipt {
  validateInventory(receipt.source, receipt.projectId);
  if (win32.basename(receipt.targetPath).toLowerCase() !== receipt.projectId) invalid();
  disjoint([receipt.source.source.rootPath, receipt.targetPath, ...receipt.source.protectedRoots]);
  if (receipt.target !== null) {
    const target = receipt.target;
    validateInventory(target, receipt.projectId);
    if (folded(target.source.rootPath) !== folded(receipt.targetPath)
      || target.totalBytes !== receipt.source.totalBytes
      || target.directories.length !== receipt.source.directories.length || target.files.length !== receipt.source.files.length) invalid();
    const expectedProtected = [receipt.source.source.rootPath, ...receipt.source.protectedRoots].map(folded).sort();
    if (JSON.stringify(target.protectedRoots.map(folded).sort()) !== JSON.stringify(expectedProtected)) invalid();
    for (let i = 0; i < target.directories.length; i += 1) {
      if (target.directories[i]!.relativePath !== receipt.source.directories[i]!.relativePath) invalid();
    }
    for (let i = 0; i < target.files.length; i += 1) {
      const a = receipt.source.files[i]!;
      const b = target.files[i]!;
      if (a.relativePath !== b.relativePath || a.sizeBytes !== b.sizeBytes || a.sha256 !== b.sha256) invalid();
    }
    // A copy has different identities/timestamps. Those are retained, not compared
    // across trees; E1b/E2 must revalidate each tree against its OWN inventory.
  }
  const length = receipt.source.files.length + receipt.source.directories.length;
  if (receipt.cursor > length || (receipt.pendingDelete !== null
    && (receipt.pendingDelete !== receipt.cursor || receipt.cursor === length))) invalid();
  if (receipt.phase === 'copying' && (receipt.cursor !== 0 || receipt.pendingDelete !== null)) invalid();
  if (receipt.phase === 'prepared' && receipt.target === null) invalid();
  return receipt;
}

function snapshotReceipt(input: unknown): MoveReceipt {
  // Every nested object/array schema parses a copy and freezes it, not the caller.
  return validateReceipt(runtimeSchema.parse(input));
}

/** Fixed-schema private canonicalizer; never exported as a generic JSON codec. */
function canonical(value: unknown): string {
  if (typeof value === 'bigint') return JSON.stringify(String(value));
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value !== 'object') invalid();
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(Reflect.get(value, key))}`).join(',')}}`;
}

function encodedReceiptBytes(receipt: MoveReceipt): Buffer {
  const payload = canonical(receipt);
  return Buffer.from(`{"checksum":${JSON.stringify(hash(payload))},"payload":${payload}}\n`, 'utf8');
}

function encodeValidated(receipt: MoveReceipt): Buffer {
  const bytes = encodedReceiptBytes(receipt);
  if (bytes.length > MAX_MOVE_RECEIPT_BYTES) invalid();
  return bytes;
}

function encodedEnvelopeBytes(payload: unknown): Buffer {
  const encoded = canonical(payload);
  return Buffer.from(`{"checksum":${JSON.stringify(hash(encoded))},"payload":${encoded}}\n`, 'utf8');
}

function decodeEnvelope(input: Uint8Array, maximumBytes: number, maximumDepth: number): unknown {
  if (!ArrayBuffer.isView(input) || Object.prototype.toString.call(input) !== '[object Uint8Array]'
    || input.byteLength === 0 || input.byteLength > maximumBytes) invalid();
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.from(input));
  const objects: Set<string>[] = [];
  let depth = 0;
  let previous = '';
  for (const match of text.matchAll(/"(?:[^"\\]|\\[\s\S])*"|[{}\[\]:]/gu)) {
    const token = match[0];
    if (token === '{' || token === '[') {
      if (++depth > maximumDepth) invalid();
      if (token === '{') objects.push(new Set());
    } else if (token === '}' || token === ']') {
      depth -= 1;
      if (token === '}') objects.pop();
    } else if (token === ':') {
      const key: unknown = JSON.parse(previous);
      const keys = objects.at(-1);
      if (typeof key !== 'string' || !keys || keys.has(key)) invalid();
      keys.add(key);
    }
    previous = token;
  }
  const envelope = envelopeSchema.parse(JSON.parse(text));
  if (hash(canonical(envelope.payload)) !== envelope.checksum) invalid();
  return envelope.payload;
}

export function encodeProjectMoveReceipt(receipt: MoveReceipt): Buffer {
  return encodeValidated(snapshotReceipt(receipt));
}

export function decodeProjectMoveReceipt(input: Uint8Array): MoveReceipt {
  try {
    // The deepest v1 container is file.snapshot.identity (7 levels including the
    // envelope). Bound BEFORE parsing/canonicalizing; decoded duplicate keys fail
    // even if their spelling uses JSON escapes. JSON.parse owns grammar validation.
    return validateReceipt(wireSchema.parse(decodeEnvelope(input, MAX_MOVE_RECEIPT_BYTES, 7)));
  } catch { return invalid(); }
}

function encodeProgress(progress: MoveProgress): Buffer {
  const value = progressSchema.parse(progress);
  const bytes = encodedEnvelopeBytes(value);
  if (bytes.length > MAX_MOVE_PROGRESS_BYTES) invalid();
  return bytes;
}

function decodeProgress(input: Uint8Array): MoveProgress {
  try { return progressSchema.parse(decodeEnvelope(input, MAX_MOVE_PROGRESS_BYTES, 2)); }
  catch { return invalid(); }
}

/** E2 consumes this exact v1 order. This function performs NO filesystem removal. */
export function getProjectMoveRemovalOrder(input: MoveReceipt): readonly ProjectMoveRemoval[] {
  const { source } = snapshotReceipt(input);
  return Object.freeze([
    ...source.files.filter((file) => file.relativePath !== markerName)
      .map((file) => Object.freeze({ kind: 'file' as const, relativePath: file.relativePath })),
    ...source.directories.slice(1).reverse()
      .map((directory) => Object.freeze({ kind: 'directory' as const, relativePath: directory.relativePath })),
    Object.freeze({ kind: 'file' as const, relativePath: markerName }),
    Object.freeze({ kind: 'directory' as const, relativePath: '' }),
  ]);
}

interface DirectoryIdentity { readonly path: string; readonly identity: ProjectFileIdentity }
interface DirectoryCheck {
  readonly path: string;
  readonly chain: readonly DirectoryIdentity[];
  readonly complete: boolean;
  readonly missing: string | null;
}
interface DiskSnapshot {
  readonly bytes: Buffer;
  readonly pathSnapshot: ProjectMoveSnapshot;
  readonly handleSnapshot: ProjectMoveSnapshot;
}
interface StoredProgressState { readonly value: MoveProgress; readonly disk: DiskSnapshot }
interface StoredState {
  readonly directory: DirectoryCheck;
  readonly path: string;
  readonly bytes: Buffer;
  readonly baseDisk: DiskSnapshot;
  readonly baseReceipt: MoveReceipt;
  readonly progressPath: string;
  readonly progress?: StoredProgressState;
}
// Only actual successful reads/creates/updates issue update handles. There is no
// public assertion/branding operation that upgrades an arbitrary object to trusted.
const storedReceipts = new WeakMap<StoredMoveReceipt, StoredState>();
const updating = new Set<string>();

function snapshot(stat: BigIntStats): ProjectMoveSnapshot {
  if (stat.ino <= 0n || stat.dev < 0n || stat.size < 0n || stat.nlink <= 0n) changed();
  return Object.freeze({
    identity: Object.freeze({ dev: String(stat.dev), ino: String(stat.ino), birthtimeNs: String(stat.birthtimeNs) }),
    sizeBytes: stat.size, mtimeNs: stat.mtimeNs, ctimeNs: stat.ctimeNs, nlink: stat.nlink,
  });
}
function ordinary(stat: BigIntStats, directory: boolean): void {
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1n)) {
    throw new Error('移動receiptのパスにリンク・非通常file・hardlinkは使用できません。');
  }
}
function enoent(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
async function checkChain(chain: readonly DirectoryIdentity[]): Promise<void> {
  for (const entry of chain) {
    const stat = await fs.lstat(entry.path, { bigint: true });
    ordinary(stat, true);
    if (!sameIdentity(snapshot(stat).identity, entry.identity)) changed();
  }
}

function checkBoundariesNow(boundaries: readonly DirectoryCheck[]): void {
  for (const { chain, missing } of boundaries) {
    for (const entry of chain) {
      const stat = native.lstatSync(entry.path, { bigint: true });
      ordinary(stat, true);
      if (!sameIdentity(snapshot(stat).identity, entry.identity)) changed();
    }
    if (missing !== null) {
      const parent = chain.at(-1)!.path;
      if (native.readdirSync(parent).some((entry) => folded(entry) === folded(win32.basename(missing)))) changed();
      try { native.lstatSync(missing, { bigint: true }); } catch (error) {
        if (enoent(error)) continue;
        throw error;
      }
      changed();
    }
  }
}

function checkDiskNow(directory: DirectoryCheck, path: string, disk: Pick<DiskSnapshot, 'pathSnapshot'>): void {
  // Metadata only, after the last await. The bounded payload hash was asynchronous.
  const name = win32.basename(path);
  const aliases = native.readdirSync(directory.path).filter((entry) => folded(entry) === folded(name));
  if (aliases.length !== 1 || aliases[0] !== name) changed();
  const stat = native.lstatSync(path, { bigint: true });
  ordinary(stat, false);
  if (!sameSnapshot(snapshot(stat), disk.pathSnapshot)) changed();
}

function beginDiskSyncGuard(directory: DirectoryCheck, path: string,
  disk: Pick<DiskSnapshot, 'pathSnapshot'>): ProjectMoveSnapshot {
  const name = win32.basename(path);
  const aliases = native.readdirSync(directory.path).filter((entry) => folded(entry) === folded(name));
  if (aliases.length !== 1 || aliases[0] !== name) changed();
  const stat = native.lstatSync(path, { bigint: true });
  ordinary(stat, false);
  const current = snapshot(stat);
  // ctime may settle differently between Node's async and sync stat APIs. Pin
  // identity/content across APIs, then compare the same sync API after awaits.
  if (!sameContent(current, disk.pathSnapshot)) changed();
  return current;
}

function checkDiskSyncGuard(directory: DirectoryCheck, path: string, before: ProjectMoveSnapshot): void {
  const name = win32.basename(path);
  const aliases = native.readdirSync(directory.path).filter((entry) => folded(entry) === folded(name));
  if (aliases.length !== 1 || aliases[0] !== name) changed();
  const stat = native.lstatSync(path, { bigint: true });
  ordinary(stat, false);
  if (!sameSnapshot(snapshot(stat), before)) changed();
}

function checkMissingNow(directory: DirectoryCheck, path: string): void {
  const name = win32.basename(path);
  if (native.readdirSync(directory.path).some((entry) => folded(entry) === folded(name))) changed();
  try { native.lstatSync(path, { bigint: true }); } catch (error) {
    if (enoent(error)) return;
    throw error;
  }
  changed();
}

async function inspectDirectory(input: string, allowMissingTail = false): Promise<DirectoryCheck> {
  const path = absolute(input);
  let cursor = win32.parse(path).root;
  const chain: DirectoryIdentity[] = [];
  let complete = true;
  let missing: string | null = null;
  for (const part of ['', ...path.slice(cursor.length).split('\\').filter(Boolean)]) {
    if (part) cursor = win32.join(cursor, part);
    let stat: BigIntStats;
    try { stat = await fs.lstat(cursor, { bigint: true }); } catch (error) {
      if (!allowMissingTail || !enoent(error) || chain.length === 0) throw error;
      complete = false;
      missing = cursor;
      break;
    }
    ordinary(stat, true);
    chain.push(Object.freeze({ path: cursor, identity: snapshot(stat).identity }));
  }
  const last = chain.at(-1)!;
  const real = absolute(await fs.realpath(last.path));
  // Case aliases are the same Windows path; short-name/other aliases are refused.
  if (folded(real) !== folded(last.path)) invalid();
  await checkChain(chain);
  return Object.freeze({ path: complete ? real : path, chain: Object.freeze(chain), complete, missing });
}

async function managedDirectory(input: string): Promise<DirectoryCheck> {
  if (process.platform !== 'win32') throw new Error('移動receiptの保存はWindows専用です。');
  if (win32.basename(absolute(input)).toLowerCase() !== 'project-moves') invalid();
  return inspectDirectory(input);
}

function checkAnchor(receipt: MoveReceipt, projectId: string, currentProjectRoot: string): void {
  const anchor = folded(absolute(currentProjectRoot));
  if (receipt.projectId !== projectId || win32.basename(currentProjectRoot).toLowerCase() !== projectId) invalid();
  const atSource = anchor === folded(receipt.source.source.rootPath);
  const atTarget = anchor === folded(receipt.targetPath);
  if ((!atSource && !atTarget) || (atTarget && receipt.phase === 'copying')
    || (atSource && (receipt.cursor !== 0 || receipt.pendingDelete !== null))) invalid();
}

function boundaryPaths(directory: string, receipt: MoveReceipt): string[] {
  const paths = [receipt.source.source.rootPath, receipt.targetPath, ...receipt.source.protectedRoots,
    ...(receipt.target?.protectedRoots ?? [])];
  if (paths.some((path) => intersects(directory, path))) invalid();
  return [...new Map(paths.map((path) => [folded(path), path])).values()];
}

async function writeBoundary(directory: DirectoryCheck, receipt: MoveReceipt): Promise<readonly DirectoryCheck[]> {
  const checks: DirectoryCheck[] = [directory];
  const ownIdentity = directory.chain.at(-1)!.identity;
  for (const path of boundaryPaths(directory.path, receipt)) {
    // Copying target, or E2's already removed source, may not exist. Existing
    // ancestors still must be ordinary/canonical; missing tails grant no ownership.
    const other = await inspectDirectory(path, true);
    if (other.chain.some((entry) => sameIdentity(entry.identity, ownIdentity))
      || (other.complete && directory.chain.some((entry) => sameIdentity(entry.identity, other.chain.at(-1)!.identity)))) invalid();
    checks.push(other);
  }
  for (const check of checks) await checkChain(check.chain);
  return checks;
}

function receiptPath(directory: string, projectId: string): string {
  const path = win32.join(directory, `${projectId}.json`);
  if (win32.dirname(path) !== directory || win32.basename(path) !== `${projectId}.json`) invalid();
  return absolute(path);
}

function progressPath(directory: string, projectId: string): string {
  const path = win32.join(directory, `${projectId}.progress.json`);
  if (win32.dirname(path) !== directory || win32.basename(path) !== `${projectId}.progress.json`) invalid();
  return absolute(path);
}

async function checkFilename(directory: string, path: string): Promise<boolean> {
  const name = win32.basename(path);
  const aliases = (await fs.readdir(directory)).filter((entry) => folded(entry) === folded(name));
  // Also reject aliases on Windows directories with case sensitivity enabled.
  if (aliases.length > 1 || (aliases.length === 1 && aliases[0] !== name)) invalid();
  return aliases.length === 1;
}

async function readDisk(directory: DirectoryCheck, path: string,
  maximumBytes = MAX_MOVE_RECEIPT_BYTES): Promise<DiskSnapshot | undefined> {
  const listed = await checkFilename(directory.path, path);
  await checkChain(directory.chain);
  let before: BigIntStats;
  try { before = await fs.lstat(path, { bigint: true }); } catch (error) {
    if (!enoent(error) || listed) throw error;
    // ENOENT from an ancestor/open/read is NOT an absent expected receipt.
    await checkChain(directory.chain);
    if (await checkFilename(directory.path, path)) changed();
    await checkChain(directory.chain);
    return undefined;
  }
  ordinary(before, false);
  if (before.size <= 0n || before.size > BigInt(maximumBytes)) invalid();
  const handle = await fs.open(path, 'r');
  let result: DiskSnapshot;
  try {
    const opened = await handle.stat({ bigint: true });
    ordinary(opened, false);
    const handleSnapshot = snapshot(opened);
    if (!sameContent(snapshot(before), handleSnapshot)) changed();
    // Windows may settle path ctime when opening. NEVER compare lstat ctime to
    // fstat ctime: establish both snapshots after open and compare same-API pairs.
    const openedPath = await fs.lstat(path, { bigint: true });
    ordinary(openedPath, false);
    const pathSnapshot = snapshot(openedPath);
    if (!sameContent(pathSnapshot, handleSnapshot)) changed();
    await checkChain(directory.chain);
    const bytes = Buffer.alloc(Number(handleSnapshot.sizeBytes) + 1);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await handle.read(bytes, length, bytes.length - length, length);
      if (!Number.isSafeInteger(bytesRead) || bytesRead < 0 || bytesRead > bytes.length - length) changed();
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    const pathAfter = await fs.lstat(path, { bigint: true });
    ordinary(after, false);
    ordinary(pathAfter, false);
    if (BigInt(length) !== handleSnapshot.sizeBytes || !sameSnapshot(handleSnapshot, snapshot(after))
      || !sameSnapshot(pathSnapshot, snapshot(pathAfter))) changed();
    result = { bytes: bytes.subarray(0, length), pathSnapshot, handleSnapshot };
  } finally { await handle.close(); }
  await checkChain(directory.chain);
  if (!await checkFilename(directory.path, path)) changed();
  const closedPath = await fs.lstat(path, { bigint: true });
  ordinary(closedPath, false);
  if (!sameSnapshot(result.pathSnapshot, snapshot(closedPath))) changed();
  return result;
}

function remember(receipt: MoveReceipt, baseReceipt: MoveReceipt, disk: DiskSnapshot,
  directory: DirectoryCheck, path: string, progress?: StoredProgressState,
  reuse?: { readonly bytes: Buffer; readonly sha256: string }): StoredMoveReceipt {
  const sha256 = reuse?.sha256 ?? hash(disk.bytes);
  const stored = Object.freeze({ receipt, sha256, pathSnapshot: disk.pathSnapshot, handleSnapshot: disk.handleSnapshot });
  storedReceipts.set(stored, { directory, path, bytes: reuse?.bytes ?? Buffer.from(disk.bytes), baseDisk: disk, baseReceipt,
    progressPath: progressPath(directory.path, receipt.projectId), progress });
  return stored;
}

function completeBase(receipt: MoveReceipt): { readonly receipt: MoveReceipt; readonly bytes: Buffer; readonly sha256: string } {
  const length = receipt.source.files.length + receipt.source.directories.length;
  const complete = snapshotReceipt({ ...receipt, cursor: length, pendingDelete: null });
  const bytes = encodeValidated(complete);
  return { receipt: complete, bytes, sha256: hash(bytes) };
}

function mergeProgress(base: MoveReceipt, disk: DiskSnapshot, progress: MoveProgress): MoveReceipt {
  if (base.phase !== 'prepared' || base.target === null || progress.projectId !== base.projectId
    || progress.operationId !== base.operationId) invalid();
  const complete = completeBase(base);
  if (progress.completedBaseSha256 !== complete.sha256) invalid();
  const baseSha256 = hash(disk.bytes);
  const length = base.source.files.length + base.source.directories.length;
  if (baseSha256 === progress.baseSha256) {
    if (progress.cursor < base.cursor || (progress.cursor === base.cursor && base.pendingDelete !== null
      && progress.pendingDelete === null)) invalid();
  } else if (baseSha256 !== progress.completedBaseSha256 || base.cursor !== length
    || base.pendingDelete !== null || progress.cursor !== length || progress.pendingDelete !== null) changed();
  return snapshotReceipt({ ...base, cursor: progress.cursor, pendingDelete: progress.pendingDelete });
}

function sameDisk(actual: DiskSnapshot, expected: DiskSnapshot, bytes: Buffer): boolean {
  return actual.bytes.equals(bytes) && sameSnapshot(actual.pathSnapshot, expected.pathSnapshot)
    && sameSnapshot(actual.handleSnapshot, expected.handleSnapshot);
}

async function replaceManagedFile(directory: DirectoryCheck, path: string, current: DiskSnapshot | undefined,
  boundaries: readonly DirectoryCheck[], guards: readonly { readonly path: string; readonly disk: DiskSnapshot }[],
  bytes: Buffer, maximumBytes: number): Promise<DiskSnapshot> {
  const temporary = absolute(win32.join(directory.path, `.autovision-${randomUUID()}.tmp`));
  let created: ProjectMoveSnapshot | undefined;
  let published = false;
  try {
    const handle = await fs.open(temporary, 'wx', 0o600);
    const errors: unknown[] = [];
    try {
      const stat = await handle.stat({ bigint: true });
      ordinary(stat, false);
      created = snapshot(stat);
      await handle.writeFile(bytes);
      await handle.sync();
    } catch (error) { errors.push(error); }
    try { await handle.close(); } catch (error) { errors.push(error); }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, '移動receiptの一時書込みとcloseに失敗しました。');
    const staged = await readDisk(directory, temporary, maximumBytes);
    if (!created || !staged || !staged.bytes.equals(bytes)
      || !sameIdentity(created.identity, staged.pathSnapshot.identity)
      || !sameIdentity(created.identity, staged.handleSnapshot.identity)) changed();
    // No await from the complete old/staged/boundary checks through publish.
    checkBoundariesNow(boundaries);
    if (current) checkDiskNow(directory, path, current);
    else checkMissingNow(directory, path);
    for (const guard of guards) checkDiskNow(directory, guard.path, guard.disk);
    checkDiskNow(directory, temporary, staged);
    native.renameSync(temporary, path);
    published = true;
    const installed = native.lstatSync(path, { bigint: true });
    ordinary(installed, false);
    const installedSnapshot = snapshot(installed);
    if (!sameFileId(installedSnapshot.identity, staged.pathSnapshot.identity)
      || installedSnapshot.sizeBytes !== BigInt(bytes.length)) changed();
    const disk = await readDisk(directory, path, maximumBytes);
    if (!disk || !disk.bytes.equals(bytes)
      || !sameIdentity(disk.pathSnapshot.identity, installedSnapshot.identity)
      || !sameIdentity(disk.handleSnapshot.identity, installedSnapshot.identity)) changed();
    return disk;
  } catch (error) {
    if (!published && created) {
      try {
        const stat = native.lstatSync(temporary, { bigint: true });
        ordinary(stat, false);
        if (!sameIdentity(snapshot(stat).identity, created.identity)) changed();
        native.unlinkSync(temporary);
      } catch (cleanupError) {
        if (!enoent(cleanupError)) {
          throw new AggregateError([error, cleanupError], '移動receiptの更新失敗後に一時fileを安全に回収できませんでした。');
        }
      }
    }
    throw error;
  }
}

/**
 * Main ONLY: supply an existing app-data/project-moves directory, never a Renderer
 * payload, DB.name, or a directory inside/containing a protected/owned root. Startup
 * owns provisioning that directory. One unresolved operation per Project, no clear.
 * C's source must already be verified by the caller under the Project move lock.
 */
export async function createProjectMoveReceipt(directoryPath: string, operationId: string,
  source: ProjectMoveInventory, targetPath: string): Promise<StoredMoveReceipt> {
  const receipt = snapshotReceipt({ schemaVersion: 1, operationId, projectId: source.source.projectId,
    phase: 'copying', source, targetPath, target: null, cursor: 0, pendingDelete: null });
  const bytes = encodeValidated(receipt); // Detached, deeply validated, before any await.
  boundaryPaths(absolute(directoryPath), receipt);
  const directory = await managedDirectory(directoryPath);
  const boundaries = await writeBoundary(directory, receipt);
  const path = receiptPath(directory.path, receipt.projectId);
  const checkpoint = progressPath(directory.path, receipt.projectId);
  await checkFilename(directory.path, path);
  if (await checkFilename(directory.path, checkpoint)) changed();
  checkBoundariesNow(boundaries);
  checkMissingNow(directory, checkpoint);
  // EEXIST is outside the write scope. Creation never unlinks or clears a receipt,
  // including an incomplete write. Only E2's explicit completed finish may remove it.
  const handle = await fs.open(path, 'wx', 0o600);
  let createdIdentity: ProjectFileIdentity | undefined;
  const errors: unknown[] = [];
  try {
    const created = await handle.stat({ bigint: true });
    ordinary(created, false);
    createdIdentity = snapshot(created).identity;
    for (const boundary of boundaries) await checkChain(boundary.chain);
    await handle.writeFile(bytes);
    await handle.sync();
  } catch (error) { errors.push(error); }
  try { await handle.close(); } catch (error) { errors.push(error); }
  if (errors.length > 0) throw new AggregateError(errors, '移動receiptの作成に失敗しました。残存fileは保持しています。');
  const disk = await readDisk(directory, path);
  if (!createdIdentity || !disk || !sameIdentity(disk.handleSnapshot.identity, createdIdentity) || !disk.bytes.equals(bytes)) changed();
  checkBoundariesNow(boundaries);
  checkDiskNow(directory, path, disk);
  checkMissingNow(directory, checkpoint);
  return remember(receipt, receipt, disk, directory, path);
}

/** Read-only. currentProjectRoot is the trusted Main caller's CURRENT DB binding.
 * Payload hash is corruption detection, NOT authentication. Restored inventory is
 * evidence to revalidate in E1b/E2, never authority to scan/delete arbitrary paths.
 */
export async function readProjectMoveReceipt(directoryPath: string, expectedProjectId: string,
  currentProjectRoot: string): Promise<StoredMoveReceipt | undefined> {
  const projectId = uuidSchema.parse(expectedProjectId);
  absolute(currentProjectRoot);
  if (win32.basename(currentProjectRoot).toLowerCase() !== projectId) invalid();
  const directory = await managedDirectory(directoryPath);
  const path = receiptPath(directory.path, projectId);
  const checkpoint = progressPath(directory.path, projectId);
  const disk = await readDisk(directory, path);
  if (!disk) {
    if (await readDisk(directory, checkpoint, MAX_MOVE_PROGRESS_BYTES)) changed();
    checkMissingNow(directory, path);
    checkMissingNow(directory, checkpoint);
    return undefined;
  }
  const baseReceipt = decodeProjectMoveReceipt(disk.bytes);
  const baseSyncGuard = beginDiskSyncGuard(directory, path, disk);
  const progressDisk = await readDisk(directory, checkpoint, MAX_MOVE_PROGRESS_BYTES);
  let receipt = baseReceipt;
  let progress: StoredProgressState | undefined;
  if (progressDisk) {
    const value = decodeProgress(progressDisk.bytes);
    receipt = mergeProgress(baseReceipt, disk, value);
    progress = { value, disk: progressDisk };
  }
  checkAnchor(receipt, projectId, currentProjectRoot);
  boundaryPaths(directory.path, receipt);
  // Reading the optional progress file added awaits after the base read. Close
  // that gap before issuing a combined capability (and pin progress absence).
  checkDiskSyncGuard(directory, path, baseSyncGuard);
  if (progress) beginDiskSyncGuard(directory, checkpoint, progress.disk);
  else checkMissingNow(directory, checkpoint);
  return remember(receipt, baseReceipt, disk, directory, path, progress);
}

function transition(previous: MoveReceipt, next: MoveReceipt, currentProjectRoot: string): void {
  checkAnchor(previous, previous.projectId, currentProjectRoot);
  checkAnchor(next, previous.projectId, currentProjectRoot);
  if (next.operationId !== previous.operationId || next.targetPath !== previous.targetPath
    || canonical(next.source) !== canonical(previous.source)
    || (previous.target !== null && canonical(next.target) !== canonical(previous.target))
    || (previous.phase === 'prepared' && next.phase !== 'prepared')) invalid();
  if (previous.phase === 'copying') {
    if (next.cursor !== 0 || next.pendingDelete !== null) invalid();
    return;
  }
  const unchanged = next.cursor === previous.cursor && next.pendingDelete === previous.pendingDelete;
  const pending = previous.pendingDelete === null && next.cursor === previous.cursor && next.pendingDelete === previous.cursor;
  const finished = previous.pendingDelete === previous.cursor && next.cursor === previous.cursor + 1 && next.pendingDelete === null;
  if (!unchanged && !pending && !finished) invalid();
}

/** Explicit same-operation prepared/cursor update; no reset, import, or silent clear.
 * E2 must prove a deletion before advancing its pending cursor. Main holds the
 * Project lock; this small set additionally rejects simultaneous receipt updates.
 * REL-01 has no compare-and-rename primitive: these pre/post checks do NOT promise
 * atomicity against a hostile OS user or full power-loss durability.
 */
export async function updateProjectMoveReceipt(previous: StoredMoveReceipt, input: MoveReceipt,
  currentProjectRoot: string): Promise<StoredMoveReceipt> {
  const state = storedReceipts.get(previous);
  if (!state) invalid();
  const next = snapshotReceipt(input);
  transition(previous.receipt, next, currentProjectRoot);
  if (state.progress) invalid();
  const bytes = encodeValidated(next);
  const key = folded(state.path);
  if (updating.has(key)) throw new Error('移動receiptは更新中です。');
  updating.add(key);
  try {
    const directory = await managedDirectory(state.directory.path);
    await checkChain(state.directory.chain);
    if (!sameIdentity(directory.chain.at(-1)!.identity, state.directory.chain.at(-1)!.identity)) changed();
    const boundaries = await writeBoundary(directory, next);
    const current = await readDisk(directory, state.path);
    if (!current || hash(current.bytes) !== previous.sha256 || !sameDisk(current, state.baseDisk, state.bytes)) changed();
    if (await checkFilename(directory.path, state.progressPath)) changed();
    checkBoundariesNow(boundaries);
    checkDiskNow(directory, state.path, current);
    checkMissingNow(directory, state.progressPath);
    const disk = await replaceManagedFile(directory, state.path, current, boundaries, [], bytes, MAX_MOVE_RECEIPT_BYTES);
    if (!disk.bytes.equals(bytes)) changed();
    checkBoundariesNow(boundaries);
    checkDiskNow(directory, state.path, disk);
    checkMissingNow(directory, state.progressPath);
    // Rename replaced the inode. Capture the NEW path/handle identities, never
    // reuse the previous fingerprint for a subsequent prepared/cursor update.
    return remember(next, next, disk, directory, state.path);
  } finally { updating.delete(key); }
}

function progressTransition(previous: MoveReceipt, cursorInput: number, pendingInput: number | null,
  currentProjectRoot: string): MoveReceipt {
  checkAnchor(previous, previous.projectId, currentProjectRoot);
  if (previous.phase !== 'prepared') invalid();
  const cursor = indexSchema.parse(cursorInput);
  const pendingDelete = pendingInput === null ? null : indexSchema.parse(pendingInput);
  const length = previous.source.files.length + previous.source.directories.length;
  if (cursor > length || (pendingDelete !== null && (pendingDelete !== cursor || cursor === length))) invalid();
  const unchanged = cursor === previous.cursor && pendingDelete === previous.pendingDelete;
  const pending = previous.pendingDelete === null && cursor === previous.cursor && pendingDelete === previous.cursor;
  const finished = previous.pendingDelete === previous.cursor && cursor === previous.cursor + 1 && pendingDelete === null;
  if (!unchanged && !pending && !finished) invalid();
  return Object.freeze({ ...previous, cursor, pendingDelete });
}

async function persistProjectMoveProgress(previous: StoredMoveReceipt, state: StoredState, next: MoveReceipt,
  currentProjectRoot: string): Promise<StoredMoveReceipt> {
  checkAnchor(next, next.projectId, currentProjectRoot);
  if (state.baseReceipt.phase !== 'prepared') invalid();
  const complete = state.progress ? undefined : completeBase(state.baseReceipt);
  const value = progressSchema.parse({ schemaVersion: 1, projectId: next.projectId, operationId: next.operationId,
    baseSha256: state.progress?.value.baseSha256 ?? hash(state.bytes),
    completedBaseSha256: state.progress?.value.completedBaseSha256 ?? complete!.sha256,
    cursor: next.cursor, pendingDelete: next.pendingDelete });
  const bytes = encodeProgress(value);
  const key = folded(state.path);
  if (updating.has(key)) throw new Error('移動receiptは更新中です。');
  updating.add(key);
  try {
    const directory = await managedDirectory(state.directory.path);
    await checkChain(state.directory.chain);
    if (!sameIdentity(directory.chain.at(-1)!.identity, state.directory.chain.at(-1)!.identity)) changed();
    const boundaries = await writeBoundary(directory, next);
    let current: DiskSnapshot | undefined;
    if (state.progress) {
      current = await readDisk(directory, state.progressPath, MAX_MOVE_PROGRESS_BYTES);
      if (!current || !sameDisk(current, state.progress.disk, state.progress.disk.bytes)) changed();
    } else if (await checkFilename(directory.path, state.progressPath)) changed();
    checkBoundariesNow(boundaries);
    checkDiskNow(directory, state.path, state.baseDisk);
    if (current) checkDiskNow(directory, state.progressPath, current);
    else checkMissingNow(directory, state.progressPath);
    const disk = await replaceManagedFile(directory, state.progressPath, current, boundaries,
      [{ path: state.path, disk: state.baseDisk }], bytes, MAX_MOVE_PROGRESS_BYTES);
    checkBoundariesNow(boundaries);
    checkDiskNow(directory, state.path, state.baseDisk);
    checkDiskNow(directory, state.progressPath, disk);
    return remember(next, state.baseReceipt, state.baseDisk, directory, state.path, { value, disk },
      { bytes: state.bytes, sha256: previous.sha256 });
  } finally { updating.delete(key); }
}

/** Recovery-only O(1) checkpoint update. Immutable inventories are reused from
 * the issued capability; only the cursor pair is parsed, copied and persisted.
 */
export async function updateProjectMoveProgress(previous: StoredMoveReceipt, cursor: number,
  pendingDelete: number | null, currentProjectRoot: string): Promise<StoredMoveReceipt> {
  const state = storedReceipts.get(previous);
  if (!state) invalid();
  const next = progressTransition(previous.receipt, cursor, pendingDelete, currentProjectRoot);
  return persistProjectMoveProgress(previous, state, next, currentProjectRoot);
}

/** Persist the completed logical cursor into the full base exactly once. A final
 * progress file remains until synchronous finish, so every one-sided crash can
 * be reopened without inventing a deleted prefix.
 */
export async function consolidateProjectMoveReceipt(previous: StoredMoveReceipt,
  currentProjectRoot: string): Promise<StoredMoveReceipt> {
  const state = storedReceipts.get(previous);
  if (!state) invalid();
  const receipt = previous.receipt;
  checkAnchor(receipt, receipt.projectId, currentProjectRoot);
  const length = receipt.source.files.length + receipt.source.directories.length;
  if (receipt.phase !== 'prepared' || receipt.cursor !== length || receipt.pendingDelete !== null) invalid();
  if (state.baseReceipt.cursor === length && state.baseReceipt.pendingDelete === null) {
    assertProjectMoveReceiptCurrent(previous);
    return previous;
  }
  if (!state.progress || state.progress.value.cursor !== length || state.progress.value.pendingDelete !== null) invalid();
  const complete = completeBase(state.baseReceipt);
  if (complete.sha256 !== state.progress.value.completedBaseSha256) invalid();
  const key = folded(state.path);
  if (updating.has(key)) throw new Error('移動receiptは更新中です。');
  updating.add(key);
  try {
    const directory = await managedDirectory(state.directory.path);
    await checkChain(state.directory.chain);
    if (!sameIdentity(directory.chain.at(-1)!.identity, state.directory.chain.at(-1)!.identity)) changed();
    const boundaries = await writeBoundary(directory, receipt);
    const current = await readDisk(directory, state.path);
    const checkpoint = await readDisk(directory, state.progressPath, MAX_MOVE_PROGRESS_BYTES);
    if (!current || !sameDisk(current, state.baseDisk, state.bytes) || !checkpoint
      || !sameDisk(checkpoint, state.progress.disk, state.progress.disk.bytes)) changed();
    const disk = await replaceManagedFile(directory, state.path, current, boundaries,
      [{ path: state.progressPath, disk: checkpoint }], complete.bytes, MAX_MOVE_RECEIPT_BYTES);
    checkBoundariesNow(boundaries);
    checkDiskNow(directory, state.progressPath, checkpoint);
    checkDiskNow(directory, state.path, disk);
    return remember(complete.receipt, complete.receipt, disk, directory, state.path,
      { value: state.progress.value, disk: checkpoint }, { bytes: Buffer.from(disk.bytes), sha256: complete.sha256 });
  } finally { updating.delete(key); }
}

/** E2's last-await guard. Only a real read/create/update can issue this capability.
 * The raw bytes were hashed on that read; here compare their pinned path metadata
 * and managed-directory identities, not a caller-supplied hash or a new inode.
 * This is not authentication or OS-atomic protection against hostile writers.
 */
export function assertProjectMoveReceiptCurrent(stored: StoredMoveReceipt): void {
  const state = storedReceipts.get(stored);
  if (!state) invalid();
  if (updating.has(folded(state.path))) throw new Error('移動receiptは更新中です。');
  checkBoundariesNow([state.directory]);
  checkDiskNow(state.directory, state.path, stored);
  if (state.progress) checkDiskNow(state.directory, state.progressPath, state.progress.disk);
  else checkMissingNow(state.directory, state.progressPath);
}

/** Main recovery ONLY. The caller has revalidated the complete source, CURRENT
 * DB binding/protections and the target's checked absence after its last await.
 * This ends an unstarted copy, never authorizes deletion of either Project tree.
 * Prepared/partial-target receipts retain their existing recovery requirements.
 */
export function abortProjectMoveReceipt(stored: StoredMoveReceipt, currentProjectRoot: string): void {
  const state = storedReceipts.get(stored);
  if (!state) invalid();
  const receipt = stored.receipt;
  checkAnchor(receipt, receipt.projectId, currentProjectRoot);
  if (folded(currentProjectRoot) !== folded(receipt.source.source.rootPath)
    || receipt.phase !== 'copying' || receipt.target !== null
    || receipt.cursor !== 0 || receipt.pendingDelete !== null) invalid();
  assertProjectMoveReceiptCurrent(stored);
  const key = folded(state.path);
  updating.add(key);
  try {
    native.unlinkSync(state.path);
    storedReceipts.delete(stored);
  } finally { updating.delete(key); }
}

/** E2 ONLY, synchronous: remove exactly the fully consumed managed receipt.
 * The caller must first fully verify the target, prove the source absent and
 * recheck CURRENT DB bindings, with no await between those guards and this call.
 * No arbitrary path, Project removal, cursor reset or history is exposed here.
 * A failed unlink retains the capability for retry (a lost ACK requires reread).
 */
export function finishProjectMoveReceipt(stored: StoredMoveReceipt, currentProjectRoot: string): void {
  const state = storedReceipts.get(stored);
  if (!state) invalid();
  const receipt = stored.receipt;
  checkAnchor(receipt, receipt.projectId, currentProjectRoot);
  if (receipt.phase !== 'prepared' || folded(currentProjectRoot) !== folded(receipt.targetPath)
    || receipt.pendingDelete !== null || receipt.cursor !== receipt.source.files.length + receipt.source.directories.length
    || state.baseReceipt.cursor !== receipt.cursor || state.baseReceipt.pendingDelete !== null) invalid();
  assertProjectMoveReceiptCurrent(stored);
  const key = folded(state.path);
  updating.add(key);
  try {
    if (state.progress) {
      if (state.progress.value.cursor !== receipt.cursor || state.progress.value.pendingDelete !== null
        || state.progress.value.completedBaseSha256 !== hash(state.bytes)) invalid();
      native.unlinkSync(state.progressPath);
      storedReceipts.set(stored, { ...state, progress: undefined });
      checkDiskNow(state.directory, state.path, stored);
      checkMissingNow(state.directory, state.progressPath);
    }
    native.unlinkSync(state.path);
    storedReceipts.delete(stored);
  } finally { updating.delete(key); }
}

function bounded(value: bigint, minimum: bigint, maximum: bigint): boolean {
  return value >= minimum && value <= maximum;
}

/** Engineering policy for values newly observed from the live Windows filesystem.
 * The v1 decoder remains backward compatible and deliberately does not apply it.
 */
export function assertProjectMoveSnapshotWritable(value: ProjectMoveSnapshot): void {
  let dev: bigint;
  let ino: bigint;
  let birthtimeNs: bigint;
  try {
    dev = BigInt(value.identity.dev);
    ino = BigInt(value.identity.ino);
    birthtimeNs = BigInt(value.identity.birthtimeNs);
  } catch { throw new Error('Project移動のnative数値をreceiptへ安全に保存できません。'); }
  if (!bounded(dev, 0n, U64_MAX) || !bounded(ino, 1n, U128_MAX)
    || !bounded(birthtimeNs, I128_MIN, I128_MAX)
    || !bounded(value.sizeBytes, 0n, U64_MAX)
    || !bounded(value.mtimeNs, I128_MIN, I128_MAX)
    || !bounded(value.ctimeNs, I128_MIN, I128_MAX)
    || !bounded(value.nlink, 1n, U64_MAX)) {
    throw new Error('Project移動のnative数値が新規receiptの保存方針を超えています。');
  }
}

function assertInventoryWritable(inventory: ProjectMoveInventory): void {
  for (const entry of inventory.directories) assertProjectMoveSnapshotWritable(entry.pathSnapshot);
  for (const entry of inventory.files) {
    assertProjectMoveSnapshotWritable(entry.pathSnapshot);
    assertProjectMoveSnapshotWritable(entry.handleSnapshot);
  }
}

function maximumPreparedTarget(source: ProjectMoveInventory, targetPath: string): ProjectMoveInventory {
  let index = 0n;
  const identity = (): ProjectFileIdentity => Object.freeze({
    dev: String(U64_MAX), ino: String(U128_MAX - index++), birthtimeNs: String(I128_MIN),
  });
  const directorySnapshot = (): ProjectMoveSnapshot => Object.freeze({
    identity: identity(), sizeBytes: U64_MAX, mtimeNs: I128_MIN, ctimeNs: I128_MIN, nlink: U64_MAX,
  });
  const fileSnapshot = (sizeBytes: bigint): ProjectMoveSnapshot => Object.freeze({
    identity: identity(), sizeBytes, mtimeNs: I128_MIN, ctimeNs: I128_MIN, nlink: 1n,
  });
  const directories = source.directories.map((entry) => Object.freeze({
    relativePath: entry.relativePath, pathSnapshot: directorySnapshot(),
  }));
  const files = source.files.map((entry) => {
    const pathSnapshot = fileSnapshot(entry.sizeBytes);
    return Object.freeze({ relativePath: entry.relativePath, pathSnapshot,
      handleSnapshot: pathSnapshot, sizeBytes: entry.sizeBytes, sha256: entry.sha256 });
  });
  const marker = files.find((entry) => entry.relativePath === markerName);
  if (!marker || directories.length === 0) invalid();
  const protectedRoots = [source.source.rootPath, ...source.protectedRoots];
  if (protectedRoots.length > maxProtectedRoots) invalid();
  return Object.freeze({
    source: Object.freeze({ rootPath: absolute(targetPath), projectId: source.source.projectId,
      rootIdentity: directories[0]!.pathSnapshot.identity, markerIdentity: marker.pathSnapshot.identity }),
    protectedRoots: Object.freeze(protectedRoots), directories: Object.freeze(directories),
    files: Object.freeze(files), totalBytes: source.totalBytes,
  });
}

/** Exact canonical UTF-8 upper bound for a future prepared v1 receipt. Paths,
 * hashes and file sizes are actual; unknown target stat fields use the enforced
 * new-observation numeric maxima. No fixed multiplier or native-ABI claim.
 */
export function estimateProjectMovePreparedReceiptBytes(sourceInput: ProjectMoveInventory, targetPath: string): number {
  const copying = snapshotReceipt({ schemaVersion: 1, operationId: sourceInput.source.projectId,
    projectId: sourceInput.source.projectId, phase: 'copying', source: sourceInput,
    targetPath, target: null, cursor: 0, pendingDelete: null });
  assertInventoryWritable(copying.source);
  encodeValidated(copying); // The initial intent must fit too.
  const target = maximumPreparedTarget(copying.source, targetPath);
  const length = target.files.length + target.directories.length;
  const states = [
    { cursor: 0, pendingDelete: null },
    { cursor: length - 1, pendingDelete: length - 1 },
    { cursor: length, pendingDelete: null },
  ];
  return Math.max(...states.map(({ cursor, pendingDelete }) => {
    const receipt = snapshotReceipt({ ...copying, phase: 'prepared', target, cursor, pendingDelete });
    return encodedReceiptBytes(receipt).length;
  }));
}

export function assertProjectMoveReceiptCanPrepare(source: ProjectMoveInventory, targetPath: string): void {
  if (estimateProjectMovePreparedReceiptBytes(source, targetPath) > MAX_MOVE_RECEIPT_BYTES) {
    throw new Error('Project移動の完了receiptが16 MiB上限を超えるため、コピーを開始できません。');
  }
}