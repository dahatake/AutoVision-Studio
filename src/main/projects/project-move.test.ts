// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto';
import native from 'node:fs';
import fs, { type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, win32 } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import type { Project } from '../../shared/contracts/project.js';
import { openDatabase, type DatabaseConnection } from '../db/database.js';
import { migrateDatabase } from '../db/migrate.js';
import { createProjectDirectory, verifyProjectDirectory, type ProjectDirectoryReceipt, type ProjectFileIdentity } from './project-directory.js';
import { assertProjectNotMoving, calculateProjectMoveCapacity, inventoryProjectMove, moveProjectDirectory, preflightProjectMove, recoverProjectMove, revalidateProjectMoveInventory, snapshotProjectMoveParent, type ProjectMoveSelectedParent } from './project-move.js';
import * as projectMove from './project-move.js';
import { createProjectMoveReceipt, decodeProjectMoveReceipt, encodeProjectMoveReceipt, getProjectMoveRemovalOrder, readProjectMoveReceipt, type MoveReceipt, type StoredMoveReceipt } from './project-move-receipt.js';
import * as receiptStorage from './project-move-receipt.js';
import { createProject, getProject, moveProject, updateProject } from './project-service.js';

const id = 'b66a587d-619c-4cc8-850b-c677f0698311';
const otherId = 'ef0c592c-2055-4f68-9c4a-7d7f6cd3ead2';
const markerName = '.autovision-project.json';
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

describe.skipIf(process.platform !== 'win32')('CORE-06C read-only Project move inventory', () => {
  let temporary: string;
  let source: ProjectDirectoryReceipt;
  let destination: string;
  beforeEach(async () => {
    temporary = native.realpathSync.native(await fs.mkdtemp(join(tmpdir(), 'autovision-core06c-')));
    source = createProjectDirectory(temporary, id, []);
    destination = join(temporary, 'destination');
    await fs.mkdir(destination);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    // All fixture files AND link targets belong exclusively to this test's mkdtemp.
    if (temporary) await fs.rm(temporary, { recursive: true, force: true });
  });

  it('inventories real nested files, empty directories and the marker with streamed byte counts', async () => {
    await fs.mkdir(join(source.rootPath, '画像', 'empty'), { recursive: true });
    const bytes = Buffer.alloc(150_001, 0x5a);
    await fs.writeFile(join(source.rootPath, '画像', 'one.bin'), bytes);
    await fs.writeFile(join(source.rootPath, 'zero'), Buffer.alloc(0));
    const marker = await fs.readFile(join(source.rootPath, markerName));
    const inventory = await inventoryProjectMove(source, []);
    expect(inventory.source).toEqual(source);
    expect(inventory.directories.map((entry) => entry.relativePath)).toEqual(['', '画像', '画像/empty']);
    expect(inventory.files.find((entry) => entry.relativePath === '画像/one.bin')).toMatchObject({
      sizeBytes: BigInt(bytes.length), sha256: sha256(bytes),
    });
    expect(inventory.files.find((entry) => entry.relativePath === markerName)?.sha256).toBe(sha256(marker));
    expect(inventory.totalBytes).toBe(BigInt(bytes.length + marker.length));
    expect(Object.isFrozen(inventory.files)).toBe(true);
    await expect(revalidateProjectMoveInventory(inventory)).resolves.toBeUndefined();
    expect(await fs.readFile(join(source.rootPath, '画像', 'one.bin'))).toEqual(bytes);
    expect(await fs.readdir(destination)).toEqual([]);
  });

  it.each(['missing', 'corrupt', 'other-id', 'receipt-identity'] as const)('rejects %s ownership without touching source bytes', async (kind) => {
    const marker = join(source.rootPath, markerName);
    await fs.writeFile(join(source.rootPath, 'keep'), 'keep');
    if (kind === 'missing') await fs.unlink(marker);
    if (kind === 'corrupt') await fs.writeFile(marker, '{}');
    const claimed = kind === 'other-id' ? { ...source, projectId: otherId }
      : kind === 'receipt-identity' ? { ...source, rootIdentity: { ...source.rootIdentity, ino: '0' } } : source;
    await expect(inventoryProjectMove(claimed, [])).rejects.toThrow();
    expect(await fs.readFile(join(source.rootPath, 'keep'), 'utf8')).toBe('keep');
    expect(await fs.readdir(destination)).toEqual([]);
  });

  it('rejects same, ancestor and descendant protected roots, but not sibling prefixes', async () => {
    const nested = join(source.rootPath, 'originals');
    await fs.mkdir(nested);
    for (const root of [source.rootPath.toUpperCase(), temporary, nested]) {
      await expect(inventoryProjectMove(source, [root])).rejects.toThrow(/重複/);
    }
    const sibling = `${source.rootPath}-originals`;
    await fs.mkdir(sibling);
    await expect(inventoryProjectMove(source, [sibling])).resolves.toMatchObject({ protectedRoots: [sibling] });
  });

  it('does not parse JSON or open Reference, sample or sibling Project payloads', async () => {
    const original = join(temporary, 'original');
    const sample = join(temporary, 'sample');
    await fs.mkdir(original);
    await fs.mkdir(sample);
    const other = createProjectDirectory(temporary, otherId, [source.rootPath]);
    const target = join(original, 'external.bin');
    await fs.writeFile(target, 'external');
    const bytes = Buffer.from(JSON.stringify({ referencePath: target, missing: join(sample, 'absent'), other: other.rootPath }));
    await fs.writeFile(join(source.rootPath, 'manifest.json'), bytes);
    const open = vi.spyOn(fs, 'open');
    const inventory = await inventoryProjectMove(source, [original, sample, other.rootPath]);
    expect(inventory.files.map((entry) => entry.relativePath)).toEqual([markerName, 'manifest.json']);
    expect(open.mock.calls.every(([path]) => String(path).startsWith(`${source.rootPath}\\`))).toBe(true);
    expect(await fs.readFile(target, 'utf8')).toBe('external');
    expect(await fs.readFile(join(source.rootPath, 'manifest.json'))).toEqual(bytes);
  });

  for (const kind of ['junction', 'hardlink', 'symlink'] as const) {
  it(`rejects source ${kind} without traversing its target`, async ({ skip }) => {
    const target = join(temporary, 'target');
    const link = join(source.rootPath, 'linked');
    if (kind === 'junction') await fs.mkdir(target);
    else await fs.writeFile(target, 'external');
    try {
      if (kind === 'hardlink') await fs.link(target, link);
      else await fs.symlink(target, link, kind === 'junction' ? 'junction' : 'file');
    } catch (error) {
      if (kind === 'symlink' && (error as NodeJS.ErrnoException).code === 'EPERM') { skip(); return; }
      throw error;
    }
    const open = vi.spyOn(fs, 'open');
    await expect(inventoryProjectMove(source, [])).rejects.toThrow(/リンク|hardlink/);
    expect(open.mock.calls.some(([path]) => path === link || path === target)).toBe(false);
    expect((await fs.lstat(target)).isDirectory()).toBe(kind === 'junction');
    if (kind !== 'junction') expect(await fs.readFile(target, 'utf8')).toBe('external');
  });
  }

  it.each(['../outside', 'NUL.txt', 'COM¹', 'a:stream', 'trail.', 'trail ', 'a\\b', 'bad\nname'])('rejects unsafe enumerated Windows name %j before opening', async (name) => {
    vi.spyOn(fs, 'readdir').mockResolvedValue([markerName, name] as never);
    const open = vi.spyOn(fs, 'open');
    await expect(inventoryProjectMove(source, [])).rejects.toThrow(/Windowsパス/);
    expect(open).not.toHaveBeenCalled();
  });

  it('rejects case-colliding directory entries before opening either spelling', async () => {
    vi.spyOn(fs, 'readdir').mockResolvedValue(['same.bin', 'SAME.bin'] as never);
    const open = vi.spyOn(fs, 'open');
    await expect(inventoryProjectMove(source, [])).rejects.toThrow(/重複/);
    expect(open).not.toHaveBeenCalled();
  });

  it('rejects nonregular metadata rather than counting a guessed size', async () => {
    const path = join(source.rootPath, 'device');
    await fs.writeFile(path, 'x');
    const lstat = fs.lstat.bind(fs);
    vi.spyOn(fs, 'lstat').mockImplementation((async (file, options) => {
      const stat = await lstat(file, options);
      if (file === path) stat.isFile = () => false;
      return stat;
    }) as typeof fs.lstat);
    await expect(inventoryProjectMove(source, [])).rejects.toThrow(/非通常/);
  });

  it('rejects same-byte-count changes even when mtime is restored', async () => {
    const path = join(source.rootPath, 'payload');
    await fs.writeFile(path, 'AAAA');
    const inventory = await inventoryProjectMove(source, []);
    const before = await fs.stat(path);
    await fs.writeFile(path, 'BBBB');
    await fs.utimes(path, before.atime, before.mtime);
    await expect(revalidateProjectMoveInventory(inventory)).rejects.toThrow(/変更/);
    await expect(preflightProjectMove(inventory, destination)).rejects.toThrow(/変更/);
    expect(await fs.readFile(path, 'utf8')).toBe('BBBB');
    expect(await fs.readdir(destination)).toEqual([]);
  });

  it('rejects a real same-length mutation during a streamed read', async () => {
    const path = join(source.rootPath, 'payload');
    await fs.writeFile(path, Buffer.alloc(150_001, 0x41));
    const open = fs.open.bind(fs);
    let mutated = false;
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await open(...args);
      if (args[0] === path) {
        const createReadStream = handle.createReadStream.bind(handle);
        vi.spyOn(handle, 'createReadStream').mockImplementation((options) => {
          const stream = createReadStream(options);
          stream.once('data', () => {
            // Synchronous fixture mutation pins the race to a real read, without timers.
            native.writeFileSync(path, Buffer.alloc(150_001, 0x42));
            native.utimesSync(path, new Date(0), new Date(0));
            mutated = true;
          });
          return stream;
        });
      }
      return handle;
    });
    await expect(inventoryProjectMove(source, [])).rejects.toThrow(/変更/);
    expect(mutated).toBe(true);
    expect((await fs.stat(path)).size).toBe(150_001);
    expect(await fs.readdir(destination)).toEqual([]);
  });

  it.each(['short', 'long', 'failure'] as const)('rejects %s stream without returning an estimated inventory', async (kind) => {
    const path = join(source.rootPath, 'payload');
    await fs.writeFile(path, 'AAAA');
    const open = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await open(...args);
      if (args[0] === path) vi.spyOn(handle, 'createReadStream').mockReturnValue(Readable.from((async function* () {
        if (kind === 'failure') throw new Error('read failure');
        yield Buffer.from(kind === 'short' ? 'AAA' : 'AAAAA');
      })()) as ReturnType<typeof handle.createReadStream>);
      return handle;
    });
    await expect(inventoryProjectMove(source, [])).rejects.toThrow();
    expect(await fs.readFile(path, 'utf8')).toBe('AAAA');
  });

  it.each(['stable', 'settled', 'handle-change', 'path-change'] as const)('keeps same-API ctime semantics: %s', async (kind) => {
    const path = join(source.rootPath, 'payload');
    await fs.writeFile(path, 'AAAA');
    const open = fs.open.bind(fs);
    const lstat = fs.lstat.bind(fs);
    let opened = false;
    let pathReads = 0;
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await open(...args);
      if (args[0] === path) {
        opened = true;
        const stat = handle.stat.bind(handle);
        let calls = 0;
        vi.spyOn(handle, 'stat').mockImplementation((async (options) => {
          const result = await stat(options);
          if ('ctimeNs' in result && typeof result.ctimeNs === 'bigint') result.ctimeNs += 100n + (kind === 'handle-change' && ++calls > 1 ? 1n : 0n);
          return result;
        }) as typeof handle.stat);
      }
      return handle;
    });
    vi.spyOn(fs, 'lstat').mockImplementation((async (file, options) => {
      const result = await lstat(file, options);
      if (file === path && opened && 'ctimeNs' in result && typeof result.ctimeNs === 'bigint') {
        pathReads += 1;
        if (kind === 'settled' || (kind === 'path-change' && pathReads > 1)) result.ctimeNs += 7n;
      }
      return result;
    }) as typeof fs.lstat);
    if (kind === 'stable' || kind === 'settled') await expect(inventoryProjectMove(source, [])).resolves.toMatchObject({ source });
    else await expect(inventoryProjectMove(source, [])).rejects.toThrow(/変更/);
  });

  it('uses parent statfs bavail, not bfree, and writes no destination on shortage', async () => {
    const inventory = await inventoryProjectMove(source, []);
    const required = calculateProjectMoveCapacity(inventory.totalBytes, 0n, 1n).requiredBytes;
    const statfs = vi.spyOn(fs, 'statfs').mockResolvedValue({ type: 0n, bsize: 1n, blocks: required * 10n,
      bfree: required * 10n, bavail: required - 1n, files: 0n, ffree: 0n });
    await expect(preflightProjectMove(inventory, destination)).rejects.toThrow(/不足/);
    expect(statfs).toHaveBeenCalledWith(destination, { bigint: true });
    expect(await fs.readdir(destination)).toEqual([]);
    statfs.mockResolvedValue({ type: 0n, bsize: 1n, blocks: required, bfree: required, bavail: required, files: 0n, ffree: 0n });
    await expect(preflightProjectMove(inventory, destination)).resolves.toMatchObject({
      destinationParent: destination, destinationRoot: join(destination, id), capacity: { requiredBytes: required, sufficient: true },
    });
    await expect(revalidateProjectMoveInventory(inventory)).resolves.toBeUndefined();
  });

  it('rejects overlapping, linked, missing and already occupied destinations', async () => {
    const original = join(temporary, 'original');
    await fs.mkdir(original);
    const inventory = await inventoryProjectMove(source, [original]);
    const alias = join(temporary, 'alias');
    await fs.symlink(destination, alias, 'junction');
    await fs.mkdir(join(destination, id));
    for (const parent of [source.rootPath, original, temporary, destination, alias, join(temporary, 'missing')]) {
      await expect(preflightProjectMove(inventory, parent)).rejects.toThrow();
    }
    expect(await fs.readdir(destination)).toEqual([id]);
    await expect(revalidateProjectMoveInventory(inventory)).resolves.toBeUndefined();
  });
});

describe('CORE-06C exact move capacity arithmetic', () => {
  it('includes destination plus temporary plus ceiling 20%, accepting exact equality', () => {
    expect(calculateProjectMoveCapacity(3n, 8n, 1n)).toEqual({ destinationBytes: 3n, temporaryBytes: 3n,
      generatedBytes: 0n, safetyBytes: 2n, requiredBytes: 8n, availableBytes: 8n, sufficient: true });
    expect(calculateProjectMoveCapacity(3n, 7n, 1n).sufficient).toBe(false);
  });
  it('handles zero and values beyond floating point range without converting to number', () => {
    expect(calculateProjectMoveCapacity(0n, 0n, 4096n).requiredBytes).toBe(0n);
    const huge = 10n ** 400n;
    expect(calculateProjectMoveCapacity(huge, huge, 3n)).toMatchObject({ requiredBytes: huge * 12n / 5n,
      availableBytes: huge * 3n, sufficient: true });
  });
  it.each([[-1n, 1n, 1n], [1n, -1n, 1n], [1n, 1n, 0n], [1n, 1n, -1n]])('rejects unknown/invalid capacity case %#', (total, available, block) => {
    expect(() => calculateProjectMoveCapacity(total, available, block)).toThrow();
  });
});

