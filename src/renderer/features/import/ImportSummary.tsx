import { useId, useMemo, useState } from 'react';

import type { ImportPreview } from '../../../shared/contracts/import-ipc';

export function formatImportCount(value: string | number): string {
  return BigInt(value).toLocaleString('ja-JP');
}

export function validImportClassName(value: string): boolean {
  return /[^\s\u0085]/u.test(value.normalize('NFKC')) && !value.includes('\0');
}

const issueMessages = new Map([
  ['INVALID_IMAGE', '画像を読み取れません。形式や破損の有無を確認してください。'],
  ['DUPLICATE_IMAGE', '同じ内容の画像が含まれています。'],
  ['NO_VALID_IMAGES', '取り込み可能な画像がありません。'],
  ['INPUT_LIMIT_EXCEEDED', '画像の件数が上限を超えています。'],
  ['SCAN_RESULT_TOO_LARGE', '検査結果が上限を超えています。'],
]);

const pageSize = 100;
function Pager({ label, total, page, setPage }: {
  label: string; total: number; page: number; setPage: (value: number) => void;
}) {
  return <nav className="import-page__pager" aria-label={`${label}のページ`}>
    <span role="status">{total === 0 ? '0' : formatImportCount(page * pageSize + 1)}〜{formatImportCount(Math.min(total, (page + 1) * pageSize))} / 全{formatImportCount(total)}件</span>
    <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label={`${label}の前の100件`}>前へ</button>
    <button type="button" disabled={(page + 1) * pageSize >= total} onClick={() => setPage(page + 1)} aria-label={`${label}の次の100件`}>次へ</button>
  </nav>;
}

export interface ImportSummaryProps {
  preview: ImportPreview;
  names: ReadonlyMap<string, string>;
  onNameChange: (key: string, value: string) => void;
  disabled: boolean;
}

export function ImportSummary({ preview, names, onNameChange, disabled }: ImportSummaryProps) {
  const id = useId();
  const [filePage, setFilePage] = useState(0);
  const [classPage, setClassPage] = useState(0);
  const [issuePage, setIssuePage] = useState(0);
  const errors = useMemo(() => preview.issues.filter((issue) => issue.severity === 'error').length, [preview]);
  return <section className="import-page__summary" aria-label="取り込みプレビュー">
    <h2>2. 検査結果を確認して取り込む</h2>
    <p>画像 {formatImportCount(preview.itemCount)}件 ／ 合計 {formatImportCount(preview.sourceBytes)} バイト</p>
    <p>クラス {formatImportCount(preview.classes.length)}件 ／ エラー {formatImportCount(errors)}件 ／ 警告 {formatImportCount(preview.issues.length - errors)}件</p>
    <p>ラベル付きの画像も未確認として取り込みます。検査の完了は、画像の確認済み・学習完了を意味しません。</p>
    {errors > 0 && <p role="alert">エラーがあるため取り込めません。元データを修正し、検査をやり直してください。</p>}
    <section aria-label="クラス一覧">
      <h3>クラス名（変更は任意）</h3>
      <p id={`${id}-names`}>空白だけの名前は使用できません。名前の最終検証は取り込み時に行います。</p>
      {preview.classes.slice(classPage * pageSize, (classPage + 1) * pageSize).map((item, index) => {
        const value = names.get(item.key) ?? item.name;
        const fieldId = `${id}-class-${classPage * pageSize + index}`;
        return <div className="import-page__class" key={item.key}>
          <label htmlFor={fieldId}>クラス {formatImportCount(classPage * pageSize + index + 1)} の名前</label>
          <input id={fieldId} type="text" value={value} disabled={disabled}
            aria-invalid={!validImportClassName(value)} aria-describedby={`${id}-names`}
            onChange={(event) => onNameChange(item.key, event.currentTarget.value)} />
        </div>;
      })}
      <Pager label="クラス" total={preview.classes.length} page={classPage} setPage={setClassPage} />
    </section>
    <section aria-label="ファイル一覧">
      <h3>ファイル名</h3>
      <ul>{preview.files.slice(filePage * pageSize, (filePage + 1) * pageSize).map((file) => <li key={file.key}>{file.displayName}</li>)}</ul>
      <Pager label="ファイル" total={preview.files.length} page={filePage} setPage={setFilePage} />
    </section>
    <section aria-label="問題一覧">
      <h3>エラー・警告</h3>
      <ul>{preview.issues.slice(issuePage * pageSize, (issuePage + 1) * pageSize).map((issue, index) => <li key={issuePage * pageSize + index}>
        {issue.severity === 'error' ? 'エラー' : '警告'}：{issueMessages.get(issue.code) ?? '検査で問題が見つかりました。元データを確認してください。'}
        {issueMessages.has(issue.code) && <>（{issue.code}）</>}
        {issue.row !== null && <> 行 {formatImportCount(issue.row)}</>}
      </li>)}</ul>
      <Pager label="問題" total={preview.issues.length} page={issuePage} setPage={setIssuePage} />
    </section>
  </section>;
}