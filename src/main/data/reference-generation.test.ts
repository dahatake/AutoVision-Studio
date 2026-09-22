// @vitest-environment node
import childProcess from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ScanImage, ScanResult } from '../../shared/contracts/import.js';
import { openDatabase, type DatabaseConnection } from '../db/database.js';
import { migrateDatabase, type Migration } from '../db/migrate.js';
import {
  applyReferenceRelink,
  findDataImport,
  insertDataImport,
  prepareDataImport,
  prepareReferenceRelink,
  type DataImport,
  type ReferenceImportSource,
} from './import-repository.js';
import { captureReferenceCandidate, captureReferenceSource } from './reference-access.js';

const migrations: readonly Migration[] = [
  { version: 1, sql: readFileSync(new URL('../db/migrations/001_core.sql', import.meta.url), 'utf8') },
  { version: 2, sql: readFileSync(new URL('../db/migrations/002_jobs.sql', import.meta.url), 'utf8') },
  { version: 3, sql: readFileSync(new URL('../db/migrations/003_import.sql', import.meta.url), 'utf8') },
  { version: 4, sql: readFileSync(new URL('../db/migrations/004_import_generation.sql', import.meta.url), 'utf8') },
];
const projectId = '01234567-89ab-4cde-8f01-23456789abcd';
const jobId = 'ae45cf74-c9f9-4c49-88b9-0523b1ac7383';
const otherJobId = 'be45cf74-c9f9-4c49-88b9-0523b1ac7383';
const importId = '9b2db431-04e9-488b-b4c2-3859fd26cb6e';
const otherImportId = '8b2db431-04e9-488b-b4c2-3859fd26cb6e';
const createdAt = '2026-09-12T05:30:00.123Z';
const relinkAt = '2026-09-12T05:31:00.123Z';
let localVolume = '';

/** Worker threads expose process.env with the OS's raw key casing, so a
 * case-sensitive read of SystemRoot misses it even when the variable is set. */
function systemRoot(): string {
  const key = Object.keys(process.env).find((name) => name.toLowerCase() === 'systemroot');
  const value = key === undefined ? undefined : process.env[key];
  if (typeof value !== 'string' || value.length === 0) throw new Error('SystemRoot is required for this fixture.');
  return value;
}

function transaction<T>(database: DatabaseConnection, action: () => T): T {
  database.exec('BEGIN IMMEDIATE');
  try {
    const result = action();
    database.exec('COMMIT');
    return result;
  } finally { if (database.inTransaction) database.exec('ROLLBACK'); }
}

function generation(database: DatabaseConnection, id = importId): string {
  return (database.prepare('SELECT CAST(generation AS TEXT) AS value FROM import_generations WHERE import_id=?')
    .get(id) as { value: string }).value;
}

function projections(database: DatabaseConnection) {
  return {
    header: database.prepare('SELECT * FROM data_imports WHERE id=?').get(importId) as Record<string, unknown>,
    sources: database.prepare('SELECT * FROM import_sources WHERE import_id=? ORDER BY ordinal')
      .all(importId) as Record<string, unknown>[],
  };
}

function insertRow(database: DatabaseConnection, table: 'data_imports' | 'import_sources',
  row: Record<string, unknown>, replace = false): void {
  const columns = Object.keys(row);
  database.prepare(`INSERT${replace ? ' OR REPLACE' : ''} INTO ${table}(${columns.join(',')})
    VALUES (${columns.map(() => '?').join(',')})`).run(...columns.map((column) => row[column]));
}

// Only the unreachable-size fixture setup bypasses the counter UPDATE guard;
// restore its exact SQL before exercising any production read/write operation.
function seedGeneration(database: DatabaseConnection, value: string): void {
  const trigger = database.prepare(`SELECT sql FROM sqlite_master
    WHERE type='trigger' AND name='import_generations_guard_update'`).get() as { sql: string };
  transaction(database, () => {
    database.exec('DROP TRIGGER import_generations_guard_update');
    database.prepare('UPDATE import_generations SET generation=CAST(? AS INTEGER) WHERE import_id=?').run(value, importId);
    database.exec(trigger.sql);
  });
  expect(generation(database)).toBe(value);
}

