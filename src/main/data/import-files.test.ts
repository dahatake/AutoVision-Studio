// @vitest-environment node
import childProcess from 'node:child_process';
import { createHash } from 'node:crypto';
import native from 'node:fs';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { win32 } from 'node:path';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import type { ScanResult } from '../../shared/contracts/import.js';
import { createProjectDirectory, type ProjectDirectoryReceipt } from '../projects/project-directory.js';
import * as copy from './copy-source.js';
import * as reference from './reference-access.js';
import { materializeImportSources, assertImportFilesCurrent, finishImportFiles, type PreparedImportFiles } from './import-files.js';

const projectId = '01234567-89ab-4cde-8f01-23456789abcd';
const importId = '11234567-89ab-4cde-8f01-23456789abcd';
const jobId = '21234567-89ab-4cde-8f01-23456789abcd';
const intent = '.autovision-import.json';
const realCopy = copy.copySourceFile;
const realCapture = reference.captureReferenceSource;
const realWrite = native.writeFileSync.bind(native);
const realClose = native.closeSync.bind(native);
let temporary = '';
let source = '';
let project: ProjectDirectoryReceipt;
let scan: ScanResult;

function root(): string { return win32.join(project.rootPath, 'datasets', importId); }
function marker(): string { return win32.join(root(), intent); }
function target(): string { return win32.join(root(), 'source', '00', '00', '000000.png'); }
function replace(path: string): void {
  const bytes = native.readFileSync(path);
  native.renameSync(path, `${path}.retained`);
  native.writeFileSync(path, bytes, { flag: 'wx' });
}

