import { useId } from 'react';
import type { LabelClass } from '../../../shared/contracts/annotation';
import { AnnotationInstructions } from './AnnotationInstructions';
import { ItemActions } from './ItemActions';
import { SaveStatus } from './SaveStatus';
import type { UseAnnotationDraftResult } from './useAnnotationDraft';

export interface ClassificationEditorProps {
  readonly draft: UseAnnotationDraftResult;
  readonly classes: readonly LabelClass[];
  readonly imageUrl: string;
  readonly exclusionReasons: readonly string[];
  /** Project の Label Schema の作業指示（W2-15）。読み取り専用でそのまま渡す。 */
  readonly instructions: string;
  readonly disabled?: boolean;
}

export function ClassificationEditor({
  draft, classes, imageUrl, exclusionReasons, instructions, disabled = false,
}: ClassificationEditorProps) {
  const pickerId = useId();
  const annotation = draft.draft.annotation;
  if (annotation.kind !== 'classification') {
    return <p role="alert">分類画像ではないため、分類エディターで編集できません。</p>;
  }
  const currentClass = classes.find((entry) => entry.id === annotation.classId);
  const excluded = draft.draft.state === 'excluded';

  return (
    <section aria-label="分類エディター">
      <AnnotationInstructions instructions={instructions} />
      <img src={imageUrl} alt={`分類対象：${draft.item.imageKey}`} />
      <p>現在のクラス：{currentClass?.displayName ?? (annotation.classId === null ? '未割当' : 'Schema 外')}</p>
      {classes.length === 0 && <p role="alert">Label Schema にクラスを作成してください。</p>}
      {!currentClass && (
        <p role="alert">クラスが未割当または Schema 外です。学習対象にはちょうど1クラスが必要です。確定できません。</p>
      )}
      {excluded && <p role="status">除外中：学習・評価の対象外です。</p>}
      <fieldset disabled={disabled || excluded || classes.length === 0}>
        <legend>1画像に1クラスを割り当て</legend>
        <label htmlFor={pickerId}>クラス</label>
        <select id={pickerId} required value={currentClass?.id ?? ''}
          onChange={(event) => {
            const selected = classes.find((entry) => entry.id === event.currentTarget.value);
            if (selected) draft.updateAnnotation({ kind: 'classification', classId: selected.id });
          }}>
          <option value="" disabled>クラスを選択</option>
          {classes.map((entry) => <option key={entry.id} value={entry.id}>{entry.displayName}</option>)}
        </select>
        <button type="button" disabled={annotation.classId === null}
          onClick={() => draft.updateAnnotation({ kind: 'classification', classId: null })}>
          クラスを解除
        </button>
      </fieldset>
      <ItemActions excluded={excluded} exclusionReason={draft.draft.exclusionReason}
        exclusionReasons={exclusionReasons} canUndo={draft.canUndo} canRedo={draft.canRedo}
        disabled={disabled} onExclude={draft.setExcluded} onClearExclusion={draft.clearExclusion}
        onUndo={draft.undo} onRedo={draft.redo} />
      <SaveStatus status={draft.saveStatus}
        errorMessage={draft.errorCode ? `保存できません（${draft.errorCode}）。変更内容を確認してください。` : null} />
    </section>
  );
}