describe.skipIf(process.platform !== 'win32')('CORE-06D/E1b real SQLite non-destructive move (same-volume fixture)', () => {
  let temporary: string;
  let database: DatabaseConnection;
  let project: Project;
  let other: Project;
  let destination: string;
  let target: string;
  let receiptDirectory: string;
  let receiptPath: string;
  let original: string;
  let bytes: Map<string, Buffer>;
  const handles: FileHandle[] = [];
  const sql = native.readFileSync(new URL('../db/migrations/001_core.sql', import.meta.url), 'utf8');
  beforeEach(async () => {
    temporary = native.realpathSync.native(await fs.mkdtemp(join(tmpdir(), 'autovision-core06d-')));
    database = openDatabase(join(temporary, 'metadata.sqlite3'));
    migrateDatabase(database, [{ version: 1, sql }]);
    project = createProject(database, { name: '移動元', taskType: 'classification', workspacePath: temporary });
    other = createProject(database, { name: '隣接Project', taskType: 'detection', workspacePath: temporary });
    destination = join(temporary, 'New Parent 日本語');
    await fs.mkdir(destination);
    target = join(destination, project.id);
    // Simulate Main startup's configured, already provisioned app-data location.
    receiptDirectory = join(temporary, 'app-data', 'project-moves');
    await fs.mkdir(receiptDirectory, { recursive: true });
    receiptPath = join(receiptDirectory, `${project.id}.json`);
    original = join(temporary, 'original');
    await fs.mkdir(original);
    await fs.writeFile(join(original, 'reference.bin'), 'never copy or remove');
    await fs.writeFile(join(other.workspacePath, 'keep'), 'other project');
    await fs.mkdir(join(project.workspacePath, '画像', 'empty'), { recursive: true });
    bytes = new Map([
      [markerName, await fs.readFile(join(project.workspacePath, markerName))],
      ['画像/data.bin', Buffer.alloc(150_001, 0x81)],
      ['zero.bin', Buffer.alloc(0)],
      ['reference.json', Buffer.from(JSON.stringify({ referencePath: join(original, 'reference.bin') }))],
    ]);
    for (const [relative, content] of bytes) {
      if (relative !== markerName) await fs.writeFile(join(project.workspacePath, relative), content);
    }
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    for (const handle of handles.splice(0)) if (handle.fd !== -1) await handle.close();
    if (database?.open) database.close();
    // Only this mkdtemp's disposable fixtures, never production cleanup policy.
    if (temporary) await fs.rm(temporary, { recursive: true, force: true });
  });
  const verifySource = async () => {
    for (const [relative, content] of bytes) expect(await fs.readFile(join(project.workspacePath, relative))).toEqual(content);
    expect(await fs.readFile(join(original, 'reference.bin'), 'utf8')).toBe('never copy or remove');
    expect(await fs.readFile(join(other.workspacePath, 'keep'), 'utf8')).toBe('other project');
    expect(getProject(database, other.id)).toEqual(other);
  };
  // Intercept a real destination handle, not a filesystem factory. The callback
  // runs after a real write while the complete move is awaiting that write.
  const onWrite = (effect: (handle: Awaited<ReturnType<typeof fs.open>>) => Promise<void>) => {
    const open = fs.open.bind(fs);
    let fired = false;
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await open(...args);
      if (args[0] === join(target, '画像/data.bin') && args[1] === 'wx') {
        const write = handle.write.bind(handle);
        vi.spyOn(handle, 'write').mockImplementation((async (...parameters: Parameters<typeof handle.write>) => {
          const result = await write(...parameters);
          if (!fired) { fired = true; await effect(handle); }
          return result;
        }) as typeof handle.write);
      }
      return handle;
    });
  };

  const onReceiptOpen = (configure: (handle: FileHandle, path: string, flags: string | number) => void) => {
    const open = fs.open.bind(fs);
    return vi.spyOn(fs, 'open').mockImplementation(async (path, flags, mode) => {
      const handle = await open(path, flags, mode);
      if (dirname(String(path)) === receiptDirectory) {
        handles.push(handle);
        configure(handle, String(path), flags ?? 'r');
      }
      return handle;
    });
  };

  it('copies every raw byte with canonical names, commits the UUID child and retains the complete source', async () => {
    const open = vi.spyOn(fs, 'open');
    const result = await moveProjectDirectory(database, project.id.toUpperCase(), destination, [original], receiptDirectory);
    expect(result.sourceRetained).toBe(true);
    expect(result.project).toMatchObject({ ...project, workspacePath: target, updatedAt: result.project.updatedAt });
    expect(result.targetReceipt.rootPath).toBe(native.realpathSync.native(target));
    expect(result.sourceInventory.files.map((entry) => entry.relativePath).sort()).toEqual([...bytes.keys()].sort());
    expect(result.targetInventory.files.map((entry) => entry.relativePath).sort()).toEqual([...bytes.keys()].sort());
    expect(result.targetReceipt.markerIdentity).not.toEqual(result.sourceInventory.source.markerIdentity);
    expect(result.storedReceipt.receipt).toMatchObject({ phase: 'prepared', source: result.sourceInventory,
      targetPath: target, target: result.targetInventory, cursor: 0, pendingDelete: null });
    expect(result.storedReceipt.sha256).toBe(sha256(await fs.readFile(receiptPath)));
    for (const [relative, content] of bytes) expect(await fs.readFile(join(target, relative))).toEqual(content);
    expect(await fs.readdir(join(target, '画像/empty'))).toEqual([]);
    expect(open.mock.calls.filter(([path, flag]) => flag === 'wx' && String(path).startsWith(`${target}\\`)).map(([path]) => path).sort())
      .toEqual([...bytes.keys()].filter((name) => name !== markerName).map((name) => join(target, name)).sort());
    expect(open.mock.calls.some(([path]) => String(path).startsWith(`${original}\\`))).toBe(false);
    expect(database.inTransaction).toBe(false);
    await verifySource();
    await expect(revalidateProjectMoveInventory(result.sourceInventory)).resolves.toBeUndefined();
    await expect(revalidateProjectMoveInventory(result.targetInventory)).resolves.toBeUndefined();
    database.close();
    database = openDatabase(join(temporary, 'metadata.sqlite3'));
    expect(getProject(database, project.id)).toEqual(result.project);
  });

  it.each(['BEGIN DEFERRED', 'BEGIN IMMEDIATE', 'SAVEPOINT caller'])('rejects nested %s before any filesystem access', async (begin) => {
    database.exec(begin);
    const inspect = vi.spyOn(native, 'lstatSync');
    const asynchronous = vi.spyOn(fs, 'lstat');
    const open = vi.spyOn(fs, 'open');
    const exec = vi.spyOn(database, 'exec');
    await expect(moveProjectDirectory(database, project.id, destination, [original], receiptDirectory)).rejects.toThrow(/transaction/);
    expect(inspect).not.toHaveBeenCalled();
    expect(asynchronous).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(exec).not.toHaveBeenCalled();
    expect(database.inTransaction).toBe(true);
    database.exec('ROLLBACK');
    expect(await fs.readdir(destination)).toEqual([]);
  });

  it('cleans only its copies after an actual partial write then rejection, with no SQL transaction during copy', async () => {
    onWrite(async () => {
      expect(database.inTransaction).toBe(false);
      expect(getProject(database, project.id)).toEqual(project);
      throw new Error('injected write failure after bytes');
    });
    await expect(moveProjectDirectory(database, project.id, destination, [original], receiptDirectory)).rejects.toThrow(/injected write failure/);
    expect(await fs.readdir(destination)).toEqual([]);
    expect(getProject(database, project.id)).toEqual(project);
    expect(database.inTransaction).toBe(false);
    expect(await readProjectMoveReceipt(receiptDirectory, project.id, getProject(database, project.id).workspacePath))
      .toMatchObject({ receipt: { phase: 'copying', targetPath: target, target: null, cursor: 0, pendingDelete: null } });
    expect(() => assertProjectNotMoving(database, project.id)).not.toThrow();
    await verifySource();
  });

  it.each(['ABORT', 'FAIL', 'ROLLBACK'])('rolls back real SQLite RAISE(%s) after the entire tree was copied', async (action) => {
    database.exec(`CREATE TRIGGER reject_move AFTER UPDATE OF workspace_path ON projects
      BEGIN SELECT RAISE(${action}, 'injected move DB failure'); END;`);
    const prepare = database.prepare.bind(database);
    let reached = false;
    vi.spyOn(database, 'prepare').mockImplementation((statement) => {
      if (statement.startsWith('UPDATE projects SET')) {
        reached = true;
        expect(database.inTransaction).toBe(true);
        expect(decodeProjectMoveReceipt(native.readFileSync(receiptPath)).phase).toBe('prepared');
        for (const [relative, content] of bytes) expect(native.readFileSync(join(target, relative))).toEqual(content);
      }
      return prepare(statement);
    });
    await expect(moveProjectDirectory(database, project.id, destination, [original], receiptDirectory)).rejects.toThrow(/injected move DB failure/);
    expect(reached).toBe(true);
    expect(database.inTransaction).toBe(false);
    expect(getProject(database, project.id)).toEqual(project);
    expect(await fs.readdir(destination)).toEqual([]);
    // The prepared record survives D's own-copy cleanup; it is not a ready flag.
    expect(await readProjectMoveReceipt(receiptDirectory, project.id, getProject(database, project.id).workspacePath))
      .toMatchObject({ receipt: { phase: 'prepared', targetPath: target, target: { source: { rootPath: target } },
        source: { source: { rootPath: project.workspacePath } }, cursor: 0, pendingDelete: null } });
    await verifySource();
  });

  it('never adopts or overwrites an existing destination', async () => {
    await fs.mkdir(target);
    await fs.writeFile(join(target, 'keep'), 'occupied');
    await expect(moveProjectDirectory(database, project.id, destination, [original], receiptDirectory)).rejects.toThrow(/既に存在/);
    expect(await fs.readFile(join(target, 'keep'), 'utf8')).toBe('occupied');
    expect(getProject(database, project.id)).toEqual(project);
    await verifySource();
  });

  it('R14 rejects an unrepresentable prepared receipt before intent, target, copy or DB write', async () => {
    const failure = new Error('injected R14 prepared capacity rejection');
    const estimate = vi.spyOn(receiptStorage, 'assertProjectMoveReceiptCanPrepare').mockImplementationOnce(() => { throw failure; });
    const mkdir = vi.spyOn(native, 'mkdirSync');
    const open = vi.spyOn(fs, 'open');
    const exec = vi.spyOn(database, 'exec');
    await expect(moveProjectDirectory(database, project.id, destination, [original], receiptDirectory)).rejects.toBe(failure);
    expect(estimate).toHaveBeenCalledOnce();
    expect(mkdir.mock.calls.some(([path]) => path === target)).toBe(false);
    expect(open.mock.calls.some(([path, flags]) => flags === 'wx'
      && (path === receiptPath || String(path).startsWith(`${target}\\`)))).toBe(false);
    expect(native.existsSync(receiptPath)).toBe(false);
    expect(native.existsSync(target)).toBe(false);
    expect(exec).not.toHaveBeenCalled();
    expect(getProject(database, project.id)).toEqual(project);
    await verifySource();
  });

  it('checks every registered Project root without requiring the caller to list them', async () => {
    await expect(moveProjectDirectory(database, project.id, other.workspacePath, [], receiptDirectory)).rejects.toThrow(/重複/);
    expect(getProject(database, project.id)).toEqual(project);
    await verifySource();
  });

  it.each(['unknown', 'changed-copy', 'replaced-root'])('preserves a target with %s rather than recursively cleaning it', async (kind) => {
    onWrite(async (handle) => {
      if (kind === 'unknown') await fs.writeFile(join(target, 'intruder'), 'do not remove');
      if (kind === 'changed-copy') await fs.writeFile(join(target, 'reference.json'), 'changed copy');
      if (kind === 'replaced-root') {
        // Windows forbids renaming the directory while this writer is open.
        // Simulate replacement only after releasing that handle.
        await handle.close();
        await fs.rename(target, join(destination, 'retained-original'));
        await fs.mkdir(target);
        await fs.writeFile(join(target, 'intruder'), 'replacement');
      }
      throw new Error('injected intrusion');
    });
    await expect(moveProjectDirectory(database, project.id, destination, [original], receiptDirectory)).rejects.toBeInstanceOf(AggregateError);
    expect(getProject(database, project.id)).toEqual(project);
    const retained = kind === 'changed-copy' ? 'reference.json' : 'intruder';
    expect(await fs.readFile(join(target, retained), 'utf8')).toBe(kind === 'unknown' ? 'do not remove' : kind === 'changed-copy' ? 'changed copy' : 'replacement');
    await verifySource();
  });

  it('rejects an earlier source file changed during a later copy, without undoing the external edit', async () => {
    const revised = Buffer.from('externally changed');
    onWrite(async () => { await fs.writeFile(join(project.workspacePath, 'reference.json'), revised); });
    await expect(moveProjectDirectory(database, project.id, destination, [original], receiptDirectory)).rejects.toThrow(/変更/);
    bytes.set('reference.json', revised);
    expect(getProject(database, project.id)).toEqual(project);
    expect(await fs.readdir(destination)).toEqual([]);
    await verifySource();
  });

  it('preserves a replacement installed while closing the final cleanup hash handle', async () => {
    database.exec(`CREATE TRIGGER reject_move AFTER UPDATE OF workspace_path ON projects
      BEGIN SELECT RAISE(ABORT, 'injected cleanup race'); END;`);
    const path = join(target, 'reference.json');
    const retained = join(temporary, 'retained-reference.json');
    const replacement = Buffer.from('unknown replacement: do not remove or rename');
    const exec = database.exec.bind(database);
    let cleanup = false;
    vi.spyOn(database, 'exec').mockImplementation((statement) => {
      const result = exec(statement);
      if (statement === 'ROLLBACK') cleanup = true;
      return result;
    });
    const open = fs.open.bind(fs);
    let cleanupReads = 0;
    let replaced = false;
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await open(...args);
      if (cleanup && args[0] === path && args[1] === 'r' && ++cleanupReads === 2) {
        const close = handle.close.bind(handle);
        vi.spyOn(handle, 'close').mockImplementation(async () => {
          await close();
          // Only the fixture renames its old copy, after releasing the real
          // Windows handle. The move must leave the replacement at this path.
          if (replaced) return;
          replaced = true;
          native.renameSync(path, retained);
          native.writeFileSync(path, replacement, { flag: 'wx' });
        });
      }
      return handle;
    });
    await expect(moveProjectDirectory(database, project.id, destination, [original], receiptDirectory)).rejects.toBeInstanceOf(AggregateError);
    expect(replaced).toBe(true);
    expect(cleanupReads).toBe(2);
    expect(await fs.readFile(path)).toEqual(replacement);
    expect(await fs.readFile(retained)).toEqual(bytes.get('reference.json'));
    for (const [relative, content] of bytes) {
      if (relative !== 'reference.json') expect(await fs.readFile(join(target, relative))).toEqual(content);
    }
    expect(getProject(database, project.id)).toEqual(project);
    expect(database.inTransaction).toBe(false);
    await verifySource();
  });

  it('rejects a source edit during the final target hash scan and cleans only its own target copies', async () => {
    const revised = Buffer.from('external source edit during target revalidation');
    const open = fs.open.bind(fs);
    let targetReads = 0;
    let edited = false;
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await open(...args);
      if (args[0] === join(target, '画像/data.bin') && args[1] === 'r' && ++targetReads === 2) {
        const createReadStream = handle.createReadStream.bind(handle);
        vi.spyOn(handle, 'createReadStream').mockImplementation((options) => {
          const stream = createReadStream(options);
          stream.once('data', () => {
            // The source's full revalidation has returned; this is a real read
            // of the target's later file, not a timer or a mocked timestamp.
            native.writeFileSync(join(project.workspacePath, 'reference.json'), revised);
            edited = true;
          });
          return stream;
        });
      }
      return handle;
    });
    await expect(moveProjectDirectory(database, project.id, destination, [original], receiptDirectory)).rejects.toThrow(/変更/);
    expect(edited).toBe(true);
    bytes.set('reference.json', revised);
    expect(getProject(database, project.id)).toEqual(project);
    expect(database.inTransaction).toBe(false);
    expect(await fs.readdir(destination)).toEqual([]);
    await verifySource();
  });

  it('rejects normal updates and detects external metadata changes during await under the final write lock', async () => {
    let updated: Project | undefined;
    onWrite(async () => {
      expect(database.inTransaction).toBe(false);
      expect(() => assertProjectNotMoving(database, project.id)).toThrow(/移動中/);
      expect(() => updateProject(database, { id: project.id, name: 'newer metadata', description: project.description,
        taskType: project.taskType, workspacePath: project.workspacePath })).toThrow(/移動中/);
      // Ordinary service writes are blocked; preserve D's independent CAS test
      // against a real external DB edit, including the old timestamp mutation.
      database.prepare('UPDATE projects SET name=?,updated_at=? WHERE id=?')
        .run('newer metadata', new Date().toISOString(), project.id);
      updated = getProject(database, project.id);
    });
    await expect(moveProjectDirectory(database, project.id, destination, [original], receiptDirectory)).rejects.toThrow(/metadata/);
    expect(updated).toBeDefined();
    expect(getProject(database, project.id)).toEqual(updated);
    expect(database.inTransaction).toBe(false);
    expect(await fs.readdir(destination)).toEqual([]);
    await verifySource();
  });

  it('rejects a second actual move for this Project while allowing the first full copy to finish', async () => {
    const elsewhere = join(temporary, 'elsewhere');
    await fs.mkdir(elsewhere);
    let attempted = false;
    onWrite(async () => {
      attempted = true;
      await expect(moveProjectDirectory(database, project.id, elsewhere, [original], receiptDirectory)).rejects.toThrow(/移動中/);
      expect(await fs.readdir(elsewhere)).toEqual([]);
    });
    const result = await moveProjectDirectory(database, project.id, destination, [original], receiptDirectory);
    expect(attempted).toBe(true);
    expect(getProject(database, project.id)).toEqual(result.project);
    for (const [relative, content] of bytes) expect(await fs.readFile(join(target, relative))).toEqual(content);
    expect(() => assertProjectNotMoving(database, project.id)).not.toThrow();
    await verifySource();
  });

  it('retains the complete destination if COMMIT succeeds but its acknowledgement throws', async () => {
    const exec = database.exec.bind(database);
    let prepared: MoveReceipt | undefined;
    vi.spyOn(database, 'exec').mockImplementation((statement) => {
      if (statement === 'COMMIT') prepared = decodeProjectMoveReceipt(native.readFileSync(receiptPath));
      const result = exec(statement);
      if (statement === 'COMMIT') throw new Error('uncertain commit acknowledgement');
      return result;
    });
    await expect(moveProjectDirectory(database, project.id, destination, [original], receiptDirectory)).rejects.toBeInstanceOf(AggregateError);
    expect(database.inTransaction).toBe(false);
    expect(getProject(database, project.id).workspacePath).toBe(target);
    expect(prepared?.phase).toBe('prepared');
    database.close();
    expect(database.open).toBe(false);
    database = openDatabase(join(temporary, 'metadata.sqlite3'));
    const current = getProject(database, project.id);
    expect(database.open).toBe(true);
    expect(database.inTransaction).toBe(false);
    expect(current.workspacePath).toBe(target);
    const restored = await readProjectMoveReceipt(receiptDirectory, project.id, current.workspacePath);
    expect(restored?.receipt).toEqual(prepared);
    expect(restored?.receipt).toMatchObject({ phase: 'prepared', targetPath: target,
      source: { source: { rootPath: project.workspacePath } }, target: { source: { rootPath: target } },
      cursor: 0, pendingDelete: null });
    await revalidateProjectMoveInventory(restored!.receipt.source);
    await revalidateProjectMoveInventory(restored!.receipt.target!);
    for (const [relative, content] of bytes) expect(await fs.readFile(join(target, relative))).toEqual(content);
    await verifySource();
  });

  it('E1b publishes a flushed copying intent before target creation and reloads prepared from disk without the result', async () => {
    const mkdir = vi.spyOn(native, 'mkdirSync');
    const events: string[] = [];
    let intent: MoveReceipt | undefined;
    onReceiptOpen((handle, path, flags) => {
      if (path !== receiptPath || flags !== 'wx') return;
      const write = handle.writeFile.bind(handle);
      const sync = handle.sync.bind(handle);
      const close = handle.close.bind(handle);
      vi.spyOn(handle, 'writeFile').mockImplementation(async (data, options) => { await write(data, options); events.push('write'); });
      vi.spyOn(handle, 'sync').mockImplementation(async () => { await sync(); events.push('sync'); });
      vi.spyOn(handle, 'close').mockImplementation(async () => {
        await close();
        expect(handle.fd).toBe(-1);
        expect(mkdir).not.toHaveBeenCalled();
        expect(native.existsSync(target)).toBe(false);
        intent = decodeProjectMoveReceipt(native.readFileSync(receiptPath));
        expect(intent).toMatchObject({ phase: 'copying', projectId: project.id, targetPath: target,
          target: null, cursor: 0, pendingDelete: null });
        events.push('close');
      });
    });
    const rename = native.renameSync.bind(native);
    vi.spyOn(native, 'renameSync').mockImplementation((...args) => {
      if (args[1] !== receiptPath) return rename(...args);
      expect(events).toEqual(['write', 'sync', 'close']);
      expect(mkdir).toHaveBeenCalledExactlyOnceWith(target);
      expect(database.inTransaction).toBe(false);
      expect(getProject(database, project.id)).toEqual(project);
      const next = decodeProjectMoveReceipt(native.readFileSync(String(args[0])));
      expect(next.phase).toBe('prepared');
      expect(next.operationId).toBe(intent!.operationId);
      for (const [relative, content] of bytes) expect(native.readFileSync(join(target, relative))).toEqual(content);
      rename(...args);
      events.push('prepared');
    });
    const exec = database.exec.bind(database);
    const transactions = vi.spyOn(database, 'exec').mockImplementation((statement) => {
      if (statement === 'BEGIN IMMEDIATE') {
        expect(events).toEqual(['write', 'sync', 'close', 'prepared']);
        expect(decodeProjectMoveReceipt(native.readFileSync(receiptPath)).phase).toBe('prepared');
      }
      return exec(statement);
    });
    // Deliberately discard the returned result. Recovery must use Main's disk
    // locator and a freshly opened DB, not a retained in-memory move capability.
    await moveProjectDirectory(database, project.id, destination, [original], receiptDirectory);
    expect(transactions.mock.calls.map(([statement]) => statement)).toEqual(['BEGIN IMMEDIATE', 'COMMIT']);
    expect(handles.every((handle) => handle.fd === -1)).toBe(true);
    expect(database.inTransaction).toBe(false);
    database.close();
    expect(database.open).toBe(false);
    database = openDatabase(join(temporary, 'metadata.sqlite3'));
    const current = getProject(database, project.id);
    expect(database.open).toBe(true);
    expect(current.workspacePath).toBe(target);
    const stored = await readProjectMoveReceipt(receiptDirectory, project.id, current.workspacePath);
    expect(stored).toBeDefined();
    const receipt = stored!.receipt;
    expect(receipt.operationId).toBe(intent!.operationId);
    expect(receipt.operationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(receipt.operationId).not.toBe(project.id);
    expect(receipt).toMatchObject({ phase: 'prepared', projectId: project.id, source: intent!.source,
      targetPath: target, target: { source: { rootPath: target } }, cursor: 0, pendingDelete: null });
    expect(receipt.source.source.rootPath).toBe(project.workspacePath);
    expect(receipt.target!.source.rootIdentity).not.toEqual(receipt.source.source.rootIdentity);
    expect(receipt.target!.source.markerIdentity).not.toEqual(receipt.source.source.markerIdentity);
    expect(receipt.source.files.map(({ relativePath, sha256: hash }) => [relativePath, hash]).sort())
      .toEqual([...bytes].map(([relativePath, content]) => [relativePath, sha256(content)]).sort());
    expect(stored!.sha256).toBe(sha256(await fs.readFile(receiptPath)));
    await revalidateProjectMoveInventory(receipt.source);
    await revalidateProjectMoveInventory(receipt.target!);
    await verifySource();
  });

  it.each(['copying', 'prepared'] as const)('E1b refuses an existing %s receipt without overwriting it or creating another target', async (phase) => {
    if (phase === 'copying') {
      const source = await inventoryProjectMove(verifyProjectDirectory(project.workspacePath, project.id), [original, other.workspacePath]);
      await createProjectMoveReceipt(receiptDirectory, randomUUID(), source, target);
    } else {
      const previousDestination = join(temporary, 'previous destination');
      await fs.mkdir(previousDestination);
      await moveProjectDirectory(database, project.id, previousDestination, [original], receiptDirectory);
    }
    const current = getProject(database, project.id);
    const before = await fs.readFile(receiptPath);
    const identity = (await fs.lstat(receiptPath, { bigint: true })).ino;
    const existing = decodeProjectMoveReceipt(before);
    expect(existing.phase).toBe(phase);
    const mkdir = vi.spyOn(native, 'mkdirSync');
    const asyncMkdir = vi.spyOn(fs, 'mkdir');
    const open = vi.spyOn(fs, 'open');
    const exec = vi.spyOn(database, 'exec');
    await expect(moveProjectDirectory(database, project.id, destination, [original], receiptDirectory)).rejects.toMatchObject({ code: 'EEXIST' });
    expect(mkdir).not.toHaveBeenCalled();
    expect(asyncMkdir).not.toHaveBeenCalled();
    expect(open.mock.calls.filter(([, flags]) => flags === 'wx')).toEqual([[receiptPath, 'wx', 0o600]]);
    expect(exec).not.toHaveBeenCalled();
    expect(await fs.readdir(destination)).toEqual([]);
    expect(await fs.readFile(receiptPath)).toEqual(before);
    expect((await fs.lstat(receiptPath, { bigint: true })).ino).toBe(identity);
    expect(getProject(database, project.id)).toEqual(current);
    expect(database.inTransaction).toBe(false);
    expect((await readProjectMoveReceipt(receiptDirectory, project.id, current.workspacePath))!.receipt).toEqual(existing);
    if (existing.target) await revalidateProjectMoveInventory(existing.target);
    await verifySource();
  });

  it.each(['write', 'sync', 'close'] as const)('E1b retains a failed intent on %s failure before any target creation or DB transaction', async (stage) => {
    const source = await inventoryProjectMove(verifyProjectDirectory(project.workspacePath, project.id), [original, other.workspacePath]);
    const failure = new Error(`injected intent ${stage}`);
    let injected = false;
    onReceiptOpen((handle, path, flags) => {
      if (path !== receiptPath || flags !== 'wx') return;
      injected = true;
      if (stage === 'write') {
        const write = handle.writeFile.bind(handle);
        vi.spyOn(handle, 'writeFile').mockImplementationOnce(async () => { await write('partial intent'); throw failure; });
      }
      if (stage === 'sync') vi.spyOn(handle, 'sync').mockRejectedValueOnce(failure);
      if (stage === 'close') {
        const close = handle.close.bind(handle);
        vi.spyOn(handle, 'close').mockImplementationOnce(async () => { await close(); throw failure; });
      }
    });
    const mkdir = vi.spyOn(native, 'mkdirSync');
    const asyncMkdir = vi.spyOn(fs, 'mkdir');
    const unlink = vi.spyOn(fs, 'unlink');
    const exec = vi.spyOn(database, 'exec');
    await expect(moveProjectDirectory(database, project.id, destination, [original], receiptDirectory)).rejects.toBeInstanceOf(AggregateError);
    expect(injected).toBe(true);
    expect(handles).toHaveLength(1);
    expect(handles[0]!.fd).toBe(-1);
    expect(mkdir).not.toHaveBeenCalled();
    expect(asyncMkdir).not.toHaveBeenCalled();
    expect(unlink).not.toHaveBeenCalled();
    expect(exec).not.toHaveBeenCalled();
    expect(getProject(database, project.id)).toEqual(project);
    expect(database.inTransaction).toBe(false);
    expect(await fs.readdir(destination)).toEqual([]);
    const retained = await fs.readFile(receiptPath);
    if (stage === 'write') expect(retained.toString('utf8')).toBe('partial intent');
    else expect(decodeProjectMoveReceipt(retained)).toMatchObject({ phase: 'copying', target: null, cursor: 0, pendingDelete: null });
    await expect(moveProjectDirectory(database, project.id, destination, [original], receiptDirectory)).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await fs.readFile(receiptPath)).toEqual(retained);
    expect(() => assertProjectNotMoving(database, project.id)).not.toThrow();
    await revalidateProjectMoveInventory(source);
    await verifySource();
  });

  it.each(['write', 'sync', 'close', 'rename', 'rename-ack'] as const)('E1b preserves old DB and source hashes when prepared persistence fails at %s', async (stage) => {
    const source = await inventoryProjectMove(verifyProjectDirectory(project.workspacePath, project.id), [original, other.workspacePath]);
    const failure = new Error(`injected prepared ${stage}`);
    let copyingBytes: Buffer | undefined;
    let preparedBytes: Buffer | undefined;
    onReceiptOpen((handle, path, flags) => {
      if (path === receiptPath || flags !== 'wx') return;
      copyingBytes = native.readFileSync(receiptPath);
      expect(decodeProjectMoveReceipt(copyingBytes)).toMatchObject({ phase: 'copying', target: null });
      expect(database.inTransaction).toBe(false);
      expect(getProject(database, project.id)).toEqual(project);
      for (const [relative, content] of bytes) expect(native.readFileSync(join(target, relative))).toEqual(content);
      if (stage === 'write') {
        const write = handle.writeFile.bind(handle);
        vi.spyOn(handle, 'writeFile').mockImplementationOnce(async () => { await write('partial prepared'); throw failure; });
      }
      if (stage === 'sync') vi.spyOn(handle, 'sync').mockRejectedValueOnce(failure);
      if (stage === 'close') {
        const close = handle.close.bind(handle);
        vi.spyOn(handle, 'close').mockImplementationOnce(async () => { await close(); throw failure; });
      }
    });
    const rename = native.renameSync.bind(native);
    vi.spyOn(native, 'renameSync').mockImplementation((...args) => {
      if (args[1] !== receiptPath) return rename(...args);
      preparedBytes = native.readFileSync(String(args[0]));
      if (stage === 'rename') throw failure;
      rename(...args);
      if (stage === 'rename-ack') throw failure;
    });
    const exec = vi.spyOn(database, 'exec');
    const remove = vi.spyOn(fs, 'rm');
    await expect(moveProjectDirectory(database, project.id, destination, [original], receiptDirectory)).rejects.toThrow(/injected prepared|Atomic write and cleanup failed/);
    expect(copyingBytes).toBeDefined();
    expect(exec).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(handles.length).toBeGreaterThan(0);
    expect(handles.every((handle) => handle.fd === -1)).toBe(true);
    expect(getProject(database, project.id)).toEqual(project);
    expect(database.inTransaction).toBe(false);
    expect(await fs.readdir(destination)).toEqual([]);
    expect(await fs.readdir(receiptDirectory)).toEqual([`${project.id}.json`]);
    const retained = await fs.readFile(receiptPath);
    // A lost rename ACK may leave prepared on disk. Never erase or regress it.
    expect(retained).toEqual(stage === 'rename-ack' ? preparedBytes : copyingBytes);
    const stored = await readProjectMoveReceipt(receiptDirectory, project.id, getProject(database, project.id).workspacePath);
    expect(stored!.receipt).toMatchObject({ phase: stage === 'rename-ack' ? 'prepared' : 'copying',
      operationId: decodeProjectMoveReceipt(copyingBytes!).operationId, targetPath: target, cursor: 0, pendingDelete: null });
    expect(stored!.receipt.target === null).toBe(stage !== 'rename-ack');
    expect(() => assertProjectNotMoving(database, project.id)).not.toThrow();
    await revalidateProjectMoveInventory(source);
    await verifySource();
  });

  it.each(['source', 'target'] as const)('E1b catches a %s edit after prepared publication and final hashes with D\'s synchronous transaction guard', async (side) => {
    let releaseGate!: () => void;
    let signalGate!: () => void;
    const gate = new Promise<void>((resolve) => { releaseGate = resolve; });
    const reached = new Promise<void>((resolve) => { signalGate = resolve; });
    const open = fs.open.bind(fs);
    let targetReads = 0;
    let finalHashClosed = false;
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await open(...args);
      if (args[0] === join(target, '画像/data.bin') && args[1] === 'r' && ++targetReads === 2) {
        handles.push(handle);
        const close = handle.close.bind(handle);
        vi.spyOn(handle, 'close').mockImplementation(async () => { await close(); finalHashClosed = true; });
      }
      return handle;
    });
    const lstat = fs.lstat.bind(fs);
    let paused = false;
    vi.spyOn(fs, 'lstat').mockImplementation((async (path: Parameters<typeof fs.lstat>[0], options: Parameters<typeof fs.lstat>[1]) => {
      const stat = await lstat(path, options);
      // Target's final full scan has already checked every payload snapshot.
      // Its final disjoint-root check now awaits this unrelated protected root;
      // only D's synchronous in-transaction guard can observe the ensuing edit.
      if (finalHashClosed && !paused && path === other.workspacePath) {
        paused = true;
        signalGate();
        await gate;
      }
      return stat;
    }) as typeof fs.lstat);
    const exec = vi.spyOn(database, 'exec');
    const prepare = vi.spyOn(database, 'prepare');
    const remove = vi.spyOn(fs, 'rm');
    const revised = Buffer.alloc(bytes.get('reference.json')!.length, 0x42);
    let preparedBytes: Buffer | undefined;
    const moving = moveProjectDirectory(database, project.id, destination, [original], receiptDirectory);
    // Observe rejection immediately, and release/await the operation even if a
    // gate assertion fails. No timers, fake handles, or background test leakage.
    const rejected = side === 'source' ? expect(moving).rejects.toThrow(/変更/)
      : expect(moving).rejects.toBeInstanceOf(AggregateError);
    try {
      await Promise.race([reached, moving.then(() => { throw new Error('move completed without reaching the guard gate'); })]);
      expect(paused).toBe(true);
      expect(exec).not.toHaveBeenCalled();
      expect(database.inTransaction).toBe(false);
      preparedBytes = await fs.readFile(receiptPath);
      expect(decodeProjectMoveReceipt(preparedBytes).phase).toBe('prepared');
      const path = join(side === 'source' ? project.workspacePath : target, 'reference.json');
      await fs.writeFile(path, revised);
      await fs.utimes(path, new Date(0), new Date(0));
    } finally {
      releaseGate();
      await rejected;
    }
    expect(exec.mock.calls.map(([statement]) => statement)).toEqual(['BEGIN IMMEDIATE', 'ROLLBACK']);
    expect(prepare.mock.calls.some(([statement]) => statement.startsWith('UPDATE projects SET'))).toBe(false);
    expect(remove).not.toHaveBeenCalled();
    expect(handles.every((handle) => handle.fd === -1)).toBe(true);
    expect(getProject(database, project.id)).toEqual(project);
    expect(database.inTransaction).toBe(false);
    expect(await fs.readFile(receiptPath)).toEqual(preparedBytes);
    const stored = await readProjectMoveReceipt(receiptDirectory, project.id, getProject(database, project.id).workspacePath);
    expect(stored!.receipt).toEqual(decodeProjectMoveReceipt(preparedBytes!));
    if (side === 'source') {
      bytes.set('reference.json', revised);
      expect(await fs.readdir(destination)).toEqual([]);
    } else {
      expect(await fs.readFile(join(target, 'reference.json'))).toEqual(revised);
      for (const [relative, content] of bytes) {
        if (relative !== 'reference.json') expect(await fs.readFile(join(target, relative))).toEqual(content);
      }
    }
    expect(() => assertProjectNotMoving(database, project.id)).not.toThrow();
    await verifySource();
  });

  describe('CORE-07H-R1 retained Main selection (no handler wiring)', () => {
    // Reproduce H's original walk + canonical walk using real directory stats.
    // Keep this caller-owned fixture mutable to test both entry points' copies.
    const selectParent = (input = destination) => {
      const selectedPath = input.replaceAll('/', '\\');
      const canonicalPath = native.realpathSync.native(selectedPath);
      const chain = (path: string) => {
        let cursor = win32.parse(path).root;
        const paths = [cursor];
        for (const part of path.slice(cursor.length).split('\\')) {
          if (part === '' || part === '.') continue;
          cursor = part === '..' ? win32.dirname(cursor) : win32.join(cursor, part);
          paths.push(cursor);
        }
        return paths.map((path) => {
          const stat = native.lstatSync(path, { bigint: true });
          expect(stat.isDirectory()).toBe(true);
          expect(stat.isSymbolicLink()).toBe(false);
          return { path, identity: { dev: String(stat.dev), ino: String(stat.ino), birthtimeNs: String(stat.birthtimeNs) } };
        });
      };
      return { selectedPath, canonicalPath, chain: [...chain(selectedPath), ...chain(canonicalPath)] };
    };
    const run = (entry: 'low' | 'service', selectedParent?: ProjectMoveSelectedParent, parent = destination) => entry === 'low'
      ? moveProjectDirectory(database, project.id, parent, [original], receiptDirectory, selectedParent)
      : moveProject(database, project.id, parent, receiptDirectory, [original], selectedParent);
    const observe = (pending: ReturnType<typeof run>) => pending.then(
      (value) => ({ value, error: undefined }), (error: unknown) => ({ value: undefined, error }),
    );
    const noIo = () => [
      vi.spyOn(database, 'prepare'), vi.spyOn(database, 'exec'),
      vi.spyOn(native, 'lstatSync'), vi.spyOn(native.realpathSync, 'native'), vi.spyOn(native, 'mkdirSync'),
      vi.spyOn(fs, 'lstat'), vi.spyOn(fs, 'open'), vi.spyOn(fs, 'mkdir'),
    ];
    const pauseSourceHash = () => {
      const reached = Promise.withResolvers<void>();
      const gate = Promise.withResolvers<void>();
      const open = fs.open.bind(fs);
      let paused = false;
      vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
        const handle = await open(...args);
        handles.push(handle);
        if (!paused && args[0] === join(project.workspacePath, '画像/data.bin') && args[1] === 'r') {
          paused = true;
          reached.resolve();
          await gate.promise;
        }
        return handle;
      });
      return { reached, gate };
    };

    it('exports the narrow optional signatures and independently clones/freezes every necessary field without reading extras', () => {
      expectTypeOf<Parameters<typeof moveProjectDirectory>>().toEqualTypeOf<[
        DatabaseConnection, unknown, string, readonly string[], string, ProjectMoveSelectedParent?,
      ]>();
      expectTypeOf<Parameters<typeof moveProject>>().toEqualTypeOf<[
        DatabaseConnection, unknown, string, string, readonly string[], ProjectMoveSelectedParent?,
      ]>();
      expectTypeOf<Parameters<typeof snapshotProjectMoveParent>>().toEqualTypeOf<[unknown, string]>();
      expectTypeOf<ReturnType<typeof snapshotProjectMoveParent>>().toEqualTypeOf<ProjectMoveSelectedParent | undefined>();
      expectTypeOf<ProjectMoveSelectedParent>().toEqualTypeOf<{
        readonly canonicalPath: string;
        readonly chain: readonly { readonly path: string; readonly identity: ProjectFileIdentity }[];
      }>();
      const selected = selectParent();
      const expected = { canonicalPath: selected.canonicalPath, chain: structuredClone(selected.chain) };
      const extra = vi.fn(() => { throw new Error('Main extra field must not be read'); });
      Object.defineProperty(selected, 'selectedPath', { get: extra });
      Object.defineProperty(selected.chain[0]!.identity, 'ctimeNs', { get: extra });
      const operations = noIo();
      const first = snapshotProjectMoveParent(selected, destination)!;
      const second = snapshotProjectMoveParent(first, destination)!;
      expect(first).toEqual(expected);
      expect(second).toEqual(expected);
      for (const [copy, previous] of [[first, selected], [second, first]] as const) {
        // Passing getter-bearing expected objects to matcher formatting can
        // evaluate the very extra properties this test forbids reading.
        expect(Object.is(copy, previous)).toBe(false);
        expect(Object.is(copy.chain, previous.chain)).toBe(false);
        expect(Object.isFrozen(copy)).toBe(true);
        expect(Object.isFrozen(copy.chain)).toBe(true);
        expect(Object.keys(copy)).toEqual(['canonicalPath', 'chain']);
        copy.chain.forEach((entry, index) => {
          expect(Object.is(entry, previous.chain[index])).toBe(false);
          expect(Object.is(entry.identity, previous.chain[index]!.identity)).toBe(false);
          expect(Object.isFrozen(entry)).toBe(true);
          expect(Object.isFrozen(entry.identity)).toBe(true);
          expect(Object.keys(entry)).toEqual(['path', 'identity']);
          expect(Object.keys(entry.identity)).toEqual(['dev', 'ino', 'birthtimeNs']);
        });
      }
      expect(Object.isFrozen(selected)).toBe(false);
      expect(Object.isFrozen(selected.chain)).toBe(false);
      selected.canonicalPath = original;
      selected.chain[0]!.path = original;
      selected.chain[0]!.identity.ino = '999999';
      selected.chain.splice(1);
      expect(first).toEqual(expected);
      expect(second).toEqual(expected);
      expect(extra).not.toHaveBeenCalled();
      for (const operation of operations) expect(operation).not.toHaveBeenCalled();
    });

    it('keeps decimal identity strings exact, including unsigned zero, large inode and signed birth time', () => {
      const selected = selectParent();
      const identity = { dev: '0', ino: '9'.repeat(100), birthtimeNs: '-1234567890123456789' };
      for (const entry of selected.chain) entry.identity = { ...identity };
      const operations = noIo();
      const copy = snapshotProjectMoveParent(selected, destination)!;
      expect(copy.chain.every((entry) => Object.keys(identity).every((key) =>
        entry.identity[key as keyof ProjectFileIdentity] === identity[key as keyof ProjectFileIdentity]))).toBe(true);
      for (const operation of operations) expect(operation).not.toHaveBeenCalled();
    });

    it.each(['single-chain', 'H-duplicate-root', 'case-alias', 'original-dot-walk'] as const)
      ('accepts complete %s selection and ignores parent timestamps changed by its own mkdir', async (kind) => {
        const visited = join(destination, 'visited');
        if (kind === 'original-dot-walk') await fs.mkdir(visited);
        const selected = selectParent(kind === 'case-alias' ? destination.toUpperCase()
          : kind === 'original-dot-walk' ? `${destination}\\.\\visited\\..` : destination);
        if (kind === 'single-chain') selected.chain = selected.chain.slice(selected.chain.length / 2);
        const expected = snapshotProjectMoveParent(selected, destination)!;
        const parentIdentity = native.lstatSync(destination, { bigint: true });
        const update = receiptStorage.updateProjectMoveReceipt;
        let prepared = false;
        vi.spyOn(receiptStorage, 'updateProjectMoveReceipt').mockImplementation(async (...args) => {
          const stored = await update(...args);
          if (stored.receipt.phase === 'prepared') {
            prepared = true;
            // Only the parent timestamp changes, not any owned payload/entry.
            native.utimesSync(destination, new Date(0), new Date(0));
          }
          return stored;
        });
        const result = await moveProjectDirectory(database, project.id, destination, [original], receiptDirectory, selected);
        expect(prepared).toBe(true);
        expect(result.project.workspacePath).toBe(target);
        expect(getProject(database, project.id)).toEqual(result.project);
        expect(snapshotProjectMoveParent(selected, destination)).toEqual(expected);
        expect(native.lstatSync(destination, { bigint: true })).toMatchObject({
          dev: parentIdentity.dev, ino: parentIdentity.ino, birthtimeNs: parentIdentity.birthtimeNs, mtimeNs: 0n,
        });
        for (const [relative, content] of bytes) expect(native.readFileSync(join(target, relative))).toEqual(content);
        await verifySource();
      });

    it.each(['low', 'service'] as const)('%s deliberately permits an explicit undefined Main nonpicker snapshot', async (entry) => {
      expect(snapshotProjectMoveParent(undefined, destination)).toBeUndefined();
      const result = await run(entry, undefined);
      expect(result.project.workspacePath).toBe(target);
      expect(getProject(database, project.id)).toEqual(result.project);
      for (const [relative, content] of bytes) expect(native.readFileSync(join(target, relative))).toEqual(content);
      expect(native.existsSync(project.workspacePath)).toBe(entry === 'low');
      if (entry === 'low') await verifySource();
      else expect(result).toMatchObject({ cleanupStatus: 'completed' });
    });

    it('the real high service passes its frozen copy and the real low entry clones it again before its first await', async () => {
      const selected = selectParent();
      const expected = { canonicalPath: selected.canonicalPath, chain: structuredClone(selected.chain) };
      const actualMove = projectMove.moveProjectDirectory;
      const low = vi.spyOn(projectMove, 'moveProjectDirectory').mockImplementation((...args) => actualMove(...args));
      const freeze = vi.spyOn(Object, 'freeze');
      const { reached, gate } = pauseSourceHash();
      const outcome = observe(run('service', selected));
      try {
        // Both copies must already exist synchronously when launch returns,
        // before even the test's first await (not merely before the hash gate).
        const copies = freeze.mock.calls.map(([value]) => value).filter((value): value is ProjectMoveSelectedParent =>
          typeof value === 'object' && value !== null && Object.hasOwn(value, 'canonicalPath') && Object.hasOwn(value, 'chain'));
        expect(copies).toHaveLength(2);
        await Promise.race([reached.promise, outcome.then(() => { throw new Error('Move settled before source gate'); })]);
        expect(low.mock.calls).toEqual([[database, project.id, destination, [original], receiptDirectory, copies[0]]]);
        expect(copies[0]).not.toBe(selected);
        expect(copies[1]).not.toBe(copies[0]);
        for (const [copy, previous] of [[copies[0]!, selected], [copies[1]!, copies[0]!]] as const) {
          expect(copy).toEqual(expected);
          expect(Object.isFrozen(copy)).toBe(true);
          expect(Object.isFrozen(copy.chain)).toBe(true);
          expect(copy.chain).not.toBe(previous.chain);
          copy.chain.forEach((item, index) => {
            expect(item).not.toBe(previous.chain[index]);
            expect(item.identity).not.toBe(previous.chain[index]!.identity);
            expect(Object.isFrozen(item)).toBe(true);
            expect(Object.isFrozen(item.identity)).toBe(true);
          });
        }
        selected.canonicalPath = original;
        selected.chain[0]!.path = original;
        selected.chain[0]!.identity.ino = '999999';
        selected.chain = [];
        expect(copies).toEqual([expected, expected]);
      } finally { gate.resolve(); await outcome; }
      expect((await outcome).error).toBeUndefined();
      expect((await outcome).value).toMatchObject({ project: { workspacePath: target }, cleanupStatus: 'completed' });
      expect(native.existsSync(project.workspacePath)).toBe(false);
      expect(handles.every((handle) => handle.fd === -1)).toBe(true);
      for (const [relative, content] of bytes) expect(native.readFileSync(join(target, relative))).toEqual(content);
      expect(native.readFileSync(join(original, 'reference.bin'), 'utf8')).toBe('never copy or remove');
      expect(native.readFileSync(join(other.workspacePath, 'keep'), 'utf8')).toBe('other project');
    });

    for (const entry of ['low', 'service'] as const) {
      it.each([
        'null', 'non-data object', 'missing canonical', 'wrong canonical', 'non-array chain', 'empty chain',
        'sparse chain', 'missing entry', 'missing identity', 'leaf-only', 'missing root',
        'missing original root', 'missing original ancestor', 'missing original leaf',
        'missing canonical root', 'missing canonical ancestor', 'missing canonical leaf', 'nonconsecutive original',
        'conflicting repeated identity', 'original endpoint identity',
      ] as const)(`${entry} rejects %s before any DB/filesystem I/O rather than falling back`, async (kind) => {
        const selected = selectParent(kind === 'original endpoint identity' ? destination.toUpperCase() : destination);
        const length = selected.chain.length / 2;
        let value: unknown = selected;
        if (kind === 'null') value = null;
        if (kind === 'non-data object') value = Object.assign(new Date(), selected);
        if (kind === 'missing canonical') value = { chain: selected.chain };
        if (kind === 'wrong canonical') selected.canonicalPath = original;
        if (kind === 'non-array chain') selected.chain = { 0: selected.chain[0], length: selected.chain.length } as never;
        if (kind === 'empty chain') selected.chain = [];
        if (kind === 'sparse chain') delete selected.chain[0];
        if (kind === 'missing entry') selected.chain[0] = {} as never;
        if (kind === 'missing identity') selected.chain[0]!.identity = undefined as never;
        if (kind === 'leaf-only') selected.chain = [selected.chain.at(-1)!];
        if (kind === 'missing root') selected.chain = selected.chain.slice(length + 1);
        if (kind === 'missing original root') selected.chain.splice(0, 1);
        if (kind === 'missing original ancestor') selected.chain.splice(1, 1);
        if (kind === 'missing original leaf') selected.chain.splice(length - 1, 1);
        if (kind === 'missing canonical root') selected.chain.splice(length, 1);
        if (kind === 'missing canonical ancestor') selected.chain.splice(length + 1, 1);
        if (kind === 'missing canonical leaf') selected.chain.pop();
        if (kind === 'nonconsecutive original') selected.chain.splice(2, 0, structuredClone(selected.chain[1]!));
        if (kind === 'conflicting repeated identity' || kind === 'original endpoint identity') {
          const identity = selected.chain[kind === 'conflicting repeated identity' ? 0 : length - 1]!.identity;
          identity.ino = String(BigInt(identity.ino) + 1n);
        }
        const operations = noIo();
        expect(() => snapshotProjectMoveParent(value, destination)).toThrow(TypeError);
        await expect(run(entry, value as ProjectMoveSelectedParent)).rejects.toBeInstanceOf(TypeError);
        for (const operation of operations) expect(operation).not.toHaveBeenCalled();
      });

      it(`${entry} rejects required-field accessors and non-plain nested data without invoking getters`, async () => {
        const base = selectParent();
        const operations = noIo();
        const getter = vi.fn(() => { throw new Error('Required data getter must not execute'); });
        for (const field of ['canonicalPath', 'chain', 'entry', 'path', 'identity', 'dev', 'ino', 'birthtimeNs'] as const) {
          const selected = structuredClone(base);
          const owner = field === 'canonicalPath' || field === 'chain' ? selected
            : field === 'entry' ? selected.chain : field === 'path' || field === 'identity' ? selected.chain[0]!
              : selected.chain[0]!.identity;
          Object.defineProperty(owner, field === 'entry' ? '0' : field, { get: getter });
          await expect(run(entry, selected)).rejects.toBeInstanceOf(TypeError);
        }
        for (const level of ['parent', 'chain', 'entry', 'identity'] as const) {
          const selected = structuredClone(base);
          Object.setPrototypeOf(level === 'parent' ? selected : level === 'chain' ? selected.chain
            : level === 'entry' ? selected.chain[0]! : selected.chain[0]!.identity, {});
          await expect(run(entry, selected)).rejects.toBeInstanceOf(TypeError);
        }
        for (const level of ['parent', 'entry', 'identity'] as const) {
          const selected = structuredClone(base);
          const owner = level === 'parent' ? selected : level === 'entry' ? selected.chain[0]! : selected.chain[0]!.identity;
          const array = Object.setPrototypeOf(Object.assign([], owner), null);
          if (level === 'entry') selected.chain[0] = array as never;
          if (level === 'identity') selected.chain[0]!.identity = array as never;
          await expect(run(entry, level === 'parent' ? array as never : selected)).rejects.toBeInstanceOf(TypeError);
        }
        expect(getter).not.toHaveBeenCalled();
        for (const operation of operations) expect(operation).not.toHaveBeenCalled();
      });

      it(`${entry} validates each identity as direct decimal strings, never coercing values`, async () => {
        const base = selectParent();
        const operations = noIo();
        const coercion = vi.fn(() => '1');
        const invalid: unknown[] = [undefined, null, 1, 1n, NaN, Infinity, true, [], { toString: coercion },
          '', ' 1', '1 ', '01', '+1', '1.0', '1e3', '1\n', '1\r\n', '-0'];
        for (const field of ['dev', 'ino', 'birthtimeNs'] as const) {
          for (const value of [...invalid, ...(field === 'birthtimeNs' ? [] : ['-1']), ...(field === 'ino' ? ['0'] : [])]) {
            const selected = structuredClone(base);
            // Set both duplicated occurrences, so rejection proves field parsing
            // rather than only a mismatch between repeated directory entries.
            for (const item of selected.chain) item.identity[field] = value as never;
            expect(() => snapshotProjectMoveParent(selected, destination)).toThrow(TypeError);
            await expect(run(entry, selected)).rejects.toBeInstanceOf(TypeError);
          }
        }
        expect(coercion).not.toHaveBeenCalled();
        for (const operation of operations) expect(operation).not.toHaveBeenCalled();
      });

      it(`${entry} rejects invalid canonical, entry and destination paths with H's length limits before I/O`, async () => {
        const base = selectParent();
        const operations = noIo();
        const paths: unknown[] = [undefined, null, 42, { toString: () => destination }, '', 'relative', 'C:relative', '\\root-relative',
          `\\\\?\\${destination}`, `\\\\.\\${destination}`, `${destination}\\NUL`, `${destination}\\CONIN$`,
          `${destination}\\bad:stream`, `${destination}\\bad*name`, `${destination}\\bad\0name`,
          `${destination}\\bad\nname`, `${destination}\\\ud800`, `${destination}\\trail.`, `${destination}\\trail `,
          `${destination}\\${'x'.repeat(256)}`, `C:\\${'a\\'.repeat(16_384)}`,
          `${destination}\\visited\\..`, `${destination}\\.`];
        for (const value of paths) {
          for (const field of ['canonical', 'entry', 'destination'] as const) {
            const selected = structuredClone(base);
            if (field === 'canonical') selected.canonicalPath = value as never;
            if (field === 'entry') selected.chain[0]!.path = value as never;
            const parent = field === 'destination' ? value as string : destination;
            expect(() => snapshotProjectMoveParent(selected, parent)).toThrow(TypeError);
            // Pass explicit undefined unchanged: the convenience runner's
            // default parent must not turn this negative into a real move.
            const pending = entry === 'low'
              ? moveProjectDirectory(database, project.id, parent, [original], receiptDirectory, selected)
              : moveProject(database, project.id, parent, receiptDirectory, [original], selected);
            await expect(pending).rejects.toBeInstanceOf(TypeError);
          }
        }
        const root = win32.parse(destination).root;
        expect(() => snapshotProjectMoveParent({ ...base, canonicalPath: root }, root)).toThrow(TypeError);
        for (const operation of operations) expect(operation).not.toHaveBeenCalled();
      });

      it.each(['realpath-mismatch', 'different-case-entry'] as const)(`${entry} checks actual canonical mapping and identity: %s`, async (kind) => {
        const selected = selectParent();
        const parent = kind === 'different-case-entry' ? destination.toUpperCase() : destination;
        if (kind === 'realpath-mismatch') vi.spyOn(native.realpathSync, 'native').mockReturnValue(original);
        else {
          const lstat = native.lstatSync.bind(native);
          vi.spyOn(native, 'lstatSync').mockImplementation(((path, options) =>
            lstat(path === parent ? original : path, options)) as typeof native.lstatSync);
        }
        const open = vi.spyOn(fs, 'open');
        const asynchronous = vi.spyOn(fs, 'lstat');
        const query = vi.spyOn(database, 'prepare');
        const mkdir = vi.spyOn(native, 'mkdirSync');
        await expect(run(entry, selected, parent)).rejects.toThrow(/変更/);
        for (const operation of [open, asynchronous, query, mkdir]) expect(operation).not.toHaveBeenCalled();
        expect(getProject(database, project.id)).toEqual(project);
        expect(native.readdirSync(destination)).toEqual([]);
        await verifySource();
      });

      it.each(['parent', 'ancestor', 'original-walk', 'root-identity', 'junction'] as const)
        (`${entry} rejects stale %s synchronously before starting source inventory`, async (kind) => {
          const retained = join(temporary, 'retained-selection');
          const ancestor = join(temporary, 'selection-ancestor');
          if (kind === 'ancestor') {
            destination = join(ancestor, 'parent');
            native.mkdirSync(destination, { recursive: true });
            target = join(destination, project.id);
          }
          const visited = join(destination, 'visited');
          if (kind === 'original-walk') native.mkdirSync(visited);
          const selected = selectParent(kind === 'original-walk' ? `${visited}\\..` : destination);
          if (kind === 'parent' || kind === 'junction') {
            native.renameSync(destination, retained);
            if (kind === 'junction') native.symlinkSync(retained, destination, 'junction');
            else { native.mkdirSync(destination); native.writeFileSync(join(destination, 'keep'), 'unselected bytes'); }
          }
          if (kind === 'ancestor') {
            const leaf = native.lstatSync(destination, { bigint: true });
            native.renameSync(ancestor, retained);
            native.mkdirSync(ancestor);
            native.renameSync(join(retained, 'parent'), destination);
            expect(native.lstatSync(destination, { bigint: true })).toMatchObject({ dev: leaf.dev, ino: leaf.ino, birthtimeNs: leaf.birthtimeNs });
          }
          if (kind === 'original-walk') { native.renameSync(visited, retained); native.mkdirSync(visited); }
          if (kind === 'root-identity') {
            for (const item of selected.chain) {
              if (item.path === win32.parse(item.path).root) item.identity.dev = String(BigInt(item.identity.dev) + 1n);
            }
          }
          const before = native.readdirSync(destination);
          const open = vi.spyOn(fs, 'open');
          const asynchronous = vi.spyOn(fs, 'lstat');
          const query = vi.spyOn(database, 'prepare');
          const mkdir = vi.spyOn(native, 'mkdirSync');
          await expect(run(entry, selected)).rejects.toThrow(/変更|リンク/);
          for (const operation of [open, asynchronous, query, mkdir]) expect(operation).not.toHaveBeenCalled();
          expect(native.readdirSync(destination)).toEqual(before);
          expect(native.existsSync(target)).toBe(false);
          expect(native.readdirSync(receiptDirectory)).toEqual([]);
          expect(getProject(database, project.id)).toEqual(project);
          expect(() => assertProjectNotMoving(database, project.id)).not.toThrow();
          if (kind === 'parent') expect(native.readFileSync(join(destination, 'keep'), 'utf8')).toBe('unselected bytes');
          await verifySource();
        });

      it.each(['unchanged-caller', 'caller-rebased'] as const)
        (`${entry} rejects same-path parent replacement during source hash before preflight (%s)`, async (kind) => {
          const selected = selectParent();
          const expected = structuredClone(selected);
          const retained = join(temporary, 'retained-selected-parent');
          const { reached, gate } = pauseSourceHash();
          const mkdir = vi.spyOn(native, 'mkdirSync');
          const asyncMkdir = vi.spyOn(fs, 'mkdir');
          const exec = vi.spyOn(database, 'exec');
          const outcome = observe(run(entry, selected));
          try {
            await Promise.race([reached.promise, outcome.then(() => { throw new Error('Move settled before source gate'); })]);
            expect(native.existsSync(receiptPath)).toBe(false);
            expect(database.inTransaction).toBe(false);
            native.renameSync(destination, retained);
            native.mkdirSync(destination);
            const replacement = selectParent();
            expect(replacement.chain.at(-1)!.identity).not.toEqual(expected.chain.at(-1)!.identity);
            if (kind === 'caller-rebased') {
              selected.canonicalPath = replacement.canonicalPath;
              selected.chain.forEach((item, index) => {
                item.path = replacement.chain[index]!.path;
                Object.assign(item.identity, replacement.chain[index]!.identity);
              });
              selected.chain = replacement.chain;
            }
          } finally { gate.resolve(); await outcome; }
          expect((await outcome).error).toBeInstanceOf(Error);
          expect((await outcome).value).toBeUndefined();
          expect(mkdir.mock.calls.some(([path]) => path === target)).toBe(false);
          expect(asyncMkdir).not.toHaveBeenCalled();
          expect(exec).not.toHaveBeenCalled();
          expect(native.readdirSync(destination)).toEqual([]);
          expect(native.readdirSync(retained)).toEqual([]);
          expect(getProject(database, project.id)).toEqual(project);
          expect(database.inTransaction).toBe(false);
          expect(handles.every((handle) => handle.fd === -1)).toBe(true);
          await verifySource();
        });

      it.each(['parent', 'original-walk'] as const)(`${entry} closes the final pre-mkdir await against replaced %s`, async (kind) => {
        const visited = join(destination, 'visited');
        if (kind === 'original-walk') native.mkdirSync(visited);
        const selected = selectParent(kind === 'original-walk' ? `${visited}\\..` : destination);
        const retained = join(temporary, 'retained-before-mkdir');
        const reached = Promise.withResolvers<void>();
        const gate = Promise.withResolvers<void>();
        const create = receiptStorage.createProjectMoveReceipt;
        let intentReturned = false;
        vi.spyOn(receiptStorage, 'createProjectMoveReceipt').mockImplementation(async (...args) => {
          const stored = await create(...args);
          intentReturned = true;
          return stored;
        });
        const lstat = fs.lstat.bind(fs);
        let parentReads = 0;
        vi.spyOn(fs, 'lstat').mockImplementation((async (path, options) => {
          const stat = await lstat(path, options);
          // inspectDirectory: original leaf, canonical leaf, final chain leaf.
          // Return the stat taken BEFORE replacement, leaving no later async
          // check to catch it: the new synchronous selected-parent guard must.
          if (intentReturned && path === destination && ++parentReads === 3) { reached.resolve(); await gate.promise; }
          return stat;
        }) as typeof fs.lstat);
        const mkdir = vi.spyOn(native, 'mkdirSync');
        const asyncMkdir = vi.spyOn(fs, 'mkdir');
        const exec = vi.spyOn(database, 'exec');
        const outcome = observe(run(entry, selected));
        try {
          await Promise.race([reached.promise, outcome.then(() => { throw new Error('Move settled before mkdir gate'); })]);
          expect(decodeProjectMoveReceipt(native.readFileSync(receiptPath)).phase).toBe('copying');
          expect(native.existsSync(target)).toBe(false);
          const changedPath = kind === 'parent' ? destination : visited;
          native.renameSync(changedPath, retained);
          native.mkdirSync(changedPath);
        } finally { gate.resolve(); await outcome; }
        expect((await outcome).error).toBeInstanceOf(Error);
        expect(parentReads).toBe(3);
        expect(mkdir.mock.calls.some(([path]) => path === target)).toBe(false);
        expect(asyncMkdir).not.toHaveBeenCalled();
        expect(exec).not.toHaveBeenCalled();
        expect(native.readdirSync(destination)).toEqual(kind === 'parent' ? [] : ['visited']);
        expect(native.readdirSync(retained)).toEqual([]);
        expect(getProject(database, project.id)).toEqual(project);
        expect(database.inTransaction).toBe(false);
        await verifySource();
      });

      it.each(['parent', 'original-walk'] as const)
        (`${entry} rejects changed %s after prepared and final async scans, before synchronous COMMIT`, async (kind) => {
          const visited = join(destination, 'visited');
          if (kind === 'original-walk') native.mkdirSync(visited);
          const selected = selectParent(kind === 'original-walk' ? `${visited}\\..` : destination);
          const retained = join(temporary, 'retained-before-commit');
          const reached = Promise.withResolvers<void>();
          const gate = Promise.withResolvers<void>();
          const open = fs.open.bind(fs);
          let targetReads = 0;
          let finalHashClosed = false;
          vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
            const handle = await open(...args);
            handles.push(handle);
            if (args[0] === join(target, '画像/data.bin') && args[1] === 'r' && ++targetReads === 2) {
              const close = handle.close.bind(handle);
              vi.spyOn(handle, 'close').mockImplementation(async () => { await close(); finalHashClosed = true; });
            }
            return handle;
          });
          const lstat = fs.lstat.bind(fs);
          let paused = false;
          vi.spyOn(fs, 'lstat').mockImplementation((async (path, options) => {
            const stat = await lstat(path, options);
            if (finalHashClosed && !paused && path === other.workspacePath) { paused = true; reached.resolve(); await gate.promise; }
            return stat;
          }) as typeof fs.lstat);
          const exec = vi.spyOn(database, 'exec');
          const query = vi.spyOn(database, 'prepare');
          const unlink = vi.spyOn(native, 'unlinkSync');
          const rmdir = vi.spyOn(native, 'rmdirSync');
          let prepared: Buffer | undefined;
          const outcome = observe(run(entry, selected));
          try {
            await Promise.race([reached.promise, outcome.then(() => { throw new Error('Move settled before commit gate'); })]);
            expect(exec).not.toHaveBeenCalled();
            prepared = native.readFileSync(receiptPath);
            expect(decodeProjectMoveReceipt(prepared).phase).toBe('prepared');
            if (kind === 'parent') {
              native.renameSync(destination, retained);
              native.mkdirSync(target, { recursive: true });
              native.writeFileSync(join(target, 'unknown'), 'unselected replacement');
            } else {
              // D's canonical target chain remains entirely unchanged. Only
              // the retained original-walk entries can detect this replacement.
              native.renameSync(visited, retained);
              native.mkdirSync(visited);
            }
          } finally { gate.resolve(); await outcome; }
          expect((await outcome).error).toBeInstanceOf(AggregateError);
          expect(exec.mock.calls.map(([statement]) => statement)).toEqual(['BEGIN IMMEDIATE', 'ROLLBACK']);
          expect(query.mock.calls.some(([statement]) => statement.startsWith('UPDATE projects SET'))).toBe(false);
          expect(unlink).not.toHaveBeenCalled();
          expect(rmdir).not.toHaveBeenCalled();
          expect(getProject(database, project.id)).toEqual(project);
          expect(database.inTransaction).toBe(false);
          expect(native.readFileSync(receiptPath)).toEqual(prepared);
          expect(handles.every((handle) => handle.fd === -1)).toBe(true);
          const copiedRoot = kind === 'parent' ? join(retained, project.id) : target;
          for (const [relative, content] of bytes) expect(native.readFileSync(join(copiedRoot, relative))).toEqual(content);
          if (kind === 'parent') expect(native.readFileSync(join(target, 'unknown'), 'utf8')).toBe('unselected replacement');
          await verifySource();
        });

      it(`${entry} retains the selected snapshot during rollback's final hash-close await too`, async () => {
        const visited = join(destination, 'visited');
        native.mkdirSync(visited);
        const selected = selectParent(`${visited}\\..`);
        database.exec(`CREATE TRIGGER reject_selected_move AFTER UPDATE OF workspace_path ON projects
          BEGIN SELECT RAISE(ABORT, 'injected selected rollback'); END;`);
        const exec = database.exec.bind(database);
        let cleanup = false;
        vi.spyOn(database, 'exec').mockImplementation((statement) => {
          const result = exec(statement);
          if (statement === 'ROLLBACK') cleanup = true;
          return result;
        });
        const reached = Promise.withResolvers<void>();
        const gate = Promise.withResolvers<void>();
        const open = fs.open.bind(fs);
        let cleanupReads = 0;
        vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
          const handle = await open(...args);
          handles.push(handle);
          if (cleanup && args[0] === join(target, 'reference.json') && args[1] === 'r' && ++cleanupReads === 2) {
            const close = handle.close.bind(handle);
            vi.spyOn(handle, 'close').mockImplementationOnce(async () => { await close(); reached.resolve(); await gate.promise; });
          }
          return handle;
        });
        const unlink = vi.spyOn(native, 'unlinkSync');
        const rmdir = vi.spyOn(native, 'rmdirSync');
        const outcome = observe(run(entry, selected));
        try {
          await Promise.race([reached.promise, outcome.then(() => { throw new Error('Move settled before rollback gate'); })]);
          expect(database.inTransaction).toBe(false);
          expect(getProject(database, project.id)).toEqual(project);
          native.renameSync(visited, join(temporary, 'retained-during-rollback'));
          native.mkdirSync(visited);
        } finally { gate.resolve(); await outcome; }
        expect((await outcome).error).toBeInstanceOf(AggregateError);
        expect(cleanupReads).toBe(2);
        expect(unlink).not.toHaveBeenCalled();
        expect(rmdir).not.toHaveBeenCalled();
        expect(handles.every((handle) => handle.fd === -1)).toBe(true);
        expect(getProject(database, project.id)).toEqual(project);
        expect(decodeProjectMoveReceipt(native.readFileSync(receiptPath)).phase).toBe('prepared');
        for (const [relative, content] of bytes) expect(native.readFileSync(join(target, relative))).toEqual(content);
        await verifySource();
      });
    }
  });
});

