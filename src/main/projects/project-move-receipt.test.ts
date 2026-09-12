// @vitest-environment node
import { createHash } from 'node:crypto';
import native from 'node:fs';
import fs, { type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createProjectDirectory, type ProjectDirectoryReceipt, type ProjectFileIdentity } from './project-directory.js';
import { inventoryProjectMove, type ProjectMoveInventory, type ProjectMoveSnapshot } from './project-move.js';
import {
  MAX_MOVE_PROGRESS_BYTES, MAX_MOVE_RECEIPT_BYTES, abortProjectMoveReceipt, assertProjectMoveReceiptCanPrepare,
  assertProjectMoveReceiptCurrent, assertProjectMoveSnapshotWritable, createProjectMoveReceipt, decodeProjectMoveReceipt,
  consolidateProjectMoveReceipt, encodeProjectMoveReceipt, estimateProjectMovePreparedReceiptBytes, finishProjectMoveReceipt,
  getProjectMoveRemovalOrder, readProjectMoveReceipt, updateProjectMoveProgress, updateProjectMoveReceipt, type MoveReceipt,
} from './project-move-receipt.js';

const projectId = 'b66a587d-619c-4cc8-850b-c677f0698311';
const operationId = 'd67f7ea8-b604-4280-ad87-26a1a44df37a';
const otherId = 'ef0c592c-2055-4f68-9c4a-7d7f6cd3ead2';
const markerName = '.autovision-project.json';
const sha256 = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
type Mutable<T> = T extends readonly (infer U)[] ? Mutable<U>[]
  : T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
type Wire<T> = T extends bigint ? string : T extends readonly (infer U)[] ? Wire<U>[]
  : T extends object ? { -readonly [K in keyof T]: Wire<T[K]> } : T;
interface Envelope { checksum: string; payload: Wire<MoveReceipt> }

// Independent JSON-only fixture encoder, deliberately able to rehash INVALID
// payloads. Production's validator is never used to manufacture a negative case.
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
      return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
    }
    return item;
  });
}
function wire(receipt: MoveReceipt): Envelope {
  return JSON.parse(encodeProjectMoveReceipt(receipt).toString('utf8')) as Envelope;
}
function rehash(envelope: Envelope): Buffer {
  envelope.checksum = sha256(canonicalJson(envelope.payload));
  return Buffer.from(JSON.stringify(envelope), 'utf8');
}
function rejectRehashed(receipt: MoveReceipt, change: (payload: Wire<MoveReceipt>) => void): void {
  const envelope = wire(receipt);
  change(envelope.payload);
  const bytes = rehash(envelope);
  expect(envelope.checksum).toBe(sha256(canonicalJson(envelope.payload)));
  expect(() => decodeProjectMoveReceipt(bytes)).toThrow(/receipt/);
}
function mutable<T>(value: T): Mutable<T> { return structuredClone(value) as Mutable<T>; }
function expectDeepFrozen(value: unknown): void {
  if (value !== null && typeof value === 'object') {
    expect(Object.isFrozen(value)).toBe(true);
    for (const child of Object.values(value)) expectDeepFrozen(child);
  }
}

function maximumTargetFixture(source: ProjectMoveInventory, targetPath: string): ProjectMoveInventory {
  const u64 = (1n << 64n) - 1n;
  const u128 = (1n << 128n) - 1n;
  const i128 = -(1n << 127n);
  let index = 0n;
  const identity = (): ProjectFileIdentity => ({ dev: String(u64), ino: String(u128 - index++), birthtimeNs: String(i128) });
  const directorySnapshot = (): ProjectMoveSnapshot => ({
    identity: identity(), sizeBytes: u64, mtimeNs: i128, ctimeNs: i128, nlink: u64,
  });
  const fileSnapshot = (sizeBytes: bigint): ProjectMoveSnapshot => ({
    identity: identity(), sizeBytes, mtimeNs: i128, ctimeNs: i128, nlink: 1n,
  });
  const directories = source.directories.map((entry) => ({ relativePath: entry.relativePath, pathSnapshot: directorySnapshot() }));
  const files = source.files.map((entry) => {
    const pathSnapshot = fileSnapshot(entry.sizeBytes);
    return { relativePath: entry.relativePath, pathSnapshot, handleSnapshot: pathSnapshot,
      sizeBytes: entry.sizeBytes, sha256: entry.sha256 };
  });
  const marker = files.find((entry) => entry.relativePath === markerName)!;
  return { source: { rootPath: targetPath, projectId: source.source.projectId,
    rootIdentity: directories[0]!.pathSnapshot.identity, markerIdentity: marker.pathSnapshot.identity },
  protectedRoots: [source.source.rootPath, ...source.protectedRoots], directories, files, totalBytes: source.totalBytes };
}

function longProtectedRoot(index: number): string {
  let path = `C:\\R14-${String(index).padStart(3, '0')}`;
  while (path.length < 32_000) {
    const length = Math.min(255, 32_000 - path.length - 1);
    if (length <= 0) break;
    path += `\\${'x'.repeat(length)}`;
  }
  return path;
}

