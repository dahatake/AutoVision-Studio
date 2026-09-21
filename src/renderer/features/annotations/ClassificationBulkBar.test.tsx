import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { annotationItemSchema, labelClassSchema, type AnnotationItem } from '../../../shared/contracts/annotation';
import type { AnnotationApi, AnnotationSaveInput, AnnotationSaveResponse } from '../../../shared/contracts/annotation-ipc';
import { ClassificationBulkBar, type ClassificationBulkBarProps } from './ClassificationBulkBar';
import { ClassDistribution } from './ClassDistribution';

const projectId = '11111111-1111-4111-8111-111111111111';
const workspaceId = '22222222-2222-4222-8222-222222222222';
const schemaId = '33333333-3333-4333-8333-333333333333';
const otherId = '44444444-4444-4444-8444-444444444444';
const time = '2026-09-21T00:00:00.000Z';
const classes = ['猫', '犬', '鳥'].map((displayName, ordinal) => labelClassSchema.parse({
  id: `55555555-5555-4555-8555-${String(ordinal + 1).padStart(12, '0')}`,
  schemaId, displayName, normalizedName: displayName, modelAlias: null,
  color: '#0078d4', description: '', examples: [], ordinal, createdAt: time, updatedAt: time,
}));
function item(index: number, fields: Partial<AnnotationItem> = {}): AnnotationItem {
  return annotationItemSchema.parse({
    id: `66666666-6666-4666-8666-${String(index).padStart(12, '0')}`,
    workspaceId, importId: '77777777-7777-4777-8777-777777777777', imageKey: `image:${index}`,
    imageSha256: 'a'.repeat(64), width: 32, height: 32,
    annotation: { kind: 'classification', classId: classes[0]!.id }, annotationSha256: 'a'.repeat(64),
    state: 'editing', negativeConfirmed: false, exclusionReason: null, editVersion: 2,
    confirmedAt: null, updatedAt: time, ...fields,
  });
}
function success(input: AnnotationSaveInput): AnnotationSaveResponse {
  return { ok: true, value: {
    item: item(1, {
      id: input.itemId, workspaceId: input.workspaceId, annotation: input.annotation,
      state: input.state, exclusionReason: input.exclusionReason, editVersion: input.expectedEditVersion + 1,
      annotationSha256: 'b'.repeat(64),
    }),
    provenance: [{
      itemId: input.itemId, targetKey: 'classification', kind: 'manual', sourceImportId: null,
      sourceImageKey: null, sourceAnnotationKey: null, sourceSuggestionId: null, original: {}, changes: {},
    }],
  } };
}
function propsFor(items = [item(1), item(2)], patch: Partial<ClassificationBulkBarProps> = {}): ClassificationBulkBarProps {
  return {
    projectId, workspaceId, schemaId, classes, items, selectedIds: items.map((entry) => entry.id),
    api: { save: vi.fn<AnnotationApi['save']>((input) => Promise.resolve(success(input))) },
    onSaved: vi.fn(), ...patch,
  };
}
const applyButton = () => screen.getByRole('button', { name: '選択画像に一括適用' });
async function chooseAndApply() {
  const user = userEvent.setup();
  await user.click(within(screen.getByRole('region', { name: '検索結果' })).getByRole('button', { name: '2: 犬' }));
  await user.click(applyButton());
}
function pendingSave() {
  let resolve!: (value: AnnotationSaveResponse) => void;
  const promise = new Promise<AnnotationSaveResponse>((done) => { resolve = done; });
  const save = vi.fn<AnnotationApi['save']>().mockImplementation(() => promise);
  return { save, resolve };
}

