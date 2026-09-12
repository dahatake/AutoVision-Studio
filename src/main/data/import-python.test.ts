// @vitest-environment node
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ScanPayload } from '../../shared/contracts/import.js';
import type { Project } from '../../shared/contracts/project.js';
import { getLabelSchema } from '../annotations/label-schema-service.js';
import { getAnnotationItem, listAnnotationItems } from '../annotations/workspace-service.js';
import { openDatabase, type DatabaseConnection } from '../db/database.js';
import { migrateDatabase } from '../db/migrate.js';
import { createJobService, type JobService } from '../jobs/job-service.js';
import { createProject } from '../projects/project-service.js';
import { findDataImportByScanJob, type DataImport } from './import-repository.js';
import { createImportService, type ImportService } from './import-service.js';
import { verifyReferenceSource } from './reference-access.js';

const python = fileURLToPath(new URL('../../../ml/.venv/Scripts/python.exe', import.meta.url));
const migrations = ['001_core', '002_jobs', '003_import', '004_import_generation', '005_import_rights', '006_annotations']
  .map((name, index) => ({ version: index + 1,
    sql: fs.readFileSync(new URL(`../db/migrations/${name}.sql`, import.meta.url), 'utf8') }));
const deadline = 90_000;
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

// Deterministic test-owned RGB PNGs, not borrowed sample bytes. PNG CRC-32
// covers the chunk type and data; every scanline starts with filter type zero.
function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function png(red: number, green: number, blue: number): Buffer {
  expect(crc32(Buffer.from('123456789', 'ascii'))).toBe(0xcbf43926);
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const length = Buffer.alloc(4), checksum = Buffer.alloc(4);
    length.writeUInt32BE(data.length); checksum.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(2, 0); header.writeUInt32BE(2, 4);
  header[8] = 8; header[9] = 2; // 8-bit RGB; deflate, filter method 0, non-interlaced.
  const row = Buffer.from([0, red, green, blue, red, green, blue]);
  const pixels = Buffer.concat([row, row]), compressed = deflateSync(pixels);
  expect(inflateSync(compressed)).toEqual(pixels);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header), chunk('IDAT', compressed), chunk('IEND', Buffer.alloc(0))]);
}