type Mutation = 'delete/insert' | 'update/restore' | 'replace' | 'no-op update';
function mutate(database: DatabaseConnection, target: 'header' | 'source', kind: Mutation): void {
  const before = projections(database);
  transaction(database, () => {
    if (kind === 'delete/insert') {
      database.prepare('DELETE FROM import_sources WHERE import_id=?').run(importId);
      if (target === 'header') {
        database.prepare('DELETE FROM data_imports WHERE id=?').run(importId);
        insertRow(database, 'data_imports', before.header);
      }
      for (const row of before.sources) insertRow(database, 'import_sources', row);
    } else if (kind === 'replace') {
      if (target === 'header') insertRow(database, 'data_imports', before.header, true);
      else insertRow(database, 'import_sources', before.sources[0]!, true);
    } else if (target === 'header') {
      database.prepare('UPDATE data_imports SET updated_at=? WHERE id=?')
        .run(kind === 'no-op update' ? createdAt : relinkAt, importId);
      if (kind === 'update/restore') database.prepare('UPDATE data_imports SET updated_at=? WHERE id=?').run(createdAt, importId);
    } else {
      const original = before.sources[0]!.source_path;
      database.prepare('UPDATE import_sources SET source_path=? WHERE import_id=?')
        .run(kind === 'no-op update' ? original : `${String(original)}.changed`, importId);
      if (kind === 'update/restore') database.prepare('UPDATE import_sources SET source_path=? WHERE import_id=?')
        .run(original, importId);
    }
  });
  expect(projections(database)).toEqual(before);
}

