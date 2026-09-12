import { z } from 'zod';

import { jobIdSchema } from './job.js';
import { projectIdSchema, taskTypeSchema } from './project.js';
import type { JsonObject } from './worker.js';

// DAT-01a: implementation-plan §15.1 / requirements §8.3. Pure contracts only.
// The existing worker envelope owns schemaVersion, kind and control-byte limits.
export const MAX_IMAGE_BYTES = 134_217_728;
export const MAX_IMAGE_PIXELS = 40_000_000;
export const MAX_INPUT_ITEMS = 100_000;
export const MAX_ANNOTATION_BYTES = 67_108_864;
export const MAX_SCAN_RESULT_BYTES = 268_435_456;
const INVALID = 'Invalid import contract';

function invalid(): never {
  throw new Error(INVALID);
}

function scalarString(value: string): boolean {
  return !/[\uD800-\uDFFF]/u.test(value);
}

// Identical whitespace set in Python; preserve spelling, including Unicode and
// surrounding spaces. Label Schema normalization/merging is not a scan action.
const text = z.string().refine((value) => scalarString(value) && !value.includes('\0') &&
  /[^\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]/u.test(value));

function windowsAbsolute(value: string): boolean {
  // Accept ordinary drive-absolute and UNC syntax, NOT permission to access a
  // network share. Main's chooser/offline policy and the worker's read-time
  // identity, containment, link and replacement checks remain mandatory.
  const path = value.replaceAll('/', '\\');
  let parts: string[];
  let deviceStart = 0;
  if (/^[A-Za-z]:\\/u.test(path)) {
    parts = path.slice(3).split('\\');
  } else if (path.startsWith('\\\\')) {
    parts = path.slice(2).split('\\');
    if (parts.length < 2 || !parts[0] || !parts[1]) return false;
    deviceStart = 2;
  } else return false;
  if (parts.at(-1) === '') parts.pop();
  return parts.every((part, index) => part.length > 0 &&
    !/[\u0000-\u001f<>:"|?*]/u.test(part) && !/[. ]$/u.test(part) &&
    (index < deviceStart || !/^(?:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)/iu.test(part)));
}

const absolutePath = text.refine(windowsAbsolute);
const integer = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const finite = z.number().finite().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
const sourceId = z.string().regex(/^(?:0|[1-9][0-9]*)(?![\s\S])/u);

// Reject non-JSON objects, getters, sparse arrays and cycles before Zod reads
// fields. No new depth policy: the actual DTO shapes are finite/non-recursive.
function jsonValue(value: unknown, active: Set<object>): boolean {
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'string') return scalarString(value);
  if (typeof value === 'number') return Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER;
  if (typeof value !== 'object' || active.has(value)) return false;
  active.add(value);
  let valid: boolean;
  if (Array.isArray(value)) {
    valid = Reflect.ownKeys(value).length === value.length + 1;
    for (let index = 0; valid && index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      valid = descriptor !== undefined && descriptor.enumerable === true &&
        'value' in descriptor && jsonValue(descriptor.value, active);
    }
  } else {
    const prototype: unknown = Object.getPrototypeOf(value);
    valid = (prototype === Object.prototype || prototype === null) &&
      Reflect.ownKeys(value).every((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        // All object nodes in these finite DTOs have fixed fields. Zod drops
        // __proto__ even in strict objects; reject it before any field is lost.
        return typeof key === 'string' && key !== '__proto__' && scalarString(key) && descriptor !== undefined &&
          descriptor.enumerable === true && 'value' in descriptor && jsonValue(descriptor.value, active);
      });
  }
  active.delete(value);
  return valid;
}

const jsonObject = z.custom<JsonObject>((value) => {
  try {
    return value !== null && typeof value === 'object' && !Array.isArray(value) && jsonValue(value, new Set());
  } catch {
    return false;
  }
});
const mode = z.enum(['copy', 'reference']);
const source = z.discriminatedUnion('format', [
  z.discriminatedUnion('selection', [
    z.strictObject({ format: z.literal('unlabeled'), selection: z.literal('directory'), root: absolutePath }),
    z.strictObject({ format: z.literal('unlabeled'), selection: z.literal('files'), selectionManifestPath: absolutePath }),
  ]),
  z.strictObject({ format: z.literal('folder'), root: absolutePath }),
  z.strictObject({ format: z.literal('csv'), root: absolutePath, annotationPath: absolutePath }),
  z.strictObject({ format: z.literal('coco'), root: absolutePath, annotationPath: absolutePath }),
]);

export const scanPayloadSchema = jsonObject.pipe(z.strictObject({ taskType: taskTypeSchema, mode, source })
  .refine((value) => value.source.format === 'unlabeled' ||
    (value.source.format === 'coco' ? value.taskType === 'detection' : value.taskType === 'classification')));

