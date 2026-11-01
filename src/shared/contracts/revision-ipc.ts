import { z } from 'zod';

import { annotationIdSchema } from './annotation.js';
import { jobSchema } from './job.js';

export const REVISION_CREATE_CHANNEL = 'revision:create' as const;
export const REVISION_VALIDATE_CHANNEL = 'revision:validate' as const;
export const REVISION_CONFIRM_AND_QUEUE_CHANNEL = 'revision:confirmAndQueue' as const;
export const REVISION_CLONE_CHANNEL = 'revision:clone' as const;

function plainJson(value: unknown, ancestors = new Set<object>(), checked = new WeakSet<object>()): boolean {
  try {
    if (value === null || typeof value === 'boolean') return true;
    if (typeof value === 'string') return !/[\uD800-\uDFFF\0]/u.test(value);
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value !== 'object' || ancestors.has(value)) return false;
    if (checked.has(value)) return true;
    ancestors.add(value);
    try {
      const keys = Reflect.ownKeys(value);
      if (Array.isArray(value)) {
        if (keys.length !== value.length + 1) return false;
        for (let index = 0; index < value.length; index += 1) {
          const field = Object.getOwnPropertyDescriptor(value, String(index));
          if (!field?.enumerable || !('value' in field) || !plainJson(field.value, ancestors, checked)) return false;
        }
      } else {
        const prototype: unknown = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) return false;
        for (const key of keys) {
          const field = Object.getOwnPropertyDescriptor(value, key);
          if (typeof key !== 'string' || key === '__proto__' || !field?.enumerable || !('value' in field)
            || !plainJson(field.value, ancestors, checked)) return false;
        }
      }
      checked.add(value);
      return true;
    } finally { ancestors.delete(value); }
  } catch { return false; }
}
const directJson = z.unknown().refine((value) => plainJson(value), 'Invalid JSON value');
const integer = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const timestamp = z.iso.datetime().refine((value) => Number.isFinite(Date.parse(value)));
const sha256 = z.string().regex(/^[a-f0-9]{64}(?![\s\S])/u);
const text = z.string().refine((value) => !/[\uD800-\uDFFF\0]/u.test(value));

export const revisionCreateInputSchema = directJson.pipe(z.strictObject({
  projectId: annotationIdSchema,
  workspaceId: annotationIdSchema,
  splitSeed: integer,
  createdBy: text.refine((value) => value.trim().length > 0 && value.length <= 256),
})).readonly();
export const revisionValidateInputSchema = directJson.pipe(z.strictObject({
  projectId: annotationIdSchema,
  workspaceId: annotationIdSchema,
})).readonly();
export const revisionCloneInputSchema = directJson.pipe(z.strictObject({
  projectId: annotationIdSchema,
  revisionId: annotationIdSchema,
})).readonly();
export const coverageWarningSchema = z.strictObject({
  code: z.enum(['CLASS_BELOW_RECOMMENDED', 'CLASS_IMBALANCE']), classId: z.string().nullable(),
  actual: z.number().finite(), required: z.number().finite(),
}).readonly();
export const revisionSummarySchema = directJson.pipe(z.strictObject({
  id: annotationIdSchema,
  projectId: annotationIdSchema,
  workspaceId: annotationIdSchema,
  revisionNo: integer.min(1),
  mode: z.enum(['copy', 'reference']),
  manifestSha256: sha256,
  manifestRelativePath: z.literal('').or(z.string().regex(/^datasets\/[a-f0-9-]{36}\/manifest\.json(?![\s\S])/u)),
  splitSeed: integer,
  createdBy: text,
  confirmedAt: timestamp,
  coverageWarnings: z.array(coverageWarningSchema).optional(),
})).readonly();
export const revisionIpcErrorCodeSchema = z.enum(['INVALID_REQUEST', 'NOT_FOUND', 'CONFLICT', 'BUSY', 'OPERATION_FAILED', 'CLASS_COVERAGE_ERROR']);
/** FR-CVP-001 guard results. Contains class ids and counts only (never paths). */
export const coverageErrorSchema = z.strictObject({
  code: z.literal('CLASS_BELOW_MINIMUM'), classId: z.string(), actual: integer, required: integer, shortfall: integer,
}).readonly();
export const revisionIpcErrorSchema = z.strictObject({
  code: revisionIpcErrorCodeSchema,
  coverageErrors: z.array(coverageErrorSchema).optional(),
}).readonly();
const response = <Value extends z.ZodType>(value: Value) => directJson.pipe(z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), value }),
  z.strictObject({ ok: z.literal(false), error: revisionIpcErrorSchema }),
])).readonly();
export const revisionCreateResponseSchema = response(revisionSummarySchema);
export const revisionValidationSummarySchema = directJson.pipe(z.strictObject({
  valid: z.boolean(),
  workspaceId: annotationIdSchema,
  total: integer,
  confirmed: integer,
  unconfirmed: integer,
  excluded: integer,
  schemaOutside: integer,
  invalidRectangles: integer,
  invalidStored: integer,
  issues: z.array(z.strictObject({
    itemId: z.string(),
    imageKey: z.string().nullable(),
    code: z.string(),
  })),
  byCode: z.record(z.string(), z.number().int().min(0)),
  /** Stored `annotation_provenance.kind` counts. Never the issue histogram. */
  provenanceByKind: z.record(z.string(), z.number().int().min(0)),
})).readonly();
export const revisionValidateResponseSchema = response(revisionValidationSummarySchema);
export const revisionConfirmAndQueueResponseSchema = directJson.pipe(z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), value: revisionSummarySchema }),
  z.strictObject({ ok: z.literal(false), error: revisionIpcErrorSchema }),
])).readonly();
export const revisionConfirmAndQueueValueSchema = directJson.pipe(z.strictObject({
  revision: revisionSummarySchema,
  training: jobSchema,
})).readonly();
export const revisionConfirmAndQueueFullResponseSchema = response(revisionConfirmAndQueueValueSchema);
export const revisionCloneResponseSchema = response(directJson.pipe(z.strictObject({
  workspaceId: annotationIdSchema,
  itemCount: integer,
})).readonly());

