import { useEffect, useId, useRef, useState } from 'react';

import '../projects/ProjectForm.css';

export interface RightsConfirmationProps {
  projectId: string;
  savedAcknowledgedAt: string | null;
  onConfirm: (projectId: string) => Promise<{ projectId: string; acknowledgedAt: string }>;
  onCancel?: () => void;
}

const failureMessage = '確認の保存結果を確認できませんでした。チェック内容を確認して、もう一度お試しください。';

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
}

// A new project gets a new draft immediately, including for A -> B -> A.
// The parent supplies persisted facts and the real persistence callback; no bridge here.
export function RightsConfirmation(props: RightsConfirmationProps) {
  return <RightsConfirmationDraft key={props.projectId} {...props} />;
}

function RightsConfirmationDraft({ projectId, savedAcknowledgedAt, onConfirm, onCancel }: RightsConfirmationProps) {
  const id = useId();
  const [checked, setChecked] = useState(false);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [phase, setPhase] = useState<'idle' | 'pending' | 'cancelled'>('idle');
  const [error, setError] = useState('');
  const request = useRef({ active: false, busy: false, confirmed: false });

  useEffect(() => {
    // Each effect lifetime owns its replies, including StrictMode cleanup/replay.
    const generation = { active: true, busy: false, confirmed: false };
    request.current = generation;
    return () => { generation.active = false; };
  }, []);

  const acknowledgedAt = isTimestamp(savedAcknowledgedAt) ? savedAcknowledgedAt : receipt;
  const pending = phase === 'pending';
  const locked = pending || phase === 'cancelled' || acknowledgedAt !== null;

  async function confirm() {
    const generation = request.current;
    if (!generation.active || generation.busy || generation.confirmed || !checked || acknowledgedAt !== null) return;
    generation.busy = true;
    setPhase('pending'); setError('');
    try {
      const result = await onConfirm(projectId);
      if (!generation.active) return;
      if (!result || result.projectId !== projectId || !isTimestamp(result.acknowledgedAt)) {
        throw new Error('Invalid acknowledgement');
      }
      generation.confirmed = true;
      setReceipt(result.acknowledgedAt);
    } catch {
      if (!generation.active) return;
      // Keep the explicit checkbox draft; never display raw transport errors.
      setError(failureMessage);
    } finally {
      if (generation.active) {
        generation.busy = false;
        setPhase('idle');
      }
    }
  }

  function cancel() {
    if (!request.current.active || !onCancel) return;
    request.current.active = false;
    setPhase('cancelled'); setError('');
    onCancel(); // Leaving does not roll back a persistence request already sent.
  }

  return (
    <section className="project-form" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>取り込むデータの権利確認</h2>
      <p id={`${id}-description`}>
        このProjectへの初回取込前に、データを利用する権利・許諾と利用条件を確認してください。
        同梱サンプルも対象です。利用者自身の責任で確認するもので、アプリが法的な適合性を保証するものではありません。
      </p>
      <div className="project-form__types">
        <label htmlFor={`${id}-rights`}>
          <input id={`${id}-rights`} type="checkbox" checked={checked} disabled={locked}
            aria-describedby={`${id}-description`}
            onChange={(event) => setChecked(event.currentTarget.checked)} />
          データの利用権利・条件と自分の責任を確認しました
        </label>
      </div>
      <p className="project-form__status" role="status" aria-live="polite" aria-atomic="true">
        {acknowledgedAt !== null ? <>
          このProjectの確認記録は保存済みです。確認日時：<time dateTime={acknowledgedAt}>{acknowledgedAt}</time>
        </> : pending ? '確認を保存中です。キャンセルしても送信済みの処理は取り消されません。'
          : phase === 'cancelled' ? '確認画面をキャンセルしました。'
            : 'チェックだけでは保存されません。「確認を保存」を押してください。'}
      </p>
      {error && <p className="project-form__error" role="alert">{error}</p>}
      <div className="project-form__actions" aria-busy={pending}>
        <button type="button" className="project-form__primary" disabled={locked || !checked}
          onClick={() => { void confirm(); }}>確認を保存</button>
        {onCancel && <button type="button" disabled={phase === 'cancelled'} onClick={cancel}>キャンセル</button>}
      </div>
    </section>
  );
}