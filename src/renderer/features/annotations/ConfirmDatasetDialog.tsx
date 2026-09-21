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
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

export function ConfirmDatasetDialog({ open, summary, busy = false, onConfirm, onCancel }: ConfirmDatasetDialogProps) {
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
      <button type="button" onClick={onConfirm} disabled={blocked}>確定して学習 Queue へ渡す</button>
      <button type="button" onClick={onCancel} disabled={busy}>キャンセル</button>
    </div>
  );
}
