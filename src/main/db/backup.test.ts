// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync, fsyncSync, linkSync, lstatSync, mkdirSync, mkdtempSync, openSync,
  readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, parse, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { migrateDatabaseWithBackup } from './backup.js';
import { openDatabase, type DatabaseConnection } from './database.js';
import { migrateDatabase, type Migration } from './migrate.js';

// Only fault boundaries are mocked; connections, WAL and backup use real SQLite.
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return { ...actual, randomUUID: vi.fn(actual.randomUUID) };
});
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, openSync: vi.fn(actual.openSync), linkSync: vi.fn(actual.linkSync), fsyncSync: vi.fn(actual.fsyncSync) };
});

const require = createRequire(import.meta.url);
const actualFs = require('node:fs') as typeof import('node:fs');
const actualCrypto = require('node:crypto') as typeof import('node:crypto');
type NativeConnection = DatabaseConnection & { readonly readonly: boolean };
const NativeDatabase = require('better-sqlite3') as new (
  path: string, options: { readonly: boolean; fileMustExist: true },
) => NativeConnection;
const connections: DatabaseConnection[] = [];
const history: readonly Migration[] = [
  { version: 1, sql: 'CREATE TABLE notes(value TEXT NOT NULL)' },
  { version: 2, sql: "ALTER TABLE notes ADD COLUMN upgraded INTEGER NOT NULL DEFAULT 1; UPDATE notes SET value = value || ' upgraded'" },
];
const oldRows = [{ rowid: 7, value: '教師データ · 確認' }, { rowid: 41, value: '日本語 😀' }];
const fixedUuid = '11111111-1111-4111-8111-111111111111';
let directory: string;
let backupDirectory: string;
let sourcePath: string;
let database: DatabaseConnection;

function connect(path: string): DatabaseConnection {
  const connection = openDatabase(path);
  connections.push(connection);
  return connection;
}
function snapshot(path: string): NativeConnection {
  const connection = new NativeDatabase(path, { readonly: true, fileMustExist: true });
  connections.push(connection);
  return connection;
}
function rows(connection = database) {
  return connection.prepare('SELECT rowid, value FROM notes ORDER BY rowid').all();
}
function expectOldSource() {
  expect(database.pragma('user_version', { simple: true })).toBe(1);
  expect(database.inTransaction).toBe(false);
  expect(rows()).toEqual(oldRows);
  expect(database.prepare('SELECT name FROM pragma_table_info(\'notes\')').all()).toEqual([{ name: 'value' }]);
}
function attemptDirectory() {
  const entries = readdirSync(backupDirectory);
  expect(entries).toHaveLength(1);
  return join(backupDirectory, entries[0]);
}
function completedSnapshot() {
  const child = attemptDirectory();
  expect(readdirSync(child).sort()).toEqual(['backup.json', 'metadata.sqlite3']);
  return join(child, 'metadata.sqlite3');
}
function conflictingOutput(path: string, kind: string) {
  const outside = join(directory, 'unrelated.txt');
  writeFileSync(outside, 'unrelated original');
  if (kind === 'hardlink') actualFs.linkSync(outside, path);
  else if (kind === 'junction') {
    const target = join(directory, 'unrelated-directory');
    mkdirSync(target);
    symlinkSync(target, path, 'junction');
  } else writeFileSync(path, kind === 'empty' ? '' : 'existing output', { flag: 'wx' });
}

