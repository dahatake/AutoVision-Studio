import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { AnnotationItem, LabelClass } from '../../../shared/contracts/annotation';
import { ClassDistribution } from './ClassDistribution';

const schemaId = '7c4d2e10-8a95-4b3c-9d1e-0f2a3b4c5d6e';
const workspaceId = '9a3c7d51-6b21-4f0e-8c7a-1d2e3f4a5b6c';
const at = '2026-09-22T00:00:00.000Z';

function labelClass(index: number, displayName: string): LabelClass {
  return {
    id: `0000000${index}-0000-4000-8000-00000000000${index}`, schemaId, displayName,
    normalizedName: displayName, modelAlias: null, color: '#112233', description: '',
    examples: [], ordinal: index, createdAt: at, updatedAt: at,
  };
}

function item(index: number, classId: string | null, state: AnnotationItem['state'] = 'editing'): AnnotationItem {
  return {
    id: `1000000${index}-0000-4000-8000-00000000000${index}`, workspaceId, importId: workspaceId,
    imageKey: `image:${index}`, imageSha256: 'a'.repeat(64), width: 64, height: 48,
    annotation: { kind: 'classification', classId },
    annotationSha256: 'b'.repeat(64), state, negativeConfirmed: false,
    exclusionReason: state === 'excluded' ? '対象外' : null, editVersion: 1,
    confirmedAt: state === 'confirmed' ? at : null, updatedAt: at,
  };
}

const cat = labelClass(1, 'cat');
const dog = labelClass(2, 'dog');

function row(name: string) {
  return screen.getByRole('row', { name: new RegExp(`^${name}`, 'u') });
}

describe('ClassDistribution', () => {
  it('separates what was counted from the workspace total and warns about the gap', () => {
    render(<ClassDistribution classes={[cat, dog]} items={[item(1, cat.id)]} totalCount={50} />);
    expect(screen.getByText('表示中 1件 ／ 全 50件 ／ 未取得 49件')).toBeVisible();
    expect(screen.getByRole('alert'))
      .toHaveTextContent('一部の画像だけを集計しています。Workspace 全体の分布ではありません。');
  });

  it('refuses to render a distribution when the supplied total is impossible', () => {
    render(<ClassDistribution classes={[cat]} items={[item(1, cat.id), item(2, cat.id)]} totalCount={1} />);
    expect(screen.getByRole('alert')).toHaveTextContent('クラス分布の総件数が不正です');
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('counts assignment and confirmation separately, and reports the ratio denominator', () => {
    render(<ClassDistribution
      classes={[cat, dog]}
      items={[item(1, cat.id, 'confirmed'), item(2, cat.id), item(3, dog.id, 'confirmed')]}
      totalCount={3} />);
    expect(within(row('cat')).getAllByRole('cell').map((cell) => cell.textContent))
      .toEqual(['2', '66.7%', '1']);
    expect(within(row('dog')).getAllByRole('cell').map((cell) => cell.textContent))
      .toEqual(['1', '33.3%', '1']);
    expect(screen.getByText(/比率の分母は除外を除く既知クラスの割当 3件です。/u)).toBeVisible();
  });

  it('keeps excluded, unassigned and Schema-外 items out of the class counts', () => {
    const outside = item(4, '99999999-0000-4000-8000-000000000099');
    render(<ClassDistribution
      classes={[cat]}
      items={[item(1, cat.id), item(2, null), item(3, cat.id, 'excluded'), outside]}
      totalCount={4} />);
    expect(screen.getByText('除外 1件 ／ 未割当 1件 ／ Schema 外 1件 ／ 分類以外 0件')).toBeVisible();
    expect(within(row('cat')).getAllByRole('cell')[0]).toHaveTextContent('1');
  });

  it('warns about empty classes and classes too small to split three ways', () => {
    render(<ClassDistribution classes={[cat, dog]} items={[item(1, cat.id), item(2, cat.id)]} totalCount={2} />);
    const warnings = within(screen.getByRole('region', { name: 'クラス分布の警告' })).getAllByRole('listitem');
    expect(warnings.map((entry) => entry.textContent)).toEqual([
      'cat：2件のため3分割に不足しています。',
      'dog：0件です。',
    ]);
  });

  it('warns about a ten-fold imbalance without judging trainability', () => {
    const items = [...Array.from({ length: 30 }, (_, index) => item(index + 10, cat.id)),
      item(1, dog.id), item(2, dog.id), item(3, dog.id)];
    render(<ClassDistribution classes={[cat, dog]} items={items} totalCount={items.length} />);
    const warnings = within(screen.getByRole('region', { name: 'クラス分布の警告' })).getAllByRole('listitem');
    expect(warnings.at(-1)).toHaveTextContent('クラス件数が極端に偏っています（最多 30件 ／ 最少の非ゼロ 3件、10倍以上）。');
    expect(screen.getByText(/学習可否の判定ではありません。/u)).toBeVisible();
  });

  it('states that the Schema has no classes instead of showing an empty distribution', () => {
    render(<ClassDistribution classes={[]} items={[item(1, null)]} totalCount={1} />);
    expect(screen.getByText('Label Schema にクラスがありません。')).toBeVisible();
    expect(within(screen.getByRole('table')).queryAllByRole('row')).toHaveLength(1);
  });
});
