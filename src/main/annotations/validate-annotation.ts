import { isDeepStrictEqual, types } from 'node:util';
import { z } from 'zod';

import {
  annotationIdSchema, annotationItemSchema, annotationStateSchema, validateAnnotationForSchema,
  type AnnotationItem, type AnnotationProvenance, type AnnotationState, type AnnotationValidationIssue,
} from '../../shared/contracts/annotation.js';
import type { DatabaseConnection } from '../db/database.js';
import {
  canonicalAnnotationJson, importWorkspaceStamp, readWorkspaceHeader, readWorkspaceItem,
  readWorkspaceProjectState, readWorkspaceSchemaState, workspaceTransaction,
  freezeWorkspaceValue,
} from './workspace-repository.js';

/** Content only; neither human confirmation nor Revision/source-byte readiness. */
export const checkAnnotationContent = validateAnnotationForSchema;

export interface ValidationIssue {
  readonly itemId: string;
  readonly code: AnnotationValidationIssue | 'unconfirmed' | 'excluded' | 'invalid-stored';
}

export interface WorkspaceValidationIssue extends ValidationIssue {
  readonly imageKey: string | null;
}

export interface WorkspaceValidationResult {
  readonly valid: boolean;
  readonly workspaceId: string;
  readonly total: number;
  readonly confirmed: number;
  readonly unconfirmed: number;
  readonly excluded: number;
  readonly schemaOutside: number;
  readonly invalidRectangles: number;
  readonly invalidStored: number;
  readonly issues: readonly WorkspaceValidationIssue[];
  readonly byCode: Readonly<Record<WorkspaceValidationIssue['code'], number>>;
}

export interface ConfirmAnnotationItemInput {
  readonly expectedEditVersion: number;
  readonly expectedAnnotationSha256: string;
  readonly expectedState: AnnotationState;
  readonly expectedConfirmedAt: string | null;
  readonly negativeConfirmed: boolean;
}

const commandSchema = z.strictObject({
  expectedEditVersion: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  expectedAnnotationSha256: z.string().regex(/^[a-f0-9]{64}(?![\s\S])/u),
  expectedState: annotationStateSchema,
  expectedConfirmedAt: z.iso.datetime().refine((value) => Number.isFinite(Date.parse(value))).nullable(),
  negativeConfirmed: z.boolean(),
}).refine((value) => (value.expectedState === 'confirmed') === (value.expectedConfirmedAt !== null));

// Flat command: snapshot descriptors before Zod/DB access, never invoke caller code.
function parseCommand(input: unknown): ConfirmAnnotationItemInput {
  const invalid = (): never => { throw new TypeError('Invalid annotation confirmation command.'); };
  if (typeof input !== 'object' || input === null || types.isProxy(input)) return invalid();
  const prototype: unknown = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) return invalid();
  const copy: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(input)) {
    const field = Object.getOwnPropertyDescriptor(input, key);
    if (typeof key !== 'string' || key === '__proto__' || !field?.enumerable || !('value' in field)) return invalid();
    const value: unknown = field.value;
    if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) return invalid();
    copy[key] = value;
  }
  return commandSchema.parse(copy);
}

/** Committed single-item readiness check. No writes; bounded, path-free errors.
 * Transaction ownership/commit errors propagate, never masquerade as content issues.
 * Whole-workspace totals/validation are deliberately NOT implemented by this leaf.
 */
export function validateAnnotationItem(database: DatabaseConnection, projectId: string, workspaceId: string,
  itemId: string): { valid: boolean; issues: ValidationIssue[] } {
  const parent = annotationIdSchema.parse(projectId), workspaceKey = annotationIdSchema.parse(workspaceId);
  const itemKey = annotationIdSchema.parse(itemId);
  return workspaceTransaction(database, false, () => {
    try {
      const workspace = readWorkspaceHeader(database, parent, workspaceKey);
      const { item } = readWorkspaceItem(database, workspace, itemKey);
      const schema = readWorkspaceSchemaState(database, parent, workspace.schemaId);
      const issues: ValidationIssue[] = checkAnnotationContent(item.annotation, item.width, item.height,
        new Set(schema.snapshot.classes.map((entry) => entry.id)), item.negativeConfirmed)
        .map((code) => ({ itemId: itemKey, code }));
      if (item.state !== 'confirmed') issues.push({ itemId: itemKey, code: item.state === 'excluded' ? 'excluded' : 'unconfirmed' });
      return { valid: issues.length === 0, issues };
    } catch {
      return { valid: false, issues: [{ itemId: itemKey, code: 'invalid-stored' }] };
    }
  });
}

