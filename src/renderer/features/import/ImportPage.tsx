import { useId, useLayoutEffect, useRef, useState } from 'react';

import {
  parseImportStartResponse, parseImportPreviewResponse, parseImportCommitResponse, parseImportDiscardResponse,
  type ImportApi, type ImportPreview, type ImportResult, type ImportPreviewInput,
  type ImportSourceKind, type ImportIpcError, type ImportCommitInput,
} from '../../../shared/contracts/import-ipc';
import type { Project } from '../../../shared/contracts/project';
import { parseJobSnapshot, type JobApi, type JobSnapshot } from '../../../shared/contracts/job-ipc';
import { useJobs } from '../jobs/JobStatusBar';
import { ImportSummary, formatImportCount, validImportClassName } from './ImportSummary';
import './ImportPage.css';

export interface ImportPageProps {
  project: Project;
  api: ImportApi;
  jobs?: JobApi;
  onImported: (result: ImportResult) => void;
}

type Mode = 'copy' | 'reference';
type Phase = 'idle' | 'picking' | 'scanning' | 'preview' | 'committing' | 'uncertain' | 'completed' | 'discarding';
type Request = {
  active: boolean; phase: Phase; selection: (ImportPreviewInput & { mode: Mode }) | null;
  stopProgress: () => void;
};
const sources: ReadonlyArray<{ value: ImportSourceKind; label: string; task?: Project['taskType'] }> = [
  { value: 'folder', label: 'クラス別フォルダー', task: 'classification' },
  { value: 'csv', label: 'CSV ラベル', task: 'classification' },
  { value: 'coco', label: 'COCO アノテーション', task: 'detection' },
  { value: 'unlabeled-directory', label: 'ラベルなし・フォルダー' },
  { value: 'unlabeled-files', label: 'ラベルなし・画像ファイル' },
];
const errors = new Map<string, string>([
  ['IMPORT_INPUT', '入力内容やクラス名を確認してください。'],
  ['IMPORT_BUSY', '別の取り込み処理が実行中です。'],
  ['IMPORT_MODE', '取り込み方法を確認してください。'],
  ['IMPORT_NOT_FOUND', '検査結果が見つかりません。検査をやり直してください。'],
  ['IMPORT_SCAN_FAILED', '検査に失敗しました。元データを確認してください。'],
  ['IMPORT_SCAN_ERRORS', '検査にエラーがあります。元データを修正してください。'],
  ['IMPORT_CAPACITY', '保存先の空き容量が不足しています。空き容量を確保して再実行してください。'],
  ['IMPORT_PROJECT_CHANGED', 'プロジェクトが変更されています。状態を確認してください。'],
  ['IMPORT_ATTENTION', '取り込みの状態確認が必要です。新しく取り込まず、状態を再確認してください。'],
  ['IMPORT_OUTCOME_UNCERTAIN', '取り込み結果が不明です。新しく取り込まず、状態を再確認してください。'],
  ['INVALID_REQUEST', '入力内容を確認してください。'],
  ['STALE_SELECTION', '選択が無効になりました。検査をやり直してください。'],
  ['OPERATION_FAILED', '処理に失敗しました。状態を確認してから再実行してください。'],
]);
function errorText(error: ImportIpcError): string {
  const message = errors.get(error.code) ?? '処理に失敗しました。状態を確認してください。';
  return error.code === 'IMPORT_CAPACITY' && error.capacity
    ? `${message} 必要 ${formatImportCount(error.capacity.requiredBytes)} バイト ／ 利用可能 ${formatImportCount(error.capacity.availableBytes)} バイト`
    : message;
}
function correlation(selection: ImportPreviewInput): ImportPreviewInput {
  return { projectId: selection.projectId, jobId: selection.jobId, token: selection.token };
}

// A keyed lifetime plus an effect generation prevents A -> B -> A and StrictMode
// replay from reviving old requests. Main owns paths, confirmation and transactions.
export function ImportPage(props: ImportPageProps) {
  return <ImportSession key={JSON.stringify([props.project.id, props.project.taskType])} {...props} />;
}

