import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { JobStatus } from '../../../shared/contracts/job';
import type { JobApi, JobSnapshot } from '../../../shared/contracts/job-ipc';
import { JobProvider, JobStatusBar } from './JobStatusBar';

const projectId = '11111111-1111-4111-8111-111111111111';
const otherProject = '22222222-2222-4222-8222-222222222222';
const jobId = '33333333-3333-4333-8333-333333333333';
function snapshot(status: JobStatus = 'Running', total: number | null = 10, processed = 2): JobSnapshot {
  return {
    job: { id: jobId, projectId, kind: 'scan-dataset', status,
      createdAt: '2026-09-21T00:00:00.000Z', updatedAt: '2026-09-21T00:00:00.000Z' },
    progress: { schemaVersion: 1, jobId, projectId, type: 'progress', source: 'actual', processed, total },
    workerCompleted: false,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture(initial: readonly JobSnapshot[] = []) {
  const listeners: ((snapshot: JobSnapshot) => void)[] = [];
  const stop = vi.fn();
  const api: JobApi = {
    list: vi.fn(), get: vi.fn(),
    cancel: vi.fn<JobApi['cancel']>().mockResolvedValue({ ok: true, value: snapshot().job }),
    subscribe: vi.fn<JobApi['subscribe']>().mockImplementation(async (_project, listener) => {
      listeners.push(listener); initial.forEach(listener); return stop;
    }),
  };
  const view = (id: string | null = projectId, port: JobApi | null = api) =>
    <JobProvider api={port} projectId={id}><JobStatusBar /></JobProvider>;
  return { api, listeners, stop, view };
}
afterEach(cleanup);

describe('W2-31 JobStatusBar', () => {
  it('distinguishes no project, unavailable, loading and an acknowledged empty queue', async () => {
    const f = fixture();
    const pending = deferred<() => void>();
    vi.mocked(f.api.subscribe).mockReturnValueOnce(pending.promise);
    const mounted = render(f.view(null));
    expect(screen.getByText('ジョブ：Project 未選択')).toBeInTheDocument();
    expect(f.api.subscribe).not.toHaveBeenCalled();
    mounted.rerender(f.view(projectId, null));
    expect(screen.getByRole('alert')).toHaveTextContent('状態は未確認');
    mounted.rerender(f.view());
    expect(screen.getByText('ジョブを取得中')).toBeInTheDocument();
    expect(screen.queryByText('処理中・待機中のジョブはありません')).not.toBeInTheDocument();
    await act(async () => pending.resolve(f.stop));
    expect(screen.getByText('処理中・待機中のジョブはありません')).toBeInTheDocument();
  });

  it('subscribes once and renders actual progress, unknown totals, zero and absent progress', async () => {
    const f = fixture([snapshot()]);
    render(f.view());
    await screen.findByText('処理中・待機中のジョブ：1件');
    expect(screen.getByText(/画像の検査 — 実行中/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '2');
    expect(screen.getByRole('progressbar')).toHaveAttribute('max', '10');
    act(() => f.listeners[0]!(snapshot('Running', null, 4)));
    expect(screen.getByText('4件処理済み／総件数不明')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    act(() => f.listeners[0]!(snapshot('Running', 0, 0)));
    expect(screen.getByText('0 / 0件')).toBeInTheDocument();
    act(() => f.listeners[0]!({ ...snapshot(), progress: null, workerCompleted: true }));
    expect(screen.getByText('進捗未取得')).toBeInTheDocument();
    expect(screen.getByText(/worker処理済み／確定待ち/)).toBeInTheDocument();
    expect(f.api.subscribe).toHaveBeenCalledTimes(1);
    expect(f.api.list).not.toHaveBeenCalled();
    expect(f.api.get).not.toHaveBeenCalled();
    expect(f.api.cancel).not.toHaveBeenCalled();
  });

  it.each(['Queued', 'Preparing', 'Running', 'Exporting', 'Evaluating'] as const)(
    'allows explicit cancel for %s, suppresses duplicate clicks and waits for terminal notification', async (status) => {
      const f = fixture([snapshot(status)]);
      const result = deferred<Awaited<ReturnType<JobApi['cancel']>>>();
      vi.mocked(f.api.cancel).mockReturnValue(result.promise);
      render(f.view());
      await screen.findByText('処理中・待機中のジョブ：1件');
      const button = screen.getByRole('button', { name: /をキャンセル/ });
      fireEvent.click(button); fireEvent.click(button);
      expect(f.api.cancel).toHaveBeenCalledExactlyOnceWith(projectId, jobId);
      expect(button).toBeDisabled();
      await act(async () => result.resolve({ ok: true, value: snapshot(status).job }));
      expect(button).toHaveTextContent('キャンセル確認待ち');
      act(() => f.listeners[0]!(snapshot('Cancelled')));
      expect(screen.getByText('処理中・待機中のジョブはありません')).toBeInTheDocument();
    });

  it.each(['Succeeded', 'Failed', 'Cancelled', 'Interrupted'] as const)(
    'never offers cancel or treats terminal %s as active', async (status) => {
      const f = fixture([snapshot(status)]);
      render(f.view());
      await screen.findByText('処理中・待機中のジョブはありません');
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
      expect(f.api.cancel).not.toHaveBeenCalled();
    });

  it.each(['denied', 'rejected', 'foreign'] as const)('surfaces %s cancellation and does not fake success', async (mode) => {
    const f = fixture([snapshot()]);
    if (mode === 'denied') vi.mocked(f.api.cancel).mockResolvedValue({ ok: false, error: { code: 'INVALID_STATE' } });
    if (mode === 'rejected') vi.mocked(f.api.cancel).mockRejectedValue(new Error('private path'));
    if (mode === 'foreign') vi.mocked(f.api.cancel).mockResolvedValue({ ok: true, value: { ...snapshot().job, projectId: otherProject } });
    render(f.view());
    await screen.findByText('処理中・待機中のジョブ：1件');
    fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByRole('alert')).toHaveTextContent('キャンセルを確認できません');
    expect(screen.getByRole('button')).toBeEnabled();
    expect(screen.queryByText(/private path/)).not.toBeInTheDocument();
    expect(screen.getByText(/実行中/)).toBeInTheDocument();
  });

  it('does not let a late cancel response overwrite a newer terminal notification', async () => {
    const f = fixture([snapshot()]);
    const result = deferred<Awaited<ReturnType<JobApi['cancel']>>>();
    vi.mocked(f.api.cancel).mockReturnValue(result.promise);
    render(f.view());
    await screen.findByText('処理中・待機中のジョブ：1件');
    fireEvent.click(screen.getByRole('button'));
    act(() => f.listeners[0]!({ ...snapshot('Cancelled'),
      job: { ...snapshot('Cancelled').job, updatedAt: '2026-09-21T00:00:01.000Z' } }));
    await act(async () => result.resolve({ ok: true, value: snapshot().job }));
    expect(screen.getByText('処理中・待機中のジョブはありません')).toBeInTheDocument();
  });

  it('clears old project data and ignores late events, cancellation and acknowledgements across A-B-A', async () => {
    const f = fixture();
    const ack = deferred<() => void>(), cancel = deferred<Awaited<ReturnType<JobApi['cancel']>>>();
    vi.mocked(f.api.subscribe).mockImplementationOnce(async (_id, listener) => {
      f.listeners.push(listener); listener(snapshot()); return ack.promise;
    });
    const mounted = render(f.view());
    mounted.rerender(f.view(otherProject));
    await waitFor(() => expect(f.api.subscribe).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(/Job ID/)).not.toBeInTheDocument();
    await act(async () => ack.resolve(f.stop));
    expect(f.stop).toHaveBeenCalledTimes(1);
    mounted.rerender(f.view());
    await screen.findByText('処理中・待機中のジョブはありません');
    act(() => f.listeners[0]!(snapshot()));
    expect(screen.queryByText(/Job ID/)).not.toBeInTheDocument();
    act(() => f.listeners[2]!(snapshot()));
    vi.mocked(f.api.cancel).mockReturnValue(cancel.promise);
    fireEvent.click(screen.getByRole('button'));
    mounted.rerender(f.view(otherProject));
    await act(async () => cancel.reject(new Error('old request')));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    mounted.unmount();
    expect(f.stop).toHaveBeenCalledTimes(4);
  });

  it('cleans StrictMode subscriptions and ignores disposed callbacks', async () => {
    const f = fixture([snapshot()]);
    const mounted = render(<StrictMode>{f.view()}</StrictMode>);
    await screen.findByText('処理中・待機中のジョブ：1件');
    expect(f.api.subscribe).toHaveBeenCalledTimes(2);
    expect(f.stop).toHaveBeenCalledTimes(1);
    act(() => f.listeners[0]!(snapshot('Cancelled')));
    expect(screen.getByText(/実行中/)).toBeInTheDocument();
    mounted.unmount();
    expect(f.stop).toHaveBeenCalledTimes(2);
  });

  it('shows subscription failure without exposing native errors or claiming an empty queue', async () => {
    const f = fixture();
    vi.mocked(f.api.subscribe).mockRejectedValue(new Error('C:\\private'));
    render(f.view());
    await screen.findByText('ジョブ通知を取得できません。状態は未確認です。');
    expect(screen.queryByText(/private|ジョブはありません/)).not.toBeInTheDocument();
  });

  it('rejects mismatched snapshots and disables action on unverified state', async () => {
    const f = fixture([snapshot()]);
    render(f.view());
    await screen.findByText('処理中・待機中のジョブ：1件');
    act(() => f.listeners[0]!({ ...snapshot(), job: { ...snapshot().job, projectId: otherProject }, progress: null }));
    expect(screen.getByText(/表示は最新ではありません/)).toBeInTheDocument();
    expect(screen.getByRole('button')).toBeDisabled();
  });
});
