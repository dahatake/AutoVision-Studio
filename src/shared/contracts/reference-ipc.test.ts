import { describe, expect, it } from 'vitest';

import * as ref from './reference-ipc.js';

const projectId = '2f1b2c8e-0c3f-4a1e-9e2f-4b8f6a1d2c3e';
const importId = '9a3c7d51-6b21-4f0e-8c7a-1d2e3f4a5b6c';

describe('Reference IPC fixed surface and inputs', () => {
  it('exposes exactly two literal channels and a two-method API', () => {
    expect(ref.REFERENCE_STATUS_CHANNEL).toBe('reference:status');
    expect(ref.REFERENCE_RELINK_CHANNEL).toBe('reference:relink');
    const keys: Array<keyof ref.ReferenceApi> = ['status', 'relink'];
    expect(keys).toEqual(['status', 'relink']);
  });

  it('accepts only a Project ID for status and rejects any extra key or path', () => {
    expect(ref.referenceStatusInputSchema.parse({ projectId })).toEqual({ projectId });
    for (const value of [
      undefined, null, {}, [], 'C:\\data',
      { projectId, path: 'C:\\data' },
      { projectId, channel: 'reference:relink' },
      { projectId: 'not-a-uuid' },
    ]) {
      expect(ref.referenceStatusInputSchema.safeParse(value).success).toBe(false);
    }
  });

  it('accepts only a saved imageKey for relink and never a filesystem path field', () => {
    const input = { projectId, importId, imageKey: 'image:0' };
    expect(ref.referenceRelinkInputSchema.parse(input)).toEqual(input);
    for (const value of [
      { ...input, candidatePath: 'C:\\replacement.png' },
      { ...input, imageKey: '' },
      { ...input, imageKey: 'a'.repeat(1025) },
      { ...input, imageKey: 'bad\u0000key' },
      { projectId, importId },
      { projectId, imageKey: 'image:0' },
    ]) {
      expect(ref.referenceRelinkInputSchema.safeParse(value).success).toBe(false);
    }
  });

  it('covers every relink reason the Main verifier can report', () => {
    for (const reason of ['missing', 'inaccessible', 'unsafe', 'read-failed', 'changed',
      'identity-changed', 'size-changed', 'mtime-changed', 'hash-changed']) {
      expect(ref.referenceRelinkReasonSchema.safeParse(reason).success).toBe(true);
    }
    expect(ref.referenceRelinkReasonSchema.safeParse('unknown').success).toBe(false);
  });

  it('rejects a status response whose Project does not match the request', () => {
    const value = { projectId, inspectedImports: 1, checked: 2, broken: [] };
    expect(ref.parseReferenceStatusResponse({ ok: true, value }, { projectId }).ok).toBe(true);
    expect(() => ref.parseReferenceStatusResponse(
      { ok: true, value: { ...value, projectId: importId } }, { projectId },
    )).toThrow();
  });

  it('rejects a relink response that claims a different import or imageKey', () => {
    const input = { projectId, importId, imageKey: 'image:0' } as const;
    expect(ref.parseReferenceRelinkResponse(
      { ok: true, value: { status: 'relinked', importId, imageKey: 'image:0' } }, input,
    ).ok).toBe(true);
    expect(ref.parseReferenceRelinkResponse({ ok: true, value: { status: 'cancelled' } }, input).ok).toBe(true);
    expect(() => ref.parseReferenceRelinkResponse(
      { ok: true, value: { status: 'relinked', importId, imageKey: 'image:1' } }, input,
    )).toThrow();
    expect(() => ref.parseReferenceRelinkResponse(
      { ok: true, value: { status: 'relinked', importId: projectId, imageKey: 'image:0' } }, input,
    )).toThrow();
  });

  it('accepts only the five declared error codes', () => {
    for (const code of ['INVALID_REQUEST', 'NOT_FOUND', 'MISMATCH', 'BUSY', 'OPERATION_FAILED']) {
      expect(ref.referenceStatusResponseSchema.safeParse({ ok: false, error: { code } }).success).toBe(true);
    }
    for (const code of ['UNKNOWN', '', 'STALE_SELECTION']) {
      expect(ref.referenceStatusResponseSchema.safeParse({ ok: false, error: { code } }).success).toBe(false);
    }
    expect(ref.referenceStatusResponseSchema.safeParse(
      { ok: false, error: { code: 'NOT_FOUND', message: 'C:\\secret.png' } },
    ).success).toBe(false);
  });
});
