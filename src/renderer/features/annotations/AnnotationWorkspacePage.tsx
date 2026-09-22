import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';

import type {
  Annotation, AnnotationItem, AnnotationRectangle, AnnotationWorkspace, LabelClass, LabelSchemaSnapshot,
} from '../../../shared/contracts/annotation';
import * as c from '../../../shared/contracts/annotation-ipc';
import type { Project } from '../../../shared/contracts/project';
import * as ref from '../../../shared/contracts/reference-ipc';
import * as r from '../../../shared/contracts/revision-ipc';
import { ClassificationEditor } from './ClassificationEditor';
import { ConfirmDatasetDialog, type ConfirmDatasetDialogSummary } from './ConfirmDatasetDialog';
import { DetectionCanvas } from './DetectionCanvas';
import { ImageGallery } from './ImageGallery';
import { NoObjectButton } from './NoObjectButton';
import { RectangleLayer } from './RectangleLayer';
import { RectangleTransformer } from './RectangleTransformer';
import { RegionList } from './RegionList';
import { useAnnotationDraft } from './useAnnotationDraft';
import type { Size, Viewport } from './canvas-coordinates';

export interface AnnotationWorkspaceProps {
  readonly project: Project;
  readonly annotations: c.AnnotationApi;
  readonly labelSchemas: Pick<c.LabelSchemaApi, 'get'>;
  readonly revisions: r.RevisionApi;
  readonly references?: ref.ReferenceApi | null;
  readonly visible?: boolean;
}

const PAGE_LIMIT = 200;
const DEFAULT_SPLIT_SEED = 20_260_922;
const CONFIRMED_BY = 'local-operator';
const DEFAULT_STAGE_WIDTH = 640;
/** Fixed stage height: a measured height would feed the canvas size back into
 * its own container and grow without bound. */
const STAGE_HEIGHT = 420;
const EXCLUSION_REASONS = ['対象外の画像', '品質不足', '重複', '権利未確認'] as const;

const annotationErrors: Record<c.AnnotationIpcErrorCode, string> = {
  INVALID_REQUEST: '入力内容を確認できません。Project を選び直してください。',
  NOT_FOUND: '対象が見つかりません。取り込み状況を確認してください。',
  CONFLICT: '他の変更と競合しました。再読込してください。',
  LOCKED: 'この Workspace は変更できません。',
  CLASS_USED: 'クラスが使用中です。',
  HISTORY_REFERENCE: '履歴から参照されているため変更できません。',
  BUSY: '別の処理中です。完了を待ってから再度操作してください。',
  OPERATION_FAILED: '処理に失敗しました。再読込してください。',
};
const revisionErrors: Record<r.RevisionIpcErrorCode, string> = {
  INVALID_REQUEST: '確定内容を確認できません。再読込してください。',
  NOT_FOUND: '対象の Workspace が見つかりません。',
  CONFLICT: '他の変更と競合しました。再読込してください。',
  BUSY: '別の処理中です。完了を待ってから再度確定してください。',
  OPERATION_FAILED: '確定に失敗しました。状態を確認してください。',
};
const referenceErrors: Record<ref.ReferenceIpcErrorCode, string> = {
  INVALID_REQUEST: '参照元の確認内容を検証できません。再読込してください。',
  NOT_FOUND: '対象の参照元が見つかりません。取り込み状況を確認してください。',
  MISMATCH: '選んだファイルは元の内容と一致しません（サイズまたは内容が異なります）。同じファイルを選び直してください。',
  BUSY: '別の処理中です。完了を待ってから再度実行してください。',
  OPERATION_FAILED: '参照元を確認できませんでした。状態を確認してください。',
};
const referenceReasons: Record<ref.ReferenceBrokenEntry['reason'], string> = {
  missing: '元のファイルが見つかりません',
  inaccessible: '元のファイルを開けません',
  unsafe: '元のファイルの場所を安全に扱えません',
  'read-failed': '元のファイルを読み取れません',
  changed: '元のファイルの内容が変わっています',
  'identity-changed': '元のファイルが別のファイルに置き換わっています',
  'size-changed': '元のファイルのサイズが変わっています',
  'mtime-changed': '元のファイルの更新日時が変わっています',
  'hash-changed': '元のファイルの内容が変わっています（ハッシュ不一致）',
};

