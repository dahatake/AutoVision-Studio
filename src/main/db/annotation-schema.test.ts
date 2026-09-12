// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openDatabase, type DatabaseConnection } from './database.js';
import { migrateDatabase, type Migration } from './migrate.js';

const history: readonly Migration[] = [
  '001_core.sql', '002_jobs.sql', '003_import.sql', '004_import_generation.sql',
  '005_import_rights.sql', '006_annotations.sql',
].map((file, index) => ({ version: index + 1, sql: readFileSync(new URL(`./migrations/${file}`, import.meta.url), 'utf8') }));
const now = '2026-09-12T01:02:03.004Z';
const later = '2026-09-12T02:02:03.004Z';
const hash = (text: string): string => createHash('sha256').update(text).digest('hex');
const tables = ['label_schemas', 'label_classes', 'annotation_workspaces', 'annotation_items',
  'annotation_provenance', 'dataset_revisions', 'dataset_items', 'workspace_revision_sources'];
let directory: string;
let db: DatabaseConnection;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'autovision-ann-schema-'));
  db = openDatabase(join(directory, 'metadata.sqlite3'));
});
afterEach(() => {
  if (db.inTransaction) db.exec('ROLLBACK');
  if (db.open) db.close();
  rmSync(directory, { recursive: true, force: true });
});

