import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual, types } from 'node:util';
import { z } from 'zod';

import {
  annotationIdSchema, annotationItemSchema, annotationProvenanceSchema, annotationStateSchema,
  annotationWorkspaceSchema, type Annotation, type AnnotationProvenance, type AnnotationState,
  type AnnotationWorkspace, type LabelSchemaSnapshot,
} from '../../shared/contracts/annotation.js';
import type { ScanClass } from '../../shared/contracts/import.js';
import { findDataImport, readPreparedDataImport, type DataImport, type PreparedDataImport } from '../data/import-repository.js';
import type { DatabaseConnection } from '../db/database.js';
import { readPreparedImportLabels, type PreparedImportLabels } from './label-schema-service.js';
import {
  annotationDigest, assertWorkspaceParents, canonicalAnnotationJson, freezeWorkspaceValue,
  importWorkspaceStamp, insertWorkspaceRows, readWorkspaceHeader, readWorkspaceItem,
  readWorkspaceItems, readWorkspaceSchemaState, workspaceTransaction, type WorkspaceInsertItem,
  plannedImportWorkspaceStamp, plannedWorkspaceSchemaStamp, readWorkspaceProjectState,
  readValidatedImportedWorkspace,
} from './workspace-repository.js';

/** Provisional UI paging policy, not a claimed product requirement. */
export const MAX_ANNOTATION_PAGE_SIZE = 200;
export type AnnotationClassMapping = Readonly<Record<ScanClass['key'], string>>;
export interface AnnotationItemPageOptions { readonly offset: number; readonly limit: number; readonly state?: AnnotationState }

// Copy primitive fields before validation or DB access. Never execute caller
// accessors/toJSON; reject proxies, inherited properties and symbol keys too.
function copyInputRecord(input: unknown): Record<string, unknown> {
  if (input === null || typeof input !== 'object' || types.isProxy(input)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(input) as object | null)) {
    throw new Error('Invalid annotation workspace input.');
  }
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(input)) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (typeof key !== 'string' || !descriptor?.enumerable || !('value' in descriptor)) {
      throw new Error('Invalid annotation workspace input.');
    }
    Object.defineProperty(result, key, { value: descriptor.value, enumerable: true });
  }
  return result;
}

/**
 * ANN-05, synchronous Main-only operation. Caller owns DAT-08 Copy publication
 * / Reference file verification and consent. This API does NO filesystem I/O,
 * class creation, human confirmation, autosave, revision or Queue registration.
 */
export function createAnnotationWorkspace(database: DatabaseConnection, projectId: string, importId: string,
  schemaId: string, classMapping: AnnotationClassMapping): Readonly<{ workspace: AnnotationWorkspace; itemCount: number }> {
  const parent = annotationIdSchema.parse(projectId);
  const sourceId = annotationIdSchema.parse(importId);
  const schema = annotationIdSchema.parse(schemaId);
  const mapping = new Map(Object.entries(copyInputRecord(classMapping)).map(([key, value]) => [key, annotationIdSchema.parse(value)]));
  if (database.inTransaction) throw new Error('Annotation workspace requires no caller transaction.');
  const stamp = importWorkspaceStamp(database, parent, sourceId);
  // Only this genuine current repository read is accepted, never a caller DTO.
  const source = findDataImport(database, parent, sourceId);
  if (!source || importWorkspaceStamp(database, parent, sourceId) !== stamp) throw new Error('Annotation import changed or not found.');
  const { snapshot: labelSchema, stamp: schemaStamp } = readWorkspaceSchemaState(database, parent, schema);
  const { workspace, entries, result } = buildWorkspace(source, labelSchema, mapping, randomUUID());
  assertWorkspaceParents(database, workspace, new Set(mapping.values()));
  return workspaceTransaction(database, true, () => {
    if (importWorkspaceStamp(database, parent, sourceId) !== stamp) throw new Error('Annotation import changed before creation.');
    if (readWorkspaceSchemaState(database, parent, schema).stamp !== schemaStamp) throw new Error('Annotation Schema changed before creation.');
    assertWorkspaceParents(database, workspace, new Set(mapping.values()));
    insertWorkspaceRows(database, workspace, entries);
    if (importWorkspaceStamp(database, parent, sourceId) !== stamp) throw new Error('Annotation import changed during creation.');
    if (readWorkspaceSchemaState(database, parent, schema).stamp !== schemaStamp) throw new Error('Annotation Schema changed during creation.');
    assertWorkspaceParents(database, workspace, new Set(mapping.values()));
    return result;
  });
}

