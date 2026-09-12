import { describe, expect, it } from 'vitest';

import {
  MAX_WORKER_MESSAGE_BYTES, encodeWorkerCancel, encodeWorkerEvent,
  encodeWorkerRequest, parseWorkerCancelLine, parseWorkerEventLine,
  parseWorkerRequest, workerCancelSchema, workerEventSchema, workerRequestSchema,
} from './worker.js';
import type { WorkerCorrelation } from './worker.js';

// Same fixed wire fixtures in ml/tests/test_protocol.py. No subprocess/runtime
// discovery here; JOB-04 must additionally test the real producer/consumer.
const jobId = 'ae45cf74-c9f9-4c49-88b9-0523b1ac7383';
const projectId = '01234567-89ab-4cde-8f01-23456789abcd';
const expected = { jobId, projectId };
const header = { schemaVersion: 1, ...expected };
const request = '{"schemaVersion":1,"jobId":"ae45cf74-c9f9-4c49-88b9-0523b1ac7383","projectId":"01234567-89ab-4cde-8f01-23456789abcd","kind":"scan-dataset","payload":{"label":"日本語🌱","items":[1,0.5,true,null]}}';
const progress = '{"schemaVersion":1,"jobId":"ae45cf74-c9f9-4c49-88b9-0523b1ac7383","projectId":"01234567-89ab-4cde-8f01-23456789abcd","type":"progress","source":"actual","processed":0,"total":null}\n';
const cancel = '{"schemaVersion":1,"jobId":"ae45cf74-c9f9-4c49-88b9-0523b1ac7383","projectId":"01234567-89ab-4cde-8f01-23456789abcd","type":"cancel"}\n';
const idFixtures = [
  ['upper-max', 'FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF', 'ffffffff-ffff-ffff-ffff-ffffffffffff'],
  ['mixed-max', 'FfFfFfFf-FfFf-FfFf-FfFf-FfFfFfFfFfFf', 'ffffffff-ffff-ffff-ffff-ffffffffffff'],
  ['nil', '00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000'],
  ['upper-regular', 'AE45CF74-C9F9-4C49-88B9-0523B1AC7383', jobId],
  ['mixed-regular', 'aE45Cf74-C9f9-4c49-88B9-0523B1Ac7383', jobId],
  ['lower-max', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'ffffffff-ffff-ffff-ffff-ffffffffffff'],
  ['lower-regular', jobId, jobId],
] as const;

