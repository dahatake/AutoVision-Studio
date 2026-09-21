import { createContext, useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import type { Job, JobKind, JobStatus } from '../../../shared/contracts/job';
import {
  jobCancelResponseSchema, parseJobSnapshot, type JobApi, type JobIpcErrorCode, type JobSnapshot,
} from '../../../shared/contracts/job-ipc';

const kindLabels: Record<JobKind, string> = {
  'scan-dataset': '画像の検査', assist: '補助候補生成', train: '学習',
};
const statusLabels: Record<JobStatus, string> = {
  Queued: '待機中', Preparing: '準備中', Running: '実行中', Exporting: '出力中', Evaluating: '評価中',
  Succeeded: '成功', Failed: '失敗', Cancelled: 'キャンセル済み', Interrupted: '中断',
};
const errorLabels: Record<JobIpcErrorCode, string> = {
  INVALID_REQUEST: '要求を確認できません。',
  NOT_FOUND: '対象のジョブが見つかりません。',
  INVALID_STATE: '現在の状態ではキャンセルできません。',
  BUSY: 'ほかの処理が実行中です。',
  STALE_SUBSCRIPTION: 'ジョブの購読が無効になりました。',
  OPERATION_FAILED: 'ジョブの処理を確認できません。',
};

export function isActiveJob(job: Job): boolean {
  return ['Queued', 'Preparing', 'Running', 'Exporting', 'Evaluating'].includes(job.status);
}

type Readout = {
  phase: 'loading' | 'ready' | 'failed';
  snapshots: readonly JobSnapshot[];
  error: string;
  cancelling: ReadonlySet<string>;
  cancelErrors: ReadonlyMap<string, string>;
};
export interface JobReadout extends Readout {
  projectId: string | null;
  available: boolean;
  cancel: (jobId: string) => Promise<void>;
}
const JobContext = createContext<JobReadout | null>(null);
export function useJobs(): JobReadout | null { return useContext(JobContext); }
const initialReadout = (): Readout => ({
  phase: 'loading', snapshots: [], error: '', cancelling: new Set(), cancelErrors: new Map(),
});

// Preload permits only one subscription. The shell owns it across route changes;
// the status bar, list and import screen all consume the same project snapshots.
export function JobProvider({ api, projectId, children }: {
  api: JobApi | null; projectId: string | null; children: ReactNode;
}) {
  const context = useMemo(() => ({ api, projectId }), [api, projectId]);
  const current = useRef<typeof context | null>(null);
  const pending = useRef(new Set<string>());
  const [state, setState] = useState<{ context: typeof context; readout: Readout }>(() => ({
    context, readout: initialReadout(),
  }));
  const readout = state.context === context ? state.readout : initialReadout();

  useLayoutEffect(() => {
    current.current = context;
    pending.current = new Set();
    setState({ context, readout: initialReadout() });
    let live = true;
    let remove: (() => void) | undefined;
    const valid = () => live && current.current === context;
    const unsubscribe = (stop: () => void) => {
      try { stop(); } catch { console.warn('ジョブ通知の解除を確認できませんでした。'); }
    };
    if (api && projectId) {
      void (async () => {
        try {
          const stop = await api.subscribe(projectId, (value) => {
            if (!valid()) return;
            let snapshot: JobSnapshot;
            try { snapshot = parseJobSnapshot(value, { projectId }); }
            catch {
              setState((previous) => ({ context, readout: { ...previous.readout,
                phase: 'failed', error: 'ジョブ通知を確認できません。表示は最新ではありません。' } }));
              return;
            }
            if (!isActiveJob(snapshot.job)) pending.current.delete(snapshot.job.id);
            setState((previous) => {
              const old = previous.readout.snapshots.find(({ job }) => job.id === snapshot.job.id);
              if (old && old.job.updatedAt > snapshot.job.updatedAt) return previous;
              const snapshots = previous.readout.snapshots.filter(({ job }) => job.id !== snapshot.job.id);
              snapshots.push(snapshot);
              snapshots.sort((a, b) => a.job.createdAt.localeCompare(b.job.createdAt) || a.job.id.localeCompare(b.job.id));
              return { context, readout: { ...previous.readout, snapshots, cancelling: new Set(pending.current) } };
            });
          });
          if (!valid()) { unsubscribe(stop); return; }
          remove = stop;
          setState((previous) => ({ context, readout: { ...previous.readout,
            phase: previous.readout.error ? 'failed' : 'ready' } }));
        } catch {
          if (valid()) setState((previous) => ({ context, readout: { ...previous.readout,
            phase: 'failed', error: 'ジョブ通知を取得できません。状態は未確認です。' } }));
        }
      })();
    }
    return () => {
      live = false;
      if (current.current === context) current.current = null;
      if (remove) unsubscribe(remove);
    };
  }, [context]);

  async function cancel(jobId: string): Promise<void> {
    const snapshot = readout.snapshots.find(({ job }) => job.id === jobId);
    if (current.current !== context || !api || !projectId || readout.phase !== 'ready'
      || !snapshot || !isActiveJob(snapshot.job) || pending.current.has(jobId)) return;
    pending.current.add(jobId);
    setState((previous) => {
      const errors = new Map(previous.readout.cancelErrors); errors.delete(jobId);
      return { context, readout: { ...previous.readout, cancelling: new Set(pending.current), cancelErrors: errors } };
    });
    let failure = '';
    try {
      const response = jobCancelResponseSchema.parse(await api.cancel(projectId, jobId));
      if (current.current !== context) return;
      if (!response.ok) failure = errorLabels[response.error.code];
      else if (response.value.id !== jobId || response.value.projectId !== projectId
        || response.value.kind !== snapshot.job.kind) failure = errorLabels.OPERATION_FAILED;
      else {
        const job = response.value;
        if (!isActiveJob(job)) pending.current.delete(jobId);
        setState((previous) => ({ context, readout: { ...previous.readout,
          cancelling: new Set(pending.current),
          snapshots: previous.readout.snapshots.map((item) => item.job.id === jobId && item.job.updatedAt <= job.updatedAt
            ? { ...item, job } : item),
        } }));
      }
    } catch { failure = errorLabels.OPERATION_FAILED; }
    if (current.current !== context || !failure) return;
    pending.current.delete(jobId);
    setState((previous) => {
      const errors = new Map(previous.readout.cancelErrors);
      errors.set(jobId, `キャンセルを確認できません。${failure}`);
      return { context, readout: { ...previous.readout, cancelling: new Set(pending.current), cancelErrors: errors } };
    });
  }

  return <JobContext.Provider value={{ ...readout, projectId, available: api !== null, cancel }}>
    {children}
  </JobContext.Provider>;
}

export function JobProgress({ snapshot }: { snapshot: JobSnapshot }) {
  const progress = snapshot.progress;
  if (!progress) return <span>進捗未取得</span>;
  const processed = progress.processed.toLocaleString('ja-JP');
  if (progress.total === null) return <span>{processed}件処理済み／総件数不明</span>;
  const counts = `${processed} / ${progress.total.toLocaleString('ja-JP')}件`;
  return <span>{progress.total > 0 && <progress aria-label="ジョブの進捗" value={progress.processed} max={progress.total} />}
    {counts}
  </span>;
}

export function JobDetails({ snapshot }: { snapshot: JobSnapshot }) {
  const jobs = useJobs();
  const { job } = snapshot;
  const cancelling = jobs?.cancelling.has(job.id);
  return <>
    <span>{kindLabels[job.kind]} — {statusLabels[job.status]}（{job.status}）</span>{' '}
    <span>Job ID：{job.id}</span>{' '}
    <JobProgress snapshot={snapshot} />{' '}
    {snapshot.workerCompleted && isActiveJob(job) && <span>worker処理済み／確定待ち </span>}
    {isActiveJob(job) ? <button type="button"
      aria-label={`${kindLabels[job.kind]}（${job.id}）をキャンセル`}
      disabled={!jobs || jobs.phase !== 'ready' || cancelling}
      onClick={() => { void jobs?.cancel(job.id); }}>
      {cancelling ? 'キャンセル確認待ち' : 'キャンセル'}
    </button> : <span>キャンセル不可（終端状態）</span>}
    {jobs?.cancelErrors.get(job.id) && <p role="alert">{jobs.cancelErrors.get(job.id)}</p>}
  </>;
}

export function JobStatusBar({ onOpenJobs }: { onOpenJobs?: () => void }) {
  const jobs = useJobs();
  const active = jobs?.snapshots.filter(({ job }) => isActiveJob(job)) ?? [];
  return <section aria-label="共通ジョブ" className="job-status-bar">
    {jobs?.projectId && onOpenJobs && <button type="button" onClick={onOpenJobs}>ジョブ一覧</button>}
    {!jobs?.projectId ? <p role="status">ジョブ：Project 未選択</p>
      : !jobs.available ? <p role="alert">ジョブ機能に接続できません。状態は未確認です。</p>
        : <>
          <p role="status" aria-atomic="true">
            {jobs.phase === 'loading' ? 'ジョブを取得中'
              : jobs.phase === 'failed' ? jobs.error
                : active.length ? `処理中・待機中のジョブ：${active.length}件` : '処理中・待機中のジョブはありません'}
          </p>
          {active.length > 0 && <ul>{active.map((snapshot) => <li key={snapshot.job.id}>
            <JobDetails snapshot={snapshot} />
          </li>)}</ul>}
        </>}
  </section>;
}
