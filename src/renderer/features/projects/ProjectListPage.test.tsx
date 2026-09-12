import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { projectSnapshotSchema, type ProjectApi, type ProjectListResponse, type ProjectSnapshot } from '../../../shared/contracts/project-ipc';
import { ProjectListPage } from './ProjectListPage';

function snapshot(index = 1, fields: Partial<ProjectSnapshot['project']> = {}): ProjectSnapshot {
  return projectSnapshotSchema.parse({
    project: {
      id: `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`,
      name: `Project ${index}`, description: '', taskType: 'classification',
      workspacePath: `C:\\Projects\\00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`,
      createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-12T01:00:00.000Z', ...fields,
    }, taskTypeLocked: index % 2 === 1,
  });
}
const many = () => Array.from({ length: 25 }, (_, index) => snapshot(index + 1));
const success = (value: readonly ProjectSnapshot[]): ProjectListResponse => ({ ok: true, value });
const apiFor = (value: readonly ProjectSnapshot[] = [snapshot()]) => ({ list: vi.fn<ProjectApi['list']>().mockResolvedValue(success(value)) });
const callbacks = () => ({ onOpen: vi.fn<(value: ProjectSnapshot) => void>(), onSettings: vi.fn<(value: ProjectSnapshot) => void>(), onCreate: vi.fn<() => void>() });
const identity = ({ project }: ProjectSnapshot) => `${project.name}（${project.id}）`;
const nameSummary = (value: ProjectSnapshot) => screen.getByLabelText(`${identity(value)}の名前全文`, { normalizer: (text) => text });
const rows = () => within(screen.getByRole('list', { name: 'Project' })).queryAllByRole('listitem');
const ids = () => rows().map((row) => row.getAttribute('data-project-id'));
const pageButton = (direction: string) => screen.getByRole('button', { name: `Project: ${direction}のページ` });
function deferred() {
  let resolve!: (value: ProjectListResponse) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<ProjectListResponse>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function ready(api = apiFor()) {
  const actions = callbacks();
  const view = render(<ProjectListPage api={api} {...actions} />);
  await screen.findByText('取得済み');
  return { ...view, api, actions, user: userEvent.setup() };
}
async function visitAll(user: ReturnType<typeof userEvent.setup>) {
  await user.click(pageButton('最初'));
  const reached: (string | null)[] = [];
  // Finite traversal, even if a pagination regression never disables Next.
  for (let step = 0; step < 25; step++) {
    reached.push(...ids());
    if (pageButton('次').hasAttribute('disabled')) break;
    await user.click(pageButton('次'));
  }
  expect(pageButton('次')).toBeDisabled();
  return reached;
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('ProjectListPage', () => {
  it('accepts only explicit callbacks and list, with no false empty state before the mount request completes', () => {
    expectTypeOf<Parameters<typeof ProjectListPage>[0]>().toEqualTypeOf<{
      api: Pick<ProjectApi, 'list'>; onOpen: (snapshot: ProjectSnapshot) => void; onCreate: () => void;
      onSettings: (snapshot: ProjectSnapshot) => void; onDeletePreview?: (snapshot: ProjectSnapshot) => void;
      visible?: boolean; refreshKey?: number;
    }>();
    const task = deferred(), api = { list: vi.fn(() => task.promise) }, actions = callbacks();
    const { container } = render(<ProjectListPage api={api} {...actions} />);
    expect(api.list.mock.calls).toEqual([[]]);
    expect(screen.getByRole('status')).toHaveTextContent('取得中');
    expect(screen.getByText('件数 未取得')).toBeVisible();
    expect(container).not.toHaveTextContent(/0件|取得済み/);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(rows()).toHaveLength(0);
    expect(actions.onOpen).not.toHaveBeenCalled();
    expect(actions.onSettings).not.toHaveBeenCalled();
    expect(actions.onCreate).not.toHaveBeenCalled();
  });

  it('makes no request or DOM while initially hidden, then reveals an unknown pending count rather than zero', async () => {
    const task = deferred(), api = { list: vi.fn(() => task.promise) }, actions = callbacks();
    const { container, rerender } = render(<ProjectListPage api={api} {...actions} visible={false} />);
    expect(container).toBeEmptyDOMElement(); expect(api.list).not.toHaveBeenCalled();
    rerender(<ProjectListPage api={api} {...actions} visible={false} refreshKey={1} />);
    expect(container).toBeEmptyDOMElement(); expect(api.list).not.toHaveBeenCalled();
    rerender(<ProjectListPage api={api} {...actions} visible refreshKey={1} />);
    expect(api.list.mock.calls).toEqual([[]]); expect(screen.getByText('件数 未取得')).toBeVisible();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(container).not.toHaveTextContent(/0件|取得済み/);
    await act(async () => { task.resolve(success([snapshot()])); });
    expect(ids()).toEqual([snapshot().project.id]);
    for (const callback of Object.values(actions)) expect(callback).not.toHaveBeenCalled();
  });

  it.each(['resolve', 'reject'] as const)('retains query/page while hidden and rejects its late %s before a fresh reveal request', async (completion) => {
    const values = many(), { api, user, actions, container, rerender } = await ready(apiFor(values));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Project 2' } });
    await user.click(pageButton('最後'));
    const target = screen.getByRole('button', { name: `${identity(values[24])}の設定` }); act(() => target.focus());
    const previous = ids(), searchId = screen.getByRole('searchbox').id;
    const old = deferred(); api.list.mockReturnValueOnce(old.promise);
    await user.click(screen.getByRole('button', { name: '再取得' }));
    rerender(<ProjectListPage api={api} {...actions} visible={false} />);
    expect(container).toBeEmptyDOMElement(); expect(target).not.toBeInTheDocument();
    await act(async () => {
      if (completion === 'resolve') old.resolve(success([snapshot(99)])); else old.reject(new Error('private path'));
    });
    expect(container).toBeEmptyDOMElement(); expect(api.list).toHaveBeenCalledTimes(2);
    const current = deferred(); api.list.mockReturnValueOnce(current.promise);
    rerender(<ProjectListPage api={api} {...actions} visible />);
    expect(api.list).toHaveBeenCalledTimes(3); expect(ids()).toEqual(previous);
    expect(screen.getByRole('searchbox')).toHaveValue('Project 2'); expect(screen.getByRole('searchbox')).toHaveAttribute('id', searchId);
    expect(screen.getByRole('status')).toHaveTextContent('取得中 — 前回の一覧（最新ではありません）');
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull(); expect(container).not.toHaveTextContent(/Project 99|private path|0件/);
    await act(async () => { current.resolve(success(values)); });
    expect(ids()).toEqual(previous); expect(screen.getByRole('status')).toHaveTextContent(/^取得済み$/);
    await user.click(screen.getByRole('button', { name: `${identity(values[24])}の設定` }));
    expect(actions.onSettings).toHaveBeenCalledExactlyOnceWith(values[24]);
  });

  it('uses refreshKey without resetting search or the anchor, ignoring older keys and callback-only rerenders', async () => {
    const values = many(), { api, actions, user, rerender, container } = await ready(apiFor(values));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Project 2' } });
    await user.click(pageButton('最後'));
    act(() => screen.getByRole('button', { name: `${identity(values[24])}を開く` }).focus());
    const previous = ids(), first = deferred(), second = deferred();
    api.list.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    rerender(<ProjectListPage api={api} {...actions} refreshKey={1} />);
    expect(ids()).toEqual(previous); expect(screen.getByRole('searchbox')).toHaveValue('Project 2');
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('前回の一覧（最新ではありません）');
    const next = callbacks(); rerender(<ProjectListPage api={api} {...next} refreshKey={1} />);
    expect(api.list).toHaveBeenCalledTimes(2);
    rerender(<ProjectListPage api={api} {...next} refreshKey={2} />);
    expect(api.list).toHaveBeenCalledTimes(3);
    const renamed = snapshot(25, { name: 'Project 25 最新', updatedAt: '2026-09-12T05:00:00.000Z' });
    await act(async () => { second.resolve(success([...values.slice(0, 24), renamed])); });
    await act(async () => { first.resolve(success([snapshot(99)])); });
    expect(ids()).toContain(renamed.project.id); expect(ids()[0]).toBe(renamed.project.id);
    expect(screen.getByRole('searchbox')).toHaveValue('Project 2'); expect(screen.getByRole('status')).toHaveTextContent(/^取得済み$/);
    await user.click(screen.getByRole('button', { name: `${identity(renamed)}を開く` }));
    expect(next.onOpen).toHaveBeenCalledExactlyOnceWith(renamed); expect(actions.onOpen).not.toHaveBeenCalled();
  });

  it.each([0, 1])('shows an actual %d-item result and disables both pagination boundaries', async (count) => {
    const { api } = await ready(apiFor(Array.from({ length: count }, (_, i) => snapshot(i + 1))));
    expect(rows()).toHaveLength(count);
    for (const direction of ['最初', '前', '次', '最後']) expect(pageButton(direction)).toBeDisabled();
    if (count === 0) expect(screen.getByText('Project は0件です。作成から始められます。')).toBeVisible();
    else expect(screen.getByText('Project 1', { selector: 'span' })).toBeVisible();
    expect(api.list.mock.calls).toEqual([[]]);
  });

  it('shows the five required labels, real type/time, and three explicitly unobserved values', async () => {
    const value = snapshot(1, { taskType: 'detection' });
    const { container } = await ready(apiFor([value]));
    const row = rows()[0];
    for (const [label, expected] of [['タスク種別', '物体検出'], ['最新Run状態', '未取得'], ['選択モデル', '未取得'], ['使用容量', '未取得']]) {
      expect(within(row).getByText(label, { selector: 'dt' }).nextElementSibling).toHaveTextContent(expected);
    }
    expect(row.querySelectorAll('dt')).toHaveLength(5);
    expect(within(row).getByText('最終更新日時', { selector: 'dt' }).nextElementSibling?.querySelector('time')).toHaveAttribute('datetime', value.project.updatedAt);
    expect(within(row).getAllByText('未取得')).toHaveLength(3);
    expect(container).not.toHaveTextContent(/0 B|モデルなし|学習成功|C:\\Projects/);
    expect(container.querySelector('img, video, audio, canvas, iframe, [src]')).toBeNull();
    for (const icon of container.querySelectorAll('svg')) {
      expect(icon).toHaveClass('system-icon'); expect(icon).toHaveAttribute('aria-hidden', 'true'); expect(icon).toHaveAttribute('focusable', 'false');
    }
  });

  it('uses exact displayed snapshots for same-name projects, without other API or global access', async () => {
    const values = [snapshot(1, { name: '同じ名前' }), snapshot(2, { name: '同じ名前' })];
    const original = structuredClone(values), listApi = apiFor(values), actions = callbacks();
    const forbidden = vi.fn(() => { throw new Error('Not a list operation'); });
    const api = { ...listApi, get: forbidden, create: forbidden, update: forbidden, move: forbidden, pickParent: forbidden, recover: forbidden } satisfies ProjectApi;
    vi.stubGlobal('autoVision', { projects: { list: forbidden } });
    const onDeletePreview = vi.fn<(value: ProjectSnapshot) => void>();
    const { container } = render(<ProjectListPage api={api} {...actions} onDeletePreview={onDeletePreview} />);
    await screen.findByText('取得済み'); const user = userEvent.setup();
    expect(onDeletePreview).not.toHaveBeenCalled();
    for (const [index, value] of values.entries()) {
      await user.click(screen.getByRole('button', { name: `${identity(value)}を開く` }));
      await user.click(screen.getByRole('button', { name: `${identity(value)}の設定` }));
      await user.click(screen.getByRole('button', { name: `${identity(value)}の削除対象を確認` }));
      const delivered = actions.onOpen.mock.calls[index][0];
      expect(delivered).toEqual(value);
      expect(actions.onSettings.mock.calls[index][0]).toBe(delivered);
      expect(onDeletePreview.mock.calls[index][0]).toBe(delivered);
      expect(container.textContent).not.toContain(value.project.id);
      expect(rows()[index].querySelector('[title]')).toHaveAttribute('title', identity(value));
    }
    await user.click(screen.getByRole('button', { name: 'Project を作成' }));
    expect(actions.onCreate.mock.calls).toEqual([[]]); expect(values).toEqual(original);
    expect(forbidden).not.toHaveBeenCalled(); expect(listApi.list.mock.calls).toEqual([[]]);
  });

  it('keeps delete explicitly unimplemented without a fake handler when preview is not supplied', async () => {
    const { user, api } = await ready();
    const button = screen.getByRole('button', { name: `${identity(snapshot())}の削除対象を確認（未実装）` });
    expect(button).toHaveTextContent('削除（未実装）'); expect(button).toBeDisabled();
    await user.click(button); expect(api.list).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull(); expect(rows()).toHaveLength(1);
  });

  it.each(['INVALID_REQUEST', 'NOT_FOUND', 'BUSY', 'OPERATION_FAILED', 'STALE_SELECTION'] as const)('allows list retry independently of the %s API failure', async (code) => {
    const api = apiFor(); api.list.mockResolvedValueOnce({ ok: false, error: { code } });
    const actions = callbacks(), { container } = render(<ProjectListPage api={api} {...actions} />);
    await screen.findByText(`取得失敗（${code}）。再試行してください。`);
    expect(container).not.toHaveTextContent('0件'); expect(rows()).toHaveLength(0);
    await userEvent.setup().click(screen.getByRole('button', { name: '再試行' }));
    await screen.findByText('取得済み'); expect(rows()).toHaveLength(1);
    expect(api.list.mock.calls).toEqual([[], []]);
  });

  it.each(['throw', 'reject', 'invalid-error'] as const)('never exposes native errors or paths: %s', async (kind) => {
    const api = apiFor(), secret = 'C:\\private\\secret.txt';
    if (kind === 'throw') api.list.mockImplementationOnce(() => { throw new Error(secret); });
    else if (kind === 'reject') api.list.mockRejectedValueOnce(new Error(secret));
    else api.list.mockResolvedValueOnce({ ok: false, error: { code: secret, message: secret } } as unknown as ProjectListResponse);
    const { container } = render(<ProjectListPage api={api} {...callbacks()} />);
    await screen.findByText(/取得失敗（OPERATION_FAILED）/);
    expect(container).not.toHaveTextContent(/private|secret|0件/);
    expect(screen.getByRole('button', { name: '再試行' })).toBeEnabled();
  });

  it.each([
    ['invalid UUID', { ...snapshot(), project: { ...snapshot().project, id: 'not-a-uuid' } }],
    ['invalid date', { ...snapshot(), project: { ...snapshot().project, updatedAt: 'yesterday' } }],
    ['missing lock', { project: snapshot().project }],
    ['invalid lock', { ...snapshot(), taskTypeLocked: 'false' }],
    ['invented stats', { ...snapshot(), latestRun: 'Succeeded', capacity: 0 }],
  ])('validates the entire response at the boundary: %s', async (_name, invalid) => {
    const api = apiFor(); api.list.mockResolvedValueOnce({ ok: true, value: [invalid] } as unknown as ProjectListResponse);
    const { container } = render(<ProjectListPage api={api} {...callbacks()} />);
    await screen.findByText(/取得失敗/); expect(rows()).toHaveLength(0);
    expect(container).not.toHaveTextContent(/Succeeded|yesterday|0件/);
  });

  it('rejects duplicate canonical IDs rather than rendering ambiguous React keys', async () => {
    const api = apiFor([snapshot(), snapshot()]);
    render(<ProjectListPage api={api} {...callbacks()} />);
    await screen.findByText(/取得失敗/); expect(rows()).toHaveLength(0);
  });

  it.each(['NOT_FOUND', 'OPERATION_FAILED', 'rejection'] as const)('preserves the previous page and marks it stale during and after failed refresh: %s', async (failure) => {
    const { user, api } = await ready(apiFor(many()));
    await user.click(pageButton('次')); const previous = ids();
    const task = deferred(); api.list.mockReturnValueOnce(task.promise);
    await user.click(screen.getByRole('button', { name: '再取得' }));
    expect(ids()).toEqual(previous); expect(screen.getByRole('status')).toHaveTextContent('取得中 — 前回の一覧（最新ではありません）');
    await act(async () => {
      if (failure === 'rejection') task.reject(new Error('private path'));
      else task.resolve({ ok: false, error: { code: failure } });
    });
    expect(ids()).toEqual(previous); expect(screen.getByRole('status')).toHaveTextContent('前回の一覧（最新ではありません）');
    expect(screen.queryByText(/Project は0件/)).toBeNull();
    await user.click(screen.getByRole('button', { name: '再試行' }));
    await screen.findByText('取得済み'); expect(ids()).toEqual(previous);
    expect(api.list.mock.calls).toEqual([[], [], []]);
  });

  it('does not present a previously empty list as a fresh zero after refresh failure', async () => {
    const { api, user } = await ready(apiFor([]));
    api.list.mockRejectedValueOnce(new Error('private'));
    await user.click(screen.getByRole('button', { name: '再取得' }));
    expect(screen.getByRole('status')).toHaveTextContent('取得失敗');
    expect(screen.getByRole('status')).toHaveTextContent('前回の一覧（最新ではありません）');
    expect(screen.getByText('前回の一覧に表示対象はありません（最新ではありません）。')).toBeVisible();
    expect(screen.queryByText('Project は0件です。作成から始められます。')).toBeNull();
  });

  it.each(['resolve', 'reject'] as const)('ignores older refresh completion after the newest request: %s', async (completion) => {
    const { user, api } = await ready(); const older = deferred(), newer = deferred();
    api.list.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    await user.click(screen.getByRole('button', { name: '再取得' }));
    await user.click(screen.getByRole('button', { name: '再取得' }));
    await act(async () => { newer.resolve(success([snapshot(2)])); });
    await act(async () => { if (completion === 'resolve') older.resolve(success([snapshot(3)])); else older.reject(new Error('private')); });
    expect(ids()).toEqual([snapshot(2).project.id]); expect(screen.getByRole('status')).toHaveTextContent(/^取得済み$/);
    expect(api.list.mock.calls).toEqual([[], [], []]);
  });

  it.each(['resolve', 'reject'] as const)('ignores the old API on replacement: %s', async (completion) => {
    const old = deferred(), current = deferred(), actions = callbacks();
    const api = { list: vi.fn(() => old.promise) }, next = { list: vi.fn(() => current.promise) };
    const { rerender, container } = render(<ProjectListPage api={api} {...actions} />);
    rerender(<ProjectListPage api={next} {...actions} />);
    await act(async () => { if (completion === 'resolve') old.resolve(success([snapshot()])); else old.reject(new Error('private')); });
    expect(rows()).toHaveLength(0); expect(screen.getByRole('status')).toHaveTextContent('取得中');
    await act(async () => { current.reject(new Error('another private path')); });
    expect(container).not.toHaveTextContent(/Project 1|0件|private/);
    expect(screen.getByRole('status')).toHaveTextContent('取得失敗');
  });

  it('clears completed results and request contexts across A -> B -> A without reviving old data', async () => {
    const { api, actions, rerender, container, user } = await ready(apiFor(many()));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Project 2' } }); await user.click(pageButton('最後'));
    const b = deferred(), renewedA = deferred(), next = { list: vi.fn(() => b.promise) };
    rerender(<ProjectListPage api={next} {...actions} visible={false} />);
    expect(container).toBeEmptyDOMElement(); expect(next.list).not.toHaveBeenCalled();
    rerender(<ProjectListPage api={next} {...actions} />); expect(rows()).toHaveLength(0);
    api.list.mockReturnValueOnce(renewedA.promise);
    rerender(<ProjectListPage api={api} {...actions} />); expect(rows()).toHaveLength(0);
    expect(screen.getByRole('searchbox')).toHaveValue(''); expect(pageButton('前')).toBeDisabled();
    await act(async () => { b.resolve(success([snapshot(2)])); }); expect(rows()).toHaveLength(0);
    await act(async () => { renewedA.resolve(success([snapshot(3)])); });
    expect(ids()).toEqual([snapshot(3).project.id]); expect(api.list).toHaveBeenCalledTimes(2); expect(next.list).toHaveBeenCalledTimes(1);
  });

  it.each(['resolve', 'reject'] as const)('ignores late completion after unmount: %s', async (completion) => {
    const task = deferred(), api = { list: vi.fn(() => task.promise) }, actions = callbacks();
    const { unmount, container } = render(<ProjectListPage api={api} {...actions} />); unmount();
    await act(async () => { if (completion === 'resolve') task.resolve(success([snapshot()])); else task.reject(new Error('private')); });
    expect(container).toBeEmptyDOMElement(); expect(api.list.mock.calls).toEqual([[]]);
    for (const callback of Object.values(actions)) expect(callback).not.toHaveBeenCalled();
  });

  it.each(['resolve', 'reject'] as const)('invalidates the discarded StrictMode mount request: %s', async (completion) => {
    const first = deferred(), second = deferred();
    const api = { list: vi.fn<ProjectApi['list']>().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise) };
    render(<StrictMode><ProjectListPage api={api} {...callbacks()} /></StrictMode>);
    await act(async () => { if (completion === 'resolve') first.resolve(success([snapshot()])); else first.reject(new Error('private')); });
    expect(rows()).toHaveLength(0); expect(screen.getByRole('status')).toHaveTextContent('取得中');
    await act(async () => { second.resolve(success([snapshot(2)])); });
    expect(ids()).toEqual([snapshot(2).project.id]); expect(api.list.mock.calls).toEqual([[], []]);
  });

  it('searches names/descriptions locally with canonical Unicode and case matching, not compatibility rewriting', async () => {
    const values = [snapshot(1, { name: 'Cafe\u0301_日本🧪', description: 'APPLE support' }), snapshot(2, { name: 'ＡＢＣ' }), snapshot(3, { name: 'ABC' })];
    const { api, user, actions } = await ready(apiFor(values));
    const input = screen.getByRole('searchbox', { name: '名前・説明を検索' });
    for (const [query, expected] of [['CAFÉ', 0], ['apple', 0], ['日本', 0], ['abc', 2], ['ａｂｃ', 1]] as const) {
      fireEvent.change(input, { target: { value: query } }); expect(ids()).toEqual([values[expected].project.id]);
    }
    fireEvent.change(input, { target: { value: 'missing' } });
    expect(screen.getByText('検索結果は0件です。検索条件を変更してください。')).toBeVisible();
    expect(screen.getByRole('navigation', { name: 'Project のページ送り' })).toHaveTextContent('0件（全3件）');
    expect(screen.queryByText(/Project は0件/)).toBeNull();
    fireEvent.change(input, { target: { value: '' } }); expect(ids()).toEqual(values.map(({ project }) => project.id));
    await user.click(screen.getByRole('button', { name: `${identity(values[0])}を開く` }));
    expect(actions.onOpen.mock.calls[0][0].project.name).toBe('Cafe\u0301_日本🧪'); expect(api.list.mock.calls).toEqual([[]]);
  });

  it('makes all 25 IDs reachable with a five-row unmeasured fallback and native first/previous/next/last controls', async () => {
    const values = many(), { user, api } = await ready(apiFor(values));
    expect(rows()).toHaveLength(5); expect(pageButton('最初')).toBeDisabled(); expect(pageButton('前')).toBeDisabled();
    expect(await visitAll(user)).toEqual(values.map(({ project }) => project.id));
    await user.click(pageButton('最初')); expect(ids()).toEqual(values.slice(0, 5).map(({ project }) => project.id));
    await user.click(pageButton('最後')); expect(ids()).toEqual(values.slice(20).map(({ project }) => project.id));
    await user.click(pageButton('前')); expect(ids()).toEqual(values.slice(15, 20).map(({ project }) => project.id));
    for (const direction of ['最初', '前', '次', '最後']) {
      expect(pageButton(direction)).toHaveAttribute('type', 'button');
      expect(pageButton(direction)).toHaveAttribute('aria-controls', screen.getByRole('list', { name: 'Project' }).id);
    }
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Project 25' } });
    expect(ids()).toEqual([values[24].project.id]); expect(pageButton('次')).toBeDisabled();
    expect(api.list.mock.calls).toEqual([[]]);
  });

  it('sorts real update timestamps descending and preserves server order on ties without mutating snapshots', async () => {
    const values = [snapshot(1, { updatedAt: '2026-09-10T01:00:00Z' }), snapshot(3), snapshot(2)];
    const before = structuredClone(values); await ready(apiFor(values));
    expect(ids()).toEqual([values[1].project.id, values[2].project.id, values[0].project.id]); expect(values).toEqual(before);
  });

  it('keeps explicit native keyboard actions working while pending and does not reload on callback changes', async () => {
    const task = deferred(), api = { list: vi.fn(() => task.promise) }, actions = callbacks();
    const { rerender } = render(<ProjectListPage api={api} {...actions} />);
    const user = userEvent.setup(), create = screen.getByRole('button', { name: 'Project を作成' });
    act(() => create.focus()); await user.keyboard('{Enter}'); expect(actions.onCreate.mock.calls).toEqual([[]]);
    await act(async () => { task.resolve(success([snapshot()])); });
    const next = callbacks(); rerender(<ProjectListPage api={api} {...next} />);
    const open = screen.getByRole('button', { name: `${identity(snapshot())}を開く` });
    act(() => open.focus()); await user.keyboard(' '); expect(next.onOpen).toHaveBeenCalledWith(snapshot());
    expect(actions.onOpen).not.toHaveBeenCalled(); expect(api.list.mock.calls).toEqual([[]]);
  });

  it('preserves a 256-grapheme Unicode/newline name through bounded inline full-name pages', async () => {
    const units = Array.from({ length: 256 }, (_, i) => i === 0 ? '先' : i === 255 ? '終' : i % 23 === 0 ? '\r\n' : i % 11 === 0 ? '👩🏽‍💻' : i % 7 === 0 ? 'e\u0301' : '名');
    const name = units.join(''), value = snapshot(1, { name });
    const { user, api } = await ready(apiFor([value]));
    const summary = nameSummary(value); await user.click(summary);
    const details = summary.closest('details')!; expect(details).toHaveAttribute('open');
    const content = details.querySelector('p')!, chunks: string[] = [];
    const segments = new Intl.Segmenter('ja', { granularity: 'grapheme' });
    for (let step = 0; step < 256; step++) {
      const text = content.textContent!; chunks.push(text);
      expect(Array.from(segments.segment(text)).length).toBeLessThanOrEqual(40);
      expect((text.match(/\r\n|[\r\n\u2028\u2029]/gu) ?? []).length).toBeLessThanOrEqual(2);
      expect(content.childElementCount).toBe(0);
      const next = within(details).getByRole('button', { name: '名前全文: 次のページ' });
      expect(next).toHaveAttribute('aria-controls', content.id);
      if (next.hasAttribute('disabled')) break;
      await user.click(next);
    }
    expect(chunks.join('')).toBe(name);
    expect(within(details).getByRole('button', { name: '名前全文: 次のページ' })).toBeDisabled();
    await user.click(within(details).getByRole('button', { name: '名前全文: 前のページ' }));
    expect(content.textContent).toBe(chunks[chunks.length - 2]);
    await user.click(summary); expect(details).not.toHaveAttribute('open'); expect(summary).toHaveFocus();
    expect(ids()).toEqual([value.project.id]); expect(api.list.mock.calls).toEqual([[]]);
  });

  it('handles newline-heavy names and resets inline name pages when the same project is renamed', async () => {
    const name = `先${'\n\r\n\u2028\u2029'.repeat(30)}終`, value = snapshot(1, { name });
    const { user, api } = await ready(apiFor([value]));
    await user.click(nameSummary(value));
    const details = rows()[0].querySelector('details')!, content = details.querySelector('p')!;
    expect((content.textContent!.match(/\r\n|[\r\n\u2028\u2029]/gu) ?? []).length).toBeLessThanOrEqual(2);
    await user.click(within(details).getByRole('button', { name: '名前全文: 次のページ' }));
    const renamed = snapshot(1, { name: '新しい名前'.repeat(40) }); api.list.mockResolvedValueOnce(success([renamed]));
    await user.click(screen.getByRole('button', { name: '再取得' }));
    await screen.findByText('取得済み');
    const summary = nameSummary(renamed); await user.click(summary);
    const updated = summary.closest('details')!;
    expect(updated.querySelector('p')!.textContent).toBe('新しい名前'.repeat(8));
    expect(within(updated).getByRole('button', { name: '名前全文: 前のページ' })).toBeDisabled();
    expect(ids()).toEqual([value.project.id]); expect(api.list.mock.calls).toEqual([[], []]);
  });

  it('renders hostile names as text, not markup, links, or script', async () => {
    const name = '<img src=x onerror=alert(1)>', value = snapshot(1, { name, description: '<script>private()</script>' });
    const { container, user, actions } = await ready(apiFor([value]));
    expect(screen.getByText(name)).toBeVisible(); expect(container.querySelector('img, script, a, [onerror]')).toBeNull();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'private()' } }); expect(rows()).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: `${identity(value)}を開く` })); expect(actions.onOpen).toHaveBeenCalledWith(value);
  });
});

