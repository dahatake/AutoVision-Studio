// @vitest-environment node
import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import type { ScanClass, ScanResult } from './import.js';
import {
  IMPORT_START_CHANNEL, IMPORT_PREVIEW_CHANNEL, IMPORT_COMMIT_CHANNEL, IMPORT_DISCARD_CHANNEL,
  importStartInputSchema, importPreviewInputSchema, importCommitInputSchema, importDiscardInputSchema,
  importStartResponseSchema, importPreviewSchema, importResultSchema, importIpcErrorCodeSchema,
  importStartValueSchema, importPreviewResponseSchema, importCommitResponseSchema, importDiscardResponseSchema,
  parseImportStartResponse, parseImportPreview, parseImportResult, parseImportPreviewResponse,
  parseImportCommitResponse, parseImportDiscardResponse,
  type ImportApi, type ImportStartInput, type ImportStartResponse, type ImportPreview,
  type ImportCommitInput, type ImportCommitResponse,
} from './import-ipc.js';

const projectId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const jobId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const token = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const importId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const selection = { projectId, jobId, token };
const start = { projectId, mode: 'reference', sourceKind: 'folder' } as const;
const commit = { ...selection, rightsAccepted: true } as const;
const job = { id: jobId, projectId, kind: 'scan-dataset', status: 'Running',
  createdAt: '2026-09-13T00:00:00.000Z', updatedAt: '2026-09-13T00:00:00.000Z' } as const;
const started = { status: 'started', token, job } as const;
const preview = { projectId, jobId, taskType: 'classification', mode: 'reference', itemCount: 1,
  sourceBytes: '900719925474099312345', classes: [{ key: '犬', name: ' 犬🐕 ', sourceCategoryId: null }],
  files: [{ key: 'image:犬/1', displayName: '犬 🐕.png' }],
  issues: [{ severity: 'warning', code: 'DUPLICATE', imageKey: 'image:犬/1', row: 1, itemId: null }],
} as const;
const completed = { status: 'completed', projectId, importId, workspaceId: importId, itemCount: 1, cleanupWarning: true } as const;

function frozen(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) frozen(child);
}

