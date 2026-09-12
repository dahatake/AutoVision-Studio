// @vitest-environment node
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openDatabase, type DatabaseConnection } from './database.js';
import { migrateDatabase, type Migration } from './migrate.js';

const history: readonly Migration[] = [
  '001_core.sql', '002_jobs.sql', '003_import.sql', '004_import_generation.sql', '005_import_rights.sql',
].map((file, index) => ({
  version: index + 1,
  sql: readFileSync(new URL(`./migrations/${file}`, import.meta.url), 'utf8'),
}));
const first = '2026-09-12T01:02:03.004Z';
const later = '2026-09-12T04:05:06.007Z';
const importId = '00000000-0000-4000-8000-000000000001';
const rawScan = '{\r\n  "scan": "画像", "n": 1.00\r\n}\n';
const rawManifest = '{ "sources" : [], "escaped": "\\u753b" }\r\n';
const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
let directory: string;
let database: DatabaseConnection;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'autovision-import-rights-'));
  database = openDatabase(join(directory, 'metadata.sqlite3'));
});
afterEach(() => {
  if (database.open) database.close();
  rmSync(directory, { recursive: true, force: true });
});

function project(id = 'project'): void {
  database.prepare(`INSERT INTO projects
    (id, name, description, task_type, workspace_path, created_at, updated_at)
    VALUES (?, '画像 Project', '既存 metadata', 'classification', ?, ?, ?)`)
    .run(id, `C:\\fixture\\${id}`, first, first);
}
function acknowledge(id = 'project', timestamp: unknown = first): void {
  database.prepare('INSERT INTO project_import_rights(project_id, acknowledged_at) VALUES (?, ?)')
    .run(id, timestamp);
}
function rights(): unknown[] {
  return database.prepare('SELECT * FROM project_import_rights ORDER BY project_id').all();
}
function schema(): unknown[] {
  return database.prepare('SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name').all();
}
function snapshot(): unknown {
  return {
    projects: database.prepare('SELECT * FROM projects ORDER BY id').all(),
    settings: database.prepare('SELECT * FROM settings ORDER BY key').all(),
    jobs: database.prepare('SELECT * FROM jobs ORDER BY id').all(),
    imports: database.prepare(`SELECT *, hex(CAST(scan_result_json AS BLOB)) AS scan_bytes,
      hex(CAST(source_manifest_json AS BLOB)) AS manifest_bytes FROM data_imports ORDER BY id`).all(),
    sources: database.prepare('SELECT * FROM import_sources ORDER BY import_id, image_key').all(),
    ledger: database.prepare(`SELECT import_id, CAST(generation AS TEXT) AS generation,
      typeof(generation) AS storage FROM import_generations ORDER BY import_id`).all(),
  };
}
function legacyData(): void {
  project();
  database.prepare('INSERT INTO settings(key, value) VALUES (?, ?)').run('fixture', ' { "日本語": 1.00 }\r\n');
  database.prepare(`INSERT INTO jobs(id, project_id, kind, status, created_at, updated_at)
    VALUES ('scan', 'project', 'scan-dataset', 'Succeeded', ?, ?)`).run(first, later);
  database.prepare(`INSERT INTO data_imports
    (id, project_id, scan_job_id, task_type, mode, created_at, updated_at,
     scan_result_json, scan_result_sha256, source_manifest_json, source_manifest_sha256)
    VALUES (?, 'project', 'scan', 'classification', 'reference', ?, ?, ?, ?, ?, ?)`)
    .run(importId, first, later, rawScan, hash(rawScan), rawManifest, hash(rawManifest));
  database.prepare(`INSERT INTO import_sources
    (import_id, image_key, ordinal, mode, source_path, identity_dev, identity_ino,
     identity_birthtime_ns, byte_size, mtime_ns, sha256, entry_sha256)
    VALUES (?, 'image', 0, 'reference', 'C:\\source\\画像.png', '1', '2', '3', 10, '4', ?, ?)`)
    .run(importId, 'a'.repeat(64), 'b'.repeat(64));
}

