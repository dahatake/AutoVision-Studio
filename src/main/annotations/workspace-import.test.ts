// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ScanImage, ScanResult } from '../../shared/contracts/import.js';
import {
  findDataImportByScanJob, insertDataImport, prepareDataImport, readPreparedDataImport,
  type PreparedDataImport,
} from '../data/import-repository.js';
import { captureReferenceSource } from '../data/reference-access.js';
import { openDatabase, type DatabaseConnection } from '../db/database.js';
import { migrateDatabase } from '../db/migrate.js';
import {
  getLabelSchema, insertImportLabels, prepareImportLabels, readPreparedImportLabels,
  type PreparedImportLabels,
} from './label-schema-service.js';
import {
  createAnnotationWorkspace, getAnnotationItem, getAnnotationWorkspace, insertPreparedAnnotationWorkspace,
  listAnnotationItems, prepareAnnotationWorkspaceForImport, type PreparedAnnotationWorkspace,
} from './workspace-service.js';

const migrations = ['001_core', '002_jobs', '003_import', '004_import_generation', '005_import_rights', '006_annotations']
  .map((name, index) => ({ version: index + 1, sql: readFileSync(new URL(`../db/migrations/${name}.sql`, import.meta.url), 'utf8') }));
const at = '2026-09-12T05:30:00.123Z';
const projectId = '01234567-89ab-4cde-8f01-23456789abcd';
const tables = ['label_schemas', 'label_classes', 'data_imports', 'import_sources', 'import_generations',
  'annotation_workspaces', 'annotation_items', 'annotation_provenance'] as const;

