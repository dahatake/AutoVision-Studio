import { createHash } from 'node:crypto';
import { win32 } from 'node:path';
import { z } from 'zod';

import {
  MAX_SCAN_RESULT_BYTES,
  decodeScanResult,
  scanResultSchema,
  type ScanContext,
  type ScanResult,
} from '../../shared/contracts/import.js';
import { jobIdSchema } from '../../shared/contracts/job.js';
import { projectIdSchema, taskTypeSchema } from '../../shared/contracts/project.js';
import type { DatabaseConnection } from '../db/database.js';
import {
  importImageKeySchema as imageKey,
  importJsonObjectSchema as jsonObject,
  importSha256Schema as sha256,
  importSourceManifestSchema,
  isImportScalar as scalar,
  type CopyImportSource,
  type ImportSourceManifest,
  type ReferenceImportSource,
} from './import-source-manifest.js';
import {
  assertCapturedReferenceSource,
  assertCapturedReferenceSourceCurrent,
  assertCapturedReferenceSourcesCurrent,
} from './reference-access.js';

export {
  importSourceManifestSchema,
  type CopyImportSource,
  type ImportSourceManifest,
  type ReferenceFileIdentity,
  type ReferenceImportSource,
} from './import-source-manifest.js';

const invalidMessage = 'Import persistence input is invalid.';
const corruptMessage = 'Stored import persistence data is invalid or changed.';
const canonicalChunkChars = 64 * 1024;
const maximumGeneration = 9223372036854775807n;

function invalid(): never { throw new Error(invalidMessage); }
function corrupt(): never { throw new Error(corruptMessage); }

function exactGeneration(value: unknown): string {
  if (typeof value !== 'string' || value.length > 19
    || !/^[1-9][0-9]*(?![\s\S])/u.test(value) || BigInt(value) > maximumGeneration) corrupt();
  return value;
}

function currentGeneration(database: DatabaseConnection, importId: string): string {
  const row = database.prepare(`SELECT CAST(generation AS TEXT) AS generation
    FROM import_generations WHERE import_id=?`).get(importId) as { generation?: unknown } | undefined;
  return exactGeneration(row?.generation);
}

export interface NewDataImport {
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly scanResult: ScanResult;
  readonly sourceManifest: ImportSourceManifest;
}

export interface DataImport {
  readonly id: string;
  readonly projectId: string;
  readonly scanJobId: string;
  readonly taskType: 'classification' | 'detection';
  readonly mode: 'copy' | 'reference';
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly scanResultSha256: string;
  readonly sourceManifestSha256: string;
  readonly scanResult: ScanResult;
  readonly sourceManifest: ImportSourceManifest;
}

export interface PreparedDataImport {
  readonly id: string;
  readonly projectId: string;
  readonly scanJobId: string;
  readonly taskType: 'classification' | 'detection';
  readonly mode: 'copy' | 'reference';
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly scanResultSha256: string;
  readonly sourceManifestSha256: string;
}

export interface PreparedReferenceRelink {
  readonly importId: string;
  readonly projectId: string;
  readonly imageKey: string;
  readonly previousManifestSha256: string;
  readonly nextManifestSha256: string;
  readonly updatedAt: string;
}

interface Canonical {
  readonly text: string;
  readonly byteLength: number;
  readonly sha256: string;
}
interface PreparedState {
  readonly value: DataImport;
  readonly scan: Canonical;
  readonly manifest: Canonical;
  readonly referenceSources: readonly ReferenceImportSource[];
}
const preparedImports = new WeakMap<PreparedDataImport, PreparedState>();
interface LoadedState {
  readonly database: DatabaseConnection;
  readonly generation: string;
  readonly manifest: Canonical;
}
interface ReferenceRelinkState {
  readonly database: DatabaseConnection;
  readonly generation: string;
  readonly previous: DataImport;
  readonly previousEntry: ReferenceImportSource;
  readonly previousEntrySha256: string;
  readonly previousManifest: Canonical;
  readonly nextEntry: ReferenceImportSource;
  readonly nextEntrySha256: string;
  readonly nextManifest: Canonical;
  readonly nextValue: DataImport;
  readonly replacementProof: ReferenceImportSource;
}
const loadedImports = new WeakMap<DataImport, LoadedState>();
const preparedReferenceRelinks = new WeakMap<PreparedReferenceRelink, ReferenceRelinkState>();

class CanonicalWriter {
  private readonly digest = createHash('sha256');
  private readonly chunks: string[] = [];
  private pending = '';
  private bytes = 0;

  constructor(private readonly maximumBytes: number) {}

  append(token: string): void {
    const tokenBytes = Buffer.byteLength(token, 'utf8');
    if (this.bytes + tokenBytes > this.maximumBytes) invalid();
    this.bytes += tokenBytes;
    if (this.pending.length > 0 && this.pending.length + token.length > canonicalChunkChars) this.flush();
    if (token.length > canonicalChunkChars) {
      this.flush();
      this.digest.update(token, 'utf8');
      this.chunks.push(token);
    } else this.pending += token;
  }

