// @vitest-environment node
import { createHash } from 'node:crypto';
import native, { constants, type BigIntStats, type Dirent } from 'node:fs';
import fs, { type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, expectTypeOf, it, vi } from 'vitest';

import { sampleManifestSchema, type SampleManifest } from '../../shared/contracts/sample.js';
import {
  getSampleAssets, SampleAssetsError,
  type SampleAssets, type SampleAssetsErrorCode, type SampleAssetsLocation, type SampleId,
} from './sample-assets.js';

const ids = ['beans', 'gwhd-2021'] as const;
// Independent reviewed evidence, NOT hashes learned from the fixture being
// tested. No production pin injection, synthetic approved assets or downloads.
const pins = {
  beans: { byteSize: 17_572, sha256: '29f0c7225ed4bcb7e79cfcb135088fd65662ac244654caec78dd2a4a5024c47d' },
  'gwhd-2021': { byteSize: 10_156, sha256: 'b4e5ba7653a4ca8b23e913e0864e39d422b0e9470bf7cc6ef527560f1a91a94b' },
} as const;
const stampFields = ['dev', 'ino', 'birthtimeNs', 'mode', 'nlink', 'size', 'mtimeNs', 'ctimeNs'] as const;
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

// The resolver uses only the explicit buffer/offset/length/position overload.
type DescriptorRead = (buffer: Buffer, offset: number, length: number, position: number) =>
  Promise<{ bytesRead: number; buffer: Buffer }>;
function mockDescriptorRead(handle: FileHandle, implementation: DescriptorRead) {
  return vi.spyOn(handle, 'read').mockImplementation(implementation as FileHandle['read']);
}

function expectFrozen(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectFrozen(child);
}

async function expectFailure(operation: Promise<unknown>, code?: SampleAssetsErrorCode): Promise<SampleAssetsError> {
  let failure: unknown;
  try { await operation; } catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(SampleAssetsError);
  if (!(failure instanceof SampleAssetsError)) throw new Error('Expected a controlled asset failure, not success.');
  if (code) expect(failure.code).toBe(code);
  expect(failure.message).not.toMatch(/[\\/]|https?:|private-token|secret-native/u);
  expect(failure).not.toHaveProperty('cause');
  return failure;
}

