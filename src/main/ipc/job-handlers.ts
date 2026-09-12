import type { Event as ElectronEvent, IpcMain, IpcMainInvokeEvent, WebContents,
  WebContentsDidStartNavigationEventParams, WebFrameMain } from 'electron';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { z } from 'zod';

import {
  JOB_LIST_CHANNEL, JOB_GET_CHANNEL, JOB_CANCEL_CHANNEL, JOB_SUBSCRIBE_CHANNEL,
  JOB_UNSUBSCRIBE_CHANNEL, JOB_CHANGED_CHANNEL,
  jobListInputSchema, jobGetInputSchema, jobCancelInputSchema, jobSubscribeInputSchema,
  jobUnsubscribeInputSchema, jobListResponseSchema, jobGetResponseSchema, jobCancelResponseSchema,
  jobSubscribeResponseSchema, jobUnsubscribeResponseSchema, jobChangedEventSchema,
  jobIpcJobSchema, parseJobSnapshot, type JobIpcErrorCode, type JobSnapshot,
} from '../../shared/contracts/job-ipc.js';
import type { JobService } from '../jobs/job-service.js';

type Service = Pick<JobService, 'list' | 'get' | 'getSnapshot' | 'cancel' | 'subscribe'>;
type Document = { frame: WebFrameMain; generation: number };
type Subscription = {
  subscriptionId: string; projectId: string; event: IpcMainInvokeEvent; document: Document;
  closed: boolean; initializing: boolean; unsubscribe?: () => void; pending: Map<string, JobSnapshot>;
};
class RequestFailure extends Error {
  constructor(readonly code: JobIpcErrorCode) { super(code); }
}

// Exact project-handlers trust pattern; there is no exported common helper.
function fileUrl(value: string): string | undefined {
  try {
    const base = value.split('#', 1)[0];
    const url = new URL(value);
    url.hash = '';
    if (url.protocol !== 'file:' || url.host !== '' || url.search !== ''
      || base?.includes('?') || url.href !== base || fileURLToPath(url).includes('\0')) return undefined;
    return url.href;
  } catch { return undefined; }
}
function failure(error: unknown) {
  let code: JobIpcErrorCode = 'OPERATION_FAILED';
  try {
    if (error instanceof RequestFailure) code = error.code;
    else if (error !== null && typeof error === 'object') {
      // Read data only, never exception message/stack/cause or a code getter.
      const field = Object.getOwnPropertyDescriptor(error, 'code');
      if (field && 'value' in field) {
        switch (field.value) {
          case 'JOB_NOT_FOUND': code = 'NOT_FOUND'; break;
          case 'JOB_INPUT': code = 'INVALID_REQUEST'; break;
          case 'JOB_STATE': case 'JOB_NOT_OWNED': code = 'INVALID_STATE'; break;
          case 'JOB_TRANSACTION': case 'JOB_SHUTDOWN': code = 'BUSY'; break;
        }
      }
    }
  } catch { code = 'OPERATION_FAILED'; }
  return { ok: false as const, error: { code } };
}

