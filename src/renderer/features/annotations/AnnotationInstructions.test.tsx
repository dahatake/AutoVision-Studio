import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AnnotationInstructions } from './AnnotationInstructions';

describe('AnnotationInstructions W2-15', () => {
  it('always shows the Project-specific policy text without any expand/collapse step', () => {
    const policy = '遮蔽：50%以上隠れた対象は除外。\n端切れ：画像端で切れた対象も対象物として含める。\n極小：一辺8px未満は対象外。\n曖昧境界：不明瞭な境界は最も確からしい輪郭で囲む。';
    render(<AnnotationInstructions instructions={policy} />);
    const panel = screen.getByRole('region', { name: '作業指示' });
    expect(panel).toHaveAttribute('data-has-instructions', 'true');
    // Rendered immediately in the accessibility tree; no button/summary is
    // required to reveal it, satisfying "always referenceable".
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(panel).toHaveTextContent('遮蔽：50%以上隠れた対象は除外。');
    expect(panel).toHaveTextContent('端切れ：画像端で切れた対象も対象物として含める。');
    expect(panel).toHaveTextContent('極小：一辺8px未満は対象外。');
    expect(panel).toHaveTextContent('曖昧境界：不明瞭な境界は最も確からしい輪郭で囲む。');
  });

  it('honestly reports when no Project policy has been set, instead of hiding the panel or inventing content', () => {
    render(<AnnotationInstructions instructions="" />);
    const panel = screen.getByRole('region', { name: '作業指示' });
    expect(panel).toHaveAttribute('data-has-instructions', 'false');
    expect(panel).toHaveTextContent('まだ設定されていません');
  });

  it('treats whitespace-only instructions as unset', () => {
    render(<AnnotationInstructions instructions={'   \n  '} />);
    const panel = screen.getByRole('region', { name: '作業指示' });
    expect(panel).toHaveAttribute('data-has-instructions', 'false');
  });

  it('never renders editing controls (textbox/save button) for the instructions', () => {
    render(<AnnotationInstructions instructions="既存の方針テキスト" />);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
