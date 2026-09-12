import { randomUUID } from 'node:crypto';
import fs, { type BigIntStats } from 'node:fs';
import { win32 } from 'node:path';
import { isDeepStrictEqual, types } from 'node:util';

import { decodeSelectionManifest, MAX_ANNOTATION_BYTES, parseScanPayload,
  type ScanContext, type ScanPayload, type ScanResult } from '../../shared/contracts/import.js';
import { jobIdSchema, type Job } from '../../shared/contracts/job.js';
import { projectIdSchema, type Project } from '../../shared/contracts/project.js';
import { insertImportLabels, prepareImportLabels } from '../annotations/label-schema-service.js';
import { insertPreparedAnnotationWorkspace,
  prepareAnnotationWorkspaceForImport, validateImportedWorkspace } from '../annotations/workspace-service.js';
import type { DatabaseConnection } from '../db/database.js';
import type { JobService } from '../jobs/job-service.js';
import type { WorkerResult } from '../jobs/worker-supervisor.js';
import { verifyProjectDirectory, type ProjectDirectoryReceipt } from '../projects/project-directory.js';
import { beginProjectImport } from '../projects/project-operation-lock.js';
import { getProject, getProjects } from '../projects/project-service.js';
import { preflightImportCapacity } from './import-capacity.js';
import { assertImportFilesCurrent, finishImportFiles, materializeImportSources } from './import-files.js';
import { findDataImportByScanJob, insertDataImport, prepareDataImport, readPreparedDataImport } from './import-repository.js';
import { acknowledgeImportRights } from './rights-acknowledgement.js';
import { assertScanArtifactCurrent, readScanArtifact, type ScanArtifact } from './scan-artifact.js';

export type ImportServiceErrorCode = 'IMPORT_INPUT' | 'IMPORT_BUSY' | 'IMPORT_MODE' | 'IMPORT_NOT_FOUND'
  | 'IMPORT_SCAN_FAILED' | 'IMPORT_SCAN_ERRORS' | 'IMPORT_CAPACITY' | 'IMPORT_PROJECT_CHANGED'
  | 'IMPORT_ATTENTION' | 'IMPORT_OUTCOME_UNCERTAIN';
