// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto';
import native, { constants } from 'node:fs';
import fs, { type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { win32 } from 'node:path';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import { MAX_IMAGE_BYTES } from '../../shared/contracts/import.js';
import type { CopyImportSource } from '../data/import-source-manifest.js';
import * as reference from '../data/reference-access.js';
import { createProjectDirectory, verifyProjectDirectory, type ProjectDirectoryReceipt } from '../projects/project-directory.js';
import { readProjectImage } from './safe-path.js';

const realRead = reference.readVerifiedReferenceImage;
const realOpen = fs.open.bind(fs);
type Read = (buffer: Buffer, offset: number, length: number, position: number) =>
  Promise<{ bytesRead: number; buffer: Buffer }>;
let directory = '';
let project: ProjectDirectoryReceipt;
let source: CopyImportSource;
let target = '';
let original: Buffer;
const handles: FileHandle[] = [];

describe.skipIf(process.platform !== 'win32')('DAT14C Project Copy image bytes', () => {
  beforeEach(async () => {
    directory = await fs.realpath(await fs.mkdtemp(win32.join(tmpdir(), 'av-dat14c-')));
    project = structuredClone(createProjectDirectory(directory, randomUUID(), []));
    await fs.mkdir(win32.join(project.rootPath, 'images'));
    target = win32.join(project.rootPath, 'images', 'image.bin');
    original = Buffer.alloc(131_119, 0x5a);
    await fs.writeFile(target, original, { flag: 'wx' });
    source = { imageKey: 'image:0', relativePath: 'images/image.bin', byteSize: original.length,
      sha256: createHash('sha256').update(original).digest('hex') };
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const handle of handles.splice(0)) if (handle.fd !== -1) await handle.close();
    if (directory) await fs.rm(directory, { recursive: true, force: true });
  });

  it('returns the exact real reader Buffer with bounded read-only opens and no source changes', async () => {
    expectTypeOf(readProjectImage).returns.toEqualTypeOf<Promise<Buffer>>();
    let returned: Buffer | undefined;
    vi.spyOn(reference, 'readVerifiedReferenceImage').mockImplementation(async (...args) => {
      returned = await realRead(...args);
      return returned;
    });
    vi.spyOn(fs, 'open').mockImplementation(async (path, flags, mode) => {
      expect(String(path)).toMatch(/^\\\\\?\\Volume\{/u);
      expect(Number(flags) & (constants.O_WRONLY | constants.O_RDWR | constants.O_CREAT | constants.O_TRUNC)).toBe(0);
      const handle = await realOpen(path, flags, mode);
      handles.push(handle);
      const read = handle.read.bind(handle);
      vi.spyOn(handle, 'read').mockImplementation((async (buffer, offset, length, position) => {
        expect(length).toBeLessThanOrEqual(65_536);
        return read(buffer, offset, length, position);
      }) as Read as FileHandle['read']);
      return handle;
    });
    const writes = [vi.spyOn(fs, 'writeFile'), vi.spyOn(fs, 'rename'), vi.spyOn(fs, 'unlink')];
    const result = await readProjectImage(project, source);
    expect(result).toBe(returned);
    expect(result).toEqual(original);
    expect(handles.every((handle) => handle.fd === -1)).toBe(true);
    for (const write of writes) expect(write).not.toHaveBeenCalled();
    expect(native.readFileSync(target)).toEqual(original);
  });

  it.each(['../image.bin', 'images/../image.bin', 'images//image.bin', './image.bin',
    '/image.bin', 'C:/image.bin', 'images\\image.bin', '.autovision-project.json',
    'images/.autovision-copy-x.tmp', 'images/NUL', 'images/image.bin.', 'images/image.bin:stream',
    'images/./image.bin', 'images/image.bin/'])('rejects unsafe relative path %s before I/O', async (path) => {
    source.relativePath = path;
    const open = vi.spyOn(fs, 'open');
    const stat = vi.spyOn(native, 'lstatSync');
    await expect(readProjectImage(project, source)).rejects.toThrow();
    expect(open).not.toHaveBeenCalled();
    expect(stat).not.toHaveBeenCalled();
  });

  it.each(['source-proxy', 'identity-proxy', 'project-proxy', 'getter', 'nested-getter', 'extra', 'oversize', 'hash', 'signal'])
    ('rejects invalid %s without invoking getters or proxy traps or I/O', async (kind) => {
      const trap = vi.fn(() => { throw new Error('trap invoked'); });
      if (kind === 'source-proxy') source = new Proxy(source, { get: trap, getPrototypeOf: trap, ownKeys: trap });
      if (kind === 'project-proxy') project = new Proxy(project, { get: trap, getPrototypeOf: trap, ownKeys: trap });
      if (kind === 'identity-proxy') project = { ...project, rootIdentity: new Proxy(project.rootIdentity, { get: trap, getPrototypeOf: trap }) };
      if (kind === 'getter') Object.defineProperty(source, 'relativePath', { get: trap });
      if (kind === 'nested-getter') Object.defineProperty(project.markerIdentity, 'ino', { get: trap });
      if (kind === 'extra') Object.assign(source, { sourcePath: target });
      if (kind === 'oversize') source.byteSize = MAX_IMAGE_BYTES + 1;
      if (kind === 'hash') source.sha256 = 'bad';
      const stat = vi.spyOn(native, 'lstatSync');
      await expect(readProjectImage(project, source, kind === 'signal' ? {} as AbortSignal : undefined)).rejects.toThrow();
      expect(trap).not.toHaveBeenCalled();
      expect(stat).not.toHaveBeenCalled();
    });

  it.each(['root-identity', 'marker-identity', 'marker-content', 'hardlink', 'junction', 'corrupt', 'case'])
    ('rejects unsafe actual %s', async (kind) => {
      if (kind === 'root-identity') project = { ...project, rootIdentity: { ...project.rootIdentity, ino: '999' } };
      if (kind === 'marker-identity') project = { ...project, markerIdentity: { ...project.markerIdentity, ino: '999' } };
      if (kind === 'marker-content') native.writeFileSync(win32.join(project.rootPath, '.autovision-project.json'), '{}');
      if (kind === 'hardlink') native.linkSync(target, `${target}.link`);
      if (kind === 'junction') {
        const images = win32.dirname(target);
        native.renameSync(images, `${images}-moved`);
        native.symlinkSync(`${images}-moved`, images, 'junction');
      }
      if (kind === 'corrupt') native.writeFileSync(target, Buffer.alloc(original.length, 1));
      if (kind === 'case') source.relativePath = 'images/IMAGE.bin';
      await expect(readProjectImage(project, source)).rejects.toThrow();
    });

  it('snapshots caller source and both receipt identities before the first await', async () => {
    const pending = readProjectImage(project, source);
    source.relativePath = '../outside';
    source.sha256 = '0'.repeat(64);
    Object.assign(project.rootIdentity, { ino: '999' });
    Object.assign(project.markerIdentity, { ino: '999' });
    Object.assign(project, { rootPath: 'C:\\outside' });
    expect(await pending).toEqual(original);
  });

  it.each(['target', 'ancestor', 'project', 'marker'])('rejects %s replacement after the actual reader returns', async (kind) => {
    vi.spyOn(reference, 'readVerifiedReferenceImage').mockImplementation(async (...args) => {
      const bytes = await realRead(...args);
      if (kind === 'target') {
        native.renameSync(target, `${target}.old`);
        native.writeFileSync(target, original, { flag: 'wx' });
      } else if (kind === 'ancestor') {
        const parent = win32.dirname(target);
        native.renameSync(parent, `${parent}-old`);
        native.mkdirSync(parent);
        native.writeFileSync(target, original, { flag: 'wx' });
      } else if (kind === 'marker') {
        const marker = win32.join(project.rootPath, '.autovision-project.json');
        native.renameSync(marker, `${marker}.old`);
        native.copyFileSync(`${marker}.old`, marker);
      } else {
        native.renameSync(project.rootPath, `${project.rootPath}-old`);
        createProjectDirectory(directory, project.projectId, []);
        native.mkdirSync(win32.dirname(target));
        native.writeFileSync(target, original, { flag: 'wx' });
      }
      return bytes;
    });
    await expect(readProjectImage(project, source)).rejects.toThrow();
  });

  it('accepts a moved Project with fresh receipt and a new Copy inode matching saved bytes', async () => {
    const parent = win32.join(directory, 'moved');
    native.mkdirSync(parent);
    const moved = win32.join(parent, project.projectId);
    native.renameSync(project.rootPath, moved);
    target = win32.join(moved, 'images', 'image.bin');
    native.renameSync(target, `${target}.old`);
    native.writeFileSync(target, original, { flag: 'wx' });
    await expect(readProjectImage(project, source)).rejects.toThrow();
    expect(await readProjectImage(verifyProjectDirectory(moved, project.projectId), source)).toEqual(original);
  });

  it.each(['before', 'read'])('aborts %s I/O and releases real handles', async (point) => {
    const controller = new AbortController();
    if (point === 'before') controller.abort();
    const stat = vi.spyOn(native, 'lstatSync');
    const open = vi.spyOn(fs, 'open').mockImplementation(async (path, flags, mode) => {
      const handle = await realOpen(path, flags, mode);
      handles.push(handle);
      const read = handle.read.bind(handle);
      vi.spyOn(handle, 'read').mockImplementation((async (buffer, offset, length, position) => {
        const result = await read(buffer, offset, length, position);
        controller.abort();
        return result;
      }) as Read as FileHandle['read']);
      return handle;
    });
    await expect(readProjectImage(project, source, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    if (point === 'before') { expect(open).not.toHaveBeenCalled(); expect(stat).not.toHaveBeenCalled(); }
    expect(handles.every((handle) => handle.fd === -1)).toBe(true);
  });
});