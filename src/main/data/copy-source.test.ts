// @vitest-environment node
import crypto, { createHash } from 'node:crypto';
import native, { constants, type BigIntStats } from 'node:fs';
import fs, { type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { win32 } from 'node:path';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import type { ScanImage } from '../../shared/contracts/import.js';
import {
  copySourceFile,
  type CopiedSourceFile,
  type CopySourceImage,
} from './copy-source.js';
import {
  createProjectDirectory,
  type ProjectDirectoryReceipt,
} from '../projects/project-directory.js';

const projectId = '9b2db431-04e9-488b-b4c2-3859fd26cb6e';
const destination = 'imports/image-0.bin';
const temporaryPrefix = '.autovision-copy-';
const realOpen = fs.open.bind(fs);
const realLink = native.linkSync.bind(native);
const realUnlink = native.unlinkSync.bind(native);
const handles: FileHandle[] = [];

let temporary: string;
let sourceDirectory: string;
let sourcePath: string;
let sourceBytes: Buffer;
let projectParent: string;
let project: ProjectDirectoryReceipt;
let imports: string;

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function fileIdentity(stat: BigIntStats): object {
  return { dev: String(stat.dev), ino: String(stat.ino), birthtimeNs: String(stat.birthtimeNs) };
}

type DescriptorRead = (buffer: Buffer, offset: number, length: number, position: number) =>
  Promise<{ bytesRead: number; buffer: Buffer }>;
type DescriptorWrite = (buffer: Buffer, offset: number, length: number, position: number) =>
  Promise<{ bytesWritten: number; buffer: Buffer }>;
function mockDescriptorRead(handle: FileHandle, implementation: DescriptorRead) {
  return vi.spyOn(handle, 'read').mockImplementation(implementation as FileHandle['read']);
}
function mockDescriptorWrite(handle: FileHandle, implementation: DescriptorWrite) {
  return vi.spyOn(handle, 'write').mockImplementation(implementation as FileHandle['write']);
}

async function scanned(overrides: Partial<CopySourceImage> = {}): Promise<CopySourceImage> {
  const stat = await fs.lstat(sourcePath, { bigint: true });
  return {
    key: 'image:0',
    sourcePath,
    byteSize: sourceBytes.length,
    mtimeNs: String(stat.mtimeNs),
    sha256: digest(sourceBytes),
    ...overrides,
  };
}

function finalPath(relative = destination): string {
  return win32.join(project.rootPath, ...relative.split('/'));
}

async function expectNoCopy(): Promise<void> {
  await expect(fs.lstat(finalPath())).rejects.toMatchObject({ code: 'ENOENT' });
  expect((await fs.readdir(imports)).filter((name) => name.startsWith(temporaryPrefix))).toEqual([]);
}

function interceptOpen(configure: (handle: FileHandle, path: string, flags: string | number) => void) {
  return vi.spyOn(fs, 'open').mockImplementation(async (path, flags, mode) => {
    const handle = await realOpen(path, flags, mode);
    handles.push(handle);
    try { configure(handle, String(path), flags as string | number); }
    catch (error) { await handle.close(); throw error; }
    return handle;
  });
}

async function closeRealHandles(): Promise<void> {
  for (const handle of handles.splice(0)) {
    if (handle.fd !== -1) {
      try { await handle.close(); } catch { /* test teardown owns only leaked fixture handles */ }
    }
  }
}

beforeEach(async () => {
  temporary = await fs.realpath(await fs.mkdtemp(win32.join(tmpdir(), 'autovision-dat06-')));
  sourceDirectory = win32.join(temporary, 'source');
  projectParent = win32.join(temporary, 'projects');
  await fs.mkdir(sourceDirectory);
  await fs.mkdir(projectParent);
  sourcePath = win32.join(sourceDirectory, '元画像.bin');
  sourceBytes = Buffer.from(Array.from({ length: 131_109 }, (_, index) => (index * 31 + 7) & 0xff));
  await fs.writeFile(sourcePath, sourceBytes, { flag: 'wx' });
  project = createProjectDirectory(projectParent, projectId, []);
  imports = win32.join(project.rootPath, 'imports');
  await fs.mkdir(imports);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await closeRealHandles();
  if (temporary) await fs.rm(temporary, { recursive: true, force: true });
});

describe.skipIf(process.platform !== 'win32')('DAT-06 copy storage', () => {
  it('exposes one narrow Main-only single-file primitive', () => {
    expectTypeOf(copySourceFile).parameters.toEqualTypeOf<[
      ProjectDirectoryReceipt, CopySourceImage, string,
    ]>();
    expectTypeOf(copySourceFile).returns.toEqualTypeOf<Promise<CopiedSourceFile>>();
    expectTypeOf<ScanImage>().toMatchTypeOf<CopySourceImage>();
  });

  it('streams exact bytes, verifies SHA-256, atomically publishes without source writes, and returns frozen proof', async () => {
    const before = await fs.lstat(sourcePath, { bigint: true });
    const link = vi.spyOn(native, 'linkSync').mockImplementation((from, to) => {
      expect(native.existsSync(to)).toBe(false);
      expect(digest(native.readFileSync(from))).toBe(digest(sourceBytes));
      realLink(from, to);
    });
    const unlink = vi.spyOn(native, 'unlinkSync');
    const rename = vi.spyOn(native, 'renameSync');
    const copy = vi.spyOn(fs, 'copyFile');
    const wholeRead = vi.spyOn(fs, 'readFile');
    const wholeWrite = vi.spyOn(fs, 'writeFile');
    const result = await copySourceFile(project, await scanned(), destination);

    const installed = await fs.lstat(finalPath(), { bigint: true });
    expect(native.readFileSync(finalPath())).toEqual(sourceBytes);
    expect(result).toEqual({ imageKey: 'image:0', relativePath: destination,
      byteSize: sourceBytes.length, sha256: digest(sourceBytes), fileIdentity: fileIdentity(installed) });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.fileIdentity)).toBe(true);
    expect(installed.nlink).toBe(1n);
    expect(link).toHaveBeenCalledOnce();
    expect(win32.dirname(String(link.mock.calls[0]![0]))).toBe(imports);
    expect(link.mock.calls[0]![1]).toBe(finalPath());
    expect(unlink).toHaveBeenCalledOnce();
    expect(unlink.mock.calls[0]![0]).toBe(link.mock.calls[0]![0]);
    expect(rename).not.toHaveBeenCalled();
    expect(copy).not.toHaveBeenCalled();
    expect(wholeRead).not.toHaveBeenCalled();
    expect(wholeWrite).not.toHaveBeenCalled();

    const after = await fs.lstat(sourcePath, { bigint: true });
    expect(native.readFileSync(sourcePath)).toEqual(sourceBytes);
    expect(fileIdentity(after)).toEqual(fileIdentity(before));
    expect(after.size).toBe(before.size);
    expect(after.mtimeNs).toBe(before.mtimeNs);
    expect((await fs.readdir(imports)).sort()).toEqual(['image-0.bin']);
  });

  it('uses bounded reads and completes short writes instead of buffering the source', async () => {
    sourceBytes = Buffer.alloc(2 * 1024 * 1024 + 17, 0xa5);
    await fs.writeFile(sourcePath, sourceBytes);
    const sourceReads: number[] = [];
    const verificationReads: number[] = [];
    let shortWrites = 0;
    interceptOpen((handle, path) => {
      if (path === sourcePath) {
        const read = handle.read.bind(handle);
        mockDescriptorRead(handle, async (buffer, offset, length, position) => {
          sourceReads.push(length);
          return read(buffer, offset, length, position);
        });
      } else if (win32.basename(path).startsWith(temporaryPrefix)) {
        const read = handle.read.bind(handle);
        const write = handle.write.bind(handle);
        mockDescriptorRead(handle, async (buffer, offset, length, position) => {
          verificationReads.push(length);
          return read(buffer, offset, length, position);
        });
        mockDescriptorWrite(handle, async (buffer, offset, length, position) => {
          const bounded = Math.min(length, 32_749);
          shortWrites += Number(bounded < length);
          return write(buffer, offset, bounded, position);
        });
      }
    });
    const result = await copySourceFile(project, await scanned(), destination);
    expect(result.byteSize).toBe(sourceBytes.length);
    expect(native.readFileSync(finalPath())).toEqual(sourceBytes);
    expect(shortWrites).toBeGreaterThan(0);
    expect(sourceReads.length).toBeGreaterThan(30);
    expect(verificationReads.length).toBeGreaterThan(30);
    expect(Math.max(...sourceReads, ...verificationReads)).toBeLessThanOrEqual(64 * 1024);
  });

  it('snapshots all required caller data before the first await and ignores extra getters', async () => {
    const image = { ...(await scanned()) };
    const mutableProject = structuredClone(project);
    const extra = vi.fn(() => { throw new Error('must not read extra'); });
    Object.defineProperty(image, 'extra', { enumerable: true, get: extra });
    const pending = copySourceFile(mutableProject, image, destination);
    image.key = 'changed';
    image.sourcePath = win32.join(temporary, 'changed');
    image.byteSize = 1;
    image.mtimeNs = '0';
    image.sha256 = '0'.repeat(64);
    Reflect.set(mutableProject, 'rootPath', win32.join(temporary, 'changed-project'));
    Reflect.set(mutableProject.rootIdentity, 'ino', '999');
    const result = await pending;
    expect(result).toMatchObject({ imageKey: 'image:0', relativePath: destination,
      byteSize: sourceBytes.length, sha256: digest(sourceBytes) });
    expect(extra).not.toHaveBeenCalled();
  });

  it.each([
    '', '/absolute.bin', 'C:/absolute.bin', '../escape.bin', 'imports/../escape.bin',
    'imports//file.bin', 'imports/./file.bin', 'imports/file.bin/', 'imports\\file.bin',
    '.autovision-project.json', 'imports/NUL.txt', 'imports/COM¹.bin', 'imports/a:stream',
    'imports/trailing.', 'imports/trailing ', `imports/${'x'.repeat(256)}`,
    'imports/.autovision-copy-owned.tmp',
  ])('rejects unsafe destination %j before filesystem I/O', async (relative) => {
    const lstat = vi.spyOn(fs, 'lstat');
    const open = vi.spyOn(fs, 'open');
    await expect(copySourceFile(project, await scanned(), relative)).rejects.toThrow(TypeError);
    // scanned() accounts for exactly one fixture lstat before the call.
    expect(lstat).toHaveBeenCalledOnce();
    expect(open).not.toHaveBeenCalled();
  });

  it('rejects required accessors and malformed scan fields without invoking getters or I/O', async () => {
    const getter = vi.fn(() => 'image:0');
    const accessor = { ...(await scanned()) };
    Object.defineProperty(accessor, 'key', { enumerable: true, get: getter });
    const open = vi.spyOn(fs, 'open');
    const lstat = vi.spyOn(fs, 'lstat');
    await expect(copySourceFile(project, accessor, destination)).rejects.toThrow(TypeError);
    expect(getter).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(lstat).not.toHaveBeenCalled();

    const valid = await scanned();
    for (const changed of [
      { ...valid, byteSize: 0 }, { ...valid, byteSize: 134_217_729 },
      { ...valid, byteSize: 1.5 }, { ...valid, mtimeNs: '01' },
      { ...valid, sha256: 'A'.repeat(64) }, { ...valid, sourcePath: '\\\\server\\share\\a.png' },
      { ...valid, sourcePath: 'C:\\safe\\..\\a.png' },
    ]) {
      await expect(copySourceFile(project, changed, destination)).rejects.toThrow(TypeError);
    }
    expect(open).not.toHaveBeenCalled();
  });

  it('rejects a copied or changed Project receipt before opening the source', async () => {
    const falseReceipt = structuredClone(project);
    Reflect.set(falseReceipt.rootIdentity, 'ino', String(BigInt(falseReceipt.rootIdentity.ino) + 1n));
    const open = vi.spyOn(fs, 'open');
    await expect(copySourceFile(falseReceipt, await scanned(), destination)).rejects.toThrow(/Project/);
    expect(open).not.toHaveBeenCalled();
    await expectNoCopy();
  });

  it.each(['size', 'mtime', 'hash'] as const)('rejects a source whose scan %s no longer matches and cleans only its temp', async (kind) => {
    const value = await scanned(kind === 'size' ? { byteSize: sourceBytes.length - 1 }
      : kind === 'mtime' ? { mtimeNs: '0' } : { sha256: '0'.repeat(64) });
    await expect(copySourceFile(project, value, destination)).rejects.toThrow(/変更/);
    await expectNoCopy();
    expect(native.readFileSync(sourcePath)).toEqual(sourceBytes);
  });

  it('detects a source mutation during streaming and never publishes a prefix', async () => {
    const image = await scanned();
    let changed = false;
    interceptOpen((handle, path) => {
      if (path !== sourcePath) return;
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
    await expect(copySourceFile(project, image, destination)).rejects.toThrow(/変更/);
    expect(changed).toBe(true);
    await expectNoCopy();
  });

  it.each(['sync', 'close'] as const)(
    'rejects a same-inode source overwrite with exactly restored mtime after writer.%s consumes the original hash', async (stage) => {
      const fixedSeconds = 1_700_000_000;
      native.utimesSync(sourcePath, fixedSeconds, fixedSeconds);
      const image = await scanned();
      const before = native.lstatSync(sourcePath, { bigint: true });
      expect(before.mtimeNs).toBe(BigInt(fixedSeconds) * 1_000_000_000n);
      const changedBytes = Buffer.alloc(sourceBytes.length, 0x42);
      const keep = win32.join(imports, 'keep');
      native.writeFileSync(keep, 'unknown owner', { flag: 'wx' });
      const streamedHash = createHash('sha256');
      let streamedBytes = 0;
      let sourceEof = false;
      let changed = false;
      let temp = '';
      let injections = 0;
      const guardDescriptors = new Set<number>();
      const openSync = native.openSync.bind(native);
      const closeSync = native.closeSync.bind(native);
      const readSync = native.readSync.bind(native);
      let guardOpens = 0;
      let guardReads = 0;
      vi.spyOn(native, 'openSync').mockImplementation((path, flags, mode) => {
        const fd = openSync(path, flags, mode);
        if (changed && String(path) === sourcePath
          && flags === (constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)) {
          guardDescriptors.add(fd);
          guardOpens += 1;
        }
        return fd;
      });
      vi.spyOn(native, 'readSync').mockImplementation(((fd: number, buffer: Buffer,
        offset: number, length: number, position: number) => {
        if (guardDescriptors.has(fd)) {
          guardReads += 1;
          expect(length).toBeLessThanOrEqual(64 * 1024);
        }
        return readSync(fd, buffer, offset, length, position);
      }) as typeof native.readSync);
      vi.spyOn(native, 'closeSync').mockImplementation((fd) => {
        closeSync(fd);
        guardDescriptors.delete(fd);
      });
      interceptOpen((handle, path, flags) => {
        if (path === sourcePath) {
          const read = handle.read.bind(handle);
          mockDescriptorRead(handle, async (buffer, offset, length, position) => {
            const result = await read(buffer, offset, length, position);
            streamedBytes += result.bytesRead;
            streamedHash.update(buffer.subarray(offset, offset + result.bytesRead));
            if (result.bytesRead === 0) sourceEof = true;
            return result;
          });
        }
        if (flags !== 'wx+') return;
        temp = path;
        const actual = handle[stage].bind(handle);
        vi.spyOn(handle, stage).mockImplementationOnce(async () => {
          await actual();
          if (stage === 'close') expect(handle.fd).toBe(-1);
          expect(sourceEof).toBe(true);
          expect(streamedBytes).toBe(sourceBytes.length);
          expect(streamedHash.digest('hex')).toBe(image.sha256);
          expect(native.readFileSync(sourcePath)).toEqual(sourceBytes);
          expect(native.readFileSync(temp)).toEqual(sourceBytes);
          const atMutation = native.lstatSync(sourcePath, { bigint: true });
          expect(fileIdentity(atMutation)).toEqual(fileIdentity(before));
          expect(atMutation.size).toBe(before.size);
          expect(atMutation.mtimeNs).toBe(before.mtimeNs);
          // Mutate real bytes only after the accepted stream hash; never spoof stat/read results.
          native.writeFileSync(sourcePath, changedBytes, { flag: 'r+' });
          native.utimesSync(sourcePath, fixedSeconds, fixedSeconds);
          const after = native.lstatSync(sourcePath, { bigint: true });
          expect(fileIdentity(after)).toEqual(fileIdentity(before));
          expect(after.size).toBe(before.size);
          expect(after.mtimeNs).toBe(before.mtimeNs);
          expect(after.nlink).toBe(before.nlink);
          expect(after.ctimeNs).not.toBe(atMutation.ctimeNs);
          expect(digest(native.readFileSync(sourcePath))).not.toBe(image.sha256);
          changed = true;
          injections += 1;
        });
      });
      const link = vi.spyOn(native, 'linkSync');
      const unlink = vi.spyOn(native, 'unlinkSync');
      try {
        await expect(copySourceFile(project, image, destination)).rejects.toThrow(
          'scan後またはコピー中に元画像の実体または内容が変更されました。',
        );
        expect(injections).toBe(1);
        expect(guardOpens).toBeGreaterThan(0);
        expect(guardReads).toBeGreaterThan(0);
        expect(guardDescriptors.size).toBe(0);
        expect(handles.every((handle) => handle.fd === -1)).toBe(true);
        expect(link).not.toHaveBeenCalled();
        expect(unlink).toHaveBeenCalledOnce();
        expect(unlink).toHaveBeenCalledWith(temp);
        await expectNoCopy();
        expect(native.readdirSync(imports)).toEqual(['keep']);
        expect(native.readFileSync(keep, 'utf8')).toBe('unknown owner');
        expect(native.readFileSync(sourcePath)).toEqual(changedBytes);
        const retained = native.lstatSync(sourcePath, { bigint: true });
        expect(fileIdentity(retained)).toEqual(fileIdentity(before));
        expect(retained.size).toBe(before.size);
        expect(retained.mtimeNs).toBe(before.mtimeNs);
      } finally {
        for (const fd of guardDescriptors) closeSync(fd);
      }
    },
  );

  it('detects an identical-byte source replacement at the final reader close', async () => {
    const image = await scanned();
    const retained = win32.join(sourceDirectory, 'retained.bin');
    let replaced = false;
    interceptOpen((handle, path) => {
      if (path !== sourcePath) return;
      const close = handle.close.bind(handle);
      vi.spyOn(handle, 'close').mockImplementation(async () => {
        await close();
        if (!replaced) {
          native.renameSync(sourcePath, retained);
          native.writeFileSync(sourcePath, sourceBytes, { flag: 'wx' });
          replaced = true;
        }
      });
    });
    await expect(copySourceFile(project, image, destination)).rejects.toThrow(/変更/);
    expect(replaced).toBe(true);
    expect(native.readFileSync(sourcePath)).toEqual(sourceBytes);
    expect(native.readFileSync(retained)).toEqual(sourceBytes);
    await expectNoCopy();
  });

  it('rejects a source hardlink and an ancestor junction without changing either target', async () => {
    const alias = win32.join(temporary, 'source-hardlink.bin');
    await fs.link(sourcePath, alias);
    await expect(copySourceFile(project, await scanned(), destination)).rejects.toThrow(/hardlink|リンク/);
    await expectNoCopy();
    await fs.unlink(alias);

    const real = win32.join(temporary, 'real-source');
    const junction = win32.join(temporary, 'source-junction');
    await fs.mkdir(real);
    const bytes = Buffer.from('junction source');
    await fs.writeFile(win32.join(real, 'image.bin'), bytes);
    await fs.symlink(real, junction, 'junction');
    const stat = await fs.lstat(win32.join(real, 'image.bin'), { bigint: true });
    const image = { key: 'image:junction', sourcePath: win32.join(junction, 'image.bin'), byteSize: bytes.length,
      mtimeNs: String(stat.mtimeNs), sha256: digest(bytes) };
    await expect(copySourceFile(project, image, destination)).rejects.toThrow(/リンク/);
    expect(native.readFileSync(win32.join(real, 'image.bin'))).toEqual(bytes);
    await expectNoCopy();
  });

  it('rejects a file symlink when Windows permits creating it', async ({ skip }) => {
    const real = win32.join(sourceDirectory, 'real.bin');
    const link = win32.join(sourceDirectory, 'link.bin');
    await fs.writeFile(real, 'symlink source');
    try { await fs.symlink(real, link, 'file'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') { skip(); return; }
      throw error;
    }
    const stat = await fs.lstat(real, { bigint: true });
    const bytes = native.readFileSync(real);
    await expect(copySourceFile(project, { key: 'image:link', sourcePath: link, byteSize: bytes.length,
      mtimeNs: String(stat.mtimeNs), sha256: digest(bytes) }, destination)).rejects.toThrow(/リンク/);
    await expectNoCopy();
  });

  it.each(['file', 'directory', 'case-alias'] as const)('never adopts or overwrites an existing %s destination', async (kind) => {
    const requested = finalPath();
    const actual = kind === 'case-alias' ? win32.join(imports, 'IMAGE-0.BIN') : requested;
    if (kind === 'directory') {
      await fs.mkdir(actual);
      await fs.writeFile(win32.join(actual, 'keep'), 'directory data');
    } else await fs.writeFile(actual, 'existing data', { flag: 'wx' });
    const link = vi.spyOn(native, 'linkSync');
    await expect(copySourceFile(project, await scanned(), destination)).rejects.toThrow(/既存|コピー先/);
    expect(link).not.toHaveBeenCalled();
    if (kind === 'directory') expect(await fs.readFile(win32.join(actual, 'keep'), 'utf8')).toBe('directory data');
    else expect(await fs.readFile(actual, 'utf8')).toBe('existing data');
    expect((await fs.readdir(imports)).filter((name) => name.startsWith(temporaryPrefix))).toEqual([]);
  });

  it('requires every destination parent to exist as a normal exact-case directory', async () => {
    await expect(copySourceFile(project, await scanned(), 'missing/file.bin')).rejects.toThrow(/コピー先/);
    await expect(fs.lstat(win32.join(project.rootPath, 'missing'))).rejects.toMatchObject({ code: 'ENOENT' });

    const outside = win32.join(temporary, 'outside');
    await fs.mkdir(outside);
    await fs.symlink(outside, win32.join(imports, 'alias'), 'junction');
    await expect(copySourceFile(project, await scanned(), 'imports/alias/file.bin')).rejects.toThrow(/コピー先/);
    expect(await fs.readdir(outside)).toEqual([]);
  });

  it('preserves a colliding exclusive temporary name without opening, deleting, or retrying it', async () => {
    const uuid = '11111111-1111-4111-8111-111111111111';
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(uuid);
    const collision = win32.join(imports, `${temporaryPrefix}${uuid}.tmp`);
    await fs.writeFile(collision, 'somebody else', { flag: 'wx' });
    const open = vi.spyOn(fs, 'open');
    const unlink = vi.spyOn(native, 'unlinkSync');
    await expect(copySourceFile(project, await scanned(), destination)).rejects.toThrow(/既存/);
    expect(open).not.toHaveBeenCalled();
    expect(unlink).not.toHaveBeenCalled();
    expect(await fs.readFile(collision, 'utf8')).toBe('somebody else');
    await expect(fs.lstat(finalPath())).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['first-source-parent', 'last-destination-parent', 'last-missing'] as const)(
    'rejects an ordinary same-path leaf replacement during %s without opening a writer', async (stage) => {
      const image = await scanned();
      const retained = `${imports}.retained`;
      const lstat = fs.lstat.bind(fs);
      let replaced = false;
      let parentStats = 0;
      let finalStats = 0;
      vi.spyOn(fs, 'lstat').mockImplementation(async (path, options) => {
        const text = String(path);
        const inject = !replaced && (stage === 'first-source-parent' && text === win32.parse(sourcePath).root
          || stage === 'last-destination-parent' && text === imports && ++parentStats === 2
          || stage === 'last-missing' && text === finalPath() && ++finalStats === 2);
        try { return await lstat(path, options as never); }
        finally {
          if (inject) {
            native.renameSync(imports, retained);
            native.mkdirSync(imports);
            native.writeFileSync(win32.join(imports, 'keep'), 'unknown leaf');
            replaced = true;
          }
        }
      });
      const open = vi.spyOn(fs, 'open');
      const unlink = vi.spyOn(native, 'unlinkSync');
      await expect(copySourceFile(project, image, destination)).rejects.toThrow(/Project/);
      expect(replaced).toBe(true);
      expect(open.mock.calls.filter(([, flags]) => flags === 'wx+')).toHaveLength(0);
      expect(unlink).not.toHaveBeenCalled();
      expect(native.readdirSync(retained)).toEqual([]);
      expect(native.readdirSync(imports)).toEqual(['keep']);
      expect(native.readFileSync(win32.join(imports, 'keep'), 'utf8')).toBe('unknown leaf');
    },
  );

  it.each(['last-destination-parent', 'last-missing'] as const)(
    'blocks a junction replacement during %s before exclusive writer open', async (stage) => {
      const image = await scanned();
      const outside = win32.join(temporary, 'outside');
      const retained = `${imports}.retained`;
      native.mkdirSync(outside);
      native.writeFileSync(win32.join(outside, 'keep'), 'external file');
      const lstat = fs.lstat.bind(fs);
      let replaced = false;
      let parentStats = 0;
      let finalStats = 0;
      vi.spyOn(fs, 'lstat').mockImplementation(async (path, options) => {
        const inject = !replaced && (stage === 'last-destination-parent' && String(path) === imports && ++parentStats === 2
          || stage === 'last-missing' && String(path) === finalPath() && ++finalStats === 2);
        try { return await lstat(path, options as never); }
        finally {
          if (inject) {
            native.renameSync(imports, retained);
            native.symlinkSync(outside, imports, 'junction');
            replaced = true;
          }
        }
      });
      const open = vi.spyOn(fs, 'open');
      const unlink = vi.spyOn(native, 'unlinkSync');
      await expect(copySourceFile(project, image, destination)).rejects.toThrow(/Project/);
      expect(replaced).toBe(true);
      expect(open.mock.calls.filter(([, flags]) => flags === 'wx+')).toHaveLength(0);
      expect(unlink).not.toHaveBeenCalled();
      expect(native.readdirSync(retained)).toEqual([]);
      expect(native.readdirSync(outside)).toEqual(['keep']);
      expect(native.readFileSync(win32.join(outside, 'keep'), 'utf8')).toBe('external file');
    },
  );

  (['leaf', 'temp', 'read-await'] as const).forEach((stage) => {
    it(`rejects a ${stage} replacement after writer open before payload and preserves both owners`, async ({ skip }) => {
      const image = await scanned();
      const retained = `${imports}.retained`;
      let temp = '';
      let owned = '';
      let replaced = false;
      let denied: NodeJS.ErrnoException | undefined;
      const write = vi.fn();
      const replace = (): void => {
        if (stage === 'leaf') {
          try { native.renameSync(imports, retained); }
          catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'EPERM') denied = error as NodeJS.ErrnoException;
            throw error;
          }
          native.mkdirSync(imports);
          owned = win32.join(retained, win32.basename(temp));
        } else {
          owned = `${temp}.retained`;
          native.renameSync(temp, owned);
        }
        native.writeFileSync(temp, 'unknown temporary', { flag: 'wx' });
        replaced = true;
      };
      interceptOpen((handle, path, flags) => {
        if (path === sourcePath && stage === 'read-await') {
          const read = handle.read.bind(handle);
          mockDescriptorRead(handle, async (buffer, offset, length, position) => {
            const result = await read(buffer, offset, length, position);
            if (!replaced) replace();
            return result;
          });
        }
        if (flags !== 'wx+') return;
        temp = path;
        const realWrite = handle.write.bind(handle);
        mockDescriptorWrite(handle, async (buffer, offset, length, position) => {
          write();
          return realWrite(buffer, offset, length, position);
        });
        if (stage !== 'read-await') replace();
      });
      const unlink = vi.spyOn(native, 'unlinkSync');
      const failure = await copySourceFile(project, image, destination).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(Error);
      if (denied) {
        expect(failure).toBe(denied);
        expect(denied).toMatchObject({ code: 'EPERM', syscall: 'rename', path: imports, dest: retained });
        expect(replaced).toBe(false);
        expect(write).not.toHaveBeenCalled();
        expect(unlink).not.toHaveBeenCalled();
        expect(handles.every((handle) => handle.fd === -1)).toBe(true);
        expect(native.statSync(temp).size).toBe(0);
        expect(native.existsSync(finalPath())).toBe(false);
        skip(`OS denied injection; no guard coverage: ${denied.message}; errno=${denied.errno}`);
        return;
      }
      expect(replaced).toBe(true);
      expect(write).not.toHaveBeenCalled();
      expect(unlink).not.toHaveBeenCalled();
      expect(native.readFileSync(temp, 'utf8')).toBe('unknown temporary');
      expect(native.statSync(owned).size).toBe(0);
      expect(native.existsSync(finalPath())).toBe(false);
      expect(handles.every((handle) => handle.fd === -1)).toBe(true);
    });
  });

  it.each(['final', 'temp'] as const)('preserves a %s collision introduced by the last missing await without opening a writer', async (kind) => {
    const image = await scanned();
    const uuid = '11111111-1111-4111-8111-111111111111';
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(uuid);
    const target = kind === 'final' ? finalPath() : win32.join(imports, `${temporaryPrefix}${uuid}.tmp`);
    const lstat = fs.lstat.bind(fs);
    let finalStats = 0;
    let inserted = false;
    vi.spyOn(fs, 'lstat').mockImplementation(async (path, options) => {
      const inject = String(path) === finalPath() && ++finalStats === 2;
      try { return await lstat(path, options as never); }
      finally {
        if (inject) {
          native.writeFileSync(target, 'external collision', { flag: 'wx' });
          inserted = true;
        }
      }
    });
    const open = vi.spyOn(fs, 'open');
    const unlink = vi.spyOn(native, 'unlinkSync');
    await expect(copySourceFile(project, image, destination)).rejects.toThrow(/既存/);
    expect(inserted).toBe(true);
    expect(open.mock.calls.filter(([, flags]) => flags === 'wx+')).toHaveLength(0);
    expect(unlink).not.toHaveBeenCalled();
    expect(native.readdirSync(imports)).toEqual([win32.basename(target)]);
    expect(native.readFileSync(target, 'utf8')).toBe('external collision');
  });

  it('does not clean a matching owned inode reached through a replaced junction after open', async ({ skip }) => {
    const image = await scanned();
    const retained = `${imports}.retained`;
    let tempName = '';
    let replaced = false;
    let denied: NodeJS.ErrnoException | undefined;
    const write = vi.fn();
    interceptOpen((handle, path, flags) => {
      if (flags !== 'wx+') return;
      tempName = win32.basename(path);
      mockDescriptorWrite(handle, async () => { write(); throw new Error('must not write'); });
      try { native.renameSync(imports, retained); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EPERM') denied = error as NodeJS.ErrnoException;
        throw error;
      }
      native.symlinkSync(retained, imports, 'junction');
      native.writeFileSync(win32.join(retained, 'keep'), 'external file');
      replaced = true;
    });
    const unlink = vi.spyOn(native, 'unlinkSync');
    const failure = await copySourceFile(project, image, destination).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    if (denied) {
      expect(failure).toBe(denied);
      expect(denied).toMatchObject({ code: 'EPERM', syscall: 'rename', path: imports, dest: retained });
      expect(replaced).toBe(false);
      expect(write).not.toHaveBeenCalled();
      expect(unlink).not.toHaveBeenCalled();
      expect(handles.every((handle) => handle.fd === -1)).toBe(true);
      expect(native.statSync(win32.join(imports, tempName)).size).toBe(0);
      expect(native.existsSync(finalPath())).toBe(false);
      skip(`OS denied injection; no guard coverage: ${denied.message}; errno=${denied.errno}`);
      return;
    }
    expect(replaced).toBe(true);
    expect(tempName).not.toBe('');
    expect(write).not.toHaveBeenCalled();
    expect(unlink).not.toHaveBeenCalled();
    expect(native.readdirSync(retained).sort()).toEqual([tempName, 'keep'].sort());
    expect(native.statSync(win32.join(retained, tempName)).size).toBe(0);
    expect(native.readFileSync(win32.join(retained, 'keep'), 'utf8')).toBe('external file');
    expect(native.existsSync(finalPath())).toBe(false);
    expect(handles.every((handle) => handle.fd === -1)).toBe(true);
  });

  it('allows exactly one of two concurrent copies to publish the same destination', async () => {
    const image = await scanned();
    const outcomes = await Promise.allSettled([
      copySourceFile(project, image, destination), copySourceFile(project, image, destination),
    ]);
    expect(outcomes.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((entry) => entry.status === 'rejected')).toHaveLength(1);
    expect(native.readFileSync(finalPath())).toEqual(sourceBytes);
    expect((await fs.readdir(imports)).sort()).toEqual(['image-0.bin']);
  });

  it.each(['write', 'sync', 'verify-read', 'writer-close', 'verifier-close', 'reader-close'] as const)(
    'closes both handles and removes only its temporary file after %s failure', async (stage) => {
      const failure = Object.assign(new Error(`${stage} injected`), { code: 'EIO' });
      let temporaryHandles = 0;
      interceptOpen((handle, path) => {
        if (path === sourcePath && stage === 'reader-close') {
          const close = handle.close.bind(handle);
          vi.spyOn(handle, 'close').mockImplementationOnce(async () => { await close(); throw failure; });
        }
        if (!win32.basename(path).startsWith(temporaryPrefix)) return;
        temporaryHandles += 1;
        if (stage === 'write') {
          const write = handle.write.bind(handle);
          mockDescriptorWrite(handle, async (buffer, offset, length, position) => {
            await write(buffer, offset, Math.min(length, 7), position);
            throw failure;
          });
        }
        if (stage === 'sync') vi.spyOn(handle, 'sync').mockRejectedValueOnce(failure);
        if (stage === 'verify-read') vi.spyOn(handle, 'read').mockRejectedValueOnce(failure);
        if ((stage === 'writer-close' && temporaryHandles === 1)
          || (stage === 'verifier-close' && temporaryHandles === 2)) {
          const close = handle.close.bind(handle);
          vi.spyOn(handle, 'close').mockImplementationOnce(async () => { await close(); throw failure; });
        }
      });
      await expect(copySourceFile(project, await scanned(), destination)).rejects.toThrow(`${stage} injected`);
      expect(handles.every((handle) => handle.fd === -1)).toBe(true);
      await expectNoCopy();
      expect(native.readFileSync(sourcePath)).toEqual(sourceBytes);
    },
  );

  it.each(['writer', 'verifier', 'reader'] as const)(
    'retries exactly once when the %s close rejects before releasing its descriptor', async (kind) => {
      const failure = new Error(`${kind} pre-release close failed`);
      let temporaryHandles = 0;
      let injected: ReturnType<typeof vi.spyOn> | undefined;
      interceptOpen((handle, path) => {
        const target = path === sourcePath ? kind === 'reader'
          : win32.basename(path).startsWith(temporaryPrefix)
            && ++temporaryHandles === (kind === 'writer' ? 1 : kind === 'verifier' ? 2 : -1);
        if (!target) return;
        injected = vi.spyOn(handle, 'close').mockRejectedValueOnce(failure);
      });
      await expect(copySourceFile(project, await scanned(), destination)).rejects.toThrow(failure.message);
      expect(injected).toHaveBeenCalledTimes(2);
      expect(handles.every((handle) => handle.fd === -1)).toBe(true);
      await expectNoCopy();
    },
  );

  it.each(['source', 'temporary'] as const)(
    'rehashes real ctime-only %s changes before publication', async (kind) => {
      const image = await scanned();
      const expectedFinal = finalPath();
      let finalStats = 0;
      let changed = false;
      const read = vi.spyOn(native, 'readSync');
      let readsAtChange = 0;
      const lstat = fs.lstat.bind(fs);
      vi.spyOn(fs, 'lstat').mockImplementation(async (path, options) => {
        if (String(path) === expectedFinal && ++finalStats === 4) {
          const target = kind === 'source' ? sourcePath : win32.join(imports,
            native.readdirSync(imports).find((name) => name.startsWith(temporaryPrefix))!);
          const retained = `${target}.ctime-test`;
          const before = native.lstatSync(target, { bigint: true });
          native.renameSync(target, retained);
          native.renameSync(retained, target);
          const after = native.lstatSync(target, { bigint: true });
          expect(after.dev).toBe(before.dev);
          expect(after.ino).toBe(before.ino);
          expect(after.birthtimeNs).toBe(before.birthtimeNs);
          expect(after.size).toBe(before.size);
          expect(after.mtimeNs).toBe(before.mtimeNs);
          expect(after.nlink).toBe(before.nlink);
          expect(after.ctimeNs).not.toBe(before.ctimeNs);
          readsAtChange = read.mock.calls.length;
          changed = true;
        }
        return lstat(path, options as never);
      });
      const link = vi.spyOn(native, 'linkSync').mockImplementation((from, to) => {
        const streamReads = read.mock.calls.slice(readsAtChange)
          .filter((call) => Buffer.isBuffer(call[1]) && call[1].byteLength === 64 * 1024);
        expect(streamReads.length).toBeGreaterThan(0);
        expect(native.readFileSync(from)).toEqual(sourceBytes);
        realLink(from, to);
      });
      await expect(copySourceFile(project, image, destination)).resolves.toMatchObject({ sha256: image.sha256 });
      expect(changed).toBe(true);
      expect(link).toHaveBeenCalledOnce();
      expect(link.mock.calls[0]![1]).toBe(expectedFinal);
      expect(native.readFileSync(expectedFinal)).toEqual(sourceBytes);
      expect(native.readdirSync(imports)).toEqual(['image-0.bin']);
    },
  );

  (['source', 'temporary'] as const).forEach((kind) => {
    it.each(['read', 'short-eof', 'hash', 'close-before', 'close-after'] as const)(
      `rejects ${kind} ctime fallback %s failure without leaking a descriptor or publishing`, async (stage) => {
        const image = await scanned();
        const failure = new Error(`fallback ${stage}`);
        const lstat = fs.lstat.bind(fs);
        const open = native.openSync.bind(native);
        const read = native.readSync.bind(native);
        const close = native.closeSync.bind(native);
        const fstat = vi.spyOn(native, 'fstatSync');
        const owned = new Set<number>();
        let target = '';
        let finalStats = 0;
        let injected = false;
        let fallbackReads = 0;
        let fallbackCloses = 0;
        let statsAtClose = 0;
        interceptOpen(() => {});
        vi.spyOn(fs, 'lstat').mockImplementation(async (path, options) => {
          if (String(path) === finalPath() && ++finalStats === 4) {
            target = kind === 'source' ? sourcePath : win32.join(imports,
              native.readdirSync(imports).find((name) => name.startsWith(temporaryPrefix))!);
            const before = native.lstatSync(target, { bigint: true });
            native.renameSync(target, `${target}.ctime-test`);
            native.renameSync(`${target}.ctime-test`, target);
            const after = native.lstatSync(target, { bigint: true });
            expect(fileIdentity(after)).toEqual(fileIdentity(before));
            expect(after.size).toBe(before.size);
            expect(after.mtimeNs).toBe(before.mtimeNs);
            expect(after.nlink).toBe(before.nlink);
            expect(after.ctimeNs).not.toBe(before.ctimeNs);
          }
          return lstat(path, options as never);
        });
        vi.spyOn(native, 'openSync').mockImplementation((path, flags, mode) => {
          const fd = open(path, flags, mode);
          if (target && String(path) === target) {
            expect(flags).toBe(constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
            owned.add(fd);
          }
          return fd;
        });
        vi.spyOn(native, 'readSync').mockImplementation(((fd: number, buffer: Buffer,
          offset: number, length: number, position: number) => {
          if (!owned.has(fd)) return read(fd, buffer, offset, length, position);
          fallbackReads += 1;
          expect(length).toBeLessThanOrEqual(64 * 1024);
          if (!injected && stage === 'read') { injected = true; throw failure; }
          if (!injected && stage === 'short-eof') { injected = true; return 0; }
          const count = read(fd, buffer, offset, length, position);
          if (!injected && stage === 'hash' && count > 0) {
            buffer[offset] = buffer[offset]! ^ 0xff;
            injected = true;
          }
          return count;
        }) as typeof native.readSync);
        vi.spyOn(native, 'closeSync').mockImplementation((fd) => {
          if (!owned.has(fd)) return close(fd);
          fallbackCloses += 1;
          if (!injected && stage === 'close-before') {
            injected = true;
            statsAtClose = fstat.mock.calls.filter(([value]) => value === fd).length;
            throw failure;
          }
          if (stage === 'close-before') {
            expect(fstat.mock.calls.filter(([value]) => value === fd).length).toBe(statsAtClose + 1);
          }
          close(fd);
          owned.delete(fd);
          if (!injected && stage === 'close-after') { injected = true; throw failure; }
        });
        const link = vi.spyOn(native, 'linkSync');
        const outcome = copySourceFile(project, image, destination);
        if (stage === 'read' || stage === 'close-before' || stage === 'close-after') {
          await expect(outcome).rejects.toBe(failure);
        } else await expect(outcome).rejects.toThrow(/変更|一時コピー/);
        expect(injected).toBe(true);
        expect(fallbackReads).toBeGreaterThan(0);
        expect(fallbackCloses).toBe(stage === 'close-before' ? 2 : 1);
        expect(owned.size).toBe(0);
        expect(handles.every((handle) => handle.fd === -1)).toBe(true);
        expect(link).not.toHaveBeenCalled();
        await expectNoCopy();
      },
    );
  });

  it.each(['source', 'temporary'] as const)(
    'rejects a real same-inode %s overwrite hidden by the last async lstat snapshot', async (kind) => {
      const fixedSeconds = 1_700_000_000;
      native.utimesSync(sourcePath, fixedSeconds, fixedSeconds);
      const image = await scanned();
      let readerClosed = false;
      let changed = false;
      let temp = '';
      interceptOpen((handle, path, flags) => {
        if (path === sourcePath) {
          const close = handle.close.bind(handle);
          vi.spyOn(handle, 'close').mockImplementation(async () => { await close(); readerClosed = true; });
        }
        if (flags === 'wx+') {
          temp = path;
          const sync = handle.sync.bind(handle);
          vi.spyOn(handle, 'sync').mockImplementation(async () => {
            native.futimesSync(handle.fd, fixedSeconds, fixedSeconds);
            await sync();
          });
        }
      });
      const lstat = fs.lstat.bind(fs);
      vi.spyOn(fs, 'lstat').mockImplementation(async (path, options) => {
        const old = await lstat(path, options as never);
        const target = kind === 'source' ? sourcePath : temp;
        if (readerClosed && !changed && String(path) === target) {
          const before = native.lstatSync(target, { bigint: true });
          native.writeFileSync(target, Buffer.alloc(sourceBytes.length, 0x42));
          native.utimesSync(target, fixedSeconds, fixedSeconds);
          const after = native.lstatSync(target, { bigint: true });
          expect(fileIdentity(after)).toEqual(fileIdentity(before));
          expect(after.size).toBe(before.size);
          expect(after.mtimeNs).toBe(before.mtimeNs);
          expect(after.ctimeNs).not.toBe(before.ctimeNs);
          expect(digest(native.readFileSync(target))).not.toBe(image.sha256);
          changed = true;
        }
        return old;
      });
      const link = vi.spyOn(native, 'linkSync');
      await expect(copySourceFile(project, image, destination)).rejects.toThrow(/変更|一時コピー/);
      expect(changed).toBe(true);
      expect(link).not.toHaveBeenCalled();
      expect(handles.every((handle) => handle.fd === -1)).toBe(true);
      await expectNoCopy();
    },
  );

  it('rejects independently re-read temporary corruption before publication', async () => {
    let corrupted = false;
    interceptOpen((handle, path) => {
      if (!win32.basename(path).startsWith(temporaryPrefix)) return;
      const sync = handle.sync.bind(handle);
      vi.spyOn(handle, 'sync').mockImplementationOnce(async () => {
        await sync();
        native.writeFileSync(path, Buffer.alloc(sourceBytes.length, 0x42));
        corrupted = true;
      });
    });
    const link = vi.spyOn(native, 'linkSync');
    await expect(copySourceFile(project, await scanned(), destination)).rejects.toThrow(/一時コピー/);
    expect(corrupted).toBe(true);
    expect(link).not.toHaveBeenCalled();
    await expectNoCopy();
  });

  it.each(['link-failure', 'link-ack-loss'] as const)('removes only its exact temp/final pair after %s', async (kind) => {
    const failure = new Error(kind);
    vi.spyOn(native, 'linkSync').mockImplementationOnce((from, to) => {
      if (kind === 'link-ack-loss') realLink(from, to);
      throw failure;
    });
    await expect(copySourceFile(project, await scanned(), destination)).rejects.toThrow(kind);
    await expectNoCopy();
    expect(native.readFileSync(sourcePath)).toEqual(sourceBytes);
  });

  it.each(['unlink-failure', 'unlink-ack-loss'] as const)('rolls back an unpublished final after %s', async (kind) => {
    const failure = new Error(kind);
    vi.spyOn(native, 'unlinkSync').mockImplementationOnce((path) => {
      if (kind === 'unlink-ack-loss') realUnlink(path);
      throw failure;
    });
    await expect(copySourceFile(project, await scanned(), destination)).rejects.toThrow(kind);
    await expectNoCopy();
  });

  it('does not overwrite a destination created at the final synchronous publish boundary', async () => {
    vi.spyOn(native, 'linkSync').mockImplementationOnce((from, to) => {
      native.writeFileSync(to, 'racing owner', { flag: 'wx' });
      realLink(from, to);
    });
    await expect(copySourceFile(project, await scanned(), destination)).rejects.toMatchObject({ code: 'EEXIST' });
    expect(native.readFileSync(finalPath(), 'utf8')).toBe('racing owner');
    expect((await fs.readdir(imports)).filter((name) => name.startsWith(temporaryPrefix))).toEqual([]);
  });

  it('retains an unknown temporary replacement and reports cleanup failure', async () => {
    const closeFailure = new Error('close after replacement');
    let temp = '';
    let retained = '';
    interceptOpen((handle, path) => {
      if (!win32.basename(path).startsWith(temporaryPrefix)) return;
      temp = path;
      retained = `${path}.retained`;
      const close = handle.close.bind(handle);
      vi.spyOn(handle, 'close').mockImplementationOnce(async () => {
        await close();
        native.renameSync(path, retained);
        native.writeFileSync(path, 'external replacement', { flag: 'wx' });
        throw closeFailure;
      });
    });
    await expect(copySourceFile(project, await scanned(), destination)).rejects.toMatchObject({
      errors: expect.arrayContaining([closeFailure]),
    });
    expect(native.readFileSync(temp, 'utf8')).toBe('external replacement');
    expect(digest(native.readFileSync(retained))).toBe(digest(sourceBytes));
    await expect(fs.lstat(finalPath())).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('retains an unknown final replacement installed after temp unlink', async () => {
    const unlink = vi.spyOn(native, 'unlinkSync').mockImplementationOnce((path) => {
      realUnlink(path);
      const final = finalPath();
      native.renameSync(final, `${final}.owned`);
      native.writeFileSync(final, 'external final replacement', { flag: 'wx' });
    });
    await expect(copySourceFile(project, await scanned(), destination)).rejects.toMatchObject({
      errors: expect.any(Array),
    });
    expect(unlink).toHaveBeenCalled();
    expect(native.readFileSync(finalPath(), 'utf8')).toBe('external final replacement');
    expect(digest(native.readFileSync(`${finalPath()}.owned`))).toBe(digest(sourceBytes));
    expect((await fs.readdir(imports)).filter((name) => name.startsWith(temporaryPrefix))).toEqual([]);
  });

  it('reports cleanup failure with the original write error and leaves only its owned temp', async () => {
    const writeFailure = new Error('write failed');
    const cleanupFailure = new Error('cleanup failed');
    let temp = '';
    interceptOpen((handle, path) => {
      if (!win32.basename(path).startsWith(temporaryPrefix)) return;
      temp = path;
      vi.spyOn(handle, 'write').mockRejectedValueOnce(writeFailure);
    });
    vi.spyOn(native, 'unlinkSync').mockImplementationOnce(() => { throw cleanupFailure; });
    await expect(copySourceFile(project, await scanned(), destination)).rejects.toMatchObject({
      errors: expect.arrayContaining([cleanupFailure]),
    });
    expect(native.existsSync(temp)).toBe(true);
    await expect(fs.lstat(finalPath())).rejects.toMatchObject({ code: 'ENOENT' });
    expect(native.readFileSync(sourcePath)).toEqual(sourceBytes);
  });
});
