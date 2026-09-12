import type { IpcRenderer } from 'electron';
import type { z } from 'zod';

import {
  JOB_LIST_CHANNEL, JOB_GET_CHANNEL, JOB_CANCEL_CHANNEL, JOB_SUBSCRIBE_CHANNEL,
  JOB_UNSUBSCRIBE_CHANNEL, JOB_CHANGED_CHANNEL,
  jobListInputSchema, jobGetInputSchema, jobCancelInputSchema, jobSubscribeInputSchema,
  jobListResponseSchema, jobGetResponseSchema, jobCancelResponseSchema,
  jobSubscribeResponseSchema, jobUnsubscribeInputSchema, jobUnsubscribeResponseSchema,
  jobChangedEventSchema, type JobApi, type JobSnapshot, type JobSubscribeResponse,
} from '../shared/contracts/job-ipc.js';

// JOB05C only: bridge registration and Main remain separate owners.
export function createJobApi(transport: Pick<IpcRenderer, 'invoke' | 'on' | 'removeListener'>): Readonly<JobApi> {
  type Expected = { readonly projectId: string; readonly jobId?: string };
  let generation = 0;
  let stopActive: (() => void) | undefined;

  async function request<Response extends z.ZodType>(
    channel: string, args: unknown[], count: 1 | 2, inputSchema: z.ZodType<Expected>,
    schema: Response, correlate: (response: z.output<Response>, expected: Expected) => boolean,
  ): Promise<z.output<Response>> {
    const failure = (code: 'INVALID_REQUEST' | 'OPERATION_FAILED') => schema.parse({ ok: false, error: { code } });
    let input: Expected;
    try {
      if (args.length !== count) return failure('INVALID_REQUEST');
      input = inputSchema.parse(count === 1 ? { projectId: args[0] } : { projectId: args[0], jobId: args[1] });
    } catch { return failure('INVALID_REQUEST'); }
    try {
      const response = schema.parse(await transport.invoke(channel, input));
      return correlate(response, input) ? response : failure('OPERATION_FAILED');
    } catch { return failure('OPERATION_FAILED'); }
  }

  const api: JobApi = {
    async list(...args: unknown[]) {
      return request(JOB_LIST_CHANNEL, args, 1, jobListInputSchema, jobListResponseSchema,
        (response, input) => !response.ok || response.value.every((job) => job.projectId === input.projectId));
    },
    async get(...args: unknown[]) {
      return request(JOB_GET_CHANNEL, args, 2, jobGetInputSchema, jobGetResponseSchema,
        (response, input) => !response.ok || (response.value.job.projectId === input.projectId && response.value.job.id === input.jobId));
    },
    async cancel(...args: unknown[]) {
      return request(JOB_CANCEL_CHANNEL, args, 2, jobCancelInputSchema, jobCancelResponseSchema,
        (response, input) => !response.ok || (response.value.projectId === input.projectId && response.value.id === input.jobId));
    },
    async subscribe(...args: unknown[]) {
      let projectId: string;
      const listener = args[1];
      if (args.length !== 2 || typeof listener !== 'function') throw new Error('INVALID_REQUEST');
      const onSnapshot = listener as (snapshot: JobSnapshot) => unknown;
      try {
        ({ projectId } = jobSubscribeInputSchema.parse({ projectId: args[0] }));
      } catch { throw new Error('INVALID_REQUEST'); }

      const ownGeneration = ++generation;
      stopActive?.();
      let live = true;
      let installed = false;
      let buffering = true;
      let token: string | undefined;
      let remoteStopped = false;
      // No history or invented cap: only the latest validated snapshot per
      // token/job. The ack selects its token; foreign projects never enter.
      const pending = new Map<string, Map<string, JobSnapshot>>();
      const current = () => live && generation === ownGeneration;

      async function stopRemote(): Promise<void> {
        if (token === undefined || remoteStopped) return;
        remoteStopped = true;
        try {
          const input = jobUnsubscribeInputSchema.parse({ projectId, subscriptionId: token });
          jobUnsubscribeResponseSchema.parse(await transport.invoke(JOB_UNSUBSCRIBE_CHANNEL, input));
        } catch { /* Observed, code-only cleanup failure; never publish native errors. */ }
      }
      function stop(): void {
        live = false;
        pending.clear();
        if (stopActive === stop) stopActive = undefined;
        if (installed) {
          installed = false;
          try { transport.removeListener(JOB_CHANGED_CHANNEL, nativeListener); } catch { /* Local invalidation is unconditional. */ }
        }
        void stopRemote();
      }
      function deliver(snapshot: JobSnapshot): void {
        if (!current()) return;
        try { void Promise.resolve(onSnapshot(snapshot)).catch(() => undefined); } catch { /* Isolate synchronous callbacks too. */ }
      }
      function nativeListener(_event: unknown, raw: unknown): void {
        if (!current()) return;
        try {
          const event = jobChangedEventSchema.parse(raw);
          if (!current() || event.snapshot.job.projectId !== projectId || (token !== undefined && event.subscriptionId !== token)) return;
          if (buffering) {
            let jobs = pending.get(event.subscriptionId);
            if (jobs === undefined) { jobs = new Map(); pending.set(event.subscriptionId, jobs); }
            jobs.set(event.snapshot.job.id, event.snapshot);
          } else deliver(event.snapshot);
        } catch { /* Malformed events are dropped without exposing Electron's event. */ }
      }

      stopActive = stop;
      let response: JobSubscribeResponse;
      try {
        // Mark before on(): even a partially successful registration is removed.
        installed = true;
        transport.on(JOB_CHANGED_CHANNEL, nativeListener);
        const input = jobSubscribeInputSchema.parse({ projectId });
        response = jobSubscribeResponseSchema.parse(await transport.invoke(JOB_SUBSCRIBE_CHANNEL, input));
      } catch { stop(); throw new Error('OPERATION_FAILED'); }
      if (!response.ok) { stop(); throw new Error(response.error.code); }
      token = response.value.subscriptionId;
      if (!response.value.snapshots.every(({ job }) => job.projectId === projectId)) {
        stop(); throw new Error('OPERATION_FAILED');
      }
      // A stale ack owns only its own returned token, even for A -> B -> A.
      if (!current()) { stop(); return stop; }
      const queued = pending.get(token) ?? new Map<string, JobSnapshot>();
      pending.clear(); pending.set(token, queued);
      for (const snapshot of response.value.snapshots) {
        if (!current()) break;
        deliver(snapshot);
      }
      for (const [jobId, snapshot] of queued) {
        if (!current()) break;
        queued.delete(jobId);
        deliver(snapshot);
      }
      pending.clear();
      buffering = false;
      return stop;
    },
  };
  Object.setPrototypeOf(api, null);
  return Object.freeze(api);
}