function isOpen(item: AnnotationItem): boolean {
  return item.state !== 'confirmed' && item.state !== 'excluded';
}

/**
 * Width probe for the detection stage. Only the width is measured, from an
 * empty element: measuring the element that contains the stage would feed the
 * stage's own height back into its container size and grow without bound.
 */
function useProbeWidth(fallback: number): [(element: HTMLDivElement | null) => void, number] {
  const [width, setWidth] = useState(fallback);
  const observer = useRef<ResizeObserver | null>(null);
  const attach = useCallback((element: HTMLDivElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!element) return;
    const measure = () => {
      const next = Math.max(1, Math.round(element.getBoundingClientRect().width));
      setWidth((previous) => (previous === next ? previous : next));
    };
    measure();
    if (typeof ResizeObserver === 'function') {
      const next = new ResizeObserver(measure);
      next.observe(element);
      observer.current = next;
    }
  }, []);
  useEffect(() => () => { observer.current?.disconnect(); observer.current = null; }, []);
  return [attach, width];
}

/**
 * W2-02..W2-24 の leaf を 1 画面へ結線する。取り込み済み Workspace の item を
 * 一覧・編集・人手確認し、Dataset Revision を確定して学習 Queue へ渡すまでを
 * 実 IPC だけで行う。ここでは新しい契約・channel・保存経路を作らない。
 */
export function AnnotationWorkspacePage(props: AnnotationWorkspaceProps) {
  const identity = `${props.project.id}:${props.project.taskType}`;
  const [scope, setScope] = useState({ identity, generation: 0 });
  if (scope.identity !== identity) {
    setScope({ identity, generation: scope.generation + 1 });
    return null;
  }
  return <AnnotationWorkspaceSession key={scope.generation} {...props} />;
}

