import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync, fchmodSync, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync,
  openSync, readSync, readdirSync, unlinkSync, writeFileSync, type BigIntStats,
} from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import type { DatabaseConnection } from './database.js';
import { migrateDatabase, type Migration } from './migrate.js';

type Backup = Readonly<{ path: string; version: number; sha256: string }>;
type Directory = { path: string; identity: BigIntStats };
const activeConnections = new WeakSet<DatabaseConnection>();
const activeFiles = new Set<string>();
// 13.0.3 ships no declarations. Only the constructor options used here are typed.
const NativeDatabase = createRequire(import.meta.url)('better-sqlite3') as new (
  path: string, options: { readonly: boolean; fileMustExist: true },
) => DatabaseConnection;

function absolutePath(path: string): string {
  if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0')
    || path.trim() !== path || path.split(/[\\/]/).some((part) => part === '.' || part === '..')
    || (process.platform === 'win32' && (!/^[a-z]:[\\/]/i.test(path)
      || path.slice(2).includes(':') || path.split(/[\\/]/).some((part) => /[. ]$/.test(part))))) {
    throw new TypeError('Backup paths must be absolute local paths without aliases, traversal or NUL characters.');
  }
  return resolve(path);
}

function sameIdentity(first: BigIntStats, second: BigIntStats): boolean {
  return first.dev === second.dev && first.ino === second.ino;
}

function directories(path: string): Directory[] {
  const result: Directory[] = [];
  for (let current = absolutePath(path);; current = dirname(current)) {
    const identity = lstatSync(current, { bigint: true });
    if (!identity.isDirectory() || identity.isSymbolicLink()) throw new Error('Linked or non-directory backup path.');
    result.push({ path: current, identity });
    if (dirname(current) === current) return result;
  }
}

function checkDirectories(entries: readonly Directory[]): void {
  for (const entry of entries) {
    const current = lstatSync(entry.path, { bigint: true });
    if (!current.isDirectory() || current.isSymbolicLink() || !sameIdentity(current, entry.identity)) {
      throw new Error('Backup directory ownership changed.');
    }
  }
}

function ownedFile(path: string, fd: number, identity: BigIntStats, links = 1n): BigIntStats {
  const current = lstatSync(path, { bigint: true });
  const handle = fstatSync(fd, { bigint: true });
  if (!current.isFile() || current.isSymbolicLink() || current.nlink !== links || handle.nlink !== links
    || !sameIdentity(current, identity) || !sameIdentity(handle, identity)) {
    throw new Error('Backup file was replaced or linked.');
  }
  return handle;
}

function onlyFiles(directory: string, expected: readonly string[]): void {
  const names = readdirSync(directory);
  if (names.length !== expected.length || names.some((name) => !expected.includes(name))) {
    throw new Error('Preexisting or unexpected backup output; no files were removed.');
  }
}

function checksum(fd: number): string {
  const before = fstatSync(fd, { bigint: true });
  const size = Number(before.size);
  if (!Number.isSafeInteger(size) || size < 512) throw new Error('Invalid backup file size.');
  const hash = createHash('sha256');
  const chunk = Buffer.allocUnsafe(64 * 1024);
  for (let position = 0; position < size;) {
    const count = readSync(fd, chunk, 0, Math.min(chunk.length, size - position), position);
    if (count === 0) throw new Error('Backup was truncated while hashing.');
    hash.update(chunk.subarray(0, count));
    position += count;
  }
  const after = fstatSync(fd, { bigint: true });
  // Windows path/handle ctime can differ; compare the same handle before/after.
  if (before.size !== after.size || before.mtimeNs !== after.mtimeNs) throw new Error('Backup changed while hashing.');
  return hash.digest('hex');
}

function sourceState(database: DatabaseConnection): string {
  return JSON.stringify([
    database.pragma('user_version', { simple: true }), database.pragma('schema_version', { simple: true }),
    database.pragma('data_version', { simple: true }), database.prepare('SELECT total_changes() AS changes').get(),
  ]);
}

