import { useId, useRef, useState } from 'react';
import { normalizeLabelClassName, type LabelClass } from '../../../shared/contracts/annotation';
import { useRecentLabels } from './useRecentLabels';

export interface LabelPickerProps {
  readonly schemaId: string;
  readonly classes: readonly LabelClass[];
  readonly selectedClassId: string | null;
  readonly onSelect: (classId: string) => void;
  readonly disabled?: boolean;
}

export function LabelPicker({ schemaId, classes, selectedClassId, onSelect, disabled = false }: LabelPickerProps) {
  const searchId = useId();
  const helpId = useId();
  const [search, setSearch] = useState({ schemaId, text: '' });
  const composing = useRef(false);
  if (search.schemaId !== schemaId) {
    setSearch({ schemaId, text: '' });
    composing.current = false;
  }
  const query = normalizeLabelClassName(search.schemaId === schemaId ? search.text : '');
  const available = classes.filter((entry) => entry.schemaId === schemaId)
    .toSorted((a, b) => a.ordinal - b.ordinal);
  const matches = (entry: LabelClass) => normalizeLabelClassName(entry.displayName).includes(query)
    || (entry.modelAlias !== null && normalizeLabelClassName(entry.modelAlias).includes(query));
  const filtered = available.filter(matches);
  const { recentLabels, remember } = useRecentLabels(schemaId, available);

  function select(classId: string) {
    if (disabled) return;
    onSelect(classId);
    remember(classId);
  }

  return (
    <section aria-label="ラベル選択" tabIndex={disabled ? -1 : 0} aria-describedby={helpId}
      onCompositionStartCapture={() => { composing.current = true; }}
      onCompositionEndCapture={() => { composing.current = false; }}
      onKeyDown={(event) => {
        if (disabled || composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229
          || event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
        if (event.target instanceof Element && event.target.closest(
          'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"]',
        )) return;
        if (!/^[1-9]$/u.test(event.key)) return;
        const entry = filtered[Number(event.key) - 1];
        if (entry) { event.preventDefault(); select(entry.id); }
      }}>
      <p id={helpId}>ラベル選択にフォーカスして1〜9キーで割り当て。文字入力・IME変換中は無効です。</p>
      <fieldset disabled={disabled}>
        <legend>クラスを選択</legend>
        <label htmlFor={searchId}>ラベル検索</label>
        <input id={searchId} type="search" value={search.schemaId === schemaId ? search.text : ''}
          onChange={(event) => setSearch({ schemaId, text: event.currentTarget.value })} />
        <section aria-label="最近使ったラベル">
          <h3>最近使ったラベル</h3>
          {recentLabels.filter(matches).length === 0 && <p>最近使ったラベルはありません。</p>}
          {recentLabels.filter(matches).map((entry) => (
            <button key={entry.id} type="button" aria-pressed={selectedClassId === entry.id}
              onClick={() => select(entry.id)}>{entry.displayName}</button>
          ))}
        </section>
        <section aria-label="検索結果">
          <p role="status">{filtered.length}件のラベル</p>
          {available.length === 0 && <p>Label Schema にクラスを作成してください。</p>}
          {available.length > 0 && filtered.length === 0 && <p>一致するラベルがありません。</p>}
          {filtered.map((entry, index) => (
            <button key={entry.id} type="button" aria-pressed={selectedClassId === entry.id}
              onClick={() => select(entry.id)}>
              {index < 9 ? `${index + 1}: ` : ''}{entry.displayName}
            </button>
          ))}
        </section>
      </fieldset>
    </section>
  );
}
