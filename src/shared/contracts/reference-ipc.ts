import { z } from 'zod';

import { annotationIdSchema } from './annotation.js';

/**
 * REL-04 / W3-05: check saved Reference originals and repair a broken one.
 *
 * The Renderer can only name a Project and one saved `imageKey`. Main owns the
 * native picker, the candidate's bytes and the size/SHA-256 equality rule, so
 * no path, channel or filesystem capability crosses the bridge.
 */
export const REFERENCE_STATUS_CHANNEL = 'reference:status' as const;
export const REFERENCE_RELINK_CHANNEL = 'reference:relink' as const;

const scalar = (value: string) => !/[\uD800-\uDFFF\0]/u.test(value);
const key = z.string().min(1).max(1024).refine(scalar);

export const referenceStatusInputSchema = z.strictObject({
  projectId: annotationIdSchema,
}).readonly();
export const referenceRelinkInputSchema = z.strictObject({
  projectId: annotationIdSchema,
  importId: annotationIdSchema,
  imageKey: key,
}).readonly();

export const referenceRelinkReasonSchema = z.enum([
  'missing', 'inaccessible', 'unsafe', 'read-failed', 'changed',
  'identity-changed', 'size-changed', 'mtime-changed', 'hash-changed',
]);
/** One saved Reference original that can no longer be used as stored. */
export const referenceBrokenEntrySchema = z.strictObject({
  importId: annotationIdSchema,
  imageKey: key,
  reason: referenceRelinkReasonSchema,
}).readonly();
export const referenceStatusSchema = z.strictObject({
  projectId: annotationIdSchema,
  /** Reference imports inspected. Copy imports are never included. */
  inspectedImports: z.number().int().min(0),
  checked: z.number().int().min(0),
  broken: z.array(referenceBrokenEntrySchema).readonly(),
}).readonly();
export const referenceRelinkResultSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('cancelled') }),
  z.strictObject({ status: z.literal('relinked'), importId: annotationIdSchema, imageKey: key }),
]).readonly();

export const referenceIpcErrorCodeSchema = z.enum([
  'INVALID_REQUEST', 'NOT_FOUND', 'MISMATCH', 'BUSY', 'OPERATION_FAILED',
]);
export const referenceIpcErrorSchema = z.strictObject({ code: referenceIpcErrorCodeSchema }).readonly();

function response<Value extends z.ZodType>(value: Value) {
  return z.discriminatedUnion('ok', [
    z.strictObject({ ok: z.literal(true), value }),
    z.strictObject({ ok: z.literal(false), error: referenceIpcErrorSchema }),
  ]).readonly();
}

export const referenceStatusResponseSchema = response(referenceStatusSchema);
export const referenceRelinkResponseSchema = response(referenceRelinkResultSchema);

export type ReferenceStatusInput = z.infer<typeof referenceStatusInputSchema>;
export type ReferenceRelinkInput = z.infer<typeof referenceRelinkInputSchema>;
export type ReferenceBrokenEntry = z.infer<typeof referenceBrokenEntrySchema>;
export type ReferenceStatus = z.infer<typeof referenceStatusSchema>;
export type ReferenceRelinkResult = z.infer<typeof referenceRelinkResultSchema>;
export type ReferenceIpcErrorCode = z.infer<typeof referenceIpcErrorCodeSchema>;
export type ReferenceStatusResponse = z.infer<typeof referenceStatusResponseSchema>;
export type ReferenceRelinkResponse = z.infer<typeof referenceRelinkResponseSchema>;

export function parseReferenceStatusResponse(value: unknown, expected: ReferenceStatusInput): ReferenceStatusResponse {
  const parsed = referenceStatusResponseSchema.parse(value);
  if (parsed.ok && parsed.value.projectId !== expected.projectId) {
    throw new Error('Invalid reference status correlation.');
  }
  return parsed;
}

export function parseReferenceRelinkResponse(value: unknown, expected: ReferenceRelinkInput): ReferenceRelinkResponse {
  const parsed = referenceRelinkResponseSchema.parse(value);
  if (parsed.ok && parsed.value.status === 'relinked'
    && (parsed.value.importId !== expected.importId || parsed.value.imageKey !== expected.imageKey)) {
    throw new Error('Invalid reference relink correlation.');
  }
  return parsed;
}

export interface ReferenceApi {
  readonly status: (input: ReferenceStatusInput) => Promise<ReferenceStatusResponse>;
  readonly relink: (input: ReferenceRelinkInput) => Promise<ReferenceRelinkResponse>;
}
