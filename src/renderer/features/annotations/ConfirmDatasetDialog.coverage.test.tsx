import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ConfirmDatasetDialog } from './ConfirmDatasetDialog';

const summary = { total: 10, confirmed: 10, excluded: 0, unconfirmed: 0, schemaOutside: 0, invalidRectangles: 0, invalidStored: 0, provenance: {} };

describe('ConfirmDatasetDialog coverage guard (FR-CVP-001)', () => {
  it('shows class, shortfall and how to fix for Errors', () => {
    render(<ConfirmDatasetDialog open summary={summary} onConfirm={() => undefined} onCancel={() => undefined}
      coverageErrors={[{ classId: 'cat', actual: 4, required: 5, shortfall: 1 }]} />);
    expect(screen.getByRole('alert', { name: 'クラス別枚数の Error' }).textContent).toContain('あと 1 枚');
  });
  it('shows recommended and imbalance Warns', () => {
    render(<ConfirmDatasetDialog open summary={summary} onConfirm={() => undefined} onCancel={() => undefined}
      coverageWarnings={[{ code: 'CLASS_BELOW_RECOMMENDED', classId: 'dog', actual: 20, required: 50 },
        { code: 'CLASS_IMBALANCE', classId: null, actual: 2.5, required: 2 }]} />);
    const list = screen.getByRole('list', { name: 'クラス別枚数の Warn' });
    expect(list.textContent).toContain('推奨 50 枚未満');
    expect(list.textContent).toContain('2.5 倍');
  });
});
