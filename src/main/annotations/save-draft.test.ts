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
import { mergeLabelClasses } from './label-schema-service.js';
import { annotationDigest, canonicalAnnotationJson } from './workspace-repository.js';
import { createAnnotationWorkspace, getAnnotationItem, getAnnotationWorkspace, listAnnotationItems } from './workspace-service.js';
import { saveAnnotationDraft, type SaveAnnotationDraftInput } from './save-draft.js';

const projectId = '01234567-89ab-4cde-8f01-23456789abcd';
const foreignId = '11234567-89ab-4cde-8f01-23456789abcd';
const jobId = 'ae45cf74-c9f9-4c49-88b9-0523b1ac7383';
const importId = '9b2db431-04e9-488b-b4c2-3859fd26cb6e';
const schemaId = '22222222-2222-4222-8222-222222222222';
const cat = '33333333-3333-4333-8333-333333333333';
const dog = '44444444-4444-4444-8444-444444444444';
const bird = '55555555-5555-4555-8555-555555555555';
const newRectangle = '66666666-6666-4666-8666-666666666666';
const now = '2026-09-12T05:30:00.123Z';
const migrations = ['001_core', '002_jobs', '003_import', '004_import_generation', '005_import_rights', '006_annotations', '007_annotation_target_history']
  .map((name, index) => ({ version: index + 1, sql: readFileSync(new URL(`../db/migrations/${name}.sql`, import.meta.url), 'utf8') }));
const classification = (classId: string | null): Annotation => ({ kind: 'classification', classId });
const detection = (): Annotation => ({ kind: 'detection', rectangles: [
  { id: newRectangle, classId: cat, x: 1.25, y: 2.5, width: 3.75, height: 4.125 },
] });
function command(item: AnnotationItem, annotation: Annotation = item.annotation): SaveAnnotationDraftInput {
  return { expectedEditVersion: item.editVersion, expectedAnnotationSha256: item.annotationSha256,
    expectedState: item.state, expectedConfirmedAt: item.confirmedAt,
    annotation, state: 'editing', exclusionReason: null };
}

