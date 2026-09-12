// @vitest-environment node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import { openDatabase, type DatabaseConnection } from '../db/database.js';
import { migrateDatabase, type Migration } from '../db/migrate.js';
import { getVersionChangeOperation, prepareVersionChange, VersionPreparationError, type PreparedVersionChange } from './version-compatibility.js';

describe('product version admission (PKG-09B)', () => {
  it.each([
    ['0.0.0', '0.0.0', 'repair'], ['0.1.0', '0.1.0', 'repair'], ['1.2.3', '1.2.3', 'repair'],
    ['0.1.0', '0.1.1', 'upgrade'], ['0.9.0', '0.10.0', 'upgrade'], ['9.999.999', '10.0.0', 'upgrade'],
    ['9007199254740992.0.0', '9007199254740993.0.0', 'upgrade'],
  ] as const)('admits %s → %s only as %s', (installed, target, expected) => {
    expect(getVersionChangeOperation(installed, target)).toBe(expected);
  });

  it.each([
    ['0.1.1', '0.1.0'], ['0.10.0', '0.9.999'], ['2.0.0', '1.999.999'],
    ['9007199254740993.0.0', '9007199254740992.999.999'],
  ])('rejects downgrade %s → %s', (installed, target) => {
    expect(() => getVersionChangeOperation(installed, target)).toThrow(RangeError);
    expect(() => getVersionChangeOperation(installed, target)).toThrow('新しい版が導入済みのため、旧版への上書きはできません。');
  });

  it.each([
    { installed: undefined, target: '1.0.0' }, { installed: '1.0.0', target: undefined },
    { installed: null, target: '1.0.0' }, { installed: '1.0.0', target: null },
    { installed: 'v1.0.0', target: '2.0.0' }, { installed: '1.0.0', target: '2.0.0-beta' },
    { installed: '1.0.0\n', target: '2.0.0' }, { installed: '1.0.0', target: '2.0.0\n' },
    { installed: '01.0.0', target: '2.0.0' }, { installed: '1.0.0', target: '2.0.0+build' },
  ])('rejects unknown/invalid release metadata %# before considering any DB state', ({ installed, target }) => {
    expect(() => getVersionChangeOperation(installed, target)).toThrow(TypeError);
  });

  it.each([
    { installed: '1.0.0', target: '0.9.0', error: RangeError },
    { installed: 'bad', target: '1.0.0', error: TypeError },
    { installed: '1.0.0', target: 'bad', error: TypeError },
  ])('does not access connection, history or backup path after rejected admission %#', async ({ installed, target, error }) => {
    const read = vi.fn(() => { throw new Error('DB_MUST_NOT_BE_ACCESSED'); });
    const connection = new Proxy({} as DatabaseConnection, { get: read });
    const history = new Proxy([] as Migration[], { get: read });
    await expect(prepareVersionChange(installed, target, connection, history, 'not-a-path')).rejects.toBeInstanceOf(error);
    expect(read).not.toHaveBeenCalled();
  });
});

