import { useEffect, useRef, useState } from 'react';
import type { Project } from '../../../shared/contracts/project';
import { normalizeLabelClassName, type LabelClass, type LabelSchemaSnapshot } from '../../../shared/contracts/annotation';
import * as c from '../../../shared/contracts/annotation-ipc';
import { SystemIcon } from '../../components/SystemIcon';
import './LabelSchemaPage.css';

export interface LabelSchemaPageProps {
  project: Project;
  api: c.LabelSchemaApi;
  visible?: boolean;
  onBack: () => void;
}
type Fields = { displayName: string; modelAlias: string; color: string; description: string; examples: string };
type Draft = { base: LabelClass; edits: Partial<Fields> };
const emptyFields = (): Fields => ({ displayName: '', modelAlias: '', color: '#0078d4', description: '', examples: '' });
const fields = (item: LabelClass): Fields => ({ displayName: item.displayName, modelAlias: item.modelAlias ?? '',
  color: item.color, description: item.description, examples: item.examples.join('\n') });
const messages: Record<c.AnnotationIpcErrorCode, string> = {
  INVALID_REQUEST: '入力内容を確認してください。名前・別名・色・文字数が不正です。',
  NOT_FOUND: '対象が見つかりません。現在の保存内容を確認してください。',
  CONFLICT: '他の変更と競合しました。下書きを保持しています。現在の保存内容を確認してください。',
  LOCKED: '初回学習開始後はラベル定義を変更できません。',
  CLASS_USED: 'このクラスは使用中のため削除できません。クラスは保持されています。',
  HISTORY_REFERENCE: '履歴から参照されているため変更できません。元のクラスは保持されています。',
  BUSY: '別の処理中です。完了を待ってから再度操作してください。',
  OPERATION_FAILED: '処理結果を確認できません。下書きを保持しています。現在の保存内容を確認してください。',
};

/** Context identity is monotonic: an A → B → A response cannot re-enter A.
 * Visibility deliberately is not part of identity; hidden commits still settle. */
export function LabelSchemaPage(props: LabelSchemaPageProps) {
  const [scope, setScope] = useState({ projectId: String(props.project.id), api: props.api, generation: 0 });
  if (scope.projectId !== String(props.project.id) || scope.api !== props.api) {
    setScope({ projectId: String(props.project.id), api: props.api, generation: scope.generation + 1 });
    return null;
  }
  return <LabelSchemaEditor key={scope.generation} {...props} />;
}