describe.skipIf(process.platform !== 'win32')('DAT-08D materialization', () => {
  beforeEach(async () => {
    temporary = await fs.realpath(await fs.mkdtemp(win32.join(tmpdir(), 'autovision-dat08d-')));
    const projects = win32.join(temporary, 'projects');
    source = win32.join(temporary, 'original');
    await fs.mkdir(projects);
    await fs.mkdir(source);
    project = createProjectDirectory(projects, projectId, []);
    scan = { formatVersion: 1, projectId, jobId, taskType: 'classification', mode: 'copy',
      classes: [{ key: 'class:one', name: 'one', sourceCategoryId: null }], images: [], issues: [] };
    for (let index = 0; index < 2; index += 1) {
      const path = win32.join(source, `${index}.png`);
      // Deliberately not a decoded PNG: this leaf consumes scan/hash evidence.
      const bytes = Buffer.from(`tiny scanned sample ${index}`);
      await fs.writeFile(path, bytes, { flag: 'wx' });
      const stat = native.lstatSync(path, { bigint: true });
      scan.images.push({ key: `image:${index}`, sourcePath: path, byteSize: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'), mtimeNs: String(stat.mtimeNs),
        format: index === 0 ? 'png' : 'jpeg', width: 1, height: 1, orientation: 1, duplicateOf: null,
        annotation: { type: 'classification', classKey: 'class:one', sourceRow: null } });
    }
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    // Only fixture teardown is recursive; production has no recursive FS call.
    if (temporary) await fs.rm(temporary, { recursive: true, force: true });
  });

  it('exposes the exact narrow API', () => {
    expectTypeOf(materializeImportSources).parameters.toEqualTypeOf<[
      ProjectDirectoryReceipt, string, ScanResult, readonly string[],
    ]>();
    expectTypeOf(materializeImportSources).returns.toEqualTypeOf<Promise<PreparedImportFiles>>();
    expectTypeOf(assertImportFilesCurrent).returns.toEqualTypeOf<void>();
    expectTypeOf(finishImportFiles).returns.toEqualTypeOf<void>();
  });

  it.each(['copy', 'reference'] as const)('materializes %s with genuine proof, preserved sources and exclusive durable intent', async (mode) => {
    scan.mode = mode;
    const originals = scan.images.map((image) => ({ bytes: native.readFileSync(image.sourcePath),
      stat: native.lstatSync(image.sourcePath, { bigint: true }) }));
    const mkdir = vi.spyOn(native, 'mkdirSync');
    const rm = vi.spyOn(native, 'rmSync');
    const copySpy = vi.spyOn(copy, 'copySourceFile');
    const capture = vi.spyOn(reference, 'captureReferenceSource');
    const result = await materializeImportSources(project, importId, scan, [source]);
    expect(result).toMatchObject({ projectId, importId, scanJobId: jobId, mode,
      location: { rootPath: root(), relativeRoot: `datasets/${importId}` } });
    expect(JSON.parse(native.readFileSync(marker(), 'utf8'))).toEqual({ version: 1,
      projectId, importId, scanJobId: jobId, mode, phase: 'materializing' });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.sourceManifest.entries)).toBe(true);
    expect(Reflect.set(result.location, 'rootPath', source)).toBe(false);
    expect(rm).not.toHaveBeenCalled();
    for (const call of mkdir.mock.calls) expect(call).toHaveLength(1);
    expect(capture).toHaveBeenCalledTimes(mode === 'copy' ? 6 : 2);
    expect(capture.mock.calls.slice(0, 2).map(([image]) => image.sourcePath))
      .toEqual(scan.images.map((image) => image.sourcePath));
    expect(capture.mock.invocationCallOrder[1]).toBeLessThan(mkdir.mock.invocationCallOrder[0]!);
    if (result.sourceManifest.mode === 'copy') {
      expect(capture.mock.calls.slice(2, 4).map(([image]) => image.sourcePath))
        .toEqual(result.sourceManifest.entries.map((entry) => win32.join(project.rootPath, entry.relativePath)));
      expect(capture.mock.calls.slice(4).map(([image]) => image.sourcePath))
        .toEqual(scan.images.map((image) => image.sourcePath));
      expect(copySpy).toHaveBeenCalledTimes(2);
      expect(result.sourceManifest.entries.map((entry) => entry.relativePath)).toEqual([
        `datasets/${importId}/source/00/00/000000.png`, `datasets/${importId}/source/00/00/000001.jpg`,
      ]);
      for (const [index, entry] of result.sourceManifest.entries.entries()) {
        expect(native.readFileSync(win32.join(project.rootPath, entry.relativePath))).toEqual(originals[index]!.bytes);
      }
    } else {
      expect(copySpy).not.toHaveBeenCalled();
      expect(native.readdirSync(root())).toEqual([intent]);
      for (const [index, entry] of result.sourceManifest.entries.entries()) {
        reference.assertCapturedReferenceSource(entry);
        expect(entry).toBe(await capture.mock.results[index]!.value);
      }
    }
    assertImportFilesCurrent(result);
    for (const [index, image] of scan.images.entries()) {
      const after = native.lstatSync(image.sourcePath, { bigint: true });
      expect(native.readFileSync(image.sourcePath)).toEqual(originals[index]!.bytes);
      expect(after.ino).toBe(originals[index]!.stat.ino);
      expect(after.mtimeNs).toBe(originals[index]!.stat.mtimeNs);
    }
    const unlink = vi.spyOn(native, 'unlinkSync');
    finishImportFiles(result);
    expect(unlink).toHaveBeenCalledExactlyOnceWith(marker());
    expect(native.existsSync(marker())).toBe(false);
    expect(native.existsSync(root())).toBe(true);
    if (mode === 'copy') expect(native.readFileSync(target())).toEqual(originals[0]!.bytes);
    expect(() => finishImportFiles(result)).toThrow(TypeError);
  });

  it('detaches all caller inputs before the first await without freezing caller data', async () => {
    const mutableProject = structuredClone(project);
    const roots = [source];
    const originalPath = scan.images[0]!.sourcePath;
    const pending = materializeImportSources(mutableProject, importId, scan, roots);
    scan.mode = 'reference';
    scan.images[0]!.sourcePath = 'C:\\forged.png';
    scan.classes[0]!.name = 'changed';
    scan.images[0]!.annotation = null;
    scan.images.length = 0;
    roots[0] = project.rootPath;
    Reflect.set(mutableProject, 'rootPath', source);
    Reflect.set(mutableProject.rootIdentity, 'ino', '1');
    const result = await pending;
    expect(result.sourceManifest.mode).toBe('copy');
    expect(result.sourceManifest.entries).toHaveLength(2);
    expect(native.readFileSync(target())).toEqual(native.readFileSync(originalPath));
    assertImportFilesCurrent(result);
  });

  it.each(['copy', 'reference'] as const)('rejects a failed local-volume preflight before %s source/protected-path I/O or output', async (mode) => {
    scan.mode = mode;
    const probe = vi.spyOn(childProcess, 'execFile').mockImplementation(() => {
      throw new Error('mapped drive has no local volume GUID');
    });
    const lstat = vi.spyOn(native, 'lstatSync');
    const realpath = vi.spyOn(native.realpathSync, 'native');
    const readdir = vi.spyOn(native, 'readdirSync');
    const asyncLstat = vi.spyOn(fs, 'lstat');
    const asyncReaddir = vi.spyOn(fs, 'readdir');
    const open = vi.spyOn(fs, 'open');
    const mkdir = vi.spyOn(native, 'mkdirSync');
    const copySpy = vi.spyOn(copy, 'copySourceFile');
    await expect(materializeImportSources(project, importId, scan, [source])).rejects.toMatchObject({
      code: 'ERR_IMPORT_FILES_ATTENTION', retainedRelativeRoot: null,
    });
    expect(probe).toHaveBeenCalledTimes(1);
    for (const spy of [lstat, realpath, readdir]) {
      expect(spy.mock.calls.filter(([path]) => String(path) === source || String(path).startsWith(`${source}\\`))).toEqual([]);
    }
    expect(asyncLstat).not.toHaveBeenCalled();
    expect(asyncReaddir).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(mkdir).not.toHaveBeenCalled();
    expect(copySpy).not.toHaveBeenCalled();
  });

  it('uses only captured GUID source evidence for Reference without protected-source paths', async () => {
    scan.mode = 'reference';
    const lstat = vi.spyOn(native, 'lstatSync');
    const realpath = vi.spyOn(native.realpathSync, 'native');
    const readdir = vi.spyOn(native, 'readdirSync');
    const result = await materializeImportSources(project, importId, scan, []);
    assertImportFilesCurrent(result);
    finishImportFiles(result);
    for (const spy of [lstat, realpath, readdir]) {
      expect(spy.mock.calls.filter(([path]) => String(path) === source || String(path).startsWith(`${source}\\`))).toEqual([]);
    }
  });

  it('rejects schema/accessor/foreign Project input before writes', async () => {
    const mkdir = vi.spyOn(native, 'mkdirSync');
    const getter = vi.fn(() => []);
    Object.defineProperty(scan, 'images', { enumerable: true, get: getter });
    await expect(materializeImportSources(project, importId, scan, [source])).rejects.toThrow(TypeError);
    expect(getter).not.toHaveBeenCalled();
    expect(mkdir).not.toHaveBeenCalled();
  });

  it.each(['foreign-id', 'forged-identity', 'protected-overlap', 'no-marker'] as const)('rejects %s without ownership or filesystem writes', async (kind) => {
    let input = project;
    let roots = [source];
    if (kind === 'foreign-id') scan.projectId = importId;
    if (kind === 'forged-identity') input = { ...project, rootIdentity: { ...project.rootIdentity, ino: '1' } };
    if (kind === 'protected-overlap') roots = [project.rootPath];
    if (kind === 'no-marker') native.unlinkSync(win32.join(project.rootPath, '.autovision-project.json'));
    const mkdir = vi.spyOn(native, 'mkdirSync');
    await expect(materializeImportSources(input, importId, scan, roots)).rejects.toThrow();
    expect(mkdir).not.toHaveBeenCalled();
  });

  it('never adopts an existing orphan root/intent or deletes unknown contents', async () => {
    native.mkdirSync(win32.join(project.rootPath, 'datasets'));
    native.mkdirSync(root());
    native.writeFileSync(marker(), 'orphan intent');
    native.writeFileSync(win32.join(root(), 'keep'), 'foreign payload');
    const unlink = vi.spyOn(native, 'unlinkSync');
    await expect(materializeImportSources(project, importId, scan, [source])).rejects.toMatchObject({
      code: 'ERR_IMPORT_FILES_ATTENTION', retainedRelativeRoot: `datasets/${importId}`,
    });
    expect(native.readFileSync(marker(), 'utf8')).toBe('orphan intent');
    expect(native.readFileSync(win32.join(root(), 'keep'), 'utf8')).toBe('foreign payload');
    expect(unlink).not.toHaveBeenCalled();
  });

  it('uses a legitimate shared datasets parent without taking ownership of siblings or overlapping protections', async () => {
    scan.mode = 'reference';
    const datasets = win32.join(project.rootPath, 'datasets');
    native.mkdirSync(datasets);
    native.writeFileSync(win32.join(datasets, 'keep'), 'other import');
    const child = win32.join(source, 'protected-child');
    native.mkdirSync(child);
    const result = await materializeImportSources(project, importId, scan, [child, source, source]);
    finishImportFiles(result);
    expect(native.readFileSync(win32.join(datasets, 'keep'), 'utf8')).toBe('other import');
    expect(native.existsSync(root())).toBe(true);
  });

  it('rejects a junction datasets parent without writing through it', async () => {
    const outside = win32.join(temporary, 'outside');
    native.mkdirSync(outside);
    native.symlinkSync(outside, win32.join(project.rootPath, 'datasets'), 'junction');
    await expect(materializeImportSources(project, importId, scan, [source])).rejects.toThrow();
    expect(native.readdirSync(outside)).toEqual([]);
  });

  it('retains an earlier completed payload and intent if the second copy fails', async () => {
    const spy = vi.spyOn(copy, 'copySourceFile');
    spy.mockImplementationOnce(realCopy).mockRejectedValueOnce(new Error('second copy failed'));
    await expect(materializeImportSources(project, importId, scan, [source])).rejects.toMatchObject({
      code: 'ERR_IMPORT_FILES_ATTENTION', retainedRelativeRoot: `datasets/${importId}`,
    });
    expect(native.readFileSync(target())).toEqual(native.readFileSync(scan.images[0]!.sourcePath));
    expect(native.existsSync(marker())).toBe(true);
  });

  it.each(['write', 'sync', 'close', 'copy'] as const)('retains intent/root after %s failure', async (stage) => {
    let markerFd = -1;
    const open = native.openSync.bind(native);
    vi.spyOn(native, 'openSync').mockImplementation((path, flags, mode) => {
      const fd = open(path, flags, mode);
      if (String(path) === marker() && flags === 'wx') markerFd = fd;
      return fd;
    });
    if (stage === 'write') vi.spyOn(native, 'writeFileSync').mockImplementation((path, bytes, options) => {
      if (path === markerFd) { realWrite(path, 'partial'); throw new Error('injected'); }
      realWrite(path, bytes, options);
    });
    if (stage === 'sync') vi.spyOn(native, 'fsyncSync').mockImplementationOnce(() => { throw new Error('injected'); });
    let released = -1;
    if (stage === 'close') vi.spyOn(native, 'closeSync').mockImplementation((fd) => {
      // The recovery close of the already released number must not reach the
      // real close: another test thread may reuse that descriptor number.
      if (fd === released) { released = -1; throw Object.assign(new Error('injected EBADF'), { code: 'EBADF' }); }
      realClose(fd);
      if (fd === markerFd) { markerFd = -1; released = fd; throw new Error('injected after release'); }
    });
    if (stage === 'copy') vi.spyOn(copy, 'copySourceFile').mockRejectedValueOnce(new Error('injected'));
    await expect(materializeImportSources(project, importId, scan, [source])).rejects.toMatchObject({
      code: 'ERR_IMPORT_FILES_ATTENTION', retainedRelativeRoot: `datasets/${importId}`,
    });
    expect(native.existsSync(root())).toBe(true);
    expect(native.existsSync(marker())).toBe(true);
    expect(native.readFileSync(marker(), 'utf8')).toBe(stage === 'write' ? 'partial'
      : `${JSON.stringify({ version: 1, projectId, importId, scanJobId: jobId, mode: 'copy', phase: 'materializing' })}\n`);
    expect(native.readdirSync(source)).toEqual(['0.png', '1.png']);
  });

  it.each(['source', 'target', 'parent', 'project-marker'] as const)('rejects an earlier %s replaced during a later copy, retaining all evidence', async (kind) => {
    let count = 0;
    vi.spyOn(copy, 'copySourceFile').mockImplementation(async (...args) => {
      const result = await realCopy(...args);
      if (++count === 2) {
        if (kind === 'source') replace(scan.images[0]!.sourcePath);
        if (kind === 'target') replace(target());
        if (kind === 'parent') {
          const path = win32.dirname(target());
          native.renameSync(path, `${path}.retained`);
          native.mkdirSync(path);
        }
        if (kind === 'project-marker') replace(win32.join(project.rootPath, '.autovision-project.json'));
      }
      return result;
    });
    await expect(materializeImportSources(project, importId, scan, [source])).rejects.toMatchObject({ code: 'ERR_IMPORT_FILES_ATTENTION' });
    expect(native.existsSync(marker())).toBe(true);
  });

  it('independently rehashes a target changed in the copy-return/first-stat gap', async () => {
    vi.spyOn(copy, 'copySourceFile').mockImplementationOnce(async (...args) => {
      const result = await realCopy(...args);
      native.writeFileSync(target(), Buffer.alloc(result.byteSize, 42));
      return result;
    });
    await expect(materializeImportSources(project, importId, scan, [source])).rejects.toThrow();
    expect(native.existsSync(marker())).toBe(true);
    expect(native.existsSync(target())).toBe(true);
  });

  it('rejects a Reference source changed while a later capture awaited', async () => {
    scan.mode = 'reference';
    let count = 0;
    vi.spyOn(reference, 'captureReferenceSource').mockImplementation(async (image) => {
      const result = await realCapture(image);
      if (++count === 2) replace(scan.images[0]!.sourcePath);
      return result;
    });
    const mkdir = vi.spyOn(native, 'mkdirSync');
    await expect(materializeImportSources(project, importId, scan, [source])).rejects.toMatchObject({
      code: 'ERR_IMPORT_FILES_ATTENTION', retainedRelativeRoot: null,
    });
    expect(mkdir).not.toHaveBeenCalled();
    expect(native.existsSync(marker())).toBe(false);
  });

  it.each(['spread', 'json', 'location'] as const)('refuses %s receipt clones without filesystem access', async (kind) => {
    scan.mode = 'reference';
    const result = await materializeImportSources(project, importId, scan, [source]);
    const fake = kind === 'spread' ? { ...result } : kind === 'json'
      ? JSON.parse(JSON.stringify(result)) as PreparedImportFiles : result.location as unknown as PreparedImportFiles;
    const lstat = vi.spyOn(native, 'lstatSync');
    expect(() => assertImportFilesCurrent(fake)).toThrow(TypeError);
    expect(() => finishImportFiles(fake)).toThrow(TypeError);
    expect(lstat).not.toHaveBeenCalled();
  });

  it.each(['marker-identity', 'marker-noncanonical', 'unknown', 'source', 'target'] as const)(
    'refuses finish after %s changes without unlinking anything', async (kind) => {
      const result = await materializeImportSources(project, importId, scan, [source]);
      if (kind === 'marker-identity') replace(marker());
      if (kind === 'marker-noncanonical') {
        const raw = native.readFileSync(marker(), 'utf8');
        native.writeFileSync(marker(), ` ${raw.slice(0, -1)}`); // Same length, different canonical bytes.
      }
      if (kind === 'unknown') native.writeFileSync(win32.join(root(), 'foreign'), 'keep');
      if (kind === 'source') replace(scan.images[0]!.sourcePath);
      if (kind === 'target') replace(target());
      const unlink = vi.spyOn(native, 'unlinkSync');
      expect(() => assertImportFilesCurrent(result)).toThrow();
      expect(() => finishImportFiles(result)).toThrow();
      expect(unlink).not.toHaveBeenCalled();
      expect(native.existsSync(marker())).toBe(true);
      expect(native.existsSync(target())).toBe(true);
    },
  );

  it.each([false, true])('reports unlink failure (acknowledgement lost=%s), consumes authority, keeps payload', async (ackLoss) => {
    const result = await materializeImportSources(project, importId, scan, [source]);
    const unlink = native.unlinkSync.bind(native);
    const spy = vi.spyOn(native, 'unlinkSync').mockImplementationOnce((path) => {
      if (ackLoss) unlink(path);
      throw new Error('injected');
    });
    expect(() => finishImportFiles(result)).toThrow('ERR_IMPORT_FILES_ATTENTION');
    expect(spy).toHaveBeenCalledExactlyOnceWith(marker());
    expect(native.existsSync(marker())).toBe(!ackLoss);
    expect(native.existsSync(target())).toBe(true);
    expect(() => finishImportFiles(result)).toThrow(TypeError);
  });
});