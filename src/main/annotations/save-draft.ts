import { isDeepStrictEqual, types } from 'node:util';
import { z } from 'zod';

import {
  annotationIdSchema, annotationItemSchema, annotationProvenanceSchema, annotationSchema, annotationStateSchema,
  type Annotation, type AnnotationItem, type AnnotationJsonObject, type AnnotationJsonValue,
  type AnnotationProvenance, type AnnotationState,
} from '../../shared/contracts/annotation.js';
import type { DatabaseConnection } from '../db/database.js';
import { annotationTargets as targets, prepareTargetHistory, type TargetHistoryEntry } from './target-history.js';
import {
  annotationDigest, canonicalAnnotationJson, importWorkspaceStamp, readWorkspaceHeader, readWorkspaceItem,
  readWorkspaceProjectState, readWorkspaceSchemaState, workspaceTransaction,
} from './workspace-repository.js';

export interface SaveAnnotationDraftInput {
  readonly expectedEditVersion: number;
  readonly expectedAnnotationSha256: string;
  readonly annotation: Annotation;
  readonly state: 'editing' | 'excluded';
  readonly exclusionReason: string | null;
  /** Optional paired assertion. Version CAS already covers EVERY state change in migration 006. */
  readonly expectedState?: AnnotationState;
  readonly expectedConfirmedAt?: string | null;
}

const inputSchema = z.strictObject({
  expectedEditVersion: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  expectedAnnotationSha256: z.string().regex(/^[a-f0-9]{64}(?![\s\S])/u),
  annotation: annotationSchema,
  state: z.enum(['editing', 'excluded']),
  exclusionReason: z.string().refine((text) => !/[\uD800-\uDFFF\0]/u.test(text)
    && Buffer.byteLength(text, 'utf8') <= 4096).nullable(),
  expectedState: annotationStateSchema.optional(),
  expectedConfirmedAt: z.iso.datetime().refine((text) => Number.isFinite(Date.parse(text))).nullable().optional(),
}).superRefine((value, ctx) => {
  if (value.state !== 'excluded' && value.exclusionReason !== null) {
    ctx.addIssue({ code: 'custom', path: ['exclusionReason'], message: 'Only excluded drafts can have a reason.' });
  }
  if ((value.expectedState === undefined) !== (value.expectedConfirmedAt === undefined)
    || (value.expectedState !== undefined && (value.expectedState === 'confirmed') !== (value.expectedConfirmedAt !== null))) {
    ctx.addIssue({ code: 'custom', message: 'Expected state and confirmation timestamp must be a consistent pair.' });
  }
});

// Main supplements the shared JSON schemas with Node's non-invoking proxy test.
// Validate the WHOLE command before Zod reads it or even inTransaction is read.
// Descriptors avoid getters/toJSON, including array accessors and revoked proxies.
function assertPlainJson(input: unknown): void {
  const pending: unknown[] = [input], seen = new WeakSet<object>();
  while (pending.length > 0) {
    const value = pending.pop();
    if (value === null || typeof value === 'boolean'
      || (typeof value === 'number' && Number.isFinite(value))
      || (typeof value === 'string' && !/[\uD800-\uDFFF\0]/u.test(value))) continue;
    if (typeof value !== 'object' || value === null || types.isProxy(value) || seen.has(value)) {
      throw new TypeError('Annotation draft must be a plain JSON tree.');
    }
    seen.add(value);
    const array = Array.isArray(value), prototype: unknown = Object.getPrototypeOf(value);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('Annotation draft must be a plain JSON tree.');
    }
    const keys = Reflect.ownKeys(value);
    const length = array ? Object.getOwnPropertyDescriptor(value, 'length')?.value as number : 0;
    if (array && (!Number.isSafeInteger(length) || keys.length !== length + 1)) {
      throw new TypeError('Annotation draft arrays must be dense.');
    }
    for (const key of keys) {
      if (array && key === 'length') continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (typeof key !== 'string' || key === '__proto__' || /[\uD800-\uDFFF\0]/u.test(key)
        || !descriptor?.enumerable || !('value' in descriptor)
        || (array && (!/^(?:0|[1-9][0-9]*)(?![\s\S])/u.test(key) || Number(key) >= length))) {
        throw new TypeError('Annotation draft must contain only enumerable JSON data.');
      }
      pending.push(descriptor.value);
    }
  }
}

