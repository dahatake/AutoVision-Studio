// @vitest-environment node
import fs, { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openDatabase, type DatabaseConnection } from '../db/database.js';
import { migrateDatabase, type Migration } from '../db/migrate.js';
import { ProjectDeleteBlockedError, deleteProject } from './delete-project.js';
import { createProjectDirectory } from './project-directory.js';
import { beginProjectImport } from './project-operation-lock.js';
import { findProject, insertProject } from './project-repository.js';

const migrations: readonly Migration[] = [1, 2, 3, 4, 5, 6, 7].map((version) => ({
  version,
  sql: readFileSync(new URL(`../db/migrations/00${version}_${[
    'core', 'jobs', 'import', 'import_generation', 'import_rights', 'annotations', 'annotation_target_history',
  ][version - 1]}.sql`, import.meta.url), 'utf8'),
}));

const projectId = '2f9c6a1e-4b7d-4a55-9c31-8ad0e5f21b77';
const keptProjectId = '3f9c6a1e-4b7d-4a55-9c31-8ad0e5f21b77';
const schemaId = '4f9c6a1e-4b7d-4a55-9c31-8ad0e5f21b77';
const classId = '5f9c6a1e-4b7d-4a55-9c31-8ad0e5f21b77';
const workspaceId = '6f9c6a1e-4b7d-4a55-9c31-8ad0e5f21b77';
const copyImportId = '7f9c6a1e-4b7d-4a55-9c31-8ad0e5f21b77';
const referenceImportId = '8f9c6a1e-4b7d-4a55-9c31-8ad0e5f21b77';
const itemId = '9f9c6a1e-4b7d-4a55-9c31-8ad0e5f21b77';
const keptImportId = 'af9c6a1e-4b7d-4a55-9c31-8ad0e5f21b77';
const at = '2026-09-21T00:00:00.000Z';
const hash = (seed: string) => seed.repeat(64).slice(0, 64);

let directory: string;
let database: DatabaseConnection;
let workspacePath: string;
let keptWorkspacePath: string;
let referenceRoot: string;
let referenceFile: string;