describe('DAT-13 Project first-import rights acknowledgement schema', () => {
  it('creates only two strict columns without defaults or automatic acknowledgement', () => {
    expect(migrateDatabase(database, history)).toBe(5);
    expect(rights()).toEqual([]);
    project();
    expect(rights()).toEqual([]);
    expect(database.prepare("SELECT strict, wr FROM pragma_table_list WHERE name = 'project_import_rights'").get())
      .toEqual({ strict: 1, wr: 1 });
    expect(database.pragma('table_info(project_import_rights)')).toEqual([
      { cid: 0, name: 'project_id', type: 'TEXT', notnull: 1, dflt_value: null, pk: 1 },
      { cid: 1, name: 'acknowledged_at', type: 'TEXT', notnull: 1, dflt_value: null, pk: 0 },
    ]);
    expect(database.pragma('foreign_key_list(project_import_rights)')).toEqual([
      { id: 0, seq: 0, table: 'projects', from: 'project_id', to: 'id',
        on_update: 'NO ACTION', on_delete: 'NO ACTION', match: 'NONE' },
    ]);
    acknowledge();
    expect(rights()).toEqual([{ project_id: 'project', acknowledged_at: first }]);
  });

  it('upgrades current 004 without changing metadata, JSON bytes or generation ledger and without backfill', () => {
    migrateDatabase(database, history.slice(0, 4));
    legacyData();
    expect(database.prepare('SELECT generation FROM import_generations WHERE import_id = ?').get(importId))
      .toEqual({ generation: 2 });
    const before = snapshot();
    const oldSchema = schema();
    expect(migrateDatabase(database, history)).toBe(5);
    expect(schema()).toEqual(expect.arrayContaining(oldSchema));
    expect(snapshot()).toEqual(before);
    expect(rights()).toEqual([]);
    acknowledge();
    const acknowledged = rights();
    expect(migrateDatabase(database, history)).toBe(5);
    expect(rights()).toEqual(acknowledged);
    expect(snapshot()).toEqual(before);
  });

  it.each([
    { name: 'null', value: null }, { name: 'empty', value: '' }, { name: 'spaces', value: '   ' },
    { name: 'numeric', value: 123 }, { name: 'blob', value: Buffer.from(first) },
    { name: 'date only', value: '2026-09-12' }, { name: 'local time', value: first.slice(0, -1) },
    { name: 'offset', value: '2026-09-12T01:02:03.004+00:00' },
    { name: 'non-numeric', value: 'xxxx-xx-xxTxx:xx:xx.xxxZ' },
    { name: 'lowercase', value: first.toLowerCase() }, { name: 'trailing space', value: `${first} ` },
    { name: 'NUL suffix', value: `${first}\0` },
  ])('rejects $name timestamps without inserting a record', ({ value }) => {
    migrateDatabase(database, history);
    project();
    expect(() => acknowledge('project', value)).toThrow();
    expect(rights()).toEqual([]);
  });

  it('requires an explicit timestamp and a known non-null Project', () => {
    migrateDatabase(database, history);
    project();
    expect(() => database.exec("INSERT INTO project_import_rights(project_id) VALUES ('project')")).toThrow(/NOT NULL/);
    expect(() => acknowledge('unknown')).toThrow(/FOREIGN KEY/);
    expect(() => database.prepare('INSERT INTO project_import_rights VALUES (NULL, ?)').run(first)).toThrow(/NOT NULL/);
    expect(rights()).toEqual([]);
  });

  it.each([0, 1].flatMap((recursive) => [first, later].flatMap((timestamp) => [
    'INSERT', 'INSERT OR REPLACE', 'INSERT OR IGNORE',
  ].map((operation) => ({ recursive, timestamp, operation })))))
  ('rejects $operation duplicates even for $timestamp with recursion=$recursive', ({ recursive, timestamp, operation }) => {
    migrateDatabase(database, history);
    database.pragma(`recursive_triggers = ${recursive}`);
    project();
    acknowledge();
    expect(() => database.prepare(`${operation} INTO project_import_rights VALUES ('project', ?)`).run(timestamp))
      .toThrow(/already acknowledged/);
    expect(rights()).toEqual([{ project_id: 'project', acknowledged_at: first }]);
  });

  it.each(['DO NOTHING', 'DO UPDATE SET acknowledged_at = excluded.acknowledged_at'])
  ('rejects upsert %s rather than silently acknowledging again', (conflict) => {
    migrateDatabase(database, history);
    project();
    acknowledge();
    expect(() => database.prepare(`INSERT INTO project_import_rights VALUES ('project', ?)
      ON CONFLICT(project_id) ${conflict}`).run(later)).toThrow(/already acknowledged/);
    expect(rights()).toEqual([{ project_id: 'project', acknowledged_at: first }]);
  });

  it.each([
    "project_id = 'other'", 'project_id = NULL', `acknowledged_at = '${later}'`,
    'acknowledged_at = NULL', "acknowledged_at = ''",
    `project_id = 'other', acknowledged_at = '${later}'`,
  ])('rejects UPDATE OR REPLACE %s without changing either Project', (assignment) => {
    migrateDatabase(database, history);
    project();
    project('other');
    acknowledge();
    acknowledge('other', later);
    const before = rights();
    expect(() => database.exec(`UPDATE OR REPLACE project_import_rights SET ${assignment} WHERE project_id = 'project'`))
      .toThrow(/immutable/);
    expect(rights()).toEqual(before);
  });

  it('allows identical updates and preserves independent acknowledgements across reopen', () => {
    migrateDatabase(database, history);
    project();
    project('other');
    acknowledge();
    acknowledge('other', later);
    const before = rights();
    database.exec('UPDATE project_import_rights SET project_id = project_id, acknowledged_at = acknowledged_at');
    expect(rights()).toEqual(before);
    database.close();
    database = openDatabase(join(directory, 'metadata.sqlite3'));
    expect(database.pragma('user_version', { simple: true })).toBe(5);
    expect(migrateDatabase(database, history)).toBe(5);
    expect(rights()).toEqual(before);
    expect(() => acknowledge()).toThrow(/already acknowledged/);
  });

  it('requires explicit owned-metadata deletion and leaves existing import foreign keys intact', () => {
    migrateDatabase(database, history);
    legacyData();
    expect(rights()).toEqual([]);
    acknowledge();
    project('other');
    acknowledge('other', later);
    expect(() => database.exec("DELETE FROM projects WHERE id = 'other'")).toThrow(/FOREIGN KEY/);
    database.exec("DELETE FROM project_import_rights WHERE project_id = 'other'; DELETE FROM projects WHERE id = 'other'");
    expect(rights()).toEqual([{ project_id: 'project', acknowledged_at: first }]);
    database.exec("DELETE FROM project_import_rights WHERE project_id = 'project'");
    const before = snapshot();
    expect(() => database.exec("DELETE FROM projects WHERE id = 'project'")).toThrow(/FOREIGN KEY/);
    expect(snapshot()).toEqual(before);
  });

  it('rolls back acknowledgement and earlier caller writes after an aborted duplicate', () => {
    migrateDatabase(database, history);
    legacyData();
    const before = snapshot();
    database.exec('BEGIN IMMEDIATE');
    try {
      database.exec("UPDATE projects SET description = 'pending'");
      acknowledge();
      expect(() => acknowledge('project', later)).toThrow(/already acknowledged/);
      expect(database.inTransaction).toBe(true);
      expect(rights()).toEqual([{ project_id: 'project', acknowledged_at: first }]);
    } finally {
      database.exec('ROLLBACK');
    }
    expect(rights()).toEqual([]);
    expect(snapshot()).toEqual(before);
    acknowledge('project', later);
    expect(rights()).toEqual([{ project_id: 'project', acknowledged_at: later }]);
  });

  it.each([0, 4])('fully rolls back failed 005 from version %i, then reopens and retries', (version) => {
    migrateDatabase(database, history.slice(0, version));
    if (version === 4) legacyData();
    const beforeSchema = schema();
    const beforeData = version === 4 ? snapshot() : undefined;
    const failing = history.map((migration) => migration.version === 5
      ? { ...migration, sql: `${migration.sql}\nINSERT INTO deliberately_absent_table VALUES (1);` }
      : migration);
    expect(() => migrateDatabase(database, failing)).toThrow(/deliberately_absent_table/);
    expect(database.inTransaction).toBe(false);
    expect(database.pragma('user_version', { simple: true })).toBe(version);
    expect(schema()).toEqual(beforeSchema);
    if (version === 4) expect(snapshot()).toEqual(beforeData);
    database.close();
    database = openDatabase(join(directory, 'metadata.sqlite3'));
    expect(database.pragma('user_version', { simple: true })).toBe(version);
    expect(schema()).toEqual(beforeSchema);
    expect(migrateDatabase(database, history)).toBe(5);
    expect(rights()).toEqual([]);
    if (version === 4) expect(snapshot()).toEqual(beforeData);
    else project();
    acknowledge();
    expect(() => acknowledge('project', later)).toThrow(/already acknowledged/);
    expect(() => database.prepare('UPDATE project_import_rights SET acknowledged_at = ?').run(later)).toThrow(/immutable/);
    expect(rights()).toEqual([{ project_id: 'project', acknowledged_at: first }]);
  });
});