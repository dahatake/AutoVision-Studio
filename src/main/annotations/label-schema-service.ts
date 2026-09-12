import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual, types } from 'node:util';
import { z } from 'zod';

import {
  annotationIdSchema, createLabelClassInputSchema, labelClassSchema, labelSchemaSnapshotSchema, normalizeLabelClassName,
  updateLabelClassInputSchema, updateLabelSchemaInputSchema,
  type CreateLabelClassInput, type LabelClass, type LabelSchemaSnapshot,
  type UpdateLabelClassInput, type UpdateLabelSchemaInput,
} from '../../shared/contracts/annotation.js';
import type { ScanClass } from '../../shared/contracts/import.js';
import { importImageKeySchema } from '../data/import-source-manifest.js';
import type { DatabaseConnection } from '../db/database.js';
import { LabelSchemaError, LabelSchemaRepository, labelFailure } from './label-schema-repository.js';

export { LabelSchemaError, type LabelSchemaErrorCode } from './label-schema-repository.js';

/** Main-only identity capability, not a caller-authored schema or IPC DTO. */
export interface PreparedImportLabels {
  readonly projectId: string;
  readonly schemaId: string;
  readonly classMapping: Readonly<Record<string, string>>;
}
interface ImportLabelsState {
  readonly database: DatabaseConnection;
  readonly previous: LabelSchemaSnapshot | undefined;
  readonly initial: LabelSchemaSnapshot;
  readonly planned: LabelSchemaSnapshot;
  readonly additions: readonly LabelClass[];
}
const preparedImportLabels = new WeakMap<PreparedImportLabels, ImportLabelsState>();
// ScanClass has no exported shape. Reuse the Main import text primitive,
// validate its exact three fields, and never manufacture a partial ScanResult.
const importScanClassSchema = z.strictObject({ key: importImageKeySchema, name: importImageKeySchema,
  sourceCategoryId: z.string().regex(/^(?:0|[1-9][0-9]*)(?![\s\S])/u).nullable() });
const importClassColor = '#4f46e5';

function input<T>(parse: () => T): T {
  try { return parse(); } catch { return labelFailure('LABEL_INPUT'); }
}
function storage<T>(action: () => T): T {
  try { return action(); } catch (error) {
    if (error instanceof LabelSchemaError) throw error;
    return labelFailure('LABEL_DATABASE');
  }
}
function id(value: string): string { return input(() => annotationIdSchema.parse(value)); }
function version(schemaId: string, expectedEditVersion: number): void {
  input(() => updateLabelSchemaInputSchema.parse({ id: schemaId, expectedEditVersion, instructions: '' }));
}
function timestamp(previous?: string): string {
  return new Date(Math.max(Date.now(), previous === undefined ? 0 : Date.parse(previous) + 1)).toISOString();
}

