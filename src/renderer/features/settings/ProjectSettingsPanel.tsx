import { useId, useLayoutEffect, useRef, useState } from 'react';

import {
  PROJECT_SOURCE_CLEANUP_FAILED_MESSAGE,
  projectGetResponseSchema, projectMoveResponseSchema, projectPickParentResponseSchema,
  projectRecoverResponseSchema, projectSnapshotSchema, projectUpdateInputSchema, projectUpdateResponseSchema,
  type ProjectApi, type ProjectGetResponse, type ProjectIpcErrorCode, type ProjectMoveResponse,
  type ProjectMoveValue, type ProjectParentSelection, type ProjectPickParentResponse,
  type ProjectSnapshot, type ProjectUpdateResponse,
} from '../../../shared/contracts/project-ipc';
import { SystemIcon } from '../../components/SystemIcon';
import '../projects/ProjectForm.css';

export interface ProjectSettingsPanelProps {
  snapshot: ProjectSnapshot;
  api: Pick<ProjectApi, 'update' | 'get' | 'pickParent' | 'move' | 'recover'>;
  onSaved: (snapshot: ProjectSnapshot) => void;
  onBack: () => void;
  visible?: boolean;
}

type Draft = Pick<ProjectSnapshot['project'], 'name' | 'description' | 'taskType'>;
type Mutation = 'save' | 'move' | 'recover';
type Pending = { kind: Mutation | 'read' | 'pick'; base: ProjectSnapshot };
type Parent = Extract<ProjectParentSelection, { status: 'selected' }>;
type Entry = {
  base: ProjectSnapshot;
  lastInput: ProjectSnapshot;
  draft: Draft;
  descriptionView: boolean;
  pending: Pending | null;
  uncertain: Mutation | null;
  saveFailed: boolean;
  nameError: string;
  message: string;
  parent: Parent | null;
  cleanup: ProjectMoveValue['cleanupStatus'] | 'unverified' | null;
};
type State = {
  api: ProjectSettingsPanelProps['api'];
  input: ProjectSnapshot;
  visible: boolean;
  left: boolean;
  session: object;
  entries: Map<string, Entry>;
};
type Context = {
  active: boolean;
  session: object;
  projectId: string;
  entry: Entry;
  onSaved: ProjectSettingsPanelProps['onSaved'];
  onBack: ProjectSettingsPanelProps['onBack'];
};
const errors: Record<ProjectIpcErrorCode, string> = {
  INVALID_REQUEST: '入力内容とタスク種別を確認してください。',
  NOT_FOUND: '対象の Project を確認できません。保存済みの内容を確認してください。',
  BUSY: 'ほかの処理が実行中です。停止せず、完了を待ってください。',
  OPERATION_FAILED: '処理結果を確認できません。保存結果を確認してください。',
  STALE_SELECTION: '選択が無効になりました。内容を確認して親フォルダーを選び直してください。',
};
const unknownMessage = '処理結果は未確認です。処理が取り消されたとは限りません。完了後に「保存結果を確認」を押してください。';

