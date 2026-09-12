// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Annotation, AnnotationItem } from '../../shared/contracts/annotation.js';
import type { ScanImage, ScanResult } from '../../shared/contracts/import.js';
import { insertDataImport, prepareDataImport } from '../data/import-repository.js';
import { openDatabase, type DatabaseConnection } from '../db/database.js';
import { migrateDatabase } from '../db/migrate.js';
import { saveAnnotationDraft } from './save-draft.js';
import { annotationDigest, canonicalAnnotationJson } from './workspace-repository.js';
import { createAnnotationWorkspace, getAnnotationItem, listAnnotationItems } from './workspace-service.js';
import { checkAnnotationContent, confirmAnnotationItem, validateAnnotationItem, type ConfirmAnnotationItemInput } from './validate-annotation.js';

const projectId = '01234567-89ab-4cde-8f01-23456789abcd';
const jobId = 'ae45cf74-c9f9-4c49-88b9-0523b1ac7383';
const importId = '9b2db431-04e9-488b-b4c2-3859fd26cb6e';
const schemaId = '22222222-2222-4222-8222-222222222222';
const cat = '33333333-3333-4333-8333-333333333333';
const foreignClass = '44444444-4444-4444-8444-444444444444';
const now = '2026-09-12T05:30:00.123Z';
const migrations = ['001_core', '002_jobs', '003_import', '004_import_generation', '005_import_rights', '006_annotations', '007_annotation_target_history']
  .map((name, index) => ({ version: index + 1, sql: readFileSync(new URL(`../db/migrations/${name}.sql`, import.meta.url), 'utf8') }));
const command = (item: AnnotationItem, negativeConfirmed = false): ConfirmAnnotationItemInput => ({
  expectedEditVersion: item.editVersion, expectedAnnotationSha256: item.annotationSha256,
  expectedState: item.state, expectedConfirmedAt: item.confirmedAt, negativeConfirmed,
});

