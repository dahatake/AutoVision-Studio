// @vitest-environment node
import { createHash } from 'node:crypto';
import native, { constants } from 'node:fs';
import fs, { type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { win32 } from 'node:path';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import { MAX_IMAGE_BYTES } from '../../shared/contracts/import.js';
import type { ReferenceImportSource } from './import-source-manifest.js';
import { captureReferenceSource, readVerifiedReferenceImage } from './reference-access.js';

const realOpen = fs.open.bind(fs);
type Read = (buffer: Buffer, offset: number, length: number, position: number) =>
  Promise<{ bytesRead: number; buffer: Buffer }>;
let directory = '';
let path = '';
let original: Buffer;
let saved: ReferenceImportSource;
const handles: FileHandle[] = [];

function intercept(configure: (handle: FileHandle, ordinal: number) => void) {
  let ordinal = 0;
  return vi.spyOn(fs, 'open').mockImplementation(async (file, flags, mode) => {
    expect(String(file)).toMatch(/^\\\\\?\\Volume\{/u);
    expect(Number(flags) & (constants.O_WRONLY | constants.O_RDWR | constants.O_CREAT
      | constants.O_TRUNC | constants.O_APPEND)).toBe(0);
    const handle = await realOpen(file, flags, mode);
    handles.push(handle);
    configure(handle, ++ordinal);
    return handle;
  });
}

describe.skipIf(process.platform !== 'win32')('DAT14B verified Reference image bytes', () => {
  beforeEach(async () => {
    directory = await fs.realpath(await fs.mkdtemp(win32.join(tmpdir(), 'av-dat14b-')));
    path = win32.join(directory, 'image.bin');
    original = Buffer.alloc(131_119, 0x5a); // No MIME/decode policy in this leaf.
    await fs.writeFile(path, original, { flag: 'wx' });
    const stat = await fs.lstat(path, { bigint: true });
    // Real native mountvol probes: never manufacture a GUID from stat.dev.
    saved = structuredClone(await captureReferenceSource({ key: 'image:0', sourcePath: path,
      byteSize: original.length, mtimeNs: String(stat.mtimeNs),
      sha256: createHash('sha256').update(original).digest('hex') }));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const handle of handles.splice(0)) if (handle.fd !== -1) await handle.close();
    if (directory) await fs.rm(directory, { recursive: true, force: true });
  });

  it('returns the exact single read allocation, bounded chunks, no writes or URL', async () => {
    expectTypeOf(readVerifiedReferenceImage).returns.toEqualTypeOf<Promise<Buffer>>();
    const buffers = new Set<Buffer>();
    intercept((handle, ordinal) => {
      if (ordinal !== 2) return;
      const read = handle.read.bind(handle);
      vi.spyOn(handle, 'read').mockImplementation((async (buffer, offset, length, position) => {
        expect(length).toBeLessThanOrEqual(65_536);
        if (position < original.length) buffers.add(buffer);
        return read(buffer, offset, length, position);
      }) as Read as FileHandle['read']);
    });
    const writes = [vi.spyOn(fs, 'writeFile'), vi.spyOn(fs, 'rename'), vi.spyOn(fs, 'unlink')];
    const result = await readVerifiedReferenceImage(saved);
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result).toEqual(original);
    expect(buffers.size).toBe(1);
    expect(buffers.has(result)).toBe(true);
    expect(handles.every((handle) => handle.fd === -1)).toBe(true);
    for (const write of writes) expect(write).not.toHaveBeenCalled();
    expect(native.readFileSync(path)).toEqual(original);
  });

  it.each(['size', 'mtime', 'hash', 'identity', 'missing', 'hardlink'] as const)(
    'rejects saved %s mismatch rather than accepting a fresh capture', async (kind) => {
      if (kind === 'size') saved.byteSize += 1;
      if (kind === 'mtime') saved.mtimeNs = String(BigInt(saved.mtimeNs) + 1n);
      if (kind === 'hash') saved.sha256 = 'f'.repeat(64);
      if (kind === 'identity') saved.identity.ino = String(BigInt(saved.identity.ino) + 1n);
      if (kind === 'missing') await fs.unlink(path);
      if (kind === 'hardlink') await fs.link(path, `${path}.link`);
      await expect(readVerifiedReferenceImage(saved)).rejects.toThrow(/relink/);
    },
  );

  it.each(['UNC', 'oversize', 'accessor', 'signal'] as const)('rejects invalid %s before I/O', async (kind) => {
    const getter = vi.fn(() => path);
    if (kind === 'UNC') saved.sourcePath = '\\\\server\\share\\image.bin';
    if (kind === 'oversize') saved.byteSize = MAX_IMAGE_BYTES + 1;
    if (kind === 'accessor') Object.defineProperty(saved, 'sourcePath', { get: getter });
    const open = vi.spyOn(fs, 'open');
    const stat = vi.spyOn(fs, 'lstat');
    await expect(readVerifiedReferenceImage(saved, kind === 'signal' ? {} as AbortSignal : undefined))
      .rejects.toThrow(TypeError);
    expect(open).not.toHaveBeenCalled();
    expect(stat).not.toHaveBeenCalled();
    expect(getter).not.toHaveBeenCalled();
  });

  it('snapshots caller fields before await and does not cache returned bytes', async () => {
    const pending = readVerifiedReferenceImage(saved);
    saved.sourcePath = 'C:\\not-the-original.bin';
    saved.identity.ino = '999';
    saved.sha256 = '0'.repeat(64);
    expect(await pending).toEqual(original);
    await expect(readVerifiedReferenceImage(saved)).rejects.toThrow(/relink/);
  });

  it('rejects same-byte replacement between verification and reader open', async () => {
    let opens = 0;
    vi.spyOn(fs, 'open').mockImplementation(async (file, flags, mode) => {
      if (++opens === 2) {
        await fs.rename(path, `${path}.retained`);
        await fs.writeFile(path, original, { flag: 'wx' });
      }
      const handle = await realOpen(file, flags, mode);
      handles.push(handle);
      return handle;
    });
    await expect(readVerifiedReferenceImage(saved)).rejects.toThrow(/relink/);
    expect(opens).toBe(2);
    expect(handles.every((handle) => handle.fd === -1)).toBe(true);
  });

  it.each(['before', 'verify-read', 'reader-open', 'reader-read'] as const)(
    'aborts at %s and releases every opened descriptor', async (point) => {
      const controller = new AbortController();
      if (point === 'before') controller.abort();
      const open = intercept((handle, ordinal) => {
        if (point === 'reader-open' && ordinal === 2) controller.abort();
        const read = handle.read.bind(handle);
        vi.spyOn(handle, 'read').mockImplementation((async (buffer, offset, length, position) => {
          const result = await read(buffer, offset, length, position);
          if ((point === 'verify-read' && ordinal === 1) || (point === 'reader-read' && ordinal === 2)) controller.abort();
          return result;
        }) as Read as FileHandle['read']);
      });
      await expect(readVerifiedReferenceImage(saved, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
      if (point === 'before') expect(open).not.toHaveBeenCalled();
      expect(handles.every((handle) => handle.fd === -1)).toBe(true);
    },
  );

  it.each(['corrupt-buffer', 'short-eof', 'extra-eof', 'partial-read-close', 'late-close'] as const)(
    'rejects %s without returning unchecked bytes', async (fault) => {
      let closeCalls = 0;
      intercept((handle, ordinal) => {
        if (ordinal !== 2) return;
        const read = handle.read.bind(handle);
        const close = handle.close.bind(handle);
        vi.spyOn(handle, 'read').mockImplementation((async (buffer, offset, length, position) => {
          if (fault === 'partial-read-close' && position > 0) throw new Error('private read path');
          if (fault === 'short-eof') return { bytesRead: 0, buffer };
          if (fault === 'extra-eof' && position === original.length) return { bytesRead: 1, buffer };
          const result = await read(buffer, offset, length, position);
          if (fault === 'corrupt-buffer' && result.bytesRead > 0) buffer[offset] = 0;
          return result;
        }) as Read as FileHandle['read']);
        vi.spyOn(handle, 'close').mockImplementation(async () => {
          closeCalls += 1;
          if (fault === 'partial-read-close' && closeCalls === 1) throw new Error('private close path');
          await close();
          if (fault === 'late-close') native.appendFileSync(path, Buffer.from([1]));
        });
      });
      await expect(readVerifiedReferenceImage(saved)).rejects.toThrow(/relink/);
      expect(closeCalls).toBe(fault === 'partial-read-close' ? 2 : 1);
      expect(handles.every((handle) => handle.fd === -1)).toBe(true);
    },
  );
});