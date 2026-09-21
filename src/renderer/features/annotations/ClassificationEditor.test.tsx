import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { annotationItemSchema, labelClassSchema, type AnnotationItem } from '../../../shared/contracts/annotation';
import type { AnnotationApi, AnnotationSaveInput, AnnotationSaveResponse } from '../../../shared/contracts/annotation-ipc';
import { ClassificationEditor } from './ClassificationEditor';
import { useAnnotationDraft } from './useAnnotationDraft';

const projectId = '11111111-1111-4111-8111-111111111111';
const schemaId = '22222222-2222-4222-8222-222222222222';
const classA = '33333333-3333-4333-8333-333333333333';
const classB = '44444444-4444-4444-8444-444444444444';
const time = '2026-09-21T00:00:00.000Z';
const classes = [classA, classB].map((id, ordinal) => labelClassSchema.parse({
  id, schemaId, displayName: ['猫', '犬'][ordinal], normalizedName: ['猫', '犬'][ordinal],
  modelAlias: null, color: '#0078d4', description: '', examples: [], ordinal, createdAt: time, updatedAt: time,
}));
function item(fields: Partial<AnnotationItem> = {}): AnnotationItem {
  return annotationItemSchema.parse({
    id: '55555555-5555-4555-8555-555555555555', workspaceId: '66666666-6666-4666-8666-666666666666',
    importId: '77777777-7777-4777-8777-777777777777', imageKey: 'image:1', imageSha256: 'a'.repeat(64),
    width: 32, height: 32, annotation: { kind: 'classification', classId: null }, annotationSha256: 'a'.repeat(64),
    state: 'unstarted', negativeConfirmed: false, exclusionReason: null, editVersion: 0,
    confirmedAt: null, updatedAt: time, ...fields,
  });
}
function success(input: AnnotationSaveInput): AnnotationSaveResponse {
  return { ok: true, value: {
    item: item({
      annotation: input.annotation, state: input.state, exclusionReason: input.exclusionReason,
      editVersion: input.expectedEditVersion + 1, annotationSha256: 'b'.repeat(64),
    }),
    provenance: [{
      itemId: input.itemId, targetKey: 'classification', kind: 'manual', sourceImportId: null,
      sourceImageKey: null, sourceAnnotationKey: null, sourceSuggestionId: null, original: {}, changes: {},
    }],
  } };
}
function Harness({ save, source = item(), disabled = false, empty = false }: {
  save: AnnotationApi['save']; source?: AnnotationItem; disabled?: boolean; empty?: boolean;
}) {
  const draft = useAnnotationDraft({ api: { save }, projectId, item: source });
  return <ClassificationEditor draft={draft} classes={empty ? [] : classes} imageUrl="av-image://project/image"
    exclusionReasons={['重複', '対象外']} disabled={disabled} />;
}
afterEach(() => { vi.useRealTimers(); });

