import { z } from 'zod';

import { jobIdSchema, jobSchema } from './job.js';
import { projectIdSchema } from './project.js';
import { workerEventSchema, type WorkerEvent } from './worker.js';

export const JOB_LIST_CHANNEL = 'jobs:list' as const;
export const JOB_GET_CHANNEL = 'jobs:get' as const;
export const JOB_CANCEL_CHANNEL = 'jobs:cancel' as const;
export const JOB_SUBSCRIBE_CHANNEL = 'jobs:subscribe' as const;
export const JOB_UNSUBSCRIBE_CHANNEL = 'jobs:unsubscribe' as const;
export const JOB_CHANGED_CHANNEL = 'jobs:changed' as const;

// Validate direct values BEFORE Zod reads properties. Never invoke accessors or
// toJSON; reject holes, symbols, hidden fields, class instances and cycles.
// Cache only fully verified nodes so shared DAGs take linear work per validation.
function plainJson(value: unknown, ancestors = new Set<object>(), checked = new WeakSet<object>()): boolean {
  try {
    if (value === null || typeof value === 'boolean') return true;
    if (typeof value === 'string') return !/[\uD800-\uDFFF]/u.test(value);
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value !== 'object' || ancestors.has(value)) return false;
    if (checked.has(value)) return true;
    ancestors.add(value);
    try {
      const keys = Reflect.ownKeys(value);
      if (Array.isArray(value)) {
        if (keys.length !== value.length + 1) return false;
        for (let i = 0; i < value.length; i += 1) {
          const field = Object.getOwnPropertyDescriptor(value, String(i));
          if (!field || !field.enumerable || !('value' in field) || !plainJson(field.value, ancestors, checked)) return false;
        }
        checked.add(value);
        return true;
      }
      const prototype: unknown = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) return false;
      if (!keys.every((key) => {
        const field = Object.getOwnPropertyDescriptor(value, key);
        return typeof key === 'string' && key !== '__proto__' && plainJson(key, ancestors, checked)
          && field !== undefined && field.enumerable === true && 'value' in field && plainJson(field.value, ancestors, checked);
      })) return false;
      checked.add(value);
      return true;
    } finally { ancestors.delete(value); }
  } catch { return false; }
}
const directJson = z.unknown().refine((value) => plainJson(value), 'Invalid JSON value');
export const jobIpcProjectIdSchema = z.string().toLowerCase().pipe(projectIdSchema);
export const jobIpcIdSchema = z.string().toLowerCase().pipe(jobIdSchema);
export const jobSubscriptionIdSchema = jobIpcIdSchema;
export const jobListInputSchema = directJson.pipe(z.strictObject({ projectId: jobIpcProjectIdSchema })).readonly();
export const jobGetInputSchema = directJson.pipe(z.strictObject({
  projectId: jobIpcProjectIdSchema, jobId: jobIpcIdSchema,
})).readonly();
export const jobCancelInputSchema = jobGetInputSchema;
export const jobSubscribeInputSchema = jobListInputSchema;
export const jobUnsubscribeInputSchema = directJson.pipe(z.strictObject({
  projectId: jobIpcProjectIdSchema, subscriptionId: jobSubscriptionIdSchema,
})).readonly();

export const jobIpcJobSchema = directJson.pipe(jobSchema).readonly();
export type JobProgress = Readonly<Extract<WorkerEvent, { type: 'progress' }>>;
export const jobProgressSchema = directJson.pipe(workerEventSchema).transform((event, ctx) => {
  if (event.type !== 'progress') {
    ctx.addIssue({ code: 'custom', message: 'Expected actual worker progress' });
    return z.NEVER;
  }
  return Object.freeze(event);
});
export const jobSnapshotSchema = directJson.pipe(z.strictObject({
  job: jobIpcJobSchema,
  progress: jobProgressSchema.nullable(),
  workerCompleted: z.boolean(),
})).refine((snapshot) => snapshot.progress === null || (
  snapshot.progress.projectId === snapshot.job.projectId && snapshot.progress.jobId === snapshot.job.id
), 'Invalid progress correlation').readonly();
export type JobSnapshot = z.infer<typeof jobSnapshotSchema>;