function LabelSchemaEditor({ project, api, visible = true, onBack }: LabelSchemaPageProps) {
  const [saved, setSaved] = useState<LabelSchemaSnapshot | null>();
  const [drafts, setDrafts] = useState<Map<string, Draft>>(() => new Map());
  const [instructions, setInstructions] = useState<string | null>(null);
  const [newClass, setNewClass] = useState<Fields>(emptyFields);
  const [newDirty, setNewDirty] = useState(false);
  const [source, setSource] = useState('');
  const [target, setTarget] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [lockedError, setLockedError] = useState(false);
  const [message, setMessage] = useState('未読込');
  const session = useRef({ active: false });
  const requested = useRef(false);
  const mutex = useRef(false);
  const composing = useRef(false);
  const root = useRef<HTMLElement>(null);
  const cancelDelete = useRef<HTMLButtonElement>(null);
  const deleteOpener = useRef<HTMLButtonElement | null>(null);
  const backSent = useRef(false);
  useEffect(() => {
    const current = { active: true }; session.current = current;
    return () => { current.active = false; requested.current = false; mutex.current = false; };
  }, []);
  useEffect(() => {
    if (visible) { backSent.current = false; if (!requested.current) void load(); }
    else if (root.current?.contains(document.activeElement)) (document.activeElement as HTMLElement | null)?.blur();
    // Only first visibility loads automatically; refresh is an explicit command.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  useEffect(() => { if (visible && deleting) cancelDelete.current?.focus(); }, [deleting, visible]);

  const locked = lockedError || saved?.lockedAt != null;
  const disabled = busy || locked || uncertain;
  const dirty = drafts.size > 0 || instructions !== null || newDirty;
  function fail(code: c.AnnotationIpcErrorCode) {
    setMessage(messages[code]);
    if (code === 'LOCKED') setLockedError(true);
    if (code === 'OPERATION_FAILED' || code === 'CONFLICT' || code === 'NOT_FOUND') setUncertain(true);
  }
  async function load() {
    if (mutex.current) return;
    mutex.current = true; requested.current = true; setBusy(true); setMessage('読込中');
    const current = session.current;
    try {
      const request = c.labelGetInputSchema.parse({ projectId: project.id });
      const response = c.parseLabelGetResponse(await api.get(request), request);
      if (!current.active) return;
      if (!response.ok) { fail(response.error.code); return; }
      if (saved && (!response.value || response.value.id !== saved.id || response.value.editVersion < saved.editVersion)) throw new Error();
      setSaved(response.value); setUncertain(false); setLockedError(false); setMessage('保存内容を確認しました。');
    } catch { if (current.active) fail('OPERATION_FAILED'); }
    finally { if (current.active) { mutex.current = false; setBusy(false); } }
  }
  async function mutate(run: () => Promise<c.LabelCreateResponse>, clear: () => void,
    check: (next: LabelSchemaSnapshot) => boolean = () => true) {
    if (!visible || mutex.current || locked || uncertain || composing.current) return;
    mutex.current = true; setBusy(true); setMessage('保存中');
    const current = session.current;
    try {
      const response = await run();
      if (!current.active) return;
      if (!response.ok) { fail(response.error.code); return; }
      if ((saved && (saved.editVersion === Number.MAX_SAFE_INTEGER || response.value.editVersion !== saved.editVersion + 1))
        || !check(response.value)) throw new Error();
      setSaved(response.value); clear(); setMessage('保存済み');
    } catch { if (current.active) fail('OPERATION_FAILED'); }
    finally { if (current.active) { mutex.current = false; setBusy(false); } }
  }
  function clearClass(id: string) { setDrafts((old) => { const next = new Map(old); next.delete(id); return next; }); }
  function saveClass(item?: LabelClass) {
    if (!saved || disabled || mutex.current || !visible || composing.current) return;
    const draft = item ? drafts.get(item.id) : undefined;
    const value = item ? { ...fields(item), ...draft?.edits } : newClass;
    const ordinal = item?.ordinal ?? saved.classes.reduce((max, entry) => Math.max(max, entry.ordinal), -1) + 1;
    const editable = { ...value, modelAlias: value.modelAlias === '' ? null : value.modelAlias,
      // Joining for display is not reversible for embedded newlines or [''].
      // Preserve the original text array unless this field was actually edited.
      examples: item && draft?.edits.examples === undefined ? [...item.examples]
        : value.examples === '' ? [] : value.examples.split('\n'), ordinal,
      schemaId: saved.id, projectId: project.id, expectedEditVersion: saved.editVersion };
    if (saved.classes.some((entry) => entry.id !== item?.id && entry.normalizedName === normalizeLabelClassName(value.displayName))) {
      setMessage('同じ名前のクラスがあります。全角・半角、前後の空白、大文字・小文字を区別しません。'); return;
    }
    if (item) {
      const parsed = c.labelUpdateClassInputSchema.safeParse({ ...editable, id: item.id });
      if (!parsed.success) { fail('INVALID_REQUEST'); return; }
      void mutate(async () => c.parseLabelUpdateClassResponse(await api.updateClass(parsed.data), parsed.data),
        () => clearClass(item.id), (next) => next.classes.some((entry) => entry.id === item.id));
    } else {
      const parsed = c.labelCreateClassInputSchema.safeParse(editable);
      if (!parsed.success) { fail('INVALID_REQUEST'); return; }
      void mutate(async () => c.parseLabelCreateClassResponse(await api.createClass(parsed.data), parsed.data),
        () => { setNewClass(emptyFields()); setNewDirty(false); },
        (next) => next.classes.some((entry) => !saved.classes.some((old) => old.id === entry.id)));
    }
  }
  function saveInstructions() {
    if (!saved || instructions === null) return;
    const parsed = c.labelUpdateInputSchema.safeParse({ projectId: project.id, id: saved.id,
      expectedEditVersion: saved.editVersion, instructions });
    if (!parsed.success) { fail('INVALID_REQUEST'); return; }
    void mutate(async () => c.parseLabelUpdateResponse(await api.update(parsed.data), parsed.data), () => setInstructions(null));
  }
  function closeDelete() { setDeleting(null); deleteOpener.current?.focus(); }
  function remove() {
    if (!saved || !deleting) return;
    const id = deleting;
    const parsed = c.labelDeleteClassInputSchema.safeParse({ projectId: project.id, schemaId: saved.id,
      classId: id, expectedEditVersion: saved.editVersion });
    if (!parsed.success) { fail('INVALID_REQUEST'); return; }
    void mutate(async () => c.parseLabelDeleteClassResponse(await api.deleteClass(parsed.data), parsed.data),
      () => { clearClass(id); setDeleting(null); }, (next) => !next.classes.some((entry) => entry.id === id));
  }
  function merge() {
    if (!saved) return;
    if (drafts.has(source) || drafts.has(target)) { setMessage('統合元・統合先の未保存の変更を先に保存してください。'); return; }
    const parsed = c.labelMergeClassesInputSchema.safeParse({ projectId: project.id, schemaId: saved.id,
      sourceId: source, targetId: target, expectedEditVersion: saved.editVersion });
    if (!parsed.success || !saved.classes.some((entry) => entry.id === source) || !saved.classes.some((entry) => entry.id === target)) {
      setMessage('異なる統合元と統合先を選択してください。'); return;
    }
    void mutate(async () => c.parseLabelMergeClassesResponse(await api.mergeClasses(parsed.data), parsed.data),
      () => { setSource(''); setTarget(''); },
      (next) => !next.classes.some((entry) => entry.id === source) && next.classes.some((entry) => entry.id === target));
  }
  const existing = saved?.classes ?? [];
  const removed = [...drafts.values()].filter((draft) => !existing.some((item) => item.id === draft.base.id));
  function editor(value: Fields, change: (key: keyof Fields, text: string) => void) {
    return <>
      <label>名前（必須）<input required value={value.displayName} onChange={(e) => change('displayName', e.target.value)} /></label>
      <label>モデル別名（任意）<input value={value.modelAlias} onChange={(e) => change('modelAlias', e.target.value)} /></label>
      <label>色（#rrggbb）<input value={value.color} onChange={(e) => change('color', e.target.value)} /></label>
      <label>説明<textarea value={value.description} onChange={(e) => change('description', e.target.value)} /></label>
      <label>例（1行に1件・文字列のみ）<textarea value={value.examples} onChange={(e) => change('examples', e.target.value)} /></label>
    </>;
  }
  return <section ref={root} hidden={!visible} className="label-schema-page" aria-label="ラベル定義"
    onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
    onKeyDown={(e) => { if (e.key === 'Enter' && (e.nativeEvent.isComposing || e.keyCode === 229)) e.preventDefault(); }}>
    <header><h1>ラベル定義</h1><p>Project: {project.name} ／ タスク: {project.taskType === 'classification' ? '画像分類' : '物体検出'}</p>
      <button type="button" onClick={() => { if (visible && !backSent.current) { backSent.current = true; onBack(); } }}>
        <SystemIcon name="back" />{dirty ? '未保存の変更を保持して戻る' : '戻る'}</button></header>
    <p role="status" aria-live="polite">{message}{dirty ? ' ／ 未保存の変更があります。' : ''}{busy ? ' 戻っても処理は取り消されません。' : ''}</p>
    {locked && <p>初回学習開始後はラベル定義を変更できません。閲覧のみ可能です。</p>}
    <button type="button" disabled={busy} onClick={() => { if (visible) void load(); }}>現在の保存内容を確認</button>
    {saved === null && <button type="button" disabled={disabled} onClick={() => {
      const request = c.labelCreateInputSchema.safeParse({ projectId: project.id });
      if (!request.success) { fail('INVALID_REQUEST'); return; }
      void mutate(async () => c.parseLabelCreateResponse(await api.create(request.data), request.data), () => undefined);
    }}>ラベル定義を作成</button>}
    {saved && <>
      <form aria-label="作業指示" onSubmit={(e) => { e.preventDefault(); saveInstructions(); }}>
        <fieldset disabled={disabled}><legend>作業指示</legend>
          <label>指示文<textarea value={instructions ?? saved.instructions} onChange={(e) => setInstructions(e.target.value)} /></label>
          <button type="submit" disabled={instructions === null}>指示文を保存</button>
        </fieldset>
      </form>
      {[...existing].sort((a, b) => a.ordinal - b.ordinal).map((item) => <form key={item.id} aria-label={`クラス: ${item.displayName}`}
        onSubmit={(e) => { e.preventDefault(); if (drafts.has(item.id)) saveClass(item); }}>
        <fieldset disabled={disabled}><legend>{item.displayName}</legend>
          {editor({ ...fields(item), ...drafts.get(item.id)?.edits }, (key, text) => setDrafts((old) => {
            const next = new Map(old); const draft = old.get(item.id);
            next.set(item.id, { base: item, edits: { ...draft?.edits, [key]: text } }); return next;
          }))}
          <button type="submit" disabled={!drafts.has(item.id)}>クラスを保存</button>
          <button type="button" onClick={(e) => { if (!disabled && visible) { deleteOpener.current = e.currentTarget; setDeleting(item.id); } }}>クラスを削除</button>
        </fieldset>
      </form>)}
      {removed.map((draft) => <section key={draft.base.id} aria-label="削除されたクラスの下書き">
        <p>保存先からクラスが削除されています。下書きは保持しています。内容をコピーして新しいクラスとして作成できます。</p>
        <fieldset disabled><legend>{draft.base.displayName}</legend>{editor({ ...fields(draft.base), ...draft.edits }, () => undefined)}</fieldset>
      </section>)}
      <form aria-label="新しいクラス" onSubmit={(e) => { e.preventDefault(); saveClass(); }}>
        <fieldset disabled={disabled}><legend>新しいクラス</legend>
          {editor(newClass, (key, text) => { setNewClass((old) => ({ ...old, [key]: text })); setNewDirty(true); })}
          <button type="submit">クラスを追加</button>
        </fieldset>
      </form>
      <form aria-label="クラス統合" onSubmit={(e) => { e.preventDefault(); merge(); }}>
        <fieldset disabled={disabled}><legend>クラス統合</legend>
          <p>統合元を統合先へまとめます。自動で統合されることはありません。</p>
          <label>統合元<select value={source} onChange={(e) => setSource(e.target.value)}><option value="">選択してください</option>
            {existing.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>
          <label>統合先<select value={target} onChange={(e) => setTarget(e.target.value)}><option value="">選択してください</option>
            {existing.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>
          <button type="submit">選択したクラスを統合</button>
        </fieldset>
      </form>
    </>}
    {deleting && <dialog open aria-label="クラス削除の確認" onCancel={(e) => { e.preventDefault(); closeDelete(); }}>
      <p>このクラスを削除しますか？このクラスの未保存の変更も破棄されます。</p>
      <button ref={cancelDelete} type="button" onClick={closeDelete}>キャンセル</button>
      <button type="button" disabled={disabled} onClick={remove}>削除する</button>
    </dialog>}
  </section>;
}