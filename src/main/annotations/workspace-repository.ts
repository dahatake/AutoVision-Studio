import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';

import {
  MAX_ANNOTATION_JSON_BYTES, MAX_LABEL_SCHEMA_JSON_BYTES, annotationItemSchema,
  annotationProvenanceKindSchema, annotationProvenanceSchema,
  annotationSchema, annotationWorkspaceSchema, labelSchemaSnapshotSchema,
  type Annotation, type AnnotationItem, type AnnotationProvenance,
  type AnnotationWorkspace, type LabelSchemaSnapshot,
} from '../../shared/contracts/annotation.js';
import type { ScanImage } from '../../shared/contracts/import.js';
import { assertDataImportSnapshotCurrent, findDataImport, type DataImport } from '../data/import-repository.js';
import type { DatabaseConnection } from '../db/database.js';

const corrupt = (): never => { throw new Error('Stored annotation workspace data is invalid or changed.'); };

// Lexicographic UTF-16 keys, not localeCompare or insertion order. Emit keys
// directly: rebuilding an object would reorder integer-like provenance keys.
function stableJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value))) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (typeof value !== 'object' || value === null) return corrupt();
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
}

/** Main-only shared encoding hook for future draft writers; never locale sort. */
export function canonicalAnnotationJson(value: Annotation): string {
  return stableJson(annotationSchema.parse(value));
}

export function annotationDigest(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function freezeWorkspaceValue<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeWorkspaceValue(child);
    Object.freeze(value);
  }
  return value;
}

function decodeJson(text: unknown): unknown {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_ANNOTATION_JSON_BYTES) return corrupt();
  try {
    const value: unknown = JSON.parse(text);
    // Also rejects duplicate/escaped duplicate keys, whitespace and noncanonical
    // numbers: JSON.parse cannot retain them, so re-encoding cannot match.
    if (stableJson(value) !== text) return corrupt();
    return value;
  } catch { return corrupt(); }
}

/** Never joins caller transactions. A lost marker leaves the outcome uncertain. */
export function workspaceTransaction<T>(database: DatabaseConnection, write: boolean, action: () => T): T {
  if (database.inTransaction) throw new Error('Annotation workspace requires no caller transaction.');
  const marker = `workspace_${randomUUID().replaceAll('-', '')}`;
  database.exec(write ? 'BEGIN IMMEDIATE' : 'BEGIN');
  try {
    database.exec(`SAVEPOINT ${marker}`);
    const result = action();
    database.exec('COMMIT');
    return result;
  } catch (error) {
    if (!database.inTransaction) throw new AggregateError([error], 'Annotation workspace transaction outcome is uncertain.');
    // One exec: a missing private marker stops SQLite BEFORE global ROLLBACK.
    // COMMIT wrappers can commit our work, BEGIN foreign work, then throw.
    try { database.exec(`ROLLBACK TO ${marker}; ROLLBACK`); }
    catch (rollbackError) {
      throw new AggregateError([error, rollbackError], 'Annotation workspace transaction outcome is uncertain; rollback ownership could not be verified.');
    }
    throw error;
  }
}

/** O(1) metadata CAS, including permanent ABA tombstone; no second payload read. */
export function importWorkspaceStamp(database: DatabaseConnection, projectId: string, importId: string): string {
  const row = database.prepare(`SELECT d.id,d.project_id,d.scan_job_id,d.task_type,d.mode,
    d.created_at,d.updated_at,d.scan_result_sha256,d.source_manifest_sha256,
    CAST(g.generation AS TEXT) AS generation FROM data_imports d
    LEFT JOIN import_generations g ON g.import_id=d.id WHERE d.id=? AND d.project_id=?`).get(importId, projectId);
  const parsed = z.strictObject({ id: z.string(), project_id: z.string(), scan_job_id: z.string(),
    task_type: z.string(), mode: z.string(), created_at: z.string(), updated_at: z.string(),
    scan_result_sha256: z.string(), source_manifest_sha256: z.string(),
    generation: z.string().regex(/^[1-9][0-9]{0,18}(?![\s\S])/u),
  }).safeParse(row);
  if (!parsed.success) return corrupt();
  const value = parsed.data;
  if (BigInt(value.generation) > 9223372036854775807n) return corrupt();
  return stableJson(value);
}