export class ImportServiceError extends Error {
  constructor(readonly code: ImportServiceErrorCode,
    readonly capacity?: Readonly<{ requiredBytes: string; availableBytes: string }>, cause?: unknown) {
    super(code, { cause }); this.name = 'ImportServiceError';
  }
}
export interface ImportResult {
  readonly status: 'completed'; readonly projectId: string; readonly importId: string;
  readonly workspaceId: string; readonly itemCount: number; readonly cleanupWarning: boolean;
}
export interface ImportPreview {
  readonly projectId: string; readonly jobId: string; readonly taskType: ScanResult['taskType'];
  readonly mode: ScanResult['mode']; readonly itemCount: number; readonly sourceBytes: string;
  readonly classes: Readonly<ScanResult['classes']>;
  readonly issues: readonly Readonly<{ severity: 'error' | 'warning'; code: string;
    imageKey: string | null; row: number | null; itemId: string | null }>[];
  readonly files: readonly Readonly<{ key: string; displayName: string }>[];
}
export interface ImportCommitOptions {
  readonly mode: 'copy' | 'reference'; readonly rightsAccepted: true;
  readonly classNames?: Readonly<Record<string, string>>;
}
export interface ImportService {
  scan(projectId: string, payload: unknown): Job;
  preview(projectId: string, jobId: string): Promise<ImportPreview>;
  commit(projectId: string, jobId: string, options: ImportCommitOptions): Promise<ImportResult>;
  discard(jobId: string): void;
}
export interface ImportConfiguration {
  readonly taskRoot: string; readonly metadataDirectory: string; readonly protectedRoots: readonly string[];
}
const intentName = '.autovision-import.json';
// Operational memory/enumeration bounds, not product throughput guarantees.
const maxContexts = 32;
const maxDatasetChildren = 100_000;
function fail(code: ImportServiceErrorCode): never { throw new ImportServiceError(code); }
function safeError(error: unknown, fallback: ImportServiceErrorCode): ImportServiceError {
  return error instanceof ImportServiceError ? error : new ImportServiceError(fallback, undefined, error);
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || types.isProxy(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value) as object | null)) fail('IMPORT_INPUT');
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(value)) {
    const field = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !field?.enumerable || !('value' in field)) fail('IMPORT_INPUT');
    Object.defineProperty(result, key, { value: field.value, enumerable: true });
  }
  return result;
}
function optionsSnapshot(value: unknown): ImportCommitOptions {
  const fields = record(value);
  if (Object.keys(fields).some((key) => !['mode', 'rightsAccepted', 'classNames'].includes(key))
    || fields.rightsAccepted !== true || !['copy', 'reference'].includes(fields.mode as string)) fail('IMPORT_INPUT');
  if (!Object.hasOwn(fields, 'classNames')) return Object.freeze({ mode: fields.mode as 'copy' | 'reference', rightsAccepted: true });
  const names = record(fields.classNames);
  if (Object.values(names).some((name) => typeof name !== 'string' || !name.isWellFormed())) fail('IMPORT_INPUT');
  return Object.freeze({ mode: fields.mode as 'copy' | 'reference', rightsAccepted: true,
    classNames: Object.freeze(names as Record<string, string>) });
}
function path(value: unknown): string {
  if (typeof value !== 'string' || !value.isWellFormed() || value.length > 32_767
    || !/^[a-z]:\\/iu.test(value) || value !== win32.normalize(value)
    || value.slice(3).split('\\').some((part) => !part || part.length > 255
      || /[\u0000-\u001f\u007f<>:"/\\|?*]/u.test(part) || /[ .]$/u.test(part)
      || /^(?:con|conin\$|conout\$|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/iu.test(part))) fail('IMPORT_INPUT');
  return value;
}
function contains(parent: string, child: string): boolean {
  const relative = win32.relative(parent.toUpperCase(), child.toUpperCase());
  return relative === '' || (relative !== '..' && !relative.startsWith('..\\') && !win32.isAbsolute(relative));
}
function intersects(a: string, b: string): boolean { return contains(a, b) || contains(b, a); }
function ordinary(directory: string): BigIntStats {
  const stat = fs.lstatSync(directory, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync.native(directory) !== directory) fail('IMPORT_ATTENTION');
  return stat;
}
function directoryChain(directory: string): void {
  let cursor = win32.parse(directory).root;
  ordinary(cursor);
  for (const part of directory.slice(3).split('\\')) { cursor = win32.join(cursor, part); ordinary(cursor); }
}
function absent(error: unknown): boolean { return error instanceof Error && 'code' in error && error.code === 'ENOENT'; }
function sameIdentity(a: BigIntStats, b: BigIntStats): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.birthtimeNs === b.birthtimeNs;
}
function sameFile(a: BigIntStats, b: BigIntStats): boolean {
  return sameIdentity(a, b)
    && a.size === b.size && a.mtimeNs === b.mtimeNs && a.nlink === b.nlink;
}
/** Bounded Main-managed selection read BEFORE worker start; no result-derived authority. */
function selectionPaths(filename: string): readonly string[] {
  directoryChain(win32.dirname(filename));
  const regular = (stat: BigIntStats) => {
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n || stat.size <= 0n
      || stat.size > BigInt(MAX_ANNOTATION_BYTES)) fail('IMPORT_INPUT');
    return stat;
  };
  const before = regular(fs.lstatSync(filename, { bigint: true }));
  const fd = fs.openSync(filename, 'r');
  try {
    const opened = regular(fs.fstatSync(fd, { bigint: true }));
    const pathOpened = regular(fs.lstatSync(filename, { bigint: true }));
    if (!sameFile(before, opened) || !sameFile(opened, pathOpened)) fail('IMPORT_INPUT');
    const bytes = Buffer.alloc(Number(opened.size));
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(fd, bytes, offset, Math.min(65_536, bytes.length - offset), offset);
      if (count <= 0) fail('IMPORT_INPUT'); offset += count;
    }
    const end = Buffer.alloc(1);
    const after = regular(fs.fstatSync(fd, { bigint: true }));
    const pathAfter = regular(fs.lstatSync(filename, { bigint: true }));
    if (fs.readSync(fd, end, 0, 1, offset) !== 0 || !sameFile(opened, after)
      || opened.ctimeNs !== after.ctimeNs || !sameFile(pathOpened, pathAfter)
      || pathOpened.ctimeNs !== pathAfter.ctimeNs) fail('IMPORT_INPUT');
    return Object.freeze(decodeSelectionManifest(bytes).files.map(path));
  } finally { fs.closeSync(fd); }
}
interface Scope { readonly roots: readonly string[]; readonly exact: ReadonlySet<string> | null }
interface Context {
  readonly project: Project; readonly directory: ProjectDirectoryReceipt; readonly projects: readonly string[];
  readonly protectedRoots: readonly string[]; readonly scope: Scope; readonly expected: ScanContext;
  readonly jobDirectory: string; readonly donePromise: Promise<WorkerResult>;
  phase: 'scanning' | 'ready' | 'committing' | 'attention'; discarded: boolean;
  artifact?: ScanArtifact; previewPromise?: Promise<ImportPreview>;
}
function rootsSnapshot(projects: Project[]): readonly string[] {
  return Object.freeze(projects.map((project) => `${project.id}:${path(project.workspacePath)}`).sort());
}
function scanAllowed(scan: ScanResult, scope: Scope, protectedRoots: readonly string[]): void {
  for (const image of scan.images) {
    const source = path(image.sourcePath);
    if (scope.exact ? !scope.exact.has(source) : !scope.roots.some((root) => contains(root, source))) fail('IMPORT_SCAN_FAILED');
    if (protectedRoots.some((root) => contains(root, source))) fail('IMPORT_SCAN_FAILED');
  }
}
/** Known current-import storage only: measured escaped UTF-8 plus conservative
 * row/index/page/WAL allowance. Not an exact upper bound, reservation, HPO or
 * future training/model/cache/export estimate. Unknown statfs is NEVER zero. */
