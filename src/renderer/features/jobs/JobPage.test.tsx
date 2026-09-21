import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { JobKind, JobStatus } from '../../../shared/contracts/job';
import type { JobApi, JobSnapshot } from '../../../shared/contracts/job-ipc';
import { JobPage } from './JobPage';
import { JobProvider, JobStatusBar } from './JobStatusBar';

const projectId = '11111111-1111-4111-8111-111111111111';
const otherProject = '22222222-2222-4222-8222-222222222222';
function snapshot(index: number, status: JobStatus, kind: JobKind = 'train'): JobSnapshot {
  return {
    job: { id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, projectId, kind, status,
      createdAt: `2026-09-21T00:00:${String(index).padStart(2, '0')}.000Z`,
      updatedAt: `2026-09-21T00:00:${String(index).padStart(2, '0')}.000Z` },
    progress: null, workerCompleted: false,
  };
}
function fixture(initial: readonly JobSnapshot[] = []) {
  const listeners: ((snapshot: JobSnapshot) => void)[] = [];
  const api: JobApi = {
    list: vi.fn(), get: vi.fn(),
    cancel: vi.fn<JobApi['cancel']>().mockImplementation(async (_project, id) => ({
      ok: true, value: { ...initial.find(({ job }) => job.id === id)!.job, status: 'Cancelled',
        updatedAt: '2026-09-21T01:00:00.000Z' },
    })),
    subscribe: vi.fn<JobApi['subscribe']>().mockImplementation(async (id, listener) => {
      listeners.push(listener);
      initial.filter(({ job }) => job.projectId === id).forEach(listener);
      return vi.fn<() => void>();
    }),
  };
  const back = vi.fn();
  const view = (id: string | null = projectId, port: JobApi | null = api) =>
    <JobProvider projectId={id} api={port}>
      <JobPage projectName="検証Project" onBack={back} />
      <JobStatusBar />
    </JobProvider>;
  return { api, listeners, back, view };
}
const page = () => within(screen.getByRole('region', { name: 'ジョブ一覧' }));
afterEach(cleanup);

