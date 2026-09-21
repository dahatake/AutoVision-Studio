import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ItemActions } from './ItemActions';
import { SaveStatus } from './SaveStatus';

const reasons = ['重複', '権利未確認', '対象外'];

describe('ItemActions and SaveStatus W2-05', () => {
  it('distinguishes saving, saved and failed states with text and aria status, not color alone', () => {
    const { rerender } = render(<SaveStatus status="saving" />);
    expect(screen.getByRole('status')).toHaveTextContent('保存状態: 保存中');
    expect(screen.getByRole('status')).toHaveAttribute('data-save-status', 'saving');
    rerender(<SaveStatus status="saved" />);
    expect(screen.getByRole('status')).toHaveTextContent('保存状態: 保存済み');
    expect(screen.getByRole('status')).toHaveAttribute('data-save-status', 'saved');
    rerender(<SaveStatus status="failed" errorMessage="競合しました" />);
    expect(screen.getByRole('status')).toHaveTextContent('保存状態: 保存失敗：競合しました');
    expect(screen.getByRole('status')).toHaveAttribute('data-save-status', 'failed');
  });

  it('selects an exclusion reason and exposes every operation through keyboard-reachable native controls', async () => {
    const onExclude = vi.fn<(reason: string) => void>();
    const onClearExclusion = vi.fn<() => void>();
    const onUndo = vi.fn<() => void>();
    const onRedo = vi.fn<() => void>();
    const user = userEvent.setup();
    render(<ItemActions excluded={false} exclusionReason={null} exclusionReasons={reasons}
      canUndo canRedo onExclude={onExclude} onClearExclusion={onClearExclusion} onUndo={onUndo} onRedo={onRedo} />);
    const select = screen.getByLabelText('除外理由');
    expect(select).toBeEnabled();
    await user.selectOptions(select, '権利未確認');
    expect(onExclude).not.toHaveBeenCalled();
    expect(select).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: '除外にする' })).toHaveFocus();
    await user.keyboard('[Enter]');
    expect(onExclude).toHaveBeenLastCalledWith('権利未確認');
    expect(screen.getByRole('button', { name: '除外を解除' })).toBeDisabled();
    await user.tab();
    expect(screen.getByRole('button', { name: '元に戻す' })).toHaveFocus();
    await user.keyboard('[Enter]');
    expect(onUndo).toHaveBeenCalledOnce();
    await user.tab();
    expect(screen.getByRole('button', { name: 'やり直す' })).toHaveFocus();
    await user.keyboard('[Enter]');
    expect(onRedo).toHaveBeenCalledOnce();
    expect(onClearExclusion).not.toHaveBeenCalled();
  });

  it('allows clearing a selected exclusion reason only when the item is excluded', async () => {
    const onClearExclusion = vi.fn<() => void>();
    const user = userEvent.setup();
    render(<ItemActions excluded exclusionReason="対象外" exclusionReasons={reasons}
      canUndo={false} canRedo={false} onExclude={vi.fn()} onClearExclusion={onClearExclusion}
      onUndo={vi.fn()} onRedo={vi.fn()} />);
    expect(screen.getByLabelText('除外理由')).toHaveValue('対象外');
    await user.click(screen.getByRole('button', { name: '除外を解除' }));
    expect(onClearExclusion).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: '元に戻す' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'やり直す' })).toBeDisabled();
  });
});