function legacy(task = 'classification', mode = 'reference') {
  const project = randomUUID();
  const scan = randomUUID();
  const imported = randomUUID();
  const raw = '{\r\n "label": "画像", "n": 1.00\r\n}\n';
  db.prepare(`INSERT INTO projects(id,name,task_type,workspace_path,created_at,updated_at)
    VALUES (?,'画像',?,'C:\\fixture',?,?)`).run(project, task, now, now);
  db.prepare('INSERT INTO project_import_rights VALUES (?,?)').run(project, now);
  db.prepare(`INSERT INTO jobs(id,project_id,kind,status,created_at,updated_at)
    VALUES (?,?,'scan-dataset','Succeeded',?,?)`).run(scan, project, now, now);
  db.prepare(`INSERT INTO data_imports(id,project_id,scan_job_id,task_type,mode,created_at,updated_at,
    scan_result_json,scan_result_sha256,source_manifest_json,source_manifest_sha256)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(imported, project, scan, task, mode, now, now, raw, hash(raw), raw, hash(raw));
  if (mode === 'reference') {
    db.prepare(`INSERT INTO import_sources(import_id,image_key,ordinal,mode,source_path,identity_dev,
      identity_ino,identity_birthtime_ns,byte_size,mtime_ns,sha256,entry_sha256)
      VALUES (?,'image',0,'reference','C:\\source\\image.png','1','2','3',10,'4',?,?)`)
      .run(imported, hash('image'), hash('entry'));
  } else {
    db.prepare(`INSERT INTO import_sources(import_id,image_key,ordinal,mode,relative_path,relative_path_key,
      byte_size,sha256,entry_sha256) VALUES (?,'image',0,'copy','source/image.png','source/image.png',10,?,?)`)
      .run(imported, hash('image'), hash('entry'));
  }
  return { project, imported, task, mode };
}
function workspace(task = 'classification', mode = 'reference') {
  const source = legacy(task, mode);
  const schema = randomUUID();
  const label = randomUUID();
  const work = randomUUID();
  db.prepare('INSERT INTO label_schemas(id,project_id,instructions,created_at,updated_at) VALUES (?,?,?,?,?)')
    .run(schema, source.project, '画像端も確認', now, now);
  db.prepare(`INSERT INTO label_classes(id,schema_id,display_name,normalized_name,color,ordinal,created_at,updated_at)
    VALUES (?,?,'対象','対象','#abcdef',0,?,?)`).run(label, schema, now, now);
  db.prepare(`INSERT INTO annotation_workspaces(id,project_id,schema_id,task_type,mode,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?)`).run(work, source.project, schema, task, mode, now, now);
  return { ...source, schema, label, work };
}
type Workspace = ReturnType<typeof workspace>;
function item(w: Workspace, annotation: unknown = { kind: w.task, classId: w.label },
  imageKey = 'image', imageHash = hash(imageKey)): string {
  const id = randomUUID();
  const text = JSON.stringify(annotation);
  db.prepare(`INSERT INTO annotation_items(id,workspace_id,import_id,image_key,image_sha256,width,height,
    annotation_json,annotation_sha256,updated_at) VALUES (?,?,?,?,?,100,80,?,?,?)`)
    .run(id, w.work, w.imported, imageKey, imageHash, text, hash(text), now);
  return id;
}
function provenance(id: string, target = 'classification'): void {
  db.prepare("INSERT INTO annotation_provenance(item_id,target_key,kind) VALUES (?,?,'manual')").run(id, target);
}
function confirm(id: string, negative = 0): void {
  db.prepare(`UPDATE annotation_items SET state='confirmed',confirmed_at=?,negative_confirmed=?,
    edit_version=edit_version+1,updated_at=? WHERE id=?`).run(now, negative, now, id);
}
function children(w: Workspace, revision: string, splits: Readonly<Record<string, string>> = {}): void {
  const insert = db.prepare(`INSERT INTO dataset_items(id,revision_id,source_item_id,import_id,image_key,image_sha256,
    width,height,source_snapshot_json,annotation_json,annotation_sha256,provenance_json,disposition,exclusion_reason,split)
    SELECT ?,?,a.id,a.import_id,a.image_key,a.image_sha256,a.width,a.height,s.snapshot_json,
      a.annotation_json,a.annotation_sha256,p.snapshot_json,
      CASE WHEN a.state='excluded' THEN 'excluded' WHEN a.negative_confirmed=1 THEN 'negative' ELSE 'labeled' END,
      a.exclusion_reason,CASE WHEN a.state='excluded' THEN NULL ELSE ? END
    FROM annotation_items a JOIN annotation_source_snapshots s ON s.import_id=a.import_id AND s.image_key=a.image_key
    JOIN annotation_provenance_snapshots p ON p.item_id=a.id WHERE a.id=?`);
  const items = db.prepare('SELECT id FROM annotation_items WHERE workspace_id=?').all(w.work) as { id: string }[];
  for (const source of items) insert.run(randomUUID(), revision, splits[source.id] ?? 'train', source.id);
}
function header(w: Workspace, revision: string, revisionNo = 1): void {
  const { count } = db.prepare('SELECT count(*) AS count FROM dataset_items WHERE revision_id=?')
    .get(revision) as { count: number };
  const manifest = JSON.stringify({ revisionId: revision, workspaceId: w.work, itemCount: count });
  db.prepare(`INSERT INTO dataset_revisions(id,project_id,workspace_id,revision_no,mode,manifest_json,
    manifest_sha256,manifest_relative_path,schema_snapshot_json,split_seed,created_by,confirmed_at)
    SELECT ?,?,?,?,?,?,?,?,snapshot_json,42,'local-user',? FROM annotation_schema_snapshots WHERE schema_id=?`)
    .run(revision, w.project, w.work, revisionNo, w.mode, manifest, hash(manifest), `datasets/${revision}/manifest.json`, now, w.schema);
}
function publish(w: Workspace): string {
  const revision = randomUUID();
  db.exec('BEGIN IMMEDIATE');
  children(w, revision);
  header(w, revision);
  db.exec('COMMIT');
  return revision;
}
function oldRows(): unknown[] {
  return ['projects', 'jobs', 'data_imports', 'import_sources', 'import_generations', 'project_import_rights']
    .map((table) => db.prepare(`SELECT * FROM ${table}`).all());
}

function allRows(): unknown[] {
  return [...oldRows(), ...tables.map((table) => db.prepare(`SELECT * FROM ${table}`).all())];
}
function rejectDeferred(action: () => void, message: RegExp): void {
  const before = allRows();
  db.exec('PRAGMA recursive_triggers=OFF; BEGIN; PRAGMA defer_foreign_keys=ON;');
  expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  expect(db.pragma('recursive_triggers', { simple: true })).toBe(0);
  expect(db.pragma('defer_foreign_keys', { simple: true })).toBe(1);
  expect(action).toThrow(message);
  expect(allRows()).toEqual(before);
  db.exec('ROLLBACK');
  expect(allRows()).toEqual(before);
  expect(db.pragma('foreign_key_check')).toEqual([]);
}

describe('ANN-01 relational manual annotation schema', () => {
  function sourcePair(binding: 'import' | 'image') {
    const w = workspace();
    const imported = binding === 'import' ? randomUUID() : w.imported;
    const imageKey = binding === 'image' ? 'second' : 'image';
    if (binding === 'import') {
      const scan = randomUUID();
      db.prepare(`INSERT INTO jobs(id,project_id,kind,status,created_at,updated_at)
        VALUES (?,?,'scan-dataset','Succeeded',?,?)`).run(scan, w.project, now, now);
      db.prepare(`INSERT INTO data_imports(id,project_id,scan_job_id,task_type,mode,created_at,updated_at,
        scan_result_json,scan_result_sha256,source_manifest_json,source_manifest_sha256)
        SELECT ?,project_id,?,task_type,mode,created_at,updated_at,
          scan_result_json,scan_result_sha256,source_manifest_json,source_manifest_sha256
        FROM data_imports WHERE id=?`).run(imported, scan, w.imported);
    }
    db.prepare(`INSERT INTO import_sources(import_id,image_key,ordinal,mode,source_path,identity_dev,
      identity_ino,identity_birthtime_ns,byte_size,mtime_ns,sha256,entry_sha256)
      VALUES (?,?,1,'reference','C:\\source\\second.png','1','5','3',10,'4',?,?)`)
      .run(imported, imageKey, hash('second'), hash('second entry'));
    const id = item(w);
    db.prepare(`INSERT INTO annotation_provenance(item_id,target_key,kind,source_import_id,
      source_image_key,source_annotation_key)
      VALUES (?,'classification','import-unmodified',?,'image','raw-label')`).run(id, w.imported);
    confirm(id);
    // Build B through the real insertion guards, then remove its unreferenced row.
    const other = item({ ...w, imported }, undefined, imageKey, hash('second'));
    const replacement = db.prepare('SELECT * FROM annotation_items WHERE id=?').get(other) as Record<string, string | number | null>;
    db.prepare('DELETE FROM annotation_items WHERE id=?').run(other);
    replacement.id = id;
    const insertReplacement = () => db.prepare(`INSERT INTO annotation_items
      (${Object.keys(replacement).join(',')}) VALUES (${Object.keys(replacement).map(() => '?').join(',')})`)
      .run(...Object.values(replacement));
    expect(db.prepare('SELECT count(*) AS count FROM import_sources').get()).toEqual({ count: 2 });
    return { w, id, insertReplacement };
  }

  it.each(['import', 'image'] as const)('blocks deferred confirmed item rebinding through another %s', (binding) => {
    migrateDatabase(db, history);
    const { w, id, insertReplacement } = sourcePair(binding);
    expect(db.prepare('SELECT state FROM annotation_workspaces WHERE id=?').get(w.work)).toEqual({ state: 'editing' });
    rejectDeferred(() => {
      db.prepare('DELETE FROM annotation_items WHERE id=?').run(id);
      insertReplacement();
      confirm(id);
    }, /referenced annotation item cannot be deleted/);
    expect(db.prepare('SELECT state,confirmed_at FROM annotation_items WHERE id=?').get(id))
      .toEqual({ state: 'confirmed', confirmed_at: now });
  });

  it.each(['import', 'image'] as const)('fails closed on pre-existing corrupt provenance %s binding without repair', (binding) => {
    migrateDatabase(db, history);
    const { id, insertReplacement } = sourcePair(binding);
    const trigger = db.prepare("SELECT sql FROM sqlite_master WHERE name='annotation_items_delete'").get() as { sql: string };
    // Simulate data left by the old deletion gap, retaining real FKs and provenance.
    db.exec('PRAGMA recursive_triggers=OFF; BEGIN; PRAGMA defer_foreign_keys=ON;');
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    db.exec('DROP TRIGGER annotation_items_delete');
    db.prepare('DELETE FROM annotation_items WHERE id=?').run(id);
    insertReplacement();
    db.exec(trigger.sql);
    db.exec('COMMIT');
    rejectDeferred(() => confirm(id), /import provenance source binding mismatch/);
    expect(db.prepare('SELECT state,confirmed_at FROM annotation_items WHERE id=?').get(id))
      .toEqual({ state: 'unstarted', confirmed_at: null });
  });

  it('permits editing item deletion only after clearing confirmation and provenance', () => {
    migrateDatabase(db, history);
    const { w, id } = sourcePair('image');
    db.prepare("UPDATE annotation_items SET state='editing',confirmed_at=NULL,edit_version=edit_version+1 WHERE id=?").run(id);
    rejectDeferred(() => { db.prepare('DELETE FROM annotation_items WHERE id=?').run(id); }, /referenced annotation item/);
    db.exec('PRAGMA recursive_triggers=OFF; BEGIN; PRAGMA defer_foreign_keys=ON;');
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    db.prepare('DELETE FROM annotation_provenance WHERE item_id=?').run(id);
    db.prepare('DELETE FROM annotation_items WHERE id=?').run(id);
    db.exec('COMMIT');
    expect(db.prepare('SELECT * FROM annotation_items').all()).toEqual([]);
    expect(db.prepare('SELECT * FROM annotation_provenance').all()).toEqual([]);
    expect(db.prepare('SELECT state FROM annotation_workspaces WHERE id=?').get(w.work)).toEqual({ state: 'editing' });
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it('blocks item deletion referenced only by a staged child before its revision header', () => {
    migrateDatabase(db, history);
    const w = workspace();
    const id = item(w);
    const before = allRows();
    db.exec('PRAGMA recursive_triggers=OFF; BEGIN; PRAGMA defer_foreign_keys=ON;');
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('recursive_triggers', { simple: true })).toBe(0);
    expect(db.pragma('defer_foreign_keys', { simple: true })).toBe(1);
    children(w, randomUUID());
    expect(db.prepare('SELECT * FROM dataset_revisions').all()).toEqual([]);
    expect(db.prepare('SELECT * FROM annotation_provenance').all()).toEqual([]);
    expect(db.prepare('SELECT source_item_id FROM dataset_items').all()).toEqual([{ source_item_id: id }]);
    expect(db.prepare('SELECT state FROM annotation_workspaces WHERE id=?').get(w.work)).toEqual({ state: 'editing' });
    const staged = allRows();
    expect(() => db.prepare('DELETE FROM annotation_items WHERE id=?').run(id)).toThrow(/referenced annotation item cannot be deleted/);
    expect(allRows()).toEqual(staged);
    db.exec('ROLLBACK');
    expect(allRows()).toEqual(before);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it.each(['id', 'rowid', '_rowid_', 'oid'])('rejects Project UPDATE OR REPLACE through %s from an unreferenced row', (key) => {
    migrateDatabase(db, history);
    const w = workspace();
    item(w);
    const other = randomUUID();
    db.prepare(`INSERT INTO projects(id,name,task_type,workspace_path,created_at,updated_at)
      VALUES (?,'other','detection','C:\\other',?,?)`).run(other, now, now);
    const target = db.prepare('SELECT rowid FROM projects WHERE id=?').get(w.project) as { rowid: number };
    rejectDeferred(() => {
      db.prepare(`UPDATE OR REPLACE projects SET ${key}=? WHERE id=?`).run(key === 'id' ? w.project : target.rowid, other);
    }, /Project identity immutable/);
  });

  it('protects even unreferenced Project identities while permitting no-op keys and name edits', () => {
    migrateDatabase(db, history);
    const id = randomUUID();
    db.prepare(`INSERT INTO projects(id,name,task_type,workspace_path,created_at,updated_at)
      VALUES (?,'unused','classification','C:\\unused',?,?)`).run(id, now, now);
    for (const key of ['id', 'rowid', '_rowid_', 'oid']) {
      rejectDeferred(() => { db.prepare(`UPDATE projects SET ${key}=? WHERE id=?`)
        .run(key === 'id' ? randomUUID() : 9999, id); }, /Project identity immutable/);
    }
    db.prepare("UPDATE projects SET id=id,rowid=rowid,name='renamed' WHERE id=?").run(id);
    expect(db.prepare('SELECT name FROM projects WHERE id=?').get(id)).toEqual({ name: 'renamed' });
  });

  it.each(['projects', 'data_imports', 'import_sources', 'label_schemas', 'annotation_workspaces', 'label_classes'])
    ('rejects deferred DELETE/reinsert rebinding of referenced %s without changing any rows', (table) => {
      migrateDatabase(db, history);
      const w = workspace();
      item(w);
      const other = workspace();
      const scan = randomUUID();
      db.prepare(`INSERT INTO jobs(id,project_id,kind,status,created_at,updated_at)
        VALUES (?,?,'scan-dataset','Succeeded',?,?)`).run(scan, other.project, now, now);
      expect(db.prepare('SELECT locked_at FROM label_schemas WHERE id=?').get(w.schema)).toEqual({ locked_at: null });
      const key = table === 'import_sources' ? 'import_id' : 'id';
      const ids: Record<string, string> = { projects: w.project, data_imports: w.imported,
        import_sources: w.imported, label_schemas: w.schema, annotation_workspaces: w.work, label_classes: w.label };
      const row = db.prepare(`SELECT * FROM ${table} WHERE ${key}=?`).get(ids[table]) as Record<string, string | number | null>;
      if (table === 'projects') row.task_type = 'detection';
      if (table === 'data_imports') { row.project_id = other.project; row.scan_job_id = scan; }
      if (table === 'import_sources') { row.sha256 = hash('different'); row.source_path = 'C:\\different.png'; }
      if (table === 'label_schemas') {
        const unused = legacy();
        row.project_id = unused.project;
      }
      if (table === 'annotation_workspaces') { row.project_id = other.project; row.schema_id = other.schema; }
      if (table === 'label_classes') row.schema_id = other.schema;
      rejectDeferred(() => {
        db.prepare(`DELETE FROM ${table} WHERE ${key}=?`).run(ids[table]);
        db.prepare(`INSERT INTO ${table} (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(() => '?').join(',')})`)
          .run(...Object.values(row));
      }, /referenced|used class/);
    });

  it('rejects deferred deletion of an editing workspace referenced only by lineage', () => {
    migrateDatabase(db, history);
    const w = workspace();
    const id = item(w);
    provenance(id);
    confirm(id);
    const revision = publish(w);
    const next = randomUUID();
    db.prepare(`INSERT INTO annotation_workspaces(id,project_id,schema_id,task_type,mode,created_at,updated_at)
      VALUES (?,?,?,'classification','reference',?,?)`).run(next, w.project, w.schema, now, now);
    db.prepare('INSERT INTO workspace_revision_sources VALUES (?,?)').run(next, revision);
    rejectDeferred(() => { db.prepare('DELETE FROM annotation_workspaces WHERE id=?').run(next); }, /referenced/);
  });

  it('allows unused editing workspace, unlocked schema, source, import and Project cleanup', () => {
    migrateDatabase(db, history);
    const w = workspace();
    db.exec('PRAGMA recursive_triggers=OFF; BEGIN; PRAGMA defer_foreign_keys=ON;');
    db.prepare('DELETE FROM annotation_workspaces WHERE id=?').run(w.work);
    db.prepare('DELETE FROM label_classes WHERE id=?').run(w.label);
    db.prepare('DELETE FROM label_schemas WHERE id=?').run(w.schema);
    db.prepare('DELETE FROM import_sources WHERE import_id=?').run(w.imported);
    db.prepare('DELETE FROM data_imports WHERE id=?').run(w.imported);
    db.prepare('DELETE FROM jobs WHERE project_id=?').run(w.project);
    db.prepare('DELETE FROM project_import_rights WHERE project_id=?').run(w.project);
    db.prepare('DELETE FROM projects WHERE id=?').run(w.project);
    db.exec('COMMIT');
    expect(db.prepare('SELECT * FROM projects').all()).toEqual([]);
    for (const table of tables) expect(db.prepare(`SELECT * FROM ${table}`).all()).toEqual([]);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it.each([true, false])('validates multiple images across splits (same hash: %s)', (sameHash) => {
    migrateDatabase(db, history);
    const w = workspace();
    const first = item(w);
    const secondHash = hash(sameHash ? 'image' : 'second');
    db.prepare(`INSERT INTO import_sources(import_id,image_key,ordinal,mode,source_path,identity_dev,
      identity_ino,identity_birthtime_ns,byte_size,mtime_ns,sha256,entry_sha256)
      VALUES (?,'second',1,'reference','C:\\source\\second.png','1','5','3',10,'4',?,?)`)
      .run(w.imported, secondHash, hash('second entry'));
    const second = item(w, undefined, 'second', secondHash);
    for (const id of [first, second]) { provenance(id); confirm(id); }
    const before = allRows();
    const revision = randomUUID();
    db.exec('PRAGMA recursive_triggers=OFF; BEGIN; PRAGMA defer_foreign_keys=ON;');
    children(w, revision, { [second]: 'test' });
    expect(db.prepare('SELECT count(*) AS count,count(DISTINCT id) AS ids FROM dataset_items').get())
      .toEqual({ count: 2, ids: 2 });
    if (sameHash) {
      expect(() => header(w, revision)).toThrow(/same image hash cannot cross splits/);
      db.exec('ROLLBACK');
      expect(allRows()).toEqual(before);
    } else {
      header(w, revision);
      db.exec('COMMIT');
      expect(db.prepare("SELECT json_extract(manifest_json,'$.itemCount') AS count FROM dataset_revisions").get())
        .toEqual({ count: 2 });
      expect(db.prepare('SELECT DISTINCT split FROM dataset_items ORDER BY split').all())
        .toEqual([{ split: 'test' }, { split: 'train' }]);
    }
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it('applies actual migrations 1..6, creates only empty STRICT WITHOUT ROWID tables and reopens', () => {
    expect(migrateDatabase(db, history)).toBe(6);
    for (const table of tables) {
      expect(db.prepare(`SELECT * FROM ${table}`).all()).toEqual([]);
      expect(db.prepare('SELECT strict,wr FROM pragma_table_list WHERE name=?').get(table)).toEqual({ strict: 1, wr: 1 });
    }
    db.close();
    db = openDatabase(join(directory, 'metadata.sqlite3'));
    expect(migrateDatabase(db, history)).toBe(6);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it('upgrades 005 preserving raw import JSON/hashes, rights and generation ledger without backfill', () => {
    migrateDatabase(db, history.slice(0, 5));
    legacy();
    const before = oldRows();
    expect(migrateDatabase(db, history)).toBe(6);
    expect(oldRows()).toEqual(before);
    for (const table of tables) expect(db.prepare(`SELECT * FROM ${table}`).all()).toEqual([]);
  });

  it.each([0, 5])('rolls failed 006 back to schema %i, reopens and retries', (version) => {
    migrateDatabase(db, history.slice(0, version));
    if (version === 5) legacy();
    const schema = db.prepare('SELECT * FROM sqlite_master ORDER BY name').all();
    const before = version === 5 ? oldRows() : [];
    const failing = history.map((m) => m.version === 6 ? { ...m, sql: `${m.sql}\nSELECT * FROM absent_ann_table;` } : m);
    expect(() => migrateDatabase(db, failing)).toThrow(/absent_ann_table/);
    expect(db.pragma('user_version', { simple: true })).toBe(version);
    expect(db.prepare('SELECT * FROM sqlite_master ORDER BY name').all()).toEqual(schema);
    if (version === 5) expect(oldRows()).toEqual(before);
    db.close();
    db = openDatabase(join(directory, 'metadata.sqlite3'));
    expect(db.pragma('user_version', { simple: true })).toBe(version);
    expect(migrateDatabase(db, history)).toBe(6);
    if (version === 5) expect(oldRows()).toEqual(before);
  });

  it('rejects Project/schema/task/import/hash mixes and primary identity changes', () => {
    migrateDatabase(db, history);
    const a = workspace();
    const b = workspace();
    expect(() => item({ ...a, imported: b.imported })).toThrow(/mismatch/);
    expect(() => item(a, { kind: 'detection', rectangles: [] })).toThrow(/mismatch/);
    expect(() => db.prepare(`INSERT INTO annotation_workspaces(id,project_id,schema_id,task_type,mode,created_at,updated_at)
      VALUES (?,?,?,'classification','reference',?,?)`).run(randomUUID(), b.project, a.schema, now, now)).toThrow();
    const id = item(a);
    expect(() => db.prepare('UPDATE annotation_items SET image_sha256=?,edit_version=edit_version+1 WHERE id=?')
      .run(hash('bad'), id)).toThrow(/immutable/);
    expect(() => db.prepare('UPDATE annotation_items SET id=?,edit_version=edit_version+1 WHERE id=?')
      .run(randomUUID(), id)).toThrow(/immutable/);
    expect(() => db.prepare("UPDATE projects SET task_type='detection' WHERE id=?").run(a.project)).toThrow();
    provenance(id);
    db.prepare('UPDATE annotation_items SET annotation_json=?,edit_version=edit_version+1 WHERE id=?')
      .run(JSON.stringify({ kind: 'classification', classId: b.label }), id);
    expect(() => confirm(id)).toThrow(/Schema class/);
  });

  it('never confirms on insertion/import; requires explicit update and clears confirmation on content changes', () => {
    migrateDatabase(db, history);
    const w = workspace();
    const id = item(w);
    expect(db.prepare('SELECT state,confirmed_at FROM annotation_items WHERE id=?').get(id))
      .toEqual({ state: 'unstarted', confirmed_at: null });
    expect(() => confirm(id)).toThrow(/provenance/);
    provenance(id);
    confirm(id);
    expect(() => db.prepare(`INSERT OR REPLACE INTO annotation_items SELECT * FROM annotation_items WHERE id=?`).run(id)).toThrow();
    expect(() => db.prepare("UPDATE annotation_items SET annotation_sha256=?,edit_version=edit_version+1 WHERE id=?")
      .run(hash('edited'), id)).toThrow(/clear confirmation/);
    expect(() => db.prepare("UPDATE annotation_provenance SET changes_json='{}' WHERE item_id=?").run(id)).toThrow();
    db.prepare(`UPDATE annotation_items SET state='editing',confirmed_at=NULL,annotation_sha256=?,
      edit_version=edit_version+1 WHERE id=?`).run(hash('edited'), id);
    expect(db.prepare('SELECT state FROM annotation_items WHERE id=?').get(id)).toEqual({ state: 'editing' });
  });

  it('binds imported provenance and rejects model writes until the AST foreign-key migration', () => {
    migrateDatabase(db, history);
    const w = workspace();
    const other = workspace();
    const id = item(w);
    const insert = db.prepare(`INSERT INTO annotation_provenance(item_id,target_key,kind,source_import_id,
      source_image_key,source_annotation_key) VALUES (?,'classification',?,?,?,?)`);
    expect(() => insert.run(id, 'import-unmodified', null, null, null)).toThrow();
    expect(() => insert.run(id, 'import-edited', other.imported, 'image', 'raw-label')).toThrow();
    expect(() => insert.run(id, 'model-accepted', null, null, null)).toThrow();
    insert.run(id, 'import-unmodified', w.imported, 'image', 'raw-label');
    confirm(id);
  });

  it('locks schema exactly once, rejecting class changes/deletion/replacement', () => {
    migrateDatabase(db, history);
    const w = workspace();
    db.prepare('UPDATE label_schemas SET locked_at=?,edit_version=edit_version+1 WHERE id=?').run(now, w.schema);
    expect(() => db.prepare('UPDATE label_schemas SET locked_at=NULL,edit_version=edit_version+1 WHERE id=?').run(w.schema)).toThrow();
    expect(() => db.prepare("UPDATE label_classes SET display_name='new' WHERE id=?").run(w.label)).toThrow();
    expect(() => db.prepare('DELETE FROM label_classes WHERE id=?').run(w.label)).toThrow();
    db.pragma('recursive_triggers=OFF');
    expect(() => db.exec('INSERT OR REPLACE INTO label_classes SELECT * FROM label_classes')).toThrow();
    expect(() => db.exec('INSERT OR REPLACE INTO label_schemas SELECT * FROM label_schemas')).toThrow();
  });

  it.each([
    { x: -1 }, { width: 0 }, { x: 99, width: 2 }, { height: 81 }, { x: '0' },
    { classId: 'unknown' }, { id: null }, { y: null },
  ])('rejects malformed/out-of-bounds rectangles %j at confirmation', (change) => {
    migrateDatabase(db, history);
    const w = workspace('detection');
    const id = item(w, { kind: 'detection', rectangles: [{ id: 'rect', classId: w.label, x: 0, y: 0, width: 10, height: 10, ...change }] });
    provenance(id, 'rect');
    expect(() => confirm(id)).toThrow();
    expect(db.prepare('SELECT state FROM annotation_items WHERE id=?').get(id)).toEqual({ state: 'unstarted' });
  });

  it('distinguishes empty unstarted detection from explicitly confirmed negative samples', () => {
    migrateDatabase(db, history);
    const w = workspace('detection');
    const id = item(w, { kind: 'detection', rectangles: [] });
    expect(() => confirm(id)).toThrow(/negative/);
    confirm(id, 1);
    publish(w);
    expect(db.prepare('SELECT disposition,split FROM dataset_items').get()).toEqual({ disposition: 'negative', split: 'train' });
  });

  it('requires children before header, commits the snapshot and preserves it through reopen', () => {
    migrateDatabase(db, history);
    const w = workspace();
    const id = item(w);
    provenance(id);
    confirm(id);
    expect(() => header(w, randomUUID())).toThrow(/count/);
    const revision = publish(w);
    const before = db.prepare('SELECT * FROM dataset_items').all();
    expect(db.prepare('SELECT state FROM annotation_workspaces WHERE id=?').get(w.work)).toEqual({ state: 'frozen' });
    db.close();
    db = openDatabase(join(directory, 'metadata.sqlite3'));
    expect(db.prepare('SELECT * FROM dataset_items').all()).toEqual(before);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    db.prepare('UPDATE dataset_revisions SET last_verified_at=? WHERE id=?').run(later, revision);
    expect(db.prepare('SELECT last_verified_at FROM dataset_revisions WHERE id=?').get(revision)).toEqual({ last_verified_at: later });
  });

  it('defers missing header FK only until commit and rolls back the entire staged snapshot', () => {
    migrateDatabase(db, history);
    const w = workspace();
    const id = item(w);
    provenance(id);
    confirm(id);
    db.exec('BEGIN');
    children(w, randomUUID());
    expect(() => db.exec('COMMIT')).toThrow(/FOREIGN KEY/);
    db.exec('ROLLBACK');
    expect(db.prepare('SELECT * FROM dataset_items').all()).toEqual([]);
  });

  it('rolls back freezing after a later transaction failure; unconfirmed/excluded-only cannot publish', () => {
    migrateDatabase(db, history);
    const w = workspace();
    const id = item(w);
    db.exec('BEGIN');
    const pending = randomUUID();
    children(w, pending);
    expect(() => header(w, pending)).toThrow(/confirmed/);
    db.exec('ROLLBACK');
    db.prepare("UPDATE annotation_items SET state='excluded',exclusion_reason='blur',edit_version=edit_version+1 WHERE id=?").run(id);
    db.exec('BEGIN');
    children(w, pending);
    expect(db.prepare('SELECT disposition,split FROM dataset_items').get()).toEqual({ disposition: 'excluded', split: null });
    expect(() => header(w, pending)).toThrow(/included/);
    db.exec('ROLLBACK');
    db.prepare("UPDATE annotation_items SET state='editing',exclusion_reason=NULL,edit_version=edit_version+1 WHERE id=?").run(id);
    provenance(id);
    confirm(id);
    db.exec('BEGIN');
    children(w, pending);
    header(w, pending);
    expect(() => db.exec('INSERT INTO absent_after_freeze VALUES (1)')).toThrow();
    db.exec('ROLLBACK');
    expect(db.prepare('SELECT state FROM annotation_workspaces WHERE id=?').get(w.work)).toEqual({ state: 'editing' });
    expect(db.prepare('SELECT * FROM dataset_items').all()).toEqual([]);
    publish(w);
  });

  it('blocks immutable writes and different-unique-key REPLACE with recursion OFF; relink preserves snapshots', () => {
    migrateDatabase(db, history);
    db.pragma('recursive_triggers=OFF');
    const w = workspace();
    const id = item(w);
    provenance(id);
    confirm(id);
    const revision = publish(w);
    const snapshot = db.prepare('SELECT * FROM dataset_items').all();
    for (const sql of [
      'INSERT OR REPLACE INTO dataset_revisions SELECT * FROM dataset_revisions',
      'INSERT OR REPLACE INTO dataset_items SELECT * FROM dataset_items',
      'DELETE FROM dataset_revisions', 'DELETE FROM dataset_items',
      "UPDATE dataset_items SET split='test'", "UPDATE dataset_revisions SET created_by='other'",
      "UPDATE annotation_workspaces SET state='editing',edit_version=edit_version+1",
      "UPDATE annotation_items SET state='editing',confirmed_at=NULL,edit_version=edit_version+1",
      'INSERT OR REPLACE INTO import_sources SELECT * FROM import_sources',
      'INSERT OR REPLACE INTO data_imports SELECT * FROM data_imports',
    ]) expect(() => db.exec(sql)).toThrow();
    expect(() => header(w, randomUUID())).toThrow(/immutable/);
    expect(() => db.prepare(`INSERT OR REPLACE INTO dataset_items
      SELECT ?,revision_id,source_item_id,import_id,image_key,image_sha256,width,height,source_snapshot_json,
      annotation_json,annotation_sha256,provenance_json,disposition,exclusion_reason,split FROM dataset_items`)
      .run(randomUUID())).toThrow(/immutable/);
    expect(() => db.prepare('UPDATE import_sources SET sha256=? WHERE import_id=?').run(hash('changed'), w.imported)).toThrow();
    db.prepare("UPDATE import_sources SET source_path='C:\\relinked\\image.png',identity_ino='999',entry_sha256=? WHERE import_id=?")
      .run(hash('new binding'), w.imported);
    expect(db.prepare('SELECT source_path,identity_ino FROM import_sources WHERE import_id=?').get(w.imported))
      .toEqual({ source_path: 'C:\\relinked\\image.png', identity_ino: '999' });
    expect(db.prepare('SELECT locked_at FROM label_schemas WHERE id=?').get(w.schema)).toEqual({ locked_at: null });
    expect(db.prepare('SELECT * FROM dataset_items').all()).toEqual(snapshot);
    expect(db.prepare('SELECT id FROM dataset_revisions').get()).toEqual({ id: revision });
  });

  it('only permits Reference verification updates and records same-Project clone lineage', () => {
    migrateDatabase(db, history);
    const w = workspace('classification', 'copy');
    const id = item(w);
    provenance(id);
    confirm(id);
    const revision = publish(w);
    expect(() => db.prepare('UPDATE dataset_revisions SET last_verified_at=? WHERE id=?').run(later, revision)).toThrow();
    const next = randomUUID();
    db.prepare(`INSERT INTO annotation_workspaces(id,project_id,schema_id,task_type,mode,created_at,updated_at)
      VALUES (?,?,?,'classification','copy',?,?)`).run(next, w.project, w.schema, now, now);
    db.prepare('INSERT INTO workspace_revision_sources VALUES (?,?)').run(next, revision);
    const other = workspace();
    expect(() => db.prepare('INSERT INTO workspace_revision_sources VALUES (?,?)').run(other.work, revision)).toThrow();
    expect(db.prepare('SELECT * FROM workspace_revision_sources').all()).toEqual([{ workspace_id: next, source_revision_id: revision }]);
  });
});