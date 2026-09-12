import type { DatabaseConnection } from './database.js';

export interface Migration {
  readonly version: number;
  readonly sql: string;
}

/**
 * Applies the complete, bundled migration history. SQL is trusted application
 * DDL/DML, never user input; it must not manage transactions or user_version.
 * The caller performs the release backup (REL-02) before migrating a user DB.
 */
export function migrateDatabase(database: DatabaseConnection, migrations: readonly Migration[]): number {
  if (database.inTransaction) {
    throw new Error('Migrations cannot run inside an existing transaction.');
  }
  for (const [index, migration] of migrations.entries()) {
    if (!Number.isSafeInteger(migration.version) || migration.version !== index + 1
      || typeof migration.sql !== 'string' || migration.sql.trim().length === 0) {
      throw new TypeError('Bundled migrations must contain non-empty SQL with consecutive versions starting at 1.');
    }
  }

  // Read the version after taking the write lock, not before another writer
  // could apply the same migration. All pending steps commit or roll back together.
  database.exec('BEGIN IMMEDIATE');
  try {
    const current = database.pragma('user_version', { simple: true });
    if (typeof current !== 'number' || !Number.isSafeInteger(current)
      || current < 0 || current > migrations.length) {
      throw new Error('Database schema version is newer than, or incompatible with, this application.');
    }
    for (const migration of migrations.slice(current)) {
      database.exec(migration.sql);
      database.pragma(`user_version = ${migration.version}`);
    }
    database.exec('COMMIT');
    return migrations.length;
  } catch (error) {
    if (database.inTransaction) {
      try {
        database.exec('ROLLBACK');
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], 'Database migration and rollback both failed.');
      }
    }
    throw error;
  }
}