describe('ClassificationEditor W2-06', () => {
  it('assigns exactly one class, replaces it, and can undo, redo and explicitly clear to an invalid draft', async () => {
    const user = userEvent.setup();
    const save = vi.fn<AnnotationApi['save']>((input) => Promise.resolve(success(input)));
    render(<StrictMode><Harness save={save} /></StrictMode>);
    const picker = screen.getByRole('combobox', { name: 'クラス' });
    expect(picker).not.toHaveAttribute('multiple');
    expect(screen.getByRole('option', { name: 'クラスを選択' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('確定できません');
    expect(screen.getByRole('button', { name: 'クラスを解除' })).toBeDisabled();
    await user.selectOptions(picker, classA);
    expect(picker).toHaveValue(classA);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await user.selectOptions(picker, classB);
    expect(picker).toHaveValue(classB);
    expect(within(picker).getAllByRole('option', { selected: true })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: '元に戻す' }));
    expect(picker).toHaveValue(classA);
    await user.click(screen.getByRole('button', { name: 'やり直す' }));
    expect(picker).toHaveValue(classB);
    await user.click(screen.getByRole('button', { name: 'クラスを解除' }));
    expect(picker).toHaveValue('');
    expect(screen.getByRole('alert')).toHaveTextContent('ちょうど1クラス');
    await user.click(screen.getByRole('button', { name: '元に戻す' }));
    expect(picker).toHaveValue(classB);
  });

  it('saves the replacement and confirmation clearing in the same CAS request within one second', async () => {
    vi.useFakeTimers();
    const save = vi.fn<AnnotationApi['save']>((input) => Promise.resolve(success(input)));
    const source = item({ annotation: { kind: 'classification', classId: classA },
      state: 'confirmed', confirmedAt: time, editVersion: 3 });
    render(<Harness save={save} source={source} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'クラス' }), { target: { value: classB } });
    await act(async () => { vi.advanceTimersByTime(750); });
    expect(save).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      expectedState: 'confirmed', expectedConfirmedAt: time, expectedEditVersion: 3,
      annotation: { kind: 'classification', classId: classB }, state: 'editing', exclusionReason: null,
    }));
    expect(screen.getByRole('status')).toHaveTextContent('保存済み');
  });

  it('excludes without deleting the class and allows keyboard undo and exclusion clearing', async () => {
    const user = userEvent.setup();
    const save = vi.fn<AnnotationApi['save']>((input) => Promise.resolve(success(input)));
    render(<Harness save={save} source={item({ annotation: { kind: 'classification', classId: classA } })} />);
    await user.selectOptions(screen.getByRole('combobox', { name: '除外理由' }), '対象外');
    await user.tab();
    expect(screen.getByRole('button', { name: '除外にする' })).toHaveFocus();
    await user.keyboard('[Enter]');
    expect(screen.getByText('除外中：学習・評価の対象外です。')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'クラス' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'クラス' })).toHaveValue(classA);
    await user.tab();
    expect(screen.getByRole('button', { name: '除外を解除' })).toHaveFocus();
    await user.keyboard('[Enter]');
    expect(screen.getByRole('combobox', { name: 'クラス' })).toBeEnabled();
    screen.getByRole('button', { name: '元に戻す' }).focus();
    await user.keyboard('[Enter]');
    expect(screen.getByRole('combobox', { name: 'クラス' })).toBeDisabled();
  });

  it('shows save failures without claiming success', async () => {
    vi.useFakeTimers();
    const save = vi.fn<AnnotationApi['save']>().mockResolvedValue({ ok: false, error: { code: 'CONFLICT' } });
    render(<Harness save={save} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'クラス' }), { target: { value: classA } });
    await act(async () => { vi.advanceTimersByTime(750); });
    expect(screen.getByRole('status')).toHaveTextContent('保存失敗');
    expect(screen.getByRole('status')).toHaveTextContent('CONFLICT');
    expect(screen.getByRole('combobox', { name: 'クラス' })).toHaveValue(classA);
  });

  it('reports unknown classes and an empty schema, never offering a foreign class', () => {
    const save = vi.fn<AnnotationApi['save']>();
    const { rerender } = render(<Harness save={save} source={item({
      annotation: { kind: 'classification', classId: projectId },
    })} />);
    expect(screen.getByText('現在のクラス：Schema 外')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('確定できません');
    expect(screen.queryByRole('option', { name: projectId })).not.toBeInTheDocument();
    rerender(<Harness save={save} empty />);
    expect(screen.getByRole('combobox', { name: 'クラス' })).toBeDisabled();
    expect(screen.getByText('Label Schema にクラスを作成してください。')).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });

  it('disables all editing controls when read-only and rejects detection items', async () => {
    const save = vi.fn<AnnotationApi['save']>();
    const { unmount } = render(<Harness save={save} disabled />);
    for (const control of screen.getAllByRole('button')) expect(control).toBeDisabled();
    for (const control of screen.getAllByRole('combobox')) expect(control).toBeDisabled();
    unmount();
    render(<Harness save={save} source={item({ annotation: { kind: 'detection', rectangles: [] } })} />);
    expect(screen.getByRole('alert')).toHaveTextContent('分類画像ではない');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });
});
