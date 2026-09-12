// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CreateLabelClassInput, LabelSchemaSnapshot, UpdateLabelClassInput } from '../../shared/contracts/annotation.js';
import type { ScanClass, ScanImage, ScanResult } from '../../shared/contracts/import.js';
import { insertDataImport, prepareDataImport } from '../data/import-repository.js';
import { openDatabase, type DatabaseConnection } from '../db/database.js';
import { migrateDatabase } from '../db/migrate.js';
import { encodeCanonicalAnnotation, LabelSchemaRepository } from './label-schema-repository.js';
import {
  createLabelClass, createLabelSchema, deleteLabelClass, getLabelSchema, insertImportLabels, lockLabelSchema,
  mergeLabelClasses, prepareImportLabels, readPreparedImportLabels, updateLabelClass, updateLabelSchema,
  type PreparedImportLabels,
} from './label-schema-service.js';
import { createAnnotationWorkspace, getAnnotationItem } from './workspace-service.js';

const now = '2026-09-12T01:02:03.004Z';
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const migrations = ['001_core.sql', '002_jobs.sql', '003_import.sql', '004_import_generation.sql',
  '005_import_rights.sql', '006_annotations.sql'].map((name, index) => ({ version: index + 1,
  sql: readFileSync(new URL(`../db/migrations/${name}`, import.meta.url), 'utf8') }));
let directory: string;
let db: DatabaseConnection;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'autovision-ann03-'));
  db = openDatabase(join(directory, 'metadata.sqlite3'));
  migrateDatabase(db, migrations);
});
afterEach(() => {
  vi.restoreAllMocks();
  if (db.inTransaction) db.exec('ROLLBACK');
  if (db.open) db.close();
  rmSync(directory, { recursive: true, force: true });
});
function project(task = 'classification'): string {
  const id = randomUUID();
  db.prepare(`INSERT INTO projects(id,name,task_type,workspace_path,created_at,updated_at)
    VALUES (?,'fixture',?,'C:\\fixture',?,?)`).run(id, task, now, now);
  return id;
}
function command(s: LabelSchemaSnapshot, displayName = '猫', ordinal = 0): CreateLabelClassInput {
  return { schemaId: s.id, expectedEditVersion: s.editVersion, displayName, color: '#abcdef', description: '', examples: [], ordinal };
}
function edit(s: LabelSchemaSnapshot, index = 0): UpdateLabelClassInput {
  const c = s.classes[index];
  return { id: c.id, schemaId: s.id, expectedEditVersion: s.editVersion, displayName: c.displayName,
    modelAlias: c.modelAlias, color: c.color, description: c.description, examples: c.examples, ordinal: c.ordinal };
}
function rows(): unknown[] {
  return ['label_schemas', 'label_classes', 'annotation_workspaces', 'annotation_items', 'annotation_provenance',
    'dataset_revisions', 'dataset_items', 'jobs', 'projects', 'data_imports', 'import_sources', 'import_generations',
    'project_import_rights'].map((table) => db.prepare(`SELECT * FROM ${table}`).all());
}
function createActualWorkspace(taskType: ScanResult['taskType'] = 'classification') {
  const parent = project(taskType);
  let schema = createLabelSchema(db, parent);
  for (const [ordinal, name] of ['source', 'target', 'last'].entries())
    schema = createLabelClass(db, parent, command(schema, name, ordinal));
  const [source, target, last] = schema.classes.map((entry) => entry.id);
  const scan = randomUUID(), importId = randomUUID();
  db.prepare(`INSERT INTO jobs(id,project_id,kind,status,created_at,updated_at)
    VALUES (?,?,'scan-dataset','Succeeded',?,?)`).run(scan, parent, now, now);
  const images: ScanImage[] = [0, 1].map((index) => ({ key: `image:${index}`, sourcePath: `C:\\images\\${index}.png`,
    byteSize: 100, mtimeNs: '1234567890123456789', sha256: hash(`image:${index}`), format: 'png',
    width: 100, height: 80, orientation: 1, duplicateOf: null,
    annotation: taskType === 'classification' ? { type: 'classification', classKey: 'scan:source', sourceRow: index + 2 }
      : { type: 'detection', sourceImageId: String(index + 1), boxes: [{ classKey: 'scan:source',
        sourceAnnotationId: String(index + 10), bbox: [0, 0, 10, 10] }] } }));
  const prepared = prepareDataImport({ id: importId, createdAt: now, updatedAt: now,
    scanResult: { formatVersion: 1, projectId: parent, jobId: scan, taskType, mode: 'copy',
      classes: [{ key: 'scan:source', name: 'Raw Source', sourceCategoryId: taskType === 'detection' ? '1' : null }], images, issues: [] },
    sourceManifest: { formatVersion: 1, mode: 'copy', entries: images.map((image, index) => ({ imageKey: image.key,
      relativePath: `datasets/${importId}/source/${index}.png`, byteSize: image.byteSize, sha256: image.sha256 })) } });
  db.exec('BEGIN IMMEDIATE');
  try { insertDataImport(db, prepared); db.exec('COMMIT'); }
  finally { if (db.inTransaction) db.exec('ROLLBACK'); }
  const { workspace } = createAnnotationWorkspace(db, parent, importId, schema.id, { 'scan:source': source });
  const items = db.prepare('SELECT id FROM annotation_items WHERE workspace_id=? ORDER BY id').all(workspace.id) as { id: string }[];
  expect(getLabelSchema(db, parent)?.classes.map((entry) => entry.id)).toEqual([source, target, last]);
  return { parent, schema, source, target, last, workspace: workspace.id, items };
}
function fixture(task = 'classification', imported = true, confirmed = true) {
  const parent = project(task);
  let schema = createLabelSchema(db, parent);
  schema = createLabelClass(db, parent, command(schema, 'source', 0));
  schema = createLabelClass(db, parent, command(schema, 'target', 1));
  const source = schema.classes[0].id; const target = schema.classes[1].id;
  const scan = randomUUID(); const importId = randomUUID(); const workspace = randomUUID(); const item = randomUUID();
  const rectangle = randomUUID();
  db.prepare('INSERT INTO project_import_rights VALUES (?,?)').run(parent, now);
  db.prepare(`INSERT INTO jobs(id,project_id,kind,status,created_at,updated_at)
    VALUES (?,?,'scan-dataset','Succeeded',?,?)`).run(scan, parent, now, now);
  db.prepare(`INSERT INTO data_imports(id,project_id,scan_job_id,task_type,mode,created_at,updated_at,
    scan_result_json,scan_result_sha256,source_manifest_json,source_manifest_sha256)
    VALUES (?,?,?,?,'reference',?,?,'{}',?,'{}',?)`).run(importId, parent, scan, task, now, now, hash('{}'), hash('{}'));
  db.prepare(`INSERT INTO import_sources(import_id,image_key,ordinal,mode,source_path,identity_dev,
    identity_ino,identity_birthtime_ns,byte_size,mtime_ns,sha256,entry_sha256)
    VALUES (?,'image',0,'reference','C:\\image.png','1','2','3',10,'4',?,?)`).run(importId, hash('image'), hash('entry'));
  db.prepare(`INSERT INTO annotation_workspaces(id,project_id,schema_id,task_type,mode,created_at,updated_at)
    VALUES (?,?,?,?,'reference',?,?)`).run(workspace, parent, schema.id, task, now, now);
  const encoded = encodeCanonicalAnnotation(task === 'classification' ? { kind: 'classification', classId: source }
    : { kind: 'detection', rectangles: [{ id: rectangle, classId: source, x: 0, y: 0, width: 10, height: 10 }] });
  db.prepare(`INSERT INTO annotation_items(id,workspace_id,import_id,image_key,image_sha256,width,height,
    annotation_json,annotation_sha256,updated_at) VALUES (?,?,?,'image',?,100,80,?,?,?)`)
    .run(item, workspace, importId, hash('image'), encoded.json, encoded.sha256, now);
  db.prepare(`INSERT INTO annotation_provenance(item_id,target_key,kind,source_import_id,source_image_key,
    source_annotation_key,original_json,changes_json) VALUES (?,?,?,?,?,?,'{"caption":"original"}','{"note":"retained"}')`)
    .run(item, task === 'classification' ? 'classification' : rectangle, imported ? 'import-unmodified' : 'manual',
      imported ? importId : null, imported ? 'image' : null, imported ? 'raw-label' : null);
  if (confirmed) db.prepare(`UPDATE annotation_items SET state='confirmed',confirmed_at=?,edit_version=edit_version+1 WHERE id=?`).run(now, item);
  return { parent, schema, source, target, workspace, item, importId };
}
function publish(f: ReturnType<typeof fixture>): void {
  const revision = randomUUID();
  db.exec('BEGIN IMMEDIATE');
  db.prepare(`INSERT INTO dataset_items(id,revision_id,source_item_id,import_id,image_key,image_sha256,width,height,
    source_snapshot_json,annotation_json,annotation_sha256,provenance_json,disposition,split)
    SELECT ?,?,a.id,a.import_id,a.image_key,a.image_sha256,a.width,a.height,s.snapshot_json,a.annotation_json,
      a.annotation_sha256,p.snapshot_json,'labeled','train' FROM annotation_items a
      JOIN annotation_source_snapshots s ON s.import_id=a.import_id AND s.image_key=a.image_key
      JOIN annotation_provenance_snapshots p ON p.item_id=a.id WHERE a.id=?`).run(randomUUID(), revision, f.item);
  const manifest = JSON.stringify({ revisionId: revision, workspaceId: f.workspace, itemCount: 1 });
  db.prepare(`INSERT INTO dataset_revisions(id,project_id,workspace_id,revision_no,mode,manifest_json,
    manifest_sha256,manifest_relative_path,schema_snapshot_json,split_seed,created_by,confirmed_at)
    SELECT ?,?,?,1,'reference',?,?,?,snapshot_json,42,'local-user',? FROM annotation_schema_snapshots WHERE schema_id=?`)
    .run(revision, f.parent, f.workspace, manifest, hash(manifest), `datasets/${revision}/manifest.json`, now, f.schema.id);
  db.exec('COMMIT');
}

