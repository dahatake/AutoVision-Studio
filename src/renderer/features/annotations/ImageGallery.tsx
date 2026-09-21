import { useMemo, useRef, useState } from 'react';
import type { AnnotationItem, AnnotationState } from '../../../shared/contracts/annotation';

export interface ImageGalleryProps {
  items: readonly AnnotationItem[];
  selectedId: string | null;
  onSelect: (item: AnnotationItem) => void;
  /** Caller owns URL construction (av-image scheme, project/workspace scoping);
   * this component stays a pure list/filter/keyboard-navigation presenter. */
  thumbnailUrl: (item: AnnotationItem) => string;
}

type Filter = 'all' | 'unstarted' | 'editing' | 'confirmed' | 'excluded';
const filters: readonly { id: Filter; label: string }[] = [
  { id: 'all', label: 'すべて' },
  { id: 'unstarted', label: '未着手' },
  { id: 'editing', label: '編集中' },
  { id: 'confirmed', label: '確認済み' },
  { id: 'excluded', label: '除外' },
];
const stateLabels: Record<AnnotationState, string> = {
  unstarted: '未着手', suggested: '未着手（提案あり）', editing: '編集中', confirmed: '確認済み', excluded: '除外',
};
function matches(filter: Filter, state: AnnotationState): boolean {
  if (filter === 'all') return true;
  if (filter === 'unstarted') return state === 'unstarted' || state === 'suggested';
  return state === filter;
}

/** W2-03: gallery list with a state filter and keyboard-operable previous/next
 * navigation. Hidden-by-filter items remain counted (never silently dropped
 * from the visible total), matching the DoD's "表示外件数を隠さない" bound. */
export function ImageGallery({ items, selectedId, onSelect, thumbnailUrl }: ImageGalleryProps) {
  const [filter, setFilter] = useState<Filter>('all');
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const visible = useMemo(() => items.filter((item) => matches(filter, item.state)), [items, filter]);
  const hiddenCount = items.length - visible.length;

  function move(offset: 1 | -1) {
    if (visible.length === 0) return;
    const current = visible.findIndex((item) => item.id === selectedId);
    const next = current === -1 ? (offset === 1 ? 0 : visible.length - 1)
      : Math.min(visible.length - 1, Math.max(0, current + offset));
    const target = visible[next]!;
    onSelect(target);
    buttons.current.get(target.id)?.focus();
  }

  return (
    <section aria-label="画像一覧・絞り込み">
      <fieldset>
        <legend>状態で絞り込み</legend>
        {filters.map(({ id, label }) => (
          <label key={id}>
            <input type="radio" name="image-gallery-filter" value={id} checked={filter === id}
              onChange={() => setFilter(id)} />
            {label}
          </label>
        ))}
      </fieldset>
      <p role="status">
        表示 {visible.length.toLocaleString('ja-JP')}件 ／ 全 {items.length.toLocaleString('ja-JP')}件
        {hiddenCount > 0 && `（絞り込みで非表示 ${hiddenCount.toLocaleString('ja-JP')}件）`}
      </p>
      <div role="list" aria-label="画像一覧"
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight' || event.key === 'ArrowDown') { event.preventDefault(); move(1); }
          else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') { event.preventDefault(); move(-1); }
        }}
      >
        {visible.map((item) => (
          <button key={item.id} type="button" role="listitem"
            ref={(element) => { if (element) buttons.current.set(item.id, element); else buttons.current.delete(item.id); }}
            aria-current={item.id === selectedId ? 'true' : undefined}
            onClick={() => onSelect(item)}
          >
            <img src={thumbnailUrl(item)} alt={`${stateLabels[item.state]}：${item.imageKey}`} />
            <span>{stateLabels[item.state]}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
