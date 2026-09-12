// @vitest-environment node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { writeFileAtomically } from './atomic-write.js';

let directory: string;
let destination: string;
const original = Buffer.from('old committed bytes');
const realOpen = fs.open.bind(fs);
const realReadFile = fs.readFile.bind(fs);
const realUnlink = fs.unlink.bind(fs);
const realHash = crypto.createHash.bind(crypto);
const handles: FileHandle[] = [];

beforeEach(async () => {
  directory = await fs.mkdtemp(join(tmpdir(), 'autovision-rel01-'));
  destination = join(directory, '設定.txt');
  await fs.writeFile(destination, original);
  await fs.writeFile(join(directory, 'untouched.tmp'), 'sibling');
});

afterEach(async () => {
  vi.restoreAllMocks();
  // Release real handles even if an assertion or an injected close fails.
  try {
    for (const handle of handles.splice(0)) {
      if (handle.fd !== -1) await handle.close();
    }
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

function interceptHandle(configure: (handle: FileHandle) => void) {
  return vi.spyOn(fs, 'open').mockImplementationOnce(async (path, flags, mode) => {
    const handle = await realOpen(path, flags, mode);
    handles.push(handle);
    configure(handle);
    return handle;
  });
}

async function expectPreserved() {
  expect(await realReadFile(destination)).toEqual(original);
  expect(await realReadFile(join(directory, 'untouched.tmp'), 'utf8')).toBe('sibling');
  expect((await fs.readdir(directory)).sort()).toEqual(['untouched.tmp', '設定.txt'].sort());
}

describe('writeFileAtomically', () => {
  it.each([
    { name: 'Unicode', content: '教師データ · 🌾\n', bytes: Buffer.from('教師データ · 🌾\n') },
    { name: 'empty text', content: '', bytes: Buffer.alloc(0) },
    { name: 'binary subarray', content: new Uint8Array([9, 0, 255, 128, 9]).subarray(1, 4), bytes: Buffer.from([0, 255, 128]) },
    { name: 'empty binary', content: new Uint8Array(), bytes: Buffer.alloc(0) },
  ])('replaces an existing file with $name and returns actual hash/length', async ({ content, bytes }) => {
    const result = await writeFileAtomically(destination, content);
    const actual = await fs.readFile(destination);
    expect(actual).toEqual(bytes);
    expect(result).toEqual({
      sha256: realHash('sha256').update(actual).digest('hex'),
      byteLength: actual.byteLength,
    });
    expect(await fs.readFile(join(directory, 'untouched.tmp'), 'utf8')).toBe('sibling');
    expect((await fs.readdir(directory)).sort()).toEqual(['untouched.tmp', '設定.txt'].sort());
  });

  it('creates a new destination and returns the known SHA-256 for abc', async () => {
    const path = join(directory, 'manifest.json');
    expect(await writeFileAtomically(path, 'abc')).toEqual({
      sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      byteLength: 3,
    });
    expect(await fs.readFile(path, 'utf8')).toBe('abc');
  });

  it.each(['Uint8Array', 'Buffer'])('snapshots %s input before asynchronous creation', async (kind) => {
    const input = kind === 'Buffer' ? Buffer.from([1, 2, 3]) : new Uint8Array([1, 2, 3]);
    const pending = writeFileAtomically(destination, input);
    input.fill(99);
    expect(await pending).toEqual({
      sha256: realHash('sha256').update(Buffer.from([1, 2, 3])).digest('hex'),
      byteLength: 3,
    });
    expect(await fs.readFile(destination)).toEqual(Buffer.from([1, 2, 3]));
  });

  it('awaits write, sync and close before verification and one sibling rename', async () => {
    const events: string[] = [];
    const open = interceptHandle((handle) => {
      const write = handle.writeFile.bind(handle);
      const sync = handle.sync.bind(handle);
      const close = handle.close.bind(handle);
      vi.spyOn(handle, 'writeFile').mockImplementation(async (data, options) => {
        await write(data, options);
        events.push('write');
      });
      vi.spyOn(handle, 'sync').mockImplementation(async () => {
        await sync();
        events.push('sync');
      });
      vi.spyOn(handle, 'close').mockImplementation(async () => {
        await close();
        events.push('close');
      });
    });
    vi.spyOn(fs, 'readFile').mockImplementationOnce(async (path) => {
      expect(events).toEqual(['write', 'sync', 'close']);
      events.push('verify');
      return realReadFile(path);
    });
    const rename = fs.rename.bind(fs);
    const renameSpy = vi.spyOn(fs, 'rename').mockImplementationOnce(async (from, to) => {
      expect(events).toEqual(['write', 'sync', 'close', 'verify']);
      expect(handles[0].fd).toBe(-1);
      expect(dirname(String(from))).toBe(directory);
      expect(from).not.toBe(destination);
      expect(to).toBe(destination);
      expect(await realReadFile(destination)).toEqual(original);
      await rename(from, to);
    });
    await writeFileAtomically(destination, 'new');
    expect(open).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith(expect.any(String), 'wx', 0o600);
    expect(renameSpy).toHaveBeenCalledOnce();
  });

  it('preserves a real EEXIST collision without unlinking it or retrying', async () => {
    const uuid = '11111111-1111-4111-8111-111111111111';
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(uuid);
    const collision = join(directory, `.autovision-${uuid}.tmp`);
    await fs.writeFile(collision, 'somebody else');
    const open = vi.spyOn(fs, 'open');
    const unlink = vi.spyOn(fs, 'unlink');
    await expect(writeFileAtomically(destination, 'new')).rejects.toMatchObject({ code: 'EEXIST' });
    expect(open).toHaveBeenCalledOnce();
    expect(unlink).not.toHaveBeenCalled();
    expect(await fs.readFile(collision, 'utf8')).toBe('somebody else');
    await realUnlink(collision);
    await expectPreserved();
  });

  it.each(['exact', 'normalized', 'Windows case'])('rejects a new destination that aliases its own temp (%s)', async (kind) => {
    const uuid = '11111111-1111-4111-8111-111111111111';
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(uuid);
    const name = `.autovision-${uuid}.tmp`;
    const target = kind === 'normalized'
      ? `${directory}/unused/../${name}`
      : join(directory, kind === 'Windows case' && process.platform === 'win32' ? name.toUpperCase() : name);
    const open = vi.spyOn(fs, 'open');
    const rename = vi.spyOn(fs, 'rename');
    const unlink = vi.spyOn(fs, 'unlink');
    await expect(writeFileAtomically(target, 'new'))
      .rejects.toThrow('Temporary path must differ from the destination.');
    expect(open).not.toHaveBeenCalled();
    expect(rename).not.toHaveBeenCalled();
    expect(unlink).not.toHaveBeenCalled();
    await expect(realReadFile(join(directory, name))).rejects.toMatchObject({ code: 'ENOENT' });
    await expectPreserved();
  });

  it.each(['write', 'sync', 'read', 'hash', 'rename', 'close'])('preserves old bytes and cleans up on %s failure', async (stage) => {
    const failure = Object.assign(new Error(`${stage} failed`), { code: 'EIO' });
    const rename = vi.spyOn(fs, 'rename');
    const unlink = vi.spyOn(fs, 'unlink');
    interceptHandle((handle) => {
      const close = handle.close.bind(handle);
      vi.spyOn(handle, 'close');
      if (stage === 'write') {
        const write = handle.writeFile.bind(handle);
        vi.spyOn(handle, 'writeFile').mockImplementationOnce(async () => {
          await write('partial');
          throw failure;
        });
      }
      if (stage === 'sync') vi.spyOn(handle, 'sync').mockRejectedValueOnce(failure);
      if (stage === 'close') {
        vi.spyOn(handle, 'close').mockImplementationOnce(async () => {
          await close();
          throw failure;
        });
      }
    });
    if (stage === 'read') vi.spyOn(fs, 'readFile').mockRejectedValueOnce(failure);
    if (stage === 'hash') {
      vi.spyOn(crypto, 'createHash')
        .mockImplementationOnce(realHash)
        .mockImplementationOnce(() => { throw failure; });
    }
    if (stage === 'rename') rename.mockRejectedValueOnce(failure);
    await expect(writeFileAtomically(destination, 'new')).rejects.toBe(failure);
    expect(handles[0].close).toHaveBeenCalledOnce();
    expect(handles[0].fd).toBe(-1);
    expect(rename).toHaveBeenCalledTimes(stage === 'rename' ? 1 : 0);
    expect(unlink).toHaveBeenCalledOnce();
    expect(unlink.mock.calls[0][0]).not.toBe(destination);
    await expectPreserved();
  });

  it.each(['same length corruption', 'truncated bytes'])('rejects verified %s before commit', async (kind) => {
    interceptHandle((handle) => {
      const write = handle.writeFile.bind(handle);
      vi.spyOn(handle, 'writeFile').mockImplementationOnce(async () => {
        await write(kind === 'same length corruption' ? 'bad' : 'n');
      });
    });
    const rename = vi.spyOn(fs, 'rename');
    await expect(writeFileAtomically(destination, 'new')).rejects.toThrow('Atomic write verification failed.');
    expect(rename).not.toHaveBeenCalled();
    expect(handles[0].fd).toBe(-1);
    await expectPreserved();
  });

  it('retains both the write error and close error without committing', async () => {
    const writeError = new Error('write failed');
    const closeError = new Error('close failed');
    interceptHandle((handle) => {
      const close = handle.close.bind(handle);
      vi.spyOn(handle, 'writeFile').mockRejectedValueOnce(writeError);
      vi.spyOn(handle, 'close').mockImplementationOnce(async () => {
        await close();
        throw closeError;
      });
    });
    await expect(writeFileAtomically(destination, 'new')).rejects.toMatchObject({
      errors: [writeError, closeError], cause: writeError,
    });
    await expectPreserved();
  });

  it('reports cleanup failure alongside the original failure, leaving only its own temp', async () => {
    const failure = new Error('rename failed');
    const cleanupError = new Error('unlink failed');
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(failure);
    const unlink = vi.spyOn(fs, 'unlink').mockRejectedValueOnce(cleanupError);
    await expect(writeFileAtomically(destination, 'new')).rejects.toMatchObject({
      errors: [failure, cleanupError], cause: failure,
    });
    const temp = String(unlink.mock.calls[0][0]);
    expect(dirname(temp)).toBe(directory);
    expect(basename(temp)).toMatch(/^\.autovision-.*\.tmp$/);
    expect(await realReadFile(temp, 'utf8')).toBe('new');
    await realUnlink(temp);
    await expectPreserved();
  });

  it('does not replace or recursively delete a destination directory', async () => {
    const target = join(directory, 'directory');
    await fs.mkdir(target);
    await fs.writeFile(join(target, 'keep'), 'safe');
    await expect(writeFileAtomically(target, 'new')).rejects.toThrow();
    expect(await fs.readFile(join(target, 'keep'), 'utf8')).toBe('safe');
    expect((await fs.readdir(directory)).filter((name) => name.startsWith('.autovision-'))).toEqual([]);
  });

  it('does not create missing parents or hide the open error', async () => {
    await expect(writeFileAtomically(join(directory, 'missing', 'file'), 'new'))
      .rejects.toMatchObject({ code: 'ENOENT' });
    await expectPreserved();
  });

  it.each(['', '.', 'relative.txt', 'C:relative.txt'])('rejects non-absolute destination %j without I/O', async (path) => {
    const open = vi.spyOn(fs, 'open');
    await expect(writeFileAtomically(path, 'new')).rejects.toThrow(TypeError);
    expect(open).not.toHaveBeenCalled();
  });

  it('rejects NUL in an absolute path without I/O', async () => {
    const open = vi.spyOn(fs, 'open');
    await expect(writeFileAtomically(`${destination}\0`, 'new')).rejects.toThrow(TypeError);
    expect(open).not.toHaveBeenCalled();
  });
});