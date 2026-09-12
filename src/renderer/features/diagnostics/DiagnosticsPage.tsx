import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { diagnosticExportResultSchema, type DiagnosticExportResult } from '../../../shared/contracts/diagnostic-export';
import { hardwareDiagnosticsSchema, type HardwareDiagnostics } from '../../../shared/contracts/diagnostics';
import { SystemIcon } from '../../components/SystemIcon';
import './DiagnosticsPage.css';

interface DiagnosticsPageProps {
  api: { collect(): Promise<HardwareDiagnostics>; exportSummary?: () => Promise<DiagnosticExportResult> };
  onBack: () => void;
}
type Phase = 'loading' | 'ready' | 'failed';
type Readout = { report?: HardwareDiagnostics; failure?: HardwareDiagnostics; phase: Phase };
type ExportReadout = { phase: 'saving' } | { phase: 'done'; result: DiagnosticExportResult };
type Rows = readonly (readonly [string, string | number | null | undefined])[];
type InspectValue = (label: string, value: string, trigger: HTMLButtonElement) => void;
type ValueInspection = { label: string; value: string; trigger: HTMLButtonElement; previous: boolean };
const tabs = ['端末', '実行環境'] as const;
const bytes = (value: number | undefined) => value === undefined ? undefined : `${value.toLocaleString('ja-JP')} B`;
const segmenter = new Intl.Segmenter('ja', { granularity: 'grapheme' });

function renderDiagnosticValue(label: string, value: Rows[number][1], onInspect: InspectValue) {
  if (typeof value === 'string' && value !== '') {
    const needsWhitespacePreservation = value.trim() !== value || /[\t\r\n\u2028\u2029]|\s{2}/u.test(value);
    if (!needsWhitespacePreservation) {
      const segments = segmenter.segment(value)[Symbol.iterator]();
      for (let count = 0; count <= 80; count++) {
        if (segments.next().done) return value;
      }
    }
    return <button type="button" aria-haspopup="dialog" aria-label={`${label}の全文を表示`}
      onClick={(event) => onInspect(label, value, event.currentTarget)}>全文を表示</button>;
  }
  return value === '' ? '未取得' : value ?? '未取得';
}

function paginateDiagnosticValue(value: string) {
  const pages: string[] = [];
  let page = '', count = 0, lineBreaks = 0;
  for (const { segment } of segmenter.segment(value)) {
    if (count === 120 || lineBreaks === 6) {
      pages.push(page); page = ''; count = 0; lineBreaks = 0;
    }
    page += segment; count++;
    if (/[\r\n\u2028\u2029]/u.test(segment)) lineBreaks++;
  }
  if (page) pages.push(page);
  return pages;
}

function Card({ title, status, rows, onInspect }: { title: string; status?: string; rows: Rows; onInspect: InspectValue }) {
  return (
    <section className="diagnostics-page__card" aria-label={title}>
      <h2>{title}</h2>
      {status !== 'ok' && <p>{status === 'error' ? '取得できません' : '未取得'} — 再取得してください。</p>}
      <dl>{rows.map(([label, value]) => (
        <div key={label}><dt>{label}</dt><dd>{renderDiagnosticValue(label, value, onInspect)}</dd></div>
      ))}</dl>
    </section>
  );
}

function Pager({ name, page, count, onChange, controls }: {
  name: string; page: number; count: number; onChange: (page: number) => void; controls: string;
}) {
  if (count <= 1) return null;
  return (
    <nav className="diagnostics-page__pager" aria-label={`${name}のページ送り`}>
      <button type="button" aria-controls={controls} aria-label={`${name}: 前のページ`}
        disabled={page === 0} onClick={() => onChange(page - 1)}>前へ</button>
      <span>{page + 1} / {count}</span>
      <button type="button" aria-controls={controls} aria-label={`${name}: 次のページ`}
        disabled={page + 1 >= count} onClick={() => onChange(page + 1)}>次へ</button>
    </nav>
  );
}

export function diagnosticsSupport(report?: HardwareDiagnostics) {
  const os = report?.os;
  if (os?.status === 'error' && os.error.code === 'unsupported-os') return '非対応（対応対象外のOS）';
  if (os?.status !== 'ok') return '未判定';
  const facts = [
    os.data.build < 26100 ? `ビルド ${os.data.build} < 26100` : '',
    os.data.productType !== 1 ? `OS製品種別 ${os.data.productType}（クライアント以外）` : '',
    os.data.architecture.trim() !== '' && os.data.architecture !== 'AMD64'
      ? `アーキテクチャ ${os.data.architecture}（AMD64以外）` : '',
  ].filter(Boolean);
  return facts.length ? `非対応（${facts.join('、')}）` : '未判定';
}