// These input records contain primitives only. Snapshot descriptors rather
// than evaluating properties; freeze detached copies, never caller objects.
function copyImportRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || types.isProxy(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value) as object | null)) labelFailure('LABEL_INPUT');
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(value)) {
    const field = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !field?.enumerable || !('value' in field)
      || (typeof field.value !== 'string' && field.value !== null)) labelFailure('LABEL_INPUT');
    Object.defineProperty(result, key, { value: field.value, enumerable: true });
  }
  return Object.freeze(result);
}
function importLabelInputs(scanClasses: readonly ScanClass[], classNames?: Readonly<Record<string, string>>) {
  const captured = input(() => {
    if (types.isProxy(scanClasses) || !Array.isArray(scanClasses) || Object.getPrototypeOf(scanClasses) !== Array.prototype
      || Reflect.ownKeys(scanClasses).length !== scanClasses.length + 1) labelFailure('LABEL_INPUT');
    const copies = [];
    for (let index = 0; index < scanClasses.length; index += 1) {
      const field = Object.getOwnPropertyDescriptor(scanClasses, String(index));
      if (!field?.enumerable || !('value' in field)) labelFailure('LABEL_INPUT');
      const row = copyImportRecord(field.value);
      if (Object.keys(row).length !== 3 || !['key', 'name', 'sourceCategoryId'].every((key) => Object.hasOwn(row, key))) {
        labelFailure('LABEL_INPUT');
      }
      copies.push(row);
    }
    Object.freeze(copies);
    const names = copyImportRecord(classNames === undefined ? {} : classNames);
    return Object.freeze({ names, classes: Object.freeze(copies.map((row) => Object.freeze(importScanClassSchema.parse(row)))) });
  });
  const keys = new Set<string>(), categories = new Set<string>();
  for (const entry of captured.classes) {
    if (keys.has(entry.key) || (entry.sourceCategoryId !== null && categories.has(entry.sourceCategoryId))) labelFailure('LABEL_INPUT');
    keys.add(entry.key);
    if (entry.sourceCategoryId !== null) categories.add(entry.sourceCategoryId);
  }
  if (Object.keys(captured.names).some((key) => !keys.has(key))) labelFailure('LABEL_INPUT');
  const normalized = new Set<string>();
  return Object.freeze(captured.classes.map((entry) => {
    // ANN-03 owns spelling/code-point and post-NFKC size validation, even when
    // the name will match an existing class rather than create a new one.
    const displayName = input(() => createLabelClassInputSchema.out.shape.displayName.parse(
      Object.hasOwn(captured.names, entry.key) ? captured.names[entry.key] : entry.name));
    const normalizedName = normalizeLabelClassName(displayName);
    if (normalized.has(normalizedName)) labelFailure('LABEL_DUPLICATE_NAME');
    normalized.add(normalizedName);
    return Object.freeze({ key: entry.key, displayName, normalizedName });
  }));
}
function freezeLabelSnapshot(snapshot: LabelSchemaSnapshot): LabelSchemaSnapshot {
  for (const entry of snapshot.classes) { Object.freeze(entry.examples); Object.freeze(entry); }
  Object.freeze(snapshot.classes);
  return Object.freeze(snapshot);
}
function emptySchema(projectId: string, schemaId: string, at: string): LabelSchemaSnapshot {
  return { id: schemaId, projectId, instructions: '', classes: [], lockedAt: null,
    editVersion: 0, createdAt: at, updatedAt: at };
}
function buildLabelClass(parsed: CreateLabelClassInput, classId: string, at: string): LabelClass {
  const { expectedEditVersion: _version, ...fields } = parsed;
  return labelClassSchema.parse({ ...fields, id: classId, modelAlias: parsed.modelAlias ?? null,
    normalizedName: normalizeLabelClassName(parsed.displayName), createdAt: at, updatedAt: at });
}
function writeNewClass(repository: LabelSchemaRepository, snapshot: LabelSchemaSnapshot, label: LabelClass): void {
  unique(snapshot, label);
  repository.bump(snapshot, label.updatedAt);
  repository.writeClass(label, true);
}

// No await, external callbacks or I/O while holding a transaction. Private
// savepoint guards rollback ownership, including a failed COMMIT. Participant
// mode never commits/rolls back the enclosing training-start/import transaction.
function transaction<T>(database: DatabaseConnection, action: (repository: LabelSchemaRepository) => T,
  participant = false, readOnly = false): T {
  if (!database.open) labelFailure('LABEL_DATABASE');
  if (database.inTransaction !== participant) labelFailure('LABEL_TRANSACTION');
  return storage(() => {
    const marker = `label_${randomUUID().replaceAll('-', '')}`;
    if (!participant) database.exec(readOnly ? 'BEGIN' : 'BEGIN IMMEDIATE');
    try {
      database.exec(`SAVEPOINT ${marker}`);
      const result = action(new LabelSchemaRepository(database));
      database.exec(participant ? `RELEASE ${marker}` : 'COMMIT');
      return result;
    } catch (error) {
      try { database.exec(`ROLLBACK TO ${marker}; ${participant ? `RELEASE ${marker}` : 'ROLLBACK'}`); }
      catch { /* Never roll back an unrelated transaction after loss of marker. */ }
      throw error;
    }
  });
}
function requireSchema(repository: LabelSchemaRepository, projectId: string, schemaId: string,
  expectedEditVersion: number): LabelSchemaSnapshot {
  const snapshot = repository.find(projectId);
  if (!snapshot || snapshot.id !== schemaId) return labelFailure('LABEL_SCHEMA_NOT_FOUND');
  if (snapshot.lockedAt !== null) labelFailure('LABEL_LOCKED');
  if (snapshot.editVersion !== expectedEditVersion || snapshot.editVersion === Number.MAX_SAFE_INTEGER) labelFailure('LABEL_CONFLICT');
  return snapshot;
}
function requireClass(snapshot: LabelSchemaSnapshot, classId: string): LabelClass {
  return snapshot.classes.find((entry) => entry.id === classId) ?? labelFailure('LABEL_CLASS_NOT_FOUND');
}
function unique(snapshot: LabelSchemaSnapshot, value: LabelClass): void {
  if (snapshot.classes.some((entry) => entry.id !== value.id && entry.normalizedName === value.normalizedName)) labelFailure('LABEL_DUPLICATE_NAME');
  if (snapshot.classes.some((entry) => entry.id !== value.id && entry.ordinal === value.ordinal)) labelFailure('LABEL_ORDINAL_CONFLICT');
}
function fresh(repository: LabelSchemaRepository, projectId: string): LabelSchemaSnapshot {
  return repository.find(projectId) ?? labelFailure('LABEL_SCHEMA_NOT_FOUND');
}