beforeEach(() => {
  vi.mocked(randomUUID).mockReset().mockImplementation(actualCrypto.randomUUID);
  vi.mocked(openSync).mockReset().mockImplementation(actualFs.openSync);
  vi.mocked(linkSync).mockReset().mockImplementation(actualFs.linkSync);
  vi.mocked(fsyncSync).mockReset().mockImplementation(actualFs.fsyncSync);
  directory = realpathSync(mkdtempSync(join(tmpdir(), 'autovision-rel02-')));
  backupDirectory = join(directory, 'backups 日本語');
  mkdirSync(backupDirectory);
  sourcePath = join(directory, 'metadata 日本語.sqlite3');
  database = connect(sourcePath);
  migrateDatabase(database, history.slice(0, 1));
  database.pragma('wal_autocheckpoint = 0');
  database.pragma('wal_checkpoint(TRUNCATE)');
  for (const row of oldRows) database.prepare('INSERT INTO notes(rowid, value) VALUES (?, ?)').run(row.rowid, row.value);
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const connection of connections.splice(0)) if (connection.open) connection.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('REL-02 backup before migration', () => {
  it('captures real WAL, Unicode and implicit rowids before SQL and retains a read-only old-version snapshot', async () => {
    expect(statSync(`${sourcePath}-wal`).size).toBeGreaterThan(32);
    const mainBytes = readFileSync(sourcePath);
    const checkpointOnly = join(directory, 'checkpoint-only.sqlite3');
    writeFileSync(checkpointOnly, mainBytes);
    expect(rows(snapshot(checkpointOnly))).toEqual([]); // The two rows exist only in WAL.
    const backup = vi.spyOn(database, 'backup');
    const result = await migrateDatabaseWithBackup(database, history, backupDirectory);
    expect(result.version).toBe(2);
    expect(backup).toHaveBeenCalledOnce();
    expect(result.backup).not.toBeNull();
    const saved = result.backup!;
    expect(saved.path).toBe(completedSnapshot());
    expect(saved.version).toBe(1);
    const savedBytes = readFileSync(saved.path);
    expect(saved.sha256).toBe(createHash('sha256').update(savedBytes).digest('hex'));
    expect(JSON.parse(readFileSync(join(dirname(saved.path), 'backup.json'), 'utf8'))).toEqual({
      file: 'metadata.sqlite3', version: 1, sha256: saved.sha256,
    });
    expect(Object.isFrozen(saved)).toBe(true);
    expect(lstatSync(saved.path, { bigint: true }).nlink).toBe(1n);
    const old = snapshot(saved.path);
    expect(old.readonly).toBe(true);
    expect(old.pragma('journal_mode', { simple: true })).toBe('delete');
    expect(old.pragma('quick_check', { simple: true })).toBe('ok');
    expect(old.pragma('user_version', { simple: true })).toBe(1);
    expect(rows(old)).toEqual(oldRows);
    expect(() => old.exec("INSERT INTO notes VALUES ('forbidden')")).toThrow(/readonly/i);
    old.close();
    expect(readFileSync(saved.path)).toEqual(savedBytes);
    expect(readdirSync(dirname(saved.path)).sort()).toEqual(['backup.json', 'metadata.sqlite3']);
    expect(rows()).toEqual(oldRows.map((row) => ({ ...row, value: `${row.value} upgraded` })));
    expect(database.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(database.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('backs up an empty persistent database before its first schema creation', async () => {
    const fresh = connect(join(directory, 'fresh.sqlite3'));
    const result = await migrateDatabaseWithBackup(fresh, history.slice(0, 1), backupDirectory);
    const old = snapshot(result.backup!.path);
    expect(result.version).toBe(1);
    expect(result.backup!.version).toBe(0);
    expect(old.pragma('user_version', { simple: true })).toBe(0);
    expect(old.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).toEqual([]);
  });

  it('rolls back every pending change, preserves the original SQLite error and keeps the completed backup', async () => {
    const badSql = 'CREATE TABLE partial(value TEXT); INSERT INTO missing_table VALUES (1)';
    const exec = database.exec.bind(database);
    let originalError: unknown;
    vi.spyOn(database, 'exec').mockImplementation((sql) => {
      try { return exec(sql); } catch (error) { if (sql === badSql) originalError = error; throw error; }
    });
    const failure = await migrateDatabaseWithBackup(database, [...history, { version: 3, sql: badSql }], backupDirectory)
      .catch((error: unknown) => error);
    expect(originalError).toBeInstanceOf(Error);
    expect(failure).toBe(originalError);
    expectOldSource();
    expect(database.prepare("SELECT name FROM sqlite_master WHERE name='partial'").get()).toBeUndefined();
    expect(rows(snapshot(completedSnapshot()))).toEqual(oldRows);
    database.close();
    database = connect(sourcePath);
    expectOldSource();
  });

  it('retains the completed backup when migration and rollback both fail', async () => {
    const rollbackError = new Error('rollback I/O failure');
    const exec = database.exec.bind(database);
    let migrationError: unknown;
    const fault = vi.spyOn(database, 'exec').mockImplementation((sql) => {
      if (sql === 'ROLLBACK') throw rollbackError;
      try { return exec(sql); } catch (error) { migrationError = error; throw error; }
    });
    try {
      const result = await migrateDatabaseWithBackup(database,
        [...history, { version: 3, sql: 'INSERT INTO absent_table VALUES (1)' }], backupDirectory)
        .catch((error: unknown) => error);
      expect(result).toBeInstanceOf(AggregateError);
      expect((result as AggregateError).errors[0]).toBe(migrationError);
      expect((result as AggregateError).errors[1]).toBe(rollbackError);
      expect(database.inTransaction).toBe(true);
      const saved = snapshot(completedSnapshot());
      expect(saved.pragma('user_version', { simple: true })).toBe(1);
      expect(rows(saved)).toEqual(oldRows);
    } finally {
      fault.mockRestore();
      if (database.inTransaction) database.exec('ROLLBACK');
    }
    expectOldSource();
  });

  it('blocks pending SQL on native backup failure and releases its locks for an explicit subsequent call', async () => {
    const failure = new Error('backup I/O failure');
    const backup = vi.spyOn(database, 'backup').mockRejectedValueOnce(failure);
    const exec = vi.spyOn(database, 'exec');
    await expect(migrateDatabaseWithBackup(database, history, backupDirectory)).rejects.toBe(failure);
    expect(exec).not.toHaveBeenCalled();
    expectOldSource();
    expect(existsSync(join(attemptDirectory(), 'backup.json'))).toBe(false);
    expect((await migrateDatabaseWithBackup(database, history, backupDirectory)).version).toBe(2);
    expect(backup).toHaveBeenCalledTimes(2);
    expect(readdirSync(backupDirectory)).toHaveLength(2);
  });

  it('makes no backup when all migrations are applied, even without a usable backup path', async () => {
    migrateDatabase(database, history);
    const backup = vi.spyOn(database, 'backup');
    await expect(migrateDatabaseWithBackup(database, history, '')).resolves.toEqual({ version: 2, backup: null });
    expect(backup).not.toHaveBeenCalled();
    expect(readdirSync(backupDirectory)).toEqual([]);
  });

  it('accepts an empty history only for schema zero without weakening the existing newer-schema guard', async () => {
    const fresh = connect(join(directory, 'fresh.sqlite3'));
    await expect(migrateDatabaseWithBackup(fresh, [], '')).resolves.toEqual({ version: 0, backup: null });
    await expect(migrateDatabaseWithBackup(database, [], backupDirectory)).rejects.toThrow(/newer than/);
    expect(readdirSync(backupDirectory)).toEqual([]);
    expectOldSource();
  });

  it('does not commit or roll back the caller transaction', async () => {
    database.exec('BEGIN IMMEDIATE; CREATE TABLE caller_table(value TEXT)');
    await expect(migrateDatabaseWithBackup(database, history, backupDirectory)).rejects.toThrow(/existing transaction/);
    expect(database.inTransaction).toBe(true);
    expect(database.prepare("SELECT name FROM sqlite_master WHERE name='caller_table'").get()).toBeDefined();
    expect(readdirSync(backupDirectory)).toEqual([]);
    database.exec('ROLLBACK');
  });

  it('rejects a closed connection without creating artifacts', async () => {
    database.close();
    await expect(migrateDatabaseWithBackup(database, history, backupDirectory)).rejects.toThrow(/open database/);
    expect(readdirSync(backupDirectory)).toEqual([]);
  });

  it('rejects non-file source databases for pending migrations', async () => {
    const memory = new NativeDatabase(':memory:', { readonly: false, fileMustExist: true });
    connections.push(memory);
    await expect(migrateDatabaseWithBackup(memory, history, backupDirectory)).rejects.toThrow(/absolute local paths/);
    expect(memory.pragma('user_version', { simple: true })).toBe(0);
    expect(readdirSync(backupDirectory)).toEqual([]);
  });

  it.each([
    { separate: false, alreadyApplied: false },
    { separate: true, alreadyApplied: false },
    { separate: false, alreadyApplied: true },
    { separate: true, alreadyApplied: true },
  ])('rejects duplicate work, including requests with no pending SQL (%j)', async ({ separate, alreadyApplied }) => {
    const second = separate ? connect(sourcePath) : database;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const native = database.backup.bind(database);
    vi.spyOn(database, 'backup').mockImplementationOnce(async (path, options) => { await gate; return native(path, options); });
    const first = migrateDatabaseWithBackup(database, history, backupDirectory);
    try {
      expect(database.inTransaction).toBe(false);
      expect(second.inTransaction).toBe(false);
      const requested = alreadyApplied ? history.slice(0, 1) : history;
      await expect(migrateDatabaseWithBackup(second, requested, backupDirectory)).rejects.toThrow(/already in progress/);
    } finally { release(); await first; }
    expect(readdirSync(backupDirectory)).toHaveLength(1);
  });

  it('copies the bundled history before awaiting native backup', async () => {
    const mutable = history.map((migration) => ({ ...migration }));
    const native = database.backup.bind(database);
    vi.spyOn(database, 'backup').mockImplementationOnce(async (path, options) => {
      mutable[1].sql = 'DROP TABLE notes';
      mutable.push({ version: 3, sql: 'SELECT 1' });
      return native(path, options);
    });
    expect((await migrateDatabaseWithBackup(database, mutable, backupDirectory)).version).toBe(2);
    expect(rows()).toEqual(oldRows.map((row) => ({ ...row, value: `${row.value} upgraded` })));
  });

  it.each(['version', 'other writer', 'own write', 'transaction'])('refuses migration after source changes: %s', async (change) => {
    const other = change === 'other writer' ? connect(sourcePath) : database;
    const native = database.backup.bind(database);
    const exec = vi.spyOn(database, 'exec');
    vi.spyOn(database, 'backup').mockImplementationOnce(async (path, options) => {
      const result = await native(path, options);
      if (change === 'version') database.pragma('user_version = 2');
      else {
        if (change === 'transaction') database.exec('BEGIN IMMEDIATE');
        other.prepare('INSERT INTO notes(rowid, value) VALUES (?, ?)').run(99, 'newer change');
      }
      return result;
    });
    await expect(migrateDatabaseWithBackup(database, history, backupDirectory)).rejects.toThrow(/Database changed/);
    expect(exec.mock.calls.map(([sql]) => sql)).not.toContain(history[1].sql);
    expect(database.pragma('user_version', { simple: true })).toBe(change === 'version' ? 2 : 1);
    expect(rows()).toEqual(change === 'version' ? oldRows : [...oldRows, { rowid: 99, value: 'newer change' }]);
    expect(existsSync(join(attemptDirectory(), 'metadata.sqlite3.partial'))).toBe(true);
    if (change === 'transaction') {
      expect(database.inTransaction).toBe(true);
      database.exec('ROLLBACK');
    }
  });

  it.each([
    { totalPages: 10, remainingPages: 10 },
    { totalPages: 11, remainingPages: 9 },
    { totalPages: 10, remainingPages: 11 },
    { totalPages: 10, remainingPages: NaN },
  ])('bounds non-progress/restart/invalid progress without retrying (%j)', async (second) => {
    const backup = vi.spyOn(database, 'backup').mockImplementationOnce(async (_path, { progress }) => {
      expect(progress({ totalPages: 10, remainingPages: 10 })).toBe(100);
      progress(second);
      throw new Error('Progress guard failed to reject');
    });
    await expect(migrateDatabaseWithBackup(database, history, backupDirectory)).rejects.toThrow(/no forward progress/);
    expect(backup).toHaveBeenCalledOnce();
    expectOldSource();
  });

  it('uses multiple real backup batches without leaving a transaction open', async () => {
    database.exec('CREATE TABLE payload(value BLOB); INSERT INTO payload VALUES (zeroblob(2097152))');
    const native = database.backup.bind(database);
    let callbacks = 0;
    vi.spyOn(database, 'backup').mockImplementationOnce((path, { progress }) => native(path, {
      progress(state) { callbacks += 1; expect(database.inTransaction).toBe(false); return progress(state); },
    }));
    const result = await migrateDatabaseWithBackup(database, history, backupDirectory);
    expect(callbacks).toBeGreaterThan(1);
    expect(snapshot(result.backup!.path).prepare('SELECT length(value) AS size FROM payload').get()).toEqual({ size: 2097152 });
  });

  it('rejects an incomplete native result before executing SQL', async () => {
    vi.spyOn(database, 'backup').mockResolvedValueOnce({ totalPages: 2, remainingPages: 1 });
    await expect(migrateDatabaseWithBackup(database, history, backupDirectory)).rejects.toThrow(/did not complete/);
    expectOldSource();
  });

  it.each(['empty', 'corrupt'])('rejects an invalid backup file (%s) and keeps it for owned cleanup', async (kind) => {
    const native = database.backup.bind(database);
    vi.spyOn(database, 'backup').mockImplementationOnce(async (path, options) => {
      const result = await native(path, options);
      writeFileSync(path, kind === 'empty' ? '' : 'not a SQLite database');
      return result;
    });
    await expect(migrateDatabaseWithBackup(database, history, backupDirectory)).rejects.toThrow();
    expectOldSource();
    expect(existsSync(join(attemptDirectory(), 'backup.json'))).toBe(false);
    expect(existsSync(join(attemptDirectory(), 'metadata.sqlite3.partial'))).toBe(true);
  });

  it('refuses a backup with the wrong actual user_version', async () => {
    const native = database.backup.bind(database);
    vi.spyOn(database, 'backup').mockImplementationOnce(async (path, options) => {
      const result = await native(path, options);
      const copy = new NativeDatabase(path, { readonly: false, fileMustExist: true });
      try { copy.pragma('user_version = 9'); } finally { copy.close(); }
      return result;
    });
    await expect(migrateDatabaseWithBackup(database, history, backupDirectory)).rejects.toThrow(/schema version mismatch/);
    expectOldSource();
  });

  it('requires a successful quick_check on the read-only reopened snapshot', async () => {
    const pragma = NativeDatabase.prototype.pragma;
    let checkedReadonly = false;
    vi.spyOn(NativeDatabase.prototype, 'pragma').mockImplementation(function (this: NativeConnection, sql, options) {
      if (this.readonly && sql === 'quick_check') { checkedReadonly = true; return 'corrupt page'; }
      return pragma.call(this, sql, options);
    });
    await expect(migrateDatabaseWithBackup(database, history, backupDirectory)).rejects.toThrow(/quick_check failed/);
    expect(checkedReadonly).toBe(true);
    expectOldSource();
  });

  it('detects byte changes during read-only validation with a second checksum', async () => {
    let path = '';
    const native = database.backup.bind(database);
    vi.spyOn(database, 'backup').mockImplementationOnce((destination, options) => { path = destination; return native(destination, options); });
    const pragma = NativeDatabase.prototype.pragma;
    vi.spyOn(NativeDatabase.prototype, 'pragma').mockImplementation(function (this: NativeConnection, sql, options) {
      const result = pragma.call(this, sql, options);
      if (this.readonly && sql === 'user_version') {
        const fd = actualFs.openSync(path, 'r+');
        try {
          const byte = Buffer.alloc(1);
          actualFs.readSync(fd, byte, 0, 1, 63);
          byte[0] ^= 1;
          actualFs.writeSync(fd, byte, 0, 1, 63);
          actualFs.fsyncSync(fd);
        } finally { actualFs.closeSync(fd); }
      }
      return result;
    });
    await expect(migrateDatabaseWithBackup(database, history, backupDirectory)).rejects.toThrow(/checksum changed/);
    expectOldSource();
  });

  it('blocks migration on snapshot durability failure', async () => {
    const failure = new Error('fsync failed');
    vi.mocked(fsyncSync).mockImplementationOnce(() => { throw failure; });
    await expect(migrateDatabaseWithBackup(database, history, backupDirectory)).rejects.toBe(failure);
    expectOldSource();
    expect(existsSync(join(attemptDirectory(), 'backup.json'))).toBe(false);
  });

  it('keeps staging and blocks migration when atomic publication fails', async () => {
    const failure = new Error('publication failed');
    vi.mocked(linkSync).mockImplementationOnce(() => { throw failure; });
    await expect(migrateDatabaseWithBackup(database, history, backupDirectory)).rejects.toBe(failure);
    expectOldSource();
    expect(readdirSync(attemptDirectory())).toEqual(['metadata.sqlite3.partial']);
  });

  it('keeps the verified snapshot but blocks SQL when its checksum receipt cannot be created', async () => {
    const failure = new Error('checksum receipt creation failed');
    vi.mocked(openSync).mockImplementation((path, flags, mode) => {
      if (String(path).endsWith(`${sep}backup.json`)) throw failure;
      return actualFs.openSync(path, flags, mode);
    });
    const exec = vi.spyOn(database, 'exec');
    await expect(migrateDatabaseWithBackup(database, history, backupDirectory)).rejects.toBe(failure);
    expect(exec).not.toHaveBeenCalled();
    expectOldSource();
    const child = attemptDirectory();
    expect(readdirSync(child)).toEqual(['metadata.sqlite3']);
    expect(rows(snapshot(join(child, 'metadata.sqlite3')))).toEqual(oldRows);
  });

  it.each(['', ':memory:', '.', 'relative.sqlite3', 'C:relative.sqlite3', 'bad\0path'])('rejects invalid backup path %j', async (path) => {
    const backup = vi.spyOn(database, 'backup');
    await expect(migrateDatabaseWithBackup(database, history, path)).rejects.toBeInstanceOf(TypeError);
    expect(backup).not.toHaveBeenCalled();
    expectOldSource();
    expect(readdirSync(backupDirectory)).toEqual([]);
  });

  it.each(['live file', 'same root', 'filesystem root', 'missing root', 'parent traversal', 'regular file'])('rejects unsafe backup root: %s', async (kind) => {
    const file = join(directory, 'ordinary-file');
    writeFileSync(file, 'keep');
    const paths: Record<string, string> = {
      'live file': sourcePath, 'same root': directory, 'filesystem root': parse(directory).root,
      'missing root': join(directory, 'missing'), 'parent traversal': `${backupDirectory}${sep}..`, 'regular file': file,
    };
    const backup = vi.spyOn(database, 'backup');
    await expect(migrateDatabaseWithBackup(database, history, paths[kind])).rejects.toThrow();
    expect(backup).not.toHaveBeenCalled();
    expect(readFileSync(file, 'utf8')).toBe('keep');
    expectOldSource();
  });

  it.each([false, true])('rejects a junction in the destination chain (ancestor: %s)', async (ancestor) => {
    const target = join(directory, 'outside');
    mkdirSync(target);
    mkdirSync(join(target, 'child'));
    const alias = join(directory, 'alias');
    symlinkSync(target, alias, 'junction');
    const backup = vi.spyOn(database, 'backup');
    await expect(migrateDatabaseWithBackup(database, history, ancestor ? join(alias, 'child') : alias)).rejects.toThrow(/Linked/);
    expect(backup).not.toHaveBeenCalled();
    expect(readdirSync(target)).toEqual(['child']);
    expect(readdirSync(join(target, 'child'))).toEqual([]);
    expectOldSource();
  });

  it('rejects a hardlinked live DB before native backup', async () => {
    actualFs.linkSync(sourcePath, join(directory, 'source-alias.sqlite3'));
    const backup = vi.spyOn(database, 'backup');
    await expect(migrateDatabaseWithBackup(database, history, backupDirectory)).rejects.toThrow(/unlinked regular file/);
    expect(backup).not.toHaveBeenCalled();
    expectOldSource();
  });

  it.each(['empty', 'populated', 'file', 'junction'])('never adopts a preexisting UUID child (%s)', async (kind) => {
    vi.mocked(randomUUID).mockReturnValue(fixedUuid);
    const child = join(backupDirectory, fixedUuid);
    if (kind === 'file') writeFileSync(child, 'keep');
    else if (kind === 'junction') symlinkSync(directory, child, 'junction');
    else { mkdirSync(child); if (kind === 'populated') writeFileSync(join(child, 'keep.txt'), 'keep'); }
    const backup = vi.spyOn(database, 'backup');
    await expect(migrateDatabaseWithBackup(database, history, backupDirectory)).rejects.toThrow();
    expect(backup).not.toHaveBeenCalled();
    expect(lstatSync(child).isSymbolicLink()).toBe(kind === 'junction');
    if (kind === 'empty') expect(readdirSync(child)).toEqual([]);
    if (kind === 'populated') expect(readFileSync(join(child, 'keep.txt'), 'utf8')).toBe('keep');
    if (kind === 'file') expect(readFileSync(child, 'utf8')).toBe('keep');
    expectOldSource();
  });

  it.each(['empty', 'populated', 'hardlink', 'junction'])('exclusively creates staging without overwriting a raced %s output', async (kind) => {
    let conflict = '';
    vi.mocked(openSync).mockImplementationOnce((path, flags, mode) => {
      conflict = String(path);
      conflictingOutput(conflict, kind);
      return actualFs.openSync(path, flags, mode);
    });
    const backup = vi.spyOn(database, 'backup');
    await expect(migrateDatabaseWithBackup(database, history, backupDirectory)).rejects.toThrow();
    expect(backup).not.toHaveBeenCalled();
    expect(readFileSync(join(directory, 'unrelated.txt'), 'utf8')).toBe('unrelated original');
    if (kind === 'empty' || kind === 'populated') expect(readFileSync(conflict, 'utf8')).toBe(kind === 'empty' ? '' : 'existing output');
    expect(lstatSync(conflict).isSymbolicLink()).toBe(kind === 'junction');
    expectOldSource();
  });

  it.each(['empty', 'populated', 'hardlink', 'junction'])('publishes without clobbering a raced %s final output', async (kind) => {
    let conflict = '';
    vi.mocked(linkSync).mockImplementationOnce((from, to) => {
      conflict = String(to);
      conflictingOutput(conflict, kind);
      actualFs.linkSync(from, to);
    });
    await expect(migrateDatabaseWithBackup(database, history, backupDirectory)).rejects.toThrow();
    expect(readFileSync(join(directory, 'unrelated.txt'), 'utf8')).toBe('unrelated original');
    if (kind === 'empty' || kind === 'populated') expect(readFileSync(conflict, 'utf8')).toBe(kind === 'empty' ? '' : 'existing output');
    expect(lstatSync(conflict).isSymbolicLink()).toBe(kind === 'junction');
    expectOldSource();
  });

  it.each(['hardlink', 'junction', 'replaced'])('rejects an output substituted after native backup (%s) without deleting it', async (kind) => {
    const native = database.backup.bind(database);
    let replaced = '';
    vi.spyOn(database, 'backup').mockImplementationOnce(async (path, options) => {
      const result = await native(path, options);
      replaced = path;
      renameSync(path, `${path}.owned`);
      conflictingOutput(path, kind);
      return result;
    });
    await expect(migrateDatabaseWithBackup(database, history, backupDirectory)).rejects.toThrow(/replaced or linked/);
    expect(existsSync(`${replaced}.owned`)).toBe(true);
    expect(lstatSync(replaced).isSymbolicLink()).toBe(kind === 'junction');
    expect(readFileSync(join(directory, 'unrelated.txt'), 'utf8')).toBe('unrelated original');
    expectOldSource();
  });

  it.each([
    [{ version: 2, sql: 'SELECT 1' }],
    [{ version: 1, sql: 'SELECT 1' }, { version: 1, sql: 'SELECT 1' }],
    [{ version: 1, sql: 'SELECT 1' }, { version: 3, sql: 'SELECT 1' }],
    [{ version: 0, sql: 'SELECT 1' }],
    [{ version: 1.5, sql: 'SELECT 1' }],
    [{ version: NaN, sql: 'SELECT 1' }],
    [{ version: 1, sql: ' \n ' }],
    [{ version: 1, sql: 42 as unknown as string }],
  ])('rejects invalid complete history before backup, including already-applied entries (%j)', async (...migrations) => {
    const backup = vi.spyOn(database, 'backup');
    await expect(migrateDatabaseWithBackup(database, migrations, backupDirectory)).rejects.toBeInstanceOf(TypeError);
    expect(backup).not.toHaveBeenCalled();
    expect(readdirSync(backupDirectory)).toEqual([]);
    expectOldSource();
  });

  it.each([-1, 3])('does not back up or downgrade an incompatible schema (%s)', async (version) => {
    database.pragma(`user_version = ${version}`);
    const backup = vi.spyOn(database, 'backup');
    await expect(migrateDatabaseWithBackup(database, history, backupDirectory)).rejects.toThrow(/newer than, or incompatible/);
    expect(backup).not.toHaveBeenCalled();
    expect(database.pragma('user_version', { simple: true })).toBe(version);
    expect(database.inTransaction).toBe(false);
    expect(rows()).toEqual(oldRows);
    expect(readdirSync(backupDirectory)).toEqual([]);
  });
});