export function readWorkspaceSchema(database: DatabaseConnection, projectId: string, schemaId: string): LabelSchemaSnapshot {
  return readWorkspaceSchemaState(database, projectId, schemaId).snapshot;
}

/** DAT-08 only: a fresh import produces one header generation plus one per source. */
export function plannedImportWorkspaceStamp(source: DataImport): string {
  return stableJson({ id: source.id, project_id: source.projectId, scan_job_id: source.scanJobId,
    task_type: source.taskType, mode: source.mode, created_at: source.createdAt, updated_at: source.updatedAt,
    scan_result_sha256: source.scanResultSha256, source_manifest_sha256: source.sourceManifestSha256,
    generation: String(1n + BigInt(source.sourceManifest.entries.length)) });
}

/** Preserve all Project metadata, including the publication root and task lock. */
export function readWorkspaceProjectState(database: DatabaseConnection, projectId: string): { taskType: string; stamp: string } {
  const row = z.strictObject({ id: z.string(), name: z.string(), description: z.string(),
    task_type: z.enum(['classification', 'detection']), task_type_locked: z.number().int().min(0).max(1),
    workspace_path: z.string().min(1), created_at: z.string(), updated_at: z.string() }).parse(database.prepare(
    'SELECT id,name,description,task_type,task_type_locked,workspace_path,created_at,updated_at FROM projects WHERE id=?').get(projectId));
  if (row.id !== projectId) return corrupt();
  return { taskType: row.task_type, stamp: stableJson(row) };
}

/** Match the full post-insert SQL view; existing examples retain their original raw spelling. */
export function plannedWorkspaceSchemaStamp(database: DatabaseConnection, snapshot: LabelSchemaSnapshot,
  taskType: string): string {
  const raw = new Map(database.prepare('SELECT id,examples_json AS examplesJson FROM label_classes WHERE schema_id=?')
    .all(snapshot.id).map((row) => {
      const value = z.strictObject({ id: z.string(), examplesJson: z.string() }).parse(row);
      return [value.id, value.examplesJson] as const;
    }));
  const { classes, ...header } = snapshot;
  const stamp = stableJson({ ...header, projectTask: taskType, classes: classes.map(({ examples, ...fields }) => ({
    ...fields, examplesJson: raw.get(fields.id) ?? JSON.stringify(examples),
  })) });
  if (Buffer.byteLength(stamp, 'utf8') > MAX_LABEL_SCHEMA_JSON_BYTES) return corrupt();
  return stamp;
}

/** Exact full SQL snapshot, including raw examples JSON; no version-only CAS. */
export function readWorkspaceSchemaState(database: DatabaseConnection, projectId: string, schemaId: string): {
  snapshot: LabelSchemaSnapshot; stamp: string;
} {
  const row = database.prepare(`SELECT s.id,s.project_id AS projectId,s.instructions,s.locked_at AS lockedAt,
    s.edit_version AS editVersion,s.created_at AS createdAt,s.updated_at AS updatedAt,p.task_type AS projectTask
    FROM label_schemas s LEFT JOIN projects p ON p.id=s.project_id WHERE s.id=? AND s.project_id=?`).get(schemaId, projectId);
  if (row === undefined) throw new Error('Annotation Label Schema not found.');
  const { projectTask, ...header } = row as Record<string, unknown>;
  if (projectTask !== 'classification' && projectTask !== 'detection') return corrupt();
  const rawClasses = database.prepare(`SELECT id,schema_id AS schemaId,display_name AS displayName,
    normalized_name AS normalizedName,model_alias AS modelAlias,color,description,examples_json AS examplesJson,
    ordinal,created_at AS createdAt,updated_at AS updatedAt FROM label_classes WHERE schema_id=? ORDER BY ordinal,id`)
    .all(schemaId);
  const stamp = stableJson({ ...header, projectTask, classes: rawClasses });
  if (Buffer.byteLength(stamp, 'utf8') > MAX_LABEL_SCHEMA_JSON_BYTES) return corrupt();
  const classes = rawClasses.map((raw) => {
      const { examplesJson, ...fields } = raw as Record<string, unknown>;
      // Existing schema owner controls its JSON encoding; the shared contract
      // validates examples and bytes, without treating the SQL view as a DTO.
      if (typeof examplesJson !== 'string' || Buffer.byteLength(examplesJson) > 65_536) return corrupt();
      return { ...fields, examples: JSON.parse(examplesJson) as unknown };
    });
  const snapshot = labelSchemaSnapshotSchema.parse({ ...header, classes });
  if (snapshot.id !== schemaId || snapshot.projectId !== projectId) return corrupt();
  return { snapshot, stamp };
}