function ImportSession({ project, api, jobs, onImported }: ImportPageProps) {
  const sharedJobs = useJobs();
  const id = useId();
  const [mode, setMode] = useState<Mode | null>(null);
  const [sourceKind, setSourceKind] = useState<ImportSourceKind | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());
  const [rights, setRights] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [progress, setProgress] = useState<JobSnapshot['progress']>(null);
  const request = useRef<Request>({ active: false, phase: 'idle', selection: null, stopProgress: () => {} });
  const callback = useRef(onImported);
  const commitInput = useRef<ImportCommitInput | null>(null);
  useLayoutEffect(() => { callback.current = onImported; }, [onImported]);

  async function release(selection: ImportPreviewInput): Promise<boolean> {
    const input = correlation(selection);
    try { return parseImportDiscardResponse(await api.discard(input), input).ok; }
    catch { return false; }
  }
  useLayoutEffect(() => {
    const context: Request = { active: true, phase: 'idle', selection: null, stopProgress: () => {} };
    request.current = context;
    setMode(null); setSourceKind(null); setPhase('idle'); setPreview(null); setNames(new Map());
    setRights(false); setMessage(''); setError(''); setNotice(''); setResult(null); setProgress(null);
    commitInput.current = null;
    return () => {
      const current = request.current;
      current.active = false; current.stopProgress();
      if (current.selection && !['committing', 'uncertain', 'completed', 'discarding'].includes(current.phase)) {
        void release(current.selection).then((ok) => {
          if (!ok) console.warn('取り込み検査の後処理を確認できませんでした。');
        });
      }
    };
  }, [api]);

  function changePhase(context: Request, next: Phase) {
    context.phase = next;
    if (context.active) setPhase(next);
  }
  function observe(context: Request, selection: ImportPreviewInput) {
    if (sharedJobs) return;
    if (!jobs) return;
    let stopped = false;
    let unsubscribe: (() => void) | undefined;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      try { unsubscribe?.(); } catch { console.warn('進捗通知の解除を確認できませんでした。'); }
    };
    context.stopProgress = stop;
    // JobApi owns its native listener/token. A late subscription acknowledgement
    // must still be unsubscribed even when preview already completed.
    void (async () => {
      try {
        const remove = await jobs.subscribe(selection.projectId, (snapshot) => {
          if (stopped || !context.active || context.phase !== 'scanning') return;
          try {
            const actual = parseJobSnapshot(snapshot, selection);
            if (actual.job.kind === 'scan-dataset') setProgress(actual.progress);
          } catch { /* Other jobs or malformed progress never affect this scan. */ }
        });
        if (stopped) { try { remove(); } catch { console.warn('進捗通知の解除を確認できませんでした。'); } }
        else unsubscribe = remove;
      } catch {
        if (context.active && !stopped) setNotice('進捗通知を取得できません。検査結果を待っています。');
      }
    })();
  }

  async function start() {
    const context = request.current;
    if (!context.active || context.phase !== 'idle' || !mode || !sourceKind) return;
    const input = { projectId: project.id, mode, sourceKind };
    changePhase(context, 'picking'); setRights(false); setError(''); setNotice(''); setMessage('ファイル・フォルダーを選択してください。');
    try {
      const response = parseImportStartResponse(await api.start(input), input);
      if (!response.ok) {
        if (context.active) { changePhase(context, 'idle'); setError(errorText(response.error)); setMessage(''); }
        return;
      }
      if (response.value.status === 'cancelled') {
        if (context.active) { changePhase(context, 'idle'); setMessage('選択をキャンセルしました。'); }
        return;
      }
      const selection = { projectId: input.projectId, jobId: response.value.job.id, token: response.value.token, mode };
      context.selection = selection;
      if (!context.active) {
        if (!await release(selection)) console.warn('取り込み検査の後処理を確認できませんでした。');
        return;
      }
      changePhase(context, 'scanning'); setMessage('検査中');
      // Do not wait for Succeeded: preview itself finalizes the scan in Main.
      const pending = api.preview(correlation(selection));
      observe(context, selection);
      const scanned = parseImportPreviewResponse(await pending, correlation(selection));
      if (!context.active || !['scanning'].includes(context.phase)) return;
      context.stopProgress(); setProgress(null); setNotice(''); setMessage('');
      if (!scanned.ok) { changePhase(context, 'preview'); setError(errorText(scanned.error)); return; }
      if (scanned.value.mode !== mode || scanned.value.taskType !== project.taskType) throw new Error('Invalid import context');
      setPreview(scanned.value); setNames(new Map()); setRights(false); changePhase(context, 'preview');
    } catch {
      if (context.active && ['picking', 'scanning'].includes(context.phase)) {
        context.stopProgress(); setProgress(null); setMessage('');
        changePhase(context, context.selection ? 'preview' : 'idle');
        setError('検査を完了できませんでした。元データを確認してやり直してください。');
      }
    }
  }

  async function discard() {
    const context = request.current;
    if (!context.active || !context.selection || !['scanning', 'preview'].includes(context.phase)) return;
    const selection = context.selection;
    changePhase(context, 'discarding'); context.stopProgress(); setError('');
    const ok = await release(selection);
    if (!context.active) return;
    if (!ok) { changePhase(context, 'preview'); setError('検査の破棄を確認できませんでした。もう一度破棄してください。'); return; }
    // Invalidate pending preview independently from the component generation.
    context.active = false;
    request.current = { active: true, phase: 'idle', selection: null, stopProgress: () => {} };
    setPhase('idle'); setPreview(null); setNames(new Map()); setRights(false); setProgress(null);
    setNotice(''); setMessage('検査を破棄しました。'); commitInput.current = null;
  }

  const invalidNames = preview?.classes.some((item) => !validImportClassName(names.get(item.key) ?? item.name)) ?? false;
  const blocked = preview?.issues.some((issue) => issue.severity === 'error') ?? false;
  async function commit() {
    const context = request.current;
    if (!context.active || !context.selection || !preview || !rights || blocked || invalidNames
      || !['preview', 'uncertain'].includes(context.phase)) return;
    const rechecking = context.phase === 'uncertain';
    let input = commitInput.current;
    if (context.phase !== 'uncertain' || !input) {
      input = { ...correlation(context.selection), rightsAccepted: true,
        ...(names.size ? { classNames: Object.fromEntries(preview.classes.map((item) => [item.key, names.get(item.key) ?? item.name])) } : {}),
      };
      commitInput.current = input;
    }
    changePhase(context, 'committing'); setError(''); setMessage('取り込み中です。画面を離れても処理は取り消されません。');
    let receipt: ImportResult;
    try {
      const response = parseImportCommitResponse(await api.commit(input), input);
      if (!context.active) return;
      if (!response.ok) {
        changePhase(context, rechecking || ['IMPORT_OUTCOME_UNCERTAIN', 'IMPORT_ATTENTION'].includes(response.error.code) ? 'uncertain' : 'preview');
        setError(errorText(response.error)); setMessage(''); return;
      }
      receipt = response.value;
    } catch {
      if (context.active) {
        changePhase(context, 'uncertain'); setError('取り込み結果が不明です。状態を再確認してください。'); setMessage('');
      }
      return;
    }
    changePhase(context, 'completed'); context.stopProgress(); setResult(receipt); setMessage('取り込み完了／画像は未確認です');
    // Callback failures are not transaction failures and must never enable retry.
    try { callback.current(receipt); } catch { setNotice('取り込みは完了しましたが、画面更新を確認できませんでした。'); }
  }

  const busy = ['picking', 'scanning', 'committing', 'discarding'].includes(phase);
  const frozen = phase !== 'preview';
  const actualProgress = sharedJobs
    ? sharedJobs.projectId === project.id
      ? sharedJobs.snapshots.find(({ job }) => job.id === request.current.selection?.jobId
        && job.kind === 'scan-dataset')?.progress ?? null : null
    : progress;
  return <section className="import-page" aria-labelledby={`${id}-heading`} aria-busy={busy}>
    <h1 id={`${id}-heading`}>画像を取り込む</h1>
    <p>プロジェクト：{project.name} ／ {project.taskType === 'classification' ? '画像分類' : '物体検出'}</p>
    <p>ローカルのデータを選択 → 検査 → 内容と権利を確認 → 取り込み</p>
    <fieldset disabled={phase !== 'idle'} aria-describedby={`${id}-mode-help`}>
      <legend>1. 形式と取り込み方法を選ぶ</legend>
      <fieldset><legend>データ形式（必須）</legend>
        {sources.filter((source) => !source.task || source.task === project.taskType).map((source) => <label key={source.value}>
          <input type="radio" name={`${id}-source`} checked={sourceKind === source.value} onChange={() => setSourceKind(source.value)} />{source.label}
        </label>)}
      </fieldset>
      <fieldset><legend>取り込み方法（必須）</legend>
        <label><input type="radio" name={`${id}-mode`} checked={mode === 'copy'} onChange={() => setMode('copy')} />コピー（推奨）</label>
        <label><input type="radio" name={`${id}-mode`} checked={mode === 'reference'} onChange={() => setMode('reference')} />参照</label>
      </fieldset>
      <p id={`${id}-mode-help`}>コピーは画像をプロジェクト内へ保存します。参照は元の画像を使用するため、移動・削除しないでください。方法は必ず選択してください。</p>
      <button type="button" disabled={!mode || !sourceKind} onClick={() => { void start(); }}>データを選択して検査</button>
    </fieldset>
    <p role="status" aria-atomic="true">{message}</p>
    {phase === 'scanning' && <div>
      {actualProgress && actualProgress.total !== null && actualProgress.total > 0
        ? <><progress aria-label="画像の検査進捗" value={actualProgress.processed} max={actualProgress.total} /> <span>{formatImportCount(actualProgress.processed)} / {formatImportCount(actualProgress.total)}件</span></>
        : <progress aria-label="検査中" />}
      {sharedJobs && (!sharedJobs.available || sharedJobs.phase === 'failed') &&
        <p role="alert">進捗通知を取得できません。検査結果を待っています。</p>}
    </div>}
    {error && <p role="alert">{error}</p>}
    {notice && <p role="alert">{notice}</p>}
    {preview && <ImportSummary key={preview.jobId} preview={preview} names={names} disabled={frozen}
      onNameChange={(key, value) => setNames((previous) => new Map(previous).set(key, value))} />}
    {preview && <fieldset disabled={frozen} aria-describedby={`${id}-rights-help`}>
      <legend>データの利用権利</legend>
      <p id={`${id}-rights-help`}>同梱サンプルも対象です。著作権・個人情報・利用条件を確認する責任は利用者にあります。この確認は法的な適合性を保証するものではありません。同意は取り込みと同じ処理で記録します。</p>
      <label><input type="checkbox" checked={rights} aria-describedby={`${id}-rights-help`} onChange={(event) => setRights(event.currentTarget.checked)} />データの利用権利・条件と自分の責任を確認しました</label>
    </fieldset>}
    {invalidNames && <p role="alert">クラス名には空白以外の文字を入力してください。</p>}
    {preview && <button type="button" className="import-page__primary"
      disabled={!['preview', 'uncertain'].includes(phase) || !rights || blocked || invalidNames} onClick={() => { void commit(); }}>
      {phase === 'uncertain' ? '状態を再確認' : '取り込む'}
    </button>}
    {['scanning', 'preview', 'discarding'].includes(phase) && <button type="button" disabled={phase === 'discarding'} onClick={() => { void discard(); }}>検査を破棄してやり直す</button>}
    {result && <section aria-label="結果記録"><h2>結果記録</h2><p>取り込み完了／画像は未確認です</p><p>{formatImportCount(result.itemCount)}件を取り込みました。</p>
      {result.cleanupWarning && <p role="alert">取り込みは完了しましたが、一時データの後処理に注意が必要です。取り込みを再実行しないでください。</p>}
    </section>}
  </section>;
}