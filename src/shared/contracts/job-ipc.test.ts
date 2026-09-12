// @vitest-environment node
import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import {
  JOB_LIST_CHANNEL, JOB_GET_CHANNEL, JOB_CANCEL_CHANNEL, JOB_SUBSCRIBE_CHANNEL,
  JOB_UNSUBSCRIBE_CHANNEL, JOB_CHANGED_CHANNEL, jobListInputSchema, jobGetInputSchema,
  jobCancelInputSchema, jobSubscribeInputSchema, jobUnsubscribeInputSchema,
  jobListResponseSchema, jobGetResponseSchema, jobCancelResponseSchema,
  jobSubscribeResponseSchema, jobUnsubscribeResponseSchema, jobChangedEventSchema,
  jobSnapshotSchema, parseJobSnapshot, type JobApi, type JobSnapshot,
} from './job-ipc.js';

const projectId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const jobId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const subscriptionId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const job = { id: jobId, projectId, kind: 'scan-dataset', status: 'Running',
  createdAt: '2026-09-12T00:00:00.000Z', updatedAt: '2026-09-12T00:00:00.000Z' } as const;
const progress = { schemaVersion: 1, type: 'progress', source: 'actual', projectId, jobId,
  processed: 1, total: 3 } as const;
const snapshot = { job, progress, workerCompleted: false };

