import { getDefaultNormalizer, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AnnotationInstructions } from './AnnotationInstructions';

const POLICY = '遮蔽：50%以上隠れた対象は除外。\n端切れ：画像端で切れた対象も対象物として含める。\n極小：一辺8px未満は対象外。\n曖昧境界：不明瞭な境界は最も確からしい輪郭で囲む。';
const UNSET_NOTICE = 'この Project の作業指示はまだ設定されていません（Label Schema 画面で設定できます）。';
// Line breaks carry meaning in the policy text, so matching must not collapse them.
const verbatim = getDefaultNormalizer({ collapseWhitespace: false, trim: false });

describe('AnnotationInstructions W2-15', () => {
  it('always shows the Project-specific policy text without any expand/collapse step', () => {
    render(<AnnotationInstructions instructions={POLICY} />);
    const panel = screen.getByRole('region', { name: '作業指示' });
    const policy = within(panel).getByText(POLICY, { normalizer: verbatim });
    // Rendered and visible immediately; no button, summary or details element
    // stands between the annotator and the policy.
    expect(policy).toBeVisible();
    expect(policy.textContent).toBe(POLICY);
    expect(policy).toHaveStyle({ whiteSpace: 'pre-wrap' });
    expect(within(panel).queryByRole('button')).not.toBeInTheDocument();
    expect(panel.querySelector('details, summary')).toBeNull();
    expect(within(panel).queryByText(UNSET_NOTICE)).not.toBeInTheDocument();
  });

  it('honestly reports when no Project policy has been set, instead of hiding the panel or inventing content', () => {
    render(<AnnotationInstructions instructions="" />);
    const panel = screen.getByRole('region', { name: '作業指示' });
    expect(within(panel).getByText(UNSET_NOTICE)).toBeVisible();
  });

  it('treats whitespace-only instructions as unset', () => {
    render(<AnnotationInstructions instructions={'   \n  '} />);
    const panel = screen.getByRole('region', { name: '作業指示' });
    expect(within(panel).getByText(UNSET_NOTICE)).toBeVisible();
  });

  it('never renders editing controls (textbox/save button) for the instructions', () => {
    render(<AnnotationInstructions instructions="既存の方針テキスト" />);
    const panel = screen.getByRole('region', { name: '作業指示' });
    expect(within(panel).getByText('既存の方針テキスト')).toBeVisible();
    expect(within(panel).queryByRole('textbox')).not.toBeInTheDocument();
    expect(within(panel).queryByRole('button')).not.toBeInTheDocument();
  });
});