describe('ANN-15 single-image content/explicit confirmation, real SQLite 001–007', () => {
  let directory: string, database: DatabaseConnection;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'autovision-ann15-'));
    database = openDatabase(join(directory, 'metadata.sqlite3'));
    migrateDatabase(database, migrations);
    // Scoped SQL test parents, as in ANN-08; no production repository mocks.
    database.prepare('INSERT INTO projects(id,name,task_type,workspace_path,created_at,updated_at) VALUES (?,?,?,?,?,?)')
      .run(projectId, 'ANN15 fixture', 'classification', 'C:\\Projects\\fixture', now, now);
    database.prepare('INSERT INTO jobs(id,project_id,kind,status,created_at,updated_at) VALUES (?,?,?,?,?,?)')
      .run(jobId, projectId, 'scan-dataset', 'Succeeded', now, now);
    database.prepare('INSERT INTO label_schemas(id,project_id,created_at,updated_at) VALUES (?,?,?,?)').run(schemaId, projectId, now, now);
    database.prepare(`INSERT INTO label_classes(id,schema_id,display_name,normalized_name,color,ordinal,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?)`).run(cat, schemaId, 'cat', 'cat', '#123456', 0, now, now);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    if (database.open) database.close();
    rmSync(directory, { recursive: true, force: true });
  });
  function fixture(taskType: ScanResult['taskType'] = 'classification', imported = true): AnnotationItem {
    database.prepare('UPDATE projects SET task_type=? WHERE id=?').run(taskType, projectId);
    const annotation: ScanImage['annotation'] = !imported ? null : taskType === 'classification'
      ? { type: 'classification', classKey: 'scan:cat', sourceRow: 2 }
      : { type: 'detection', sourceImageId: '9007199254740993123', boxes: [
        { classKey: 'scan:cat', sourceAnnotationId: '9007199254740993124', bbox: [1, 2, 20, 30] },
      ] };
    const images: ScanImage[] = [0, 1].map((index) => ({ key: `image:${index}`, sourcePath: `C:\\images\\${index}.png`,
      byteSize: 100, mtimeNs: '1234567890123456789', sha256: String(index).repeat(64), format: 'png',
      width: 640, height: 480, orientation: 6, duplicateOf: null, annotation: index === 0 ? annotation : null }));
    const scanResult: ScanResult = { formatVersion: 1, projectId, jobId, taskType, mode: 'copy',
      classes: imported ? [{ key: 'scan:cat', name: 'cat', sourceCategoryId: taskType === 'detection' ? '12' : null }] : [], images, issues: [] };
    const source = prepareDataImport({ id: importId, createdAt: now, updatedAt: now, scanResult,
      sourceManifest: { formatVersion: 1, mode: 'copy', entries: images.map((image, index) => ({ imageKey: image.key,
        relativePath: `datasets/${importId}/source/${index}.png`, byteSize: image.byteSize, sha256: image.sha256 })) } });
    database.exec('BEGIN IMMEDIATE');
    try { insertDataImport(database, source); database.exec('COMMIT'); }
    finally { if (database.inTransaction) database.exec('ROLLBACK'); }
    const { workspace } = createAnnotationWorkspace(database, projectId, importId, schemaId, imported ? { 'scan:cat': cat } : {});
    return listAnnotationItems(database, projectId, workspace.id, { offset: 0, limit: 200 }).items.find((item) => item.imageKey === 'image:0')!;
  }
  const get = (item: AnnotationItem) => getAnnotationItem(database, projectId, item.workspaceId, item.id);
  const validate = (item: AnnotationItem) => validateAnnotationItem(database, projectId, item.workspaceId, item.id);
  const confirm = (item: AnnotationItem, negative = false) => confirmAnnotationItem(database, projectId, item.workspaceId, item.id, command(item, negative));
  function snapshot() {
    return ['projects', 'label_schemas', 'label_classes', 'data_imports', 'import_sources', 'import_generations',
      'annotation_workspaces', 'annotation_items', 'annotation_provenance', 'annotation_target_history',
      'dataset_revisions', 'dataset_items', 'workspace_revision_sources', 'project_import_rights', 'jobs']
      .map((table) => database.prepare(`SELECT * FROM ${table}`).all());
  }

  it.each(['classification', 'detection'] as const)('confirms imported %s only on request, preserves content/originals, clears proof on actual draft save', (task) => {
    const item = fixture(task), before = snapshot(), original = get(item);
    expect(item.state).toBe('unstarted');
    expect(validate(item)).toEqual({ valid: false, issues: [{ itemId: item.id, code: 'unconfirmed' }] });
    expect(snapshot()).toEqual(before);
    const result = confirm(item);
    expect(result.provenance).toEqual(original.provenance);
    expect(result.item).toMatchObject({ annotation: item.annotation, annotationSha256: item.annotationSha256,
      state: 'confirmed', negativeConfirmed: false, editVersion: item.editVersion + 1, confirmedAt: result.item.updatedAt });
    expect(Date.parse(result.item.updatedAt)).toBeGreaterThan(Date.parse(item.updatedAt));
    expect(validate(result.item)).toEqual({ valid: true, issues: [] });
    const after = snapshot();
    for (const index of [0, 1, 2, 3, 4, 5, 8, 9, 10, 11, 12, 13, 14]) expect(after[index]).toEqual(before[index]);
    expect(database.prepare('SELECT edit_version FROM annotation_workspaces WHERE id=?').get(item.workspaceId)).toEqual({ edit_version: 1 });
    const siblings = listAnnotationItems(database, projectId, item.workspaceId, { offset: 0, limit: 200 }).items.filter((entry) => entry.id !== item.id);
    expect(siblings).toHaveLength(1); expect(siblings[0].state).toBe('unstarted');
    expect(() => confirm(item)).toThrow(/conflict/);
    expect(() => confirm(result.item)).toThrow(/unconfirmed draft/);
    const draft = saveAnnotationDraft(database, projectId, item.workspaceId, item.id, {
      expectedEditVersion: result.item.editVersion, expectedAnnotationSha256: result.item.annotationSha256,
      expectedState: result.item.state, expectedConfirmedAt: result.item.confirmedAt,
      annotation: result.item.annotation, state: 'editing', exclusionReason: null,
    });
    expect(draft.item).toMatchObject({ state: 'editing', confirmedAt: null, negativeConfirmed: false });
    expect(database.pragma('foreign_key_check')).toEqual([]);
  });
  it.each(['suggested', 'excluded', 'confirmed'] as const)('rejects valid imported %s with matching CAS before any SQL changes, directly in Main', (state) => {
    const original = fixture(), originalValue = get(original);
    const updatedAt = new Date(Date.parse(original.updatedAt) + 1000).toISOString();
    database.prepare(`UPDATE annotation_items SET state=?, exclusion_reason=?, confirmed_at=?,
      negative_confirmed=0, edit_version = edit_version + 1, updated_at=? WHERE id=? AND edit_version=?`)
      .run(state, state === 'excluded' ? 'legacy import exclusion' : null,
        state === 'confirmed' ? updatedAt : null, updatedAt, original.id, original.editVersion);
    const stored = get(original), item = stored.item;
    expect(item.state).toBe(state);
    expect(item.annotation).toEqual(original.annotation);
    expect(item.annotationSha256).toBe(original.annotationSha256);
    expect(stored.provenance).toEqual(originalValue.provenance);
    expect(stored.provenance).toHaveLength(1);
    expect(stored.provenance[0]!.kind).toBe('import-unmodified');
    expect(checkAnnotationContent(item.annotation, item.width, item.height, new Set([cat]), false)).toEqual([]);
    expect(database.pragma('foreign_key_check')).toEqual([]);
    const before = snapshot(), changes = database.prepare('SELECT total_changes() AS count').get();
    // SQLite counts even rolled-back writes: snapshot equality alone is insufficient.
    expect(() => confirmAnnotationItem(database, projectId, item.workspaceId, item.id, command(item)))
      .toThrow(/unconfirmed draft/);
    expect(database.prepare('SELECT total_changes() AS count').get()).toEqual(changes);
    expect(snapshot()).toEqual(before);
    expect(get(item)).toEqual(stored);
    expect(database.inTransaction).toBe(false);
  });
  it('requires explicit negative only for empty detection and clears it on save', () => {
    const item = fixture('detection', false), before = snapshot();
    expect(() => confirm(item)).toThrow(/invalid-negative-confirmation/);
    expect(snapshot()).toEqual(before);
    const result = confirm(item, true);
    expect(result.item.negativeConfirmed).toBe(true); expect(result.provenance).toEqual([]);
    const draft = saveAnnotationDraft(database, projectId, item.workspaceId, item.id, {
      expectedEditVersion: result.item.editVersion, expectedAnnotationSha256: result.item.annotationSha256,
      annotation: result.item.annotation, state: 'editing', exclusionReason: null,
    });
    expect(draft.item).toMatchObject({ negativeConfirmed: false, confirmedAt: null });
  });
  it.each(['classification', 'detection'] as const)('rejects negative=true for nonempty %s', (task) => {
    const item = fixture(task), before = snapshot(); expect(() => confirm(item, true)).toThrow(/invalid-negative/); expect(snapshot()).toEqual(before);
  });
  it('allows null classification as a stored draft but never as confirmed', () => {
    const item = fixture('classification', false), before = snapshot();
    expect(validate(item).issues.map((issue) => issue.code)).toEqual(['missing-class', 'unconfirmed']);
    expect(() => confirm(item)).toThrow(/missing-class/); expect(snapshot()).toEqual(before);
  });
  it.each(['version', 'hash', 'state', 'timestamp'] as const)('rejects altered %s token', (kind) => {
    const item = fixture(), before = snapshot();
    const input = { ...command(item), ...(kind === 'version' ? { expectedEditVersion: 1 }
      : kind === 'hash' ? { expectedAnnotationSha256: 'f'.repeat(64) }
        : kind === 'state' ? { expectedState: 'editing' as const }
          : { expectedState: 'confirmed' as const, expectedConfirmedAt: now }) };
    expect(() => confirmAnnotationItem(database, projectId, item.workspaceId, item.id, input)).toThrow(/conflict/);
    expect(snapshot()).toEqual(before);
  });
  it.each(['original', 'missing-provenance', 'foreign-class', 'out-of-bounds', 'hash'] as const)('fails closed on stored %s without leaking paths', (kind) => {
    const item = fixture(kind === 'out-of-bounds' ? 'detection' : 'classification');
    if (kind === 'original') database.prepare("UPDATE annotation_provenance SET original_json='{}' WHERE item_id=?").run(item.id);
    else if (kind === 'missing-provenance') database.prepare('DELETE FROM annotation_provenance WHERE item_id=?').run(item.id);
    else {
      const annotation: Annotation = kind === 'foreign-class' ? { kind: 'classification', classId: foreignClass }
        : kind === 'out-of-bounds' && item.annotation.kind === 'detection'
          ? { kind: 'detection', rectangles: item.annotation.rectangles.map((box) => ({ ...box, x: 640 })) } : item.annotation;
      const json = canonicalAnnotationJson(annotation);
      database.prepare('UPDATE annotation_items SET annotation_json=?,annotation_sha256=?,edit_version=edit_version+1 WHERE id=?')
        .run(json, kind === 'hash' ? 'f'.repeat(64) : annotationDigest(json), item.id);
    }
    const before = snapshot();
    expect(validate(item)).toEqual({ valid: false, issues: [{ itemId: item.id, code: 'invalid-stored' }] });
    expect(() => confirm(item)).toThrow(); expect(snapshot()).toEqual(before);
  });
  it('rolls back item confirmation when workspace update aborts', () => {
    const item = fixture(), before = snapshot();
    database.exec("CREATE TRIGGER fail_confirm BEFORE UPDATE ON annotation_workspaces BEGIN SELECT RAISE(ABORT,'confirm abort'); END");
    expect(() => confirm(item)).toThrow(/confirm abort/); expect(snapshot()).toEqual(before); expect(database.inTransaction).toBe(false);
  });
  it.each(['project', 'schema', 'source'] as const)('rolls back trigger changes to full %s metadata', (kind) => {
    const item = fixture(), before = snapshot();
    const sql = kind === 'project' ? "UPDATE projects SET description='changed';"
      : kind === 'schema' ? "UPDATE label_classes SET description='changed';" : "UPDATE data_imports SET updated_at='2026-09-13T00:00:00.000Z';";
    database.exec(`CREATE TRIGGER mutate_confirm AFTER UPDATE ON annotation_workspaces BEGIN ${sql} END`);
    expect(() => confirm(item)).toThrow(); expect(snapshot()).toEqual(before);
  });
  it('never joins, commits or rolls back foreign transactions, including validation', () => {
    const item = fixture(); database.exec('BEGIN'); database.prepare('INSERT INTO settings VALUES (?,?)').run('foreign', 'retained');
    expect(() => confirm(item)).toThrow(/caller transaction/); expect(() => validate(item)).toThrow(/caller transaction/);
    expect(database.inTransaction).toBe(true);
    expect(database.prepare('SELECT value FROM settings WHERE key=?').get('foreign')).toEqual({ value: 'retained' }); database.exec('ROLLBACK');
  });
  it('rejects excluded items until an actual draft save restores editing', () => {
    const item = fixture();
    const excluded = saveAnnotationDraft(database, projectId, item.workspaceId, item.id, {
      expectedEditVersion: item.editVersion, expectedAnnotationSha256: item.annotationSha256,
      annotation: item.annotation, state: 'excluded', exclusionReason: null,
    }).item;
    expect(() => confirm(excluded)).toThrow(/unconfirmed draft/);
    const editing = saveAnnotationDraft(database, projectId, item.workspaceId, item.id, {
      expectedEditVersion: excluded.editVersion, expectedAnnotationSha256: excluded.annotationSha256,
      annotation: excluded.annotation, state: 'editing', exclusionReason: null,
    }).item;
    expect(confirm(editing).item.state).toBe('confirmed');
  });
});