describe.skipIf(process.platform !== 'win32')('SP-09 fixed Windows sample assets', () => {
  let repository: string;
  let originalRoot: string;
  let temporary: string;
  let appPath: string;
  let resourcesPath: string;
  let sampleRoot: string;
  let packaged: SampleAssetsLocation;
  let dev: SampleAssetsLocation;
  let counter = 0;
  const rawManifests = new Map<SampleId, Buffer>();
  const manifests = new Map<SampleId, SampleManifest>();
  const inventory = new Map<string, { byteSize: number; sha256: string }>();
  const undo: (() => Promise<void>)[] = [];

  function asset(relative: string): string {
    const path = win32.join(sampleRoot, ...relative.split('/'));
    const inside = win32.relative(sampleRoot, path);
    if (inside === '..' || inside.startsWith('..\\') || win32.isAbsolute(inside)) throw new Error('Test fixture path escaped.');
    return path;
  }
  function image(id: SampleId, index = 0): string {
    return `${id}/${manifests.get(id)!.images.at(index)!.path}`;
  }
  async function overwrite(relative: string, bytes: Buffer): Promise<void> {
    const path = asset(relative);
    const original = await fs.readFile(path);
    undo.push(() => fs.writeFile(path, original));
    await fs.writeFile(path, bytes);
  }
  async function aside(relative: string): Promise<string> {
    const path = asset(relative);
    const saved = win32.join(temporary, `aside-${++counter}`);
    await fs.rename(path, saved);
    undo.push(() => fs.rename(saved, path));
    return saved;
  }
  async function addFile(relative: string): Promise<void> {
    const path = asset(relative);
    await fs.writeFile(path, 'test-owned extra', { flag: 'wx' });
    undo.push(() => fs.unlink(path));
  }
  function padded(text: string, size: number): Buffer {
    const raw = Buffer.from(text, 'utf8');
    expect(raw.length).toBeLessThanOrEqual(size);
    return Buffer.concat([raw, Buffer.alloc(size - raw.length, 0x20)]);
  }
  function flipped(raw: Buffer): Buffer {
    const changed = Buffer.from(raw);
    changed[Math.floor(changed.length / 2)]! ^= 1;
    return changed;
  }

  beforeAll(async () => {
    repository = await fs.realpath(fileURLToPath(new URL('../../../', import.meta.url)));
    originalRoot = win32.join(repository, 'resources', 'samples');
    temporary = await fs.realpath(await fs.mkdtemp(win32.join(tmpdir(), 'autovision-sp09-')));
    appPath = win32.join(temporary, 'Application 日本語');
    resourcesPath = win32.join(appPath, 'resources');
    sampleRoot = win32.join(resourcesPath, 'samples');
    packaged = { isPackaged: true, appPath: win32.join(resourcesPath, 'app.asar'), resourcesPath };
    dev = { isPackaged: false, appPath, resourcesPath: win32.join(temporary, 'unused-electron-resources') };
    for (const id of ids) {
      const raw = await fs.readFile(win32.join(originalRoot, id, 'manifest.json'));
      expect(raw.length).toBe(pins[id].byteSize);
      expect(digest(raw)).toBe(pins[id].sha256);
      const manifest = sampleManifestSchema.parse(JSON.parse(raw.toString('utf8')));
      expect(manifest.id).toBe(id);
      rawManifests.set(id, raw);
      manifests.set(id, manifest);
      inventory.set(`${id}/manifest.json`, pins[id]);
      for (const entry of [...manifest.images, ...manifest.files]) inventory.set(`${id}/${entry.path}`, entry);
    }
    expect(inventory.size).toBe(87);
    expect([...inventory.values()].reduce((total, entry) => total + entry.byteSize, 0)).toBe(44_942_112);
    // Exactly one ~45 MB copy for the entire sequential suite. Only the 87
    // pinned paths are read, never recursive repo/user-data enumeration. Every
    // link target and mutation below stays inside this single temporary root.
    for (const relative of inventory.keys()) {
      const path = asset(relative);
      await fs.mkdir(win32.dirname(path), { recursive: true });
      await fs.copyFile(win32.join(originalRoot, ...relative.split('/')), path, constants.COPYFILE_EXCL);
    }
  }, 30_000);

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const restore of undo.splice(0).reverse()) await restore();
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    try {
      // Verify original bytes survived BOTH successful and rejected calls.
      // Reads are one known file at a time; only our temporary root is removed.
      for (const [relative, metadata] of inventory) {
        const raw = await fs.readFile(win32.join(originalRoot, ...relative.split('/')));
        expect(raw.length).toBe(metadata.byteSize);
        expect(digest(raw)).toBe(metadata.sha256);
      }
    } finally {
      if (temporary) await fs.rm(temporary, { recursive: true, force: true });
    }
  }, 30_000);

  it('exposes one Main-only resolver with readonly discriminated output', () => {
    expectTypeOf(getSampleAssets).parameter(0).toEqualTypeOf<unknown>();
    expectTypeOf(getSampleAssets).parameter(1).toEqualTypeOf<SampleAssetsLocation>();
    expectTypeOf(getSampleAssets).returns.toEqualTypeOf<Promise<SampleAssets>>();
    expectTypeOf<Extract<SampleAssets, { id: 'beans' }>['annotationPath']>().toEqualTypeOf<undefined>();
    expectTypeOf<Extract<SampleAssets, { id: 'gwhd-2021' }>['annotationPath']>().toEqualTypeOf<string>();
    expectTypeOf<Extract<SampleAssets, { id: 'beans' }>['manifest']['images']>().toEqualTypeOf<
      readonly Readonly<Extract<SampleManifest, { id: 'beans' }>['images'][number]>[]
    >();
  });

  it.each(ids)('resolves the actual read-only development resources for %s', async (id) => {
    const assets = await getSampleAssets(id, { isPackaged: false, appPath: repository,
      resourcesPath: win32.join(temporary, 'not-used') });
    const manifest = manifests.get(id)!;
    const root = win32.join(originalRoot, id);
    expect(assets).toMatchObject({ id, taskType: manifest.taskType, readOnly: true,
      rootPath: root, imagesRoot: win32.join(root, 'images'), manifestPath: win32.join(root, 'manifest.json'), manifest });
    expect(assets.manifest.images).toHaveLength(id === 'beans' ? 60 : 20);
    expect(assets.manifest.source.url).toBe(manifest.source.url); // Passive provenance remains intact.
    expect(assets.notices).toEqual(['LICENSE.txt', 'ATTRIBUTION.txt'].map((name) => {
      const file = manifest.files.find((entry) => entry.path === name)!;
      return { kind: name === 'LICENSE.txt' ? 'license' : 'attribution', license: manifest.licenses.images,
        path: win32.join(root, name), byteSize: file.byteSize, sha256: file.sha256 };
    }));
    if (assets.id === 'gwhd-2021') expect(assets.annotationPath).toBe(win32.join(root, 'annotations.coco.json'));
    else expect(Object.hasOwn(assets, 'annotationPath')).toBe(false);
    expectFrozen(assets);
    expect(Reflect.set(assets, 'rootPath', temporary)).toBe(false);
    expect(Reflect.set(assets.manifest.source, 'url', 'https://example.invalid/')).toBe(false);
    expect(Reflect.set(assets.manifest.images[0]!, 'sha256', '0'.repeat(64))).toBe(false);
    expect(Reflect.set(assets.manifest.images, '0', {})).toBe(false);
    expect(Reflect.set(assets.notices[0]!, 'path', temporary)).toBe(false);
  }, 30_000);

  it('uses packaged resources outside app.asar and reads each pinned file through one or two bounded read-only descriptors', async () => {
    const writeSpies = [vi.spyOn(fs, 'writeFile'), vi.spyOn(fs, 'appendFile'), vi.spyOn(fs, 'mkdir'),
      vi.spyOn(fs, 'rm'), vi.spyOn(fs, 'rename'), vi.spyOn(fs, 'copyFile'), vi.spyOn(fs, 'unlink'),
      vi.spyOn(fs, 'chmod'), vi.spyOn(fs, 'utimes'), vi.spyOn(native, 'writeFileSync'), vi.spyOn(native, 'mkdirSync')];
    const wholeReads = vi.spyOn(fs, 'readFile');
    const wholeSyncReads = vi.spyOn(native, 'readFileSync');
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network is forbidden in resolver tests.'));
    const open = fs.open;
    const handles: { path: string; handle: FileHandle; hash: ReturnType<typeof createHash> }[] = [];
    const reads: { handleId: number; offset: number; length: number; position: number; bytesRead: number }[] = [];
    const closes: ReturnType<typeof vi.fn>[] = [];
    const opening = vi.spyOn(fs, 'open').mockImplementation(async (path, flags, mode) => {
      const handle = await open(path, flags, mode);
      const handleId = handles.length;
      const descriptor = { path: String(path), handle, hash: createHash('sha256') };
      handles.push(descriptor);
      const read = handle.read.bind(handle);
      mockDescriptorRead(handle, async (buffer, offset, length, position) => {
        const result = await read(buffer, offset, length, position);
        descriptor.hash.update(buffer.subarray(offset, offset + result.bytesRead));
        reads.push({ handleId, offset, length, position, bytesRead: result.bytesRead });
        return result;
      });
      closes.push(vi.spyOn(handle, 'close'));
      return handle;
    });
    const assets = await getSampleAssets('beans', packaged);
    expect(assets.rootPath).toBe(asset('beans'));
    expect(await fs.stat(resourcesPath)).toBeDefined();
    const openedPaths = opening.mock.calls.map(([path]) => String(path));
    const expectedPaths = [...inventory.keys()].map(asset).sort();
    expect(openedPaths.slice(0, inventory.size).sort()).toEqual(expectedPaths);
    expect([...new Set(openedPaths)].sort()).toEqual(expectedPaths);
    for (const [, flags] of opening.mock.calls) {
      expect(flags).toBe(constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    }
    expect(handles.length).toBeGreaterThanOrEqual(inventory.size);
    expect(handles.length).toBeLessThanOrEqual(2 * inventory.size);
    for (const [relative, metadata] of inventory) {
      const fileHandles = handles.map((entry, handleId) => ({ ...entry, handleId })).filter(({ path }) => path === asset(relative));
      expect([1, 2]).toContain(fileHandles.length);
      for (const { handleId, hash } of fileHandles) {
        const fileReads = reads.filter((read) => read.handleId === handleId);
        expect(fileReads.length).toBeGreaterThan(0);
        let bytes = 0;
        let requested = 0;
        for (const { offset, length, position, bytesRead } of fileReads) {
          expect(offset).toBe(0);
          expect(length).toBeGreaterThan(0);
          expect(length).toBeLessThanOrEqual(65_536);
          expect(position).toBe(bytes);
          expect(position + length).toBeLessThanOrEqual(metadata.byteSize + 1);
          expect(Number.isInteger(bytesRead)).toBe(true);
          expect(bytesRead).toBeGreaterThanOrEqual(0);
          expect(bytesRead).toBeLessThanOrEqual(length);
          bytes += bytesRead;
          requested += length;
        }
        expect(bytes).toBe(metadata.byteSize);
        expect(requested).toBeLessThanOrEqual(metadata.byteSize + 1);
        expect(fileReads.at(-1)).toMatchObject({ position: metadata.byteSize, length: 1, bytesRead: 0 });
        expect(hash.digest('hex')).toBe(metadata.sha256);
      }
    }
    const declared = [...inventory.values()].reduce((total, entry) => total + entry.byteSize, 0);
    const actual = reads.reduce((total, read) => total + read.bytesRead, 0);
    expect(actual).toBeGreaterThanOrEqual(declared);
    expect(actual).toBeLessThanOrEqual(2 * declared);
    expect(2 * declared).toBe(89_884_224);
    expect(2 * declared).toBeLessThan(96 * 1024 * 1024);
    expect(actual).toBeLessThanOrEqual(96 * 1024 * 1024);
    expect(handles.every(({ handle }) => handle.fd === -1)).toBe(true);
    for (const close of closes) expect(close).toHaveBeenCalledTimes(1);
    expect(wholeReads).not.toHaveBeenCalled();
    expect(wholeSyncReads).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    for (const spy of writeSpies) expect(spy).not.toHaveBeenCalled();
  }, 30_000);

  it('resolves mixed Main base separators/case to the actual canonical directory', async () => {
    const mixed = appPath.toUpperCase().replace('\\Application 日本語'.toUpperCase(), '/APPLICATION 日本語');
    const result = await getSampleAssets('gwhd-2021', { ...dev, appPath: `${mixed}/` });
    expect(result.rootPath).toBe(asset('gwhd-2021'));
  }, 30_000);

  it('snapshots trusted configuration before the first await', async () => {
    const mutable = { ...packaged };
    const resolving = getSampleAssets('beans', mutable);
    mutable.isPackaged = false;
    mutable.appPath = win32.join(temporary, 'changed-app');
    mutable.resourcesPath = win32.join(temporary, 'changed-resources');
    expect((await resolving).rootPath).toBe(asset('beans'));
  }, 30_000);

  it('rejects unknown, aliased, URL, path and object IDs without coercion or filesystem IO', async () => {
    const coerce = vi.fn(() => 'beans');
    const lstat = vi.spyOn(fs, 'lstat');
    const open = vi.spyOn(fs, 'open');
    for (const id of [undefined, null, 0, false, NaN, {}, [], new String('beans'), { toString: coerce },
      { [Symbol.toPrimitive]: coerce }, Symbol('beans'), '', 'BEANS', 'gwhd', 'beans ', 'beans\n',
      '../beans', 'beans/../gwhd-2021', 'beans\\images', 'beans:stream', '%62eans', 'constructor', '__proto__',
      'C:\\samples\\beans', 'https://example.invalid/beans']) {
      await expectFailure(getSampleAssets(id, packaged), 'SAMPLE_ID');
    }
    expect(coerce).not.toHaveBeenCalled();
    expect(lstat).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it('requires exact Main data fields and has no runtime manifest/path overrides or getters', async () => {
    const getter = vi.fn(() => appPath);
    const accessor = { ...packaged };
    Object.defineProperty(accessor, 'appPath', { get: getter });
    const lstat = vi.spyOn(fs, 'lstat');
    const invalid: unknown[] = [undefined, null, [], {}, Object.create(packaged), accessor,
      { ...packaged, isPackaged: 'true' }, { ...packaged, appPath: undefined },
      { ...packaged, resourcesPath: new String(resourcesPath) }, { isPackaged: true, resourcesPath },
      ...['rootPath', 'imagesRoot', 'annotationPath', 'mainBundleDir', 'manifestHashes', 'url'].map((key) => ({ ...packaged, [key]: temporary })),
      { ...packaged, [Symbol('override')]: true }];
    for (const input of invalid) await expectFailure(getSampleAssets('beans', input as SampleAssetsLocation), 'SAMPLE_LOCATION');
    expect(getter).not.toHaveBeenCalled();
    expect(lstat).not.toHaveBeenCalled();
  });

  it.each(['appPath', 'resourcesPath'] as const)('rejects unsafe %s before normalization or IO, including inactive bases', async (field) => {
    const lstat = vi.spyOn(fs, 'lstat');
    const invalid = ['', 'relative', 'C:relative', '\\root-relative', 'C:\\', '\\\\server\\share\\folder',
      '//server/share/folder', '\\\\?\\C:\\folder', '\\\\.\\C:\\folder', 'https://example.invalid/a', 'file:///C:/app',
      'C:\\safe\\..\\app', 'C:/safe/./app', 'C:\\safe\\\\app', 'C:\\safe:stream\\app',
      'C:\\NUL', 'C:\\con.txt', 'C:\\CONIN$', 'C:\\LPT².txt', 'C:\\trailing.', 'C:\\trailing ',
      'C:\\bad*name', 'C:\\line\nfeed', 'C:\\nul\0byte', 'C:\\bad\ud800', `C:\\${'x'.repeat(256)}`, 'x'.repeat(32_768)];
    for (const value of invalid) await expectFailure(getSampleAssets('beans', { ...packaged, [field]: value }), 'SAMPLE_LOCATION');
    expect(lstat).not.toHaveBeenCalled();
  });

  it.each([false, true])('does not guess cwd/dist parents or fall back to the other base (packaged=%s)', async (isPackaged) => {
    const mkdir = vi.spyOn(fs, 'mkdir');
    const input = isPackaged
      ? { isPackaged, appPath, resourcesPath: win32.join(temporary, 'missing-resources') }
      : { isPackaged, appPath: win32.join(appPath, 'dist', 'main'), resourcesPath };
    await expectFailure(getSampleAssets('beans', input), 'SAMPLE_ASSET_IO');
    expect(mkdir).not.toHaveBeenCalled();
  });

  it.each(['beans-image', 'gwhd-image', 'beans-license', 'gwhd-attribution', 'coco', 'gwhd-manifest'] as const)(
    'refuses missing %s even for a request for the other dataset, without repair', async (kind) => {
      const relative = ({ 'beans-image': image('beans'), 'gwhd-image': image('gwhd-2021'),
        'beans-license': 'beans/LICENSE.txt', 'gwhd-attribution': 'gwhd-2021/ATTRIBUTION.txt',
        coco: 'gwhd-2021/annotations.coco.json', 'gwhd-manifest': 'gwhd-2021/manifest.json' })[kind];
      await aside(relative);
      await expectFailure(getSampleAssets(relative.startsWith('beans/') ? 'gwhd-2021' : 'beans', packaged));
      await expect(fs.lstat(asset(relative))).rejects.toMatchObject({ code: 'ENOENT' });
    }, 30_000);

  it.each(['first-image', 'last-image', 'license', 'attribution', 'coco'] as const)(
    'hashes the full raw %s bytes rather than just headers, names or metadata', async (kind) => {
      const relative = ({ 'first-image': image('beans'), 'last-image': image('gwhd-2021', -1),
        license: 'beans/LICENSE.txt', attribution: 'gwhd-2021/ATTRIBUTION.txt', coco: 'gwhd-2021/annotations.coco.json' })[kind];
      const changed = flipped(await fs.readFile(asset(relative)));
      await overwrite(relative, changed);
      await expectFailure(getSampleAssets(relative.startsWith('beans/') ? 'gwhd-2021' : 'beans', packaged), 'SAMPLE_ASSET_INTEGRITY');
      expect(await fs.readFile(asset(relative))).toEqual(changed);
    }, 30_000);

  it.each(['empty', 'shorter', 'longer'] as const)('rejects an %s image size without rewriting it', async (kind) => {
    const relative = image('gwhd-2021');
    const original = await fs.readFile(asset(relative));
    const changed = kind === 'empty' ? Buffer.alloc(0) : kind === 'shorter' ? original.subarray(0, -1) : Buffer.concat([original, Buffer.from('x')]);
    await overwrite(relative, changed);
    await expectFailure(getSampleAssets('beans', packaged), 'SAMPLE_ASSET_INTEGRITY');
    expect(await fs.readFile(asset(relative))).toEqual(changed);
  }, 30_000);

  it.each(ids)('checks %s raw manifest pin BEFORE parsing even JSON-equivalent changes', async (id) => {
    const original = rawManifests.get(id)!;
    const changed = Buffer.from(original);
    changed[changed.indexOf(0x20)] = 0x09; // Same byte length and JSON value, different raw digest.
    expect(JSON.parse(changed.toString('utf8'))).toEqual(manifests.get(id));
    await overwrite(`${id}/manifest.json`, changed);
    const parse = vi.spyOn(sampleManifestSchema, 'parse');
    await expectFailure(getSampleAssets(id === 'beans' ? 'gwhd-2021' : 'beans', packaged), 'SAMPLE_ASSET_INTEGRITY');
    expect(parse).toHaveBeenCalledTimes(id === 'beans' ? 0 : 1);
    if (id === 'gwhd-2021') expect(parse.mock.calls[0]![0]).toEqual(manifests.get('beans'));
  });

  it.each(['root', 'nested', 'escaped-key'] as const)('rejects JSON-equivalent duplicate %s members without silently parsing them', async (kind) => {
    const text = JSON.stringify(manifests.get('beans'));
    const duplicate = kind === 'root' ? text.replace('{', '{"id":"beans",')
      : kind === 'nested' ? text.replace('"dataset":"Beans"', '"dataset":"Beans","dataset":"Beans"')
        : text.replace('{', '{"\\u0069d":"beans",');
    const raw = padded(duplicate, pins.beans.byteSize);
    expect(JSON.parse(raw.toString('utf8'))).toEqual(manifests.get('beans'));
    await overwrite('beans/manifest.json', raw);
    const parse = vi.spyOn(sampleManifestSchema, 'parse');
    await expectFailure(getSampleAssets('beans', packaged), 'SAMPLE_ASSET_INTEGRITY');
    expect(parse).not.toHaveBeenCalled();
  });

  it.each(['version', 'license', 'source-url', 'image-traversal', 'rehashed-notice'] as const)(
    'does not grant approval to a changed %s manifest or locally rehashed inventory', async (kind) => {
      const changed = structuredClone(manifests.get('beans')!);
      if (kind === 'version') Reflect.set(changed, 'schemaVersion', 2);
      else if (kind === 'license') Reflect.set(changed.licenses, 'images', 'unknown');
      else if (kind === 'source-url') Reflect.set(changed.source, 'url', 'https://example.invalid/private-token');
      else if (kind === 'image-traversal') Reflect.set(changed.images[0]!, 'path', '../outside.jpg');
      else {
        const bytes = flipped(await fs.readFile(asset('beans/LICENSE.txt')));
        await overwrite('beans/LICENSE.txt', bytes);
        changed.files.find((file) => file.path === 'LICENSE.txt')!.sha256 = digest(bytes);
        expect(sampleManifestSchema.safeParse(changed).success).toBe(true);
      }
      await overwrite('beans/manifest.json', padded(JSON.stringify(changed), pins.beans.byteSize));
      const parse = vi.spyOn(sampleManifestSchema, 'parse');
      await expectFailure(getSampleAssets('gwhd-2021', packaged), 'SAMPLE_ASSET_INTEGRITY');
      expect(parse).not.toHaveBeenCalled();
    });

  it.each(['root-directory', 'image-file', 'notice-alias'] as const)('rejects extra %s without exploring extra descendants', async (kind) => {
    const relative = kind === 'root-directory' ? 'unexpected' : kind === 'image-file'
      ? 'gwhd-2021/images/unreviewed.png' : 'beans/LICENSE.txt.old';
    if (kind === 'root-directory') {
      await fs.mkdir(asset(relative));
      undo.push(() => fs.rmdir(asset(relative)));
      await addFile(`${relative}/do-not-read`);
    } else await addFile(relative);
    const openDirectory = vi.spyOn(fs, 'opendir');
    const open = vi.spyOn(fs, 'open');
    await expectFailure(getSampleAssets('beans', packaged), 'SAMPLE_ASSET_INTEGRITY');
    expect(openDirectory.mock.calls.some(([path]) => String(path).startsWith(asset(relative)))).toBe(false);
    expect(open.mock.calls.some(([path]) => String(path).startsWith(asset(relative)))).toBe(false);
  });

  it.each(['dataset', 'notice', 'image'] as const)('rejects a case-aliased fixed %s name even on case-insensitive Windows', async (kind) => {
    const relative = kind === 'dataset' ? 'beans' : kind === 'notice' ? 'beans/LICENSE.txt' : image('gwhd-2021');
    const path = asset(relative);
    const name = win32.basename(path);
    const aliasName = kind === 'notice' ? name.toLowerCase() : name.toUpperCase();
    expect(aliasName).not.toBe(name);
    const saved = await aside(relative);
    const alias = win32.join(win32.dirname(path), aliasName);
    await fs.rename(saved, alias);
    undo.push(() => fs.rename(alias, saved));
    await expectFailure(getSampleAssets('beans', packaged), 'SAMPLE_ASSET_INTEGRITY');
  });

  it.each(['gwhd-2021/images', 'beans/images/healthy'])('rejects a missing fixed directory %s', async (relative) => {
    await aside(relative);
    await expectFailure(getSampleAssets('beans', packaged), 'SAMPLE_ASSET_IO');
  });

  it('requires regular files, not directories at a notice path', async () => {
    const relative = 'gwhd-2021/LICENSE.txt';
    await aside(relative);
    await fs.mkdir(asset(relative));
    undo.push(() => fs.rmdir(asset(relative)));
    await expectFailure(getSampleAssets('beans', packaged), 'SAMPLE_ASSET_UNSAFE');
  });

  it.each(['manifest', 'notice', 'image', 'coco'] as const)('rejects a native hardlink for %s, including an alias outside samples', async (kind) => {
    const relative = ({ manifest: 'beans/manifest.json', notice: 'beans/LICENSE.txt', image: image('gwhd-2021'),
      coco: 'gwhd-2021/annotations.coco.json' })[kind];
    const alias = win32.join(temporary, `hardlink-${++counter}`);
    await fs.link(asset(relative), alias); // NEVER link a repository asset.
    undo.push(() => fs.unlink(alias));
    expect((await fs.lstat(asset(relative), { bigint: true })).nlink).toBe(2n);
    await expectFailure(getSampleAssets('beans', packaged), 'SAMPLE_ASSET_UNSAFE');
  });

  it.each(['app-base', 'resources-base', 'samples-root', 'dataset-root', 'images-dir', 'label-dir'] as const)(
    'rejects a native %s junction before any asset is opened', async (kind) => {
      let input = packaged;
      if (kind === 'app-base' || kind === 'resources-base') {
        const alias = win32.join(temporary, `junction-${++counter}`);
        await fs.symlink(kind === 'app-base' ? appPath : resourcesPath, alias, 'junction');
        undo.push(() => fs.unlink(alias));
        input = kind === 'app-base' ? { ...dev, appPath: alias } : { ...packaged, resourcesPath: alias };
      } else {
        const relative = ({ 'samples-root': '', 'dataset-root': 'gwhd-2021',
          'images-dir': 'gwhd-2021/images', 'label-dir': 'beans/images/healthy' })[kind];
        const saved = await aside(relative);
        await fs.symlink(saved, asset(relative), 'junction');
        undo.push(() => fs.unlink(asset(relative)));
      }
      const open = vi.spyOn(fs, 'open');
      await expectFailure(getSampleAssets('beans', input), 'SAMPLE_ASSET_UNSAFE');
      expect(open).not.toHaveBeenCalled();
    });

  it('does not erase a native junction hidden by mixed separators and a parent segment', async () => {
    const alias = win32.join(temporary, `junction-${++counter}`);
    await fs.symlink(appPath, alias, 'junction');
    undo.push(() => fs.unlink(alias));
    const lstat = vi.spyOn(fs, 'lstat');
    await expectFailure(getSampleAssets('beans', { ...dev, appPath: `${alias}/../Application 日本語` }), 'SAMPLE_LOCATION');
    expect(lstat).not.toHaveBeenCalled();
  });

  it('rejects a native file symlink when the OS permits unprivileged creation', async ({ skip }) => {
    const relative = image('gwhd-2021');
    const saved = await aside(relative);
    try { await fs.symlink(saved, asset(relative), 'file'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') { skip(); return; }
      throw error;
    }
    undo.push(() => fs.unlink(asset(relative)));
    await expectFailure(getSampleAssets('beans', packaged), 'SAMPLE_ASSET_UNSAFE');
  });

  it.each(ids)('applies the combined actual 96 MiB budget to both datasets when resolving only %s', async (id) => {
    const lstat = fs.lstat;
    vi.spyOn(fs, 'lstat').mockImplementation(async (path, options) => {
      const stat = await lstat(path, options);
      if ('ctimeNs' in stat) {
        if (path === asset(image('beans'))) stat.size = 60n * 1024n * 1024n;
        if (path === asset(image('gwhd-2021'))) stat.size = 40n * 1024n * 1024n;
      }
      return stat;
    });
    const open = vi.spyOn(fs, 'open');
    await expectFailure(getSampleAssets(id, packaged), 'SAMPLE_ASSET_LIMIT');
    expect(open.mock.calls.map(([path]) => String(path))).toEqual(ids.map((sampleId) => asset(`${sampleId}/manifest.json`)));
  });

  it('bounds a repeated/aliased native directory entry and closes the iterator on rejection', async () => {
    const opendir = fs.opendir;
    let read: ReturnType<typeof vi.fn> | undefined;
    let closed: ReturnType<typeof vi.fn> | undefined;
    vi.spyOn(fs, 'opendir').mockImplementation(async (path, options) => {
      const directory = await opendir(path, options);
      expect(options).toEqual({ bufferSize: 1 });
      if (path === sampleRoot) {
        const nativeRead = directory.read.bind(directory);
        const entry = await nativeRead();
        expect(entry).not.toBeNull();
        read = vi.spyOn(directory, 'read').mockImplementation(async () => entry as Dirent);
        closed = vi.spyOn(directory, 'close');
      }
      return directory;
    });
    await expectFailure(getSampleAssets('beans', packaged), 'SAMPLE_ASSET_INTEGRITY');
    expect(read).toHaveBeenCalledTimes(2);
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it.each(stampFields.filter((field) => field !== 'ctimeNs'))('rejects an opened descriptor %s mismatch before reading', async (field) => {
    const target = asset(image('beans'));
    const open = fs.open;
    let opened: FileHandle | undefined;
    let reading: ReturnType<typeof vi.fn> | undefined;
    vi.spyOn(fs, 'open').mockImplementation(async (path, flags, mode) => {
      const handle = await open(path, flags, mode);
      if (path === target) {
        opened = handle;
        const stat = handle.stat.bind(handle);
        vi.spyOn(handle, 'stat').mockImplementation(async (options) => {
          const value = await stat(options);
          if ('ctimeNs' in value) value[field] += 1n;
          return value;
        });
        reading = vi.spyOn(handle, 'read');
      }
      return handle;
    });
    await expectFailure(getSampleAssets('beans', packaged), field === 'nlink' ? 'SAMPLE_ASSET_UNSAFE' : 'SAMPLE_ASSET_CHANGED');
    expect(reading).not.toHaveBeenCalled();
    expect(opened?.fd).toBe(-1);
  });

  it.each(stampFields.flatMap((field) => (['handle', 'path'] as const).map((api) => ({ field, api }))))(
    'rejects post-read $api $field changes against that API\'s own snapshot', async ({ api, field }) => {
      const target = asset(image('beans'));
      const open = fs.open;
      const lstat = fs.lstat;
      let reachedEof = false;
      let opened: FileHandle | undefined;
      vi.spyOn(fs, 'open').mockImplementation(async (path, flags, mode) => {
        const handle = await open(path, flags, mode);
        if (path === target) {
          opened = handle;
          const read = handle.read.bind(handle);
          mockDescriptorRead(handle, async (buffer, offset, length, position) => {
            const result = await read(buffer, offset, length, position);
            if (result.bytesRead === 0) reachedEof = true;
            return result;
          });
          const stat = handle.stat.bind(handle);
          vi.spyOn(handle, 'stat').mockImplementation(async (options) => {
            const value = await stat(options);
            if (api === 'handle' && reachedEof && 'ctimeNs' in value) value[field] += 1n;
            return value;
          });
        }
        return handle;
      });
      vi.spyOn(fs, 'lstat').mockImplementation(async (path, options) => {
        const value = await lstat(path, options);
        if (path === target && api === 'path' && reachedEof && 'ctimeNs' in value) value[field] += 1n;
        return value;
      });
      await expectFailure(getSampleAssets('beans', packaged), field === 'nlink' ? 'SAMPLE_ASSET_UNSAFE' : 'SAMPLE_ASSET_CHANGED');
      expect(reachedEof).toBe(true);
      expect(opened?.fd).toBe(-1);
    }, 30_000);

  it('fails closed when a filesystem cannot supply a nonzero file identity', async () => {
    const lstat = fs.lstat;
    vi.spyOn(fs, 'lstat').mockImplementation(async (path, options) => {
      const stat = await lstat(path, options);
      if (path === asset('beans/manifest.json') && 'ctimeNs' in stat) stat.ino = 0n;
      return stat;
    });
    const open = vi.spyOn(fs, 'open');
    await expectFailure(getSampleAssets('beans', packaged), 'SAMPLE_ASSET_UNSAFE');
    expect(open).not.toHaveBeenCalled();
  });

  it.each(['api-difference', 'path-settlement'] as const)('accepts stable Windows ctime %s without relaxing content or final checks', async (kind) => {
    const target = asset(image('beans'));
    const open = fs.open;
    const lstat = fs.lstat;
    const lstatSync = native.lstatSync;
    let opened = false;
    vi.spyOn(fs, 'open').mockImplementation(async (path, flags, mode) => {
      const handle = await open(path, flags, mode);
      if (path === target) {
        opened = true;
        const stat = handle.stat.bind(handle);
        vi.spyOn(handle, 'stat').mockImplementation(async (options) => {
          const value = await stat(options);
          if ('ctimeNs' in value) value.ctimeNs += 100n;
          return value;
        });
      }
      return handle;
    });
    vi.spyOn(fs, 'lstat').mockImplementation(async (path, options) => {
      const value = await lstat(path, options);
      if (path === target && opened && kind === 'path-settlement' && 'ctimeNs' in value) value.ctimeNs += 7n;
      return value;
    });
    vi.spyOn(native, 'lstatSync').mockImplementation((path, options) => {
      const value = lstatSync(path, options);
      if (path === target && opened && kind === 'path-settlement' && value && 'ctimeNs' in value) value.ctimeNs += 7n;
      return value;
    });
    expect((await getSampleAssets('beans', packaged)).rootPath).toBe(asset('beans'));
    expect(opened).toBe(true);
  }, 30_000);

  it.each([false, true])('allows pre-hash ctime settlement but still checks the independent payload pin (corrupt=%s)', async (corrupt) => {
    const relative = image('beans');
    const target = asset(relative);
    if (corrupt) await overwrite(relative, flipped(await fs.readFile(target)));
    const lstat = fs.lstat;
    let calls = 0;
    vi.spyOn(fs, 'lstat').mockImplementation(async (path, options) => {
      const value = await lstat(path, options);
      // The first lstat is inventory-only. Subsequent reads use the actual
      // stable stamp; identity, size and mtime were never changed by this spy.
      if (path === target && 'ctimeNs' in value && ++calls === 1) value.ctimeNs -= 7n;
      return value;
    });
    if (corrupt) await expectFailure(getSampleAssets('beans', packaged), 'SAMPLE_ASSET_INTEGRITY');
    else expect((await getSampleAssets('beans', packaged)).rootPath).toBe(asset('beans'));
    expect(calls).toBeGreaterThan(2);
  }, 30_000);

  it('uses directory identity and exact children rather than timestamp-only changes', async () => {
    const lstatSync = native.lstatSync;
    let observed = false;
    vi.spyOn(native, 'lstatSync').mockImplementation((path, options) => {
      const value = lstatSync(path, options);
      if (path === asset('beans/images') && value && 'ctimeNs' in value) {
        value.ctimeNs += 7n;
        value.mtimeNs += 7n;
        observed = true;
      }
      return value;
    });
    expect((await getSampleAssets('beans', packaged)).rootPath).toBe(asset('beans'));
    expect(observed).toBe(true);
  }, 30_000);

  it('rejects early descriptor EOF even when stat still claims the expected length', async () => {
    const relative = image('beans');
    const expectedSize = inventory.get(relative)!.byteSize;
    const open = fs.open;
    let opened: FileHandle | undefined;
    let reachedEof = false;
    let bytes = 0;
    vi.spyOn(fs, 'open').mockImplementation(async (path, flags, mode) => {
      const handle = await open(path, flags, mode);
      if (path === asset(relative)) {
        opened = handle;
        const read = handle.read.bind(handle);
        mockDescriptorRead(handle, async (buffer, offset, length, position) => {
          if (position >= expectedSize - 1) {
            reachedEof = true;
            return { bytesRead: 0, buffer };
          }
          const result = await read(buffer, offset, Math.min(length, expectedSize - 1 - position), position);
          bytes += result.bytesRead;
          return result;
        });
      }
      return handle;
    });
    await expectFailure(getSampleAssets('beans', packaged), 'SAMPLE_ASSET_INTEGRITY');
    expect(reachedEof).toBe(true);
    expect(bytes).toBe(expectedSize - 1);
    expect(opened?.fd).toBe(-1);
    expect((await fs.stat(asset(relative))).size).toBe(expectedSize);
  });

  it('bounds a file that grows before the second descriptor read and closes it after the extra byte is detected', async () => {
    const relative = image('beans');
    const target = asset(relative);
    const raw = await fs.readFile(target);
    undo.push(() => fs.writeFile(target, raw));
    const open = fs.open;
    let opened: FileHandle | undefined;
    let readCalls = 0;
    let bytes = 0;
    vi.spyOn(fs, 'open').mockImplementation(async (path, flags, mode) => {
      const handle = await open(path, flags, mode);
      if (path === target) {
        opened = handle;
        const read = handle.read.bind(handle);
        mockDescriptorRead(handle, async (buffer, offset, length, position) => {
          readCalls += 1;
          if (readCalls === 2) native.appendFileSync(target, 'x'); // Only this copied temporary image.
          expect(length).toBeLessThanOrEqual(65_536);
          expect(position + length).toBeLessThanOrEqual(raw.length + 1);
          const result = await read(buffer, offset, length, position);
          bytes += result.bytesRead;
          return result;
        });
      }
      return handle;
    });
    await expectFailure(getSampleAssets('beans', packaged), 'SAMPLE_ASSET_INTEGRITY');
    expect(readCalls).toBeGreaterThanOrEqual(2);
    expect(bytes).toBe(raw.length + 1);
    expect(opened?.fd).toBe(-1);
    expect((await fs.stat(target)).size).toBe(raw.length + 1);
  });

  it('sanitizes descriptor read failures and closes its opened handle without logging', async () => {
    const target = asset(image('beans'));
    const open = fs.open;
    const log = vi.spyOn(console, 'error');
    let opened: FileHandle | undefined;
    let readCalls = 0;
    let bytes = 0;
    vi.spyOn(fs, 'open').mockImplementation(async (path, flags, mode) => {
      const handle = await open(path, flags, mode);
      if (path === target) {
        opened = handle;
        const read = handle.read.bind(handle);
        mockDescriptorRead(handle, async (buffer, offset, length, position) => {
          readCalls += 1;
          if (readCalls === 2) throw new Error(`secret-native ${target}`);
          const result = await read(buffer, offset, length, position);
          bytes += result.bytesRead;
          return result;
        });
      }
      return handle;
    });
    const failure = await expectFailure(getSampleAssets('beans', packaged), 'SAMPLE_ASSET_IO');
    expect(failure.message).toBe('同梱サンプル素材を読み取れません。');
    expect(readCalls).toBe(2);
    expect(bytes).toBeGreaterThan(0);
    expect(opened?.fd).toBe(-1);
    expect(log).not.toHaveBeenCalled();
  });

  it('rejects invalid native bytesRead counts and closes each handle without logging', async () => {
    const open = fs.open;
    const log = vi.spyOn(console, 'error');
    for (const bytesRead of [-1, 0.5, NaN, Infinity, pins.beans.byteSize + 1]) {
      let opened: FileHandle | undefined;
      let reading: ReturnType<typeof vi.fn> | undefined;
      let closed: ReturnType<typeof vi.fn> | undefined;
      let actualBytes: number | undefined;
      const opening = vi.spyOn(fs, 'open').mockImplementation(async (path, flags, mode) => {
        const handle = await open(path, flags, mode);
        if (path === asset('beans/manifest.json')) {
          opened = handle;
          const read = handle.read.bind(handle);
          reading = mockDescriptorRead(handle, async (buffer, offset, length, position) => {
            const result = await read(buffer, offset, length, position);
            actualBytes = result.bytesRead;
            return { ...result, bytesRead };
          });
          closed = vi.spyOn(handle, 'close');
        }
        return handle;
      });
      try {
        await expectFailure(getSampleAssets('beans', packaged), 'SAMPLE_ASSET_IO');
        expect(opening).toHaveBeenCalledTimes(1);
        expect(reading).toHaveBeenCalledTimes(1);
        expect(actualBytes).toBe(pins.beans.byteSize);
        expect(closed).toHaveBeenCalledTimes(1);
        expect(opened?.fd).toBe(-1);
      } finally { opening.mockRestore(); }
    }
    expect(log).not.toHaveBeenCalled();
  });

  it('sanitizes native open errors without logging paths or retrying', async () => {
    const open = vi.spyOn(fs, 'open').mockRejectedValue(new Error(`secret-native ${sampleRoot}`));
    const log = vi.spyOn(console, 'error');
    await expectFailure(getSampleAssets('beans', packaged), 'SAMPLE_ASSET_IO');
    expect(open).toHaveBeenCalledTimes(1);
    expect(log).not.toHaveBeenCalled();
  });

  it('sanitizes directory enumeration errors rather than returning partial assets', async () => {
    const opendir = vi.spyOn(fs, 'opendir').mockRejectedValue(new Error(`secret-native ${sampleRoot}`));
    await expectFailure(getSampleAssets('beans', packaged), 'SAMPLE_ASSET_IO');
    expect(opendir).toHaveBeenCalledTimes(1);
  });

  it('does not publish assets when a handle close acknowledgement fails', async () => {
    const open = fs.open;
    const log = vi.spyOn(console, 'error');
    let opened: FileHandle | undefined;
    let closed: ReturnType<typeof vi.fn> | undefined;
    let reachedEof = false;
    let bytes = 0;
    vi.spyOn(fs, 'open').mockImplementation(async (path, flags, mode) => {
      const handle = await open(path, flags, mode);
      if (path === asset('beans/manifest.json')) {
        opened = handle;
        const read = handle.read.bind(handle);
        mockDescriptorRead(handle, async (buffer, offset, length, position) => {
          const result = await read(buffer, offset, length, position);
          bytes += result.bytesRead;
          if (result.bytesRead === 0) reachedEof = true;
          return result;
        });
        const close = handle.close.bind(handle);
        closed = vi.spyOn(handle, 'close').mockImplementation(async () => {
          await close();
          throw new Error(`secret-native ${path}`);
        });
      }
      return handle;
    });
    await expectFailure(getSampleAssets('beans', packaged), 'SAMPLE_ASSET_IO');
    expect(reachedEof).toBe(true);
    expect(bytes).toBe(pins.beans.byteSize);
    expect(closed).toHaveBeenCalledTimes(1);
    expect(opened?.fd).toBe(-1);
    expect(log).not.toHaveBeenCalled();
  });

  it.each(['earlier-bytes', 'earlier-replacement', 'extra-entry', 'missing-entry'] as const)(
    'final snapshots detect %s introduced while hashing a later file', async (kind) => {
      const earlier = image('beans');
      const target = asset(earlier);
      const later = asset(image('gwhd-2021', -1));
      const raw = await fs.readFile(target);
      const originalStat = await fs.stat(target);
      const open = fs.open;
      let changed = false;
      let earlierReads = 0;
      vi.spyOn(fs, 'open').mockImplementation(async (path, flags, mode) => {
        if (path === target) earlierReads += 1;
        if (path === later && !changed) {
          changed = true;
          expect(earlierReads).toBe(1);
          if (kind === 'earlier-bytes') {
            await overwrite(earlier, flipped(raw));
            await fs.utimes(target, originalStat.atime, originalStat.mtime);
          } else if (kind === 'earlier-replacement') {
            await aside(earlier);
            await fs.writeFile(target, raw, { flag: 'wx' });
            undo.push(() => fs.unlink(target));
          } else if (kind === 'extra-entry') await addFile('beans/late-extra');
          else await aside('beans/ATTRIBUTION.txt');
        }
        return open(path, flags, mode);
      });
      const failure = await expectFailure(getSampleAssets('beans', packaged));
      expect(changed).toBe(true);
      if (kind === 'earlier-bytes') {
        // Date-based utimes may not restore every mtime nanosecond. A changed
        // mtime must stop before reopening; ctime alone permits one ORIGINAL
        // pin check that must reject the wrong bytes, never silently rebase.
        expect([1, 2]).toContain(earlierReads);
        expect(failure.code).toBe(earlierReads === 2 ? 'SAMPLE_ASSET_INTEGRITY' : 'SAMPLE_ASSET_CHANGED');
      } else expect(earlierReads).toBe(1);
    }, 30_000);

  it('rejects a root replaced by a junction after parent checks but before a later open', async () => {
    const later = asset(image('gwhd-2021', -1));
    const open = fs.open;
    let changed = false;
    vi.spyOn(fs, 'open').mockImplementation(async (path, flags, mode) => {
      if (path === later && !changed) {
        changed = true;
        const saved = await aside('');
        await fs.symlink(saved, sampleRoot, 'junction');
        undo.push(() => fs.unlink(sampleRoot));
      }
      return open(path, flags, mode);
    });
    await expectFailure(getSampleAssets('beans', packaged), 'SAMPLE_ASSET_UNSAFE');
    expect(changed).toBe(true);
  }, 30_000);

  it('does not cache a previous success or skip the unselected dataset on reuse', async () => {
    const first = await getSampleAssets('beans', packaged);
    const relative = image('gwhd-2021');
    await overwrite(relative, flipped(await fs.readFile(asset(relative))));
    await expectFailure(getSampleAssets('beans', packaged), 'SAMPLE_ASSET_INTEGRITY');
    expect(first.rootPath).toBe(asset('beans'));
    expectFrozen(first);
  }, 30_000);

  it('does not adopt an unrelated canonical root or short-name expansion from realpath', async () => {
    const realpath = fs.realpath;
    vi.spyOn(fs, 'realpath').mockImplementation(async (path, options) => {
      if (path === sampleRoot) return `${sampleRoot}-other`;
      return realpath(path, options);
    });
    const open = vi.spyOn(fs, 'open');
    await expectFailure(getSampleAssets('beans', packaged), 'SAMPLE_ASSET_UNSAFE');
    expect(open).not.toHaveBeenCalled();
  });

  it.each(['ctime-only', 'wrong-bytes', 'identity', 'second-final'] as const)(
    'bounds final %s confirmation with exact fixture stamps and the original pin', async (kind) => {
      const relative = image('beans');
      const target = asset(relative);
      const raw = await fs.readFile(target);
      const originalTimes = await fs.stat(target);
      const snapshots = new Map<string, Readonly<Pick<BigIntStats, typeof stampFields[number]>>>();
      // Fix the test's exact stamps before installing any spies. Real copy-time
      // timestamp differences must not select extra files or shift our phase;
      // freeze only primitive copies, not native Stats or approval metadata.
      for (const name of inventory.keys()) {
        const value = await fs.lstat(asset(name), { bigint: true });
        snapshots.set(asset(name), Object.freeze({ dev: value.dev, ino: value.ino, birthtimeNs: value.birthtimeNs,
          mode: value.mode, nlink: value.nlink, size: value.size, mtimeNs: value.mtimeNs, ctimeNs: value.ctimeNs }));
      }
      const original = snapshots.get(target)!;
      let finalChecks = 0;
      function fixedStamp(path: string, value: BigIntStats): void {
        const initial = snapshots.get(path);
        if (!initial) return;
        for (const field of stampFields) value[field] = initial[field];
        if (path === target && finalChecks > 0) value.ctimeNs = initial.ctimeNs + 7n;
      }
      const lstat = fs.lstat;
      const lstatSync = native.lstatSync;
      const open = fs.open;
      const handles: FileHandle[] = [];
      const closes: ReturnType<typeof vi.fn>[] = [];
      const payloads: { bytes: number; hash: ReturnType<typeof createHash> }[] = [];
      vi.spyOn(fs, 'lstat').mockImplementation(async (path, options) => {
        const value = await lstat(path, options);
        if ('ctimeNs' in value) fixedStamp(String(path), value);
        return value;
      });
      const opening = vi.spyOn(fs, 'open').mockImplementation(async (path, flags, mode) => {
        const handle = await open(path, flags, mode);
        handles.push(handle);
        closes.push(vi.spyOn(handle, 'close'));
        const stat = handle.stat.bind(handle);
        vi.spyOn(handle, 'stat').mockImplementation(async (options) => {
          const value = await stat(options);
          if ('ctimeNs' in value) fixedStamp(String(path), value);
          return value;
        });
        if (path === target) {
          const payload = { bytes: 0, hash: createHash('sha256') };
          payloads.push(payload);
          const read = handle.read.bind(handle);
          mockDescriptorRead(handle, async (buffer, offset, length, position) => {
            const result = await read(buffer, offset, length, position);
            payload.bytes += result.bytesRead;
            payload.hash.update(buffer.subarray(offset, offset + result.bytesRead));
            return result;
          });
        }
        return handle;
      });
      vi.spyOn(native, 'lstatSync').mockImplementation((path, options) => {
        if (path === target) {
          finalChecks += 1;
          expect(finalChecks).toBeLessThanOrEqual(2);
          expect(opening.mock.calls).toHaveLength(inventory.size + finalChecks - 1);
          expect(handles.every((handle) => handle.fd === -1)).toBe(true);
          if (kind === 'wrong-bytes' && finalChecks === 1) {
            undo.push(() => fs.writeFile(target, raw));
            native.writeFileSync(target, flipped(raw));
            native.utimesSync(target, originalTimes.atime, originalTimes.mtime);
            // The actual temporary bytes changed; fixedStamp restores exact
            // mtimeNs as well, so only the original payload pin can reject them.
          }
        }
        const value = lstatSync(path, options);
        if (value && 'ctimeNs' in value) {
          fixedStamp(String(path), value);
          if (path === target && kind === 'identity') value.ino = original.ino + 1n;
          if (path === target && kind === 'second-final' && finalChecks === 2) value.ctimeNs = original.ctimeNs + 14n;
        }
        return value;
      });
      const resolving = getSampleAssets('beans', packaged);
      if (kind === 'ctime-only') {
        const assets = await resolving;
        expect(assets).toMatchObject({ id: 'beans', readOnly: true, rootPath: asset('beans') });
        expectFrozen(assets);
      } else await expectFailure(resolving, kind === 'wrong-bytes' ? 'SAMPLE_ASSET_INTEGRITY' : 'SAMPLE_ASSET_CHANGED');
      const passes = kind === 'identity' ? 1 : 2;
      expect(payloads).toHaveLength(passes);
      expect(opening.mock.calls).toHaveLength(inventory.size + passes - 1);
      expect(finalChecks).toBe(kind === 'ctime-only' || kind === 'second-final' ? 2 : 1);
      for (const [index, payload] of payloads.entries()) {
        expect(payload.bytes).toBe(inventory.get(relative)!.byteSize);
        expect(payload.hash.digest('hex')).toBe(kind === 'wrong-bytes' && index === 1
          ? digest(flipped(raw)) : inventory.get(relative)!.sha256);
      }
      expect(handles.every((handle) => handle.fd === -1)).toBe(true);
      for (const close of closes) expect(close).toHaveBeenCalledTimes(1);
    }, 30_000);
});