describe.skipIf(process.platform !== 'win32')('DAT-12 B2 Reference import generation', () => {
  let directory: string;
  let databasePath: string;
  let database: DatabaseConnection;
  let scan: ScanResult;
  let source: ReferenceImportSource;
  let candidate: ReferenceImportSource;
  let inserted: DataImport;

  beforeAll(() => {
    localVolume = childProcess.execFileSync(win32.join(systemRoot(), 'System32', 'mountvol.exe'),
      [win32.parse(realpathSync.native(tmpdir())).root, '/L'], {
        shell: false, windowsHide: true, encoding: 'utf8', timeout: 5_000, maxBuffer: 4_096,
      });
  });

  function persist(connection: DatabaseConnection, id = importId, scanJobId = jobId): DataImport {
    connection.prepare(`INSERT INTO jobs(id,project_id,kind,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?)`).run(scanJobId, projectId, 'scan-dataset', 'Succeeded', createdAt, createdAt);
    const prepared = prepareDataImport({ id, createdAt, updatedAt: createdAt,
      scanResult: { ...scan, jobId: scanJobId },
      sourceManifest: { formatVersion: 1, mode: 'reference', entries: [source] } });
    return transaction(connection, () => insertDataImport(connection, prepared));
  }

  function initialize(connection: DatabaseConnection): void {
    expect(migrateDatabase(connection, migrations)).toBe(4);
    connection.prepare(`INSERT INTO projects(id,name,task_type,workspace_path,created_at,updated_at)
      VALUES (?,?,?,?,?,?)`).run(projectId, 'Generation fixture', 'classification', directory, createdAt, createdAt);
  }

  function prepare(current = findDataImport(database, projectId, importId)!) {
    return prepareReferenceRelink(current, 'image:0', candidate, relinkAt);
  }

  beforeEach(async () => {
    // Only the OS volume probe is substituted; path, identity, metadata and
    // streamed SHA-256 proof all come from real temporary files.
    vi.spyOn(childProcess, 'execFile').mockImplementation((_file, _args, _options, callback) => {
      if (!callback) throw new Error('Expected mountvol callback.');
      const child = new childProcess.ChildProcess();
      queueMicrotask(() => { callback(null, localVolume, ''); child.emit('close', 0, null); });
      return child;
    });
    vi.spyOn(childProcess, 'spawnSync').mockReturnValue({
      pid: 0, status: 0, signal: null, stdout: localVolume, stderr: '',
      output: [null, localVolume, ''],
    });
    directory = realpathSync.native(mkdtempSync(join(tmpdir(), 'autovision-dat12-generation-')));
    const sourcePath = join(directory, 'source.bin');
    const candidatePath = join(directory, 'candidate.bin');
    const bytes = Buffer.from('real Reference generation capture fixture');
    writeFileSync(sourcePath, bytes, { flag: 'wx' });
    writeFileSync(candidatePath, bytes, { flag: 'wx' });
    const image: ScanImage = {
      key: 'image:0', sourcePath, byteSize: bytes.length,
      mtimeNs: String(lstatSync(sourcePath, { bigint: true }).mtimeNs),
      sha256: createHash('sha256').update(bytes).digest('hex'), format: 'png',
      width: 32, height: 24, orientation: 1, duplicateOf: null, annotation: null,
    };
    source = await captureReferenceSource(image);
    candidate = await captureReferenceCandidate(source, candidatePath);
    scan = { formatVersion: 1, jobId, projectId, taskType: 'classification', mode: 'reference',
      classes: [], images: [image], issues: [] };
    databasePath = join(directory, 'metadata.sqlite3');
    database = openDatabase(databasePath);
    initialize(database);
    inserted = persist(database);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (database?.open) database.close();
    if (directory) rmSync(directory, { recursive: true, force: true });
  });

  it('requires the exact loaded DTO and real captured candidate, without exposing generation or connection', () => {
    const current = findDataImport(database, projectId, importId)!;
    expect(current).toEqual(inserted);
    expect(Object.keys(current).sort()).toEqual(Object.keys(inserted).sort());
    expect(current).not.toHaveProperty('generation');
    expect(current).not.toHaveProperty('database');
    for (const detached of [inserted, { ...current }, structuredClone(current)]) {
      expect(() => prepare(detached)).toThrow(/repository-loaded/);
    }
    for (const detached of [{ ...candidate }, structuredClone(candidate), current.sourceManifest.entries[0]!]) {
      expect(() => prepareReferenceRelink(current, 'image:0', detached as ReferenceImportSource, relinkAt))
        .toThrow(/captured Reference source/);
    }
    const prepared = prepare(current);
    expect(prepared).not.toHaveProperty('generation');
    expect(prepared).not.toHaveProperty('database');
    expect(() => applyReferenceRelink(database, prepared)).toThrow(/caller transaction/);
    expect(projections(database).header.updated_at).toBe(createdAt);
  });

  it.each(['same file', 'different file', 'reopened file'] as const)(
    'rejects a capability on a foreign connection (%s) before writing', (kind) => {
      const prepared = prepare();
      if (kind === 'reopened file') database.close();
      const foreign = openDatabase(kind === 'different file' ? join(directory, 'foreign.sqlite3') : databasePath);
      try {
        if (kind === 'different file') { initialize(foreign); persist(foreign); }
        const before = projections(foreign);
        const oldGeneration = generation(foreign);
        foreign.exec('BEGIN IMMEDIATE');
        try {
          expect(() => applyReferenceRelink(foreign, prepared)).toThrow(/originating database connection/);
          expect(foreign.inTransaction).toBe(true);
          expect(projections(foreign)).toEqual(before);
          expect(generation(foreign)).toBe(oldGeneration);
        } finally { foreign.exec('ROLLBACK'); }
      } finally { foreign.close(); }
    },
  );

  it.each(['header', 'source'] as const)('detects %s ABA for every mutation form before apply', (target) => {
    for (const kind of ['delete/insert', 'update/restore', 'replace', 'no-op update'] as const) {
      const current = findDataImport(database, projectId, importId)!;
      const prepared = prepare(current);
      const oldGeneration = generation(database);
      mutate(database, target, kind);
      expect(BigInt(generation(database))).toBeGreaterThan(BigInt(oldGeneration));
      expect(findDataImport(database, projectId, importId)).toEqual(current);
      const before = projections(database);
      const changedGeneration = generation(database);
      database.exec('BEGIN IMMEDIATE');
      try {
        expect(() => applyReferenceRelink(database, prepared)).toThrow(/changed before relink/);
        expect(database.inTransaction).toBe(true);
        expect(projections(database)).toEqual(before);
        expect(generation(database)).toBe(changedGeneration);
      } finally { database.exec('ROLLBACK'); }
    }
  });

  it('does not invalidate import A when import B header and source mutate', () => {
    const prepared = prepare();
    const oldGeneration = generation(database);
    persist(database, otherImportId, otherJobId);
    database.prepare('UPDATE data_imports SET updated_at=updated_at WHERE id=?').run(otherImportId);
    database.prepare('UPDATE import_sources SET source_path=source_path WHERE import_id=?').run(otherImportId);
    expect(generation(database)).toBe(oldGeneration);
    const result = transaction(database, () => applyReferenceRelink(database, prepared));
    expect(result.sourceManifest.entries[0]).toEqual(candidate);
    expect(generation(database)).toBe(String(BigInt(oldGeneration) + 2n));
    expect(findDataImport(database, projectId, importId)).toEqual(result);
  });

  it.each(['9007199254740992', '9007199254740993', '9223372036854775805'])(
    'retains exact generation %s through header +1 and source +2', (value) => {
      seedGeneration(database, value);
      const prepared = prepare();
      const result = transaction(database, () => applyReferenceRelink(database, prepared));
      expect(generation(database)).toBe(String(BigInt(value) + 2n));
      expect(findDataImport(database, projectId, importId)).toEqual(result);
    },
  );

  it('rejects adjacent stale generations that would round to the same Number', () => {
    seedGeneration(database, '9007199254740992');
    const prepared = prepare();
    database.prepare('UPDATE data_imports SET updated_at=updated_at WHERE id=?').run(importId);
    expect(generation(database)).toBe('9007199254740993');
    database.exec('BEGIN IMMEDIATE');
    try {
      expect(() => applyReferenceRelink(database, prepared)).toThrow(/changed before relink/);
      expect(database.inTransaction).toBe(true);
    } finally { database.exec('ROLLBACK'); }
    expect(findDataImport(database, projectId, importId)).toEqual(inserted);
  });

  it.each(['9223372036854775806', '9223372036854775807'])(
    'rejects relink overflow from %s without partial writes or caller rollback', (value) => {
      seedGeneration(database, value);
      const prepared = prepare();
      const before = projections(database);
      database.exec('BEGIN IMMEDIATE');
      try {
        expect(() => applyReferenceRelink(database, prepared)).toThrow(/generation exhausted/);
        expect(database.inTransaction).toBe(true);
        expect(projections(database)).toEqual(before);
        expect(generation(database)).toBe(value);
      } finally { database.exec('ROLLBACK'); }
      if (value === '9223372036854775807') {
        expect(() => database.prepare('UPDATE data_imports SET updated_at=updated_at WHERE id=?').run(importId))
          .toThrow(/generation exhausted/);
        expect(projections(database)).toEqual(before);
        expect(generation(database)).toBe(value);
      }
    },
  );

  it.each([undefined, null, '', '0', '-1', '01', '+1', '1.0', '1e0', '1\n', '9223372036854775808'])(
    'fails closed on missing or noncanonical generation %j, not as a missing import', (value) => {
      // A deliberately malformed TEMP ledger shadows the valid main table for
      // actual SQLite reads; no repository/proof assertions are substituted.
      database.exec('CREATE TEMP TABLE import_generations(import_id TEXT PRIMARY KEY,generation TEXT)');
      if (value !== undefined) database.prepare('INSERT INTO temp.import_generations VALUES (?,?)').run(importId, value);
      expect(() => findDataImport(database, projectId, importId)).toThrow(/Stored import persistence data is invalid or changed/);
      expect(database.inTransaction).toBe(false);
      expect(projections(database).header.id).toBe(importId);
    },
  );

  it.each(['header', 'source'] as const)(
    'refuses issuance after second-connection %s ABA between header and source SELECT', (target) => {
      const second = openDatabase(databasePath);
      const oldGeneration = generation(database);
      const nativePrepare = database.prepare.bind(database);
      let injected = false;
      const interception = vi.spyOn(database, 'prepare').mockImplementation((sql: string) => {
        if (!injected && sql.includes('FROM import_sources WHERE import_id=? ORDER BY ordinal')) {
          injected = true;
          mutate(second, target, 'update/restore');
        }
        return nativePrepare(sql);
      });
      try {
        expect(() => findDataImport(database, projectId, importId)).toThrow(/Stored import persistence data is invalid or changed/);
        expect(injected).toBe(true);
        expect(database.inTransaction).toBe(false);
        expect(second.inTransaction).toBe(false);
        expect(generation(second)).toBe(String(BigInt(oldGeneration) + 2n));
      } finally { interception.mockRestore(); second.close(); }
      expect(findDataImport(database, projectId, importId)).toEqual(inserted);
    },
  );

  it('keeps caller-owned read transactions and uncommitted changes intact on success and failure', () => {
    expect(database.inTransaction).toBe(false);
    expect(findDataImport(database, projectId, importId)).toEqual(inserted);
    expect(database.inTransaction).toBe(false);
    database.exec('BEGIN IMMEDIATE');
    try {
      database.prepare('INSERT INTO settings(key,value) VALUES (?,?)').run('caller-owned', 'uncommitted');
      expect(findDataImport(database, projectId, importId)).toEqual(inserted);
      database.prepare('DELETE FROM import_sources WHERE import_id=?').run(importId);
      expect(() => findDataImport(database, projectId, importId)).toThrow(/invalid or changed/);
      expect(database.inTransaction).toBe(true);
      expect(database.prepare('SELECT value FROM settings WHERE key=?').get('caller-owned'))
        .toEqual({ value: 'uncommitted' });
    } finally { database.exec('ROLLBACK'); }
    expect(database.prepare('SELECT value FROM settings WHERE key=?').get('caller-owned')).toBeUndefined();
    expect(findDataImport(database, projectId, importId)).toEqual(inserted);
  });

  it('leaves a mixed header/entry CAS failure for the caller to roll back atomically', () => {
    const prepared = prepare();
    const before = projections(database);
    const oldGeneration = generation(database);
    database.exec(`CREATE TRIGGER fixture_change_entry AFTER UPDATE ON data_imports
      BEGIN UPDATE import_sources SET source_path=source_path || '.changed' WHERE import_id=NEW.id; END`);
    database.exec('BEGIN IMMEDIATE');
    try {
      expect(() => applyReferenceRelink(database, prepared)).toThrow(/source changed before relink/);
      expect(database.inTransaction).toBe(true);
      expect(projections(database).header.updated_at).toBe(relinkAt);
      expect(projections(database).sources[0]!.source_path).toBe(`${source.sourcePath}.changed`);
      expect(generation(database)).toBe(String(BigInt(oldGeneration) + 2n));
    } finally { database.exec('ROLLBACK'); }
    expect(projections(database)).toEqual(before);
    expect(generation(database)).toBe(oldGeneration);
    expect(findDataImport(database, projectId, importId)).toEqual(inserted);
  });

  it('requires final generation old+2 even when both direct CAS updates succeed', () => {
    const prepared = prepare();
    const before = projections(database);
    const oldGeneration = generation(database);
    database.exec(`CREATE TRIGGER fixture_extra_header_update AFTER UPDATE ON import_sources
      BEGIN UPDATE data_imports SET updated_at=updated_at WHERE id=NEW.import_id; END`);
    database.exec('BEGIN IMMEDIATE');
    try {
      expect(() => applyReferenceRelink(database, prepared)).toThrow(/changed during relink/);
      expect(database.inTransaction).toBe(true);
      expect(projections(database).header.updated_at).toBe(relinkAt);
      expect(projections(database).sources[0]!.source_path).toBe(candidate.sourcePath);
      expect(generation(database)).toBe(String(BigInt(oldGeneration) + 3n));
    } finally { database.exec('ROLLBACK'); }
    expect(projections(database)).toEqual(before);
    expect(generation(database)).toBe(oldGeneration);
  });
});