/** Explicit user operation only. No startup/camera/import/run side effects.
 * One schema per existing Project; repeated explicit creation returns its data. */
export function createLabelSchema(database: DatabaseConnection, projectId: string): LabelSchemaSnapshot {
  const parent = id(projectId);
  return transaction(database, (repository) => {
    repository.requireProject(parent);
    const existing = repository.find(parent);
    if (existing) return existing;
    const at = timestamp();
    repository.insert(emptySchema(parent, randomUUID(), at));
    return fresh(repository, parent);
  });
}

/** Standalone committed snapshot only; never seeds an absent schema. */
export function getLabelSchema(database: DatabaseConnection, projectId: string): LabelSchemaSnapshot | undefined {
  const parent = id(projectId);
  return transaction(database, (repository) => repository.find(parent), false, true);
}

/** DAT-08B: no caller TX. Capture a genuine committed full schema in the normal
 * read transaction, then plan all UUIDs/timestamps/validation outside that TX.
 * No SQL writes, source-ID reuse, alias invention, instructions/lock changes,
 * workspace writes or human confirmation. Overrides map exact scan keys to
 * display names; ambiguous normalized names must be explicitly disambiguated. */
export function prepareImportLabels(database: DatabaseConnection, projectId: string,
  scanClasses: readonly ScanClass[], classNames?: Readonly<Record<string, string>>): PreparedImportLabels {
  const parent = id(projectId);
  const labels = importLabelInputs(scanClasses, classNames);
  const previous = transaction(database, (repository) => {
    repository.requireProject(parent);
    return repository.find(parent);
  }, false, true);
  if (previous) freezeLabelSnapshot(previous);
  const initial = previous ?? freezeLabelSnapshot(emptySchema(parent, randomUUID(), timestamp()));
  let next = { ...initial, classes: [...initial.classes] };
  let ordinal = initial.classes.reduce((maximum, entry) => Math.max(maximum, entry.ordinal), -1);
  const existing = new Map(initial.classes.map((entry) => [entry.normalizedName, entry]));
  const mapping: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const entry of labels) {
    const match = existing.get(entry.normalizedName);
    if (match) { mapping[entry.key] = match.id; continue; }
    if (initial.lockedAt !== null) labelFailure('LABEL_LOCKED');
    if (next.editVersion === Number.MAX_SAFE_INTEGER) labelFailure('LABEL_CONFLICT');
    if (ordinal === Number.MAX_SAFE_INTEGER) labelFailure('LABEL_ORDINAL_CONFLICT');
    const parsed = input(() => createLabelClassInputSchema.parse({ schemaId: initial.id, expectedEditVersion: next.editVersion,
      displayName: entry.displayName, modelAlias: null, color: importClassColor, description: '', examples: [], ordinal: ordinal + 1 }));
    const at = timestamp(next.updatedAt);
    const label = input(() => buildLabelClass(parsed, randomUUID(), at));
    unique(next, label);
    next.classes.push(label);
    next = { ...next, editVersion: next.editVersion + 1, updatedAt: at };
    ordinal = label.ordinal;
    mapping[entry.key] = label.id;
  }
  const planned = freezeLabelSnapshot(input(() => labelSchemaSnapshotSchema.parse(next)));
  const capability = Object.freeze({ projectId: parent, schemaId: planned.id, classMapping: Object.freeze(mapping) });
  preparedImportLabels.set(capability, { database, previous, initial, planned,
    additions: Object.freeze(planned.classes.slice(initial.classes.length)) });
  return capability;
}

/** Main-only planning read for the workspace participant, with no SQL. Accepts
 * only this service's still-unused capability, never a copied DTO/lookup ID.
 * Runtime-deep-frozen full future schema; not proof of committed persistence. */
export function readPreparedImportLabels(prepared: PreparedImportLabels): LabelSchemaSnapshot {
  return preparedImportLabels.get(prepared)?.planned ?? labelFailure('LABEL_INPUT');
}

/** Caller owns BEGIN/COMMIT/ROLLBACK. Consume on the first attempt (including
 * wrong DB/TX or rollback); retry requires fresh preparation outside TX.
 * Return the frozen actual repository read, provisional until owner COMMIT. */
export function insertImportLabels(database: DatabaseConnection, prepared: PreparedImportLabels): LabelSchemaSnapshot {
  const state = preparedImportLabels.get(prepared) ?? labelFailure('LABEL_INPUT');
  preparedImportLabels.delete(prepared);
  if (database !== state.database) labelFailure('LABEL_DATABASE');
  return transaction(database, (repository) => {
    repository.requireProject(state.planned.projectId);
    let current = repository.find(state.planned.projectId);
    // Compare every header/class field, not just the header's editVersion:
    // direct class-row changes must invalidate even an all-existing mapping.
    if (!isDeepStrictEqual(current, state.previous)) labelFailure('LABEL_CONFLICT');
    if (!current) {
      repository.insert(state.initial);
      current = fresh(repository, state.planned.projectId);
      if (!isDeepStrictEqual(current, state.initial)) labelFailure('LABEL_CONFLICT');
    }
    for (const label of state.additions) {
      writeNewClass(repository, current, label);
      current = fresh(repository, state.planned.projectId);
    }
    if (!isDeepStrictEqual(current, state.planned)) labelFailure('LABEL_CONFLICT');
    return freezeLabelSnapshot(current);
  }, true);
}

