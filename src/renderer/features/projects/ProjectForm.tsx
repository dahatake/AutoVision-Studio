import { useId, useLayoutEffect, useRef, useState } from 'react';

import { createProjectSchema, type Project } from '../../../shared/contracts/project';
import {
  projectCreateInputSchema, projectCreateResponseSchema, projectPickParentResponseSchema,
  type ProjectApi, type ProjectCreateResponse, type ProjectIpcErrorCode,
  type ProjectParentSelection, type ProjectPickParentResponse, type ProjectSnapshot,
} from '../../../shared/contracts/project-ipc';
import { SystemIcon } from '../../components/SystemIcon';
import './ProjectForm.css';

export interface ProjectFormProps {
  api: Pick<ProjectApi, 'pickParent' | 'create'>;
  onCreated: (snapshot: ProjectSnapshot) => void;
  onCancel: () => void;
}

type Phase = 'idle' | 'picking' | 'creating' | 'uncertain' | 'created' | 'left';
type Parent = Extract<ProjectParentSelection, { status: 'selected' }>;
const uncertainMessage = '作成結果を確認できません。一覧で状態を確認してください。';
const selectionErrors: Record<ProjectIpcErrorCode, string> = {
  INVALID_REQUEST: '入力内容を確認し、親フォルダーを選び直してください。',
  NOT_FOUND: '対象を確認できません。親フォルダーを選び直してください。',
  BUSY: 'ほかの処理が実行中です。完了後に親フォルダーを選び直してください。',
  OPERATION_FAILED: '親フォルダーを選択できませんでした。もう一度選択してください。',
  STALE_SELECTION: 'フォルダーの選択が無効になりました。親フォルダーを選び直してください。',
};