describe('W2-32 JobPage', () => {
  it('lists all queue and terminal states in creation order without starting, resuming or retrying anything', async () => {
    const statuses: JobStatus[] = ['Queued', 'Preparing', 'Running', 'Exporting', 'Evaluating',
      'Succeeded', 'Failed', 'Cancelled', 'Interrupted'];
    const values = statuses.map((status, index) => snapshot(index + 1, status,
      index === 1 ? 'assist' : index === 2 ? 'scan-dataset' : 'train'));
    const f = fixture([...values].reverse());
    render(f.view());
    await page().findByText('全9件 ／ 待機中1件 ／ 処理中4件');
    const rows = page().getAllByRole('listitem');
    expect(rows).toHaveLength(9);
    rows.forEach((row, index) => {
      expect(row).toHaveTextContent(`（${statuses[index]}）`);
      expect(row).toHaveTextContent(`Job ID：${values[index]!.job.id}`);
      expect(row).toHaveTextContent(values[index]!.job.createdAt);
    });
    expect(page().getByText(/補助候補生成 — 準備中/)).toBeInTheDocument();
    expect(page().getByText(/画像の検査 — 実行中/)).toBeInTheDocument();
    expect(page().getAllByRole('button', { name: /をキャンセル/ })).toHaveLength(5);
    expect(page().getAllByText('キャンセル不可（終端状態）')).toHaveLength(4);
    expect(page().queryByRole('button', { name: /再開|再試行/ })).not.toBeInTheDocument();
    expect(f.api.subscribe).toHaveBeenCalledTimes(1);
    expect(f.api.cancel).not.toHaveBeenCalled();
    expect(f.api.list).not.toHaveBeenCalled(); expect(f.api.get).not.toHaveBeenCalled();
    fireEvent.click(page().getByRole('button', { name: '作業画面に戻る' }));
    expect(f.back).toHaveBeenCalledTimes(1);
  });

  it('cancels a queued job explicitly and synchronizes the status bar without removing history', async () => {
    const value = snapshot(1, 'Queued'), f = fixture([value]);
    render(f.view());
    await page().findByText('全1件 ／ 待機中1件 ／ 処理中0件');
    fireEvent.click(page().getByRole('button', { name: /をキャンセル/ }));
    await page().findByText(/キャンセル済み（Cancelled）/);
    expect(f.api.cancel).toHaveBeenCalledExactlyOnceWith(projectId, value.job.id);
    expect(page().getAllByRole('listitem')).toHaveLength(1);
    expect(page().queryByRole('button', { name: /をキャンセル/ })).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: '共通ジョブ' }))
      .getByText('処理中・待機中のジョブはありません')).toBeInTheDocument();
  });

  it('keeps running status until cancellation is confirmed and shares duplicate suppression with the bar', async () => {
    const value = snapshot(1, 'Running'), f = fixture([value]);
    vi.mocked(f.api.cancel).mockResolvedValue({ ok: true, value: value.job });
    render(f.view());
    await page().findByText('全1件 ／ 待機中0件 ／ 処理中1件');
    await act(async () => fireEvent.click(page().getByRole('button', { name: /をキャンセル/ })));
    for (const button of screen.getAllByRole('button', { name: /をキャンセル/ })) {
      expect(button).toBeDisabled(); expect(button).toHaveTextContent('キャンセル確認待ち');
      fireEvent.click(button);
    }
    expect(f.api.cancel).toHaveBeenCalledTimes(1);
    expect(page().getByText(/実行中（Running）/)).toBeInTheDocument();
    act(() => f.listeners[0]!({ ...value, job: { ...value.job, status: 'Cancelled' } }));
    expect(page().getByText(/キャンセル済み（Cancelled）/)).toBeInTheDocument();
  });

  it('renders updates and new queued jobs while rejecting an older snapshot', async () => {
    const value = snapshot(1, 'Running'), f = fixture([value]);
    render(f.view());
    await page().findByText('全1件 ／ 待機中0件 ／ 処理中1件');
    act(() => {
      f.listeners[0]!(snapshot(2, 'Queued'));
      f.listeners[0]!({ ...value, job: { ...value.job, status: 'Succeeded', updatedAt: '2026-09-21T01:00:00.000Z' } });
      f.listeners[0]!(value);
    });
    expect(page().getByText('全2件 ／ 待機中1件 ／ 処理中0件')).toBeInTheDocument();
    expect(page().getByText(/成功（Succeeded）/)).toBeInTheDocument();
  });

  it('reports cancellation failures and only retries on another explicit click', async () => {
    const value = snapshot(1, 'Queued'), f = fixture([value]);
    vi.mocked(f.api.cancel).mockResolvedValue({ ok: false, error: { code: 'BUSY' } });
    render(f.view());
    await page().findByText('全1件 ／ 待機中1件 ／ 処理中0件');
    fireEvent.click(page().getByRole('button', { name: /をキャンセル/ }));
    expect(await page().findByRole('alert')).toHaveTextContent('ほかの処理が実行中');
    expect(f.api.cancel).toHaveBeenCalledTimes(1);
    await act(async () => fireEvent.click(page().getByRole('button', { name: /をキャンセル/ })));
    expect(f.api.cancel).toHaveBeenCalledTimes(2);
  });

  it('distinguishes empty, no project, unavailable and subscription failure without fake counts', async () => {
    const f = fixture();
    const mounted = render(f.view(null));
    expect(page().getByText('Project を選択してください。')).toBeInTheDocument();
    mounted.rerender(f.view(projectId, null));
    expect(page().getByRole('alert')).toHaveTextContent('状態は未確認');
    mounted.rerender(f.view());
    await page().findByText('ジョブはありません。');
    vi.mocked(f.api.subscribe).mockRejectedValue(new Error('private'));
    mounted.rerender(f.view(otherProject));
    await page().findByRole('alert');
    expect(page().queryByText('ジョブはありません。')).not.toBeInTheDocument();
    expect(page().queryByText(/全0件|private/)).not.toBeInTheDocument();
  });

  it('does not show an empty queue before subscription acknowledgement', async () => {
    const f = fixture();
    let resolve!: (stop: () => void) => void;
    vi.mocked(f.api.subscribe).mockReturnValue(new Promise((done) => { resolve = done; }));
    render(f.view());
    expect(page().getByText('ジョブを取得中')).toBeInTheDocument();
    expect(page().queryByText(/全0件|ジョブはありません/)).not.toBeInTheDocument();
    await act(async () => resolve(vi.fn()));
    expect(page().getByText('ジョブはありません。')).toBeInTheDocument();
  });

  it('clears history on project change and rejects callbacks from the previous project', async () => {
    const f = fixture([snapshot(1, 'Interrupted')]);
    const mounted = render(f.view());
    await page().findByText(/中断（Interrupted）/);
    mounted.rerender(f.view(otherProject));
    await page().findByText('ジョブはありません。');
    act(() => f.listeners[0]!(snapshot(2, 'Running')));
    expect(page().queryByRole('list')).not.toBeInTheDocument();
  });
});
