import { z } from 'zod';

import { jobIdSchema, jobKindSchema } from './job.js';
import { projectIdSchema } from './project.js';

// JOB-03: plan §3.3 / §7 and ADR-0001 §2.4–2.6. Foundation for
// FR-TRN-001/002, 010–014, not evidence of queueing or execution.
// Fixed transport limits, not user options. Bytes include the NDJSON terminator.
export const WORKER_SCHEMA_VERSION = 1;
export const MAX_WORKER_MESSAGE_BYTES = 65_536;
const MAX_JSON_DEPTH = 64;
const INVALID_MESSAGE = 'Invalid worker protocol message';

export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
export type JsonObject = { [key: string]: JsonValue };

function validString(value: string): boolean {
  return !/[\uD800-\uDFFF]/u.test(value);
}

function isJsonValue(value: unknown, depth = 0): value is JsonValue {
  if (depth > MAX_JSON_DEPTH) return false;
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'string') return validString(value);
  if (typeof value === 'number') {
    return Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER;
  }
  if (typeof value !== 'object') return false;
  if (Array.isArray(value)) {
    if (Reflect.ownKeys(value).length !== value.length + 1) return false;
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || !('value' in descriptor) ||
        !isJsonValue(descriptor.value, depth + 1)) return false;
    }
    return true;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Reflect.ownKeys(value).every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return typeof key === 'string' && validString(key) &&
      descriptor !== undefined && descriptor.enumerable === true &&
      'value' in descriptor && isJsonValue(descriptor.value, depth + 1);
  });
}

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' &&
    !Array.isArray(value) && isJsonValue(value);
}

// Fixed envelope fields must not be silently dropped by Zod. This guard is
// root-only: arbitrary JSON keys inside the command-owned payload stay valid.
const fixedEnvelope = z.custom<JsonObject>((value) =>
  isJsonObject(value) && !Object.hasOwn(value, '__proto__'));

// Normalize before UUID validation so the MAX sentinel is also case-insensitive.
const correlation = {
  jobId: z.string().toLowerCase().pipe(jobIdSchema).refine((id) => id.length === 36),
  projectId: z.string().toLowerCase().pipe(projectIdSchema).refine((id) => id.length === 36),
};
const header = { schemaVersion: z.literal(WORKER_SCHEMA_VERSION), ...correlation };
const correlationSchema = fixedEnvelope.pipe(z.strictObject(correlation));
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const code = z.string().regex(/^[A-Z][A-Z0-9_]{0,63}(?![\s\S])/u);

// Only the JSON object envelope is checked here. DAT-01 / AST-04 / TRN-14
// MUST validate payload for the selected kind before dispatch. No hidden options.
export const workerRequestSchema = fixedEnvelope.pipe(z.strictObject({
  ...header,
  kind: jobKindSchema,
  payload: z.custom<JsonObject>(isJsonObject),
}));

export const workerEventSchema = fixedEnvelope.pipe(z.discriminatedUnion('type', [
  z.strictObject({ ...header, type: z.literal('started') }),
  z.strictObject({
    ...header,
    type: z.literal('progress'),
    source: z.literal('actual'),
    processed: count,
    // null means unknown; 0 means a known empty workload, never an estimate.
    total: count.nullable(),
  }).refine((event) => event.total === null || event.processed <= event.total),
  z.strictObject({ ...header, type: z.literal('warning'), code }),
  z.strictObject({
    ...header,
    type: z.literal('completed'),
    // Untrusted locator, NOT permission. JOB-04 must validate job containment,
    // links, manifest contents and hashes before reading/committing artifacts.
    resultManifest: z.string().min(1).refine(validString),
  }),
  z.strictObject({ ...header, type: z.literal('failed'), code }),
]));

// Input control, not a stdout event. Cancellation acknowledgement/state and
// grace/kill belong to JOB-04/05. No invented cancelled event or fake success.
export const workerCancelSchema = fixedEnvelope.pipe(z.strictObject({ ...header, type: z.literal('cancel') }));
export type WorkerRequest = z.infer<typeof workerRequestSchema>;
export type WorkerEvent = z.infer<typeof workerEventSchema>;
export type WorkerCancel = z.infer<typeof workerCancelSchema>;
export type WorkerCorrelation = z.infer<typeof correlationSchema>;