// Only shared-schema-validated trees reach this encoder. Match ANN-05's UTF-16
// ordering exactly, including integer-like keys in pre-existing delta records.
function provenanceJson(value: AnnotationJsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(provenanceJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${provenanceJson(value[key]!)}`).join(',')}}`;
}

function draftProvenance(item: AnnotationItem, previous: AnnotationItem,
  provenance: readonly AnnotationProvenance[], restored: ReadonlyMap<string, TargetHistoryEntry>): AnnotationProvenance[] {
  const before = targets(previous.annotation), origins = new Map(provenance.map((p) => [p.targetKey, p]));
  return [...targets(item.annotation)].map(([targetKey, fields]) => {
    const origin = origins.get(targetKey) ?? restored.get(targetKey)?.provenance;
    const priorFields = before.get(targetKey) ?? restored.get(targetKey)?.targetFields;
    // Exact identity only: active first, authenticated tombstone second, new manual last.
    const base: AnnotationProvenance = origin ?? { itemId: item.id, targetKey, kind: 'manual',
      sourceImportId: null, sourceImageKey: null, sourceAnnotationKey: null, sourceSuggestionId: null,
      original: {}, changes: {} };
    if (base.kind.startsWith('model-')) throw new Error('Model provenance is not enabled for draft saves.');
    const changes: AnnotationJsonObject = { ...base.changes };
    let edited = false;
    for (const [field, to] of Object.entries(fields)) {
      const from = priorFields?.[field] ?? null;
      if (isDeepStrictEqual(from, to)) continue;
      edited = true;
      const delta = changes[field];
      const first = delta !== null && typeof delta === 'object' && !Array.isArray(delta) && Object.hasOwn(delta, 'from')
        ? delta['from']! : from;
      changes[field] = { from: first, to };
    }
    return annotationProvenanceSchema.parse({ ...base,
      kind: edited && base.kind === 'import-unmodified' ? 'import-edited' : base.kind, changes });
  }).sort((a, b) => a.targetKey < b.targetKey ? -1 : a.targetKey > b.targetKey ? 1 : 0);
}

const conflict = (): never => { throw new Error('Annotation draft conflict: stored content or state changed.'); };
const requireOne = (changes: number): void => { if (changes !== 1) conflict(); };

/**
 * ANN-08 Main primitive: persist ONE explicit draft command synchronously now.
 * UI owns the <=1s debounce, flush/ack and content-only undo/redo (not implemented
 * here). Every accepted command advances item AND workspace versions, even if
 * its content hash is unchanged, and NEVER restores confirmation or negatives.
 * No model calls, filesystem access, timers, Revision or Queue side effects.
 */
export function saveAnnotationDraft(database: DatabaseConnection, projectId: string, workspaceId: string,
  itemId: string, input: SaveAnnotationDraftInput): { item: AnnotationItem; provenance: AnnotationProvenance[] } {
  const parent = annotationIdSchema.parse(projectId), workspaceIdValue = annotationIdSchema.parse(workspaceId);
  const itemIdValue = annotationIdSchema.parse(itemId);
  assertPlainJson(input);
  const command = inputSchema.parse(input);
  const annotationJson = canonicalAnnotationJson(command.annotation), annotationSha256 = annotationDigest(annotationJson);

  return workspaceTransaction(database, true, () => {
    const workspace = readWorkspaceHeader(database, parent, workspaceIdValue);
    if (workspace.state !== 'editing') throw new Error('Annotation workspace is frozen.');
    const projectStamp = readWorkspaceProjectState(database, parent).stamp;
    const schema = readWorkspaceSchemaState(database, parent, workspace.schemaId);
    const previous = readWorkspaceItem(database, workspace, itemIdValue);
    const item = previous.item;
    const sourceStamp = importWorkspaceStamp(database, parent, item.importId);
    if (item.editVersion !== command.expectedEditVersion || item.annotationSha256 !== command.expectedAnnotationSha256
      || (command.expectedState !== undefined && (item.state !== command.expectedState || item.confirmedAt !== command.expectedConfirmedAt))) conflict();
    if (item.editVersion === Number.MAX_SAFE_INTEGER || workspace.editVersion === Number.MAX_SAFE_INTEGER) conflict();
    if (command.annotation.kind !== workspace.taskType) throw new Error('Annotation draft task mismatch.');
    const classes = new Set(schema.snapshot.classes.map((entry) => entry.id));
    if ([...targets(command.annotation).values()].some((fields) => !classes.has(fields['classId'] as string))) {
      throw new Error('Annotation draft contains an unknown or foreign class.');
    }
    const updatedAt = new Date(Math.max(Date.now(), Date.parse(item.updatedAt) + 1, Date.parse(workspace.updatedAt) + 1)).toISOString();
    const next = annotationItemSchema.parse({ ...item, annotation: command.annotation, annotationSha256,
      state: command.state, exclusionReason: command.exclusionReason, negativeConfirmed: false, confirmedAt: null,
      editVersion: item.editVersion + 1, updatedAt });
    const history = prepareTargetHistory(database, workspace, previous, next.annotation);
    const provenance = draftProvenance(next, item, previous.provenance, history.restored);

    // Read and recheck confirmation explicitly, not merely the new draft state.
    // SQL 006 mandates version+1 even for confirm-only/reason-only changes: the
    // required expected version therefore also binds legacy callers' old state.
    requireOne(database.prepare(`UPDATE annotation_items SET annotation_json=?,annotation_sha256=?,state=?,
      negative_confirmed=0,exclusion_reason=?,edit_version=edit_version+1,confirmed_at=NULL,updated_at=?
      WHERE id=? AND workspace_id=? AND edit_version=? AND annotation_sha256=? AND annotation_json=?
        AND state=? AND confirmed_at IS ? AND negative_confirmed=? AND exclusion_reason IS ? AND updated_at=?`)
      .run(annotationJson, annotationSha256, next.state, next.exclusionReason, updatedAt, item.id, workspace.id,
        item.editVersion, item.annotationSha256, canonicalAnnotationJson(item.annotation), item.state,
        item.confirmedAt, Number(item.negativeConfirmed), item.exclusionReason, item.updatedAt).changes);
    // Unconfirm first (SQL prohibits touching provenance of confirmed items),
    // then replace just this image's projection in the SAME transaction.
    const removed = database.prepare('DELETE FROM annotation_provenance WHERE item_id=?').run(item.id);
    if (removed.changes !== previous.provenance.length) conflict();
    const insert = database.prepare(`INSERT INTO annotation_provenance
      (item_id,target_key,kind,source_import_id,source_image_key,source_annotation_key,source_suggestion_id,original_json,changes_json)
      VALUES (?,?,?,?,?,?,?,?,?)`);
    for (const p of provenance) requireOne(insert.run(p.itemId, p.targetKey, p.kind, p.sourceImportId, p.sourceImageKey,
      p.sourceAnnotationKey, p.sourceSuggestionId, provenanceJson(p.original), provenanceJson(p.changes)).changes);
    requireOne(database.prepare(`UPDATE annotation_workspaces SET edit_version=edit_version+1,updated_at=?
      WHERE id=? AND project_id=? AND schema_id=? AND state='editing' AND edit_version=? AND updated_at=?`)
      .run(updatedAt, workspace.id, parent, workspace.schemaId, workspace.editVersion, workspace.updatedAt).changes);

    const savedWorkspace = readWorkspaceHeader(database, parent, workspace.id);
    const saved = readWorkspaceItem(database, savedWorkspace, item.id);
    if (!isDeepStrictEqual(savedWorkspace, { ...workspace, editVersion: workspace.editVersion + 1, updatedAt })
      || !isDeepStrictEqual(saved, { item: next, provenance })
      || readWorkspaceProjectState(database, parent).stamp !== projectStamp
      || readWorkspaceSchemaState(database, parent, workspace.schemaId).stamp !== schema.stamp
      || importWorkspaceStamp(database, parent, item.importId) !== sourceStamp) conflict();
    history.assertSnapshot();
    return saved;
  });
}