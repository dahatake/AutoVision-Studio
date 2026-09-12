import { z } from 'zod';

import {
  annotationIdSchema, annotationItemSchema, annotationProvenanceSchema, annotationSchema,
  annotationStateSchema, annotationWorkspaceSchema, createLabelClassInputSchema,
  labelSchemaSnapshotSchema, updateLabelClassInputSchema, updateLabelSchemaInputSchema,
} from './annotation.js';

export const LABEL_GET_CHANNEL = 'label:get' as const;
export const LABEL_CREATE_CHANNEL = 'label:create' as const;
export const LABEL_CREATE_CLASS_CHANNEL = 'label:createClass' as const;
export const LABEL_UPDATE_CLASS_CHANNEL = 'label:updateClass' as const;
export const LABEL_UPDATE_CHANNEL = 'label:update' as const;
export const LABEL_DELETE_CLASS_CHANNEL = 'label:deleteClass' as const;
export const LABEL_MERGE_CLASSES_CHANNEL = 'label:mergeClasses' as const;
export const ANNOTATION_WORKSPACES_CHANNEL = 'annotation:workspaces' as const;
export const ANNOTATION_LIST_CHANNEL = 'annotation:list' as const;
export const ANNOTATION_GET_CHANNEL = 'annotation:get' as const;
export const ANNOTATION_SAVE_CHANNEL = 'annotation:save' as const;
export const ANNOTATION_CONFIRM_CHANNEL = 'annotation:confirm' as const;

const INVALID = 'Invalid annotation IPC contract';
const scalar = (value: string) => !/[\uD800-\uDFFF\0]/u.test(value);

// Descriptor snapshots never invoke getters/toJSON. Completed nodes keep DAG
// inspection linear; active nodes reject cycles. Preserve aliases in the copy
// rather than expanding them exponentially. Domain DTO schemas subsequently
// reject aliases inside their JSON trees. Main must reject transparent Proxies
// before parsing: portable JavaScript cannot identify them without invoking traps.
function copyJson(input: unknown): unknown {
  const active = new WeakSet<object>(), completed = new WeakSet<object>();
  const copies = new WeakMap<object, object>();
  type Visit = { value: unknown; put: (value: unknown) => void } | { done: object };
  let result: unknown;
  const pending: Visit[] = [{ value: input, put: (value) => { result = value; } }];
  while (pending.length > 0) {
    const next = pending.pop()!;
    if ('done' in next) { active.delete(next.done); completed.add(next.done); continue; }
    const value = next.value;
    if (value === null || typeof value === 'boolean' || (typeof value === 'string' && scalar(value))
      || (typeof value === 'number' && Number.isFinite(value))) { next.put(value); continue; }
    if (typeof value !== 'object' || value === null || active.has(value)) throw new Error(INVALID);
    if (completed.has(value)) { next.put(copies.get(value)); continue; }
    const array = Array.isArray(value), prototype: unknown = Object.getPrototypeOf(value);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) throw new Error(INVALID);
    const keys = Reflect.ownKeys(value);
    const length: unknown = array ? Object.getOwnPropertyDescriptor(value, 'length')?.value : 0;
    if (array && (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0 || keys.length !== length + 1)) throw new Error(INVALID);
    const output: object = array ? [] : Object.create(null) as object;
    active.add(value); copies.set(value, output); next.put(output); pending.push({ done: value });
    for (const key of keys) {
      if (array && key === 'length') continue;
      const field = Object.getOwnPropertyDescriptor(value, key);
      if (typeof key !== 'string' || !scalar(key) || key === '__proto__' || !field?.enumerable || !('value' in field)
        || (array && (!/^(?:0|[1-9][0-9]*)(?![\s\S])/u.test(key) || Number(key) >= (length as number)))) throw new Error(INVALID);
      pending.push({ value: field.value, put: (child) => {
        Object.defineProperty(output, key, { value: child, enumerable: true, writable: true, configurable: true });
      } });
    }
  }
  return result;
}
const directJson = z.unknown().transform((value, ctx) => {
  try { return copyJson(value); } catch {
    ctx.addIssue({ code: 'custom', message: INVALID });
    return z.NEVER; // Invalid/revoked proxies must never reach a freeze operation.
  }
});
function freezeCopy<T>(value: T): T {
  const pending: unknown[] = [value], seen = new WeakSet<object>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === null || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current); pending.push(...Object.values(current)); Object.freeze(current);
  }
  return value;
}
function boundary<S extends z.ZodType>(schema: S) {
  return directJson.pipe(schema).transform((value) => freezeCopy(value)).readonly();
}
const project = { projectId: annotationIdSchema };
const workspace = { ...project, workspaceId: annotationIdSchema };
const item = { ...workspace, itemId: annotationIdSchema };
const integer = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const sha256 = z.string().regex(/^[a-f0-9]{64}(?![\s\S])/u);
const timestamp = z.iso.datetime().refine((value) => Number.isFinite(Date.parse(value)));
const reason = z.string().refine((value) => scalar(value) && new TextEncoder().encode(value).length <= 4096).nullable();

