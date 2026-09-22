import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SaveStatus } from './SaveStatus';

describe('SaveStatus', () => {
  it('announces each save state politely and exposes it for styling', () => {
    const cases = [
      ['clean', '保存済み'], ['dirty', '未保存の変更があります'],
      ['saving', '保存中'], ['saved', '保存済み'], ['failed', '保存失敗'],
    ] as const;
    for (const [status, label] of cases) {
      const view = render(<SaveStatus status={status} />);
      const region = screen.getByRole('status');
      expect(region).toHaveAttribute('aria-live', 'polite');
      expect(region).toHaveAttribute('data-save-status', status);
      expect(region).toHaveTextContent(label);
      view.unmount();
    }
  });

  it('appends the reason only for a real failure, never inventing one', () => {
    const view = render(<SaveStatus status="failed" errorMessage="保存できません（CONFLICT）。" />);
    expect(screen.getByRole('status')).toHaveTextContent('保存失敗：保存できません（CONFLICT）。');
    view.unmount();

    // A failure without a supplied reason must not fabricate an explanation.
    render(<SaveStatus status="failed" errorMessage={null} />);
    expect(screen.getByRole('status')).toHaveTextContent('保存状態: 保存失敗');
    expect(screen.getByRole('status')).not.toHaveTextContent('：');
  });

  it('never shows an error message while the state is not failed', () => {
    render(<SaveStatus status="saving" errorMessage="保存できません（CONFLICT）。" />);
    expect(screen.getByRole('status')).toHaveTextContent('保存中');
    expect(screen.getByRole('status')).not.toHaveTextContent('CONFLICT');
  });
});
