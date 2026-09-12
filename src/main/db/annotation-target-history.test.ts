// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openDatabase, type DatabaseConnection } from './database.js';
import { migrateDatabase, type Migration } from './migrate.js';

const migrations: readonly Migration[] = [
  '001_core.sql', '002_jobs.sql', '003_import.sql', '004_import_generation.sql',
  '005_import_rights.sql', '006_annotations.sql', '007_annotation_target_history.sql',
].map((file, index) => ({ version: index + 1, sql: readFileSync(new URL(`./migrations/${file}`, import.meta.url), 'utf8') }));
const now = '2026-09-13T00:00:00.000Z';
const hash = (text: string): string => createHash('sha256').update(text).digest('hex');
type Row = Record<string, string | number | null>;
let directory: string;
let db: DatabaseConnection;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'av-ann08-history-'));
  db = openDatabase(join(directory, 'metadata.sqlite3'));
});
afterEach(() => {
  if (db.inTransaction) db.exec('ROLLBACK');
  if (db.open) db.close();
  rmSync(directory, { recursive: true, force: true });
});

function fixture(task: 'classification' | 'detection' = 'detection', manual = false) {
  const project = randomUUID(), scan = randomUUID(), imported = randomUUID();
  const schema = randomUUID(), label = randomUUID(), workspace = randomUUID(), item = randomUUID();
  const target = task === 'classification' ? 'classification' : randomUUID();
  // Raw scan class key is deliberately NOT the actual class UUID.
  const raw = '{\r\n "classKey": "scan-class-17", "n": 1.00\r\n}\n';
  db.prepare(`INSERT INTO projects(id,name,task_type,workspace_path,created_at,updated_at)
    VALUES (?,'history',?,'C:\\fixture',?,?)`).run(project, task, now, now);
  db.prepare('INSERT INTO project_import_rights VALUES (?,?)').run(project, now);
  db.prepare(`INSERT INTO jobs(id,project_id,kind,status,created_at,updated_at)
    VALUES (?,?,'scan-dataset','Succeeded',?,?)`).run(scan, project, now, now);
  db.prepare(`INSERT INTO data_imports(id,project_id,scan_job_id,task_type,mode,created_at,updated_at,
    scan_result_json,scan_result_sha256,source_manifest_json,source_manifest_sha256)
    VALUES (?,?,?,?,'reference',?,?,?,?,?,?)`).run(imported, project, scan, task, now, now, raw, hash(raw), raw, hash(raw));
  db.prepare(`INSERT INTO import_sources(import_id,image_key,ordinal,mode,source_path,identity_dev,
    identity_ino,identity_birthtime_ns,byte_size,mtime_ns,sha256,entry_sha256)
    VALUES (?,'image',0,'reference','C:\\source\\image.png','1','2','3',10,'4',?,?)`)
    .run(imported, hash('image'), hash('entry'));
  db.prepare('INSERT INTO label_schemas(id,project_id,created_at,updated_at) VALUES (?,?,?,?)')
    .run(schema, project, now, now);
  db.prepare(`INSERT INTO label_classes(id,schema_id,display_name,normalized_name,color,ordinal,created_at,updated_at)
    VALUES (?,?,'class','class','#abcdef',0,?,?)`).run(label, schema, now, now);
  db.prepare(`INSERT INTO annotation_workspaces(id,project_id,schema_id,task_type,mode,created_at,updated_at)
    VALUES (?,?,?,?,'reference',?,?)`).run(workspace, project, schema, task, now, now);
  const fields = task === 'classification' ? { classId: label } : { classId: label, x: 1, y: 2, width: 10, height: 20 };
  const annotation = JSON.stringify(task === 'classification' ? { kind: task, ...fields }
    : { kind: task, rectangles: [{ id: target, ...fields }] });
  db.prepare(`INSERT INTO annotation_items(id,workspace_id,import_id,image_key,image_sha256,width,height,
    annotation_json,annotation_sha256,updated_at) VALUES (?,?,?,'image',?,100,80,?,?,?)`)
    .run(item, workspace, imported, hash('image'), annotation, hash(annotation), now);
  db.prepare(`INSERT INTO annotation_provenance(item_id,target_key,kind,source_import_id,source_image_key,
    source_annotation_key,original_json,changes_json) VALUES (?,?,?,?,?,?,?,'{}')`)
    .run(item, target, manual ? 'manual' : 'import-unmodified', manual ? null : imported,
      manual ? null : 'image', manual ? null : 'R', manual ? '{}' : '{"classKey":"scan-class-17","source":"R"}');
  return { project, imported, schema, label, workspace, item, target, fields, annotation, task };
}
type Fixture = ReturnType<typeof fixture>;
function active(f: Fixture): Row {
  return db.prepare('SELECT * FROM annotation_provenance WHERE item_id=? AND target_key=?').get(f.item, f.target) as Row;
}
function candidate(f: Fixture): Row {
  const record = { ...active(f), target_fields_json: JSON.stringify(f.fields) };
  return { ...record, record_sha256: hash(JSON.stringify(record)) };
}
function insert(row: Row, verb = 'INSERT'): void {
  db.prepare(`${verb} INTO annotation_target_history (${Object.keys(row).join(',')})
    VALUES (${Object.keys(row).map(() => '?').join(',')})`).run(...Object.values(row));
}
function update(f: Fixture, patch: Row): void {
  db.prepare(`UPDATE annotation_target_history SET ${Object.keys(patch).map((key) => `${key}=?`).join(',')}
    WHERE item_id=? AND target_key=?`).run(...Object.values(patch), f.item, f.target);
}
function saved(f: Fixture): Row {
  return db.prepare('SELECT * FROM annotation_target_history WHERE item_id=? AND target_key=?').get(f.item, f.target) as Row;
}
function confirm(f: Fixture): void {
  db.prepare(`UPDATE annotation_items SET state='confirmed',confirmed_at=?,edit_version=edit_version+1 WHERE id=?`)
    .run(now, f.item);
}
function removeActive(f: Fixture): void {
  const text = JSON.stringify(f.task === 'classification' ? { kind: f.task, classId: null } : { kind: f.task, rectangles: [] });
  db.prepare(`UPDATE annotation_items SET annotation_json=?,annotation_sha256=?,state='editing',confirmed_at=NULL,
    negative_confirmed=0,edit_version=edit_version+1 WHERE id=?`).run(text, hash(text), f.item);
  db.prepare('DELETE FROM annotation_provenance WHERE item_id=? AND target_key=?').run(f.item, f.target);
}
function restore(f: Fixture, row: Row): void {
  db.prepare(`UPDATE annotation_items SET annotation_json=?,annotation_sha256=?,edit_version=edit_version+1 WHERE id=?`)
    .run(f.annotation, hash(f.annotation), f.item);
  const { target_fields_json: _fields, record_sha256: _hash, ...origin } = row;
  db.prepare(`INSERT INTO annotation_provenance (${Object.keys(origin).join(',')})
    VALUES (${Object.keys(origin).map(() => '?').join(',')})`).run(...Object.values(origin));
}
function oldRows(): unknown[] {
  return ['projects', 'jobs', 'data_imports', 'import_sources', 'import_generations', 'project_import_rights',
    'label_schemas', 'label_classes', 'annotation_workspaces', 'annotation_items', 'annotation_provenance',
    'dataset_revisions', 'dataset_items', 'workspace_revision_sources', 'annotation_schema_snapshots',
    'annotation_provenance_snapshots', 'annotation_source_snapshots'].map((table) => db.prepare(`SELECT * FROM ${table}`).all());
}
function freeze(f: Fixture): void {
  confirm(f);
  const revision = randomUUID();
  db.exec('BEGIN');
  db.prepare(`INSERT INTO dataset_items(id,revision_id,source_item_id,import_id,image_key,image_sha256,width,height,
    source_snapshot_json,annotation_json,annotation_sha256,provenance_json,disposition,split)
    SELECT ?,?,a.id,a.import_id,a.image_key,a.image_sha256,a.width,a.height,s.snapshot_json,a.annotation_json,
      a.annotation_sha256,p.snapshot_json,'labeled','train'
    FROM annotation_items a JOIN annotation_source_snapshots s ON s.import_id=a.import_id AND s.image_key=a.image_key
    JOIN annotation_provenance_snapshots p ON p.item_id=a.id WHERE a.id=?`).run(randomUUID(), revision, f.item);
  const manifest = JSON.stringify({ revisionId: revision, workspaceId: f.workspace, itemCount: 1 });
  db.prepare(`INSERT INTO dataset_revisions(id,project_id,workspace_id,revision_no,mode,manifest_json,manifest_sha256,
    manifest_relative_path,schema_snapshot_json,split_seed,created_by,confirmed_at)
    SELECT ?,?,?,1,'reference',?,?,?,snapshot_json,42,'local-user',? FROM annotation_schema_snapshots WHERE schema_id=?`)
    .run(revision, f.project, f.workspace, manifest, hash(manifest), `datasets/${revision}/manifest.json`, now, f.schema);
  db.exec('COMMIT');
}

