import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ConfirmDatasetDialog } from './ConfirmDatasetDialog';

describe('ConfirmDatasetDialog', () => {
  it('shows counts, provenance and blocks confirmation while errors remain', async () => {
    const confirm = vi.fn();
    render(<ConfirmDatasetDialog open summary={{
      total: 4, confirmed: 2, excluded: 1, unconfirmed: 1, schemaOutside: 0,
      invalidRectangles: 0, invalidStored: 0, provenance: { manual: 2, 'import-unmodified': 1 },
    }} onConfirm={confirm} onCancel={vi.fn()} />);

    expect(screen.getByText('未処理候補')).toBeInTheDocument();
    expect(screen.getByText('manual: 2')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('確定できません');
    await userEvent.click(screen.getByRole('button', { name: '確定して学習 Queue へ渡す' }));
    expect(confirm).not.toHaveBeenCalled();
  });

  it('allows confirmation when there are no errors', async () => {
    const confirm = vi.fn();
    render(<ConfirmDatasetDialog open summary={{
      total: 2, confirmed: 2, excluded: 0, unconfirmed: 0, schemaOutside: 0,
      invalidRectangles: 0, invalidStored: 0, provenance: {},
    }} onConfirm={confirm} onCancel={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: '確定して学習 Queue へ渡す' }));
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('blocks confirmation when stored-data validation errors remain', async () => {
    const confirm = vi.fn();
    render(<ConfirmDatasetDialog open summary={{
      total: 1, confirmed: 1, excluded: 0, unconfirmed: 0, schemaOutside: 0,
      invalidRectangles: 0, invalidStored: 1, provenance: {},
    }} onConfirm={confirm} onCancel={vi.fn()} />);

    expect(screen.getByText('保存データ不整合')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '確定して学習 Queue へ渡す' }));
    expect(confirm).not.toHaveBeenCalled();
  });
});
