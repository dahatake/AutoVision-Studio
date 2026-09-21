import { useId, useState } from 'react';

/** Mirrors the Main preview (CORE-10) across the process boundary. Renderer
 * displays these measurements only; it never derives or fills in missing ones.
 */
export type DeleteProjectDirectoryUsage =
  | { readonly status: 'measured'; readonly files: number; readonly bytes: number;
    readonly ownership: 'verified' | 'unverified' }
  | { readonly status: 'partial'; readonly files: number; readonly bytes: number;
    readonly ownership: 'verified' | 'unverified' }
  | { readonly status: 'missing' }
  | { readonly status: 'unreadable' };

export interface DeleteProjectPreview {
  readonly projectId: string;
  readonly name: string;
  readonly workspacePath: string;
  readonly owned: {
    readonly labelSchemas: number;
    readonly annotationWorkspaces: number;
    readonly annotationItems: number;
    readonly datasetRevisions: number;
    readonly datasetItems: number;
    readonly trainingRuns: number;
    readonly otherJobs: number;
    readonly copyImports: number;
    readonly copiedImages: { readonly count: number; readonly bytes: number };
    readonly directory: DeleteProjectDirectoryUsage;
  };
  readonly referenced: {
    readonly imports: number;
    readonly images: { readonly count: number; readonly bytes: number };
  };
  readonly blockers: readonly { readonly code: string; readonly count: number; readonly message: string }[];
  readonly unmeasuredCategories: readonly string[];
}

export interface DeleteProjectDialogProps {
  readonly open: boolean;
  readonly preview: DeleteProjectPreview;
  readonly busy?: boolean;
  readonly onDelete: () => void;
  readonly onCancel: () => void;
}

const categoryLabels: Readonly<Record<string, string>> = Object.freeze({
  'model-suggestions': 'Model Suggestion',
  'model-versions': 'Model Version',
  reports: 'レポート',
  'derived-caches': '派生キャッシュ',
});

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}

function DirectoryUsage({ usage }: { usage: DeleteProjectDirectoryUsage }) {
  // An unmeasured folder must never be presented as an empty one.
  if (usage.status === 'missing') return <>フォルダーが見つかりません（容量は不明）</>;
  if (usage.status === 'unreadable') return <>フォルダーを読み取れません（容量は不明）</>;
  return <>{usage.files} 件 / {formatBytes(usage.bytes)}
    {usage.status === 'partial' && '（一部を読み取れないため、これ以上の容量がある可能性があります）'}
    {usage.ownership === 'unverified' && '（このProjectの所有フォルダーであることを確認できていません）'}</>;
}

export function DeleteProjectDialog({ open, preview, busy = false, onDelete, onCancel }: DeleteProjectDialogProps) {
  const titleId = useId();
  const confirmId = useId();
  const [acknowledged, setAcknowledged] = useState(false);
  if (!open) return null;
  const blocked = preview.blockers.length > 0;
  const { owned, referenced } = preview;
  return (
    <div role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <h2 id={titleId}>Project「{preview.name}」を削除</h2>
      <p>保存場所: {preview.workspacePath}</p>
      <section aria-label="削除される所有データ">
        <h3>削除される所有データ</h3>
        <dl>
          <dt>Projectフォルダー</dt><dd><DirectoryUsage usage={owned.directory} /></dd>
          <dt>取り込み（Copy）</dt><dd>{owned.copyImports} 件</dd>
          <dt>Copy済み画像</dt><dd>{owned.copiedImages.count} 件 / {formatBytes(owned.copiedImages.bytes)}</dd>
          <dt>Label Schema</dt><dd>{owned.labelSchemas} 件</dd>
          <dt>Annotation Workspace</dt><dd>{owned.annotationWorkspaces} 件</dd>
          <dt>Annotation 画像</dt><dd>{owned.annotationItems} 件</dd>
          <dt>Dataset Revision</dt><dd>{owned.datasetRevisions} 件</dd>
          <dt>Dataset 画像</dt><dd>{owned.datasetItems} 件</dd>
          <dt>Training Run</dt><dd>{owned.trainingRuns} 件</dd>
          <dt>その他の処理履歴</dt><dd>{owned.otherJobs} 件</dd>
        </dl>
      </section>
      <section aria-label="削除されない参照データ">
        <h3>削除されない参照データ</h3>
        <p>Reference で取り込んだ元ファイルは削除・変更しません。</p>
        <dl>
          <dt>取り込み（Reference）</dt><dd>{referenced.imports} 件</dd>
          <dt>参照元画像</dt><dd>{referenced.images.count} 件 / {formatBytes(referenced.images.bytes)}</dd>
        </dl>
      </section>
      {preview.unmeasuredCategories.length > 0 && (
        <p>このversionでは未実装のため件数を取得できない項目: {preview.unmeasuredCategories
          .map((category) => categoryLabels[category] ?? category).join('、')}</p>
      )}
      {blocked && (
        <div role="alert">
          <p>次の理由でこのProjectは削除できません。</p>
          <ul>{preview.blockers.map((blocker) => (
            <li key={blocker.code}>{blocker.message}（{blocker.count} 件）</li>
          ))}</ul>
        </div>
      )}
      <p>
        <input id={confirmId} type="checkbox" checked={acknowledged} disabled={blocked || busy}
          onChange={(event) => setAcknowledged(event.target.checked)} />
        <label htmlFor={confirmId}>上記の所有データを削除することを確認しました。</label>
      </p>
      <button type="button" disabled={blocked || busy || !acknowledged}
        onClick={() => { if (!blocked && !busy && acknowledged) onDelete(); }}>削除する</button>
      <button type="button" disabled={busy} onClick={onCancel}>キャンセル</button>
    </div>
  );
}