  finish(): Canonical {
    this.flush();
    if (this.bytes <= 0) invalid();
    return Object.freeze({ text: this.chunks.join(''), byteLength: this.bytes, sha256: this.digest.digest('hex') });
  }

  private flush(): void {
    if (this.pending.length === 0) return;
    this.digest.update(this.pending, 'utf8');
    this.chunks.push(this.pending);
    this.pending = '';
  }
}

function writeCanonical(value: unknown, output: CanonicalWriter): void {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) invalid();
    output.append(encoded);
    return;
  }
  if (Array.isArray(value)) {
    output.append('[');
    for (let index = 0; index < value.length; index += 1) {
      if (index > 0) output.append(',');
      writeCanonical(value[index], output);
    }
    output.append(']');
    return;
  }
  if (typeof value !== 'object') invalid();
  output.append('{');
  const entries = Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  for (let index = 0; index < entries.length; index += 1) {
    if (index > 0) output.append(',');
    output.append(JSON.stringify(entries[index]![0]));
    output.append(':');
    writeCanonical(entries[index]![1], output);
  }
  output.append('}');
}

function canonical(value: unknown, maximumBytes = MAX_SCAN_RESULT_BYTES): Canonical {
  const output = new CanonicalWriter(maximumBytes);
  writeCanonical(value, output);
  return output.finish();
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function parseSourceManifest(value: unknown): ImportSourceManifest {
  try { return importSourceManifestSchema.parse(value); }
  catch { return invalid(); }
}

function validateSourceManifest(scan: ScanResult, manifest: ImportSourceManifest, initialReferenceBinding: boolean): void {
  if (manifest.mode !== scan.mode || manifest.entries.length !== scan.images.length) invalid();
  const paths = new Set<string>();
  for (let index = 0; index < scan.images.length; index += 1) {
    const image = scan.images[index]!;
    const entry = manifest.entries[index]!;
    if (entry.imageKey !== image.key || entry.byteSize !== image.byteSize || entry.sha256 !== image.sha256) invalid();
    if (manifest.mode === 'copy') {
      const copy = entry as CopyImportSource;
      const key = copy.relativePath.toUpperCase();
      if (paths.has(key)) invalid();
      paths.add(key);
    } else {
      const reference = entry as ReferenceImportSource;
      if (initialReferenceBinding
        && (reference.sourcePath !== image.sourcePath || reference.mtimeNs !== image.mtimeNs)) invalid();
    }
  }
}

function exactInput(value: NewDataImport): {
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly scanResult: ScanResult;
  readonly sourceManifest: ImportSourceManifest;
} {
  const schema = jsonObject.pipe(z.strictObject({
    id: z.uuid().transform((id) => id.toLowerCase()),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    scanResult: scanResultSchema,
    sourceManifest: importSourceManifestSchema,
  }));
  try {
    const parsed = schema.parse(value);
    if (parsed.createdAt !== parsed.updatedAt) invalid();
    validateSourceManifest(parsed.scanResult, parsed.sourceManifest, true);
    return parsed;
  } catch { return invalid(); }
}

function decodeJson(text: string, maximumBytes: number): unknown {
  try {
    if (!scalar(text) || Buffer.byteLength(text, 'utf8') > maximumBytes) corrupt();
    const objects: Set<string>[] = [];
    let previous = '';
    for (const match of text.matchAll(/"(?:[^"\\]|\\[\s\S])*"|[{}\[\]:]/gu)) {
      const token = match[0];
      if (token === '{') objects.push(new Set());
      else if (token === '}') objects.pop();
      else if (token === ':') {
        const key: unknown = JSON.parse(previous);
        const keys = objects.at(-1);
        if (typeof key !== 'string' || keys === undefined || keys.has(key)) corrupt();
        keys.add(key);
      }
      previous = token;
    }
    return JSON.parse(text) as unknown;
  } catch { return corrupt(); }
}

function hashText(text: string, expected: string, maximumBytes: number): void {
  if (!/^[a-f0-9]{64}(?![\s\S])/u.test(expected) || Buffer.byteLength(text, 'utf8') > maximumBytes
    || createHash('sha256').update(text, 'utf8').digest('hex') !== expected) corrupt();
}

function snapshotValue(fields: Omit<DataImport, 'scanResult' | 'sourceManifest'>,
  scanResult: ScanResult, sourceManifest: ImportSourceManifest): DataImport {
  return deepFreeze({ ...fields, scanResult, sourceManifest });
}

/**
 * DAT-07 preparation phase. It performs all potentially large parsing,
 * cross-reference validation, canonical UTF-8 encoding and SHA-256 work before
 * a SQLite write transaction. It does no DB or filesystem I/O. Array order and
 * exact Unicode/path spelling are preserved; object keys alone are sorted.
 */