describe('ClassificationBulkBar W2-08', () => {
  it('applies one class only to unique selected unconfirmed images, never confirmed Ground Truth or excluded images', async () => {
    const confirmed = item(4, { state: 'confirmed', confirmedAt: time });
    const items = [
      item(1, { state: 'unstarted', annotation: { kind: 'classification', classId: null } }),
      item(2), item(3, { state: 'suggested' }), confirmed,
      item(5, { state: 'excluded', exclusionReason: '対象外' }),
      item(6, { annotation: { kind: 'detection', rectangles: [] } }), item(7, { workspaceId: otherId }),
    ];
    const before = JSON.stringify(items);
    const props = propsFor(items, { selectedIds: [...items.map((entry) => entry.id), items[0]!.id, otherId] });
    render(<ClassificationBulkBar {...props} />);
    expect(screen.getByText('選択 8件 ／ 適用対象 3件 ／ 対象外 5件')).toBeInTheDocument();
    expect(screen.getByText(/確認済み 1件は上書きしません/)).toBeInTheDocument();
    expect(applyButton()).toBeDisabled();
    await chooseAndApply();
    await screen.findByText('一括適用完了：保存確認 3/3件。確認済みへの変更はありません。');
    expect(props.api.save).toHaveBeenCalledTimes(3);
    for (const source of items.slice(0, 3)) {
      expect(props.api.save).toHaveBeenCalledWith({
        projectId, workspaceId, itemId: source.id, expectedEditVersion: 2,
        expectedAnnotationSha256: source.annotationSha256, expectedState: source.state, expectedConfirmedAt: null,
        annotation: { kind: 'classification', classId: classes[1]!.id }, state: 'editing', exclusionReason: null,
      });
    }
    expect(props.onSaved).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(items)).toBe(before);
  });

  it('does not allow applying to an empty selection, only confirmed/excluded selection, or a locked workspace', async () => {
    const user = userEvent.setup();
    const props = propsFor([item(1, { state: 'confirmed', confirmedAt: time }), item(2, { state: 'excluded' })]);
    const { rerender } = render(<ClassificationBulkBar {...props} />);
    await user.click(screen.getByRole('button', { name: '1: 猫' }));
    expect(applyButton()).toBeDisabled();
    rerender(<ClassificationBulkBar {...props} selectedIds={[]} />);
    expect(applyButton()).toBeDisabled();
    rerender(<ClassificationBulkBar {...propsFor()} disabled />);
    expect(applyButton()).toBeDisabled();
    expect(screen.getByRole('searchbox')).toBeDisabled();
    expect(props.api.save).not.toHaveBeenCalled();
  });

  it('stops before a pending target that becomes confirmed while the first image is saving', async () => {
    const pending = pendingSave();
    const props = propsFor(undefined, { api: { save: pending.save } });
    const { rerender } = render(<ClassificationBulkBar {...props} />);
    await chooseAndApply();
    expect(applyButton()).toBeDisabled();
    const confirmed = { ...props.items[1]!, state: 'confirmed' as const, confirmedAt: time, editVersion: 3 };
    rerender(<ClassificationBulkBar {...props} items={[props.items[0]!, confirmed]} />);
    await act(async () => { pending.resolve(success(pending.save.mock.calls[0]![0])); });
    expect(pending.save).toHaveBeenCalledOnce();
    expect(props.onSaved).toHaveBeenCalledOnce();
    expect(screen.getByRole('alert')).toHaveTextContent('CONFLICT');
    expect(screen.getByRole('alert')).toHaveTextContent('保存確認 1/2件');
    expect(screen.getByRole('alert')).toHaveTextContent('image:2');
    expect(confirmed.annotation).toEqual({ kind: 'classification', classId: classes[0]!.id });
  });

  it('uses CAS to fail closed on a server-side confirmation race, reports partial completion and stops later writes', async () => {
    const save = vi.fn<AnnotationApi['save']>()
      .mockImplementationOnce((input) => Promise.resolve(success(input)))
      .mockResolvedValueOnce({ ok: false, error: { code: 'CONFLICT' } });
    const props = propsFor([item(1), item(2), item(3)], { api: { save } });
    render(<ClassificationBulkBar {...props} />);
    await chooseAndApply();
    await screen.findByRole('alert');
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]![0]).toMatchObject({ expectedState: 'editing', expectedConfirmedAt: null, expectedEditVersion: 2 });
    expect(props.onSaved).toHaveBeenCalledOnce();
    expect(screen.getByRole('alert')).toHaveTextContent('保存確認 1/3件');
    expect(screen.getByRole('alert')).toHaveTextContent('CONFLICT');
    expect(screen.queryByText(/一括適用完了/)).not.toBeInTheDocument();
  });

  it.each(['rejected', 'malformed', 'wrong-item'] as const)('surfaces %s responses without false success', async (failure) => {
    const save = vi.fn<AnnotationApi['save']>((input) => {
      if (failure === 'rejected') return Promise.reject(new Error('transport'));
      if (failure === 'malformed') return Promise.resolve(JSON.parse('{"ok":true,"value":{}}'));
      const result = success(input);
      if (result.ok) result.value.item.id = otherId;
      return Promise.resolve(result);
    });
    const props = propsFor(undefined, { api: { save } });
    render(<ClassificationBulkBar {...props} />);
    await chooseAndApply();
    expect(screen.getByRole('alert')).toHaveTextContent('OPERATION_FAILED');
    expect(screen.getByRole('alert')).toHaveTextContent('保存確認 0/2件');
    expect(props.onSaved).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledOnce();
  });

  it('ignores repeat clicks during an in-flight batch', async () => {
    const pending = pendingSave();
    const props = propsFor([item(1)], { api: { save: pending.save } });
    render(<ClassificationBulkBar {...props} />);
    await chooseAndApply();
    fireEvent.click(applyButton());
    fireEvent.click(applyButton());
    expect(pending.save).toHaveBeenCalledOnce();
    await act(async () => { pending.resolve(success(pending.save.mock.calls[0]![0])); });
    expect(props.onSaved).toHaveBeenCalledOnce();
  });

  it('does not continue or publish a stale result after A -> B -> A scope switching', async () => {
    const pending = pendingSave();
    const props = propsFor(undefined, { api: { save: pending.save } });
    const { rerender } = render(<ClassificationBulkBar {...props} />);
    await chooseAndApply();
    rerender(<ClassificationBulkBar {...props} workspaceId={otherId} />);
    rerender(<ClassificationBulkBar {...props} />);
    await act(async () => { pending.resolve(success(pending.save.mock.calls[0]![0])); });
    expect(pending.save).toHaveBeenCalledOnce();
    expect(props.onSaved).not.toHaveBeenCalled();
    expect(applyButton()).toBeDisabled();
    expect(screen.getByText('未実行')).toBeInTheDocument();
  });

  it.each(['removed-class', 'locked'] as const)('stops remaining writes when the context becomes %s', async (change) => {
    const pending = pendingSave();
    const props = propsFor(undefined, { api: { save: pending.save } });
    const { rerender } = render(<ClassificationBulkBar {...props} />);
    await chooseAndApply();
    rerender(<ClassificationBulkBar {...props} classes={change === 'removed-class' ? [] : classes}
      disabled={change === 'locked'} />);
    await act(async () => { pending.resolve(success(pending.save.mock.calls[0]![0])); });
    expect(pending.save).toHaveBeenCalledOnce();
    expect(screen.getByRole('alert')).toHaveTextContent(change === 'locked' ? 'LOCKED' : 'CONFLICT');
    expect(screen.getByRole('alert')).toHaveTextContent('保存確認 1/2件');
  });

  it('supports selecting a class by digit and applying by keyboard without confirming the results', async () => {
    const user = userEvent.setup();
    const props = propsFor();
    render(<ClassificationBulkBar {...props} />);
    screen.getByRole('region', { name: 'ラベル選択' }).focus();
    await user.keyboard('2');
    applyButton().focus();
    await user.keyboard('[Enter]');
    await waitFor(() => expect(props.onSaved).toHaveBeenCalledTimes(2));
    expect(props.onSaved).toHaveBeenCalledWith(expect.objectContaining({ state: 'editing', confirmedAt: null }));
  });

  it('disables apply if the selected class is removed before submission', async () => {
    const user = userEvent.setup();
    const props = propsFor();
    const { rerender } = render(<ClassificationBulkBar {...props} />);
    await user.click(screen.getByRole('button', { name: '2: 犬' }));
    rerender(<ClassificationBulkBar {...props} classes={[classes[0]!]} />);
    expect(applyButton()).toBeDisabled();
    expect(props.api.save).not.toHaveBeenCalled();
  });
});

