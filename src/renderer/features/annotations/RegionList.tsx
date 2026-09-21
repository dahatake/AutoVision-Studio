import type { AnnotationRectangle } from '../../../shared/contracts/annotation';

/** Only what the list needs to show and change a class; the full LabelClass
 * DTO is assignable to it. */
export interface RegionClassOption {
  readonly id: string;
  readonly displayName: string;
}

export interface RegionListProps {
  readonly rectangles: readonly AnnotationRectangle[];
  readonly classes: readonly RegionClassOption[];
  readonly selectedId: string | null;
  readonly disabled?: boolean;
  readonly onSelect: (id: string) => void;
  readonly onChangeClass: (id: string, classId: string) => void;
}

function describe(rectangle: AnnotationRectangle): string {
  const round = (value: number) => Math.round(value).toLocaleString('ja-JP');
  return `X ${round(rectangle.x)}, Y ${round(rectangle.y)}, 幅 ${round(rectangle.width)}, 高さ ${round(rectangle.height)}`;
}

/** W2-13: the DOM view of the rectangles drawn on the canvas. Selection and
 * per-rectangle class changes only; geometry is edited on the canvas (W2-12)
 * and multi-rectangle commands are W2-14. */
export function RegionList({ rectangles, classes, selectedId, disabled = false, onSelect, onChangeClass }: RegionListProps) {
  return (
    <section aria-label="領域一覧">
      <p role="status">領域 {rectangles.length.toLocaleString('ja-JP')}件</p>
      {rectangles.length === 0
        ? <p>領域がありません。画像上をドラッグして領域を作成してください。</p>
        : (
          <ul>
            {rectangles.map((rectangle, index) => {
              const known = classes.some((option) => option.id === rectangle.classId);
              return (
                <li key={rectangle.id} aria-current={rectangle.id === selectedId ? 'true' : undefined}>
                  <button type="button" disabled={disabled} onClick={() => onSelect(rectangle.id)}>
                    領域 {index + 1}（{describe(rectangle)}）
                  </button>
                  <label htmlFor={`region-class-${rectangle.id}`}>領域 {index + 1} のクラス</label>
                  <select
                    id={`region-class-${rectangle.id}`}
                    value={known ? rectangle.classId : ''}
                    disabled={disabled || classes.length === 0}
                    onChange={(event) => onChangeClass(rectangle.id, event.currentTarget.value)}
                  >
                    {/* An unknown class is shown as-is instead of silently
                        re-labelling the region with the first known class. */}
                    {!known && <option value="">未対応のクラス（{rectangle.classId}）</option>}
                    {classes.map((option) => (
                      <option key={option.id} value={option.id}>{option.displayName}</option>
                    ))}
                  </select>
                </li>
              );
            })}
          </ul>
        )}
    </section>
  );
}
