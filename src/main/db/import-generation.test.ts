// @vitest-environment node
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openDatabase, type DatabaseConnection } from './database.js';
import { migrateDatabase, type Migration } from './migrate.js';

const history: readonly Migration[] = [
  '001_core.sql', '002_jobs.sql', '003_import.sql', '004_import_generation.sql',
].map((file, index) => ({
  version: index + 1,
  sql: readFileSync(new URL(`./migrations/${file}`, import.meta.url), 'utf8'),
}));
const a = '00000000-0000-4000-8000-000000000001';
const b = '00000000-0000-4000-8000-000000000002';
const c = '00000000-0000-4000-8000-000000000003';
const rawScan = '{\r\n  "scan": "画像", "n": 1.00\r\n}\n';
const rawManifest = '{ "sources" : [ ], "escaped": "\\u753b" }\r\n';
const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
let directory: string;
let database: DatabaseConnection;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'autovision-import-generation-'));
  database = openDatabase(join(directory, 'metadata.sqlite3'));
});
afterEach(() => {
  if (database.open) database.close();
  rmSync(directory, { recursive: true, force: true });
});

// Raw fixtures intentionally exercise only bundled schema, not repository APIs.
function insertHeader(id: string, mode = 'reference', replace = false, job = `scan-${id}`): void {
  database.prepare(`INSERT ${replace ? 'OR REPLACE ' : ''}INTO data_imports
    (id, project_id, scan_job_id, task_type, mode, created_at, updated_at,
     scan_result_json, scan_result_sha256, source_manifest_json, source_manifest_sha256)
    VALUES (?, 'project', ?, 'classification', ?, 'created', 'updated', ?, ?, ?, ?)`)
    .run(id, job, mode, rawScan, hash(rawScan), rawManifest, hash(rawManifest));
}
function createImport(id: string, mode = 'reference'): void {
  database.exec(`INSERT OR IGNORE INTO projects
    (id, name, task_type, workspace_path, created_at, updated_at)
    VALUES ('project', 'fixture', 'classification', 'C:\\fixture', 'created', 'updated')`);
  database.prepare(`INSERT INTO jobs(id, project_id, kind, status, created_at, updated_at)
    VALUES (?, 'project', 'scan-dataset', 'Succeeded', 'created', 'updated')`).run(`scan-${id}`);
  insertHeader(id, mode);
}
function insertSource(id: string, mode = 'reference', replace = false): void {
  const copy = mode === 'copy';
  database.prepare(`INSERT ${replace ? 'OR REPLACE ' : ''}INTO import_sources
    (import_id, image_key, ordinal, mode, relative_path, relative_path_key,
     source_path, identity_dev, identity_ino, identity_birthtime_ns, byte_size,
     mtime_ns, sha256, entry_sha256)
    VALUES (?, 'image', 0, ?, ?, ?, ?, ?, ?, ?, 10, ?, ?, ?)`)
    .run(id, mode, copy ? 'images/a.png' : null, copy ? 'images/a.png' : null,
      copy ? null : 'C:\\source\\a.png', copy ? null : '1', copy ? null : '2',
      copy ? null : '3', copy ? null : '4', 'a'.repeat(64), 'b'.repeat(64));
}
function generation(id = a): number {
  return (database.prepare('SELECT generation FROM import_generations WHERE import_id = ?')
    .get(id) as { generation: number }).generation;
}
function dataSnapshot(): unknown {
  return {
    projects: database.prepare('SELECT * FROM projects ORDER BY id').all(),
    jobs: database.prepare('SELECT * FROM jobs ORDER BY id').all(),
    headers: database.prepare(`SELECT *, hex(CAST(scan_result_json AS BLOB)) AS scan_bytes,
      hex(CAST(source_manifest_json AS BLOB)) AS manifest_bytes FROM data_imports ORDER BY id`).all(),
    sources: database.prepare('SELECT * FROM import_sources ORDER BY import_id, image_key').all(),
  };
}
function ledger(): unknown[] {
  // Never round int64 through a JavaScript Number, including overflow assertions.
  return database.prepare(`SELECT import_id, CAST(generation AS TEXT) AS generation,
    typeof(generation) AS storage FROM import_generations ORDER BY import_id`).all();
}
function schema(): unknown[] {
  return database.prepare('SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name').all();
}
function seedNearOverflow(value: string): void {
  // Test-only boundary fixture; restore the exact bundled guard before any operation.
  const guard = database.prepare(`SELECT sql FROM sqlite_master
    WHERE name = 'import_generations_guard_update'`).get() as { sql: string };
  database.exec('DROP TRIGGER import_generations_guard_update');
  try {
    database.prepare('UPDATE import_generations SET generation = CAST(? AS INTEGER) WHERE import_id = ?')
      .run(value, a);
  } finally {
    database.exec(guard.sql);
  }
}

