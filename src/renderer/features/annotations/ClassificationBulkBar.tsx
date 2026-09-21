import { useEffect, useRef, useState } from 'react';
import type { AnnotationItem, LabelClass } from '../../../shared/contracts/annotation';
import * as c from '../../../shared/contracts/annotation-ipc';
import { LabelPicker } from './LabelPicker';

export interface ClassificationBulkBarProps {
  readonly projectId: string;
  readonly workspaceId: string;
  readonly schemaId: string;
  readonly api: Pick<c.AnnotationApi, 'save'>;
  readonly classes: readonly LabelClass[];
  readonly items: readonly AnnotationItem[];
  readonly selectedIds: readonly string[];
  readonly onSaved: (item: AnnotationItem) => void;
  readonly disabled?: boolean;
}

export function ClassificationBulkBar(props: ClassificationBulkBarProps) {
  const identity = `${props.projectId}:${props.workspaceId}:${props.schemaId}`;
  const [scope, setScope] = useState({ identity, generation: 0 });
  if (scope.identity !== identity) {
    setScope({ identity, generation: scope.generation + 1 });
    return null;
  }
  return <BulkEditor key={scope.generation} {...props} />;
}

function editable(item: AnnotationItem, workspaceId: string) {
  return item.workspaceId === workspaceId && item.annotation.kind === 'classification'
    && item.state !== 'confirmed' && item.confirmedAt === null && item.state !== 'excluded';
}

function BulkEditor({
  projectId, workspaceId, schemaId, api, classes, items, selectedIds, onSaved, disabled = false,
}: ClassificationBulkBarProps) {
  const [classId, setClassId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('未実行');
  const [error, setError] = useState<string | null>(null);
  const mutex = useRef(false);
  const session = useRef({ active: false });
  const latest = useRef({ items, classes, disabled });
  latest.current = { items, classes, disabled };
  useEffect(() => {
    const current = { active: true };
    session.current = current;
    return () => { current.active = false; };
  }, []);

  const selected = new Set(selectedIds);
  const uniqueItems = [...new Map(items.map((item) => [item.id, item])).values()];
  const targets = uniqueItems.filter((item) => selected.has(item.id) && editable(item, workspaceId));
  const confirmedCount = uniqueItems.filter((item) => selected.has(item.id) && item.state === 'confirmed').length;
  const label = classes.find((entry) => entry.schemaId === schemaId && entry.id === classId);

  async function apply() {
    if (disabled || mutex.current || !label || targets.length === 0) return;
    mutex.current = true; setBusy(true); setError(null);
    const current = session.current;
    let saved = 0;
    let targetName = '';
    const stop = (code: c.AnnotationIpcErrorCode) => {
      setError(`一括適用を停止しました（${code}）。保存確認 ${saved}/${targets.length}件。対象：${targetName}。一覧を再読込して確認してください。`);
    };
    setMessage(`一括適用中：保存確認 0/${targets.length}件`);
    try {
      for (const target of targets) {
        if (!current.active) return;
        targetName = target.imageKey;
        if (latest.current.disabled) { stop('LOCKED'); return; }
        const present = latest.current.items.find((item) => item.id === target.id);
        if (!present || !editable(present, workspaceId) || present.editVersion !== target.editVersion
          || present.annotationSha256 !== target.annotationSha256 || present.state !== target.state
          || !latest.current.classes.some((entry) => entry.schemaId === schemaId && entry.id === label.id)) {
          stop('CONFLICT'); return;
        }
        // Main's state/version CAS also rejects confirmation after this UI snapshot.
        const request = c.annotationSaveInputSchema.parse({
          projectId, workspaceId, itemId: target.id,
          expectedEditVersion: target.editVersion, expectedAnnotationSha256: target.annotationSha256,
          expectedState: target.state, expectedConfirmedAt: target.confirmedAt,
          annotation: { kind: 'classification', classId: label.id }, state: 'editing', exclusionReason: null,
        });
        const response = c.parseAnnotationSaveResponse(await api.save(request), request);
        if (!current.active) return;
        if (!response.ok) { stop(response.error.code); return; }
        saved += 1;
        setMessage(`一括適用中：保存確認 ${saved}/${targets.length}件`);
        onSaved(response.value.item);
      }
      setMessage(`一括適用完了：保存確認 ${saved}/${targets.length}件。確認済みへの変更はありません。`);
    } catch {
      if (current.active) stop('OPERATION_FAILED');
    } finally {
      if (current.active) { mutex.current = false; setBusy(false); }
    }
  }

  return (
    <section aria-label="分類の一括適用" aria-busy={busy}>
      <p>選択 {selected.size}件 ／ 適用対象 {targets.length}件 ／ 対象外 {selected.size - targets.length}件</p>
      <p>確認済み {confirmedCount}件は上書きしません。除外・未取得・別 Workspace・分類以外も対象外です。</p>
      <p>選択した未確認画像だけに手動でクラスを割り当てます。確認済みにはしません。</p>
      <LabelPicker schemaId={schemaId} classes={classes} selectedClassId={label?.id ?? null}
        onSelect={setClassId} disabled={disabled || busy} />
      <button type="button" disabled={disabled || busy || !label || targets.length === 0}
        onClick={() => void apply()}>選択画像に一括適用</button>
      {error ? <p role="alert">{error}</p> : <p role="status">{message}</p>}
    </section>
  );
}
