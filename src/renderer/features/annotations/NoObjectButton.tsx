import type { AnnotationState } from '../../../shared/contracts/annotation';

export interface NoObjectButtonProps {
  readonly rectangleCount: number;
  readonly state: AnnotationState;
  readonly negativeConfirmed: boolean;
  readonly disabled?: boolean;
  readonly onMarkNoObject: () => void;
  readonly onClearNoObject: () => void;
}

/** W2-13: "対象物なし" is a confirmed statement that the image contains nothing
 * to annotate. It is never inferred from an empty rectangle list: an image
 * nobody has looked at stays 未着手, and the two are reported separately. */
export function NoObjectButton({
  rectangleCount, state, negativeConfirmed, disabled = false, onMarkNoObject, onClearNoObject,
}: NoObjectButtonProps) {
  const declared = negativeConfirmed && rectangleCount === 0 && state === 'confirmed';
  const untouched = state === 'unstarted' || state === 'suggested';
  const blocked = rectangleCount > 0;
  const label = declared ? '対象物なし（確認済み）'
    : blocked ? `領域 ${rectangleCount.toLocaleString('ja-JP')}件（対象物なしにはできません）`
      : untouched ? '未着手（対象物なしの確認はされていません）'
        : '編集中（領域なし・対象物なしの確認はされていません）';

  return (
    <section aria-label="対象物なしの確認">
      <p role="status" data-no-object-state={declared ? 'declared' : untouched ? 'unstarted' : blocked ? 'blocked' : 'editing'}>
        {label}
      </p>
      {declared
        ? <button type="button" disabled={disabled} onClick={onClearNoObject}>対象物なしを取り消す</button>
        : (
          <button type="button" disabled={disabled || blocked} onClick={onMarkNoObject}>
            対象物なしとして確定
          </button>
        )}
      {blocked && <p>領域をすべて削除すると「対象物なし」として確定できます。</p>}
    </section>
  );
}
