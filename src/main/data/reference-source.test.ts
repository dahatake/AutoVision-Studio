// @vitest-environment node
import { createHash } from 'node:crypto';
import childProcess, { type ExecFileException } from 'node:child_process';
import native, { constants, readFileSync, type BigIntStats } from 'node:fs';
import fs, { type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { win32 } from 'node:path';
import { build } from 'esbuild';
import { afterEach, beforeAll, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import type { ScanImage, ScanResult } from '../../shared/contracts/import.js';
import { openDatabase, type DatabaseConnection } from '../db/database.js';
import { migrateDatabase, type Migration } from '../db/migrate.js';
import {
  applyReferenceRelink,
  findDataImport,
  insertDataImport,
  prepareDataImport,
  prepareReferenceRelink,
  type CopyImportSource,
  type DataImport,
  type ImportSourceManifest,
  type ReferenceImportSource,
} from './import-repository.js';
import {
  captureReferenceSource,
  relinkReferenceSource,
  verifyReferenceSource,
  type ReferenceRelinkReason,
  type ReferenceSourceImage,
  type ReferenceVerification,
} from './reference-source.js';
import {
  assertCapturedReferenceSource,
  assertCapturedReferenceSourceCurrent,
  assertCapturedReferenceSourcesCurrent,
  captureReferenceCandidate,
} from './reference-access.js';

const migrations: readonly Migration[] = [
  { version: 1, sql: readFileSync(new URL('../db/migrations/001_core.sql', import.meta.url), 'utf8') },
  { version: 2, sql: readFileSync(new URL('../db/migrations/002_jobs.sql', import.meta.url), 'utf8') },
  { version: 3, sql: readFileSync(new URL('../db/migrations/003_import.sql', import.meta.url), 'utf8') },
  { version: 4, sql: readFileSync(new URL('../db/migrations/004_import_generation.sql', import.meta.url), 'utf8') },
];
const projectId = '01234567-89ab-4cde-8f01-23456789abcd';
const otherProjectId = '11234567-89ab-4cde-8f01-23456789abcd';
const jobId = 'ae45cf74-c9f9-4c49-88b9-0523b1ac7383';
const importId = '9b2db431-04e9-488b-b4c2-3859fd26cb6e';
const createdAt = '2026-09-12T05:30:00.123Z';
const firstRelinkAt = '2026-09-12T05:31:00.123Z';
const secondRelinkAt = '2026-09-12T05:32:00.123Z';
const realOpen = fs.open.bind(fs);
const nativeExecFile = childProcess.execFile.bind(childProcess);
const handles: FileHandle[] = [];
let localVolume = '';
let fixtureDriveRoot = '';
let volumeExecutable = '';
let volumeProbeOutput = '';
let currentVolumeOutput = '';
let volumeProbeResult: 'local' | 'remote' | 'failed' = 'local';
let volumeProbe: ReturnType<typeof vi.spyOn>;
let currentVolumeProbe: ReturnType<typeof vi.spyOn>;

function normalizeFixturePath(path: native.PathLike): string {
  const value = String(path);
  return localVolume && value.slice(0, localVolume.length).toLowerCase() === localVolume.toLowerCase()
    ? fixtureDriveRoot + value.slice(localVolume.length) : value;
}

function differentVolume(): string {
  return localVolume.replace(/(Volume\{)([0-9a-f])/iu,
    (_match, prefix: string, digit: string) => prefix + (digit === '0' ? '1' : '0'));
}

function volumeReply(stdout = currentVolumeOutput): ReturnType<typeof childProcess.spawnSync> {
  return { pid: 0, output: [null, stdout, ''], stdout, stderr: '', status: 0, signal: null };
}

type DescriptorRead = (buffer: Buffer, offset: number, length: number, position: number) =>
  Promise<{ bytesRead: number; buffer: Buffer }>;

function mockDescriptorRead(handle: FileHandle, implementation: DescriptorRead) {
  return vi.spyOn(handle, 'read').mockImplementation(implementation as FileHandle['read']);
}

function interceptOpen(configure: (handle: FileHandle, path: string, flags: string | number) => void) {
  return vi.spyOn(fs, 'open').mockImplementation(async (path, flags, mode) => {
    const handle = await realOpen(path, flags, mode);
    handles.push(handle);
    configure(handle, normalizeFixturePath(path), flags as string | number);
    return handle;
  });
}

async function closeFixtureHandles(): Promise<void> {
  for (const handle of handles.splice(0)) {
    if (handle.fd !== -1) {
      try { await handle.close(); } catch { /* teardown owns only leaked fixture descriptors */ }
    }
  }
}

function installVolumeProbe(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(childProcess, 'execFile').mockImplementation((_file, _args, _options, callback) => {
    if (!callback) throw new Error('Expected mountvol callback.');
    const child = new childProcess.ChildProcess();
    queueMicrotask(() => {
      if (volumeProbeResult === 'local') callback(null, volumeProbeOutput, '');
      else if (volumeProbeResult === 'remote') {
        callback(Object.assign(new Error('No local volume GUID.'), { code: 1 }) as ExecFileException, '', '');
      } else {
        callback(Object.assign(new Error('Probe failed.'), { code: 'ETIMEDOUT', killed: true }) as ExecFileException, '', '');
      }
      child.emit('close', volumeProbeResult === 'local' ? 0 : 1, null);
    });
    return child;
  });
}

async function runNodeProcess(script: string, args: readonly string[]): Promise<Record<string, unknown>> {
  const output = await new Promise<string>((resolve, reject) => {
    nativeExecFile(process.execPath, [script, ...args], {
      cwd: process.cwd(),
      shell: false,
      windowsHide: true,
      encoding: 'utf8',
      timeout: 30_000,
      maxBuffer: 64 * 1024,
    }, (error, stdout, stderr) => {
      if (error !== null || typeof stdout !== 'string' || typeof stderr !== 'string' || stderr.length !== 0) {
        reject(new AggregateError(error ? [error] : [], `Reference process failed: ${stderr}`));
        return;
      }
      resolve(stdout);
    });
  });
  const parsed: unknown = JSON.parse(output);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid process result.');
  return parsed as Record<string, unknown>;
}

async function buildProcessFixture(outfile: string): Promise<void> {
  const source = String.raw`
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import { openDatabase } from './src/main/db/database.ts';
import { migrateDatabase } from './src/main/db/migrate.ts';
import { findDataImport, insertDataImport, prepareDataImport } from './src/main/data/import-repository.ts';
import { captureReferenceSource, relinkReferenceSource, verifyReferenceSource } from './src/main/data/reference-source.ts';

const projectId = '${projectId}';
const jobId = '${jobId}';
const importId = '${importId}';
const createdAt = '${createdAt}';
const [phase, databasePath, sourcePath, candidatePath, updatedAt] = process.argv.slice(2);
const migrations = [
  { version: 1, sql: readFileSync('./src/main/db/migrations/001_core.sql', 'utf8') },
  { version: 2, sql: readFileSync('./src/main/db/migrations/002_jobs.sql', 'utf8') },
  { version: 3, sql: readFileSync('./src/main/db/migrations/003_import.sql', 'utf8') },
  { version: 4, sql: readFileSync('./src/main/db/migrations/004_import_generation.sql', 'utf8') },
];
const database = openDatabase(databasePath);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const imageAt = async (path) => {
  const bytes = await fs.readFile(path);
  const stat = await fs.lstat(path, { bigint: true });
  return { key: 'image:0', sourcePath: path, byteSize: bytes.length, mtimeNs: String(stat.mtimeNs),
    sha256: hash(bytes), format: 'png', width: 32, height: 24, orientation: 1,
    duplicateOf: null, annotation: null };
};
const scan = (image) => ({ formatVersion: 1, jobId, projectId, taskType: 'classification',
  mode: 'reference', classes: [], images: [image], issues: [] });
try {
  migrateDatabase(database, migrations);
  if (phase === 'persist') {
    database.prepare('INSERT INTO projects(id,name,task_type,workspace_path,created_at,updated_at) VALUES (?,?,?,?,?,?)')
      .run(projectId, 'Process fixture', 'classification', 'C:\\Projects\\' + projectId, createdAt, createdAt);
    database.prepare('INSERT INTO jobs(id,project_id,kind,status,created_at,updated_at) VALUES (?,?,?,?,?,?)')
      .run(jobId, projectId, 'scan-dataset', 'Succeeded', createdAt, createdAt);
    const image = await imageAt(sourcePath);
    const entry = await captureReferenceSource(image);
    const prepared = prepareDataImport({ id: importId, createdAt, updatedAt: createdAt,
      scanResult: scan(image), sourceManifest: { formatVersion: 1, mode: 'reference', entries: [entry] } });
    database.exec('BEGIN IMMEDIATE');
    try { insertDataImport(database, prepared); database.exec('COMMIT'); }
    catch (error) { if (database.inTransaction) database.exec('ROLLBACK'); throw error; }
    console.log(JSON.stringify({ phase, sourcePath: entry.sourcePath, sha256: entry.sha256 }));
  } else if (phase === 'verify') {
    const stored = findDataImport(database, projectId, importId);
    if (!stored || stored.sourceManifest.mode !== 'reference') throw new Error('Missing Reference import.');
    const result = await verifyReferenceSource(stored.sourceManifest.entries[0]);
    console.log(JSON.stringify({ phase, result }));
  } else if (phase === 'relink') {
    const stored = findDataImport(database, projectId, importId);
    if (!stored || stored.sourceManifest.mode !== 'reference') throw new Error('Missing Reference import.');
    const before = await verifyReferenceSource(stored.sourceManifest.entries[0]);
    const updated = await relinkReferenceSource(database, projectId, importId, 'image:0', candidatePath, updatedAt);
    if (updated.sourceManifest.mode !== 'reference') throw new Error('Unexpected Copy import.');
    const after = await verifyReferenceSource(updated.sourceManifest.entries[0]);
    console.log(JSON.stringify({ phase, before, after, sourcePath: updated.sourceManifest.entries[0].sourcePath }));
  } else throw new Error('Unknown phase.');
} finally { database.close(); }
`;
  await build({
    absWorkingDir: process.cwd(),
    stdin: { contents: source, loader: 'ts', resolveDir: process.cwd() },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    external: ['better-sqlite3'],
    logLevel: 'silent',
  });
}

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function identity(stat: BigIntStats): object {
  return { dev: String(stat.dev), ino: String(stat.ino), birthtimeNs: String(stat.birthtimeNs) };
}

function deepFrozen(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) deepFrozen(child);
}

let temporary = '';
let sourceDirectory = '';
let sourcePath = '';
let sourceBytes = Buffer.alloc(0);
let databasePath = '';
let database: DatabaseConnection;

async function imageAt(path: string, key = 'image:0'): Promise<ScanImage> {
  const bytes = await fs.readFile(path);
  const stat = await fs.lstat(path, { bigint: true });
  return {
    key,
    sourcePath: path,
    byteSize: bytes.length,
    mtimeNs: String(stat.mtimeNs),
    sha256: digest(bytes),
    format: 'png',
    width: 32,
    height: 24,
    orientation: 1,
    duplicateOf: null,
    annotation: null,
  };
}

function scan(image: ScanImage, mode: 'copy' | 'reference' = 'reference'): ScanResult {
  return {
    formatVersion: 1,
    jobId,
    projectId,
    taskType: 'classification',
    mode,
    classes: [],
    images: [image],
    issues: [],
  };
}

function seedDatabase(): void {
  database.prepare(`INSERT INTO projects(id,name,task_type,workspace_path,created_at,updated_at)
    VALUES (?,?,?,?,?,?)`).run(projectId, 'Reference fixture', 'classification',
      `C:\\Projects\\${projectId}`, createdAt, createdAt);
  database.prepare(`INSERT INTO projects(id,name,task_type,workspace_path,created_at,updated_at)
    VALUES (?,?,?,?,?,?)`).run(otherProjectId, 'Other fixture', 'classification',
      `C:\\Projects\\${otherProjectId}`, createdAt, createdAt);
  database.prepare(`INSERT INTO jobs(id,project_id,kind,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?)`).run(jobId, projectId, 'scan-dataset', 'Succeeded', createdAt, createdAt);
}

function persist(scanResult: ScanResult, sourceManifest: ImportSourceManifest): DataImport {
  const prepared = prepareDataImport({
    id: importId,
    createdAt,
    updatedAt: createdAt,
    scanResult,
    sourceManifest,
  });
  database.exec('BEGIN IMMEDIATE');
  try {
    const result = insertDataImport(database, prepared);
    database.exec('COMMIT');
    return result;
  } catch (error) {
    if (database.inTransaction) database.exec('ROLLBACK');
    throw error;
  }
}

async function persistReference(path = sourcePath): Promise<DataImport> {
  const image = await imageAt(path);
  const entry = await captureReferenceSource(image);
  return persist(scan(image), { formatVersion: 1, mode: 'reference', entries: [entry] });
}

async function persistCopy(): Promise<DataImport> {
  const image = await imageAt(sourcePath);
  const entry: CopyImportSource = {
    imageKey: image.key,
    relativePath: `datasets/${importId}/source/image.png`,
    byteSize: image.byteSize,
    sha256: image.sha256,
  };
  return persist(scan(image, 'copy'), { formatVersion: 1, mode: 'copy', entries: [entry] });
}

async function prepareCapturedBatch() {
  const images: ScanImage[] = [];
  const entries: ReferenceImportSource[] = [];
  for (let index = 0; index < 16; index += 1) {
    const path = win32.join(sourceDirectory, `batch-${index}.bin`);
    const bytes = Buffer.from(sourceBytes);
    bytes[0] = index;
    await fs.writeFile(path, bytes, { flag: 'wx' });
    const image = await imageAt(path, `image:${index}`);
    if (index % 2 === 1) image.sourcePath = image.sourcePath.replace(/^[a-z]/iu, (drive) => drive.toLowerCase());
    images.push(image);
    entries.push(await captureReferenceSource(image));
  }
  const prepared = prepareDataImport({ id: importId, createdAt, updatedAt: createdAt,
    scanResult: { ...scan(images[0]!), images },
    sourceManifest: { formatVersion: 1, mode: 'reference', entries } });
  return { images, entries, prepared };
}

function referenceEntry(value: DataImport): ReferenceImportSource {
  if (value.mode !== 'reference' || value.sourceManifest.mode !== 'reference') {
    throw new Error('Reference fixture expected.');
  }
  return value.sourceManifest.entries[0]!;
}

function rawHeader(): Record<string, unknown> {
  return database.prepare('SELECT * FROM data_imports WHERE id=?').get(importId) as Record<string, unknown>;
}

function afterFixtureWrite(prefix: string, action: () => void): void {
  const prepare = database.prepare.bind(database);
  vi.spyOn(database, 'prepare').mockImplementation(((sql: string) => {
    const statement = prepare(sql);
    if (sql.startsWith(prefix)) {
      const run = statement.run.bind(statement);
      vi.spyOn(statement, 'run').mockImplementation((...parameters: unknown[]) => {
        const result = run(...parameters);
        action();
        return result;
      });
    }
    return statement;
  }) as DatabaseConnection['prepare']);
}

beforeAll(async () => {
  if (process.platform !== 'win32') return;
  const systemRoot = process.env.SystemRoot;
  if (!systemRoot) throw new Error('SystemRoot is required for the local-volume fixture.');
  volumeExecutable = win32.join(systemRoot, 'System32', 'mountvol.exe');
  fixtureDriveRoot = win32.parse(await fs.realpath(tmpdir())).root;
  if (!/^[a-z]:\\$/iu.test(fixtureDriveRoot)) throw new Error('Fixture requires a local drive.');
  // Resolve only the fixture drive, once, before installing any process mocks.
  localVolume = await new Promise<string>((resolve, reject) => {
    nativeExecFile(volumeExecutable, [fixtureDriveRoot, '/L'], {
      shell: false, windowsHide: true, encoding: 'utf8', timeout: 5_000, maxBuffer: 4_096,
    }, (error, stdout, stderr) => {
      if (error !== null || typeof stdout !== 'string' || stderr !== ''
        || Buffer.byteLength(stdout, 'utf8') > 4_096
        || !/^\\\\\?\\Volume\{[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}\\(?![\s\S])/iu.test(stdout.trim())) {
        reject(error ?? new Error('Fixture drive has no strict local volume GUID.'));
        return;
      }
      resolve(stdout.trim());
    });
  });
});

beforeEach(async () => {
  volumeProbeResult = 'local';
  volumeProbeOutput = `${localVolume}\r\n`;
  currentVolumeOutput = localVolume;
  volumeProbe = installVolumeProbe();
  currentVolumeProbe = vi.spyOn(childProcess, 'spawnSync').mockImplementation(() => volumeReply());
  temporary = await fs.realpath(await fs.mkdtemp(win32.join(tmpdir(), 'autovision-dat12-')));
  sourceDirectory = win32.join(temporary, 'sources');
  sourcePath = win32.join(sourceDirectory, 'source.bin');
  sourceBytes = Buffer.from(Array.from({ length: 131_119 }, (_, index) => (index * 47 + 13) & 0xff));
  await fs.mkdir(sourceDirectory);
  await fs.writeFile(sourcePath, sourceBytes, { flag: 'wx' });
  databasePath = win32.join(temporary, 'metadata.sqlite3');
  database = openDatabase(databasePath);
  migrateDatabase(database, migrations);
  seedDatabase();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await closeFixtureHandles();
  if (database?.open) database.close();
  if (temporary) await fs.rm(temporary, { recursive: true, force: true });
});

describe.skipIf(process.platform !== 'win32')('DAT-12 Reference source lifecycle', () => {
  it('exports narrow capture, verification and explicit relink contracts', () => {
    expectTypeOf(captureReferenceSource).parameters.toEqualTypeOf<[ReferenceSourceImage]>();
    expectTypeOf(captureReferenceSource).returns.toEqualTypeOf<Promise<ReferenceImportSource>>();
    expectTypeOf(verifyReferenceSource).returns.toEqualTypeOf<Promise<ReferenceVerification>>();
    expectTypeOf<ReferenceRelinkReason>().toEqualTypeOf<
      'missing' | 'inaccessible' | 'unsafe' | 'read-failed' | 'changed'
      | 'identity-changed' | 'size-changed' | 'mtime-changed' | 'hash-changed'
    >();
  });

  it('captures exact identity, size, mtime and SHA-256 using only bounded read-only source access', async () => {
    const image = await imageAt(sourcePath);
    const before = await fs.lstat(sourcePath, { bigint: true });
    const lengths: number[] = [];
    interceptOpen((handle, path, flags) => {
      expect(path).toBe(sourcePath);
      expect(typeof flags).toBe('number');
      const writable = constants.O_WRONLY | constants.O_RDWR | constants.O_APPEND
        | constants.O_CREAT | constants.O_TRUNC;
      expect(Number(flags) & writable).toBe(0);
      const read = handle.read.bind(handle);
      mockDescriptorRead(handle, async (buffer, offset, length, position) => {
        lengths.push(length);
        return read(buffer, offset, length, position);
      });
    });
    const write = vi.spyOn(fs, 'writeFile');
    const unlink = vi.spyOn(fs, 'unlink');
    const rename = vi.spyOn(fs, 'rename');
    const entry = await captureReferenceSource(image);

    expect(entry).toEqual({
      imageKey: image.key,
      sourcePath,
      identity: identity(before),
      byteSize: sourceBytes.length,
      mtimeNs: String(before.mtimeNs),
      sha256: digest(sourceBytes),
    });
    deepFrozen(entry);
    expect(Math.max(...lengths)).toBeLessThanOrEqual(64 * 1024);
    expect(lengths.length).toBeGreaterThan(2);
    expect(write).not.toHaveBeenCalled();
    expect(unlink).not.toHaveBeenCalled();
    expect(rename).not.toHaveBeenCalled();
    const after = await fs.lstat(sourcePath, { bigint: true });
    expect(identity(after)).toEqual(identity(before));
    expect(after.size).toBe(before.size);
    expect(after.mtimeNs).toBe(before.mtimeNs);
    expect(native.readFileSync(sourcePath)).toEqual(sourceBytes);
  });

  it.each(['spread', 'structuredClone', 'JSON'] as const)(
    'rejects a %s copy of a real capture at prepare without I/O', async (kind) => {
      const image = await imageAt(sourcePath);
      const captured = await captureReferenceSource(image);
      const copied: ReferenceImportSource = kind === 'spread' ? { ...captured }
        : kind === 'structuredClone' ? structuredClone(captured) : JSON.parse(JSON.stringify(captured));
      const lstat = vi.spyOn(native, 'lstatSync');
      const readdir = vi.spyOn(native, 'readdirSync');
      const open = vi.spyOn(fs, 'open');
      const prepare = (entry: ReferenceImportSource) => prepareDataImport({
        id: importId, createdAt, updatedAt: createdAt, scanResult: scan(image),
        sourceManifest: { formatVersion: 1, mode: 'reference', entries: [entry] },
      });
      expect(() => assertCapturedReferenceSource(captured)).not.toThrow();
      expect(() => prepare(captured)).not.toThrow();
      expect(() => assertCapturedReferenceSource(copied)).toThrow(TypeError);
      expect(() => assertCapturedReferenceSourceCurrent(copied)).toThrow(/captured Reference source/);
      expect(() => prepare(copied)).toThrow(/captured Reference source/);
      expect(lstat).not.toHaveBeenCalled();
      expect(readdir).not.toHaveBeenCalled();
      expect(open).not.toHaveBeenCalled();
    },
  );

  it('retains the exact deeply frozen proof independently of later input mutation', async () => {
    const image = await imageAt(sourcePath);
    const captured = await captureReferenceSource(image);
    const entries = [captured];
    const prepared = prepareDataImport({ id: importId, createdAt, updatedAt: createdAt,
      scanResult: scan(image), sourceManifest: { formatVersion: 1, mode: 'reference', entries } });
    deepFrozen(captured);
    expect(Reflect.set(captured, 'sourcePath', 'C:\\forged.bin')).toBe(false);
    expect(Reflect.set(captured.identity, 'ino', '999')).toBe(false);
    entries[0] = { ...captured, sha256: 'f'.repeat(64) };
    entries.length = 0;
    image.sourcePath = 'C:\\forged.bin';
    database.exec('BEGIN IMMEDIATE');
    try {
      const result = insertDataImport(database, prepared);
      expect(referenceEntry(result)).toEqual(captured);
      expect(result.scanResult.images[0]!.sourcePath).toBe(sourcePath);
      expect(database.inTransaction).toBe(true);
      database.exec('COMMIT');
    } finally { if (database.inTransaction) database.exec('ROLLBACK'); }
    expect(referenceEntry(findDataImport(database, projectId, importId)!)).toEqual(captured);
  });

  describe('current-proof ctime settlement', () => {
    async function settlementFixture() {
      const pinnedPath = localVolume + sourcePath.slice(fixtureDriveRoot.length);
      const timestamp = new Date('2026-09-12T00:00:00.000Z');
      native.utimesSync(pinnedPath, timestamp, timestamp);
      const entry = await captureReferenceSource(await imageAt(sourcePath));
      const proof = structuredClone(entry);
      const realLstat = native.lstatSync.bind(native);
      const before = realLstat(pinnedPath, { bigint: true });
      // Install only after issuance. Keep real metadata and methods; change
      // only this pinned source's synchronous ctime, never a drive-letter stat.
      const lstat = vi.spyOn(native, 'lstatSync').mockImplementation(((path: native.PathLike, options?: unknown) => {
        const stat = realLstat(path, options as never);
        if (String(path) !== pinnedPath) return stat;
        expect(normalizeFixturePath(path)).toBe(sourcePath);
        return Object.assign(Object.create(Object.getPrototypeOf(stat)), stat,
          { ctimeNs: before.ctimeNs + 1n });
      }) as typeof native.lstatSync);
      return { pinnedPath, timestamp, entry, proof, before, realLstat, lstat };
    }

    it('rehashes real bytes for stable ctime-only settlement without rebasing the proof and caches only verified metadata', async () => {
      const { pinnedPath, entry, proof, lstat } = await settlementFixture();
      const originalIdentity = entry.identity;
      const open = vi.spyOn(native, 'openSync');
      const read = vi.spyOn(native, 'readSync');
      const fstat = vi.spyOn(native, 'fstatSync');
      const close = vi.spyOn(native, 'closeSync');
      const readdir = vi.spyOn(native, 'readdirSync');
      expect(() => assertCapturedReferenceSourceCurrent(entry)).not.toThrow();
      expect(open).toHaveBeenCalledTimes(1);
      expect(open.mock.calls[0]![0]).toBe(pinnedPath);
      expect(Number(open.mock.calls[0]![1]) & (constants.O_WRONLY | constants.O_RDWR
        | constants.O_APPEND | constants.O_CREAT | constants.O_TRUNC)).toBe(0);
      const fd = open.mock.results[0]!.value as number;
      expect(read.mock.calls.map((call) => call[0])).toEqual(Array(read.mock.calls.length).fill(fd));
      const readCalls = read.mock.calls as unknown as readonly [number, NodeJS.ArrayBufferView, number, number, number][];
      expect(readCalls.map((call) => call[3])).toEqual([65_536, 65_536, 47, 1]);
      expect(readCalls.map((call) => call[4])).toEqual([0, 65_536, 131_072, sourceBytes.length]);
      expect(read.mock.results.map((result) => result.value)).toEqual([65_536, 65_536, 47, 0]);
      expect(fstat).toHaveBeenCalledTimes(2);
      expect(close).toHaveBeenCalledExactlyOnceWith(fd);
      expect(() => native.fstatSync(fd)).toThrow(expect.objectContaining({ code: 'EBADF' }));
      for (const spy of [lstat, readdir]) {
        for (const [path] of spy.mock.calls) expect(String(path).startsWith(localVolume)).toBe(true);
      }
      expect(entry).toEqual(proof);
      expect(entry.identity).toBe(originalIdentity);
      expect(entry.sha256).toBe(digest(sourceBytes));
      deepFrozen(entry);
      read.mockClear();
      open.mockClear();
      fstat.mockClear();
      close.mockClear();
      lstat.mockClear();
      expect(() => assertCapturedReferenceSourceCurrent(entry)).not.toThrow();
      expect(lstat.mock.calls.filter(([path]) => String(path) === pinnedPath)).toHaveLength(1);
      for (const spy of [open, read, fstat, close]) expect(spy).not.toHaveBeenCalled();
      expect(entry).toEqual(proof);
      expect(entry.sha256).toBe(digest(sourceBytes));
    });

    it('rejects real same-inode same-length exact-mtime altered bytes without rebasing the original hash', async () => {
      const { pinnedPath, timestamp, entry, proof, before, realLstat } = await settlementFixture();
      const replacement = Buffer.alloc(sourceBytes.length, 0x5a);
      native.writeFileSync(pinnedPath, replacement, { flag: 'r+' });
      native.utimesSync(pinnedPath, timestamp, timestamp);
      const after = realLstat(pinnedPath, { bigint: true });
      expect(identity(after)).toEqual(identity(before));
      expect(after.size).toBe(before.size);
      expect(after.mtimeNs).toBe(before.mtimeNs);
      expect(after.nlink).toBe(before.nlink);
      expect(after.ctimeNs).not.toBe(before.ctimeNs);
      expect(digest(replacement)).not.toBe(proof.sha256);
      const read = vi.spyOn(native, 'readSync');
      const close = vi.spyOn(native, 'closeSync');
      for (let attempt = 0; attempt < 2; attempt += 1) {
        read.mockClear();
        expect(() => assertCapturedReferenceSourceCurrent(entry)).toThrow(expect.objectContaining({ reason: 'changed' }));
        expect(read).toHaveBeenCalled();
        expect(entry).toEqual(proof);
        expect(entry.sha256).toBe(digest(sourceBytes));
      }
      expect(close).toHaveBeenCalledTimes(2);
      expect(native.readFileSync(pinnedPath)).toEqual(replacement);
    });

    it.each(['dev', 'ino', 'birthtimeNs', 'size', 'mtimeNs', 'nlink'] as const)(
      'fast-rejects %s changes without any fallback open or read', async (field) => {
        const { pinnedPath, entry, proof, before, realLstat, lstat } = await settlementFixture();
        lstat.mockImplementation(((path: native.PathLike, options?: unknown) => {
          const stat = realLstat(path, options as never);
          return String(path) === pinnedPath
            ? Object.assign(Object.create(Object.getPrototypeOf(stat)), stat,
              { ctimeNs: before.ctimeNs + 1n, [field]: before[field] + 1n }) : stat;
        }) as typeof native.lstatSync);
        const open = vi.spyOn(native, 'openSync');
        const read = vi.spyOn(native, 'readSync');
        expect(() => assertCapturedReferenceSourceCurrent(entry)).toThrow(/safely read/);
        expect(open).not.toHaveBeenCalled();
        expect(read).not.toHaveBeenCalled();
        expect(entry).toEqual(proof);
      },
    );

    it.each(['descriptor', 'path', 'post-close'] as const)(
      'rejects independent %s ctime movement during fallback without caching an unverified stamp', async (point) => {
        const { pinnedPath, entry, proof, before, realLstat, lstat } = await settlementFixture();
        const realFstat = native.fstatSync.bind(native);
        let descriptorChecks = 0;
        let pathChecks = 0;
        const fstat = vi.spyOn(native, 'fstatSync').mockImplementation(((fd: number, options?: unknown) => {
          const stat = realFstat(fd, options as { bigint: true });
          if (point !== 'descriptor' || ++descriptorChecks !== 2) return stat;
          return Object.assign(Object.create(Object.getPrototypeOf(stat)), stat, { ctimeNs: stat.ctimeNs + 1n });
        }) as typeof native.fstatSync);
        lstat.mockImplementation(((path: native.PathLike, options?: unknown) => {
          const stat = realLstat(path, options as never);
          if (String(path) !== pinnedPath) return stat;
          pathChecks += 1;
          const moved = (point === 'path' && pathChecks === 3) || (point === 'post-close' && pathChecks === 4);
          return Object.assign(Object.create(Object.getPrototypeOf(stat)), stat,
            { ctimeNs: before.ctimeNs + (moved ? 2n : 1n) });
        }) as typeof native.lstatSync);
        const close = vi.spyOn(native, 'closeSync');
        const read = vi.spyOn(native, 'readSync');
        expect(() => assertCapturedReferenceSourceCurrent(entry)).toThrow(expect.objectContaining({ reason: 'changed' }));
        expect(close).toHaveBeenCalledTimes(1);
        expect(() => realFstat(close.mock.calls[0]![0])).toThrow(expect.objectContaining({ code: 'EBADF' }));
        if (point === 'post-close') expect(lstat.mock.invocationCallOrder.at(-1)!).toBeGreaterThan(close.mock.invocationCallOrder[0]!);
        fstat.mockRestore();
        read.mockClear();
        expect(() => assertCapturedReferenceSourceCurrent(entry)).not.toThrow();
        expect(read).toHaveBeenCalled();
        expect(entry).toEqual(proof);
      },
    );

    it.each(['read-io', 'short-eof', 'end-extra', 'close-before-release'] as const)(
      'rejects fallback %s and releases the descriptor without caching failed verification', async (fault) => {
        const { entry, proof } = await settlementFixture();
        const realRead = native.readSync.bind(native);
        const realClose = native.closeSync.bind(native);
        const realFstat = native.fstatSync.bind(native);
        const open = vi.spyOn(native, 'openSync');
        const close = vi.spyOn(native, 'closeSync');
        const read = vi.spyOn(native, 'readSync');
        if (fault === 'read-io') read.mockImplementationOnce(() => { throw Object.assign(new Error('injected read'), { code: 'EIO' }); });
        if (fault === 'short-eof') read.mockImplementationOnce(() => 0);
        if (fault === 'end-extra') {
          read.mockImplementation(((fd: number, buffer: Buffer, offset: number, length: number, position: number) =>
            position === sourceBytes.length ? 1 : realRead(fd, buffer, offset, length, position)) as typeof native.readSync);
        }
        if (fault === 'close-before-release') {
          close.mockImplementationOnce(() => { throw Object.assign(new Error('injected close'), { code: 'EIO' }); });
        }
        let fd: number | undefined;
        try {
          expect(() => assertCapturedReferenceSourceCurrent(entry)).toThrow(expect.objectContaining({
            reason: fault === 'end-extra' ? 'changed' : 'read-failed',
          }));
          fd = open.mock.results[0]!.value as number;
          expect(entry).toEqual(proof);
          // Regression: a pre-release close failure must not leak the fd.
          // Current production finally-close does not yet perform this recovery.
          expect(close).toHaveBeenCalledTimes(fault === 'close-before-release' ? 2 : 1);
          expect(() => realFstat(fd!)).toThrow(expect.objectContaining({ code: 'EBADF' }));
          read.mockRestore();
          const retryRead = vi.spyOn(native, 'readSync');
          expect(() => assertCapturedReferenceSourceCurrent(entry)).not.toThrow();
          expect(retryRead).toHaveBeenCalled();
          expect(entry).toEqual(proof);
        } finally {
          // Teardown owns only this fixture's descriptor, including the known
          // failing close-recovery regression; never close a reused descriptor.
          if (fd !== undefined) {
            let live = false;
            try { realFstat(fd); live = true; } catch { /* already released */ }
            if (live) realClose(fd);
          }
        }
      },
    );
  });

  it('grouped batch inserts 16 real captures with two volume queries and every file guarded in both phases', async () => {
    expectTypeOf(assertCapturedReferenceSourcesCurrent).parameters.toEqualTypeOf<[readonly ReferenceImportSource[]]>();
    expectTypeOf(assertCapturedReferenceSourcesCurrent).returns.toEqualTypeOf<void>();
    const { images, entries, prepared } = await prepareCapturedBatch();
    expect(new Set(entries.map((entry) => `${entry.identity.dev}:${entry.identity.ino}`)).size).toBe(16);
    expect(new Set(entries.map((entry) => entry.sha256)).size).toBe(16);
    currentVolumeProbe.mockClear();
    volumeProbe.mockClear();
    const lstat = vi.spyOn(native, 'lstatSync');
    const readdir = vi.spyOn(native, 'readdirSync');
    database.exec('BEGIN IMMEDIATE');
    try {
      const result = insertDataImport(database, prepared);
      expect(result.sourceManifest.entries).toEqual(entries);
      expect(database.inTransaction).toBe(true);
      expect(currentVolumeProbe).toHaveBeenCalledTimes(2);
      expect(volumeProbe).not.toHaveBeenCalled();
      for (const call of currentVolumeProbe.mock.calls) expect(call).toEqual([
        volumeExecutable, [win32.parse(images[0]!.sourcePath).root, '/L'], {
          shell: false, windowsHide: true, encoding: 'utf8', timeout: 5_000,
          maxBuffer: 4_096, stdio: ['ignore', 'pipe', 'pipe'],
        },
      ]);
      const [pre, post] = currentVolumeProbe.mock.invocationCallOrder;
      for (const image of images) {
        const orders = lstat.mock.calls.flatMap(([path], index) =>
          normalizeFixturePath(path).toLowerCase() === image.sourcePath.toLowerCase()
            ? [lstat.mock.invocationCallOrder[index]!] : []);
        expect(orders).toHaveLength(2);
        expect(orders[0]!).toBeGreaterThan(pre!);
        expect(orders[0]!).toBeLessThan(post!);
        expect(orders[1]!).toBeGreaterThan(post!);
      }
      for (const spy of [lstat, readdir]) {
        expect(spy).toHaveBeenCalled();
        for (const [path] of spy.mock.calls) expect(String(path).startsWith(localVolume)).toBe(true);
      }
      database.exec('COMMIT');
    } finally { if (database.inTransaction) database.exec('ROLLBACK'); }
    expect(findDataImport(database, projectId, importId)!.sourceManifest.entries).toEqual(entries);
  });

  it.each([
    ['pre', 'modified'], ['pre', 'replaced'], ['post', 'modified'], ['post', 'replaced'],
  ] as const)('grouped batch rejects the last file %s-guard %s and leaves rollback to the caller', async (phase, kind) => {
    const { images, prepared } = await prepareCapturedBatch();
    const lastPath = images.at(-1)!.sourcePath;
    const before = native.readFileSync(lastPath);
    const realLstat = native.lstatSync.bind(native);
    let lastChecks = 0;
    let changed = false;
    currentVolumeProbe.mockClear();
    vi.spyOn(native, 'lstatSync').mockImplementation(((path: native.PathLike, options?: unknown) => {
      if (normalizeFixturePath(path).toLowerCase() === lastPath.toLowerCase()
        && ++lastChecks === (phase === 'pre' ? 1 : 2)) {
        if (kind === 'modified') native.appendFileSync(lastPath, Buffer.from([0xff]));
        else {
          native.renameSync(lastPath, `${lastPath}.retained`);
          native.writeFileSync(lastPath, before, { flag: 'wx' });
        }
        changed = true;
      }
      return realLstat(path, options as never);
    }) as typeof native.lstatSync);
    database.exec('BEGIN IMMEDIATE');
    try {
      expect(() => insertDataImport(database, prepared)).toThrow(/safely read/);
      expect(changed).toBe(true);
      expect(currentVolumeProbe).toHaveBeenCalledTimes(phase === 'pre' ? 1 : 2);
      expect(database.inTransaction).toBe(true);
      expect(database.prepare('SELECT * FROM data_imports').all()).toHaveLength(phase === 'pre' ? 0 : 1);
      expect(database.prepare('SELECT * FROM import_sources').all()).toHaveLength(phase === 'pre' ? 0 : 16);
    } finally { database.exec('ROLLBACK'); }
    expect(database.prepare('SELECT * FROM data_imports').all()).toEqual([]);
    expect(database.prepare('SELECT * FROM import_sources').all()).toEqual([]);
    if (kind === 'replaced') expect(native.readFileSync(`${lastPath}.retained`)).toEqual(before);
  });

  it.each(['forged', 'sparse', 'accessor', 'iterator', 'non-array'] as const)(
    'grouped batch rejects a later %s proof before any volume query or file I/O', async (kind) => {
      const entry = await captureReferenceSource(await imageAt(sourcePath));
      const entries = [entry, { ...entry }];
      const getter = vi.fn(() => entry);
      const iterator = vi.fn(() => [entry][Symbol.iterator]());
      if (kind === 'sparse') delete entries[1];
      if (kind === 'accessor') Object.defineProperty(entries, '1', { get: getter });
      if (kind === 'iterator') entries[Symbol.iterator] = iterator;
      const input = kind === 'non-array' ? { 0: entry, 1: entries[1], length: 2 } : entries;
      currentVolumeProbe.mockClear();
      volumeProbe.mockClear();
      const spies = [vi.spyOn(native, 'lstatSync'), vi.spyOn(native, 'readdirSync'),
        vi.spyOn(fs, 'lstat'), vi.spyOn(fs, 'readdir'), vi.spyOn(fs, 'open')];
      expect(() => assertCapturedReferenceSourcesCurrent(input as readonly ReferenceImportSource[])).toThrow(TypeError);
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
      expect(currentVolumeProbe).not.toHaveBeenCalled();
      expect(volumeProbe).not.toHaveBeenCalled();
      expect(getter).not.toHaveBeenCalled();
      expect(iterator).not.toHaveBeenCalled();
    },
  );

  it('grouped batch snapshots the whole array before queries and never caches authority across calls', async () => {
    const first = await captureReferenceSource(await imageAt(sourcePath));
    const secondPath = win32.join(sourceDirectory, 'second.bin');
    await fs.writeFile(secondPath, sourceBytes, { flag: 'wx' });
    const second = await captureReferenceSource(await imageAt(secondPath, 'image:1'));
    const entries = [first, second];
    currentVolumeProbe.mockClear();
    currentVolumeProbe.mockImplementationOnce(() => { entries.length = 0; return volumeReply(); });
    const lstat = vi.spyOn(native, 'lstatSync');
    assertCapturedReferenceSourcesCurrent(entries);
    expect(entries).toEqual([]);
    expect(currentVolumeProbe).toHaveBeenCalledTimes(1);
    for (const path of [sourcePath, secondPath]) {
      expect(lstat.mock.calls.filter(([candidate]) => normalizeFixturePath(candidate) === path)).toHaveLength(1);
    }
    lstat.mockClear();
    currentVolumeOutput = differentVolume();
    expect(() => assertCapturedReferenceSourcesCurrent([first, second])).toThrow(/safely read/);
    expect(currentVolumeProbe).toHaveBeenCalledTimes(2);
    expect(lstat).not.toHaveBeenCalled();
  });

  it('grouped batch checks every distinct drive before any pinned file guard', async () => {
    const image = await imageAt(sourcePath);
    const first = await captureReferenceSource(image);
    const otherRoot = fixtureDriveRoot.toUpperCase() === 'Z:\\' ? 'Y:\\' : 'Z:\\';
    const second = await captureReferenceSource({ ...image, key: 'image:1',
      sourcePath: otherRoot + sourcePath.slice(fixtureDriveRoot.length) });
    currentVolumeProbe.mockClear();
    const lstat = vi.spyOn(native, 'lstatSync');
    assertCapturedReferenceSourcesCurrent([first, second]);
    expect(currentVolumeProbe.mock.calls.map((call: readonly unknown[]) => call[1])).toEqual([
      [fixtureDriveRoot, '/L'], [otherRoot, '/L'],
    ]);
    expect(currentVolumeProbe.mock.invocationCallOrder[1]!).toBeLessThan(lstat.mock.invocationCallOrder[0]!);
    currentVolumeProbe.mockClear();
    lstat.mockClear();
    currentVolumeProbe.mockReturnValueOnce(volumeReply()).mockReturnValueOnce(volumeReply(differentVolume()));
    expect(() => assertCapturedReferenceSourcesCurrent([first, second])).toThrow(/safely read/);
    expect(currentVolumeProbe).toHaveBeenCalledTimes(2);
    expect(lstat).not.toHaveBeenCalled();
  });

  it('grouped batch rejects conflicting same-drive executable captures before any query or file I/O', async () => {
    const image = await imageAt(sourcePath);
    const first = await captureReferenceSource(image);
    let second: ReferenceImportSource;
    vi.stubEnv('SystemRoot', win32.join(process.env.SystemRoot!, 'recaptured'));
    try { second = await captureReferenceSource({ ...image, key: 'image:1' }); }
    finally { vi.unstubAllEnvs(); }
    currentVolumeProbe.mockClear();
    const lstat = vi.spyOn(native, 'lstatSync');
    const readdir = vi.spyOn(native, 'readdirSync');
    expect(() => assertCapturedReferenceSourcesCurrent([first, second])).toThrow(/safely read/);
    expect(currentVolumeProbe).not.toHaveBeenCalled();
    expect(lstat).not.toHaveBeenCalled();
    expect(readdir).not.toHaveBeenCalled();
  });

  it('grouped batch empty arrays and Copy inserts perform no source or volume I/O', async () => {
    const image = await imageAt(sourcePath);
    const spies = [vi.spyOn(native, 'lstatSync'), vi.spyOn(native, 'readdirSync'),
      vi.spyOn(fs, 'lstat'), vi.spyOn(fs, 'readdir'), vi.spyOn(fs, 'open')];
    assertCapturedReferenceSourcesCurrent([]);
    persist(scan(image, 'copy'), { formatVersion: 1, mode: 'copy', entries: [{
      imageKey: image.key, relativePath: `datasets/${importId}/source/image.png`,
      byteSize: image.byteSize, sha256: image.sha256,
    }] });
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect(currentVolumeProbe).not.toHaveBeenCalled();
    expect(volumeProbe).not.toHaveBeenCalled();
  });

  it.each(['before-header', 'after-projection'] as const)(
    'rejects a real import proof replaced %s and leaves rollback to the caller', async (point) => {
      const image = await imageAt(sourcePath);
      const captured = await captureReferenceSource(image);
      const prepared = prepareDataImport({ id: importId, createdAt, updatedAt: createdAt,
        scanResult: scan(image), sourceManifest: { formatVersion: 1, mode: 'reference', entries: [captured] } });
      const retainedPath = `${sourcePath}.retained`;
      const replace = () => {
        native.renameSync(sourcePath, retainedPath);
        native.writeFileSync(sourcePath, sourceBytes, { flag: 'wx' });
      };
      if (point === 'before-header') replace();
      else afterFixtureWrite('INSERT INTO import_sources(', replace);
      database.exec('BEGIN IMMEDIATE');
      try {
        expect(() => insertDataImport(database, prepared)).toThrow(/safely read/);
        expect(database.inTransaction).toBe(true);
        expect(database.prepare('SELECT * FROM data_imports').all()).toHaveLength(point === 'before-header' ? 0 : 1);
        expect(database.prepare('SELECT * FROM import_sources').all()).toHaveLength(point === 'before-header' ? 0 : 1);
      } finally { database.exec('ROLLBACK'); }
      expect(database.prepare('SELECT * FROM data_imports').all()).toEqual([]);
      expect(database.prepare('SELECT * FROM import_sources').all()).toEqual([]);
      expect(native.readFileSync(retainedPath)).toEqual(sourceBytes);
    },
  );

  it('snapshots saved candidate expectations before await and issues the actual candidate proof', async () => {
    const saved = structuredClone(await captureReferenceSource(await imageAt(sourcePath)));
    const candidatePath = win32.join(sourceDirectory, 'candidate.bin');
    await fs.writeFile(candidatePath, sourceBytes, { flag: 'wx' });
    const pending = captureReferenceCandidate(saved, candidatePath);
    saved.imageKey = 'forged';
    saved.byteSize = 1;
    saved.sha256 = 'f'.repeat(64);
    const candidate = await pending;
    expect(candidate).toMatchObject({ imageKey: 'image:0', sourcePath: candidatePath,
      byteSize: sourceBytes.length, sha256: digest(sourceBytes),
      identity: identity(await fs.lstat(candidatePath, { bigint: true })) });
    deepFrozen(candidate);
    expect(() => assertCapturedReferenceSourceCurrent(candidate)).not.toThrow();
  });

  it.each(['imageKey', 'byteSize', 'sha256'] as const)(
    'rejects a saved candidate %s getter before any candidate I/O', async (field) => {
      const saved = structuredClone(await captureReferenceSource(await imageAt(sourcePath)));
      const getter = vi.fn(() => { throw new Error('must not read'); });
      Object.defineProperty(saved, field, { enumerable: true, get: getter });
      const open = vi.spyOn(fs, 'open');
      const lstat = vi.spyOn(fs, 'lstat');
      await expect(captureReferenceCandidate(saved, sourcePath)).rejects.toThrow(/安全な絶対パス/);
      expect(getter).not.toHaveBeenCalled();
      expect(open).not.toHaveBeenCalled();
      expect(lstat).not.toHaveBeenCalled();
    },
  );

  it('rejects detached and forged relink replacements even with a genuine repository read', async () => {
    await persistReference();
    const current = findDataImport(database, projectId, importId)!;
    const saved = referenceEntry(current);
    const captured = await captureReferenceCandidate(saved, sourcePath);
    const before = rawHeader();
    for (const replacement of [saved, { ...captured }, structuredClone(captured),
      JSON.parse(JSON.stringify(captured)) as ReferenceImportSource,
      { ...saved, identity: { dev: '1', ino: '42', birthtimeNs: '0' } }]) {
      expect(() => prepareReferenceRelink(current, 'image:0', replacement, firstRelinkAt))
        .toThrow(/captured Reference source/);
    }
    expect(() => prepareReferenceRelink(current, 'image:0', captured, firstRelinkAt)).not.toThrow();
    expect(rawHeader()).toEqual(before);
  });

  it.each(['before-header', 'after-projection'] as const)(
    'revalidates a real relink candidate %s without taking caller rollback ownership', async (point) => {
      const original = await persistReference();
      const current = findDataImport(database, projectId, importId)!;
      const candidatePath = win32.join(sourceDirectory, 'candidate.bin');
      await fs.writeFile(candidatePath, sourceBytes, { flag: 'wx' });
      const captured = await captureReferenceCandidate(referenceEntry(current), candidatePath);
      const prepared = prepareReferenceRelink(current, 'image:0', captured, firstRelinkAt);
      const replace = () => {
        native.renameSync(candidatePath, `${candidatePath}.retained`);
        native.writeFileSync(candidatePath, sourceBytes, { flag: 'wx' });
      };
      if (point === 'before-header') replace();
      else afterFixtureWrite('UPDATE import_sources', replace);
      database.exec('BEGIN IMMEDIATE');
      try {
        expect(() => applyReferenceRelink(database, prepared)).toThrow(/safely read/);
        expect(database.inTransaction).toBe(true);
      } finally { database.exec('ROLLBACK'); }
      expect(findDataImport(database, projectId, importId)).toEqual(original);
    },
  );

  it('preserves validated scan path spelling while normalizing only the I/O path', async () => {
    const image = await imageAt(sourcePath);
    image.sourcePath = sourcePath.replace(/^[A-Z]/u, (drive) => drive.toLowerCase()).replaceAll('\\', '/');
    const entry = await captureReferenceSource(image);
    expect(entry.sourcePath).toBe(image.sourcePath);
    expect(entry.sha256).toBe(digest(sourceBytes));
  });

  it('snapshots required caller fields before the first await and never invokes extra getters', async () => {
    const image = { ...(await imageAt(sourcePath)) };
    const extra = vi.fn(() => { throw new Error('must not read'); });
    Object.defineProperty(image, 'extra', { enumerable: true, get: extra });
    const pending = captureReferenceSource(image);
    image.key = 'changed';
    image.sourcePath = 'C:\\changed.bin';
    image.byteSize = 1;
    image.mtimeNs = '0';
    image.sha256 = '0'.repeat(64);
    const entry = await pending;
    expect(entry).toMatchObject({ imageKey: 'image:0', sourcePath,
      byteSize: sourceBytes.length, sha256: digest(sourceBytes) });
    expect(extra).not.toHaveBeenCalled();
  });

  it.each([
    '\\\\server\\share\\source.bin', '\\\\?\\C:\\source.bin', 'C:relative.bin',
    'C:\\safe\\..\\source.bin', 'C:\\safe\\NUL.txt', 'C:\\safe\\a:stream',
    'C:\\safe\\trailing.', 'C:\\safe\\trailing ', 'C:\\safe\\bad\nname',
  ])('rejects unsafe runtime path %j before any filesystem access', async (badPath) => {
    const image = { ...(await imageAt(sourcePath)), sourcePath: badPath };
    const lstat = vi.spyOn(fs, 'lstat');
    await expect(captureReferenceSource(image)).rejects.toThrow(/安全な絶対パス/);
    expect(lstat).not.toHaveBeenCalled();
  });

  it.each(['remote', 'failed'] as const)(
    'rejects a %s drive-volume probe before source filesystem access', async (probeResult) => {
      const image = await imageAt(sourcePath);
      volumeProbeResult = probeResult;
      const lstat = vi.spyOn(fs, 'lstat');
      const readdir = vi.spyOn(fs, 'readdir');
      const open = vi.spyOn(fs, 'open');
      const syncLstat = vi.spyOn(native, 'lstatSync');
      const syncReaddir = vi.spyOn(native, 'readdirSync');
      await expect(captureReferenceSource(image)).rejects.toThrow(/安全に再読込/);
      expect(volumeProbe).toHaveBeenCalledExactlyOnceWith(
        expect.stringMatching(/\\System32\\mountvol\.exe$/iu),
        [win32.parse(sourcePath).root, '/L'],
        { shell: false, windowsHide: true, encoding: 'utf8', timeout: 5_000, maxBuffer: 4_096 },
        expect.any(Function),
      );
      expect(lstat).not.toHaveBeenCalled();
      expect(readdir).not.toHaveBeenCalled();
      expect(open).not.toHaveBeenCalled();
      expect(syncLstat).not.toHaveBeenCalled();
      expect(syncReaddir).not.toHaveBeenCalled();
      expect(currentVolumeProbe).not.toHaveBeenCalled();
    },
  );

  it.each(['hyphens', 'grouping', 'prefix', 'suffix', 'multiple', 'remote', 'oversized'] as const)(
    'rejects a malformed %s initial GUID before any source I/O', async (kind) => {
      const image = await imageAt(sourcePath);
      const outputs = {
        hyphens: `\\\\?\\Volume{${'-'.repeat(36)}}\\`,
        grouping: localVolume.replace(/([0-9a-f]{8})-([0-9a-f]{4})/iu, '$1$2-'),
        prefix: `x${localVolume}`,
        suffix: `${localVolume}x`,
        multiple: `${localVolume}\n${localVolume}`,
        remote: '\\\\remote.invalid\\share\\',
        oversized: `${' '.repeat(4_096)}${localVolume}`,
      };
      volumeProbeOutput = outputs[kind];
      const spies = [vi.spyOn(fs, 'lstat'), vi.spyOn(fs, 'readdir'), vi.spyOn(fs, 'open'),
        vi.spyOn(native, 'lstatSync'), vi.spyOn(native, 'readdirSync')];
      await expect(captureReferenceSource(image)).rejects.toThrow(/安全に再読込/);
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
      expect(currentVolumeProbe).not.toHaveBeenCalled();
    },
  );

  it('uses exact finite local-manager options once per issuance/current-proof guard, before source guards', async () => {
    const image = await imageAt(sourcePath);
    volumeProbeOutput = ` \t${localVolume}\r\n`;
    currentVolumeOutput = `\n${localVolume.toUpperCase()} \t`;
    const entry = await captureReferenceSource(image);
    const query = [volumeExecutable, [win32.parse(sourcePath).root, '/L'], {
      shell: false, windowsHide: true, encoding: 'utf8', timeout: 5_000,
      maxBuffer: 4_096, stdio: ['ignore', 'pipe', 'pipe'],
    }];
    expect(volumeProbe).toHaveBeenCalledTimes(1);
    expect(currentVolumeProbe).toHaveBeenCalledExactlyOnceWith(...query);
    currentVolumeProbe.mockClear();
    const lstat = vi.spyOn(native, 'lstatSync');
    const readdir = vi.spyOn(native, 'readdirSync');
    assertCapturedReferenceSourceCurrent(entry);
    expect(currentVolumeProbe).toHaveBeenCalledExactlyOnceWith(...query);
    expect(currentVolumeProbe.mock.invocationCallOrder[0]!).toBeLessThan(lstat.mock.invocationCallOrder[0]!);
    expect(currentVolumeProbe.mock.invocationCallOrder[0]!).toBeLessThan(readdir.mock.invocationCallOrder[0]!);
    currentVolumeProbe.mockClear();
    persist(scan(image), { formatVersion: 1, mode: 'reference', entries: [entry] });
    expect(currentVolumeProbe).toHaveBeenCalled();
    for (const call of currentVolumeProbe.mock.calls) expect(call).toEqual(query);
    expect(volumeProbe).toHaveBeenCalledTimes(1);
  });

  it.each(['changed', 'remote'] as const)(
    'pins every source I/O to the original GUID and rejects a %s drive during awaited reading before issuance', async (kind) => {
      const image = await imageAt(sourcePath);
      let changed = false;
      const open = interceptOpen((handle) => {
        const read = handle.read.bind(handle);
        mockDescriptorRead(handle, async (buffer, offset, length, position) => {
          const result = await read(buffer, offset, length, position);
          if (!changed && result.bytesRead > 0) {
            changed = true;
            currentVolumeOutput = kind === 'changed' ? differentVolume() : '\\\\remote.invalid\\share\\';
          }
          return result;
        });
      });
      const lstat = vi.spyOn(fs, 'lstat');
      const readdir = vi.spyOn(fs, 'readdir');
      const syncLstat = vi.spyOn(native, 'lstatSync');
      const syncReaddir = vi.spyOn(native, 'readdirSync');
      const prepare = vi.spyOn(database, 'prepare');
      const exec = vi.spyOn(database, 'exec');
      await expect(captureReferenceSource(image)).rejects.toThrow(/safely read/);
      expect(changed).toBe(true);
      expect(volumeProbe).toHaveBeenCalledTimes(1);
      expect(currentVolumeProbe).toHaveBeenCalledTimes(1);
      for (const spy of [open, lstat, readdir, syncLstat, syncReaddir]) {
        expect(spy).toHaveBeenCalled();
        for (const [path] of spy.mock.calls) expect(String(path).startsWith(localVolume)).toBe(true);
      }
      expect(readdir.mock.calls[0]![0]).toBe(localVolume);
      expect(lstat.mock.calls[0]![0]).toBe(localVolume + sourcePath.slice(fixtureDriveRoot.length).split('\\')[0]);
      expect(lstat.mock.calls.some(([path]) => String(path) === localVolume)).toBe(false);
      expect(open.mock.calls[0]![0]).toBe(localVolume + sourcePath.slice(fixtureDriveRoot.length));
      expect(syncLstat.mock.invocationCallOrder.at(-1)!).toBeLessThan(currentVolumeProbe.mock.invocationCallOrder[0]!);
      expect(syncReaddir.mock.invocationCallOrder.at(-1)!).toBeLessThan(currentVolumeProbe.mock.invocationCallOrder[0]!);
      expect(prepare).not.toHaveBeenCalled();
      expect(exec).not.toHaveBeenCalled();
      expect(database.prepare('SELECT * FROM data_imports').all()).toEqual([]);
      expect(database.prepare('SELECT * FROM import_sources').all()).toEqual([]);
      expect(handles.every((handle) => handle.fd === -1)).toBe(true);
      expect(native.readFileSync(sourcePath)).toEqual(sourceBytes);
    },
  );

  it.each(['status', 'error', 'signal', 'stderr', 'malformed', 'different', 'remote', 'throw'] as const)(
    'rejects a %s synchronous volume result before the current-proof source guard', async (kind) => {
      const entry = await captureReferenceSource(await imageAt(sourcePath));
      currentVolumeProbe.mockClear();
      const result = volumeReply();
      if (kind === 'status') result.status = 1;
      if (kind === 'error') result.error = Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
      if (kind === 'signal') result.signal = 'SIGTERM';
      if (kind === 'stderr') result.stderr = ' ';
      if (kind === 'malformed') result.stdout = `${localVolume}extra`;
      if (kind === 'different') result.stdout = differentVolume();
      if (kind === 'remote') result.stdout = '\\\\remote.invalid\\share\\';
      if (kind === 'throw') currentVolumeProbe.mockImplementationOnce(() => { throw new Error('spawn failed'); });
      else currentVolumeProbe.mockReturnValueOnce(result);
      const lstat = vi.spyOn(native, 'lstatSync');
      const readdir = vi.spyOn(native, 'readdirSync');
      expect(() => assertCapturedReferenceSourceCurrent(entry)).toThrow(/safely read/);
      expect(currentVolumeProbe).toHaveBeenCalledTimes(1);
      expect(lstat).not.toHaveBeenCalled();
      expect(readdir).not.toHaveBeenCalled();
    },
  );

  it('rolls back relink when the volume changes at the final authority guard and preserves source bytes and DB', async () => {
    const original = await persistReference();
    const header = rawHeader();
    const projection = database.prepare('SELECT * FROM import_sources').all();
    const candidatePath = win32.join(sourceDirectory, 'candidate.bin');
    await fs.writeFile(candidatePath, sourceBytes, { flag: 'wx' });
    const sourceBefore = await fs.lstat(sourcePath, { bigint: true });
    const candidateBefore = await fs.lstat(candidatePath, { bigint: true });
    let changed = false;
    afterFixtureWrite('UPDATE import_sources', () => {
      changed = true;
      currentVolumeOutput = differentVolume();
    });
    await expect(relinkReferenceSource(database, projectId, importId, 'image:0',
      candidatePath, firstRelinkAt)).rejects.toThrow(/safely read/);
    expect(changed).toBe(true);
    expect(database.inTransaction).toBe(false);
    expect(rawHeader()).toEqual(header);
    expect(database.prepare('SELECT * FROM import_sources').all()).toEqual(projection);
    expect(findDataImport(database, projectId, importId)).toEqual(original);
    for (const [path, before] of [[sourcePath, sourceBefore], [candidatePath, candidateBefore]] as const) {
      expect(native.readFileSync(path)).toEqual(sourceBytes);
      const after = await fs.lstat(path, { bigint: true });
      expect(identity(after)).toEqual(identity(before));
      expect(after.mtimeNs).toBe(before.mtimeNs);
      expect(after.size).toBe(before.size);
      expect(after.nlink).toBe(before.nlink);
    }
  });

  it('rejects accessors and non-plain inputs before filesystem access', async () => {
    const image = await imageAt(sourcePath);
    const getter = vi.fn(() => sourcePath);
    Object.defineProperty(image, 'sourcePath', { enumerable: true, get: getter });
    const lstat = vi.spyOn(fs, 'lstat');
    await expect(captureReferenceSource(image)).rejects.toThrow(/安全な絶対パス/);
    expect(getter).not.toHaveBeenCalled();
    expect(lstat).not.toHaveBeenCalled();
  });

  it.each(['size', 'mtime', 'hash'] as const)('rejects a scan %s mismatch without persisting a binding', async (kind) => {
    const image = await imageAt(sourcePath);
    if (kind === 'size') image.byteSize += 1;
    if (kind === 'mtime') image.mtimeNs = String(BigInt(image.mtimeNs) + 1n);
    if (kind === 'hash') image.sha256 = 'f'.repeat(64);
    await expect(captureReferenceSource(image)).rejects.toThrow(/scan後/);
    expect(database.prepare('SELECT * FROM data_imports').all()).toEqual([]);
  });

  it('rejects a same-length source mutation during streamed hashing', async () => {
    const image = await imageAt(sourcePath);
    let changed = false;
    interceptOpen((handle, path) => {
      if (path !== sourcePath) return;
      const read = handle.read.bind(handle);
      mockDescriptorRead(handle, async (buffer, offset, length, position) => {
        const result = await read(buffer, offset, length, position);
        if (!changed && result.bytesRead > 0) {
          native.writeFileSync(sourcePath, Buffer.alloc(sourceBytes.length, 0x5a));
          changed = true;
        }
        return result;
      });
    });
    await expect(captureReferenceSource(image)).rejects.toThrow(/再読込|変更/);
    expect(changed).toBe(true);
  });

  it.each([
    ['capture', 'real-close'], ['verify', 'real-close'],
    ['capture', 'stale-last-path-stat'], ['verify', 'stale-last-path-stat'],
  ] as const)('rejects %s same-size exact-mtime rewrite during %s', async (operation, point) => {
    const pinnedPath = localVolume + sourcePath.slice(fixtureDriveRoot.length);
    // Set a whole-millisecond timestamp first, rather than rounding an arbitrary
    // filesystem nanosecond value through Number when restoring it later.
    const timestamp = new Date('2026-09-12T00:00:00.000Z');
    native.utimesSync(pinnedPath, timestamp, timestamp);
    const before = native.lstatSync(pinnedPath, { bigint: true });
    expect(before.mtimeNs).toBe(BigInt(timestamp.getTime()) * 1_000_000n);
    const image = await imageAt(sourcePath);
    const saved = structuredClone(await captureReferenceSource(image));
    const replacement = Buffer.alloc(sourceBytes.length, 0x5a);
    const realLstat = fs.lstat.bind(fs);
    let rewritten = false;
    let sourceStats = 0;
    const rewrite = (): void => {
      // Real native I/O on the pinned path: retain the inode and exact size.
      native.writeFileSync(pinnedPath, replacement, { flag: 'r+' });
      native.utimesSync(pinnedPath, timestamp, timestamp);
      rewritten = true;
    };
    interceptOpen((handle) => {
      const close = handle.close.bind(handle);
      vi.spyOn(handle, 'close').mockImplementation(async () => {
        await close();
        if (point === 'real-close') rewrite();
      });
    });
    if (point === 'stale-last-path-stat') {
      vi.spyOn(fs, 'lstat').mockImplementation((async (path: native.PathLike, options?: unknown) => {
        const old = await realLstat(path, options as never);
        if (String(path) === pinnedPath && ++sourceStats === 3) rewrite();
        // The final async path stat returns its genuine, now-stale snapshot.
        return old;
      }) as typeof fs.lstat);
    }
    if (operation === 'capture') {
      await expect(captureReferenceSource(image)).rejects.toThrow(/安全に再読込/);
    } else {
      await expect(verifyReferenceSource(saved)).resolves.toEqual({
        status: 'relink-required', imageKey: image.key, sourcePath, reason: 'changed',
      });
    }
    expect(rewritten).toBe(true);
    expect(handles).toHaveLength(1);
    expect(handles[0]!.close).toHaveBeenCalledTimes(1);
    expect(handles[0]!.fd).toBe(-1);
    const after = native.lstatSync(pinnedPath, { bigint: true });
    expect(identity(after)).toEqual(identity(before));
    expect(after.size).toBe(before.size);
    expect(after.nlink).toBe(before.nlink);
    expect(after.mtimeNs).toBe(before.mtimeNs);
    expect(after.ctimeNs).not.toBe(before.ctimeNs);
    expect(native.readFileSync(pinnedPath)).toEqual(replacement);
    expect(() => assertCapturedReferenceSource(saved)).toThrow(/captured Reference source/);
  });

  it('closes the real read handle when the pre-close synchronous baseline fails', async () => {
    const image = await imageAt(sourcePath);
    const realLstat = native.lstatSync.bind(native);
    interceptOpen((handle) => { vi.spyOn(handle, 'close'); });
    vi.spyOn(native, 'lstatSync').mockImplementation(((path: native.PathLike, options?: unknown) => {
      if (normalizeFixturePath(path) === sourcePath) throw new Error('baseline stat failed');
      return realLstat(path, options as never);
    }) as typeof native.lstatSync);
    await expect(captureReferenceSource(image)).rejects.toThrow(/安全に再読込/);
    expect(handles).toHaveLength(1);
    expect(handles[0]!.close).toHaveBeenCalledTimes(1);
    expect(handles[0]!.fd).toBe(-1);
    expect(native.readFileSync(sourcePath)).toEqual(sourceBytes);
  });

  it('rejects hardlinks and directory junctions without following them as Reference authority', async () => {
    const image = await imageAt(sourcePath);
    const alias = win32.join(sourceDirectory, 'alias.bin');
    await fs.link(sourcePath, alias);
    await expect(captureReferenceSource(image)).rejects.toThrow(/再読込/);
    await fs.unlink(alias);

    const target = win32.join(temporary, 'junction-target');
    const junction = win32.join(temporary, 'junction');
    await fs.mkdir(target);
    await fs.writeFile(win32.join(target, 'source.bin'), sourceBytes);
    await fs.symlink(target, junction, 'junction');
    const targetImage = await imageAt(win32.join(target, 'source.bin'));
    targetImage.sourcePath = win32.join(junction, 'source.bin');
    await expect(captureReferenceSource(targetImage)).rejects.toThrow(/再読込/);
  });

  it('rejects a case-alias source spelling before opening the file', async () => {
    const image = await imageAt(sourcePath);
    image.sourcePath = sourcePath.toUpperCase();
    const open = vi.spyOn(fs, 'open');
    await expect(captureReferenceSource(image)).rejects.toThrow(/再読込/);
    expect(open).not.toHaveBeenCalled();
  });

  it('retries exactly once when close fails before releasing the read descriptor', async () => {
    const image = await imageAt(sourcePath);
    const failure = new Error('pre-release close failure');
    let close: ReturnType<typeof vi.spyOn> | undefined;
    interceptOpen((handle) => {
      close = vi.spyOn(handle, 'close').mockRejectedValueOnce(failure);
    });
    await expect(captureReferenceSource(image)).rejects.toThrow(/再読込/);
    expect(close).toHaveBeenCalledTimes(2);
    expect(handles.every((handle) => handle.fd === -1)).toBe(true);
  });

  it('verifies a JSON-round-tripped manifest after closing and reopening SQLite', async () => {
    const stored = await persistReference();
    const serialized = JSON.stringify(referenceEntry(stored));
    database.close();
    database = openDatabase(databasePath);
    expect(migrateDatabase(database, migrations)).toBe(4);
    const reopened = findDataImport(database, projectId, importId)!;
    const detached = JSON.parse(serialized) as ReferenceImportSource;
    expect(referenceEntry(reopened)).toEqual(detached);
    expect(() => assertCapturedReferenceSource(detached)).toThrow(/captured Reference source/);
    const verified = await verifyReferenceSource(detached);
    expect(verified).toEqual({ status: 'verified', source: detached });
    if (verified.status !== 'verified') throw new Error('Expected verified fixture.');
    expect(verified.source).not.toBe(detached);
    expect(() => assertCapturedReferenceSourceCurrent(verified.source)).not.toThrow();
    deepFrozen(verified.source);
  });

  it('returns missing without creating, deleting, renaming or rewriting the source path', async () => {
    const stored = await persistReference();
    const entry = referenceEntry(stored);
    await fs.unlink(sourcePath);
    const write = vi.spyOn(fs, 'writeFile');
    const rename = vi.spyOn(fs, 'rename');
    const result = await verifyReferenceSource(entry);
    expect(result).toEqual({ status: 'relink-required', imageKey: 'image:0', sourcePath, reason: 'missing' });
    expect(write).not.toHaveBeenCalled();
    expect(rename).not.toHaveBeenCalled();
    await expect(fs.lstat(sourcePath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each([
    ['identity-changed', (entry: ReferenceImportSource) => ({ ...entry,
      identity: { ...entry.identity, ino: String(BigInt(entry.identity.ino) + 1n) } })],
    ['size-changed', (entry: ReferenceImportSource) => ({ ...entry, byteSize: entry.byteSize - 1 })],
    ['mtime-changed', (entry: ReferenceImportSource) => ({ ...entry,
      mtimeNs: String(BigInt(entry.mtimeNs) + 1n) })],
    ['hash-changed', (entry: ReferenceImportSource) => ({ ...entry, sha256: 'f'.repeat(64) })],
  ] as const)('classifies a persisted %s binding mismatch without hiding it as success', async (reason, alter) => {
    const stored = await persistReference();
    const changed = alter(referenceEntry(stored));
    await expect(verifyReferenceSource(changed)).resolves.toMatchObject({
      status: 'relink-required', imageKey: 'image:0', sourcePath, reason,
    });
  });

  it.each([
    ['inaccessible', 'EACCES'],
    ['read-failed', 'EIO'],
  ] as const)('returns %s for a finite read failure', async (reason, code) => {
    const stored = await persistReference();
    const entry = referenceEntry(stored);
    interceptOpen((handle) => {
      if (reason === 'read-failed') {
        mockDescriptorRead(handle, async () => { throw Object.assign(new Error('injected'), { code }); });
      }
    });
    if (reason === 'inaccessible') {
      vi.mocked(fs.open).mockRejectedValueOnce(Object.assign(new Error('denied'), { code }));
    }
    await expect(verifyReferenceSource(entry)).resolves.toMatchObject({ status: 'relink-required', reason });
  });

  it('returns unsafe if a persisted source becomes hard-linked', async () => {
    const stored = await persistReference();
    const alias = win32.join(sourceDirectory, 'alias.bin');
    await fs.link(sourcePath, alias);
    await expect(verifyReferenceSource(referenceEntry(stored))).resolves.toMatchObject({
      status: 'relink-required', reason: 'unsafe',
    });
    expect(native.readFileSync(sourcePath)).toEqual(sourceBytes);
  });

  it('returns changed when the file changes during verification instead of issuing a verified result', async () => {
    const stored = await persistReference();
    let changed = false;
    interceptOpen((handle) => {
      const read = handle.read.bind(handle);
      mockDescriptorRead(handle, async (buffer, offset, length, position) => {
        const result = await read(buffer, offset, length, position);
        if (!changed && result.bytesRead > 0) {
          native.appendFileSync(sourcePath, Buffer.from([0xff]));
          changed = true;
        }
        return result;
      });
    });
    await expect(verifyReferenceSource(referenceEntry(stored))).resolves.toMatchObject({
      status: 'relink-required', reason: 'changed',
    });
    expect(changed).toBe(true);
  });

  it('relinks a missing binding to an equal-size/equal-hash file in one transaction and preserves both sources', async () => {
    const original = await persistReference();
    const originalEntry = referenceEntry(original);
    const originalStat = await fs.lstat(sourcePath, { bigint: true });
    const candidatePath = win32.join(sourceDirectory, 'candidate.bin');
    await fs.writeFile(candidatePath, sourceBytes, { flag: 'wx' });
    const candidateStat = await fs.lstat(candidatePath, { bigint: true });
    await fs.unlink(sourcePath);
    const candidateBefore = native.readFileSync(candidatePath);
    const write = vi.spyOn(fs, 'writeFile');
    const unlink = vi.spyOn(fs, 'unlink');
    const rename = vi.spyOn(fs, 'rename');

    const updated = await relinkReferenceSource(database, projectId, importId, 'image:0', candidatePath, firstRelinkAt);
    expect(updated.updatedAt).toBe(firstRelinkAt);
    expect(updated.scanResult).toEqual(original.scanResult);
    expect(updated.scanResultSha256).toBe(original.scanResultSha256);
    expect(referenceEntry(updated)).toEqual({
      ...originalEntry,
      sourcePath: candidatePath,
      identity: identity(candidateStat),
      mtimeNs: String(candidateStat.mtimeNs),
    });
    expect(updated.sourceManifestSha256).not.toBe(original.sourceManifestSha256);
    expect(write).not.toHaveBeenCalled();
    expect(unlink).not.toHaveBeenCalled();
    expect(rename).not.toHaveBeenCalled();
    expect(native.readFileSync(candidatePath)).toEqual(candidateBefore);
    expect((await fs.lstat(candidatePath, { bigint: true })).mtimeNs).toBe(candidateStat.mtimeNs);
    expect(originalStat.size).toBe(BigInt(sourceBytes.length));

    database.close();
    database = openDatabase(databasePath);
    migrateDatabase(database, migrations);
    const reopened = findDataImport(database, projectId, importId)!;
    expect(reopened).toEqual(updated);
    await expect(verifyReferenceSource(referenceEntry(reopened))).resolves.toMatchObject({ status: 'verified' });
  });

  it.each(['size', 'hash'] as const)('rejects a relink candidate with mismatched %s before DB write', async (kind) => {
    const original = await persistReference();
    const before = rawHeader();
    const candidatePath = win32.join(sourceDirectory, 'mismatch.bin');
    const candidate = kind === 'size'
      ? Buffer.concat([sourceBytes, Buffer.from([1])])
      : Buffer.alloc(sourceBytes.length, 0x6c);
    await fs.writeFile(candidatePath, candidate, { flag: 'wx' });
    await expect(relinkReferenceSource(database, projectId, importId, 'image:0',
      candidatePath, firstRelinkAt)).rejects.toThrow(/一致しません/);
    expect(rawHeader()).toEqual(before);
    expect(findDataImport(database, projectId, importId)).toEqual(original);
    expect(native.readFileSync(candidatePath)).toEqual(candidate);
  });

  it('rejects Copy imports, missing/foreign imports and unknown image keys without candidate I/O', async () => {
    await persistCopy();
    const candidatePath = win32.join(sourceDirectory, 'candidate.bin');
    await fs.writeFile(candidatePath, sourceBytes);
    let open = vi.spyOn(fs, 'open');
    await expect(relinkReferenceSource(database, projectId, importId, 'image:0',
      candidatePath, firstRelinkAt)).rejects.toThrow(/Copy/);
    expect(open).not.toHaveBeenCalled();
    database.prepare('DELETE FROM import_sources WHERE import_id=?').run(importId);
    database.prepare('DELETE FROM data_imports WHERE id=?').run(importId);
    open.mockRestore();
    open = vi.spyOn(fs, 'open');
    await expect(relinkReferenceSource(database, projectId, importId, 'image:0',
      candidatePath, firstRelinkAt)).rejects.toThrow(/見つかりません/);
    await expect(relinkReferenceSource(database, otherProjectId, importId, 'image:0',
      candidatePath, firstRelinkAt)).rejects.toThrow(/見つかりません/);
    expect(open).not.toHaveBeenCalled();
  });

  it('rejects an unknown image key and an existing caller transaction before candidate I/O', async () => {
    await persistReference();
    const candidatePath = win32.join(sourceDirectory, 'candidate.bin');
    await fs.writeFile(candidatePath, sourceBytes);
    const open = vi.spyOn(fs, 'open');
    await expect(relinkReferenceSource(database, projectId, importId, 'missing',
      candidatePath, firstRelinkAt)).rejects.toThrow(/sourceが見つかりません/);
    database.exec('BEGIN IMMEDIATE');
    try {
      await expect(relinkReferenceSource(database, projectId, importId, 'image:0',
        candidatePath, firstRelinkAt)).rejects.toThrow(/existing transaction/);
      expect(database.inTransaction).toBe(true);
    } finally { database.exec('ROLLBACK'); }
    expect(open).not.toHaveBeenCalled();
  });

  it('preserves a foreign transaction begun while candidate hashing awaited', async () => {
    await persistReference();
    const candidatePath = win32.join(sourceDirectory, 'candidate.bin');
    await fs.writeFile(candidatePath, sourceBytes);
    let beganForeign = false;
    interceptOpen((handle, path) => {
      if (path !== candidatePath) return;
      const read = handle.read.bind(handle);
      mockDescriptorRead(handle, async (buffer, offset, length, position) => {
        if (!beganForeign) {
          beganForeign = true;
          database.exec('BEGIN IMMEDIATE');
          database.prepare('INSERT INTO settings(key,value) VALUES (?,?)').run('foreign-owner', 'preserve');
        }
        return read(buffer, offset, length, position);
      });
    });

    await expect(relinkReferenceSource(database, projectId, importId, 'image:0',
      candidatePath, firstRelinkAt)).rejects.toThrow(/existing transaction/);
    expect(beganForeign).toBe(true);
    expect(database.inTransaction).toBe(true);
    expect(database.prepare('SELECT value FROM settings WHERE key=?').get('foreign-owner'))
      .toEqual({ value: 'preserve' });
    database.exec('ROLLBACK');
    expect(database.prepare('SELECT value FROM settings WHERE key=?').get('foreign-owner')).toBeUndefined();
  });

  it('rolls back the header if the indexed entry changes after read but before its CAS update', async () => {
    const original = await persistReference();
    const before = rawHeader();
    const candidatePath = win32.join(sourceDirectory, 'candidate.bin');
    await fs.writeFile(candidatePath, sourceBytes);
    const realExec = database.exec.bind(database);
    let injected = false;
    vi.spyOn(database, 'exec').mockImplementation(((sql: string) => {
      if (sql === 'BEGIN IMMEDIATE' && !injected) {
        injected = true;
        database.prepare('UPDATE import_sources SET source_path=? WHERE import_id=? AND image_key=?')
          .run('D:\\tampered\\source.bin', importId, 'image:0');
      }
      return realExec(sql);
    }) as DatabaseConnection['exec']);

    await expect(relinkReferenceSource(database, projectId, importId, 'image:0',
      candidatePath, firstRelinkAt)).rejects.toThrow(/changed before relink/);
    expect(injected).toBe(true);
    expect(database.inTransaction).toBe(false);
    expect(rawHeader()).toEqual(before);
    expect(database.prepare('SELECT source_path FROM import_sources WHERE import_id=?').get(importId))
      .toEqual({ source_path: 'D:\\tampered\\source.bin' });
    expect(original.sourceManifestSha256).toBe(before.source_manifest_sha256);
  });

  it('rejects a stale full-manifest capability after another entry update and keeps the winner intact', async () => {
    const original = await persistReference();
    const alternatePath = win32.join(sourceDirectory, 'alternate.bin');
    const candidatePath = win32.join(sourceDirectory, 'candidate.bin');
    await fs.writeFile(alternatePath, sourceBytes);
    await fs.writeFile(candidatePath, sourceBytes);
    const alternate = await captureReferenceSource(await imageAt(alternatePath));
    const current = findDataImport(database, projectId, importId)!;
    const concurrent = prepareReferenceRelink(current, 'image:0', alternate, firstRelinkAt);
    let injected = false;
    interceptOpen((handle, path) => {
      if (path !== candidatePath) return;
      const read = handle.read.bind(handle);
      mockDescriptorRead(handle, async (buffer, offset, length, position) => {
        if (!injected) {
          injected = true;
          database.exec('BEGIN IMMEDIATE');
          try {
            applyReferenceRelink(database, concurrent);
            database.exec('COMMIT');
          } finally { if (database.inTransaction) database.exec('ROLLBACK'); }
        }
        return read(buffer, offset, length, position);
      });
    });
    await expect(relinkReferenceSource(database, projectId, importId, 'image:0',
      candidatePath, secondRelinkAt)).rejects.toThrow(/changed before relink/);
    expect(injected).toBe(true);
    expect(database.inTransaction).toBe(false);
    const winner = findDataImport(database, projectId, importId)!;
    expect(referenceEntry(winner).sourcePath).toBe(alternatePath);
    expect(winner.updatedAt).toBe(firstRelinkAt);
    expect(winner.scanResultSha256).toBe(original.scanResultSha256);
  });

  it('detects a same-byte candidate replacement at the final synchronous transaction guard', async () => {
    const original = await persistReference();
    const before = rawHeader();
    const candidatePath = win32.join(sourceDirectory, 'candidate.bin');
    const retainedPath = `${candidatePath}.retained`;
    await fs.writeFile(candidatePath, sourceBytes);
    const realLstat = native.lstatSync.bind(native);
    let candidateStats = 0;
    let replaced = false;
    vi.spyOn(native, 'lstatSync').mockImplementation(((path: native.PathLike, options?: unknown) => {
      if (normalizeFixturePath(path) === candidatePath && ++candidateStats === 3) {
        native.renameSync(candidatePath, retainedPath);
        native.writeFileSync(candidatePath, sourceBytes, { flag: 'wx' });
        replaced = true;
      }
      return realLstat(path, options as never);
    }) as typeof native.lstatSync);

    await expect(relinkReferenceSource(database, projectId, importId, 'image:0',
      candidatePath, firstRelinkAt)).rejects.toThrow(/safely read/);
    expect(replaced).toBe(true);
    expect(database.inTransaction).toBe(false);
    expect(rawHeader()).toEqual(before);
    expect(findDataImport(database, projectId, importId)).toEqual(original);
    expect(native.readFileSync(candidatePath)).toEqual(sourceBytes);
    expect(native.readFileSync(retainedPath)).toEqual(sourceBytes);
  });

  it.each(['commit-failure', 'commit-ack-loss'] as const)(
    'does not auto-retry or misreport a %s', async (kind) => {
      const original = await persistReference();
      const candidatePath = win32.join(sourceDirectory, 'candidate.bin');
      await fs.writeFile(candidatePath, sourceBytes);
      const realExec = database.exec.bind(database);
      const failure = new Error(kind);
      vi.spyOn(database, 'exec').mockImplementation(((sql: string) => {
        if (sql === 'COMMIT') {
          if (kind === 'commit-ack-loss') realExec(sql);
          throw failure;
        }
        return realExec(sql);
      }) as DatabaseConnection['exec']);

      if (kind === 'commit-failure') {
        await expect(relinkReferenceSource(database, projectId, importId, 'image:0',
          candidatePath, firstRelinkAt)).rejects.toBe(failure);
        expect(database.inTransaction).toBe(false);
        expect(findDataImport(database, projectId, importId)).toEqual(original);
      } else {
        await expect(relinkReferenceSource(database, projectId, importId, 'image:0',
          candidatePath, firstRelinkAt)).rejects.toMatchObject({ errors: expect.arrayContaining([failure]) });
        expect(database.inTransaction).toBe(false);
        const committed = findDataImport(database, projectId, importId)!;
        expect(referenceEntry(committed).sourcePath).toBe(candidatePath);
        expect(committed.updatedAt).toBe(firstRelinkAt);
      }
    },
  );

  it.each(['commit', 'rollback'] as const)(
    'preserves a foreign transaction started after native %s and a lost COMMIT acknowledgement', async (outcome) => {
      const original = await persistReference();
      const candidatePath = win32.join(sourceDirectory, 'candidate.bin');
      await fs.writeFile(candidatePath, sourceBytes);
      const realExec = database.exec.bind(database);
      const failure = new Error('lost acknowledgement after another owner began');
      const exec = vi.spyOn(database, 'exec').mockImplementation(((sql: string) => {
        if (sql === 'COMMIT') {
          realExec(outcome === 'commit' ? 'COMMIT' : 'ROLLBACK');
          realExec('BEGIN IMMEDIATE');
          database.prepare('INSERT INTO settings(key,value) VALUES (?,?)').run('after-commit-owner', 'preserve');
          throw failure;
        }
        return realExec(sql);
      }) as DatabaseConnection['exec']);

      await expect(relinkReferenceSource(database, projectId, importId, 'image:0',
        candidatePath, firstRelinkAt)).rejects.toMatchObject({ errors: expect.arrayContaining([failure]) });
      expect(database.inTransaction).toBe(true);
      expect(database.prepare('SELECT value FROM settings WHERE key=?').get('after-commit-owner'))
        .toEqual({ value: 'preserve' });
      expect(exec.mock.calls.filter(([sql]) => sql === 'COMMIT')).toHaveLength(1);
      const stored = findDataImport(database, projectId, importId)!;
      if (outcome === 'commit') expect(referenceEntry(stored).sourcePath).toBe(candidatePath);
      else expect(stored).toEqual(original);
      realExec('ROLLBACK');
      expect(database.prepare('SELECT value FROM settings WHERE key=?').get('after-commit-owner')).toBeUndefined();
    },
  );

  it('persists, verifies, relinks and verifies again across four real app-process lifetimes', async () => {
    const processDatabase = win32.join(temporary, 'process.sqlite3');
    const candidatePath = win32.join(sourceDirectory, 'process-candidate.bin');
    const retainedPath = win32.join(sourceDirectory, 'process-original-retained.bin');
    const bundleDirectory = win32.join(process.cwd(), 'test-results', '.dat12-process');
    const bundlePath = win32.join(bundleDirectory, `reference-${process.pid}-${Date.now()}.mjs`);
    const originalStat = await fs.lstat(sourcePath, { bigint: true });
    try {
      await fs.mkdir(bundleDirectory, { recursive: true });
      await buildProcessFixture(bundlePath);
      const persisted = await runNodeProcess(bundlePath, ['persist', processDatabase, sourcePath, '', firstRelinkAt]);
      expect(persisted).toMatchObject({ phase: 'persist', sourcePath, sha256: digest(sourceBytes) });
      expect(native.readFileSync(sourcePath)).toEqual(sourceBytes);
      expect((await fs.lstat(sourcePath, { bigint: true })).mtimeNs).toBe(originalStat.mtimeNs);

      const verified = await runNodeProcess(bundlePath, ['verify', processDatabase, sourcePath, '', firstRelinkAt]);
      expect(verified).toMatchObject({ phase: 'verify', result: { status: 'verified' } });

      await fs.rename(sourcePath, retainedPath);
      await fs.writeFile(candidatePath, sourceBytes, { flag: 'wx' });
      const candidateStat = await fs.lstat(candidatePath, { bigint: true });
      const relinked = await runNodeProcess(bundlePath,
        ['relink', processDatabase, retainedPath, candidatePath, firstRelinkAt]);
      expect(relinked).toMatchObject({
        phase: 'relink',
        before: { status: 'relink-required', reason: 'missing' },
        after: { status: 'verified' },
        sourcePath: candidatePath,
      });
      expect(native.readFileSync(retainedPath)).toEqual(sourceBytes);
      expect(native.readFileSync(candidatePath)).toEqual(sourceBytes);
      expect((await fs.lstat(retainedPath, { bigint: true })).mtimeNs).toBe(originalStat.mtimeNs);
      expect((await fs.lstat(candidatePath, { bigint: true })).mtimeNs).toBe(candidateStat.mtimeNs);

      const verifiedAgain = await runNodeProcess(bundlePath,
        ['verify', processDatabase, retainedPath, candidatePath, secondRelinkAt]);
      expect(verifiedAgain).toMatchObject({ phase: 'verify', result: { status: 'verified',
        source: { sourcePath: candidatePath, sha256: digest(sourceBytes) } } });
    } finally {
      await fs.rm(bundlePath, { force: true });
    }
  }, 60_000);
});