describe('DAT-08C real SQLite 001–006 workspace participant', () => {
  let directory: string, path: string, db: DatabaseConnection;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'av-dat08c-'));
    path = join(directory, 'metadata.sqlite3');
    db = openDatabase(path);
    migrateDatabase(db, migrations);
    db.prepare(`INSERT INTO projects(id,name,task_type,workspace_path,created_at,updated_at) VALUES (?,?,?,?,?,?)`)
      .run(projectId, 'DAT08C unit fixture', 'classification', directory, at, at);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    if (db.open) db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const graph = () => Object.fromEntries(tables.map((table) => [table, db.prepare(`SELECT * FROM ${table}`).all()]));

  async function fixture(mode: ScanResult['mode'] = 'copy', taskType: ScanResult['taskType'] = 'classification', name = 'cat') {
    const jobId = randomUUID(), id = randomUUID();
    db.prepare('UPDATE projects SET task_type=? WHERE id=?').run(taskType, projectId);
    // Ordinary test fixture only, never a scan-completion operation or user consent.
    db.prepare('INSERT INTO jobs(id,project_id,kind,status,created_at,updated_at) VALUES (?,?,?,?,?,?)')
      .run(jobId, projectId, 'scan-dataset', 'Succeeded', at, at);
    const images: ScanImage[] = [0, 1].map((index) => {
      const sourcePath = join(directory, `${id}-${index}.png`);
      const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6XkAAAAASUVORK5CYII=', 'base64');
      writeFileSync(sourcePath, bytes);
      const stat = statSync(sourcePath, { bigint: true });
      return { key: `image:${index}`, sourcePath, byteSize: bytes.length, mtimeNs: String(stat.mtimeNs),
        sha256: createHash('sha256').update(bytes).digest('hex'), format: 'png', width: 1, height: 1,
        orientation: 1, duplicateOf: index === 1 ? 'image:0' : null,
        annotation: index === 1 ? null : taskType === 'classification'
          ? { type: 'classification', classKey: 'constructor', sourceRow: 2 }
          : { type: 'detection', sourceImageId: '9007199254740993123', boxes: [
            { classKey: 'constructor', sourceAnnotationId: '9007199254740993124', bbox: [0.1, 0.2, 0.3, 0.4] },
          ] } };
    });
    const scan: ScanResult = { formatVersion: 1, projectId, jobId, taskType, mode,
      classes: [{ key: 'constructor', name, sourceCategoryId: taskType === 'detection' ? '42' : null }], images, issues: [] };
    // Real OS mountvol and filesystem checks: no child_process or proof mocks.
    const sourceManifest = mode === 'reference'
      ? { formatVersion: 1 as const, mode, entries: await Promise.all(images.map((image) => captureReferenceSource(image))) }
      : { formatVersion: 1 as const, mode, entries: images.map((image, ordinal) => ({ imageKey: image.key,
        relativePath: `datasets/${id}/source/${ordinal}.png`, byteSize: image.byteSize, sha256: image.sha256 })) };
    const imported = prepareDataImport({ id, createdAt: at, updatedAt: at, scanResult: scan, sourceManifest });
    const labels = prepareImportLabels(db, projectId, scan.classes);
    return { imported, labels, scan, id, jobId };
  }
  function insert(plan: Awaited<ReturnType<typeof fixture>>, workspace: PreparedAnnotationWorkspace) {
    insertImportLabels(db, plan.labels);
    insertDataImport(db, plan.imported);
    return insertPreparedAnnotationWorkspace(db, workspace);
  }
  function commit(plan: Awaited<ReturnType<typeof fixture>>, workspace: PreparedAnnotationWorkspace) {
    db.exec('BEGIN');
    try { const result = insert(plan, workspace); db.exec('COMMIT'); return result; }
    catch (error) { if (db.inTransaction) db.exec('ROLLBACK'); throw error; }
  }

  it.each(['classification', 'detection'] as const)('commits Copy %s and reopens the full graph', async (task) => {
    const plan = await fixture('copy', task), before = graph();
    const labels = readPreparedImportLabels(plan.labels);
    const prepared = prepareAnnotationWorkspaceForImport(db, plan.imported, plan.labels);
    expect(graph()).toEqual(before);
    expect(prepared.id).toBe(plan.id);
    const queries = vi.spyOn(db, 'prepare');
    const result = commit(plan, prepared);
    expect(queries.mock.calls.some(([sql]) => sql.includes('scan_result_json AS scanResultJson'))).toBe(false);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.workspace)).toBe(true);
    expect(() => readPreparedImportLabels(plan.labels)).toThrow();
    expect(readPreparedDataImport(plan.imported).id).toBe(plan.id);
    vi.restoreAllMocks();
    db.close(); db = openDatabase(path);
    expect(getLabelSchema(db, projectId)).toEqual(labels);
    expect(findDataImportByScanJob(db, projectId, plan.jobId)?.id).toBe(plan.id);
    expect(findDataImportByScanJob(db, randomUUID(), plan.jobId)).toBeUndefined();
    expect(findDataImportByScanJob(db, projectId, randomUUID())).toBeUndefined();
    expect(getAnnotationWorkspace(db, projectId, plan.id)).toEqual(result.workspace);
    const items = listAnnotationItems(db, projectId, plan.id, { offset: 0, limit: 10 }).items;
    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(item).toMatchObject({ state: 'unstarted', negativeConfirmed: false, confirmedAt: null, editVersion: 0 });
      getAnnotationItem(db, projectId, plan.id, item.id);
    }
    expect(db.prepare('SELECT * FROM annotation_workspaces').all()).toHaveLength(1);
    expect(db.prepare('SELECT * FROM project_import_rights').all()).toEqual([]);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it.skipIf(process.platform !== 'win32')('commits genuine native-captured Reference and reopens', async () => {
    const plan = await fixture('reference');
    const prepared = prepareAnnotationWorkspaceForImport(db, plan.imported, plan.labels);
    const result = commit(plan, prepared);
    db.close(); db = openDatabase(path);
    expect(findDataImportByScanJob(db, projectId, plan.jobId)?.mode).toBe('reference');
    expect(getLabelSchema(db, projectId)?.classes).toHaveLength(1);
    expect(getAnnotationWorkspace(db, projectId, plan.id)).toEqual(result.workspace);
    for (const item of listAnnotationItems(db, projectId, plan.id, { offset: 0, limit: 10 }).items)
      getAnnotationItem(db, projectId, plan.id, item.id);
  });

  it.each(['labels', 'import', 'partial-items'] as const)('caller rollback after %s preserves the old graph and removes new classes', async (point) => {
    const old = await fixture();
    commit(old, prepareAnnotationWorkspaceForImport(db, old.imported, old.labels));
    const plan = await fixture('copy', 'classification', 'dog'), before = graph();
    const workspace = prepareAnnotationWorkspaceForImport(db, plan.imported, plan.labels);
    if (point === 'partial-items') db.exec(`CREATE TRIGGER fail_item BEFORE INSERT ON annotation_items
      WHEN NEW.image_key='image:1' BEGIN SELECT RAISE(ABORT,'partial item failure'); END`);
    db.exec('BEGIN');
    try {
      expect(() => {
        insertImportLabels(db, plan.labels);
        if (point === 'labels') throw new Error('injected');
        insertDataImport(db, plan.imported);
        if (point === 'import') throw new Error('injected');
        insertPreparedAnnotationWorkspace(db, workspace);
      }).toThrow();
      expect(db.inTransaction).toBe(true);
    } finally { db.exec('ROLLBACK'); }
    expect(graph()).toEqual(before);
    if (point === 'partial-items') expect(() => insertPreparedAnnotationWorkspace(db, workspace)).toThrow(/unused/);
  });

  it('rejects forged/copied capabilities without invoking accessors and does not consume the originals', async () => {
    const plan = await fixture();
    const getter = vi.fn(() => plan.id);
    expect(() => readPreparedDataImport({ ...plan.imported })).toThrow();
    expect(() => prepareAnnotationWorkspaceForImport(db, { ...plan.imported }, plan.labels)).toThrow();
    expect(() => prepareAnnotationWorkspaceForImport(db, plan.imported, { ...plan.labels })).toThrow();
    const prepared = prepareAnnotationWorkspaceForImport(db, plan.imported, plan.labels);
    for (const forged of [{ ...prepared }, Object.defineProperty({}, 'id', { get: getter })])
      expect(() => insertPreparedAnnotationWorkspace(db, forged as PreparedAnnotationWorkspace)).toThrow();
    expect(getter).not.toHaveBeenCalled();
    commit(plan, prepared);
    expect(() => insertPreparedAnnotationWorkspace(db, prepared)).toThrow(/unused/);
  });

  it.each(['no-tx', 'foreign-db'] as const)('consumes first use even with %s', async (kind) => {
    const plan = await fixture(), before = graph();
    const prepared = prepareAnnotationWorkspaceForImport(db, plan.imported, plan.labels);
    const other = openDatabase(path);
    try {
      expect(() => insertPreparedAnnotationWorkspace(kind === 'foreign-db' ? other : db, prepared)).toThrow();
      db.exec('BEGIN');
      expect(() => insertPreparedAnnotationWorkspace(db, prepared)).toThrow(/unused/);
      expect(db.inTransaction).toBe(true);
      db.exec('ROLLBACK');
      expect(graph()).toEqual(before);
    } finally { other.close(); }
  });

  it('rejects preparation in a caller transaction and protects the detached immutable plan', async () => {
    const plan = await fixture(), before = graph();
    const value = readPreparedDataImport(plan.imported);
    expect(readPreparedDataImport(plan.imported)).toBe(value);
    expect(Object.isFrozen(value.scanResult.images[0].annotation)).toBe(true);
    expect(Object.isFrozen(value.sourceManifest.entries)).toBe(true);
    plan.scan.images[0].width = 999;
    expect(value.scanResult.images[0].width).toBe(1);
    expect(() => { value.scanResult.images[0].width = 999; }).toThrow();
    expect(Reflect.set(plan.labels.classMapping, 'constructor', randomUUID())).toBe(false);
    db.exec('BEGIN');
    expect(() => prepareAnnotationWorkspaceForImport(db, plan.imported, plan.labels)).toThrow(/caller transaction/);
    expect(db.inTransaction).toBe(true);
    db.exec('ROLLBACK');
    expect(graph()).toEqual(before);
    commit(plan, prepareAnnotationWorkspaceForImport(db, plan.imported, plan.labels));
  });

  it.each(['class', 'raw-examples', 'project', 'generation', 'during-writes'] as const)('rejects %s changes and leaves rollback to caller', async (kind) => {
    const plan = await fixture(), before = graph();
    const workspace = prepareAnnotationWorkspaceForImport(db, plan.imported, plan.labels);
    if (kind === 'during-writes') db.exec(`CREATE TRIGGER mutate_schema AFTER INSERT ON annotation_items
      BEGIN UPDATE label_classes SET description='changed'; END`);
    db.exec('BEGIN');
    try {
      insertImportLabels(db, plan.labels); insertDataImport(db, plan.imported);
      if (kind === 'class') db.exec("UPDATE label_classes SET color='#123456'");
      if (kind === 'raw-examples') db.exec("UPDATE label_classes SET examples_json='[ ]'");
      if (kind === 'project') db.exec("UPDATE projects SET workspace_path=workspace_path || '-changed'");
      if (kind === 'generation') db.prepare('UPDATE import_sources SET sha256=sha256 WHERE import_id=?').run(plan.id);
      expect(() => insertPreparedAnnotationWorkspace(db, workspace)).toThrow(/changed/);
      expect(db.inTransaction).toBe(true);
    } finally { db.exec('ROLLBACK'); }
    expect(graph()).toEqual(before);
    expect(() => insertPreparedAnnotationWorkspace(db, workspace)).toThrow(/unused/);
  });

  it.each(['classification', 'detection'] as const)('shares exact annotation/provenance encoding with ordinary %s creation', async (task) => {
    const plan = await fixture('copy', task);
    const mapping = plan.labels.classMapping, schemaId = plan.labels.schemaId;
    commit(plan, prepareAnnotationWorkspaceForImport(db, plan.imported, plan.labels));
    const ordinary = createAnnotationWorkspace(db, projectId, plan.id, schemaId, mapping);
    expect(ordinary.workspace.id).not.toBe(plan.id);
    const rows = (id: string) => db.prepare(`SELECT a.image_key,a.annotation_json,p.original_json,p.changes_json,
      p.source_annotation_key FROM annotation_items a LEFT JOIN annotation_provenance p ON p.item_id=a.id
      WHERE a.workspace_id=? ORDER BY a.image_key,p.source_annotation_key`).all(id) as
      { image_key: string; annotation_json: string; original_json: string | null; changes_json: string | null; source_annotation_key: string | null }[];
    const normalize = (id: string) => rows(id).map((row) => ({ ...row,
      // Only generated rectangle UUIDs differ; all remaining canonical bytes must match.
      annotation_json: row.annotation_json.replace(/"id":"[a-f0-9-]{36}"/gu, '"id":"rectangle"'),
    }));
    expect(normalize(ordinary.workspace.id)).toEqual(normalize(plan.id));
  });

  it('scan-job lookup still performs full strict validation', async () => {
    const plan = await fixture();
    commit(plan, prepareAnnotationWorkspaceForImport(db, plan.imported, plan.labels));
    // Deliberate corruption fixture only; keep the production immutability
    // guard intact when exercising the strict lookup path.
    const guard = db.prepare("SELECT sql FROM sqlite_master WHERE name='import_sources_preserve_copy_binding'")
      .get() as { sql: string };
    db.exec('DROP TRIGGER import_sources_preserve_copy_binding');
    db.prepare('UPDATE import_sources SET entry_sha256=? WHERE import_id=?').run('0'.repeat(64), plan.id);
    db.exec(guard.sql);
    expect(() => findDataImportByScanJob(db, projectId, plan.jobId)).toThrow(/invalid|changed/);
  });

  it('refuses unmatched projects and non-succeeded jobs without persisting', async () => {
    const plan = await fixture();
    db.prepare('UPDATE projects SET task_type=? WHERE id=?').run('detection', projectId);
    expect(() => prepareAnnotationWorkspaceForImport(db, plan.imported, plan.labels)).toThrow(/mismatch/);
    expect(() => prepareAnnotationWorkspaceForImport(db, {} as PreparedDataImport, {} as PreparedImportLabels)).toThrow();
    expect(db.prepare('SELECT * FROM annotation_workspaces').all()).toEqual([]);
  });
});