function buildWorkspace(source: DataImport, labelSchema: LabelSchemaSnapshot,
  mapping: ReadonlyMap<string, string>, workspaceId: string) {
  const parent = source.projectId, sourceId = source.id, schema = labelSchema.id;
  if (labelSchema.projectId !== parent) throw new Error('Annotation Project/Schema mismatch.');
  const classes = new Set(labelSchema.classes.map((entry) => entry.id));
  if (mapping.size !== source.scanResult.classes.length
    || source.scanResult.classes.some((entry) => !mapping.has(entry.key))
    || [...mapping.values()].some((id) => !classes.has(id))) {
    throw new Error('Annotation class mapping must exactly cover scan keys with actual Schema class UUIDs.');
  }
  const now = new Date().toISOString();
  const workspace = annotationWorkspaceSchema.parse({ id: workspaceId, projectId: parent, schemaId: schema,
    taskType: source.taskType, mode: source.mode, state: 'editing', editVersion: 0, createdAt: now, updatedAt: now });
  const entries: WorkspaceInsertItem[] = source.scanResult.images.map((image) => {
    const itemId = randomUUID();
    const provenance: AnnotationProvenance[] = [];
    const addProvenance = (targetKey: string, sourceAnnotationKey: string, original: unknown) => {
      provenance.push(annotationProvenanceSchema.parse({ itemId, targetKey, kind: 'import-unmodified',
        sourceImportId: sourceId, sourceImageKey: image.key, sourceAnnotationKey, sourceSuggestionId: null,
        original, changes: {} }));
    };
    let annotation: Annotation;
    const imported = image.annotation;
    if (source.taskType === 'classification') {
      if (imported !== null && imported.type !== 'classification') throw new Error('Import annotation task mismatch.');
      annotation = { kind: 'classification', classId: imported === null ? null : mapping.get(imported.classKey)! };
      // Explicit row namespace; never confuse CSV row 1 with a COCO annotation 1.
      if (imported !== null) addProvenance('classification', imported.sourceRow === null
        ? 'classification' : `row:${imported.sourceRow}`, imported);
    } else {
      if (imported !== null && imported.type !== 'detection') throw new Error('Import annotation task mismatch.');
      annotation = { kind: 'detection', rectangles: imported === null ? [] : imported.boxes.map((box) => {
        const id = randomUUID();
        addProvenance(id, box.sourceAnnotationId, { type: 'detection', sourceImageId: imported.sourceImageId, ...box });
        const [x, y, width, height] = box.bbox;
        return { id, classId: mapping.get(box.classKey)!, x, y, width, height };
      }) };
    }
    // Preserve the scan coordinate frame exactly. Current DAT-01 describes
    // pre-EXIF values; applying another transform here would corrupt provenance.
    // Empty detections have no target provenance; their baseline stays in import.
    const annotationJson = canonicalAnnotationJson(annotation);
    const item = annotationItemSchema.parse({ id: itemId, workspaceId: workspace.id, importId: sourceId,
      imageKey: image.key, imageSha256: image.sha256, width: image.width, height: image.height,
      annotation, annotationSha256: annotationDigest(annotationJson), state: 'unstarted', negativeConfirmed: false,
      exclusionReason: null, editVersion: 0, confirmedAt: null, updatedAt: now });
    return { item, annotationJson, provenance };
  });
  const result = freezeWorkspaceValue({ workspace, itemCount: entries.length });
  return freezeWorkspaceValue({ workspace, entries, result });
}

export interface PreparedAnnotationWorkspace {
  readonly id: string;
  readonly projectId: string;
  readonly schemaId: string;
  readonly itemCount: number;
}
interface PreparedWorkspaceState {
  readonly database: DatabaseConnection;
  readonly source: DataImport;
  readonly labels: LabelSchemaSnapshot;
  readonly projectStamp: string;
  readonly importStamp: string;
  readonly schemaStamp: string;
  readonly built: ReturnType<typeof buildWorkspace>;
}
const preparedWorkspaces = new WeakMap<PreparedAnnotationWorkspace, PreparedWorkspaceState>();

