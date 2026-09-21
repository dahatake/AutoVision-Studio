import type { AnnotationItem, LabelClass } from '../../../shared/contracts/annotation';

export interface ClassDistributionProps {
  readonly classes: readonly LabelClass[];
  readonly items: readonly AnnotationItem[];
  readonly totalCount: number;
}

export function ClassDistribution({ classes, items, totalCount }: ClassDistributionProps) {
  if (!Number.isSafeInteger(totalCount) || totalCount < items.length) {
    return <p role="alert">クラス分布の総件数が不正です。一覧を再読込してください。</p>;
  }
  const counts = new Map(classes.map((entry) => [entry.id, { assigned: 0, confirmed: 0 }]));
  let excluded = 0, unassigned = 0, unknown = 0, nonClassification = 0;
  for (const item of items) {
    if (item.state === 'excluded') { excluded += 1; continue; }
    if (item.annotation.kind !== 'classification') { nonClassification += 1; continue; }
    if (item.annotation.classId === null) { unassigned += 1; continue; }
    const count = counts.get(item.annotation.classId);
    if (!count) { unknown += 1; continue; }
    count.assigned += 1;
    if (item.state === 'confirmed') count.confirmed += 1;
  }
  const values = [...counts.values()].map((count) => count.assigned);
  const assigned = values.reduce((sum, count) => sum + count, 0);
  const nonzero = values.filter((count) => count > 0);
  const smallest = nonzero.reduce((min, count) => Math.min(min, count), Infinity);
  const largest = nonzero.reduce((max, count) => Math.max(max, count), 0);
  const imbalanced = nonzero.length > 1 && largest >= smallest * 10;

  return (
    <section aria-label="クラス分布">
      <h2>クラス分布</h2>
      <p>表示中 {items.length}件 ／ 全 {totalCount}件 ／ 未取得 {totalCount - items.length}件</p>
      {totalCount > items.length && <p role="alert">一部の画像だけを集計しています。Workspace 全体の分布ではありません。</p>}
      <p>除外 {excluded}件 ／ 未割当 {unassigned}件 ／ Schema 外 {unknown}件 ／ 分類以外 {nonClassification}件</p>
      <table>
        <caption>表示中の画像のクラス割当（未確認を含む）。比率の分母は除外を除く既知クラスの割当 {assigned}件です。</caption>
        <thead><tr><th scope="col">クラス</th><th scope="col">件数</th><th scope="col">比率</th><th scope="col">確認済み</th></tr></thead>
        <tbody>
          {classes.map((entry) => {
            const count = counts.get(entry.id)!;
            return <tr key={entry.id}>
              <th scope="row">{entry.displayName}</th>
              <td>{count.assigned}</td>
              <td>{assigned === 0 ? '0.0' : (count.assigned / assigned * 100).toFixed(1)}%</td>
              <td>{count.confirmed}</td>
            </tr>;
          })}
        </tbody>
      </table>
      <section aria-label="クラス分布の警告">
        <p>目安：0件、1〜2件（train/validation/testの3分割に不足）、最多/最少の非ゼロ件数が10倍以上の場合に警告します。学習可否の判定ではありません。</p>
        {classes.length === 0 && <p>Label Schema にクラスがありません。</p>}
        <ul>
          {classes.flatMap((entry) => {
            const count = counts.get(entry.id)!.assigned;
            return count === 0 ? [<li key={entry.id}>{entry.displayName}：0件です。</li>]
              : count < 3 ? [<li key={entry.id}>{entry.displayName}：{count}件のため3分割に不足しています。</li>] : [];
          })}
          {imbalanced && <li>クラス件数が極端に偏っています（最多 {largest}件 ／ 最少の非ゼロ {smallest}件、10倍以上）。</li>}
        </ul>
      </section>
    </section>
  );
}