export function prepareDataImport(input: NewDataImport): PreparedDataImport {
  const parsed = exactInput(input);
  // exactInput has already rejected getters/non-JSON fields. Retain the exact
  // issued objects, not the schema's detached canonical clones.
  const referenceSources = Object.freeze(parsed.sourceManifest.mode === 'reference'
    ? [...input.sourceManifest.entries] as ReferenceImportSource[] : []);
  for (const source of referenceSources) assertCapturedReferenceSource(source);
  const scan = canonical(parsed.scanResult);
  const manifest = canonical(parsed.sourceManifest);
  const value = snapshotValue({
    id: parsed.id,
    projectId: parsed.scanResult.projectId,
    scanJobId: parsed.scanResult.jobId,
    taskType: parsed.scanResult.taskType,
    mode: parsed.scanResult.mode,
    createdAt: parsed.createdAt,
    updatedAt: parsed.updatedAt,
    scanResultSha256: scan.sha256,
    sourceManifestSha256: manifest.sha256,
  }, parsed.scanResult, parsed.sourceManifest);
  const capability = Object.freeze({
    id: value.id,
    projectId: value.projectId,
    scanJobId: value.scanJobId,
    taskType: value.taskType,
    mode: value.mode,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    scanResultSha256: value.scanResultSha256,
    sourceManifestSha256: value.sourceManifestSha256,
  });
  preparedImports.set(capability, { value, scan, manifest, referenceSources });
  return capability;
}

/** Pure planning read; only the issued capability carries authority. No I/O or write capability cloning. */
export function readPreparedDataImport(prepared: PreparedDataImport): DataImport {
  const state = preparedImports.get(prepared);
  if (!state) throw new TypeError('A real prepared import capability is required.');
  return state.value;
}

function rowForSource(importId: string, mode: DataImport['mode'], entry: CopyImportSource | ReferenceImportSource,
  ordinal: number): readonly unknown[] {
  const encoded = canonical(entry);
  if (mode === 'copy') {
    const copy = entry as CopyImportSource;
    return [importId, copy.imageKey, ordinal, mode, copy.relativePath, copy.relativePath.toUpperCase(),
      null, null, null, null, copy.byteSize, null, copy.sha256, encoded.sha256];
  }
  const reference = entry as ReferenceImportSource;
  return [importId, reference.imageKey, ordinal, mode, null, null, reference.sourcePath,
    reference.identity.dev, reference.identity.ino, reference.identity.birthtimeNs,
    reference.byteSize, reference.mtimeNs, reference.sha256, encoded.sha256];
}

/**
 * Writes a previously issued preparation capability into the caller's short
 * transaction. The caller owns BEGIN/COMMIT/ROLLBACK and must not report the
 * returned snapshot as committed until COMMIT succeeds. No upsert or retry.
 */