describe('ClassDistribution W2-08', () => {
  it('shows counts and ratios, reports excluded/unknown/unassigned items and warns about zero and small classes', () => {
    const items = [
      item(1), item(2, { state: 'confirmed', confirmedAt: time }),
      ...[3, 4, 5].map((index) => item(index, { annotation: { kind: 'classification', classId: classes[1]!.id } })),
      item(6, { state: 'excluded' }), item(7, { annotation: { kind: 'classification', classId: null } }),
      item(8, { annotation: { kind: 'classification', classId: otherId } }),
      item(9, { annotation: { kind: 'detection', rectangles: [] } }),
    ];
    render(<ClassDistribution classes={classes} items={items} totalCount={items.length} />);
    expect(within(screen.getByRole('row', { name: '猫 2 40.0% 1' })).getAllByRole('cell').map((cell) => cell.textContent))
      .toEqual(['2', '40.0%', '1']);
    expect(screen.getByRole('row', { name: '犬 3 60.0% 0' })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: '鳥 0 0.0% 0' })).toBeInTheDocument();
    expect(screen.getByText('除外 1件 ／ 未割当 1件 ／ Schema 外 1件 ／ 分類以外 1件')).toBeInTheDocument();
    expect(screen.getByText('猫：2件のため3分割に不足しています。')).toBeInTheDocument();
    expect(screen.getByText('鳥：0件です。')).toBeInTheDocument();
    expect(screen.queryByText('犬：3件のため3分割に不足しています。')).not.toBeInTheDocument();
  });

  it.each([9, 10])('tests the exact imbalance boundary at a %i:1 ratio', (majority) => {
    const items = Array.from({ length: majority }, (_, index) => item(index));
    items.push(item(majority, { annotation: { kind: 'classification', classId: classes[1]!.id } }));
    render(<ClassDistribution classes={classes} items={items} totalCount={items.length} />);
    if (majority === 10) expect(screen.getByText(/クラス件数が極端に偏っています/)).toBeInTheDocument();
    else expect(screen.queryByText(/クラス件数が極端に偏っています/)).not.toBeInTheDocument();
  });

  it('shows partial scope explicitly and never presents empty ratios as NaN or Infinity', () => {
    const { container } = render(<ClassDistribution classes={classes} items={[]} totalCount={20} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Workspace 全体の分布ではありません');
    expect(screen.getByText('表示中 0件 ／ 全 20件 ／ 未取得 20件')).toBeInTheDocument();
    expect(screen.getAllByRole('cell').filter((cell) => cell.textContent === '0.0%')).toHaveLength(3);
    expect(container.textContent).not.toMatch(/NaN|Infinity/u);
    expect(screen.queryByText(/クラス件数が極端に偏っています/)).not.toBeInTheDocument();
  });

  it('reports invalid totals rather than rendering misleading counts', () => {
    render(<ClassDistribution classes={classes} items={[item(1)]} totalCount={0} />);
    expect(screen.getByRole('alert')).toHaveTextContent('総件数が不正');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
