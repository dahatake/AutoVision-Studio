import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import {
  projectCreateInputSchema, projectCreateResponseSchema, projectPickParentResponseSchema, projectSnapshotSchema,
  type ProjectApi, type ProjectCreateResponse, type ProjectPickParentResponse, type ProjectSnapshot,
} from '../../../shared/contracts/project-ipc';
import { ProjectForm, type ProjectFormProps } from './ProjectForm';

const token = '11111111-1111-4111-8111-111111111111';
const nextToken = '33333333-3333-4333-8333-333333333333';
const parentPath = 'C:\\選択した親\\共有 🧪';
const uncertain = '作成結果を確認できません。一覧で状態を確認してください。';
function saved(taskType: ProjectSnapshot['project']['taskType'] = 'classification', taskTypeLocked = false) {
  return projectSnapshotSchema.parse({
    project: {
      id: 'ABCDEFAB-1234-4123-8123-ABCDEFABCDEF', name: '確定した Project', description: '保存済みの説明', taskType,
      workspacePath: 'D:\\DBの確定先\\abcdefab-1234-4123-8123-abcdefabcdef',
      createdAt: '2026-09-12T01:00:00.000Z', updatedAt: '2026-09-12T01:00:00.000Z',
    },
    taskTypeLocked,
  });
}
const selected = (parentToken = token, displayPath = parentPath) => projectPickParentResponseSchema.parse({
  ok: true, value: { status: 'selected', token: parentToken, displayPath },
});
const created = () => projectCreateResponseSchema.parse({ ok: true, value: saved() });
function apiFor() {
  return {
    pickParent: vi.fn<ProjectApi['pickParent']>().mockResolvedValue(selected()),
    create: vi.fn<ProjectApi['create']>().mockResolvedValue(created()),
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function mount(api = apiFor()) {
  const onCreated = vi.fn<(snapshot: ProjectSnapshot) => void>(); const onCancel = vi.fn<() => void>();
  const view = render(<ProjectForm api={api} onCreated={onCreated} onCancel={onCancel} />);
  return { ...view, api, onCreated, onCancel, user: userEvent.setup() };
}
const nameField = () => screen.getByRole('textbox', { name: '名前（必須）' });
const picker = () => screen.getByRole('button', { name: '親フォルダーを選択' });
const submit = () => screen.getByRole('button', { name: '作成' });
const form = () => screen.getByRole('form', { name: 'Project を作成' });
const descriptionButton = () => screen.getByRole('button', { name: '説明を編集（任意）' });
async function ready(h = mount()) {
  fireEvent.change(nameField(), { target: { value: '作成前の名前' } });
  await h.user.click(picker());
  expect(screen.getByText(parentPath)).toBeVisible();
  return h;
}
async function describeProject(h: ReturnType<typeof mount>, value = '  説明 🌾\n二行目  ') {
  await h.user.click(descriptionButton());
  fireEvent.change(screen.getByRole('textbox', { name: '説明（任意）' }), { target: { value } });
  await h.user.click(screen.getByRole('button', { name: '入力項目に戻る' }));
  return value;
}

// DOM/contract tests only. Native OS dialogs, IME and viewport/textarea reachability require parent-run checks.
describe('ProjectForm (UIR-022, create only)', () => {
  it('has exactly the create props, native fields, one live status and no automatic requests', () => {
    expectTypeOf<ProjectFormProps>().toEqualTypeOf<{
      api: Pick<ProjectApi, 'pickParent' | 'create'>;
      onCreated: (snapshot: ProjectSnapshot) => void;
      onCancel: () => void;
    }>();
    expectTypeOf<Parameters<typeof ProjectForm>[0]>().toEqualTypeOf<ProjectFormProps>();
    const h = mount();
    expect(nameField()).toHaveValue(''); expect(nameField()).toBeRequired();
    expect(screen.getByRole('radio', { name: '画像分類' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '物体検出' })).not.toBeChecked();
    expect(screen.queryByRole('textbox', { name: '説明（任意）' })).toBeNull();
    expect(screen.getByText('未選択')).toBeVisible();
    expect(submit()).toHaveAttribute('type', 'submit');
    expect(screen.getByRole('button', { name: 'キャンセル' })).toHaveAttribute('type', 'button');
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(h.container.querySelectorAll('[aria-live]')).toHaveLength(1);
    expect(h.container.querySelector('video, audio, canvas, iframe, img, [src], input[type="file"]')).toBeNull();
    expect(h.api.pickParent).not.toHaveBeenCalled(); expect(h.api.create).not.toHaveBeenCalled();
    expect(h.onCreated).not.toHaveBeenCalled(); expect(h.onCancel).not.toHaveBeenCalled();
  });

  it('does not read readonly API method getters during render, effects or unrelated rerenders', async () => {
    const backing = apiFor(); const readPick = vi.fn(() => backing.pickParent); const readCreate = vi.fn(() => backing.create);
    const api: ProjectFormProps['api'] = Object.freeze({
      get pickParent() { return readPick(); }, get create() { return readCreate(); },
    });
    const onCreated = vi.fn();
    const h = render(<StrictMode><ProjectForm api={api} onCreated={onCreated} onCancel={vi.fn()} /></StrictMode>);
    h.rerender(<StrictMode><ProjectForm api={api} onCreated={onCreated} onCancel={vi.fn()} /></StrictMode>);
    expect(readPick).not.toHaveBeenCalled(); expect(readCreate).not.toHaveBeenCalled();
    fireEvent.change(nameField(), { target: { value: '名前' } });
    const user = userEvent.setup(); await user.click(picker()); await user.click(submit());
    expect(readPick).toHaveBeenCalledTimes(1); expect(readCreate).toHaveBeenCalledTimes(1);
    expect(onCreated).toHaveBeenCalledWith(saved());
  });

  it.each(['', ' \t ', '\u3000\u00a0'])('rejects empty/trim-empty names locally without consuming the selection: %j', async (name) => {
    const h = await ready(); fireEvent.change(nameField(), { target: { value: name } });
    await h.user.click(submit());
    expect(nameField()).toHaveAttribute('aria-invalid', 'true');
    expect(nameField()).toHaveAccessibleDescription('Project名を入力してください。');
    expect(h.api.create).not.toHaveBeenCalled(); expect(screen.getByText(parentPath)).toBeVisible();
    fireEvent.change(nameField(), { target: { value: '  有効な名前  ' } });
    expect(nameField()).toHaveAttribute('aria-invalid', 'false');
    expect(nameField()).not.toHaveAttribute('aria-describedby');
    await h.user.click(submit());
    expect(h.api.create.mock.calls).toEqual([[{ name: '有効な名前', description: '', taskType: 'classification', parentToken: token }]]);
  });

  it('requires a native selection and associates only the current selection error', async () => {
    const h = mount(); fireEvent.change(nameField(), { target: { value: '名前' } });
    await h.user.click(submit());
    expect(h.api.create).not.toHaveBeenCalled(); expect(picker()).toHaveAttribute('aria-invalid', 'true');
    expect(picker()).toHaveAccessibleDescription(/親フォルダーを選択してください。/);
    await h.user.click(picker());
    expect(picker()).toHaveAttribute('aria-invalid', 'false');
    expect(picker().getAttribute('aria-describedby')).not.toContain(screen.getByRole('status').id);
    expect(h.api.pickParent.mock.calls).toEqual([[{ purpose: 'create' }]]);
  });

  it.each([
    { name: '  normal name  ', task: 'classification', label: '画像分類', description: '  notes\nline 2  ', locked: false },
    { name: '\u3000観察 👩🏽‍💻 e\u0301\u3000', task: 'detection', label: '物体検出', description: '\u3000説明 🌾 e\u0301\n二行目  ', locked: true },
    { name: '0', task: 'classification', label: '画像分類', description: '', locked: false },
  ] as const)('sends exact trimmed create fields and forwards the actual snapshot: $task / $name', async (example) => {
    const h = await ready(); const snapshot = saved(example.task, example.locked);
    h.api.create.mockResolvedValueOnce(projectCreateResponseSchema.parse({ ok: true, value: snapshot }));
    fireEvent.change(nameField(), { target: { value: example.name } });
    await h.user.click(screen.getByRole('radio', { name: example.label }));
    await describeProject(h, example.description);
    await h.user.click(submit());
    const payload = { name: example.name.trim(), description: example.description, taskType: example.task, parentToken: token };
    expect(h.api.create.mock.calls).toEqual([[payload]]);
    expect(projectCreateInputSchema.parse(h.api.create.mock.calls[0][0])).toEqual(payload);
    expect(Object.keys(h.api.create.mock.calls[0][0]).sort()).toEqual(['description', 'name', 'parentToken', 'taskType']);
    expect(h.onCreated.mock.calls).toEqual([[snapshot]]);
    expect(screen.getByText(snapshot.project.workspacePath)).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('作成しました。');
    expect(h.container.textContent).not.toContain(`${parentPath}\\${snapshot.project.id}`);
    expect(submit()).toBeDisabled(); fireEvent.submit(form()); expect(h.api.create).toHaveBeenCalledTimes(1);
  });

  it('keeps the description and other draft fields across view changes and callback-only rerenders', async () => {
    const h = await ready(); const originalForm = form(); await h.user.click(screen.getByRole('radio', { name: '物体検出' }));
    await h.user.click(descriptionButton());
    const textarea = screen.getByRole('textbox', { name: '説明（任意）' });
    expect(textarea.tagName).toBe('TEXTAREA'); expect(textarea).toHaveFocus(); expect(textarea).not.toHaveAttribute('maxlength');
    // Large native textarea value; this is not a claim that all text fits without scrolling.
    const description = '  行 👩🏽‍💻 e\u0301\n'.repeat(500);
    fireEvent.change(textarea, { target: { value: description } });
    await h.user.keyboard('{Enter}');
    const edited = (textarea as HTMLTextAreaElement).value;
    expect(h.api.create).not.toHaveBeenCalled();
    const callback = vi.fn(); h.rerender(<ProjectForm api={h.api} onCreated={callback} onCancel={h.onCancel} />);
    expect(textarea).toHaveValue(edited); expect(form()).toBe(originalForm);
    await h.user.click(screen.getByRole('button', { name: '入力項目に戻る' }));
    expect(descriptionButton()).toHaveFocus(); expect(nameField()).toHaveValue('作成前の名前');
    expect(nameField()).not.toHaveAttribute('maxlength'); expect(screen.getByRole('radio', { name: '物体検出' })).toBeChecked();
    expect(screen.getByText(parentPath)).toBeVisible();
    await h.user.click(descriptionButton()); expect(screen.getByRole('textbox', { name: '説明（任意）' })).toHaveValue(edited);
    await h.user.click(submit());
    expect(h.api.create.mock.calls[0][0].description).toBe(edited); expect(callback).toHaveBeenCalledWith(saved());
    expect(h.onCreated).not.toHaveBeenCalled();
  });

  it('renders an entire long Unicode display path as text, never as an editable or authoritative path', async () => {
    const path = `C:\\${'親e\u0301👩🏽‍💻\\'.repeat(40)}終端`;
    const h = mount(); h.api.pickParent.mockResolvedValueOnce(selected(token, path));
    await h.user.click(picker());
    const value = h.container.querySelector('.project-form__path');
    expect(value?.textContent).toBe(path); expect(value).toHaveAttribute('tabindex', '0');
    expect(h.container.querySelector('input[readonly], textarea[readonly], input[name="workspacePath"], input[name="parentToken"]')).toBeNull();
    fireEvent.change(nameField(), { target: { value: '名前' } }); await h.user.click(submit());
    expect(h.api.create.mock.calls).toEqual([[{ name: '名前', description: '', taskType: 'classification', parentToken: token }]]);
    expect(h.container.querySelectorAll('svg.system-icon[aria-hidden="true"][focusable="false"]').length).toBeGreaterThan(0);
  });

  it('clears the previous selection when reopening the picker, including native cancellation', async () => {
    const h = await ready(); const task = deferred<ProjectPickParentResponse>(); h.api.pickParent.mockReturnValueOnce(task.promise);
    await h.user.click(picker()); expect(screen.queryByText(parentPath)).toBeNull();
    await act(async () => { task.resolve(projectPickParentResponseSchema.parse({ ok: true, value: { status: 'cancelled' } })); });
    expect(screen.getByText('未選択')).toBeVisible(); expect(nameField()).toHaveValue('作成前の名前');
    expect(screen.getByRole('status')).toHaveTextContent('フォルダーの選択をキャンセルしました。');
    expect(h.onCancel).not.toHaveBeenCalled(); fireEvent.submit(form()); expect(h.api.create).not.toHaveBeenCalled();
    h.api.pickParent.mockResolvedValueOnce(selected(nextToken)); await h.user.click(picker()); await h.user.click(submit());
    expect(h.api.create.mock.calls[0][0].parentToken).toBe(nextToken);
  });

  it.each(['INVALID_REQUEST', 'NOT_FOUND', 'BUSY', 'OPERATION_FAILED', 'STALE_SELECTION'] as const)('shows safe Japanese picker errors and allows reselection: %s', async (code) => {
    const h = await ready(); h.api.pickParent.mockResolvedValueOnce({ ok: false, error: { code } });
    await h.user.click(picker());
    expect(screen.queryByText(parentPath)).toBeNull(); expect(picker()).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('status').textContent).toMatch(/選択|選び直/);
    expect(h.container).not.toHaveTextContent(code); expect(h.onCreated).not.toHaveBeenCalled();
    expect(picker()).toBeEnabled(); await h.user.click(picker()); expect(screen.getByText(parentPath)).toBeVisible();
  });

  it.each([
    ['missing-token', { ok: true, value: { status: 'selected', displayPath: parentPath } }],
    ['invalid-token', { ok: true, value: { status: 'selected', token: 'not-a-token', displayPath: parentPath } }],
    ['empty-path', { ok: true, value: { status: 'selected', token, displayPath: '  ' } }],
    ['unknown-status', { ok: true, value: { status: 'ready', token, displayPath: parentPath } }],
    ['native-details', { ok: false, error: { code: 'STALE_SELECTION', message: 'PRIVATE_NATIVE_PATH' } }],
  ])('rejects malformed picker results without exposing their fields: %s', async (_label, value) => {
    const h = await ready(); h.api.pickParent.mockResolvedValueOnce(value as unknown as ProjectPickParentResponse);
    await h.user.click(picker());
    expect(screen.queryByText(parentPath)).toBeNull(); expect(picker()).toBeEnabled();
    expect(screen.getByRole('status')).toHaveTextContent('親フォルダーを選択できませんでした。');
    expect(h.container).not.toHaveTextContent(/PRIVATE_NATIVE_PATH|not-a-token|STALE_SELECTION/);
    fireEvent.submit(form()); expect(h.api.create).not.toHaveBeenCalled();
  });

  it.each(['reject', 'throw'] as const)('handles picker transport failure without claiming creation: %s', async (failure) => {
    const h = mount();
    if (failure === 'reject') h.api.pickParent.mockRejectedValueOnce(new Error('PRIVATE_NATIVE_PATH'));
    else h.api.pickParent.mockImplementationOnce(() => { throw new Error('PRIVATE_NATIVE_PATH'); });
    await h.user.click(picker()); expect(picker()).toBeEnabled();
    expect(screen.getByRole('status')).toHaveTextContent('親フォルダーを選択できませんでした。');
    expect(h.container).not.toHaveTextContent('PRIVATE_NATIVE_PATH'); expect(h.onCreated).not.toHaveBeenCalled();
  });

  it('locks inputs and guards same-turn picker and create dispatch while the picker is pending', async () => {
    const h = await ready(); const task = deferred<ProjectPickParentResponse>(); h.api.pickParent.mockReturnValueOnce(task.promise);
    const folder = picker();
    act(() => { folder.click(); folder.click(); fireEvent.submit(form()); });
    expect(h.api.pickParent).toHaveBeenCalledTimes(2); expect(h.api.create).not.toHaveBeenCalled();
    expect(nameField()).toBeDisabled(); expect(screen.getByRole('radio', { name: '物体検出' })).toBeDisabled();
    expect(descriptionButton()).toBeDisabled(); expect(picker()).toBeDisabled(); expect(submit()).toBeDisabled();
    expect(fireEvent.keyDown(nameField(), { key: 'Enter' })).toBe(false);
    expect(screen.getByRole('button', { name: 'キャンセル' })).toBeEnabled();
    await act(async () => { task.resolve(selected(nextToken)); });
    expect(nameField()).toBeEnabled(); expect(submit()).toBeEnabled();
  });

  it('guards same-turn repeated submit and double clicks, locks description, and warns before leaving', async () => {
    const h = await ready(); const task = deferred<ProjectCreateResponse>(); h.api.create.mockReturnValueOnce(task.promise);
    await h.user.click(descriptionButton()); const textarea = screen.getByRole('textbox', { name: '説明（任意）' });
    fireEvent.change(textarea, { target: { value: '保持する draft' } });
    const button = submit(); act(() => { button.click(); fireEvent.submit(form()); button.click(); });
    await h.user.dblClick(button);
    expect(h.api.create).toHaveBeenCalledTimes(1); expect(textarea).toBeDisabled();
    expect(screen.getByRole('button', { name: '入力項目に戻る' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('一覧へ戻っても作成処理は取り消されません。');
    const back = screen.getByRole('button', { name: '結果未確認のまま一覧へ戻る' });
    expect(back).toBeEnabled(); expect(fireEvent.keyDown(back, { key: 'Enter' })).toBe(true);
    await act(async () => { task.resolve(created()); });
    expect(h.onCreated).toHaveBeenCalledTimes(1); expect(textarea).toHaveValue('保持する draft');
  });

  it.each(['INVALID_REQUEST', 'NOT_FOUND', 'BUSY', 'STALE_SELECTION'] as const)('burns tokens on recoverable create failure but preserves every draft field: %s', async (code) => {
    const h = await ready(); const description = await describeProject(h);
    await h.user.click(screen.getByRole('radio', { name: '物体検出' }));
    h.api.create.mockResolvedValueOnce({ ok: false, error: { code } }); await h.user.click(submit());
    expect(h.onCreated).not.toHaveBeenCalled(); expect(nameField()).toHaveValue('作成前の名前');
    expect(screen.getByRole('radio', { name: '物体検出' })).toBeChecked();
    expect(picker()).toBeEnabled(); expect(picker()).toHaveAttribute('aria-invalid', 'true');
    expect(h.container).not.toHaveTextContent(code); expect(screen.queryByText(parentPath)).toBeNull();
    fireEvent.submit(form()); expect(h.api.create).toHaveBeenCalledTimes(1);
    h.api.pickParent.mockResolvedValueOnce(selected(nextToken)); await h.user.click(picker()); await h.user.click(submit());
    expect(h.api.create.mock.calls).toEqual([
      [{ name: '作成前の名前', description, taskType: 'detection', parentToken: token }],
      [{ name: '作成前の名前', description, taskType: 'detection', parentToken: nextToken }],
    ]);
  });

  it('cannot resend a consumed token after a failure acknowledgement in the same render batch', async () => {
    const h = await ready(); const task = deferred<ProjectCreateResponse>(); h.api.create.mockReturnValueOnce(task.promise);
    await act(async () => {
      fireEvent.submit(form());
      task.resolve(projectCreateResponseSchema.parse({ ok: false, error: { code: 'STALE_SELECTION' } }));
      await task.promise;
      fireEvent.submit(form());
    });
    expect(h.api.create).toHaveBeenCalledTimes(1); expect(h.onCreated).not.toHaveBeenCalled();
    h.api.pickParent.mockResolvedValueOnce(selected(nextToken)); await h.user.click(picker()); await h.user.click(submit());
    expect(h.api.create.mock.calls[1][0].parentToken).toBe(nextToken);
  });

  const malformedCreates: [string, unknown][] = [
    ['no-snapshot', { ok: true, value: {} }],
    ['missing-lock', { ok: true, value: { project: saved().project } }],
    ['invalid-id', { ok: true, value: { ...saved(), project: { ...saved().project, id: 'new-project' } } }],
    ['blank-root', { ok: true, value: { ...saved(), project: { ...saved().project, workspacePath: '' } } }],
    ['partial-move-result', { ok: true, value: { ...saved(), cleanupStatus: 'source-retained' } }],
    ['native-details', { ok: false, error: { code: 'OPERATION_FAILED', message: 'PRIVATE_NATIVE_PATH' } }],
  ];
  it.each(malformedCreates)('keeps malformed/partial create outcomes uncertain, never a fabricated project: %s', async (_label, value) => {
    const h = await ready(); h.api.create.mockResolvedValueOnce(value as ProjectCreateResponse); await h.user.click(submit());
    expect(screen.getByRole('status')).toHaveTextContent(uncertain); expect(submit()).toBeDisabled(); expect(picker()).toBeDisabled();
    expect(h.onCreated).not.toHaveBeenCalled(); expect(h.container).not.toHaveTextContent(/PRIVATE_NATIVE_PATH|source-retained|new-project/);
    expect(screen.queryByText(saved().project.workspacePath)).toBeNull();
    fireEvent.submit(form()); expect(h.api.create).toHaveBeenCalledTimes(1);
    const back = screen.getByRole('button', { name: '一覧で確認' }); expect(back).toHaveClass('project-form__primary');
    await h.user.click(back); expect(h.onCancel.mock.calls).toEqual([[]]);
  });

  it.each(['OPERATION_FAILED', 'reject', 'throw'] as const)('requires list verification after an unacknowledged create and never reuses its token: %s', async (failure) => {
    const h = await ready(); await describeProject(h);
    if (failure === 'OPERATION_FAILED') h.api.create.mockResolvedValueOnce({ ok: false, error: { code: failure } });
    else if (failure === 'reject') h.api.create.mockRejectedValueOnce(new Error('PRIVATE_NATIVE_PATH'));
    else h.api.create.mockImplementationOnce(() => { throw new Error('PRIVATE_NATIVE_PATH'); });
    await h.user.click(submit());
    expect(screen.getByRole('status')).toHaveTextContent(uncertain); expect(nameField()).toHaveValue('作成前の名前');
    expect(h.container).not.toHaveTextContent(/PRIVATE_NATIVE_PATH|ロールバック|取消済み/);
    h.rerender(<ProjectForm api={h.api} onCreated={vi.fn()} onCancel={h.onCancel} />);
    expect(submit()).toBeDisabled(); fireEvent.submit(form()); fireEvent.click(picker()); expect(h.api.create).toHaveBeenCalledTimes(1);
    expect(h.api.pickParent).toHaveBeenCalledTimes(1); expect(h.onCreated).not.toHaveBeenCalled();
    await h.user.click(screen.getByRole('button', { name: '一覧で確認' })); expect(h.onCancel).toHaveBeenCalledTimes(1);
  });

  it('prevents composing Enter and composition-time submit, but allows ordinary Enter after composition ends', async () => {
    const h = await ready(); const name = nameField(); await h.user.click(name);
    expect(fireEvent.keyDown(name, { key: 'Enter', isComposing: true })).toBe(false);
    expect(fireEvent.keyDown(name, { key: 'Enter', keyCode: 229 })).toBe(false);
    fireEvent.compositionStart(name); expect(fireEvent.keyDown(name, { key: 'Enter' })).toBe(false);
    fireEvent.submit(form()); expect(h.api.create).not.toHaveBeenCalled();
    fireEvent.compositionEnd(name); await h.user.keyboard('{Enter}'); expect(h.api.create).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['picker', 'resolve'], ['picker', 'reject'], ['create', 'resolve'], ['create', 'reject'],
  ] as const)('invalidates pending %s on explicit back and ignores its %s even if still mounted', async (operation, completion) => {
    const h = await ready(); const pick = deferred<ProjectPickParentResponse>(); const create = deferred<ProjectCreateResponse>();
    if (operation === 'picker') h.api.pickParent.mockReturnValueOnce(pick.promise);
    else h.api.create.mockReturnValueOnce(create.promise);
    await h.user.click(operation === 'picker' ? picker() : submit());
    const onCreated = vi.fn(); const onCancel = vi.fn();
    h.rerender(<ProjectForm api={h.api} onCreated={onCreated} onCancel={onCancel} />);
    const back = screen.getByRole('button', { name: operation === 'picker' ? 'キャンセル' : '結果未確認のまま一覧へ戻る' });
    act(() => { back.click(); back.click(); });
    await act(async () => {
      if (operation === 'picker') { if (completion === 'resolve') pick.resolve(selected()); else pick.reject(new Error('PRIVATE_NATIVE_PATH')); }
      else if (completion === 'resolve') create.resolve(created()); else create.reject(new Error('PRIVATE_NATIVE_PATH'));
    });
    expect(onCancel.mock.calls).toEqual([[]]); expect(h.onCancel).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled(); expect(h.onCreated).not.toHaveBeenCalled();
    expect(screen.queryByText(parentPath)).toBeNull(); expect(screen.queryByText(saved().project.workspacePath)).toBeNull();
    expect(submit()).toBeDisabled(); expect(h.container).not.toHaveTextContent('PRIVATE_NATIVE_PATH');
  });

  it('uses the current onCreated only when the pending request still belongs to this API context', async () => {
    const h = await ready(); const task = deferred<ProjectCreateResponse>(); h.api.create.mockReturnValueOnce(task.promise);
    await h.user.click(submit()); const callback = vi.fn();
    h.rerender(<ProjectForm api={h.api} onCreated={callback} onCancel={h.onCancel} />);
    expect(nameField()).toHaveValue('作成前の名前'); expect(nameField()).toBeDisabled();
    await act(async () => { task.resolve(created()); });
    expect(callback.mock.calls).toEqual([[saved()]]); expect(h.onCreated).not.toHaveBeenCalled();
  });

  it.each([
    ['picker', 'resolve'], ['picker', 'reject'], ['create', 'resolve'], ['create', 'reject'],
  ] as const)('resets on API change and ignores old %s completion: %s', async (operation, completion) => {
    const h = await ready(); await describeProject(h); const oldPick = deferred<ProjectPickParentResponse>(); const oldCreate = deferred<ProjectCreateResponse>();
    if (operation === 'picker') h.api.pickParent.mockReturnValueOnce(oldPick.promise); else h.api.create.mockReturnValueOnce(oldCreate.promise);
    await h.user.click(operation === 'picker' ? picker() : submit());
    const api = apiFor(); const callback = vi.fn(); h.rerender(<ProjectForm api={api} onCreated={callback} onCancel={h.onCancel} />);
    expect(nameField()).toHaveValue(''); expect(screen.getByText('未選択')).toBeVisible(); expect(picker()).toBeEnabled();
    expect(api.pickParent).not.toHaveBeenCalled(); expect(api.create).not.toHaveBeenCalled();
    fireEvent.change(nameField(), { target: { value: '新しい context' } });
    await act(async () => {
      if (operation === 'picker') { if (completion === 'resolve') oldPick.resolve(selected()); else oldPick.reject(new Error('PRIVATE_NATIVE_PATH')); }
      else if (completion === 'resolve') oldCreate.resolve(created()); else oldCreate.reject(new Error('PRIVATE_NATIVE_PATH'));
    });
    expect(nameField()).toHaveValue('新しい context'); expect(screen.getByText('未選択')).toBeVisible();
    expect(h.onCreated).not.toHaveBeenCalled(); expect(callback).not.toHaveBeenCalled(); expect(h.container).not.toHaveTextContent('PRIVATE_NATIVE_PATH');
    await h.user.click(descriptionButton()); expect(screen.getByRole('textbox', { name: '説明（任意）' })).toHaveValue('');
    await h.user.click(screen.getByRole('button', { name: '入力項目に戻る' }));
    await h.user.click(picker()); await h.user.click(submit()); expect(callback).toHaveBeenCalledWith(saved());
  });

  it('does not revive an old request after API A -> B -> A', async () => {
    const h = await ready(); const old = deferred<ProjectCreateResponse>(); h.api.create.mockReturnValueOnce(old.promise);
    await h.user.click(submit()); const b = apiFor();
    h.rerender(<ProjectForm api={b} onCreated={h.onCreated} onCancel={h.onCancel} />);
    h.rerender(<ProjectForm api={h.api} onCreated={h.onCreated} onCancel={h.onCancel} />);
    await act(async () => { old.resolve(created()); });
    expect(h.onCreated).not.toHaveBeenCalled(); expect(nameField()).toHaveValue(''); expect(submit()).toBeEnabled();
    expect(screen.queryByText(saved().project.workspacePath)).toBeNull();
  });

  it('drops a completed snapshot and terminal state only on a fresh API context', async () => {
    const h = await ready(); await h.user.click(submit()); expect(screen.getByText(saved().project.workspacePath)).toBeVisible();
    h.rerender(<ProjectForm api={apiFor()} onCreated={h.onCreated} onCancel={h.onCancel} />);
    expect(screen.queryByText(saved().project.workspacePath)).toBeNull(); expect(nameField()).toHaveValue('');
    expect(submit()).toBeEnabled(); expect(h.onCreated).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['picker', 'resolve'], ['picker', 'reject'], ['create', 'resolve'], ['create', 'reject'],
  ] as const)('ignores late %s %s after unmount', async (operation, completion) => {
    const h = await ready(); const pick = deferred<ProjectPickParentResponse>(); const create = deferred<ProjectCreateResponse>();
    if (operation === 'picker') h.api.pickParent.mockReturnValueOnce(pick.promise); else h.api.create.mockReturnValueOnce(create.promise);
    await h.user.click(operation === 'picker' ? picker() : submit()); h.unmount();
    await act(async () => {
      if (operation === 'picker') { if (completion === 'resolve') pick.resolve(selected()); else pick.reject(new Error('PRIVATE_NATIVE_PATH')); }
      else if (completion === 'resolve') create.resolve(created()); else create.reject(new Error('PRIVATE_NATIVE_PATH'));
    });
    expect(h.container).toBeEmptyDOMElement(); expect(h.onCreated).not.toHaveBeenCalled(); expect(h.onCancel).not.toHaveBeenCalled();
  });
});
