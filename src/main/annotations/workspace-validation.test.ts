// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScanResult } from '../../shared/contracts/import.js';
import { findDataImportByScanJob, insertDataImport, prepareDataImport, type DataImport } from '../data/import-repository.js';
import { openDatabase, type DatabaseConnection } from '../db/database.js';
import { migrateDatabase } from '../db/migrate.js';
import { getLabelSchema, insertImportLabels, mergeLabelClasses, prepareImportLabels } from './label-schema-service.js';
import { annotationDigest, canonicalAnnotationJson } from './workspace-repository.js';
import { insertPreparedAnnotationWorkspace, prepareAnnotationWorkspaceForImport, validateImportedWorkspace } from './workspace-service.js';
import { validateAnnotationWorkspace } from './validate-annotation.js';
import { createDatasetRevision } from '../data/revision-service.js';
import { enqueueTrainingRun } from '../jobs/training-queue.js';
import { confirmDatasetAndQueueTraining } from './confirm-and-queue.js';
import { cloneWorkspaceFromRevision } from './clone-workspace.js';

const at = '2026-09-12T05:30:00.123Z';
const migrations = ['001_core', '002_jobs', '003_import', '004_import_generation', '005_import_rights', '006_annotations']
  .map((name, index) => ({ version: index + 1, sql: readFileSync(new URL(`../db/migrations/${name}.sql`, import.meta.url), 'utf8') }));