describe.skipIf(process.platform !== 'win32')('CORE-06E2 finite recovery from real B/E1b roots and reopened SQLite', () => {
  let temporary: string;
  let database: DatabaseConnection;
  let project: Project;
  let other: Project;
  let destination: string;
  let target: string;
  let original: string;
  let receiptDirectory: string;
  let receiptPath: string;
  let progressPath: string;
  let bytes: Map<string, Buffer>;
  const handles: FileHandle[] = [];
  const sql = native.readFileSync(new URL('../db/migrations/001_core.sql', import.meta.url), 'utf8');
  type Mutable<T> = T extends readonly (infer U)[] ? Mutable<U>[]
    : T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;

  beforeEach(async () => {
    temporary = native.realpathSync.native(await fs.mkdtemp(join(tmpdir(), 'autovision-core06e2-')));
    database = openDatabase(join(temporary, 'metadata.sqlite3'));
    migrateDatabase(database, [{ version: 1, sql }]);
    const sourceParent = join(temporary, 'source');
    const otherParent = join(temporary, 'other');
    destination = join(temporary, 'destination');
    original = join(temporary, 'original');
    for (const path of [sourceParent, otherParent, destination, original]) await fs.mkdir(path);
    project = createProject(database, { name: '回復元', taskType: 'classification', workspacePath: sourceParent });
    other = createProject(database, { name: '他Project', taskType: 'detection', workspacePath: otherParent });
    target = join(destination, project.id);
    receiptDirectory = join(temporary, 'app-data', 'project-moves');
    await fs.mkdir(receiptDirectory, { recursive: true });
    receiptPath = join(receiptDirectory, `${project.id}.json`);
    progressPath = join(receiptDirectory, `${project.id}.progress.json`);
    await fs.writeFile(join(original, 'external.bin'), 'external original');
    await fs.writeFile(join(other.workspacePath, 'keep'), 'other project');
    await fs.mkdir(join(project.workspacePath, 'images', 'empty'), { recursive: true });
    bytes = new Map([
      [markerName, await fs.readFile(join(project.workspacePath, markerName))],
      ['images/data.bin', Buffer.from('AAAA')],
      ['reference.json', Buffer.from(JSON.stringify({ referencePath: join(original, 'external.bin') }))],
      ['top.txt', Buffer.from('BBBB')], ['zero.bin', Buffer.alloc(0)],
    ]);
    for (const [relative, content] of bytes) if (relative !== markerName) await fs.writeFile(join(project.workspacePath, relative), content);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    for (const handle of handles.splice(0)) if (handle.fd !== -1) await handle.close();
    if (database?.open) database.close();
    // Every pending operation is settled by its test before fixture removal.
    // All originals, links and detached trees are inside this one mkdtemp.
    if (temporary) await fs.rm(temporary, { recursive: true, force: true });
  });

  const disk = (): MoveReceipt => {
    const base = decodeProjectMoveReceipt(native.readFileSync(receiptPath));
    if (!native.existsSync(progressPath)) return base;
    const envelope = JSON.parse(native.readFileSync(progressPath, 'utf8')) as {
      payload: { cursor: number; pendingDelete: number | null };
    };
    return { ...base, cursor: envelope.payload.cursor, pendingDelete: envelope.payload.pendingDelete };
  };
  const move = async () => {
    // Do not retain D's result or its WeakMap capability as recovery input.
    await moveProjectDirectory(database, project.id, destination, [original], receiptDirectory);
    return disk();
  };
  const reopen = () => {
    database.close();
    expect(database.open).toBe(false);
    database = openDatabase(join(temporary, 'metadata.sqlite3'));
  };
  const recover = () => recoverProjectMove(database, project.id, receiptDirectory);
  const assertBytes = (root: string) => {
    for (const [relative, content] of bytes) expect(native.readFileSync(join(root, relative))).toEqual(content);
  };
  const assertUnrelated = () => {
    expect(native.readFileSync(join(original, 'external.bin'), 'utf8')).toBe('external original');
    expect(native.readFileSync(join(other.workspacePath, 'keep'), 'utf8')).toBe('other project');
  };
  const recordSourceRemovals = () => {
    const observed: { kind: 'file' | 'directory'; path: string; receipt: MoveReceipt }[] = [];
    const record = (kind: 'file' | 'directory', path: native.PathLike) => {
      if (String(path) === project.workspacePath || String(path).startsWith(`${project.workspacePath}\\`)) {
        observed.push({ kind, path: String(path), receipt: disk() });
      }
    };
    const unlink = native.unlinkSync.bind(native);
    const rmdir = native.rmdirSync.bind(native);
    vi.spyOn(native, 'unlinkSync').mockImplementation((path) => { record('file', path); unlink(path); });
    vi.spyOn(native, 'rmdirSync').mockImplementation((path, options) => { record('directory', path); rmdir(path, options); });
    return observed;
  };
  const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((complete) => { resolve = complete; });
    return { promise, resolve };
  };
  const afterProgress = (matches: (receipt: MoveReceipt) => boolean, effect: (stored: StoredMoveReceipt) => Promise<void>) => {
    const update = receiptStorage.updateProjectMoveProgress;
    let fired = false;
    vi.spyOn(receiptStorage, 'updateProjectMoveProgress').mockImplementation(async (...args) => {
      const stored = await update(...args); // Real persistence and fingerprint first.
      if (!fired && matches(stored.receipt)) { fired = true; await effect(stored); }
      return stored;
    });
    return () => fired;
  };

  it('reloads without D result, verifies full bytes, removes in E1a order, returns none on repeat and permits a new move', async () => {
    const prepared = await move();
    const current = getProject(database, project.id);
    assertBytes(project.workspacePath); // D alone still retains every source byte.
    reopen();
    const observed = recordSourceRemovals();
    const open = vi.spyOn(fs, 'open');
    const exec = vi.spyOn(database, 'exec');
    const statements = vi.spyOn(database, 'prepare');
    await expect(recoverProjectMove(database, project.id.toUpperCase(), receiptDirectory))
      .resolves.toEqual({ status: 'completed', project: current });
    const order = getProjectMoveRemovalOrder(prepared);
    expect(observed.map(({ kind, path }) => ({ kind, path })))
      .toEqual(order.map(({ kind, relativePath }) => ({ kind, path: join(project.workspacePath, relativePath) })));
    observed.forEach(({ receipt }, index) => {
      expect(receipt).toMatchObject({ cursor: index, pendingDelete: index, phase: 'prepared' });
      expect(receipt.source).toEqual(prepared.source); // Never shrink/rebase source snapshots.
      expect(receipt.target).toEqual(prepared.target);
    });
    const reads = open.mock.calls.filter(([, flags]) => flags === 'r').map(([path]) => String(path));
    for (const relative of bytes.keys()) {
      expect(reads.filter((path) => path === join(project.workspacePath, relative))).toHaveLength(1);
      expect(reads.filter((path) => path === join(target, relative))).toHaveLength(2);
    }
    expect(reads.some((path) => path.startsWith(`${original}\\`) || path.startsWith(`${other.workspacePath}\\`))).toBe(false);
    expect(exec).not.toHaveBeenCalled();
    expect(statements.mock.calls.every(([statement]) => statement.startsWith('SELECT '))).toBe(true);
    expect(database.inTransaction).toBe(false);
    expect(native.existsSync(project.workspacePath)).toBe(false);
    expect(native.existsSync(receiptPath)).toBe(false);
    expect(getProject(database, project.id)).toEqual(current);
    assertBytes(target);
    assertUnrelated();
    await expect(recover()).resolves.toEqual({ status: 'none', project: current });
    expect(observed).toHaveLength(order.length);
    const nextParent = join(temporary, 'next');
    await fs.mkdir(nextParent);
    const next = await moveProjectDirectory(database, project.id, nextParent, [original], receiptDirectory);
    expect(next.sourceRetained).toBe(true);
    expect(next.storedReceipt.receipt.operationId).not.toBe(prepared.operationId);
    assertBytes(target);
    assertBytes(next.project.workspacePath);
    expect(() => assertProjectNotMoving(database, project.id)).not.toThrow();
  });

  it('returns none only for the missing expected record and leaves the DB/source unchanged', async () => {
    const open = vi.spyOn(fs, 'open');
    const exec = vi.spyOn(database, 'exec');
    const observed = recordSourceRemovals();
    await expect(recover()).resolves.toEqual({ status: 'none', project });
    expect(open).not.toHaveBeenCalled();
    expect(exec).not.toHaveBeenCalled();
    expect(observed).toEqual([]);
    assertBytes(project.workspacePath);
    expect(await fs.readdir(receiptDirectory)).toEqual([]);
    await expect(recoverProjectMove(database, project.id, join(temporary, 'missing', 'project-moves'))).rejects.toThrow();
    assertUnrelated();
  });

  it.each(['BEGIN DEFERRED', 'BEGIN IMMEDIATE', 'SAVEPOINT caller'])('rejects %s before receipt I/O without ending the transaction', async (begin) => {
    database.exec(begin);
    const open = vi.spyOn(fs, 'open');
    const lstat = vi.spyOn(fs, 'lstat');
    const syncStat = vi.spyOn(native, 'lstatSync');
    const exec = vi.spyOn(database, 'exec');
    await expect(recover()).rejects.toThrow(/transaction/);
    expect(open).not.toHaveBeenCalled();
    expect(lstat).not.toHaveBeenCalled();
    expect(syncStat).not.toHaveBeenCalled();
    expect(exec).not.toHaveBeenCalled();
    expect(database.inTransaction).toBe(true);
    database.exec('ROLLBACK');
  });

  it('rejects an invalid or unregistered Project before opening a receipt and releases the exclusion', async () => {
    const open = vi.spyOn(fs, 'open');
    for (const value of ['invalid', id]) await expect(recoverProjectMove(database, value, receiptDirectory)).rejects.toThrow();
    expect(open).not.toHaveBeenCalled();
    expect(() => assertProjectNotMoving(database, id)).not.toThrow();
    assertBytes(project.workspacePath);
  });

  it.each(['partial receipt', '{}', ''])('preserves corrupt existing receipt case %# instead of calling it absent', async (raw) => {
    await move();
    await fs.writeFile(receiptPath, raw);
    const observed = recordSourceRemovals();
    await expect(recover()).rejects.toThrow();
    expect(observed).toEqual([]);
    expect(native.readFileSync(receiptPath, 'utf8')).toBe(raw);
    expect(getProject(database, project.id).workspacePath).toBe(target);
    assertBytes(project.workspacePath);
    assertBytes(target);
    assertUnrelated();
  });

  it('returns source-retained for a prepared receipt still bound to the source, without cleaning either tree', async () => {
    await move();
    database.prepare('UPDATE projects SET workspace_path=? WHERE id=?').run(project.workspacePath, project.id);
    const current = getProject(database, project.id);
    const before = native.readFileSync(receiptPath);
    const observed = recordSourceRemovals();
    const rename = vi.spyOn(fs, 'rename');
    await expect(recover()).resolves.toEqual({ status: 'source-retained', project: current });
    expect(observed).toEqual([]);
    expect(rename).not.toHaveBeenCalled();
    expect(native.readFileSync(receiptPath)).toEqual(before);
    assertBytes(project.workspacePath);
    assertBytes(target);
    assertUnrelated();
  });

  it('retains a real failed E1b copying intent and partial target as requiring attention', async () => {
    const open = fs.open.bind(fs);
    let injected = false;
    const intercept = vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await open(...args);
      handles.push(handle);
      if (args[0] === join(target, 'images/data.bin') && args[1] === 'wx' && !injected) {
        injected = true;
        await fs.writeFile(join(target, 'unclaimed'), 'preserve this partial target');
        vi.spyOn(handle, 'write').mockRejectedValueOnce(new Error('injected copy write'));
      }
      return handle;
    });
    await expect(move()).rejects.toBeInstanceOf(AggregateError);
    expect(injected).toBe(true);
    expect(handles.every((handle) => handle.fd === -1)).toBe(true);
    intercept.mockRestore();
    const before = native.readFileSync(receiptPath);
    expect(disk().phase).toBe('copying');
    const observed = recordSourceRemovals();
    await expect(recover()).resolves.toEqual({ status: 'source-retained', project });
    expect(observed).toEqual([]);
    expect(native.readFileSync(receiptPath)).toEqual(before);
    expect(native.readFileSync(join(target, 'unclaimed'), 'utf8')).toBe('preserve this partial target');
    expect(native.existsSync(join(target, 'images/data.bin'))).toBe(true);
    assertBytes(project.workspacePath);
    assertUnrelated();
  });

  it.each(['images/data.bin', 'images/empty', markerName, ''])('rejects unexplained missing source entry %j with zero deletes', async (relative) => {
    await move();
    await fs.rename(join(project.workspacePath, relative), join(temporary, 'detached'));
    const before = native.readFileSync(receiptPath);
    const observed = recordSourceRemovals();
    await expect(recover()).rejects.toThrow();
    expect(observed).toEqual([]);
    expect(native.existsSync(join(temporary, 'detached'))).toBe(true);
    expect(native.readFileSync(receiptPath)).toEqual(before);
    expect(getProject(database, project.id).workspacePath).toBe(target);
    assertBytes(target);
    assertUnrelated();
  });

  for (const side of ['source', 'target'] as const) {
    it.each(['extra', 'edit', 'hardlink', 'junction', 'root-replacement', 'root-junction'] as const)(`rejects ${side} %s and preserves unknown bytes`, async (kind) => {
      await move();
      const root = side === 'source' ? project.workspacePath : target;
      const payload = join(root, 'images/data.bin');
      const detached = join(temporary, 'detached');
      let retainedFile = payload;
      if (kind === 'extra') {
        retainedFile = join(root, 'images/unclaimed');
        await fs.writeFile(retainedFile, 'unclaimed');
      }
      if (kind === 'edit') {
        const before = await fs.stat(payload);
        await fs.writeFile(payload, 'ZZZZ');
        await fs.utimes(payload, before.atime, before.mtime);
      }
      if (kind === 'hardlink') {
        await fs.rename(payload, detached);
        await fs.link(join(original, 'external.bin'), payload);
      }
      if (kind === 'junction') {
        await fs.rename(join(root, 'images'), detached);
        await fs.symlink(detached, join(root, 'images'), 'junction');
      }
      if (kind === 'root-replacement' || kind === 'root-junction') {
        await fs.rename(root, detached);
        if (kind === 'root-junction') await fs.symlink(detached, root, 'junction');
        else {
          await fs.mkdir(root);
          retainedFile = join(root, 'unclaimed');
          await fs.writeFile(retainedFile, 'replacement root');
        }
      }
      const retained = native.readFileSync(retainedFile);
      const before = native.readFileSync(receiptPath);
      const observed = recordSourceRemovals();
      await expect(recover()).rejects.toThrow();
      expect(observed).toEqual([]);
      expect(native.readFileSync(retainedFile)).toEqual(retained);
      expect(native.readFileSync(receiptPath)).toEqual(before);
      expect(getProject(database, project.id).workspacePath).toBe(target);
      assertUnrelated();
    });

    it.each(['root', 'marker', 'file', 'handle-time'] as const)(`checks actual ${side} identity/metadata, not rehashed fake %s fields`, async (kind) => {
      const prepared = await move();
      const forged = structuredClone(prepared) as Mutable<MoveReceipt>;
      const inventory = side === 'source' ? forged.source : forged.target!;
      if (kind === 'root') {
        const identity = { ...inventory.source.rootIdentity, ino: `${inventory.source.rootIdentity.ino}1` };
        inventory.source.rootIdentity = identity;
        inventory.directories[0]!.pathSnapshot.identity = identity;
      } else {
        const file = inventory.files.find((entry) => entry.relativePath === (kind === 'marker' ? markerName : 'images/data.bin'))!;
        if (kind === 'handle-time') file.handleSnapshot.ctimeNs += 1n;
        else {
          const identity = { ...file.pathSnapshot.identity, ino: `${file.pathSnapshot.identity.ino}1` };
          file.pathSnapshot.identity = identity;
          file.handleSnapshot.identity = identity;
          if (kind === 'marker') inventory.source.markerIdentity = identity;
        }
      }
      const raw = encodeProjectMoveReceipt(forged); // Strict schema + payload checksum still valid.
      await fs.writeFile(receiptPath, raw);
      expect(decodeProjectMoveReceipt(raw)).toEqual(forged);
      const observed = recordSourceRemovals();
      await expect(recover()).rejects.toThrow();
      expect(observed).toEqual([]);
      expect(native.readFileSync(receiptPath)).toEqual(raw);
      expect(getProject(database, project.id).workspacePath).toBe(target);
      assertBytes(project.workspacePath);
      assertBytes(target);
    });
  }

  it('rehashes the actual target even when forged receipt metadata matches its changed same-size bytes', async () => {
    const prepared = await move();
    await fs.writeFile(join(target, 'images/data.bin'), 'ZZZZ');
    const actual = await inventoryProjectMove(verifyProjectDirectory(target, project.id), prepared.target!.protectedRoots);
    const forged = { ...prepared, target: { ...actual,
      files: actual.files.map((file) => ({ ...file, sha256: prepared.target!.files.find((entry) => entry.relativePath === file.relativePath)!.sha256 })) } };
    const raw = encodeProjectMoveReceipt(forged);
    await fs.writeFile(receiptPath, raw);
    const observed = recordSourceRemovals();
    await expect(recover()).rejects.toThrow(/変更/);
    expect(observed).toEqual([]);
    expect(native.readFileSync(receiptPath)).toEqual(raw);
    expect(native.readFileSync(join(target, 'images/data.bin'), 'utf8')).toBe('ZZZZ');
    assertBytes(project.workspacePath);
    assertUnrelated();
  });

  it('rejects a missing target payload without deleting the still complete source', async () => {
    await move();
    await fs.unlink(join(target, 'images/data.bin'));
    const observed = recordSourceRemovals();
    await expect(recover()).rejects.toThrow();
    expect(observed).toEqual([]);
    expect(disk()).toMatchObject({ cursor: 0, pendingDelete: null });
    assertBytes(project.workspacePath);
    expect(getProject(database, project.id).workspacePath).toBe(target);
  });

  it('pins the current DB path identity, not just its folded equality to the prepared target', async () => {
    await move();
    const dbPath = target.toUpperCase();
    database.prepare('UPDATE projects SET workspace_path=? WHERE id=?').run(dbPath, project.id);
    const lstat = fs.lstat.bind(fs);
    let inspected = false;
    vi.spyOn(fs, 'lstat').mockImplementation((async (path, options) => {
      // Model a distinct case-sensitive Windows entry using another REAL root's
      // stat; the fixture does not enable OS case sensitivity or need elevation.
      if (path === dbPath) { inspected = true; return lstat(other.workspacePath, options); }
      return lstat(path, options);
    }) as typeof fs.lstat);
    const before = native.readFileSync(receiptPath);
    const observed = recordSourceRemovals();
    await expect(recover()).rejects.toThrow(/変更/);
    expect(inspected).toBe(true);
    expect(observed).toEqual([]);
    expect(native.readFileSync(receiptPath)).toEqual(before);
    expect(getProject(database, project.id).workspacePath).toBe(dbPath);
    assertBytes(project.workspacePath);
    assertBytes(target);
    assertUnrelated();
  });

  it.each(['source', 'target', 'source-parent', 'source-child', 'target-child'] as const)('refuses current other-Project binding to %s before deletion', async (location) => {
    await move();
    const root = location === 'source' ? project.workspacePath : location === 'target' ? target
      : location === 'source-parent' ? dirname(project.workspacePath)
        : join(location === 'source-child' ? project.workspacePath : target, 'images');
    database.prepare('UPDATE projects SET workspace_path=? WHERE id=?').run(root, other.id);
    const observed = recordSourceRemovals();
    const before = native.readFileSync(receiptPath);
    await expect(recover()).rejects.toThrow(/重複/);
    expect(observed).toEqual([]);
    expect(native.readFileSync(receiptPath)).toEqual(before);
    expect(getProject(database, project.id).workspacePath).toBe(target);
    assertBytes(project.workspacePath);
    assertBytes(target);
    assertUnrelated();
  });

  it.each(['write', 'sync', 'close', 'rename', 'rename-ack'] as const)('resumes after source unlink and progress %s failure from disk pending/prefix only', async (stage) => {
    const prepared = await move();
    const first = join(project.workspacePath, getProjectMoveRemovalOrder(prepared)[0]!.relativePath);
    const observed = recordSourceRemovals();
    let injected = false;
    if (stage === 'write' || stage === 'sync' || stage === 'close') {
      const open = fs.open.bind(fs);
      vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
        const handle = await open(...args);
        handles.push(handle);
        if (args[1] === 'wx' && dirname(String(args[0])) === receiptDirectory && !native.existsSync(first) && !injected) {
          injected = true;
          const failure = new Error(`injected progress ${stage}`);
          if (stage === 'write') vi.spyOn(handle, 'writeFile').mockRejectedValueOnce(failure);
          if (stage === 'sync') vi.spyOn(handle, 'sync').mockRejectedValueOnce(failure);
          if (stage === 'close') {
            const close = handle.close.bind(handle);
            vi.spyOn(handle, 'close').mockImplementationOnce(async () => { await close(); throw failure; });
          }
        }
        return handle;
      });
    } else {
      const rename = native.renameSync.bind(native);
      vi.spyOn(native, 'renameSync').mockImplementation((...args) => {
        const progress = args[1] === progressPath
          ? JSON.parse(native.readFileSync(String(args[0]), 'utf8')) as { payload: { cursor: number } } : undefined;
        if (progress?.payload.cursor === 1 && !injected) {
          injected = true;
          if (stage === 'rename-ack') rename(...args);
          throw new Error('injected progress rename');
        }
        return rename(...args);
      });
    }
    await expect(recover()).rejects.toThrow();
    expect(injected).toBe(true);
    expect(handles.every((handle) => handle.fd === -1)).toBe(true);
    expect(observed.map(({ path }) => path)).toEqual([first]);
    expect(native.existsSync(first)).toBe(false);
    expect(disk()).toMatchObject({ cursor: stage === 'rename-ack' ? 1 : 0, pendingDelete: stage === 'rename-ack' ? null : 0 });
    expect(disk().source).toEqual(prepared.source);
    expect(getProject(database, project.id).workspacePath).toBe(target);
    expect(() => assertProjectNotMoving(database, project.id)).not.toThrow();
    vi.restoreAllMocks();
    reopen();
    const resumed = recordSourceRemovals();
    await expect(recover()).resolves.toMatchObject({ status: 'completed', project: { workspacePath: target } });
    expect(resumed.some(({ path }) => path === first)).toBe(false);
    expect(resumed).toHaveLength(getProjectMoveRemovalOrder(prepared).length - 1);
    expect(native.existsSync(receiptPath)).toBe(false);
    assertBytes(target);
    assertUnrelated();
  });

  it.each(['original', 'identical-byte-replacement', 'hardlink-replacement'] as const)('only deletes a present pending path when it is still the %s', async (kind) => {
    await move();
    const path = join(project.workspacePath, 'images/data.bin');
    const unlink = native.unlinkSync.bind(native);
    const blocked = vi.spyOn(native, 'unlinkSync').mockImplementation((entry) => {
      if (entry === path) throw new Error('injected unlink before removal');
      unlink(entry);
    });
    await expect(recover()).rejects.toThrow(/injected unlink/);
    expect(disk()).toMatchObject({ cursor: 0, pendingDelete: 0 });
    blocked.mockRestore();
    if (kind !== 'original') {
      const detached = join(temporary, 'detached-file');
      await fs.rename(path, detached);
      if (kind === 'identical-byte-replacement') await fs.writeFile(path, bytes.get('images/data.bin')!, { flag: 'wx' });
      else await fs.link(detached, path);
    }
    reopen();
    const observed = recordSourceRemovals();
    if (kind === 'original') await expect(recover()).resolves.toMatchObject({ status: 'completed' });
    else {
      const before = native.readFileSync(receiptPath);
      await expect(recover()).rejects.toThrow();
      expect(observed).toEqual([]);
      expect(native.readFileSync(path)).toEqual(bytes.get('images/data.bin'));
      expect(native.readFileSync(receiptPath)).toEqual(before);
    }
    expect(getProject(database, project.id).workspacePath).toBe(target);
    assertBytes(target);
    assertUnrelated();
  });

  it.each(['extra', 'missing', 'completed-reappeared', 'target-copy'] as const)('stops on %s after its own cursor advance, preserving all later entries', async (kind) => {
    const prepared = await move();
    const fired = afterProgress((receipt) => receipt.cursor === 1 && receipt.pendingDelete === null, async () => {
      if (kind === 'extra') await fs.writeFile(join(project.workspacePath, 'images/unclaimed'), 'unknown');
      if (kind === 'missing') await fs.unlink(join(project.workspacePath, 'top.txt'));
      if (kind === 'completed-reappeared') await fs.writeFile(join(project.workspacePath, 'images/data.bin'), bytes.get('images/data.bin')!);
      if (kind === 'target-copy') await fs.writeFile(join(target, 'images/data.bin'), 'ZZZZ');
    });
    const observed = recordSourceRemovals();
    await expect(recover()).rejects.toThrow();
    expect(fired()).toBe(true);
    expect(observed.map(({ path }) => path)).toEqual([join(project.workspacePath, 'images/data.bin')]);
    expect(disk()).toMatchObject({ cursor: 1, pendingDelete: null });
    expect(disk().source).toEqual(prepared.source);
    expect(native.readFileSync(join(project.workspacePath, 'reference.json'))).toEqual(bytes.get('reference.json'));
    const before = native.readFileSync(receiptPath);
    vi.restoreAllMocks();
    const resumed = recordSourceRemovals();
    await expect(recover()).rejects.toThrow();
    expect(resumed).toEqual([]);
    expect(native.readFileSync(receiptPath)).toEqual(before);
    expect(getProject(database, project.id).workspacePath).toBe(target);
    assertUnrelated();
  });

  it.each(['source-file', 'target-file', 'extra-source', 'project-name', 'db-root', 'other-project-root', 'transaction'] as const)
    ('closes the pending-write await gap against %s without DB rollback or source deletion', async (kind) => {
      await move();
      const reached = deferred();
      const gate = deferred();
      afterProgress((receipt) => receipt.pendingDelete === 0, async () => { reached.resolve(); await gate.promise; });
      const observed = recordSourceRemovals();
      const exec = vi.spyOn(database, 'exec');
      const pending = recover();
      const outcome = pending.then((value) => ({ value, error: undefined }), (error: unknown) => ({ value: undefined, error }));
      try {
        await Promise.race([reached.promise, outcome.then(() => { throw new Error('recovery settled before gate'); })]);
        expect(disk()).toMatchObject({ cursor: 0, pendingDelete: 0 });
        if (kind === 'source-file' || kind === 'target-file') {
          await fs.writeFile(join(kind === 'source-file' ? project.workspacePath : target, 'top.txt'), 'ZZZZ');
        }
        if (kind === 'extra-source') await fs.writeFile(join(project.workspacePath, 'images/unclaimed'), 'unknown');
        if (kind === 'project-name') {
          expect(() => updateProject(database, { id: project.id, name: 'newer name', description: project.description,
            taskType: project.taskType, workspacePath: target })).toThrow(/移動中/);
          database.prepare('UPDATE projects SET name=?,updated_at=? WHERE id=?')
            .run('newer name', new Date().toISOString(), project.id);
        }
        if (kind === 'db-root') database.prepare('UPDATE projects SET workspace_path=? WHERE id=?').run(project.workspacePath, project.id);
        if (kind === 'other-project-root') database.prepare('UPDATE projects SET workspace_path=? WHERE id=?').run(project.workspacePath, other.id);
        if (kind === 'transaction') database.exec('BEGIN DEFERRED');
      } finally { gate.resolve(); await outcome; }
      expect((await outcome).error).toBeInstanceOf(Error);
      expect(observed).toEqual([]);
      expect(disk()).toMatchObject({ cursor: 0, pendingDelete: 0 });
      expect(native.existsSync(join(project.workspacePath, 'images/data.bin'))).toBe(true);
      expect(getProject(database, project.id).workspacePath).toBe(kind === 'db-root' ? project.workspacePath : target);
      if (kind === 'project-name') expect(getProject(database, project.id).name).toBe('newer name');
      expect(exec.mock.calls.map(([statement]) => statement)).toEqual(kind === 'transaction' ? ['BEGIN DEFERRED'] : []);
      if (kind === 'transaction') { expect(database.inTransaction).toBe(true); database.exec('ROLLBACK'); }
      expect(() => assertProjectNotMoving(database, project.id)).not.toThrow();
      assertUnrelated();
    });

  it('shares recovery exclusion with another recovery and D, but permits unrelated metadata edits', async () => {
    await move();
    const reached = deferred();
    const gate = deferred();
    afterProgress((receipt) => receipt.pendingDelete === 0, async () => { reached.resolve(); await gate.promise; });
    const pending = recover();
    const outcome = pending.then((value) => ({ value, error: undefined }), (error: unknown) => ({ value: undefined, error }));
    try {
      await Promise.race([reached.promise, outcome.then(() => { throw new Error('recovery settled before gate'); })]);
      await expect(recover()).rejects.toThrow(/移動中/);
      await expect(moveProjectDirectory(database, project.id, original, [], receiptDirectory)).rejects.toThrow(/移動中/);
      expect(() => assertProjectNotMoving(database, project.id)).toThrow(/移動中/);
      expect(() => assertProjectNotMoving(database, other.id)).not.toThrow();
      updateProject(database, { id: other.id, name: 'unrelated metadata', description: other.description,
        taskType: other.taskType, workspacePath: other.workspacePath });
    } finally { gate.resolve(); await outcome; }
    expect((await outcome).value).toMatchObject({ status: 'completed' });
    expect((await outcome).error).toBeUndefined();
    expect(() => assertProjectNotMoving(database, project.id)).not.toThrow();
    assertBytes(target);
    assertUnrelated();
  });

  it('rejects recovery while a real D copy is awaiting an open writer, then settles that move', async () => {
    const reached = deferred();
    const gate = deferred();
    const open = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await open(...args);
      handles.push(handle);
      if (args[0] === join(target, 'images/data.bin') && args[1] === 'wx') { reached.resolve(); await gate.promise; }
      return handle;
    });
    const pending = move();
    const outcome = pending.then((value) => ({ value, error: undefined }), (error: unknown) => ({ value: undefined, error }));
    try {
      await Promise.race([reached.promise, outcome.then(() => { throw new Error('move settled before gate'); })]);
      await expect(recover()).rejects.toThrow(/移動中/);
      expect(getProject(database, project.id)).toEqual(project);
    } finally { gate.resolve(); await outcome; }
    expect((await outcome).value?.phase).toBe('prepared');
    expect((await outcome).error).toBeUndefined();
    expect(handles.every((handle) => handle.fd === -1)).toBe(true);
    assertBytes(project.workspacePath);
    assertBytes(target);
  });

  it.each(['same-byte-new-inode', 'unissued-result'] as const)('refuses %s after a real progress write instead of trusting a matching checksum', async (kind) => {
    await move();
    const update = receiptStorage.updateProjectMoveProgress;
    let injected = false;
    let issued: StoredMoveReceipt | undefined;
    let originalProgressIno: bigint | undefined;
    vi.spyOn(receiptStorage, 'updateProjectMoveProgress').mockImplementation(async (...args) => {
      const stored = await update(...args);
      if (stored.receipt.pendingDelete === 0 && !injected) {
        injected = true;
        issued = stored;
        if (kind === 'unissued-result') return { ...stored };
        const raw = native.readFileSync(progressPath);
        originalProgressIno = native.lstatSync(progressPath, { bigint: true }).ino;
        native.renameSync(progressPath, join(receiptDirectory, 'retained-progress.json'));
        native.writeFileSync(progressPath, raw, { flag: 'wx' });
      }
      return stored;
    });
    const observed = recordSourceRemovals();
    await expect(recover()).rejects.toThrow(/receipt/);
    expect(injected).toBe(true);
    expect(observed).toEqual([]);
    expect(disk()).toMatchObject({ cursor: 0, pendingDelete: 0 });
    expect(sha256(native.readFileSync(receiptPath))).toBe(issued!.sha256);
    if (kind === 'same-byte-new-inode') expect(native.lstatSync(progressPath, { bigint: true }).ino).not.toBe(originalProgressIno);
    expect(getProject(database, project.id).workspacePath).toBe(target);
    assertBytes(project.workspacePath);
    assertBytes(target);
  });

  it('rejects a same-byte source replacement installed during the last hash handle close', async () => {
    await move();
    const path = join(project.workspacePath, 'zero.bin');
    const open = fs.open.bind(fs);
    let injected = false;
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await open(...args);
      handles.push(handle);
      if (args[0] === path && args[1] === 'r' && !injected) {
        const close = handle.close.bind(handle);
        vi.spyOn(handle, 'close').mockImplementationOnce(async () => {
          await close();
          injected = true;
          native.renameSync(path, join(temporary, 'detached-zero'));
          native.writeFileSync(path, Buffer.alloc(0), { flag: 'wx' });
        });
      }
      return handle;
    });
    const observed = recordSourceRemovals();
    await expect(recover()).rejects.toThrow(/変更/);
    expect(injected).toBe(true);
    expect(handles.every((handle) => handle.fd === -1)).toBe(true);
    expect(observed).toEqual([]);
    expect(disk()).toMatchObject({ cursor: 0, pendingDelete: null });
    assertBytes(project.workspacePath);
    assertBytes(target);
  });

  for (const position of ['child-directory', 'marker', 'root'] as const) {
    it.each(['before', 'after'] as const)(`resumes ${position} removal %s native failure without requiring a removed marker`, async (when) => {
      const prepared = await move();
      const order = getProjectMoveRemovalOrder(prepared);
      const index = position === 'child-directory' ? order.findIndex((entry) => entry.relativePath === 'images/empty')
        : order.length - (position === 'marker' ? 2 : 1);
      const path = join(project.workspacePath, order[index]!.relativePath);
      let injected = false;
      const failure = new Error('injected native removal');
      if (position === 'marker') {
        const unlink = native.unlinkSync.bind(native);
        vi.spyOn(native, 'unlinkSync').mockImplementation((entry) => {
          if (entry === path && !injected) {
            injected = true;
            if (when === 'after') unlink(entry);
            throw failure;
          }
          unlink(entry);
        });
      } else {
        const rmdir = native.rmdirSync.bind(native);
        vi.spyOn(native, 'rmdirSync').mockImplementation((entry, options) => {
          if (entry === path && !injected) {
            injected = true;
            if (when === 'after') rmdir(entry, options);
            throw failure;
          }
          rmdir(entry, options);
        });
      }
      await expect(recover()).rejects.toBe(failure);
      expect(injected).toBe(true);
      expect(disk()).toMatchObject({ cursor: index, pendingDelete: index });
      expect(disk().source).toEqual(prepared.source);
      if (position === 'root' && when === 'after') expect(native.existsSync(project.workspacePath)).toBe(false);
      else if (position === 'child-directory') {
        expect(native.readdirSync(project.workspacePath).sort()).toEqual([markerName, 'images']);
        expect(native.readdirSync(join(project.workspacePath, 'images'))).toEqual(when === 'before' ? ['empty'] : []);
      }
      else expect(native.readdirSync(project.workspacePath)).toEqual(position === 'marker' && when === 'before' ? [markerName] : []);
      expect(getProject(database, project.id).workspacePath).toBe(target);
      vi.restoreAllMocks();
      reopen();
      const observed = recordSourceRemovals();
      await expect(recover()).resolves.toMatchObject({ status: 'completed' });
      expect(observed.map(({ path: removed }) => removed)).toEqual(order.slice(index + (when === 'after' ? 1 : 0))
        .map((entry) => join(project.workspacePath, entry.relativePath)));
      expect(native.existsSync(project.workspacePath)).toBe(false);
      expect(native.existsSync(receiptPath)).toBe(false);
      assertBytes(target);
      assertUnrelated();
    });
  }

  it('preserves the final cursor and DB target on receipt-unlink failure, then retries with source already absent', async () => {
    const prepared = await move();
    const unlink = native.unlinkSync.bind(native);
    let injected = false;
    vi.spyOn(native, 'unlinkSync').mockImplementation((path) => {
      if (path === receiptPath && !injected) { injected = true; throw new Error('injected finish unlink'); }
      unlink(path);
    });
    await expect(recover()).rejects.toThrow(/injected finish unlink/);
    expect(injected).toBe(true);
    expect(native.existsSync(project.workspacePath)).toBe(false);
    expect(disk()).toMatchObject({ cursor: getProjectMoveRemovalOrder(prepared).length, pendingDelete: null });
    expect(getProject(database, project.id).workspacePath).toBe(target);
    vi.restoreAllMocks();
    reopen();
    const observed = recordSourceRemovals();
    await expect(recover()).resolves.toMatchObject({ status: 'completed' });
    expect(observed).toEqual([]);
    await expect(recover()).resolves.toMatchObject({ status: 'none' });
    assertBytes(target);
    assertUnrelated();
  });

  it.each(['write', 'sync', 'close', 'rename', 'rename-ack'] as const)
    ('resumes after final base consolidation %s failure without repeating a source removal', async (stage) => {
      const prepared = await move();
      const length = getProjectMoveRemovalOrder(prepared).length;
      let injected = false;
      if (stage === 'write' || stage === 'sync' || stage === 'close') {
        const open = fs.open.bind(fs);
        vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
          const handle = await open(...args);
          handles.push(handle);
          if (args[1] !== 'wx' || dirname(String(args[0])) !== receiptDirectory) return handle;
          const write = handle.writeFile.bind(handle);
          let consolidation = false;
          vi.spyOn(handle, 'writeFile').mockImplementation(async (data, options) => {
            if (Buffer.isBuffer(data)) {
              try {
                const receipt = decodeProjectMoveReceipt(data);
                consolidation = receipt.cursor === length && receipt.pendingDelete === null;
              } catch { consolidation = false; }
            }
            if (consolidation && stage === 'write' && !injected) {
              injected = true;
              throw new Error('injected consolidation write');
            }
            await write(data, options);
          });
          const sync = handle.sync.bind(handle);
          vi.spyOn(handle, 'sync').mockImplementation(async () => {
            if (consolidation && stage === 'sync' && !injected) {
              injected = true;
              throw new Error('injected consolidation sync');
            }
            await sync();
          });
          if (stage === 'close') {
            const close = handle.close.bind(handle);
            vi.spyOn(handle, 'close').mockImplementation(async () => {
              await close();
              if (consolidation && !injected) {
                injected = true;
                throw new Error('injected consolidation close');
              }
            });
          }
          return handle;
        });
      } else {
        const rename = native.renameSync.bind(native);
        vi.spyOn(native, 'renameSync').mockImplementation((...args) => {
          if (args[1] === receiptPath && !injected) {
            let receipt: MoveReceipt | undefined;
            try { receipt = decodeProjectMoveReceipt(native.readFileSync(String(args[0]))); } catch { /* not a receipt */ }
            if (receipt?.cursor === length) {
              injected = true;
              if (stage === 'rename-ack') rename(...args);
              throw new Error(`injected consolidation ${stage}`);
            }
          }
          return rename(...args);
        });
      }
      const observed = recordSourceRemovals();
      await expect(recover()).rejects.toThrow(/injected consolidation/);
      expect(injected).toBe(true);
      expect(observed).toHaveLength(length);
      expect(native.existsSync(project.workspacePath)).toBe(false);
      expect(native.existsSync(progressPath)).toBe(true);
      expect(disk()).toMatchObject({ cursor: length, pendingDelete: null });
      expect(decodeProjectMoveReceipt(native.readFileSync(receiptPath)).cursor)
        .toBe(stage === 'rename-ack' ? length : 0);
      vi.restoreAllMocks();
      reopen();
      const resumed = recordSourceRemovals();
      await expect(recover()).resolves.toMatchObject({ status: 'completed', project: { workspacePath: target } });
      expect(resumed).toEqual([]);
      expect(native.existsSync(receiptPath)).toBe(false);
      expect(native.existsSync(progressPath)).toBe(false);
      assertBytes(target);
      assertUnrelated();
    });

  it.each(['target-file', 'source-recreated', 'project-name', 'receipt-replaced'] as const)
    ('preserves the final receipt when %s changes during the final target verification await', async (kind) => {
      const prepared = await move();
      const reached = deferred();
      const gate = deferred();
      const open = fs.open.bind(fs);
      let finalHashClosed = false;
      let targetReads = 0;
      vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
        const handle = await open(...args);
        handles.push(handle);
        if (args[0] === join(target, 'zero.bin') && args[1] === 'r' && ++targetReads === 2) {
          const close = handle.close.bind(handle);
          vi.spyOn(handle, 'close').mockImplementationOnce(async () => { await close(); finalHashClosed = true; });
        }
        return handle;
      });
      const lstat = fs.lstat.bind(fs);
      let paused = false;
      vi.spyOn(fs, 'lstat').mockImplementation((async (path, options) => {
        const stat = await lstat(path, options);
        // C has checked target file metadata and is in its last disjoint-root
        // check. The old source is already absent and not a C protected root.
        if (finalHashClosed && path === other.workspacePath && !paused) {
          paused = true;
          reached.resolve();
          await gate.promise;
        }
        return stat;
      }) as typeof fs.lstat);
      const finish = vi.spyOn(receiptStorage, 'finishProjectMoveReceipt');
      const pending = recover();
      const outcome = pending.then((value) => ({ value, error: undefined }), (error: unknown) => ({ value: undefined, error }));
      let retained: Buffer | undefined;
      try {
        await Promise.race([reached.promise, outcome.then(() => { throw new Error('recovery settled before final gate'); })]);
        expect(native.existsSync(project.workspacePath)).toBe(false);
        expect(disk()).toMatchObject({ cursor: getProjectMoveRemovalOrder(prepared).length, pendingDelete: null });
        retained = native.readFileSync(receiptPath);
        if (kind === 'target-file') await fs.writeFile(join(target, 'images/data.bin'), 'ZZZZ');
        if (kind === 'source-recreated') {
          await fs.mkdir(project.workspacePath);
          await fs.writeFile(join(project.workspacePath, 'unclaimed'), 'unknown replacement');
        }
        if (kind === 'project-name') {
          expect(() => updateProject(database, { id: project.id, name: 'newer final metadata', description: project.description,
            taskType: project.taskType, workspacePath: target })).toThrow(/移動中/);
          database.prepare('UPDATE projects SET name=?,updated_at=? WHERE id=?')
            .run('newer final metadata', new Date().toISOString(), project.id);
        }
        if (kind === 'receipt-replaced') {
          await fs.rename(receiptPath, join(receiptDirectory, 'retained.json'));
          await fs.writeFile(receiptPath, retained, { flag: 'wx' });
        }
      } finally { gate.resolve(); await outcome; }
      expect(paused).toBe(true);
      expect((await outcome).error).toBeInstanceOf(Error);
      expect(finish).not.toHaveBeenCalled();
      expect(handles.every((handle) => handle.fd === -1)).toBe(true);
      expect(native.readFileSync(receiptPath)).toEqual(retained);
      expect(getProject(database, project.id).workspacePath).toBe(target);
      if (kind === 'source-recreated') expect(native.readFileSync(join(project.workspacePath, 'unclaimed'), 'utf8')).toBe('unknown replacement');
      if (kind === 'project-name') expect(getProject(database, project.id).name).toBe('newer final metadata');
      expect(() => assertProjectNotMoving(database, project.id)).not.toThrow();
      assertUnrelated();
    });

  it('keeps old-source ancestor geometry after reclamation instead of following a new alias into the target', async () => {
    const prepared = await move();
    const unlink = native.unlinkSync.bind(native);
    const blocked = vi.spyOn(native, 'unlinkSync').mockImplementation((path) => {
      if (path === receiptPath) throw new Error('hold final receipt');
      unlink(path);
    });
    await expect(recover()).rejects.toThrow(/hold final/);
    blocked.mockRestore();
    const sourceParent = dirname(project.workspacePath);
    await fs.rename(sourceParent, join(temporary, 'retained-parent'));
    await fs.symlink(destination, sourceParent, 'junction');
    const before = native.readFileSync(receiptPath);
    const observed = recordSourceRemovals();
    await expect(recover()).rejects.toThrow(/リンク/);
    expect(observed).toEqual([]);
    expect(native.readFileSync(receiptPath)).toEqual(before);
    expect(disk().cursor).toBe(getProjectMoveRemovalOrder(prepared).length);
    expect(getProject(database, project.id).workspacePath).toBe(target);
    assertBytes(target);
    assertUnrelated();
  });
});