describe.skipIf(process.platform !== 'win32')('CORE-06E1a fixed move receipt (isolated Windows roots)', () => {
  let temporary: string;
  let directory: string;
  let receiptPath: string;
  let progressPath: string;
  let source: ProjectDirectoryReceipt;
  let inventory: ProjectMoveInventory;
  let targetParent: string;
  let targetPath: string;
  let original: string;
  const handles: FileHandle[] = [];

  const populate = async (root: string) => {
    await fs.mkdir(join(root, 'images', 'empty'), { recursive: true });
    await fs.writeFile(join(root, 'images', 'data.bin'), 'AAAA');
    await fs.writeFile(join(root, 'top.txt'), 'AAAA');
  };
  beforeEach(async () => {
    temporary = native.realpathSync.native(await fs.mkdtemp(join(tmpdir(), 'autovision-e1a-')));
    directory = join(temporary, 'app-data', 'project-moves');
    await fs.mkdir(directory, { recursive: true });
    receiptPath = join(directory, `${projectId}.json`);
    progressPath = join(directory, `${projectId}.progress.json`);
    const parent = join(temporary, 'source');
    targetParent = join(temporary, 'destination');
    original = join(temporary, 'original');
    for (const path of [parent, targetParent, original]) await fs.mkdir(path);
    await fs.writeFile(join(original, 'keep.txt'), 'ORIGINAL');
    source = createProjectDirectory(parent, projectId, [original]);
    await populate(source.rootPath);
    inventory = await inventoryProjectMove(source, [original]);
    targetPath = join(targetParent, projectId);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    for (const handle of handles.splice(0)) if (handle.fd !== -1) await handle.close();
    // Disposable fixture root AND all link targets only. Not production cleanup.
    if (temporary) await fs.rm(temporary, { recursive: true, force: true });
  });

  const copying = (): MoveReceipt => ({ schemaVersion: 1, operationId, projectId, phase: 'copying',
    source: inventory, targetPath, target: null, cursor: 0, pendingDelete: null });
  const prepared = async (): Promise<MoveReceipt> => {
    const target = createProjectDirectory(targetParent, projectId, [source.rootPath, original]);
    // Independently write the same small bytes, not an asset copy or full mover run.
    await populate(target.rootPath);
    const targetInventory = await inventoryProjectMove(target, [source.rootPath, original]);
    return { ...copying(), phase: 'prepared', target: targetInventory };
  };
  const create = () => createProjectMoveReceipt(directory, operationId, inventory, targetPath);
  const read = () => readProjectMoveReceipt(directory, projectId, source.rootPath);
  const assertSourcePreserved = async () => {
    expect(await fs.readFile(join(source.rootPath, 'images', 'data.bin'), 'utf8')).toBe('AAAA');
    expect(await fs.readFile(join(source.rootPath, 'top.txt'), 'utf8')).toBe('AAAA');
    expect(await fs.readdir(join(source.rootPath, 'images', 'empty'))).toEqual([]);
    expect(await fs.readFile(join(source.rootPath, markerName), 'utf8'))
      .toBe(`${JSON.stringify({ schemaVersion: 1, projectId })}\n`);
    expect(await fs.readFile(join(original, 'keep.txt'), 'utf8')).toBe('ORIGINAL');
  };
  const interceptOpen = (configure: (handle: FileHandle, path: string, flags: string | number) => void) => {
    const open = fs.open.bind(fs);
    return vi.spyOn(fs, 'open').mockImplementation(async (path, flags, mode) => {
      const handle = await open(path, flags, mode);
      handles.push(handle);
      configure(handle, String(path), flags ?? 'r');
      return handle;
    });
  };

  it('round-trips copying and prepared BigInts, with matching bytes but different copy identities', async () => {
    const complete = await prepared();
    expect(complete.target!.source.rootIdentity).not.toEqual(source.rootIdentity);
    expect(complete.target!.source.markerIdentity).not.toEqual(source.markerIdentity);
    expect(complete.target!.files[1]!.pathSnapshot.identity).not.toEqual(inventory.files[1]!.pathSnapshot.identity);
    for (const receipt of [copying(), complete, { ...complete, phase: 'copying' as const }]) {
      const bytes = encodeProjectMoveReceipt(receipt);
      const envelope = wire(receipt);
      expect(envelope.checksum).toBe(sha256(canonicalJson(envelope.payload)));
      expect(typeof envelope.payload.source.totalBytes).toBe('string');
      expect(typeof envelope.payload.source.files[0]!.pathSnapshot.mtimeNs).toBe('string');
      const restored = decodeProjectMoveReceipt(bytes);
      expect(restored).toEqual(receipt);
      expect(decodeProjectMoveReceipt(rehash(envelope))).toEqual(receipt);
      expect(typeof restored.source.files[0]!.handleSnapshot.ctimeNs).toBe('bigint');
      expect(typeof restored.source.source.rootIdentity.ino).toBe('string');
      expectDeepFrozen(restored);
    }
    await assertSourcePreserved();
  });

  it('normalizes UUIDs, sorts keys stably, and keeps signed timestamp strings and BigInts exact', () => {
    const value = mutable(copying());
    value.operationId = operationId.toUpperCase();
    value.projectId = projectId.toUpperCase();
    value.source.source.projectId = projectId.toUpperCase();
    value.source.source.rootIdentity.birthtimeNs = '-11644473600000000000';
    value.source.directories[0]!.pathSnapshot.identity.birthtimeNs = value.source.source.rootIdentity.birthtimeNs;
    value.source.directories[0]!.pathSnapshot.mtimeNs = -1n;
    value.source.directories[0]!.pathSnapshot.ctimeNs = -9_007_199_254_740_993n;
    value.source.files[1]!.handleSnapshot.ctimeNs += 100n;
    const bytes = encodeProjectMoveReceipt(value);
    const restored = decodeProjectMoveReceipt(bytes);
    expect(restored.operationId).toBe(operationId);
    expect(restored.projectId).toBe(projectId);
    expect(restored.source.source.projectId).toBe(projectId);
    expect(restored.source.source.rootIdentity.birthtimeNs).toBe('-11644473600000000000');
    expect(restored.source.directories[0]!.pathSnapshot.ctimeNs).toBe(-9_007_199_254_740_993n);
    expect(restored.source.files[1]!.handleSnapshot.ctimeNs).toBe(value.source.files[1]!.handleSnapshot.ctimeNs);
    const reordered = Object.fromEntries(Object.entries(value).reverse()) as unknown as MoveReceipt;
    expect(encodeProjectMoveReceipt(reordered)).toEqual(bytes);
  });

  it('preserves C depth-first sibling ordering rather than a global file-path sort', async () => {
    await fs.mkdir(join(source.rootPath, 'a'));
    await fs.writeFile(join(source.rootPath, 'a', 'z.bin'), 'AAAA');
    await fs.writeFile(join(source.rootPath, 'a.bin'), 'AAAA');
    await fs.writeFile(join(source.rootPath, 'brace{[]}.bin'), 'AAAA');
    const expanded = await inventoryProjectMove(source, [original]);
    const names = expanded.files.map((file) => file.relativePath);
    expect(names.indexOf('a/z.bin')).toBeLessThan(names.indexOf('a.bin'));
    const value = { ...copying(), source: expanded };
    expect(decodeProjectMoveReceipt(encodeProjectMoveReceipt(value))).toEqual(value);
  });

  it('bounds the wire bytes at exactly 16 MiB including whitespace and never guesses a numeric field', () => {
    const bytes = encodeProjectMoveReceipt(copying());
    const atLimit = Buffer.concat([bytes, Buffer.alloc(MAX_MOVE_RECEIPT_BYTES - bytes.length, 0x20)]);
    expect(decodeProjectMoveReceipt(atLimit)).toEqual(copying());
    expect(() => decodeProjectMoveReceipt(Buffer.concat([atLimit, Buffer.from(' ')]))).toThrow();
    const value = mutable(copying());
    Object.assign(value.source, { totalBytes: String(value.source.totalBytes) });
    expect(() => encodeProjectMoveReceipt(value)).toThrow();
    const identity = mutable(copying());
    Object.assign(identity.source.source.rootIdentity, { ino: BigInt(identity.source.source.rootIdentity.ino) });
    expect(() => encodeProjectMoveReceipt(identity)).toThrow();
  });

  it('R14 matches the independently constructed maximal prepared receipt and includes the longest cursor state', () => {
    const target = maximumTargetFixture(inventory, targetPath);
    const length = target.files.length + target.directories.length;
    const actual = [
      { cursor: 0, pendingDelete: null },
      { cursor: length - 1, pendingDelete: length - 1 },
      { cursor: length, pendingDelete: null },
    ].map(({ cursor, pendingDelete }) => encodeProjectMoveReceipt({ ...copying(), phase: 'prepared', target, cursor, pendingDelete }).length);
    expect(estimateProjectMovePreparedReceiptBytes(inventory, targetPath)).toBe(Math.max(...actual));

    const expanded = mutable(inventory);
    const marker = expanded.files.find((entry) => entry.relativePath === markerName)!;
    const zeroSnapshot = (index: number): ProjectMoveSnapshot => ({ identity: {
      dev: '18446744073709551614', ino: String((1n << 128n) - 200_000n - BigInt(index)), birthtimeNs: '0',
    }, sizeBytes: 0n, mtimeNs: 0n, ctimeNs: 0n, nlink: 1n });
    expanded.directories = [expanded.directories[0]!];
    expanded.files = [marker, ...Array.from({ length: 9_999 }, (_, index) => {
      const snapshot = zeroSnapshot(index);
      return { relativePath: `f${String(index).padStart(5, '0')}`, pathSnapshot: snapshot,
        handleSnapshot: snapshot, sizeBytes: 0n, sha256: '0'.repeat(64) };
    })];
    expanded.totalBytes = marker.sizeBytes;
    const expandedTarget = maximumTargetFixture(expanded, targetPath);
    const expandedLength = expandedTarget.files.length + expandedTarget.directories.length;
    expect(expandedLength).toBe(10_001);
    const pending = encodeProjectMoveReceipt({ ...copying(), source: expanded, phase: 'prepared', target: expandedTarget,
      cursor: expandedLength - 1, pendingDelete: expandedLength - 1 }).length;
    const final = encodeProjectMoveReceipt({ ...copying(), source: expanded, phase: 'prepared', target: expandedTarget,
      cursor: expandedLength, pendingDelete: null }).length;
    expect(pending).toBeGreaterThan(final);
    expect(estimateProjectMovePreparedReceiptBytes(expanded, targetPath)).toBe(pending);
  });

  it('R14 accepts the exact prepared boundary and rejects one additional escaped long path', () => {
    const base = estimateProjectMovePreparedReceiptBytes(inventory, targetPath);
    const sample = longProtectedRoot(0);
    expect(sample).toHaveLength(32_000);
    const perRoot = 2 * (1 + Buffer.byteLength(JSON.stringify(sample), 'utf8'));
    const count = Math.floor((MAX_MOVE_RECEIPT_BYTES - base) / perRoot);
    expect(count).toBeGreaterThan(0);
    const roots = Array.from({ length: count + 1 }, (_, index) => longProtectedRoot(index));
    const under = mutable(inventory);
    under.protectedRoots = [...inventory.protectedRoots, ...roots.slice(0, count)];
    const over = mutable(inventory);
    over.protectedRoots = [...under.protectedRoots, roots[count]!];
    expect(estimateProjectMovePreparedReceiptBytes(under, targetPath)).toBe(base + count * perRoot);
    expect(estimateProjectMovePreparedReceiptBytes(under, targetPath)).toBeLessThanOrEqual(MAX_MOVE_RECEIPT_BYTES);
    expect(() => assertProjectMoveReceiptCanPrepare(under, targetPath)).not.toThrow();
    expect(estimateProjectMovePreparedReceiptBytes(over, targetPath)).toBeGreaterThan(MAX_MOVE_RECEIPT_BYTES);
    expect(() => assertProjectMoveReceiptCanPrepare(over, targetPath)).toThrow(/16 MiB/);
  });

  it('R14 keeps legacy decoding broad while rejecting out-of-policy values for new observations', () => {
    const legacy = mutable(copying());
    const huge = String(1n << 256n);
    legacy.source.source.rootIdentity.dev = huge;
    legacy.source.directories[0]!.pathSnapshot.identity.dev = huge;
    const bytes = encodeProjectMoveReceipt(legacy);
    expect(decodeProjectMoveReceipt(bytes)).toEqual(legacy);
    expect(() => assertProjectMoveSnapshotWritable(legacy.source.directories[0]!.pathSnapshot)).toThrow(/方針/);
    expect(() => estimateProjectMovePreparedReceiptBytes(legacy.source, targetPath)).toThrow(/方針/);
  });

  it.each(['', '{}', '{', '\ufeff{}', 'NaN', 'null', '[[]]', '{"checksum":null,"payload":{}}'])('rejects malformed/missing wire %j', (text) => {
    expect(() => decodeProjectMoveReceipt(Buffer.from(text))).toThrow(/receipt/);
  });
  it('rejects malformed UTF-8 and bounds JSON nesting before deep decode', () => {
    expect(() => decodeProjectMoveReceipt(Buffer.from([0xc0, 0xaf]))).toThrow();
    expect(() => decodeProjectMoveReceipt(Buffer.from('['.repeat(128) + '0' + ']'.repeat(128)))).toThrow();
  });
  it('rejects bad payload checksums and unknown envelope fields', () => {
    const envelope = wire(copying());
    envelope.checksum = '0'.repeat(64);
    expect(() => decodeProjectMoveReceipt(Buffer.from(JSON.stringify(envelope)))).toThrow();
    const unknown = { ...wire(copying()), journal: [] };
    expect(() => decodeProjectMoveReceipt(Buffer.from(JSON.stringify(unknown)))).toThrow();
  });
  it.each(['plain', 'escaped', 'nested', 'envelope'])('rejects %s duplicate JSON keys even with the correct payload hash', (kind) => {
    const bytes = encodeProjectMoveReceipt(copying()).toString('utf8');
    const duplicate = kind === 'plain' ? bytes.replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1')
      : kind === 'escaped' ? bytes.replace('"schemaVersion":1', '"schemaVersion":1,"schema\\u0056ersion":1')
        : kind === 'nested' ? bytes.replace('"nlink":"1"', '"nlink":"1","nlink":"1"')
          : bytes.replace('"checksum":', `"checksum":"${wire(copying()).checksum}","checksum":`);
    expect(duplicate).not.toBe(bytes);
    expect(() => decodeProjectMoveReceipt(Buffer.from(duplicate))).toThrow();
  });

  const corruptions: { name: string; change: (value: Wire<MoveReceipt>) => void }[] = [
    { name: 'unknown receipt field', change: (v) => { Object.assign(v, { config: {} }); } },
    { name: 'unknown inventory field', change: (v) => { Object.assign(v.source, { journal: [] }); } },
    { name: 'unknown root receipt field', change: (v) => { Object.assign(v.source.source, { name: 'not persisted' }); } },
    { name: 'unknown directory field', change: (v) => { Object.assign(v.source.directories[0]!, { deleted: true }); } },
    { name: 'unknown file field', change: (v) => { Object.assign(v.source.files[0]!, { url: 'unused' }); } },
    { name: 'unknown path snapshot field', change: (v) => { Object.assign(v.source.files[0]!.pathSnapshot, { mode: 0 }); } },
    { name: 'unknown handle snapshot field', change: (v) => { Object.assign(v.source.files[0]!.handleSnapshot, { time: 0 }); } },
    { name: 'unknown identity field', change: (v) => { Object.assign(v.source.source.rootIdentity, { key: 'unused' }); } },
    { name: 'missing nullable target', change: (v) => { Reflect.deleteProperty(v, 'target'); } },
    { name: 'missing pendingDelete', change: (v) => { Reflect.deleteProperty(v, 'pendingDelete'); } },
    { name: 'unknown version', change: (v) => { Object.assign(v, { schemaVersion: 2 }); } },
    { name: 'unknown phase', change: (v) => { Object.assign(v, { phase: 'completed' }); } },
    { name: 'invalid operation UUID', change: (v) => { v.operationId = '../operation'; } },
    { name: 'wrong Project UUID', change: (v) => { v.projectId = otherId; } },
    { name: 'wrong source Project UUID', change: (v) => { v.source.source.projectId = otherId; } },
    { name: 'wrong source basename', change: (v) => { v.source.source.rootPath = join(temporary, otherId); } },
    { name: 'wrong target basename', change: (v) => { v.targetPath = join(targetParent, otherId); } },
    { name: 'root identity mismatch', change: (v) => { v.source.source.rootIdentity.ino += '1'; } },
    { name: 'marker identity mismatch', change: (v) => { v.source.source.markerIdentity.ino += '1'; } },
    { name: 'zero inode', change: (v) => { v.source.files[1]!.pathSnapshot.identity.ino = '0'; } },
    { name: 'nonnumeric device', change: (v) => { v.source.files[1]!.pathSnapshot.identity.dev = 'disk'; } },
    { name: 'invalid birthtime', change: (v) => { v.source.files[1]!.pathSnapshot.identity.birthtimeNs = '-0'; } },
    { name: 'duplicate identity', change: (v) => { v.source.files[2]!.pathSnapshot.identity = v.source.files[1]!.pathSnapshot.identity; } },
    { name: 'path/handle identity mismatch', change: (v) => { v.source.files[1]!.handleSnapshot.identity.ino += '1'; } },
    { name: 'path/handle mtime mismatch', change: (v) => { v.source.files[1]!.handleSnapshot.mtimeNs += '1'; } },
    { name: 'file size mismatch', change: (v) => { v.source.files[1]!.sizeBytes = '1'; } },
    { name: 'path/handle size mismatch', change: (v) => { v.source.files[1]!.handleSnapshot.sizeBytes = '1'; } },
    { name: 'path hardlink', change: (v) => { v.source.files[1]!.pathSnapshot.nlink = '2'; } },
    { name: 'handle hardlink', change: (v) => { v.source.files[1]!.handleSnapshot.nlink = '2'; } },
    { name: 'zero directory nlink', change: (v) => { v.source.directories[1]!.pathSnapshot.nlink = '0'; } },
    { name: 'negative total', change: (v) => { v.source.totalBytes = '-1'; } },
    { name: 'wrong total sum', change: (v) => { v.source.totalBytes = String(BigInt(v.source.totalBytes) + 1n); } },
    { name: 'malformed SHA-256', change: (v) => { v.source.files[1]!.sha256 = 'f'.repeat(64) + '\n'; } },
    { name: 'wrong marker hash', change: (v) => { v.source.files[0]!.sha256 = '0'.repeat(64); } },
    { name: 'missing marker', change: (v) => { v.source.files.shift(); v.source.totalBytes = '8'; } },
    { name: 'missing root directory', change: (v) => { v.source.directories.shift(); } },
    { name: 'no files', change: (v) => { v.source.files = []; } },
    { name: 'duplicate root', change: (v) => { v.source.directories.push(v.source.directories[0]!); } },
    { name: 'duplicate file case alias', change: (v) => { v.source.files.push({ ...v.source.files[1]!, relativePath: 'IMAGES/DATA.BIN' }); } },
    { name: 'file/directory case collision', change: (v) => { v.source.files[2]!.relativePath = 'IMAGES'; } },
    { name: 'parent case mismatch', change: (v) => { v.source.files[1]!.relativePath = 'IMAGES/data.bin'; } },
    { name: 'missing parent', change: (v) => { v.source.files[1]!.relativePath = 'missing/data.bin'; } },
    { name: 'directory order reversed', change: (v) => { v.source.directories.reverse(); } },
    { name: 'file order reversed', change: (v) => { v.source.files.reverse(); } },
    { name: 'copying cursor advanced', change: (v) => { v.cursor = 1; } },
    { name: 'copying pending deletion', change: (v) => { v.pendingDelete = 0; } },
    { name: 'prepared without target', change: (v) => { v.phase = 'prepared'; } },
  ];
  it.each(corruptions)('rejects rehashed $name', ({ change }) => { rejectRehashed(copying(), change); });

  it.each(['01', '-0', '+1', '1e3', '1.0', ' 1', '1\n', '1n', '', 'NaN'])('rejects noncanonical decimal %j', (value) => {
    rejectRehashed(copying(), (v) => { v.source.directories[0]!.pathSnapshot.ctimeNs = value; });
  });
  it('rejects JSON numbers in BigInt fields and BigInt-like objects rather than reviving them', () => {
    rejectRehashed(copying(), (v) => { Object.assign(v.source.directories[0]!.pathSnapshot, { mtimeNs: 1 }); });
    rejectRehashed(copying(), (v) => { Object.assign(v.source.directories[0]!.pathSnapshot, { mtimeNs: { bigint: '1' } }); });
  });
  it.each(['../escape', '/absolute', 'images/../escape', 'images//file', 'images\\data.bin',
    'images/./file', 'images/', 'NUL.txt', 'conin$', 'COM¹.bin', 'a:stream', 'trail.', 'trail ',
    'bad\nname', '\ud800', 'x'.repeat(256)])('rejects unsafe relative path case %#', (path) => {
    rejectRehashed(copying(), (v) => { v.source.files[1]!.relativePath = path; });
  });
  it.each(['C:relative', 'C:/root', '\\\\server\\share\\root', '\\\\?\\C:\\root', '\\\\.\\C:\\root',
    'C:\\before\\..\\root', 'C:\\before\\.\\root', 'C:\\before\\\\root', 'C:\\NUL\\root',
    'C:\\root.\\child', 'C:\\root \\child', 'C:\\root:stream\\child', 'C:\\bad\nroot'])('rejects noncanonical local root case %#', (parent) => {
    rejectRehashed(copying(), (v) => { v.targetPath = `${parent}\\${projectId}`; });
  });
  it('rejects source/target/protected intersections in both directions and folded duplicates', () => {
    rejectRehashed(copying(), (v) => { v.targetPath = source.rootPath.toUpperCase(); });
    rejectRehashed(copying(), (v) => { v.targetPath = join(source.rootPath, projectId); });
    rejectRehashed(copying(), (v) => { v.targetPath = join(original, projectId); });
    for (const root of [source.rootPath, win32.dirname(source.rootPath), join(source.rootPath, 'images')]) {
      rejectRehashed(copying(), (v) => { v.source.protectedRoots = [root]; });
    }
    rejectRehashed(copying(), (v) => { v.source.protectedRoots.push(original.toUpperCase()); });
    rejectRehashed(copying(), (v) => { v.source.protectedRoots.push(`${original}-sibling`, join(original, 'child')); });
    const siblings = mutable(copying());
    siblings.source.protectedRoots = [original, `${source.rootPath}-backup`];
    expect(decodeProjectMoveReceipt(encodeProjectMoveReceipt(siblings))).toEqual(siblings);
  });
  it('enforces matching prepared trees and target protection, not just a self-consistent checksum', async () => {
    const complete = await prepared();
    const changes: ((v: Wire<MoveReceipt>) => void)[] = [
      (v) => { v.target!.source.projectId = otherId; },
      (v) => { v.target!.source.rootPath = join(temporary, 'unrelated', projectId); },
      (v) => { v.target!.files[1]!.sha256 = '0'.repeat(64); },
      (v) => { v.target!.files[2]!.relativePath = 'zzz.txt'; },
      (v) => { v.target!.directories[2]!.relativePath = 'images/other-empty'; },
      (v) => { v.target!.files.reverse(); },
      (v) => { v.target!.directories.reverse(); },
      (v) => { v.target!.protectedRoots = [original]; },
      (v) => { Object.assign(v.target!, { extras: {} }); },
    ];
    for (const change of changes) rejectRehashed(complete, change);
  });
  it('defines bounded deterministic deletion positions, marker then root last, with no removal', async () => {
    const complete = await prepared();
    const unlink = vi.spyOn(fs, 'unlink');
    const rmdir = vi.spyOn(fs, 'rmdir');
    const order = getProjectMoveRemovalOrder(complete);
    expect(order).toEqual([
      { kind: 'file', relativePath: 'images/data.bin' }, { kind: 'file', relativePath: 'top.txt' },
      { kind: 'directory', relativePath: 'images/empty' }, { kind: 'directory', relativePath: 'images' },
      { kind: 'file', relativePath: markerName }, { kind: 'directory', relativePath: '' },
    ]);
    expect(order.length).toBe(inventory.files.length + inventory.directories.length);
    expectDeepFrozen(order);
    for (let cursor = 0; cursor <= order.length; cursor += 1) {
      for (const pendingDelete of cursor < order.length ? [null, cursor] : [null]) {
        const value = { ...complete, cursor, pendingDelete };
        expect(decodeProjectMoveReceipt(encodeProjectMoveReceipt(value))).toEqual(value);
      }
    }
    for (const cursor of [-1, 0.5, order.length + 1, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1]) {
      rejectRehashed(complete, (v) => { v.cursor = cursor; });
    }
    for (const pendingDelete of [-1, 0.5, 1, order.length, Number.MAX_SAFE_INTEGER]) {
      rejectRehashed(complete, (v) => { v.pendingDelete = pendingDelete; });
    }
    rejectRehashed(complete, (v) => { v.cursor = order.length; v.pendingDelete = order.length; });
    expect(() => encodeProjectMoveReceipt({ ...complete, cursor: -0 })).toThrow();
    expect(unlink).not.toHaveBeenCalled();
    expect(rmdir).not.toHaveBeenCalled();
    await assertSourcePreserved();
  });

  it('creates only the exclusive intent, flushes/closes, and records actual file identity and raw bytes', async () => {
    const events: string[] = [];
    const open = interceptOpen((handle, path, flags) => {
      if (path !== receiptPath || flags !== 'wx') return;
      const write = handle.writeFile.bind(handle);
      const sync = handle.sync.bind(handle);
      const close = handle.close.bind(handle);
      vi.spyOn(handle, 'writeFile').mockImplementation(async (data, options) => { await write(data, options); events.push('write'); });
      vi.spyOn(handle, 'sync').mockImplementation(async () => { await sync(); events.push('sync'); });
      vi.spyOn(handle, 'close').mockImplementation(async () => { await close(); events.push('close'); });
    });
    const mkdir = vi.spyOn(fs, 'mkdir');
    const result = await create();
    expect(result.receipt).toEqual(copying());
    expect(events).toEqual(['write', 'sync', 'close']);
    expect(open.mock.calls.filter(([, flags]) => flags === 'wx')).toEqual([[receiptPath, 'wx', 0o600]]);
    expect(mkdir).not.toHaveBeenCalled();
    expect(await fs.readdir(directory)).toEqual([`${projectId}.json`]);
    const bytes = await fs.readFile(receiptPath);
    expect(bytes).toEqual(encodeProjectMoveReceipt(copying()));
    expect(result.sha256).toBe(sha256(bytes));
    expect(result.pathSnapshot.identity.ino).toBe(String((await fs.lstat(receiptPath, { bigint: true })).ino));
    expect(result.handleSnapshot.identity).toEqual(result.pathSnapshot.identity);
    expectDeepFrozen(result);
    expect(await fs.readdir(targetParent)).toEqual([]);
    await assertSourcePreserved();
  });
  it('copies input before the first await and never freezes or trusts later caller mutations', async () => {
    const input = mutable(inventory);
    const pending = createProjectMoveReceipt(directory, operationId, input, targetPath);
    input.files[1]!.sha256 = '0'.repeat(64);
    input.source.rootIdentity.ino = '0';
    input.protectedRoots.push(source.rootPath);
    const result = await pending;
    expect(result.receipt).toEqual(copying());
    expect(Object.isFrozen(input)).toBe(false);
    expect(() => Reflect.set(result.receipt.source.files[1]!, 'sha256', '0'.repeat(64))).not.toThrow();
    expect(Reflect.set(result.receipt.source.files[1]!, 'sha256', '0'.repeat(64))).toBe(false);
    expect((await read())!.receipt).toEqual(copying());
  });
  it('refuses an existing receipt for either the same or another operation without overwriting it', async () => {
    await create();
    const originalBytes = await fs.readFile(receiptPath);
    const unlink = vi.spyOn(fs, 'unlink');
    for (const id of [operationId, otherId]) {
      await expect(createProjectMoveReceipt(directory, id, inventory, targetPath)).rejects.toMatchObject({ code: 'EEXIST' });
      expect(await fs.readFile(receiptPath)).toEqual(originalBytes);
    }
    expect(unlink).not.toHaveBeenCalled();
  });
  it.each(['write', 'sync', 'close'])('retains its own unresolved receipt on create %s failure and closes the real handle', async (stage) => {
    interceptOpen((handle, path, flags) => {
      if (path !== receiptPath || flags !== 'wx') return;
      const failure = new Error(`injected ${stage}`);
      if (stage === 'write') {
        const write = handle.writeFile.bind(handle);
        vi.spyOn(handle, 'writeFile').mockImplementationOnce(async () => { await write('partial'); throw failure; });
      }
      if (stage === 'sync') vi.spyOn(handle, 'sync').mockRejectedValueOnce(failure);
      if (stage === 'close') {
        const close = handle.close.bind(handle);
        vi.spyOn(handle, 'close').mockImplementationOnce(async () => { await close(); throw failure; });
      }
    });
    const unlink = vi.spyOn(fs, 'unlink');
    await expect(create()).rejects.toBeInstanceOf(AggregateError);
    expect(handles[0]!.fd).toBe(-1);
    expect((await fs.lstat(receiptPath)).isFile()).toBe(true);
    expect(unlink).not.toHaveBeenCalled();
    await expect(create()).rejects.toMatchObject({ code: 'EEXIST' });
    await assertSourcePreserved();
  });

  it('returns undefined only for an absent expected file in an existing ordinary managed directory', async () => {
    const open = vi.spyOn(fs, 'open');
    const mkdir = vi.spyOn(fs, 'mkdir');
    expect(await read()).toBeUndefined();
    expect(open).not.toHaveBeenCalled();
    expect(mkdir).not.toHaveBeenCalled();
    const missing = join(temporary, 'missing', 'project-moves');
    await expect(readProjectMoveReceipt(missing, projectId, source.rootPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(createProjectMoveReceipt(missing, operationId, inventory, targetPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(mkdir).not.toHaveBeenCalled();
  });
  it('loads without writes or canonical rewrites and uses raw, not reserialized, file fingerprints', async () => {
    const envelope = wire(copying());
    const raw = Buffer.from(JSON.stringify(envelope, null, 2) + '\r\n');
    await fs.writeFile(receiptPath, raw);
    const open = vi.spyOn(fs, 'open');
    const write = vi.spyOn(fs, 'writeFile');
    const rename = vi.spyOn(fs, 'rename');
    const unlink = vi.spyOn(fs, 'unlink');
    const mkdir = vi.spyOn(fs, 'mkdir');
    const result = await readProjectMoveReceipt(directory.toUpperCase(), projectId.toUpperCase(), source.rootPath.toUpperCase());
    expect(result!.receipt).toEqual(copying());
    expect(result!.sha256).toBe(sha256(raw));
    expect(result!.sha256).not.toBe(sha256(encodeProjectMoveReceipt(copying())));
    expect(await fs.readFile(receiptPath)).toEqual(raw);
    expect(open.mock.calls.every(([path, flags]) => path === receiptPath && flags === 'r')).toBe(true);
    for (const spy of [write, rename, unlink, mkdir]) expect(spy).not.toHaveBeenCalled();
  });
  it('requires the expected Project and a current DB source/target anchor, never copying plus DB target', async () => {
    await create();
    const unrelatedRoot = join(temporary, 'unrelated', projectId);
    await expect(readProjectMoveReceipt(directory, projectId, unrelatedRoot)).rejects.toThrow();
    await expect(readProjectMoveReceipt(directory, projectId, targetPath)).rejects.toThrow();
    const raw = await fs.readFile(receiptPath);
    await fs.writeFile(join(directory, `${otherId}.json`), raw);
    await expect(readProjectMoveReceipt(directory, otherId, join(temporary, otherId))).rejects.toThrow();
    const complete = await prepared();
    await fs.writeFile(receiptPath, encodeProjectMoveReceipt(complete));
    expect((await read())!.receipt).toEqual(complete);
    expect((await readProjectMoveReceipt(directory, projectId, targetPath))!.receipt).toEqual(complete);
    await fs.writeFile(receiptPath, encodeProjectMoveReceipt({ ...complete, pendingDelete: 0 }));
    await expect(read()).rejects.toThrow();
    expect((await readProjectMoveReceipt(directory, projectId, targetPath))!.receipt.pendingDelete).toBe(0);
  });
  it('can read the future completed cursor with a removed source, without opening inventory payloads', async () => {
    const complete = await prepared();
    const finished = { ...complete, cursor: getProjectMoveRemovalOrder(complete).length };
    await fs.writeFile(receiptPath, encodeProjectMoveReceipt(finished));
    // Simulate a future E2 outcome strictly inside this disposable fixture.
    await fs.rm(source.rootPath, { recursive: true });
    const open = vi.spyOn(fs, 'open');
    expect((await readProjectMoveReceipt(directory, projectId, targetPath))!.receipt).toEqual(finished);
    expect(open.mock.calls.every(([path, flags]) => path === receiptPath && flags === 'r')).toBe(true);
  });
  it.each(['open', 'read'])('propagates %s ENOENT after an observed file instead of returning undefined', async (stage) => {
    await create();
    const failure = Object.assign(new Error('injected disappeared file'), { code: 'ENOENT' });
    if (stage === 'open') vi.spyOn(fs, 'open').mockRejectedValueOnce(failure);
    else interceptOpen((handle, path) => { if (path === receiptPath) vi.spyOn(handle, 'read').mockRejectedValueOnce(failure); });
    await expect(read()).rejects.toBe(failure);
  });
  it('does not hide access errors or malformed existing receipts as missing', async () => {
    await fs.writeFile(receiptPath, '{}');
    await expect(read()).rejects.toThrow();
    const lstat = fs.lstat.bind(fs);
    const failure = Object.assign(new Error('denied'), { code: 'EACCES' });
    vi.spyOn(fs, 'lstat').mockImplementation((async (path, options) => {
      if (path === receiptPath) throw failure;
      return lstat(path, options);
    }) as typeof fs.lstat);
    await expect(read()).rejects.toBe(failure);
  });

  it('updates prepared then pending/cursor using a guarded rename and the NEW inode fingerprint', async () => {
    const first = await create();
    const complete = await prepared();
    const rename = vi.spyOn(native, 'renameSync');
    const next = await updateProjectMoveReceipt(first, complete, source.rootPath);
    expect(rename).toHaveBeenCalledOnce();
    expect(rename.mock.calls[0]![1]).toBe(receiptPath);
    expect(win32.dirname(String(rename.mock.calls[0]![0]))).toBe(directory);
    expect(next.pathSnapshot.identity).not.toEqual(first.pathSnapshot.identity);
    expect(next.pathSnapshot.identity.ino).toBe(String((await fs.lstat(receiptPath, { bigint: true })).ino));
    const loaded = await readProjectMoveReceipt(directory, projectId, targetPath);
    const pending = await updateProjectMoveReceipt(loaded!, { ...complete, pendingDelete: 0 }, targetPath);
    const advanced = await updateProjectMoveReceipt(pending, { ...complete, cursor: 1, pendingDelete: null }, targetPath);
    expect(advanced.receipt.cursor).toBe(1);
    expect(advanced.sha256).toBe(sha256(await fs.readFile(receiptPath)));
    expect((await readProjectMoveReceipt(directory, projectId, targetPath))!.receipt).toEqual(advanced.receipt);
    await expect(updateProjectMoveReceipt(first, complete, source.rootPath)).rejects.toThrow();
    // Cursor saving is NOT deletion authority; this test deliberately deletes nothing.
    await assertSourcePreserved();
  });
  it('R13 keeps the prepared base immutable, bounds every progress write, and consolidates it exactly once', async () => {
    const first = await create();
    const complete = await prepared();
    let stored = await updateProjectMoveReceipt(first, complete, source.rootPath);
    const base = await fs.readFile(receiptPath);
    const baseIdentity = (await fs.lstat(receiptPath, { bigint: true })).ino;
    const writeLengths: number[] = [];
    let baseReads = 0;
    interceptOpen((handle, path, flags) => {
      if (path === receiptPath && flags === 'r') { baseReads += 1; return; }
      if (flags !== 'wx' || !win32.basename(path).startsWith('.autovision-')) return;
      const write = handle.writeFile.bind(handle);
      vi.spyOn(handle, 'writeFile').mockImplementation(async (data, options) => {
        if (!Buffer.isBuffer(data)) throw new Error('R13 fixture expected binary progress bytes');
        writeLengths.push(data.length);
        await write(data, options);
      });
    });
    const order = getProjectMoveRemovalOrder(complete);
    for (let cursor = 0; cursor < order.length; cursor += 1) {
      stored = await updateProjectMoveProgress(stored, cursor, cursor, targetPath);
      const entry = order[cursor]!;
      const path = join(source.rootPath, entry.relativePath);
      if (entry.kind === 'file') await fs.unlink(path);
      else await fs.rmdir(path);
      stored = await updateProjectMoveProgress(stored, cursor + 1, null, targetPath);
      expect(await fs.readFile(receiptPath)).toEqual(base);
      expect((await fs.lstat(receiptPath, { bigint: true })).ino).toBe(baseIdentity);
    }
    expect(baseReads).toBe(0);
    expect(writeLengths).toHaveLength(order.length * 2);
    expect(Math.max(...writeLengths)).toBeLessThanOrEqual(MAX_MOVE_PROGRESS_BYTES);
    expect((await fs.readFile(progressPath)).length).toBeLessThanOrEqual(MAX_MOVE_PROGRESS_BYTES);
    expect(decodeProjectMoveReceipt(await fs.readFile(receiptPath))).toMatchObject({ cursor: 0, pendingDelete: null });
    expect((await readProjectMoveReceipt(directory, projectId, targetPath))!.receipt)
      .toMatchObject({ cursor: order.length, pendingDelete: null });
    expect(baseReads).toBe(1);

    stored = await consolidateProjectMoveReceipt(stored, targetPath);
    expect(baseReads).toBe(3); // One validation read plus one installed-base read, independent of item count.
    expect(writeLengths).toHaveLength(order.length * 2 + 1);
    expect(writeLengths.slice(0, -1).every((length) => length <= MAX_MOVE_PROGRESS_BYTES)).toBe(true);
    expect(writeLengths.at(-1)).toBe(encodeProjectMoveReceipt(stored.receipt).length);
    expect((await fs.lstat(receiptPath, { bigint: true })).ino).not.toBe(baseIdentity);
    expect(decodeProjectMoveReceipt(await fs.readFile(receiptPath)))
      .toMatchObject({ cursor: order.length, pendingDelete: null });
    expect(native.existsSync(progressPath)).toBe(true);
    const readsBeforeReopen = baseReads;
    const reopened = (await readProjectMoveReceipt(directory, projectId, targetPath))!;
    expect(baseReads).toBe(readsBeforeReopen + 1);
    expect(reopened.receipt).toEqual(stored.receipt);
    expect(() => finishProjectMoveReceipt(reopened, targetPath)).not.toThrow();
    expect(native.existsSync(receiptPath)).toBe(false);
    expect(native.existsSync(progressPath)).toBe(false);
  });

  it('R13 rejects an orphan progress file before read or a replacement base create', async () => {
    const first = await create();
    const complete = await prepared();
    const ready = await updateProjectMoveReceipt(first, complete, source.rootPath);
    await updateProjectMoveProgress(ready, 0, 0, targetPath);
    const progress = await fs.readFile(progressPath);
    await fs.unlink(receiptPath);
    const open = vi.spyOn(fs, 'open');
    await expect(readProjectMoveReceipt(directory, projectId, targetPath)).rejects.toThrow(/変更/);
    await expect(create()).rejects.toThrow(/変更/);
    expect(open.mock.calls.some(([path, flags]) => path === receiptPath && flags === 'wx')).toBe(false);
    expect(await fs.readFile(progressPath)).toEqual(progress);
    await assertSourcePreserved();
  });

  it('R13 rejects same-byte progress replacement without changing the immutable base', async () => {
    const first = await create();
    const complete = await prepared();
    const ready = await updateProjectMoveReceipt(first, complete, source.rootPath);
    const stored = await updateProjectMoveProgress(ready, 0, 0, targetPath);
    const base = await fs.readFile(receiptPath);
    const progress = await fs.readFile(progressPath);
    await fs.rename(progressPath, join(directory, 'retained-progress.json'));
    await fs.writeFile(progressPath, progress, { flag: 'wx' });
    expect(() => assertProjectMoveReceiptCurrent(stored)).toThrow(/変更/);
    await expect(updateProjectMoveProgress(stored, 0, 0, targetPath)).rejects.toThrow(/変更/);
    expect(await fs.readFile(receiptPath)).toEqual(base);
    expect(await fs.readFile(progressPath)).toEqual(progress);
    await assertSourcePreserved();
  });

  it('R13 rejects a same-byte base replacement during progress read before issuing a combined capability', async () => {
    const first = await create();
    const complete = await prepared();
    const ready = await updateProjectMoveReceipt(first, complete, source.rootPath);
    await updateProjectMoveProgress(ready, 0, 0, targetPath);
    const base = await fs.readFile(receiptPath);
    const progress = await fs.readFile(progressPath);
    const retained = join(directory, 'retained-base.json');
    let replaced = false;
    interceptOpen((handle, path, flags) => {
      if (path !== progressPath || flags !== 'r') return;
      const close = handle.close.bind(handle);
      vi.spyOn(handle, 'close').mockImplementationOnce(async () => {
        await close();
        native.renameSync(receiptPath, retained);
        native.writeFileSync(receiptPath, base, { flag: 'wx' });
        replaced = true;
      });
    });
    await expect(readProjectMoveReceipt(directory, projectId, targetPath)).rejects.toThrow(/変更/);
    expect(replaced).toBe(true);
    expect(await fs.readFile(receiptPath)).toEqual(base);
    expect(await fs.readFile(retained)).toEqual(base);
    expect(await fs.readFile(progressPath)).toEqual(progress);
    await assertSourcePreserved();
  });

  it('R13 binds progress to the exact prepared base bytes and rejects a whitespace rewrite', async () => {
    const first = await create();
    const complete = await prepared();
    const ready = await updateProjectMoveReceipt(first, complete, source.rootPath);
    await updateProjectMoveProgress(ready, 0, 0, targetPath);
    const progress = await fs.readFile(progressPath);
    const rewritten = Buffer.from(JSON.stringify(wire(complete), null, 2) + '\r\n');
    expect(decodeProjectMoveReceipt(rewritten)).toEqual(complete);
    expect(sha256(rewritten)).not.toBe(ready.sha256);
    await fs.writeFile(receiptPath, rewritten);
    await expect(readProjectMoveReceipt(directory, projectId, targetPath)).rejects.toThrow(/変更/);
    expect(await fs.readFile(receiptPath)).toEqual(rewritten);
    expect(await fs.readFile(progressPath)).toEqual(progress);
    await assertSourcePreserved();
  });

  it.each(['malformed', 'oversized', 'case-alias'] as const)
    ('R13 rejects a %s progress file without changing the prepared base or source', async (kind) => {
      const first = await create();
      const complete = await prepared();
      const ready = await updateProjectMoveReceipt(first, complete, source.rootPath);
      await updateProjectMoveProgress(ready, 0, 0, targetPath);
      const base = await fs.readFile(receiptPath);
      if (kind === 'malformed') await fs.writeFile(progressPath, '{}');
      if (kind === 'oversized') await fs.truncate(progressPath, MAX_MOVE_PROGRESS_BYTES + 1);
      if (kind === 'case-alias') {
        await fs.rename(progressPath, join(directory, `${projectId.toUpperCase()}.PROGRESS.JSON`));
      }
      const open = vi.spyOn(fs, 'open');
      await expect(readProjectMoveReceipt(directory, projectId, targetPath)).rejects.toThrow();
      expect(await fs.readFile(receiptPath)).toEqual(base);
      if (kind === 'oversized' || kind === 'case-alias') {
        expect(open.mock.calls.some(([path, flags]) => path === progressPath && flags === 'r')).toBe(false);
      }
      await assertSourcePreserved();
    });
  it('does not treat an arbitrary lookalike snapshot as an update capability', async () => {
    const stored = await create();
    const open = vi.spyOn(fs, 'open');
    await expect(updateProjectMoveReceipt({ ...stored }, stored.receipt, source.rootPath)).rejects.toThrow();
    expect(open).not.toHaveBeenCalled();
  });
  it('rejects operation/source/target replacement, phase regression and cursor jumps without writing', async () => {
    const first = await create();
    const complete = await prepared();
    const replacementSource = mutable(complete);
    replacementSource.source.directories[1]!.pathSnapshot.ctimeNs += 1n;
    for (const next of [{ ...complete, operationId: otherId }, replacementSource,
      { ...copying(), targetPath: join(temporary, 'another', projectId) }]) {
      await expect(updateProjectMoveReceipt(first, next, source.rootPath)).rejects.toThrow();
    }
    const stored = await updateProjectMoveReceipt(first, complete, source.rootPath);
    const before = await fs.readFile(receiptPath);
    const changedTarget = mutable(complete);
    changedTarget.target!.directories[1]!.pathSnapshot.ctimeNs += 1n;
    for (const next of [copying(), changedTarget, { ...complete, cursor: 1 }, { ...complete, cursor: 2, pendingDelete: 2 }]) {
      await expect(updateProjectMoveReceipt(stored, next, targetPath)).rejects.toThrow();
    }
    await expect(updateProjectMoveReceipt(stored, { ...complete, pendingDelete: 0 }, source.rootPath)).rejects.toThrow();
    expect(await fs.readFile(receiptPath)).toEqual(before);
    const pending = await updateProjectMoveReceipt(stored, { ...complete, pendingDelete: 0 }, targetPath);
    await expect(updateProjectMoveReceipt(pending, complete, targetPath)).rejects.toThrow();
    await assertSourcePreserved();
  });
  it('snapshots an update before await and rejects concurrent same-file updates', async () => {
    const first = await create();
    const complete = await prepared();
    const next = mutable(complete);
    const pending = updateProjectMoveReceipt(first, next, source.rootPath);
    next.target!.files[1]!.sha256 = '0'.repeat(64);
    await expect(updateProjectMoveReceipt(first, complete, source.rootPath)).rejects.toThrow(/更新中/);
    expect((await pending).receipt).toEqual(complete);
    expect((await read())!.receipt).toEqual(complete);
  });
  it.each(['same-length edit', 'whitespace rewrite', 'identical-byte replacement', 'missing'])('refuses update after %s of the stored receipt', async (kind) => {
    const first = await create();
    const complete = await prepared();
    const old = await fs.readFile(receiptPath);
    if (kind === 'same-length edit') await fs.writeFile(receiptPath, old.toString('utf8').replace(operationId, otherId));
    if (kind === 'whitespace rewrite') await fs.writeFile(receiptPath, JSON.stringify(wire(copying()), null, 2));
    if (kind === 'identical-byte replacement') {
      await fs.rename(receiptPath, join(directory, 'retained.json'));
      await fs.writeFile(receiptPath, old, { flag: 'wx' });
    }
    if (kind === 'missing') await fs.unlink(receiptPath);
    const current = kind === 'missing' ? undefined : await fs.readFile(receiptPath);
    const rename = vi.spyOn(native, 'renameSync');
    await expect(updateProjectMoveReceipt(first, complete, source.rootPath)).rejects.toThrow();
    expect(rename).not.toHaveBeenCalled();
    if (current) expect(await fs.readFile(receiptPath)).toEqual(current);
    else await expect(fs.lstat(receiptPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await assertSourcePreserved();
  });
  it.each(['write', 'sync', 'rename'])('preserves the old receipt on atomic update %s failure', async (stage) => {
    const first = await create();
    const complete = await prepared();
    const old = await fs.readFile(receiptPath);
    const failure = new Error(`injected atomic ${stage}`);
    if (stage === 'rename') vi.spyOn(native, 'renameSync').mockImplementationOnce(() => { throw failure; });
    else interceptOpen((handle, path, flags) => {
      if (flags !== 'wx' || !win32.basename(path).startsWith('.autovision-')) return;
      if (stage === 'write') vi.spyOn(handle, 'writeFile').mockRejectedValueOnce(failure);
      else vi.spyOn(handle, 'sync').mockRejectedValueOnce(failure);
    });
    await expect(updateProjectMoveReceipt(first, complete, source.rootPath)).rejects.toThrow(/injected atomic/);
    expect(await fs.readFile(receiptPath)).toEqual(old);
    expect(await fs.readdir(directory)).toEqual([`${projectId}.json`]);
    expect((await read())!.receipt).toEqual(copying());
    await assertSourcePreserved();
  });

  it('refuses managed directories inside source, target or protected roots before any writer opens', async () => {
    for (const path of [join(source.rootPath, 'project-moves'), join(targetPath, 'project-moves'), join(original, 'project-moves')]) {
      await fs.mkdir(path, { recursive: true });
      const open = vi.spyOn(fs, 'open');
      await expect(createProjectMoveReceipt(path.toUpperCase(), operationId, inventory, targetPath)).rejects.toThrow();
      expect(open).not.toHaveBeenCalled();
      open.mockRestore();
      expect(await fs.readdir(path)).toEqual([]);
    }
  });
  it('also rejects managed directories containing owned or protected roots', async () => {
    const sourceInside = mutable(inventory);
    sourceInside.source.rootPath = join(directory, projectId);
    const protectedInside = mutable(inventory);
    protectedInside.protectedRoots = [join(directory, 'original')];
    const open = vi.spyOn(fs, 'open');
    await expect(createProjectMoveReceipt(directory, operationId, inventory, join(directory, projectId))).rejects.toThrow();
    await expect(createProjectMoveReceipt(directory, operationId, sourceInside, targetPath)).rejects.toThrow();
    await expect(createProjectMoveReceipt(directory, operationId, protectedInside, targetPath)).rejects.toThrow();
    expect(open).not.toHaveBeenCalled();
    expect(await fs.readdir(directory)).toEqual([]);
  });
  it('rejects unmanaged names, traversal/separator aliases and a noncanonical realpath', async () => {
    const open = vi.spyOn(fs, 'open');
    for (const path of [temporary, `${directory}\\`, `${directory}\\..\\project-moves`, directory.replaceAll('\\', '/')]) {
      await expect(createProjectMoveReceipt(path, operationId, inventory, targetPath)).rejects.toThrow();
    }
    const realpath = fs.realpath.bind(fs);
    vi.spyOn(fs, 'realpath').mockImplementation(async (path) => path === directory
      ? join(temporary, 'different', 'project-moves') : realpath(path));
    await expect(create()).rejects.toThrow();
    expect(open).not.toHaveBeenCalled();
  });
  it('rejects an ancestor junction for read/create and never follows its receipt file', async () => {
    await create();
    const alias = join(temporary, 'alias');
    await fs.symlink(win32.dirname(directory), alias, 'junction');
    const path = join(alias, 'project-moves');
    const open = vi.spyOn(fs, 'open');
    await expect(readProjectMoveReceipt(path, projectId, source.rootPath)).rejects.toThrow(/リンク/);
    await expect(createProjectMoveReceipt(path, operationId, inventory, targetPath)).rejects.toThrow(/リンク/);
    expect(open).not.toHaveBeenCalled();
  });
  it('rejects junctions in declared owned/protected ancestors before writes', async () => {
    const alias = join(temporary, 'alias');
    await fs.symlink(targetParent, alias, 'junction');
    const open = vi.spyOn(fs, 'open');
    await expect(createProjectMoveReceipt(directory, operationId, inventory, join(alias, projectId))).rejects.toThrow(/リンク/);
    expect(open).not.toHaveBeenCalled();
    const protectedAlias = mutable(inventory);
    protectedAlias.protectedRoots = [alias];
    await expect(createProjectMoveReceipt(directory, operationId, protectedAlias, targetPath)).rejects.toThrow(/リンク/);
    expect(open).not.toHaveBeenCalled();
  });
  for (const kind of ['hardlink', 'symlink', 'directory'] as const) {
    it(`refuses receipt ${kind} before opening it`, async ({ skip }) => {
      const target = join(temporary, 'linked-receipt.json');
      await fs.writeFile(target, encodeProjectMoveReceipt(copying()));
      try {
        if (kind === 'hardlink') await fs.link(target, receiptPath);
        else if (kind === 'symlink') await fs.symlink(target, receiptPath, 'file');
        else await fs.mkdir(receiptPath);
      } catch (error) {
        if (kind === 'symlink' && (error as NodeJS.ErrnoException).code === 'EPERM') { skip(); return; }
        throw error;
      }
      const open = vi.spyOn(fs, 'open');
      await expect(read()).rejects.toThrow(/リンク|非通常|hardlink/);
      expect(open).not.toHaveBeenCalled();
      expect(await fs.readFile(target)).toEqual(encodeProjectMoveReceipt(copying()));
    });
  }
  it('rejects oversized or empty files before allocating/reading their contents', async () => {
    await fs.writeFile(receiptPath, '');
    const open = vi.spyOn(fs, 'open');
    await expect(read()).rejects.toThrow();
    await fs.truncate(receiptPath, MAX_MOVE_RECEIPT_BYTES + 1);
    await expect(read()).rejects.toThrow();
    expect(open).not.toHaveBeenCalled();
  });
  it('rejects case-aliased receipt names and duplicate Windows spellings without creating a second record', async () => {
    const upper = join(directory, `${projectId.toUpperCase()}.json`);
    await fs.writeFile(upper, encodeProjectMoveReceipt(copying()));
    const open = vi.spyOn(fs, 'open');
    await expect(read()).rejects.toThrow();
    await expect(create()).rejects.toThrow();
    expect(open).not.toHaveBeenCalled();
    expect(await fs.readFile(upper)).toEqual(encodeProjectMoveReceipt(copying()));
    vi.spyOn(fs, 'readdir').mockResolvedValue([`${projectId}.json`, `${projectId.toUpperCase()}.json`] as never);
    await expect(read()).rejects.toThrow();
    expect(open).not.toHaveBeenCalled();
  });
  it('refuses updates after replacement of the managed directory even with identical receipt bytes', async () => {
    const first = await create();
    const complete = await prepared();
    const old = await fs.readFile(receiptPath);
    await fs.rename(directory, join(win32.dirname(directory), 'retained-project-moves'));
    await fs.mkdir(directory);
    await fs.writeFile(receiptPath, old);
    const rename = vi.spyOn(native, 'renameSync');
    await expect(updateProjectMoveReceipt(first, complete, source.rootPath)).rejects.toThrow();
    expect(rename).not.toHaveBeenCalled();
    expect(await fs.readFile(receiptPath)).toEqual(old);
  });
  it.each(['read', 'update'])('detects a replacement at the last reader close during %s and leaves it untouched', async (kind) => {
    const first = await create();
    const complete = await prepared();
    const old = await fs.readFile(receiptPath);
    const retained = join(directory, 'retained.json');
    let replaced = false;
    interceptOpen((handle, path, flags) => {
      if (path !== receiptPath || flags !== 'r') return;
      const close = handle.close.bind(handle);
      vi.spyOn(handle, 'close').mockImplementation(async () => {
        await close();
        if (replaced) return;
        replaced = true;
        native.renameSync(receiptPath, retained);
        native.writeFileSync(receiptPath, old, { flag: 'wx' });
      });
    });
    const rename = vi.spyOn(native, 'renameSync');
    await expect(kind === 'read' ? read() : updateProjectMoveReceipt(first, complete, source.rootPath)).rejects.toThrow();
    expect(replaced).toBe(true);
    expect(rename.mock.calls.filter(([, destination]) => destination === receiptPath)).toEqual([]);
    expect(await fs.readFile(receiptPath)).toEqual(old);
    expect(await fs.readFile(retained)).toEqual(old);
  });
  it('rechecks the receipt synchronously after the final asynchronous stat, before REL-01', async () => {
    const first = await create();
    const complete = await prepared();
    const old = await fs.readFile(receiptPath);
    let closed = false;
    let replaced = false;
    interceptOpen((handle, path, flags) => {
      if (path !== receiptPath || flags !== 'r') return;
      const close = handle.close.bind(handle);
      vi.spyOn(handle, 'close').mockImplementation(async () => { await close(); closed = true; });
    });
    const lstat = fs.lstat.bind(fs);
    vi.spyOn(fs, 'lstat').mockImplementation((async (path, options) => {
      const result = await lstat(path, options);
      if (path === receiptPath && closed && !replaced) {
        replaced = true;
        native.renameSync(receiptPath, join(directory, 'retained.json'));
        native.writeFileSync(receiptPath, old, { flag: 'wx' });
      }
      return result; // The completed async stat observed the PRE-replacement file.
    }) as typeof fs.lstat);
    const rename = vi.spyOn(native, 'renameSync');
    await expect(updateProjectMoveReceipt(first, complete, source.rootPath)).rejects.toThrow(/変更/);
    expect(replaced).toBe(true);
    expect(rename.mock.calls.filter(([, destination]) => destination === receiptPath)).toEqual([]);
    expect(await fs.readFile(receiptPath)).toEqual(old);
    await assertSourcePreserved();
  });
  it('rejects old-receipt replacement during temporary verification before publish', async () => {
    const first = await create();
    const complete = await prepared();
    const old = await fs.readFile(receiptPath);
    const retained = join(directory, 'retained-old.json');
    let replaced = false;
    interceptOpen((handle, path, flags) => {
      if (flags !== 'r' || !win32.basename(path).startsWith('.autovision-')) return;
      const close = handle.close.bind(handle);
      vi.spyOn(handle, 'close').mockImplementationOnce(async () => {
        await close();
        replaced = true;
        native.renameSync(receiptPath, retained);
        native.writeFileSync(receiptPath, old, { flag: 'wx' });
      });
    });
    const publish = vi.spyOn(native, 'renameSync');
    await expect(updateProjectMoveReceipt(first, complete, source.rootPath)).rejects.toThrow(/変更/);
    expect(replaced).toBe(true);
    expect(publish.mock.calls.some(([, destination]) => destination === receiptPath)).toBe(false);
    expect(await fs.readFile(receiptPath)).toEqual(old);
    expect(await fs.readFile(retained)).toEqual(old);
    await assertSourcePreserved();
  });

  it('rejects same-byte destination replacement immediately after receipt publish', async () => {
    const first = await create();
    const complete = await prepared();
    const next = encodeProjectMoveReceipt(complete);
    const retained = join(directory, 'retained-published.json');
    const rename = native.renameSync.bind(native);
    let replaced = false;
    vi.spyOn(native, 'renameSync').mockImplementation((from, to) => {
      rename(from, to);
      if (to === receiptPath && win32.basename(String(from)).startsWith('.autovision-')) {
        replaced = true;
        rename(receiptPath, retained);
        native.writeFileSync(receiptPath, next, { flag: 'wx' });
      }
    });
    await expect(updateProjectMoveReceipt(first, complete, source.rootPath)).rejects.toThrow(/変更/);
    expect(replaced).toBe(true);
    expect(await fs.readFile(receiptPath)).toEqual(next);
    expect(await fs.readFile(retained)).toEqual(next);
    await assertSourcePreserved();
  });
  it.each(['stable', 'settled', 'handle-change', 'path-change'])('uses same-API ctime comparisons: %s', async (kind) => {
    await create();
    let opened = false;
    let pathReads = 0;
    interceptOpen((handle, path, flags) => {
      if (path !== receiptPath || flags !== 'r') return;
      opened = true;
      const stat = handle.stat.bind(handle);
      let calls = 0;
      vi.spyOn(handle, 'stat').mockImplementation((async (options) => {
        const result = await stat(options);
        calls += 1;
        if ('ctimeNs' in result && typeof result.ctimeNs === 'bigint') {
          result.ctimeNs += 100n + (kind === 'handle-change' && calls > 1 ? 1n : 0n);
        }
        return result;
      }) as typeof handle.stat);
    });
    const lstat = fs.lstat.bind(fs);
    vi.spyOn(fs, 'lstat').mockImplementation((async (path, options) => {
      const result = await lstat(path, options);
      if (path === receiptPath && opened && 'ctimeNs' in result && typeof result.ctimeNs === 'bigint') {
        pathReads += 1;
        if (kind === 'settled' || (kind === 'path-change' && pathReads > 1)) result.ctimeNs += 7n;
      }
      return result;
    }) as typeof fs.lstat);
    if (kind === 'stable' || kind === 'settled') await expect(read()).resolves.toMatchObject({ receipt: copying() });
    else await expect(read()).rejects.toThrow(/変更/);
  });

  it('R15A ends only an issued unstarted copying record without touching source or target', async () => {
    const stored = await create();
    const unlink = vi.spyOn(native, 'unlinkSync');
    const asyncUnlink = vi.spyOn(fs, 'unlink');
    const rmdir = vi.spyOn(native, 'rmdirSync');
    expect(abortProjectMoveReceipt(stored, source.rootPath)).toBeUndefined();
    expect(unlink).toHaveBeenCalledExactlyOnceWith(receiptPath);
    expect(asyncUnlink).not.toHaveBeenCalled();
    expect(rmdir).not.toHaveBeenCalled();
    expect(() => assertProjectMoveReceiptCurrent(stored)).toThrow();
    expect(await read()).toBeUndefined();
    expect(await fs.readdir(targetParent)).toEqual([]);
    await assertSourcePreserved();
  });

  it('R15A rejects foreign anchors, copied capabilities and prepared records before unlink', async () => {
    const stored = await create();
    const raw = native.readFileSync(receiptPath);
    const unlink = vi.spyOn(native, 'unlinkSync');
    expect(() => abortProjectMoveReceipt(stored, targetPath)).toThrow();
    expect(() => abortProjectMoveReceipt(stored, join(temporary, 'foreign', projectId))).toThrow();
    expect(() => abortProjectMoveReceipt({ ...stored }, source.rootPath)).toThrow();
    expect(native.readFileSync(receiptPath)).toEqual(raw);
    const complete = await prepared();
    const copyingWithTarget = await updateProjectMoveReceipt(stored, { ...complete, phase: 'copying' }, source.rootPath);
    expect(() => abortProjectMoveReceipt(copyingWithTarget, source.rootPath)).toThrow();
    const ready = await updateProjectMoveReceipt(copyingWithTarget, complete, source.rootPath);
    expect(() => abortProjectMoveReceipt(ready, source.rootPath)).toThrow();
    expect(unlink).not.toHaveBeenCalled();
    await assertSourcePreserved();
  });

  it.each(['record', 'directory'] as const)('R15A retains an identical-byte %s replacement', async (kind) => {
    const stored = await create();
    const raw = native.readFileSync(receiptPath);
    if (kind === 'record') await fs.rename(receiptPath, join(directory, 'retained.json'));
    else {
      await fs.rename(directory, join(win32.dirname(directory), 'retained-project-moves'));
      await fs.mkdir(directory);
    }
    await fs.writeFile(receiptPath, raw, { flag: 'wx' });
    const unlink = vi.spyOn(native, 'unlinkSync');
    expect(() => abortProjectMoveReceipt(stored, source.rootPath)).toThrow(/変更/);
    expect(unlink).not.toHaveBeenCalled();
    expect(native.readFileSync(receiptPath)).toEqual(raw);
    await assertSourcePreserved();
  });

  it('R15A preserves the issued record on unlink failure and refuses an update in flight', async () => {
    const stored = await create();
    const raw = native.readFileSync(receiptPath);
    const unlink = vi.spyOn(native, 'unlinkSync').mockImplementationOnce(() => { throw new Error('injected abort unlink'); });
    expect(() => abortProjectMoveReceipt(stored, source.rootPath)).toThrow(/injected abort unlink/);
    expect(native.readFileSync(receiptPath)).toEqual(raw);
    expect(() => assertProjectMoveReceiptCurrent(stored)).not.toThrow();
    const pending = updateProjectMoveReceipt(stored, stored.receipt, source.rootPath);
    expect(() => abortProjectMoveReceipt(stored, source.rootPath)).toThrow(/更新中/);
    const updated = await pending;
    expect(() => abortProjectMoveReceipt(stored, source.rootPath)).toThrow(/変更/);
    expect(() => abortProjectMoveReceipt(updated, source.rootPath)).not.toThrow();
    expect(unlink.mock.calls).toEqual([[receiptPath], [receiptPath]]);
    await assertSourcePreserved();
  });

  // Receipt-only unit fixture. E2's separate integration tests own the real
  // B/E1b/DB recovery policy; here simulate each acknowledged fixture deletion.
  const fullyConsumed = async () => {
    const first = await create();
    const complete = await prepared();
    let stored = await updateProjectMoveReceipt(first, complete, source.rootPath);
    const order = getProjectMoveRemovalOrder(complete);
    for (let cursor = 0; cursor < order.length; cursor += 1) {
      stored = await updateProjectMoveReceipt(stored, { ...stored.receipt, pendingDelete: cursor }, targetPath);
      const entry = order[cursor]!;
      const path = join(source.rootPath, entry.relativePath);
      if (entry.kind === 'file') await fs.unlink(path);
      else await fs.rmdir(path);
      stored = await updateProjectMoveReceipt(stored, { ...stored.receipt, cursor: cursor + 1, pendingDelete: null }, targetPath);
    }
    expect(native.existsSync(source.rootPath)).toBe(false);
    return stored;
  };

  it('E2 finish synchronously removes only the fully consumed exact managed file using a real read capability', async () => {
    await fullyConsumed();
    const unrelated = join(directory, `${otherId}.json`);
    await fs.writeFile(unrelated, 'unrelated record');
    const loaded = (await readProjectMoveReceipt(directory, projectId, targetPath))!;
    const open = vi.spyOn(fs, 'open');
    const unlink = vi.spyOn(native, 'unlinkSync');
    const asyncUnlink = vi.spyOn(fs, 'unlink');
    const rmdir = vi.spyOn(native, 'rmdirSync');
    const rename = vi.spyOn(fs, 'rename');
    expect(() => assertProjectMoveReceiptCurrent(loaded)).not.toThrow();
    expect(finishProjectMoveReceipt(loaded, targetPath)).toBeUndefined();
    expect(unlink).toHaveBeenCalledExactlyOnceWith(receiptPath);
    for (const spy of [open, asyncUnlink, rmdir, rename]) expect(spy).not.toHaveBeenCalled();
    expect(() => assertProjectMoveReceiptCurrent(loaded)).toThrow();
    expect(await readProjectMoveReceipt(directory, projectId, targetPath)).toBeUndefined();
    expect(native.readFileSync(unrelated, 'utf8')).toBe('unrelated record');
    expect(native.readFileSync(join(targetPath, 'images/data.bin'), 'utf8')).toBe('AAAA');
    expect(native.readFileSync(join(original, 'keep.txt'), 'utf8')).toBe('ORIGINAL');
  });

  it.each(['copying', 'prepared', 'pending'] as const)('E2 finish rejects %s without advancing or removing a record', async (phase) => {
    let stored = await create();
    if (phase !== 'copying') stored = await updateProjectMoveReceipt(stored, await prepared(), source.rootPath);
    if (phase === 'pending') stored = await updateProjectMoveReceipt(stored, { ...stored.receipt, pendingDelete: 0 }, targetPath);
    const raw = native.readFileSync(receiptPath);
    const unlink = vi.spyOn(native, 'unlinkSync');
    expect(() => finishProjectMoveReceipt(stored, targetPath)).toThrow();
    expect(unlink).not.toHaveBeenCalled();
    expect(native.readFileSync(receiptPath)).toEqual(raw);
    await assertSourcePreserved();
  });

  it('E2 finish rejects source/foreign DB anchors and lookalike objects without read/update proof', async () => {
    const stored = await fullyConsumed();
    const unlink = vi.spyOn(native, 'unlinkSync');
    const stat = vi.spyOn(native, 'lstatSync');
    expect(() => finishProjectMoveReceipt(stored, source.rootPath)).toThrow();
    expect(() => finishProjectMoveReceipt(stored, join(temporary, 'foreign', projectId))).toThrow();
    expect(() => finishProjectMoveReceipt({ ...stored }, targetPath)).toThrow();
    expect(() => assertProjectMoveReceiptCurrent({ ...stored })).toThrow();
    expect(stat).not.toHaveBeenCalled();
    expect(unlink).not.toHaveBeenCalled();
    expect(sha256(native.readFileSync(receiptPath))).toBe(stored.sha256);
  });

  it.each(['record', 'managed-directory'] as const)('E2 finish rejects identical bytes after %s replacement', async (kind) => {
    const stored = await fullyConsumed();
    const raw = native.readFileSync(receiptPath);
    if (kind === 'record') {
      await fs.rename(receiptPath, join(directory, 'retained.json'));
    } else {
      await fs.rename(directory, join(win32.dirname(directory), 'retained-project-moves'));
      await fs.mkdir(directory);
    }
    await fs.writeFile(receiptPath, raw, { flag: 'wx' });
    expect(sha256(native.readFileSync(receiptPath))).toBe(stored.sha256);
    expect(String(native.lstatSync(receiptPath, { bigint: true }).ino)).not.toBe(stored.pathSnapshot.identity.ino);
    const unlink = vi.spyOn(native, 'unlinkSync');
    expect(() => assertProjectMoveReceiptCurrent(stored)).toThrow(/変更/);
    expect(() => finishProjectMoveReceipt(stored, targetPath)).toThrow(/変更/);
    expect(unlink).not.toHaveBeenCalled();
    expect(native.readFileSync(receiptPath)).toEqual(raw);
    expect(native.readFileSync(join(targetPath, 'top.txt'), 'utf8')).toBe('AAAA');
  });

  it('E2 last-await guard rejects an identical replacement after the final asynchronous receipt stat', async () => {
    await fullyConsumed();
    const raw = native.readFileSync(receiptPath);
    let closed = false;
    let replaced = false;
    interceptOpen((handle, path, flags) => {
      if (path !== receiptPath || flags !== 'r') return;
      const close = handle.close.bind(handle);
      vi.spyOn(handle, 'close').mockImplementationOnce(async () => { await close(); closed = true; });
    });
    const lstat = fs.lstat.bind(fs);
    vi.spyOn(fs, 'lstat').mockImplementation((async (path, options) => {
      const stat = await lstat(path, options);
      if (path === receiptPath && closed && !replaced) {
        replaced = true;
        native.renameSync(receiptPath, join(directory, 'retained.json'));
        native.writeFileSync(receiptPath, raw, { flag: 'wx' });
      }
      return stat;
    }) as typeof fs.lstat);
    await expect(readProjectMoveReceipt(directory, projectId, targetPath)).rejects.toThrow(/変更/);
    const unlink = vi.spyOn(native, 'unlinkSync');
    expect(replaced).toBe(true);
    expect(handles.every((handle) => handle.fd === -1)).toBe(true);
    expect(unlink).not.toHaveBeenCalled();
    expect(native.readFileSync(receiptPath)).toEqual(raw);
  });

  it('E2 finish releases its exclusion after a failed native unlink so the exact record can be retried', async () => {
    const stored = await fullyConsumed();
    const raw = native.readFileSync(receiptPath);
    const unlink = vi.spyOn(native, 'unlinkSync').mockImplementationOnce(() => { throw new Error('injected finish unlink'); });
    expect(() => finishProjectMoveReceipt(stored, targetPath)).toThrow(/injected finish unlink/);
    expect(native.readFileSync(receiptPath)).toEqual(raw);
    expect(() => assertProjectMoveReceiptCurrent(stored)).not.toThrow();
    expect(() => finishProjectMoveReceipt(stored, targetPath)).not.toThrow();
    expect(unlink.mock.calls).toEqual([[receiptPath], [receiptPath]]);
    expect(native.existsSync(receiptPath)).toBe(false);
  });

  it('R13 finish retries the same capability after progress unlink succeeds and base unlink fails', async () => {
    const first = await create();
    const complete = await prepared();
    let stored = await updateProjectMoveReceipt(first, complete, source.rootPath);
    const order = getProjectMoveRemovalOrder(complete);
    for (let cursor = 0; cursor < order.length; cursor += 1) {
      stored = await updateProjectMoveProgress(stored, cursor, cursor, targetPath);
      const entry = order[cursor]!;
      const path = join(source.rootPath, entry.relativePath);
      if (entry.kind === 'file') await fs.unlink(path);
      else await fs.rmdir(path);
      stored = await updateProjectMoveProgress(stored, cursor + 1, null, targetPath);
    }
    stored = await consolidateProjectMoveReceipt(stored, targetPath);
    const unlink = native.unlinkSync.bind(native);
    const calls: string[] = [];
    let failed = false;
    vi.spyOn(native, 'unlinkSync').mockImplementation((path) => {
      calls.push(String(path));
      if (path === receiptPath && !failed) { failed = true; throw new Error('injected base unlink'); }
      unlink(path);
    });
    expect(() => finishProjectMoveReceipt(stored, targetPath)).toThrow(/injected base unlink/);
    expect(native.existsSync(progressPath)).toBe(false);
    expect(native.existsSync(receiptPath)).toBe(true);
    expect(() => assertProjectMoveReceiptCurrent(stored)).not.toThrow();
    expect(() => finishProjectMoveReceipt(stored, targetPath)).not.toThrow();
    expect(calls).toEqual([progressPath, receiptPath, receiptPath]);
    expect(native.existsSync(receiptPath)).toBe(false);
  });

  it('E2 finish refuses an in-flight update and only consumes its new issued fingerprint after settlement', async () => {
    const stored = await fullyConsumed();
    const pending = updateProjectMoveReceipt(stored, stored.receipt, targetPath);
    try {
      expect(() => assertProjectMoveReceiptCurrent(stored)).toThrow(/更新中/);
      expect(() => finishProjectMoveReceipt(stored, targetPath)).toThrow(/更新中/);
    } finally { await pending; }
    const updated = await pending;
    expect(updated.sha256).toBe(stored.sha256);
    expect(updated.pathSnapshot.identity).not.toEqual(stored.pathSnapshot.identity);
    expect(() => finishProjectMoveReceipt(stored, targetPath)).toThrow(/変更/);
    expect(() => finishProjectMoveReceipt(updated, targetPath)).not.toThrow();
  });
});