function increment<T extends string>(target: Map<T, number>, code: T): void {
  target.set(code, (target.get(code) ?? 0) + 1);
}

function workspaceIssue(itemId: string, imageKey: string | null,
  code: WorkspaceValidationIssue['code']): WorkspaceValidationIssue {
  return Object.freeze({ itemId, imageKey, code });
}

function issueBucket(code: WorkspaceValidationIssue['code']): 'schemaOutside' | 'invalidRectangles' | 'invalidStored' | undefined {
  if (code === 'unknown-class' || code === 'invalid-class-ids') return 'schemaOutside';
  if (code === 'out-of-bounds' || code === 'invalid-dimensions' || code === 'invalid-annotation') return 'invalidRectangles';
  if (code === 'invalid-stored') return 'invalidStored';
  return undefined;
}

/** Whole-workspace readiness summary for Revision confirmation.
 * Read-only: never changes item state, confirmations, provenance, schema, or workspace locks.
 */
export function validateAnnotationWorkspace(database: DatabaseConnection, projectId: string,
  workspaceId: string): WorkspaceValidationResult {
  const parent = annotationIdSchema.parse(projectId), workspaceKey = annotationIdSchema.parse(workspaceId);
  return workspaceTransaction(database, false, () => {
    const workspace = readWorkspaceHeader(database, parent, workspaceKey);
    const schema = readWorkspaceSchemaState(database, parent, workspace.schemaId);
    const classIds = new Set(schema.snapshot.classes.map((entry) => entry.id));
    const rows = database.prepare(`SELECT id,image_key AS imageKey,width,height,annotation_json AS annotationJson,
      state,negative_confirmed AS negativeConfirmed FROM annotation_items WHERE workspace_id=? ORDER BY id`).all(workspace.id);
    let confirmed = 0, unconfirmed = 0, excluded = 0, schemaOutside = 0, invalidRectangles = 0, invalidStored = 0;
    const issues: WorkspaceValidationIssue[] = [];
    const byCode = new Map<WorkspaceValidationIssue['code'], number>();
    const add = (itemId: string, imageKey: string | null, code: WorkspaceValidationIssue['code']) => {
      issues.push(workspaceIssue(itemId, imageKey, code));
      increment(byCode, code);
      switch (issueBucket(code)) {
        case 'schemaOutside': schemaOutside += 1; break;
        case 'invalidRectangles': invalidRectangles += 1; break;
        case 'invalidStored': invalidStored += 1; break;
      }
    };
    for (const raw of rows) {
      const row = raw as Record<string, unknown>;
      const itemId = typeof row.id === 'string' ? row.id : '';
      const imageKey = typeof row.imageKey === 'string' ? row.imageKey : null;
      const state = row.state;
      if (state === 'confirmed') confirmed += 1;
      else if (state === 'excluded') excluded += 1;
      else unconfirmed += 1;
      if (typeof itemId !== 'string' || !annotationIdSchema.safeParse(itemId).success
        || typeof row.annotationJson !== 'string' || (row.negativeConfirmed !== 0 && row.negativeConfirmed !== 1)) {
        add(itemId, imageKey, 'invalid-stored');
        continue;
      }
      if (state === 'excluded') add(itemId, imageKey, 'excluded');
      else {
        let annotation: unknown;
        try { annotation = JSON.parse(row.annotationJson); }
        catch { add(itemId, imageKey, 'invalid-stored'); continue; }
        for (const code of checkAnnotationContent(annotation, Number(row.width), Number(row.height),
          classIds, row.negativeConfirmed === 1)) {
          add(itemId, imageKey, code);
        }
        if (state !== 'confirmed') add(itemId, imageKey, 'unconfirmed');
      }
    }
    const byCodeObject = Object.fromEntries(byCode) as Record<WorkspaceValidationIssue['code'], number>;
    return freezeWorkspaceValue({
      valid: issues.length === 0,
      workspaceId: workspace.id,
      total: rows.length,
      confirmed,
      unconfirmed,
      excluded,
      schemaOutside,
      invalidRectangles,
      invalidStored,
      issues,
      byCode: byCodeObject,
    });
  });
}

const conflict = (): never => { throw new Error('Annotation confirmation conflict: stored content or state changed.'); };
const requireOne = (changes: number): void => { if (changes !== 1) conflict(); };

