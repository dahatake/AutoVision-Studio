import { z } from 'zod';

import { MAX_INPUT_ITEMS, scanResultSchema } from './import.js';
import { jobIpcIdSchema, jobIpcJobSchema, jobIpcProjectIdSchema } from './job-ipc.js';

export const IMPORT_START_CHANNEL = 'import:start' as const;
export const IMPORT_PREVIEW_CHANNEL = 'import:preview' as const;
export const IMPORT_COMMIT_CHANNEL = 'import:commit' as const;
export const IMPORT_DISCARD_CHANNEL = 'import:discard' as const;

// Descriptor-only inspection: no getters/toJSON, sparse arrays, symbols,
// hidden fields or class instances. Completed nodes make shared DAGs linear;
// active nodes still detect cycles. Shared cannot detect transparent Proxies:
// Main must reject them before parsing; native IPC supplies structured clones.
function plainJson(value: unknown, active = new WeakSet<object>(), completed = new WeakSet<object>(),
  depth = 0, mapping = false): boolean {
  try {
    if (value === null || typeof value === 'boolean') return true;
    if (typeof value === 'string') return !/[\uD800-\uDFFF]/u.test(value);
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value !== 'object' || active.has(value)) return false;
    // Mapping nodes are shallow string dictionaries, checked independently.
    if (!mapping && completed.has(value)) return true;
    active.add(value);
    try {
      const keys = Reflect.ownKeys(value);
      if (Array.isArray(value)) {
        if (mapping || Object.getPrototypeOf(value) !== Array.prototype || keys.length !== value.length + 1) return false;
        for (let i = 0; i < value.length; i += 1) {
          const field = Object.getOwnPropertyDescriptor(value, String(i));
          if (!field?.enumerable || !('value' in field) || !plainJson(field.value, active, completed, depth + 1)) return false;
        }
      } else {
        const prototype: unknown = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) return false;
        for (const key of keys) {
          const field = Object.getOwnPropertyDescriptor(value, key);
          if (typeof key !== 'string' || /[\uD800-\uDFFF]/u.test(key) || (!mapping && key === '__proto__')
            || !field?.enumerable || !('value' in field)) return false;
          if (mapping) {
            if (typeof field.value !== 'string' || /[\uD800-\uDFFF]/u.test(field.value)) return false;
          } else if (!plainJson(field.value, active, completed, depth + 1, depth === 0 && key === 'classNames')) return false;
        }
      }
      if (!mapping) completed.add(value);
      return true;
    } finally { active.delete(value); }
  } catch { return false; }
}
const directJson = z.unknown().transform((value, ctx) => {
  if (plainJson(value)) return value;
  ctx.addIssue({ code: 'custom', message: 'Invalid JSON value' });
  return z.NEVER; // Do not let readonly inspect/freeze an invalid or revoked Proxy.
});
const scan = scanResultSchema.out.shape;
const decimal = z.string().regex(/^(?:0|[1-9][0-9]*)(?![\s\S])/u);
const count = z.number().int().min(1).max(MAX_INPUT_ITEMS);
export const importSourceKindSchema = z.enum(['folder', 'csv', 'coco', 'unlabeled-directory', 'unlabeled-files']);
export const importTokenSchema = jobIpcIdSchema;
const correlation = { projectId: jobIpcProjectIdSchema, jobId: jobIpcIdSchema, token: importTokenSchema };
export const importStartInputSchema = directJson.pipe(z.strictObject({
  projectId: jobIpcProjectIdSchema, mode: scan.mode, sourceKind: importSourceKindSchema,
})).readonly();
export const importPreviewInputSchema = directJson.pipe(z.strictObject(correlation)).readonly();
export const importDiscardInputSchema = importPreviewInputSchema;

// z.record drops __proto__; Main's descriptor-based Record accepts it as an
// ordinary scanned class key. Preserve all keys in a detached null-prototype
// dictionary, never via assignment to Object.prototype-backed objects.
const classNames = z.unknown().transform((value, ctx) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || !plainJson(value, new WeakSet(), new WeakSet(), 0, true)) {
    ctx.addIssue({ code: 'custom', message: 'Invalid class names' }); return z.NEVER;
  }
  const names: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const key of Object.keys(value)) {
    const field = Object.getOwnPropertyDescriptor(value, key)!;
    Object.defineProperty(names, key, { value: field.value, enumerable: true });
  }
  return Object.freeze(names);
});
export const importCommitInputSchema = directJson.pipe(z.strictObject({
  ...correlation, rightsAccepted: z.literal(true), classNames: classNames.optional(),
})).readonly();

