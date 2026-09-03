import { writeSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

interface RunResult {
  readonly changes: number;
}

interface SmokeStatement {
  run(...parameters: unknown[]): RunResult;
  get(...parameters: unknown[]): unknown;
  all(...parameters: unknown[]): unknown[];
}

interface SmokeDatabase {
  readonly open: boolean;
  exec(source: string): this;
  prepare(source: string): SmokeStatement;
  transaction<TArguments extends unknown[], TResult>(
    operation: (...arguments_: TArguments) => TResult,
  ): (...arguments_: TArguments) => TResult;
  close(): this;
}

type DatabaseConstructor = new (filename: string) => SmokeDatabase;

export interface SqliteSmokeRow {
  readonly id: number;
  readonly name: string;
  readonly value: number;
}

export interface SqliteSmokeResult {
  readonly runtime: 'node' | 'electron';
  readonly platform: NodeJS.Platform;
  readonly architecture: string;
  readonly nodeVersion: string;
  readonly moduleAbi: string;
  readonly napiVersion: string;
  readonly electronVersion: string | null;
  readonly sqliteVersion: string;
  readonly rows: readonly SqliteSmokeRow[];
  readonly rollbackVerified: true;
  readonly closed: true;
}

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3') as DatabaseConstructor;
const rollbackSentinel = 'SPI-01 rollback sentinel';

function requireCondition(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

export function runSqliteSmoke(): SqliteSmokeResult {
  const database = new Database(':memory:');

  try {
    database.exec(`
      CREATE TABLE smoke_items (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        value INTEGER NOT NULL
      )
    `);

    const insert = database.prepare(
      'INSERT INTO smoke_items (name, value) VALUES (?, ?)',
    );
    requireCondition(insert.run('alpha', 1).changes === 1, 'INSERT alpha failed');
    requireCondition(insert.run('beta', 2).changes === 1, 'INSERT beta failed');

    const initialRow = database
      .prepare('SELECT id, name, value FROM smoke_items WHERE name = ?')
      .get('alpha') as SqliteSmokeRow | undefined;
    requireCondition(initialRow?.value === 1, 'SELECT after INSERT failed');

    const update = database.prepare('UPDATE smoke_items SET value = ? WHERE name = ?');
    requireCondition(update.run(42, 'alpha').changes === 1, 'UPDATE failed');

    const rollback = database.transaction(() => {
      insert.run('rolled-back', 99);
      throw new Error(rollbackSentinel);
    });

    try {
      rollback();
      throw new Error('Transaction unexpectedly committed');
    } catch (error) {
      if (!(error instanceof Error) || error.message !== rollbackSentinel) {
        throw error;
      }
    }

    const rolledBackRow = database
      .prepare('SELECT id FROM smoke_items WHERE name = ?')
      .get('rolled-back');
    requireCondition(rolledBackRow === undefined, 'Transaction rollback failed');

    const remove = database.prepare('DELETE FROM smoke_items WHERE name = ?');
    requireCondition(remove.run('beta').changes === 1, 'DELETE failed');

    const rows = database
      .prepare('SELECT id, name, value FROM smoke_items ORDER BY id')
      .all() as SqliteSmokeRow[];
    requireCondition(
      rows.length === 1 && rows[0]?.name === 'alpha' && rows[0].value === 42,
      'Final CRUD state is invalid',
    );

    const sqliteVersionRow = database
      .prepare('SELECT sqlite_version() AS version')
      .get() as { readonly version?: unknown } | undefined;
    requireCondition(
      typeof sqliteVersionRow?.version === 'string',
      'SQLite version was not reported',
    );

    database.close();
    requireCondition(!database.open, 'Database connection did not close');

    const electronVersion = (
      process.versions as NodeJS.ProcessVersions & { readonly electron?: string }
    ).electron;
    const moduleAbi = process.versions.modules;
    const napiVersion = process.versions.napi;
    requireCondition(typeof moduleAbi === 'string', 'Node module ABI was not reported');
    requireCondition(typeof napiVersion === 'string', 'Node-API version was not reported');

    return {
      runtime: electronVersion === undefined ? 'node' : 'electron',
      platform: process.platform,
      architecture: process.arch,
      nodeVersion: process.versions.node,
      moduleAbi,
      napiVersion,
      electronVersion: electronVersion ?? null,
      sqliteVersion: sqliteVersionRow.version,
      rows,
      rollbackVerified: true,
      closed: true,
    };
  } finally {
    if (database.open) {
      database.close();
    }
  }
}

function isDirectExecution(): boolean {
  const entryPath = process.argv[1];
  return (
    process.argv.includes('--autovision-sqlite-smoke') ||
    (entryPath !== undefined && import.meta.url === pathToFileURL(resolve(entryPath)).href)
  );
}

if (isDirectExecution()) {
  try {
    writeSync(1, `${JSON.stringify(runSqliteSmoke())}\n`);
    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeSync(2, `SPI-01 SQLite smoke failed: ${message}\n`);
    process.exit(1);
  }
}