describe('ANN-05 bulk imported workspace validation', () => {
  let db: DatabaseConnection, directory: string, path: string, projectId: string;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'av-bulk-')); path = join(directory, 'metadata.sqlite3');
    db = openDatabase(path); migrateDatabase(db, migrations); projectId = randomUUID();
    // Unit-only Main DB seed, not evidence of source file verification or user consent.
    db.prepare('INSERT INTO projects(id,name,task_type,workspace_path,created_at,updated_at) VALUES (?,?,?,?,?,?)')
      .run(projectId, 'Bulk fixture', 'classification', directory, at, at);
  });
  afterEach(() => { vi.restoreAllMocks(); if (db.open) db.close(); rmSync(directory, { recursive: true, force: true }); });
  function fixture(task: ScanResult['taskType'] = 'classification', count = 3) {
    const id = randomUUID(), jobId = randomUUID();
    db.prepare('UPDATE projects SET task_type=? WHERE id=?').run(task, projectId);
    db.prepare('INSERT INTO jobs(id,project_id,kind,status,created_at,updated_at) VALUES (?,?,?,?,?,?)')
      .run(jobId, projectId, 'scan-dataset', 'Succeeded', at, at);
    const scan: ScanResult = { formatVersion: 1, projectId, jobId, taskType: task, mode: 'copy', issues: [],
      classes: [{ key: 'constructor', name: 'Cat', sourceCategoryId: task === 'detection' ? '1' : null },
        { key: 'dog', name: 'Dog', sourceCategoryId: task === 'detection' ? '2' : null }],
      images: Array.from({ length: count }, (_, index) => ({ key: `image:${index}`, sourcePath: `C:\\fixtures\\${index}.png`,
        byteSize: 100, mtimeNs: '123456789', sha256: index.toString(16).padStart(64, '0'), format: 'png',
        width: 640, height: 480, orientation: 1, duplicateOf: null,
        annotation: index > 0 ? null : task === 'classification'
          ? { type: 'classification', classKey: 'constructor', sourceRow: 2 }
          : { type: 'detection', sourceImageId: '9007199254740993123', boxes: [
            { classKey: 'constructor', sourceAnnotationId: '9007199254740993124', bbox: [1, 2, 3, 4] }] } })) };
    const imported = prepareDataImport({ id, createdAt: at, updatedAt: at, scanResult: scan,
      sourceManifest: { formatVersion: 1, mode: 'copy', entries: scan.images.map((image, index) => ({
        imageKey: image.key, relativePath: `datasets/${id}/source/${index}.png`, byteSize: image.byteSize, sha256: image.sha256 })) } });
    const labels = prepareImportLabels(db, projectId, scan.classes);
    const workspace = prepareAnnotationWorkspaceForImport(db, imported, labels);
    db.exec('BEGIN'); insertImportLabels(db, labels); insertDataImport(db, imported);
    insertPreparedAnnotationWorkspace(db, workspace); db.exec('COMMIT');
    return { id, jobId, labels, count };
  }
  const load = (jobId: string) => findDataImportByScanJob(db, projectId, jobId)!;
  function check(plan: ReturnType<typeof fixture>) {
    db.exec('BEGIN');
    try { return validateImportedWorkspace(db, projectId, plan.id, load(plan.jobId)); }
    finally { db.exec('ROLLBACK'); }
  }
  const graph = () => ['annotation_workspaces', 'annotation_items', 'annotation_provenance', 'data_imports', 'import_sources', 'import_generations', 'label_schemas', 'label_classes']
    .map((table) => db.prepare(`SELECT * FROM ${table}`).all());

  it.each([3, 64])('validates %i items with constant reads, zero payload rereads and no writes/TX ownership', (count) => {
    const plan = fixture('classification', count), before = graph();
    db.exec('BEGIN'); const source = load(plan.jobId);
    const prepare = vi.spyOn(db, 'prepare'), exec = vi.spyOn(db, 'exec');
    const result = validateImportedWorkspace(db, projectId, plan.id, source);
    expect(result.itemCount).toBe(count); expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result.workspace)).toBe(true);
    expect(prepare.mock.calls).toHaveLength(7);
    expect(prepare.mock.calls.every(([sql]) => /^SELECT/u.test(sql))).toBe(true);
    expect(prepare.mock.calls.filter(([sql]) => /scan_result_json|source_manifest_json/u.test(sql))).toHaveLength(0);
    expect(exec).not.toHaveBeenCalled(); expect(db.inTransaction).toBe(true);
    vi.restoreAllMocks(); db.exec('COMMIT'); expect(graph()).toEqual(before);
  });

  it.each(['classification', 'detection'] as const)('accepts ordinary %s class merges with current hashes and original provenance', (task) => {
    const plan = fixture(task);
    mergeLabelClasses(db, projectId, plan.labels.schemaId, plan.labels.classMapping['constructor']!,
      plan.labels.classMapping['dog']!, getLabelSchema(db, projectId)!.editVersion);
    expect(check(plan).itemCount).toBe(3);
  });

  it('accepts manual edits, excluded and explicitly negative items', () => {
    const plan = fixture('detection');
    const rectangle = { id: randomUUID(), classId: plan.labels.classMapping['dog']!, x: 2, y: 3, width: 4, height: 5 };
    const text = canonicalAnnotationJson({ kind: 'detection', rectangles: [rectangle] });
    const item = db.prepare("SELECT id FROM annotation_items WHERE image_key='image:1'").get() as { id: string };
    db.prepare("UPDATE annotation_items SET annotation_json=?,annotation_sha256=?,state='editing',edit_version=edit_version+1 WHERE id=?")
      .run(text, annotationDigest(text), item.id);
    db.prepare("INSERT INTO annotation_provenance(item_id,target_key,kind,original_json,changes_json) VALUES (?,?,'manual','{}','{}')")
      .run(item.id, rectangle.id);
    db.exec("UPDATE annotation_items SET state='excluded',exclusion_reason='explicit unit edit',edit_version=edit_version+1 WHERE image_key='image:0'");
    db.prepare("UPDATE annotation_items SET state='confirmed',negative_confirmed=1,confirmed_at=?,edit_version=edit_version+1 WHERE image_key='image:2'").run(at);
    expect(check(plan).itemCount).toBe(3);
  });

  it.each(['hash', 'unknown', 'canonical', 'provenance-drop', 'source-key', 'original', 'changes', 'flag'] as const)
    ('rejects same-count %s corruption without writes', (kind) => {
      const plan = fixture();
      if (kind === 'hash') db.exec("UPDATE annotation_items SET annotation_sha256='" + 'f'.repeat(64) + "',edit_version=edit_version+1");
      if (kind === 'unknown' || kind === 'canonical') {
        const text = kind === 'unknown' ? '{"classId":null,"extra":true,"kind":"classification"}' : '{"kind":"classification","classId":null}';
        db.prepare("UPDATE annotation_items SET annotation_json=?,annotation_sha256=?,edit_version=edit_version+1 WHERE image_key='image:1'").run(text, annotationDigest(text));
      }
      if (kind === 'provenance-drop') db.exec('DELETE FROM annotation_provenance');
      if (kind === 'source-key') db.exec("UPDATE annotation_provenance SET source_annotation_key='row:999'");
      if (kind === 'original') db.exec("UPDATE annotation_provenance SET original_json='{}'");
      if (kind === 'changes') db.exec("UPDATE annotation_provenance SET changes_json='{\"x\":1}'");
      if (kind === 'flag') {
        db.pragma('ignore_check_constraints=ON');
        db.exec('UPDATE annotation_items SET negative_confirmed=2,edit_version=edit_version+1');
        db.pragma('ignore_check_constraints=OFF');
      }
      const before = graph(); expect(() => check(plan)).toThrow(); expect(graph()).toEqual(before);
    });

  it.each(['missing', 'all-missing', 'foreign-import', 'wrong-key', 'image-hash'] as const)('rejects %s item sets', (kind) => {
    const plan = fixture();
    if (kind === 'missing') db.exec("DELETE FROM annotation_items WHERE image_key='image:2'");
    if (kind === 'all-missing') { db.exec('DELETE FROM annotation_provenance'); db.exec('DELETE FROM annotation_items'); }
    if (kind === 'foreign-import') { const other = fixture(); expect(() => {
      db.exec('BEGIN'); try { validateImportedWorkspace(db, projectId, other.id, load(plan.jobId)); } finally { db.exec('ROLLBACK'); }
    }).toThrow(); return; }
    if (kind === 'wrong-key' || kind === 'image-hash') {
      // Deliberate corrupt DB fixture only; production guards stay unchanged.
      db.exec('DROP TRIGGER annotation_items_update');
      if (kind === 'image-hash') db.prepare("UPDATE annotation_items SET image_sha256=? WHERE image_key='image:2'").run('f'.repeat(64));
      else {
        db.pragma('foreign_keys=OFF');
        db.exec("UPDATE annotation_items SET image_key='wrong-key' WHERE image_key='image:2'");
        db.pragma('foreign_keys=ON');
      }
    }
    expect(() => check(plan)).toThrow();
  });

  it('rejects absent TX, forged/accessor snapshots and a genuine snapshot from another connection', () => {
    const plan = fixture(), source = load(plan.jobId), getter = vi.fn();
    expect(() => validateImportedWorkspace(db, projectId, plan.id, source)).toThrow(/transaction/);
    const other = openDatabase(path);
    try {
      const foreign = findDataImportByScanJob(other, projectId, plan.jobId)!;
      db.exec('BEGIN');
      for (const value of [{ ...source }, Object.defineProperty({}, 'id', { get: getter }), foreign])
        expect(() => validateImportedWorkspace(db, projectId, plan.id, value as DataImport)).toThrow(/repository-loaded/);
      expect(getter).not.toHaveBeenCalled(); expect(db.inTransaction).toBe(true); db.exec('ROLLBACK');
    } finally { other.close(); }
  });

  it('rejects an old genuine snapshot after a source generation change', () => {
    const plan = fixture(), source = load(plan.jobId);
    db.prepare('UPDATE import_sources SET sha256=sha256 WHERE import_id=?').run(plan.id);
    db.exec('BEGIN'); expect(() => validateImportedWorkspace(db, projectId, plan.id, source)).toThrow(/changed/);
    expect(db.inTransaction).toBe(true); db.exec('ROLLBACK'); expect(check(plan).itemCount).toBe(3);
  });

  it('rechecks generation at the end without acquiring or rolling back a TX', () => {
    const plan = fixture(); db.exec('BEGIN'); const source = load(plan.jobId);
    const native = db.prepare.bind(db); let reads = 0;
    vi.spyOn(db, 'prepare').mockImplementation((sql) => {
      if (sql.includes('FROM import_generations WHERE import_id=?') && ++reads === 2)
        native('UPDATE import_sources SET sha256=sha256 WHERE import_id=?').run(plan.id);
      return native(sql);
    });
    expect(() => validateImportedWorkspace(db, projectId, plan.id, source)).toThrow(/changed/);
    expect(reads).toBe(2); expect(db.inTransaction).toBe(true); db.exec('ROLLBACK');
  });

  it('keeps the caller read snapshot stable across external committed graph changes', () => {
    const plan = fixture(), other = openDatabase(path);
    try {
      db.exec('BEGIN'); const source = load(plan.jobId);
      other.exec('DELETE FROM annotation_provenance');
      expect(validateImportedWorkspace(db, projectId, plan.id, source).itemCount).toBe(3);
      db.exec('COMMIT'); expect(() => check(plan)).toThrow();
    } finally { other.close(); }
  });

  it('summarizes whole-workspace readiness without writes', () => {
    const plan = fixture('classification', 2), before = graph();
    const first = validateAnnotationWorkspace(db, projectId, plan.id);
    expect(first.valid).toBe(false);
    expect(first.total).toBe(2);
    expect(first.unconfirmed).toBe(2);
    expect(first.excluded).toBe(0);
    expect(first.byCode.unconfirmed).toBe(2);
    expect(graph()).toEqual(before);

    db.prepare("UPDATE annotation_items SET state='excluded',exclusion_reason='unit',edit_version=edit_version+1 WHERE image_key='image:1'")
      .run();
    const second = validateAnnotationWorkspace(db, projectId, plan.id);
    expect(second.unconfirmed).toBe(1);
    expect(second.excluded).toBe(1);
    expect(second.byCode.excluded).toBe(1);
  });

  /** Confirms every item of the workspace, 5 per class (FR-CVP-001 minimum for classification). */
  function confirmWithClasses(workspaceId: string, schemaId: string): void {
    const classes = (db.prepare('SELECT id,normalized_name AS name FROM label_classes WHERE schema_id=?')
      .all(schemaId) as { id: string; name: string }[]);
    const ids = [classes.find((entry) => entry.name === 'cat')!.id, classes.find((entry) => entry.name === 'dog')!.id];
    const items = db.prepare('SELECT id,image_key AS imageKey FROM annotation_items WHERE workspace_id=? ORDER BY image_key')
      .all(workspaceId) as { id: string; imageKey: string }[];
    items.forEach((item, index) => {
      const text = canonicalAnnotationJson({ kind: 'classification', classId: ids[index < 5 ? 0 : 1] });
      db.prepare('DELETE FROM annotation_provenance WHERE item_id=?').run(item.id);
      db.prepare("INSERT INTO annotation_provenance(item_id,target_key,kind,original_json,changes_json) VALUES (?,'classification','manual','{}','{}')")
        .run(item.id);
      db.prepare(`UPDATE annotation_items SET annotation_json=?,annotation_sha256=?,state='confirmed',
        confirmed_at=?,edit_version=edit_version+1 WHERE id=?`).run(text, annotationDigest(text), at, item.id);
    });
  }

  it('creates a revision manifest, freezes the workspace, queues training and clones without changing the revision', () => {
    const plan = fixture('classification', 10);
    confirmWithClasses(plan.id, plan.labels.schemaId);

    const created = createDatasetRevision(db, { projectId, workspaceId: plan.id, splitSeed: 42, createdBy: 'unit-test' });
    expect(created.coverage.errors).toEqual([]);
    expect(created.revision.revisionNo).toBe(1);
    expect(created.revision.manifestRelativePath).toBe(`datasets/${created.revision.id}/manifest.json`);
    expect(db.prepare('SELECT state FROM annotation_workspaces WHERE id=?').get(plan.id)).toEqual({ state: 'frozen' });
    expect(db.prepare('SELECT count(*) AS total FROM dataset_items WHERE revision_id=?').get(created.revision.id)).toEqual({ total: 10 });

    const queued = enqueueTrainingRun(db, projectId, created.revision.id, at);
    expect(queued.job.status).toBe('Queued');
    expect(queued.job.kind).toBe('train');

    const combinedPlan = fixture('classification', 10);
    confirmWithClasses(combinedPlan.id, combinedPlan.labels.schemaId);
    const combined = confirmDatasetAndQueueTraining(db, { projectId, workspaceId: combinedPlan.id, splitSeed: 43, createdBy: 'unit-test' });
    expect(combined.training.job.status).toBe('Queued');

    const revisionCount = db.prepare('SELECT count(*) AS total FROM dataset_revisions').get();
    const cloned = cloneWorkspaceFromRevision(db, projectId, created.revision.id);
    expect(cloned.itemCount).toBe(10);
    expect(db.prepare('SELECT count(*) AS total FROM dataset_revisions').get()).toEqual(revisionCount);
    expect(db.prepare('SELECT source_revision_id AS id FROM workspace_revision_sources WHERE workspace_id=?').get(cloned.workspaceId))
      .toEqual({ id: created.revision.id });
  });

  it('FR-CVP-001: rejects a revision with a class below the minimum and leaves the workspace unfrozen', () => {
    const plan = fixture('classification', 4);
    confirmWithClasses(plan.id, plan.labels.schemaId);
    let caught: unknown;
    try { createDatasetRevision(db, { projectId, workspaceId: plan.id, splitSeed: 1, createdBy: 'unit-test' }); } catch (error) { caught = error; }
    expect(caught).toMatchObject({ code: 'CLASS_COVERAGE_ERROR', message: 'CLASS_COVERAGE_ERROR' });
    expect(db.prepare('SELECT count(*) AS total FROM dataset_revisions').get()).toEqual({ total: 0 });
    expect(db.prepare('SELECT state FROM annotation_workspaces WHERE id=?').get(plan.id)).not.toEqual({ state: 'frozen' });
  });

  it('stratifies classification revision splits while keeping duplicate hashes together', () => {
    const plan = fixture('classification', 20);
    const classRows = db.prepare('SELECT id,normalized_name AS name FROM label_classes WHERE schema_id=?')
      .all(plan.labels.schemaId);
    const classes = classRows.map((row) => row as { id: string; name: string });
    const cat = classes.find((entry) => entry.name === 'cat')!.id;
    const dog = classes.find((entry) => entry.name === 'dog')!.id;
    const itemRows = db.prepare('SELECT id,image_key AS imageKey,image_sha256 AS imageSha256 FROM annotation_items WHERE workspace_id=? ORDER BY image_key')
      .all(plan.id);
    const items = itemRows as { id: string; imageKey: string; imageSha256: string }[];
    for (const item of items) {
      const index = Number(item.imageKey.split(':')[1]);
      const classId = index < 10 ? cat : dog;
      const text = canonicalAnnotationJson({ kind: 'classification', classId });
      db.prepare('DELETE FROM annotation_provenance WHERE item_id=?').run(item.id);
      db.prepare("INSERT INTO annotation_provenance(item_id,target_key,kind,original_json,changes_json) VALUES (?,'classification','manual','{}','{}')")
        .run(item.id);
      db.prepare(`UPDATE annotation_items SET annotation_json=?,annotation_sha256=?,state='confirmed',
        confirmed_at=?,edit_version=edit_version+1 WHERE id=?`).run(text, annotationDigest(text), at, item.id);
    }
    const created = createDatasetRevision(db, { projectId, workspaceId: plan.id, splitSeed: 7, createdBy: 'unit-test' });
    const splitRows = db.prepare(`SELECT d.split,json_extract(d.annotation_json,'$.classId') AS classId,d.image_sha256 AS hash
      FROM dataset_items d WHERE d.revision_id=? AND d.split IS NOT NULL`).all(created.revision.id);
    const rows = splitRows.map((row) => row as { split: string; classId: string; hash: string });
    for (const classId of [cat, dog]) {
      expect(new Set(rows.filter((row) => row.classId === classId).map((row) => row.split)))
        .toEqual(new Set(['train', 'validation', 'test']));
    }
    for (const hash of new Set(rows.map((row) => row.hash))) {
      expect(new Set(rows.filter((row) => row.hash === hash).map((row) => row.split)).size).toBe(1);
    }
  });
});