function invalid(): never {
  throw new Error(INVALID_MESSAGE);
}

function textFrom(input: string | Uint8Array): string {
  // TextEncoder/IPC may originate in another realm; instanceof alone rejects
  // genuine byte arrays there. Do not accept arbitrary array-like objects.
  if (typeof input !== 'string' && (!ArrayBuffer.isView(input)
    || Object.prototype.toString.call(input) !== '[object Uint8Array]')) invalid();
  if (input.length > MAX_WORKER_MESSAGE_BYTES) invalid();
  const text = typeof input === 'string'
    ? input
    : new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(input);
  if (!validString(text) || new TextEncoder().encode(text).length > MAX_WORKER_MESSAGE_BYTES) invalid();
  return text;
}

function decode(input: string | Uint8Array, line: boolean): unknown {
  const text = textFrom(input);
  if (line && (!text.endsWith('\n') || /[\r\n]/u.test(text.replace(/\r?\n$/u, '')))) invalid();
  // Token scan only checks duplicate decoded keys and bounds nesting. Native
  // JSON.parse remains the grammar parser; strings cannot inject delimiters.
  const objects: Set<string>[] = [];
  let depth = 0;
  let previous = '';
  for (const match of text.matchAll(/"(?:[^"\\]|\\[\s\S])*"|[{}\[\]:]/gu)) {
    const token = match[0];
    if (token === '{' || token === '[') {
      depth += 1;
      if (depth > MAX_JSON_DEPTH) invalid();
      if (token === '{') objects.push(new Set());
    } else if (token === '}' || token === ']') {
      depth -= 1;
      if (token === '}') objects.pop();
    } else if (token === ':') {
      const key: unknown = JSON.parse(previous);
      const keys = objects.at(-1);
      if (typeof key !== 'string' || keys === undefined || keys.has(key)) invalid();
      keys.add(key);
    }
    previous = token;
  }
  const value: unknown = JSON.parse(text);
  if (!isJsonValue(value)) invalid();
  return value;
}

function parse<T>(schema: z.ZodType<T>, input: string | Uint8Array, line: boolean): T {
  try {
    return schema.parse(decode(input, line));
  } catch {
    return invalid();
  }
}

function encode<T>(schema: z.ZodType<T>, value: unknown, line: boolean): string {
  try {
    if (!isJsonValue(value)) invalid();
    const text = JSON.stringify(schema.parse(value)) + (line ? '\n' : '');
    // Apply identical size/depth/Unicode rules to both directions.
    decode(text, line);
    return text;
  } catch {
    return invalid();
  }
}

function correlate<T extends WorkerCorrelation>(value: T, expected: WorkerCorrelation): T {
  const parsed = correlationSchema.safeParse(expected);
  if (!parsed.success || value.jobId !== parsed.data.jobId ||
    value.projectId !== parsed.data.projectId) invalid();
  return value;
}

export function parseWorkerRequest(input: string | Uint8Array): WorkerRequest {
  return parse(workerRequestSchema, input, false);
}

export function encodeWorkerRequest(value: unknown): string {
  return encode(workerRequestSchema, value, false);
}

export function parseWorkerEventLine(input: string | Uint8Array, expected: WorkerCorrelation): WorkerEvent {
  return correlate(parse(workerEventSchema, input, true), expected);
}

export function encodeWorkerEvent(value: unknown): string {
  return encode(workerEventSchema, value, true);
}

export function parseWorkerCancelLine(input: string | Uint8Array, expected: WorkerCorrelation): WorkerCancel {
  return correlate(parse(workerCancelSchema, input, true), expected);
}

export function encodeWorkerCancel(value: unknown): string {
  return encode(workerCancelSchema, value, true);
}

// JOB-04 must also cap its pending byte buffer before receiving a full line.
// Stateless codecs only: no I/O, process launch, clock, sequence assertion or
// CLI registration. SPI-02 mode/short IDs/completed counter are NOT compatible.