export const importStartValueSchema = directJson.pipe(z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('cancelled') }),
  z.strictObject({ status: z.literal('started'), token: importTokenSchema,
    job: jobIpcJobSchema.refine((job) => job.kind === 'scan-dataset', 'Invalid import job') }),
])).readonly();

export const importPreviewSchema = directJson.pipe(z.strictObject({
  projectId: jobIpcProjectIdSchema, jobId: jobIpcIdSchema, taskType: scan.taskType, mode: scan.mode,
  // DAT-01 decoder rejects zero valid images; do not invent an empty success.
  itemCount: count, sourceBytes: decimal,
  classes: z.array(scan.classes.element.readonly()).readonly(),
  issues: z.array(z.strictObject({
    severity: scan.issues.element.shape.severity, code: scan.issues.element.shape.code,
    imageKey: scan.issues.element.shape.target.shape.imageKey,
    row: scan.issues.element.shape.target.shape.row,
    itemId: scan.issues.element.shape.target.shape.itemId,
  }).readonly()).readonly(),
  files: z.array(z.strictObject({
    key: scan.images.element.shape.key,
    displayName: z.string().min(1).refine((name) => name !== '.' && name !== '..'
      && !/[\u0000-\u001f\u007f<>:"/\\|?*]/u.test(name) && !/[ .]$/u.test(name)),
  }).readonly()).max(MAX_INPUT_ITEMS).readonly(),
})).superRefine((value, ctx) => {
  const reject = () => ctx.addIssue({ code: 'custom', message: 'Invalid import preview' });
  const keys = new Set(value.files.map((file) => file.key));
  if (value.files.length !== value.itemCount || keys.size !== value.files.length
    || new Set(value.classes.map((item) => item.key)).size !== value.classes.length) reject();
  const categories = new Set<string>();
  for (const item of value.classes) {
    if ((value.taskType === 'classification') !== (item.sourceCategoryId === null)) reject();
    if (item.sourceCategoryId !== null) {
      if (categories.has(item.sourceCategoryId)) reject();
      categories.add(item.sourceCategoryId);
    }
  }
  // Failed candidates can have keys absent from files; Main has validated the
  // original sourcePath before omitting it from this safe display projection.
  for (const issue of value.issues) {
    if (issue.imageKey !== null && issue.severity !== 'error' && !keys.has(issue.imageKey)) reject();
  }
}).readonly();
export const importResultSchema = directJson.pipe(z.strictObject({
  status: z.literal('completed'), projectId: jobIpcProjectIdSchema,
  importId: jobIpcIdSchema, workspaceId: jobIpcIdSchema, itemCount: count, cleanupWarning: z.boolean(),
})).refine((value) => value.importId === value.workspaceId, 'Invalid import workspace').readonly();

export const importIpcErrorCodeSchema = z.enum([
  'IMPORT_INPUT', 'IMPORT_BUSY', 'IMPORT_MODE', 'IMPORT_NOT_FOUND', 'IMPORT_SCAN_FAILED',
  'IMPORT_SCAN_ERRORS', 'IMPORT_CAPACITY', 'IMPORT_PROJECT_CHANGED', 'IMPORT_ATTENTION',
  'IMPORT_OUTCOME_UNCERTAIN', 'INVALID_REQUEST', 'STALE_SELECTION', 'OPERATION_FAILED',
]);
export const importIpcErrorSchema = directJson.pipe(z.strictObject({
  code: importIpcErrorCodeSchema,
  capacity: z.strictObject({ requiredBytes: decimal, availableBytes: decimal }).readonly().optional(),
})).refine((value) => value.capacity === undefined || value.code === 'IMPORT_CAPACITY', 'Invalid capacity error').readonly();
function response<Value extends z.ZodType>(value: Value) {
  // Validate JSON once before finite strict schemas; never recursively expand
  // unknown fields through a recursive Zod JSON union (shared-DAG blowup).
  return directJson.pipe(z.discriminatedUnion('ok', [
    z.strictObject({ ok: z.literal(true), value }),
    z.strictObject({ ok: z.literal(false), error: importIpcErrorSchema }),
  ])).readonly();
}
export const importStartResponseSchema = response(importStartValueSchema);
export const importPreviewResponseSchema = response(importPreviewSchema);
export const importCommitResponseSchema = response(importResultSchema);
export const importDiscardResponseSchema = response(z.null());

export type ImportSourceKind = z.infer<typeof importSourceKindSchema>;
export type ImportStartInput = z.infer<typeof importStartInputSchema>;
export type ImportPreviewInput = z.infer<typeof importPreviewInputSchema>;
export type ImportCommitInput = z.infer<typeof importCommitInputSchema>;
export type ImportDiscardInput = z.infer<typeof importDiscardInputSchema>;
export type ImportStartValue = z.infer<typeof importStartValueSchema>;
export type ImportPreview = z.infer<typeof importPreviewSchema>;
export type ImportResult = z.infer<typeof importResultSchema>;
export type ImportIpcErrorCode = z.infer<typeof importIpcErrorCodeSchema>;
export type ImportIpcError = z.infer<typeof importIpcErrorSchema>;
export type ImportStartResponse = z.infer<typeof importStartResponseSchema>;
export type ImportPreviewResponse = z.infer<typeof importPreviewResponseSchema>;
export type ImportCommitResponse = z.infer<typeof importCommitResponseSchema>;
export type ImportDiscardResponse = z.infer<typeof importDiscardResponseSchema>;

function correlated(valid: boolean): void { if (!valid) throw new Error('Invalid import correlation'); }
export function parseImportStartResponse(value: unknown, expected: ImportStartInput): ImportStartResponse {
  const input = importStartInputSchema.parse(expected), result = importStartResponseSchema.parse(value);
  if (result.ok && result.value.status === 'started') correlated(result.value.job.projectId === input.projectId);
  return result;
}
export function parseImportPreview(value: unknown, expected: ImportPreviewInput): ImportPreview {
  const input = importPreviewInputSchema.parse(expected), result = importPreviewSchema.parse(value);
  correlated(result.projectId === input.projectId && result.jobId === input.jobId);
  return result;
}
export function parseImportResult(value: unknown, expected: ImportCommitInput): ImportResult {
  const input = importCommitInputSchema.parse(expected), result = importResultSchema.parse(value);
  correlated(result.projectId === input.projectId);
  return result;
}
export function parseImportPreviewResponse(value: unknown, expected: ImportPreviewInput): ImportPreviewResponse {
  const input = importPreviewInputSchema.parse(expected), result = importPreviewResponseSchema.parse(value);
  if (result.ok) correlated(result.value.projectId === input.projectId && result.value.jobId === input.jobId);
  return result;
}
export function parseImportCommitResponse(value: unknown, expected: ImportCommitInput): ImportCommitResponse {
  const input = importCommitInputSchema.parse(expected), result = importCommitResponseSchema.parse(value);
  if (result.ok) correlated(result.value.projectId === input.projectId);
  return result;
}
export function parseImportDiscardResponse(value: unknown, expected: ImportDiscardInput): ImportDiscardResponse {
  importDiscardInputSchema.parse(expected);
  return importDiscardResponseSchema.parse(value);
}

/** One object per invoke; H rejects extra arguments. Main retains picker paths,
 * taskType, mode and token -> project/job/sender/document binding; validates
 * that binding for preview/commit/discard (null discard has no echo to check).
 * Token syntax is not authority. Invalidate on disposal/navigation; never
 * auto-retry or fall back from reference to copy. Scan success is not import
 * completion. Existing Jobs API owns progress; there are no import events.
 * H/P validate both directions and re-freeze the received structured clone. */
export interface ImportApi {
  readonly start: (input: ImportStartInput) => Promise<ImportStartResponse>;
  readonly preview: (input: ImportPreviewInput) => Promise<ImportPreviewResponse>;
  readonly commit: (input: ImportCommitInput) => Promise<ImportCommitResponse>;
  readonly discard: (input: ImportDiscardInput) => Promise<ImportDiscardResponse>;
}