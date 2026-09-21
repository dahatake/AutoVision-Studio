import { useEffect, useState } from 'react';

export interface ItemActionsProps {
  readonly excluded: boolean;
  readonly exclusionReason: string | null;
  readonly exclusionReasons: readonly string[];
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly disabled?: boolean;
  readonly onExclude: (reason: string) => void;
  readonly onClearExclusion: () => void;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
}

export function ItemActions({
  excluded, exclusionReason, exclusionReasons, canUndo, canRedo, disabled = false,
  onExclude, onClearExclusion, onUndo, onRedo,
}: ItemActionsProps) {
  const [selectedReason, setSelectedReason] = useState(exclusionReason ?? exclusionReasons[0] ?? '');
  useEffect(() => {
    setSelectedReason(exclusionReason ?? exclusionReasons[0] ?? '');
  }, [exclusionReason, exclusionReasons]);
  return (
    <section aria-label="画像操作">
      <div>
        <label htmlFor="annotation-exclusion-reason">除外理由</label>
        <select
          id="annotation-exclusion-reason"
          value={selectedReason}
          disabled={disabled || exclusionReasons.length === 0}
          onChange={(event) => setSelectedReason(event.currentTarget.value)}
        >
          {exclusionReasons.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
        </select>
        <button
          type="button"
          disabled={disabled || exclusionReasons.length === 0}
          onClick={() => onExclude(selectedReason)}
        >
          除外にする
        </button>
        <button type="button" disabled={disabled || !excluded} onClick={onClearExclusion}>
          除外を解除
        </button>
      </div>
      <div>
        <button type="button" disabled={disabled || !canUndo} onClick={onUndo}>元に戻す</button>
        <button type="button" disabled={disabled || !canRedo} onClick={onRedo}>やり直す</button>
      </div>
    </section>
  );
}