describe('ANN-03 label schema backend', () => {
  it('does not seed on read; explicitly creates one empty schema only for an existing Project', () => {
    const parent = project();
    expect(getLabelSchema(db, parent)).toBeUndefined();
    expect(() => createLabelSchema(db, randomUUID())).toThrow();
    const s = createLabelSchema(db, parent);
    expect(s).toMatchObject({ projectId: parent, instructions: '', classes: [], editVersion: 0, lockedAt: null });
    expect(createLabelSchema(db, parent)).toEqual(s);
    expect(getLabelSchema(db, parent)).toEqual(s);
    expect(db.prepare('SELECT * FROM jobs').all()).toEqual([]);
  });
  it('keeps class UUID, raw Unicode spelling, alias and timestamps separate and bumps parent once', () => {
    const parent = project(); let s = createLabelSchema(db, parent);
    s = createLabelClass(db, parent, { ...command(s, '\u0085ＣＡＴ　'), modelAlias: 'cat-model', examples: ['境界'], description: '説明' });
    const original = s.classes[0];
    expect(original).toMatchObject({ displayName: '\u0085ＣＡＴ　', normalizedName: 'cat', modelAlias: 'cat-model' });
    expect(s.editVersion).toBe(1);
    s = updateLabelClass(db, parent, { ...edit(s), displayName: 'e\u0301', color: '#112233', ordinal: 9, modelAlias: null });
    expect(s.classes[0]).toMatchObject({ id: original.id, createdAt: original.createdAt, normalizedName: 'é', ordinal: 9 });
    expect(s.editVersion).toBe(2);
    s = updateLabelSchema(db, parent, { id: s.id, expectedEditVersion: 2, instructions: '画面端を確認' });
    expect(s.editVersion).toBe(3);
    expect(s.instructions).toBe('画面端を確認');
    s = deleteLabelClass(db, parent, s.id, original.id, 3);
    expect(s.classes).toEqual([]); expect(s.editVersion).toBe(4);
  });
  it.each(['ﬃ'.repeat(86), 'İ'.repeat(129), '\u0085', '😀'.repeat(257)])('rejects invalid/expanded names before any SQL %#', (displayName) => {
    const s = createLabelSchema(db, project());
    const prepare = vi.spyOn(db, 'prepare'); const exec = vi.spyOn(db, 'exec');
    expect(() => createLabelClass(db, s.projectId, command(s, displayName))).toThrow();
    expect(prepare).not.toHaveBeenCalled(); expect(exec).not.toHaveBeenCalled();
  });
  it('rejects unknown fields, forged authority, uppercase root IDs and bad versions before SQL', () => {
    const s = createLabelSchema(db, project());
    const prepare = vi.spyOn(db, 'prepare'); const exec = vi.spyOn(db, 'exec');
    expect(() => createLabelClass(db, s.projectId, { ...command(s), normalizedName: 'forged' } as CreateLabelClassInput)).toThrow();
    expect(() => updateLabelSchema(db, s.projectId, { id: s.id, expectedEditVersion: 0, instructions: '', lockedAt: now } as never)).toThrow();
    expect(() => getLabelSchema(db, s.projectId.toUpperCase())).toThrow();
    expect(() => deleteLabelClass(db, s.projectId, s.id, randomUUID(), NaN)).toThrow();
    expect(prepare).not.toHaveBeenCalled(); expect(exec).not.toHaveBeenCalled();
  });
  it('rejects normalized duplicates and occupied ordinals without swaps or version changes', () => {
    let s = createLabelSchema(db, project()); s = createLabelClass(db, s.projectId, command(s, 'ＣＡＴ'));
    const before = rows();
    expect(() => createLabelClass(db, s.projectId, command(s, 'cat', 1))).toThrow();
    expect(() => createLabelClass(db, s.projectId, command(s, 'dog', 0))).toThrow();
    expect(rows()).toEqual(before);
    s = createLabelClass(db, s.projectId, command(s, 'dog', 1));
    const beforeEdit = rows();
    expect(() => updateLabelClass(db, s.projectId, { ...edit(s, 1), ordinal: 0 })).toThrow();
    expect(rows()).toEqual(beforeEdit);
  });
  it('rejects foreign Projects/schema/classes and stale parent CAS without changes', () => {
    let a = createLabelSchema(db, project()); a = createLabelClass(db, a.projectId, command(a));
    const b = createLabelSchema(db, project()); const before = rows();
    expect(() => createLabelClass(db, b.projectId, command(a, 'dog', 1))).toThrow();
    expect(() => updateLabelClass(db, a.projectId, { ...edit(a), id: randomUUID() })).toThrow();
    expect(() => updateLabelSchema(db, a.projectId, { id: a.id, expectedEditVersion: 0, instructions: 'stale' })).toThrow();
    expect(() => deleteLabelClass(db, a.projectId, b.id, a.classes[0].id, 1)).toThrow();
    expect(rows()).toEqual(before);
  });
  it('rejects public reads/writes within foreign transactions without touching or rolling them back', () => {
    const parent = project(); db.exec('BEGIN');
    db.prepare('UPDATE projects SET name=? WHERE id=?').run('uncommitted', parent);
    expect(() => getLabelSchema(db, parent)).toThrow();
    expect(() => createLabelSchema(db, parent)).toThrow();
    expect(db.inTransaction).toBe(true);
    expect(db.prepare('SELECT name FROM projects WHERE id=?').get(parent)).toEqual({ name: 'uncommitted' });
    db.exec('ROLLBACK');
  });
  it('rolls the parent CAS back when a later SQLite statement aborts', () => {
    const s = createLabelSchema(db, project()); const before = rows();
    db.exec("CREATE TRIGGER injected_abort BEFORE INSERT ON label_classes BEGIN SELECT RAISE(ABORT,'injected'); END");
    expect(() => createLabelClass(db, s.projectId, command(s))).toThrow();
    expect(rows()).toEqual(before); expect(db.inTransaction).toBe(false);
  });
  it.each([false, true])('does not delete classes referenced by draft/confirmed annotations (%s)', (confirmed) => {
    const f = fixture('classification', false, confirmed); const before = rows();
    expect(() => deleteLabelClass(db, f.parent, f.schema.id, f.source, f.schema.editVersion)).toThrow();
    expect(rows()).toEqual(before);
  });
  it.each(['classification', 'detection'])('merges %s, unconfirms, hashes and preserves imported provenance', (task) => {
    const f = fixture(task);
    const s = mergeLabelClasses(db, f.parent, f.schema.id, f.source, f.target, f.schema.editVersion);
    expect(s.classes.map((c) => c.id)).toEqual([f.target]); expect(s.editVersion).toBe(3);
    const item = db.prepare('SELECT * FROM annotation_items WHERE id=?').get(f.item) as Record<string, string | number | null>;
    expect(item).toMatchObject({ state: 'editing', confirmed_at: null, negative_confirmed: 0, edit_version: 2 });
    expect(item['annotation_json']).toContain(f.target); expect(item['annotation_json']).not.toContain(f.source);
    expect(item['annotation_sha256']).toBe(hash(item['annotation_json'] as string));
    const p = db.prepare('SELECT * FROM annotation_provenance WHERE item_id=?').get(f.item) as Record<string, string>;
    expect(p['kind']).toBe('import-edited'); expect(p['original_json']).toBe('{"caption":"original"}');
    expect(p['source_import_id']).toBe(f.importId);
    expect(JSON.parse(p['changes_json'])).toEqual({ note: 'retained', classId: { from: f.source, to: f.target } });
    expect(db.prepare('SELECT edit_version FROM annotation_workspaces WHERE id=?').get(f.workspace)).toEqual({ edit_version: 1 });
  });
  it('keeps manual provenance manual and preserves the first delta origin across repeated merges', () => {
    const f = fixture('classification', false, false);
    db.prepare('UPDATE annotation_provenance SET changes_json=? WHERE item_id=?')
      .run(JSON.stringify({ classId: { from: 'original-label', to: f.source }, note: 'kept' }), f.item);
    mergeLabelClasses(db, f.parent, f.schema.id, f.source, f.target, 2);
    const p = db.prepare('SELECT kind,changes_json FROM annotation_provenance WHERE item_id=?').get(f.item) as { kind: string; changes_json: string };
    expect(p.kind).toBe('manual');
    expect(JSON.parse(p.changes_json)).toEqual({ classId: { from: 'original-label', to: f.target }, note: 'kept' });
  });
  it.each(['hash', 'key-order', 'whitespace'] as const)('rejects saved annotation %s without repairing any rows', (corruption) => {
    const f = createActualWorkspace();
    const item = f.items[1].id; // A prior item has already been updated when this one fails.
    const raw = db.prepare('SELECT annotation_json FROM annotation_items WHERE id=?').get(item) as { annotation_json: string };
    const text = corruption === 'key-order' ? `{"kind":"classification","classId":"${f.source}"}`
      : corruption === 'whitespace' ? ` ${raw.annotation_json}` : raw.annotation_json;
    db.prepare('UPDATE annotation_items SET annotation_json=?,annotation_sha256=?,edit_version=edit_version+1 WHERE id=?')
      .run(text, corruption === 'hash' ? hash('corrupt') : hash(text), item);
    const before = rows();
    expect(() => mergeLabelClasses(db, f.parent, f.schema.id, f.source, f.target, f.schema.editVersion))
      .toThrow(expect.objectContaining({ code: 'LABEL_STORED_DATA' }));
    expect(rows()).toEqual(before);
    expect(getLabelSchema(db, f.parent)).toEqual(f.schema);
    expect(db.inTransaction).toBe(false);
  });
  it.each(['original_json', 'changes_json'] as const)('rejects noncanonical existing %s and preserves original bytes', (column) => {
    const f = createActualWorkspace();
    const item = f.items[1].id;
    const raw = db.prepare(`SELECT ${column} AS text FROM annotation_provenance WHERE item_id=?`).get(item) as { text: string };
    db.prepare(`UPDATE annotation_provenance SET ${column}=? WHERE item_id=?`).run(` ${raw.text}`, item);
    const before = rows();
    expect(() => mergeLabelClasses(db, f.parent, f.schema.id, f.source, f.target, f.schema.editVersion))
      .toThrow(expect.objectContaining({ code: 'LABEL_STORED_DATA' }));
    expect(rows()).toEqual(before); expect(getLabelSchema(db, f.parent)).toEqual(f.schema);
    expect(db.inTransaction).toBe(false);
  });
  it.each(['classification', 'detection'] as const)('ANN-05 reads actual %s workspaces after two ANN-03 merges', (task) => {
    const f = createActualWorkspace(task);
    const before = f.items.map(({ id }) => getAnnotationItem(db, f.parent, f.workspace, id));
    const originals = db.prepare('SELECT item_id,original_json FROM annotation_provenance ORDER BY item_id,target_key').all();
    const imports = db.prepare('SELECT * FROM data_imports ORDER BY id').all();
    const sources = db.prepare('SELECT * FROM import_sources ORDER BY import_id,ordinal').all();
    let schema = f.schema;
    for (const [source, target] of [[f.source, f.target], [f.target, f.last]]) {
      schema = mergeLabelClasses(db, f.parent, schema.id, source, target, schema.editVersion);
      expect(schema.classes.some((entry) => entry.id === source)).toBe(false);
      for (const [index, { id }] of f.items.entries()) {
        const detail = getAnnotationItem(db, f.parent, f.workspace, id);
        const encoded = encodeCanonicalAnnotation(detail.item.annotation);
        expect(db.prepare('SELECT annotation_json,annotation_sha256 FROM annotation_items WHERE id=?').get(id))
          .toEqual({ annotation_json: encoded.json, annotation_sha256: hash(encoded.json) });
        expect(detail.item.annotationSha256).toBe(hash(encoded.json));
        expect(detail.provenance).toEqual(before[index].provenance.map((p) => ({ ...p, kind: 'import-edited',
          changes: { classId: { from: f.source, to: target } } })));
        const p = db.prepare('SELECT changes_json FROM annotation_provenance WHERE item_id=?').get(id) as { changes_json: string };
        expect(p.changes_json).toBe(`{"classId":{"from":"${f.source}","to":"${target}"}}`);
      }
      expect(db.prepare('SELECT item_id,original_json FROM annotation_provenance ORDER BY item_id,target_key').all()).toEqual(originals);
      expect(db.prepare('SELECT * FROM data_imports ORDER BY id').all()).toEqual(imports);
      expect(db.prepare('SELECT * FROM import_sources ORDER BY import_id,ordinal').all()).toEqual(sources);
    }
  });
  it.each([false, true])('keeps manual/import provenance canonical with integer keys and array order (%s)', (imported) => {
    const f = fixture('classification', imported, false);
    const original = '{"10":{"a":1,"z":2},"2":[{"a":3,"z":4},2,1],"caption":"日本語"}';
    db.prepare('UPDATE annotation_provenance SET original_json=?,changes_json=? WHERE item_id=?')
      .run(original, `{"10":[{"a":1,"z":2},3,2],"2":true,"classId":{"from":"first-origin","to":"${f.source}"}}`, f.item);
    let schema = createLabelClass(db, f.parent, command(f.schema, 'last', 2));
    const last = schema.classes[2].id;
    for (const [source, target] of [[f.source, f.target], [f.target, last]]) {
      schema = mergeLabelClasses(db, f.parent, schema.id, source, target, schema.editVersion);
      const p = db.prepare('SELECT * FROM annotation_provenance WHERE item_id=?').get(f.item) as Record<string, string | null>;
      expect(p['kind']).toBe(imported ? 'import-edited' : 'manual');
      expect(p['source_import_id']).toBe(imported ? f.importId : null);
      expect(p['original_json']).toBe(original);
      expect(p['changes_json']).toBe(`{"10":[{"a":1,"z":2},3,2],"2":true,"classId":{"from":"first-origin","to":"${target}"}}`);
    }
  });
  it('inserts canonical manual provenance when a draft has no provenance', () => {
    const f = fixture('classification', false, false);
    db.prepare('DELETE FROM annotation_provenance WHERE item_id=?').run(f.item);
    mergeLabelClasses(db, f.parent, f.schema.id, f.source, f.target, f.schema.editVersion);
    expect(db.prepare('SELECT kind,original_json,changes_json FROM annotation_provenance WHERE item_id=?').get(f.item))
      .toEqual({ kind: 'manual', original_json: '{}', changes_json: `{"classId":{"from":"${f.source}","to":"${f.target}"}}` });
  });
  it('rolls back annotation, confirmation, provenance, workspace and parent when merge deletion aborts', () => {
    const f = fixture(); const before = rows();
    db.exec("CREATE TRIGGER merge_abort BEFORE DELETE ON label_classes BEGIN SELECT RAISE(ABORT,'injected'); END");
    expect(() => mergeLabelClasses(db, f.parent, f.schema.id, f.source, f.target, 2)).toThrow();
    expect(rows()).toEqual(before); expect(db.inTransaction).toBe(false);
  });
  it('rejects frozen history references without editing or deleting historical content', () => {
    const f = fixture(); publish(f); const before = rows();
    expect(() => mergeLabelClasses(db, f.parent, f.schema.id, f.source, f.target, 2)).toThrow(expect.objectContaining({ code: 'LABEL_HISTORY_REFERENCE' }));
    expect(rows()).toEqual(before);
  });
  it('participates only in Main training-start transactions, rolls back with owner and permanently locks after commit', () => {
    let s = createLabelSchema(db, project()); s = createLabelClass(db, s.projectId, command(s));
    expect(() => lockLabelSchema(db, s.projectId, s.id, 1)).toThrow();
    db.exec('BEGIN'); const provisional = lockLabelSchema(db, s.projectId, s.id, 1);
    expect(provisional.lockedAt).not.toBeNull(); expect(db.inTransaction).toBe(true); db.exec('ROLLBACK');
    expect(getLabelSchema(db, s.projectId)).toEqual(s);
    s = updateLabelSchema(db, s.projectId, { id: s.id, expectedEditVersion: 1, instructions: 'before training' });
    db.exec('BEGIN'); lockLabelSchema(db, s.projectId, s.id, 2); db.exec('COMMIT');
    const before = rows();
    expect(() => createLabelClass(db, s.projectId, command({ ...s, editVersion: 3 }, 'new', 1))).toThrow();
    expect(() => updateLabelClass(db, s.projectId, { ...edit(s), expectedEditVersion: 3 })).toThrow();
    expect(() => updateLabelSchema(db, s.projectId, { id: s.id, expectedEditVersion: 3, instructions: 'locked' })).toThrow();
    expect(() => deleteLabelClass(db, s.projectId, s.id, s.classes[0].id, 3)).toThrow();
    db.exec('BEGIN'); expect(() => lockLabelSchema(db, s.projectId, s.id, 3)).toThrow();
    expect(db.inTransaction).toBe(true); db.exec('COMMIT');
    expect(rows()).toEqual(before); expect(db.prepare('SELECT * FROM jobs').all()).toEqual([]);
  });
  it('rejects malformed stored examples and duplicate ordinals instead of repairing reads', () => {
    let s = createLabelSchema(db, project()); s = createLabelClass(db, s.projectId, command(s));
    db.prepare('UPDATE label_classes SET examples_json=? WHERE id=?').run('[{"caption":"not text"}]', s.classes[0].id);
    expect(() => getLabelSchema(db, s.projectId)).toThrow();
    db.prepare("UPDATE label_classes SET examples_json='[]' WHERE id=?").run(s.classes[0].id);
    s = createLabelClass(db, s.projectId, command(s, 'dog', 1));
    db.prepare('UPDATE label_classes SET ordinal=0 WHERE id=?').run(s.classes[1].id);
    const before = rows(); expect(() => getLabelSchema(db, s.projectId)).toThrow(); expect(rows()).toEqual(before);
  });
  it('rejects escaped duplicate stored annotation keys and unknown fields atomically', () => {
    const f = fixture('classification', false, false);
    for (const text of [
      `{"kind":"classification","classId":"${f.source}","class\\u0049d":"${f.source}"}`,
      JSON.stringify({ kind: 'classification', classId: f.source, unknown: true }),
    ]) {
      db.prepare('UPDATE annotation_items SET annotation_json=?,edit_version=edit_version+1 WHERE id=?').run(text, f.item);
      const before = rows(); expect(() => mergeLabelClasses(db, f.parent, f.schema.id, f.source, f.target, 2)).toThrow();
      expect(rows()).toEqual(before);
    }
  });
  it('canonical encoding fixes property order and preserves rectangle array order', () => {
    const classId = randomUUID(); const rectangle = randomUUID();
    const a = encodeCanonicalAnnotation({ kind: 'detection', rectangles: [{ id: rectangle, classId, x: 1, y: 2, width: 3, height: 4 }] });
    const b = encodeCanonicalAnnotation({ rectangles: [{ height: 4, width: 3, y: 2, x: 1, classId, id: rectangle }], kind: 'detection' });
    expect(a).toEqual(b);
    expect(a.json).toBe(`{"kind":"detection","rectangles":[{"classId":"${classId}","height":4,"id":"${rectangle}","width":3,"x":1,"y":2}]}`);
    expect(a.sha256).toBe(hash(a.json));
  });
});