describe.skipIf(process.platform !== 'win32')('REALPYTHON Main import smoke (installed venv, no substitutes)', () => {
  let root: string | undefined, db: DatabaseConnection | undefined, jobs: JobService | undefined;
  let metadata: string, tasks: string, source: string, dbPath: string;
  let project: Project, service: ImportService;
  let originals: Map<string, { bytes: Buffer; mtimeNs: bigint; ino: bigint; dev: bigint; birthtimeNs: bigint }>;

  beforeEach(() => {
    root = undefined; db = undefined; jobs = undefined;
    if (!fs.existsSync(python)) throw new Error(`REALPYTHON requires the existing ML venv executable: ${python}. No install or skip is performed.`);
    if (!fs.statSync(python).isFile()) throw new Error(`REALPYTHON executable is not a file: ${python}`);
    root = fs.realpathSync.native(fs.mkdtempSync(join(tmpdir(), 'av-realpy-')));
    metadata = join(root, 'metadata'); tasks = join(root, 'tasks'); source = join(root, 'selected');
    for (const directory of [metadata, tasks, source, join(root, 'projects')]) fs.mkdirSync(directory);
    dbPath = join(metadata, 'metadata.sqlite3');
    db = openDatabase(dbPath); migrateDatabase(db, migrations);
    originals = new Map();
  }, deadline);

  afterEach(async () => {
    if (db?.open && db.inTransaction) db.exec('ROLLBACK');
    // A rejected shutdown means termination is unconfirmed: retain the owned
    // task files rather than deleting underneath a possibly live worker.
    await jobs?.shutdown();
    if (db?.open) db.close();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }, deadline);

  function startServices() {
    jobs = createJobService(db!, { executablePath: python, argsPrefix: ['-m', 'autovision_ml.cli'],
      taskRoot: tasks, env: { PYTHONDONTWRITEBYTECODE: '1', PYTHONPATH: '', PYTHONNOUSERSITE: '1' },
      policy: { timeoutMs: 60_000, cancelGraceMs: 2_000, closeTimeoutMs: 5_000,
        maxManifestBytes: 256 * 1024 * 1024, maxStdoutBytes: 65_536 } });
    // No cwd override/PYTHONPATH injection: the supervisor runs in its temporary
    // job directory and the installed editable package must resolve via the venv.
    service = createImportService(db!, jobs, { taskRoot: tasks, metadataDirectory: metadata, protectedRoots: [] });
  }
  function start(taskType: Project['taskType']) {
    project = createProject(db!, { name: 'REALPYTHON', description: '', taskType, workspacePath: join(root!, 'projects') });
    startServices();
  }
  function fixture(relative: string, bytes: Buffer): string {
    const path = join(source, relative);
    fs.mkdirSync(dirname(path), { recursive: true }); fs.writeFileSync(path, bytes, { flag: 'wx' });
    const stat = fs.statSync(path, { bigint: true });
    originals.set(path, { bytes, mtimeNs: stat.mtimeNs, ino: stat.ino, dev: stat.dev, birthtimeNs: stat.birthtimeNs });
    return path;
  }
  function unchangedSources() {
    for (const [path, original] of originals) {
      expect(fs.readFileSync(path)).toEqual(original.bytes);
      const stat = fs.statSync(path, { bigint: true });
      // Reads can settle Windows ctime; content, mtime and identity must not change.
      expect({ mtimeNs: stat.mtimeNs, ino: stat.ino, dev: stat.dev, birthtimeNs: stat.birthtimeNs })
        .toEqual({ mtimeNs: original.mtimeNs, ino: original.ino, dev: original.dev, birthtimeNs: original.birthtimeNs });
    }
  }
  async function commit(payload: ScanPayload, count: number) {
    const job = service.scan(project.id, payload);
    expect(job.status).toBe('Preparing');
    const preview = await service.preview(project.id, job.id);
    expect(preview).toMatchObject({ projectId: project.id, jobId: job.id, taskType: project.taskType, mode: payload.mode, itemCount: count });
    expect(preview.issues).toEqual([]);
    expect(jobs!.get(project.id, job.id)?.status).toBe('Succeeded');
    // Python scan completion alone has not imported/confirmed anything.
    expect(db!.prepare('SELECT id FROM data_imports').all()).toEqual([]);
    const result = await service.commit(project.id, job.id, { mode: payload.mode, rightsAccepted: true });
    expect(result).toEqual({ status: 'completed', projectId: project.id, importId: result.importId,
      workspaceId: result.importId, itemCount: count, cleanupWarning: false });
    const stored = findDataImportByScanJob(db!, project.id, job.id)!;
    expect(stored).toBeDefined();
    expect(stored.id).toBe(result.importId);
    expect(stored.scanResult.images).toHaveLength(count);
    expect(stored.sourceManifest.entries).toHaveLength(count);
    expect(db!.prepare('SELECT * FROM project_import_rights').all()).toHaveLength(1);
    const page = listAnnotationItems(db!, project.id, result.workspaceId, { offset: 0, limit: 10 });
    expect(page.total).toBe(count); expect(page.items).toHaveLength(count);
    for (const image of stored.scanResult.images) {
      const original = originals.get(image.sourcePath)!;
      expect(original).toBeDefined();
      expect(image).toMatchObject({ format: 'png', width: 2, height: 2, orientation: 1, duplicateOf: null,
        byteSize: original.bytes.length, sha256: sha256(original.bytes), mtimeNs: String(original.mtimeNs) });
      const item = page.items.find((entry) => entry.imageKey === image.key)!;
      expect(item).toMatchObject({ importId: result.importId, workspaceId: result.workspaceId,
        imageSha256: image.sha256, width: 2, height: 2, state: 'unstarted', negativeConfirmed: false,
        confirmedAt: null, exclusionReason: null, editVersion: 0 });
    }
    expect(db!.pragma('foreign_key_check')).toEqual([]); unchangedSources();
    return { job, result, stored, items: page.items };
  }
  function copies(stored: DataImport) {
    if (stored.sourceManifest.mode !== 'copy') throw new Error('Expected Copy manifest');
    for (const entry of stored.sourceManifest.entries) {
      const image = stored.scanResult.images.find((value) => value.key === entry.imageKey)!;
      const destination = join(project.workspacePath, entry.relativePath);
      expect(destination).not.toBe(image.sourcePath);
      const bytes = fs.readFileSync(destination);
      expect(bytes).toEqual(originals.get(image.sourcePath)!.bytes);
      expect(sha256(bytes)).toBe(entry.sha256); expect(entry.sha256).toBe(image.sha256);
    }
  }

  it.each(['folder', 'csv'] as const)('classification %s Copy decodes real PNGs and preserves labels, hashes and provenance', async (format) => {
    start('classification');
    const red = fixture('cat/red.png', png(255, 0, 0)), blue = fixture('dog/blue.png', png(0, 0, 255));
    const annotationPath = format === 'csv'
      ? fixture('labels.csv', Buffer.from('path,label\ncat/red.png,猫\ndog/blue.png,犬\n', 'utf8')) : undefined;
    const selected = format === 'csv' ? { format, root: source, annotationPath: annotationPath! } : { format, root: source };
    const { stored, result, items } = await commit({ taskType: 'classification', mode: 'copy', source: selected }, 2);
    copies(stored);
    expect(new Set(stored.scanResult.images.map((image) => image.sha256)).size).toBe(2);
    const labels = getLabelSchema(db!, project.id)!.classes;
    expect(labels).toHaveLength(2);
    const expected = new Map([[red, { name: format === 'csv' ? '猫' : 'cat', row: format === 'csv' ? 2 : null }],
      [blue, { name: format === 'csv' ? '犬' : 'dog', row: format === 'csv' ? 3 : null }]]);
    for (const image of stored.scanResult.images) {
      const target = expected.get(image.sourcePath)!;
      const scanClass = stored.scanResult.classes.find((entry) => entry.name === target.name)!;
      const label = labels.find((entry) => entry.displayName === target.name)!;
      expect(label.id).toMatch(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u);
      expect(image.annotation).toEqual({ type: 'classification', classKey: scanClass.key, sourceRow: target.row });
      const item = items.find((entry) => entry.imageKey === image.key)!;
      expect(item.annotation).toEqual({ kind: 'classification', classId: label.id });
      expect(getAnnotationItem(db!, project.id, result.workspaceId, item.id).provenance).toEqual([{
        itemId: item.id, targetKey: 'classification', kind: 'import-unmodified', sourceImportId: result.importId,
        sourceImageKey: image.key, sourceAnnotationKey: target.row === null ? 'classification' : `row:${target.row}`,
        sourceSuggestionId: null, original: image.annotation, changes: {},
      }]);
    }
  }, deadline);

  it('unlabeled Reference captures real identity/hash and repeats strictly after reopening the DB', async () => {
    start('classification');
    const path = fixture('image.png', png(255, 0, 0));
    const { job, result, stored, items } = await commit({ taskType: 'classification', mode: 'reference',
      source: { format: 'unlabeled', selection: 'directory', root: source } }, 1);
    expect(stored.scanResult.classes).toEqual([]); expect(getLabelSchema(db!, project.id)!.classes).toEqual([]);
    expect(stored.scanResult.images[0]!.annotation).toBeNull();
    expect(items[0]!.annotation).toEqual({ kind: 'classification', classId: null });
    expect(getAnnotationItem(db!, project.id, result.workspaceId, items[0]!.id).provenance).toEqual([]);
    if (stored.sourceManifest.mode !== 'reference') throw new Error('Expected Reference manifest');
    const entry = stored.sourceManifest.entries[0]!, original = originals.get(path)!;
    expect(entry).toEqual({ imageKey: items[0]!.imageKey, sourcePath: path, byteSize: original.bytes.length,
      mtimeNs: String(original.mtimeNs), sha256: sha256(original.bytes),
      identity: { dev: String(original.dev), ino: String(original.ino), birthtimeNs: String(original.birthtimeNs) } });
    expect(await verifyReferenceSource(entry)).toEqual({ status: 'verified', source: entry });
    expect(fs.existsSync(join(project.workspacePath, 'datasets', result.importId, 'source'))).toBe(false);
    await jobs!.shutdown(); db!.close(); db = openDatabase(dbPath); startServices();
    expect(await service.commit(project.id, job.id, { mode: 'reference', rightsAccepted: true })).toStrictEqual(result);
    const reopened = findDataImportByScanJob(db, project.id, job.id)!;
    expect(reopened).toStrictEqual(stored);
    expect(listAnnotationItems(db, project.id, result.workspaceId, { offset: 0, limit: 10 }).items).toStrictEqual(items);
    expect(db.prepare('SELECT id FROM data_imports').all()).toEqual([{ id: result.importId }]);
    expect(jobs!.list(project.id)).toHaveLength(1);
    expect(db.pragma('foreign_key_check')).toEqual([]); unchangedSources();
  }, deadline);

  it('COCO Copy preserves category zero, two exact boxes and an unconfirmed zero-box image', async () => {
    start('detection');
    const red = fixture('images/red.png', png(255, 0, 0)); fixture('images/blue.png', png(0, 0, 255));
    const boxes = [{ id: 11, bbox: [0, 0, 1, 1] }, { id: 12, bbox: [0.5, 0.25, 1.5, 1.75] }];
    const annotationPath = fixture('annotations.json', Buffer.from(JSON.stringify({
      images: [{ id: 1, file_name: 'images/red.png', width: 2, height: 2 },
        { id: 2, file_name: 'images/blue.png', width: 2, height: 2 }],
      categories: [{ id: 0, name: 'object' }],
      annotations: boxes.map((box) => ({ ...box, image_id: 1, category_id: 0, iscrowd: 0 })),
    }), 'utf8'));
    const { stored, result, items } = await commit({ taskType: 'detection', mode: 'copy',
      source: { format: 'coco', root: source, annotationPath } }, 2);
    copies(stored);
    expect(stored.scanResult.classes).toEqual([{ key: 'category:0', name: 'object', sourceCategoryId: '0' }]);
    const labels = getLabelSchema(db!, project.id)!.classes; expect(labels).toHaveLength(1);
    const label = labels[0]!;
    expect(label.id).toMatch(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u);
    expect(label.displayName).toBe('object');
    for (const image of stored.scanResult.images) {
      const expectedBoxes = image.sourcePath === red ? boxes : [];
      const sourceImageId = image.sourcePath === red ? '1' : '2';
      expect(image.annotation).toEqual({ type: 'detection', sourceImageId, boxes: expectedBoxes.map((box) => ({
        classKey: 'category:0', sourceAnnotationId: String(box.id), bbox: box.bbox,
      })) });
      const item = items.find((entry) => entry.imageKey === image.key)!;
      if (item.annotation.kind !== 'detection') throw new Error('Expected detection annotation');
      expect(item.annotation.rectangles).toHaveLength(expectedBoxes.length);
      const detail = getAnnotationItem(db!, project.id, result.workspaceId, item.id);
      expect(detail.provenance).toHaveLength(expectedBoxes.length);
      for (const [index, rectangle] of item.annotation.rectangles.entries()) {
        const box = expectedBoxes[index]!;
        expect(rectangle).toEqual({ id: rectangle.id, classId: label.id,
          x: box.bbox[0], y: box.bbox[1], width: box.bbox[2], height: box.bbox[3] });
        expect(detail.provenance.find((entry) => entry.targetKey === rectangle.id)).toEqual({
          itemId: item.id, targetKey: rectangle.id, kind: 'import-unmodified', sourceImportId: result.importId,
          sourceImageKey: image.key, sourceAnnotationKey: String(box.id), sourceSuggestionId: null,
          original: { type: 'detection', sourceImageId, classKey: 'category:0', sourceAnnotationId: String(box.id), bbox: box.bbox },
          changes: {},
        });
      }
    }
  }, deadline);
});