describe('ANN-08 synchronous single-image autosave / real SQLite 001–007', () => {
  let directory: string, path: string, database: DatabaseConnection;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'autovision-ann08-'));
    path = join(directory, 'metadata.sqlite3');
    database = openDatabase(path);
    migrateDatabase(database, migrations);
    // Raw TEST parents only: no rights approval, filesystem publication, real
    // model suggestions, human confirmation service, Revision or Queue claim.
    for (const id of [projectId, foreignId]) database.prepare(`INSERT INTO projects
      (id,name,task_type,workspace_path,created_at,updated_at) VALUES (?,?,?,?,?,?)`)
      .run(id, 'ANN08 fixture', 'classification', `C:\\Projects\\${id}`, now, now);
    database.prepare('INSERT INTO jobs(id,project_id,kind,status,created_at,updated_at) VALUES (?,?,?,?,?,?)')
      .run(jobId, projectId, 'scan-dataset', 'Succeeded', now, now);
    database.prepare('INSERT INTO label_schemas(id,project_id,created_at,updated_at) VALUES (?,?,?,?)')
      .run(schemaId, projectId, now, now);
    for (const [index, id] of [cat, dog, bird].entries()) database.prepare(`INSERT INTO label_classes
      (id,schema_id,display_name,normalized_name,color,ordinal,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run(id, schemaId, `class${index}`, `class${index}`, '#123456', index, now, now);
    database.prepare('INSERT INTO label_schemas(id,project_id,created_at,updated_at) VALUES (?,?,?,?)')
      .run(foreignId, foreignId, now, now);
    database.prepare(`INSERT INTO label_classes
      (id,schema_id,display_name,normalized_name,color,ordinal,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run(foreignId, foreignId, 'foreign', 'foreign', '#123456', 0, now, now);
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
        { classKey: 'scan:cat', sourceAnnotationId: '9007199254740993124', bbox: [0.5, 1.25, 20.75, 30.125] },
        { classKey: 'scan:cat', sourceAnnotationId: '9007199254740993125', bbox: [40.5, 41.25, 20.75, 30.125] },
      ] };
    const images: ScanImage[] = [0, 1].map((index) => ({ key: `image:${index}`, sourcePath: `C:\\images\\${index}.png`,
      byteSize: 100, mtimeNs: '1234567890123456789', sha256: String(index).repeat(64), format: 'png',
      width: 640, height: 480, orientation: 6, duplicateOf: null, annotation: index === 0 ? annotation : null }));
    const scanResult: ScanResult = { formatVersion: 1, projectId, jobId, taskType, mode: 'copy',
      classes: imported ? [{ key: 'scan:cat', name: 'Raw Cat', sourceCategoryId: taskType === 'detection' ? '12' : null }] : [],
      images, issues: [] };
    const prepared = prepareDataImport({ id: importId, createdAt: now, updatedAt: now, scanResult,
      sourceManifest: { formatVersion: 1, mode: 'copy', entries: images.map((image, index) => ({ imageKey: image.key,
        relativePath: `datasets/${importId}/source/${index}.png`, byteSize: image.byteSize, sha256: image.sha256 })) } });
    database.exec('BEGIN IMMEDIATE');
    try { insertDataImport(database, prepared); database.exec('COMMIT'); }
    finally { if (database.inTransaction) database.exec('ROLLBACK'); }
    const { workspace } = createAnnotationWorkspace(database, projectId, importId, schemaId, imported ? { 'scan:cat': cat } : {});
    return listAnnotationItems(database, projectId, workspace.id, { offset: 0, limit: 200 }).items.find((item) => item.imageKey === 'image:0')!;
  }
  const get = (item: AnnotationItem) => getAnnotationItem(database, projectId, item.workspaceId, item.id);
  const save = (item: AnnotationItem, annotation: Annotation = item.annotation, patch: Partial<SaveAnnotationDraftInput> = {}) =>
    saveAnnotationDraft(database, projectId, item.workspaceId, item.id, { ...command(item, annotation), ...patch });
  function snapshot() {
    return ['projects', 'label_schemas', 'label_classes', 'data_imports', 'import_sources', 'import_generations',
      'annotation_workspaces', 'annotation_items', 'annotation_provenance', 'dataset_revisions', 'dataset_items',
      'workspace_revision_sources', 'project_import_rights', 'jobs', 'annotation_target_history']
      .map((table) => database.prepare(`SELECT * FROM ${table}`).all());
  }
  function confirmFixture(item: AnnotationItem): AnnotationItem {
    database.prepare(`UPDATE annotation_items SET state='confirmed',confirmed_at=?,negative_confirmed=?,
      edit_version=edit_version+1,updated_at=? WHERE id=?`)
      .run(now, Number(item.annotation.kind === 'detection' && item.annotation.rectangles.length === 0), now, item.id);
    return get(item).item;
  }

  it('persists immediately, owns hash/time/version, and changes only one image and its workspace', () => {
    const item = fixture(), before = snapshot();
    const siblings = database.prepare('SELECT * FROM annotation_items WHERE id<>?').all(item.id);
    const request = command(item, classification(dog));
    const result = saveAnnotationDraft(database, projectId, item.workspaceId, item.id, request);
    expect(result).not.toBeInstanceOf(Promise);
    expect(database.inTransaction).toBe(false);
    expect(result.item).toMatchObject({ id: item.id, annotation: classification(dog), state: 'editing',
      editVersion: 1, negativeConfirmed: false, confirmedAt: null });
    expect(result.item.annotationSha256).toBe(annotationDigest(canonicalAnnotationJson(classification(dog))));
    expect(Date.parse(result.item.updatedAt)).toBeGreaterThan(Date.parse(item.updatedAt));
    expect(getAnnotationWorkspace(database, projectId, item.workspaceId)).toMatchObject({ editVersion: 1, updatedAt: result.item.updatedAt });
    expect(database.prepare('SELECT * FROM annotation_items WHERE id<>?').all(item.id)).toEqual(siblings);
    const after = snapshot();
    for (const index of [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14]) expect(after[index]).toEqual(before[index]);
    const other = openDatabase(path);
    try { expect(getAnnotationItem(other, projectId, item.workspaceId, item.id)).toEqual(result); }
    finally { other.close(); }
    database.close(); database = openDatabase(path);
    expect(get(item)).toEqual(result);
    expect(Object.isFrozen(result.item.annotation)).toBe(true);
    expect(Object.isFrozen(result.provenance[0].original)).toBe(true);
    expect(request).toEqual(command(item, classification(dog)));
    expect(database.pragma('foreign_key_check')).toEqual([]);
  });

  it('accepts the required API without optional assertions and rejects a duplicate even with unchanged hash', () => {
    const item = fixture();
    const request = { expectedEditVersion: item.editVersion, expectedAnnotationSha256: item.annotationSha256,
      annotation: item.annotation, state: 'editing' as const, exclusionReason: null };
    const result = saveAnnotationDraft(database, projectId, item.workspaceId, item.id, request);
    expect(result.item.annotationSha256).toBe(item.annotationSha256);
    expect(result.item.editVersion).toBe(1);
    expect(result.provenance[0].kind).toBe('import-unmodified');
    expect(() => saveAnnotationDraft(database, projectId, item.workspaceId, item.id, request)).toThrow(/conflict/);
    expect(get(item)).toEqual(result);
  });

  it('unconfirms content edits and never restores confirmation after Undo, Redo or a same-hash save', () => {
    const original = confirmFixture(fixture());
    const originalProvenance = get(original).provenance[0];
    const edited = save(original, classification(dog));
    const undo = save(edited.item, original.annotation);
    const redo = save(undo.item, edited.item.annotation);
    for (const result of [edited, undo, redo]) {
      expect(result.item).toMatchObject({ state: 'editing', confirmedAt: null, negativeConfirmed: false });
      expect(result.provenance[0]).toMatchObject({ kind: 'import-edited', original: originalProvenance.original,
        sourceImportId: importId, sourceImageKey: 'image:0', sourceAnnotationKey: 'row:2', sourceSuggestionId: null });
    }
    expect(undo.item.annotationSha256).toBe(original.annotationSha256);
    expect(undo.provenance[0].changes).toEqual({ classId: { from: cat, to: cat } });
    expect(redo.provenance[0].changes).toEqual({ classId: { from: cat, to: dog } });
    expect(redo.item.editVersion).toBe(original.editVersion + 3);
    const confirmedAgain = confirmFixture(redo.item);
    expect(save(confirmedAgain).item).toMatchObject({ state: 'editing', confirmedAt: null, negativeConfirmed: false });
  });

  it.each(['classification', 'detection'] as const)('allows empty %s drafts and never implicitly confirms a negative', (task) => {
    const item = fixture(task, false);
    const result = save(item);
    expect(result.item).toMatchObject({ annotation: task === 'classification' ? classification(null) : { kind: 'detection', rectangles: [] },
      state: 'editing', negativeConfirmed: false, confirmedAt: null });
    expect(result.provenance).toEqual([]);
    if (task === 'detection') {
      const confirmed = confirmFixture(result.item);
      expect(confirmed.negativeConfirmed).toBe(true);
      expect(save(confirmed).item).toMatchObject({ negativeConfirmed: false, confirmedAt: null, state: 'editing' });
    }
  });

  it.each([null, '', '明示的に除外 🐈'] as const)('persists optional exclusion reason %s, then explicitly returns to editing', (reason) => {
    const item = confirmFixture(fixture());
    const excluded = save(item, item.annotation, { state: 'excluded', exclusionReason: reason });
    expect(excluded.item).toMatchObject({ state: 'excluded', exclusionReason: reason, negativeConfirmed: false, confirmedAt: null });
    expect(excluded.provenance).toEqual(get(item).provenance);
    expect(save(excluded.item).item).toMatchObject({ state: 'editing', exclusionReason: null, confirmedAt: null });
  });

  it('restores classification import identity after clear and reopen without restoring confirmation', () => {
    const item = fixture();
    const original = get(item).provenance;
    const cleared = save(item, classification(null));
    expect(cleared.provenance).toEqual([]);
    const history = database.prepare('SELECT * FROM annotation_target_history').all();
    expect(history).toHaveLength(1);
    database.close(); database = openDatabase(path);
    const restored = save(cleared.item, item.annotation);
    expect(restored.provenance).toEqual(original);
    expect(database.prepare('SELECT * FROM annotation_target_history').all()).toEqual(history);
    expect(restored.item).toMatchObject({ confirmedAt: null, negativeConfirmed: false });
    const replaced = save(restored.item, classification(dog));
    expect(replaced.provenance[0].changes).toEqual({ classId: { from: cat, to: dog } });
    database.close(); database = openDatabase(path);
    expect(get(item)).toEqual(replaced);
  });

  it('tracks exact imported box originals, independent target deltas, removal and manual additions', () => {
    const item = fixture('detection');
    if (item.annotation.kind !== 'detection') throw new Error('fixture');
    const [first, second] = item.annotation.rectangles;
    const original = get(item).provenance;
    const annotation: Annotation = { kind: 'detection', rectangles: [
      { ...first, x: 2.75, width: 22.5, classId: dog }, second,
      { id: newRectangle, classId: bird, x: 0.25, y: 0.5, width: 1.75, height: 2.125 },
    ] };
    const result = save(item, annotation);
    const changed = result.provenance.find((p) => p.targetKey === first.id)!;
    expect(changed).toMatchObject({ kind: 'import-edited', original: original.find((p) => p.targetKey === first.id)!.original,
      sourceAnnotationKey: '9007199254740993124', changes: { classId: { from: cat, to: dog },
        x: { from: 0.5, to: 2.75 }, width: { from: 20.75, to: 22.5 } } });
    expect(result.provenance.find((p) => p.targetKey === second.id)).toEqual(original.find((p) => p.targetKey === second.id));
    expect(result.provenance.find((p) => p.targetKey === newRectangle)).toMatchObject({ kind: 'manual', original: {}, sourceSuggestionId: null });
    const movedAgain = save(result.item, { kind: 'detection', rectangles: [{ ...first, x: 3.25, width: 25, classId: dog }, second] });
    expect(movedAgain.provenance.find((p) => p.targetKey === first.id)?.changes).toEqual({
      classId: { from: cat, to: dog }, x: { from: 0.5, to: 3.25 }, width: { from: 20.75, to: 25 },
    });
    const cleared = save(movedAgain.item, { kind: 'detection', rectangles: [] });
    expect(cleared.provenance).toEqual([]);
    database.close(); database = openDatabase(path);
    const undo = save(cleared.item, item.annotation);
    expect(undo.provenance.find((p) => p.targetKey === first.id)).toMatchObject({ kind: 'import-edited',
      original: original.find((p) => p.targetKey === first.id)!.original, sourceImportId: importId,
      changes: { classId: { from: cat, to: cat }, x: { from: 0.5, to: 0.5 }, width: { from: 20.75, to: 20.75 } } });
    expect(undo.provenance.find((p) => p.targetKey === second.id)).toEqual(original.find((p) => p.targetKey === second.id));
    expect(undo.item.confirmedAt).toBeNull();
  });

  it('treats a NEW UUID with identical geometry as manual, never as an import restore', () => {
    const item = fixture('detection');
    if (item.annotation.kind !== 'detection') throw new Error('fixture');
    const cleared = save(item, { kind: 'detection', rectangles: [] });
    const restored = save(cleared.item, { kind: 'detection', rectangles: [{ ...item.annotation.rectangles[0], id: newRectangle }] });
    expect(restored.provenance[0]).toMatchObject({ kind: 'manual', original: {}, sourceImportId: null });
  });

  it('keeps edited import original coordinates and first-from through restore edits and a second deletion', () => {
    const item = fixture('detection');
    if (item.annotation.kind !== 'detection') throw new Error('fixture');
    const first = item.annotation.rectangles[0], original = get(item).provenance.find((p) => p.targetKey === first.id)!.original;
    const edited = save(item, { kind: 'detection', rectangles: [{ ...first, x: 5, classId: dog }] });
    const cleared = save(edited.item, { kind: 'detection', rectangles: [] });
    const restored = save(cleared.item, { kind: 'detection', rectangles: [{ ...first, x: 7, classId: bird }] });
    expect(restored.provenance[0]).toMatchObject({ kind: 'import-edited', original,
      changes: { x: { from: 0.5, to: 7 }, classId: { from: cat, to: bird } } });
    const deletedAgain = save(restored.item, { kind: 'detection', rectangles: [] });
    expect(save(deletedAgain.item, restored.item.annotation).provenance).toEqual(restored.provenance);
  });

  it('preserves manual metadata and first-from through deletion and restoration', () => {
    const item = fixture('classification', false), assigned = save(item, classification(cat));
    database.prepare('UPDATE annotation_provenance SET changes_json=? WHERE item_id=?')
      .run(`{"10":{"note":"ten"},"2":{"note":"two"},"classId":{"from":null,"to":"${cat}"}}`, item.id);
    const cleared = save(assigned.item, classification(null));
    const restored = save(cleared.item, classification(dog));
    expect(restored.provenance[0]).toMatchObject({ kind: 'manual', changes: {
      '10': { note: 'ten' }, '2': { note: 'two' }, classId: { from: null, to: dog },
    } });
  });

  it('rejects a merged-away historical class until an existing class is selected, preserving the original', () => {
    const item = fixture(), original = get(item).provenance[0].original;
    const cleared = save(item, classification(null));
    mergeLabelClasses(database, projectId, schemaId, cat, dog, 0);
    const before = snapshot();
    expect(() => save(cleared.item, item.annotation)).toThrow(/class/);
    expect(snapshot()).toEqual(before);
    expect(save(cleared.item, classification(dog)).provenance[0]).toMatchObject({ original, kind: 'import-edited',
      changes: { classId: { from: cat, to: dog } } });
  });

  it.each(['json', 'duplicate', 'hash', 'source', 'original', 'key'] as const)('fails closed on corrupt history %s without a manual fallback', (kind) => {
    const item = fixture(), cleared = save(item, classification(null));
    const guards = database.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND tbl_name='annotation_target_history'").all() as { name: string; sql: string }[];
    try {
      for (const guard of guards) database.exec(`DROP TRIGGER ${guard.name}`);
      if (kind === 'json') database.prepare("UPDATE annotation_target_history SET changes_json=' { }'").run();
      else if (kind === 'duplicate') database.prepare(`UPDATE annotation_target_history SET changes_json='{"a":1,"a":2}'`).run();
      else if (kind === 'hash') database.prepare('UPDATE annotation_target_history SET record_sha256=?').run('f'.repeat(64));
      else {
        const value = database.prepare(`SELECT item_id AS itemId,target_key AS targetKey,kind,source_import_id AS sourceImportId,
          source_image_key AS sourceImageKey,source_annotation_key AS sourceAnnotationKey,source_suggestion_id AS sourceSuggestionId,
          original_json AS originalJson,changes_json AS changesJson,target_fields_json AS targetFieldsJson FROM annotation_target_history`).get() as Record<string, string | null>;
        const { originalJson, changesJson, targetFieldsJson, ...fields } = value;
        const original: unknown = kind === 'original' ? {} : JSON.parse(originalJson!);
        if (kind === 'source') fields['sourceAnnotationKey'] = 'row:999';
        if (kind === 'key') fields['targetKey'] = newRectangle;
        const stable = (v: unknown): string => v !== null && typeof v === 'object'
          ? Array.isArray(v) ? `[${v.map(stable).join(',')}]`
            : `{${Object.keys(v).sort().map((key) => `${JSON.stringify(key)}:${stable((v as Record<string, unknown>)[key])}`).join(',')}}`
          : JSON.stringify(v);
        const hash = annotationDigest(stable({ ...fields, original, changes: JSON.parse(changesJson!), targetFields: JSON.parse(targetFieldsJson!) }));
        database.prepare('UPDATE annotation_target_history SET target_key=?,source_annotation_key=?,original_json=?,record_sha256=?')
          .run(fields['targetKey'], fields['sourceAnnotationKey'], stable(original), hash);
      }
    } finally { for (const guard of guards) database.exec(guard.sql); }
    const before = snapshot();
    expect(() => save(cleared.item, item.annotation)).toThrow();
    expect(snapshot()).toEqual(before);
  });

  it.each(['annotation_items', 'annotation_workspaces'] as const)('rolls back newly archived history when %s aborts', (table) => {
    const item = fixture(), before = snapshot();
    database.exec(`CREATE TRIGGER abort_after_archive BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'archive abort'); END`);
    expect(() => save(item, classification(null))).toThrow(/archive abort/);
    expect(snapshot()).toEqual(before);
  });

  it('rejects stale deletion CAS before any history write', () => {
    const item = fixture(), current = save(item, classification(dog)), before = snapshot();
    expect(() => save(item, classification(null))).toThrow(/conflict/);
    expect(snapshot()).toEqual(before);
    expect(get(item)).toEqual(current);
    expect(database.prepare('SELECT * FROM annotation_target_history').all()).toEqual([]);
  });

  it('never repairs missing active provenance from an otherwise valid tombstone', () => {
    const item = fixture(), cleared = save(item, classification(null));
    const restored = save(cleared.item, item.annotation);
    database.prepare('DELETE FROM annotation_provenance WHERE item_id=?').run(item.id);
    const before = snapshot();
    expect(() => save(restored.item, classification(null))).toThrow();
    expect(snapshot()).toEqual(before);
    expect(database.pragma('foreign_key_check')).toEqual([]);
  });

  it('preserves original/from after an ANN-03 class merge and permits a locked schema', () => {
    const item = fixture(), original = get(item).provenance[0].original;
    mergeLabelClasses(database, projectId, schemaId, cat, dog, 0);
    database.prepare('UPDATE label_schemas SET locked_at=?,edit_version=edit_version+1 WHERE id=?').run(now, schemaId);
    const result = save(get(item).item, classification(bird));
    expect(result.provenance[0]).toMatchObject({ kind: 'import-edited', original, changes: { classId: { from: cat, to: bird } } });
  });

  it('preserves prior delta metadata with canonical integer-like key ordering', () => {
    const item = fixture();
    database.prepare("UPDATE annotation_provenance SET kind='import-edited',changes_json=? WHERE item_id=?")
      .run('{"10":{"note":"ten"},"2":{"note":"two"}}', item.id);
    const result = save(item, classification(dog));
    expect(result.provenance[0].changes).toEqual({ '10': { note: 'ten' }, '2': { note: 'two' }, classId: { from: cat, to: dog } });
    expect(database.prepare('SELECT changes_json FROM annotation_provenance WHERE item_id=?').get(item.id)).toEqual({
      changes_json: `{"10":{"note":"ten"},"2":{"note":"two"},"classId":{"from":"${cat}","to":"${dog}"}}`,
    });
    expect(get(item)).toEqual(result);
  });

  it('accepts null-prototype JSON records while retaining strict shared-schema validation', () => {
    const item = fixture();
    const annotation = Object.assign(Object.create(null) as object, classification(dog)) as Annotation;
    const request = Object.assign(Object.create(null) as object, command(item, annotation)) as SaveAnnotationDraftInput;
    expect(saveAnnotationDraft(database, projectId, item.workspaceId, item.id, request).item.annotation).toEqual(classification(dog));
  });

  it.each(['version', 'hash', 'expected-state', 'expected-confirmed-at'] as const)('rejects stale %s without changing any rows', (kind) => {
    const item = confirmFixture(fixture()), before = snapshot();
    const patch: Partial<SaveAnnotationDraftInput> = kind === 'version' ? { expectedEditVersion: item.editVersion - 1 }
      : kind === 'hash' ? { expectedAnnotationSha256: 'f'.repeat(64) }
        : kind === 'expected-state' ? { expectedState: 'editing', expectedConfirmedAt: null }
          : { expectedConfirmedAt: '2026-09-12T05:31:00.123Z' };
    expect(() => save(item, classification(dog), patch)).toThrow(/conflict/);
    expect(snapshot()).toEqual(before);
  });

  it('rejects a second connection stale write and a state-only confirmation race with unchanged content hash', () => {
    const item = fixture(), other = openDatabase(path);
    try {
      const winner = saveAnnotationDraft(other, projectId, item.workspaceId, item.id, command(item, classification(dog)));
      expect(() => save(item, classification(bird))).toThrow(/conflict/);
      expect(get(item)).toEqual(winner);
      const confirmed = confirmFixture(winner.item);
      expect(confirmed.annotationSha256).toBe(winner.item.annotationSha256);
      const legacy = { expectedEditVersion: winner.item.editVersion, expectedAnnotationSha256: winner.item.annotationSha256,
        annotation: classification(bird), state: 'editing' as const, exclusionReason: null };
      expect(() => saveAnnotationDraft(other, projectId, item.workspaceId, item.id, legacy)).toThrow(/conflict/);
      expect(get(item).item).toEqual(confirmed);
    } finally { other.close(); }
  });

  it('takes its input snapshot before DB access, so later caller mutation cannot alter the write', () => {
    const item = fixture(), request = command(item, classification(dog)), nativeExec = database.exec.bind(database);
    vi.spyOn(database, 'exec').mockImplementation((sql) => {
      if (sql === 'BEGIN IMMEDIATE' && request.annotation.kind === 'classification') request.annotation.classId = bird;
      return nativeExec(sql);
    });
    expect(saveAnnotationDraft(database, projectId, item.workspaceId, item.id, request).item.annotation).toEqual(classification(dog));
  });

  it.each(['project', 'workspace', 'item', 'class', 'task'] as const)('rejects wrong %s scope atomically', (kind) => {
    const item = fixture(), before = snapshot();
    expect(() => saveAnnotationDraft(database, kind === 'project' ? foreignId : projectId,
      kind === 'workspace' ? foreignId : item.workspaceId, kind === 'item' ? foreignId : item.id,
      command(item, kind === 'class' ? classification(foreignId) : kind === 'task' ? detection() : classification(dog)))).toThrow();
    expect(snapshot()).toEqual(before);
  });

  it('rejects out-of-bounds rectangles even in excluded drafts using actual image dimensions', () => {
    const item = fixture('detection', false), before = snapshot();
    const annotation: Annotation = { kind: 'detection', rectangles: [
      { id: newRectangle, classId: cat, x: 639.75, y: 0, width: 0.5, height: 1 },
    ] };
    expect(() => save(item, annotation, { state: 'excluded' })).toThrow();
    expect(snapshot()).toEqual(before);
  });

  it.each(['annotation_items', 'annotation_provenance', 'annotation_workspaces'] as const)('rolls back content, confirmation, provenance and versions when %s fails', (table) => {
    const item = confirmFixture(fixture()), before = snapshot();
    database.exec(`CREATE TRIGGER fail_draft BEFORE ${table === 'annotation_provenance' ? 'INSERT' : 'UPDATE'} ON ${table}
      BEGIN SELECT RAISE(ABORT,'injected draft failure'); END`);
    expect(() => save(item, classification(dog))).toThrow(/injected draft failure/);
    expect(snapshot()).toEqual(before);
    expect(database.inTransaction).toBe(false);
  });

  it('rolls back the already-replaced first provenance row when the second target fails', () => {
    const item = confirmFixture(fixture('detection')), before = snapshot();
    if (item.annotation.kind !== 'detection') throw new Error('fixture');
    const secondId = item.annotation.rectangles.map((rectangle) => rectangle.id).sort()[1];
    database.exec(`CREATE TRIGGER fail_second_provenance BEFORE INSERT ON annotation_provenance
      WHEN NEW.target_key='${secondId}' BEGIN SELECT RAISE(ABORT,'second target failure'); END`);
    expect(() => save(item, { kind: 'detection', rectangles: item.annotation.kind === 'detection'
      ? item.annotation.rectangles.map((rectangle) => ({ ...rectangle, classId: dog })) : [] })).toThrow(/second target failure/);
    expect(snapshot()).toEqual(before);
    expect(database.inTransaction).toBe(false);
  });

  it.each(['schema', 'provenance', 'item', 'import', 'project'] as const)('detects trigger changes to %s before commit and rolls back', (kind) => {
    const item = fixture(), before = snapshot();
    const sql = kind === 'schema' ? "UPDATE label_classes SET description='changed';"
      : kind === 'provenance' ? "UPDATE annotation_provenance SET changes_json='{}';"
        : kind === 'item' ? "UPDATE annotation_items SET edit_version=edit_version+1,updated_at='2026-09-13T00:00:00.000Z';"
          : kind === 'import' ? "UPDATE data_imports SET updated_at='2026-09-13T00:00:00.000Z';"
            : "UPDATE projects SET description='changed';";
    database.exec(`CREATE TRIGGER change_draft AFTER UPDATE ON annotation_workspaces BEGIN ${sql} END`);
    expect(() => save(item, classification(dog))).toThrow();
    expect(snapshot()).toEqual(before);
    expect(database.inTransaction).toBe(false);
  });

  it('never joins or rolls back a caller transaction', () => {
    const item = fixture();
    database.exec('BEGIN');
    database.prepare('INSERT INTO settings VALUES (?,?)').run('foreign', 'retained');
    expect(() => save(item, classification(dog))).toThrow(/caller transaction/);
    expect(database.inTransaction).toBe(true);
    expect(database.prepare('SELECT value FROM settings WHERE key=?').get('foreign')).toEqual({ value: 'retained' });
    database.exec('ROLLBACK');
    expect(get(item).item).toEqual(item);
  });

  it.each([false, true])('reports uncertain COMMIT without retry/foreign rollback (foreign transaction=%s)', (foreign) => {
    const item = fixture(), nativeExec = database.exec.bind(database);
    const exec = vi.spyOn(database, 'exec').mockImplementation((sql) => {
      nativeExec(sql);
      if (sql === 'COMMIT') {
        if (foreign) { nativeExec('BEGIN'); database.prepare('INSERT INTO settings VALUES (?,?)').run('foreign', 'retained'); }
        throw new Error('lost COMMIT acknowledgement');
      }
      return database;
    });
    expect(() => save(item, classification(dog))).toThrow(/uncertain/);
    expect(exec.mock.calls.filter(([sql]) => sql === 'COMMIT')).toHaveLength(1);
    if (foreign) {
      expect(database.inTransaction).toBe(true);
      expect(database.prepare('SELECT value FROM settings WHERE key=?').get('foreign')).toEqual({ value: 'retained' });
      nativeExec('ROLLBACK');
    }
    exec.mockRestore();
    expect(get(item).item).toMatchObject({ editVersion: 1, annotation: classification(dog), state: 'editing' });
    expect(() => save(item)).toThrow(/conflict/);
  });

  it.each(['frozen', 'item-version', 'workspace-version', 'corrupt-hash', 'missing-provenance', 'corrupt-original'] as const)
    ('fails closed on stored %s without repairing or overwriting it', (kind) => {
      const item = fixture();
      // Deliberately invalid/frozen SQL fixtures only, NOT an ANN-19 publication.
      if (kind === 'frozen' || kind === 'workspace-version') {
        database.exec('DROP TRIGGER annotation_workspaces_update');
        database.prepare('UPDATE annotation_workspaces SET state=?,edit_version=? WHERE id=?')
          .run(kind === 'frozen' ? 'frozen' : 'editing', kind === 'frozen' ? 1 : Number.MAX_SAFE_INTEGER, item.workspaceId);
      } else if (kind === 'item-version') {
        database.exec('DROP TRIGGER annotation_items_update');
        database.prepare('UPDATE annotation_items SET edit_version=? WHERE id=?').run(Number.MAX_SAFE_INTEGER, item.id);
      } else if (kind === 'corrupt-hash') {
        database.prepare('UPDATE annotation_items SET annotation_sha256=?,edit_version=edit_version+1 WHERE id=?').run('f'.repeat(64), item.id);
      } else if (kind === 'missing-provenance') database.prepare('DELETE FROM annotation_provenance WHERE item_id=?').run(item.id);
      else database.prepare("UPDATE annotation_provenance SET original_json='{}' WHERE item_id=?").run(item.id);
      const before = snapshot();
      expect(() => save(item, classification(dog), kind === 'item-version' ? { expectedEditVersion: Number.MAX_SAFE_INTEGER } : {})).toThrow();
      expect(snapshot()).toEqual(before);
    });

  it('advances timestamps despite a stationary clock, independently of client time', () => {
    const item = fixture();
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse(now) - 1000);
    const first = save(item, classification(dog)), second = save(first.item, classification(bird));
    expect(Date.parse(first.item.updatedAt)).toBeGreaterThan(Date.parse(item.updatedAt));
    expect(Date.parse(second.item.updatedAt)).toBe(Date.parse(first.item.updatedAt) + 1);
  });
});