/** ONE explicit human command, no content/provenance rewrite or schema lock.
 * Already-confirmed items reject even with fresh tokens: edit first to reconfirm.
 * The genuine repository read checks stored source hashes/originals, not disk bytes.
 * No filesystem, model, Revision, Queue, training or automatic confirmation.
 */
export function confirmAnnotationItem(database: DatabaseConnection, projectId: string, workspaceId: string,
  itemId: string, input: ConfirmAnnotationItemInput): { item: AnnotationItem; provenance: AnnotationProvenance[] } {
  const parent = annotationIdSchema.parse(projectId), workspaceKey = annotationIdSchema.parse(workspaceId);
  const itemKey = annotationIdSchema.parse(itemId), command = parseCommand(input);
  return workspaceTransaction(database, true, () => {
    const workspace = readWorkspaceHeader(database, parent, workspaceKey);
    if (workspace.state !== 'editing') throw new Error('Annotation workspace is frozen.');
    const projectStamp = readWorkspaceProjectState(database, parent).stamp;
    const schema = readWorkspaceSchemaState(database, parent, workspace.schemaId);
    const previous = readWorkspaceItem(database, workspace, itemKey), item = previous.item;
    const sourceStamp = importWorkspaceStamp(database, parent, item.importId);
    if (item.editVersion !== command.expectedEditVersion || item.annotationSha256 !== command.expectedAnnotationSha256
      || item.state !== command.expectedState || item.confirmedAt !== command.expectedConfirmedAt) conflict();
    if (item.state !== 'unstarted' && item.state !== 'editing') {
      throw new Error('Annotation must be an unconfirmed draft without pending suggestions.');
    }
    if (item.editVersion === Number.MAX_SAFE_INTEGER || workspace.editVersion === Number.MAX_SAFE_INTEGER) conflict();
    const issues = checkAnnotationContent(item.annotation, item.width, item.height,
      new Set(schema.snapshot.classes.map((entry) => entry.id)), command.negativeConfirmed);
    if (issues.length !== 0) throw new Error(`Annotation confirmation content invalid: ${issues.join(',')}.`);
    const updatedAt = new Date(Math.max(Date.now(), Date.parse(item.updatedAt) + 1, Date.parse(workspace.updatedAt) + 1)).toISOString();
    const next = annotationItemSchema.parse({ ...item, state: 'confirmed', confirmedAt: updatedAt,
      negativeConfirmed: command.negativeConfirmed, editVersion: item.editVersion + 1, updatedAt });
    requireOne(database.prepare(`UPDATE annotation_items SET state='confirmed',confirmed_at=?,negative_confirmed=?,
      edit_version=edit_version+1,updated_at=? WHERE id=? AND workspace_id=? AND import_id=? AND image_key=?
      AND image_sha256=? AND width=? AND height=? AND annotation_json=? AND annotation_sha256=?
      AND state=? AND confirmed_at IS ? AND negative_confirmed=? AND exclusion_reason IS ? AND edit_version=? AND updated_at=?`)
      .run(updatedAt, Number(command.negativeConfirmed), updatedAt, item.id, workspace.id, item.importId, item.imageKey,
        item.imageSha256, item.width, item.height, canonicalAnnotationJson(item.annotation), item.annotationSha256,
        item.state, item.confirmedAt, Number(item.negativeConfirmed), item.exclusionReason, item.editVersion, item.updatedAt).changes);
    requireOne(database.prepare(`UPDATE annotation_workspaces SET edit_version=edit_version+1,updated_at=?
      WHERE id=? AND project_id=? AND schema_id=? AND task_type=? AND mode=? AND state='editing'
      AND edit_version=? AND created_at=? AND updated_at=?`)
      .run(updatedAt, workspace.id, parent, workspace.schemaId, workspace.taskType, workspace.mode,
        workspace.editVersion, workspace.createdAt, workspace.updatedAt).changes);
    const savedWorkspace = readWorkspaceHeader(database, parent, workspace.id);
    const saved = readWorkspaceItem(database, savedWorkspace, item.id);
    if (!isDeepStrictEqual(savedWorkspace, { ...workspace, editVersion: workspace.editVersion + 1, updatedAt })
      || !isDeepStrictEqual(saved, { item: next, provenance: previous.provenance })
      || readWorkspaceProjectState(database, parent).stamp !== projectStamp
      || readWorkspaceSchemaState(database, parent, workspace.schemaId).stamp !== schema.stamp
      || importWorkspaceStamp(database, parent, item.importId) !== sourceStamp) conflict();
    return saved;
  });
}