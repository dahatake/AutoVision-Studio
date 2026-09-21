// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto';
import native from 'node:fs';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const electron = vi.hoisted(() => ({ createFromBuffer: vi.fn() }));
vi.mock('electron', () => ({ nativeImage: { createFromBuffer: electron.createFromBuffer } }));

import type { ScanResult } from '../../shared/contracts/import.js';
import { insertImportLabels, prepareImportLabels } from '../annotations/label-schema-service.js';
import { createAnnotationWorkspace } from '../annotations/workspace-service.js';
import { openDatabase, type DatabaseConnection } from '../db/database.js';
import { migrateDatabase } from '../db/migrate.js';
import { createProjectDirectory } from '../projects/project-directory.js';
import * as safePath from '../security/safe-path.js';
import { insertDataImport, prepareDataImport, type ImportSourceManifest } from './import-repository.js';
import * as reference from './reference-access.js';
import {
  createImageProtocol, IMAGE_PROTOCOL_MAX_READS, IMAGE_PROTOCOL_RESERVED_BYTES,
  IMAGE_THUMBNAIL_MAX_EDGE, IMAGE_THUMBNAIL_MAX_PIXELS, SCHEME,
} from './image-protocol.js';

const realCopyRead = safePath.readProjectImage;
const realReferenceRead = reference.readVerifiedReferenceImage;
const stamp = '2026-09-13T00:00:00.000Z';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ9sAAAAASUVORK5CYII=', 'base64');
// Deterministic test-owned solid-color PNG at an arbitrary size, needed to
// exercise the real width/height header parsed by image-protocol's own
// dimensions() check (independent of any DB-recorded width/height columns).
function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function solidPng(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const length = Buffer.alloc(4), checksum = Buffer.alloc(4);
    length.writeUInt32BE(data.length); checksum.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 2; // 8-bit RGB; deflate, filter method 0, non-interlaced.
  const row = Buffer.from([0, ...Array.from({ length: width * 3 }, () => 128)]);
  const pixels = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
const migrationNames = ['001_core', '002_jobs', '003_import', '004_import_generation', '005_import_rights', '006_annotations'];
const migrations = migrationNames.map((name, index) => ({ version: index + 1,
  sql: native.readFileSync(new URL(`../db/migrations/${name}.sql`, import.meta.url), 'utf8') }));

describe.skipIf(process.platform !== 'win32')('DAT14D image protocol, real SQLite/source readers', () => {
  let directory: string;
  let database: DatabaseConnection;
  let protocol: ReturnType<typeof createImageProtocol>;

  beforeEach(async () => {
    electron.createFromBuffer.mockImplementation((bytes: Buffer) => ({
      isEmpty: () => false,
      getSize: () => ({ width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }),
      resize: vi.fn(({ width }: { width: number }) => ({
        toPNG: () => Buffer.concat([Buffer.from('thumbnail:'), bytes]),
        getSize: () => ({ width, height: width / 2 }),
      })),
      toPNG: () => Buffer.from(bytes),
    }));
    directory = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'av-dat14d-')));
    database = openDatabase(join(directory, 'metadata.sqlite3'));
    migrateDatabase(database, migrations);
    protocol = createImageProtocol(database);
  });
  afterEach(async () => {
    await protocol.dispose();
    vi.restoreAllMocks();
    if (database.open) database.close();
    await fs.rm(directory, { recursive: true, force: true });
  });

  async function fixture(mode: 'copy' | 'reference' = 'copy', bytes: Buffer = png) {
    const projectId = randomUUID(), jobId = randomUUID(), importId = randomUUID();
    const project = createProjectDirectory(directory, projectId, []);
    const path = join(project.rootPath, 'image.bin');
    await fs.writeFile(path, bytes, { flag: 'wx' });
    const image = { key: 'image:0', sourcePath: path, byteSize: bytes.length,
      mtimeNs: String(native.lstatSync(path, { bigint: true }).mtimeNs),
      sha256: createHash('sha256').update(bytes).digest('hex'), format: 'png' as const,
      width: 1, height: 1, orientation: 1 as const, duplicateOf: null, annotation: null };
    const scan: ScanResult = { formatVersion: 1, jobId, projectId, taskType: 'classification', mode,
      classes: [], images: [image], issues: [] };
    // Real issuance and normal import/workspace services; no forged WeakMap capabilities.
    const manifest: ImportSourceManifest = mode === 'copy'
      ? { formatVersion: 1, mode, entries: [{ imageKey: image.key, relativePath: 'image.bin',
        byteSize: image.byteSize, sha256: image.sha256 }] }
      : { formatVersion: 1, mode, entries: [await reference.captureReferenceSource(image)] };
    database.prepare(`INSERT INTO projects(id,name,task_type,workspace_path,created_at,updated_at)
      VALUES (?,?,?,?,?,?)`).run(projectId, 'Image fixture', 'classification', project.rootPath, stamp, stamp);
    database.prepare(`INSERT INTO jobs(id,project_id,kind,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?)`).run(jobId, projectId, 'scan-dataset', 'Succeeded', stamp, stamp);
    const prepared = prepareDataImport({ id: importId, createdAt: stamp, updatedAt: stamp,
      scanResult: scan, sourceManifest: manifest });
    const labels = prepareImportLabels(database, projectId, []);
    database.exec('BEGIN');
    try {
      insertDataImport(database, prepared);
      insertImportLabels(database, labels);
      database.exec('COMMIT');
    } finally { if (database.inTransaction) database.exec('ROLLBACK'); }
    const { workspace } = createAnnotationWorkspace(database, projectId, importId, labels.schemaId, labels.classMapping);
    const item = database.prepare('SELECT id FROM annotation_items WHERE workspace_id=?').get(workspace.id) as { id: string };
    return { projectId, project, path, url: `${SCHEME}://image/${projectId}/${workspace.id}/${item.id}` };
  }

  it.each(['copy', 'reference'] as const)('serves exact %s bytes with safe headers outside all transactions', async (mode) => {
    const binding = await fixture(mode);
    vi.spyOn(reference, 'readVerifiedReferenceImage').mockImplementation(async (...args) => {
      expect(database.inTransaction).toBe(false);
      return realReferenceRead(...args);
    });
    const result = await protocol.handle(new Request(binding.url, { headers: { Origin: 'null' } }));
    expect(result.status).toBe(200);
    expect(result.headers.get('Content-Type')).toBe('image/png');
    expect(result.headers.get('Cache-Control')).toBe('no-store');
    expect(result.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(result.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
    expect(result.headers.get('Access-Control-Allow-Origin')).toBe('null');
    expect(Buffer.from(await result.arrayBuffer())).toEqual(png);
    expect(database.inTransaction).toBe(false);
    expect(native.readFileSync(binding.path)).toEqual(png);
  });

  it.each(['copy', 'reference'] as const)('passes a thumbnail through unresized when already within bounds (%s)', async (mode) => {
    const binding = await fixture(mode);
    const result = await protocol.handle(new Request(binding.url.replace('://image/', '://thumbnail/')));
    expect(result.status).toBe(200);
    expect(result.headers.get('Content-Type')).toBe('image/png');
    expect(result.headers.get('Cache-Control')).toBe('no-store');
    expect(Buffer.from(await result.arrayBuffer())).toEqual(png);
    expect(electron.createFromBuffer).toHaveBeenCalledWith(png);
    const decoded = electron.createFromBuffer.mock.results.at(-1)!.value;
    expect(decoded.resize).not.toHaveBeenCalled();
    expect(IMAGE_THUMBNAIL_MAX_EDGE).toBe(256);
    expect(IMAGE_THUMBNAIL_MAX_PIXELS).toBe(4_000_000);
    expect(native.readFileSync(binding.path)).toEqual(png);
  });

  it('downsizes a PNG thumbnail whose longer edge exceeds the bound, keeping aspect ratio', async () => {
    const large = solidPng(400, 100);
    const binding = await fixture('copy', large);
    const result = await protocol.handle(new Request(binding.url.replace('://image/', '://thumbnail/')));
    expect(result.status).toBe(200);
    expect(result.headers.get('Content-Type')).toBe('image/png');
    expect(Buffer.from(await result.arrayBuffer())).toEqual(Buffer.concat([Buffer.from('thumbnail:'), large]));
    expect(electron.createFromBuffer).toHaveBeenCalledWith(large);
    const decoded = electron.createFromBuffer.mock.results.at(-1)!.value;
    expect(decoded.resize).toHaveBeenCalledWith({ width: IMAGE_THUMBNAIL_MAX_EDGE, quality: 'good' });
  });

  it('downsizes a portrait PNG thumbnail by its longer (height) edge', async () => {
    const tall = solidPng(100, 400);
    const binding = await fixture('copy', tall);
    const result = await protocol.handle(new Request(binding.url.replace('://image/', '://thumbnail/')));
    expect(result.status).toBe(200);
    const decoded = electron.createFromBuffer.mock.results.at(-1)!.value;
    expect(decoded.resize).toHaveBeenCalledWith({ height: IMAGE_THUMBNAIL_MAX_EDGE, quality: 'good' });
  });

  it('rejects an over-pixel-budget thumbnail header before ever invoking the native decoder', async () => {
    // A minimal IHDR-only header is sufficient: the pre-decode pixel-count gate
    // reads width/height straight from the header, so a decompression-bomb-
    // shaped IDAT is unnecessary to exercise (and would be reached only after
    // this gate, which is exactly the ordering being verified here).
    const oversized = Buffer.alloc(64, 0);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(oversized, 0);
    oversized.write('IHDR', 12, 'ascii');
    oversized.writeUInt32BE(3000, 16); oversized.writeUInt32BE(3000, 20); // 9,000,000 > 4,000,000
    const binding = await fixture('copy', oversized);
    electron.createFromBuffer.mockClear();
    const result = await protocol.handle(new Request(binding.url.replace('://image/', '://thumbnail/')));
    expect(result.status).toBe(404);
    expect(await result.text()).toBe('');
    expect(electron.createFromBuffer).not.toHaveBeenCalled();
    expect((await protocol.handle(new Request(binding.url))).status).toBe(200);
  });

  it('rejects a thumbnail whose decoded size disagrees with its own header, without leaking bytes', async () => {
    const binding = await fixture('copy', png);
    electron.createFromBuffer.mockReturnValueOnce({ isEmpty: () => false, getSize: () => ({ width: 2, height: 2 }) });
    const result = await protocol.handle(new Request(binding.url.replace('://image/', '://thumbnail/')));
    expect(result.status).toBe(404);
    expect(await result.text()).toBe('');
  });

  it('rejects raw aliases, methods, ranges and non-file origins before DB/FS access', async () => {
    const id = 'abcdef01-2345-4678-9abc-0123456789ab';
    const url = `${SCHEME}://image/${id}/${id}/${id}`;
    const query = vi.spyOn(database, 'prepare'), execute = vi.spyOn(database, 'exec');
    const open = vi.spyOn(fs, 'open'), stat = vi.spyOn(native, 'lstatSync');
    for (const raw of [url.toUpperCase(), url + '/', url + '?', url + '#', url + '?x=1', url + '#x',
      url.replace('image/', 'image:80/'), url.replace('image/', 'user@image/'), url.replace('image/', 'IMAGE/'),
      url.replace(id, `%61${id.slice(1)}`), url.replace(`/${id}/`, `/${id}/../${id}/`),
      url.replace(`/${id}/`, `//${id}/`), url.replaceAll('/', '\\'), url + '\n',
      url.replace('av-image:', 'https:'), url.replace('image/', 'image./'),
      url.replace('image/', 'thumbnail./'), url.replace('image/', 'THUMBNAIL/'),
      url.replace('image/', 'thumbnail:80/')]) {
      const request = new Request(url);
      Object.defineProperty(request, 'url', { value: raw }); // Preserve pre-normalization transport spelling.
      const response = await protocol.handle(request);
      expect(response.status, raw).toBe(404);
      expect(await response.text()).toBe('');
    }
    for (const method of ['POST', 'HEAD', 'PUT', 'DELETE', 'OPTIONS'])
      expect((await protocol.handle(new Request(url, { method }))).status).toBe(405);
    expect((await protocol.handle(new Request(url, { headers: { Range: 'bytes=0-1' } }))).status).toBe(416);
    expect((await protocol.handle(new Request(url, { headers: { Origin: 'https://example.invalid' } }))).status).toBe(403);
    for (const spy of [query, execute, open, stat]) expect(spy).not.toHaveBeenCalled();
  });

  it('rejects invalid thumbnail decoding without exposing bytes or retaining capacity', async () => {
    const binding = await fixture();
    electron.createFromBuffer.mockReturnValueOnce({
      isEmpty: () => true,
    });
    const url = binding.url.replace('://image/', '://thumbnail/');
    const result = await protocol.handle(new Request(url));
    expect(result.status).toBe(404);
    expect(await result.text()).toBe('');
    expect((await protocol.handle(new Request(binding.url))).status).toBe(200);
  });

  it.each([
    ['webp', Buffer.from('RIFFxxxxWEBP')],
    ['bmp', Buffer.concat([Buffer.from('BM'), Buffer.alloc(52)])],
    ['tiff', Buffer.from([73, 73, 42, 0, 8, 0, 0, 0])],
  ] as const)('returns 415 for unsupported %s thumbnails without invoking the decoder', async (_format, bytes) => {
    const binding = await fixture('copy', Buffer.from(bytes));
    electron.createFromBuffer.mockClear();
    const result = await protocol.handle(new Request(binding.url.replace('://image/', '://thumbnail/')));
    expect(result.status).toBe(415);
    expect(electron.createFromBuffer).not.toHaveBeenCalled();
  });

  it('returns empty missing/foreign responses and leaves external transactions untouched', async () => {
    const binding = await fixture();
    const foreign = binding.url.replace(binding.projectId, randomUUID());
    for (const url of [foreign, binding.url.replace(/[^/]+$/u, randomUUID())]) {
      const result = await protocol.handle(new Request(url));
      expect(result.status).toBe(404); expect(await result.text()).toBe('');
    }
    database.exec('BEGIN');
    const result = await protocol.handle(new Request(binding.url));
    expect(result.status).toBe(503); expect(database.inTransaction).toBe(true);
    database.exec('ROLLBACK');
  });

  it.each(['hash', 'inode'] as const)('rejects changed Reference %s without leaking paths', async (kind) => {
    const binding = await fixture('reference');
    if (kind === 'inode') await fs.rename(binding.path, `${binding.path}.old`);
    await fs.writeFile(binding.path, kind === 'hash' ? Buffer.alloc(png.length, 1) : png);
    const result = await protocol.handle(new Request(binding.url));
    expect(result.status).toBe(404); expect(await result.text()).toBe('');
    expect([...result.headers.values()].join(' ')).not.toContain(directory);
  });

  it('does not roll back a foreign transaction after COMMIT acknowledgement loss', async () => {
    const binding = await fixture();
    const exec = database.exec.bind(database);
    vi.spyOn(database, 'exec').mockImplementation((sql) => {
      const result = exec(sql);
      if (sql === 'COMMIT') {
        exec('BEGIN');
        database.prepare('INSERT INTO settings(key,value) VALUES (?,?)').run('foreign-image-test', 'retained');
        throw new Error(`Private native COMMIT failure: ${directory}`);
      }
      return result;
    });
    const result = await protocol.handle(new Request(binding.url));
    expect(result.status).toBe(503); expect(await result.text()).toBe('');
    expect(database.inTransaction).toBe(true);
    expect(database.prepare('SELECT value FROM settings WHERE key=?').get('foreign-image-test')).toEqual({ value: 'retained' });
    exec('ROLLBACK');
  });

  it('suppresses native reader messages and frees failed request resources', async () => {
    const binding = await fixture();
    vi.spyOn(safePath, 'readProjectImage').mockRejectedValueOnce(new Error(`Native private path: ${binding.path}`));
    const result = await protocol.handle(new Request(binding.url));
    expect(result.status).toBe(404); expect(await result.text()).toBe('');
    const next = await protocol.handle(new Request(binding.url));
    expect(next.status).toBe(200); await next.body!.cancel();
  });

  it.each(['copy', 'reference'] as const)('rejects %s DB changes after the real reader returns', async (mode) => {
    const binding = await fixture(mode);
    const mutate = () => database.prepare('UPDATE projects SET description=? WHERE id=?').run('changed', binding.projectId);
    if (mode === 'copy') vi.spyOn(safePath, 'readProjectImage').mockImplementation(async (...args) => {
      const bytes = await realCopyRead(...args); mutate(); return bytes;
    });
    else vi.spyOn(reference, 'readVerifiedReferenceImage').mockImplementation(async (...args) => {
      const bytes = await realReferenceRead(...args); mutate(); return bytes;
    });
    const result = await protocol.handle(new Request(binding.url));
    expect(result.status).toBe(404); expect(await result.text()).toBe('');
  });

  it.each(['root', 'marker', 'transaction'] as const)('rejects late Reference %s change', async (kind) => {
    const binding = await fixture('reference');
    vi.spyOn(reference, 'readVerifiedReferenceImage').mockImplementation(async (...args) => {
      const bytes = await realReferenceRead(...args);
      if (kind === 'root') database.prepare('UPDATE projects SET workspace_path=? WHERE id=?')
        .run(`${binding.project.rootPath}-moved`, binding.projectId);
      if (kind === 'marker') native.writeFileSync(join(binding.project.rootPath, '.autovision-project.json'), '{}');
      if (kind === 'transaction') database.exec('BEGIN');
      return bytes;
    });
    const result = await protocol.handle(new Request(binding.url));
    expect(result.status).toBe(kind === 'transaction' ? 503 : 404);
    expect(await result.text()).toBe('');
    if (kind === 'transaction') { expect(database.inTransaction).toBe(true); database.exec('ROLLBACK'); }
  });

  it('holds four unread bodies, refuses the fifth, and releases on cancel and complete consumption', async () => {
    expect(IMAGE_PROTOCOL_MAX_READS).toBe(4);
    expect(IMAGE_PROTOCOL_RESERVED_BYTES).toBe(256 * 1024 * 1024);
    const binding = await fixture();
    const results = await Promise.all(Array.from({ length: 4 }, () => protocol.handle(new Request(binding.url))));
    expect(results.map((result) => result.status)).toEqual([200, 200, 200, 200]);
    const lookup = vi.spyOn(database, 'prepare');
    expect((await protocol.handle(new Request(binding.url))).status).toBe(503);
    expect(lookup).not.toHaveBeenCalled();
    await results[0]!.body!.cancel();
    const next = await protocol.handle(new Request(binding.url));
    expect(next.status).toBe(200); expect(Buffer.from(await next.arrayBuffer())).toEqual(png);
    for (const result of results.slice(1)) await result.body!.cancel();
  });

  it('bounds in-flight reads and dispose waits for their settlement without waiting for consumers', async () => {
    const binding = await fixture();
    let unblock!: () => void;
    const gate = new Promise<void>((resolve) => { unblock = resolve; });
    const read = vi.spyOn(safePath, 'readProjectImage').mockImplementation(async (...args) => {
      await gate;
      return realCopyRead(...args);
    });
    const requests = Array.from({ length: 4 }, () => protocol.handle(new Request(binding.url)));
    expect(read).toHaveBeenCalledTimes(4);
    expect((await protocol.handle(new Request(binding.url))).status).toBe(503);
    let disposed = false;
    const completion = protocol.dispose().then(() => { disposed = true; });
    await Promise.resolve(); expect(disposed).toBe(false);
    unblock();
    expect((await Promise.all(requests)).map((result) => result.status)).toEqual([503, 503, 503, 503]);
    await completion;
    expect((await protocol.handle(new Request(binding.url))).status).toBe(503);
    await protocol.dispose();
  });

  it('enforces double-byte reservations below four slots and frees them after cancellation', async () => {
    const payload = Buffer.alloc(IMAGE_PROTOCOL_RESERVED_BYTES / 4 + 1);
    png.copy(payload);
    const binding = await fixture('copy', payload);
    let unblock!: () => void;
    const gate = new Promise<void>((resolve) => { unblock = resolve; });
    const read = vi.spyOn(safePath, 'readProjectImage').mockImplementation(async (...args) => {
      await gate;
      return realCopyRead(...args);
    });
    const controller = new AbortController();
    const first = protocol.handle(new Request(binding.url, { signal: controller.signal }));
    try {
      expect(read).toHaveBeenCalledTimes(1);
      expect((await protocol.handle(new Request(binding.url))).status).toBe(503);
      expect(read).toHaveBeenCalledTimes(1);
    } finally { controller.abort(); unblock(); }
    expect((await first).status).toBe(503);
    const secondController = new AbortController();
    const second = protocol.handle(new Request(binding.url, { signal: secondController.signal }));
    expect(read).toHaveBeenCalledTimes(2); // Released bytes, not just a released slot.
    secondController.abort();
    expect((await second).status).toBe(503);
  });

  it('aborts pre-read, mid-read and unread streams; subsequent non-aborted requests work', async () => {
    const binding = await fixture();
    const controller = new AbortController(); controller.abort();
    const read = vi.spyOn(safePath, 'readProjectImage');
    expect((await protocol.handle(new Request(binding.url, { signal: controller.signal }))).status).toBe(503);
    expect(read).not.toHaveBeenCalled();
    const middle = new AbortController();
    read.mockImplementationOnce(async (...args) => { const bytes = await realCopyRead(...args); middle.abort(); return bytes; });
    expect((await protocol.handle(new Request(binding.url, { signal: middle.signal }))).status).toBe(503);
    const late = new AbortController();
    const response = await protocol.handle(new Request(binding.url, { signal: late.signal }));
    expect(response.status).toBe(200); late.abort();
    await expect(response.arrayBuffer()).rejects.toMatchObject({ name: 'AbortError' });
    const final = await protocol.handle(new Request(binding.url));
    expect(final.status).toBe(200);
    await protocol.dispose();
    await expect(final.arrayBuffer()).rejects.toMatchObject({ name: 'AbortError' });
  });

  it.each([
    ['jpeg', Buffer.from([255, 216, 255, 224]), 'image/jpeg'],
    ['webp', Buffer.from('RIFFxxxxWEBP'), 'image/webp'],
    ['bmp', Buffer.concat([Buffer.from('BM'), Buffer.alloc(52)]), 'image/bmp'],
    ['tiff', Buffer.from([73, 73, 42, 0, 8, 0, 0, 0]), 'image/tiff'],
    ['html', Buffer.from('<html>not an image</html>'), null],
    ['svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), null],
    ['gif', Buffer.from('GIF89a........'), null],
    ['short-png', png.subarray(0, 7), null],
    ['short-bmp', Buffer.from('BM'), null],
    ['high-bit-webp-alias', Buffer.from('RIFFxxxxWEBP').map((value) => value | 128), null],
  ] as const)('sniffs %s bytes, not extension or saved format (signature policy, not decode proof)', async (_name, bytes, expected) => {
    const binding = await fixture('copy', Buffer.from(bytes));
    const result = await protocol.handle(new Request(binding.url));
    expect(result.status).toBe(expected === null ? 415 : 200);
    if (expected === null) expect(await result.text()).toBe('');
    else { expect(result.headers.get('Content-Type')).toBe(expected); expect(Buffer.from(await result.arrayBuffer())).toEqual(bytes); }
  });
});