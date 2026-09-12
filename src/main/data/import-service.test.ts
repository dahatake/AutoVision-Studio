// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto';
import native from 'node:fs';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Project } from '../../shared/contracts/project.js';
import { createLabelClass, getLabelSchema, mergeLabelClasses } from '../annotations/label-schema-service.js';
import { getAnnotationItem, listAnnotationItems } from '../annotations/workspace-service.js';
import { openDatabase, type DatabaseConnection } from '../db/database.js';
import { migrateDatabase } from '../db/migrate.js';
import { createJobService, type JobService } from '../jobs/job-service.js';
import { beginProjectMoveActivity } from '../projects/project-operation-lock.js';
import { createProject, updateProject } from '../projects/project-service.js';
import { findDataImportByScanJob } from './import-repository.js';
import { createImportService, type ImportCommitOptions, type ImportService } from './import-service.js';
import * as reference from './reference-access.js';

const migrations = ['001_core', '002_jobs', '003_import', '004_import_generation', '005_import_rights', '006_annotations']
  .map((name, index) => ({ version: index + 1,
    sql: native.readFileSync(new URL(`../db/migrations/${name}.sql`, import.meta.url), 'utf8') }));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6XkAAAAASUVORK5CYII=', 'base64');
// Real Node protocol process, real source bytes/hash/stat and valid result file.
// Deliberately NOT a Python scanner/image-decoder smoke test.
const worker = `
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
if (process.argv.length !== 5 || process.argv[2] !== 'scan-dataset' || process.argv[3] !== '--request') process.exit(93);
const request = JSON.parse(fs.readFileSync(process.argv[4], 'utf8'));
const p = request.payload, source = p.source, root = path.dirname(process.argv[4]);
const send = fields => process.stdout.write(JSON.stringify({schemaVersion:1,jobId:request.jobId,projectId:request.projectId,...fields})+'\\n');
send({type:'started'});
let files = source.selection === 'files' ? JSON.parse(fs.readFileSync(source.selectionManifestPath,'utf8')).files : [path.join(source.root,'image.png')];
if (process.env.TEST_OUTSIDE) files = [process.env.TEST_OUTSIDE];
const coco = source.format === 'coco' ? JSON.parse(fs.readFileSync(source.annotationPath,'utf8')) : null;
const classes = source.format === 'unlabeled' ? [] : coco ? coco.categories.map(c => ({key:'category:'+c.id,name:c.name,sourceCategoryId:String(c.id)})) : [{key:'constructor',name:'cat',sourceCategoryId:null}];
const images = files.map((file,index) => {
  const bytes = fs.readFileSync(file), stat = fs.statSync(file,{bigint:true});
  const original = coco ? coco.images.find(image => image.file_name === path.basename(file)) : null;
  return {key:'image:'+index,sourcePath:file,byteSize:bytes.length,mtimeNs:String(stat.mtimeNs),sha256:crypto.createHash('sha256').update(bytes).digest('hex'),
    format:'png',width:1,height:1,orientation:1,duplicateOf:null,
    annotation:source.format==='unlabeled'?null:p.taskType==='classification'?{type:'classification',classKey:'constructor',sourceRow:null}:
      {type:'detection',sourceImageId:String(original.id),boxes:coco.annotations.filter(a => a.image_id === original.id).map(a => ({classKey:'category:'+a.category_id,sourceAnnotationId:String(a.id),bbox:a.bbox}))}};
});
const issues = process.env.TEST_ISSUE ? [{severity:'error',code:'BAD_IMAGE',target:{imageKey:null,sourcePath:'private diagnostic',row:1,itemId:null}}] : [];
fs.writeFileSync(path.join(root,'result.json'),JSON.stringify({formatVersion:1,projectId:request.projectId,jobId:request.jobId,taskType:p.taskType,mode:p.mode,classes,images:process.env.TEST_ZERO?[]:images,issues}),{flag:'wx'});
send({type:'progress',source:'actual',processed:images.length,total:images.length});
send({type:'completed',resultManifest:'result.json'});
`;
const tables = ['project_import_rights', 'label_schemas', 'label_classes', 'data_imports', 'import_sources',
  'annotation_workspaces', 'annotation_items', 'annotation_provenance'];