export function createLabelClass(database: DatabaseConnection, projectId: string, value: CreateLabelClassInput): LabelSchemaSnapshot {
  const parent = id(projectId);
  const parsed = input(() => createLabelClassInputSchema.parse(value));
  return transaction(database, (repository) => {
    const snapshot = requireSchema(repository, parent, parsed.schemaId, parsed.expectedEditVersion);
    const at = timestamp(snapshot.updatedAt);
    const label = buildLabelClass(parsed, randomUUID(), at);
    writeNewClass(repository, snapshot, label);
    return fresh(repository, parent);
  });
}

export function updateLabelClass(database: DatabaseConnection, projectId: string, value: UpdateLabelClassInput): LabelSchemaSnapshot {
  const parent = id(projectId);
  const parsed = input(() => updateLabelClassInputSchema.parse(value));
  return transaction(database, (repository) => {
    const snapshot = requireSchema(repository, parent, parsed.schemaId, parsed.expectedEditVersion);
    const previous = requireClass(snapshot, parsed.id);
    const at = timestamp(snapshot.updatedAt);
    const { expectedEditVersion: _version, ...fields } = parsed;
    const label = labelClassSchema.parse({ ...fields, normalizedName: normalizeLabelClassName(parsed.displayName),
      createdAt: previous.createdAt, updatedAt: at });
    unique(snapshot, label);
    repository.bump(snapshot, at);
    repository.writeClass(label, false);
    return fresh(repository, parent);
  });
}

export function updateLabelSchema(database: DatabaseConnection, projectId: string, value: UpdateLabelSchemaInput): LabelSchemaSnapshot {
  const parent = id(projectId);
  const parsed = input(() => updateLabelSchemaInputSchema.parse(value));
  return transaction(database, (repository) => {
    const snapshot = requireSchema(repository, parent, parsed.id, parsed.expectedEditVersion);
    repository.bump(snapshot, timestamp(snapshot.updatedAt), parsed.instructions);
    return fresh(repository, parent);
  });
}

export function deleteLabelClass(database: DatabaseConnection, projectId: string, schemaId: string,
  classId: string, expectedEditVersion: number): LabelSchemaSnapshot {
  const parent = id(projectId); id(schemaId); id(classId); version(schemaId, expectedEditVersion);
  return transaction(database, (repository) => {
    const snapshot = requireSchema(repository, parent, schemaId, expectedEditVersion);
    requireClass(snapshot, classId);
    repository.bump(snapshot, timestamp(snapshot.updatedAt));
    repository.removeClass(schemaId, classId);
    return fresh(repository, parent);
  });
}

/** Main-only participant: call inside the future first-learning-start DB
 * transaction, NOT at Run creation and NOT from Renderer. The return value is
 * provisional until the owner commits. Once committed, the marker is permanent. */
export function lockLabelSchema(database: DatabaseConnection, projectId: string, schemaId: string,
  expectedEditVersion: number): LabelSchemaSnapshot {
  const parent = id(projectId); id(schemaId); version(schemaId, expectedEditVersion);
  return transaction(database, (repository) => {
    const snapshot = requireSchema(repository, parent, schemaId, expectedEditVersion);
    repository.bump(snapshot, timestamp(snapshot.updatedAt), snapshot.instructions, true);
    return fresh(repository, parent);
  }, true);
}

/** Existing editable workspaces only. Frozen/revision references block the
 * entire merge: ANN-19 must define any future history-aware alternative. */
export function mergeLabelClasses(database: DatabaseConnection, projectId: string, schemaId: string,
  sourceId: string, targetId: string, expectedEditVersion: number): LabelSchemaSnapshot {
  const parent = id(projectId); id(schemaId); id(sourceId); id(targetId); version(schemaId, expectedEditVersion);
  if (sourceId === targetId) labelFailure('LABEL_INPUT');
  return transaction(database, (repository) => {
    const snapshot = requireSchema(repository, parent, schemaId, expectedEditVersion);
    requireClass(snapshot, sourceId); requireClass(snapshot, targetId);
    const at = timestamp(snapshot.updatedAt);
    repository.bump(snapshot, at);
    repository.mergeReferences(snapshot, sourceId, targetId, at);
    repository.removeClass(schemaId, sourceId);
    return fresh(repository, parent);
  });
}