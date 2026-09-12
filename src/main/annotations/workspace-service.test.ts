// @vitest-environment node
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ScanImage, ScanResult } from '../../shared/contracts/import.js';
import { insertDataImport, prepareDataImport } from '../data/import-repository.js';
import { openDatabase, type DatabaseConnection } from '../db/database.js';
import { migrateDatabase } from '../db/migrate.js';
import { canonicalAnnotationJson, importWorkspaceStamp, workspaceTransaction } from './workspace-repository.js';
import { mergeLabelClasses, updateLabelClass } from './label-schema-service.js';
import { createAnnotationWorkspace, getAnnotationItem, getAnnotationWorkspace, listAnnotationItems } from './workspace-service.js';

const projectId = '01234567-89ab-4cde-8f01-23456789abcd';
const foreignId = '11234567-89ab-4cde-8f01-23456789abcd';
const jobId = 'ae45cf74-c9f9-4c49-88b9-0523b1ac7383';
const importId = '9b2db431-04e9-488b-b4c2-3859fd26cb6e';
const schemaId = '22222222-2222-4222-8222-222222222222';
const classId = '33333333-3333-4333-8333-333333333333';
const now = '2026-09-12T05:30:00.123Z';
const digest = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(',')}}`;
}
const migrations = ['001_core', '002_jobs', '003_import', '004_import_generation', '005_import_rights', '006_annotations']
  .map((name, index) => ({ version: index + 1, sql: readFileSync(new URL(`../db/migrations/${name}.sql`, import.meta.url), 'utf8') }));

describe('ANN-05 workspace service / real SQLite 001–006', () => {
  let directory: string, path: string, database: DatabaseConnection;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'autovision-ann05-'));
    path = join(directory, 'metadata.sqlite3');
    database = openDatabase(path);
    migrateDatabase(database, migrations);
    for (const id of [projectId, foreignId]) database.prepare(`INSERT INTO projects
      (id,name,task_type,workspace_path,created_at,updated_at) VALUES (?,?,?,?,?,?)`)
      .run(id, 'ANN05 fixture', 'classification', `C:\\Projects\\${id}`, now, now);
    database.prepare(`INSERT INTO jobs(id,project_id,kind,status,created_at,updated_at) VALUES (?,?,?,?,?,?)`)
      .run(jobId, projectId, 'scan-dataset', 'Succeeded', now, now);
    // Raw TEST fixture only: not user approval, automatic schema/class creation,
    // rights acknowledgement, DAT-08 file publication or Reference authority.
    database.prepare(`INSERT INTO label_schemas(id,project_id,created_at,updated_at) VALUES (?,?,?,?)`)
      .run(schemaId, projectId, now, now);
    database.prepare(`INSERT INTO label_classes
      (id,schema_id,display_name,normalized_name,color,ordinal,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run(classId, schemaId, '猫', '猫', '#123456', 0, now, now);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    if (database.open) database.close();
    rmSync(directory, { recursive: true, force: true });
  });

  function image(index: number, annotation: ScanImage['annotation'] = null): ScanImage {
    return { key: `image:${index}`, sourcePath: `C:\\images\\${index}.png`, byteSize: 100,
      mtimeNs: '1234567890123456789', sha256: index.toString(16).padStart(64, '0'), format: 'png',
      width: 640, height: 480, orientation: 6, duplicateOf: null, annotation };
  }
  function persist(images: ScanImage[], taskType: ScanResult['taskType'] = 'classification',
    mode: ScanResult['mode'] = 'copy', classKey = 'scan:cat'): void {
    database.prepare('UPDATE projects SET task_type=? WHERE id=?').run(taskType, projectId);
    const scan: ScanResult = { formatVersion: 1, projectId, jobId, taskType, mode,
      classes: images.some((entry) => entry.annotation !== null) ? [{ key: classKey, name: 'Raw Cat',
        sourceCategoryId: taskType === 'detection' ? '9007199254740993123' : null }] : [], images, issues: [] };
    if (mode === 'copy') {
      const prepared = prepareDataImport({ id: importId, createdAt: now, updatedAt: now, scanResult: scan,
        sourceManifest: { formatVersion: 1, mode, entries: images.map((entry, ordinal) => ({ imageKey: entry.key,
          relativePath: `datasets/${importId}/source/${ordinal}.png`, byteSize: entry.byteSize, sha256: entry.sha256 })) } });
      database.exec('BEGIN IMMEDIATE');
      try { insertDataImport(database, prepared); database.exec('COMMIT'); }
      finally { if (database.inTransaction) database.exec('ROLLBACK'); }
    } else {
      // Deliberate raw SQL Reference READ fixture. Never fabricate or invoke a
      // captured capability, and never claim to have verified a real file.
      const entries = images.map((entry) => ({ imageKey: entry.key, sourcePath: entry.sourcePath,
        identity: { dev: '1', ino: '42', birthtimeNs: '0' }, byteSize: entry.byteSize,
        mtimeNs: entry.mtimeNs, sha256: entry.sha256 }));
      const scanJson = stable(scan), manifestJson = stable({ formatVersion: 1, mode, entries });
      database.prepare(`INSERT INTO data_imports VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
        .run(importId, projectId, jobId, taskType, mode, now, now, scanJson, digest(scanJson), manifestJson, digest(manifestJson));
      entries.forEach((entry, ordinal) => database.prepare('INSERT INTO import_sources VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(importId, entry.imageKey, ordinal, mode, null, null, entry.sourcePath, '1', '42', '0',
          entry.byteSize, entry.mtimeNs, entry.sha256, digest(stable(entry))));
    }
  }
  const create = (mapping: Readonly<Record<string, string>> = {}) =>
    createAnnotationWorkspace(database, projectId, importId, schemaId, mapping);
  function list(workspaceId: string) { return listAnnotationItems(database, projectId, workspaceId, { offset: 0, limit: 200 }); }
  function expectNoWorkspace() {
    for (const table of ['annotation_workspaces', 'annotation_items', 'annotation_provenance'])
      expect(database.prepare(`SELECT * FROM ${table}`).all()).toEqual([]);
  }

  it.each([null, 'folder', 'csv'] as const)('imports classification %s without confirmation and preserves source rows', (kind) => {
    const annotation: ScanImage['annotation'] = kind === null ? null
      : { type: 'classification', classKey: 'scan:cat', sourceRow: kind === 'csv' ? 9007199254740991 : null };
    persist([image(0, annotation)]);
    const result = create(kind === null ? {} : { 'scan:cat': classId });
    expect(Object.keys(result).sort()).toEqual(['itemCount', 'workspace']);
    expect(result.itemCount).toBe(1);
    expect(result.workspace).toMatchObject({ state: 'editing', editVersion: 0 });
    const [item] = list(result.workspace.id).items;
    expect(item).toMatchObject({ state: 'unstarted', negativeConfirmed: false, confirmedAt: null,
      width: 640, height: 480, annotation: { kind: 'classification', classId: kind === null ? null : classId } });
    const detail = getAnnotationItem(database, projectId, result.workspace.id, item.id);
    if (kind === null) expect(detail.provenance).toEqual([]);
    else expect(detail.provenance).toEqual([expect.objectContaining({ targetKey: 'classification',
      sourceAnnotationKey: kind === 'csv' ? 'row:9007199254740991' : 'classification',
      kind: 'import-unmodified', original: annotation, changes: {} })]);
    expect(item.annotationSha256).toBe(digest(canonicalAnnotationJson(item.annotation)));
    expect(Object.isFrozen(result.workspace)).toBe(true);
    expect(Object.isFrozen(detail.provenance)).toBe(true);
  });

  it.each(['none', 'empty', 'boxes'] as const)('imports detection %s with exact coordinates and lossless decimal IDs', (kind) => {
    const boxes = kind === 'boxes' ? [{ classKey: 'scan:cat', bbox: [0.5, 1.25, 639.5, 478.75] as [number, number, number, number],
      sourceAnnotationId: '9007199254740993123456789' }] : [];
    persist([image(0, kind === 'none' ? null : { type: 'detection', sourceImageId: '9007199254740993123456788', boxes })], 'detection');
    const { workspace } = create(kind === 'none' ? {} : { 'scan:cat': classId });
    const [item] = list(workspace.id).items;
    expect(item).toMatchObject({ state: 'unstarted', negativeConfirmed: false, confirmedAt: null });
    const { provenance } = getAnnotationItem(database, projectId, workspace.id, item.id);
    if (kind !== 'boxes') expect(provenance).toEqual([]);
    else {
      expect(item.annotation).toMatchObject({ rectangles: [{ classId, x: 0.5, y: 1.25, width: 639.5, height: 478.75 }] });
      expect(provenance[0]).toMatchObject({ sourceAnnotationKey: boxes[0].sourceAnnotationId,
        original: { ...boxes[0], type: 'detection', sourceImageId: '9007199254740993123456788' }, changes: {} });
      expect(provenance[0].targetKey).not.toBe(boxes[0].sourceAnnotationId);
    }
  });

  it('allows locked schemas and only actual mapped classes, including prototype-like scan keys', () => {
    persist([image(0, { type: 'classification', classKey: 'constructor', sourceRow: null })], 'classification', 'copy', 'constructor');
    database.prepare('UPDATE label_schemas SET locked_at=?,edit_version=edit_version+1 WHERE id=?').run(now, schemaId);
    const first = create({ constructor: classId });
    const second = create({ constructor: classId });
    expect(second.workspace.id).not.toBe(first.workspace.id);
    expect(database.prepare('SELECT count(*) AS count FROM label_classes').get()).toEqual({ count: 1 });
    expect(database.prepare('SELECT * FROM dataset_revisions').all()).toEqual([]);
    expect(database.prepare('SELECT * FROM project_import_rights').all()).toEqual([]);
    expect(database.prepare('SELECT * FROM jobs').all()).toHaveLength(1);
  });

  it.each<Readonly<Record<string, string>>>([{}, { 'scan:cat': classId, extra: classId }, { 'scan:cat': '猫' }, { 'scan:cat': foreignId }])
    ('rejects missing/extra/name-guessed/foreign mappings %j atomically', (mapping) => {
      persist([image(0, { type: 'classification', classKey: 'scan:cat', sourceRow: 2 })]);
      expect(() => create(mapping)).toThrow();
      expectNoWorkspace();
    });

  it('rejects real classes from another Project and changed Project tasks', () => {
    persist([image(0, { type: 'classification', classKey: 'scan:cat', sourceRow: null })]);
    database.prepare('INSERT INTO label_schemas(id,project_id,created_at,updated_at) VALUES (?,?,?,?)').run(foreignId, foreignId, now, now);
    database.prepare(`INSERT INTO label_classes(id,schema_id,display_name,normalized_name,color,ordinal,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?)`).run(foreignId, foreignId, 'Other', 'other', '#123456', 0, now, now);
    expect(() => create({ 'scan:cat': foreignId })).toThrow();
    database.prepare('UPDATE projects SET task_type=? WHERE id=?').run('detection', projectId);
    expect(() => create({ 'scan:cat': classId })).toThrow();
    expectNoWorkspace();
  });

  it('rejects accessors without executing them and never joins a foreign transaction', () => {
    const getter = vi.fn(() => classId);
    persist([image(0)]);
    expect(() => create(Object.defineProperty({}, 'bad', { enumerable: true, get: getter }))).toThrow();
    expect(getter).not.toHaveBeenCalled();
    database.exec('BEGIN');
    database.prepare('INSERT INTO settings VALUES (?,?)').run('caller', 'retained');
    expect(() => create()).toThrow(/caller transaction/);
    expect(database.inTransaction).toBe(true);
    expect(database.prepare('SELECT * FROM settings').all()).toEqual([{ key: 'caller', value: 'retained' }]);
    database.exec('ROLLBACK');
    expectNoWorkspace();
  });

  it('rolls back header, previous items and provenance when a later insert fails', () => {
    persist([image(0, { type: 'classification', classKey: 'scan:cat', sourceRow: 2 }), image(1)]);
    database.exec(`CREATE TRIGGER fail_second BEFORE INSERT ON annotation_items WHEN NEW.image_key='image:1'
      BEGIN SELECT RAISE(ABORT,'injected failure'); END`);
    expect(() => create({ 'scan:cat': classId })).toThrow(/injected failure/);
    expectNoWorkspace();
    expect(database.inTransaction).toBe(false);
  });

  it.each(['COMMIT', 'SAVEPOINT'] as const)('does not roll back foreign work after %s loses acknowledgement', (point) => {
    const nativeExec = database.exec.bind(database);
    vi.spyOn(database, 'exec').mockImplementation((sql) => {
      nativeExec(sql);
      if (sql === point || (point === 'SAVEPOINT' && sql.startsWith('SAVEPOINT '))) {
        if (point === 'SAVEPOINT') nativeExec('COMMIT');
        nativeExec('BEGIN');
        database.prepare('INSERT INTO settings VALUES (?,?)').run('foreign', 'retained');
        throw new Error('lost acknowledgement');
      }
      return database;
    });
    expect(() => workspaceTransaction(database, true, () => {
      database.prepare('INSERT INTO settings VALUES (?,?)').run('own', 'committed');
    })).toThrow(/uncertain/);
    expect(database.inTransaction).toBe(true);
    expect(database.prepare('SELECT value FROM settings WHERE key=?').get('foreign')).toEqual({ value: 'retained' });
    nativeExec('ROLLBACK');
    expect(database.prepare('SELECT value FROM settings WHERE key=?').get('own'))
      .toEqual(point === 'COMMIT' ? { value: 'committed' } : undefined);
  });

  it('leaves a failed private savepoint uncertain without global rollback', () => {
    const nativeExec = database.exec.bind(database), action = vi.fn();
    const exec = vi.spyOn(database, 'exec').mockImplementation((sql) => {
      if (sql.startsWith('SAVEPOINT ')) throw new Error('marker unavailable');
      return nativeExec(sql);
    });
    expect(() => workspaceTransaction(database, true, action)).toThrow(/uncertain/);
    expect(action).not.toHaveBeenCalled();
    expect(database.inTransaction).toBe(true);
    expect(exec.mock.calls.some(([sql]) => sql === 'ROLLBACK')).toBe(false);
    nativeExec('ROLLBACK');
  });

  it.each((['sql', 'service', 'raw-examples'] as const).flatMap((kind) => [false, true].map((winnerExists) => ({ kind, winnerExists }))))
    ('rejects same-ID Schema races via $kind before inserts (winner: $winnerExists)', ({ kind, winnerExists }) => {
    persist([image(0, { type: 'classification', classKey: 'scan:cat', sourceRow: 2 })]);
    const winner = winnerExists ? create({ 'scan:cat': classId }) : undefined;
    const saved = winner ? list(winner.workspace.id) : undefined;
    const other = openDatabase(path), nativeExec = database.exec.bind(database);
    vi.spyOn(database, 'exec').mockImplementation((sql) => {
      if (sql === 'BEGIN IMMEDIATE') {
        if (kind === 'service') updateLabelClass(other, projectId, { id: classId, schemaId, expectedEditVersion: 0,
          displayName: '猫', modelAlias: null, color: '#123456', description: 'changed', examples: [], ordinal: 0 });
        else if (kind === 'raw-examples') other.prepare('UPDATE label_classes SET examples_json=? WHERE id=?').run('[ ]', classId);
        else other.prepare('UPDATE label_classes SET description=? WHERE id=?').run('changed without version bump', classId);
      }
      return nativeExec(sql);
    });
    try {
      expect(() => create({ 'scan:cat': classId })).toThrow(/Schema changed/);
      if (winner) {
        expect(database.prepare('SELECT id FROM annotation_workspaces').all()).toEqual([{ id: winner.workspace.id }]);
        expect(list(winner.workspace.id)).toEqual(saved);
      } else expectNoWorkspace();
      expect(database.inTransaction).toBe(false);
    } finally { other.close(); }
  });

  it('detects Schema metadata changed by an insert trigger at the end and rolls back every row', () => {
    persist([image(0)]);
    database.exec(`CREATE TRIGGER change_schema AFTER INSERT ON annotation_items BEGIN
      UPDATE label_classes SET description='changed'; END`);
    expect(() => create()).toThrow(/Schema changed/);
    expectNoWorkspace();
    expect(database.prepare('SELECT description FROM label_classes').get()).toEqual({ description: '' });
  });

  it('rejects workspace header reads inside caller transactions without ending them', () => {
    persist([image(0)]);
    const { workspace } = create();
    database.exec('BEGIN');
    expect(() => getAnnotationWorkspace(database, projectId, workspace.id)).toThrow(/caller transaction/);
    expect(database.inTransaction).toBe(true);
    database.exec('ROLLBACK');
  });

  it('rejects trailing-newline generations and missing ledgers as stored corruption', () => {
    persist([image(0)]);
    const nativePrepare = database.prepare.bind(database);
    vi.spyOn(database, 'prepare').mockImplementation((sql) => {
      const statement = nativePrepare(sql);
      if (sql.includes('CAST(g.generation AS TEXT) AS generation')) {
        const nativeGet = statement.get.bind(statement);
        vi.spyOn(statement, 'get').mockImplementation((...args: unknown[]) => ({ ...nativeGet(...args) as object, generation: '1\n' }));
      }
      return statement;
    });
    expect(() => importWorkspaceStamp(database, projectId, importId)).toThrow(/invalid|changed/);
    vi.restoreAllMocks();
    database.exec('DROP TRIGGER import_generations_guard_delete');
    database.prepare('DELETE FROM import_generations WHERE import_id=?').run(importId);
    expect(() => importWorkspaceStamp(database, projectId, importId)).toThrow(/invalid|changed/);
    expect(() => create()).toThrow(/invalid|changed/);
    expectNoWorkspace();
  });

  it('rejects Schema snapshots exceeding 4 MiB on both list and item reads', () => {
    persist([image(0)]);
    const { workspace } = create();
    const [item] = list(workspace.id).items;
    const insert = database.prepare(`INSERT INTO label_classes
      (id,schema_id,display_name,normalized_name,color,description,ordinal,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`);
    for (let index = 1; index <= 64; index += 1) insert.run(
      `${String(index).padStart(8, '0')}-1111-4111-8111-111111111111`, schemaId,
      `class${index}`, `class${index}`, '#123456', 'x'.repeat(65_536), index, now, now);
    expect(() => list(workspace.id)).toThrow();
    expect(() => getAnnotationItem(database, projectId, workspace.id, item.id)).toThrow();
  });

  it('detects same-ID source delete/reinsert ABA before BEGIN without rereading full payloads', () => {
    persist([image(0)]);
    const other = openDatabase(path);
    const nativeExec = database.exec.bind(database);
    let injected = false;
    vi.spyOn(database, 'exec').mockImplementation((sql) => {
      if (sql === 'BEGIN IMMEDIATE' && !injected) {
        injected = true;
        const row = other.prepare('SELECT * FROM import_sources WHERE import_id=?').get(importId) as Record<string, unknown>;
        other.exec('BEGIN IMMEDIATE');
        other.prepare('DELETE FROM import_sources WHERE import_id=?').run(importId);
        other.prepare('INSERT INTO import_sources VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(...Object.values(row));
        other.exec('COMMIT');
      }
      return nativeExec(sql);
    });
    try { expect(() => create()).toThrow(/changed/); expectNoWorkspace(); }
    finally { other.close(); }
  });

  it('rejects corrupt import hash or indexed projection before writing', () => {
    persist([image(0)]);
    database.exec('DROP TRIGGER data_imports_preserve_identity_and_scan');
    database.prepare('UPDATE data_imports SET scan_result_sha256=? WHERE id=?').run('f'.repeat(64), importId);
    expect(() => create()).toThrow(/invalid|changed/);
    expectNoWorkspace();
  });

  it.each(['hash', 'canonical', 'duplicate', 'unknown'])('fails reads on persisted annotation %s corruption', (kind) => {
    persist([image(0)]);
    const { workspace } = create();
    const [item] = list(workspace.id).items;
    const text = kind === 'canonical' ? '{"kind":"classification","classId":null}'
      : kind === 'duplicate' ? '{"classId":null,"classId":null,"kind":"classification"}'
        : kind === 'unknown' ? '{"classId":null,"extra":true,"kind":"classification"}' : canonicalAnnotationJson(item.annotation);
    database.prepare('UPDATE annotation_items SET annotation_json=?,annotation_sha256=?,edit_version=edit_version+1 WHERE id=?')
      .run(text, kind === 'hash' ? 'f'.repeat(64) : digest(text), item.id);
    expect(() => list(workspace.id)).toThrow();
    expect(() => getAnnotationItem(database, projectId, workspace.id, item.id)).toThrow();
  });

  it('fails individual reads on corrupt or missing provenance rather than returning empty evidence', () => {
    persist([image(0, { type: 'classification', classKey: 'scan:cat', sourceRow: 2 })]);
    const { workspace } = create({ 'scan:cat': classId });
    const [item] = list(workspace.id).items;
    database.prepare('UPDATE annotation_provenance SET original_json=? WHERE item_id=?').run(' {}', item.id);
    expect(() => getAnnotationItem(database, projectId, workspace.id, item.id)).toThrow();
    database.prepare('DELETE FROM annotation_provenance WHERE item_id=?').run(item.id);
    expect(() => getAnnotationItem(database, projectId, workspace.id, item.id)).toThrow();
  });

  it('reopens Reference metadata without filesystem I/O or claiming file verification', () => {
    persist([image(0)], 'classification', 'reference');
    const { workspace } = create();
    database.close(); database = openDatabase(path);
    expect(getAnnotationWorkspace(database, projectId, workspace.id)).toEqual(workspace);
    expect(list(workspace.id).items[0].state).toBe('unstarted');
    expect(workspace.mode).toBe('reference');
  });

  it.each(['csv', 'coco'] as const)('reopens real SQLite %s provenance and rejects fabricated keys and originals', (format) => {
    const annotation: NonNullable<ScanImage['annotation']> = format === 'csv'
      ? { type: 'classification', classKey: 'scan:cat', sourceRow: 2 }
      : { type: 'detection', sourceImageId: '10', boxes: [{ classKey: 'scan:cat', sourceAnnotationId: '20', bbox: [1, 2, 3, 4] }] };
    persist([image(0, annotation)], format === 'csv' ? 'classification' : 'detection');
    const { workspace } = create({ 'scan:cat': classId });
    const [item] = list(workspace.id).items;
    database.close(); database = openDatabase(path);
    const queries = vi.spyOn(database, 'prepare');
    const detail = getAnnotationItem(database, projectId, workspace.id, item.id);
    expect(queries.mock.calls.filter(([sql]) => sql.includes('scan_result_json AS scanResultJson'))).toHaveLength(1);
    queries.mockClear();
    list(workspace.id);
    expect(queries.mock.calls.filter(([sql]) => sql.includes('scan_result_json AS scanResultJson'))).toHaveLength(0);
    expect(detail.item).toMatchObject({ state: 'unstarted', negativeConfirmed: false, confirmedAt: null });
    const original = detail.provenance[0];
    database.prepare('UPDATE annotation_provenance SET source_annotation_key=? WHERE item_id=?')
      .run(format === 'csv' ? 'row:999' : '999', item.id);
    expect(() => getAnnotationItem(database, projectId, workspace.id, item.id)).toThrow(/invalid|changed/);
    database.prepare('UPDATE annotation_provenance SET source_annotation_key=?,original_json=? WHERE item_id=?')
      .run(original.sourceAnnotationKey, stable({ ...original.original, classKey: 'fabricated' }), item.id);
    expect(() => getAnnotationItem(database, projectId, workspace.id, item.id)).toThrow(/invalid|changed/);
    const changes = { reason: 'explicit edit', classId };
    database.prepare("UPDATE annotation_provenance SET kind='import-edited',original_json=?,changes_json=? WHERE item_id=?")
      .run(stable(original.original), stable(changes), item.id);
    const edited = getAnnotationItem(database, projectId, workspace.id, item.id);
    expect(edited.provenance[0]).toMatchObject({ original: original.original, changes, kind: 'import-edited' });
    expect(edited.item.confirmedAt).toBeNull();
    database.prepare('UPDATE annotation_provenance SET original_json=? WHERE item_id=?')
      .run(stable({ ...original.original, classKey: 'fabricated' }), item.id);
    expect(() => getAnnotationItem(database, projectId, workspace.id, item.id)).toThrow(/invalid|changed/);
  });

  it.each(['classification', 'detection'] as const)('reads ANN-03 merged %s provenance without changing its import original', (task) => {
    const annotation: NonNullable<ScanImage['annotation']> = task === 'classification'
      ? { type: 'classification', classKey: 'scan:cat', sourceRow: 2 }
      : { type: 'detection', sourceImageId: '10', boxes: [{ classKey: 'scan:cat', sourceAnnotationId: '20', bbox: [1, 2, 3, 4] }] };
    persist([image(0, annotation)], task);
    database.prepare(`INSERT INTO label_classes(id,schema_id,display_name,normalized_name,color,ordinal,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?)`).run(foreignId, schemaId, 'Target', 'target', '#123456', 1, now, now);
    const { workspace } = create({ 'scan:cat': classId });
    const [item] = list(workspace.id).items;
    const original = getAnnotationItem(database, projectId, workspace.id, item.id).provenance[0].original;
    mergeLabelClasses(database, projectId, schemaId, classId, foreignId, 0);
    database.close(); database = openDatabase(path);
    const detail = getAnnotationItem(database, projectId, workspace.id, item.id);
    expect(detail.provenance[0]).toMatchObject({ kind: 'import-edited', original });
    expect(Object.keys(detail.provenance[0].changes).length).toBeGreaterThan(0);
    expect(detail.item.annotation).toMatchObject(task === 'classification'
      ? { classId: foreignId } : { rectangles: [{ classId: foreignId }] });
    expect(detail.item).toMatchObject({ negativeConfirmed: false, confirmedAt: null });
    expect(detail.item.state).not.toBe('confirmed');
  });

  it('provides 16 stable pages after reopen, strict limits, filters and Project isolation', () => {
    persist(Array.from({ length: 32 }, (_, index) => image(index)));
    const { workspace } = create();
    const initial = list(workspace.id).items.map((item) => item.id);
    database.close(); database = openDatabase(path);
    const pages = Array.from({ length: 16 }, (_, index) => listAnnotationItems(database, projectId, workspace.id,
      { offset: index * 2, limit: 2, state: 'unstarted' }));
    expect(pages.every((page) => page.total === 32 && page.items.length === 2)).toBe(true);
    expect(pages.flatMap((page) => page.items.map((item) => item.id))).toEqual(initial);
    expect(listAnnotationItems(database, projectId, workspace.id, { offset: 0, limit: 1, state: 'confirmed' })).toEqual({ items: [], total: 0 });
    expect(listAnnotationItems(database, projectId, workspace.id, { offset: 32, limit: 1 })).toEqual({ items: [], total: 32 });
    for (const limit of [0, 201, 1.5, NaN, Infinity]) expect(() => listAnnotationItems(database, projectId, workspace.id, { offset: 0, limit })).toThrow();
    expect(() => listAnnotationItems(database, projectId, workspace.id, { offset: -1, limit: 1 })).toThrow();
    expect(() => getAnnotationWorkspace(database, foreignId, workspace.id)).toThrow(/not found/);
    expect(() => listAnnotationItems(database, foreignId, workspace.id, { offset: 0, limit: 1 })).toThrow(/not found/);
    expect(() => getAnnotationItem(database, foreignId, workspace.id, initial[0])).toThrow(/not found/);
    expect(database.pragma('foreign_key_check')).toEqual([]);
  });
});