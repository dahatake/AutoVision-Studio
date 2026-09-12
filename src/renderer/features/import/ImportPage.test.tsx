import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { Project } from '../../../shared/contracts/project';
import type { ImportApi, ImportPreview, ImportResult, ImportPreviewResponse, ImportCommitResponse, ImportStartResponse, ImportDiscardResponse } from '../../../shared/contracts/import-ipc';
import type { JobApi, JobSnapshot } from '../../../shared/contracts/job-ipc';
import { ImportPage, type ImportPageProps } from './ImportPage';
import { formatImportCount } from './ImportSummary';

const projectId = '11111111-1111-4111-8111-111111111111';
const jobId = '22222222-2222-4222-8222-222222222222';
const token = '33333333-3333-4333-8333-333333333333';
const otherId = '44444444-4444-4444-8444-444444444444';
const timestamp = '2026-09-13T00:00:00.000Z';
const project: Project = { id: projectId, name: 'ローカル実験', description: '', taskType: 'classification', workspacePath: 'C:\\PRIVATE', createdAt: timestamp, updatedAt: timestamp };
const job: JobSnapshot['job'] = { id: jobId, projectId, kind: 'scan-dataset', status: 'Running', createdAt: timestamp, updatedAt: timestamp };
const receipt: ImportResult = { status: 'completed', projectId, importId: token, workspaceId: token, itemCount: 1, cleanupWarning: false };
const scanned: ImportPreview = { projectId, jobId, mode: 'copy', taskType: 'classification', itemCount: 1, sourceBytes: '9007199254740993',
  classes: [{ key: '__proto__', name: '猫', sourceCategoryId: null }], files: [{ key: 'image-1', displayName: 'cat.png' }], issues: [] };
const correlation = { projectId, jobId, token };
const chooseButton = () => screen.getByRole('button', { name: 'データを選択して検査' });
const commitButton = () => screen.getByRole('button', { name: '取り込む' });
const discardButton = () => screen.getByRole('button', { name: '検査を破棄してやり直す' });
const rights = () => screen.getByRole('checkbox', { name: 'データの利用権利・条件と自分の責任を確認しました' });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function ports() {
  return {
    start: vi.fn<ImportApi['start']>().mockResolvedValue({ ok: true, value: { status: 'started', job, token } }),
    preview: vi.fn<ImportApi['preview']>().mockResolvedValue({ ok: true, value: scanned }),
    commit: vi.fn<ImportApi['commit']>().mockResolvedValue({ ok: true, value: receipt }),
    discard: vi.fn<ImportApi['discard']>().mockResolvedValue({ ok: true, value: null }),
  };
}
function mount(options: Partial<ImportPageProps> = {}) {
  const api = ports(); const onImported = vi.fn();
  const props: ImportPageProps = { project, api, onImported, ...options };
  return { ...render(<ImportPage {...props} />), api, onImported, props, user: userEvent.setup() };
}
async function choose(mode: 'copy' | 'reference' = 'copy', source = 'クラス別フォルダー') {
  fireEvent.click(screen.getByRole('radio', { name: source }));
  fireEvent.click(screen.getByRole('radio', { name: mode === 'copy' ? 'コピー（推奨）' : '参照' }));
  await act(async () => { chooseButton().click(); });
}

