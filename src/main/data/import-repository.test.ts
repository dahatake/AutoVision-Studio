// @vitest-environment node
import { createHash } from 'node:crypto';
import { lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import type { ScanImage, ScanResult } from '../../shared/contracts/import.js';
import { insertImportLabels, prepareImportLabels } from '../annotations/label-schema-service.js';
import { createAnnotationWorkspace } from '../annotations/workspace-service.js';
import { openDatabase, type DatabaseConnection } from '../db/database.js';
import { migrateDatabase, type Migration } from '../db/migrate.js';
import {
  assertImportImageSourceCurrent,
  findImportImageSource,
  findDataImport,
  importSourceManifestSchema,
  insertDataImport,
  listDataImportHeaders,
  prepareDataImport,
  type CopyImportSource,
  type DataImport,
  type ImportSourceManifest,
  type ImportImageSource,
  type NewDataImport,
  type PreparedDataImport,
  type ReferenceImportSource,
} from './import-repository.js';
import { captureReferenceCandidate, captureReferenceSource } from './reference-access.js';

const migrations: readonly Migration[] = [
  { version: 1, sql: readFileSync(new URL('../db/migrations/001_core.sql', import.meta.url), 'utf8') },
  { version: 2, sql: readFileSync(new URL('../db/migrations/002_jobs.sql', import.meta.url), 'utf8') },
  { version: 3, sql: readFileSync(new URL('../db/migrations/003_import.sql', import.meta.url), 'utf8') },
];
const repositoryMigrations: readonly Migration[] = [
  ...migrations,
  { version: 4, sql: readFileSync(new URL('../db/migrations/004_import_generation.sql', import.meta.url), 'utf8') },
];
const projectId = '01234567-89ab-4cde-8f01-23456789abcd';
const otherProjectId = '11234567-89ab-4cde-8f01-23456789abcd';
const jobId = 'ae45cf74-c9f9-4c49-88b9-0523b1ac7383';
const otherJobId = 'be45cf74-c9f9-4c49-88b9-0523b1ac7383';
const importId = '9b2db431-04e9-488b-b4c2-3859fd26cb6e';
const otherImportId = '8b2db431-04e9-488b-b4c2-3859fd26cb6e';
const createdAt = '2026-09-12T05:30:00.123Z';
const sourcePath = 'C:\\画像\\a.png';
const secondSourcePath = 'C:\\画像\\b.png';
const hashA = 'a'.repeat(64);
const hashB = 'b'.repeat(64);

function image(overrides: Partial<ScanImage> = {}): ScanImage {
  return {
    key: 'image:0', sourcePath, byteSize: 1234, mtimeNs: '1750000000123456789',
    sha256: hashA, format: 'png', width: 640, height: 480, orientation: 1,
    duplicateOf: null, annotation: null, ...overrides,
  };
}

function scan(mode: 'copy' | 'reference' = 'copy', overrides: Partial<ScanResult> = {}): ScanResult {
  return {
    formatVersion: 1, jobId, projectId, taskType: 'classification', mode,
    classes: [], images: [image()], issues: [], ...overrides,
  };
}

function copyEntry(overrides: Partial<CopyImportSource> = {}): CopyImportSource {
  return { imageKey: 'image:0', relativePath: `datasets/${importId}/source/a.png`,
    byteSize: 1234, sha256: hashA, ...overrides };
}

function referenceEntry(overrides: Partial<ReferenceImportSource> = {}): ReferenceImportSource {
  return {
    imageKey: 'image:0', sourcePath,
    identity: { dev: '1', ino: '42', birthtimeNs: '1750000000000000000' },
    byteSize: 1234, mtimeNs: '1750000000123456789', sha256: hashA, ...overrides,
  };
}

function manifest(mode: 'copy' | 'reference' = 'copy', entries?: readonly (CopyImportSource | ReferenceImportSource)[]): ImportSourceManifest {
  return mode === 'copy'
    ? { formatVersion: 1, mode, entries: (entries ?? [copyEntry()]) as CopyImportSource[] }
    : { formatVersion: 1, mode, entries: (entries ?? [referenceEntry()]) as ReferenceImportSource[] };
}

function input(mode: 'copy' | 'reference' = 'copy', overrides: Partial<NewDataImport> = {}): NewDataImport {
  return { id: importId, createdAt, updatedAt: createdAt, scanResult: scan(mode), sourceManifest: manifest(mode), ...overrides };
}

async function capturedReferenceInput(directory: string): Promise<NewDataImport> {
  const path = join(realpathSync.native(directory), 'captured.png');
  const bytes = Buffer.from('isolated Reference capture fixture');
  writeFileSync(path, bytes, { flag: 'wx' });
  const capturedImage = image({ sourcePath: path, byteSize: bytes.length,
    mtimeNs: String(lstatSync(path, { bigint: true }).mtimeNs),
    sha256: createHash('sha256').update(bytes).digest('hex') });
  const entry = await captureReferenceSource(capturedImage);
  return input('reference', { scanResult: scan('reference', { images: [capturedImage] }),
    sourceManifest: manifest('reference', [entry]) });
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(',')}}`;
}

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function expectDeepFrozen(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeepFrozen(child);
}

function seedProject(database: DatabaseConnection, id = projectId, taskType = 'classification'): void {
  database.prepare(`INSERT INTO projects(id,name,task_type,workspace_path,created_at,updated_at)
    VALUES (?,?,?,?,?,?)`).run(id, 'Import fixture 日本語', taskType, `C:\\Projects\\${id}`, createdAt, createdAt);
}

function seedJob(database: DatabaseConnection, overrides: {
  id?: string; projectId?: string; kind?: string; status?: string;
} = {}): void {
  database.prepare(`INSERT INTO jobs(id,project_id,kind,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?)`).run(overrides.id ?? jobId, overrides.projectId ?? projectId,
      overrides.kind ?? 'scan-dataset', overrides.status ?? 'Succeeded', createdAt, createdAt);
}

function persist(database: DatabaseConnection, prepared = prepareDataImport(input())): DataImport {
  database.exec('BEGIN IMMEDIATE');
  try {
    const result = insertDataImport(database, prepared);
    database.exec('COMMIT');
    return result;
  } catch (error) {
    if (database.inTransaction) database.exec('ROLLBACK');
    throw error;
  }
}

function rawImportRows(database: DatabaseConnection): unknown[] {
  return database.prepare('SELECT * FROM data_imports ORDER BY id').all();
}

function rawSourceRows(database: DatabaseConnection): unknown[] {
  return database.prepare('SELECT * FROM import_sources ORDER BY import_id,ordinal').all();
}

describe.skipIf(process.platform !== 'win32')('DAT-14A indexed image source leaf, real 001–006 database', () => {
  let directory: string, path: string, database: DatabaseConnection;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'av-dat14a-'));
    path = join(directory, 'metadata.sqlite3');
    database = openDatabase(path);
    migrateDatabase(database, [...repositoryMigrations,
      ...['005_import_rights', '006_annotations'].map((name, index) => ({ version: index + 5,
        sql: readFileSync(new URL(`../db/migrations/${name}.sql`, import.meta.url), 'utf8') }))]);
    seedProject(database); seedProject(database, otherProjectId); seedJob(database);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    if (database.open) database.close();
    rmSync(directory, { recursive: true, force: true });
  });
  async function fixture(mode: 'copy' | 'reference' = 'copy') {
    const value = mode === 'copy' ? input() : await capturedReferenceInput(directory);
    persist(database, prepareDataImport(value));
    const labels = prepareImportLabels(database, projectId, value.scanResult.classes);
    const schemaId = labels.schemaId, mapping = labels.classMapping;
    database.exec('BEGIN');
    try { insertImportLabels(database, labels); database.exec('COMMIT'); }
    finally { if (database.inTransaction) database.exec('ROLLBACK'); }
    const { workspace } = createAnnotationWorkspace(database, projectId, importId, schemaId, mapping);
    const item = database.prepare('SELECT id FROM annotation_items WHERE workspace_id=?').get(workspace.id) as { id: string };
    return { workspaceId: workspace.id, itemId: item.id, value };
  }
  function lookup(binding: { workspaceId: string; itemId: string }, parent = projectId) {
    database.exec('BEGIN DEFERRED');
    try { return findImportImageSource(database, parent, binding.workspaceId, binding.itemId); }
    finally { database.exec('ROLLBACK'); }
  }

  it.each(['copy', 'reference'] as const)('returns frozen %s exact fields, preserving the caller transaction', async (mode) => {
    const binding = await fixture(mode);
    database.exec('BEGIN DEFERRED');
    const value = findImportImageSource(database, projectId, binding.workspaceId, binding.itemId)!;
    expect(database.inTransaction).toBe(true);
    database.exec('COMMIT');
    expectDeepFrozen(value);
    const entry = binding.value.sourceManifest.entries[0]!;
    expect(value).toEqual({ projectId, workspaceId: binding.workspaceId, itemId: binding.itemId, importId,
      imageKey: entry.imageKey, mode, byteSize: entry.byteSize, sha256: entry.sha256,
      relativePath: mode === 'copy' ? (entry as CopyImportSource).relativePath : null,
      sourcePath: mode === 'reference' ? (entry as ReferenceImportSource).sourcePath : null,
      identity: mode === 'reference' ? (entry as ReferenceImportSource).identity : null,
      mtimeNs: mode === 'reference' ? (entry as ReferenceImportSource).mtimeNs : null,
      generation: '2', projectRoot: `C:\\Projects\\${projectId}` });
    assertImportImageSourceCurrent(database, value);
  });

  it('requires caller TX; missing/foreign item requests never disclose paths', async () => {
    const binding = await fixture();
    expect(() => findImportImageSource(database, projectId, binding.workspaceId, binding.itemId)).toThrow(/caller read transaction/);
    expect(lookup(binding, otherProjectId)).toBeUndefined();
    expect(lookup({ ...binding, itemId: otherImportId })).toBeUndefined();
    expect(lookup({ ...binding, workspaceId: otherImportId })).toBeUndefined();
    expect(database.inTransaction).toBe(false);
  });

  it.each(['copy', 'reference'] as const)('rejects rehashed %s path projection not in the saved manifest', async (mode) => {
    const binding = await fixture(mode);
    const entry = binding.value.sourceManifest.entries[0]!;
    const changed = mode === 'copy' ? { ...entry, relativePath: 'datasets/swapped.png' }
      : { ...entry, sourcePath: 'C:\\swapped.png' };
    if (mode === 'copy') {
      database.exec('DROP TRIGGER import_sources_preserve_copy_binding');
      database.prepare('UPDATE import_sources SET relative_path=?,relative_path_key=?,entry_sha256=? WHERE import_id=?')
        .run('datasets/swapped.png', 'DATASETS/SWAPPED.PNG', digest(canonical(changed)), importId);
    } else database.prepare('UPDATE import_sources SET source_path=?,entry_sha256=? WHERE import_id=?')
      .run('C:\\swapped.png', digest(canonical(changed)), importId);
    expect(() => lookup(binding)).toThrow(/invalid or changed/);
  });

  it.each(['uppercase-key', 'image-hash', 'task', 'mode', 'owner', 'source', 'workspace', 'project', 'header', 'generation-missing', 'generation-zero'])(
    'fails closed for existing item with corrupt %s', async (kind) => {
      const binding = await fixture();
      database.pragma('foreign_keys=OFF');
      if (kind === 'uppercase-key') {
        database.exec('DROP TRIGGER import_sources_preserve_copy_binding');
        database.prepare('UPDATE import_sources SET relative_path_key=? WHERE import_id=?').run('wrong', importId);
      }
      if (kind === 'image-hash') {
        database.exec('DROP TRIGGER annotation_items_update');
        database.prepare('UPDATE annotation_items SET image_sha256=? WHERE id=?').run(hashB, binding.itemId);
      }
      if (kind === 'task' || kind === 'mode') {
        database.exec('DROP TRIGGER annotation_workspaces_update');
        database.exec(kind === 'task' ? "UPDATE annotation_workspaces SET task_type='detection'"
          : "UPDATE annotation_workspaces SET mode='reference'");
      }
      if (kind === 'owner') {
        database.exec("DROP TRIGGER annotation_workspaces_update; UPDATE annotation_workspaces SET project_id='corrupt'");
      }
      if (kind === 'source') {
        database.exec('DROP TRIGGER annotations_source_delete; DELETE FROM import_sources');
      }
      if (kind === 'workspace') database.exec('DROP TRIGGER annotation_workspaces_delete; DELETE FROM annotation_workspaces');
      if (kind === 'project') database.exec('DROP TRIGGER annotations_project_delete; DELETE FROM projects');
      if (kind === 'header') database.exec('DROP TRIGGER annotations_import_delete; DELETE FROM data_imports');
      if (kind === 'generation-missing') database.exec('DROP TRIGGER import_generations_guard_delete; DELETE FROM import_generations');
      if (kind === 'generation-zero') {
        database.exec('DROP TRIGGER import_generations_guard_update; PRAGMA ignore_check_constraints=ON; UPDATE import_generations SET generation=0');
      }
      expect(() => lookup(binding)).toThrow(/invalid or changed/);
    });

  it.each(['generation', 'project-root', 'project-raw', 'source-identity'])(
    'invalidates a previously issued capability after %s changes', async (kind) => {
      const binding = await fixture(kind === 'source-identity' ? 'reference' : 'copy');
      const value = lookup(binding)!;
      if (kind === 'generation') database.exec('UPDATE import_generations SET generation=generation+1');
      if (kind === 'project-root') database.exec("UPDATE projects SET workspace_path=workspace_path || '-changed'");
      if (kind === 'project-raw') database.exec("UPDATE projects SET description='changed'");
      if (kind === 'source-identity') database.exec("UPDATE import_sources SET identity_ino='999'");
      expect(() => assertImportImageSourceCurrent(database, value)).toThrow(/invalid or changed/);
    });

  it('rejects copied/forged/foreign/closed capabilities and requires fresh issuance after reopen', async () => {
    const binding = await fixture(), value = lookup(binding)!;
    const getter = vi.fn();
    for (const fake of [{ ...value }, Object.defineProperty({}, 'projectId', { get: getter })])
      expect(() => assertImportImageSourceCurrent(database, fake as ImportImageSource)).toThrow(TypeError);
    expect(getter).not.toHaveBeenCalled();
    const other = openDatabase(path);
    try { expect(() => assertImportImageSourceCurrent(other, value)).toThrow(TypeError); }
    finally { other.close(); }
    database.close();
    expect(() => assertImportImageSourceCurrent(database, value)).toThrow();
    database = openDatabase(path);
    expect(() => assertImportImageSourceCurrent(database, value)).toThrow(TypeError);
    const reloaded = lookup(binding)!;
    expect(reloaded).toEqual(value);
    assertImportImageSourceCurrent(database, reloaded);
  });

  it('does not select scan JSON or return a full manifest; rechecks avoid all large JSON', async () => {
    const binding = await fixture();
    // Deliberately invalid large scan metadata: full reload must reject it, but
    // this entry lookup must not fetch/parse it. The saved manifest is unchanged.
    database.exec('DROP TRIGGER data_imports_preserve_identity_and_scan');
    database.prepare('UPDATE data_imports SET scan_result_json=? WHERE id=?')
      .run(JSON.stringify({ unused: 'x'.repeat(1024 * 1024) }), importId);
    const queries = vi.spyOn(database, 'prepare');
    const value = lookup(binding)!;
    expect(queries.mock.calls.every(([sql]) => !sql.includes('scan_result_json'))).toBe(true);
    expect(queries.mock.calls.some(([sql]) => sql.includes('AS sourceManifestEntryJson'))).toBe(true);
    expect(queries.mock.calls.every(([sql]) => !/source_manifest_json\s+AS\s+sourceManifestJson/iu.test(sql))).toBe(true);
    queries.mockClear();
    assertImportImageSourceCurrent(database, value);
    expect(queries.mock.calls).toHaveLength(1);
    expect(queries.mock.calls[0]![0]).not.toMatch(/source_manifest_json|scan_result_json|annotation_json/iu);
  });
});

describe('DAT-07 import migration', () => {
  let directory: string;
  let database: DatabaseConnection;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'autovision-dat07-schema-'));
    database = openDatabase(join(directory, 'metadata.sqlite3'));
  });
  afterEach(() => {
    if (database?.open) database.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('upgrades 002 to 003 without seeds and preserves existing Project, settings, and Job rows', () => {
    migrateDatabase(database, migrations.slice(0, 2));
    seedProject(database);
    seedJob(database);
    database.prepare('INSERT INTO settings(key,value) VALUES (?,?)').run('fixture', '保持');
    const beforeProject = database.prepare('SELECT * FROM projects').all();
    const beforeJob = database.prepare('SELECT * FROM jobs').all();

    expect(migrateDatabase(database, migrations)).toBe(3);
    expect(database.pragma('user_version', { simple: true })).toBe(3);
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()).toEqual([
      { name: 'data_imports' }, { name: 'import_sources' }, { name: 'jobs' }, { name: 'projects' }, { name: 'settings' },
    ]);
    expect(database.prepare('SELECT * FROM data_imports').all()).toEqual([]);
    expect(database.prepare('SELECT * FROM import_sources').all()).toEqual([]);
    expect(database.prepare('SELECT * FROM projects').all()).toEqual(beforeProject);
    expect(database.prepare('SELECT * FROM jobs').all()).toEqual(beforeJob);
    expect(database.prepare('SELECT * FROM settings').all()).toEqual([{ key: 'fixture', value: '保持' }]);
    expect(database.pragma('foreign_key_check')).toEqual([]);
    expect(database.inTransaction).toBe(false);
  });

  it('creates strict tables, required indexes and direct-SQL invariant triggers', () => {
    migrateDatabase(database, migrations);
    expect(database.pragma('table_list')).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'data_imports', ncol: 11, strict: 1 }),
      expect.objectContaining({ name: 'import_sources', ncol: 14, strict: 1 }),
    ]));
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type='index' AND sql IS NOT NULL ORDER BY name").all())
      .toEqual(expect.arrayContaining([
        { name: 'data_imports_project_created_at' }, { name: 'jobs_project_created_at' },
        { name: 'jobs_kind_status_created_at' }, { name: 'jobs_project_id_id' },
      ]));
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name").all()).toEqual([
      { name: 'data_imports_preserve_copy_manifest' },
      { name: 'data_imports_preserve_identity_and_scan' },
      { name: 'data_imports_require_succeeded_scan' },
      { name: 'import_sources_preserve_copy_binding' },
      { name: 'import_sources_preserve_identity_fields' },
      { name: 'jobs_preserve_persisted_import' },
    ]);
  });

  it('rolls back all 003 objects and its version after a later statement fails, then retries cleanly', () => {
    migrateDatabase(database, migrations.slice(0, 2));
    seedProject(database);
    const before = database.prepare('SELECT * FROM projects').all();
    expect(() => migrateDatabase(database, [...migrations.slice(0, 2), {
      version: 3, sql: `${migrations[2]!.sql}\nCREATE TABLE data_imports(id TEXT);`,
    }])).toThrow(/already exists/);
    expect(database.pragma('user_version', { simple: true })).toBe(2);
    expect(database.prepare("SELECT name FROM sqlite_master WHERE name IN ('data_imports','import_sources','jobs_project_id_id')").all())
      .toEqual([]);
    expect(database.prepare('SELECT * FROM projects').all()).toEqual(before);
    expect(migrateDatabase(database, migrations)).toBe(3);
  });

  it.each([
    ['Queued', 'scan-dataset'], ['Failed', 'scan-dataset'], ['Succeeded', 'assist'], ['Succeeded', 'train'],
  ])('rejects a direct import for %s/%s instead of trusting JSON metadata', (status, kind) => {
    migrateDatabase(database, migrations);
    seedProject(database);
    seedJob(database, { status, kind });
    expect(() => database.prepare(`INSERT INTO data_imports(
      id,project_id,scan_job_id,task_type,mode,created_at,updated_at,
      scan_result_json,scan_result_sha256,source_manifest_json,source_manifest_sha256
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(importId, projectId, jobId, 'classification', 'copy', createdAt, createdAt,
      '{}', hashA, '{}', hashB)).toThrow(/succeeded scan job/);
    expect(rawImportRows(database)).toEqual([]);
  });

  it('enforces Project/job lineage and prevents parent deletion or terminal scan rewrites', () => {
    migrateDatabase(database, migrations);
    seedProject(database);
    seedProject(database, otherProjectId);
    seedJob(database);
    persist(database);
    expect(() => database.prepare('UPDATE jobs SET status=? WHERE id=?').run('Failed', jobId)).toThrow(/immutable/);
    expect(() => database.prepare('UPDATE jobs SET kind=? WHERE id=?').run('assist', jobId)).toThrow(/immutable/);
    expect(() => database.prepare('DELETE FROM jobs WHERE id=?').run(jobId)).toThrow(/FOREIGN KEY/);
    expect(() => database.prepare('DELETE FROM projects WHERE id=?').run(projectId)).toThrow(/FOREIGN KEY/);
    expect(rawImportRows(database)).toHaveLength(1);
    expect(rawSourceRows(database)).toHaveLength(1);
  });

  it('makes Copy header and projected binding immutable under direct SQL', () => {
    migrateDatabase(database, migrations);
    seedProject(database);
    seedJob(database);
    persist(database);
    const imports = rawImportRows(database);
    const sources = rawSourceRows(database);
    for (const [sql, parameters] of [
      ['UPDATE data_imports SET source_manifest_sha256=? WHERE id=?', [hashB, importId]],
      ['UPDATE data_imports SET scan_result_sha256=? WHERE id=?', [hashB, importId]],
      ['UPDATE import_sources SET relative_path=? WHERE import_id=?', ['datasets/other/source/a.png', importId]],
      ['UPDATE import_sources SET sha256=? WHERE import_id=?', [hashB, importId]],
    ] as const) expect(() => database.prepare(sql).run(...parameters)).toThrow(/immutable/);
    expect(rawImportRows(database)).toEqual(imports);
    expect(rawSourceRows(database)).toEqual(sources);
  });
});