// Reset the entire request/readout context synchronously, including A → B → A.
export function DiagnosticsPage({ api, onBack }: DiagnosticsPageProps) {
  const [context, setContext] = useState({ api, generation: 0 });
  if (context.api !== api) {
    setContext({ api, generation: context.generation + 1 });
    return null;
  }
  return <DiagnosticsSession key={context.generation} api={api} onBack={onBack} />;
}

function DiagnosticsSession({ api, onBack }: DiagnosticsPageProps) {
  const id = useId();
  const [state, setState] = useState<Readout>({ phase: 'loading' });
  const [selected, setSelected] = useState(0);
  const [focused, setFocused] = useState(0);
  const [gpuPage, setGpuPage] = useState(0);
  const [providerPage, setProviderPage] = useState(0);
  const [inspection, setInspection] = useState<ValueInspection | null>(null);
  const [valuePage, setValuePage] = useState(0);
  const valueDialog = useRef<HTMLDialogElement>(null);
  const valuePages = useMemo(() => inspection ? paginateDiagnosticValue(inspection.value) : [], [inspection]);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const alive = useRef(false);
  const request = useRef<object | null>(null);
  const exportRequest = useRef<object | null>(null);
  const [exportState, setExportState] = useState<ExportReadout | null>(null);
  const collect = useCallback(async () => {
    if (!alive.current || request.current !== null || exportRequest.current !== null) return;
    const token = {};
    request.current = token;
    setInspection(null);
    setExportState(null);
    setState((old) => ({ report: old.report, phase: 'loading' }));
    try {
      const report = hardwareDiagnosticsSchema.parse(await api.collect());
      if (!alive.current || request.current !== token) return;
      setInspection(null);
      setState((old) => report.status === 'error'
        ? { report: old.report ?? report, failure: report, phase: 'failed' }
        : { report, phase: 'ready' });
      setGpuPage(0);
      setProviderPage(0);
    } catch {
      if (alive.current && request.current === token) {
        setInspection(null);
        setState((old) => ({ report: old.report, phase: 'failed' }));
      }
    } finally {
      if (request.current === token) request.current = null;
    }
  }, [api]);
  useEffect(() => {
    alive.current = true;
    void collect();
    return () => { alive.current = false; request.current = null; exportRequest.current = null; };
  }, [collect]);

  async function exportSummary() {
    if (!alive.current || request.current || exportRequest.current || !api.exportSummary) return;
    const token = {};
    exportRequest.current = token;
    setInspection(null);
    setExportState({ phase: 'saving' });
    try {
      const result = diagnosticExportResultSchema.parse(await api.exportSummary());
      if (alive.current && exportRequest.current === token) setExportState({ phase: 'done', result });
    } catch {
      if (alive.current && exportRequest.current === token) {
        setExportState({ phase: 'done', result: { status: 'failed', code: 'DIAGNOSTIC_EXPORT_FAILED' } });
      }
    } finally { if (exportRequest.current === token) exportRequest.current = null; }
  }

  useEffect(() => {
    const dialog = valueDialog.current;
    if (!inspection || !dialog) return;
    dialog.showModal();
    return () => { if (dialog.open) dialog.close(); };
  }, [inspection]);

  function inspectValue(label: string, value: string, trigger: HTMLButtonElement) {
    setValuePage(0);
    setInspection({ label, value, trigger, previous: stale });
  }

  function tabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.nativeEvent.isComposing) return;
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault(); setSelected(index); return;
    } else return;
    event.preventDefault(); setFocused(next); tabRefs.current[next]?.focus();
  }

  const { report, phase } = state;
  const pending = phase === 'loading';
  const saving = exportState?.phase === 'saving';
  const exportResult = exportState?.phase === 'done' ? exportState.result : undefined;
  const stale = !!report && (pending || (phase === 'failed' && report !== state.failure));
  const status = pending ? '取得中' : phase === 'failed' ? '取得失敗'
    : report?.status === 'partial' ? '一部未取得' : '取得済み';
  const os = report?.os.data;
  const cpu = report?.cpu.data;
  const memory = report?.memory.data;
  const disk = report?.disk.data;
  const adapters = report?.gpu.data?.adapters ?? [];
  const runtime = report?.onnxRuntime.data;
  const providers = runtime?.providers ?? [];
  const adapter = adapters[gpuPage];
  const cuda = report?.cuda.data;
  const supportStatus = diagnosticsSupport(state.failure ?? (stale ? undefined : report));

  return (
    <section className="diagnostics-page" aria-labelledby={`${id}-heading`}>
      <header className="diagnostics-page__header">
        <h1 id={`${id}-heading`} tabIndex={-1}><SystemIcon name="settings" />端末・容量</h1>
        <button type="button" onClick={() => onBack()}><SystemIcon name="back" />戻る</button>
      </header>
      <div className="diagnostics-page__toolbar">
        <p role="status" aria-live="polite" aria-atomic="true">{status}
          {stale && (pending ? ' — 前回の結果を表示中' : ' — 前回の結果（最新ではありません）')}
          {phase === 'failed' && ' — 再取得してください。'}</p>
        <strong>対応レベル: {supportStatus.startsWith('非対応')
          ? <>非対応{renderDiagnosticValue('非対応の理由', supportStatus.slice(3), inspectValue)}</>
          : supportStatus}</strong>
        <button type="button" disabled={pending || saving} onClick={() => { void collect(); }}>再取得</button>
        <button type="button" disabled={pending || saving || !api.exportSummary}
          title={api.exportSummary ? '診断し直し、要約の内容を確認してから保存します。画像・raw logは含みません。'
            : 'この接続では診断要約の保存を利用できません。'}
          onClick={() => { void exportSummary(); }}>{api.exportSummary ? '診断要約を保存' : '要約保存：利用不可'}</button>
      </div>
      <div role="tablist" aria-label="診断の表示" className="diagnostics-page__tabs"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setFocused(selected);
        }}>
        {tabs.map((label, index) => (
          <button key={label} ref={(element) => { tabRefs.current[index] = element; }}
            type="button" role="tab" id={`${id}-tab-${index}`} aria-controls={`${id}-panel-${index}`}
            aria-selected={selected === index} tabIndex={focused === index ? 0 : -1}
            onFocus={() => setFocused(index)} onKeyDown={(event) => tabKey(event, index)}
            onClick={() => { setFocused(index); setSelected(index); }}>{label}</button>
        ))}
      </div>
      <div aria-busy={pending}>
        {exportState && <div className="diagnostics-page__export">
          <p role="status" aria-label="診断要約の保存状態" aria-live="polite" aria-atomic="true">
            {saving ? '診断要約：確認待ち・保存中（取消は確認画面で行えます）'
              : exportResult?.status === 'saved' ? '診断要約を保存しました。'
                : exportResult?.status === 'cancelled' ? '診断要約の保存をキャンセルしました。'
                  : exportResult?.status === 'failed' && exportResult.code === 'DIAGNOSTIC_EXPORT_BUSY'
                    ? '別の診断要約を確認・保存中です。完了を待ってください。'
                    : '診断要約の保存結果を確認できません。ファイルが残っている場合があります。'}
          </p>
          {exportResult?.status === 'saved' && <button type="button" aria-haspopup="dialog"
            aria-label="診断要約の保存先を表示" onClick={(event) => {
              setValuePage(0);
              setInspection({ label: '診断要約の保存先', value: exportResult.path, trigger: event.currentTarget, previous: false });
            }}>保存先を表示</button>}
        </div>}
        {stale && <p className="diagnostics-page__previous">{pending
          ? '前回の結果（再取得中）' : '前回の結果（更新失敗・最新ではありません）'}</p>}
        <div role="tabpanel" id={`${id}-panel-0`} aria-labelledby={`${id}-tab-0`}
          hidden={selected !== 0} tabIndex={0}>
          <div className="diagnostics-page__grid">
            <Card title="OS" status={report?.os.status} onInspect={inspectValue} rows={[
              ['OS', os?.name], ['バージョン', os ? `${os.major}.${os.minor} / ビルド ${os.build}` : null],
              ['製品種別', os ? (os.productType === 1 ? 'クライアント' : `サーバー（種別 ${os.productType}）`) : null],
              ['アーキテクチャ', os?.architecture],
            ]} />
            <Card title="CPU" status={report?.cpu.status} onInspect={inspectValue} rows={[
              ['名前', cpu?.name], ['論理プロセッサ数', cpu?.logicalCount],
            ]} />
            <Card title="メモリ" status={report?.memory.status} onInspect={inspectValue} rows={[
              ['合計', bytes(memory?.totalBytes)], ['利用可能', bytes(memory?.availableBytes)],
              ['使用率', memory ? `${memory.loadPercent}%` : null],
            ]} />
            <Card title="ディスク" status={report?.disk.status} onInspect={inspectValue} rows={[
              ['合計', bytes(disk?.totalBytes)], ['使用中', bytes(disk?.usedBytes)], ['空き', bytes(disk?.freeBytes)],
            ]} />
          </div>
        </div>
        <div role="tabpanel" id={`${id}-panel-1`} aria-labelledby={`${id}-tab-1`}
          hidden={selected !== 1} tabIndex={0}>
          <div className="diagnostics-page__grid">
            <section className="diagnostics-page__card" aria-label="GPU">
              <h2>GPU</h2><p>表示アダプター（現在のセッション）・計算実行は未確認</p>
              <div id={`${id}-gpu`}>
                {adapter ? <dl><div><dt>デバイス名（DeviceName）</dt><dd>{renderDiagnosticValue('デバイス名（DeviceName）', adapter.DeviceName, inspectValue)}</dd></div>
                  <div><dt>アダプター名（DeviceString）</dt><dd>{renderDiagnosticValue('アダプター名（DeviceString）', adapter.DeviceString, inspectValue)}</dd></div></dl>
                  : <p>{report?.gpu.status === 'ok' ? '表示アダプター 0 件'
                    : report?.gpu.status === 'error' ? '取得できません — 再取得してください。' : '未取得 — 再取得してください。'}</p>}
              </div>
              <Pager name="GPU" page={gpuPage} count={adapters.length} onChange={setGpuPage} controls={`${id}-gpu`} />
            </section>
            <section className="diagnostics-page__card" aria-label="ONNX Runtime">
              <h2>ONNX Runtime</h2>
              <p>{runtime ? <>バージョン {renderDiagnosticValue('バージョン', runtime.version, inspectValue)}</> : report?.onnxRuntime.status === 'error'
                ? '取得できません — 再取得してください。' : '未取得 — 再取得してください。'}</p>
              <p>実行プロバイダー・モデル実行は未確認</p>
              <ul id={`${id}-providers`} aria-label="実行プロバイダー">
                {providers.slice(providerPage * 4, providerPage * 4 + 4).map((provider, index) => <li key={index}>{renderDiagnosticValue('実行プロバイダー', provider, inspectValue)}</li>)}
              </ul>
              {runtime && providers.length === 0 && <p>実行プロバイダー 0 件</p>}
              <Pager name="実行プロバイダー" page={providerPage} count={Math.ceil(providers.length / 4)}
                onChange={setProviderPage} controls={`${id}-providers`} />
            </section>
            <Card title="CUDA（PyTorch環境のみ）" status={report?.cuda.status} onInspect={inspectValue} rows={[
              ['PyTorch', cuda?.torchVersion], ['CUDA Runtime', cuda?.runtimeVersion],
              ['ランタイムの検出', cuda ? (cuda.available ? '検出あり（実行は未確認）' : '検出なし') : null],
            ]} />
            <section className="diagnostics-page__card" aria-label="カメラ">
              <h2>カメラ</h2><p>未取得 — 推論開始時に確認します。</p>
            </section>
          </div>
        </div>
      </div>
      {inspection && <dialog ref={valueDialog} className="diagnostics-page__value-dialog"
        aria-labelledby={`${id}-value-heading`} onClose={(event) => {
          if (event.currentTarget.open) return;
          setInspection(null);
          if (inspection.trigger.isConnected) inspection.trigger.focus();
        }}>
        <h2 id={`${id}-value-heading`}>{inspection.label}</h2>
        {inspection.previous && <p>前回の結果（最新ではありません）</p>}
        <p id={`${id}-value-content`} className="diagnostics-page__full-value" tabIndex={0}>{valuePages[valuePage]}</p>
        <nav className="diagnostics-page__value-pages" aria-label="全文のページ送り">
          <button type="button" aria-controls={`${id}-value-content`} aria-label="全文: 前のページ"
            disabled={valuePage === 0} onClick={() => setValuePage(valuePage - 1)}>前へ</button>
          <span>{valuePage + 1} / {valuePages.length}</span>
          <button type="button" aria-controls={`${id}-value-content`} aria-label="全文: 次のページ"
            disabled={valuePage + 1 >= valuePages.length} onClick={() => setValuePage(valuePage + 1)}>次へ</button>
        </nav>
        <button type="button" aria-label="全文を閉じる" onClick={() => valueDialog.current?.close()}>閉じる</button>
      </dialog>}
    </section>
  );
}