describe('DAT-08 shared import IPC contract', () => {
  it('exports four fixed object-only operations, without events or worker launch authority', () => {
    expect([IMPORT_START_CHANNEL, IMPORT_PREVIEW_CHANNEL, IMPORT_COMMIT_CHANNEL, IMPORT_DISCARD_CHANNEL])
      .toEqual(['import:start', 'import:preview', 'import:commit', 'import:discard']);
    expectTypeOf<keyof ImportApi>().toEqualTypeOf<'start' | 'preview' | 'commit' | 'discard'>();
    expectTypeOf<ImportApi['start']>().toEqualTypeOf<(input: ImportStartInput) => Promise<ImportStartResponse>>();
    expectTypeOf<ImportApi['commit']>().toEqualTypeOf<(input: ImportCommitInput) => Promise<ImportCommitResponse>>();
    expectTypeOf<ImportPreview['classes'][number]>().toEqualTypeOf<Readonly<ScanClass>>();
    expectTypeOf<ImportPreview['taskType']>().toEqualTypeOf<ScanResult['taskType']>();
    for (const sourceKind of ['folder', 'csv', 'coco', 'unlabeled-directory', 'unlabeled-files']) {
      expect(importStartInputSchema.parse({ ...start, sourceKind }).sourceKind).toBe(sourceKind);
    }
    expect(importStartInputSchema.safeParse({ ...start, sourceKind: 'unlabeled' }).success).toBe(false);
    expect(importStartInputSchema.parse({ ...start, projectId: projectId.toUpperCase() }).projectId).toBe(projectId);
    expect(importStartInputSchema.parse({ ...start, mode: 'copy' }).mode).toBe('copy');
    expect(importStartInputSchema.safeParse({ ...start, mode: 'auto' }).success).toBe(false);
  });

  it('rejects extra authority fields, absent/false consent and invalid selection IDs', () => {
    for (const field of ['path', 'root', 'files', 'annotationPath', 'source', 'taskType', 'fallback', 'channel']) {
      expect(importStartInputSchema.safeParse({ ...start, [field]: 'C:\\private\\source' }).success).toBe(false);
    }
    for (const rightsAccepted of [undefined, false, 0, 'true', null]) {
      expect(importCommitInputSchema.safeParse({ ...selection, rightsAccepted }).success).toBe(false);
    }
    expect(importCommitInputSchema.safeParse(selection).success).toBe(false);
    expect(importCommitInputSchema.safeParse({ ...commit, mode: 'copy' }).success).toBe(false);
    for (const schema of [importPreviewInputSchema, importDiscardInputSchema]) {
      expect(schema.parse(selection)).toEqual(selection);
      for (const field of ['projectId', 'jobId', 'token']) {
        expect(schema.safeParse({ ...selection, [field]: 'bad' }).success).toBe(false);
        const missing: Record<string, unknown> = { ...selection }; delete missing[field];
        expect(schema.safeParse(missing).success).toBe(false);
      }
      expect(schema.safeParse({ ...selection, extra: true }).success).toBe(false);
    }
  });

  it('matches actual scan keys and Unicode basenames, preserving decimal bytes literally', () => {
    expect(importPreviewSchema.parse(preview)).toEqual(preview);
    for (const sourceBytes of ['0', '123', '900719925474099312345']) {
      expect(importPreviewSchema.parse({ ...preview, sourceBytes }).sourceBytes).toBe(sourceBytes);
    }
    for (const sourceBytes of [0, -1, '', '01', '+1', '-0', '1.0', '1e3', '1\n']) {
      expect(importPreviewSchema.safeParse({ ...preview, sourceBytes }).success).toBe(false);
    }
    for (const displayName of ['C:\\private\\a.png', '../a.png', 'a/b.png', 'a\\b.png', '.', '..', 'a\0.png', 'a:stream']) {
      expect(importPreviewSchema.safeParse({ ...preview, files: [{ ...preview.files[0], displayName }] }).success).toBe(false);
    }
    for (const key of ['__proto__', 'constructor', 'prototype', 'image/key:実際']) {
      expect(importPreviewSchema.safeParse({ ...preview, files: [{ key, displayName: '画像.png' }], issues: [] }).success).toBe(true);
    }
    expect(importPreviewSchema.safeParse({ ...preview, files: [{ key: 'a\0b', displayName: 'a.png' }] }).success).toBe(false);
  });

  it('rejects zero/invalid counts, duplicates, category mismatches and unsafe nested extras', () => {
    for (const itemCount of [0, -1, 1.5, 100001, NaN, Infinity, 2]) {
      expect(importPreviewSchema.safeParse({ ...preview, itemCount }).success).toBe(false);
    }
    for (const invalid of [
      { ...preview, itemCount: 2, files: [preview.files[0], preview.files[0]] },
      { ...preview, classes: [preview.classes[0], preview.classes[0]] },
      { ...preview, taskType: 'detection' },
      { ...preview, classes: [{ ...preview.classes[0], sourceCategoryId: '1' }] },
      { ...preview, classes: [{ ...preview.classes[0], sourcePath: 'PRIVATE' }] },
      { ...preview, files: [{ ...preview.files[0], sourcePath: 'PRIVATE' }] },
      { ...preview, issues: [{ ...preview.issues[0], sourcePath: 'PRIVATE' }] },
      { ...preview, issues: [{ ...preview.issues[0], imageKey: 'missing' }] },
      { ...preview, issues: [{ ...preview.issues[0], imageKey: 'bad\0key' }] },
    ]) expect(importPreviewSchema.safeParse(invalid).success).toBe(false);
    expect(importPreviewSchema.safeParse({ ...preview, taskType: 'detection', classes: [
      { key: '1', name: '犬', sourceCategoryId: '1' },
    ] }).success).toBe(true);
    expect(importPreviewSchema.safeParse({ ...preview, taskType: 'detection', classes: [
      { key: '1', name: '犬', sourceCategoryId: '1' }, { key: '2', name: '猫', sourceCategoryId: '1' },
    ] }).success).toBe(false);
    expect(importPreviewSchema.safeParse({ ...preview, issues: [{ ...preview.issues[0], severity: 'error', imageKey: 'failed-candidate' }] }).success).toBe(true);
    expect(importPreviewSchema.safeParse({ ...preview, issues: [{ ...preview.issues[0], imageKey: null, row: null, itemId: null }] }).success).toBe(true);
  });

  it('checks request correlations as well as workspace equality, without inventing response echoes', () => {
    expect(parseImportStartResponse({ ok: true, value: started }, start).ok).toBe(true);
    expect(importStartResponseSchema.parse({ ok: true, value: { status: 'cancelled' } }).ok).toBe(true);
    expect(importStartValueSchema.safeParse({ ...started, job: { ...job, kind: 'train' } }).success).toBe(false);
    expect(() => parseImportStartResponse({ ok: true, value: started }, { ...start, projectId: token })).toThrow('Invalid import correlation');
    expect(parseImportPreview(preview, selection)).toEqual(preview);
    expect(parseImportResult(completed, commit)).toEqual(completed);
    expect(parseImportPreviewResponse({ ok: true, value: preview }, selection).ok).toBe(true);
    expect(parseImportCommitResponse({ ok: true, value: completed }, commit).ok).toBe(true);
    for (const expected of [{ ...selection, projectId: token }, { ...selection, jobId: token }]) {
      expect(() => parseImportPreview(preview, expected)).toThrow('Invalid import correlation');
      expect(() => parseImportPreviewResponse({ ok: true, value: preview }, expected)).toThrow('Invalid import correlation');
    }
    expect(() => parseImportResult(completed, { ...commit, projectId: token })).toThrow('Invalid import correlation');
    expect(() => parseImportCommitResponse({ ok: true, value: completed }, { ...commit, projectId: token })).toThrow('Invalid import correlation');
    expect(importResultSchema.safeParse({ ...completed, workspaceId: token }).success).toBe(false);
    expect(parseImportDiscardResponse({ ok: true, value: null }, selection)).toEqual({ ok: true, value: null });
    expect(importDiscardResponseSchema.safeParse({ ok: true, value: {} }).success).toBe(false);
  });

  it('allows only code failures and optional strict decimal capacity for IMPORT_CAPACITY', () => {
    const schemas = [importStartResponseSchema, importPreviewResponseSchema, importCommitResponseSchema, importDiscardResponseSchema];
    for (const schema of schemas) {
      for (const code of importIpcErrorCodeSchema.options) expect(schema.safeParse({ ok: false, error: { code } }).success).toBe(true);
      for (const error of [
        { code: 'UNKNOWN' }, { code: 'OPERATION_FAILED', capacity: { requiredBytes: '1', availableBytes: '0' } },
        { code: 'IMPORT_CAPACITY', capacity: { requiredBytes: '1', availableBytes: 0 } },
        { code: 'IMPORT_CAPACITY', capacity: { requiredBytes: '01', availableBytes: '0' } },
        { code: 'IMPORT_CAPACITY', capacity: { requiredBytes: '1' } },
        { code: 'IMPORT_CAPACITY', capacity: { requiredBytes: '1', availableBytes: '0', path: 'PRIVATE' } },
        ...['message', 'path', 'cause', 'retry', 'stack'].map((key) => ({ code: 'OPERATION_FAILED', [key]: true })),
      ]) expect(schema.safeParse({ ok: false, error }).success).toBe(false);
      const result = schema.parse({ ok: false, error: { code: 'IMPORT_CAPACITY', capacity: { requiredBytes: '900719925474099312345', availableBytes: '0' } } });
      frozen(result);
      expect(schema.safeParse({ ok: false, error: { code: 'IMPORT_INPUT' }, extra: true }).success).toBe(false);
    }
  });

  it('preserves special class mapping keys without freezing/mutating caller objects', () => {
    const names: Record<string, string> = Object.create(null) as Record<string, string>;
    for (const key of ['__proto__', 'constructor', 'prototype', '犬']) Object.defineProperty(names, key, { value: key, enumerable: true, writable: true });
    const input = { ...commit, classNames: names };
    const parsed = importCommitInputSchema.parse(input);
    expect(Object.keys(parsed.classNames!)).toEqual(Object.keys(names));
    expect(Object.getPrototypeOf(parsed.classNames)).toBeNull();
    expect(parsed.classNames!['__proto__']).toBe('__proto__');
    expect(parsed.classNames).not.toBe(names); frozen(parsed);
    expect(Object.isFrozen(input)).toBe(false); expect(Object.isFrozen(names)).toBe(false);
    names['犬'] = 'changed'; expect(parsed.classNames!['犬']).toBe('犬');
    expect(importCommitInputSchema.safeParse({ ...commit, classNames: { dog: 1 } }).success).toBe(false);
    expect(importCommitInputSchema.safeParse({ ...commit, classNames: { dog: '\ud800' } }).success).toBe(false);
    for (const value of [preview, completed, started]) {
      const schema = value === preview ? importPreviewSchema : value === completed ? importResultSchema : importStartValueSchema;
      const result = schema.parse(value); frozen(result); expect(Object.isFrozen(value)).toBe(false);
    }
    frozen(importPreviewResponseSchema.parse({ ok: true, value: preview }));
  });

  it('rejects getters/toJSON/cycles/sparse arrays/hidden fields without executing user code', () => {
    const getter = vi.fn(() => projectId), toJSON = vi.fn(() => start);
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    const revoked = Proxy.revocable({}, {}); revoked.revoke();
    for (const input of [
      Object.defineProperty({ ...start }, 'projectId', { get: getter, enumerable: true }),
      { ...start, toJSON }, { ...start, extra: cycle }, { ...start, extra: new Array(1) },
      { ...start, [Symbol('private')]: true }, Object.defineProperty({ ...start }, 'hidden', { value: 1 }),
      Object.create(start), revoked.proxy, JSON.parse('{"__proto__":{},"projectId":"x"}') as unknown,
    ]) expect(importStartInputSchema.safeParse(input).success).toBe(false);
    expect(getter).not.toHaveBeenCalled(); expect(toJSON).not.toHaveBeenCalled();
    const mapping = Object.defineProperty({}, 'dog', { enumerable: true, get: getter });
    expect(importCommitInputSchema.safeParse({ ...commit, classNames: mapping }).success).toBe(false);
    expect(getter).not.toHaveBeenCalled();
  });

  it('rejects unknown shared-DAG fields in linear work at depth 32', () => {
    let dag: unknown = { leaf: true };
    for (let i = 0; i < 32; i += 1) dag = [dag, dag];
    const spy = vi.spyOn(Object, 'getOwnPropertyDescriptor');
    try {
      const result = importStartInputSchema.safeParse({ ...start, extra: dag });
      const calls = spy.mock.calls.length;
      expect(result.success).toBe(false);
      expect(result.error?.issues).toEqual([expect.objectContaining({ code: 'unrecognized_keys', keys: ['extra'] })]);
      expect(calls).toBeGreaterThan(64); expect(calls).toBeLessThan(100);
    } finally { spy.mockRestore(); }
  });
});