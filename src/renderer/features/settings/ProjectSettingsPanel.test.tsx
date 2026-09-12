import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import {
  PROJECT_SOURCE_CLEANUP_FAILED_MESSAGE,
  projectGetResponseSchema, projectMoveResponseSchema, projectPickParentResponseSchema,
  projectSnapshotSchema, projectUpdateInputSchema, projectUpdateResponseSchema,
  type ProjectApi, type ProjectGetResponse, type ProjectMoveResponse, type ProjectPickParentResponse,
  type ProjectSnapshot, type ProjectUpdateResponse,
} from '../../../shared/contracts/project-ipc';
import { ProjectSettingsPanel, type ProjectSettingsPanelProps } from './ProjectSettingsPanel';

const projectA = 'abcdefab-1234-4123-8123-abcdefabcdef';
const projectB = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const token = '11111111-1111-4111-8111-111111111111';
const nextToken = '33333333-3333-4333-8333-333333333333';
const parentPath = 'D:\\選択した親 🧪';
const movedPath = `E:\\DBで確認した移動先\\${projectA}`;
const privateDetail = 'PRIVATE_NATIVE_PATH_STACK';

function saved(changes: Partial<ProjectSnapshot['project']> = {}, taskTypeLocked = false): ProjectSnapshot {
  return projectSnapshotSchema.parse({
    project: { id: projectA.toUpperCase(), name: '保存済みの名前', description: '保存済みの説明', taskType: 'classification',
      workspacePath: `C:\\Project\\${projectA}`, createdAt: '2026-09-12T01:00:00.000Z', updatedAt: '2026-09-12T01:00:00.000Z', ...changes },
    taskTypeLocked,
  });
}
function updated(value = saved()) { return projectUpdateResponseSchema.parse({ ok: true, value }); }
function readback(value = saved()) { return projectGetResponseSchema.parse({ ok: true, value }); }
function selected(parentToken = token, displayPath = parentPath) {
  return projectPickParentResponseSchema.parse({ ok: true, value: { status: 'selected', token: parentToken, displayPath } });
}
function movement(cleanupStatus: 'none' | 'completed' | 'source-retained', value = saved({ workspacePath: movedPath }), warning = false) {
  return projectMoveResponseSchema.parse({ ok: true, value: { ...value, cleanupStatus,
    ...(warning ? { cleanupError: { code: 'PROJECT_SOURCE_CLEANUP_FAILED', message: PROJECT_SOURCE_CLEANUP_FAILED_MESSAGE } } : {}) } });
}
function apiFor(snapshot = saved()) {
  return {
    update: vi.fn<ProjectApi['update']>().mockResolvedValue(updated(snapshot)),
    get: vi.fn<ProjectApi['get']>().mockResolvedValue(readback(snapshot)),
    pickParent: vi.fn<ProjectApi['pickParent']>().mockResolvedValue(selected()),
    move: vi.fn<ProjectApi['move']>().mockResolvedValue(movement('completed')),
    recover: vi.fn<ProjectApi['recover']>().mockResolvedValue(movement('none', snapshot)),
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function mount(snapshot = saved(), api = apiFor(snapshot)) {
  const onSaved = vi.fn<(value: ProjectSnapshot) => void>();
  const onBack = vi.fn<() => void>();
  return { ...render(<ProjectSettingsPanel snapshot={snapshot} api={api} onSaved={onSaved} onBack={onBack} />),
    snapshot, api, onSaved, onBack, user: userEvent.setup() };
}
function show(h: ReturnType<typeof mount>, snapshot = h.snapshot, visible = true, api = h.api) {
  h.rerender(<ProjectSettingsPanel snapshot={snapshot} api={api} onSaved={h.onSaved} onBack={h.onBack} visible={visible} />);
}
const nameField = () => screen.getByRole('textbox', { name: '名前（必須）' });
const description = () => screen.getByRole('textbox', { name: '説明（任意）' });
const descriptionOpener = () => screen.getByRole('button', { name: '説明を編集（任意）' });
const inputsBack = () => screen.getByRole('button', { name: '入力項目に戻る' });
const submit = () => screen.getByRole('button', { name: 'Project情報を保存' });
const picker = () => screen.getByRole('button', { name: '移動先の親フォルダーを選択' });
const move = () => screen.getByRole('button', { name: '保存場所を変更' });
const recover = () => screen.getByRole('button', { name: '旧領域の復旧を確認' });
const check = () => screen.getByRole('button', { name: '保存結果を確認' });
const discard = () => screen.getByRole('button', { name: '未保存の変更を破棄' });
const status = () => screen.getByRole('status');
const form = () => screen.getByRole('form', { name: 'Project 設定' });
const editName = (value = '未保存の名前') => fireEvent.change(nameField(), { target: { value } });
async function editDescription(h: ReturnType<typeof mount>, value = '未保存の説明') {
  await h.user.click(descriptionOpener()); fireEvent.change(description(), { target: { value } });
  await h.user.click(inputsBack()); return value;
}
async function readyMove(h = mount()) {
  await h.user.click(picker()); expect(screen.getByText(parentPath)).toBeVisible(); return h;
}
function expectUnknown(h: ReturnType<typeof mount>, metadata = true) {
  expect(status()).toHaveTextContent(metadata ? '保存結果不明' : '保存場所の処理結果不明');
  expect(screen.getByText('保存先（前回確認値・現在は未確認）')).toBeVisible();
  expect(submit()).toBeDisabled(); expect(picker()).toBeDisabled(); expect(move()).toBeDisabled(); expect(recover()).toBeDisabled();
  expect(discard()).toBeDisabled(); expect(h.container).not.toHaveTextContent(privateDetail);
}

// Planned DOM/contract cases only. No native dialog, filesystem, viewport,
// Narrator, actual job/camera or Main/Preload integration claim follows from these tests.
describe('ProjectSettingsPanel (UIR-023)', () => {
  it('exposes the exact stable-instance props and only Project metadata and explicit fixed operations', () => {
    expectTypeOf<ProjectSettingsPanelProps>().toEqualTypeOf<{
      snapshot: ProjectSnapshot;
      api: Pick<ProjectApi, 'update' | 'get' | 'pickParent' | 'move' | 'recover'>;
      onSaved: (snapshot: ProjectSnapshot) => void;
      onBack: () => void;
      visible?: boolean;
    }>();
    const h = mount();
    expect(form()).toHaveClass('project-form'); expect(nameField()).toHaveValue(h.snapshot.project.name); expect(nameField()).toBeRequired();
    expect(screen.getByRole('radio', { name: '画像分類' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '物体検出' })).toBeEnabled(); expect(status()).toHaveTextContent('Project情報：保存済み');
    expect(submit()).toBeDisabled(); expect(move()).toBeDisabled(); expect(screen.queryByRole('textbox', { name: '説明（任意）' })).toBeNull();
    const root = h.container.querySelector('.project-form__destination .project-form__path');
    expect(root?.textContent).toBe(h.snapshot.project.workspacePath); expect(root).toHaveAttribute('tabindex', '0');
    expect(h.container.querySelector('input[name="workspacePath"], input[name="parentToken"], [contenteditable]')).toBeNull();
    expect(screen.queryByRole('button', { name: /削除|書き出す/ })).toBeNull();
    expect(h.container).not.toHaveTextContent(/HPO|threshold|Profile|モデル版/);
    expect(screen.getAllByRole('status')).toHaveLength(1); expect(h.container.querySelectorAll('[aria-live]')).toHaveLength(1);
    for (const method of Object.values(h.api)) expect(method).not.toHaveBeenCalled();
    expect(h.onSaved).not.toHaveBeenCalled(); expect(h.onBack).not.toHaveBeenCalled();
  });

  it('does not read API getters, start jobs/media/workers, or open URL-looking display text on render or visibility changes', () => {
    const backing = apiFor(), access = vi.fn();
    const api: ProjectSettingsPanelProps['api'] = Object.freeze({
      get update() { access('update'); return backing.update; }, get get() { access('get'); return backing.get; },
      get pickParent() { access('pick'); return backing.pickParent; }, get move() { access('move'); return backing.move; },
      get recover() { access('recover'); return backing.recover; },
    });
    const fetch = vi.fn(), worker = vi.fn(), camera = vi.fn(), devices = vi.fn();
    vi.stubGlobal('fetch', fetch); vi.stubGlobal('Worker', worker);
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: camera, enumerateDevices: devices } });
    try {
      const path = 'https://169.254.169.254/latest/meta-data/?not-a-request=<script>private</script>';
      const snapshot = saved({ workspacePath: path }); const onSaved = vi.fn(), onBack = vi.fn();
      const view = render(<StrictMode><ProjectSettingsPanel snapshot={snapshot} api={api} onSaved={onSaved} onBack={onBack} /></StrictMode>);
      expect(view.container.querySelector('.project-form__destination .project-form__path')?.textContent).toBe(path);
      expect(view.container.querySelector('a, img, video, audio, canvas, iframe, script, [src], input[type="file"]')).toBeNull();
      view.rerender(<StrictMode><ProjectSettingsPanel snapshot={snapshot} api={api} onSaved={onSaved} onBack={onBack} visible={false} /></StrictMode>);
      expect(view.container).toBeEmptyDOMElement();
      view.rerender(<StrictMode><ProjectSettingsPanel snapshot={snapshot} api={api} onSaved={onSaved} onBack={onBack} /></StrictMode>);
      expect(access).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled(); expect(worker).not.toHaveBeenCalled();
      expect(camera).not.toHaveBeenCalled(); expect(devices).not.toHaveBeenCalled(); expect(onSaved).not.toHaveBeenCalled();
      view.unmount();
    } finally { vi.unstubAllGlobals(); }
  });

  it.each(['', ' \t ', '\u3000\u00a0'])('validates trim-empty names locally and keeps the draft: %j', async (value) => {
    const h = mount(); editName(value); await h.user.click(submit());
    expect(nameField()).toHaveValue(value); expect(nameField()).toHaveAttribute('aria-invalid', 'true');
    expect(nameField()).toHaveAccessibleDescription('Project名を入力してください。'); expect(h.api.update).not.toHaveBeenCalled();
    editName('  正しい名前  '); expect(nameField()).toHaveAttribute('aria-invalid', 'false');
    await h.user.click(submit()); expect(h.api.update.mock.calls[0][0].name).toBe('正しい名前');
  });

  it('sends exactly id/name/description/taskType and displays the matching normalized DB response and its actual lock', async () => {
    const h = mount(); const notes = '  説明 🌾\n二行目  '; editName('  依頼名 👩🏽‍💻  ');
    await h.user.click(screen.getByRole('radio', { name: '物体検出' })); await editDescription(h, notes);
    const confirmed = saved({ name: 'DBで正規化した名前', description: 'DBで確定した説明', taskType: 'detection' }, true);
    h.api.update.mockResolvedValueOnce(updated(confirmed)); await h.user.click(submit());
    const payload = { id: projectA, name: '依頼名 👩🏽‍💻', description: notes, taskType: 'detection' };
    expect(h.api.update.mock.calls).toEqual([[payload]]); expect(projectUpdateInputSchema.parse(payload)).toEqual(payload);
    expect(Object.keys(h.api.update.mock.calls[0][0]).sort()).toEqual(['description', 'id', 'name', 'taskType']);
    expect(h.onSaved.mock.calls).toEqual([[confirmed]]); expect(nameField()).toHaveValue(confirmed.project.name);
    expect(status()).toHaveTextContent('Project情報：保存済み'); expect(screen.getByRole('radio', { name: '物体検出' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '画像分類' })).toBeDisabled(); expect(nameField()).toBeEnabled();
    await h.user.click(descriptionOpener()); expect(description()).toHaveValue(confirmed.project.description);
    expect(h.api.pickParent).not.toHaveBeenCalled(); expect(h.api.move).not.toHaveBeenCalled(); expect(h.api.recover).not.toHaveBeenCalled();
  });

  it('retains long native textarea drafts and other fields through the dedicated description view without new length limits', async () => {
    const h = mount(); editName('編集中の名前'); await h.user.click(screen.getByRole('radio', { name: '物体検出' }));
    expect(nameField()).not.toHaveAttribute('maxlength'); await h.user.click(descriptionOpener());
    expect(description().tagName).toBe('TEXTAREA'); expect(description()).not.toHaveAttribute('maxlength'); expect(description()).toHaveFocus();
    fireEvent.change(description(), { target: { value: '  行 e\u0301 👩🏽‍💻\n'.repeat(500) } }); await h.user.keyboard('{Enter}');
    const notes = (description() as HTMLTextAreaElement).value; expect(h.api.update).not.toHaveBeenCalled();
    await h.user.click(inputsBack()); expect(descriptionOpener()).toHaveFocus(); expect(nameField()).toHaveValue('編集中の名前');
    expect(screen.getByRole('radio', { name: '物体検出' })).toBeChecked();
    await h.user.click(descriptionOpener()); expect(description()).toHaveValue(notes);
  });

  it('merges same-ID saved props into pristine fields only, keeps dirty text on lock transitions, and discards to the newest base', async () => {
    const h = mount(); editName('保持する名前');
    const next = saved({ name: '別の保存名', description: '新しい保存済み説明', taskType: 'detection' }); show(h, next);
    expect(nameField()).toHaveValue('保持する名前'); expect(screen.getByRole('radio', { name: '物体検出' })).toBeChecked();
    await h.user.click(descriptionOpener()); expect(description()).toHaveValue(next.project.description);
    fireEvent.change(description(), { target: { value: '保持する説明' } }); await h.user.click(inputsBack());
    const locked = saved({ ...next.project, description: 'さらに新しい保存値' }, true); show(h, locked);
    expect(nameField()).toHaveValue('保持する名前'); expect(screen.getByRole('radio', { name: '物体検出' })).toBeDisabled();
    await h.user.click(descriptionOpener()); expect(description()).toHaveValue('保持する説明');
    await h.user.click(discard()); expect(description()).toHaveValue(locked.project.description); await h.user.click(inputsBack());
    expect(nameField()).toHaveValue(locked.project.name); expect(status()).toHaveTextContent('Project情報：保存済み');
    expect(h.api.update).not.toHaveBeenCalled(); expect(h.onSaved).not.toHaveBeenCalled();
  });

  it('never silently drops a dirty task choice when locked, and restores just that field by explicit choice', async () => {
    const h = mount(); editName('保持する名前'); await editDescription(h, '保持する説明');
    await h.user.click(screen.getByRole('radio', { name: '物体検出' })); show(h, saved({}, true));
    expect(screen.getByRole('radio', { name: '物体検出' })).toBeChecked(); expect(submit()).toBeDisabled();
    fireEvent.submit(form()); expect(h.api.update).not.toHaveBeenCalled();
    await h.user.click(screen.getByRole('button', { name: 'タスク種別の変更を破棄' }));
    expect(screen.getByRole('radio', { name: '画像分類' })).toBeChecked(); expect(nameField()).toHaveValue('保持する名前');
    await h.user.click(descriptionOpener()); expect(description()).toHaveValue('保持する説明'); await h.user.click(inputsBack());
    const confirmed = saved({ name: '保持する名前', description: '保持する説明' }, true); h.api.update.mockResolvedValueOnce(updated(confirmed));
    await h.user.click(submit()); expect(h.api.update.mock.calls[0][0].taskType).toBe('classification');
    show(h, saved(confirmed.project, false)); expect(screen.getByRole('radio', { name: '物体検出' })).toBeEnabled();
  });

  it.each(['INVALID_REQUEST', 'NOT_FOUND', 'BUSY', 'STALE_SELECTION'] as const)('keeps failed metadata and shows only safe Japanese for a known refusal: %s', async (code) => {
    const h = mount(); editName(); await editDescription(h); h.api.update.mockResolvedValueOnce({ ok: false, error: { code } });
    await h.user.click(submit()); expect(status()).toHaveTextContent('保存失敗'); expect(status()).not.toHaveTextContent('保存結果不明');
    expect(nameField()).toHaveValue('未保存の名前'); expect(submit()).toBeEnabled(); expect(picker()).toBeDisabled();
    expect(h.container).not.toHaveTextContent(code); expect(h.onSaved).not.toHaveBeenCalled();
    if (code === 'BUSY') expect(status()).toHaveTextContent('停止せず、完了を待ってください。');
    await h.user.click(descriptionOpener()); expect(description()).toHaveValue('未保存の説明');
    expect(h.api.get).not.toHaveBeenCalled(); expect(h.api.recover).not.toHaveBeenCalled();
  });

  const untrustedUpdates: [string, unknown][] = [
    ['missing-lock', { ok: true, value: { project: saved().project } }],
    ['other-project', { ok: true, value: saved({ id: projectB, name: privateDetail }) }],
    ['unknown-code-native-details', { ok: false, error: { code: 'constructor', message: privateDetail, stack: privateDetail } }],
  ];
  it.each(untrustedUpdates)('does not acknowledge or display untrusted update output: %s', async (_label, value) => {
    const h = mount(); editName(); h.api.update.mockResolvedValueOnce(value as ProjectUpdateResponse);
    await h.user.click(submit()); expectUnknown(h); expect(nameField()).toHaveValue('未保存の名前');
    expect(h.onSaved).not.toHaveBeenCalled(); expect(h.api.get).not.toHaveBeenCalled();
    fireEvent.submit(form()); expect(h.api.update).toHaveBeenCalledTimes(1);
  });

  it.each(['OPERATION_FAILED', 'reject', 'throw'] as const)('keeps an unacknowledged metadata write uncertain without retry: %s', async (failure) => {
    const h = mount(); editName();
    if (failure === 'OPERATION_FAILED') h.api.update.mockResolvedValueOnce({ ok: false, error: { code: failure } });
    else if (failure === 'reject') h.api.update.mockRejectedValueOnce(new Error(privateDetail));
    else h.api.update.mockImplementationOnce(() => { throw new Error(privateDetail); });
    await h.user.click(submit()); expectUnknown(h); show(h, saved()); expectUnknown(h);
    fireEvent.submit(form()); fireEvent.click(picker()); fireEvent.click(recover());
    expect(h.api.update).toHaveBeenCalledTimes(1); expect(h.api.pickParent).not.toHaveBeenCalled();
    expect(h.api.get).not.toHaveBeenCalled(); expect(h.api.recover).not.toHaveBeenCalled(); expect(h.onSaved).not.toHaveBeenCalled();
  });

  it('requires explicit successful get before retry, retains dirty fields on readback, and does not treat a failed read as resolution', async () => {
    const h = mount(); editName(); await editDescription(h); h.api.update.mockResolvedValueOnce({ ok: false, error: { code: 'OPERATION_FAILED' } });
    await h.user.click(submit()); h.api.get.mockResolvedValueOnce({ ok: false, error: { code: 'BUSY' } });
    await h.user.click(check()); expectUnknown(h); expect(check()).toBeEnabled();
    const current = saved({ name: '現在のDB名', description: '現在のDB説明', workspacePath: movedPath });
    h.api.get.mockResolvedValueOnce(readback(current)); await h.user.click(check());
    expect(h.api.get.mock.calls).toEqual([[{ projectId: projectA }], [{ projectId: projectA }]]);
    expect(nameField()).toHaveValue('未保存の名前'); expect(screen.getByText(movedPath)).toBeVisible();
    expect(status()).toHaveTextContent('Project情報：未保存'); expect(submit()).toBeEnabled(); expect(h.api.update).toHaveBeenCalledTimes(1);
    await h.user.click(descriptionOpener()); expect(description()).toHaveValue('未保存の説明'); await h.user.click(inputsBack());
    expect(h.onSaved.mock.calls).toEqual([[current]]); await h.user.click(submit()); expect(h.api.update).toHaveBeenCalledTimes(2);
    expect(h.api.update.mock.calls[1][0]).toEqual({ id: projectA, name: '未保存の名前', description: '未保存の説明', taskType: 'classification' });
  });

  it.each(['other-project', 'malformed', 'reject'] as const)('keeps uncertainty and drafts when the explicit get cannot be trusted: %s', async (failure) => {
    const h = mount(); editName(); h.api.update.mockResolvedValueOnce({ ok: false, error: { code: 'OPERATION_FAILED' } }); await h.user.click(submit());
    if (failure === 'reject') h.api.get.mockRejectedValueOnce(new Error(privateDetail));
    else h.api.get.mockResolvedValueOnce((failure === 'other-project'
      ? { ok: true, value: saved({ id: projectB, workspacePath: privateDetail }) }
      : { ok: true, value: { project: saved().project } }) as ProjectGetResponse);
    await h.user.click(check()); expectUnknown(h); expect(nameField()).toHaveValue('未保存の名前');
    expect(h.onSaved).not.toHaveBeenCalled(); fireEvent.submit(form()); expect(h.api.update).toHaveBeenCalledTimes(1);
  });

  it('does not overwrite newer saved props or a real task lock with an older same-ID save acknowledgement', async () => {
    const h = mount(); editName(); const task = deferred<ProjectUpdateResponse>(); h.api.update.mockReturnValueOnce(task.promise);
    await h.user.click(submit()); show(h, saved({ description: '新しいDB説明', updatedAt: '2026-09-12T02:00:00.000Z' }, true));
    await act(async () => { task.resolve(updated(saved({ name: '古い応答名' }, false))); });
    expectUnknown(h); expect(nameField()).toHaveValue('未保存の名前'); expect(screen.getByRole('radio', { name: '物体検出' })).toBeDisabled();
    expect(h.onSaved).not.toHaveBeenCalled();
  });

  it('guards IME and same-turn repeated saves, disables busy controls, and leaves navigation available without job cancellation', async () => {
    const h = mount(); editName(); const input = nameField();
    expect(fireEvent.keyDown(input, { key: 'Enter', isComposing: true })).toBe(false);
    expect(fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })).toBe(false);
    fireEvent.compositionStart(input); fireEvent.submit(form()); expect(h.api.update).not.toHaveBeenCalled(); fireEvent.compositionEnd(input);
    const task = deferred<ProjectUpdateResponse>(); h.api.update.mockReturnValueOnce(task.promise);
    act(() => { submit().click(); fireEvent.submit(form()); submit().click(); });
    expect(h.api.update).toHaveBeenCalledTimes(1); expect(status()).toHaveTextContent('保存中');
    for (const control of [nameField(), descriptionOpener(), submit(), picker(), move(), recover(), check(), discard()]) expect(control).toBeDisabled();
    const back = screen.getByRole('button', { name: '未保存の変更を保持して戻る' }); expect(back).toBeEnabled();
    expect(fireEvent.keyDown(back, { key: 'Enter' })).toBe(true); expect(status()).toHaveTextContent('戻っても保存処理は取り消されません。');
    fireEvent.click(picker()); fireEvent.click(check()); fireEvent.click(recover());
    expect(h.api.pickParent).not.toHaveBeenCalled(); expect(h.api.get).not.toHaveBeenCalled(); expect(h.api.recover).not.toHaveBeenCalled();
    await act(async () => { task.resolve(updated(saved({ name: '未保存の名前' }))); }); expect(h.onSaved).toHaveBeenCalledTimes(1);
  });

  it('keeps unsaved text and the description view on explicit back and hidden/reopened stable-instance navigation', async () => {
    const h = mount(); editName(); await h.user.click(descriptionOpener()); fireEvent.change(description(), { target: { value: '保持する詳細' } });
    const back = screen.getByRole('button', { name: '未保存の変更を保持して戻る' }); act(() => { back.click(); back.click(); });
    expect(h.onBack.mock.calls).toEqual([[]]); expect(h.container).toBeEmptyDOMElement();
    show(h, h.snapshot, false); show(h); expect(description()).toHaveValue('保持する詳細');
    await h.user.click(inputsBack()); expect(nameField()).toHaveValue('未保存の名前'); expect(status()).toHaveTextContent('未保存');
    for (const method of Object.values(h.api)) expect(method).not.toHaveBeenCalled();
  });

  it('retains realized A/B drafts independently across hidden A -> B -> A without keying or leaking fields', async () => {
    const h = mount(); const b = saved({ id: projectB, name: 'B 保存名', description: 'B 保存説明', taskType: 'detection' });
    editName('A draft'); await editDescription(h, 'A 説明'); show(h, h.snapshot, false); show(h, b, false); show(h, b);
    expect(nameField()).toHaveValue('B 保存名'); expect(screen.getByRole('radio', { name: '物体検出' })).toBeChecked();
    editName('B draft'); await editDescription(h, 'B 説明'); show(h, h.snapshot);
    expect(nameField()).toHaveValue('A draft'); expect(screen.getByRole('radio', { name: '画像分類' })).toBeChecked();
    await h.user.click(descriptionOpener()); expect(description()).toHaveValue('A 説明');
    show(h, b); expect(nameField()).toHaveValue('B draft'); await h.user.click(descriptionOpener()); expect(description()).toHaveValue('B 説明');
    expect(h.api.update).not.toHaveBeenCalled(); expect(h.api.get).not.toHaveBeenCalled();
  });

  it('does not revive a pending save after hide/show and requires get only after the original request has settled', async () => {
    const h = mount(); editName(); const task = deferred<ProjectUpdateResponse>(); h.api.update.mockReturnValueOnce(task.promise);
    await h.user.click(submit()); show(h, h.snapshot, false); expect(h.container).toBeEmptyDOMElement(); show(h);
    expectUnknown(h); expect(check()).toBeDisabled(); fireEvent.click(check()); expect(h.api.get).not.toHaveBeenCalled();
    show(h, h.snapshot, false); await act(async () => { task.resolve(updated(saved({ name: '遅い保存結果' }))); }); show(h);
    expectUnknown(h); expect(check()).toBeEnabled(); expect(nameField()).toHaveValue('未保存の名前'); expect(h.onSaved).not.toHaveBeenCalled();
    h.api.get.mockResolvedValueOnce(readback(saved({ name: '遅い保存結果' }))); await h.user.click(check());
    expect(h.onSaved).toHaveBeenCalledTimes(1); expect(submit()).toBeEnabled();
  });

  it('clears old-session drafts on API A -> B -> A and never revives the first API A promise', async () => {
    const h = mount(); const b = saved({ id: projectB, name: 'B 保存名' }); show(h, b); editName('B old draft'); show(h);
    editName('A old draft'); const old = deferred<ProjectUpdateResponse>(); h.api.update.mockReturnValueOnce(old.promise); await h.user.click(submit());
    const nextApi = apiFor(); show(h, h.snapshot, true, nextApi); expect(nameField()).toHaveValue(h.snapshot.project.name);
    editName('新context draft'); show(h); expect(nameField()).toHaveValue(h.snapshot.project.name);
    await act(async () => { old.resolve(updated(saved({ name: privateDetail }))); });
    expect(h.onSaved).not.toHaveBeenCalled(); expect(h.container).not.toHaveTextContent(privateDetail);
    show(h, b); expect(nameField()).toHaveValue('B 保存名');
    for (const method of Object.values(nextApi)) expect(method).not.toHaveBeenCalled();
  });

  it.each(['resolve', 'reject'] as const)('ignores a late save after unmount without any callback or readback: %s', async (completion) => {
    const h = mount(); editName(); const task = deferred<ProjectUpdateResponse>(); h.api.update.mockReturnValueOnce(task.promise);
    await h.user.click(submit()); h.unmount();
    await act(async () => { if (completion === 'resolve') task.resolve(updated()); else task.reject(new Error(privateDetail)); });
    expect(h.container).toBeEmptyDOMElement(); expect(h.onSaved).not.toHaveBeenCalled(); expect(h.onBack).not.toHaveBeenCalled();
    expect(h.api.get).not.toHaveBeenCalled();
  });

  it('uses the latest callback and keeps normalized DB values when unchanged props recur, including A -> B -> A', async () => {
    const h = mount(); editName(); const task = deferred<ProjectUpdateResponse>(); h.api.update.mockReturnValueOnce(task.promise); await h.user.click(submit());
    const onSaved = vi.fn(); h.rerender(<ProjectSettingsPanel snapshot={saved()} api={h.api} onSaved={onSaved} onBack={h.onBack} />);
    expect(nameField()).toHaveValue('未保存の名前'); const confirmed = saved({ name: 'DB 正規化名' });
    await act(async () => { task.resolve(updated(confirmed)); }); expect(onSaved.mock.calls).toEqual([[confirmed]]); expect(h.onSaved).not.toHaveBeenCalled();
    h.rerender(<ProjectSettingsPanel snapshot={saved()} api={h.api} onSaved={onSaved} onBack={h.onBack} />);
    expect(nameField()).toHaveValue('DB 正規化名'); expect(status()).toHaveTextContent('Project情報：保存済み');
    h.rerender(<ProjectSettingsPanel snapshot={saved({ id: projectB })} api={h.api} onSaved={onSaved} onBack={h.onBack} />);
    h.rerender(<ProjectSettingsPanel snapshot={saved()} api={h.api} onSaved={onSaved} onBack={h.onBack} />);
    expect(nameField()).toHaveValue('DB 正規化名'); expect(status()).toHaveTextContent('Project情報：保存済み');
    expect(onSaved.mock.calls).toEqual([[confirmed]]); expect(h.api.get).not.toHaveBeenCalled();
  });

  it('keeps old A settlement in A only while B can save and notify its own confirmed snapshot', async () => {
    const h = mount(); editName('A draft'); const old = deferred<ProjectUpdateResponse>(); h.api.update.mockReturnValueOnce(old.promise); await h.user.click(submit());
    const b = saved({ id: projectB, name: 'B 保存名' }); show(h, b); editName('B draft');
    const savedB = saved({ ...b.project, name: 'B 確定名' }); h.api.update.mockResolvedValueOnce(updated(savedB)); await h.user.click(submit());
    await act(async () => { old.resolve(updated(saved({ name: 'A 遅延確定名' }))); });
    expect(nameField()).toHaveValue('B 確定名'); expect(h.onSaved.mock.calls).toEqual([[savedB]]);
    show(h); expect(nameField()).toHaveValue('A draft'); expectUnknown(h); expect(check()).toBeEnabled();
    expect(h.api.update.mock.calls.map(([input]) => input.id)).toEqual([projectA, projectB]);
  });

  it('requires clean metadata before picker/move/recovery and invalidates a selected token even when an edit is later restored', async () => {
    const h = mount(); editName(); expect(picker()).toBeDisabled(); expect(recover()).toBeDisabled();
    fireEvent.click(picker()); expect(h.api.pickParent).not.toHaveBeenCalled(); await h.user.click(discard());
    await h.user.click(picker()); expect(move()).toBeEnabled(); editName(); editName(h.snapshot.project.name);
    expect(move()).toBeDisabled(); expect(screen.queryByText(parentPath)).toBeNull(); fireEvent.click(move()); expect(h.api.move).not.toHaveBeenCalled();
    editName('保存後に移動する名前'); h.api.update.mockResolvedValueOnce(updated(saved({ name: '保存後に移動する名前' })));
    await h.user.click(submit()); expect(picker()).toBeEnabled(); expect(h.api.move).not.toHaveBeenCalled();
  });

  it('burns the old picker selection at dialog start, including cancellation, and requires a newly selected token', async () => {
    const h = await readyMove(); const task = deferred<ProjectPickParentResponse>(); h.api.pickParent.mockReturnValueOnce(task.promise);
    await h.user.click(picker()); expect(screen.queryByText(parentPath)).toBeNull(); expect(move()).toBeDisabled();
    await act(async () => { task.resolve(projectPickParentResponseSchema.parse({ ok: true, value: { status: 'cancelled' } })); });
    expect(status()).toHaveTextContent('選択をキャンセル'); expect(h.onBack).not.toHaveBeenCalled(); expect(h.api.move).not.toHaveBeenCalled();
    expect(move()).toBeDisabled(); h.api.pickParent.mockResolvedValueOnce(selected(nextToken)); await h.user.click(picker()); await h.user.click(move());
    expect(h.api.move.mock.calls).toEqual([[{ projectId: projectA, parentToken: nextToken }]]);
  });

  it('discards a picker response when current saved metadata or the actual lock changed while its dialog was open', async () => {
    const h = mount(); const task = deferred<ProjectPickParentResponse>(); h.api.pickParent.mockReturnValueOnce(task.promise); await h.user.click(picker());
    show(h, saved({ name: '新しい保存済み名' }, true)); await act(async () => { task.resolve(selected()); });
    expect(nameField()).toHaveValue('新しい保存済み名'); expect(screen.queryByText(parentPath)).toBeNull(); expect(move()).toBeDisabled();
    expect(status()).toHaveTextContent('選択が無効'); expect(h.api.move).not.toHaveBeenCalled();
  });

  it('rejects malformed picker capabilities and unknown/native errors without leaking values or enabling a move', async () => {
    const h = mount();
    h.api.pickParent.mockResolvedValueOnce({ ok: true, value: { status: 'selected', displayPath: privateDetail } } as ProjectPickParentResponse);
    await h.user.click(picker()); expect(move()).toBeDisabled(); expect(h.container).not.toHaveTextContent(privateDetail);
    h.api.pickParent.mockResolvedValueOnce({ ok: false, error: { code: 'constructor', message: privateDetail } } as unknown as ProjectPickParentResponse);
    await h.user.click(picker()); expect(move()).toBeDisabled(); expect(h.container).not.toHaveTextContent(/constructor|PRIVATE_NATIVE_PATH_STACK/);
    expect(h.api.get).not.toHaveBeenCalled(); await h.user.click(picker()); expect(move()).toBeEnabled();
  });

  it('never accepts a late native selection after hiding and API context changes', async () => {
    const h = mount(); const task = deferred<ProjectPickParentResponse>(); h.api.pickParent.mockReturnValueOnce(task.promise); await h.user.click(picker());
    show(h, h.snapshot, false); show(h, h.snapshot, false, apiFor()); show(h);
    await act(async () => { task.resolve(selected()); });
    expect(screen.queryByText(parentPath)).toBeNull(); expect(move()).toBeDisabled(); expect(picker()).toBeEnabled();
    expect(h.api.move).not.toHaveBeenCalled(); expect(h.onSaved).not.toHaveBeenCalled();
  });

  it('sends only projectId/token once, burns on BUSY, and uses the next DB root rather than deriving it from displayPath', async () => {
    const h = await readyMove(); expect(h.api.pickParent.mock.calls).toEqual([[{ purpose: 'move', projectId: projectA }]]);
    const task = deferred<ProjectMoveResponse>(); h.api.move.mockReturnValueOnce(task.promise);
    act(() => { move().click(); move().click(); fireEvent.submit(form()); });
    expect(h.api.move).toHaveBeenCalledTimes(1); expect(nameField()).toBeDisabled(); expect(check()).toBeDisabled(); expect(picker()).toBeDisabled();
    expect(screen.getByRole('button', { name: '戻る' })).toBeEnabled(); expect(screen.queryByText(parentPath)).toBeNull();
    await act(async () => { task.resolve({ ok: false, error: { code: 'BUSY' } }); });
    expect(status()).toHaveTextContent('停止せず、完了を待ってください。'); expect(screen.getByText(h.snapshot.project.workspacePath)).toBeVisible();
    fireEvent.click(move()); expect(h.api.move).toHaveBeenCalledTimes(1); expect(h.onSaved).not.toHaveBeenCalled();
    h.api.pickParent.mockResolvedValueOnce(selected(nextToken)); await h.user.click(picker()); await h.user.click(move());
    expect(h.api.move.mock.calls).toEqual([[{ projectId: projectA, parentToken: token }], [{ projectId: projectA, parentToken: nextToken }]]);
    expect(h.onSaved.mock.calls).toEqual([[saved({ workspacePath: movedPath })]]); expect(screen.getByText(movedPath)).toBeVisible();
    expect(h.container.textContent).not.toContain(`${parentPath}\\${projectA}`); expect(h.api.update).not.toHaveBeenCalled();
    expect(h.api.recover).not.toHaveBeenCalled();
  });

  it.each([false, true])('preserves a committed source-retained root and warning through get, with recovery only on explicit click: warning=%s', async (warning) => {
    const h = await readyMove(); const current = saved({ workspacePath: movedPath }); h.api.move.mockResolvedValueOnce(movement('source-retained', current, warning));
    await h.user.click(move()); expect(screen.getByText(movedPath)).toBeVisible(); expect(status()).toHaveTextContent('保存先はDBの現在値です。移動・回収状態の確認が必要です。');
    expect(screen.getByText(PROJECT_SOURCE_CLEANUP_FAILED_MESSAGE)).toBeVisible(); expect(h.onSaved.mock.calls).toEqual([[current]]);
    expect(h.container).not.toHaveTextContent(/旧場所へ復旧済み|旧領域は完全|ロールバック済み/); expect(recover()).toBeEnabled(); expect(picker()).toBeDisabled();
    h.api.get.mockResolvedValueOnce(readback(current)); await h.user.click(check());
    expect(screen.getByText(PROJECT_SOURCE_CLEANUP_FAILED_MESSAGE)).toBeVisible(); expect(h.api.recover).not.toHaveBeenCalled(); expect(picker()).toBeDisabled();
    h.api.recover.mockResolvedValueOnce(movement('completed', current)); await h.user.click(recover());
    expect(h.api.recover.mock.calls).toEqual([[{ projectId: projectA }]]); expect(screen.getByText(movedPath)).toBeVisible();
    expect(screen.queryByText(PROJECT_SOURCE_CLEANUP_FAILED_MESSAGE)).toBeNull(); expect(status()).toHaveTextContent('旧領域の回収は完了しています。');
    expect(picker()).toBeEnabled(); expect(h.api.move).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])('does not claim a DB move for source-retained recovery at the original root: warning=%s', async (warning) => {
    const h = mount();
    h.api.recover.mockResolvedValueOnce(movement('source-retained', h.snapshot, warning));
    await h.user.click(recover());
    expect(status()).toHaveTextContent('保存先はDBの現在値です。移動・回収状態の確認が必要です。');
    expect(h.container).not.toHaveTextContent(/変更済み|旧領域は完全|回収は完了しています/);
    expect(screen.getByText(h.snapshot.project.workspacePath)).toBeVisible();
    expect(screen.getByText(PROJECT_SOURCE_CLEANUP_FAILED_MESSAGE)).toBeVisible();
    expect(picker()).toBeDisabled(); expect(move()).toBeDisabled(); expect(recover()).toBeEnabled();
    expect(h.onSaved.mock.calls).toEqual([[h.snapshot]]);
    expect(h.api.move).not.toHaveBeenCalled(); expect(h.api.get).not.toHaveBeenCalled();
  });

  it('displays recovery none as no receipt, never cleanup completed, and preserves the actual response root', async () => {
    const h = mount(); const current = saved({ workspacePath: movedPath }, true); h.api.recover.mockResolvedValueOnce(movement('none', current));
    expect(h.api.recover).not.toHaveBeenCalled(); await h.user.click(recover());
    expect(h.api.recover.mock.calls).toEqual([[{ projectId: projectA }]]); expect(status()).toHaveTextContent('復旧対象の移動記録はありません。回収完了を意味しません。');
    expect(status()).not.toHaveTextContent('回収は完了しています'); expect(screen.getByText(movedPath)).toBeVisible();
    expect(screen.getByRole('radio', { name: '物体検出' })).toBeDisabled(); expect(h.onSaved.mock.calls).toEqual([[current]]);
  });

  it.each(['OPERATION_FAILED', 'reject', 'malformed', 'other-project'] as const)('keeps move outcome uncertain until get, never repeats move or guesses rollback: %s', async (failure) => {
    const h = await readyMove();
    if (failure === 'OPERATION_FAILED') h.api.move.mockResolvedValueOnce({ ok: false, error: { code: failure } });
    else if (failure === 'reject') h.api.move.mockRejectedValueOnce(new Error(privateDetail));
    else h.api.move.mockResolvedValueOnce((failure === 'other-project' ? movement('completed', saved({ id: projectB, workspacePath: privateDetail }))
      : { ok: true, value: { ...saved({ workspacePath: privateDetail }), cleanupStatus: 'unexpected' } }) as ProjectMoveResponse);
    await h.user.click(move()); expectUnknown(h, false); expect(screen.getByText(h.snapshot.project.workspacePath)).toBeVisible();
    expect(h.onSaved).not.toHaveBeenCalled(); expect(h.api.get).not.toHaveBeenCalled(); expect(h.api.recover).not.toHaveBeenCalled();
    fireEvent.click(move()); fireEvent.click(picker()); expect(h.api.move).toHaveBeenCalledTimes(1); expect(h.api.pickParent).toHaveBeenCalledTimes(1);
    // A failed write may precede or follow the DB switch. Only get answers which.
    const current = failure === 'OPERATION_FAILED' ? h.snapshot : saved({ workspacePath: movedPath });
    h.api.get.mockResolvedValueOnce(readback(current)); await h.user.click(check());
    expect(screen.getByText('保存先（DB確認済み）')).toBeVisible(); expect(screen.getByText(current.project.workspacePath)).toBeVisible();
    expect(h.onSaved.mock.calls).toEqual([[current]]); expect(recover()).toBeEnabled(); expect(picker()).toBeDisabled();
    expect(h.api.move).toHaveBeenCalledTimes(1); expect(h.api.recover).not.toHaveBeenCalled();
  });

  it('treats rejected or wrong-project recovery as uncertain and requires another explicit read before any recovery retry', async () => {
    const h = mount(saved({ workspacePath: movedPath })); h.api.recover.mockRejectedValueOnce(new Error(privateDetail));
    await h.user.click(recover()); expectUnknown(h, false); expect(screen.getByText(movedPath)).toBeVisible();
    fireEvent.click(recover()); expect(h.api.recover).toHaveBeenCalledTimes(1); await h.user.click(check());
    expect(recover()).toBeEnabled(); h.api.recover.mockResolvedValueOnce(movement('completed', saved({ id: projectB, workspacePath: privateDetail })));
    await h.user.click(recover()); expectUnknown(h, false); expect(h.onSaved.mock.calls).toEqual([[h.snapshot]]);
    expect(h.api.get).toHaveBeenCalledTimes(1); expect(h.api.move).not.toHaveBeenCalled();
  });

  it('ignores readback after hiding and refuses a read that was superseded by newer props instead of erasing drafts', async () => {
    const h = mount(); editName(); const old = deferred<ProjectGetResponse>(); h.api.get.mockReturnValueOnce(old.promise); await h.user.click(check());
    show(h, h.snapshot, false); await act(async () => { old.resolve(readback(saved({ name: privateDetail }))); }); show(h);
    expect(nameField()).toHaveValue('未保存の名前'); expect(h.onSaved).not.toHaveBeenCalled(); expect(h.container).not.toHaveTextContent(privateDetail);
    const task = deferred<ProjectGetResponse>(); h.api.get.mockReturnValueOnce(task.promise); await h.user.click(check());
    const latest = saved({ description: '最新のDB説明' }, true); show(h, latest);
    await act(async () => { task.resolve(readback(saved({ name: '古い読込名' }, false))); });
    expect(status()).toHaveTextContent('もう一度確認してください'); expect(nameField()).toHaveValue('未保存の名前');
    expect(screen.getByRole('radio', { name: '物体検出' })).toBeDisabled(); expect(h.onSaved).not.toHaveBeenCalled();
  });

  it.each(['move', 'recover'] as const)('ignores late %s acknowledgement after back and reopening, retains last-known root and demands explicit get', async (kind) => {
    const h = await readyMove(); const task = deferred<ProjectMoveResponse>();
    if (kind === 'move') h.api.move.mockReturnValueOnce(task.promise); else h.api.recover.mockReturnValueOnce(task.promise);
    await h.user.click(kind === 'move' ? move() : recover()); await h.user.click(screen.getByRole('button', { name: '戻る' }));
    show(h, h.snapshot, false); show(h); expectUnknown(h, false); expect(check()).toBeDisabled();
    await act(async () => { task.resolve(movement('source-retained')); });
    expectUnknown(h, false); expect(check()).toBeEnabled(); expect(screen.queryByText(movedPath)).toBeNull();
    expect(h.onSaved).not.toHaveBeenCalled(); expect(h.onBack).toHaveBeenCalledTimes(1); expect(h.api.get).not.toHaveBeenCalled();
    const current = saved({ workspacePath: movedPath }); h.api.get.mockResolvedValueOnce(readback(current)); await h.user.click(check());
    expect(screen.getByText(movedPath)).toBeVisible(); expect(h.onSaved.mock.calls).toEqual([[current]]);
    expect(picker()).toBeDisabled(); expect(recover()).toBeEnabled();
  });
});