describe.skipIf(process.platform !== 'win32')('DAT-08E real Main import integration (Node transport, not Python smoke)', () => {
  let root: string, metadata: string, tasks: string, source: string, dbPath: string;
  let db: DatabaseConnection, project: Project, jobs: JobService, service: ImportService;
  beforeEach(() => {
    root = native.realpathSync.native(native.mkdtempSync(join(tmpdir(), 'av-dat08e-')));
    metadata = join(root, 'metadata'); tasks = join(root, 'tasks'); source = join(root, 'selected');
    for (const dir of [metadata, tasks, source, join(root, 'projects')]) native.mkdirSync(dir);
    native.writeFileSync(join(source, 'image.png'), png);
    native.writeFileSync(join(root, 'worker.cjs'), worker);
    dbPath = join(metadata, 'metadata.sqlite3'); db = openDatabase(dbPath); migrateDatabase(db, migrations);
    project = createProject(db, { name: 'DAT08E', description: '', taskType: 'classification', workspacePath: join(root, 'projects') });
    start();
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    if (db.inTransaction) db.exec('ROLLBACK');
    await jobs.shutdown();
    db.close(); native.rmSync(root, { recursive: true, force: true });
  });
  function start(env: Record<string, string> = {}) {
    jobs = createJobService(db, { executablePath: process.execPath, argsPrefix: [join(root, 'worker.cjs')],
      taskRoot: tasks, env, policy: { timeoutMs: 10_000, cancelGraceMs: 500,
        closeTimeoutMs: 2000, maxStdoutBytes: 65_536, maxManifestBytes: 1_048_576 } });
    const real = createImportService(db, jobs, { taskRoot: tasks, metadataDirectory: metadata, protectedRoots: [] });
    service = Object.freeze({ ...real, async commit(...args: Parameters<ImportService['commit']>) {
      try { return await real.commit(...args); }
      catch (error) {
        // Test-only diagnostics: retain the same error identity/code and real flow.
        if (error instanceof Error) {
          const causes: string[] = [], seen = new Set<Error>([error]);
          for (let current = error.cause; current instanceof Error && !seen.has(current) && causes.length < 8; current = current.cause) {
            seen.add(current); causes.push(current.stack ?? current.message);
          }
          if (causes.length) error.stack = `${error.stack ?? error.message}\nCaused by: ${causes.join('\nCaused by: ')}`;
        }
        throw error;
      }
    } });
  }
  function scan(mode: 'copy' | 'reference' = 'copy', format: 'folder' | 'unlabeled' | 'coco' = 'folder') {
    const selected = format === 'unlabeled' ? { format, selection: 'directory', root: source }
      : format === 'coco' ? { format, root: source, annotationPath: join(source, 'annotations.json') }
        : { format, root: source };
    return service.scan(project.id, { taskType: project.taskType, mode, source: selected });
  }
  function graphEmpty() { for (const table of tables) expect(db.prepare(`SELECT * FROM ${table}`).all(), table).toEqual([]); }
  function workerCompleted(jobId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const inspect = (snapshot: ReturnType<JobService['getSnapshot']>) => {
        if (snapshot?.job.id !== jobId) return;
        if (snapshot.workerCompleted) { unsubscribe(); resolve(); }
        else if (snapshot.job.status === 'Failed' || snapshot.job.status === 'Cancelled') {
          unsubscribe(); reject(new Error(`Worker closed before completion: ${snapshot.job.status}`));
        }
      };
      const unsubscribe = jobs.subscribe(project.id, inspect);
      inspect(jobs.getSnapshot(project.id, jobId));
    });
  }
  function intents(): string[] {
    const datasets = join(project.workspacePath, 'datasets');
    return native.existsSync(datasets) ? native.readdirSync(datasets).map((id) => join(datasets, id, '.autovision-import.json')) : [];
  }

  it('imports into a real default project below the metadata volume anchor without copying the DB', async () => {
    const parent = join(metadata, 'projects'); native.mkdirSync(parent);
    project = createProject(db, { name: 'Default', description: '', taskType: 'classification', workspacePath: parent });
    expect(project.workspacePath).toBe(join(parent, project.id));
    source = join(metadata, 'documents'); native.mkdirSync(source);
    native.writeFileSync(join(source, 'image.png'), png);
    const run = scan('copy', 'unlabeled');
    await expect(service.preview(project.id, run.id)).resolves.toMatchObject({ itemCount: 1, mode: 'copy', issues: [] });
    graphEmpty();
    const result = await service.commit(project.id, run.id, { mode: 'copy', rightsAccepted: true });
    expect(result).toMatchObject({ status: 'completed', projectId: project.id, workspaceId: result.importId,
      itemCount: 1, cleanupWarning: false });
    const stored = findDataImportByScanJob(db, project.id, run.id)!;
    expect(stored.sourceManifest.mode).toBe('copy');
    if (stored.sourceManifest.mode !== 'copy') throw new Error('Expected copy manifest');
    expect(stored.sourceManifest.entries).toHaveLength(1);
    const entry = stored.sourceManifest.entries[0]!;
    expect(entry.sha256).toBe(createHash('sha256').update(png).digest('hex'));
    expect(native.readFileSync(join(project.workspacePath, entry.relativePath))).toEqual(png);
    const payloadRoot = join(project.workspacePath, 'datasets', result.importId, 'source');
    const payloadFiles = native.readdirSync(payloadRoot, { recursive: true, withFileTypes: true })
      .filter((item) => item.isFile()).map((item) => join(item.parentPath, item.name));
    expect(payloadFiles).toEqual([join(project.workspacePath, entry.relativePath)]);
    expect(native.readFileSync(join(source, 'image.png'))).toEqual(png);
    expect(db.prepare('SELECT project_id FROM project_import_rights').all()).toEqual([{ project_id: project.id }]);
    const items = listAnnotationItems(db, project.id, result.workspaceId, { offset: 0, limit: 10 }).items;
    expect(items).toHaveLength(1); expect(items[0]).toMatchObject({ state: 'unstarted' });
    // DB bytes legitimately change on commit: verify integrity and reopen, not byte equality.
    expect(db.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }]);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    await jobs.shutdown(); db.close(); db = openDatabase(dbPath); start();
    expect(await service.commit(project.id, run.id, { mode: 'copy', rightsAccepted: true })).toEqual(result);
  }, 30_000);

  it.each(['equal', 'ancestor'] as const)('rejects a project %s to the actual metadata directory before filesystem access or spawn', async (relationship) => {
    await jobs.shutdown(); db.close();
    metadata = relationship === 'equal' ? project.workspacePath : join(project.workspacePath, 'metadata');
    if (relationship === 'ancestor') native.mkdirSync(metadata);
    const relocated = join(metadata, 'metadata.sqlite3'); native.renameSync(dbPath, relocated); dbPath = relocated;
    db = openDatabase(dbPath); start();
    const spawn = vi.fn(jobs.startScan);
    service = createImportService(db, { ...jobs, startScan: spawn }, { taskRoot: tasks, metadataDirectory: metadata, protectedRoots: [] });
    const lstat = vi.spyOn(native, 'lstatSync');
    expect(() => scan()).toThrow(expect.objectContaining({ code: 'IMPORT_PROJECT_CHANGED' }));
    expect(lstat).not.toHaveBeenCalled(); expect(spawn).not.toHaveBeenCalled();
    expect(jobs.list(project.id)).toEqual([]); graphEmpty();
  });

  it.each(['task', 'selection', 'current', 'other'] as const)('retains %s source protection before filesystem access or spawn', (kind) => {
    const selection = join(metadata, 'selections'); native.mkdirSync(selection);
    const other = createProject(db, { name: 'Other', description: '', taskType: 'classification', workspacePath: join(root, 'projects') });
    const spawn = vi.fn(jobs.startScan);
    service = createImportService(db, { ...jobs, startScan: spawn }, { taskRoot: tasks, metadataDirectory: metadata, protectedRoots: [selection] });
    source = kind === 'task' ? tasks : kind === 'selection' ? selection : kind === 'current' ? project.workspacePath : other.workspacePath;
    const lstat = vi.spyOn(native, 'lstatSync');
    expect(() => scan()).toThrow(expect.objectContaining({ code: 'IMPORT_INPUT' }));
    expect(lstat).not.toHaveBeenCalled(); expect(spawn).not.toHaveBeenCalled();
    expect(jobs.list(project.id)).toEqual([]); graphEmpty();
  });

  it.each(['copy', 'reference'] as const)('commits %s with real sources, rights, UUID labels and unstarted workspace; reopen is idempotent', async (mode) => {
    const run = scan(mode, mode === 'reference' ? 'unlabeled' : 'folder');
    expect(run.status).toBe('Preparing'); graphEmpty();
    const p1 = service.preview(project.id, run.id), p2 = service.preview(project.id, run.id);
    expect(p1).toBe(p2); const preview = await p1;
    expect(preview.itemCount).toBe(1); expect(JSON.stringify(preview)).not.toContain(root);
    expect(jobs.get(project.id, run.id)?.status).toBe('Succeeded'); graphEmpty();
    const result = await service.commit(project.id, run.id, { mode, rightsAccepted: true }).catch((error: unknown) => {
      const causes: string[] = [];
      for (let current = error; current instanceof Error && causes.length < 8; current = current.cause) {
        causes.push(current.stack ?? current.message);
      }
      throw new Error(causes.join('\nCaused by: '));
    });
    expect(result).toMatchObject({ status: 'completed', projectId: project.id, workspaceId: result.importId, itemCount: 1, cleanupWarning: false });
    const stored = findDataImportByScanJob(db, project.id, run.id)!;
    expect(stored.id).toBe(result.importId);
    if (stored.sourceManifest.mode === 'copy') expect(native.readFileSync(join(project.workspacePath,
      stored.sourceManifest.entries[0]!.relativePath))).toEqual(png);
    else expect(stored.sourceManifest.entries[0]!.sourcePath).toBe(join(source, 'image.png'));
    expect(native.readFileSync(join(source, 'image.png'))).toEqual(png);
    const items = listAnnotationItems(db, project.id, result.workspaceId, { offset: 0, limit: 10 }).items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ state: 'unstarted', negativeConfirmed: false, confirmedAt: null });
    await jobs.shutdown(); db.close(); db = openDatabase(dbPath); start();
    expect(await service.commit(project.id, run.id, { mode, rightsAccepted: true })).toEqual(result);
    expect(db.prepare('SELECT id FROM data_imports').all()).toHaveLength(1);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  }, 30_000);

  it('commits detection COCO boxes with actual class UUID mapping and import provenance', async () => {
    project = updateProject(db, { id: project.id, name: project.name, description: project.description,
      workspacePath: project.workspacePath, taskType: 'detection' });
    native.writeFileSync(join(source, 'annotations.json'), JSON.stringify({ images: [{ id: 1, file_name: 'image.png', width: 1, height: 1 }],
      categories: [{ id: 1, name: 'cat' }], annotations: [{ id: 1, image_id: 1, category_id: 1, bbox: [0, 0, 1, 1] }] }));
    const run = scan('copy', 'coco');
    const result = await service.commit(project.id, run.id, { mode: 'copy', rightsAccepted: true, classNames: { 'category:1': 'Cat' } });
    const item = listAnnotationItems(db, project.id, result.workspaceId, { offset: 0, limit: 1 }).items[0]!;
    expect(item.annotation.kind).toBe('detection');
    expect(db.prepare('SELECT kind FROM annotation_provenance').all()).toEqual([{ kind: 'import-unmodified' }]);
    expect(db.prepare('SELECT display_name FROM label_classes').all()).toEqual([{ display_name: 'Cat' }]);
  }, 30_000);

  it('rejects rights false, option accessors and mode mismatch before creating a dataset root', async () => {
    const run = scan(); const getter = vi.fn(() => true);
    await expect(service.commit(project.id, run.id, { mode: 'copy', rightsAccepted: false } as unknown as ImportCommitOptions))
      .rejects.toMatchObject({ code: 'IMPORT_INPUT' });
    await expect(service.commit(project.id, run.id, Object.defineProperty({ mode: 'copy' }, 'rightsAccepted', { enumerable: true, get: getter }) as ImportCommitOptions))
      .rejects.toMatchObject({ code: 'IMPORT_INPUT' });
    await expect(service.commit(project.id, run.id, { mode: 'reference', rightsAccepted: true })).rejects.toMatchObject({ code: 'IMPORT_MODE' });
    expect(getter).not.toHaveBeenCalled(); expect(intents()).toEqual([]); graphEmpty();
    service.discard(run.id);
  });

  it.each(['C:\\selected\\..\\private', '\\\\server\\share', 'C:\\selected\\NUL', 'C:relative'])('rejects unsafe source %s without jobs or filesystem access', (unsafe) => {
    const lstat = vi.spyOn(native, 'lstatSync');
    expect(() => service.scan(project.id, { taskType: 'classification', mode: 'copy', source: { format: 'folder', root: unsafe } }))
      .toThrow(expect.objectContaining({ code: 'IMPORT_INPUT' }));
    expect(lstat).not.toHaveBeenCalled(); expect(jobs.list(project.id)).toEqual([]); graphEmpty();
  });

  it('rejects a foreign transaction before filesystem access or job writes', async () => {
    const lstat = vi.spyOn(native, 'lstatSync'); db.exec('BEGIN');
    await expect(service.commit(project.id, randomUUID(), { mode: 'copy', rightsAccepted: true })).rejects.toMatchObject({ code: 'IMPORT_BUSY' });
    expect(() => scan()).toThrow(expect.objectContaining({ code: 'IMPORT_BUSY' }));
    expect(lstat).not.toHaveBeenCalled(); expect(db.inTransaction).toBe(true); db.exec('ROLLBACK');
  });

  it.each(['TEST_ISSUE', 'TEST_ZERO'] as const)('refuses %s without output or rights and never falsely completes invalid scan', async (flag) => {
    await jobs.shutdown(); start({ [flag]: '1' }); const run = scan();
    await expect(service.commit(project.id, run.id, { mode: 'copy', rightsAccepted: true })).rejects.toMatchObject({
      code: flag === 'TEST_ISSUE' ? 'IMPORT_SCAN_ERRORS' : 'IMPORT_SCAN_FAILED' });
    expect(jobs.get(project.id, run.id)?.status).toBe(flag === 'TEST_ISSUE' ? 'Succeeded' : 'Cancelled');
    expect(intents()).toEqual([]); graphEmpty();
  }, 15_000);

  it('rejects worker images outside the selected prefix without expanding authorization', async () => {
    const outside = join(root, 'outside.png'); native.writeFileSync(outside, png);
    await jobs.shutdown(); start({ TEST_OUTSIDE: outside }); const run = scan();
    await expect(service.preview(project.id, run.id)).rejects.toMatchObject({ code: 'IMPORT_SCAN_FAILED' });
    expect(jobs.get(project.id, run.id)?.status).toBe('Cancelled'); graphEmpty(); expect(intents()).toEqual([]);
  }, 15_000);

  it('strictly snapshots Main-managed file selection before spawn, refusing changed selection output', async () => {
    const selection = join(metadata, 'selection.json'), outside = join(root, 'outside.png'); native.writeFileSync(outside, png);
    native.writeFileSync(selection, JSON.stringify({ formatVersion: 1, files: [join(source, 'image.png')] }));
    const run = service.scan(project.id, { taskType: 'classification', mode: 'copy', source: { format: 'unlabeled', selection: 'files', selectionManifestPath: selection } });
    native.writeFileSync(selection, JSON.stringify({ formatVersion: 1, files: [outside] }));
    await expect(service.preview(project.id, run.id)).rejects.toMatchObject({ code: 'IMPORT_SCAN_FAILED' }); graphEmpty();
  }, 15_000);

  it('capacity shortage reports decimal bytes and creates no import directory', async () => {
    const run = scan(); await service.preview(project.id, run.id);
    const statfs = fs.statfs.bind(fs);
    vi.spyOn(fs, 'statfs').mockImplementation(async (...args) => ({ ...await statfs(...args), bavail: 0n }) as never);
    await expect(service.commit(project.id, run.id, { mode: 'copy', rightsAccepted: true }))
      .rejects.toMatchObject({ code: 'IMPORT_CAPACITY', capacity: { availableBytes: '0', requiredBytes: expect.stringMatching(/^[1-9][0-9]*$/) } });
    graphEmpty(); expect(intents()).toEqual([]);
  }, 15_000);

  it('changed source after preview fails genuine capture without inventing a DB graph', async () => {
    const run = scan(); await service.preview(project.id, run.id);
    native.writeFileSync(join(source, 'image.png'), Buffer.from('changed'));
    await expect(service.commit(project.id, run.id, { mode: 'copy', rightsAccepted: true })).rejects.toMatchObject({ code: 'IMPORT_ATTENTION' });
    graphEmpty(); expect(intents()).toEqual([]);
  }, 15_000);

  it('holds Project exclusion across real capture await and rejects concurrent duplicate commit', async () => {
    const run = scan(); await service.preview(project.id, run.id);
    const entered = Promise.withResolvers<void>(), resume = Promise.withResolvers<void>();
    const capture = reference.captureReferenceSource;
    vi.spyOn(reference, 'captureReferenceSource').mockImplementationOnce(async (image) => {
      const proof = await capture(image); entered.resolve(); await resume.promise; return proof;
    });
    const pending = service.commit(project.id, run.id, { mode: 'copy', rightsAccepted: true });
    try {
      await entered.promise;
      expect(() => updateProject(db, { id: project.id, name: 'during import', description: project.description,
        taskType: project.taskType, workspacePath: project.workspacePath })).toThrow();
      expect(() => beginProjectMoveActivity(db, project.id)).toThrow();
      await expect(service.commit(project.id, run.id, { mode: 'copy', rightsAccepted: true })).rejects.toMatchObject({ code: 'IMPORT_BUSY' });
    } finally { resume.resolve(); }
    await expect(pending).resolves.toMatchObject({ status: 'completed' });
  }, 30_000);

  it('SQL abort after labels rolls back rights and the entire graph, retaining intent and payload', async () => {
    const run = scan(); await service.preview(project.id, run.id);
    db.exec("CREATE TRIGGER test_abort BEFORE INSERT ON data_imports BEGIN SELECT RAISE(ABORT,'test'); END");
    await expect(service.commit(project.id, run.id, { mode: 'copy', rightsAccepted: true })).rejects.toMatchObject({ code: 'IMPORT_ATTENTION' });
    graphEmpty(); expect(intents()).toHaveLength(1); expect(native.existsSync(intents()[0]!)).toBe(true);
    expect(native.readFileSync(join(project.workspacePath, 'datasets', native.readdirSync(join(project.workspacePath, 'datasets'))[0]!, 'source', '00', '00', '000000.png'))).toEqual(png);
    db.exec('DROP TRIGGER test_abort'); const next = scan();
    await expect(service.commit(project.id, next.id, { mode: 'copy', rightsAccepted: true })).rejects.toMatchObject({ code: 'IMPORT_ATTENTION' });
    expect(intents()).toHaveLength(1);
  }, 30_000);

  it('COMMIT acknowledgement loss retains committed files and repeat reads without duplicates', async () => {
    const run = scan(); await service.preview(project.id, run.id);
    const exec = db.exec.bind(db); let importTransaction = false;
    const spy = vi.spyOn(db, 'exec').mockImplementation((sql) => {
      if (sql.startsWith('SAVEPOINT import_')) importTransaction = true;
      const result = exec(sql);
      if (sql === 'COMMIT' && importTransaction) { importTransaction = false; throw new Error('private native failure'); }
      return result;
    });
    await expect(service.commit(project.id, run.id, { mode: 'copy', rightsAccepted: true })).rejects.toMatchObject({ code: 'IMPORT_OUTCOME_UNCERTAIN' });
    spy.mockRestore(); expect(native.existsSync(intents()[0]!)).toBe(true);
    const repeat = await service.commit(project.id, run.id, { mode: 'copy', rightsAccepted: true });
    expect(repeat).toMatchObject({ status: 'completed', cleanupWarning: true });
    expect(db.prepare('SELECT id FROM data_imports').all()).toHaveLength(1);
  }, 30_000);

  it('intent unlink failure returns completed with warning and never rolls back committed rows', async () => {
    const run = scan(); await service.preview(project.id, run.id);
    const unlink = native.unlinkSync.bind(native);
    const spy = vi.spyOn(native, 'unlinkSync').mockImplementation((filename) => {
      if (String(filename).endsWith('.autovision-import.json')) throw new Error('private unlink failure');
      return unlink(filename);
    });
    const result = await service.commit(project.id, run.id, { mode: 'copy', rightsAccepted: true });
    expect(result.cleanupWarning).toBe(true);
    expect(spy.mock.calls.filter(([filename]) => String(filename).endsWith('.autovision-import.json'))).toHaveLength(1);
    expect(await service.commit(project.id, run.id, { mode: 'copy', rightsAccepted: true })).toEqual(result);
  }, 30_000);

  it.each(['hash', 'provenance'] as const)('repeat rejects same-count %s corruption and rolls back its read TX', async (kind) => {
    const run = scan('reference');
    await service.commit(project.id, run.id, { mode: 'reference', rightsAccepted: true });
    if (kind === 'hash') db.prepare('UPDATE annotation_items SET annotation_sha256=?,edit_version=edit_version+1').run('f'.repeat(64));
    else db.exec("UPDATE annotation_provenance SET source_annotation_key='row:999'");
    const before = tables.map((table) => db.prepare(`SELECT * FROM ${table}`).all());
    const lstat = vi.spyOn(native, 'lstatSync');
    await expect(service.commit(project.id, run.id, { mode: 'reference', rightsAccepted: true }))
      .rejects.toMatchObject({ code: 'IMPORT_ATTENTION' });
    expect(db.inTransaction).toBe(false); expect(lstat).not.toHaveBeenCalled();
    expect(tables.map((table) => db.prepare(`SELECT * FROM ${table}`).all())).toEqual(before);
  }, 30_000);

  it('repeat accepts a real class merge with edited annotation hash and retained original provenance', async () => {
    const run = scan('reference');
    const result = await service.commit(project.id, run.id, { mode: 'reference', rightsAccepted: true });
    const schema = getLabelSchema(db, project.id)!;
    const added = createLabelClass(db, project.id, { schemaId: schema.id, expectedEditVersion: schema.editVersion,
      displayName: 'Dog', modelAlias: null, color: '#112233', description: '', examples: [], ordinal: 1 });
    const target = added.classes.find((entry) => entry.displayName === 'Dog')!;
    const itemId = listAnnotationItems(db, project.id, result.workspaceId, { offset: 0, limit: 1 }).items[0]!.id;
    const before = getAnnotationItem(db, project.id, result.workspaceId, itemId);
    mergeLabelClasses(db, project.id, schema.id, schema.classes[0]!.id, target.id, added.editVersion);
    const after = getAnnotationItem(db, project.id, result.workspaceId, itemId);
    expect(after).not.toEqual(before);
    expect(await service.commit(project.id, run.id, { mode: 'reference', rightsAccepted: true })).toEqual(result);
    expect(getAnnotationItem(db, project.id, result.workspaceId, itemId)).toEqual(after);
  }, 30_000);

  it('commits an empty retry lookup read TX and rejects stored mode mismatch without filesystem reads', async () => {
    const exec = vi.spyOn(db, 'exec');
    await expect(service.commit(project.id, randomUUID(), { mode: 'copy', rightsAccepted: true }))
      .rejects.toMatchObject({ code: 'IMPORT_NOT_FOUND' });
    expect(exec.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN DEFERRED', expect.stringMatching(/^SAVEPOINT read_import_[a-f0-9]{32}$/u), 'COMMIT']);
    expect(db.inTransaction).toBe(false); exec.mockRestore();
    const run = scan('reference'); await service.commit(project.id, run.id, { mode: 'reference', rightsAccepted: true });
    const lstat = vi.spyOn(native, 'lstatSync');
    await expect(service.commit(project.id, run.id, { mode: 'copy', rightsAccepted: true })).rejects.toMatchObject({ code: 'IMPORT_MODE' });
    expect(lstat).not.toHaveBeenCalled(); expect(db.inTransaction).toBe(false);
  }, 30_000);

  it('repeat observes filesystem only after COMMIT and never rolls back a replacement caller TX', async () => {
    const run = scan('reference'); const options = { mode: 'reference', rightsAccepted: true } as const;
    const result = await service.commit(project.id, run.id, options);
    const lstat = native.lstatSync.bind(native);
    const filesystem = vi.spyOn(native, 'lstatSync').mockImplementation(((...args: Parameters<typeof native.lstatSync>) => {
      expect(db.inTransaction).toBe(false); return lstat(...args);
    }) as typeof native.lstatSync);
    expect(await service.commit(project.id, run.id, options)).toEqual(result);
    expect(filesystem).toHaveBeenCalled(); filesystem.mockRestore();
    const exec = db.exec.bind(db);
    vi.spyOn(db, 'exec').mockImplementation((sql) => {
      const value = exec(sql);
      if (sql === 'COMMIT') { exec('BEGIN'); throw new Error('read acknowledgement lost with replacement TX'); }
      return value;
    });
    await expect(service.commit(project.id, run.id, options)).rejects.toMatchObject({ code: 'IMPORT_ATTENTION' });
    expect(db.inTransaction).toBe(true);
  }, 30_000);

  it('retains 32 transport-completed Running scans, then admits another after actual cancellation without preview', async () => {
    const runs = [];
    for (let index = 0; index < 32; index += 1) {
      const run = scan(); runs.push(run); await workerCompleted(run.id);
      expect(jobs.get(project.id, run.id)?.status).toBe('Running');
    }
    expect(() => scan()).toThrow(expect.objectContaining({ code: 'IMPORT_BUSY' }));
    expect(jobs.list(project.id)).toHaveLength(32);
    for (const run of runs) expect(jobs.cancel(project.id, run.id).status).toBe('Cancelled');
    const next = scan(); expect(jobs.list(project.id)).toHaveLength(33);
    await expect(service.preview(project.id, next.id)).resolves.toMatchObject({ itemCount: 1 });
    await expect(service.preview(project.id, runs[0]!.id)).rejects.toMatchObject({ code: 'IMPORT_SCAN_FAILED' });
  }, 60_000);

  it('retains 32 valid Succeeded previews and rejects without creating an extra job', async () => {
    const runs = [];
    for (let index = 0; index < 32; index += 1) {
      const run = scan(); runs.push(run); await service.preview(project.id, run.id);
    }
    expect(jobs.list(project.id).every((job) => job.status === 'Succeeded')).toBe(true);
    expect(() => scan()).toThrow(expect.objectContaining({ code: 'IMPORT_BUSY' }));
    expect(jobs.list(project.id)).toHaveLength(32);
    await expect(service.preview(project.id, runs[0]!.id)).resolves.toMatchObject({ itemCount: 1 });
    service.discard(runs[0]!.id);
    const next = scan(); await service.preview(project.id, next.id);
    expect(jobs.list(project.id)).toHaveLength(33);
  }, 60_000);

  it('keeps 32 active contexts at the JobService boundary and prunes only exact Failed jobs', () => {
    const entries = new Map<string, ReturnType<JobService['startScan']>['job']>();
    const startScan = vi.fn<JobService['startScan']>(() => {
      const at = new Date().toISOString();
      const job = { id: randomUUID(), projectId: project.id, kind: 'scan-dataset', status: 'Preparing', createdAt: at, updatedAt: at } as const;
      entries.set(job.id, job);
      return { job, donePromise: new Promise(() => undefined) };
    });
    const get = vi.fn<JobService['get']>((parent, id) => {
      const job = entries.get(id); return job?.projectId === parent ? job : undefined;
    });
    const boundary = createImportService(db, { ...jobs, startScan, get }, { taskRoot: tasks, metadataDirectory: metadata, protectedRoots: [] });
    const payload = { taskType: project.taskType, mode: 'copy', source: { format: 'folder', root: source } };
    for (let index = 0; index < 32; index += 1) boundary.scan(project.id, payload);
    expect(() => boundary.scan(project.id, payload)).toThrow(expect.objectContaining({ code: 'IMPORT_BUSY' }));
    expect(startScan).toHaveBeenCalledTimes(32);
    for (const [id, job] of entries) entries.set(id, { ...job, status: 'Running' });
    expect(() => boundary.scan(project.id, payload)).toThrow(expect.objectContaining({ code: 'IMPORT_BUSY' }));
    expect(startScan).toHaveBeenCalledTimes(32);
    const closed = entries.values().next().value!;
    get.mockImplementation((parent, id) => id === closed.id ? { ...closed, projectId: randomUUID(), status: 'Failed' }
      : entries.get(id)?.projectId === parent ? entries.get(id) : undefined);
    expect(() => boundary.scan(project.id, payload)).toThrow(expect.objectContaining({ code: 'IMPORT_BUSY' }));
    expect(startScan).toHaveBeenCalledTimes(32);
    get.mockImplementation((parent, id) => entries.get(id)?.projectId === parent ? entries.get(id) : undefined);
    entries.set(closed.id, { ...closed, status: 'Failed' });
    expect(boundary.scan(project.id, payload).status).toBe('Preparing');
    expect(startScan).toHaveBeenCalledTimes(33);
  });
});