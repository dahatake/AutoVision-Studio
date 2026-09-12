// @vitest-environment node
import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import { DIAGNOSTIC_EXPORT_CHANNEL, diagnosticExportResultSchema, type DiagnosticExportResult } from './diagnostic-export.js';

const saved = { status: 'saved', path: 'C:\\Users\\利用者\\AppData\\logs\\diagnostics-test.txt', byteLength: 880, sha256: 'a'.repeat(64) };
const cancelled = { status: 'cancelled' };
const failed = { status: 'failed', code: 'DIAGNOSTIC_EXPORT_FAILED' };

describe('diagnostic export response contract (SEC-07C1)', () => {
  it.each([saved, cancelled, failed, { ...failed, code: 'DIAGNOSTIC_EXPORT_BUSY' }])('preserves only the exact readonly variant %#', (value) => {
    const result = diagnosticExportResultSchema.parse(value);
    expect(result).toEqual(value); expect(result).not.toBe(value); expect(Object.isFrozen(result)).toBe(true);
    expect(Reflect.set(result, 'status', 'bad')).toBe(false);
    expectTypeOf(result).toEqualTypeOf<DiagnosticExportResult>();
    expect(DIAGNOSTIC_EXPORT_CHANNEL).toBe('diagnostics:export');
  });

  it.each(['path', 'byteLength', 'sha256'])('requires saved %s rather than defaulting it', (key) => {
    const value: Record<string, unknown> = { ...saved }; delete value[key];
    expect(diagnosticExportResultSchema.safeParse(value).success).toBe(false);
  });

  it.each([0, -1, 0.5, NaN, Infinity, 8193, '880', null])('rejects invalid saved bytes %j', (byteLength) => {
    expect(diagnosticExportResultSchema.safeParse({ ...saved, byteLength }).success).toBe(false);
  });

  it.each(['', 'A'.repeat(64), 'g'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), `${'a'.repeat(64)}\n`, null])('rejects invalid saved hash %#', (sha256) => {
    expect(diagnosticExportResultSchema.safeParse({ ...saved, sha256 }).success).toBe(false);
  });

  it.each(['', 'relative', 'C:relative', '\\\\server\\share\\diagnostics.txt', 'C:\\logs\\file\0', 'C:/logs/file\n', 'C:/'.padEnd(32768, 'x'), null])(
    'rejects malformed or nonlocal display path %#', (path) => {
      expect(diagnosticExportResultSchema.safeParse({ ...saved, path }).success).toBe(false);
    },
  );

  it.each(['message', 'stack', 'cause', 'report', 'image', 'executablePath', '__proto__', 'constructor'])('rejects extra field %s before Zod can strip it', (key) => {
    for (const source of [saved, cancelled, failed]) {
      const value = { ...source }; Object.defineProperty(value, key, { value: 'PRIVATE', enumerable: true });
      expect(diagnosticExportResultSchema.safeParse(value).success).toBe(false);
    }
  });

  it('rejects accessor and symbol properties without reading their values', () => {
    const read = vi.fn(() => { throw new Error('PRIVATE'); });
    for (const key of Object.keys(saved)) {
      const value = { ...saved }; Object.defineProperty(value, key, { get: read });
      expect(diagnosticExportResultSchema.safeParse(value).success).toBe(false);
    }
    expect(diagnosticExportResultSchema.safeParse({ ...cancelled, [Symbol('hidden')]: 'PRIVATE' }).success).toBe(false);
    expect(read).not.toHaveBeenCalled();
  });

  it.each([null, undefined, [], 'saved', {}, { status: 'saved' }, { status: 'failed' }, { status: 'failed', code: 'ENOENT' },
    { status: 'cancelled', path: saved.path }, { ...saved, code: failed.code }])('refuses incomplete or mixed results %#', (value) => {
    expect(diagnosticExportResultSchema.safeParse(value).success).toBe(false);
  });
});