export function estimateImportStorage(scan: ScanResult, classNames: Readonly<Record<string, string>> = {}) {
  const encoded = (value: unknown) => BigInt(Buffer.byteLength(JSON.stringify(value), 'utf8'));
  let sourceBytes = 0n, temporaryBytes = 0n, entries = 0n, boxes = 0n;
  for (const image of scan.images) {
    sourceBytes += BigInt(image.byteSize);
    if (BigInt(image.byteSize) > temporaryBytes) temporaryBytes = BigInt(image.byteSize);
    entries += encoded({ imageKey: image.key, sourcePath: image.sourcePath,
      byteSize: image.byteSize, mtimeNs: image.mtimeNs, sha256: image.sha256 }) + 512n;
    if (image.annotation?.type === 'detection') boxes += BigInt(image.annotation.boxes.length);
  }
  const imageCount = BigInt(scan.images.length);
  const metadataBytes = 4n * (2n * encoded(scan) + entries + imageCount * 4096n
    + boxes * 1024n + BigInt(scan.classes.length) * 2048n + encoded(classNames) + 16_384n);
  const buckets = (imageCount + 255n) / 256n;
  const directoryBytes = 4096n * (scan.mode === 'copy' ? 4n + buckets + (buckets + 255n) / 256n : 3n);
  return Object.freeze({ sourceBytes, temporaryBytes: scan.mode === 'copy' ? temporaryBytes : 0n,
    metadataBytes, directoryBytes });
}
/** Only direct ordinary UUID children are inspected. No recursion/adoption/deletion. */
function pendingIntent(root: string, onlyId?: string): boolean {
  const datasets = win32.join(root, 'datasets');
  try { ordinary(datasets); } catch (error) { if (absent(error)) return false; throw error; }
  const directory = fs.opendirSync(datasets);
  let count = 0;
  try {
    for (let entry = directory.readSync(); entry; entry = directory.readSync()) {
      if (++count > maxDatasetChildren) fail('IMPORT_ATTENTION');
      if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/iu.test(entry.name)) continue;
      if (onlyId !== undefined && entry.name !== onlyId) continue;
      if (entry.name !== entry.name.toLowerCase()) fail('IMPORT_ATTENTION');
      const child = win32.join(datasets, entry.name);
      ordinary(child);
      try {
        const stat = fs.lstatSync(win32.join(child, intentName), { bigint: true });
        if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n) fail('IMPORT_ATTENTION');
        return true;
      } catch (error) { if (!absent(error)) throw error; }
    }
    return false;
  } finally { directory.closeSync(); }
}