function scanClass(key = 'scan:cat', name = 'cat', sourceCategoryId: string | null = null): ScanClass {
  return { key, name, sourceCategoryId };
}

describe('DAT-08B prepared import label participant', () => {
  it('prepares without SQL writes, exposes only frozen metadata, and inserts the exact future schema through normal CRUD', () => {
    const parent = project('detection'), sourceId = randomUUID();
    const classes = Object.freeze([Object.freeze(scanClass(sourceId, '\u0085ＣＡＴ　', '7')),
      Object.freeze(scanClass('scan:8', 'source spelling', '8'))]);
    const before = rows();
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse(now));
    const prepare = vi.spyOn(db, 'prepare'), exec = vi.spyOn(db, 'exec');
    const capability = prepareImportLabels(db, parent, classes, { 'scan:8': 'e\u0301' });
    expect(prepare.mock.calls.length).toBeGreaterThan(0);
    expect(prepare.mock.calls.every(([sql]) => /^\s*SELECT\b/iu.test(sql))).toBe(true);
    expect(exec.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN', expect.stringMatching(/^SAVEPOINT label_/u), 'COMMIT']);
    prepare.mockClear(); exec.mockClear();
    const planned = readPreparedImportLabels(capability);
    expect(readPreparedImportLabels(capability)).toBe(planned);
    expect(prepare).not.toHaveBeenCalled(); expect(exec).not.toHaveBeenCalled();
    expect(Object.keys(capability).sort()).toEqual(['classMapping', 'projectId', 'schemaId']);
    expect(Object.isFrozen(capability)).toBe(true); expect(Object.isFrozen(capability.classMapping)).toBe(true);
    expect(Object.isFrozen(planned)).toBe(true); expect(Object.isFrozen(planned.classes)).toBe(true);
    expect(planned).toMatchObject({ projectId: parent, id: capability.schemaId, instructions: '', lockedAt: null,
      editVersion: 2, createdAt: now, updatedAt: '2026-09-12T01:02:03.006Z' });
    expect(planned.classes.map((entry) => [entry.displayName, entry.normalizedName, entry.ordinal]))
      .toEqual([['\u0085ＣＡＴ　', 'cat', 0], ['e\u0301', 'é', 1]]);
    for (const [index, entry] of planned.classes.entries()) {
      expect(entry).toMatchObject({ schemaId: planned.id, modelAlias: null, color: '#4f46e5', description: '', examples: [] });
      expect(entry.id).toMatch(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u);
      expect([sourceId, '7', '8', parent, planned.id]).not.toContain(entry.id);
      expect(entry.createdAt).toBe(entry.updatedAt);
      expect(Object.isFrozen(entry)).toBe(true); expect(Object.isFrozen(entry.examples)).toBe(true);
      expect(capability.classMapping[classes[index].key]).toBe(entry.id);
    }
    expect(rows()).toEqual(before); expect(db.inTransaction).toBe(false);
    const insert = vi.spyOn(LabelSchemaRepository.prototype, 'insert');
    const bump = vi.spyOn(LabelSchemaRepository.prototype, 'bump');
    const write = vi.spyOn(LabelSchemaRepository.prototype, 'writeClass');
    db.exec('BEGIN IMMEDIATE');
    const actual = insertImportLabels(db, capability);
    expect(actual).toEqual(planned); expect(actual).not.toBe(planned);
    expect(Object.isFrozen(actual.classes[0].examples)).toBe(true);
    expect(insert).toHaveBeenCalledTimes(1); expect(bump).toHaveBeenCalledTimes(2); expect(write).toHaveBeenCalledTimes(2);
    expect(bump.mock.calls.map(([snapshot]) => snapshot.editVersion)).toEqual([0, 1]);
    expect(db.inTransaction).toBe(true);
    db.exec('COMMIT');
    expect(getLabelSchema(db, parent)).toEqual(planned);
    expect(() => readPreparedImportLabels(capability)).toThrow(expect.objectContaining({ code: 'LABEL_INPUT' }));
    expect(db.prepare('SELECT * FROM annotation_items').all()).toEqual([]);
    expect(db.prepare('SELECT * FROM annotation_workspaces').all()).toEqual([]);
    expect(db.prepare('SELECT * FROM jobs').all()).toEqual([]);
  });
  it.each([false, true])('supports an empty class list without class mutations (existing schema: %s)', (existing) => {
    const parent = project();
    const previous = existing ? createLabelSchema(db, parent) : undefined;
    const before = rows();
    const prepared = prepareImportLabels(db, parent, []);
    const planned = readPreparedImportLabels(prepared);
    expect(planned.classes).toEqual([]); expect(Object.keys(prepared.classMapping)).toEqual([]);
    expect(planned.editVersion).toBe(0); if (previous) expect(planned).toEqual(previous);
    expect(rows()).toEqual(before);
    const bump = vi.spyOn(LabelSchemaRepository.prototype, 'bump');
    db.exec('BEGIN'); expect(insertImportLabels(db, prepared)).toEqual(planned); db.exec('COMMIT');
    expect(bump).not.toHaveBeenCalled();
    expect(getLabelSchema(db, parent)).toEqual(planned);
  });
  it('retains existing normalized matches verbatim and appends Unicode names after the maximum ordinal, bumping only new classes', () => {
    const parent = project(); let schema = createLabelSchema(db, parent);
    schema = createLabelClass(db, parent, { ...command(schema, 'ＣＡＴ', 4), modelAlias: 'model-cat',
      description: 'keep description', examples: ['keep example'] });
    schema = createLabelClass(db, parent, command(schema, 'unused', 20));
    schema = updateLabelSchema(db, parent, { id: schema.id, expectedEditVersion: schema.editVersion, instructions: 'keep instructions' });
    const prepared = prepareImportLabels(db, parent, [scanClass('raw:cat', ' cat '), scanClass('raw:dog', '犬　'),
      scanClass('raw:accent', 'e\u0301')]);
    const planned = readPreparedImportLabels(prepared);
    expect(planned.classes.slice(0, 2)).toEqual(schema.classes);
    expect(prepared.classMapping['raw:cat']).toBe(schema.classes[0].id);
    expect(planned.classes.slice(2).map((entry) => [entry.displayName, entry.normalizedName, entry.ordinal]))
      .toEqual([['犬　', '犬', 21], ['e\u0301', 'é', 22]]);
    expect(planned).toMatchObject({ id: schema.id, instructions: schema.instructions, lockedAt: null,
      createdAt: schema.createdAt, editVersion: schema.editVersion + 2 });
    db.exec('BEGIN IMMEDIATE'); expect(insertImportLabels(db, prepared)).toEqual(planned); db.exec('COMMIT');
    const unchanged = prepareImportLabels(db, parent, [scanClass('new-source-key', 'different raw name')], { 'new-source-key': 'ｃａｔ' });
    expect(unchanged.classMapping['new-source-key']).toBe(schema.classes[0].id);
    expect(readPreparedImportLabels(unchanged)).toEqual(planned);
    const before = rows(), bump = vi.spyOn(LabelSchemaRepository.prototype, 'bump');
    db.exec('BEGIN'); expect(insertImportLabels(db, unchanged)).toEqual(planned); db.exec('COMMIT');
    expect(bump).not.toHaveBeenCalled(); expect(rows()).toEqual(before);
  });
  it('permits additional images against a locked schema only when every class already matches', () => {
    const parent = project(); let schema = createLabelSchema(db, parent);
    schema = createLabelClass(db, parent, command(schema));
    db.exec('BEGIN'); schema = lockLabelSchema(db, parent, schema.id, schema.editVersion); db.exec('COMMIT');
    const before = rows();
    const prepared = prepareImportLabels(db, parent, [scanClass('another-source', '猫')]);
    expect(prepared.classMapping['another-source']).toBe(schema.classes[0].id);
    expect(readPreparedImportLabels(prepared)).toEqual(schema);
    expect(() => prepareImportLabels(db, parent, [scanClass('existing', '猫'), scanClass('unknown', '犬')]))
      .toThrow(expect.objectContaining({ code: 'LABEL_LOCKED' }));
    db.exec('BEGIN'); expect(insertImportLabels(db, prepared)).toEqual(schema); db.exec('COMMIT');
    expect(rows()).toEqual(before);
  });
  it.each([['cat', 'cat'], ['cat', 'ＣＡＴ'], ['é', 'e\u0301']])('rejects ambiguous normalized names rather than silently folding (%#)', (first, second) => {
    let schema = createLabelSchema(db, project());
    schema = createLabelClass(db, schema.projectId, command(schema, first));
    const before = rows();
    const prepare = vi.spyOn(db, 'prepare'), exec = vi.spyOn(db, 'exec');
    expect(() => prepareImportLabels(db, schema.projectId, [scanClass('one', first), scanClass('two', second)]))
      .toThrow(expect.objectContaining({ code: 'LABEL_DUPLICATE_NAME' }));
    expect(prepare).not.toHaveBeenCalled(); expect(exec).not.toHaveBeenCalled();
    expect(rows()).toEqual(before);
  });
  it('allows explicit disambiguation but rejects duplicate override names and unknown override keys', () => {
    const parent = project(), classes = [scanClass('one'), scanClass('two', 'ＣＡＴ')];
    expect(() => prepareImportLabels(db, parent, classes)).toThrow(expect.objectContaining({ code: 'LABEL_DUPLICATE_NAME' }));
    expect(() => prepareImportLabels(db, parent, classes, { two: 'cat' })).toThrow(expect.objectContaining({ code: 'LABEL_DUPLICATE_NAME' }));
    expect(() => prepareImportLabels(db, parent, classes, { unknown: 'dog' })).toThrow(expect.objectContaining({ code: 'LABEL_INPUT' }));
    const prepared = prepareImportLabels(db, parent, classes, { two: 'dog' });
    expect(readPreparedImportLabels(prepared).classes.map((entry) => entry.displayName)).toEqual(['cat', 'dog']);
    expect(prepared.classMapping['one']).not.toBe(prepared.classMapping['two']);
    expect(getLabelSchema(db, parent)).toBeUndefined();
  });
  it.each([
    { key: '', name: 'cat', sourceCategoryId: null }, { key: '\u0085', name: 'cat', sourceCategoryId: null },
    { key: 'bad\0key', name: 'cat', sourceCategoryId: null }, { key: '\ud800', name: 'cat', sourceCategoryId: null },
    { key: 'key', name: '', sourceCategoryId: null }, { key: 'key', name: 'ﬃ'.repeat(86), sourceCategoryId: null },
    { key: 'key', name: 'İ'.repeat(129), sourceCategoryId: null }, { key: 'key', name: '😀'.repeat(257), sourceCategoryId: null },
    { key: 'key', name: 'cat', sourceCategoryId: '01' }, { key: 'key', name: 'cat', sourceCategoryId: '-1' },
    { key: 'key', name: 'cat', sourceCategoryId: 1 }, { key: 'key', name: 'cat' },
    { key: 'key', name: 'cat', sourceCategoryId: null, modelAlias: 'forged' },
    { key: 'key', name: 'cat', sourceCategoryId: null, createdAt: now },
  ])('rejects malformed direct ScanClass fields and normal label-name violations before SQL (%#)', (row) => {
    const parent = project(), prepare = vi.spyOn(db, 'prepare'), exec = vi.spyOn(db, 'exec');
    expect(() => prepareImportLabels(db, parent, [row] as never)).toThrow(expect.objectContaining({ code: 'LABEL_INPUT' }));
    expect(prepare).not.toHaveBeenCalled(); expect(exec).not.toHaveBeenCalled();
  });
  it('rejects sparse arrays, duplicate keys/categories, getters, proxies, symbols and inherited/unknown maps without invoking them', () => {
    const parent = project(), row = scanClass();
    const invoke = vi.fn(() => { throw new Error('Caller code must never run.'); });
    const getterRow = Object.defineProperty({ ...row }, 'name', { get: invoke, enumerable: true });
    const getterArray = Object.defineProperty(new Array(1), '0', { get: invoke, enumerable: true });
    const getterMap = Object.defineProperty({}, row.key, { get: invoke, enumerable: true });
    const handler = { get: invoke, getPrototypeOf: invoke, ownKeys: invoke };
    const cases: [unknown, unknown][] = [
      [new Array(1), undefined], [getterArray, undefined], [[getterRow], undefined],
      [new Proxy([row], handler), undefined], [[new Proxy(row, handler)], undefined],
      [[row], new Proxy({}, handler)], [[row], getterMap], [[row], Object.create({ [row.key]: 'dog' })],
      [[Object.assign({}, row, { [Symbol('field')]: 'value' })], undefined],
      [Object.assign([row], { extra: 'value' }), undefined],
      [[Object.defineProperty({ ...row }, 'name', { value: 'cat', enumerable: false })], undefined],
      [[Object.create(row)], undefined], [[row, scanClass(row.key, 'dog')], undefined],
      [[scanClass('one', 'cat', '1'), scanClass('two', 'dog', '1')], undefined],
      [[row], { [row.key]: null }], [[row], { [row.key]: 'ﬃ'.repeat(86) }], [[row], { unknown: 'dog' }],
      [[row], { [Symbol('key')]: 'dog' }], [[row], null], [[row], []],
    ];
    const prepare = vi.spyOn(db, 'prepare'), exec = vi.spyOn(db, 'exec');
    for (const [classes, names] of cases) {
      expect(() => prepareImportLabels(db, parent, classes as readonly ScanClass[], names as Readonly<Record<string, string>>))
        .toThrow(expect.objectContaining({ code: 'LABEL_INPUT' }));
    }
    expect(invoke).not.toHaveBeenCalled(); expect(prepare).not.toHaveBeenCalled(); expect(exec).not.toHaveBeenCalled();
  });
  it('detaches inputs before the first database read and safely maps prototype-like source keys', () => {
    const parent = project();
    const classes = [scanClass('constructor'), scanClass('__proto__', 'dog'), scanClass('toString', 'bird')];
    const names: Record<string, string> = Object.create(null) as Record<string, string>;
    names['constructor'] = '猫'; names['__proto__'] = '犬';
    const realPrepare = db.prepare.bind(db);
    vi.spyOn(db, 'prepare').mockImplementationOnce((sql) => {
      classes[0].key = 'changed'; classes[0].name = 'changed'; names['constructor'] = 'changed';
      return realPrepare(sql);
    });
    const prepared = prepareImportLabels(db, parent, classes, names);
    const planned = readPreparedImportLabels(prepared);
    classes.push(scanClass('late', 'late')); names['__proto__'] = 'later';
    expect(Object.isFrozen(classes)).toBe(false); expect(Object.isFrozen(names)).toBe(false);
    expect(Object.getPrototypeOf(prepared.classMapping)).toBeNull();
    expect(Object.keys(prepared.classMapping)).toEqual(['constructor', '__proto__', 'toString']);
    expect(planned.classes.map((entry) => entry.displayName)).toEqual(['猫', '犬', 'bird']);
    expect(prepared.classMapping['constructor']).toBe(planned.classes[0].id);
    expect(prepared.classMapping['__proto__']).toBe(planned.classes[1].id);
    expect(Reflect.set(prepared, 'schemaId', randomUUID())).toBe(false);
    expect(Reflect.set(prepared.classMapping, '__proto__', randomUUID())).toBe(false);
    expect(Reflect.set(planned, 'instructions', 'forged')).toBe(false);
    expect(Reflect.set(planned.classes, '0', {})).toBe(false);
    expect(Reflect.set(planned.classes[0], 'displayName', 'forged')).toBe(false);
    expect(Reflect.set(planned.classes[0].examples, '0', 'forged')).toBe(false);
    db.exec('BEGIN'); expect(insertImportLabels(db, prepared)).toEqual(planned); db.exec('COMMIT');
  });
  it('rejects copied, forged and proxy capabilities without SQL or consuming the genuine plan', () => {
    const parent = project(), prepared = prepareImportLabels(db, parent, [scanClass()]);
    const planned = readPreparedImportLabels(prepared), invoke = vi.fn(() => { throw new Error('Not a capability.'); });
    const copies: unknown[] = [{ ...prepared }, { ...prepared, classMapping: { ...prepared.classMapping } },
      { ...prepared, snapshot: planned }, Object.create(prepared), new Proxy(prepared, { get: invoke }), {}, null];
    db.exec('BEGIN');
    const prepare = vi.spyOn(db, 'prepare'), exec = vi.spyOn(db, 'exec');
    for (const copy of copies) {
      expect(() => readPreparedImportLabels(copy as PreparedImportLabels)).toThrow(expect.objectContaining({ code: 'LABEL_INPUT' }));
      expect(() => insertImportLabels(db, copy as PreparedImportLabels)).toThrow(expect.objectContaining({ code: 'LABEL_INPUT' }));
    }
    expect(prepare).not.toHaveBeenCalled(); expect(exec).not.toHaveBeenCalled(); expect(invoke).not.toHaveBeenCalled();
    expect(insertImportLabels(db, prepared)).toEqual(planned);
    expect(() => insertImportLabels(db, prepared)).toThrow(expect.objectContaining({ code: 'LABEL_INPUT' }));
    expect(db.inTransaction).toBe(true); db.exec('COMMIT');
  });
  it('requires an existing Project both at preparation and at insertion', () => {
    expect(() => prepareImportLabels(db, randomUUID(), [])).toThrow(expect.objectContaining({ code: 'LABEL_PROJECT_NOT_FOUND' }));
    const parent = project(), prepared = prepareImportLabels(db, parent, [scanClass()]);
    db.prepare('DELETE FROM projects WHERE id=?').run(parent);
    const before = rows();
    db.exec('BEGIN');
    expect(() => insertImportLabels(db, prepared)).toThrow(expect.objectContaining({ code: 'LABEL_PROJECT_NOT_FOUND' }));
    expect(db.inTransaction).toBe(true); db.exec('COMMIT'); expect(rows()).toEqual(before);
  });
  it('rejects preparation in a caller TX and consumes a non-TX insertion attempt without writes', () => {
    const parent = project(), prepared = prepareImportLabels(db, parent, [scanClass()]);
    const before = rows(), prepare = vi.spyOn(db, 'prepare'), exec = vi.spyOn(db, 'exec');
    expect(() => insertImportLabels(db, prepared)).toThrow(expect.objectContaining({ code: 'LABEL_TRANSACTION' }));
    expect(prepare).not.toHaveBeenCalled(); expect(exec).not.toHaveBeenCalled();
    db.exec('BEGIN'); exec.mockClear();
    expect(() => prepareImportLabels(db, parent, [scanClass()])).toThrow(expect.objectContaining({ code: 'LABEL_TRANSACTION' }));
    expect(() => insertImportLabels(db, prepared)).toThrow(expect.objectContaining({ code: 'LABEL_INPUT' }));
    expect(prepare).not.toHaveBeenCalled(); expect(exec).not.toHaveBeenCalled(); expect(db.inTransaction).toBe(true);
    db.exec('ROLLBACK'); expect(rows()).toEqual(before);
  });
  it('binds even identical database contents to the originating connection and consumes a foreign-DB attempt', () => {
    const parent = project(), prepared = prepareImportLabels(db, parent, [scanClass()]);
    const other = openDatabase(join(directory, 'metadata.sqlite3'));
    try {
      other.exec('BEGIN');
      const prepare = vi.spyOn(other, 'prepare'), exec = vi.spyOn(other, 'exec');
      expect(() => insertImportLabels(other, prepared)).toThrow(expect.objectContaining({ code: 'LABEL_DATABASE' }));
      expect(prepare).not.toHaveBeenCalled(); expect(exec).not.toHaveBeenCalled(); expect(other.inTransaction).toBe(true);
      other.exec('ROLLBACK');
      db.exec('BEGIN'); expect(() => insertImportLabels(db, prepared)).toThrow(expect.objectContaining({ code: 'LABEL_INPUT' })); db.exec('ROLLBACK');
      expect(getLabelSchema(db, parent)).toBeUndefined();
    } finally { if (other.inTransaction) other.exec('ROLLBACK'); other.close(); }
  });
  it('rejects a closed originating database without retaining a reusable capability', () => {
    const prepared = prepareImportLabels(db, project(), [scanClass()]); db.close();
    expect(() => insertImportLabels(db, prepared)).toThrow(expect.objectContaining({ code: 'LABEL_DATABASE' }));
    expect(() => readPreparedImportLabels(prepared)).toThrow(expect.objectContaining({ code: 'LABEL_INPUT' }));
  });
  it.each([
    ['display_name', 'ＣＡＴ'], ['model_alias', 'new-alias'], ['color', '#112233'], ['description', 'changed'],
    ['examples_json', '["changed"]'], ['ordinal', 9], ['updated_at', '2000-01-01T00:00:00.000Z'],
  ] as const)('compares full snapshots, detecting class %s changes with unchanged parent editVersion', (column, value) => {
    const parent = project(); let schema = createLabelSchema(db, parent);
    schema = createLabelClass(db, parent, command(schema, 'cat'));
    const prepared = prepareImportLabels(db, parent, [scanClass()]);
    db.prepare(`UPDATE label_classes SET ${column}=? WHERE id=?`).run(value, schema.classes[0].id);
    expect(getLabelSchema(db, parent)?.editVersion).toBe(schema.editVersion);
    const before = rows(), bump = vi.spyOn(LabelSchemaRepository.prototype, 'bump');
    db.exec('BEGIN'); expect(() => insertImportLabels(db, prepared)).toThrow(expect.objectContaining({ code: 'LABEL_CONFLICT' }));
    expect(db.inTransaction).toBe(true); db.exec('COMMIT'); expect(rows()).toEqual(before); expect(bump).not.toHaveBeenCalled();
    expect(() => readPreparedImportLabels(prepared)).toThrow(expect.objectContaining({ code: 'LABEL_INPUT' }));
  });
  it.each(['appeared', 'removed', 'header', 'locked', 'class-added'] as const)('rejects schema changes before insertion: %s', (change) => {
    const parent = project(); const schema = change === 'appeared' ? undefined : createLabelSchema(db, parent);
    const prepared = prepareImportLabels(db, parent, [scanClass()]);
    if (change === 'appeared') createLabelSchema(db, parent);
    else if (change === 'removed') db.prepare('DELETE FROM label_schemas WHERE id=?').run(schema!.id);
    else if (change === 'header') updateLabelSchema(db, parent, { id: schema!.id, expectedEditVersion: 0, instructions: 'changed' });
    else if (change === 'class-added') createLabelClass(db, parent, command(schema!, 'dog'));
    else { db.exec('BEGIN'); lockLabelSchema(db, parent, schema!.id, 0); db.exec('COMMIT'); }
    const before = rows();
    db.exec('BEGIN'); expect(() => insertImportLabels(db, prepared)).toThrow(expect.objectContaining({ code: 'LABEL_CONFLICT' }));
    expect(db.inTransaction).toBe(true); db.exec('COMMIT'); expect(rows()).toEqual(before);
  });
  it('fails closed on malformed stored schema content instead of repairing it during preparation', () => {
    const parent = project(); let schema = createLabelSchema(db, parent);
    schema = createLabelClass(db, parent, command(schema));
    db.prepare('UPDATE label_classes SET examples_json=? WHERE id=?').run('[{}]', schema.classes[0].id);
    const before = rows();
    expect(() => prepareImportLabels(db, parent, [])).toThrow(expect.objectContaining({ code: 'LABEL_STORED_DATA' }));
    expect(rows()).toEqual(before); expect(db.inTransaction).toBe(false);
  });
  it('allows the last safe ordinal and read-only matches but rejects any overflowing addition', () => {
    const parent = project(); let schema = createLabelSchema(db, parent);
    schema = createLabelClass(db, parent, command(schema, 'cat', Number.MAX_SAFE_INTEGER - 1));
    const prepared = prepareImportLabels(db, parent, [scanClass('dog', 'dog')]);
    expect(readPreparedImportLabels(prepared).classes[1].ordinal).toBe(Number.MAX_SAFE_INTEGER);
    db.exec('BEGIN'); schema = insertImportLabels(db, prepared); db.exec('COMMIT');
    const before = rows();
    expect(() => prepareImportLabels(db, parent, [scanClass('new', 'new')])).toThrow(expect.objectContaining({ code: 'LABEL_ORDINAL_CONFLICT' }));
    const match = prepareImportLabels(db, parent, [scanClass('again', 'dog')]);
    db.exec('BEGIN'); expect(insertImportLabels(db, match)).toEqual(schema); db.exec('COMMIT'); expect(rows()).toEqual(before);
  });
  it('preflights the entire batch against editVersion exhaustion and still permits unchanged mappings at the limit', () => {
    const parent = project(), schemaId = randomUUID();
    db.prepare(`INSERT INTO label_schemas(id,project_id,edit_version,created_at,updated_at) VALUES (?,?,?,?,?)`)
      .run(schemaId, parent, Number.MAX_SAFE_INTEGER - 1, now, now);
    const before = rows();
    expect(() => prepareImportLabels(db, parent, [scanClass(), scanClass('dog', 'dog')]))
      .toThrow(expect.objectContaining({ code: 'LABEL_CONFLICT' }));
    expect(rows()).toEqual(before);
    const prepared = prepareImportLabels(db, parent, [scanClass()]);
    expect(readPreparedImportLabels(prepared).editVersion).toBe(Number.MAX_SAFE_INTEGER);
    db.exec('BEGIN'); const actual = insertImportLabels(db, prepared); db.exec('COMMIT');
    expect(() => prepareImportLabels(db, parent, [scanClass('dog', 'dog')])).toThrow(expect.objectContaining({ code: 'LABEL_CONFLICT' }));
    const match = prepareImportLabels(db, parent, [scanClass()]);
    db.exec('BEGIN'); expect(insertImportLabels(db, match)).toEqual(actual); db.exec('COMMIT');
  });
  it.each(['abort', 'drift'] as const)('rolls back its own batch on class %s, preserves the owner TX, and cannot be retried', (failure) => {
    const parent = project(), prepared = prepareImportLabels(db, parent, [scanClass(), scanClass('dog', 'dog')]);
    if (failure === 'abort') db.exec("CREATE TRIGGER import_label_abort BEFORE INSERT ON label_classes WHEN NEW.ordinal=1 BEGIN SELECT RAISE(ABORT,'injected'); END");
    else db.exec("CREATE TRIGGER import_label_drift AFTER INSERT ON label_classes BEGIN UPDATE label_classes SET description='injected' WHERE id=NEW.id; END");
    db.exec('BEGIN IMMEDIATE'); db.prepare('UPDATE projects SET name=? WHERE id=?').run('owner-write', parent);
    expect(() => insertImportLabels(db, prepared)).toThrow(expect.objectContaining({ code: failure === 'abort' ? 'LABEL_DATABASE' : 'LABEL_CONFLICT' }));
    expect(db.inTransaction).toBe(true); expect(db.prepare('SELECT name FROM projects WHERE id=?').get(parent)).toEqual({ name: 'owner-write' });
    expect(db.prepare('SELECT * FROM label_schemas').all()).toEqual([]); expect(db.prepare('SELECT * FROM label_classes').all()).toEqual([]);
    expect(() => insertImportLabels(db, prepared)).toThrow(expect.objectContaining({ code: 'LABEL_INPUT' }));
    db.exec('COMMIT');
  });
  it('leaves labels and DataImport provisional and rolls both back when the owner fails at a later workspace step', () => {
    const parent = project(), jobId = randomUUID(), importId = randomUUID();
    db.prepare(`INSERT INTO jobs(id,project_id,kind,status,created_at,updated_at) VALUES (?,?,'scan-dataset','Succeeded',?,?)`)
      .run(jobId, parent, now, now);
    const classes = [scanClass()];
    const image: ScanImage = { key: 'image', sourcePath: 'C:\\images\\one.png', byteSize: 100,
      mtimeNs: '123456789', sha256: hash('image'), format: 'png', width: 10, height: 10, orientation: 1,
      duplicateOf: null, annotation: { type: 'classification', classKey: classes[0].key, sourceRow: 1 } };
    const imported = prepareDataImport({ id: importId, createdAt: now, updatedAt: now,
      scanResult: { formatVersion: 1, projectId: parent, jobId, taskType: 'classification', mode: 'copy', classes, images: [image], issues: [] },
      sourceManifest: { formatVersion: 1, mode: 'copy', entries: [{ imageKey: image.key,
        relativePath: `datasets/${importId}/source/one.png`, byteSize: image.byteSize, sha256: image.sha256 }] } });
    const labels = prepareImportLabels(db, parent, classes), planned = readPreparedImportLabels(labels), before = rows();
    db.exec('BEGIN IMMEDIATE');
    expect(() => {
      expect(insertImportLabels(db, labels)).toEqual(planned);
      insertDataImport(db, imported);
      expect(db.prepare('SELECT id FROM label_schemas').all()).toEqual([{ id: planned.id }]);
      expect(db.prepare('SELECT id FROM data_imports').all()).toEqual([{ id: importId }]);
      throw new Error('Injected downstream workspace failure.');
    }).toThrow('Injected downstream workspace failure.');
    expect(db.inTransaction).toBe(true); db.exec('ROLLBACK');
    expect(rows()).toEqual(before);
    expect(() => readPreparedImportLabels(labels)).toThrow(expect.objectContaining({ code: 'LABEL_INPUT' }));
    const retry = prepareImportLabels(db, parent, classes);
    expect(retry.schemaId).not.toBe(planned.id);
    expect(retry.classMapping[classes[0].key]).not.toBe(labels.classMapping[classes[0].key]);
  });
});