function fields(snapshot: ProjectSnapshot): Draft {
  const { name, description, taskType } = snapshot.project;
  return { name, description, taskType };
}
function dirty(entry: Entry): boolean {
  const base = entry.base.project;
  return entry.draft.name !== base.name || entry.draft.description !== base.description || entry.draft.taskType !== base.taskType;
}
function needsRecovery(entry: Entry): boolean {
  return entry.cleanup === 'source-retained' || entry.cleanup === 'unverified';
}
function sameSnapshot(a: ProjectSnapshot, b: ProjectSnapshot): boolean {
  const left = a.project, right = b.project;
  return a.taskTypeLocked === b.taskTypeLocked && left.id === right.id && left.name === right.name
    && left.description === right.description && left.taskType === right.taskType && left.workspacePath === right.workspacePath
    && left.createdAt === right.createdAt && left.updatedAt === right.updatedAt;
}
function initialEntry(base: ProjectSnapshot): Entry {
  return { base, lastInput: base, draft: fields(base), descriptionView: false, pending: null, uncertain: null,
    saveFailed: false, nameError: '', message: '', parent: null, cleanup: null };
}
function initialState(api: State['api'], snapshot: ProjectSnapshot, visible: boolean): State {
  return { api, input: snapshot, visible, left: false, session: {}, entries: new Map([[snapshot.project.id, initialEntry(snapshot)]]) };
}
function mergeSaved(entry: Entry, base: ProjectSnapshot): Entry {
  const old = entry.base.project, next = base.project;
  return { ...entry, base, parent: null, draft: {
    name: entry.draft.name === old.name ? next.name : entry.draft.name,
    description: entry.draft.description === old.description ? next.description : entry.draft.description,
    taskType: entry.draft.taskType === old.taskType ? next.taskType : entry.draft.taskType,
  }, cleanup: old.workspacePath !== next.workspacePath && entry.cleanup !== null ? 'unverified' : entry.cleanup };
}
function abandon(entry: Entry): Entry {
  const kind = entry.pending?.kind;
  if (kind === 'save' || kind === 'move' || kind === 'recover') {
    return { ...entry, parent: null, uncertain: kind, message: unknownMessage,
      cleanup: kind === 'save' ? entry.cleanup : 'unverified' };
  }
  return { ...entry, parent: null, message: kind === 'pick' ? 'フォルダーの選択結果は採用していません。選び直してください。'
    : kind === 'read' ? '読込結果は採用していません。もう一度保存結果を確認してください。' : entry.message };
}