export const labelGetInputSchema = boundary(z.strictObject(project));
export const labelCreateInputSchema = labelGetInputSchema;
export const labelCreateClassInputSchema = boundary(z.strictObject({ ...project, ...createLabelClassInputSchema.out.shape }));
export const labelUpdateClassInputSchema = boundary(z.strictObject({ ...project, ...updateLabelClassInputSchema.out.shape }));
export const labelUpdateInputSchema = boundary(z.strictObject({ ...project, ...updateLabelSchemaInputSchema.out.shape }));
export const labelDeleteClassInputSchema = boundary(z.strictObject({ ...project, schemaId: annotationIdSchema,
  classId: annotationIdSchema, expectedEditVersion: integer }));
export const labelMergeClassesInputSchema = boundary(z.strictObject({ ...project, schemaId: annotationIdSchema,
  sourceId: annotationIdSchema, targetId: annotationIdSchema, expectedEditVersion: integer,
}).refine((value) => value.sourceId !== value.targetId));
export const annotationWorkspacesInputSchema = boundary(z.strictObject(project));
export const annotationListInputSchema = boundary(z.strictObject({ ...workspace, offset: integer,
  limit: integer.min(1).max(200), state: annotationStateSchema.optional() }));
export const annotationGetInputSchema = boundary(z.strictObject(item));
export const annotationSaveInputSchema = boundary(z.strictObject({ ...item,
  expectedEditVersion: integer, expectedAnnotationSha256: sha256,
  expectedState: annotationStateSchema, expectedConfirmedAt: timestamp.nullable(),
  annotation: annotationSchema, state: z.enum(['editing', 'excluded']), exclusionReason: reason,
}).refine((value) => (value.expectedState === 'confirmed') === (value.expectedConfirmedAt !== null)
  && (value.state === 'excluded' || value.exclusionReason === null)));
// A separate human command: no annotation/provenance writes. Main rejects
// confirmed/excluded source states; their CAS assertions remain representable.
export const annotationConfirmInputSchema = boundary(z.strictObject({ ...item,
  expectedEditVersion: integer, expectedAnnotationSha256: sha256,
  expectedState: annotationStateSchema, expectedConfirmedAt: timestamp.nullable(),
  negativeConfirmed: z.boolean(),
}).refine((value) => (value.expectedState === 'confirmed') === (value.expectedConfirmedAt !== null)));

