import { createRequire } from 'node:module';
import { isAbsolute } from 'node:path';

// The installed package has no declarations. Keep its used surface local to
// Main instead of exporting native database capabilities through AppApi.
export interface DatabaseConnection {
  readonly open: boolean;
  readonly inTransaction: boolean;
  backup(destination: string, options: {
    progress(state: { totalPages: number; remainingPages: number }): number;
  }): Promise<{ totalPages: number; remainingPages: number }>;
  exec(sql: string): this;
  pragma(sql: string, options?: { simple: boolean }): unknown;
  prepare(sql: string): {
    run(...parameters: unknown[]): { changes: number; lastInsertRowid: number | bigint };
    get(...parameters: unknown[]): unknown;
    all(...parameters: unknown[]): unknown[];
  };
  close(): this;
}

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3') as new (path: string) => DatabaseConnection;

/** The Main lifecycle owns this connection and closes it on shutdown (UIR-019). */
export function openDatabase(path: string): DatabaseConnection {
  if (typeof path !== 'string' || path.includes('\0') || !isAbsolute(path)) {
    throw new TypeError('Database path must be absolute and contain no NUL characters.');
  }

  const database = new Database(path);
  try {
    database.pragma('foreign_keys = ON');
    if (database.pragma('foreign_keys', { simple: true }) !== 1) {
      throw new Error('SQLite foreign key enforcement could not be enabled.');
    }
    if (database.pragma('journal_mode = WAL', { simple: true }) !== 'wal') {
      throw new Error('SQLite WAL journal mode could not be enabled.');
    }
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}