function insertImport(id: string, project: string, mode: 'copy' | 'reference', jobId: string): void {
  database.prepare('INSERT INTO jobs(id,project_id,kind,status,created_at,updated_at) VALUES (?,?,?,?,?,?)')
    .run(jobId, project, 'scan-dataset', 'Succeeded', at, at);
  database.prepare(`INSERT INTO data_imports(id,project_id,scan_job_id,task_type,mode,created_at,updated_at,
    scan_result_json,scan_result_sha256,source_manifest_json,source_manifest_sha256) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, project, jobId, 'classification', mode, at, at, '{}', hash('c'), '{}', hash('d'));
}

function insertCopySource(importId: string, imageKey: string, sha: string): void {
  database.prepare(`INSERT INTO import_sources(import_id,image_key,ordinal,mode,relative_path,relative_path_key,
    byte_size,sha256,entry_sha256) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(importId, imageKey, imageKey.length, 'copy', `images\\${imageKey}.png`, `images/${imageKey}.png`,
      1024, sha, hash('e'));
}

function populateProject(): void {
  insertImport(copyImportId, projectId, 'copy', 'job-copy');
  insertCopySource(copyImportId, 'first', hash('a'));
  insertImport(referenceImportId, projectId, 'reference', 'job-reference');
  database.prepare(`INSERT INTO import_sources(import_id,image_key,ordinal,mode,source_path,identity_dev,identity_ino,
    identity_birthtime_ns,mtime_ns,byte_size,sha256,entry_sha256) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(referenceImportId, 'outside', 0, 'reference', referenceFile, '1', '2', '3', '4', 4096, hash('f'), hash('0'));
  database.prepare('INSERT INTO project_import_rights(project_id,acknowledged_at) VALUES (?,?)').run(projectId, at);
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
  database.prepare('INSERT INTO annotation_provenance(item_id,target_key,kind) VALUES (?,?,?)')
    .run(itemId, 'classification', 'manual');
}

const rowCount = (sql: string) => (database.prepare(sql).get() as { value: number }).value;

beforeEach(() => {
  directory = fs.realpathSync.native(fs.mkdtempSync(join(tmpdir(), 'autovision-rel04-')));
  database = openDatabase(join(directory, 'metadata.sqlite3'));
  migrateDatabase(database, migrations);
  referenceRoot = join(directory, 'reference-originals');
  fs.mkdirSync(referenceRoot);
  referenceFile = join(referenceRoot, 'outside.png');
  fs.writeFileSync(referenceFile, Buffer.from('original-bytes'));
  workspacePath = createProjectDirectory(directory, projectId, []).rootPath;
  keptWorkspacePath = createProjectDirectory(directory, keptProjectId, [workspacePath]).rootPath;
  for (const [id, path, name] of [[projectId, workspacePath, '削除対象'], [keptProjectId, keptWorkspacePath, '残す']] as const) {
    insertProject(database, { id, name, description: '', taskType: 'classification', workspacePath: path, createdAt: at, updatedAt: at });
  }
  insertImport(keptImportId, keptProjectId, 'copy', 'job-kept');
  insertCopySource(keptImportId, 'kept', hash('1'));
  populateProject();
  fs.mkdirSync(join(workspacePath, 'images'));
  fs.writeFileSync(join(workspacePath, 'images', 'first.png'), Buffer.alloc(16));
});

afterEach(() => {
  vi.restoreAllMocks();
  if (database.open) database.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

describe('REL-04 Project deletion', () => {
  it('removes owned rows and folder while keeping Reference originals and other Projects', () => {
    // A junction inside the Project must be removed as a link, not followed.
    fs.symlinkSync(referenceRoot, join(workspacePath, 'linked-originals'), 'junction');

    const result = deleteProject(database, projectId.toUpperCase());

    expect(result.directory).toBe('removed');
    expect(result.retainedPaths).toEqual([]);
    expect(result.deletedRows).toMatchObject({
      annotation_provenance: 1, annotation_items: 1, annotation_workspaces: 1, label_classes: 1,
      label_schemas: 1, import_sources: 2, data_imports: 2, project_import_rights: 1, jobs: 2, projects: 1,
    });
    expect(fs.existsSync(workspacePath)).toBe(false);
    expect(findProject(database, projectId)).toBeUndefined();
    expect(rowCount('SELECT COUNT(*) AS value FROM annotation_items')).toBe(0);
    // Reference originals and the unrelated Project survive untouched.
    expect(fs.readFileSync(referenceFile, 'utf8')).toBe('original-bytes');
    expect(fs.readdirSync(referenceRoot)).toEqual(['outside.png']);
    expect(findProject(database, keptProjectId)?.name).toBe('残す');
    expect(rowCount('SELECT COUNT(*) AS value FROM import_sources')).toBe(1);
    expect(fs.existsSync(keptWorkspacePath)).toBe(true);
    // DAT-12 tombstones are deliberately permanent and are not deleted.
    expect(rowCount('SELECT COUNT(*) AS value FROM import_generations')).toBe(3);
  });

  it('refuses while a schema rule blocks deletion, without changing anything', () => {
    database.prepare('INSERT INTO jobs(id,project_id,kind,status,created_at,updated_at) VALUES (?,?,?,?,?,?)')
      .run('job-train', projectId, 'train', 'Running', at, at);

    expect(() => deleteProject(database, projectId)).toThrow(ProjectDeleteBlockedError);
    try {
      deleteProject(database, projectId);
    } catch (error) {
      expect((error as ProjectDeleteBlockedError).blockers.map((blocker) => blocker.code)).toEqual(['ACTIVE_JOB']);
    }
    expect(findProject(database, projectId)?.name).toBe('削除対象');
    expect(fs.existsSync(join(workspacePath, 'images', 'first.png'))).toBe(true);
  });

  it('refuses when the folder cannot be verified as this Project, and keeps every row', () => {
    fs.unlinkSync(join(workspacePath, '.autovision-project.json'));

    expect(() => deleteProject(database, projectId)).toThrow(/所有を確認できない/);

    expect(findProject(database, projectId)?.name).toBe('削除対象');
    expect(rowCount('SELECT COUNT(*) AS value FROM annotation_items')).toBe(1);
    expect(fs.existsSync(join(workspacePath, 'images', 'first.png'))).toBe(true);
  });

  it('leaves no partially deleted Project when a delete statement fails', () => {
    const prepare = database.prepare.bind(database);
    vi.spyOn(database, 'prepare').mockImplementation((sql: string) => {
      if (sql.startsWith('DELETE FROM jobs')) throw new Error('simulated failure');
      return prepare(sql);
    });

    expect(() => deleteProject(database, projectId)).toThrow(/simulated failure/);

    vi.restoreAllMocks();
    expect(database.inTransaction).toBe(false);
    expect(findProject(database, projectId)?.name).toBe('削除対象');
    expect(rowCount('SELECT COUNT(*) AS value FROM annotation_provenance')).toBe(1);
    expect(rowCount('SELECT COUNT(*) AS value FROM annotation_items')).toBe(1);
    expect(rowCount('SELECT COUNT(*) AS value FROM label_schemas')).toBe(1);
    expect(rowCount('SELECT COUNT(*) AS value FROM data_imports')).toBe(3);
    expect(rowCount('SELECT COUNT(*) AS value FROM project_import_rights')).toBe(1);
    expect(fs.existsSync(workspacePath)).toBe(true);
  });

  it('reports the files it could not remove instead of claiming they are gone', () => {
    const blocked = join(workspacePath, 'images', 'first.png');
    const unlink = fs.unlinkSync.bind(fs);
    vi.spyOn(fs, 'unlinkSync').mockImplementation((path) => {
      if (String(path) === blocked) throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' });
      unlink(path);
    });

    const result = deleteProject(database, projectId);

    expect(result.directory).toBe('retained');
    expect(result.retainedPaths).toContain(blocked);
    expect(result.retainedPaths).toContain(workspacePath);
    expect(findProject(database, projectId)).toBeUndefined();
    // The failed item is reported, not silently reported as deleted.
    expect(fs.existsSync(blocked)).toBe(true);
  });

  it('still cleans up the rows when the owned folder is already gone', () => {
    fs.rmSync(workspacePath, { recursive: true, force: true });

    const result = deleteProject(database, projectId);

    expect(result.directory).toBe('missing');
    expect(result.retainedPaths).toEqual([]);
    expect(findProject(database, projectId)).toBeUndefined();
  });

  it('rejects busy Projects, unknown IDs and nested transactions', () => {
    const release = beginProjectImport(database, projectId);
    expect(() => deleteProject(database, projectId)).toThrow(/取り込み中/);
    release();

    expect(() => deleteProject(database, '00000000-0000-4000-8000-000000000000')).toThrow(/見つかりません/);
    expect(() => deleteProject(database, 'not-a-uuid')).toThrow();

    database.exec('BEGIN');
    expect(() => deleteProject(database, projectId)).toThrow(/transaction/);
    database.exec('ROLLBACK');
    expect(findProject(database, projectId)?.name).toBe('削除対象');
  });
});
