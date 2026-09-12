import { z } from 'zod';

import { projectIdSchema, taskTypeSchema } from './project.js';

// ANN-02: domain DTOs, not write commands or evidence of human confirmation.
// Main owns generated IDs/timestamps/hashes, CAS, Project/task/schema/source
// binding, locks, consent, actual Suggestion FKs and all persistence. ANN-15
// still owns complete confirmation validation; ANN-19 owns revision manifests.
export const MAX_ANNOTATION_JSON_BYTES = 1_048_576;
export const MAX_LABEL_EXAMPLES_JSON_BYTES = 65_536;
export const MAX_LABEL_SCHEMA_JSON_BYTES = 4_194_304;
export type AnnotationJsonValue = null | boolean | number | string | AnnotationJsonValue[] | AnnotationJsonObject;
export type AnnotationJsonObject = { [key: string]: AnnotationJsonValue };
const INVALID = 'Invalid annotation contract';
const encoder = new TextEncoder();
const scalar = (value: string) => !/[\uD800-\uDFFF]/u.test(value) && !value.includes('\0');
const trimUnicode = (value: string) => value.replace(/^[\p{White_Space}\ufeff]+|[\p{White_Space}\ufeff]+$/gu, '');

// Locale-independent lowercase, NOT full Unicode case folding/transliteration.
// NFKC intentionally equates compatibility forms (including Roman numerals),
// but does not remove accents, fold confusables or collapse internal whitespace.
export function normalizeLabelClassName(displayName: string): string {
  return trimUnicode(displayName.normalize('NFKC')).toLowerCase();
}

// Direct DTOs from Main must be JSON trees, as in serialized JSON: no shared
// object/array references (or cycles); repeated primitives remain valid.
// Snapshot descriptors before Zod reads fields. No getter/toJSON invocation,
// symbols, sparse arrays, exotic prototypes or silent unknown removal.
// Iterative traversal also avoids a call-stack limit on adversarial JSON depth.
function copyJson(input: unknown): AnnotationJsonValue {
  let result: AnnotationJsonValue = null;
  const seen = new WeakSet<object>();
  type Visit = { value: unknown; put: (value: AnnotationJsonValue) => void };
  const pending: Visit[] = [{ value: input, put: (value) => { result = value; } }];
  while (pending.length > 0) {
    const next = pending.pop()!;
    const value = next.value;
    if (value === null || typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value)) ||
      (typeof value === 'string' && scalar(value))) {
      next.put(value);
      continue;
    }
    if (typeof value !== 'object' || value === null || seen.has(value)) throw new Error(INVALID);
    seen.add(value);
    const array = Array.isArray(value);
    const prototype: unknown = Object.getPrototypeOf(value);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) throw new Error(INVALID);
    const keys = Reflect.ownKeys(value);
    const output: AnnotationJsonValue[] | AnnotationJsonObject = array ? [] : Object.create(null) as AnnotationJsonObject;
    next.put(output);
    let length = 0;
    if (array) {
      const descriptor = Object.getOwnPropertyDescriptor(value, 'length');
      if (!descriptor || !('value' in descriptor) || !Number.isSafeInteger(descriptor.value)) throw new Error(INVALID);
      length = descriptor.value as number;
      if (keys.length !== length + 1) throw new Error(INVALID);
    }
    for (const key of keys) {
      if (array && key === 'length') continue;
      if (typeof key !== 'string' || key === '__proto__' || !scalar(key)) throw new Error(INVALID);
      if (array && (!/^(?:0|[1-9][0-9]*)(?![\s\S])/u.test(key) || Number(key) >= length)) throw new Error(INVALID);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw new Error(INVALID);
      pending.push({ value: descriptor.value, put: (child) => {
        Object.defineProperty(output, key, { value: child, enumerable: true, writable: true, configurable: true });
      } });
    }
  }
  return result;
}