/** DAT-08 participant planning only: genuine capabilities, no caller TX or writes. */
export function prepareAnnotationWorkspaceForImport(database: DatabaseConnection, preparedImport: PreparedDataImport,
  preparedLabels: PreparedImportLabels): PreparedAnnotationWorkspace {
  if (database.inTransaction) throw new Error('Annotation workspace requires no caller transaction.');
  const source = readPreparedDataImport(preparedImport), labels = readPreparedImportLabels(preparedLabels);
  const project = readWorkspaceProjectState(database, source.projectId);
  if (labels.projectId !== source.projectId || preparedLabels.projectId !== source.projectId
    || preparedLabels.schemaId !== labels.id || project.taskType !== source.taskType) {
    throw new Error('Annotation Project/task/Schema mismatch.');
  }
  const job = database.prepare('SELECT project_id,kind,status FROM jobs WHERE id=?').get(source.scanJobId) as
    { project_id: string; kind: string; status: string } | undefined;
  if (job?.project_id !== source.projectId || job.kind !== 'scan-dataset' || job.status !== 'Succeeded') {
    throw new Error('Annotation import requires a matching succeeded scan job.');
  }
  if (database.prepare('SELECT import_id FROM import_generations WHERE import_id=?').get(source.id)
    || database.prepare('SELECT id FROM data_imports WHERE id=? OR scan_job_id=?').get(source.id, source.scanJobId)) {
    throw new Error('Annotation import requires a fresh import identity and scan job.');
  }
  const built = buildWorkspace(source, labels, new Map(Object.entries(preparedLabels.classMapping)), source.id);
  const capability = Object.freeze({ id: built.workspace.id, projectId: source.projectId,
    schemaId: labels.id, itemCount: built.entries.length });
  preparedWorkspaces.set(capability, { database, source, labels, projectStamp: project.stamp,
    importStamp: plannedImportWorkspaceStamp(source),
    schemaStamp: plannedWorkspaceSchemaStamp(database, labels, source.taskType), built });
  return capability;
}

/** One attempt, same DB, caller-owned TX. The result is provisional until COMMIT. */
export function insertPreparedAnnotationWorkspace(database: DatabaseConnection,
  prepared: PreparedAnnotationWorkspace): Readonly<{ workspace: AnnotationWorkspace; itemCount: number }> {
  const state = preparedWorkspaces.get(prepared);
  if (!state) throw new TypeError('A real unused prepared annotation workspace capability is required.');
  preparedWorkspaces.delete(prepared);
  if (database !== state.database) throw new Error('Annotation workspace requires its originating database connection.');
  if (!database.inTransaction) throw new Error('Annotation workspace requires the caller transaction.');
  const { workspace, entries, result } = state.built;
  const guard = () => {
    if (readWorkspaceProjectState(database, workspace.projectId).stamp !== state.projectStamp) {
      throw new Error('Annotation Project metadata changed.');
    }
    if (importWorkspaceStamp(database, workspace.projectId, state.source.id) !== state.importStamp) {
      throw new Error('Annotation import changed or was not inserted as planned.');
    }
    const actualLabels = readWorkspaceSchemaState(database, workspace.projectId, state.labels.id);
    if (actualLabels.stamp !== state.schemaStamp || !isDeepStrictEqual(actualLabels.snapshot, state.labels)) {
      throw new Error('Annotation Schema changed or was not inserted as planned.');
    }
  };
  guard();
  insertWorkspaceRows(database, workspace, entries);
  guard();
  return result;
}

/** Main-only DAT-08 retry validation. Read the genuine import in the same caller TX; commit remains the caller's responsibility. */
export function validateImportedWorkspace(database: DatabaseConnection, projectId: string, workspaceId: string,
  importSnapshot: DataImport): Readonly<{ workspace: AnnotationWorkspace; itemCount: number }> {
  return readValidatedImportedWorkspace(database, annotationIdSchema.parse(projectId),
    annotationIdSchema.parse(workspaceId), importSnapshot);
}

export function getAnnotationWorkspace(database: DatabaseConnection, projectId: string, workspaceId: string): AnnotationWorkspace {
  if (database.inTransaction) throw new Error('Annotation workspace requires no caller transaction.');
  return readWorkspaceHeader(database, annotationIdSchema.parse(projectId), annotationIdSchema.parse(workspaceId));
}

export function listAnnotationItems(database: DatabaseConnection, projectId: string, workspaceId: string,
  options: AnnotationItemPageOptions): ReturnType<typeof readWorkspaceItems> {
  const parent = annotationIdSchema.parse(projectId), workspace = annotationIdSchema.parse(workspaceId);
  const page = z.strictObject({ offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    limit: z.number().int().min(1).max(MAX_ANNOTATION_PAGE_SIZE), state: annotationStateSchema.optional() }).parse(copyInputRecord(options));
  return workspaceTransaction(database, false, () => readWorkspaceItems(database,
    readWorkspaceHeader(database, parent, workspace), page.offset, page.limit, page.state));
}

export function getAnnotationItem(database: DatabaseConnection, projectId: string, workspaceId: string,
  itemId: string): ReturnType<typeof readWorkspaceItem> {
  const parent = annotationIdSchema.parse(projectId), workspace = annotationIdSchema.parse(workspaceId), item = annotationIdSchema.parse(itemId);
  return workspaceTransaction(database, false, () => readWorkspaceItem(database,
    readWorkspaceHeader(database, parent, workspace), item));
}