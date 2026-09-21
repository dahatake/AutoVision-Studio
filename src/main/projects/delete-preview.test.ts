// @vitest-environment node
import fs, { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openDatabase, type DatabaseConnection } from '../db/database.js';
import { migrateDatabase, type Migration } from '../db/migrate.js';
import { previewProjectDeletion } from './delete-preview.js';
import { createProjectDirectory } from './project-directory.js';
import { insertProject } from './project-repository.js';

const migrations: readonly Migration[] = [1, 2, 3, 4, 5, 6, 7].map((version) => ({
  version,
  sql: readFileSync(new URL(`../db/migrations/00${version}_${[
    'core', 'jobs', 'import', 'import_generation', 'import_rights', 'annotations', 'annotation_target_history',
  ][version - 1]}.sql`, import.meta.url), 'utf8'),
}));

const projectId = '2f9c6a1e-4b7d-4a55-9c31-8ad0e5f21b77';
const otherProjectId = '3f9c6a1e-4b7d-4a55-9c31-8ad0e5f21b77';
const schemaId = '4f9c6a1e-4b7d-4a55-9c31-8ad0e5f21b77';
const classId = '5f9c6a1e-4b7d-4a55-9c31-8ad0e5f21b77';
const workspaceId = '6f9c6a1e-4b7d-4a55-9c31-8ad0e5f21b77';
const copyImportId = '7f9c6a1e-4b7d-4a55-9c31-8ad0e5f21b77';
const referenceImportId = '8f9c6a1e-4b7d-4a55-9c31-8ad0e5f21b77';
const itemId = '9f9c6a1e-4b7d-4a55-9c31-8ad0e5f21b77';
const at = '2026-09-21T00:00:00.000Z';
const hash = (seed: string) => seed.repeat(64).slice(0, 64);

let directory: string;
let database: DatabaseConnection;
let workspacePath: string;

function insertScanJob(id: string, project: string): void {
  database.prepare('INSERT INTO jobs(id,project_id,kind,status,created_at,updated_at) VALUES (?,?,?,?,?,?)')
    .run(id, project, 'scan-dataset', 'Succeeded', at, at);
}

