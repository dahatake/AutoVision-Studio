export interface AnnotationInstructionsProps {
  /** Label Schema の指示文（遮蔽・端切れ・極小・曖昧境界などの Project 固有の方針）。
   *  空文字は「未設定」を意味し、捏造せずそのまま伝える。 */
  readonly instructions: string;
}

const EMPTY_NOTICE = 'この Project の作業指示はまだ設定されていません（Label Schema 画面で設定できます）。';

/** W2-15: read-only, always-rendered reference panel for the Project's
 * occlusion / truncation / tiny-object / ambiguous-boundary policy while
 * annotating. There is no collapse/expand control, so the text stays visible
 * without an extra interaction. Editing the instructions remains
 * LabelSchemaPage's responsibility; this component never writes them. */
export function AnnotationInstructions({ instructions }: AnnotationInstructionsProps) {
  const hasInstructions = instructions.trim().length > 0;
  return (
    <section aria-label="作業指示" data-has-instructions={hasInstructions}>
      <h2>作業指示</h2>
      {hasInstructions
        ? <p style={{ whiteSpace: 'pre-wrap' }}>{instructions}</p>
        : <p>{EMPTY_NOTICE}</p>}
    </section>
  );
}