function AnnotationWorkspaceSession({
  project, annotations, labelSchemas, revisions, references, visible = true,
}: AnnotationWorkspaceProps) {
  const [workspace, setWorkspace] = useState<AnnotationWorkspace | null>(null);
  const [items, setItems] = useState<readonly AnnotationItem[]>([]);
  /** Workspace-wide count from Main. `items` only holds the first page. */
  const [total, setTotal] = useState(0);
  const [schema, setSchema] = useState<LabelSchemaSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AnnotationItem | null>(null);
  const [message, setMessage] = useState('未読込');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<ConfirmDatasetDialogSummary | null>(null);
  const [queued, setQueued] = useState<{ revisionNo: number; jobId: string; status: string } | null>(null);
  const [referenceState, setReferenceState] = useState<ref.ReferenceStatus | null>(null);
  const [referenceNotice, setReferenceNotice] = useState<{ tone: 'status' | 'alert'; text: string } | null>(null);
  const requested = useRef(false);
  const session = useRef({ active: true });

  useEffect(() => {
    const current = { active: true };
    session.current = current;
    return () => { current.active = false; };
  }, []);
  useEffect(() => {
    if (visible && !requested.current) { requested.current = true; void load(); }
    // Only the first visibility loads automatically; refresh is an explicit command.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const classes: readonly LabelClass[] = schema?.classes ?? [];
  const instructions = schema?.instructions ?? '';
  const openCount = items.filter(isOpen).length;

  async function load(keepSelection = false): Promise<void> {
    const current = session.current;
    setBusy(true); setError(''); setMessage('読込中');
    try {
      const workspacesInput = c.annotationWorkspacesInputSchema.parse({ projectId: project.id });
      const found = c.parseAnnotationWorkspacesResponse(await annotations.workspaces(workspacesInput), workspacesInput);
      if (!current.active) return;
      if (!found.ok) { reset(annotationErrors[found.error.code]); return; }
      if (found.value.length === 0) {
        reset('取り込み済みの Workspace がありません。先にデータ取り込みを行ってください。');
        return;
      }
      const latest = found.value.reduce((best, candidate) => (candidate.createdAt > best.createdAt ? candidate : best));
      const listInput = c.annotationListInputSchema.parse({
        projectId: project.id, workspaceId: latest.id, offset: 0, limit: PAGE_LIMIT,
      });
      const listed = c.parseAnnotationListResponse(await annotations.list(listInput), listInput);
      if (!current.active) return;
      if (!listed.ok) { reset(annotationErrors[listed.error.code]); return; }
      const schemaInput = c.labelGetInputSchema.parse({ projectId: project.id });
      const loadedSchema = c.parseLabelGetResponse(await labelSchemas.get(schemaInput), schemaInput);
      if (!current.active) return;
      setWorkspace(latest);
      setItems(listed.value.items);
      setTotal(listed.value.total);
      setSchema(loadedSchema.ok ? loadedSchema.value : null);
      if (!loadedSchema.ok) setError(annotationErrors[loadedSchema.error.code]);
      setMessage(listed.value.total === 0 ? '対象画像がありません。' : '読込済み');
      const keep = keepSelection && listed.value.items.some((entry) => entry.id === selectedId)
        ? selectedId : listed.value.items[0]?.id ?? null;
      setSelectedId(keep);
    } catch {
      if (current.active) reset(annotationErrors.OPERATION_FAILED);
    } finally { if (current.active) setBusy(false); }
  }

  function reset(text: string): void {
    setWorkspace(null); setItems([]); setTotal(0); setSchema(null); setSelectedId(null); setDetail(null);
    setReferenceState(null); setReferenceNotice(null); setQueued(null);
    setMessage(text);
  }

  // Item detail is fetched separately: the list DTO is a projection without provenance.
  useEffect(() => {
    const current = session.current;
    // Drop the previous item immediately: showing item A's editor while item B
    // is selected would let a human confirm the wrong image as Ground Truth.
    setDetail(null);
    if (!workspace || !selectedId) return;
    let active = true;
    void (async () => {
      try {
        const input = c.annotationGetInputSchema.parse({
          projectId: project.id, workspaceId: workspace.id, itemId: selectedId,
        });
        const response = c.parseAnnotationGetResponse(await annotations.get(input), input);
        if (!active || !current.active) return;
        if (!response.ok) { setDetail(null); setError(annotationErrors[response.error.code]); return; }
        setDetail(response.value.item);
      } catch { if (active && current.active) { setDetail(null); setError(annotationErrors.OPERATION_FAILED); } }
    })();
    return () => { active = false; };
  }, [annotations, project.id, workspace, selectedId]);

  /** Reads the stored item again so confirmation asserts the current CAS values. */
  async function currentItem(workspaceId: string, itemId: string): Promise<AnnotationItem | null> {
    const input = c.annotationGetInputSchema.parse({ projectId: project.id, workspaceId, itemId });
    const response = c.parseAnnotationGetResponse(await annotations.get(input), input);
    return response.ok ? response.value.item : null;
  }

  async function confirmItem(itemId: string, negativeConfirmed: boolean, flush?: () => Promise<void>): Promise<void> {
    if (!workspace) return;
    const current = session.current;
    setBusy(true); setError('');
    try {
      await flush?.();
      const stored = await currentItem(workspace.id, itemId);
      if (!current.active) return;
      if (!stored) { setError(annotationErrors.NOT_FOUND); return; }
      const input = c.annotationConfirmInputSchema.parse({
        projectId: project.id, workspaceId: workspace.id, itemId,
        expectedEditVersion: stored.editVersion,
        expectedAnnotationSha256: stored.annotationSha256,
        expectedState: stored.state,
        expectedConfirmedAt: stored.confirmedAt,
        negativeConfirmed,
      });
      const response = c.parseAnnotationConfirmResponse(await annotations.confirm(input), input);
      if (!current.active) return;
      if (!response.ok) { setError(annotationErrors[response.error.code]); return; }
      await load(true);
    } catch { if (current.active) setError('確認を完了できませんでした。状態を確認してください。'); }
    finally { if (current.active) setBusy(false); }
  }

  async function openConfirmDialog(): Promise<void> {
    if (!workspace) return;
    const current = session.current;
    setBusy(true); setError('');
    try {
      const input = r.revisionValidateInputSchema.parse({ projectId: project.id, workspaceId: workspace.id });
      const response = r.parseRevisionValidateResponse(await revisions.validate(input), input);
      if (!current.active) return;
      if (!response.ok) { setError(revisionErrors[response.error.code]); return; }
      const summary = response.value;
      setDialog({
        total: summary.total, confirmed: summary.confirmed, excluded: summary.excluded,
        unconfirmed: summary.unconfirmed, schemaOutside: summary.schemaOutside,
        invalidRectangles: summary.invalidRectangles, invalidStored: summary.invalidStored,
        // Stored 由来 breakdown. `byCode` is the validation-issue histogram and
        // must never be shown under the provenance heading.
        provenance: summary.provenanceByKind,
      });
    } catch { if (current.active) setError(revisionErrors.OPERATION_FAILED); }
    finally { if (current.active) setBusy(false); }
  }

  async function confirmAndQueue(): Promise<void> {
    if (!workspace) return;
    const current = session.current;
    setBusy(true); setError('');
    try {
      const input = r.revisionCreateInputSchema.parse({
        projectId: project.id, workspaceId: workspace.id,
        splitSeed: DEFAULT_SPLIT_SEED, createdBy: CONFIRMED_BY,
      });
      const response = r.parseRevisionConfirmAndQueueResponse(await revisions.confirmAndQueue(input), input);
      if (!current.active) return;
      if (!response.ok) { setError(revisionErrors[response.error.code]); return; }
      setDialog(null);
      setQueued({
        revisionNo: response.value.revision.revisionNo,
        jobId: response.value.training.id,
        status: response.value.training.status,
      });
      await load(true);
    } catch { if (current.active) setError(revisionErrors.OPERATION_FAILED); }
    finally { if (current.active) setBusy(false); }
  }

  /** Re-verifies saved Reference originals; nothing is written here. */
  async function checkReferences(preserveNotice = false): Promise<void> {
    if (!references) return;
    const current = session.current;
    setBusy(true);
    if (!preserveNotice) setReferenceNotice(null);
    try {
      const input = ref.referenceStatusInputSchema.parse({ projectId: project.id });
      const response = ref.parseReferenceStatusResponse(await references.status(input), input);
      if (!current.active) return;
      if (!response.ok) { setReferenceNotice({ tone: 'alert', text: referenceErrors[response.error.code] }); return; }
      setReferenceState(response.value);
      if (preserveNotice) return;
      setReferenceNotice(response.value.broken.length === 0
        ? { tone: 'status', text: `参照元 ${response.value.checked.toLocaleString('ja-JP')} 件すべてを確認できました。` }
        : { tone: 'alert', text: `参照元 ${response.value.broken.length.toLocaleString('ja-JP')} 件を確認できません。選び直してください。` });
    } catch { if (current.active) setReferenceNotice({ tone: 'alert', text: referenceErrors.OPERATION_FAILED }); }
    finally { if (current.active) setBusy(false); }
  }

  async function relinkReference(entry: ref.ReferenceBrokenEntry): Promise<void> {
    if (!references) return;
    const current = session.current;
    setBusy(true); setReferenceNotice(null);
    try {
      const input = ref.referenceRelinkInputSchema.parse({
        projectId: project.id, importId: entry.importId, imageKey: entry.imageKey,
      });
      const response = ref.parseReferenceRelinkResponse(await references.relink(input), input);
      if (!current.active) return;
      if (!response.ok) { setReferenceNotice({ tone: 'alert', text: referenceErrors[response.error.code] }); return; }
      setReferenceNotice(response.value.status === 'cancelled'
        ? { tone: 'status', text: '選び直しをキャンセルしました。' }
        : { tone: 'status', text: '参照元を選び直しました。' });
    } catch { if (current.active) setReferenceNotice({ tone: 'alert', text: referenceErrors.OPERATION_FAILED }); }
    finally {
      // Refresh the broken list but keep the outcome of this attempt visible.
      if (current.active) await checkReferences(true);
    }
  }

  return (
    <section aria-labelledby="annotation-workspace-heading" className="annotation-workspace">
      <h1 id="annotation-workspace-heading">教師データ作成</h1>
      <p role="status">{message}</p>
      {error && <p role="alert">{error}</p>}
      {workspace && (
        <p role="status">
          全 {total.toLocaleString('ja-JP')}件（表示 {items.length.toLocaleString('ja-JP')}件）
          ／ 表示分の未確認 {openCount.toLocaleString('ja-JP')} 件
          {total > items.length && `。表示は先頭 ${PAGE_LIMIT.toLocaleString('ja-JP')}件までです。残り ${(total - items.length).toLocaleString('ja-JP')}件は未取得で、この未確認件数には含まれていません。`}
        </p>
      )}
      {queued && (
        <p role="status">
          Dataset Revision {queued.revisionNo} を確定しました。学習ジョブ {queued.jobId} は {queued.status} です。
        </p>
      )}
      {workspace && (
        <ImageGallery
          items={items}
          selectedId={selectedId}
          onSelect={(item) => setSelectedId(item.id)}
          thumbnailUrl={(item) => c.annotationImageUrl(project.id, workspace.id, item.id)}
        />
      )}
      {workspace && detail && (
        <ItemEditor
          key={detail.id}
          project={project}
          workspace={workspace}
          item={detail}
          classes={classes}
          instructions={instructions}
          annotations={annotations}
          disabled={busy}
          onConfirm={(negativeConfirmed, flush) => { void confirmItem(detail.id, negativeConfirmed, flush); }}
        />
      )}
      {workspace && (
        <div className="annotation-workspace__actions">
          <button type="button" disabled={busy} onClick={() => { void load(true); }}>再読込</button>
          <button type="button" disabled={busy || items.length === 0} onClick={() => { void openConfirmDialog(); }}>
            Dataset を確定する
          </button>
        </div>
      )}
      {references && (
        <section aria-label="参照元の確認">
          <h2>参照元（Reference）の確認</h2>
          <p>参照取り込みの元ファイルは Project の外にあります。移動・削除されると使えません。</p>
          <button type="button" disabled={busy} onClick={() => { void checkReferences(); }}>参照元を確認</button>
          {referenceNotice && (referenceNotice.tone === 'alert'
            ? <p role="alert">{referenceNotice.text}</p>
            : <p role="status">{referenceNotice.text}</p>)}
          {referenceState && referenceState.broken.length > 0 && (
            <ul aria-label="確認できない参照元">
              {referenceState.broken.map((entry) => (
                <li key={`${entry.importId}:${entry.imageKey}`}>
                  <span>{entry.imageKey}：{referenceReasons[entry.reason]}</span>
                  <button type="button" disabled={busy}
                    onClick={() => { void relinkReference(entry); }}>
                    参照元を選び直す
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {dialog && (
        <ConfirmDatasetDialog
          open
          summary={dialog}
          busy={busy}
          onConfirm={() => { void confirmAndQueue(); }}
          onCancel={() => setDialog(null)}
        />
      )}
    </section>
  );
}

interface ItemEditorProps {
  readonly project: Project;
  readonly workspace: AnnotationWorkspace;
  readonly item: AnnotationItem;
  readonly classes: readonly LabelClass[];
  readonly instructions: string;
  readonly annotations: c.AnnotationApi;
  readonly disabled: boolean;
  readonly onConfirm: (negativeConfirmed: boolean, flush: () => Promise<void>) => void;
}

function ItemEditor({
  project, workspace, item, classes, instructions, annotations, disabled, onConfirm,
}: ItemEditorProps) {
  const draft = useAnnotationDraft({ api: annotations, projectId: project.id, item });
  const imageUrl = useMemo(
    () => c.annotationImageUrl(project.id, workspace.id, item.id),
    [project.id, workspace.id, item.id],
  );
  const confirmed = item.state === 'confirmed';

  if (project.taskType === 'classification') {
    const annotation = draft.draft.annotation;
    const assigned = annotation.kind === 'classification' && annotation.classId !== null
      && classes.some((entry) => entry.id === annotation.classId);
    return (
      <section aria-label="編集対象">
        <ClassificationEditor draft={draft} classes={classes} imageUrl={imageUrl}
          exclusionReasons={[...EXCLUSION_REASONS]} instructions={instructions} disabled={disabled || confirmed} />
        <button type="button" disabled={disabled || confirmed || !assigned || draft.draft.state === 'excluded'}
          onClick={() => onConfirm(false, draft.flush)}>
          確認済みにする
        </button>
        {confirmed && <p role="status">この画像は確認済みです。</p>}
      </section>
    );
  }
  return (
    <DetectionItemEditor project={project} item={item} classes={classes} instructions={instructions}
      imageUrl={imageUrl} draft={draft} disabled={disabled} onConfirm={onConfirm} />
  );
}

interface DetectionItemEditorProps {
  readonly project: Project;
  readonly item: AnnotationItem;
  readonly classes: readonly LabelClass[];
  readonly instructions: string;
  readonly imageUrl: string;
  readonly draft: ReturnType<typeof useAnnotationDraft>;
  readonly disabled: boolean;
  readonly onConfirm: (negativeConfirmed: boolean, flush: () => Promise<void>) => void;
}

function DetectionItemEditor({
  item, classes, instructions, imageUrl, draft, disabled, onConfirm,
}: DetectionItemEditorProps) {
  const activeClassFieldId = useId();
  const [attachProbe, stageWidth] = useProbeWidth(DEFAULT_STAGE_WIDTH);
  const [viewport, setViewport] = useState<Viewport | null>(null);
  const [selectedRectangle, setSelectedRectangle] = useState<string | null>(null);
  const [activeClassId, setActiveClassId] = useState<string | null>(classes[0]?.id ?? null);
  useLayoutEffect(() => {
    setActiveClassId((previous) => (previous && classes.some((entry) => entry.id === previous) ? previous : classes[0]?.id ?? null));
  }, [classes]);

  const annotation = draft.draft.annotation;
  if (annotation.kind !== 'detection') {
    return <p role="alert">検出画像ではないため、検出エディターで編集できません。</p>;
  }
  const rectangles = annotation.rectangles;
  const imageSize: Size = { width: item.width, height: item.height };
  const containerSize: Size = { width: stageWidth, height: STAGE_HEIGHT };
  const confirmed = item.state === 'confirmed';
  const locked = disabled || confirmed;

  function replace(next: readonly AnnotationRectangle[]): void {
    const updated: Annotation = { kind: 'detection', rectangles: [...next] };
    draft.updateAnnotation(updated);
  }

  return (
    <section aria-label="編集対象">
      <div ref={attachProbe} aria-hidden="true" style={{ width: '100%', height: 0 }} />
      <DetectionCanvas imageUrl={imageUrl} imageSize={imageSize} containerSize={containerSize}
        instructions={instructions} onViewportChange={setViewport}>
          {viewport && (
            <>
              <RectangleLayer rectangles={rectangles} imageSize={imageSize} viewport={viewport}
                selectedId={selectedRectangle} activeClassId={locked ? null : activeClassId}
                onSelect={setSelectedRectangle}
                onCreate={(rectangle) => { replace([...rectangles, rectangle]); setSelectedRectangle(rectangle.id); }}
                onDelete={(id) => {
                  replace(rectangles.filter((entry) => entry.id !== id));
                  setSelectedRectangle((previous) => (previous === id ? null : previous));
                }} />
              <RectangleTransformer rectangle={rectangles.find((entry) => entry.id === selectedRectangle) ?? null}
                imageSize={imageSize} viewport={viewport}
                onChange={(next) => replace(rectangles.map((entry) => (entry.id === next.id ? next : entry)))} />
            </>
          )}
        </DetectionCanvas>
      <fieldset disabled={locked || classes.length === 0}>
        <legend>新しい領域に割り当てるクラス</legend>
        <label htmlFor={activeClassFieldId}>新規領域のクラス</label>
        <select id={activeClassFieldId} value={activeClassId ?? ''}
          onChange={(event) => setActiveClassId(event.currentTarget.value || null)}>
          {classes.map((entry) => <option key={entry.id} value={entry.id}>{entry.displayName}</option>)}
        </select>
      </fieldset>
      <RegionList rectangles={rectangles} classes={classes} selectedId={selectedRectangle} disabled={locked}
        onSelect={setSelectedRectangle}
        onChangeClass={(id, classId) => replace(rectangles.map((entry) => (entry.id === id ? { ...entry, classId } : entry)))} />
      <NoObjectButton rectangleCount={rectangles.length} state={item.state}
        negativeConfirmed={item.negativeConfirmed} disabled={locked}
        onMarkNoObject={() => onConfirm(true, draft.flush)}
        onClearNoObject={() => { /* 取り消しは Workspace の再編集経路で扱う */ }} />
      <button type="button" disabled={locked || rectangles.length === 0 || draft.draft.state === 'excluded'}
        onClick={() => onConfirm(false, draft.flush)}>
        確認済みにする
      </button>
      {confirmed && <p role="status">この画像は確認済みです。</p>}
    </section>
  );
}
