import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { labelClassSchema } from '../../../shared/contracts/annotation';
import { LabelPicker } from './LabelPicker';

const schemaId = '11111111-1111-4111-8111-111111111111';
const otherSchema = '22222222-2222-4222-8222-222222222222';
const classes = Array.from({ length: 11 }, (_, ordinal) => labelClassSchema.parse({
  id: `33333333-3333-4333-8333-${String(ordinal + 1).padStart(12, '0')}`,
  schemaId, displayName: ordinal === 0 ? '猫' : ordinal === 1 ? '犬' : `ラベル${ordinal + 1}`,
  normalizedName: ordinal === 0 ? '猫' : ordinal === 1 ? '犬' : `ラベル${ordinal + 1}`,
  modelAlias: ordinal === 0 ? 'Cat' : null, color: '#0078d4', description: '', examples: [],
  ordinal, createdAt: '2026-09-21T00:00:00.000Z', updatedAt: '2026-09-21T00:00:00.000Z',
}));
const base = { schemaId, classes, selectedClassId: null };
const results = () => within(screen.getByRole('region', { name: '検索結果' }));
const recent = () => within(screen.getByRole('region', { name: '最近使ったラベル' }));

describe('LabelPicker W2-07', () => {
  it('searches normalized display names and aliases without assigning while typing', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<LabelPicker {...base} onSelect={onSelect} />);
    await user.type(screen.getByRole('searchbox'), 'ＣＡＴ');
    expect(results().getAllByRole('button')).toHaveLength(1);
    expect(results().getByRole('button', { name: '1: 猫' })).toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
    await user.click(results().getByRole('button', { name: '1: 猫' }));
    expect(onSelect).toHaveBeenLastCalledWith(classes[0]!.id);
    await user.clear(screen.getByRole('searchbox'));
    await user.type(screen.getByRole('searchbox'), '犬');
    expect(results().getAllByRole('button')).toHaveLength(1);
    expect(results().getByRole('button', { name: '1: 犬' })).toBeInTheDocument();
    await user.clear(screen.getByRole('searchbox'));
    await user.type(screen.getByRole('searchbox'), '見つからない');
    expect(results().getByText('一致するラベルがありません。')).toBeInTheDocument();
    expect(results().queryByRole('button')).not.toBeInTheDocument();
  });

  it('supports keyboard search and selection, and recent labels by mouse and keyboard', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<LabelPicker {...base} onSelect={onSelect} />);
    await user.tab();
    expect(screen.getByRole('region', { name: 'ラベル選択' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('searchbox')).toHaveFocus();
    await user.keyboard('猫');
    await user.tab();
    expect(results().getByRole('button', { name: '1: 猫' })).toHaveFocus();
    await user.keyboard('[Enter]');
    expect(onSelect).toHaveBeenLastCalledWith(classes[0]!.id);
    await user.click(recent().getByRole('button', { name: '猫' }));
    expect(onSelect).toHaveBeenCalledTimes(2);
    await user.keyboard(' ');
    expect(onSelect).toHaveBeenCalledTimes(3);
    expect(recent().getAllByRole('button')).toHaveLength(1);
  });

  it('maps digits to displayed results in schema order, including after filtering', async () => {
    const onSelect = vi.fn();
    render(<LabelPicker {...base} classes={[...classes].reverse()} onSelect={onSelect} />);
    const root = screen.getByRole('region', { name: 'ラベル選択' });
    fireEvent.keyDown(root, { key: '2' });
    expect(onSelect).toHaveBeenLastCalledWith(classes[1]!.id);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '猫' } });
    fireEvent.keyDown(root, { key: '2' });
    expect(onSelect).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(root, { key: '1' });
    expect(onSelect).toHaveBeenLastCalledWith(classes[0]!.id);
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it('does not run shortcuts during native or captured IME composition, including keyCode 229', () => {
    const onSelect = vi.fn();
    render(<LabelPicker {...base} onSelect={onSelect} />);
    const root = screen.getByRole('region', { name: 'ラベル選択' });
    fireEvent.keyDown(root, { key: '1', isComposing: true });
    fireEvent.keyDown(root, { key: '1', keyCode: 229 });
    fireEvent.compositionStart(screen.getByRole('searchbox'));
    fireEvent.keyDown(root, { key: '1' });
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.compositionEnd(screen.getByRole('searchbox'));
    fireEvent.keyDown(root, { key: '1' });
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(classes[0]!.id);
  });

  it('never intercepts numeric text input, textarea, select or nested contenteditable targets', () => {
    const onSelect = vi.fn();
    render(<LabelPicker {...base} onSelect={onSelect} />);
    const root = screen.getByRole('region', { name: 'ラベル選択' });
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: '1' });
    for (const tag of ['input', 'textarea', 'select', 'div']) {
      const control = document.createElement(tag);
      if (tag === 'div') {
        control.setAttribute('contenteditable', 'true');
        control.appendChild(document.createElement('span'));
      }
      root.appendChild(control);
      fireEvent.keyDown(control.firstElementChild ?? control, { key: '1' });
      control.remove();
    }
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: '1' });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('ignores modifiers, repeats, zero and unrelated keys', () => {
    const onSelect = vi.fn();
    render(<LabelPicker {...base} onSelect={onSelect} />);
    const root = screen.getByRole('region', { name: 'ラベル選択' });
    for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey', 'repeat']) {
      fireEvent.keyDown(root, { key: '1', [modifier]: true });
    }
    for (const key of ['0', 'a', 'Escape']) fireEvent.keyDown(root, { key });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('keeps nine unique recent labels in most-recent order without changing digit mappings', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<LabelPicker {...base} onSelect={onSelect} />);
    for (const button of results().getAllByRole('button')) await user.click(button);
    expect(recent().getAllByRole('button').map((button) => button.textContent)).toEqual(
      classes.slice(-9).reverse().map((entry) => entry.displayName),
    );
    await user.click(recent().getByRole('button', { name: 'ラベル5' }));
    expect(recent().getAllByRole('button')[0]).toHaveTextContent('ラベル5');
    expect(recent().getAllByRole('button')).toHaveLength(9);
    fireEvent.keyDown(screen.getByRole('region', { name: 'ラベル選択' }), { key: '1' });
    expect(onSelect).toHaveBeenLastCalledWith(classes[0]!.id);
    expect(recent().getAllByRole('button')[0]).toHaveTextContent('猫');
  });

  it('prunes deleted labels, reflects renames, and resets recent labels and search on schema switch', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const { rerender } = render(<LabelPicker {...base} onSelect={onSelect} />);
    await user.click(results().getByRole('button', { name: '1: 猫' }));
    await user.click(results().getByRole('button', { name: '2: 犬' }));
    const renamed = { ...classes[0]!, displayName: 'ねこ', normalizedName: 'ねこ' };
    rerender(<LabelPicker {...base} classes={[renamed]} onSelect={onSelect} />);
    expect(recent().getAllByRole('button')).toHaveLength(1);
    expect(recent().getByRole('button', { name: 'ねこ' })).toBeInTheDocument();
    rerender(<LabelPicker {...base} onSelect={onSelect} />);
    expect(recent().queryByRole('button', { name: '犬' })).not.toBeInTheDocument();
    await user.type(screen.getByRole('searchbox'), '猫');
    rerender(<LabelPicker {...base} schemaId={otherSchema} onSelect={onSelect} />);
    expect(recent().queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByRole('searchbox')).toHaveValue('');
    expect(results().queryByRole('button')).not.toBeInTheDocument();
    rerender(<LabelPicker {...base} onSelect={onSelect} />);
    expect(recent().queryByRole('button')).not.toBeInTheDocument();
  });

  it('does not deselect the active label, and disables mouse and numeric actions when locked', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const { rerender } = render(<LabelPicker {...base} selectedClassId={classes[0]!.id} onSelect={onSelect} />);
    expect(results().getByRole('button', { name: '1: 猫' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(results().getByRole('button', { name: '1: 猫' }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(classes[0]!.id);
    rerender(<LabelPicker {...base} onSelect={onSelect} disabled />);
    await user.click(results().getByRole('button', { name: '2: 犬' }));
    fireEvent.keyDown(screen.getByRole('region', { name: 'ラベル選択' }), { key: '1' });
    expect(screen.getByRole('searchbox')).toBeDisabled();
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