export const annotationIpcErrorCodeSchema = z.enum([
  'INVALID_REQUEST', 'NOT_FOUND', 'CONFLICT', 'LOCKED', 'CLASS_USED', 'HISTORY_REFERENCE', 'BUSY', 'OPERATION_FAILED',
]);
export const annotationIpcErrorSchema = boundary(z.strictObject({ code: annotationIpcErrorCodeSchema }));
function response<S extends z.ZodType>(value: S) {
  return boundary(z.discriminatedUnion('ok', [
    z.strictObject({ ok: z.literal(true), value }),
    z.strictObject({ ok: z.literal(false), error: annotationIpcErrorSchema }),
  ]));
}
// Main maps an absent schema (undefined) to null; no implicit schema creation.
export const labelGetResponseSchema = response(labelSchemaSnapshotSchema.nullable());
export const labelCreateResponseSchema = response(labelSchemaSnapshotSchema);
export const labelCreateClassResponseSchema = labelCreateResponseSchema;
export const labelUpdateClassResponseSchema = labelCreateResponseSchema;
export const labelUpdateResponseSchema = labelCreateResponseSchema;
export const labelDeleteClassResponseSchema = labelCreateResponseSchema;
export const labelMergeClassesResponseSchema = labelCreateResponseSchema;
export const annotationWorkspacesResponseSchema = response(z.array(annotationWorkspaceSchema));
export const annotationListResponseSchema = response(z.strictObject({ items: z.array(annotationItemSchema).max(200), total: integer }));
export const annotationGetResponseSchema = response(z.strictObject({ item: annotationItemSchema, provenance: z.array(annotationProvenanceSchema) }));
export const annotationSaveResponseSchema = annotationGetResponseSchema;
export const annotationConfirmResponseSchema = annotationGetResponseSchema;

export type LabelGetInput = z.infer<typeof labelGetInputSchema>;
export type LabelCreateInput = z.infer<typeof labelCreateInputSchema>;
export type LabelCreateClassInput = z.infer<typeof labelCreateClassInputSchema>;
export type LabelUpdateClassInput = z.infer<typeof labelUpdateClassInputSchema>;
export type LabelUpdateInput = z.infer<typeof labelUpdateInputSchema>;
export type LabelDeleteClassInput = z.infer<typeof labelDeleteClassInputSchema>;
export type LabelMergeClassesInput = z.infer<typeof labelMergeClassesInputSchema>;
export type AnnotationWorkspacesInput = z.infer<typeof annotationWorkspacesInputSchema>;
export type AnnotationListInput = z.infer<typeof annotationListInputSchema>;
export type AnnotationGetInput = z.infer<typeof annotationGetInputSchema>;
export type AnnotationSaveInput = z.infer<typeof annotationSaveInputSchema>;
export type AnnotationConfirmInput = z.infer<typeof annotationConfirmInputSchema>;
export type AnnotationIpcErrorCode = z.infer<typeof annotationIpcErrorCodeSchema>;
export type AnnotationIpcError = z.infer<typeof annotationIpcErrorSchema>;
export type LabelGetResponse = z.infer<typeof labelGetResponseSchema>;
export type LabelCreateResponse = z.infer<typeof labelCreateResponseSchema>;
export type LabelCreateClassResponse = z.infer<typeof labelCreateClassResponseSchema>;
export type LabelUpdateClassResponse = z.infer<typeof labelUpdateClassResponseSchema>;
export type LabelUpdateResponse = z.infer<typeof labelUpdateResponseSchema>;
export type LabelDeleteClassResponse = z.infer<typeof labelDeleteClassResponseSchema>;
export type LabelMergeClassesResponse = z.infer<typeof labelMergeClassesResponseSchema>;
export type AnnotationWorkspacesResponse = z.infer<typeof annotationWorkspacesResponseSchema>;
export type AnnotationListResponse = z.infer<typeof annotationListResponseSchema>;
export type AnnotationGetResponse = z.infer<typeof annotationGetResponseSchema>;
export type AnnotationSaveResponse = z.infer<typeof annotationSaveResponseSchema>;
export type AnnotationConfirmResponse = z.infer<typeof annotationConfirmResponseSchema>;

function correlated(valid: boolean): void { if (!valid) throw new Error(INVALID); }
function parser<I extends z.ZodType, R extends z.ZodType>(input: I, result: R,
  check: (value: z.output<R>, expected: z.output<I>) => void) {
  return (value: unknown, expected: z.input<I>): z.output<R> => {
    try { const request = input.parse(expected), parsed = result.parse(value); check(parsed, request); return parsed; }
    catch { throw new Error(INVALID); }
  };
}
// Explicit public context types: one validated strict request per invocation.
function labelCheck(result: LabelGetResponse, expected: LabelGetInput, schemaId?: string): void {
  if (result.ok && result.value !== null) correlated(result.value.projectId === expected.projectId
    && (schemaId === undefined || result.value.id === schemaId));
}
export const parseLabelGetResponse: (value: unknown, expected: LabelGetInput) => LabelGetResponse =
  parser(labelGetInputSchema, labelGetResponseSchema, labelCheck);