// Injected UI ports only. These tests do not establish Main transaction or native picker behavior.
describe('ImportPage UIR024 / DAT09', () => {
  it.each(['copy', 'reference'] as const)('requires explicit choices and consent for %s, with no automatic actions', async (mode) => {
    const h = mount(); h.api.preview.mockResolvedValue({ ok: true, value: { ...scanned, mode } });
    expect(chooseButton()).toBeDisabled();
    expect(screen.getAllByRole('radio').every((radio) => !(radio as HTMLInputElement).checked)).toBe(true);
    expect(h.api.start).not.toHaveBeenCalled(); expect(h.api.commit).not.toHaveBeenCalled();
    expect(h.container).not.toHaveTextContent('C:\\PRIVATE');
    await choose(mode);
    expect(h.api.start.mock.calls).toEqual([[{ projectId, mode, sourceKind: 'folder' }]]);
    expect(h.api.preview.mock.calls).toEqual([[correlation]]);
    expect(rights()).not.toBeChecked(); expect(commitButton()).toBeDisabled();
    expect(h.container).toHaveTextContent('9,007,199,254,740,993');
    expect(h.container).toHaveTextContent('法的な適合性を保証するものではありません');
    fireEvent.click(rights()); expect(h.api.commit).not.toHaveBeenCalled();
    await h.user.click(commitButton());
    expect(h.api.commit.mock.calls).toEqual([[{ ...correlation, rightsAccepted: true }]]);
    expect(h.onImported.mock.calls).toEqual([[receipt]]);
    expect(screen.getByRole('region', { name: '結果記録' })).toHaveTextContent('取り込み完了／画像は未確認です');
    expect(commitButton()).toBeDisabled(); expect(h.api.discard).not.toHaveBeenCalled();
  });

  it.each([
    ['classification', 'CSV ラベル', 'csv'],
    ['classification', 'ラベルなし・フォルダー', 'unlabeled-directory'],
    ['detection', 'COCO アノテーション', 'coco'],
    ['detection', 'ラベルなし・画像ファイル', 'unlabeled-files'],
  ] as const)('uses task-compatible %s / %s', async (taskType, label, sourceKind) => {
    const h = mount({ project: { ...project, taskType } });
    h.api.start.mockResolvedValue({ ok: true, value: { status: 'cancelled' } });
    expect(screen.queryByRole('radio', { name: taskType === 'classification' ? 'COCO アノテーション' : 'CSV ラベル' })).toBeNull();
    await choose('copy', label);
    expect(h.api.start).toHaveBeenCalledWith({ projectId, mode: 'copy', sourceKind });
    expect(h.api.preview).not.toHaveBeenCalled(); expect(h.api.discard).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull(); expect(chooseButton()).toBeEnabled();
  });

  it('guards same-turn duplicate picker and commit activation', async () => {
    const h = mount(); const picking = deferred<ImportStartResponse>(); const committing = deferred<ImportCommitResponse>();
    h.api.start.mockReturnValueOnce(picking.promise); h.api.commit.mockReturnValueOnce(committing.promise);
    await choose(); act(() => { chooseButton().click(); chooseButton().click(); });
    expect(h.api.start).toHaveBeenCalledTimes(1);
    await act(async () => { picking.resolve({ ok: true, value: { status: 'started', job, token } }); });
    fireEvent.click(rights()); const button = commitButton(); act(() => { button.click(); button.click(); });
    expect(h.api.commit).toHaveBeenCalledTimes(1); expect(rights()).toBeDisabled();
    await act(async () => { committing.resolve({ ok: true, value: { ...receipt, cleanupWarning: true } }); });
    expect(h.onImported).toHaveBeenCalledTimes(1); expect(screen.getByRole('alert')).toHaveTextContent('再実行しない');
  });

  it.each(['error', 'warning'] as const)('handles %s issues without discarding or exposing unknown codes', async (severity) => {
    const h = mount(); h.api.preview.mockResolvedValue({ ok: true, value: { ...scanned, issues: [{ severity, code: 'PRIVATE_UNKNOWN', imageKey: null, row: 7, itemId: 'C:\\PRIVATE' }] } });
    await choose(); fireEvent.click(rights());
    expect(commitButton().hasAttribute('disabled')).toBe(severity === 'error');
    expect(h.container).toHaveTextContent('元データを確認');
    expect(h.container).not.toHaveTextContent('PRIVATE_UNKNOWN'); expect(h.container).not.toHaveTextContent('C:\\PRIVATE');
    expect(h.api.discard).not.toHaveBeenCalled();
  });

  it('retains rights, names and exact capacity bytes for explicit retry', async () => {
    const h = mount(); h.api.commit.mockResolvedValueOnce({ ok: false, error: { code: 'IMPORT_CAPACITY', capacity: { requiredBytes: '18446744073709551615', availableBytes: '9007199254740993' } } });
    await choose(); fireEvent.change(screen.getByRole('textbox'), { target: { value: 'ねこ' } }); fireEvent.click(rights());
    await h.user.click(commitButton());
    expect(screen.getByRole('alert')).toHaveTextContent('18,446,744,073,709,551,615');
    expect(rights()).toBeChecked(); expect(screen.getByRole('textbox')).toHaveValue('ねこ');
    expect(commitButton()).toBeEnabled(); expect(h.api.commit).toHaveBeenCalledTimes(1);
    const sent = h.api.commit.mock.calls[0][0];
    expect(Object.hasOwn(sent.classNames!, '__proto__')).toBe(true); expect(sent.classNames!['__proto__']).toBe('ねこ');
    await h.user.click(commitButton()); expect(h.api.commit.mock.calls[1][0]).toEqual(sent);
  });

  it.each(['IMPORT_OUTCOME_UNCERTAIN', 'IMPORT_ATTENTION', 'rejected'] as const)('only explicitly rechecks the same request after %s', async (code) => {
    const h = mount();
    if (code === 'rejected') h.api.commit.mockRejectedValueOnce(new Error('C:\\PRIVATE'));
    else h.api.commit.mockResolvedValueOnce({ ok: false, error: { code } });
    await choose(); fireEvent.click(rights()); await h.user.click(commitButton());
    expect(rights()).toBeChecked(); expect(rights()).toBeDisabled(); expect(chooseButton()).toBeDisabled();
    expect(screen.queryByRole('button', { name: '検査を破棄してやり直す' })).toBeNull();
    expect(h.api.commit).toHaveBeenCalledTimes(1); expect(h.container).not.toHaveTextContent('C:\\PRIVATE');
    await h.user.click(screen.getByRole('button', { name: '状態を再確認' }));
    expect(h.api.commit.mock.calls[1][0]).toEqual(h.api.commit.mock.calls[0][0]);
    expect(h.onImported).toHaveBeenCalledTimes(1);
  });

  it('rejects Unicode whitespace names and escapes HTML-looking class/project text', async () => {
    const h = mount({ project: { ...project, name: '<img src=x onerror=alert(1)>' } });
    h.api.preview.mockResolvedValue({ ok: true, value: { ...scanned, classes: [{ key: 'constructor', name: '<script>alert(1)</script>', sourceCategoryId: null }] } });
    await choose(); fireEvent.click(rights());
    expect(h.container.querySelector('img, script')).toBeNull();
    expect(screen.getByRole('textbox')).toHaveValue('<script>alert(1)</script>');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '\u3000\u0085\u00a0' } });
    expect(commitButton()).toBeDisabled(); expect(screen.getByRole('textbox')).toHaveAttribute('aria-invalid', 'true');
    expect(h.api.commit).not.toHaveBeenCalled();
  });

  it('caps all three lists at 100 and preserves off-page names in the complete edited mapping', async () => {
    const h = mount();
    const many: ImportPreview = { ...scanned, itemCount: 101,
      files: Array.from({ length: 101 }, (_, i) => ({ key: `f${i}`, displayName: `file${i}.png` })),
      classes: Array.from({ length: 101 }, (_, i) => ({ key: `c${i}`, name: `class${i}`, sourceCategoryId: null })),
      issues: Array.from({ length: 101 }, () => ({ severity: 'warning', code: 'DUPLICATE_IMAGE', imageKey: null, row: null, itemId: null })),
    };
    h.api.preview.mockResolvedValue({ ok: true, value: many }); await choose();
    expect(screen.getAllByRole('textbox')).toHaveLength(100);
    expect(within(screen.getByRole('region', { name: 'ファイル一覧' })).getAllByRole('listitem')).toHaveLength(100);
    expect(within(screen.getByRole('region', { name: '問題一覧' })).getAllByRole('listitem')).toHaveLength(100);
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'changed' } });
    await h.user.click(screen.getByRole('button', { name: 'クラスの次の100件' }));
    expect(screen.getAllByRole('textbox')).toHaveLength(1); expect(screen.getByRole('textbox')).toHaveValue('class100');
    await h.user.click(screen.getByRole('button', { name: 'ファイルの次の100件' })); expect(screen.getByText('file100.png')).toBeVisible();
    await h.user.click(screen.getByRole('button', { name: '問題の次の100件' }));
    expect(within(screen.getByRole('region', { name: '問題一覧' })).getAllByRole('listitem')).toHaveLength(1);
    rights().focus(); await h.user.keyboard(' '); await h.user.tab(); expect(commitButton()).toHaveFocus();
    await h.user.keyboard('{Enter}');
    expect(Object.keys(h.api.commit.mock.calls[0][0].classNames!)).toHaveLength(101);
    expect(h.api.commit.mock.calls[0][0].classNames).toMatchObject({ c0: 'changed', c100: 'class100' });
  });

  it('starts preview before job success and unsubscribes even on late subscription ack', async () => {
    const h = mount(); const pending = deferred<ImportPreviewResponse>(); const ack = deferred<() => void>(); const unsubscribe = vi.fn();
    let listener!: (snapshot: JobSnapshot) => void;
    const jobs: JobApi = { list: vi.fn(), get: vi.fn(), cancel: vi.fn(), subscribe: vi.fn((_id, next) => { listener = next; return ack.promise; }) };
    h.rerender(<ImportPage {...h.props} jobs={jobs} />); h.api.preview.mockReturnValueOnce(pending.promise); await choose();
    expect(h.api.preview).toHaveBeenCalledTimes(1); expect(jobs.subscribe).toHaveBeenCalledWith(projectId, expect.any(Function));
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('value');
    act(() => { listener({ job: { ...job, projectId: otherId }, progress: null, workerCompleted: true }); });
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('value');
    act(() => { listener({ job, progress: { schemaVersion: 1, type: 'progress', source: 'actual', projectId, jobId, processed: 2, total: 4 }, workerCompleted: false }); });
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '2');
    expect(h.container).not.toHaveTextContent('workerCompleted');
    await act(async () => { pending.resolve({ ok: true, value: scanned }); });
    await act(async () => { ack.resolve(unsubscribe); }); expect(unsubscribe).toHaveBeenCalledTimes(1);
    h.unmount(); expect(unsubscribe).toHaveBeenCalledTimes(1); expect(h.api.discard).toHaveBeenCalledWith(correlation);
  });

  it.each(['resolve', 'reject'] as const)('discards the original scan and ignores stale preview %s through A-B-A', async (completion) => {
    const h = mount(); const pending = deferred<ImportPreviewResponse>(); h.api.preview.mockReturnValueOnce(pending.promise);
    await choose(); h.rerender(<ImportPage {...h.props} project={{ ...project, id: otherId }} />);
    h.rerender(<ImportPage {...h.props} />); expect(h.api.discard).toHaveBeenCalledWith(correlation);
    await act(async () => { if (completion === 'resolve') pending.resolve({ ok: true, value: scanned }); else pending.reject(new Error('private')); });
    expect(screen.queryByRole('checkbox')).toBeNull(); expect(screen.queryByRole('alert')).toBeNull(); expect(h.onImported).not.toHaveBeenCalled();
  });

  it('discards a picker result arriving after unmount without requesting preview', async () => {
    const h = mount(); const pending = deferred<ImportStartResponse>(); h.api.start.mockReturnValueOnce(pending.promise);
    await choose(); h.unmount();
    await act(async () => { pending.resolve({ ok: true, value: { status: 'started', token, job } }); });
    expect(h.api.discard.mock.calls).toEqual([[correlation]]); expect(h.api.preview).not.toHaveBeenCalled();
  });

  it('does not discard or deliver a callback for a commit finishing after navigation', async () => {
    const h = mount(); const pending = deferred<ImportCommitResponse>(); h.api.commit.mockReturnValueOnce(pending.promise);
    await choose(); fireEvent.click(rights()); await h.user.click(commitButton());
    h.rerender(<ImportPage {...h.props} project={{ ...project, id: otherId }} />); h.rerender(<ImportPage {...h.props} />);
    await act(async () => { pending.resolve({ ok: true, value: receipt }); });
    expect(h.api.discard).not.toHaveBeenCalled(); expect(h.onImported).not.toHaveBeenCalled(); expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('ignores preview during discard, then cleans up a subsequent scan on unmount', async () => {
    const h = mount(); const pending = deferred<ImportPreviewResponse>(); const discarding = deferred<ImportDiscardResponse>();
    h.api.preview.mockReturnValueOnce(pending.promise); h.api.discard.mockReturnValueOnce(discarding.promise); await choose();
    await h.user.click(discardButton());
    await act(async () => { pending.resolve({ ok: true, value: scanned }); });
    expect(screen.queryByRole('checkbox')).toBeNull(); expect(discardButton()).toBeDisabled();
    await act(async () => { discarding.resolve({ ok: true, value: null }); });
    await h.user.click(chooseButton()); expect(rights()).not.toBeChecked(); h.unmount();
    expect(h.api.discard).toHaveBeenCalledTimes(2);
  });

  it('keeps preview and consent after explicit discard failure', async () => {
    const h = mount(); await choose(); fireEvent.click(rights()); h.api.discard.mockRejectedValueOnce(new Error('private path'));
    await h.user.click(discardButton()); expect(screen.getByRole('alert')).toHaveTextContent('破棄を確認できません');
    expect(rights()).toBeChecked(); expect(screen.getByText('cat.png')).toBeVisible();
  });

  it('never invokes import automatically under StrictMode and formats 64-bit counts losslessly', () => {
    const api = ports(); render(<StrictMode><ImportPage project={project} api={api} onImported={vi.fn()} /></StrictMode>);
    expect(api.start).not.toHaveBeenCalled(); expect(api.commit).not.toHaveBeenCalled(); expect(api.discard).not.toHaveBeenCalled();
    expect(formatImportCount('18446744073709551615')).toBe('18,446,744,073,709,551,615');
  });
});