describe('ANN-08 hostile command boundary is rejected before ANY DB access', () => {
  const valid = (): SaveAnnotationDraftInput => ({ expectedEditVersion: 0, expectedAnnotationSha256: 'a'.repeat(64),
    annotation: classification(null), state: 'editing', exclusionReason: null });
  function reject(input: unknown, ids = [projectId, schemaId, importId]) {
    const touched = vi.fn((): never => { throw new Error('DB touched before validation'); });
    const database = new Proxy({} as DatabaseConnection, { get: touched });
    expect(() => saveAnnotationDraft(database, ids[0], ids[1], ids[2], input as SaveAnnotationDraftInput)).toThrow();
    expect(touched).not.toHaveBeenCalled();
  }

  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, '0', null])('rejects invalid expected edit version %s', (value) => {
    reject({ ...valid(), expectedEditVersion: value });
  });
  it.each(['', 'a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64), 'g'.repeat(64), `${'a'.repeat(64)}\n`, null])
    ('rejects invalid expected hash %s', (value) => reject({ ...valid(), expectedAnnotationSha256: value }));
  it.each(['id', 'itemId', 'annotationSha256', 'updatedAt', 'confirmedAt', 'negativeConfirmed', 'provenance', 'sourceSuggestionId', 'history', 'targetHistory'])
    ('rejects caller-authoritative %s', (key) => reject({ ...valid(), [key]: null }));
  it.each(['confirmed', 'unstarted', 'suggested', null])('rejects non-draft state %s', (state) => reject({ ...valid(), state }));
  it('rejects missing/extra fields, serialized JSON and inconsistent expected-state pairs', () => {
    for (const key of Object.keys(valid())) {
      const value = { ...valid() } as Record<string, unknown>; delete value[key]; reject(value);
    }
    for (const value of [null, [], JSON.stringify(valid()), { ...valid(), extra: true },
      { ...valid(), expectedState: 'editing' }, { ...valid(), expectedConfirmedAt: null },
      { ...valid(), expectedState: 'confirmed', expectedConfirmedAt: null },
      { ...valid(), expectedState: 'editing', expectedConfirmedAt: now },
      { ...valid(), expectedState: 'confirmed', expectedConfirmedAt: 'yesterday' },
      { ...valid(), expectedState: undefined, expectedConfirmedAt: undefined }]) reject(value);
  });
  it('rejects invalid exclusion reason shape, byte count, Unicode and non-excluded reason', () => {
    for (const reason of [1, undefined, '\0', '\uD800', '界'.repeat(1366)]) reject({ ...valid(), state: 'excluded', exclusionReason: reason });
    reject({ ...valid(), exclusionReason: 'not excluded' });
  });
  it('rejects invalid IDs without consulting the database', () => {
    for (let index = 0; index < 3; index += 1) for (const bad of ['bad', projectId.toUpperCase(), `${projectId}\n`]) {
      const ids = [projectId, schemaId, importId]; ids[index] = bad; reject(valid(), ids);
    }
  });
  it('rejects annotation unknowns, invalid coordinates, duplicate targets and oversized JSON', () => {
    for (const annotation of [{ kind: 'classification', classId: null, extra: true },
      { kind: 'classification', classId: 'name-not-id' }, { kind: 'detection', rectangles: [], suggested: true }]) reject({ ...valid(), annotation });
    const box = { id: newRectangle, classId: cat, x: 0, y: 0, width: 1, height: 1 };
    for (const patch of [{ x: -1 }, { y: NaN }, { width: 0 }, { height: Infinity }, { id: 'raw-coco-id' }, { score: 0.9 }]) {
      reject({ ...valid(), annotation: { kind: 'detection', rectangles: [{ ...box, ...patch }] } });
    }
    reject({ ...valid(), annotation: { kind: 'detection', rectangles: [{ ...box }, { ...box }] } });
    reject({ ...valid(), annotation: { kind: 'detection', rectangles: Array.from({ length: 10_000 }, (_, index) => ({
      ...box, id: `${String(index).padStart(8, '0')}-6666-4666-8666-666666666666`,
    })) } });
  });
  it('rejects accessors, toJSON, non-enumerables, symbols, exotic prototypes, sparse arrays and shared/cyclic trees without executing code', () => {
    const getter = vi.fn(() => classification(null)), toJSON = vi.fn(() => valid());
    reject(Object.defineProperty(valid(), 'annotation', { enumerable: true, get: getter }));
    reject({ ...valid(), annotation: Object.defineProperty({ kind: 'classification' }, 'classId', { enumerable: true, get: getter }) });
    reject({ ...valid(), toJSON });
    reject(Object.defineProperty(valid(), 'hidden', { value: true }));
    reject(Object.assign(valid(), { [Symbol('extra')]: true }));
    reject(Object.assign(Object.create({ inherited: true }) as object, valid()));
    reject({ ...valid(), annotation: new Date() });
    reject({ ...valid(), annotation: { kind: 'detection', rectangles: new Array(1) } });
    const array = Object.defineProperty([], '0', { enumerable: true, get: getter });
    reject({ ...valid(), annotation: { kind: 'detection', rectangles: array } });
    const shared = { id: newRectangle, classId: cat, x: 0, y: 0, width: 1, height: 1 };
    reject({ ...valid(), annotation: { kind: 'detection', rectangles: [shared, shared] } });
    const cycle: Record<string, unknown> = {}; cycle['self'] = cycle;
    reject({ ...valid(), annotation: cycle });
    expect(getter).not.toHaveBeenCalled(); expect(toJSON).not.toHaveBeenCalled();
  });
  it('rejects root/nested and revoked proxies without invoking any traps', () => {
    const trap = vi.fn((): never => { throw new Error('proxy trap executed'); });
    const handler = { get: trap, getPrototypeOf: trap, ownKeys: trap, getOwnPropertyDescriptor: trap };
    reject(new Proxy(valid(), handler));
    reject({ ...valid(), annotation: new Proxy(classification(null), handler) });
    reject({ ...valid(), annotation: { kind: 'detection', rectangles: new Proxy([], handler) } });
    const revoked = Proxy.revocable({}, handler); revoked.revoke();
    reject(revoked.proxy); reject({ ...valid(), annotation: revoked.proxy });
    expect(trap).not.toHaveBeenCalled();
  });
});