async function createBackup(database: DatabaseConnection, version: number, backupDirectory: string,
  sourcePath: string, checkSource: () => void): Promise<Backup> {
  const root = absolutePath(backupDirectory);
  const guards = directories(root);
  const sourceRelative = relative(root, sourcePath);
  if (dirname(root) === root || (sourceRelative !== '..' && !sourceRelative.startsWith(`..${sep}`)
    && !isAbsolute(sourceRelative))) throw new Error('Backup root must not contain the live database.');
  const directory = join(root, randomUUID());
  mkdirSync(directory, { mode: 0o700 }); // Exclusive: even an existing empty UUID directory is refused.
  guards.push({ path: directory, identity: lstatSync(directory, { bigint: true }) });
  const staging = join(directory, 'metadata.sqlite3.partial');
  const path = join(directory, 'metadata.sqlite3');
  const fd = openSync(staging, 'wx+', 0o600);
  try {
    const identity = fstatSync(fd, { bigint: true });
    onlyFiles(directory, [basename(staging)]);
    const checkOwnership = () => {
      checkDirectories(guards);
      ownedFile(staging, fd, identity);
    };
    checkOwnership();
    checkSource();
    let previous: { totalPages: number; remainingPages: number } | undefined;
    const result = await database.backup(staging, {
      progress(state) {
        checkSource();
        checkOwnership();
        if (!Number.isSafeInteger(state.totalPages) || !Number.isSafeInteger(state.remainingPages)
          || state.remainingPages <= 0 || state.remainingPages > state.totalPages
          || (previous && (state.totalPages !== previous.totalPages || state.remainingPages >= previous.remainingPages))) {
          throw new Error('Backup source changed or backup made no forward progress.');
        }
        previous = { ...state };
        return 100; // Installed API's default batch size; no retry loop or product-time SLA.
      },
    });
    checkOwnership();
    checkSource();
    if (result.remainingPages !== 0 || !Number.isSafeInteger(result.totalPages) || result.totalPages < 0) {
      throw new Error('Native backup did not complete.');
    }
    onlyFiles(directory, [basename(staging)]);
    // Finalize only our unpublished copy, never the live DB/WAL. A WAL source can
    // leave a WAL-format header; DELETE makes the snapshot independently readable.
    const stagingDatabase = new NativeDatabase(staging, { readonly: false, fileMustExist: true });
    try {
      if (stagingDatabase.pragma('journal_mode = DELETE', { simple: true }) !== 'delete') {
        throw new Error('Backup could not be finalized as a single file.');
      }
    } finally { stagingDatabase.close(); }
    onlyFiles(directory, [basename(staging)]);
    checkOwnership();
    fsyncSync(fd);
    const sha256 = checksum(fd);
    // Do not use openDatabase(): it would change the snapshot back to WAL.
    const snapshot = new NativeDatabase(staging, { readonly: true, fileMustExist: true });
    try {
      if (snapshot.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('Backup quick_check failed.');
      if (snapshot.pragma('user_version', { simple: true }) !== version) throw new Error('Backup schema version mismatch.');
    } finally { snapshot.close(); }
    checkOwnership();
    if (checksum(fd) !== sha256) throw new Error('Backup checksum changed during verification.');
    onlyFiles(directory, [basename(staging)]);
    checkSource();
    // Atomic, no-clobber publication. The sole temporary hardlink is between our
    // own names; verify both identities before removing only our staging name.
    linkSync(staging, path);
    ownedFile(staging, fd, identity, 2n);
    ownedFile(path, fd, identity, 2n);
    unlinkSync(staging);
    ownedFile(path, fd, identity);
    fchmodSync(fd, 0o400);
    fsyncSync(fd);
    const receipt = openSync(join(directory, 'backup.json'), 'wx', 0o600);
    try {
      writeFileSync(receipt, `${JSON.stringify({ file: basename(path), version, sha256 })}\n`, 'utf8');
      fchmodSync(receipt, 0o400);
      fsyncSync(receipt);
    } finally { closeSync(receipt); }
    checkDirectories(guards);
    ownedFile(path, fd, identity);
    onlyFiles(directory, [basename(path), 'backup.json']);
    return Object.freeze({ path, version, sha256 });
  } finally { closeSync(fd); }
}

/**
 * REL-02 / NFR-REL-002 / FR-INS-015 (DB portion), ADR-0002 §3.6.
 * Main supplies an existing, private directory under its userData (not cache or
 * a Renderer path). Main owns every exclusively-created UUID staging directory.
 * Caller MUST hold the application maintenance lock, quiesce ALL writer
 * connections, and prevent other access/replacement of these directories until
 * settlement. Path checks are not an ACL or a cross-process maintenance lock.
 * No source SQLite transaction spans the async native backup. Completed snapshots and
 * incomplete attempts are retained; only a verified snapshot has a backup.json
 * receipt. No cleanup of unknown files or live DB/WAL replacement is attempted.
 * migrateDatabase owns transactional recovery. Installer/old-app restore and
 * crash-time recovery orchestration remain release/PKG responsibilities.
 */
export async function migrateDatabaseWithBackup(database: DatabaseConnection, migrations: readonly Migration[],
  backupDirectory: string): Promise<{ version: number; backup: Backup | null }> {
  if (activeConnections.has(database)) throw new Error('Backup/migration is already in progress.');
  if (!database.open) throw new Error('Backup requires an open database.');
  if (database.inTransaction) throw new Error('Migrations cannot run inside an existing transaction.');
  activeConnections.add(database);
  let fileKey: string | undefined;
  try {
    // Mirror only the runner's input guard, before creating artifacts. Copy the
    // trusted bundled SQL so mutation while awaiting backup cannot change it.
    const history: Migration[] = [];
    for (const [index, { version, sql }] of migrations.entries()) {
      if (!Number.isSafeInteger(version) || version !== index + 1 || typeof sql !== 'string' || !sql.trim()) {
        throw new TypeError('Bundled migrations must contain non-empty SQL with consecutive versions starting at 1.');
      }
      history.push({ version, sql });
    }
    const current = database.pragma('user_version', { simple: true });
    if (typeof current !== 'number' || !Number.isSafeInteger(current) || current < 0 || current > history.length) {
      throw new Error('Database schema version is newer than, or incompatible with, this application.');
    }
    const main = (database.pragma('database_list') as { name: string; file: string }[]).find((entry) => entry.name === 'main');
    if (current === history.length) {
      if (main?.file && activeFiles.size > 0) {
        const file = lstatSync(main.file, { bigint: true });
        if (activeFiles.has(`${file.dev}:${file.ino}`)) throw new Error('Backup/migration is already in progress for this file.');
      }
      return { version: migrateDatabase(database, history), backup: null };
    }
    const sourcePath = absolutePath(main?.file ?? '');
    const guards = directories(dirname(sourcePath));
    const source = lstatSync(sourcePath, { bigint: true });
    if (!source.isFile() || source.nlink !== 1n) throw new Error('Live database must be an unlinked regular file.');
    const key = `${source.dev}:${source.ino}`;
    if (activeFiles.has(key)) throw new Error('Backup/migration is already in progress for this file.');
    activeFiles.add(key);
    fileKey = key;
    const initialState = sourceState(database);
    const checkSource = () => {
      if (!database.open || database.inTransaction || sourceState(database) !== initialState) {
        throw new Error('Database changed during backup; maintenance quiescence is required.');
      }
      checkDirectories(guards);
      const now = lstatSync(sourcePath, { bigint: true });
      if (!now.isFile() || now.nlink !== 1n || !sameIdentity(source, now)) throw new Error('Live database file changed.');
    };
    const backup = await createBackup(database, current, backupDirectory, sourcePath, checkSource);
    checkSource(); // No await between this check and the runner's BEGIN IMMEDIATE.
    // Its rollback keeps the old schema/data; propagate the original exception.
    return { version: migrateDatabase(database, history), backup };
  } finally {
    if (fileKey !== undefined) activeFiles.delete(fileKey);
    activeConnections.delete(database);
  }
}