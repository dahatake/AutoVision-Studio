// @vitest-environment node
import { createHash } from 'node:crypto';
import native, { constants, type BigIntStats } from 'node:fs';
import fs, { type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { win32 } from 'node:path';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import { decodeScanResult, MAX_SCAN_RESULT_BYTES, type ScanContext, type ScanResult } from '../../shared/contracts/import.js';
import { assertScanArtifactCurrent, readScanArtifact, type ScanArtifact } from './scan-artifact.js';

const context: ScanContext = {
  projectId: '01234567-89ab-4cde-8f01-23456789abcd',
  jobId: 'ae45cf74-c9f9-4c49-88b9-0523b1ac7383', taskType: 'classification', mode: 'copy',
};
const realOpen = fs.open.bind(fs);
const handles: FileHandle[] = [];
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
let temporary = '';
let directory = '';
let manifest = '';
let source = '';
let bytes: Buffer;
let result: ScanResult;

type Read = (buffer: Buffer, offset: number, length: number, position: number) =>
  Promise<{ bytesRead: number; buffer: Buffer }>;
function intercept(configure: (handle: FileHandle) => void) {
  return vi.spyOn(fs, 'open').mockImplementation(async (path, flags, mode) => {
    const handle = await realOpen(path, flags, mode);
    handles.push(handle);
    configure(handle);
    return handle;
  });
}
function mockRead(handle: FileHandle, read: Read) {
  return vi.spyOn(handle, 'read').mockImplementation(read as FileHandle['read']);
}
function frozen(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) frozen(child);
}
function replace(): void {
  native.renameSync(manifest, `${manifest}.retained`);
  native.writeFileSync(manifest, bytes, { flag: 'wx' });
}
const read = (expected = context, path = manifest, job = directory) => readScanArtifact(job, path, expected);