describe('real database version preparation (PKG-09B)', () => {
  const nativeRequire = createRequire(import.meta.url);
  const NativeDatabase = nativeRequire('better-sqlite3') as new (
    path: string, options: { readonly: boolean; fileMustExist: true },
  ) => DatabaseConnection;
  const history: readonly Migration[] = [
    { version: 1, sql: 'CREATE TABLE notes(id INTEGER PRIMARY KEY, value TEXT NOT NULL)' },
    { version: 2, sql: 'ALTER TABLE notes ADD COLUMN migrated INTEGER NOT NULL DEFAULT 1' },
  ];
  const oldRows = [{ id: 7, value: '教師データの保持 🌾' }];
  const connections: DatabaseConnection[] = [];
  let directory: string, backupDirectory: string, source: string, database: DatabaseConnection;
  const rows = (db = database) => db.prepare('SELECT id,value FROM notes ORDER BY id').all();
  function checkOld(db = database) {
    expect(db.pragma('user_version', { simple: true })).toBe(1);
    expect(db.inTransaction).toBe(false); expect(rows(db)).toEqual(oldRows);
    expect(db.prepare('SELECT name FROM pragma_table_info(\'notes\')').all()).toEqual([{ name: 'id' }, { name: 'value' }]);
  }
  function backupPath() {
    const names = readdirSync(backupDirectory); expect(names).toHaveLength(1);
    return join(backupDirectory, names[0], 'metadata.sqlite3');
  }
  function checkBackup() {
    const path = backupPath(), bytes = readFileSync(path), db = new NativeDatabase(path, { readonly: true, fileMustExist: true });
    connections.push(db); checkOld(db); db.close(); expect(readFileSync(path)).toEqual(bytes);
    return path;
  }
  function reopen() {
    database.close(); database = openDatabase(source); connections.push(database); return database;
  }
  async function failure(migrations: readonly Migration[] = history, installed = '0.1.0', target = '0.2.0') {
    try { await prepareVersionChange(installed, target, database, migrations, backupDirectory); }
    catch (error) {
      expect(error).toBeInstanceOf(VersionPreparationError);
      const result = error as VersionPreparationError;
      expect(result.code).toBe('PRODUCT_UPDATE_PREPARATION_FAILED'); expect(result.canStart).toBe(false);
      expect(result.rollbackStatus).toBe('unconfirmed'); expect(result.message).toContain('復旧完了は未確認');
      expect(result.message).not.toContain('PRIVATE_NATIVE_PATH'); return result;
    }
    throw new Error('Expected preparation failure');
  }

  beforeEach(() => {
    directory = realpathSync(mkdtempSync(join(tmpdir(), 'autovision-pkg09b-')));
    backupDirectory = join(directory, 'backups'); mkdirSync(backupDirectory);
    source = join(directory, 'metadata.sqlite3'); database = openDatabase(source); connections.push(database);
    migrateDatabase(database, history.slice(0, 1));
    database.prepare('INSERT INTO notes(id,value) VALUES (?,?)').run(oldRows[0].id, oldRows[0].value);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    for (const db of connections.splice(0)) if (db.open) db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it.each(['repair', 'upgrade'] as const)('backs up the actual old schema before pending SQL for %s, preserving rows on reopen', async (operation) => {
    const target = operation === 'repair' ? '0.1.0' : '0.2.0', native = database.backup.bind(database);
    const backup = vi.spyOn(database, 'backup').mockImplementation((path, options) => {
      checkOld(); return native(path, options);
    });
    const result = await prepareVersionChange('0.1.0', target, database, history, backupDirectory);
    expectTypeOf(result).toEqualTypeOf<PreparedVersionChange>();
    expect(result.operation).toBe(operation); expect(result.schemaVersion).toBe(2); expect(Object.isFrozen(result)).toBe(true);
    expect(Object.keys(result)).toEqual(['operation', 'schemaVersion', 'backup']);
    expect(backup).toHaveBeenCalledTimes(1); expect(result.backup?.path).toBe(checkBackup());
    expect(result.backup?.version).toBe(1);
    expect(result.backup?.sha256).toBe(createHash('sha256').update(readFileSync(result.backup!.path)).digest('hex'));
    expect(database.open).toBe(true); expect(rows()).toEqual(oldRows);
    expect(database.prepare('SELECT migrated FROM notes').all()).toEqual([{ migrated: 1 }]);
    reopen(); expect(database.pragma('user_version', { simple: true })).toBe(2); expect(rows()).toEqual(oldRows);
  });

  it.each(['repair', 'upgrade'] as const)('validates an already-applied schema without creating a new backup for %s', async (operation) => {
    migrateDatabase(database, history); const backup = vi.spyOn(database, 'backup');
    await expect(prepareVersionChange('0.1.0', operation === 'repair' ? '0.1.0' : '0.2.0', database, history, ''))
      .resolves.toEqual({ operation, schemaVersion: 2, backup: null });
    expect(backup).not.toHaveBeenCalled(); expect(readdirSync(backupDirectory)).toEqual([]);
    expect(rows()).toEqual(oldRows); expect(database.open).toBe(true);
  });

  it.each(['repair', 'upgrade'] as const)('does not infer DB compatibility from a permitted %s product version', async (operation) => {
    database.pragma('user_version = 3'); const backup = vi.spyOn(database, 'backup'), exec = vi.spyOn(database, 'exec');
    const error = await failure(history, '0.1.0', operation === 'repair' ? '0.1.0' : '0.2.0');
    expect(error.operation).toBe(operation); expect(error.cause).toBeInstanceOf(Error);
    expect(backup).not.toHaveBeenCalled(); expect(exec).not.toHaveBeenCalled();
    expect(database.pragma('user_version', { simple: true })).toBe(3); expect(rows()).toEqual(oldRows);
    expect(readdirSync(backupDirectory)).toEqual([]);
  });

  it('does not touch an existing DB on downgrade rejection', async () => {
    const backup = vi.spyOn(database, 'backup'), exec = vi.spyOn(database, 'exec'), pragma = vi.spyOn(database, 'pragma');
    await expect(prepareVersionChange('1.0.0', '0.9.0', database, history, backupDirectory)).rejects.toBeInstanceOf(RangeError);
    expect(backup).not.toHaveBeenCalled(); expect(exec).not.toHaveBeenCalled(); expect(pragma).not.toHaveBeenCalled();
    expect(readdirSync(backupDirectory)).toEqual([]); checkOld();
  });

  it('waits for native backup before SQL without owning a long transaction, and uses the captured history', async () => {
    let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
    const native = database.backup.bind(database), mutable = history.map((m) => ({ ...m }));
    vi.spyOn(database, 'backup').mockImplementationOnce(async (path, options) => { await gate; return native(path, options); });
    const exec = vi.spyOn(database, 'exec'), pending = prepareVersionChange('0.1.0', '0.2.0', database, mutable, backupDirectory);
    try {
      expect(exec).not.toHaveBeenCalled(); expect(database.inTransaction).toBe(false); checkOld();
      mutable[1].sql = 'DROP TABLE notes';
    } finally { release(); }
    expect((await pending).schemaVersion).toBe(2); expect(rows()).toEqual(oldRows); checkBackup();
  });

  it('preserves a native backup failure as a private cause and never starts SQL or claims rollback', async () => {
    const cause = new Error('PRIVATE_NATIVE_PATH'); vi.spyOn(database, 'backup').mockRejectedValueOnce(cause);
    const exec = vi.spyOn(database, 'exec'); expect((await failure()).cause).toBe(cause);
    expect(exec).not.toHaveBeenCalled(); checkOld();
    expect(existsSync(backupPath())).toBe(false); // The unpublished attempt is retained by REL-02.
    expect(database.open).toBe(true);
  });

  it('retains the completed backup after SQL failure and verifies old data on reopen without claiming old-app restoration', async () => {
    const bad = { version: 3, sql: 'CREATE TABLE partial(value TEXT); INSERT INTO missing_table VALUES (1)' };
    const error = await failure([...history, bad]);
    expect(error.cause).toBeInstanceOf(Error); checkOld(); checkBackup();
    expect(database.prepare("SELECT name FROM sqlite_master WHERE name='partial'").get()).toBeUndefined();
    reopen(); checkOld(); expect(error.rollbackStatus).toBe('unconfirmed');
  });

  it('retains both causes and leaves a failed rollback for the connection owner, not a second automatic attempt', async () => {
    const native = database.exec.bind(database), rollbackFailure = new Error('PRIVATE_NATIVE_PATH');
    const exec = vi.spyOn(database, 'exec').mockImplementation((sql) => {
      if (sql === 'ROLLBACK') throw rollbackFailure;
      return native(sql);
    });
    const error = await failure([...history, { version: 3, sql: 'INSERT INTO absent_table VALUES (1)' }]);
    expect(error.cause).toBeInstanceOf(AggregateError);
    expect((error.cause as AggregateError).errors[1]).toBe(rollbackFailure);
    expect(exec.mock.calls.filter(([sql]) => sql === 'ROLLBACK')).toHaveLength(1);
    expect(database.inTransaction).toBe(true); checkBackup();
    exec.mockRestore(); database.exec('ROLLBACK'); checkOld();
  });

  it('does not restore or report rollback after COMMIT succeeded but its acknowledgement failed', async () => {
    const native = database.exec.bind(database), ackFailure = new Error('PRIVATE_NATIVE_PATH');
    const exec = vi.spyOn(database, 'exec').mockImplementation((sql) => {
      const result = native(sql); if (sql === 'COMMIT') throw ackFailure; return result;
    });
    const error = await failure(); expect(error.cause).toBe(ackFailure); expect(error.rollbackStatus).toBe('unconfirmed');
    expect(exec.mock.calls.filter(([sql]) => sql === 'ROLLBACK')).toHaveLength(0);
    expect(database.inTransaction).toBe(false); expect(database.pragma('user_version', { simple: true })).toBe(2);
    expect(rows()).toEqual(oldRows); checkBackup();
    exec.mockRestore(); reopen(); expect(database.pragma('user_version', { simple: true })).toBe(2);
  });

  it('rejects a borrowed transaction without committing, rolling it back, backing up or closing the connection', async () => {
    database.exec("BEGIN IMMEDIATE; INSERT INTO notes VALUES (8,'uncommitted')");
    const backup = vi.spyOn(database, 'backup'), exec = vi.spyOn(database, 'exec');
    await failure(); expect(backup).not.toHaveBeenCalled(); expect(exec).not.toHaveBeenCalled();
    expect(database.inTransaction).toBe(true); expect(database.open).toBe(true); expect(rows()).toHaveLength(2);
    database.exec('ROLLBACK'); checkOld(); expect(readdirSync(backupDirectory)).toEqual([]);
  });

  it('rejects a closed connection without preparing or opening a replacement', async () => {
    database.close(); const backup = vi.spyOn(database, 'backup');
    await failure(); expect(database.open).toBe(false); expect(backup).not.toHaveBeenCalled();
    expect(readdirSync(backupDirectory)).toEqual([]); reopen(); checkOld();
  });

  it('preserves REL-02 duplicate-work exclusion without creating a second backup or retrying', async () => {
    let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
    const native = database.backup.bind(database), backup = vi.spyOn(database, 'backup')
      .mockImplementationOnce(async (path, options) => { await gate; return native(path, options); });
    const first = prepareVersionChange('0.1.0', '0.2.0', database, history, backupDirectory);
    try { await failure(); expect(backup).toHaveBeenCalledTimes(1); expect(database.inTransaction).toBe(false); }
    finally { release(); }
    expect((await first).schemaVersion).toBe(2); expect(readdirSync(backupDirectory)).toHaveLength(1);
  });

  it('rejects invalid bundled history before any backup or migration', async () => {
    const backup = vi.spyOn(database, 'backup'), exec = vi.spyOn(database, 'exec');
    const error = await failure([{ version: 2, sql: 'DROP TABLE notes' }]);
    expect(error.cause).toBeInstanceOf(TypeError); expect(backup).not.toHaveBeenCalled(); expect(exec).not.toHaveBeenCalled();
    expect(readdirSync(backupDirectory)).toEqual([]); checkOld();
  });
});