export const parseLabelCreateResponse: (value: unknown, expected: LabelCreateInput) => LabelCreateResponse =
  parser(labelCreateInputSchema, labelCreateResponseSchema, labelCheck);
export const parseLabelCreateClassResponse: (value: unknown, expected: LabelCreateClassInput) => LabelCreateClassResponse =
  parser(labelCreateClassInputSchema, labelCreateClassResponseSchema, (r, i) => labelCheck(r, i, i.schemaId));
export const parseLabelUpdateClassResponse: (value: unknown, expected: LabelUpdateClassInput) => LabelUpdateClassResponse =
  parser(labelUpdateClassInputSchema, labelUpdateClassResponseSchema, (r, i) => labelCheck(r, i, i.schemaId));
export const parseLabelUpdateResponse: (value: unknown, expected: LabelUpdateInput) => LabelUpdateResponse =
  parser(labelUpdateInputSchema, labelUpdateResponseSchema, (r, i) => labelCheck(r, i, i.id));
export const parseLabelDeleteClassResponse: (value: unknown, expected: LabelDeleteClassInput) => LabelDeleteClassResponse =
  parser(labelDeleteClassInputSchema, labelDeleteClassResponseSchema, (r, i) => labelCheck(r, i, i.schemaId));
export const parseLabelMergeClassesResponse: (value: unknown, expected: LabelMergeClassesInput) => LabelMergeClassesResponse =
  parser(labelMergeClassesInputSchema, labelMergeClassesResponseSchema, (r, i) => labelCheck(r, i, i.schemaId));
export const parseAnnotationWorkspacesResponse: (value: unknown, expected: AnnotationWorkspacesInput) => AnnotationWorkspacesResponse =
  parser(annotationWorkspacesInputSchema, annotationWorkspacesResponseSchema, (r, i) => {
    if (r.ok) correlated(r.value.every((w) => w.projectId === i.projectId)
      && new Set(r.value.map((w) => w.id)).size === r.value.length);
  });
export const parseAnnotationListResponse: (value: unknown, expected: AnnotationListInput) => AnnotationListResponse =
  parser(annotationListInputSchema, annotationListResponseSchema, (r, i) => {
    if (r.ok) correlated(r.value.items.every((entry) => entry.workspaceId === i.workspaceId
      && (i.state === undefined || entry.state === i.state)) && r.value.items.length <= i.limit
      && r.value.items.length <= Math.max(0, r.value.total - i.offset)
      && new Set(r.value.items.map((entry) => entry.id)).size === r.value.items.length);
  });
function itemCheck(result: AnnotationGetResponse, expected: AnnotationGetInput): void {
  if (!result.ok) return;
  const { item: entry, provenance } = result.value;
  const targets = new Set(entry.annotation.kind === 'classification'
    ? (entry.annotation.classId === null ? [] : ['classification']) : entry.annotation.rectangles.map((r) => r.id));
  correlated(entry.id === expected.itemId && entry.workspaceId === expected.workspaceId
    && provenance.length === targets.size
    && provenance.every((p) => p.itemId === entry.id && targets.has(p.targetKey)
      && ((p.kind !== 'import-unmodified' && p.kind !== 'import-edited')
        || (p.sourceImportId === entry.importId && p.sourceImageKey === entry.imageKey)))
    && new Set(provenance.map((p) => p.targetKey)).size === provenance.length);
}
function sameAnnotation(actual: AnnotationSaveInput['annotation'], expected: AnnotationSaveInput['annotation']): boolean {
  if (actual.kind === 'classification') return expected.kind === 'classification' && actual.classId === expected.classId;
  if (expected.kind !== 'detection') return false;
  return actual.rectangles.length === expected.rectangles.length && actual.rectangles.every((rect, index) => {
    const other = expected.rectangles[index]!;
    return rect.id === other.id && rect.classId === other.classId && rect.x === other.x && rect.y === other.y
      && rect.width === other.width && rect.height === other.height;
  });
}
export const parseAnnotationGetResponse: (value: unknown, expected: AnnotationGetInput) => AnnotationGetResponse =
  parser(annotationGetInputSchema, annotationGetResponseSchema, itemCheck);