describe('DAT-12 persistent import generation schema', () => {
  it('upgrades 001/002/003, backfills once, and preserves every column and raw JSON byte', () => {
    migrateDatabase(database, history.slice(0, 3));
    createImport(a);
    insertSource(a);
    createImport(b, 'copy');
    insertSource(b, 'copy');
    const before = dataSnapshot();
    expect(migrateDatabase(database, history)).toBe(4);
    expect(dataSnapshot()).toEqual(before);
    expect(ledger()).toEqual([a, b].map((import_id) => ({ import_id, generation: '1', storage: 'integer' })));
    expect(migrateDatabase(database, history)).toBe(4);
    expect(dataSnapshot()).toEqual(before);
    expect(generation()).toBe(1);
    expect(database.prepare("SELECT strict, wr FROM pragma_table_list WHERE name = 'import_generations'").get())
      .toEqual({ strict: 1, wr: 1 });
    expect(database.pragma('foreign_key_list(import_generations)')).toEqual([]);
  });

  it('creates fresh, reopens with a tombstone, and reinserts without resetting it', () => {
    migrateDatabase(database, history);
    expect(ledger()).toEqual([]);
    createImport(a);
    expect(generation()).toBe(1);
    insertSource(a);
    expect(generation()).toBe(2);
    database.exec('DELETE FROM import_sources; DELETE FROM data_imports');
    expect(generation()).toBe(4);
    database.close();
    database = openDatabase(join(directory, 'metadata.sqlite3'));
    expect(database.pragma('user_version', { simple: true })).toBe(4);
    migrateDatabase(database, history);
    expect(generation()).toBe(4);
    insertHeader(a);
    expect(generation()).toBe(5);
    database.exec('UPDATE data_imports SET updated_at = updated_at');
    expect(generation()).toBe(6);
  });

  it('counts header no-ops, update/restore ABA and delete/identical-insert ABA', () => {
    migrateDatabase(database, history);
    createImport(a);
    const before = dataSnapshot();
    database.exec('UPDATE data_imports SET updated_at = updated_at');
    expect(generation()).toBe(2);
    database.exec("UPDATE data_imports SET source_manifest_json = '{}', updated_at = 'later'");
    expect(generation()).toBe(3);
    database.prepare("UPDATE data_imports SET source_manifest_json = ?, updated_at = 'updated'").run(rawManifest);
    expect(generation()).toBe(4);
    expect(dataSnapshot()).toEqual(before);
    database.exec('DELETE FROM data_imports');
    expect(generation()).toBe(5);
    insertHeader(a);
    expect(generation()).toBe(6);
    expect(dataSnapshot()).toEqual(before);
  });

  it('counts every source operation including no-op and both ABA forms', () => {
    migrateDatabase(database, history);
    createImport(a);
    insertSource(a);
    const before = dataSnapshot();
    expect(generation()).toBe(2);
    database.exec('UPDATE import_sources SET source_path = source_path');
    expect(generation()).toBe(3);
    database.exec("UPDATE import_sources SET source_path = 'C:\\other.png'");
    expect(generation()).toBe(4);
    database.prepare('UPDATE import_sources SET source_path = ?').run('C:\\source\\a.png');
    expect(generation()).toBe(5);
    expect(dataSnapshot()).toEqual(before);
    database.exec('DELETE FROM import_sources');
    expect(generation()).toBe(6);
    insertSource(a);
    expect(generation()).toBe(7);
    expect(dataSnapshot()).toEqual(before);
  });

  it('preserves Copy immutability and FK NO ACTION while counting permitted no-ops', () => {
    migrateDatabase(database, history);
    createImport(a, 'copy');
    insertSource(a, 'copy');
    database.exec('UPDATE data_imports SET updated_at = updated_at; UPDATE import_sources SET ordinal = ordinal');
    expect(generation()).toBe(4);
    const before = dataSnapshot();
    expect(() => database.exec("UPDATE data_imports SET source_manifest_json = '{}'")).toThrow(/immutable/);
    expect(() => database.exec("UPDATE import_sources SET relative_path = 'changed.png'")).toThrow(/immutable/);
    expect(() => database.exec('DELETE FROM data_imports')).toThrow(/FOREIGN KEY/);
    expect(generation()).toBe(4);
    expect(dataSnapshot()).toEqual(before);
  });

  it.each([0, 1])('detects identical header/source REPLACE with recursive_triggers=%i', (recursive) => {
    migrateDatabase(database, history);
    database.pragma(`recursive_triggers = ${recursive}`);
    expect(database.pragma('recursive_triggers', { simple: true })).toBe(recursive);
    createImport(a);
    insertSource(a);
    const before = dataSnapshot();
    let previous = generation();
    insertHeader(a, 'reference', true);
    expect(generation()).toBeGreaterThan(previous);
    expect(dataSnapshot()).toEqual(before);
    previous = generation();
    insertSource(a, 'reference', true);
    expect(generation()).toBeGreaterThan(previous);
    expect(dataSnapshot()).toEqual(before);
  });

  it('tracks a different header displaced by the unique scan job with recursion off', () => {
    migrateDatabase(database, history);
    database.pragma('recursive_triggers = OFF');
    createImport(a);
    createImport(c);
    insertHeader(b, 'reference', true, `scan-${a}`);
    expect(generation(a)).toBe(2);
    expect(generation(b)).toBe(1);
    expect(generation(c)).toBe(1);
    expect(database.prepare('SELECT id FROM data_imports WHERE id = ?').get(a)).toBeUndefined();
  });

  it.each([0, 1].flatMap((recursive) => [false, true].flatMap((exhausted) =>
    [1, -1].flatMap((victimRowid) => ['data_imports', 'import_sources'].flatMap((table) =>
      ['INSERT OR REPLACE', 'UPDATE OR REPLACE'].map((operation) =>
        ({ recursive, exhausted, victimRowid, table, operation })))))))
  ('preserves every row on $operation rowid collision: $table recursion=$recursive max=$exhausted rowid=$victimRowid',
    ({ recursive, exhausted, victimRowid, table, operation }) => {
      // Seed legacy physical identities before the new immutable-rowid guards.
      migrateDatabase(database, history.slice(0, 3));
      database.pragma(`recursive_triggers = ${recursive}`);
      expect(database.pragma('recursive_triggers', { simple: true })).toBe(recursive);
      createImport(a);
      createImport(b);
      createImport(c);
      if (table === 'import_sources') {
        insertSource(a);
        insertSource(b);
        insertSource(c);
      }
      const key = table === 'data_imports' ? 'id' : 'import_id';
      database.prepare(`UPDATE ${table} SET rowid = ? WHERE ${key} = ?`).run(victimRowid, a);
      migrateDatabase(database, history);
      if (exhausted) seedNearOverflow('9223372036854775807');
      const snapshot = () => ({
        data: dataSnapshot(), generations: ledger(),
        headers: database.prepare('SELECT rowid, id FROM data_imports ORDER BY rowid').all(),
        sources: database.prepare('SELECT rowid, import_id, image_key FROM import_sources ORDER BY rowid').all(),
      });
      const before = snapshot();
      database.exec('BEGIN IMMEDIATE');
      try {
        // This successful earlier write must also disappear on caller rollback.
        database.prepare('UPDATE data_imports SET updated_at = ? WHERE id = ?').run('temporary', c);
        const pending = snapshot();
        const sql = operation === 'INSERT OR REPLACE'
          ? `INSERT OR REPLACE INTO ${table} SELECT ?, * FROM ${table} WHERE ${key} = ?`
          : `UPDATE OR REPLACE ${table} SET rowid = ? WHERE ${key} = ?`;
        // SELECT * excludes hidden rowid; explicitly name it plus all columns.
        const columns = (database.pragma(`table_info(${table})`) as { name: string }[])
          .map(({ name }) => name).join(', ');
        const statement = operation === 'INSERT OR REPLACE'
          ? sql.replace(`INTO ${table}`, `INTO ${table} (rowid, ${columns})`)
          : sql;
        expect(() => database.prepare(statement).run(victimRowid, b)).toThrow(/rowid/);
        // Includes both the victim and the replacing row's PK/UNIQUE sibling.
        expect(snapshot()).toEqual(pending);
      } finally {
        database.exec('ROLLBACK');
      }
      expect(snapshot()).toEqual(before);
    });

  it.each([0, 1].flatMap((recursive) => ['data_imports', 'import_sources'].flatMap((table) =>
    ['rowid', '_rowid_', 'oid'].map((alias) => ({ recursive, table, alias })))))
  ('rejects even no-op $alias UPDATE on $table with recursion=$recursive', ({ recursive, table, alias }) => {
    migrateDatabase(database, history);
    database.pragma(`recursive_triggers = ${recursive}`);
    createImport(a);
    insertSource(a);
    const before = dataSnapshot();
    const generations = ledger();
    expect(() => database.exec(`UPDATE OR REPLACE ${table} SET ${alias} = ${alias}`)).toThrow(/rowid/);
    expect(dataSnapshot()).toEqual(before);
    expect(ledger()).toEqual(generations);
  });

  it.each([
    'DELETE FROM import_generations',
    "UPDATE import_generations SET import_id = 'renamed'",
    'UPDATE import_generations SET generation = 0',
    'UPDATE import_generations SET generation = 1',
    'UPDATE import_generations SET generation = generation',
    'UPDATE import_generations SET generation = generation + 2',
    'UPDATE import_generations SET generation = NULL',
    'UPDATE import_generations SET generation = 2.5',
    'UPDATE import_generations SET generation = 9223372036854775808',
    `INSERT INTO import_generations VALUES ('${a}', 1)`,
    `INSERT OR IGNORE INTO import_generations VALUES ('${a}', 1)`,
    `INSERT OR REPLACE INTO import_generations VALUES ('${a}', 1)`,
    `INSERT OR REPLACE INTO import_generations VALUES ('${a}', 3)`,
    'INSERT OR REPLACE INTO import_generations SELECT * FROM import_generations',
    "INSERT OR REPLACE INTO import_generations(rowid, import_id, generation) VALUES (1, 'replacement', 1)",
  ])('rejects ledger tampering with recursion off: %s', (sql) => {
    migrateDatabase(database, history);
    database.pragma('recursive_triggers = OFF');
    createImport(a);
    database.exec('UPDATE data_imports SET updated_at = updated_at');
    const before = ledger();
    expect(() => database.exec(sql)).toThrow();
    expect(ledger()).toEqual(before);
  });

  it.each(['0', '-1', 'NULL', '1.5', '2', '9223372036854775808'])('rejects invalid initial generation %s', (value) => {
    migrateDatabase(database, history);
    expect(() => database.exec(`INSERT INTO import_generations VALUES ('new', ${value})`)).toThrow();
    expect(ledger()).toEqual([]);
  });

  it('allows exactly +1, but rejects a null or changed ledger identity', () => {
    migrateDatabase(database, history);
    createImport(a);
    database.exec('UPDATE import_generations SET generation = generation + 1');
    expect(generation()).toBe(2);
    expect(() => database.exec('INSERT INTO import_generations VALUES (NULL, 1)')).toThrow();
    expect(() => database.exec('UPDATE import_generations SET import_id = NULL, generation = generation + 1')).toThrow();
    expect(generation()).toBe(2);
  });

  it('rolls back all header/source increments and new ledgers with the caller transaction', () => {
    migrateDatabase(database, history);
    createImport(a);
    const before = dataSnapshot();
    const generations = ledger();
    database.exec('BEGIN IMMEDIATE');
    try {
      insertSource(a);
      database.exec(`UPDATE import_sources SET source_path = source_path;
        DELETE FROM import_sources; UPDATE data_imports SET updated_at = updated_at;
        DELETE FROM data_imports`);
      insertHeader(a);
      expect(generation()).toBe(7);
      createImport(b);
      expect(generation(b)).toBe(1);
    } finally {
      database.exec('ROLLBACK');
    }
    expect(dataSnapshot()).toEqual(before);
    expect(ledger()).toEqual(generations);
  });

  it('does not advance unrelated or newly created imports', () => {
    migrateDatabase(database, history);
    createImport(a);
    createImport(b);
    insertSource(a);
    database.prepare('DELETE FROM import_sources WHERE import_id = ?').run(a);
    database.prepare('DELETE FROM data_imports WHERE id = ?').run(a);
    createImport(c);
    expect(generation(a)).toBe(4);
    expect(generation(b)).toBe(1);
    expect(generation(c)).toBe(1);
    insertHeader(a);
    expect(generation(a)).toBe(5);
    expect(generation(b)).toBe(1);
    expect(generation(c)).toBe(1);
  });

  it('reaches int64 max exactly without storing a real or rounded number', () => {
    migrateDatabase(database, history);
    createImport(a);
    seedNearOverflow('9223372036854775806');
    database.exec('UPDATE data_imports SET updated_at = updated_at');
    expect(ledger()).toEqual([{ import_id: a, generation: '9223372036854775807', storage: 'integer' }]);
    expect(() => database.exec('UPDATE import_generations SET generation = generation + 1')).toThrow();
    expect(ledger()).toEqual([{ import_id: a, generation: '9223372036854775807', storage: 'integer' }]);
  });

  it.each([
    'header insert', 'header replace', 'header update', 'header delete',
    'source insert', 'source replace', 'source update', 'source delete',
  ])('fails closed at int64 max: %s', (operation) => {
    migrateDatabase(database, history);
    database.pragma('recursive_triggers = OFF');
    createImport(a);
    createImport(b);
    if (['source replace', 'source update', 'source delete'].includes(operation)) insertSource(a);
    if (operation === 'header insert') database.prepare('DELETE FROM data_imports WHERE id = ?').run(a);
    seedNearOverflow('9223372036854775807');
    const before = dataSnapshot();
    const generations = ledger();
    const actions: Record<string, () => unknown> = {
      'header insert': () => insertHeader(a),
      'header replace': () => insertHeader(a, 'reference', true),
      'header update': () => database.prepare('UPDATE data_imports SET updated_at = updated_at WHERE id = ?').run(a),
      'header delete': () => database.prepare('DELETE FROM data_imports WHERE id = ?').run(a),
      'source insert': () => insertSource(a),
      'source replace': () => insertSource(a, 'reference', true),
      'source update': () => database.prepare('UPDATE import_sources SET source_path = source_path WHERE import_id = ?').run(a),
      'source delete': () => database.prepare('DELETE FROM import_sources WHERE import_id = ?').run(a),
    };
    expect(actions[operation]).toThrow(/import generation exhausted/);
    expect(dataSnapshot()).toEqual(before);
    expect(ledger()).toEqual(generations);
    database.prepare('UPDATE data_imports SET updated_at = updated_at WHERE id = ?').run(b);
    expect(generation(b)).toBe(2);
  });

  it.each([0, 3])('rolls back failed migration from version %i without partial objects, then retries', (version) => {
    migrateDatabase(database, history.slice(0, version));
    if (version === 3) {
      createImport(a);
      insertSource(a);
    }
    const beforeSchema = schema();
    const beforeData = version === 3 ? dataSnapshot() : undefined;
    const failing = history.map((migration) => migration.version === 4
      ? { ...migration, sql: `${migration.sql}\nINSERT INTO deliberately_absent_table VALUES (1);` }
      : migration);
    expect(() => migrateDatabase(database, failing)).toThrow(/deliberately_absent_table/);
    expect(database.inTransaction).toBe(false);
    expect(database.pragma('user_version', { simple: true })).toBe(version);
    expect(schema()).toEqual(beforeSchema);
    if (version === 3) expect(dataSnapshot()).toEqual(beforeData);
    expect(migrateDatabase(database, history)).toBe(4);
    if (version === 0) createImport(a);
    else expect(dataSnapshot()).toEqual(beforeData);
    expect(generation()).toBe(1);
    database.exec('UPDATE data_imports SET updated_at = updated_at');
    expect(generation()).toBe(2);
  });
});