export function insertDataImport(database: DatabaseConnection, prepared: PreparedDataImport): DataImport {
  const state = preparedImports.get(prepared);
  if (!state) throw new TypeError('A real prepared import capability is required.');
  if (!database.inTransaction) throw new Error('Import persistence requires the caller transaction.');
  const value = state.value;
  const job = database.prepare(`SELECT j.project_id AS projectId,j.kind,j.status,p.task_type AS taskType
    FROM jobs AS j JOIN projects AS p ON p.id=j.project_id WHERE j.id=?`).get(value.scanJobId) as
    | { projectId?: unknown; kind?: unknown; status?: unknown; taskType?: unknown }
    | undefined;
  if (job?.projectId !== value.projectId || job.kind !== 'scan-dataset' || job.status !== 'Succeeded'
    || job.taskType !== value.taskType) {
    throw new Error('Import persistence requires the matching succeeded scan job and Project task type.');
  }
  assertCapturedReferenceSourcesCurrent(state.referenceSources);
  const inserted = database.prepare(`INSERT INTO data_imports(
    id,project_id,scan_job_id,task_type,mode,created_at,updated_at,
    scan_result_json,scan_result_sha256,source_manifest_json,source_manifest_sha256
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    value.id, value.projectId, value.scanJobId, value.taskType, value.mode,
    value.createdAt, value.updatedAt, state.scan.text, state.scan.sha256,
    state.manifest.text, state.manifest.sha256,
  );
  if (inserted.changes !== 1) throw new Error('Import persistence insert did not create exactly one row.');
  const insertSource = database.prepare(`INSERT INTO import_sources(
    import_id,image_key,ordinal,mode,relative_path,relative_path_key,source_path,
    identity_dev,identity_ino,identity_birthtime_ns,byte_size,mtime_ns,sha256,entry_sha256
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const [ordinal, entry] of value.sourceManifest.entries.entries()) {
    if (insertSource.run(...rowForSource(value.id, value.mode, entry, ordinal)).changes !== 1) {
      throw new Error('Import source insert did not create exactly one row.');
    }
  }
  assertCapturedReferenceSourcesCurrent(state.referenceSources);
  return value;
}

/**
 * Builds a one-shot Reference relink capability from an exact repository read.
 * Large manifest encoding and hashing happen before the caller acquires a DB
 * write lock. The immutable content size/hash must still match; relink changes
 * only the explicit path, file identity and mtime binding.
 */
export function prepareReferenceRelink(current: DataImport, targetImageKey: string,
  replacementInput: ReferenceImportSource, updatedAtInput: string): PreparedReferenceRelink {
  const loaded = loadedImports.get(current);
  if (!loaded) throw new TypeError('A real repository-loaded import snapshot is required.');
  if (current.mode !== 'reference' || current.sourceManifest.mode !== 'reference') {
    throw new Error('Only a Reference import can be relinked.');
  }
  assertCapturedReferenceSource(replacementInput);
  let replacement: ReferenceImportSource, target: string, updatedAt: string;
  try {
    replacement = (importSourceManifestSchema.parse({
      formatVersion: 1, mode: 'reference', entries: [replacementInput],
    }) as Extract<ImportSourceManifest, { mode: 'reference' }>).entries[0]!;
    target = imageKey.parse(targetImageKey);
    updatedAt = z.iso.datetime().parse(updatedAtInput);
  } catch { return invalid(); }
  if (replacement.imageKey !== target || Date.parse(updatedAt) <= Date.parse(current.updatedAt)) invalid();
  const index = current.sourceManifest.entries.findIndex((entry) => entry.imageKey === target);
  if (index < 0) invalid();
  const previousEntry = current.sourceManifest.entries[index]!;
  if (replacement.byteSize !== previousEntry.byteSize || replacement.sha256 !== previousEntry.sha256) {
    throw new Error('Relink candidate content does not match the stored Reference source.');
  }
  const nextSourceManifest = importSourceManifestSchema.parse({
    formatVersion: 1,
    mode: 'reference',
    entries: current.sourceManifest.entries.map((entry, ordinal) => ordinal === index ? replacement : entry),
  }) as Extract<ImportSourceManifest, { mode: 'reference' }>;
  const nextManifest = canonical(nextSourceManifest);
  const previousEntrySha256 = canonical(previousEntry).sha256;
  const nextEntrySha256 = canonical(replacement).sha256;
  const nextValue = snapshotValue({
    id: current.id,
    projectId: current.projectId,
    scanJobId: current.scanJobId,
    taskType: current.taskType,
    mode: current.mode,
    createdAt: current.createdAt,
    updatedAt,
    scanResultSha256: current.scanResultSha256,
    sourceManifestSha256: nextManifest.sha256,
  }, current.scanResult, nextSourceManifest);
  const capability = Object.freeze({
    importId: current.id,
    projectId: current.projectId,
    imageKey: target,
    previousManifestSha256: loaded.manifest.sha256,
    nextManifestSha256: nextManifest.sha256,
    updatedAt,
  });
  preparedReferenceRelinks.set(capability, {
    database: loaded.database,
    generation: loaded.generation,
    previous: current,
    previousEntry,
    previousEntrySha256,
    previousManifest: loaded.manifest,
    nextEntry: replacement,
    nextEntrySha256,
    nextManifest,
    nextValue,
    replacementProof: replacementInput,
  });
  return capability;
}

/**
 * Applies both the indexed entry and full Reference manifest inside the
 * caller-owned transaction. Both old projections are compared exactly; any
 * concurrent relink makes one statement affect zero rows and the caller must
 * roll back the whole transaction. The capability is consumed on first use.
 */
export function applyReferenceRelink(database: DatabaseConnection,
  prepared: PreparedReferenceRelink): DataImport {
  const state = preparedReferenceRelinks.get(prepared);
  if (!state) throw new TypeError('A real unused Reference relink capability is required.');
  preparedReferenceRelinks.delete(prepared);
  if (database !== state.database) throw new Error('Reference relink requires its originating database connection.');
  if (!database.inTransaction) throw new Error('Reference relink requires the caller transaction.');
  const generation = BigInt(state.generation);
  if (generation + 2n > maximumGeneration) throw new Error('Import generation exhausted before Reference relink.');
  assertCapturedReferenceSourceCurrent(state.replacementProof);
  const previous = state.previous;
  const next = state.nextEntry;
  const header = database.prepare(`UPDATE data_imports
    SET updated_at=?,source_manifest_json=?,source_manifest_sha256=?
    WHERE id=? AND project_id=? AND mode='reference' AND updated_at=?
      AND source_manifest_json=? AND source_manifest_sha256=?
      AND (SELECT CAST(g.generation AS TEXT) FROM import_generations AS g
        WHERE g.import_id=data_imports.id)=?`).run(
    state.nextValue.updatedAt, state.nextManifest.text, state.nextManifest.sha256,
    previous.id, previous.projectId, previous.updatedAt,
    state.previousManifest.text, state.previousManifest.sha256, state.generation,
  );
  if (header.changes !== 1) throw new Error('Reference import changed before relink.');
  const old = state.previousEntry;
  const source = database.prepare(`UPDATE import_sources
    SET source_path=?,identity_dev=?,identity_ino=?,identity_birthtime_ns=?,mtime_ns=?,entry_sha256=?
    WHERE import_id=? AND image_key=? AND mode='reference'
      AND source_path=? AND identity_dev=? AND identity_ino=? AND identity_birthtime_ns=?
      AND byte_size=? AND mtime_ns=? AND sha256=? AND entry_sha256=?
      AND (SELECT CAST(g.generation AS TEXT) FROM import_generations AS g
        WHERE g.import_id=import_sources.import_id)=?`).run(
    next.sourcePath, next.identity.dev, next.identity.ino, next.identity.birthtimeNs,
    next.mtimeNs, state.nextEntrySha256,
    previous.id, old.imageKey, old.sourcePath, old.identity.dev, old.identity.ino,
    old.identity.birthtimeNs, old.byteSize, old.mtimeNs, old.sha256, state.previousEntrySha256,
    String(generation + 1n),
  );
  if (source.changes !== 1) throw new Error('Reference source changed before relink.');
  if (currentGeneration(database, previous.id) !== String(generation + 2n)) {
    throw new Error('Reference import changed during relink.');
  }
  assertCapturedReferenceSourceCurrent(state.replacementProof);
  return state.nextValue;
}

const storedRowSchema = z.strictObject({
  id: z.string(), projectId: z.string(), scanJobId: z.string(), taskType: z.string(), mode: z.string(),
  createdAt: z.string(), updatedAt: z.string(), scanResultJson: z.string(), scanResultSha256: z.string(),
  sourceManifestJson: z.string(), sourceManifestSha256: z.string(), generation: z.string(),
});
const sourceRowSchema = z.strictObject({
  importId: z.string(), imageKey: z.string(), ordinal: z.number().int().min(0), mode: z.string(),
  relativePath: z.string().nullable(), relativePathKey: z.string().nullable(), sourcePath: z.string().nullable(),
  identityDev: z.string().nullable(), identityIno: z.string().nullable(), identityBirthtimeNs: z.string().nullable(),
  byteSize: z.number().int(), mtimeNs: z.string().nullable(), sha256: z.string(), entrySha256: z.string(),
});

/** DAT-14A: Main-only issued read capability. Never expose source paths through IPC. */
export interface ImportImageSource {
  readonly projectId: string;
  readonly workspaceId: string;
  readonly itemId: string;
  readonly importId: string;
  readonly imageKey: string;
  readonly mode: 'copy' | 'reference';
  readonly byteSize: number;
  readonly sha256: string;
  readonly relativePath: string | null;
  readonly sourcePath: string | null;
  readonly identity: Readonly<ReferenceImportSource['identity']> | null;
  readonly mtimeNs: string | null;
  readonly generation: string;
  readonly projectRoot: string;
}

const imageSourceEntryMaxBytes = 1024 * 1024;
const imageSourceRowSchema = sourceRowSchema.extend({
  itemId: z.uuid(), workspaceId: z.uuid(), imageSha256: sha256,
  workspaceParent: z.uuid(), workspaceProject: projectIdSchema,
  workspaceTask: taskTypeSchema, workspaceMode: z.enum(['copy', 'reference']),
  projectId: projectIdSchema, projectRoot: z.string().min(1).max(32_767).refine((value) =>
    scalar(value) && /^[a-z]:[\\/]/iu.test(value) && win32.isAbsolute(value)
    && !value.split(/[\\/]/u).some((part) => part === '.' || part === '..')),
  projectName: z.string(), projectDescription: z.string(), projectLocked: z.number().int(),
  projectCreatedAt: z.string(), projectUpdatedAt: z.string(), projectTask: taskTypeSchema,
  headerId: z.uuid(), headerProject: projectIdSchema, headerTask: taskTypeSchema,
  headerMode: z.enum(['copy', 'reference']), headerUpdatedAt: z.string(),
  sourceManifestSha256: sha256, generation: z.string(),
});
type ImageSourceRow = z.infer<typeof imageSourceRowSchema>;
const issuedImageSources = new WeakMap<ImportImageSource, {
  readonly database: DatabaseConnection;
  readonly row: ImageSourceRow;
}>();

// All joins are LEFT joins: a requested item with a broken parent must not
// disappear as if it never existed. The WHERE clause scopes only the item.
const imageSourceColumns = `a.id AS itemId,a.workspace_id AS workspaceId,a.image_sha256 AS imageSha256,
  a.import_id AS importId,a.image_key AS imageKey,s.ordinal,s.mode,
  s.relative_path AS relativePath,s.relative_path_key AS relativePathKey,s.source_path AS sourcePath,
  s.identity_dev AS identityDev,s.identity_ino AS identityIno,s.identity_birthtime_ns AS identityBirthtimeNs,
  s.byte_size AS byteSize,s.mtime_ns AS mtimeNs,s.sha256,s.entry_sha256 AS entrySha256,
  w.id AS workspaceParent,w.project_id AS workspaceProject,w.task_type AS workspaceTask,w.mode AS workspaceMode,
  p.id AS projectId,p.workspace_path AS projectRoot,p.name AS projectName,p.description AS projectDescription,
  p.task_type_locked AS projectLocked,p.created_at AS projectCreatedAt,p.updated_at AS projectUpdatedAt,
  p.task_type AS projectTask,d.id AS headerId,d.project_id AS headerProject,d.task_type AS headerTask,
  d.mode AS headerMode,d.updated_at AS headerUpdatedAt,d.source_manifest_sha256 AS sourceManifestSha256,
  CAST(g.generation AS TEXT) AS generation`;
const imageSourceJoins = `FROM annotation_items a
  LEFT JOIN annotation_workspaces w ON w.id=a.workspace_id
  LEFT JOIN projects p ON p.id=w.project_id
  LEFT JOIN import_sources s ON s.import_id=a.import_id AND s.image_key=a.image_key
  LEFT JOIN data_imports d ON d.id=s.import_id
  LEFT JOIN import_generations g ON g.import_id=d.id
  WHERE a.id=? AND a.workspace_id=?`;

function validateImageSourceRow(raw: unknown, projectId: string): ImageSourceRow {
  try {
    const row = imageSourceRowSchema.parse(raw);
    exactGeneration(row.generation);
    if (row.projectId !== projectId || row.workspaceProject !== projectId || row.headerProject !== projectId
      || row.workspaceId !== row.workspaceParent || row.importId !== row.headerId
      || row.projectTask !== row.workspaceTask || row.headerTask !== row.workspaceTask
      || row.mode !== row.workspaceMode || row.headerMode !== row.mode || row.imageSha256 !== row.sha256
      || !Number.isSafeInteger(row.ordinal)) corrupt();
    return row;
  } catch { return corrupt(); }
}

/**
 * Caller MUST hold a short consistent read transaction and release it before
 * asynchronous image I/O. No filesystem I/O, transaction ownership or retries.
 * Only one bounded entry crosses into JS; SQLite's json_extract still parses
 * the saved TEXT manifest internally (linear in manifest size, NOT O(1)).
 * Full canonical manifest/scan hash validation belongs to initial persistence,
 * reload (findDataImport), or a separate full-validation pass. This leaf binds
 * the indexed projection to the current saved entry, not to a cryptographic
 * Merkle proof: malicious replacement of the entire local DB is not authenticated.
 * DAT-14 must check actual image magic/MIME, bytes/hash and file identity itself.
 */
export function findImportImageSource(database: DatabaseConnection, projectId: string,
  workspaceId: string, itemId: string): ImportImageSource | undefined {
  if (!database.open || !database.inTransaction) throw new Error('Import image lookup requires the caller read transaction.');
  const parent = projectIdSchema.parse(projectId);
  const workspace = z.uuid().parse(workspaceId).toLowerCase(), item = z.uuid().parse(itemId).toLowerCase();
  // CASE is intentionally nested: bound the BLOB length before any JSON parse,
  // and validate integer ordinal before constructing the parameter-free path.
  const raw = database.prepare(`SELECT ${imageSourceColumns},
    CASE WHEN length(CAST(d.source_manifest_json AS BLOB)) BETWEEN 1 AND ${MAX_SCAN_RESULT_BYTES}
      AND typeof(s.ordinal)='integer' AND s.ordinal BETWEEN 0 AND 9007199254740991
    THEN CASE WHEN json_valid(d.source_manifest_json) THEN CASE
      WHEN json_extract(d.source_manifest_json,'$.formatVersion')=1
        AND json_extract(d.source_manifest_json,'$.mode')=d.mode
        AND json_type(d.source_manifest_json,'$.entries')='array'
      THEN substr(json_extract(d.source_manifest_json,'$.entries[' || s.ordinal || ']'),1,${imageSourceEntryMaxBytes + 1}) END END END
      AS sourceManifestEntryJson,
    CASE WHEN length(CAST(a.annotation_json AS BLOB)) BETWEEN 1 AND 1048576
      THEN CASE WHEN json_valid(a.annotation_json) THEN json_extract(a.annotation_json,'$.kind') END END AS annotationKind
    ${imageSourceJoins}`).get(item, workspace);
  if (raw === undefined) return undefined;
  // Foreign items stay indistinguishable from missing items. A missing workspace
  // has no valid foreign owner and must instead fail the strict parent checks.
  const candidate = raw as Record<string, unknown>;
  if (candidate.workspaceProject !== null && candidate.workspaceProject !== undefined) {
    const owner = projectIdSchema.safeParse(candidate.workspaceProject);
    if (!owner.success || owner.data !== candidate.workspaceProject) corrupt();
    if (owner.data !== parent) return undefined;
  }
  const { sourceManifestEntryJson, annotationKind, ...fields } = candidate;
  const row = validateImageSourceRow(fields, parent);
  if (annotationKind !== row.workspaceTask) corrupt();
  try {
    const reconstructed = row.mode === 'copy'
      ? { imageKey: row.imageKey, relativePath: row.relativePath, byteSize: row.byteSize, sha256: row.sha256 }
      : { imageKey: row.imageKey, sourcePath: row.sourcePath, byteSize: row.byteSize, sha256: row.sha256,
        identity: { dev: row.identityDev, ino: row.identityIno, birthtimeNs: row.identityBirthtimeNs }, mtimeNs: row.mtimeNs };
    const entry = importSourceManifestSchema.parse({ formatVersion: 1, mode: row.mode, entries: [reconstructed] }).entries[0]!;
    if (row.mode === 'copy') {
      if (row.relativePathKey !== (entry as CopyImportSource).relativePath.toUpperCase()
        || row.sourcePath !== null || row.identityDev !== null || row.identityIno !== null
        || row.identityBirthtimeNs !== null || row.mtimeNs !== null) corrupt();
    } else if (row.relativePath !== null || row.relativePathKey !== null) corrupt();
    const encoded = canonical(entry, imageSourceEntryMaxBytes);
    if (row.entrySha256 !== encoded.sha256 || typeof sourceManifestEntryJson !== 'string') corrupt();
    const saved = decodeJson(sourceManifestEntryJson, imageSourceEntryMaxBytes);
    const savedEntry = importSourceManifestSchema.parse({ formatVersion: 1, mode: row.mode, entries: [saved] }).entries[0]!;
    if (canonical(savedEntry, imageSourceEntryMaxBytes).text !== encoded.text
      || sourceManifestEntryJson !== encoded.text) corrupt();
    const value: ImportImageSource = deepFreeze({ projectId: parent, workspaceId: workspace, itemId: item,
      importId: row.importId, imageKey: row.imageKey, mode: row.headerMode, byteSize: row.byteSize, sha256: row.sha256,
      relativePath: row.relativePath, sourcePath: row.sourcePath,
      identity: row.mode === 'reference' ? (entry as ReferenceImportSource).identity : null,
      mtimeNs: row.mtimeNs, generation: row.generation, projectRoot: row.projectRoot });
    issuedImageSources.set(value, { database, row: Object.freeze(row) });
    assertImportImageSourceCurrent(database, value);
    return value;
  } catch { return corrupt(); }
}

/**
 * Check before/after I/O on the issuing connection. A fresh statement outside
 * a TX, or a NEW caller read TX, observes current committed state; keeping the
 * original read TX across I/O would only recheck its old SQLite snapshot.
 * Indexed fixed-row comparison, no scan/manifest JSON reads. Database triggers
 * advance the durable ledger on every header/source change, including ABA.
 */
export function assertImportImageSourceCurrent(database: DatabaseConnection, value: ImportImageSource): void {
  const state = issuedImageSources.get(value);
  if (!state || state.database !== database) throw new TypeError('A real repository-issued image source is required.');
  if (!database.open) corrupt();
  const raw = database.prepare(`SELECT ${imageSourceColumns} ${imageSourceJoins}`).get(value.itemId, value.workspaceId);
  const current = validateImageSourceRow(raw, value.projectId);
  if (Object.keys(state.row).some((key) => current[key as keyof ImageSourceRow] !== state.row[key as keyof ImageSourceRow])) corrupt();
}

function decodeStored(database: DatabaseConnection, raw: unknown): DataImport {
  let row: z.infer<typeof storedRowSchema>;
  try { row = storedRowSchema.parse(raw); } catch { return corrupt(); }
  const generation = exactGeneration(row.generation);
  let context: ScanContext;
  try {
    context = {
      jobId: jobIdSchema.parse(row.scanJobId),
      projectId: projectIdSchema.parse(row.projectId),
      taskType: taskTypeSchema.parse(row.taskType),
      mode: row.mode === 'copy' || row.mode === 'reference' ? row.mode : corrupt(),
    };
  } catch { return corrupt(); }
  let id: string, createdAt: string, updatedAt: string;
  try {
    id = z.uuid().transform((value) => value.toLowerCase()).parse(row.id);
    createdAt = z.iso.datetime().parse(row.createdAt);
    updatedAt = z.iso.datetime().parse(row.updatedAt);
  } catch { return corrupt(); }
  if (id !== row.id || context.jobId !== row.scanJobId || context.projectId !== row.projectId) corrupt();
  hashText(row.scanResultJson, row.scanResultSha256, MAX_SCAN_RESULT_BYTES);
  let scanResult: ScanResult;
  try { scanResult = decodeScanResult(row.scanResultJson, context); } catch { return corrupt(); }
  const encodedScan = canonical(scanResult);
  if (encodedScan.text !== row.scanResultJson || encodedScan.sha256 !== row.scanResultSha256) corrupt();

  hashText(row.sourceManifestJson, row.sourceManifestSha256, MAX_SCAN_RESULT_BYTES);
  let sourceManifest: ImportSourceManifest;
  try { sourceManifest = parseSourceManifest(decodeJson(row.sourceManifestJson, MAX_SCAN_RESULT_BYTES)); }
  catch { return corrupt(); }
  try { validateSourceManifest(scanResult, sourceManifest, false); } catch { return corrupt(); }
  const encodedManifest = canonical(sourceManifest);
  if (encodedManifest.text !== row.sourceManifestJson || encodedManifest.sha256 !== row.sourceManifestSha256
    || sourceManifest.mode !== context.mode) corrupt();

  let sourceRows: z.infer<typeof sourceRowSchema>[];
  try {
    sourceRows = database.prepare(`SELECT import_id AS importId,image_key AS imageKey,ordinal,mode,
      relative_path AS relativePath,relative_path_key AS relativePathKey,source_path AS sourcePath,
      identity_dev AS identityDev,identity_ino AS identityIno,identity_birthtime_ns AS identityBirthtimeNs,
      byte_size AS byteSize,mtime_ns AS mtimeNs,sha256,entry_sha256 AS entrySha256
      FROM import_sources WHERE import_id=? ORDER BY ordinal`).all(id).map((item) => sourceRowSchema.parse(item));
  } catch { return corrupt(); }
  if (sourceRows.length !== sourceManifest.entries.length) corrupt();
  for (let ordinal = 0; ordinal < sourceRows.length; ordinal += 1) {
    const sourceRow = sourceRows[ordinal]!;
    const entry = sourceManifest.entries[ordinal]!;
    if (sourceRow.importId !== id || sourceRow.ordinal !== ordinal || sourceRow.mode !== context.mode
      || sourceRow.imageKey !== entry.imageKey || sourceRow.byteSize !== entry.byteSize
      || sourceRow.sha256 !== entry.sha256 || sourceRow.entrySha256 !== canonical(entry).sha256) corrupt();
    if (context.mode === 'copy') {
      const copy = entry as CopyImportSource;
      if (sourceRow.relativePath !== copy.relativePath || sourceRow.relativePathKey !== copy.relativePath.toUpperCase()
        || sourceRow.sourcePath !== null || sourceRow.identityDev !== null || sourceRow.identityIno !== null
        || sourceRow.identityBirthtimeNs !== null || sourceRow.mtimeNs !== null) corrupt();
    } else {
      const reference = entry as ReferenceImportSource;
      if (sourceRow.relativePath !== null || sourceRow.relativePathKey !== null
        || sourceRow.sourcePath !== reference.sourcePath || sourceRow.identityDev !== reference.identity.dev
        || sourceRow.identityIno !== reference.identity.ino
        || sourceRow.identityBirthtimeNs !== reference.identity.birthtimeNs
        || sourceRow.mtimeNs !== reference.mtimeNs) corrupt();
    }
  }
  const value = snapshotValue({
    id, projectId: context.projectId, scanJobId: context.jobId, taskType: context.taskType, mode: context.mode,
    createdAt, updatedAt, scanResultSha256: row.scanResultSha256,
    sourceManifestSha256: row.sourceManifestSha256,
  }, scanResult, sourceManifest);
  // Recheck only the indexed ledger after decoding both projections. Reads do
  // not acquire, commit, roll back or retry a transaction on the caller's behalf.
  if (currentGeneration(database, id) !== generation) corrupt();
  loadedImports.set(value, { database, generation, manifest: encodedManifest });
  return value;
}

/** Main-only proof check for a caller-owned consistent read transaction. */
export function assertDataImportSnapshotCurrent(database: DatabaseConnection, value: DataImport): void {
  const state = loadedImports.get(value);
  if (!state || state.database !== database) throw new TypeError('A real repository-loaded import snapshot is required.');
  if (currentGeneration(database, value.id) !== state.generation) corrupt();
}

/** Missing and foreign IDs are indistinguishable; any malformed stored byte or projection row fails closed. */
export function findDataImport(database: DatabaseConnection, projectId: string, id: string): DataImport | undefined {
  const parent = projectIdSchema.parse(projectId);
  const importId = z.uuid().transform((value) => value.toLowerCase()).parse(id);
  const row = database.prepare(`SELECT id,project_id AS projectId,scan_job_id AS scanJobId,
    task_type AS taskType,mode,created_at AS createdAt,updated_at AS updatedAt,
    scan_result_json AS scanResultJson,scan_result_sha256 AS scanResultSha256,
    source_manifest_json AS sourceManifestJson,source_manifest_sha256 AS sourceManifestSha256,
    (SELECT CAST(g.generation AS TEXT) FROM import_generations AS g
      WHERE g.import_id=data_imports.id) AS generation
    FROM data_imports WHERE project_id=? AND id=?`).get(parent, importId);
  return row === undefined ? undefined : decodeStored(database, row);
}

/** Unique scan-job lookup, followed by the ordinary strict, generation-checked read. */
export function findDataImportByScanJob(database: DatabaseConnection, projectId: string,
  scanJobId: string): DataImport | undefined {
  const parent = projectIdSchema.parse(projectId), job = jobIdSchema.parse(scanJobId);
  const row = database.prepare('SELECT id FROM data_imports WHERE project_id=? AND scan_job_id=?')
    .get(parent, job) as { id: string } | undefined;
  if (row === undefined) return undefined;
  const value = findDataImport(database, parent, row.id);
  if (!value || value.scanJobId !== job) return corrupt();
  return value;
}

/** Metadata-only chronological Project list; large JSON payloads are deliberately not decoded here. */
export function listDataImportHeaders(database: DatabaseConnection, projectId: string): PreparedDataImport[] {
  const parent = projectIdSchema.parse(projectId);
  const rows = database.prepare(`SELECT id,project_id AS projectId,scan_job_id AS scanJobId,
    task_type AS taskType,mode,created_at AS createdAt,updated_at AS updatedAt,
    scan_result_sha256 AS scanResultSha256,source_manifest_sha256 AS sourceManifestSha256
    FROM data_imports WHERE project_id=? ORDER BY created_at,id`).all(parent);
  return rows.map((row) => {
    try {
      const value = z.strictObject({
        id: z.uuid(), projectId: projectIdSchema, scanJobId: jobIdSchema,
        taskType: taskTypeSchema, mode: z.enum(['copy', 'reference']),
        createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
        scanResultSha256: sha256, sourceManifestSha256: sha256,
      }).parse(row);
      if (value.id !== value.id.toLowerCase()) corrupt();
      return Object.freeze(value);
    } catch { return corrupt(); }
  });
}