describe('ANN-15 content helper and explicit input boundary', () => {
  it('delegates class cardinality, duplicate region and bounds checks to the shared validator', () => {
    const box = { id: schemaId, classId: cat, x: 0, y: 0, width: 1, height: 1 }, classes = new Set([cat]);
    expect(checkAnnotationContent({ kind: 'classification', classId: [cat, cat] }, 640, 480, classes, false)).toEqual(['invalid-annotation']);
    expect(checkAnnotationContent({ kind: 'classification', classId: foreignClass }, 640, 480, classes, false)).toEqual(['unknown-class']);
    expect(checkAnnotationContent({ kind: 'detection', rectangles: [{ ...box }, { ...box }] }, 640, 480, classes, false)).toEqual(['invalid-annotation']);
    expect(checkAnnotationContent({ kind: 'detection', rectangles: [{ ...box, x: 640 }] }, 640, 480, classes, false)).toEqual(['out-of-bounds']);
  });
  it('rejects missing boolean/state proof, getters and proxies before database access', () => {
    const touched = vi.fn((): never => { throw new Error('DB touched'); });
    const database = new Proxy({} as DatabaseConnection, { get: touched });
    const valid = { expectedEditVersion: 0, expectedAnnotationSha256: 'a'.repeat(64), expectedState: 'unstarted', expectedConfirmedAt: null, negativeConfirmed: false };
    const getter = vi.fn(() => false);
    const values: unknown[] = [new Proxy(valid, { get: getter }), Object.defineProperty({ ...valid }, 'negativeConfirmed', { get: getter }),
      { ...valid, negativeConfirmed: undefined }, { ...valid, expectedState: undefined }, { ...valid, expectedConfirmedAt: undefined }, { ...valid, negativeConfirmed: 'true' }];
    for (const input of values) expect(() => confirmAnnotationItem(database, projectId, schemaId, importId, input as ConfirmAnnotationItemInput)).toThrow();
    expect(touched).not.toHaveBeenCalled(); expect(getter).not.toHaveBeenCalled();
  });
});