export function assertWorkspaceParents(database: DatabaseConnection, workspace: AnnotationWorkspace,
  classIds: ReadonlySet<string>): void {
  const parent = database.prepare(`SELECT p.task_type AS taskType FROM projects p
    JOIN label_schemas s ON s.project_id=p.id WHERE p.id=? AND s.id=?`).get(workspace.projectId, workspace.schemaId) as
    { taskType?: unknown } | undefined;
  if (parent?.taskType !== workspace.taskType) throw new Error('Annotation Project/task/Schema mismatch.');
  const actual = new Set(database.prepare('SELECT id FROM label_classes WHERE schema_id=?').all(workspace.schemaId)
    .map((row) => (row as { id: string }).id));
  if ([...classIds].some((id) => !actual.has(id))) throw new Error('Annotation class mapping changed or is foreign.');
  // locked_at is deliberately NOT a creation gate. It locks class edits only.
}

export interface WorkspaceInsertItem {
  readonly item: AnnotationItem;
  readonly annotationJson: string;
  readonly provenance: readonly AnnotationProvenance[];
}

/** Internal service-owned insertion; all DTO parsing/hash work precedes BEGIN. */
export function insertWorkspaceRows(database: DatabaseConnection, workspace: AnnotationWorkspace,
  entries: readonly WorkspaceInsertItem[]): void {
  if (!database.inTransaction) throw new Error('Workspace insertion requires the service transaction.');
  const check = (changes: number) => { if (changes !== 1) throw new Error('Workspace insert did not create one row.'); };
  check(database.prepare(`INSERT INTO annotation_workspaces
    (id,project_id,schema_id,task_type,mode,state,edit_version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(workspace.id, workspace.projectId, workspace.schemaId, workspace.taskType, workspace.mode,
      workspace.state, workspace.editVersion, workspace.createdAt, workspace.updatedAt).changes);
  const insertItem = database.prepare(`INSERT INTO annotation_items
    (id,workspace_id,import_id,image_key,image_sha256,width,height,annotation_json,annotation_sha256,
     state,negative_confirmed,exclusion_reason,edit_version,confirmed_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insertProvenance = database.prepare(`INSERT INTO annotation_provenance
    (item_id,target_key,kind,source_import_id,source_image_key,source_annotation_key,source_suggestion_id,original_json,changes_json)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  for (const { item, annotationJson, provenance } of entries) {
    check(insertItem.run(item.id, item.workspaceId, item.importId, item.imageKey, item.imageSha256,
      item.width, item.height, annotationJson, item.annotationSha256, item.state,
      Number(item.negativeConfirmed), item.exclusionReason, item.editVersion, item.confirmedAt, item.updatedAt).changes);
    for (const p of provenance) check(insertProvenance.run(p.itemId, p.targetKey, p.kind, p.sourceImportId,
      p.sourceImageKey, p.sourceAnnotationKey, p.sourceSuggestionId, stableJson(p.original), stableJson(p.changes)).changes);
  }
}

export function readWorkspaceHeader(database: DatabaseConnection, projectId: string, workspaceId: string): AnnotationWorkspace {
  const raw = database.prepare(`SELECT w.id,w.project_id AS projectId,w.schema_id AS schemaId,
    w.task_type AS taskType,w.mode,w.state,w.edit_version AS editVersion,w.created_at AS createdAt,w.updated_at AS updatedAt,
    p.task_type AS projectTask,s.project_id AS schemaProject FROM annotation_workspaces w
    LEFT JOIN projects p ON p.id=w.project_id LEFT JOIN label_schemas s ON s.id=w.schema_id
    WHERE w.id=? AND w.project_id=?`).get(workspaceId, projectId);
  if (raw === undefined) throw new Error('Annotation workspace not found.');
  const { projectTask, schemaProject, ...fields } = raw as Record<string, unknown>;
  const workspace = annotationWorkspaceSchema.parse(fields);
  if (workspace.taskType !== projectTask || workspace.projectId !== schemaProject) return corrupt();
  return freezeWorkspaceValue(workspace);
}

const itemSelect = `SELECT a.id,a.workspace_id AS workspaceId,a.import_id AS importId,a.image_key AS imageKey,
  a.image_sha256 AS imageSha256,a.width,a.height,a.annotation_json AS annotationJson,
  a.annotation_sha256 AS annotationSha256,a.state,a.negative_confirmed AS negativeConfirmed,
  a.exclusion_reason AS exclusionReason,a.edit_version AS editVersion,a.confirmed_at AS confirmedAt,a.updated_at AS updatedAt,
  s.sha256 AS sourceHash,s.mode AS sourceMode,d.project_id AS sourceProject,d.task_type AS sourceTask,d.mode AS importMode
  FROM annotation_items a LEFT JOIN import_sources s ON s.import_id=a.import_id AND s.image_key=a.image_key
  LEFT JOIN data_imports d ON d.id=a.import_id`;

function decodeItem(raw: unknown, workspace: AnnotationWorkspace, classes: ReadonlySet<string>): AnnotationItem {
  const { annotationJson, negativeConfirmed, sourceHash, sourceMode, sourceProject, sourceTask, importMode, ...fields }
    = raw as Record<string, unknown>;
  if (negativeConfirmed !== 0 && negativeConfirmed !== 1) return corrupt();
  const item = annotationItemSchema.parse({ ...fields, negativeConfirmed: negativeConfirmed === 1,
    annotation: decodeJson(annotationJson) });
  if (typeof annotationJson !== 'string' || canonicalAnnotationJson(item.annotation) !== annotationJson
    || annotationDigest(annotationJson) !== item.annotationSha256 || item.workspaceId !== workspace.id
    || item.annotation.kind !== workspace.taskType || sourceHash !== item.imageSha256
    || sourceProject !== workspace.projectId || sourceTask !== workspace.taskType
    || sourceMode !== workspace.mode || importMode !== workspace.mode) return corrupt();
  const ids = item.annotation.kind === 'classification'
    ? (item.annotation.classId === null ? [] : [item.annotation.classId]) : item.annotation.rectangles.map((r) => r.classId);
  if (ids.some((id) => !classes.has(id))) return corrupt();
  return freezeWorkspaceValue(item);
}

export function readWorkspaceItems(database: DatabaseConnection, workspace: AnnotationWorkspace,
  offset: number, limit: number, state?: string): { items: AnnotationItem[]; total: number } {
  const classes = new Set(readWorkspaceSchema(database, workspace.projectId, workspace.schemaId).classes.map((c) => c.id));
  const where = ` WHERE a.workspace_id=?${state === undefined ? '' : ' AND a.state=?'}`;
  const parameters: unknown[] = state === undefined ? [workspace.id] : [workspace.id, state];
  const count = database.prepare(`SELECT count(*) AS total FROM annotation_items a${where}`).get(...parameters) as { total: number };
  if (!Number.isSafeInteger(count.total) || count.total < 0) return corrupt();
  // Fixed identity order remains stable when ANN-08 later changes updated_at.
  const rows = database.prepare(`${itemSelect}${where} ORDER BY a.id LIMIT ? OFFSET ?`).all(...parameters, limit, offset);
  return freezeWorkspaceValue({ items: rows.map((row) => decodeItem(row, workspace, classes)), total: count.total });
}

export function readWorkspaceItem(database: DatabaseConnection, workspace: AnnotationWorkspace, itemId: string): {
  item: AnnotationItem; provenance: AnnotationProvenance[];
} {
  const raw = database.prepare(`${itemSelect} WHERE a.workspace_id=? AND a.id=?`).get(workspace.id, itemId);
  if (raw === undefined) throw new Error('Annotation item not found.');
  const classes = new Set(readWorkspaceSchema(database, workspace.projectId, workspace.schemaId).classes.map((c) => c.id));
  const item = decodeItem(raw, workspace, classes);
  // One genuine, bounded (256 MiB) repository decode within the caller's read
  // transaction. No DTO cache; list reads deliberately do not inspect provenance.
  const source = findDataImport(database, workspace.projectId, item.importId);
  if (!source || source.projectId !== workspace.projectId || source.taskType !== workspace.taskType
    || source.mode !== workspace.mode) return corrupt();
  const image = source.scanResult.images.find((entry) => entry.key === item.imageKey);
  const rows = database.prepare(`${provenanceSelect} WHERE p.item_id=? ORDER BY p.target_key`).all(item.id);
  return freezeWorkspaceValue({ item, provenance: validateItemProvenance(item, image, rows) });
}

const provenanceSelect = `SELECT p.item_id AS itemId,p.target_key AS targetKey,p.kind,
  p.source_import_id AS sourceImportId,p.source_image_key AS sourceImageKey,p.source_annotation_key AS sourceAnnotationKey,
  p.source_suggestion_id AS sourceSuggestionId,p.original_json AS originalJson,p.changes_json AS changesJson
  FROM annotation_provenance p`;

/**
 * W2-22: counts stored provenance rows of one workspace by kind, so the
 * confirmation dialog can show the real 由来 breakdown instead of another
 * metric. Read-only aggregation of existing rows; it derives nothing and
 * reports only kinds that actually occur.
 */
export function countWorkspaceProvenanceKinds(database: DatabaseConnection, projectId: string,
  workspaceId: string): Readonly<Record<string, number>> {
  const workspace = readWorkspaceHeader(database, projectId, workspaceId);
  const rows = database.prepare(`SELECT p.kind AS kind, COUNT(*) AS total
    FROM annotation_provenance p JOIN annotation_items a ON a.id=p.item_id
    WHERE a.workspace_id=? GROUP BY p.kind ORDER BY p.kind`).all(workspace.id);
  const counts: Record<string, number> = {};
  for (const raw of rows) {
    const row = raw as Record<string, unknown>;
    const kind = annotationProvenanceKindSchema.parse(row.kind);
    const total = row.total;
    if (typeof total !== 'number' || !Number.isSafeInteger(total) || total < 0) return corrupt();
    counts[kind] = total;
  }
  return Object.freeze(counts);
}

/** Shared strict validation; the bulk path supplies its already-indexed scan image. */
function validateItemProvenance(item: AnnotationItem, image: ScanImage | undefined,
  rows: readonly unknown[]): AnnotationProvenance[] {
  if (!image || image.sha256 !== item.imageSha256 || image.width !== item.width || image.height !== item.height) return corrupt();
  const original = image.annotation;
  const boxes = new Map(original?.type === 'detection' ? original.boxes.map((box) => [box.sourceAnnotationId, box]) : []);
  const rectangles = new Map(item.annotation.kind === 'detection' ? item.annotation.rectangles.map((r) => [r.id, r]) : []);
  const targets = new Set(item.annotation.kind === 'classification'
    ? (item.annotation.classId === null ? [] : ['classification']) : item.annotation.rectangles.map((r) => r.id));
  const provenance = rows.map((row) => {
      const { originalJson, changesJson, ...fields } = row as Record<string, unknown>;
      const p = annotationProvenanceSchema.parse({ ...fields, original: decodeJson(originalJson), changes: decodeJson(changesJson) });
      if (!targets.delete(p.targetKey) || p.itemId !== item.id || p.kind.startsWith('model-')
        || (p.kind !== 'manual' && (p.sourceImportId !== item.importId || p.sourceImageKey !== item.imageKey))
        || (p.kind === 'import-unmodified' && Object.keys(p.changes).length !== 0)) return corrupt();
      if (p.kind === 'import-unmodified' || p.kind === 'import-edited') {
        if (original === null) return corrupt();
        if (original.type === 'classification') {
          const key = original.sourceRow === null ? 'classification' : `row:${original.sourceRow}`;
          if (p.targetKey !== 'classification' || p.sourceAnnotationKey !== key
            || stableJson(p.original) !== stableJson(original)) return corrupt();
        } else {
          const box = boxes.get(p.sourceAnnotationKey!);
          const rectangle = rectangles.get(p.targetKey);
          if (!box || !rectangle || stableJson(p.original) !== stableJson({ type: 'detection', sourceImageId: original.sourceImageId, ...box })) return corrupt();
          if (p.kind === 'import-unmodified' && (rectangle.x !== box.bbox[0] || rectangle.y !== box.bbox[1]
            || rectangle.width !== box.bbox[2] || rectangle.height !== box.bbox[3])) return corrupt();
        }
        // Original scan classKey is verified above; the initial classKey→UUID
        // mapping is not stored. Only current Schema membership is provable.
      }
      return p;
    });
  if (targets.size !== 0) return corrupt();
  return provenance;
}

/** Caller-owned consistent read TX; constant SQL reads, no import payload reread or filesystem I/O. */
export function readValidatedImportedWorkspace(database: DatabaseConnection, projectId: string, workspaceId: string,
  source: DataImport): Readonly<{ workspace: AnnotationWorkspace; itemCount: number }> {
  if (!database.inTransaction) throw new Error('Imported workspace validation requires the caller read transaction.');
  assertDataImportSnapshotCurrent(database, source);
  const workspace = readWorkspaceHeader(database, projectId, workspaceId);
  if (source.projectId !== workspace.projectId || source.taskType !== workspace.taskType
    || source.mode !== workspace.mode) return corrupt();
  const classes = new Set(readWorkspaceSchema(database, projectId, workspace.schemaId).classes.map((entry) => entry.id));
  const images = new Map(source.scanResult.images.map((image) => [image.key, image]));
  const rows = database.prepare(`${itemSelect} WHERE a.workspace_id=? ORDER BY a.id`).all(workspace.id);
  if (rows.length !== images.size) return corrupt();
  const provenance = new Map<string, unknown[]>();
  for (const row of database.prepare(`${provenanceSelect}
    JOIN annotation_items a ON a.id=p.item_id WHERE a.workspace_id=? ORDER BY p.item_id,p.target_key`).all(workspace.id)) {
    const itemId = (row as { itemId: unknown }).itemId;
    if (typeof itemId !== 'string') return corrupt();
    const group = provenance.get(itemId);
    if (group) group.push(row); else provenance.set(itemId, [row]);
  }
  for (const row of rows) {
    const item = decodeItem(row, workspace, classes);
    if (item.importId !== source.id) return corrupt();
    validateItemProvenance(item, images.get(item.imageKey), provenance.get(item.id) ?? []);
    images.delete(item.imageKey);
    provenance.delete(item.id);
  }
  if (images.size !== 0 || provenance.size !== 0) return corrupt();
  assertDataImportSnapshotCurrent(database, source);
  return freezeWorkspaceValue({ workspace, itemCount: rows.length });
}