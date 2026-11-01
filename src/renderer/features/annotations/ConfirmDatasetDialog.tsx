export interface ConfirmDatasetDialogSummary {
  readonly total: number;
  readonly confirmed: number;
  readonly excluded: number;
  readonly unconfirmed: number;
  readonly schemaOutside: number;
  readonly invalidRectangles: number;
  readonly invalidStored: number;
  readonly provenance: Readonly<Record<string, number>>;
}

export interface ConfirmDatasetDialogProps {
  readonly open: boolean;
  readonly summary: ConfirmDatasetDialogSummary;
  readonly busy?: boolean;
  /** FR-CVP-001: result of a rejected (errors) or accepted (warnings) revision attempt. */
  readonly coverageErrors?: readonly { readonly classId: string; readonly actual: number; readonly required: number; readonly shortfall: number }[];
  readonly coverageWarnings?: readonly { readonly code: string; readonly classId: string | null; readonly actual: number; readonly required: number }[];
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

export function ConfirmDatasetDialog({ open, summary, busy = false, coverageErrors = [], coverageWarnings = [], onConfirm, onCancel }: ConfirmDatasetDialogProps) {
  if (!open) return null;
  const errorCount = summary.unconfirmed + summary.schemaOutside + summary.invalidRectangles + summary.invalidStored;
  const blocked = busy || errorCount > 0;
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="confirm-dataset-title">
      <h2 id="confirm-dataset-title">Dataset Revision を確定</h2>
      <dl>
        <dt>全件数</dt><dd>{summary.total}</dd>
        <dt>確認済み</dt><dd>{summary.confirmed}</dd>
        <dt>除外</dt><dd>{summary.excluded}</dd>
        <dt>未処理候補</dt><dd>{summary.unconfirmed}</dd>
        <dt>Schema 外</dt><dd>{summary.schemaOutside}</dd>
        <dt>不正矩形</dt><dd>{summary.invalidRectangles}</dd>
        <dt>保存データ不整合</dt><dd>{summary.invalidStored}</dd>
      </dl>
      <section aria-label="provenance 内訳">
        <h3>provenance 内訳</h3>
        {Object.keys(summary.provenance).length === 0 ? <p>記録なし</p> : (
          <ul>{Object.entries(summary.provenance).map(([kind, count]) => <li key={kind}>{kind}: {count}</li>)}</ul>
        )}
      </section>
      {errorCount > 0 && <p role="alert">Error が残っているため確定できません。</p>}
      {coverageErrors.length > 0 && (
        <ul role="alert" aria-label="クラス別枚数の Error">
          {coverageErrors.map((e) => <li key={e.classId}>クラス {e.classId}: {e.actual} 枚（最低 {e.required} 枚、あと {e.shortfall} 枚）。画像を追加して取り込み直してください。</li>)}
        </ul>
      )}
      {coverageWarnings.length > 0 && (
        <ul aria-label="クラス別枚数の Warn">
          {coverageWarnings.map((w) => (
            <li key={`${w.code}:${w.classId ?? ''}`}>{w.code === 'CLASS_IMBALANCE'
              ? `クラス間の枚数比が ${w.actual.toFixed(1)} 倍です（${w.required} 倍以上で警告）。`
              : `クラス ${w.classId}: ${w.actual} 枚（推奨 ${w.required} 枚未満）。`}</li>
          ))}
        </ul>
      )}
      <button type="button" onClick={onConfirm} disabled={blocked}>確定して学習 Queue へ渡す</button>
      <button type="button" onClick={onCancel} disabled={busy}>キャンセル</button>
    </div>
  );
}
