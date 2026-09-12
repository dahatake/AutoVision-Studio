// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openDatabase, type DatabaseConnection } from './database.js';

let directory: string;
const connections: DatabaseConnection[] = [];
function connect(path = join(directory, 'metadata.sqlite3')) {
  const database = openDatabase(path);
  connections.push(database);
  return database;
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'autovision-core02-'));
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const connection of connections.splice(0)) {
    if (connection.open) connection.close();
  }
  rmSync(directory, { recursive: true, force: true });
});

describe('Main SQLite connection', () => {
  it('opens a file database with WAL and enforced foreign keys but no application schema', () => {
    const database = connect();
    expect(database.open).toBe(true);
    expect(database.inTransaction).toBe(false);
    expect(database.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(database.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).toEqual([]);
  });

  it('enforces foreign keys on writes rather than just reporting a pragma', () => {
    const database = connect();
    database.exec('CREATE TABLE parents(id INTEGER PRIMARY KEY); CREATE TABLE children(parent_id INTEGER REFERENCES parents(id))');
    expect(() => database.prepare('INSERT INTO children VALUES (?)').run(1)).toThrow(/FOREIGN KEY/);
    database.prepare('INSERT INTO parents VALUES (?)').run(1);
    expect(database.prepare('INSERT INTO children VALUES (?)').run(1).changes).toBe(1);
    expect(() => database.prepare('DELETE FROM parents WHERE id=?').run(1)).toThrow(/FOREIGN KEY/);
  });

  it('persists committed Unicode values across close and reopen', () => {
    const database = connect(join(directory, '日本語 metadata.sqlite3'));
    database.exec('CREATE TABLE notes(value TEXT NOT NULL)');
    database.prepare('INSERT INTO notes VALUES (?)').run('教師データ · 確認');
    database.close();
    expect(database.open).toBe(false);
    expect(() => database.prepare('SELECT 1')).toThrow();
    const reopened = connect(join(directory, '日本語 metadata.sqlite3'));
    expect(reopened.prepare('SELECT value FROM notes').get()).toEqual({ value: '教師データ · 確認' });
    expect(reopened.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('does not commit an unfinished transaction on close', () => {
    const database = connect();
    database.exec('CREATE TABLE notes(value TEXT); BEGIN IMMEDIATE; INSERT INTO notes VALUES (\'unfinished\')');
    expect(database.inTransaction).toBe(true);
    database.close();
    expect(connect().prepare('SELECT * FROM notes').all()).toEqual([]);
  });

  it('allows WAL readers but serializes SQLite writes', () => {
    const first = connect();
    first.exec('CREATE TABLE notes(value TEXT)');
    const second = connect();
    second.pragma('busy_timeout = 0');
    first.exec("BEGIN IMMEDIATE; INSERT INTO notes VALUES ('pending')");
    expect(second.prepare('SELECT * FROM notes').all()).toEqual([]);
    expect(() => second.exec("INSERT INTO notes VALUES ('conflicting')")).toThrow(/locked/);
    first.exec('COMMIT');
    expect(second.prepare('SELECT * FROM notes').all()).toEqual([{ value: 'pending' }]);
  });

  it.each(['', ':memory:', '.', 'relative.sqlite3', 'C:relative.sqlite3', 'bad\0path'])('rejects non-persistent or relative input %j', (path) => {
    expect(() => openDatabase(path)).toThrow(TypeError);
  });

  it('does not silently create missing parent folders', () => {
    expect(() => connect(join(directory, 'missing', 'metadata.sqlite3'))).toThrow();
  });

  it('does not replace a corrupt input file with an empty database', () => {
    const path = join(directory, 'corrupt.sqlite3');
    const original = Buffer.from('not a SQLite database');
    writeFileSync(path, original);
    expect(() => connect(path)).toThrow();
    expect(readFileSync(path)).toEqual(original);
  });

  it('closes a connection when pragma initialization throws', () => {
    const require = createRequire(import.meta.url);
    const NativeDatabase = require('better-sqlite3') as { prototype: DatabaseConnection };
    const close = vi.spyOn(NativeDatabase.prototype, 'close');
    const failure = new Error('pragma initialization failed');
    vi.spyOn(NativeDatabase.prototype, 'pragma').mockImplementationOnce(() => { throw failure; });
    expect(() => connect()).toThrow(failure);
    expect(close).toHaveBeenCalledOnce();
    expect((close.mock.instances[0] as DatabaseConnection).open).toBe(false);
  });

  it.each([0, 'delete'])('closes when required pragmas are not effective (%s)', (actual) => {
    const require = createRequire(import.meta.url);
    const NativeDatabase = require('better-sqlite3') as { prototype: DatabaseConnection };
    const close = vi.spyOn(NativeDatabase.prototype, 'close');
    const original = NativeDatabase.prototype.pragma;
    vi.spyOn(NativeDatabase.prototype, 'pragma').mockImplementation(function (this: DatabaseConnection, sql, options) {
      if (actual === 0 && sql === 'foreign_keys') return 0;
      if (actual === 'delete' && sql === 'journal_mode = WAL') return 'delete';
      return original.call(this, sql, options);
    });
    expect(() => connect()).toThrow(/could not be enabled/);
    expect(close).toHaveBeenCalledOnce();
    expect((close.mock.instances[0] as DatabaseConnection).open).toBe(false);
  });
});