// UIR-025 mounts this only while creating; a fresh form is required after leaving
// or an uncertain create. No edit mode, persistent draft store or path authority.
export function ProjectForm({ api, onCreated, onCancel }: ProjectFormProps) {
  const id = useId();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [taskType, setTaskType] = useState<Project['taskType']>('classification');
  const [parent, setParent] = useState<Parent | null>(null);
  const [descriptionView, setDescriptionView] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState('');
  const [errors, setErrors] = useState({ name: '', parent: false });
  const [snapshot, setSnapshot] = useState<ProjectSnapshot | null>(null);
  const request = useRef({ active: false, busy: false });
  const selection = useRef<Parent | null>(null);
  const callbacks = useRef({ onCreated, onCancel });
  const composing = useRef(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const descriptionInput = useRef<HTMLTextAreaElement>(null);
  const descriptionOpener = useRef<HTMLButtonElement>(null);
  const previousView = useRef(false);

  useLayoutEffect(() => { callbacks.current = { onCreated, onCancel }; }, [onCreated, onCancel]);
  useLayoutEffect(() => {
    // Unique committed context: A -> B -> A must not revive A's first promise.
    // Do not inspect method getters or invoke APIs while rendering/resetting.
    const context = { active: true, busy: false };
    request.current = context; composing.current = false; selection.current = null;
    setName(''); setDescription(''); setTaskType('classification'); setParent(null);
    setDescriptionView(false); setPhase('idle'); setMessage(''); setSnapshot(null);
    setErrors({ name: '', parent: false });
    return () => { context.active = false; };
  }, [api]);
  useLayoutEffect(() => {
    if (previousView.current !== descriptionView) {
      (descriptionView ? descriptionInput.current : errors.name ? nameInput.current : descriptionOpener.current)?.focus();
      previousView.current = descriptionView;
    }
  }, [descriptionView, errors.name]);

  async function pickParent() {
    const context = request.current;
    if (!context.active || context.busy) return;
    context.busy = true; setPhase('picking');
    // Main invalidates its previous capability BEFORE opening the new dialog,
    // even if that dialog later cancels or fails. Never keep the old token.
    selection.current = null; setParent(null); setErrors((previous) => ({ ...previous, parent: false }));
    setMessage('親フォルダーを選択中です。');
    let response: ProjectPickParentResponse;
    try { response = projectPickParentResponseSchema.parse(await api.pickParent({ purpose: 'create' })); }
    catch { response = { ok: false, error: { code: 'OPERATION_FAILED' } }; }
    if (!context.active) return;
    context.busy = false; setPhase('idle');
    if (!response.ok) {
      setErrors((previous) => ({ ...previous, parent: true }));
      setMessage(selectionErrors[response.error.code]);
    } else if (response.value.status === 'selected') {
      selection.current = response.value; setParent(response.value); setMessage('親フォルダーを選択しました。');
    } else setMessage('フォルダーの選択をキャンセルしました。');
  }

  async function create() {
    const context = request.current;
    if (!context.active || context.busy || composing.current) return;
    const chosen = selection.current;
    const input = projectCreateInputSchema.safeParse({ name, description, taskType, parentToken: chosen?.token });
    if (!input.success) {
      setErrors({
        name: createProjectSchema.shape.name.safeParse(name).success ? '' : 'Project名を入力してください。',
        parent: chosen === null,
      });
      setDescriptionView(false);
      setMessage(chosen === null ? '親フォルダーを選択してください。' : '入力内容を確認してください。');
      return; // Local validation has not consumed the OS selection.
    }
    // State may not have rendered yet when a recoverable response arrives.
    selection.current = null; context.busy = true; setPhase('creating'); setParent(null);
    setErrors({ name: '', parent: false });
    setMessage('作成中です。一覧へ戻っても作成処理は取り消されません。結果は一覧で確認してください。');
    // Burn on ANY attempt, including rejected transport or a throwing getter.
    // Only the token is authority; displayPath is never sent or joined to an ID.
    let response: ProjectCreateResponse;
    try { response = projectCreateResponseSchema.parse(await api.create(input.data)); }
    catch { response = { ok: false, error: { code: 'OPERATION_FAILED' } }; }
    if (!context.active) return;
    if (!response.ok) {
      if (response.error.code === 'OPERATION_FAILED') {
        setPhase('uncertain'); setMessage(uncertainMessage); // Keep the synchronous guard closed.
      } else {
        context.busy = false; setPhase('idle');
        setErrors({ name: '', parent: true }); setMessage(selectionErrors[response.error.code]);
      }
      return;
    }
    setSnapshot(response.value); setPhase('created'); setMessage('作成しました。');
    // A parent callback failure is not an IPC failure or evidence of rollback.
    callbacks.current.onCreated(response.value);
  }

  function leave() {
    const context = request.current;
    if (!context.active) return;
    context.active = false; context.busy = true; selection.current = null; setPhase('left');
    callbacks.current.onCancel(); // Navigation only; never cancellation of Main's create.
  }

  const locked = phase !== 'idle';
  const pending = phase === 'picking' || phase === 'creating';
  return (
    <form className="project-form" aria-labelledby={`${id}-heading`} noValidate
      onSubmit={(event) => { event.preventDefault(); void create(); }}
      onCompositionStart={() => { composing.current = true; }}
      onCompositionEnd={() => { composing.current = false; }}
      onKeyDown={(event) => {
        const navigationButton = event.target instanceof HTMLButtonElement && event.target.type === 'button';
        if (event.key === 'Enter' && (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229
          || (request.current.busy && !navigationButton))) event.preventDefault();
      }}>
      <h1 id={`${id}-heading`}>Project を作成</h1>
      <fieldset className="project-form__fields" disabled={locked} aria-label="Project の入力" aria-busy={pending}>
        {descriptionView ? (
          <div className="project-form__description">
            <label htmlFor={`${id}-description`}>説明（任意）</label>
            <textarea ref={descriptionInput} id={`${id}-description`} rows={4} value={description}
              onChange={(event) => setDescription(event.currentTarget.value)} />
            <button type="button" onClick={() => setDescriptionView(false)}>
              <SystemIcon name="back" /><span>入力項目に戻る</span>
            </button>
          </div>
        ) : (
          <div className="project-form__metadata">
            <div className="project-form__row">
              <div className="project-form__name">
                <label htmlFor={`${id}-name`}>名前（必須）</label>
                <input ref={nameInput} id={`${id}-name`} type="text" required value={name}
                  aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? `${id}-name-error` : undefined}
                  onChange={(event) => {
                    const value = event.currentTarget.value; setName(value);
                    setErrors((previous) => ({ ...previous,
                      name: previous.name && !createProjectSchema.shape.name.safeParse(value).success ? previous.name : '',
                    }));
                  }} />
                {errors.name && <p id={`${id}-name-error`} className="project-form__error">{errors.name}</p>}
              </div>
              <fieldset className="project-form__task">
                <legend>タスク種別</legend>
                <div className="project-form__types">
                  <label><input type="radio" name={`${id}-task`} value="classification" checked={taskType === 'classification'}
                    onChange={() => setTaskType('classification')} />画像分類</label>
                  <label><input type="radio" name={`${id}-task`} value="detection" checked={taskType === 'detection'}
                    onChange={() => setTaskType('detection')} />物体検出</label>
                </div>
              </fieldset>
            </div>
            <div className="project-form__parent">
              <span>保存先の親フォルダー（必須）</span>
              <button type="button" onClick={() => { void pickParent(); }} aria-invalid={errors.parent}
                aria-describedby={errors.parent ? `${id}-parent-help ${id}-status` : `${id}-parent-help`}>
                <SystemIcon name="projects" /><span>親フォルダーを選択</span>
              </button>
            </div>
            <p className="project-form__path" tabIndex={parent ? 0 : undefined}>{parent?.displayPath ?? '未選択'}</p>
            <p id={`${id}-parent-help`} className="project-form__hint">選択した親の中にUUIDの専用フォルダーを作成します。</p>
            <button ref={descriptionOpener} type="button" onClick={() => setDescriptionView(true)}>説明を編集（任意）</button>
          </div>
        )}
      </fieldset>
      <p id={`${id}-status`} className="project-form__status" role="status" aria-live="polite" aria-atomic="true">{message}</p>
      {snapshot && (
        <div className="project-form__destination">
          <span>保存先（作成済み）</span>
          <p className="project-form__path" tabIndex={0}>{snapshot.project.workspacePath}</p>
        </div>
      )}
      <div className="project-form__actions">
        <button type="submit" disabled={locked} className={phase === 'uncertain' ? undefined : 'project-form__primary'}>作成</button>
        <button type="button" disabled={phase === 'left'} onClick={leave}
          className={phase === 'uncertain' ? 'project-form__primary' : undefined}>
          <SystemIcon name="back" />
          <span>{phase === 'uncertain' ? '一覧で確認' : phase === 'creating' ? '結果未確認のまま一覧へ戻る'
            : phase === 'created' ? '一覧に戻る' : 'キャンセル'}</span>
        </button>
      </div>
    </form>
  );
}