// UIR-025A: keep ONE instance across Project IDs and hide with visible=false.
// onBack is navigation only; it retains drafts, never saves/discards/cancels a job.
// Changing the API object explicitly resets this local session (including drafts).
// onSaved publishes only matching, schema-validated DB snapshots, including explicit get.
export function ProjectSettingsPanel({ snapshot, api, onSaved, onBack, visible = true }: ProjectSettingsPanelProps) {
  const id = useId();
  const [state, setState] = useState(() => initialState(api, snapshot, visible));
  const projectId = snapshot.project.id;
  const entry = state.entries.get(projectId) ?? initialEntry(snapshot);
  const contextRef = useRef<Context | null>(null);
  const mounted = useRef(false);
  const composing = useRef(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const descriptionInput = useRef<HTMLTextAreaElement>(null);
  const descriptionOpener = useRef<HTMLButtonElement>(null);
  const previousView = useRef<{ session: object; projectId: string; visible: boolean; description: boolean } | null>(null);

  useLayoutEffect(() => {
    const context: Context = { active: visible, session: state.session, projectId, entry, onSaved, onBack };
    contextRef.current = context; mounted.current = true; composing.current = false;
    return () => { context.active = false; mounted.current = false; };
  }, [state.session, projectId, visible]);
  useLayoutEffect(() => {
    const context = contextRef.current;
    if (context) { context.entry = entry; context.onSaved = onSaved; context.onBack = onBack; }
  });
  useLayoutEffect(() => {
    const previous = previousView.current;
    if (visible && !state.left && previous?.visible && previous.session === state.session && previous.projectId === projectId
      && previous.description !== entry.descriptionView) {
      (entry.descriptionView ? descriptionInput.current : entry.nameError ? nameInput.current : descriptionOpener.current)?.focus();
    }
    previousView.current = { session: state.session, projectId, visible: visible && !state.left, description: entry.descriptionView };
  }, [state.session, state.left, projectId, visible, entry.descriptionView, entry.nameError]);

  // Adjust only local state before rendering children; no API/property getters.
  // A -> B -> A uses distinct committed request contexts but the same draft Map.
  if (state.api !== api) {
    setState(initialState(api, snapshot, visible));
    return null;
  }
  if (state.input !== snapshot || state.visible !== visible) {
    const navigation = state.input.project.id !== projectId || state.visible !== visible;
    const entries = new Map(state.entries);
    if (navigation) entries.set(state.input.project.id, abandon(entries.get(state.input.project.id)!));
    let next = entries.get(projectId) ?? initialEntry(snapshot);
    // Repeating A's already-seen props after visiting B is not a new DB read.
    // Keep A's confirmed response/base; merge only an actual incoming change.
    if (!sameSnapshot(next.lastInput, snapshot)) next = mergeSaved(next, snapshot);
    next = { ...next, lastInput: snapshot };
    if (navigation) next = { ...next, parent: null };
    entries.set(projectId, next);
    setState({ ...state, input: snapshot, visible, entries, left: navigation ? false : state.left });
    return null;
  }

  function current(): Context | null {
    const context = contextRef.current;
    return context?.active && !context.entry.pending ? context : null;
  }
  function publish(context: Context, next: Entry) {
    // Synchronous mirror closes same-turn double-submit/token reuse windows.
    // The Map remains the only retained Project draft/base store.
    context.entry = next;
    setState((previous) => previous.session !== context.session ? previous
      : { ...previous, entries: new Map(previous.entries).set(context.projectId, next) });
  }
  function accept(context: Context, ticket: Pending): boolean {
    if (context.active && contextRef.current === context && context.entry.pending === ticket) return true;
    if (mounted.current) {
      // An abandoned mutation still ran. Wait for settlement before allowing get;
      // never acknowledge its value, even after hiding and reopening the same ID.
      setState((previous) => {
        const cached = previous.entries.get(context.projectId);
        if (previous.session !== context.session || cached?.pending !== ticket) return previous;
        return { ...previous, entries: new Map(previous.entries).set(context.projectId, { ...abandon(cached), pending: null }) };
      });
    }
    return false;
  }
  function uncertain(context: Context, kind: Mutation) {
    publish(context, { ...context.entry, pending: null, parent: null, uncertain: kind, message: unknownMessage,
      cleanup: kind === 'save' ? context.entry.cleanup : 'unverified' });
  }
  function superseded(context: Context, ticket: Pending, result: ProjectSnapshot): boolean {
    // A newer prop arriving during a request must not be replaced by an older ack.
    // This is only a UI freshness check, not an optimistic-concurrency DB protocol.
    return !sameSnapshot(context.entry.base, ticket.base) && !sameSnapshot(context.entry.base, result);
  }
  function edit(changes: Partial<Draft>) {
    const context = current();
    if (!context) return;
    publish(context, { ...context.entry, draft: { ...context.entry.draft, ...changes }, parent: null, saveFailed: false,
      nameError: changes.name === undefined || changes.name.trim() === '' ? context.entry.nameError : '',
      message: context.entry.uncertain ? context.entry.message : '' });
  }
  function changeView(descriptionView: boolean) {
    const context = current();
    if (context) publish(context, { ...context.entry, descriptionView });
  }
  function discard() {
    const context = current();
    if (!context || context.entry.uncertain) return;
    publish(context, { ...context.entry, draft: fields(context.entry.base), saveFailed: false, nameError: '', parent: null,
      message: '未保存の Project 情報を破棄し、確認済みの保存値に戻しました。' });
  }

  async function save() {
    const context = current();
    if (!context || context.entry.uncertain || composing.current || !dirty(context.entry)) return;
    const submitted = context.entry.draft;
    if (context.entry.base.taskTypeLocked && submitted.taskType !== context.entry.base.project.taskType) return;
    const input = projectUpdateInputSchema.safeParse({ id: context.projectId, ...submitted });
    if (!input.success) {
      publish(context, { ...context.entry, nameError: 'Project名を入力してください。', descriptionView: false,
        message: '入力内容を確認してください。' });
      nameInput.current?.focus();
      return;
    }
    const ticket: Pending = { kind: 'save', base: context.entry.base };
    publish(context, { ...context.entry, pending: ticket, parent: null, nameError: '', saveFailed: false,
      message: '保存中です。戻っても保存処理は取り消されません。' });
    let response: ProjectUpdateResponse;
    try { response = projectUpdateResponseSchema.parse(await api.update(input.data)); }
    catch { response = { ok: false, error: { code: 'OPERATION_FAILED' } }; }
    if (!accept(context, ticket)) return;
    if (!response.ok) {
      if (response.error.code === 'OPERATION_FAILED') uncertain(context, 'save');
      else publish(context, { ...context.entry, pending: null, saveFailed: true, message: errors[response.error.code] });
      return;
    }
    if (response.value.project.id !== context.projectId || superseded(context, ticket, response.value)) {
      uncertain(context, 'save'); return;
    }
    const confirmed = response.value;
    const latest = context.entry.draft;
    publish(context, { ...mergeSaved(context.entry, confirmed), pending: null, uncertain: null, saveFailed: false, nameError: '',
      draft: {
        name: latest.name === submitted.name ? confirmed.project.name : latest.name,
        description: latest.description === submitted.description ? confirmed.project.description : latest.description,
        taskType: latest.taskType === submitted.taskType ? confirmed.project.taskType : latest.taskType,
      }, message: 'Project情報を保存しました。' });
    context.onSaved(confirmed); // Callback exceptions are not transport failures.
  }

  async function readSaved() {
    const context = current();
    if (!context) return;
    const ticket: Pending = { kind: 'read', base: context.entry.base };
    publish(context, { ...context.entry, pending: ticket, parent: null, message: '保存済みの内容を確認中です。' });
    let response: ProjectGetResponse;
    try { response = projectGetResponseSchema.parse(await api.get({ projectId: context.projectId })); }
    catch { response = { ok: false, error: { code: 'OPERATION_FAILED' } }; }
    if (!accept(context, ticket)) return;
    if (!response.ok || response.value.project.id !== context.projectId) {
      publish(context, { ...context.entry, pending: null, message: '保存済みの内容を確認できませんでした。'
        + (response.ok ? errors.OPERATION_FAILED : errors[response.error.code]) });
      return;
    }
    if (superseded(context, ticket, response.value)) {
      publish(context, { ...context.entry, pending: null, message: '確認中に保存済みの内容が変わりました。もう一度確認してください。' });
      return;
    }
    publish(context, { ...mergeSaved(context.entry, response.value), pending: null, uncertain: null, saveFailed: false,
      message: '保存済みの内容を確認しました。未保存の編集内容は保持しています。' });
    context.onSaved(response.value);
  }

  async function pickParent() {
    const context = current();
    if (!context || context.entry.uncertain || dirty(context.entry) || context.entry.saveFailed || needsRecovery(context.entry)) return;
    const ticket: Pending = { kind: 'pick', base: context.entry.base };
    // Discard the previous capability BEFORE opening a new native dialog.
    publish(context, { ...context.entry, pending: ticket, parent: null, message: '移動先の親フォルダーを選択中です。' });
    let response: ProjectPickParentResponse;
    try { response = projectPickParentResponseSchema.parse(await api.pickParent({ purpose: 'move', projectId: context.projectId })); }
    catch { response = { ok: false, error: { code: 'OPERATION_FAILED' } }; }
    if (!accept(context, ticket)) return;
    if (!sameSnapshot(context.entry.base, ticket.base) || dirty(context.entry)) {
      publish(context, { ...context.entry, pending: null, message: errors.STALE_SELECTION }); return;
    }
    const parent = response.ok && response.value.status === 'selected' ? response.value : null;
    publish(context, { ...context.entry, pending: null, parent, message: !response.ok
      ? response.error.code === 'OPERATION_FAILED' ? '親フォルダーを選択できませんでした。選び直してください。' : errors[response.error.code]
      : parent ? '移動先の親フォルダーを選択しました。まだ移動していません。' : 'フォルダーの選択をキャンセルしました。' });
  }

  async function moveOrRecover(kind: 'move' | 'recover') {
    const context = current();
    if (!context || context.entry.uncertain || dirty(context.entry) || context.entry.saveFailed) return;
    const parent = context.entry.parent;
    if (kind === 'move' && (!parent || needsRecovery(context.entry))) return;
    const ticket: Pending = { kind, base: context.entry.base };
    // Burn on every attempt, including BUSY, thrown getters and lost responses.
    // displayPath is text only; never concatenate, open or send it to Main.
    publish(context, { ...context.entry, pending: ticket, parent: null,
      message: kind === 'move' ? '保存場所を変更中です。戻っても処理は取り消されません。' : '旧領域の復旧を確認中です。戻っても処理は取り消されません。' });
    let response: ProjectMoveResponse;
    try {
      response = kind === 'move'
        ? projectMoveResponseSchema.parse(await api.move({ projectId: context.projectId, parentToken: parent!.token }))
        : projectRecoverResponseSchema.parse(await api.recover({ projectId: context.projectId }));
    } catch { response = { ok: false, error: { code: 'OPERATION_FAILED' } }; }
    if (!accept(context, ticket)) return;
    if (!response.ok) {
      if (response.error.code === 'OPERATION_FAILED') uncertain(context, kind);
      else publish(context, { ...context.entry, pending: null, message: errors[response.error.code] });
      return;
    }
    const confirmed = projectSnapshotSchema.parse({ project: response.value.project, taskTypeLocked: response.value.taskTypeLocked });
    if (confirmed.project.id !== context.projectId || superseded(context, ticket, confirmed)) {
      uncertain(context, kind); return;
    }
    const cleanup = response.value.cleanupStatus;
    publish(context, { ...mergeSaved(context.entry, confirmed), pending: null, uncertain: null, cleanup,
      message: cleanup === 'source-retained' ? '保存先はDBの現在値です。移動・回収状態の確認が必要です。'
        : cleanup === 'completed' ? '保存先を確認しました。旧領域の回収は完了しています。'
          : '保存先を確認しました。復旧対象の移動記録はありません。回収完了を意味しません。' });
    context.onSaved(confirmed);
  }

  function leave() {
    const context = contextRef.current;
    if (!context?.active) return;
    publish(context, abandon(context.entry));
    context.active = false;
    setState((previous) => ({ ...previous, left: true }));
    context.onBack();
  }

  if (!visible || state.left) return null;
  const pending = entry.pending !== null;
  const changed = dirty(entry);
  const taskConflict = entry.base.taskTypeLocked && entry.draft.taskType !== entry.base.project.taskType;
  const saveStatus = entry.uncertain === 'save' ? '保存結果不明' : entry.pending?.kind === 'save' ? '保存中'
    : entry.saveFailed ? '保存失敗' : changed ? '未保存' : '保存済み';
  return (
    <form className="project-form" aria-labelledby={`${id}-heading`} noValidate
      onSubmit={(event) => { event.preventDefault(); void save(); }}
      onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
      onKeyDown={(event) => {
        const navigation = event.target instanceof HTMLButtonElement && event.target.type === 'button';
        if (event.key === 'Enter' && (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229
          || (pending && !navigation))) event.preventDefault();
      }}>
      <h1 id={`${id}-heading`}>Project 設定</h1>
      <fieldset className="project-form__fields" disabled={pending} aria-label="Project 情報" aria-busy={pending}>
        {entry.descriptionView ? (
          <div className="project-form__description">
            <label htmlFor={`${id}-description`}>説明（任意）</label>
            <textarea ref={descriptionInput} id={`${id}-description`} rows={4} value={entry.draft.description}
              onChange={(event) => edit({ description: event.currentTarget.value })} />
            <button type="button" onClick={() => changeView(false)}><SystemIcon name="back" /><span>入力項目に戻る</span></button>
          </div>
        ) : (
          <div className="project-form__metadata">
            <div className="project-form__row">
              <div className="project-form__name">
                <label htmlFor={`${id}-name`}>名前（必須）</label>
                <input ref={nameInput} id={`${id}-name`} type="text" required value={entry.draft.name}
                  aria-invalid={Boolean(entry.nameError)} aria-describedby={entry.nameError ? `${id}-name-error` : undefined}
                  onChange={(event) => edit({ name: event.currentTarget.value })} />
                {entry.nameError && <p className="project-form__error" id={`${id}-name-error`}>{entry.nameError}</p>}
              </div>
              <fieldset className="project-form__task" disabled={entry.base.taskTypeLocked} aria-describedby={`${id}-task-help`}>
                <legend>タスク種別</legend>
                <div className="project-form__types">
                  <label><input type="radio" name={`${id}-task`} value="classification" checked={entry.draft.taskType === 'classification'}
                    onChange={() => { if (!entry.base.taskTypeLocked) edit({ taskType: 'classification' }); }} />画像分類</label>
                  <label><input type="radio" name={`${id}-task`} value="detection" checked={entry.draft.taskType === 'detection'}
                    onChange={() => { if (!entry.base.taskTypeLocked) edit({ taskType: 'detection' }); }} />物体検出</label>
                </div>
              </fieldset>
            </div>
            <button ref={descriptionOpener} type="button" onClick={() => changeView(true)}>説明を編集（任意）</button>
          </div>
        )}
        <p id={`${id}-task-help`} className="project-form__hint">{entry.base.taskTypeLocked
          ? '初回 Run 作成済みのため、タスク種別は変更できません。名前と説明は編集できます。'
          : 'タスク種別は初回 Run 作成まで変更できます。ラベル定義のロックとは別です。'}</p>
        {taskConflict && <div>
          <p className="project-form__error">未保存のタスク種別は保存できません。保存済みの種別に戻してください。</p>
          <button type="button" onClick={() => edit({ taskType: entry.base.project.taskType })}>タスク種別の変更を破棄</button>
        </div>}
      </fieldset>
      <p id={`${id}-status`} className="project-form__status" role="status" aria-live="polite" aria-atomic="true">
        Project情報：{saveStatus}。{entry.uncertain && entry.uncertain !== 'save' && '保存場所の処理結果不明。'}{entry.message}
      </p>
      <div className="project-form__destination">
        <span>{entry.uncertain ? '保存先（前回確認値・現在は未確認）' : '保存先（DB確認済み）'}</span>
        <p className="project-form__path" tabIndex={0}>{entry.base.project.workspacePath}</p>
      </div>
      {needsRecovery(entry) && <p className="project-form__error">{entry.cleanup === 'source-retained'
        ? PROJECT_SOURCE_CLEANUP_FAILED_MESSAGE
        : '旧領域の回収状態は未確認です。保存結果を確認した後、移動をやり直さず明示的な復旧で確認してください。'}</p>}
      <fieldset disabled={pending || Boolean(entry.uncertain) || changed || entry.saveFailed} aria-label="保存場所の変更・復旧">
        <legend>保存場所の変更・復旧</legend>
        <div className="project-form__actions">
          <button type="button" disabled={needsRecovery(entry)} onClick={() => { void pickParent(); }}>
            <SystemIcon name="projects" /><span>移動先の親フォルダーを選択</span>
          </button>
          <button type="button" disabled={!entry.parent || needsRecovery(entry)} onClick={() => { void moveOrRecover('move'); }}>保存場所を変更</button>
          <button type="button" onClick={() => { void moveOrRecover('recover'); }}>旧領域の復旧を確認</button>
        </div>
        <p className="project-form__path" tabIndex={entry.parent ? 0 : undefined}>{entry.parent?.displayPath ?? '移動先の親フォルダー：未選択'}</p>
      </fieldset>
      <p className="project-form__hint">移動・復旧の前に Project 情報を保存するか、未保存の変更を明示的に破棄してください。外部の Reference 元は変更しません。</p>
      <div className="project-form__actions">
        <button type="submit" className="project-form__primary" disabled={pending || Boolean(entry.uncertain) || !changed || taskConflict}>Project情報を保存</button>
        <button type="button" disabled={pending || Boolean(entry.uncertain) || (!changed && !entry.saveFailed)} onClick={discard}>未保存の変更を破棄</button>
        <button type="button" disabled={pending} onClick={() => { void readSaved(); }}>保存結果を確認</button>
        <button type="button" onClick={leave}><SystemIcon name="back" /><span>{changed ? '未保存の変更を保持して戻る' : '戻る'}</span></button>
      </div>
    </form>
  );
}