export const parseAnnotationSaveResponse: (value: unknown, expected: AnnotationSaveInput) => AnnotationSaveResponse =
  parser(annotationSaveInputSchema, annotationSaveResponseSchema, (r, i) => {
    itemCheck(r, i);
    if (r.ok) correlated(i.expectedEditVersion < Number.MAX_SAFE_INTEGER
      && r.value.item.editVersion === i.expectedEditVersion + 1 && r.value.item.state === i.state
      && r.value.item.confirmedAt === null && !r.value.item.negativeConfirmed
        && r.value.item.exclusionReason === i.exclusionReason && sameAnnotation(r.value.item.annotation, i.annotation));
  });
export const parseAnnotationConfirmResponse: (value: unknown, expected: AnnotationConfirmInput) => AnnotationConfirmResponse =
  parser(annotationConfirmInputSchema, annotationConfirmResponseSchema, (r, i) => {
    itemCheck(r, i);
    if (r.ok) correlated((i.expectedState === 'unstarted' || i.expectedState === 'editing')
      && i.expectedEditVersion < Number.MAX_SAFE_INTEGER
      && r.value.item.editVersion === i.expectedEditVersion + 1 && r.value.item.state === 'confirmed'
      && r.value.item.confirmedAt !== null && r.value.item.updatedAt === r.value.item.confirmedAt
      && r.value.item.negativeConfirmed === i.negativeConfirmed
      && r.value.item.annotationSha256 === i.expectedAnnotationSha256 && r.value.item.exclusionReason === null);
  });

/** UUID route only, never a path or an encoded URL. Main authenticates sender,
 * project/workspace/item membership and resolves verified image bytes. */
export function annotationImageUrl(projectId: string, workspaceId: string, itemId: string): string {
  try {
    return `av-image://image/${annotationIdSchema.parse(projectId)}/${annotationIdSchema.parse(workspaceId)}/${annotationIdSchema.parse(itemId)}`;
  } catch { throw new Error(INVALID); }
}

/** H/P validate both directions and freeze received copies. Main owns error
 * mapping, project membership, CAS, recomputed hashes and image authorization.
 * No raw native errors/paths; keys in DTOs are opaque text, not filesystem paths.
 * Main must project safe keys/provenance, never serialize storage/source paths.
 * Five provenance kinds are read vocabulary, NOT permission for model writes.
 * Import owns workspace creation; learning owns locks; confirmation is an
 * explicit human command. Revision and model operations remain absent.
 * Reject extra invoke arguments. */
export interface LabelSchemaApi {
  readonly get: (input: LabelGetInput) => Promise<LabelGetResponse>;
  readonly create: (input: LabelCreateInput) => Promise<LabelCreateResponse>;
  readonly createClass: (input: LabelCreateClassInput) => Promise<LabelCreateClassResponse>;
  readonly updateClass: (input: LabelUpdateClassInput) => Promise<LabelUpdateClassResponse>;
  readonly update: (input: LabelUpdateInput) => Promise<LabelUpdateResponse>;
  readonly deleteClass: (input: LabelDeleteClassInput) => Promise<LabelDeleteClassResponse>;
  readonly mergeClasses: (input: LabelMergeClassesInput) => Promise<LabelMergeClassesResponse>;
}
export interface AnnotationApi {
  readonly workspaces: (input: AnnotationWorkspacesInput) => Promise<AnnotationWorkspacesResponse>;
  readonly list: (input: AnnotationListInput) => Promise<AnnotationListResponse>;
  readonly get: (input: AnnotationGetInput) => Promise<AnnotationGetResponse>;
  readonly save: (input: AnnotationSaveInput) => Promise<AnnotationSaveResponse>;
  readonly confirm: (input: AnnotationConfirmInput) => Promise<AnnotationConfirmResponse>;
}