describe('ANN-08 latest target provenance tombstone schema', () => {
  it('migrates actual 001..007 fresh, STRICT WITHOUT ROWID, no seeds, and reopens', () => {
    expect(migrateDatabase(db, migrations)).toBe(7);
    expect(db.prepare('SELECT * FROM annotation_target_history').all()).toEqual([]);
    expect(db.prepare("SELECT strict,wr FROM pragma_table_list WHERE name='annotation_target_history'").get())
      .toEqual({ strict: 1, wr: 1 });
    const keys = db.prepare("PRAGMA foreign_key_list('annotation_target_history')").all() as { table: string; on_delete: string }[];
    expect(keys.map((key) => key.table).sort()).toEqual(['annotation_items', 'import_sources', 'import_sources']);
    expect(keys.every((key) => key.on_delete === 'NO ACTION')).toBe(true);
    db.close(); db = openDatabase(join(directory, 'metadata.sqlite3'));
    expect(migrateDatabase(db, migrations)).toBe(7);
    expect(db.prepare('SELECT * FROM annotation_target_history').all()).toEqual([]);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it('upgrades populated 006 without backfill or changes to old DDL, rights, ledger and snapshot bytes', () => {
    migrateDatabase(db, migrations.slice(0, 6));
    const f = fixture(); freeze(f);
    const before = oldRows();
    const ddl = db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY name').all() as Row[];
    migrateDatabase(db, migrations);
    expect(oldRows()).toEqual(before);
    for (const row of ddl) expect(db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name=?').get(row.name)).toEqual(row);
    expect(db.prepare('SELECT * FROM annotation_target_history').all()).toEqual([]);
  });

  it.each([0, 6])('rolls failed 007 back atomically from %i and retries after reopen', (version) => {
    migrateDatabase(db, migrations.slice(0, version));
    if (version === 6) fixture();
    const before = version === 6 ? oldRows() : [];
    const ddl = db.prepare('SELECT * FROM sqlite_master ORDER BY name').all();
    const failing = migrations.map((m) => m.version === 7 ? { ...m, sql: `${m.sql}\nSELECT * FROM absent_ann08;` } : m);
    expect(() => migrateDatabase(db, failing)).toThrow(/absent_ann08/);
    expect(db.pragma('user_version', { simple: true })).toBe(version);
    expect(db.prepare('SELECT * FROM sqlite_master ORDER BY name').all()).toEqual(ddl);
    if (version === 6) expect(oldRows()).toEqual(before);
    db.close(); db = openDatabase(join(directory, 'metadata.sqlite3'));
    expect(migrateDatabase(db, migrations)).toBe(7);
    if (version === 6) expect(oldRows()).toEqual(before);
    expect(db.prepare('SELECT * FROM annotation_target_history').all()).toEqual([]);
  });

  it.each(['classification', 'detection'] as const)('archives confirmed %s source R before removal without changing human state', (task) => {
    migrateDatabase(db, migrations);
    const f = fixture(task); confirm(f);
    const before = oldRows(), row = candidate(f);
    db.exec('BEGIN'); insert(row);
    expect(oldRows()).toEqual(before);
    removeActive(f);
    expect(saved(f)).toEqual(row);
    expect(db.prepare('SELECT * FROM annotation_provenance WHERE item_id=?').all(f.item)).toEqual([]);
    restore(f, row);
    expect(active(f).source_annotation_key).toBe('R');
    expect(active(f).kind).toBe('import-unmodified');
    expect(db.prepare('SELECT state,confirmed_at FROM annotation_items WHERE id=?').get(f.item))
      .toEqual({ state: 'editing', confirmed_at: null });
    update(f, { record_sha256: hash('next archive') });
    db.exec('COMMIT');
    expect(db.prepare('SELECT count(*) AS n FROM annotation_target_history').get()).toEqual({ n: 1 });
    db.close(); db = openDatabase(join(directory, 'metadata.sqlite3'));
    expect(saved(f).source_annotation_key).toBe('R');
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it('keeps actual old class UUID after class deletion without inventing a class or using scan keys', () => {
    migrateDatabase(db, migrations);
    const f = fixture(); const row = candidate(f); insert(row); removeActive(f);
    db.prepare('DELETE FROM label_classes WHERE id=?').run(f.label);
    expect(JSON.parse(saved(f).target_fields_json as string)).toEqual(f.fields);
    restore(f, row); update(f, { record_sha256: hash('restored old UUID') });
    expect(db.prepare('SELECT * FROM label_classes').all()).toEqual([]);
    expect(JSON.parse(saved(f).target_fields_json as string).classId).toBe(f.label);
    expect(() => confirm(f)).toThrow(); // history is not permission to confirm an absent class
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it('accepts active manual provenance but cannot forge imported history from it', () => {
    migrateDatabase(db, migrations);
    const f = fixture('classification', true), row = candidate(f);
    expect(() => insert({ ...row, kind: 'import-unmodified', source_import_id: f.imported,
      source_image_key: 'image', source_annotation_key: 'R' })).toThrow();
    insert(row); expect(saved(f)).toEqual(row);
  });

  it.each(['kind', 'source_import_id', 'source_image_key', 'source_annotation_key', 'original_json', 'changes_json',
    'target_key', 'item_id', 'source_suggestion_id'])('rejects insert tampering with %s', (field) => {
    migrateDatabase(db, migrations);
    const f = fixture(), row = candidate(f);
    const value = field === 'kind' ? 'import-edited' : field.endsWith('_json') ? '{"tampered":true}' : randomUUID();
    expect(() => insert({ ...row, [field]: value })).toThrow();
    expect(db.prepare('SELECT * FROM annotation_target_history').all()).toEqual([]);
  });

  it('compares provenance JSON text exactly rather than semantic JSON equivalence', () => {
    migrateDatabase(db, migrations);
    const f = fixture(), row = candidate(f);
    expect(() => insert({ ...row, changes_json: '{ }' })).toThrow();
    expect(() => insert({ ...row, original_json: '{"source":"R","classKey":"scan-class-17"}' })).toThrow();
    insert(row);
    expect(() => update(f, { changes_json: '{ }' })).toThrow();
    expect(saved(f)).toEqual(row);
  });

  it('rejects another existing import source rather than relying on FK existence', () => {
    migrateDatabase(db, migrations);
    const f = fixture(), other = fixture();
    expect(() => insert({ ...candidate(f), source_import_id: other.imported })).toThrow();
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it.each(['classification', 'detection'] as const)('rejects missing, extra, duplicated and mismatched %s target fields', (task) => {
    migrateDatabase(db, migrations);
    const f = fixture(task), row = candidate(f);
    const invalid = ['{}', '[]', 'null', '{"classId":null}', JSON.stringify({ ...f.fields, id: f.target }),
      JSON.stringify({ ...f.fields, classId: 'scan-class-17' }), JSON.stringify({ ...f.fields, extra: 1 }),
      `${JSON.stringify(f.fields).slice(0, -1)},"classId":"${f.label}"}`];
    if (task === 'detection') invalid.push(JSON.stringify({ ...f.fields, x: 99 }), JSON.stringify({ ...f.fields, x: '1' }),
      JSON.stringify({ classId: f.label, x: 1, y: 2, width: 10, extra: 20 }));
    for (const target_fields_json of invalid) expect(() => insert({ ...row, target_fields_json })).toThrow();
    insert(row);
  });

  it('rejects absent or duplicate rectangle identity even if active provenance remains', () => {
    migrateDatabase(db, migrations);
    const f = fixture(), row = candidate(f);
    for (const rectangles of [[], [{ id: f.target, ...f.fields }, { id: f.target, ...f.fields }]]) {
      const text = JSON.stringify({ kind: 'detection', rectangles });
      db.prepare('UPDATE annotation_items SET annotation_json=?,edit_version=edit_version+1 WHERE id=?').run(text, f.item);
      expect(() => insert(row)).toThrow();
    }
  });

  it('updates latest active fields/deltas and promotes import-unmodified only forward', () => {
    migrateDatabase(db, migrations);
    const f = fixture(), row = candidate(f); insert(row);
    const fields = { ...f.fields, x: 3 }, changes = '{"x":{"from":1,"to":3}}';
    const annotation = JSON.stringify({ kind: 'detection', rectangles: [{ id: f.target, ...fields }] });
    db.prepare('UPDATE annotation_items SET annotation_json=?,annotation_sha256=?,edit_version=edit_version+1 WHERE id=?')
      .run(annotation, hash(annotation), f.item);
    db.prepare("UPDATE annotation_provenance SET kind='import-edited',changes_json=? WHERE item_id=?").run(changes, f.item);
    expect(() => update(f, { kind: 'import-edited' })).toThrow();
    update(f, { kind: 'import-edited', changes_json: changes, target_fields_json: JSON.stringify(fields), record_sha256: hash('latest') });
    expect(saved(f).original_json).toBe(row.original_json);
    expect(db.prepare('SELECT count(*) AS n FROM annotation_target_history').get()).toEqual({ n: 1 });
    db.prepare("UPDATE annotation_provenance SET kind='import-unmodified' WHERE item_id=?").run(f.item);
    expect(() => update(f, { kind: 'import-unmodified' })).toThrow(/origin immutable/);
  });

  it('rejects history identity changes even after active provenance has been forged to match', () => {
    migrateDatabase(db, migrations);
    const f = fixture(), row = candidate(f); insert(row);
    db.prepare("UPDATE annotation_provenance SET original_json='{}',source_annotation_key='other' WHERE item_id=?").run(f.item);
    expect(() => update(f, { original_json: '{}', source_annotation_key: 'other' })).toThrow(/origin immutable/);
    db.prepare(`UPDATE annotation_provenance SET kind='manual',source_import_id=NULL,source_image_key=NULL,
      source_annotation_key=NULL WHERE item_id=?`).run(f.item);
    expect(() => update(f, { kind: 'manual', source_import_id: null, source_image_key: null,
      source_annotation_key: null, original_json: '{}' })).toThrow(/origin immutable/);
    expect(saved(f)).toEqual(row);
  });

  it('requires current active provenance for every update, including hash-only/no-op updates', () => {
    migrateDatabase(db, migrations);
    const f = fixture(), row = candidate(f); insert(row); removeActive(f);
    expect(() => update(f, { record_sha256: row.record_sha256! })).toThrow(/active preimage/);
    expect(() => update(f, { changes_json: '{}' })).toThrow(/active preimage/);
    expect(saved(f)).toEqual(row);
    expect(() => insert({ ...row, target_key: randomUUID() })).toThrow();
  });

  it.each([0, 1])('rejects REPLACE and DELETE with recursive_triggers=%i before implicit deletion', (recursive) => {
    migrateDatabase(db, migrations);
    const f = fixture(), row = candidate(f); insert(row);
    db.pragma(`recursive_triggers=${recursive}`);
    expect(() => insert(row, 'INSERT OR REPLACE')).toThrow(/replacement forbidden/);
    expect(() => db.exec('REPLACE INTO annotation_target_history SELECT * FROM annotation_target_history')).toThrow(/replacement forbidden/);
    expect(() => update(f, { target_key: randomUUID() })).toThrow(/origin immutable/);
    expect(() => update(f, { item_id: randomUUID() })).toThrow(/origin immutable/);
    expect(() => db.exec('DELETE FROM annotation_target_history')).toThrow(/deletion forbidden/);
    expect(saved(f)).toEqual(row);
  });

  it('rejects deferred item deletion/reinsertion when only history remains', () => {
    migrateDatabase(db, migrations);
    const f = fixture(); insert(candidate(f)); removeActive(f);
    const row = db.prepare('SELECT * FROM annotation_items WHERE id=?').get(f.item) as Row;
    db.exec('PRAGMA recursive_triggers=OFF; BEGIN; PRAGMA defer_foreign_keys=ON;');
    expect(db.pragma('defer_foreign_keys', { simple: true })).toBe(1);
    expect(() => {
      db.prepare('DELETE FROM annotation_items WHERE id=?').run(f.item);
      db.prepare(`INSERT INTO annotation_items (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(() => '?').join(',')})`)
        .run(...Object.values(row));
    }).toThrow(/referenced by target history/);
    expect(db.prepare('SELECT * FROM annotation_items WHERE id=?').get(f.item)).toEqual(row);
    expect(() => db.exec('INSERT OR REPLACE INTO annotation_items SELECT * FROM annotation_items')).toThrow();
    db.exec('ROLLBACK');
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it.each([false, true])('rejects frozen workspace archives (existing history: %s)', (existing) => {
    migrateDatabase(db, migrations);
    const f = fixture(), row = candidate(f);
    if (existing) insert(row);
    freeze(f);
    const before = oldRows();
    expect(() => existing ? update(f, { record_sha256: hash('frozen') }) : insert(row)).toThrow(/active preimage/);
    expect(oldRows()).toEqual(before);
  });

  it.each(['original_json', 'changes_json', 'target_fields_json'])('rejects malformed, nonobject and oversized %s', (field) => {
    migrateDatabase(db, migrations);
    const f = fixture(), row = candidate(f);
    for (const value of ['{', '[]', 'null', JSON.stringify({ data: 'x'.repeat(1048576) })]) {
      expect(() => insert({ ...row, [field]: value })).toThrow();
    }
    expect(db.prepare('SELECT * FROM annotation_target_history').all()).toEqual([]);
  });

  it('validates hash shape but deliberately leaves cryptographic verification to Main', () => {
    migrateDatabase(db, migrations);
    const f = fixture(), row = candidate(f);
    for (const value of ['', 'a'.repeat(63), 'a'.repeat(65), 'g'.repeat(64), `${'a'.repeat(63)}\n`]) {
      expect(() => insert({ ...row, record_sha256: value })).toThrow();
    }
    insert({ ...row, record_sha256: '0'.repeat(64) });
    expect(saved(f).record_sha256).toBe('0'.repeat(64));
  });

  it('rolls archive and service removal back together after a later failure', () => {
    migrateDatabase(db, migrations);
    const f = fixture(); confirm(f); const before = oldRows();
    db.exec('BEGIN'); insert(candidate(f)); removeActive(f);
    expect(() => db.exec('SELECT * FROM absent_after_archive')).toThrow();
    db.exec('ROLLBACK');
    expect(oldRows()).toEqual(before);
    expect(db.prepare('SELECT * FROM annotation_target_history').all()).toEqual([]);
  });
});