// Keep order and repeated path spellings. Case folding cannot establish Windows
// file identity; DAT-02 reports physical/content duplicates, never silently drops
// candidates. MAX_INPUT_ITEMS counts selections BEFORE duplicate handling.
export const selectionManifestSchema = jsonObject.pipe(z.strictObject({
  formatVersion: z.literal(1),
  files: z.array(absolutePath).min(1).max(MAX_INPUT_ITEMS),
}));

const scanClass = z.strictObject({
  key: text,
  name: text,
  // COCO integer IDs are canonical decimal strings; folder/CSV uses null.
  sourceCategoryId: sourceId.nullable(),
});
const box = z.strictObject({
  classKey: text,
  bbox: z.tuple([finite.min(0), finite.min(0), finite.positive(), finite.positive()]),
  sourceAnnotationId: sourceId,
});
const annotation = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('classification'), classKey: text, sourceRow: integer.min(1).nullable() }),
  z.strictObject({ type: z.literal('detection'), sourceImageId: sourceId, boxes: z.array(box) }),
]);

// Only successfully hashed/decoded images belong here. A failed candidate must
// remain in issues with its path/item context, NOT invented hash/dimensions.
// bbox is original, unrounded xywh in pre-EXIF pixels; width/height use that same
// coordinate frame. No clamping, EXIF transform or source mutation here. These
// annotations are the import-unmodified baseline for later editing/provenance;
// source IDs/CSV row + the retained request locate the originals. No confirmed
// flag. null means no usable annotation; detection boxes: [] is distinct.
const image = z.strictObject({
  key: text,
  sourcePath: absolutePath,
  byteSize: integer.min(1).max(MAX_IMAGE_BYTES),
  // Signed canonical decimal, including pre-epoch times; never a JS number.
  mtimeNs: z.string().regex(/^(?:0|-?[1-9][0-9]*)(?![\s\S])/u),
  sha256: z.string().regex(/^[a-f0-9]{64}(?![\s\S])/u),
  format: z.enum(['jpeg', 'png', 'webp', 'bmp', 'tiff']),
  width: integer.min(1).max(MAX_IMAGE_PIXELS),
  height: integer.min(1).max(MAX_IMAGE_PIXELS),
  orientation: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6), z.literal(7), z.literal(8)]),
  duplicateOf: text.nullable(),
  annotation: annotation.nullable(),
}).refine((value) => value.width * value.height <= MAX_IMAGE_PIXELS);

const issue = z.strictObject({
  severity: z.enum(['error', 'warning']),
  code: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}(?![\s\S])/u),
  target: z.strictObject({
    imageKey: text.nullable(),
    // Diagnostic locator only: relative/invalid paths may explain a rejection.
    // This is local result data, never an I/O authority or a log message.
    sourcePath: text.nullable(),
    row: integer.min(1).nullable(),
    itemId: text.nullable(),
  }).refine((value) => Object.values(value).some((item) => item !== null)),
});
const contextFields = {
  // Same lower-before-validation rule as worker.ts, including UUID MAX.
  jobId: z.string().toLowerCase().pipe(jobIdSchema).refine((value) => value.length === 36),
  projectId: z.string().toLowerCase().pipe(projectIdSchema).refine((value) => value.length === 36),
  taskType: taskTypeSchema,
  mode,
};
const scanContextSchema = jsonObject.pipe(z.strictObject(contextFields));

export const scanResultSchema = jsonObject.pipe(z.strictObject({
  formatVersion: z.literal(1),
  ...contextFields,
  classes: z.array(scanClass),
  images: z.array(image).min(1).max(MAX_INPUT_ITEMS),
  issues: z.array(issue),
}).superRefine((value, ctx) => {
  const reject = () => ctx.addIssue({ code: 'custom', message: INVALID });
  const classes = new Map(value.classes.map((item) => [item.key, item]));
  const images = new Map(value.images.map((item) => [item.key, item]));
  if (classes.size !== value.classes.length || images.size !== value.images.length) reject();
  const categories = new Set<string>();
  for (const item of value.classes) {
    if ((value.taskType === 'classification') !== (item.sourceCategoryId === null)) reject();
    if (item.sourceCategoryId !== null) {
      if (categories.has(item.sourceCategoryId)) reject();
      categories.add(item.sourceCategoryId);
    }
  }
  const sourceImages = new Set<string>();
  const sourceAnnotations = new Set<string>();
  for (const item of value.images) {
    if (item.duplicateOf !== null) {
      const original = images.get(item.duplicateOf);
      // Reference a primary image, not a chain/cycle. Array order is irrelevant.
      if (original === undefined || original.key === item.key ||
        original.sha256 !== item.sha256 || original.duplicateOf !== null) reject();
    }
    const imported = item.annotation;
    if (imported === null) continue;
    if (imported.type !== value.taskType) reject();
    if (imported.type === 'classification') {
      if (!classes.has(imported.classKey)) reject();
    } else {
      if (sourceImages.has(imported.sourceImageId)) reject();
      sourceImages.add(imported.sourceImageId);
      for (const region of imported.boxes) {
        const [x, y, width, height] = region.bbox;
        if (!classes.has(region.classKey) || width > item.width - x || height > item.height - y ||
          x > item.width - width || y > item.height - height ||
          sourceAnnotations.has(region.sourceAnnotationId)) reject();
        sourceAnnotations.add(region.sourceAnnotationId);
      }
    }
  }
  for (const entry of value.issues) {
    const target = entry.target;
    if (target.imageKey === null) continue;
    const found = images.get(target.imageKey);
    if (found === undefined) {
      if (entry.severity !== 'error' || target.sourcePath === null) reject();
    } else if (target.sourcePath !== null && target.sourcePath !== found.sourcePath) reject();
  }
}));