describe('JOB-03 worker envelope', () => {
  it('round trips fixed Unicode request and correlated progress fixtures', () => {
    expect(encodeWorkerRequest(parseWorkerRequest(request))).toBe(request);
    expect(encodeWorkerEvent(parseWorkerEventLine(progress, expected))).toBe(progress);
    expect(parseWorkerEventLine(progress.replace('\n', '\r\n'), expected).type).toBe('progress');
    expect(parseWorkerRequest(new TextEncoder().encode(request))).toEqual(parseWorkerRequest(request));
  });
  it('decodes escaped surrogate pairs to scalar Unicode in payloads and manifests', () => {
    const escaped = request.replace('🌱', '\\ud83c\\udf31');
    for (const source of [escaped, new TextEncoder().encode(escaped)]) {
      expect(encodeWorkerRequest(parseWorkerRequest(source))).toBe(request);
    }
    const event = { ...header, type: 'completed', resultManifest: '🌱.json' };
    const canonical = JSON.stringify(event) + '\n';
    const parsed = parseWorkerEventLine(canonical.replace('🌱', '\\ud83c\\udf31'), expected);
    expect(parsed).toEqual(event);
    expect(encodeWorkerEvent(parsed)).toBe(canonical);
  });
  it.each(['scan-dataset', 'assist', 'train'])('accepts planned kind %s and normalizes UUIDs', (kind) => {
    const value = parseWorkerRequest(JSON.stringify({ ...header, jobId: jobId.toUpperCase(), kind, payload: {} }));
    expect(value.jobId).toBe(jobId);
    expect(value.kind).toBe(kind);
  });
  it.each(idFixtures)('normalizes %s UUIDs in messages and expected correlations', (_name, suppliedId, normalizedId) => {
    for (const field of ['jobId', 'projectId'] as const) {
      const supplied = { ...expected, [field]: suppliedId };
      const normalized = { ...expected, [field]: normalizedId };
      const value = { ...header, ...supplied, kind: 'train', payload: {} };
      const canonicalRequest = { ...value, ...normalized };
      expect(parseWorkerRequest(JSON.stringify(value))).toEqual(canonicalRequest);
      expect(encodeWorkerRequest(value)).toBe(JSON.stringify(canonicalRequest));
      const event = { ...header, ...supplied, type: 'started' };
      const canonicalEvent = { ...event, ...normalized };
      const eventLine = JSON.stringify(event) + '\n';
      const canonicalEventLine = JSON.stringify(canonicalEvent) + '\n';
      const control = { ...header, ...supplied, type: 'cancel' };
      const canonicalControl = { ...control, ...normalized };
      const controlLine = JSON.stringify(control) + '\n';
      const canonicalControlLine = JSON.stringify(canonicalControl) + '\n';
      expect(encodeWorkerEvent(event)).toBe(canonicalEventLine);
      expect(encodeWorkerCancel(control)).toBe(canonicalControlLine);
      for (const identity of [supplied, normalized]) {
        for (const line of [eventLine, canonicalEventLine]) {
          expect(parseWorkerEventLine(line, identity)).toEqual(canonicalEvent);
        }
        for (const line of [controlLine, canonicalControlLine]) {
          expect(parseWorkerCancelLine(line, identity)).toEqual(canonicalControl);
        }
      }
    }
  });
  it('rejects invalid UUIDs in both message IDs and expected correlations', () => {
    const invalidIds = [
      'not-a-uuid', 'ae45cf74-c9f9-0c49-88b9-0523b1ac7383',
      'ae45cf74-c9f9-4c49-78b9-0523b1ac7383', 'FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFE',
      '00000000-0000-0000-0000-000000000001', jobId + '\n', jobId + ' ', jobId.slice(0, -1),
    ];
    for (const invalidId of invalidIds) {
      for (const field of ['jobId', 'projectId'] as const) {
        const identity = { ...expected, [field]: invalidId };
        const value = { ...header, ...identity, kind: 'train', payload: {} };
        const event = { ...header, ...identity, type: 'started' };
        const control = { ...header, ...identity, type: 'cancel' };
        expect(() => parseWorkerRequest(JSON.stringify(value))).toThrow('Invalid worker protocol message');
        expect(() => encodeWorkerRequest(value)).toThrow('Invalid worker protocol message');
        expect(() => parseWorkerEventLine(JSON.stringify(event) + '\n', expected)).toThrow('Invalid worker protocol message');
        expect(() => encodeWorkerEvent(event)).toThrow('Invalid worker protocol message');
        expect(() => parseWorkerCancelLine(JSON.stringify(control) + '\n', expected)).toThrow('Invalid worker protocol message');
        expect(() => encodeWorkerCancel(control)).toThrow('Invalid worker protocol message');
        expect(() => parseWorkerEventLine(progress, identity)).toThrow('Invalid worker protocol message');
        expect(() => parseWorkerCancelLine(cancel, identity)).toThrow('Invalid worker protocol message');
      }
    }
  });
  it.each([
    { type: 'started' }, { type: 'warning', code: 'CANCELLED' },
    { type: 'completed', resultManifest: 'result.json' }, { type: 'failed', code: 'READ_FAILED' },
  ])('round trips exact event $type', (fields) => {
    const event = { ...header, ...fields };
    expect(parseWorkerEventLine(encodeWorkerEvent(event), expected)).toEqual(event);
    expect(() => encodeWorkerEvent({ ...event, extra: 1 })).toThrow('Invalid worker protocol message');
  });
  it('separates cancel input from output and checks both IDs', () => {
    const control = { ...header, type: 'cancel' };
    const line = encodeWorkerCancel(control);
    expect(parseWorkerCancelLine(line, expected)).toEqual(control);
    expect(() => parseWorkerEventLine(line, expected)).toThrow();
    for (const identity of [{ ...expected, jobId: projectId }, { ...expected, projectId: jobId }]) {
      expect(() => parseWorkerEventLine(progress, identity)).toThrow();
      expect(() => parseWorkerCancelLine(line, identity)).toThrow();
    }
  });
  it.each([
    [0, 0, true], [1, 2, true], [5, null, true], [1, 0, false],
    [-1, 2, false], [0.5, 2, false], [true, 2, false], [false, 2, false], [1, false, false],
    [1, Infinity, false], [NaN, null, false], [9007199254740992, null, false],
  ])('checks actual counts %j / %j', (processed, total, accepted) => {
    const encode = () => encodeWorkerEvent({ ...header, type: 'progress', source: 'actual', processed, total });
    if (accepted) expect(encode).not.toThrow();
    else expect(encode).toThrow();
  });
  it.each(['1.0', '1e0'])('normalizes integer protocol fields encoded as %s', (number) => {
    const numericRequest = request.replace('"schemaVersion":1', `"schemaVersion":${number}`);
    expect(encodeWorkerRequest(parseWorkerRequest(numericRequest))).toBe(request);
    const canonicalProgress = progress.replace('"processed":0,"total":null', '"processed":1,"total":1');
    const numericProgress = canonicalProgress
      .replace('"schemaVersion":1', `"schemaVersion":${number}`)
      .replace('"processed":1,"total":1', `"processed":${number},"total":${number}`);
    const event = parseWorkerEventLine(numericProgress, expected);
    expect(event).toEqual({ ...header, type: 'progress', source: 'actual', processed: 1, total: 1 });
    expect(encodeWorkerEvent(event)).toBe(canonicalProgress);
    const numericCancel = cancel.replace('"schemaVersion":1', `"schemaVersion":${number}`);
    expect(encodeWorkerCancel(parseWorkerCancelLine(numericCancel, expected))).toBe(cancel);
    // Payload numbers are compared semantically, not byte-for-byte across codecs.
    const numericPayload = request.replace('"items":[1,', `"items":[${number},`);
    const value = parseWorkerRequest(numericPayload);
    expect(value.payload).toEqual(parseWorkerRequest(request).payload);
    expect(parseWorkerRequest(encodeWorkerRequest(value))).toEqual(value);
  });
  it('keeps false as payload data but rejects it in protocol integer fields', () => {
    const falsePayload = request.replace('true', 'false');
    expect(encodeWorkerRequest(parseWorkerRequest(falsePayload))).toBe(falsePayload);
    expect(() => parseWorkerRequest(request.replace('"schemaVersion":1', '"schemaVersion":false'))).toThrow();
    expect(() => encodeWorkerRequest({ ...header, schemaVersion: false, kind: 'train', payload: {} })).toThrow();
    for (const line of [
      progress.replace('"schemaVersion":1', '"schemaVersion":false'),
      progress.replace('"processed":0', '"processed":false'),
      progress.replace('"total":null', '"total":false'),
    ]) {
      expect(() => parseWorkerEventLine(line, expected)).toThrow('Invalid worker protocol message');
    }
    expect(() => encodeWorkerEvent({ ...header, schemaVersion: false, type: 'started' })).toThrow();
    expect(() => parseWorkerCancelLine(cancel.replace('"schemaVersion":1', '"schemaVersion":false'), expected)).toThrow();
    expect(() => encodeWorkerCancel({ ...header, schemaVersion: false, type: 'cancel' })).toThrow();
  });
  it.each([
    '', '{}', '[]', request + '{}', '\ufeff' + request,
    request.replace('"schemaVersion":1', '"schemaVersion":true'),
    request.replace('"schemaVersion":1', '"schemaVersion":2'),
    request.replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'),
    request.replace('"label":', '"label":0,"\\u006cabel":'),
    request.replace('0.5', 'NaN'), request.replace('0.5', 'Infinity'),
    request.replace('0.5', '1e400'), request.replace('0.5', '9007199254740992'),
    request.replace('scan-dataset', 'health'), request.replace('日本語🌱', '\\ud800'),
  ])('rejects malformed/ambiguous JSON case %#', (source) => {
    expect(() => parseWorkerRequest(source)).toThrow('Invalid worker protocol message');
  });
  it('rejects unterminated, multiple, blank and malformed UTF-8 lines', () => {
    for (const line of [progress.trimEnd(), progress + progress, '\n', progress + '\n', new Uint8Array([0xff, 10])]) {
      expect(() => parseWorkerEventLine(line, expected)).toThrow('Invalid worker protocol message');
    }
  });
  it('rejects UTF-8 BOM bytes in requests, events and cancel controls', () => {
    expect(() => parseWorkerRequest(new TextEncoder().encode('\ufeff' + request))).toThrow('Invalid worker protocol message');
    expect(() => parseWorkerEventLine(new TextEncoder().encode('\ufeff' + progress), expected)).toThrow('Invalid worker protocol message');
    expect(() => parseWorkerCancelLine(new TextEncoder().encode('\ufeff' + cancel), expected)).toThrow('Invalid worker protocol message');
  });
  it('rejects non-byte views and array-like objects instead of trusting a type assertion', () => {
    for (const value of [new Uint16Array([123, 125]), new DataView(new ArrayBuffer(2)), { length: 2, 0: 123, 1: 125 }]) {
      expect(() => parseWorkerRequest(value as unknown as Uint8Array)).toThrow('Invalid worker protocol message');
    }
  });
  it.each([[64, true], [65, false]] as const)('bounds normal request nesting at depth %i', (depth, accepted) => {
    // The request envelope and payload object account for two container levels.
    let nested: unknown = 0;
    for (let index = 0; index < depth - 2; index += 1) nested = [nested];
    const value = { ...header, kind: 'train', payload: { nested } };
    const source = JSON.stringify(value);
    if (accepted) {
      expect(parseWorkerRequest(source)).toEqual(value);
      expect(encodeWorkerRequest(value)).toBe(source);
    } else {
      expect(() => parseWorkerRequest(source)).toThrow('Invalid worker protocol message');
      expect(() => encodeWorkerRequest(value)).toThrow('Invalid worker protocol message');
    }
  });
  it('bounds bytes and rejects invalid encoder values without diagnostics', () => {
    const base = { ...header, kind: 'train', payload: {} };
    for (const payload of [[], { value: undefined }, { value: Infinity }, { value: '\ud800' }]) {
      expect(() => encodeWorkerRequest({ ...base, payload })).toThrow();
    }
    const exact = request + ' '.repeat(MAX_WORKER_MESSAGE_BYTES - new TextEncoder().encode(request).length);
    expect(() => parseWorkerRequest(exact)).not.toThrow();
    expect(() => parseWorkerRequest(exact + ' ')).toThrow();
    expect(() => encodeWorkerEvent({ ...header, type: 'failed', code: 'C:\\private\\image.png' })).toThrow('Invalid worker protocol message');
    expect(() => encodeWorkerEvent({ ...header, type: 'progress', source: 'estimated', processed: 0, total: null })).toThrow();
  });
  it('adversarial fixed keys rejects own __proto__ at the request root', () => {
    const wire = '{"__proto__":null,' + request.slice(1);
    const candidate = JSON.parse(wire);
    expect(Object.hasOwn(candidate, '__proto__')).toBe(true);
    expect(candidate['__proto__']).toBeNull();
    expect.soft(workerRequestSchema.safeParse(candidate).success).toBe(false);
    expect.soft(() => encodeWorkerRequest(candidate)).toThrow('Invalid worker protocol message');
    for (const input of [wire, new TextEncoder().encode(wire)]) {
      expect.soft(() => parseWorkerRequest(input)).toThrow('Invalid worker protocol message');
    }
  });
  it('adversarial fixed keys rejects own __proto__ at event roots', () => {
    const events = [
      JSON.stringify({ ...header, type: 'started' }), progress.trimEnd(),
      JSON.stringify({ ...header, type: 'warning', code: 'CANCELLED' }),
      JSON.stringify({ ...header, type: 'completed', resultManifest: 'result.json' }),
      JSON.stringify({ ...header, type: 'failed', code: 'READ_FAILED' }),
    ];
    for (const original of events) {
      expect(workerEventSchema.safeParse(JSON.parse(original)).success).toBe(true);
      const wire = '{"__proto__":null,' + original.slice(1) + '\n';
      const candidate = JSON.parse(wire);
      expect(Object.hasOwn(candidate, '__proto__'), candidate.type).toBe(true);
      expect(candidate['__proto__'], candidate.type).toBeNull();
      expect.soft(workerEventSchema.safeParse(candidate).success, candidate.type).toBe(false);
      expect.soft(() => encodeWorkerEvent(candidate), candidate.type).toThrow('Invalid worker protocol message');
      for (const input of [wire, new TextEncoder().encode(wire)]) {
        expect.soft(() => parseWorkerEventLine(input, expected), candidate.type).toThrow('Invalid worker protocol message');
      }
    }
  });
  it('adversarial fixed keys rejects own __proto__ at the cancel root', () => {
    const wire = '{"__proto__":null,' + cancel.slice(1);
    const candidate = JSON.parse(wire);
    expect(Object.hasOwn(candidate, '__proto__')).toBe(true);
    expect(candidate['__proto__']).toBeNull();
    expect.soft(workerCancelSchema.safeParse(candidate).success).toBe(false);
    expect.soft(() => encodeWorkerCancel(candidate)).toThrow('Invalid worker protocol message');
    for (const input of [wire, new TextEncoder().encode(wire)]) {
      expect.soft(() => parseWorkerCancelLine(input, expected)).toThrow('Invalid worker protocol message');
    }
  });
  it('adversarial fixed keys rejects own __proto__ in expected correlations', () => {
    const identity = JSON.parse('{"__proto__":null,' + JSON.stringify(expected).slice(1));
    expect(Object.hasOwn(identity, '__proto__')).toBe(true);
    expect(identity['__proto__']).toBeNull();
    // The correlation schema is private; exercise it through both public parsers.
    for (const input of [progress, new TextEncoder().encode(progress)]) {
      expect.soft(() => parseWorkerEventLine(input, identity as WorkerCorrelation)).toThrow('Invalid worker protocol message');
    }
    for (const input of [cancel, new TextEncoder().encode(cancel)]) {
      expect.soft(() => parseWorkerCancelLine(input, identity as WorkerCorrelation)).toThrow('Invalid worker protocol message');
    }
  });
  it('adversarial fixed keys preserves own __proto__ and all JSON values inside free payloads', () => {
    const values = [
      'null', 'false', 'true', '0', '0.5', '"__proto__"',
      '["日本語🌱",1,false,null]', '{"label":"日本語🌱","count":2}',
    ];
    for (const json of values) {
      // Free JSON remains distinct from the fixed envelope and import DTOs.
      const payload = JSON.parse(`{"__proto__":${json},"nested":{"__proto__":${json}},"items":[{"__proto__":${json}}]}`);
      for (const target of [payload, payload.nested, payload.items[0]]) {
        expect(Object.hasOwn(target, '__proto__'), json).toBe(true);
        expect(target['__proto__'], json).toEqual(JSON.parse(json));
      }
      const value = { ...JSON.parse(request), payload };
      const wire = JSON.stringify(value);
      const validated = workerRequestSchema.safeParse(value);
      expect(validated, json).toEqual({ success: true, data: value });
      // Comparing serialized schema output also detects a silently dropped own key.
      expect(JSON.stringify(validated), json).toBe(JSON.stringify({ success: true, data: value }));
      expect(encodeWorkerRequest(value), json).toBe(wire);
      for (const input of [wire, new TextEncoder().encode(wire), encodeWorkerRequest(value)]) {
        expect(JSON.stringify(parseWorkerRequest(input)), json).toBe(wire);
      }
    }
  });
});