/** Main-only explicit registration. No startup, generic RPC, timers or workers. */
export function registerJobHandlers(
  ipc: Pick<IpcMain, 'handle' | 'removeHandler'>,
  contents: WebContents,
  expectedURL: string,
  service: Service,
): { dispose(): void } {
  const expected = fileUrl(expectedURL);
  if (expected === undefined) throw new RequestFailure('INVALID_REQUEST');
  const registered: string[] = [];
  let disposed = false;
  let invalidating = false;
  let generation = 0;
  let sequence = 0;
  let active: Subscription | undefined;

  function stop(subscription: Subscription | undefined): void {
    if (!subscription || subscription.closed) return;
    subscription.closed = true;
    if (active === subscription) active = undefined;
    subscription.pending.clear();
    const unsubscribe = subscription.unsubscribe;
    delete subscription.unsubscribe;
    try { unsubscribe?.(); } catch { /* Revoked locally even if service cleanup fails. */ }
  }
  function invalidate(): void {
    generation += 1; sequence += 1;
    const wasInvalidating = invalidating;
    invalidating = true;
    try { stop(active); } finally { invalidating = wasInvalidating; }
  }
  function onNavigation(details: ElectronEvent<WebContentsDidStartNavigationEventParams>): void {
    if (details.isMainFrame && !details.isSameDocument) invalidate();
  }
  function trusted(event: IpcMainInvokeEvent): boolean {
    try {
      const frame = event.senderFrame;
      return !disposed && !invalidating && event.sender === contents && !contents.isDestroyed()
        && frame !== null && frame === contents.mainFrame
        && fileUrl(frame.url) === expected && fileUrl(contents.getURL()) === expected;
    } catch { return false; }
  }
  function current(event: IpcMainInvokeEvent, document: Document): boolean {
    try { return trusted(event) && generation === document.generation && event.senderFrame === document.frame; }
    catch { return false; }
  }
  function assertCurrent(event: IpcMainInvokeEvent, document: Document): void {
    if (!current(event, document)) throw new RequestFailure('STALE_SUBSCRIPTION');
  }
  function live(subscription: Subscription): boolean {
    return !subscription.closed && active === subscription && current(subscription.event, subscription.document);
  }
  function assertLive(subscription: Subscription): void {
    if (!live(subscription)) throw new RequestFailure('STALE_SUBSCRIPTION');
  }
  function changed(subscription: Subscription, value: unknown): void {
    if (!live(subscription)) { stop(subscription); return; }
    try {
      const snapshot = parseJobSnapshot(value, { projectId: subscription.projectId });
      assertLive(subscription);
      if (subscription.initializing) { subscription.pending.set(snapshot.job.id, snapshot); return; }
      const envelope = jobChangedEventSchema.parse({ subscriptionId: subscription.subscriptionId, snapshot });
      assertLive(subscription);
      contents.send(JOB_CHANGED_CHANNEL, envelope);
    } catch { stop(subscription); }
  }
  function checkedJob(value: unknown, projectId: string, jobId?: string) {
    const job = jobIpcJobSchema.parse(value);
    if (job.projectId !== projectId || (jobId !== undefined && job.id !== jobId)) throw new RequestFailure('OPERATION_FAILED');
    return job;
  }
  function headers(projectId: string) {
    const result = jobListResponseSchema.parse({ ok: true, value: service.list(projectId) });
    if (!result.ok) throw new RequestFailure('OPERATION_FAILED');
    const jobs = result.value.map((job) => checkedJob(job, projectId));
    if (new Set(jobs.map((job) => job.id)).size !== jobs.length) throw new RequestFailure('OPERATION_FAILED');
    return jobs;
  }
  function subscribe(event: IpcMainInvokeEvent, document: Document, projectId: string) {
    const ticket = ++sequence;
    stop(active); // Cleanup can reenter. Never overwrite a newer registration.
    assertCurrent(event, document);
    if (ticket !== sequence) throw new RequestFailure('STALE_SUBSCRIPTION');
    const subscription: Subscription = { subscriptionId: randomUUID(), projectId, event, document,
      closed: false, initializing: true, pending: new Map() };
    active = subscription;
    try {
      const unsubscribe = service.subscribe(projectId, (value) => changed(subscription, value));
      // A synchronous initial callback can navigate/replace/dispose BEFORE the
      // service returns its cleanup. Release that late cleanup exactly once.
      if (!live(subscription)) { try { unsubscribe(); } catch { /* sanitized below */ }
        throw new RequestFailure('STALE_SUBSCRIPTION'); }
      subscription.unsubscribe = unsubscribe;
      const jobs = headers(projectId);
      assertLive(subscription);
      const snapshots = new Map<string, JobSnapshot>();
      for (const job of jobs) {
        assertLive(subscription);
        // This fresh read supersedes notifications received BEFORE it. Keep
        // only notifications reentering DURING/AFTER the read as overrides.
        subscription.pending.delete(job.id);
        const snapshot = parseJobSnapshot(service.getSnapshot(projectId, job.id), { projectId, jobId: job.id });
        assertLive(subscription);
        snapshots.set(job.id, snapshot);
      }
      // Listener first, initial read second; callbacks during snapshot reads win.
      // Memory is latest-per-job, not event history; no arbitrary list truncation.
      for (const [id, value] of subscription.pending) snapshots.set(id, value);
      const reply = jobSubscribeResponseSchema.parse({ ok: true, value: {
        subscriptionId: subscription.subscriptionId, snapshots: [...snapshots.values()],
      } });
      assertLive(subscription);
      subscription.pending.clear(); subscription.initializing = false;
      return reply;
    } catch (error) { stop(subscription); throw error; }
  }
  function register<Input, Output>(channel: string, inputSchema: z.ZodType<Input>, outputSchema: z.ZodType<Output>,
    operation: (input: Input, event: IpcMainInvokeEvent, document: Document) => unknown): void {
    ipc.handle(channel, (event, ...args: unknown[]) => {
      let document: Document | undefined;
      try {
        if (!trusted(event) || args.length !== 1) throw new RequestFailure('INVALID_REQUEST');
        const frame = event.senderFrame;
        if (frame === null) throw new RequestFailure('INVALID_REQUEST');
        document = { frame, generation };
        const input = inputSchema.safeParse(args[0]);
        if (!input.success) throw new RequestFailure('INVALID_REQUEST');
        assertCurrent(event, document);
        const result = outputSchema.parse(operation(input.data, event, document));
        assertCurrent(event, document);
        return result;
      } catch (error) {
        return outputSchema.parse(failure(document && !current(event, document)
          ? new RequestFailure('STALE_SUBSCRIPTION') : error));
      }
    });
    registered.push(channel); // Failed/conflicting handle belongs to another owner.
  }
  function dispose(): void {
    if (disposed) return;
    disposed = true; invalidate();
    contents.removeListener('did-start-navigation', onNavigation);
    contents.removeListener('render-process-gone', invalidate);
    contents.removeListener('destroyed', dispose);
    for (const channel of registered.splice(0)) ipc.removeHandler(channel);
  }
  try {
    contents.on('did-start-navigation', onNavigation);
    contents.on('render-process-gone', invalidate);
    contents.on('destroyed', dispose);
    register(JOB_LIST_CHANNEL, jobListInputSchema, jobListResponseSchema,
      ({ projectId }) => ({ ok: true, value: headers(projectId) }));
    register(JOB_GET_CHANNEL, jobGetInputSchema, jobGetResponseSchema, ({ projectId, jobId }) => {
      const value = service.getSnapshot(projectId, jobId);
      if (value === undefined) throw new RequestFailure('NOT_FOUND');
      return { ok: true, value: parseJobSnapshot(value, { projectId, jobId }) };
    });
    register(JOB_CANCEL_CHANNEL, jobCancelInputSchema, jobCancelResponseSchema, ({ projectId, jobId }) =>
      ({ ok: true, value: checkedJob(service.cancel(projectId, jobId), projectId, jobId) }));
    register(JOB_SUBSCRIBE_CHANNEL, jobSubscribeInputSchema, jobSubscribeResponseSchema,
      ({ projectId }, event, document) => subscribe(event, document, projectId));
    register(JOB_UNSUBSCRIBE_CHANNEL, jobUnsubscribeInputSchema, jobUnsubscribeResponseSchema,
      ({ projectId, subscriptionId }) => {
        if (!active || !live(active) || active.subscriptionId !== subscriptionId || active.projectId !== projectId) {
          throw new RequestFailure('STALE_SUBSCRIPTION');
        }
        stop(active);
        return { ok: true, value: null };
      });
  } catch (error) { dispose(); throw error; }
  return Object.freeze({ dispose });
}