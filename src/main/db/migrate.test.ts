// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openDatabase, type DatabaseConnection } from './database.js';
import { migrateDatabase, type Migration } from './migrate.js';

let directory: string;
let database: DatabaseConnection;
const history: readonly Migration[] = [
  { version: 1, sql: 'CREATE TABLE notes(id INTEGER PRIMARY KEY, value TEXT NOT NULL)' },
  { version: 2, sql: "INSERT INTO notes(value) VALUES ('first')" },
];
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'autovision-core03-'));
  database = openDatabase(join(directory, 'metadata.sqlite3'));
});
afterEach(() => {
  vi.restoreAllMocks();
  if (database.open) database.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('bundled SQLite migrations', () => {
  it('applies SQL in order and persists its independent schema version', () => {
    expect(migrateDatabase(database, history)).toBe(2);
    expect(database.pragma('user_version', { simple: true })).toBe(2);
    expect(database.inTransaction).toBe(false);
    database.close();
    database = openDatabase(join(directory, 'metadata.sqlite3'));
    expect(database.pragma('user_version', { simple: true })).toBe(2);
    expect(database.prepare('SELECT * FROM notes').all()).toEqual([{ id: 1, value: 'first' }]);
  });

  it('does not reapply completed migrations', () => {
    migrateDatabase(database, history);
    expect(migrateDatabase(database, history)).toBe(2);
    expect(database.prepare('SELECT * FROM notes').all()).toHaveLength(1);
  });

  it('applies only new steps on upgrade without altering earlier data', () => {
    migrateDatabase(database, history.slice(0, 1));
    database.prepare('INSERT INTO notes(value) VALUES (?)').run('利用者の値');
    migrateDatabase(database, history);
    expect(database.prepare('SELECT value FROM notes ORDER BY id').all()).toEqual([
      { value: '利用者の値' }, { value: 'first' },
    ]);
  });

  it('rolls back all pending SQL and version changes if a later step fails', () => {
    migrateDatabase(database, history.slice(0, 1));
    database.prepare('INSERT INTO notes(value) VALUES (?)').run('keep');
    expect(() => migrateDatabase(database, [
      ...history,
      { version: 3, sql: 'CREATE TABLE temporary_table(value TEXT); INSERT INTO absent_table VALUES (1)' },
    ])).toThrow(/absent_table/);
    expect(database.inTransaction).toBe(false);
    expect(database.pragma('user_version', { simple: true })).toBe(1);
    expect(database.prepare('SELECT value FROM notes').all()).toEqual([{ value: 'keep' }]);
    expect(database.prepare("SELECT name FROM sqlite_master WHERE name='temporary_table'").get()).toBeUndefined();
    expect(migrateDatabase(database, history)).toBe(2);
  });

  it('preserves both actual migration and rollback failures without claiming recovery', () => {
    migrateDatabase(database, history.slice(0, 1));
    const rollbackError = new Error('injected rollback I/O failure');
    const exec = database.exec.bind(database);
    let migrationError: unknown;
    const fault = vi.spyOn(database, 'exec').mockImplementation((sql) => {
      if (sql === 'ROLLBACK') throw rollbackError;
      try { return exec(sql); } catch (error) { migrationError = error; throw error; }
    });
    try {
      let result: unknown;
      try {
        migrateDatabase(database, [...history, { version: 3, sql: 'INSERT INTO absent_table VALUES (1)' }]);
      } catch (error) { result = error; }
      expect(result).toBeInstanceOf(AggregateError);
      expect(migrationError).toBeInstanceOf(Error);
      expect((result as AggregateError).errors).toEqual([migrationError, rollbackError]);
      expect((result as AggregateError).errors[0]).toBe(migrationError);
      expect((result as AggregateError).errors[1]).toBe(rollbackError);
      expect(database.inTransaction).toBe(true);
    } finally {
      fault.mockRestore();
      if (database.inTransaction) database.exec('ROLLBACK');
    }
    expect(database.pragma('user_version', { simple: true })).toBe(1);
  });

  it('rolls back schema creation on a fresh database after a foreign-key violation', () => {
    expect(() => migrateDatabase(database, [
      { version: 1, sql: 'CREATE TABLE parents(id INTEGER PRIMARY KEY); CREATE TABLE children(parent_id INTEGER REFERENCES parents(id))' },
      { version: 2, sql: 'INSERT INTO children VALUES (99)' },
    ])).toThrow(/FOREIGN KEY/);
    expect(database.pragma('user_version', { simple: true })).toBe(0);
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).toEqual([]);
  });

  it.each([
    [{ version: 2, sql: 'SELECT 1' }],
    [{ version: 1, sql: 'SELECT 1' }, { version: 1, sql: 'SELECT 1' }],
    [{ version: 1, sql: 'SELECT 1' }, { version: 3, sql: 'SELECT 1' }],
    [{ version: 0, sql: 'SELECT 1' }],
    [{ version: 1.5, sql: 'SELECT 1' }],
    [{ version: NaN, sql: 'SELECT 1' }],
    [{ version: 1, sql: ' \n ' }],
  ])('rejects invalid migration history before changing the DB (%j)', (...migrations) => {
    expect(() => migrateDatabase(database, migrations)).toThrow(TypeError);
    expect(database.pragma('user_version', { simple: true })).toBe(0);
    expect(database.inTransaction).toBe(false);
  });

  it('refuses a newer schema rather than downgrading it', () => {
    migrateDatabase(database, history);
    expect(() => migrateDatabase(database, history.slice(0, 1))).toThrow(/newer than/);
    expect(database.pragma('user_version', { simple: true })).toBe(2);
    expect(database.prepare('SELECT * FROM notes').all()).toHaveLength(1);
    expect(database.inTransaction).toBe(false);
  });

  it('does not commit or roll back the caller transaction', () => {
    database.exec('BEGIN IMMEDIATE; CREATE TABLE caller_data(value TEXT)');
    expect(() => migrateDatabase(database, history)).toThrow(/existing transaction/);
    expect(database.inTransaction).toBe(true);
    expect(database.prepare("SELECT name FROM sqlite_master WHERE name='caller_data'").get()).toBeDefined();
    database.exec('ROLLBACK');
  });

  it('accepts an empty history only for a new database', () => {
    expect(migrateDatabase(database, [])).toBe(0);
    migrateDatabase(database, history);
    expect(() => migrateDatabase(database, [])).toThrow(/newer than/);
  });

  it('does not read an old version before acquiring the write lock', () => {
    const other = openDatabase(join(directory, 'metadata.sqlite3'));
    try {
      database.pragma('busy_timeout = 0');
      other.exec('BEGIN IMMEDIATE');
      const pragma = vi.spyOn(database, 'pragma');
      expect(() => migrateDatabase(database, history)).toThrow(/locked/);
      expect(pragma).not.toHaveBeenCalledWith('user_version', { simple: true });
      expect(database.inTransaction).toBe(false);
      other.exec('ROLLBACK');
      expect(migrateDatabase(database, history)).toBe(2);
    } finally {
      other.close();
    }
  });
});