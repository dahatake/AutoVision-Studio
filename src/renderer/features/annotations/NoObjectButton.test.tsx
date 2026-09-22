import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { NoObjectButton } from './NoObjectButton';

function ports(overrides: Partial<Parameters<typeof NoObjectButton>[0]> = {}) {
  const onMarkNoObject = vi.fn();
  const onClearNoObject = vi.fn();
  const props = {
    rectangleCount: 0, state: 'unstarted' as const, negativeConfirmed: false,
    onMarkNoObject, onClearNoObject, ...overrides,
  };
  render(<NoObjectButton {...props} />);
  return { onMarkNoObject, onClearNoObject };
}

describe('NoObjectButton', () => {
  it('keeps 未着手 distinct from 対象物なし for an image nobody has looked at', () => {
    ports();
    expect(screen.getByRole('status')).toHaveTextContent('未着手（対象物なしの確認はされていません）');
    expect(screen.getByRole('status')).toHaveAttribute('data-no-object-state', 'unstarted');
    expect(screen.getByRole('button', { name: '対象物なしとして確定' })).toBeEnabled();
  });

  it('separates an edited empty image from an untouched one', () => {
    ports({ state: 'editing' });
    expect(screen.getByRole('status'))
      .toHaveTextContent('編集中（領域なし・対象物なしの確認はされていません）');
    expect(screen.getByRole('status')).toHaveAttribute('data-no-object-state', 'editing');
  });

  it('records 対象物なし only as an explicit human command', async () => {
    const h = ports();
    await userEvent.click(screen.getByRole('button', { name: '対象物なしとして確定' }));
    expect(h.onMarkNoObject).toHaveBeenCalledTimes(1);
    expect(h.onClearNoObject).not.toHaveBeenCalled();
  });

  it('refuses 対象物なし while regions exist, and says why', async () => {
    const h = ports({ rectangleCount: 2, state: 'editing' });
    const button = screen.getByRole('button', { name: /対象物なしにはできません|対象物なしとして確定/u });
    expect(button).toBeDisabled();
    expect(screen.getByRole('status')).toHaveAttribute('data-no-object-state', 'blocked');
    expect(screen.getByText('領域をすべて削除すると「対象物なし」として確定できます。')).toBeVisible();
    await userEvent.click(button, { pointerEventsCheck: 0 });
    expect(h.onMarkNoObject).not.toHaveBeenCalled();
  });

  it('shows the declared state only when a confirmed, empty negative is stored', () => {
    ports({ state: 'confirmed', negativeConfirmed: true });
    expect(screen.getByRole('status')).toHaveTextContent('対象物なし（確認済み）');
    expect(screen.getByRole('status')).toHaveAttribute('data-no-object-state', 'declared');
    expect(screen.getByRole('button', { name: '対象物なしを取り消す' })).toBeVisible();
  });

  it('does not claim 対象物なし when the flag is set without a confirmed empty image', () => {
    ports({ state: 'editing', negativeConfirmed: true, rectangleCount: 1 });
    expect(screen.getByRole('status')).not.toHaveTextContent('対象物なし（確認済み）');
    expect(screen.getByRole('status')).toHaveAttribute('data-no-object-state', 'blocked');
  });

  it('disables every command while the caller says the item is locked', async () => {
    const h = ports({ state: 'confirmed', negativeConfirmed: true, disabled: true });
    const button = screen.getByRole('button', { name: '対象物なしを取り消す' });
    expect(button).toBeDisabled();
    await userEvent.click(button, { pointerEventsCheck: 0 });
    expect(h.onClearNoObject).not.toHaveBeenCalled();
  });
});