describe('JOB-05B shared wire/domain contracts', () => {
  it('has exactly the fixed transport names and a transport-free four-method public API', () => {
    expect([JOB_LIST_CHANNEL, JOB_GET_CHANNEL, JOB_CANCEL_CHANNEL, JOB_SUBSCRIBE_CHANNEL,
      JOB_UNSUBSCRIBE_CHANNEL, JOB_CHANGED_CHANNEL]).toEqual([
      'jobs:list', 'jobs:get', 'jobs:cancel', 'jobs:subscribe', 'jobs:unsubscribe', 'jobs:changed',
    ]);
    expectTypeOf<keyof JobApi>().toEqualTypeOf<'list' | 'get' | 'cancel' | 'subscribe'>();
    expectTypeOf<JobApi['subscribe']>().toEqualTypeOf<
      (projectId: string, listener: (snapshot: JobSnapshot) => void) => Promise<() => void>
    >();
  });

  it('normalizes UUIDs and requires exact project/job/token request shapes', () => {
    expect(jobListInputSchema.parse({ projectId: projectId.toUpperCase() })).toEqual({ projectId });
    expect(jobGetInputSchema.parse({ projectId, jobId: jobId.toUpperCase() })).toEqual({ projectId, jobId });
    expect(jobSubscribeInputSchema.parse({ projectId })).toEqual({ projectId });
    expect(jobCancelInputSchema.parse({ projectId, jobId })).toEqual({ projectId, jobId });
    expect(jobUnsubscribeInputSchema.parse({ projectId, subscriptionId })).toEqual({ projectId, subscriptionId });
    for (const id of ['', 'not-uuid', 12, null, undefined]) {
      expect(jobGetInputSchema.safeParse({ projectId, jobId: id }).success).toBe(false);
      expect(jobUnsubscribeInputSchema.safeParse({ projectId, subscriptionId: id }).success).toBe(false);
    }
    for (const field of ['kind', 'executablePath', 'path', 'env', 'channel', 'payload', 'workerCompleted']) {
      expect(jobSubscribeInputSchema.safeParse({ projectId, [field]: 'PRIVATE' }).success).toBe(false);
    }
  });

  it('rejects accessors, inherited/hidden/symbol fields, arrays, holes and toJSON without executing them', () => {
    const getter = vi.fn(() => projectId);
    const accessor = Object.defineProperty({}, 'projectId', { enumerable: true, get: getter });
    const hidden = Object.defineProperty({ projectId }, 'hidden', { value: true });
    const toJSON = vi.fn(() => ({ projectId }));
    for (const input of [null, [], new Array(1), [projectId], Object.create({ projectId }), accessor, hidden,
      { projectId, [Symbol('hidden')]: true }, { projectId, toJSON }, { projectId, __proto__: { foreign: true } }]) {
      expect(jobListInputSchema.safeParse(input).success).toBe(false);
    }
    expect(getter).not.toHaveBeenCalled(); expect(toJSON).not.toHaveBeenCalled();
    expect(jobListResponseSchema.safeParse({ ok: true, value: new Array(1) }).success).toBe(false);
    const cycle: Record<string, unknown> = { projectId }; cycle.self = cycle;
    expect(jobListInputSchema.safeParse(cycle).success).toBe(false);
  });

  it.each([20, 32])('rejects shared DAG unknown input with linear descriptor reads (depth %i)', (depth) => {
    let dag: unknown = { leaf: true };
    for (let i = 0; i < depth; i += 1) dag = [dag, dag];
    const input: unknown = structuredClone({ projectId, extra: dag });
    const descriptor = vi.spyOn(Object, 'getOwnPropertyDescriptor');
    try {
      const result = jobListInputSchema.safeParse(input);
      const calls = descriptor.mock.calls.length;
      expect(result.success).toBe(false);
      expect(result.error?.issues).toEqual([
        expect.objectContaining({ code: 'unrecognized_keys', keys: ['extra'] }),
      ]);
      expect(calls).toBeGreaterThanOrEqual(depth * 2 + 3);
      expect(calls).toBeLessThanOrEqual(depth * 2 + 10);
    } finally { descriptor.mockRestore(); }
  });

  it('rejects active cycles and invalid shared nodes without leaking deep nesting exceptions', () => {
    const shared = { leaf: true };
    const cycle: unknown[] = [shared, shared]; cycle.push(cycle);
    const invalid = { leaf: 1n };
    let deep: unknown = null;
    for (let i = 0; i < 20_000; i += 1) deep = [deep];
    for (const extra of [cycle, [invalid, invalid], deep]) {
      const result = jobListInputSchema.safeParse({ projectId, extra });
      expect(result.success).toBe(false);
      expect(result.error?.issues).toEqual([
        expect.objectContaining({ code: 'custom', message: 'Invalid JSON value' }),
      ]);
    }
  });

  it('accepts shared valid job references while preserving duplicate snapshot rejection', () => {
    expect(jobListResponseSchema.parse({ ok: true, value: [job, job] })).toEqual({ ok: true, value: [job, job] });
    const result = jobSubscribeResponseSchema.safeParse({ ok: true, value: { subscriptionId, snapshots: [snapshot, snapshot] } });
    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual([
      expect.objectContaining({ code: 'custom', message: 'Invalid initial snapshots' }),
    ]);
  });

  it('shares the actual worker progress rules without accepting other worker events', () => {
    expect(jobSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(jobSnapshotSchema.parse({ ...snapshot, progress: null, workerCompleted: true }).workerCompleted).toBe(true);
    for (const invalid of [
      { ...progress, processed: -1 }, { ...progress, processed: 4 }, { ...progress, processed: NaN },
      { ...progress, total: Infinity }, { ...progress, source: 'estimated' }, { ...progress, schemaVersion: 2 },
      { ...progress, projectId: subscriptionId }, { ...progress, jobId: subscriptionId },
      { ...progress, resultManifest: 'PRIVATE' }, { schemaVersion: 1, type: 'started', projectId, jobId },
    ]) expect(jobSnapshotSchema.safeParse({ ...snapshot, progress: invalid }).success).toBe(false);
    expect(jobSnapshotSchema.safeParse({ ...snapshot, progress: { ...progress, total: null } }).success).toBe(true);
    expect(jobSnapshotSchema.safeParse({ ...snapshot, progress: { ...progress, total: 0, processed: 0 } }).success).toBe(true);
    expect(() => parseJobSnapshot(snapshot, { projectId: subscriptionId })).toThrow('Invalid job correlation');
    expect(() => parseJobSnapshot(snapshot, { projectId, jobId: subscriptionId })).toThrow('Invalid job correlation');
  });

  it('validates and freezes exact response DTOs with no functions, secrets or duplicate snapshots', () => {
    expect(jobListResponseSchema.parse({ ok: true, value: [job] }).ok).toBe(true);
    expect(jobGetResponseSchema.parse({ ok: true, value: snapshot }).ok).toBe(true);
    expect(jobCancelResponseSchema.parse({ ok: true, value: job }).ok).toBe(true);
    const result = jobSubscribeResponseSchema.parse({ ok: true, value: { subscriptionId, snapshots: [snapshot] } });
    expect(result.ok).toBe(true); expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(jobSnapshotSchema.parse(snapshot).progress)).toBe(true);
    expect(jobUnsubscribeResponseSchema.parse({ ok: true, value: null })).toEqual({ ok: true, value: null });
    expect(jobChangedEventSchema.parse({ subscriptionId, snapshot })).toEqual({ subscriptionId, snapshot });
    for (const value of [
      { subscriptionId, snapshots: [snapshot, snapshot] },
      { subscriptionId, snapshots: [snapshot], unsubscribe: () => undefined },
      { subscriptionId, snapshots: [snapshot, { ...snapshot, job: { ...job, id: subscriptionId, projectId: jobId }, progress: null }] },
    ]) expect(jobSubscribeResponseSchema.safeParse({ ok: true, value }).success).toBe(false);
    for (const schema of [jobListResponseSchema, jobGetResponseSchema, jobCancelResponseSchema,
      jobSubscribeResponseSchema, jobUnsubscribeResponseSchema]) {
      expect(schema.safeParse({ ok: false, error: { code: 'NOT_FOUND' } }).success).toBe(true);
      expect(schema.safeParse({ ok: false, error: { code: 'PRIVATE' } }).success).toBe(false);
      expect(schema.safeParse({ ok: false, error: { code: 'OPERATION_FAILED', message: 'PRIVATE' } }).success).toBe(false);
    }
  });
});