const plainJson = z.unknown().transform((input, ctx) => {
  try { return copyJson(input); } catch {
    ctx.addIssue({ code: 'custom', message: INVALID });
    return z.NEVER;
  }
});
// Internal shape only: copyJson validates every descendant at the DTO boundary.
// Nested shapes must not reintroduce unknown input into the guarded JSON object.
const jsonObjectShape = z.custom<AnnotationJsonObject>((value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value));
const jsonObject = plainJson.pipe(jsonObjectShape);
function jsonBytesWithin(value: AnnotationJsonValue, limit: number): boolean {
  try { return encoder.encode(JSON.stringify(value)).length <= limit; } catch { return false; }
}
const text = z.string().refine(scalar);
const name = text.refine((value) => trimUnicode(value).length > 0 && [...value].length <= 256);
const longText = text.refine((value) => encoder.encode(value).length <= 65_536);
const sourceKey = text.refine((value) => trimUnicode(value).length > 0);
const integer = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const dimension = integer.min(1).max(2_147_483_647);
const timestamp = z.iso.datetime().refine((value) => Number.isFinite(Date.parse(value)));
const sha256 = z.string().regex(/^[a-f0-9]{64}(?![\s\S])/u);
const mode = z.enum(['copy', 'reference']);
// Unlike legacy Project input, domain identity is already lowercase canonical.
export const annotationIdSchema = z.string().regex(/^[a-f0-9-]{36}(?![\s\S])/u).pipe(projectIdSchema);
const timestamps = { createdAt: timestamp, updatedAt: timestamp };
const schemaFields = {
  id: annotationIdSchema, projectId: annotationIdSchema, instructions: longText,
  lockedAt: timestamp.nullable(), editVersion: integer, ...timestamps,
};
const classEditableFields = {
  // Preserve raw spelling and its code-point limit; also bound the canonical name.
  displayName: name.refine((value) => name.safeParse(normalizeLabelClassName(value)).success),
  modelAlias: name.nullable(),
  color: z.string().regex(/^#[a-f0-9]{6}(?![\s\S])/u), description: longText,
  // Literal text examples/captions only, NOT URLs, paths or image capabilities.
  // Consumers must render as text, never resolve/fetch/open these strings.
  examples: z.array(text).refine((value) => jsonBytesWithin(value, MAX_LABEL_EXAMPLES_JSON_BYTES)),
  ordinal: integer,
};
const classShape = z.strictObject({
  id: annotationIdSchema, schemaId: annotationIdSchema, ...classEditableFields,
  normalizedName: name, ...timestamps,
}).refine((value) => value.normalizedName === normalizeLabelClassName(value.displayName), {
  path: ['normalizedName'], message: 'Normalized name must match display name',
});

export const labelSchemaSchema = jsonObject.pipe(z.strictObject(schemaFields));
export const labelClassSchema = jsonObject.pipe(classShape);
// Rich read DTO: unlike the SQL annotation_schema_snapshots revision projection,
// retains header/class timestamps and each class.schemaId. ANN-19 must explicitly
// project the SQL view fields; never serialize this DTO as that view verbatim.
export const labelSchemaSnapshotSchema = jsonObject.pipe(z.strictObject({
  ...schemaFields, classes: z.array(classShape),
}).superRefine((value, ctx) => {
  const ids = new Set<string>();
  const names = new Set<string>();
  const ordinals = new Set<number>();
  value.classes.forEach((entry, index) => {
    if (entry.schemaId !== value.id || ids.has(entry.id) || names.has(entry.normalizedName) || ordinals.has(entry.ordinal)) {
      ctx.addIssue({ code: 'custom', path: ['classes', index], message: 'Foreign or duplicate class' });
    }
    ids.add(entry.id); names.add(entry.normalizedName); ordinals.add(entry.ordinal);
  });
}).refine((value) => jsonBytesWithin(value, MAX_LABEL_SCHEMA_JSON_BYTES)));

// Editable input deliberately excludes caller-authoritative normalizedName,
// identity generation, timestamps and lock state. Main recomputes normalization.
export const createLabelClassInputSchema = jsonObject.pipe(z.strictObject({
  schemaId: annotationIdSchema, expectedEditVersion: integer, ...classEditableFields,
  modelAlias: name.nullable().optional(),
}));
export const updateLabelClassInputSchema = jsonObject.pipe(z.strictObject({
  id: annotationIdSchema, schemaId: annotationIdSchema, expectedEditVersion: integer, ...classEditableFields,
}));
export const updateLabelSchemaInputSchema = jsonObject.pipe(z.strictObject({
  id: annotationIdSchema, expectedEditVersion: integer, instructions: longText,
}));

const rectangleShape = z.strictObject({
  id: annotationIdSchema, classId: annotationIdSchema,
  x: z.number().finite().min(0), y: z.number().finite().min(0),
  width: z.number().finite().positive(), height: z.number().finite().positive(),
});
const classificationShape = z.strictObject({ kind: z.literal('classification'), classId: annotationIdSchema.nullable() });
const detectionShape = z.strictObject({ kind: z.literal('detection'), rectangles: z.array(rectangleShape) });
const annotationShape = z.discriminatedUnion('kind', [classificationShape, detectionShape])
  .refine((value) => value.kind !== 'detection' || new Set(value.rectangles.map((entry) => entry.id)).size === value.rectangles.length,
    'Duplicate rectangle identity')
  .refine((value) => jsonBytesWithin(value, MAX_ANNOTATION_JSON_BYTES));
export const annotationRectangleSchema = jsonObject.pipe(rectangleShape);
export const classificationAnnotationSchema = jsonObject.pipe(classificationShape);
export const detectionAnnotationSchema = jsonObject.pipe(detectionShape)
  .refine((value) => new Set(value.rectangles.map((entry) => entry.id)).size === value.rectangles.length)
  .refine((value) => jsonBytesWithin(value, MAX_ANNOTATION_JSON_BYTES));
export const annotationSchema = jsonObject.pipe(annotationShape);
export const annotationStateSchema = z.enum(['unstarted', 'suggested', 'editing', 'confirmed', 'excluded']);

function inBounds(rectangle: AnnotationRectangle, width: number, height: number): boolean {
  // Subtraction prevents x + width rounding an outside rectangle back inside.
  return rectangle.width <= width - rectangle.x && rectangle.height <= height - rectangle.y;
}
export const annotationItemSchema = jsonObject.pipe(z.strictObject({
  id: annotationIdSchema, workspaceId: annotationIdSchema, importId: annotationIdSchema,
  imageKey: sourceKey, imageSha256: sha256, width: dimension, height: dimension,
  annotation: annotationShape, annotationSha256: sha256, state: annotationStateSchema,
  negativeConfirmed: z.boolean(), exclusionReason: text.refine((value) => encoder.encode(value).length <= 4096).nullable(),
  editVersion: integer, confirmedAt: timestamp.nullable(), updatedAt: timestamp,
}).superRefine((value, ctx) => {
  const reject = (path: string) => ctx.addIssue({ code: 'custom', path: [path], message: INVALID });
  const confirmed = value.state === 'confirmed';
  const emptyDetection = value.annotation.kind === 'detection' && value.annotation.rectangles.length === 0;
  if (confirmed !== (value.confirmedAt !== null)) reject('confirmedAt');
  if (value.state !== 'excluded' && value.exclusionReason !== null) reject('exclusionReason');
  if (value.negativeConfirmed && (!confirmed || !emptyDetection)) reject('negativeConfirmed');
  if (confirmed && emptyDetection && !value.negativeConfirmed) reject('negativeConfirmed');
  if (confirmed && value.annotation.kind === 'classification' && value.annotation.classId === null) reject('annotation');
  if (value.annotation.kind === 'detection' && value.annotation.rectangles.some((entry) => !inBounds(entry, value.width, value.height))) reject('annotation');
}));

export const annotationWorkspaceSchema = jsonObject.pipe(z.strictObject({
  id: annotationIdSchema, projectId: annotationIdSchema, schemaId: annotationIdSchema,
  taskType: taskTypeSchema, mode, state: z.enum(['editing', 'frozen']), editVersion: integer, ...timestamps,
}));
export const annotationProvenanceKindSchema = z.enum(['manual', 'import-unmodified', 'import-edited', 'model-accepted', 'model-edited']);
export const annotationProvenanceSchema = jsonObject.pipe(z.strictObject({
  itemId: annotationIdSchema, targetKey: z.union([z.literal('classification'), annotationIdSchema]),
  kind: annotationProvenanceKindSchema,
  sourceImportId: annotationIdSchema.nullable(), sourceImageKey: sourceKey.nullable(),
  sourceAnnotationKey: sourceKey.nullable(), sourceSuggestionId: annotationIdSchema.nullable(),
  original: jsonObjectShape.refine((value) => jsonBytesWithin(value, MAX_ANNOTATION_JSON_BYTES)),
  changes: jsonObjectShape.refine((value) => jsonBytesWithin(value, MAX_ANNOTATION_JSON_BYTES)),
}).superRefine((value, ctx) => {
  const imported = value.kind === 'import-unmodified' || value.kind === 'import-edited';
  const model = value.kind === 'model-accepted' || value.kind === 'model-edited';
  if (imported ? value.sourceImportId === null || value.sourceImageKey === null || value.sourceAnnotationKey === null || value.sourceSuggestionId !== null
    : value.sourceImportId !== null || value.sourceImageKey !== null || value.sourceAnnotationKey !== null || (model ? value.sourceSuggestionId === null : value.sourceSuggestionId !== null)) {
    ctx.addIssue({ code: 'custom', message: 'Provenance source mismatch' });
  }
}));
// Five-kind vocabulary is not permission to persist model provenance: schema
// 006 rejects BOTH model kinds until AST adds real Suggestion FKs and gates.

export type LabelSchema = z.infer<typeof labelSchemaSchema>;
export type LabelClass = z.infer<typeof labelClassSchema>;
export type LabelSchemaSnapshot = z.infer<typeof labelSchemaSnapshotSchema>;
export type CreateLabelClassInput = z.infer<typeof createLabelClassInputSchema>;
export type UpdateLabelClassInput = z.infer<typeof updateLabelClassInputSchema>;
export type UpdateLabelSchemaInput = z.infer<typeof updateLabelSchemaInputSchema>;
export type AnnotationRectangle = z.infer<typeof annotationRectangleSchema>;
export type ClassificationAnnotation = z.infer<typeof classificationAnnotationSchema>;
export type DetectionAnnotation = z.infer<typeof detectionAnnotationSchema>;
export type Annotation = z.infer<typeof annotationSchema>;
export type AnnotationState = z.infer<typeof annotationStateSchema>;
export type AnnotationItem = z.infer<typeof annotationItemSchema>;
export type AnnotationWorkspace = z.infer<typeof annotationWorkspaceSchema>;
export type AnnotationProvenanceKind = z.infer<typeof annotationProvenanceKindSchema>;
export type AnnotationProvenance = z.infer<typeof annotationProvenanceSchema>;
export type AnnotationValidationIssue = 'invalid-annotation' | 'invalid-dimensions' | 'invalid-class-ids' |
  'missing-class' | 'unknown-class' | 'out-of-bounds' | 'invalid-negative-confirmation';

// Content-only validation for a prospective confirmed annotation. classIds MUST
// come from Main's selected Project/Schema, never from an untrusted request.
// A [] result proves neither human intent nor resolved suggestions/provenance,
// source bytes, splits, locking or revision readiness. Draft DTOs allow null/[];
// this helper intentionally requires one class or explicit negative detection.
export function validateAnnotationForSchema(
  annotation: unknown, width: number, height: number, classIds: ReadonlySet<string>, negativeConfirmed: boolean,
): AnnotationValidationIssue[] {
  const parsed = annotationSchema.safeParse(annotation);
  if (!parsed.success) return ['invalid-annotation'];
  if (!dimension.safeParse(width).success || !dimension.safeParse(height).success) return ['invalid-dimensions'];
  if (!(classIds instanceof Set) || [...classIds].some((id) => !annotationIdSchema.safeParse(id).success)) return ['invalid-class-ids'];
  if (typeof negativeConfirmed !== 'boolean') return ['invalid-negative-confirmation'];
  const result = new Set<AnnotationValidationIssue>();
  const value = parsed.data;
  if (value.kind === 'classification') {
    if (value.classId === null) result.add('missing-class');
    else if (!classIds.has(value.classId)) result.add('unknown-class');
    if (negativeConfirmed) result.add('invalid-negative-confirmation');
  } else {
    if ((value.rectangles.length === 0) !== negativeConfirmed) result.add('invalid-negative-confirmation');
    for (const entry of value.rectangles) {
      if (!classIds.has(entry.classId)) result.add('unknown-class');
      if (!inBounds(entry, width, height)) result.add('out-of-bounds');
    }
  }
  return [...result];
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  try { return schema.parse(value); } catch { throw new Error(INVALID); }
}
export function parseLabelSchema(value: unknown): LabelSchema { return parse(labelSchemaSchema, value); }
export function parseAnnotationItem(value: unknown): AnnotationItem { return parse(annotationItemSchema, value); }
// DTO parsers do not decode serialized JSON or detect already-discarded duplicate
// keys. Main must bound actual serialized bytes and reject duplicate JSON keys.