export type RevisionCreateInput = z.infer<typeof revisionCreateInputSchema>;
export type RevisionValidateInput = z.infer<typeof revisionValidateInputSchema>;
export type RevisionCloneInput = z.infer<typeof revisionCloneInputSchema>;
export type RevisionSummary = z.infer<typeof revisionSummarySchema>;
export type RevisionIpcErrorCode = z.infer<typeof revisionIpcErrorCodeSchema>;
export type RevisionCreateResponse = z.infer<typeof revisionCreateResponseSchema>;
export type RevisionValidateResponse = z.infer<typeof revisionValidateResponseSchema>;
export type RevisionConfirmAndQueueResponse = z.infer<typeof revisionConfirmAndQueueFullResponseSchema>;
export type RevisionCloneResponse = z.infer<typeof revisionCloneResponseSchema>;

export function parseRevisionCreateResponse(value: unknown, expected: RevisionCreateInput): RevisionCreateResponse {
  const response = revisionCreateResponseSchema.parse(value);
  if (response.ok && (response.value.projectId !== expected.projectId || response.value.workspaceId !== expected.workspaceId
    || response.value.splitSeed !== expected.splitSeed || response.value.createdBy !== expected.createdBy)) {
    throw new Error('Invalid revision response correlation.');
  }
  return response;
}

export function parseRevisionValidateResponse(value: unknown, expected: RevisionValidateInput): RevisionValidateResponse {
  const response = revisionValidateResponseSchema.parse(value);
  if (response.ok && response.value.workspaceId !== expected.workspaceId) throw new Error('Invalid revision validation correlation.');
  return response;
}

export function parseRevisionConfirmAndQueueResponse(value: unknown, expected: RevisionCreateInput): RevisionConfirmAndQueueResponse {
  const response = revisionConfirmAndQueueFullResponseSchema.parse(value);
  if (response.ok && (response.value.revision.projectId !== expected.projectId
    || response.value.revision.workspaceId !== expected.workspaceId
    || response.value.revision.splitSeed !== expected.splitSeed
    || response.value.revision.createdBy !== expected.createdBy
    || response.value.training.projectId !== expected.projectId
    || response.value.training.kind !== 'train'
    || response.value.training.status !== 'Queued')) {
    throw new Error('Invalid revision queue correlation.');
  }
  return response;
}

export function parseRevisionCloneResponse(value: unknown, expected: RevisionCloneInput): RevisionCloneResponse {
  const response = revisionCloneResponseSchema.parse(value);
  if (response.ok && response.value.itemCount < 0) throw new Error('Invalid revision clone response.');
  annotationIdSchema.parse(expected.revisionId);
  return response;
}

export interface RevisionApi {
  readonly create: (input: RevisionCreateInput) => Promise<RevisionCreateResponse>;
  readonly validate: (input: RevisionValidateInput) => Promise<RevisionValidateResponse>;
  readonly confirmAndQueue: (input: RevisionCreateInput) => Promise<RevisionConfirmAndQueueResponse>;
  readonly clone: (input: RevisionCloneInput) => Promise<RevisionCloneResponse>;
}