describe('ProjectListPage measured paging (synthetic dimensions, NOT real viewport/density evidence)', () => {
  let rootHeight: number, width: number, headerHeight: number, pagerHeight: number;
  const heights = new Map<string, number>();
  const observers = new Set<TestResizeObserver>();
  class TestResizeObserver implements ResizeObserver {
    readonly targets = new Set<Element>();
    constructor(private readonly callback: ResizeObserverCallback) { observers.add(this); }
    observe(target: Element) { this.targets.add(target); }
    unobserve(target: Element) { this.targets.delete(target); }
    disconnect() { this.targets.clear(); observers.delete(this); }
    deliver() { this.callback([], this); }
  }
  const resize = () => act(() => { for (const observer of [...observers]) observer.deliver(); });
  beforeEach(() => {
    rootHeight = 368; width = 1280; headerHeight = 72; pagerHeight = 40; heights.clear(); observers.clear();
    vi.stubGlobal('ResizeObserver', TestResizeObserver); vi.stubGlobal('innerHeight', 1000);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      let height = 0;
      if (this.classList.contains('project-list-page')) height = rootHeight;
      else if (this.classList.contains('project-list-page__header')) height = headerHeight;
      else if (this.classList.contains('project-list-page__pager')) height = pagerHeight;
      else if (this.classList.contains('project-list-page__row')) height = heights.get(this.dataset.projectId!) ?? (width < 1024 ? 96 : 48);
      return new DOMRect(0, 0, width, height);
    });
  });

  it('observes root/header/pager/rows and increases visible rows while retaining the focused project ID', async () => {
    const values = many(), { user, api } = await ready(apiFor(values));
    expect(rows()).toHaveLength(5); expect(observers.size).toBe(1);
    const targets = [...observers][0].targets;
    for (const selector of ['.project-list-page', '.project-list-page__header', '.project-list-page__pager', '.project-list-page__row']) {
      expect(targets.has(document.querySelector(selector)!)).toBe(true);
    }
    await user.click(pageButton('次'));
    const focused = screen.getByRole('button', { name: `${identity(values[7])}を開く` }); act(() => focused.focus());
    rootHeight = 608; resize();
    expect(rows()).toHaveLength(10); expect(ids()).toContain(values[7].project.id); expect(focused).toHaveFocus();
    rootHeight = 368; width = 640; resize();
    expect(rows()).toHaveLength(2); expect(ids()).toContain(values[7].project.id); expect(focused).toHaveFocus();
    expect(await visitAll(user)).toEqual(values.map(({ project }) => project.id)); expect(api.list.mock.calls).toEqual([[]]);
  });

  it('keeps the final ID visible when a previously unmeasured last page splits after navigation', async () => {
    const values = many().slice(0, 23);
    for (const value of values) heights.set(value.project.id, 96);
    const { user, api } = await ready(apiFor(values));
    expect(ids()).not.toContain(values.at(-1)!.project.id);
    await user.click(pageButton('最後'));
    expect(ids()).toContain(values.at(-1)!.project.id);
    expect(pageButton('次')).toBeDisabled(); expect(pageButton('最後')).toBeDisabled();
    resize(); resize();
    expect(ids()).toContain(values.at(-1)!.project.id);
    expect(pageButton('次')).toBeDisabled(); expect(pageButton('最後')).toBeDisabled();
    expect(api.list).toHaveBeenCalledTimes(1);
  });

  it('retains off-page measurements and the last anchor while hidden, disconnecting and reconnecting observation', async () => {
    const values = many(); heights.set(values[0].project.id, 300);
    const { api, actions, user, rerender, container } = await ready(apiFor(values));
    await user.click(pageButton('最後'));
    const previous = ids(); expect(previous).toContain(values[24].project.id);
    rerender(<ProjectListPage api={api} {...actions} visible={false} />);
    expect(container).toBeEmptyDOMElement(); expect(observers.size).toBe(0);
    // Off-page rows are not remeasured on reveal; their previous measurements remain.
    heights.delete(values[0].project.id);
    const task = deferred(); api.list.mockReturnValueOnce(task.promise);
    rerender(<ProjectListPage api={api} {...actions} visible />);
    expect(observers.size).toBe(1); expect(ids()).toEqual(previous);
    expect(screen.getByRole('status')).toHaveTextContent('前回の一覧（最新ではありません）');
    await act(async () => { task.resolve(success(values)); });
    expect(ids()).toEqual(previous); expect(api.list).toHaveBeenCalledTimes(2);
    width = 640; resize(); resize();
    expect(ids()).toContain(values[24].project.id); expect(pageButton('次')).toBeDisabled();
  });

  it('subtracts expanded header and pager measurements, never reducing a page below one row', async () => {
    await ready(apiFor(many()));
    headerHeight = 168; resize(); expect(rows()).toHaveLength(3);
    pagerHeight = 136; resize(); expect(rows()).toHaveLength(1);
    rootHeight = 200; resize(); expect(rows()).toHaveLength(1); expect(pageButton('次')).toBeEnabled();
  });

  it('remembers oversized row measurements across pages without oscillation, with every ID still reachable', async () => {
    const values = many(); heights.set(values[0].project.id, 300);
    const { user, api } = await ready(apiFor(values));
    expect(ids()).toEqual([values[0].project.id]); resize(); resize(); expect(ids()).toEqual([values[0].project.id]);
    await user.click(pageButton('次')); expect(rows()).toHaveLength(5);
    expect(await visitAll(user)).toEqual(values.map(({ project }) => project.id));
    await user.click(pageButton('最初')); expect(ids()).toEqual([values[0].project.id]); expect(api.list).toHaveBeenCalledTimes(1);
  });

  it('uses window resize when ResizeObserver is absent and disconnects observers on unmount', async () => {
    const first = await ready(apiFor(many())); first.unmount(); expect(observers.size).toBe(0);
    vi.stubGlobal('ResizeObserver', undefined);
    const second = await ready(apiFor(many()));
    rootHeight = 608; act(() => { window.dispatchEvent(new Event('resize')); });
    expect(rows()).toHaveLength(10); second.unmount(); expect(observers.size).toBe(0);
    act(() => { window.dispatchEvent(new Event('resize')); }); expect(second.container).toBeEmptyDOMElement();
  });
});