export type ScanPayload = z.infer<typeof scanPayloadSchema>;
export type ScanSource = ScanPayload['source'];
export type SelectionManifest = z.infer<typeof selectionManifestSchema>;
export type ScanContext = z.infer<typeof scanContextSchema>;
export type ScanResult = z.infer<typeof scanResultSchema>;
export type ScanClass = ScanResult['classes'][number];
export type ScanImage = ScanResult['images'][number];
export type ScanAnnotation = z.infer<typeof annotation>;
export type ScanBox = z.infer<typeof box>;
export type ScanIssue = ScanResult['issues'][number];

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  try {
    return schema.parse(value);
  } catch {
    // Do not expose raw values, paths or untrusted field names in diagnostics.
    return invalid();
  }
}

export function parseScanPayload(value: unknown): ScanPayload {
  // Call on the payload of parseWorkerRequest; that codec rejects duplicate
  // members and enforces the existing 64 KiB envelope budget before this step.
  return parse(scanPayloadSchema, value);
}

export function parseSelectionManifest(value: unknown): SelectionManifest {
  return parse(selectionManifestSchema, value);
}

export function parseScanResult(value: unknown, expected?: ScanContext): ScanResult {
  const result = parse(scanResultSchema, value);
  if (expected !== undefined) {
    const context = parse(scanContextSchema, expected);
    if (result.jobId !== context.jobId || result.projectId !== context.projectId ||
      result.taskType !== context.taskType || result.mode !== context.mode) invalid();
  }
  return result;
}

function decode(input: string | Uint8Array, limit: number): unknown {
  try {
    if (typeof input !== 'string' && (!ArrayBuffer.isView(input) ||
      Object.prototype.toString.call(input) !== '[object Uint8Array]')) invalid();
    if (input.length > limit) invalid();
    const value = typeof input === 'string' ? input : new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(input);
    if (!scalarString(value) || new TextEncoder().encode(value).length > limit) invalid();
    // Detect duplicate DECODED keys before JSON.parse discards them, including
    // nested/escaped keys. Native JSON.parse still owns JSON grammar validation.
    const objects: Set<string>[] = [];
    let previous = '';
    for (const match of value.matchAll(/"(?:[^"\\]|\\[\s\S])*"|[{}\[\]:]/gu)) {
      const token = match[0];
      if (token === '{') objects.push(new Set());
      else if (token === '}') objects.pop();
      else if (token === ':') {
        const key: unknown = JSON.parse(previous);
        const keys = objects.at(-1);
        if (typeof key !== 'string' || keys === undefined || keys.has(key)) invalid();
        keys.add(key);
      }
      previous = token;
    }
    const parsed: unknown = JSON.parse(value);
    return parsed;
  } catch {
    return invalid();
  }
}

export function decodeSelectionManifest(input: string | Uint8Array): SelectionManifest {
  return parseSelectionManifest(decode(input, MAX_ANNOTATION_BYTES));
}

export function decodeScanResult(input: string | Uint8Array, expected: ScanContext): ScanResult {
  const context = parse(scanContextSchema, expected);
  return parseScanResult(decode(input, MAX_SCAN_RESULT_BYTES), context);
}

// Object parsers validate DTOs, not serialized byte counts. Decoders bound the
// supplied UTF-8 bytes. DAT-01b/08 must also bound actual reads/writes, preserve
// every failed candidate in issues and fail the command on zero valid images or
// source JSON/CSV parse failure. No I/O, image decode, CLI registration or IDs,
// timestamps, splits, seeds, human confirmation or success events are generated.