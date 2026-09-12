import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import { RightsConfirmation, type RightsConfirmationProps } from './RightsConfirmation';

type Receipt = Awaited<ReturnType<RightsConfirmationProps['onConfirm']>>;
const timestamp = '2026-09-12T01:02:03.000Z';
const label = 'データの利用権利・条件と自分の責任を確認しました';
const checkbox = () => screen.getByRole('checkbox', { name: label });
const confirmButton = () => screen.getByRole('button', { name: '確認を保存' });
function deferred() {
  let resolve!: (value: Receipt) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Receipt>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function mount(overrides: Partial<RightsConfirmationProps> = {}) {
  const onConfirm = vi.fn<RightsConfirmationProps['onConfirm']>()
    .mockResolvedValue({ projectId: 'A', acknowledgedAt: timestamp });
  const props: RightsConfirmationProps = { projectId: 'A', savedAcknowledgedAt: null, onConfirm, ...overrides };
  const view = render(<RightsConfirmation {...props} />);
  return { ...view, props, onConfirm, user: userEvent.setup() };
}

// UI callback/DOM coverage only: these mocks do not prove backend persistence or legal rights.
describe('RightsConfirmation (DAT13 standalone leaf)', () => {
  it('exposes only primitive persistence props, with no automatic confirmation', () => {
    expectTypeOf<RightsConfirmationProps>().toEqualTypeOf<{
      projectId: string;
      savedAcknowledgedAt: string | null;
      onConfirm: (projectId: string) => Promise<{ projectId: string; acknowledgedAt: string }>;
      onCancel?: () => void;
    }>();
    const h = mount();
    expect(checkbox()).not.toBeChecked(); expect(confirmButton()).toBeDisabled();
    expect(confirmButton()).toHaveAttribute('type', 'button');
    expect(checkbox()).toHaveAccessibleDescription(/同梱サンプルも対象/);
    expect(h.container).toHaveTextContent('法的な適合性を保証するものではありません');
    expect(screen.getByRole('region', { name: '取り込むデータの権利確認' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'キャンセル' })).toBeNull();
    fireEvent.click(confirmButton());
    expect(h.onConfirm).not.toHaveBeenCalled();
  });

  it('does not save on checkbox changes or same-project prop changes', async () => {
    const h = mount(); await h.user.click(checkbox());
    expect(confirmButton()).toBeEnabled(); expect(h.onConfirm).not.toHaveBeenCalled();
    h.rerender(<RightsConfirmation {...h.props} onCancel={vi.fn()} />);
    expect(checkbox()).toBeChecked(); expect(h.onConfirm).not.toHaveBeenCalled();
    await h.user.click(checkbox()); expect(confirmButton()).toBeDisabled();
    expect(h.onConfirm).not.toHaveBeenCalled();
  });

  it('waits for a matching receipt, blocks same-turn duplicate clicks and shows the returned date', async () => {
    const h = mount(); const task = deferred(); h.onConfirm.mockReturnValueOnce(task.promise);
    await h.user.click(checkbox()); const button = confirmButton();
    act(() => { button.click(); button.click(); });
    expect(h.onConfirm.mock.calls).toEqual([['A']]);
    expect(checkbox()).toBeDisabled(); expect(button).toBeDisabled();
    expect(button.closest('[aria-busy]')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('保存中');
    expect(screen.queryByText(timestamp)).toBeNull();
    expect(screen.getByRole('status')).not.toHaveTextContent('保存済み');
    await act(async () => { task.resolve({ projectId: 'A', acknowledgedAt: timestamp }); });
    expect(screen.getByRole('status')).toHaveTextContent('保存済み');
    expect(screen.getByText(timestamp)).toHaveAttribute('datetime', timestamp);
    expect(button).toBeDisabled(); fireEvent.click(button);
    expect(h.onConfirm).toHaveBeenCalledTimes(1);
  });

  it.each(['reject', 'throw', 'mismatch', 'invalid-date'] as const)('retains the draft and allows explicit retry after %s', async (kind) => {
    const h = mount();
    if (kind === 'reject') h.onConfirm.mockRejectedValueOnce(new Error('PRIVATE_TRANSPORT_DETAILS'));
    else if (kind === 'throw') h.onConfirm.mockImplementationOnce(() => { throw new Error('PRIVATE_TRANSPORT_DETAILS'); });
    else h.onConfirm.mockResolvedValueOnce({ projectId: kind === 'mismatch' ? 'B' : 'A', acknowledgedAt: kind === 'invalid-date' ? '' : timestamp });
    await h.user.click(checkbox()); await h.user.click(confirmButton());
    expect(screen.getByRole('alert')).toHaveTextContent('もう一度');
    expect(checkbox()).toBeChecked(); expect(confirmButton()).toBeEnabled();
    expect(h.container).not.toHaveTextContent('PRIVATE_TRANSPORT_DETAILS');
    expect(screen.getByRole('status')).not.toHaveTextContent('保存済み');
    await h.user.click(confirmButton());
    expect(h.onConfirm.mock.calls).toEqual([['A'], ['A']]);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent(timestamp);
  });

  it('displays an existing saved record without synthesizing a checked draft or a request', () => {
    const h = mount({ savedAcknowledgedAt: timestamp });
    expect(screen.getByRole('status')).toHaveTextContent(timestamp);
    expect(checkbox()).not.toBeChecked(); expect(checkbox()).toBeDisabled();
    expect(confirmButton()).toBeDisabled(); expect(h.onConfirm).not.toHaveBeenCalled();
    h.rerender(<RightsConfirmation {...h.props} projectId="B" savedAcknowledgedAt={null} />);
    expect(screen.queryByText(timestamp)).toBeNull(); expect(checkbox()).not.toBeChecked();
    expect(checkbox()).toBeEnabled(); expect(h.onConfirm).not.toHaveBeenCalled();
  });

  it('renders incoming saved props without calling the callback', () => {
    const h = mount();
    h.rerender(<RightsConfirmation {...h.props} savedAcknowledgedAt={timestamp} />);
    expect(screen.getByRole('status')).toHaveTextContent(timestamp);
    expect(checkbox()).not.toBeChecked(); expect(confirmButton()).toBeDisabled();
    expect(h.onConfirm).not.toHaveBeenCalled();
  });

  it('uses native keyboard checkbox and button activation with unique input labels', async () => {
    const h = mount();
    await h.user.tab(); expect(checkbox()).toHaveFocus();
    await h.user.keyboard(' '); expect(checkbox()).toBeChecked(); expect(h.onConfirm).not.toHaveBeenCalled();
    await h.user.tab(); expect(confirmButton()).toHaveFocus();
    await h.user.keyboard('{Enter}'); expect(h.onConfirm).toHaveBeenCalledWith('A');
    render(<RightsConfirmation projectId="B" savedAcknowledgedAt={null} onConfirm={vi.fn()} />);
    const fields = screen.getAllByRole('checkbox', { name: label });
    expect(fields[0].id).not.toBe(fields[1].id);
    for (const field of fields) expect(h.baseElement.querySelector(`label[for="${field.id}"]`)).not.toBeNull();
  });

  it('cancels without confirming a checked draft', async () => {
    const onCancel = vi.fn(); const h = mount({ onCancel });
    await h.user.click(checkbox()); await h.user.click(screen.getByRole('button', { name: 'キャンセル' }));
    expect(onCancel.mock.calls).toEqual([[]]); expect(h.onConfirm).not.toHaveBeenCalled();
    expect(confirmButton()).toBeDisabled();
  });

  it.each(['resolve', 'reject'] as const)('ignores pending %s after cancellation, without claiming rollback', async (completion) => {
    const onCancel = vi.fn(); const h = mount({ onCancel }); const task = deferred();
    h.onConfirm.mockReturnValueOnce(task.promise);
    await h.user.click(checkbox()); await h.user.click(confirmButton());
    expect(screen.getByRole('status')).toHaveTextContent('送信済みの処理は取り消されません');
    await h.user.click(screen.getByRole('button', { name: 'キャンセル' }));
    await act(async () => {
      if (completion === 'resolve') task.resolve({ projectId: 'A', acknowledgedAt: timestamp });
      else task.reject(new Error('late failure'));
    });
    expect(onCancel).toHaveBeenCalledTimes(1); expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('status')).not.toHaveTextContent('保存済み');
  });

  it.each(['resolve', 'reject'] as const)('resets project drafts and ignores stale %s through A -> B -> A', async (completion) => {
    const h = mount(); const old = deferred(); const current = deferred();
    h.onConfirm.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    await h.user.click(checkbox()); await h.user.click(confirmButton());
    h.rerender(<RightsConfirmation {...h.props} projectId="B" />);
    expect(checkbox()).not.toBeChecked(); expect(checkbox()).toBeEnabled();
    h.rerender(<RightsConfirmation {...h.props} />);
    expect(checkbox()).not.toBeChecked(); expect(h.onConfirm).toHaveBeenCalledTimes(1);
    await h.user.click(checkbox()); await h.user.click(confirmButton());
    await act(async () => {
      if (completion === 'resolve') old.resolve({ projectId: 'A', acknowledgedAt: timestamp });
      else old.reject(new Error('stale failure'));
    });
    expect(screen.getByRole('status')).toHaveTextContent('保存中');
    expect(screen.queryByRole('alert')).toBeNull(); expect(confirmButton()).toBeDisabled();
    await act(async () => { current.resolve({ projectId: 'A', acknowledgedAt: timestamp }); });
    expect(screen.getByRole('status')).toHaveTextContent('保存済み');
  });

  it('clears errors and successful local receipts on project change', async () => {
    const h = mount(); h.onConfirm.mockRejectedValueOnce(new Error('failure'));
    await h.user.click(checkbox()); await h.user.click(confirmButton());
    expect(screen.getByRole('alert')).toBeVisible();
    h.rerender(<RightsConfirmation {...h.props} projectId="B" />);
    expect(screen.queryByRole('alert')).toBeNull(); expect(checkbox()).not.toBeChecked();
    h.onConfirm.mockResolvedValueOnce({ projectId: 'B', acknowledgedAt: timestamp });
    await h.user.click(checkbox()); await h.user.click(confirmButton());
    expect(screen.getByRole('status')).toHaveTextContent(timestamp);
    h.rerender(<RightsConfirmation {...h.props} />);
    expect(screen.queryByText(timestamp)).toBeNull(); expect(checkbox()).not.toBeChecked();
  });

  it.each(['resolve', 'reject'] as const)('ignores %s after unmount without affecting a fresh instance', async (completion) => {
    const h = mount(); const task = deferred(); h.onConfirm.mockReturnValueOnce(task.promise);
    await h.user.click(checkbox()); await h.user.click(confirmButton()); h.unmount();
    const fresh = mount();
    await act(async () => {
      if (completion === 'resolve') task.resolve({ projectId: 'A', acknowledgedAt: timestamp });
      else task.reject(new Error('late failure'));
    });
    expect(h.container).toBeEmptyDOMElement(); expect(checkbox()).not.toBeChecked();
    expect(screen.queryByRole('alert')).toBeNull(); expect(screen.queryByText(timestamp)).toBeNull();
    expect(fresh.onConfirm).not.toHaveBeenCalled();
  });

  it('does not auto-confirm under StrictMode effect replay', async () => {
    const onConfirm = vi.fn<RightsConfirmationProps['onConfirm']>()
      .mockResolvedValue({ projectId: 'A', acknowledgedAt: timestamp });
    render(<StrictMode><RightsConfirmation projectId="A" savedAcknowledgedAt={null} onConfirm={onConfirm} /></StrictMode>);
    expect(onConfirm).not.toHaveBeenCalled();
    const user = userEvent.setup(); await user.click(checkbox()); await user.click(confirmButton());
    expect(onConfirm).toHaveBeenCalledTimes(1); expect(screen.getByRole('status')).toHaveTextContent(timestamp);
  });
});