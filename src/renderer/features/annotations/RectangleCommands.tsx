import type { KeyboardEvent } from 'react';
import type { AnnotationRectangle } from '../../../shared/contracts/annotation';

/** Structural view of a Main-side duplicate warning. The renderer keeps its own
 * shape so it never imports Main code; values arrive over IPC with the item. */
export interface DuplicateWarningView {
  readonly classId: string;
  readonly firstId: string;
  readonly secondId: string;
  readonly iou: number;
}

export interface RectangleCommandsProps {
  readonly rectangles: readonly AnnotationRectangle[];
  readonly selectedIds: readonly string[];
  readonly warnings: readonly DuplicateWarningView[];
  readonly disabled?: boolean;
  readonly onDuplicate: (ids: readonly string[]) => void;
  readonly onDelete: (ids: readonly string[]) => void;
  readonly onSelectAll: () => void;
  readonly onClearSelection: () => void;
}

const shortcuts = 'Ctrl+D で複製、Ctrl+A で全選択、Delete で削除、Esc で選択解除';

/** W2-14: commands over the current rectangle selection, plus the read-only
 * duplicate report. Heavy overlaps are surfaced for a person to resolve; this
 * component never deletes or merges a rectangle on its own. */
export function RectangleCommands({
  rectangles, selectedIds, warnings, disabled = false,
  onDuplicate, onDelete, onSelectAll, onClearSelection,
}: RectangleCommandsProps) {
  const selectedCount = selectedIds.length;
  const hasSelection = selectedCount > 0;
  const canSelectAll = rectangles.length > 0 && selectedCount < rectangles.length;

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (disabled) return;
    const key = event.key.toLowerCase();
    if (event.ctrlKey && key === 'd' && hasSelection) { event.preventDefault(); onDuplicate(selectedIds); }
    else if (event.ctrlKey && key === 'a' && canSelectAll) { event.preventDefault(); onSelectAll(); }
    else if ((event.key === 'Delete' || event.key === 'Backspace') && hasSelection) { event.preventDefault(); onDelete(selectedIds); }
    else if (event.key === 'Escape' && hasSelection) { event.preventDefault(); onClearSelection(); }
  }

  return (
    <section aria-label="領域コマンド" onKeyDown={onKeyDown}>
      <p role="status">
        選択中 {selectedCount.toLocaleString('ja-JP')}件 ／ 全 {rectangles.length.toLocaleString('ja-JP')}件（{shortcuts}）
      </p>
      <button type="button" disabled={disabled || !hasSelection} onClick={() => onDuplicate(selectedIds)}>複製</button>
      <button type="button" disabled={disabled || !hasSelection} onClick={() => onDelete(selectedIds)}>削除</button>
      <button type="button" disabled={disabled || !canSelectAll} onClick={onSelectAll}>すべて選択</button>
      <button type="button" disabled={disabled || !hasSelection} onClick={onClearSelection}>選択を解除</button>
      {warnings.length > 0 && (
        <div role="alert">
          <p>同じクラスで重なりの大きい領域が {warnings.length.toLocaleString('ja-JP')}組あります。自動では削除も統合もしません。</p>
          <ul>
            {warnings.map((warning) => (
              <li key={`${warning.firstId}:${warning.secondId}`}>
                {warning.firstId} と {warning.secondId}（重なり {Math.round(warning.iou * 100)}%）
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