/** Main-only. The caller MUST use the same taskRoot as this JobService's fixed
 * startup configuration; its public API cannot introspect that configuration.
 * Pass only retained Main picker selections, NEVER Renderer-authored paths.
 * Own one instance per DB/JobService. discard releases retained previews; at most
 * 32 contexts are kept. No automatic import, retry, intent recovery or cleanup.
 * Job Succeeded means validated SCAN, not completed import. */
export function createImportService(database: DatabaseConnection, jobs: JobService,
  trustedConfig: ImportConfiguration): ImportService {
  let config: ImportConfiguration;
  try {
    const raw = record(trustedConfig);
    if (Object.keys(raw).length !== 3 || !Array.isArray(raw.protectedRoots) || types.isProxy(raw.protectedRoots)
      || Object.getPrototypeOf(raw.protectedRoots) !== Array.prototype
      || Reflect.ownKeys(raw.protectedRoots).length !== raw.protectedRoots.length + 1) fail('IMPORT_INPUT');
    const roots: string[] = [];
    for (let index = 0; index < raw.protectedRoots.length; index += 1) {
      const field = Object.getOwnPropertyDescriptor(raw.protectedRoots, String(index));
      if (!field || !('value' in field)) fail('IMPORT_INPUT'); roots.push(path(field.value));
    }
    config = Object.freeze({ taskRoot: path(raw.taskRoot), metadataDirectory: path(raw.metadataDirectory),
      protectedRoots: Object.freeze(roots) });
  } catch (error) { throw safeError(error, 'IMPORT_INPUT'); }
  const contexts = new Map<string, Context>();
  function idle(): void { if (!database.open) fail('IMPORT_ATTENTION'); if (database.inTransaction) fail('IMPORT_BUSY'); }
  function ids(projectId: string, jobId?: string): [string, string] {
    try { return [projectIdSchema.parse(projectId), jobId === undefined ? '' : jobIdSchema.parse(jobId)]; }
    catch { return fail('IMPORT_INPUT'); }
  }
  function project(id: string): Project { try { return getProject(database, id); } catch { return fail('IMPORT_NOT_FOUND'); } }
  function guard(context: Context, participant = false): void {
    if (!participant) idle();
    if (context.discarded || !isDeepStrictEqual(getProject(database, context.project.id), context.project)
      || !isDeepStrictEqual(rootsSnapshot(getProjects(database)), context.projects)
      || !isDeepStrictEqual(verifyProjectDirectory(context.project.workspacePath, context.project.id), context.directory)) {
      fail('IMPORT_PROJECT_CHANGED');
    }
  }
  function lookup(projectId: string, jobId: string): Context {
    const context = contexts.get(jobId);
    if (!context || context.expected.projectId !== projectId || context.discarded) {
      const status = jobs.get(projectId, jobId)?.status;
      if (status === 'Cancelled' || status === 'Failed') fail('IMPORT_SCAN_FAILED');
      fail('IMPORT_NOT_FOUND');
    }
    return context;
  }
  function previewInternal(context: Context): Promise<ImportPreview> {
    if (context.previewPromise) return context.previewPromise;
    context.previewPromise = (async () => {
      try {
        const transport = await context.donePromise;
        guard(context);
        if (transport.type !== 'completed' || jobs.getSnapshot(context.expected.projectId, context.expected.jobId)?.job.status !== 'Running') {
          fail('IMPORT_SCAN_FAILED');
        }
        const artifact = await readScanArtifact(context.jobDirectory, transport.manifestPath, context.expected);
        guard(context);
        scanAllowed(artifact.result, context.scope, context.protectedRoots);
        jobs.completeScan(context.expected.projectId, context.expected.jobId);
        context.artifact = artifact;
        if (context.phase !== 'committing') context.phase = 'ready';
        const scan = artifact.result;
        return Object.freeze({ ...context.expected, itemCount: scan.images.length,
          sourceBytes: String(scan.images.reduce((sum, image) => sum + BigInt(image.byteSize), 0n)),
          classes: scan.classes,
          issues: Object.freeze(scan.issues.map((issue) => Object.freeze({ severity: issue.severity, code: issue.code,
            imageKey: issue.target.imageKey, row: issue.target.row, itemId: issue.target.itemId }))),
          files: Object.freeze(scan.images.map((image) => Object.freeze({ key: image.key, displayName: win32.basename(image.sourcePath) }))) });
      } catch (error) {
        context.phase = 'attention'; contexts.delete(context.expected.jobId);
        try { jobs.cancel(context.expected.projectId, context.expected.jobId); } catch { /* No false success or native diagnostic. */ }
        throw safeError(error, 'IMPORT_SCAN_FAILED');
      }
    })();
    return context.previewPromise;
  }
  function completed(projectId: string, jobId: string, mode: ImportCommitOptions['mode']): ImportResult | undefined {
    idle();
    const marker = `read_import_${randomUUID().replaceAll('-', '')}`;
    let validated: { id: string; itemCount: number } | undefined;
    database.exec('BEGIN DEFERRED');
    try {
      database.exec(`SAVEPOINT ${marker}`);
      const stored = findDataImportByScanJob(database, projectId, jobId);
      if (stored) {
        if (stored.mode !== mode) fail('IMPORT_MODE');
        const graph = validateImportedWorkspace(database, projectId, stored.id, stored);
        validated = { id: stored.id, itemCount: graph.itemCount };
      }
      database.exec('COMMIT');
    } catch (error) {
      // A missing private marker stops before ROLLBACK, protecting any later caller TX.
      try { database.exec(`ROLLBACK TO ${marker}; ROLLBACK`); } catch { /* Never guess ownership. */ }
      throw safeError(error, 'IMPORT_ATTENTION');
    }
    if (!validated) return undefined;
    // Filesystem observations happen only after the read snapshot is committed.
    let cleanupWarning = true;
    try {
      const current = project(projectId); path(current.workspacePath);
      verifyProjectDirectory(current.workspacePath, projectId);
      cleanupWarning = pendingIntent(current.workspacePath, validated.id);
    } catch { /* Committed graph stays completed; no authority to unlink an old intent. */ }
    return Object.freeze({ status: 'completed', projectId, importId: validated.id, workspaceId: validated.id,
      itemCount: validated.itemCount, cleanupWarning });
  }
  return Object.freeze({
    scan(projectId: string, payload: unknown): Job {
      try {
        idle(); const [parent] = ids(projectId);
        if (contexts.size >= maxContexts) {
          for (const [id, context] of contexts) {
            if (context.phase === 'committing') continue;
            const current = jobs.get(context.expected.projectId, id);
            if (current?.id === id && current.projectId === context.expected.projectId
              && (current.status === 'Cancelled' || current.status === 'Failed')) {
              context.discarded = true; contexts.delete(id);
            }
          }
        }
        if (contexts.size >= maxContexts) fail('IMPORT_BUSY');
        // Parse a detached finite shape without evaluating getters/proxies.
        const fields = record(payload), sourceFields = record(fields.source);
        if (Object.keys(fields).some((key) => !['taskType', 'mode', 'source'].includes(key))
          || typeof fields.taskType !== 'string' || typeof fields.mode !== 'string'
          || Object.values(sourceFields).some((value) => typeof value !== 'string')) fail('IMPORT_INPUT');
        const parsed: ScanPayload = parseScanPayload({ ...fields, source: sourceFields });
        Object.freeze(parsed.source); Object.freeze(parsed);
        const current = project(parent);
        if (current.taskType !== parsed.taskType) fail('IMPORT_INPUT');
        path(current.workspacePath);
        const all = getProjects(database), projects = rootsSnapshot(all);
        // Metadata anchors capacity checks; its descendants may be default projects.
        // A project must never own the metadata directory itself, however.
        if (contains(current.workspacePath, config.metadataDirectory)) fail('IMPORT_PROJECT_CHANGED');
        const protections = Object.freeze([...config.protectedRoots, config.taskRoot,
          ...all.filter((entry) => entry.id !== parent).map((entry) => path(entry.workspacePath))]);
        if (protections.some((root) => intersects(current.workspacePath, root))) fail('IMPORT_PROJECT_CHANGED');
        let scope: Scope;
        const source = parsed.source;
        // Lexically validate ALL supplied paths before any filesystem operation.
        if (source.format === 'unlabeled' && source.selection === 'files') {
          path(source.selectionManifestPath);
          if (![config.taskRoot, config.metadataDirectory].some((root) => contains(root, source.selectionManifestPath))) fail('IMPORT_INPUT');
          const selected = selectionPaths(source.selectionManifestPath);
          scope = { roots: Object.freeze([...new Set(selected.map((entry) => win32.dirname(entry)))]), exact: new Set(selected) };
        } else {
          path(source.root);
          if ('annotationPath' in source) path(source.annotationPath);
          scope = { roots: Object.freeze(source.format === 'csv'
            ? [source.root, win32.dirname(source.annotationPath)] : [source.root]), exact: null };
        }
        const protectedRoots = Object.freeze([...protections, current.workspacePath]);
        if (scope.exact && [...scope.exact].some((entry) => protectedRoots.some((root) => contains(root, entry)))) fail('IMPORT_INPUT');
        if (!scope.exact && scope.roots.some((root) => protectedRoots.some((protectedRoot) => intersects(root, protectedRoot)))) fail('IMPORT_INPUT');
        if ('annotationPath' in source && protectedRoots.some((root) => contains(root, source.annotationPath))) fail('IMPORT_INPUT');
        const directory = verifyProjectDirectory(current.workspacePath, parent);
        const run = jobs.startScan(parent, parsed);
        const context: Context = { project: Object.freeze(current), directory, projects, protectedRoots, scope,
          expected: Object.freeze({ projectId: parent, jobId: run.job.id, taskType: parsed.taskType, mode: parsed.mode }),
          jobDirectory: win32.join(config.taskRoot, run.job.id), donePromise: run.donePromise, phase: 'scanning', discarded: false };
        contexts.set(run.job.id, context);
        void run.donePromise.then((result) => { if (result.type === 'cancelled') contexts.delete(run.job.id); }, () => contexts.delete(run.job.id));
        return run.job;
      } catch (error) { throw safeError(error, 'IMPORT_INPUT'); }
    },
    preview(projectId: string, jobId: string): Promise<ImportPreview> {
      try { idle(); const [parent, id] = ids(projectId, jobId); return previewInternal(lookup(parent, id)); }
      catch (error) { return Promise.reject(safeError(error, 'IMPORT_SCAN_FAILED')); }
    },
    async commit(projectId: string, jobId: string, value: ImportCommitOptions): Promise<ImportResult> {
      let release: (() => void) | undefined, context: Context | undefined;
      let materializing = false;
      try {
        const options = optionsSnapshot(value); // Before first await, including repeats.
        idle(); const [parent, id] = ids(projectId, jobId);
        context = contexts.get(id);
        if (context?.phase === 'committing') fail('IMPORT_BUSY');
        const existing = completed(parent, id, options.mode);
        if (existing) { contexts.delete(id); return existing; }
        context = lookup(parent, id);
        if (context.phase === 'attention') fail('IMPORT_ATTENTION');
        if (options.mode !== context.expected.mode) fail('IMPORT_MODE');
        try { release = beginProjectImport(database, parent); } catch { fail('IMPORT_BUSY'); }
        context.phase = 'committing';
        await previewInternal(context); guard(context);
        const artifact = context.artifact!;
        const scan = artifact.result;
        if (scan.issues.some((issue) => issue.severity === 'error')) fail('IMPORT_SCAN_ERRORS');
        if (pendingIntent(context.project.workspacePath)) fail('IMPORT_ATTENTION');
        const budget = estimateImportStorage(scan, options.classNames);
        directoryChain(config.metadataDirectory);
        const metadata = ordinary(config.metadataDirectory), destination = ordinary(context.project.workspacePath);
        const sameVolume = metadata.dev === destination.dev;
        const capacity = await preflightImportCapacity(context.project.workspacePath, { mode: scan.mode,
          sourceBytes: budget.sourceBytes, temporaryBytes: budget.temporaryBytes,
          generatedBytes: budget.directoryBytes + (sameVolume ? budget.metadataBytes : 0n) });
        guard(context);
        if (!capacity.sufficient) throw new ImportServiceError('IMPORT_CAPACITY', Object.freeze({
          requiredBytes: String(capacity.requiredBytes), availableBytes: String(capacity.availableBytes) }));
        if (!sameVolume) {
          const metadataCapacity = await preflightImportCapacity(config.metadataDirectory, { mode: 'reference',
            sourceBytes: 0n, temporaryBytes: 0n, generatedBytes: budget.metadataBytes });
          guard(context);
          if (!metadataCapacity.sufficient) throw new ImportServiceError('IMPORT_CAPACITY', Object.freeze({
            requiredBytes: String(metadataCapacity.requiredBytes), availableBytes: String(metadataCapacity.availableBytes) }));
        }
        const capacityLocationsCurrent = () => {
          directoryChain(config.metadataDirectory);
          if (!sameIdentity(metadata, ordinary(config.metadataDirectory))
            || !sameIdentity(destination, ordinary(context!.project.workspacePath))) fail('IMPORT_PROJECT_CHANGED');
        };
        capacityLocationsCurrent();
        // Validate names/locked schema before creating output. The participant
        // rechecks the full committed label snapshot inside the write TX.
        const labels = prepareImportLabels(database, parent, scan.classes, options.classNames);
        guard(context);
        if (pendingIntent(context.project.workspacePath)) fail('IMPORT_ATTENTION');
        const importId = randomUUID(); materializing = true;
        const files = await materializeImportSources(context.directory, importId, scan,
          context.protectedRoots.filter((root) => root !== context!.project.workspacePath));
        guard(context); capacityLocationsCurrent();
        const createdAt = new Date().toISOString();
        const prepared = prepareDataImport({ id: importId, createdAt, updatedAt: createdAt,
          scanResult: scan, sourceManifest: files.sourceManifest });
        if (readPreparedDataImport(prepared).id !== importId) fail('IMPORT_ATTENTION');
        const workspace = prepareAnnotationWorkspaceForImport(database, prepared, labels);
        assertScanArtifactCurrent(artifact); assertImportFilesCurrent(files); guard(context); capacityLocationsCurrent();
        const marker = `import_${randomUUID().replaceAll('-', '')}`;
        let committing = false;
        database.exec('BEGIN IMMEDIATE');
        try {
          database.exec(`SAVEPOINT ${marker}`);
          acknowledgeImportRights(database, parent, true);
          insertImportLabels(database, labels);
          insertDataImport(database, prepared);
          insertPreparedAnnotationWorkspace(database, workspace);
          assertImportFilesCurrent(files); guard(context, true); capacityLocationsCurrent();
          committing = true; database.exec('COMMIT');
        } catch (error) {
          try { database.exec(`ROLLBACK TO ${marker}; ROLLBACK`); } catch { /* Private marker protects unrelated TX. */ }
          throw new ImportServiceError(committing ? 'IMPORT_OUTCOME_UNCERTAIN' : 'IMPORT_ATTENTION', undefined, error);
        }
        let cleanupWarning = false;
        try { finishImportFiles(files); } catch { cleanupWarning = true; }
        contexts.delete(id);
        return Object.freeze({ status: 'completed', projectId: parent, importId, workspaceId: workspace.id,
          itemCount: workspace.itemCount, cleanupWarning });
      } catch (error) {
        if (context && release) {
          context.phase = materializing ? 'attention' : 'ready';
          if (materializing) contexts.delete(context.expected.jobId);
        }
        throw safeError(error, 'IMPORT_ATTENTION');
      } finally { release?.(); }
    },
    discard(jobId: string): void {
      try {
        idle(); let id: string; try { id = jobIdSchema.parse(jobId); } catch { return fail('IMPORT_INPUT'); }
        const context = contexts.get(id); if (!context) return;
        if (context.phase === 'committing') fail('IMPORT_BUSY');
        jobs.cancel(context.expected.projectId, id);
        context.discarded = true; contexts.delete(id);
      } catch (error) { throw safeError(error, 'IMPORT_ATTENTION'); }
    },
  });
}