/** Also check request correlation: structural validation alone is not authority. */
export function parseJobSnapshot(value: unknown, expected: { projectId: string; jobId?: string }): JobSnapshot {
  const snapshot = jobSnapshotSchema.parse(value);
  if (snapshot.job.projectId !== jobIpcProjectIdSchema.parse(expected.projectId)
    || (expected.jobId !== undefined && snapshot.job.id !== jobIpcIdSchema.parse(expected.jobId))) {
    throw new Error('Invalid job correlation');
  }
  return snapshot;
}

export const jobIpcErrorCodeSchema = z.enum([
  'INVALID_REQUEST', 'NOT_FOUND', 'INVALID_STATE', 'BUSY', 'STALE_SUBSCRIPTION', 'OPERATION_FAILED',
]);
export const jobIpcErrorSchema = z.strictObject({ code: jobIpcErrorCodeSchema }).readonly();
function response<Value extends z.ZodType>(value: Value) {
  return directJson.pipe(z.discriminatedUnion('ok', [
    z.strictObject({ ok: z.literal(true), value }),
    z.strictObject({ ok: z.literal(false), error: jobIpcErrorSchema }),
  ])).readonly();
}
export const jobListResponseSchema = response(z.array(jobIpcJobSchema).readonly());
export const jobGetResponseSchema = response(jobSnapshotSchema);
export const jobCancelResponseSchema = response(jobIpcJobSchema);
export const jobSubscribeValueSchema = directJson.pipe(z.strictObject({
  subscriptionId: jobSubscriptionIdSchema,
  snapshots: z.array(jobSnapshotSchema).readonly(),
})).refine(({ snapshots }) => new Set(snapshots.map(({ job }) => job.id)).size === snapshots.length
  && snapshots.every(({ job }) => job.projectId === snapshots[0]?.job.projectId), 'Invalid initial snapshots').readonly();
export const jobSubscribeResponseSchema = response(jobSubscribeValueSchema);
export const jobUnsubscribeResponseSchema = response(z.null());
export const jobChangedEventSchema = directJson.pipe(z.strictObject({
  subscriptionId: jobSubscriptionIdSchema, snapshot: jobSnapshotSchema,
})).readonly();

export type JobListInput = z.infer<typeof jobListInputSchema>;
export type JobGetInput = z.infer<typeof jobGetInputSchema>;
export type JobCancelInput = z.infer<typeof jobCancelInputSchema>;
export type JobSubscribeInput = z.infer<typeof jobSubscribeInputSchema>;
export type JobUnsubscribeInput = z.infer<typeof jobUnsubscribeInputSchema>;
export type JobIpcErrorCode = z.infer<typeof jobIpcErrorCodeSchema>;
export type JobListResponse = z.infer<typeof jobListResponseSchema>;
export type JobGetResponse = z.infer<typeof jobGetResponseSchema>;
export type JobCancelResponse = z.infer<typeof jobCancelResponseSchema>;
export type JobSubscribeResponse = z.infer<typeof jobSubscribeResponseSchema>;
export type JobUnsubscribeResponse = z.infer<typeof jobUnsubscribeResponseSchema>;
export type JobChangedEvent = z.infer<typeof jobChangedEventSchema>;

/** Fixed domain API, NOT a transport. Preload owns all channel names/tokens.
 * subscribe installs its native listener BEFORE invoking, validates both wire
 * schemas and expected project/token, and delivers initial snapshots first.
 * Until ack, retain only latest snapshot per job for the pending subscription;
 * discard replaced tokens and clear on denial/disposal. No progress history,
 * polling, invented snapshot limit, launch options or worker-start capability.
 * Denial rejects Error(code) only. Success returns an idempotent local void
 * unsubscribe which removes its listener immediately and sends its own token;
 * observe/sanitize the wire unsubscribe failure, never an unhandled rejection.
 * Functions exist ONLY in this local API, never in a Zod/wire payload.
 */
export interface JobApi {
  readonly list: (projectId: string) => Promise<JobListResponse>;
  readonly get: (projectId: string, jobId: string) => Promise<JobGetResponse>;
  readonly cancel: (projectId: string, jobId: string) => Promise<JobCancelResponse>;
  readonly subscribe: (projectId: string, listener: (snapshot: JobSnapshot) => void) => Promise<() => void>;
}