describe.skipIf(process.platform !== 'win32')('DAT-07 import repository', () => {
  let directory: string;
  let path: string;
  let database: DatabaseConnection;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'autovision-dat07-repository-'));
    path = join(directory, 'metadata.sqlite3');
    database = openDatabase(path);
    migrateDatabase(database, repositoryMigrations);
    seedProject(database);
    seedProject(database, otherProjectId);
    seedJob(database);
  });
  afterEach(() => {
    if (database?.open) database.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('exports narrow prepare/insert/read/header contracts', () => {
    expectTypeOf(prepareDataImport).parameters.toEqualTypeOf<[NewDataImport]>();
    expectTypeOf(prepareDataImport).returns.toEqualTypeOf<PreparedDataImport>();
    expectTypeOf(insertDataImport).returns.toEqualTypeOf<DataImport>();
    expectTypeOf(findDataImport).returns.toEqualTypeOf<DataImport | undefined>();
    expect(importSourceManifestSchema.parse(manifest())).toEqual(manifest());
  });

  it.each(['copy', 'reference'] as const)('round-trips a canonical immutable %s snapshot through commit and reopen', async (mode) => {
    const value = mode === 'reference' ? await capturedReferenceInput(directory) : input(mode);
    const prepared = prepareDataImport(value);
    expect(Object.keys(prepared).sort()).toEqual([
      'createdAt', 'id', 'mode', 'projectId', 'scanJobId', 'scanResultSha256',
      'sourceManifestSha256', 'taskType', 'updatedAt',
    ]);
    const result = persist(database, prepared);
    expect(result).toMatchObject({ id: importId, projectId, scanJobId: jobId, taskType: 'classification', mode,
      createdAt, updatedAt: createdAt, scanResult: value.scanResult, sourceManifest: value.sourceManifest });
    expectDeepFrozen(result);
    database.close();
    database = openDatabase(path);
    expect(migrateDatabase(database, repositoryMigrations)).toBe(4);
    const stored = findDataImport(database, projectId, importId);
    expect(stored).toEqual(result);
    expect(stored).not.toBe(result);
    expectDeepFrozen(stored);
    const row = rawImportRows(database)[0] as Record<string, unknown>;
    expect(row.scan_result_json).toBe(canonical(value.scanResult));
    expect(row.source_manifest_json).toBe(canonical(value.sourceManifest));
    expect(row.scan_result_sha256).toBe(digest(row.scan_result_json as string));
    expect(row.source_manifest_sha256).toBe(digest(row.source_manifest_json as string));
    expect(database.pragma('foreign_key_check')).toEqual([]);
  });

  it('rejects schema-valid invented Reference identity/hash strings without issuing persistence authority', () => {
    expect(importSourceManifestSchema.parse(manifest('reference'))).toEqual(manifest('reference'));
    expect(() => prepareDataImport(input('reference'))).toThrow(TypeError);
    expect(() => prepareDataImport(input('reference'))).toThrow(/captured Reference source/);
    expect(rawImportRows(database)).toEqual([]);
    expect(rawSourceRows(database)).toEqual([]);
  });

  it('prepares a deep copy synchronously and never trusts later caller mutation', () => {
    const value = structuredClone(input('copy'));
    const prepared = prepareDataImport(value);
    Reflect.set(value, 'id', otherImportId);
    value.scanResult.images[0]!.key = 'changed';
    (value.sourceManifest as Extract<ImportSourceManifest, { mode: 'copy' }>).entries[0]!.relativePath = 'datasets/changed.png';
    const stored = persist(database, prepared);
    expect(stored.id).toBe(importId);
    expect(stored.scanResult.images[0]!.key).toBe('image:0');
    expect(stored.sourceManifest.entries[0]).toEqual(copyEntry());
  });

  it('rejects lookalike capabilities and requires a caller-owned transaction before any write', () => {
    const prepared = prepareDataImport(input());
    const before = rawImportRows(database);
    expect(() => insertDataImport(database, prepared)).toThrow(/caller transaction/);
    expect(rawImportRows(database)).toEqual(before);
    database.exec('BEGIN IMMEDIATE');
    try {
      expect(() => insertDataImport(database, { ...prepared })).toThrow(/real prepared/);
      expect(rawImportRows(database)).toEqual(before);
    } finally { database.exec('ROLLBACK'); }
  });

  it('joins rollback and never commits or rolls back the caller transaction itself', () => {
    const prepared = prepareDataImport(input());
    database.exec('BEGIN IMMEDIATE');
    const inserted = insertDataImport(database, prepared);
    expect(inserted.id).toBe(importId);
    expect(database.inTransaction).toBe(true);
    expect(rawImportRows(database)).toHaveLength(1);
    database.exec('ROLLBACK');
    expect(rawImportRows(database)).toEqual([]);
    expect(rawSourceRows(database)).toEqual([]);
  });

  it.each([
    { status: 'Running' }, { status: 'Failed' }, { kind: 'assist' },
  ])('rejects a changed scan job %j inside the insertion transaction', (changed) => {
    database.prepare('UPDATE jobs SET status=?,kind=? WHERE id=?')
      .run(changed.status ?? 'Succeeded', changed.kind ?? 'scan-dataset', jobId);
    const prepared = prepareDataImport(input());
    database.exec('BEGIN IMMEDIATE');
    try {
      expect(() => insertDataImport(database, prepared)).toThrow(/matching succeeded scan/);
      expect(rawImportRows(database)).toEqual([]);
    } finally { database.exec('ROLLBACK'); }
  });

  it('rejects a Project task-type change inside the insertion transaction', () => {
    database.prepare('UPDATE projects SET task_type=? WHERE id=?').run('detection', projectId);
    const prepared = prepareDataImport(input());
    database.exec('BEGIN IMMEDIATE');
    try { expect(() => insertDataImport(database, prepared)).toThrow(/task type/); }
    finally { database.exec('ROLLBACK'); }
  });

  it('rejects duplicate import identity and duplicate scan lineage without replacing either snapshot', () => {
    const first = persist(database);
    const beforeImports = rawImportRows(database);
    const beforeSources = rawSourceRows(database);
    for (const candidate of [
      input('copy', { sourceManifest: manifest('copy', [copyEntry({ relativePath: 'datasets/replacement.png' })]) }),
      input('copy', { id: otherImportId }),
    ]) {
      database.exec('BEGIN IMMEDIATE');
      try { expect(() => insertDataImport(database, prepareDataImport(candidate))).toThrow(); }
      finally { database.exec('ROLLBACK'); }
      expect(findDataImport(database, projectId, importId)).toEqual(first);
      expect(rawImportRows(database)).toEqual(beforeImports);
      expect(rawSourceRows(database)).toEqual(beforeSources);
    }
  });

  it('isolates Project-scoped reads and returns undefined only for missing or foreign IDs', () => {
    persist(database);
    expect(findDataImport(database, projectId.toUpperCase(), importId.toUpperCase())?.id).toBe(importId);
    expect(findDataImport(database, otherProjectId, importId)).toBeUndefined();
    expect(findDataImport(database, projectId, otherImportId)).toBeUndefined();
    expect(listDataImportHeaders(database, otherProjectId)).toEqual([]);
  });

  it('lists deterministic metadata-only headers without exposing or decoding payload columns', () => {
    const first = persist(database);
    seedJob(database, { id: otherJobId });
    const secondInput = input('copy', {
      id: otherImportId, createdAt, updatedAt: createdAt,
      scanResult: scan('copy', { jobId: otherJobId }),
      sourceManifest: manifest('copy', [copyEntry({ relativePath: `datasets/${otherImportId}/source/a.png` })]),
    });
    const second = persist(database, prepareDataImport(secondInput));
    const headers = listDataImportHeaders(database, projectId);
    expect(headers.map(({ id }) => id)).toEqual([otherImportId, importId].sort());
    expect(headers).toEqual([first, second].sort((a, b) => a.id.localeCompare(b.id)).map((item) => ({
      id: item.id, projectId: item.projectId, scanJobId: item.scanJobId, taskType: item.taskType,
      mode: item.mode, createdAt: item.createdAt, updatedAt: item.updatedAt,
      scanResultSha256: item.scanResultSha256, sourceManifestSha256: item.sourceManifestSha256,
    })));
    for (const header of headers) {
      expect(header).not.toHaveProperty('scanResult');
      expect(header).not.toHaveProperty('sourceManifest');
      expect(Object.isFrozen(header)).toBe(true);
    }
  });

  it.each([
    ['mode', () => input('copy', { sourceManifest: manifest('reference') })],
    ['count', () => input('copy', { sourceManifest: manifest('copy', [copyEntry(), copyEntry({ imageKey: 'image:1' })]) })],
    ['key', () => input('copy', { sourceManifest: manifest('copy', [copyEntry({ imageKey: 'other' })]) })],
    ['size', () => input('copy', { sourceManifest: manifest('copy', [copyEntry({ byteSize: 1235 })]) })],
    ['hash', () => input('copy', { sourceManifest: manifest('copy', [copyEntry({ sha256: hashB })]) })],
    ['reference path', () => input('reference', { sourceManifest: manifest('reference', [referenceEntry({ sourcePath: secondSourcePath })]) })],
    ['reference mtime', () => input('reference', { sourceManifest: manifest('reference', [referenceEntry({ mtimeNs: '1' })]) })],
    ['timestamp pair', () => input('copy', { updatedAt: '2026-09-12T05:31:00.000Z' })],
  ] as const)('rejects a mismatched %s before issuing a capability', (_case, make) => {
    expect(() => prepareDataImport(make())).toThrow(/^Import persistence input is invalid\.$/u);
  });

  it.each([
    '../escape.png', '/absolute.png', 'C:/absolute.png', 'datasets/../escape.png',
    'datasets//a.png', 'datasets/a.png/', 'datasets\\a.png', 'datasets/NUL.txt',
    'datasets/a.png:stream', '.autovision-project.json', 'datasets/.autovision-copy-x.tmp',
  ])('rejects unsafe Copy relative path %j', (relativePath) => {
    expect(() => prepareDataImport(input('copy', {
      sourceManifest: manifest('copy', [copyEntry({ relativePath })]),
    }))).toThrow(/invalid/);
  });

  it('rejects case-folded duplicate Copy destinations before any DB write', () => {
    const images = [image(), image({ key: 'image:1', sourcePath: secondSourcePath, sha256: hashB })];
    expect(() => prepareDataImport(input('copy', {
      scanResult: scan('copy', { images }),
      sourceManifest: manifest('copy', [copyEntry(), copyEntry({ imageKey: 'image:1',
        relativePath: copyEntry().relativePath.toUpperCase(), sha256: hashB })]),
    }))).toThrow(/invalid/);
    expect(rawImportRows(database)).toEqual([]);
  });

  it.each([
    { sourcePath: '\\\\server\\share\\a.png' }, { sourcePath: 'C:\\safe\\..\\a.png' },
    { identity: { dev: '-1', ino: '42', birthtimeNs: '0' } },
    { identity: { dev: '1', ino: '0', birthtimeNs: '0' } },
    { identity: { dev: '1', ino: '42', birthtimeNs: '01' } },
  ] as Partial<ReferenceImportSource>[])('rejects unsafe Reference binding %j', (change) => {
    const sourceManifest = manifest('reference', [referenceEntry(change)]);
    const scanResult = scan('reference', { images: [image({
      sourcePath: change.sourcePath ?? sourcePath,
      mtimeNs: change.mtimeNs ?? image().mtimeNs,
    })] });
    expect(() => prepareDataImport(input('reference', { scanResult, sourceManifest }))).toThrow(/invalid/);
  });

  it('rejects getters, sparse arrays, unknown fields, cycles, and noncanonical identity values', () => {
    const getter = () => { throw new Error('must not run'); };
    const accessor = structuredClone(input());
    Object.defineProperty(accessor, 'id', { enumerable: true, get: getter });
    expect(() => prepareDataImport(accessor)).toThrow(/invalid/);
    const sparse = structuredClone(input());
    sparse.sourceManifest.entries.length = 2;
    expect(() => prepareDataImport(sparse)).toThrow(/invalid/);
    const extra = { ...input(), retry: true };
    expect(() => prepareDataImport(extra as NewDataImport)).toThrow(/invalid/);
    const cycle = structuredClone(input()) as NewDataImport & { cycle?: unknown };
    cycle.cycle = cycle;
    expect(() => prepareDataImport(cycle)).toThrow(/invalid/);
  });

  it('persists a result larger than the worker control envelope without truncating arrays or Unicode', () => {
    const images = Array.from({ length: 350 }, (_, index) => image({
      key: `image:${index}`, sourcePath: `C:\\画像\\${index}.png`,
      sha256: index.toString(16).padStart(64, '0'),
    }));
    const entries = images.map((entry, index) => copyEntry({ imageKey: entry.key,
      relativePath: `datasets/${importId}/source/${index}.png`, sha256: entry.sha256 }));
    const large = input('copy', { scanResult: scan('copy', { images }), sourceManifest: manifest('copy', entries) });
    const result = persist(database, prepareDataImport(large));
    expect(result.scanResult.images).toHaveLength(350);
    expect((rawImportRows(database)[0] as Record<string, string>).scan_result_json.length).toBeGreaterThan(65_536);
    database.close();
    database = openDatabase(path);
    expect(findDataImport(database, projectId, importId)).toEqual(result);
  });

  it.each(['scan hash', 'manifest hash', 'scan whitespace', 'manifest duplicate key', 'projection missing'] as const)(
    'fails closed on stored %s corruption without canonical rewrite', (kind) => {
      const expected = persist(database);
      const before = rawImportRows(database);
      if (kind === 'projection missing') database.prepare('DELETE FROM import_sources WHERE import_id=?').run(importId);
      else {
        database.exec('DROP TRIGGER data_imports_preserve_identity_and_scan; DROP TRIGGER data_imports_preserve_copy_manifest');
        if (kind === 'scan hash') database.prepare('UPDATE data_imports SET scan_result_sha256=? WHERE id=?').run(hashB, importId);
        if (kind === 'manifest hash') database.prepare('UPDATE data_imports SET source_manifest_sha256=? WHERE id=?').run(hashB, importId);
        if (kind === 'scan whitespace') {
          const text = ` ${canonical(expected.scanResult)}`;
          database.prepare('UPDATE data_imports SET scan_result_json=?,scan_result_sha256=? WHERE id=?')
            .run(text, digest(text), importId);
        }
        if (kind === 'manifest duplicate key') {
          const text = canonical(expected.sourceManifest).replace('{', '{"mode":"copy",');
          database.prepare('UPDATE data_imports SET source_manifest_json=?,source_manifest_sha256=? WHERE id=?')
            .run(text, digest(text), importId);
        }
      }
      expect(() => findDataImport(database, projectId, importId)).toThrow(/^Stored import persistence data is invalid or changed\.$/u);
      if (kind !== 'projection missing') expect(rawImportRows(database)).not.toEqual([]);
      expect(before).toHaveLength(1);
    },
  );

  it('accepts a transactionally consistent future Reference relink while keeping scan bytes immutable', async () => {
    const value = await capturedReferenceInput(directory);
    const original = persist(database, prepareDataImport(value));
    const candidatePath = join(realpathSync.native(directory), 'relinked.png');
    writeFileSync(candidatePath, readFileSync(value.scanResult.images[0]!.sourcePath), { flag: 'wx' });
    const saved = (original.sourceManifest as Extract<ImportSourceManifest, { mode: 'reference' }>).entries[0]!;
    const candidate = await captureReferenceCandidate(saved, candidatePath);
    const changed = manifest('reference', [candidate]) as Extract<ImportSourceManifest, { mode: 'reference' }>;
    const text = canonical(changed);
    const entryHash = digest(canonical(changed.entries[0]));
    database.exec('BEGIN IMMEDIATE');
    try {
      database.prepare(`UPDATE data_imports SET updated_at=?,source_manifest_json=?,source_manifest_sha256=?
        WHERE id=? AND mode='reference' AND source_manifest_sha256=?`).run(
        '2026-09-12T06:00:00.000Z', text, digest(text), importId, original.sourceManifestSha256);
      database.prepare(`UPDATE import_sources SET source_path=?,identity_dev=?,identity_ino=?,identity_birthtime_ns=?,
        mtime_ns=?,entry_sha256=? WHERE import_id=? AND image_key=? AND mode='reference'`).run(
        changed.entries[0].sourcePath, changed.entries[0].identity.dev, changed.entries[0].identity.ino,
        changed.entries[0].identity.birthtimeNs, changed.entries[0].mtimeNs, entryHash, importId, 'image:0');
      database.exec('COMMIT');
    } finally { if (database.inTransaction) database.exec('ROLLBACK'); }
    const relinked = findDataImport(database, projectId, importId)!;
    expect(relinked.sourceManifest).toEqual(changed);
    expect(relinked.scanResult).toEqual(original.scanResult);
    expect(relinked.scanResultSha256).toBe(original.scanResultSha256);
    expect(relinked.sourceManifestSha256).toBe(digest(text));
  });
});