describe.skipIf(process.platform !== 'win32')('DAT-08 read-only scan artifact', () => {
  beforeEach(async () => {
    temporary = await fs.realpath(await fs.mkdtemp(win32.join(tmpdir(), 'autovision-dat08-')));
    directory = win32.join(temporary, context.jobId);
    manifest = win32.join(directory, 'scan-result.json');
    source = win32.join(temporary, 'source.bin');
    await fs.mkdir(directory);
    await fs.writeFile(source, 'not an image; must never be decoded');
    result = { formatVersion: 1, ...context, classes: [], issues: [], images: [{
      key: 'image:0', sourcePath: source, byteSize: 1, mtimeNs: '0', sha256: 'a'.repeat(64),
      format: 'png', width: 1, height: 1, orientation: 1, duplicateOf: null, annotation: null,
    }] };
    bytes = Buffer.from(` \n${JSON.stringify(result, null, 2)}\n\t`);
    await fs.writeFile(manifest, bytes, { flag: 'wx' });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    for (const handle of handles.splice(0)) if (handle.fd !== -1) await handle.close();
    if (temporary) await fs.rm(temporary, { recursive: true, force: true });
  });

  it('issues frozen real-file evidence with the raw whitespace-sensitive hash, without source I/O or writes', async () => {
    expectTypeOf(readScanArtifact).parameters.toEqualTypeOf<[string, string, ScanContext]>();
    expectTypeOf(readScanArtifact).returns.toEqualTypeOf<Promise<ScanArtifact>>();
    const before = native.lstatSync(manifest, { bigint: true });
    const sourceBefore = native.lstatSync(source, { bigint: true });
    const open = intercept(() => {});
    const lstat = vi.spyOn(fs, 'lstat');
    const syncLstat = vi.spyOn(native, 'lstatSync');
    const readFile = vi.spyOn(fs, 'readFile');
    const writes = [vi.spyOn(fs, 'writeFile'), vi.spyOn(fs, 'unlink'), vi.spyOn(fs, 'rename'),
      vi.spyOn(native, 'writeFileSync'), vi.spyOn(native, 'unlinkSync'), vi.spyOn(native, 'renameSync')];
    const artifact = await read();
    expect(artifact).toEqual({ result: decodeScanResult(bytes, context), sha256: digest(bytes),
      byteSize: bytes.length, manifestPath: manifest, identity: {
        dev: String(before.dev), ino: String(before.ino), birthtimeNs: String(before.birthtimeNs),
      } });
    frozen(artifact);
    expect(Reflect.set(artifact.result.images[0]!, 'sourcePath', 'C:\\forged.png')).toBe(false);
    expect('rawBytes' in artifact).toBe(false);
    expect(() => assertScanArtifactCurrent(artifact)).not.toThrow();
    expect(open).toHaveBeenCalledExactlyOnceWith(manifest,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    expect(Number(open.mock.calls[0]![1]) & (constants.O_WRONLY | constants.O_RDWR | constants.O_CREAT
      | constants.O_TRUNC | constants.O_APPEND)).toBe(0);
    for (const spy of [lstat, syncLstat]) expect(spy.mock.calls.some(([path]) => path === source)).toBe(false);
    expect(readFile).not.toHaveBeenCalled();
    for (const spy of writes) expect(spy).not.toHaveBeenCalled();
    expect(handles.every((handle) => handle.fd === -1)).toBe(true);
    expect(native.readFileSync(manifest)).toEqual(bytes);
    expect(native.readFileSync(source, 'utf8')).toBe('not an image; must never be decoded');
    expect(native.lstatSync(source, { bigint: true }).mtimeNs).toBe(sourceBefore.mtimeNs);
    expect(native.lstatSync(manifest, { bigint: true }).mtimeNs).toBe(before.mtimeNs);
  });

  it('keeps an expected snapshot before await, without freezing or trusting later caller changes', async () => {
    const expected = { ...context };
    const pending = read(expected);
    expected.projectId = context.jobId;
    expected.jobId = context.projectId;
    expected.taskType = 'detection';
    expected.mode = 'reference';
    expect((await pending).result).toEqual(result);
    expect(Object.isFrozen(expected)).toBe(false);
  });

  it.each(['projectId', 'jobId', 'taskType', 'mode'] as const)('rejects invalid %s before filesystem access', async (key) => {
    const lstat = vi.spyOn(fs, 'lstat');
    const syncLstat = vi.spyOn(native, 'lstatSync');
    const open = vi.spyOn(fs, 'open');
    await expect(read({ ...context, [key]: 'invalid' })).rejects.toThrow();
    expect(lstat).not.toHaveBeenCalled();
    expect(syncLstat).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });
  it('rejects context getters without invoking them', async () => {
    const expected = { ...context };
    const getter = vi.fn(() => context.jobId);
    Object.defineProperty(expected, 'jobId', { get: getter, enumerable: true });
    const open = vi.spyOn(fs, 'open');
    await expect(read(expected)).rejects.toThrow();
    expect(getter).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it.each(['traversal', 'sibling', 'request', 'request-case', 'slash', 'ads', 'relative', 'unc', 'device', 'dot', 'job'])(
    'rejects %s lexical paths before filesystem access', async (kind) => {
      const paths: Record<string, string> = {
        traversal: `${directory}\\nested\\..\\scan-result.json`, sibling: `${directory}-sibling\\scan-result.json`,
        request: `${directory}\\request.json`, 'request-case': `${directory}\\REQUEST.JSON`,
        slash: manifest.replaceAll('\\', '/'), ads: `${manifest}:stream`, relative: 'C:scan-result.json',
        unc: '\\\\server\\share\\scan-result.json', device: `\\\\?\\${manifest}`, dot: `${manifest}.`, job: manifest,
      };
      const lstat = vi.spyOn(fs, 'lstat');
      await expect(read(context, paths[kind]!, kind === 'job' ? temporary : directory)).rejects.toThrow();
      expect(lstat).not.toHaveBeenCalled();
    },
  );

  it('accepts an exact nested descendant, not a prefix alias', async () => {
    const parent = win32.join(directory, 'output');
    await fs.mkdir(parent);
    const nested = win32.join(parent, 'result.json');
    await fs.writeFile(nested, bytes);
    const artifact = await read(context, nested);
    expect(artifact.result).toEqual(result);
    expect(() => assertScanArtifactCurrent(artifact)).not.toThrow();
  });
  it('rejects case-alias names and hardlinks before opening', async () => {
    const open = vi.spyOn(fs, 'open');
    await expect(read(context, manifest.replace('scan-result', 'SCAN-RESULT'))).rejects.toThrow();
    await fs.link(manifest, win32.join(directory, 'alias.json'));
    await expect(read()).rejects.toThrow();
    expect(open).not.toHaveBeenCalled();
  });
  it('rejects an ancestor junction and a directory artifact without following or reading them', async () => {
    const junction = win32.join(temporary, 'junction');
    await fs.symlink(directory, junction, 'junction');
    const viaLink = win32.join(directory, 'output');
    await fs.symlink(temporary, viaLink, 'junction');
    const open = vi.spyOn(fs, 'open');
    await expect(read(context, win32.join(viaLink, 'junction', 'scan-result.json'))).rejects.toThrow();
    await expect(read(context, viaLink)).rejects.toThrow();
    expect(open).not.toHaveBeenCalled();
  });

  it.each([0, MAX_SCAN_RESULT_BYTES + 1])('prechecks size %i before open/allocation', async (size) => {
    await fs.truncate(manifest, size);
    const open = vi.spyOn(fs, 'open');
    const allocation = vi.spyOn(Buffer, 'alloc');
    await expect(read()).rejects.toThrow();
    expect(open).not.toHaveBeenCalled();
    expect(allocation).not.toHaveBeenCalled();
  });
  it('reads large real bytes in bounded chunks, tolerating genuine short reads', async () => {
    bytes = Buffer.from(`${JSON.stringify(result)}${' '.repeat(150_000)}`);
    await fs.writeFile(manifest, bytes);
    const lengths: number[] = [];
    intercept((handle) => {
      const realRead = handle.read.bind(handle);
      mockRead(handle, (buffer, offset, length, position) => {
        lengths.push(length);
        expect(buffer.length).toBe(bytes.length);
        return realRead(buffer, offset, Math.min(length, 7_919), position);
      });
    });
    expect((await read()).sha256).toBe(digest(bytes));
    expect(lengths.length).toBeGreaterThan(10);
    expect(Math.max(...lengths)).toBeLessThanOrEqual(65_536);
    expect(MAX_SCAN_RESULT_BYTES).toBe(268_435_456);
  });

  it.each(['duplicate', 'nested-duplicate', 'utf8', 'deep', 'context', 'unknown'])(
    'uses the real strict shared decoder to reject %s', async (kind) => {
      const wire = JSON.stringify(result);
      const bad: Record<string, Buffer> = {
        duplicate: Buffer.from(wire.replace('"formatVersion":1', '"formatVersion":1,"formatVersion":1')),
        'nested-duplicate': Buffer.from(wire.replace('"key":"image:0"', '"key":"image:0","k\\u0065y":"image:0"')),
        utf8: Buffer.concat([Buffer.from([0xff]), bytes]),
        deep: Buffer.from('['.repeat(128) + '0' + ']'.repeat(128)),
        context: Buffer.from(JSON.stringify({ ...result, projectId: context.jobId })),
        unknown: Buffer.from(JSON.stringify({ ...result, unknown: true })),
      };
      await fs.writeFile(manifest, bad[kind]!);
      intercept(() => {});
      await expect(read()).rejects.toThrow();
      expect(handles.every((handle) => handle.fd === -1)).toBe(true);
      expect(native.readFileSync(manifest)).toEqual(bad[kind]);
    },
  );
  it('does not access even a syntactically accepted nonexistent source locator', async () => {
    result.images[0]!.sourcePath = 'Z:\\not-selected\\missing.png';
    await fs.writeFile(manifest, JSON.stringify(result));
    const open = intercept(() => {});
    const artifact = await read();
    expect(artifact.result.images[0]!.sourcePath).toBe('Z:\\not-selected\\missing.png');
    expect(open.mock.calls.map(([path]) => path)).toEqual([manifest]);
  });

  it.each(['eof', 'io', 'invalid-count', 'grow'] as const)('rejects %s with real handle cleanup', async (kind) => {
    intercept((handle) => {
      const realRead = handle.read.bind(handle);
      mockRead(handle, async (buffer, offset, length, position) => {
        if (kind === 'io') throw new Error('injected I/O failure');
        if (kind === 'eof') return { buffer, bytesRead: 0 };
        if (kind === 'invalid-count') return { buffer, bytesRead: length + 1 };
        const answer = await realRead(buffer, offset, length, position);
        if (position === 0) native.appendFileSync(manifest, ' ');
        return answer;
      });
    });
    await expect(read()).rejects.toThrow();
    expect(handles.every((handle) => handle.fd === -1)).toBe(true);
    expect(native.readFileSync(source, 'utf8')).toBe('not an image; must never be decoded');
  });
  it.each([false, true])('retries pre-release close only once, preserving failure (also I/O failure: %s)', async (ioFailure) => {
    let closes = 0;
    intercept((handle) => {
      const realClose = handle.close.bind(handle);
      vi.spyOn(handle, 'close').mockImplementation(async () => {
        if (++closes === 1) throw new Error('before release');
        return realClose();
      });
      if (ioFailure) mockRead(handle, async () => { throw new Error('read failed'); });
    });
    await expect(read()).rejects.toThrow();
    expect(closes).toBe(2);
    expect(handles.every((handle) => handle.fd === -1)).toBe(true);
    expect(native.readFileSync(manifest)).toEqual(bytes);
  });

  it.each(['close', 'final-await'] as const)('catches a same-byte replacement at %s', async (point) => {
    let replaced = false;
    if (point === 'close') intercept((handle) => {
      const close = handle.close.bind(handle);
      vi.spyOn(handle, 'close').mockImplementation(async () => {
        await close(); replace(); replaced = true;
      });
    });
    else {
      const realpath = fs.realpath.bind(fs);
      vi.spyOn(fs, 'realpath').mockImplementation((async (path: native.PathLike) => {
        const resolved = await realpath(path);
        if (path === manifest) { replace(); replaced = true; }
        return resolved;
      }) as typeof fs.realpath);
    }
    await expect(read()).rejects.toThrow();
    expect(replaced).toBe(true);
    expect(native.readFileSync(`${manifest}.retained`)).toEqual(bytes);
  });

  it.each(['close', 'final-stat'] as const)(
    'never issues read-then-assert proof for same-inode changed bytes with restored mtime at %s', async (point) => {
      // Integer seconds survive utimesSync exactly; no timestamp rounding mock.
      const time = 1_700_000_000;
      native.utimesSync(manifest, time, time);
      const before = native.lstatSync(manifest, { bigint: true });
      const modified = Buffer.from(bytes);
      modified[0] = 0x09; // Different raw hash, same length and still valid JSON.
      let readerClosed = false;
      let overwritten = false;
      let beforeClose: BigIntStats | undefined;
      const overwrite = () => {
        expect(readerClosed).toBe(true);
        native.writeFileSync(manifest, modified);
        native.utimesSync(manifest, time, time);
        overwritten = true;
      };
      intercept((handle) => {
        const close = handle.close.bind(handle);
        vi.spyOn(handle, 'close').mockImplementation(async () => {
          beforeClose = native.lstatSync(manifest, { bigint: true });
          await close();
          readerClosed = true;
          if (point === 'close') overwrite();
        });
      });
      if (point === 'final-stat') {
        const lstat = fs.lstat.bind(fs);
        let pathReads = 0;
        vi.spyOn(fs, 'lstat').mockImplementation((async (path: native.PathLike) => {
          const stat = await lstat(path, { bigint: true });
          // Return the old final async snapshot AFTER the overwrite. Only the
          // pinned pre-close sync baseline can reject this before issuance.
          if (path === manifest && ++pathReads === 4) overwrite();
          return stat;
        }) as typeof fs.lstat);
      }
      const assertIssued = vi.fn((artifact: ScanArtifact) => assertScanArtifactCurrent(artifact));
      await expect(read().then(assertIssued)).rejects.toThrow('Scan artifact could not be safely read.');
      expect(overwritten).toBe(true);
      expect(assertIssued).not.toHaveBeenCalled();
      expect(handles.every((handle) => handle.fd === -1)).toBe(true);
      const after = native.lstatSync(manifest, { bigint: true });
      for (const key of ['dev', 'ino', 'birthtimeNs', 'size', 'mtimeNs', 'nlink'] as const) {
        expect(after[key]).toBe(before[key]);
      }
      expect(beforeClose).toBeDefined();
      expect(after.ctimeNs).not.toBe(beforeClose!.ctimeNs);
      expect(native.readFileSync(manifest)).toEqual(modified);
      expect(digest(modified)).not.toBe(digest(bytes));
      expect(native.readFileSync(source, 'utf8')).toBe('not an image; must never be decoded');
    },
  );

  it.each(['stable', 'api-difference', 'path-change', 'handle-change'] as const)(
    'compares ctime within each API only: %s', async (kind) => {
      const realLstat = fs.lstat.bind(fs);
      let pathReads = 0;
      vi.spyOn(fs, 'lstat').mockImplementation((async (path: native.PathLike) => {
        const stat = await realLstat(path, { bigint: true });
        if (path === manifest) {
          pathReads += 1;
          if (kind === 'api-difference' || (kind === 'path-change' && pathReads >= 3)) stat.ctimeNs += 7n;
        }
        return stat;
      }) as typeof fs.lstat);
      intercept((handle) => {
        const stat = handle.stat.bind(handle);
        let count = 0;
        vi.spyOn(handle, 'stat').mockImplementation((async () => {
          const value: BigIntStats = await stat({ bigint: true });
          if (kind === 'handle-change' && ++count > 1) value.ctimeNs += 11n;
          return value;
        }) as FileHandle['stat']);
      });
      if (kind === 'stable' || kind === 'api-difference') expect((await read()).result).toEqual(result);
      else await expect(read()).rejects.toThrow();
    },
  );

  it('rejects forged/cloned capabilities without I/O, and rejects a stale genuine capability', async () => {
    const artifact = await read();
    const lstat = vi.spyOn(native, 'lstatSync');
    for (const fake of [{ ...artifact }, structuredClone(artifact), JSON.parse(JSON.stringify(artifact)) as ScanArtifact]) {
      expect(() => assertScanArtifactCurrent(fake)).toThrow(TypeError);
    }
    expect(lstat).not.toHaveBeenCalled();
    replace();
    expect(() => assertScanArtifactCurrent(artifact)).toThrow();
    expect(native.readFileSync(`${manifest}.retained`)).toEqual(bytes);
  });
  it('rechecks all ancestor identities when the complete job directory is replaced', async () => {
    const artifact = await read();
    native.renameSync(directory, `${directory}.retained`);
    native.mkdirSync(directory);
    native.writeFileSync(manifest, bytes);
    expect(() => assertScanArtifactCurrent(artifact)).toThrow();
  });
});