function insertImport(id: string, project: string, mode: 'copy' | 'reference', jobId: string): void {
  insertScanJob(jobId, project);
  database.prepare(`INSERT INTO data_imports(id,project_id,scan_job_id,task_type,mode,created_at,updated_at,
    scan_result_json,scan_result_sha256,source_manifest_json,source_manifest_sha256) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, project, jobId, 'classification', mode, at, at, '{}', hash('c'), '{}', hash('d'));
}

function insertCopySource(importId: string, imageKey: string, bytes: number, sha: string): void {
  database.prepare(`INSERT INTO import_sources(import_id,image_key,ordinal,mode,relative_path,relative_path_key,
    byte_size,sha256,entry_sha256) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(importId, imageKey, imageKey.length, 'copy', `images\\${imageKey}.png`, `images/${imageKey}.png`,
      bytes, sha, hash('e'));
}

function insertReferenceSource(importId: string, imageKey: string, bytes: number, sourcePath: string): void {
  database.prepare(`INSERT INTO import_sources(import_id,image_key,ordinal,mode,source_path,identity_dev,identity_ino,
    identity_birthtime_ns,mtime_ns,byte_size,sha256,entry_sha256) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(importId, imageKey, 0, 'reference', sourcePath, '1', '2', '3', '4', bytes, hash('f'), hash('0'));
}

function insertWorkspaceWithItem(): void {
  database.prepare('INSERT INTO label_schemas(id,project_id,created_at,updated_at) VALUES (?,?,?,?)')
    .run(schemaId, projectId, at, at);
  database.prepare(`INSERT INTO label_classes(id,schema_id,display_name,normalized_name,color,ordinal,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(classId, schemaId, '猫', '猫', '#112233', 0, at, at);
  database.prepare(`INSERT INTO annotation_workspaces(id,project_id,schema_id,task_type,mode,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?)`).run(workspaceId, projectId, schemaId, 'classification', 'copy', at, at);
  database.prepare(`INSERT INTO annotation_items(id,workspace_id,import_id,image_key,image_sha256,width,height,
    annotation_json,annotation_sha256,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(itemId, workspaceId, copyImportId, 'first', hash('a'), 64, 64,
      `{"kind":"classification","classId":"${classId}"}`, hash('b'), at);
}

beforeEach(() => {
  directory = fs.realpathSync.native(fs.mkdtempSync(join(tmpdir(), 'autovision-core10-')));
  database = openDatabase(join(directory, 'metadata.sqlite3'));
  migrateDatabase(database, migrations);
  workspacePath = createProjectDirectory(directory, projectId, []).rootPath;
  insertProject(database, {
    id: projectId, name: '削除対象', description: '', taskType: 'classification',
    workspacePath, createdAt: at, updatedAt: at,
  });
  insertImport(copyImportId, projectId, 'copy', 'job-copy');
  insertCopySource(copyImportId, 'first', 1024, hash('a'));
  insertCopySource(copyImportId, 'second', 2048, hash('9'));
  insertImport(referenceImportId, projectId, 'reference', 'job-reference');
  insertReferenceSource(referenceImportId, 'outside', 4096, 'D:\\外部\\outside.png');
});

afterEach(() => {
  vi.restoreAllMocks();
  if (database.open) database.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

describe('CORE-10 Project delete preview', () => {
  it('separates owned data from Reference data and measures the owned folder', () => {
    insertWorkspaceWithItem();
    fs.mkdirSync(join(workspacePath, 'images'));
    fs.writeFileSync(join(workspacePath, 'images', 'first.png'), Buffer.alloc(10));
    fs.writeFileSync(join(workspacePath, 'images', 'second.png'), Buffer.alloc(5));
    const markerBytes = fs.statSync(join(workspacePath, '.autovision-project.json')).size;

    const preview = previewProjectDeletion(database, projectId.toUpperCase());

    expect(preview.projectId).toBe(projectId);
    expect(preview.workspacePath).toBe(workspacePath);
    expect(preview.owned.copyImports).toBe(1);
    expect(preview.owned.copiedImages).toEqual({ count: 2, bytes: 3072 });
    expect(preview.owned.labelSchemas).toBe(1);
    expect(preview.owned.annotationWorkspaces).toBe(1);
    expect(preview.owned.annotationItems).toBe(1);
    expect(preview.owned.datasetRevisions).toBe(0);
    expect(preview.owned.datasetItems).toBe(0);
    expect(preview.owned.trainingRuns).toBe(0);
    expect(preview.owned.otherJobs).toBe(2);
    expect(preview.owned.directory).toEqual({
      status: 'measured', ownership: 'verified', files: 3, bytes: markerBytes + 15,
    });
    // Reference images are counted separately because deletion must keep them.
    expect(preview.referenced).toEqual({ imports: 1, images: { count: 1, bytes: 4096 } });
    expect(preview.blockers).toEqual([]);
    expect(preview.unmeasuredCategories).toContain('model-versions');
  });

  it('does not delete or modify anything while previewing', () => {
    insertWorkspaceWithItem();
    const command = vi.spyOn(database, 'exec');
    const statements: string[] = [];
    const prepare = database.prepare.bind(database);
    vi.spyOn(database, 'prepare').mockImplementation((sql: string) => {
      statements.push(sql);
      return prepare(sql);
    });

    previewProjectDeletion(database, projectId);

    expect(command).not.toHaveBeenCalled();
    expect(statements.length).toBeGreaterThan(0);
    expect(statements.every((sql) => sql.trimStart().toUpperCase().startsWith('SELECT'))).toBe(true);
    expect(database.prepare('SELECT COUNT(*) AS value FROM import_sources').get()).toEqual({ value: 3 });
    expect(database.prepare('SELECT COUNT(*) AS value FROM annotation_items').get()).toEqual({ value: 1 });
    expect(fs.existsSync(workspacePath)).toBe(true);
  });

  it('counts only the requested Project', () => {
    insertProject(database, {
      id: otherProjectId, name: '別Project', description: '', taskType: 'classification',
      workspacePath: join(directory, 'other'), createdAt: at, updatedAt: at,
    });
    insertImport('af9c6a1e-4b7d-4a55-9c31-8ad0e5f21b77', otherProjectId, 'copy', 'job-other');
    insertCopySource('af9c6a1e-4b7d-4a55-9c31-8ad0e5f21b77', 'other', 8192, hash('8'));

    const preview = previewProjectDeletion(database, otherProjectId);

    expect(preview.owned.copiedImages).toEqual({ count: 1, bytes: 8192 });
    expect(preview.referenced.images).toEqual({ count: 0, bytes: 0 });
    // A folder that does not exist reports no size instead of a fabricated 0.
    expect(preview.owned.directory).toEqual({ status: 'missing' });
  });

  it('reports the schema rules that refuse deletion', () => {
    insertWorkspaceWithItem();
    database.prepare('INSERT INTO jobs(id,project_id,kind,status,created_at,updated_at) VALUES (?,?,?,?,?,?)')
      .run('job-train', projectId, 'train', 'Queued', at, at);
    database.prepare(`INSERT INTO annotation_provenance(item_id,target_key,kind) VALUES (?,?,?)`)
      .run(itemId, 'classification', 'manual');
    database.prepare(`INSERT INTO annotation_target_history(item_id,target_key,kind,original_json,changes_json,
      target_fields_json,record_sha256) VALUES (?,?,?,?,?,?,?)`)
      .run(itemId, 'classification', 'manual', '{}', '{}', `{"classId":"${classId}"}`, hash('7'));
    database.prepare('UPDATE annotation_items SET state=?,confirmed_at=?,edit_version=edit_version+1 WHERE id=?')
      .run('confirmed', at, itemId);
    database.prepare('UPDATE label_schemas SET locked_at=?,edit_version=edit_version+1,updated_at=? WHERE id=?')
      .run(at, at, schemaId);

    const preview = previewProjectDeletion(database, projectId);

    expect(preview.owned.trainingRuns).toBe(1);
    expect(preview.blockers.map((blocker) => blocker.code).sort()).toEqual([
      'ACTIVE_JOB', 'ANNOTATION_HISTORY_IMMUTABLE', 'CONFIRMED_PROVENANCE_IMMUTABLE', 'LOCKED_LABEL_SCHEMA_IMMUTABLE',
    ]);
    expect(preview.blockers.every((blocker) => blocker.count > 0 && blocker.message.length > 0)).toBe(true);
  });

  it('rejects unknown and malformed Project IDs', () => {
    expect(() => previewProjectDeletion(database, 'not-a-uuid')).toThrow();
    expect(() => previewProjectDeletion(database, otherProjectId)).toThrow(/見つかりません/);
  });
});
