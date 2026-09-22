import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { APP_API_CONTRACT_VERSION, type AppApi } from '../../shared/contracts/app';
import type { AnnotationApi, LabelSchemaApi } from '../../shared/contracts/annotation-ipc';
import { diagnosticExportResultSchema, type DiagnosticExportResult } from '../../shared/contracts/diagnostic-export';
import { hardwareDiagnosticsSchema, type HardwareDiagnostics } from '../../shared/contracts/diagnostics';
import type { ImportApi } from '../../shared/contracts/import-ipc';
import type { JobApi } from '../../shared/contracts/job-ipc';
import {
  parseProjectDeletePreviewResponse, parseProjectDeleteResponse,
  projectDeleteInputSchema, projectDeletePreviewInputSchema,
  projectGetInputSchema, projectGetResponseSchema, type ProjectApi,
  type ProjectDeletePreviewDto, type ProjectDeletePreviewResponse, type ProjectDeleteResponse,
  type ProjectGetResponse, type ProjectIpcErrorCode, type ProjectSnapshot,
} from '../../shared/contracts/project-ipc';
import type { ReferenceApi } from '../../shared/contracts/reference-ipc';
import type { RevisionApi } from '../../shared/contracts/revision-ipc';
import { SystemIcon } from '../components/SystemIcon';
import { LabelSchemaPage } from '../features/annotations/LabelSchemaPage';
import { DiagnosticsPage, diagnosticsSupport } from '../features/diagnostics/DiagnosticsPage';
import { JobProvider, JobStatusBar } from '../features/jobs/JobStatusBar';
import { JobPage } from '../features/jobs/JobPage';
import { DeleteProjectDialog } from '../features/projects/DeleteProjectDialog';
import { ProjectForm } from '../features/projects/ProjectForm';
import { ProjectListPage } from '../features/projects/ProjectListPage';
import { ProjectSettingsPanel } from '../features/settings/ProjectSettingsPanel';
import { SettingsPage } from '../features/settings/SettingsPage';
import { appRoutes, type ScreenId, type SettingsCategoryId } from '../routes';
import { ProjectWorkspace } from './ProjectWorkspace';

type View = 'list' | 'create' | 'workspace' | 'jobs';
type DiagnosticReadout = { phase: 'loading' | 'ready' | 'failed'; report?: HardwareDiagnostics; failure?: HardwareDiagnostics };
type FocusTarget = { kind: 'main' } | { kind: 'settings' }
  | { kind: 'header'; id: 'app-shell-settings-link' | 'diagnostics-settings-link' }
  | { kind: 'row'; projectId: string; element: HTMLButtonElement | null };
type SettingsOrigin = { baseView: View } & (Exclude<FocusTarget, { kind: 'main' | 'settings' }> | { kind: 'workspace' });
const selectionErrors: Record<ProjectIpcErrorCode, string> = {
  INVALID_REQUEST: '選択内容を確認できません。Project を選び直してください。',
  NOT_FOUND: '対象の Project は利用できません。一覧を再取得するか、別の Project を選び直してください。',
  BUSY: 'ほかの処理が実行中です。完了後に Project を選び直してください。',
  OPERATION_FAILED: 'Project の最新情報を確認できません。一覧を再取得するか、選び直してください。',
  STALE_SELECTION: '選択が無効になりました。一覧を再取得して Project を選び直してください。',
};
// Deletion needs its own wording: reusing the selection text would hide whether
// anything was deleted. OPERATION_FAILED never proves that nothing was removed.
const deletePreviewErrors: Record<ProjectIpcErrorCode, string> = {
  INVALID_REQUEST: '削除対象を確認できません。一覧を再取得してください。',
  NOT_FOUND: '対象の Project が見つかりません。一覧を再取得してください。',
  BUSY: 'ほかの処理が実行中です。完了後に削除対象を確認してください。',
  OPERATION_FAILED: '削除対象を確認できませんでした。削除は実行していません。一覧を再取得してください。',
  STALE_SELECTION: '選択が無効になりました。一覧を再取得して選び直してください。',
};
const deleteErrors: Record<ProjectIpcErrorCode, string> = {
  INVALID_REQUEST: '削除要求を確認できません。削除は実行していません。',
  NOT_FOUND: '対象の Project が見つかりません。すでに削除されている可能性があります。一覧を再取得してください。',
  BUSY: 'ほかの処理が実行中です。削除は実行していません。完了後に再度実行してください。',
  OPERATION_FAILED: '削除の結果を確認できませんでした。削除された可能性があります。自動で再試行せず、一覧を再取得して状態を確認してください。',
  STALE_SELECTION: '選択が無効になりました。削除は実行していません。一覧を再取得してください。',
};

function screenPath(id: ScreenId) {
  return appRoutes.find((route) => route.screenId === id)!.path;
}

// Snapshot the Project capabilities of an already validated bridge independently.
// Preserve receivers and factory closures; no render-time method repicking.
function readProjects(bridge: AppApi | null): ProjectApi | null {
  try {
    const projects = bridge?.projects;
    if (!projects) return null;
    const { list, get, create, update, pickParent, move, recover, deletePreview } = projects;
    const remove = projects.delete;
    if ([list, get, create, update, pickParent, move, recover, deletePreview, remove]
      .some((method) => typeof method !== 'function')) return null;
    return Object.freeze({ list: list.bind(projects), get: get.bind(projects), create: create.bind(projects),
      update: update.bind(projects), pickParent: pickParent.bind(projects), move: move.bind(projects),
      recover: recover.bind(projects), deletePreview: deletePreview.bind(projects), delete: remove.bind(projects) });
  } catch { return null; }
}

function readImports(bridge: AppApi | null): ImportApi | null {
  try {
    const source = bridge?.imports;
    if (!source) return null;
    const { start, preview, commit, discard } = source;
    if ([start, preview, commit, discard].some((method) => typeof method !== 'function')) return null;
    return Object.freeze({ start: start.bind(source), preview: preview.bind(source),
      commit: commit.bind(source), discard: discard.bind(source) });
  } catch { return null; }
}

function readJobs(bridge: AppApi | null): JobApi | null {
  try {
    const source = bridge?.jobs;
    if (!source) return null;
    const { list, get, cancel, subscribe } = source;
    if ([list, get, cancel, subscribe].some((method) => typeof method !== 'function')) return null;
    return Object.freeze({ list: list.bind(source), get: get.bind(source),
      cancel: cancel.bind(source), subscribe: subscribe.bind(source) });
  } catch { return null; }
}

function readLabelSchemas(bridge: AppApi | null): LabelSchemaApi | null {
  try {
    const source = bridge?.labelSchemas;
    if (!source) return null;
    const { get, create, createClass, updateClass, update, deleteClass, mergeClasses } = source;
    if ([get, create, createClass, updateClass, update, deleteClass, mergeClasses].some((method) => typeof method !== 'function')) return null;
    return Object.freeze({ get: get.bind(source), create: create.bind(source), createClass: createClass.bind(source),
      updateClass: updateClass.bind(source), update: update.bind(source), deleteClass: deleteClass.bind(source),
      mergeClasses: mergeClasses.bind(source) });
  } catch { return null; }
}

function readAnnotations(bridge: AppApi | null): AnnotationApi | null {
  try {
    const source = bridge?.annotations;
    if (!source) return null;
    const { workspaces, list, get, save, confirm } = source;
    if ([workspaces, list, get, save, confirm].some((method) => typeof method !== 'function')) return null;
    return Object.freeze({ workspaces: workspaces.bind(source), list: list.bind(source), get: get.bind(source),
      save: save.bind(source), confirm: confirm.bind(source) });
  } catch { return null; }
}

function readRevisions(bridge: AppApi | null): RevisionApi | null {
  try {
    const source = bridge?.revisions;
    if (!source) return null;
    const { create, validate, confirmAndQueue, clone } = source;
    if ([create, validate, confirmAndQueue, clone].some((method) => typeof method !== 'function')) return null;
    return Object.freeze({ create: create.bind(source), validate: validate.bind(source),
      confirmAndQueue: confirmAndQueue.bind(source), clone: clone.bind(source) });
  } catch { return null; }
}

function readReferences(bridge: AppApi | null): ReferenceApi | null {
  try {
    const source = bridge?.references;
    if (!source) return null;
    const { status, relink } = source;
    if ([status, relink].some((method) => typeof method !== 'function')) return null;
    return Object.freeze({ status: status.bind(source), relink: relink.bind(source) });
  } catch { return null; }
}

export function AppShell() {
  const [api, setApi] = useState<ProjectApi | null>(null);
  const [importApi, setImportApi] = useState<ImportApi | null>(null);
  const [jobApi, setJobApi] = useState<JobApi | null>(null);
  const [labelSchemaApi, setLabelSchemaApi] = useState<LabelSchemaApi | null>(null);
  const [annotationApi, setAnnotationApi] = useState<AnnotationApi | null>(null);
  const [revisionApi, setRevisionApi] = useState<RevisionApi | null>(null);
  const [referenceApi, setReferenceApi] = useState<ReferenceApi | null>(null);
  const [diagnosticsApi, setDiagnosticsApi] = useState<AppApi['diagnostics'] | null>(null);
  const [diagnosticReadout, setDiagnosticReadout] = useState<DiagnosticReadout>({ phase: 'loading' });
  const apiContext = useRef({ initialized: false, active: false, api: null as ProjectApi | null });
  const [view, setView] = useState<View>('list');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [category, setCategory] = useState<SettingsCategoryId>('project');
  const [selected, setSelected] = useState<ProjectSnapshot | null>(null);
  const lastValidSnapshot = useRef<ProjectSnapshot | null>(null);
  const panelSnapshot = selected ?? lastValidSnapshot.current;
  const [selection, setSelection] = useState<{ projectId: string; error: ProjectIpcErrorCode | null } | null>(null);
  const [listGeneration, setListGeneration] = useState(0);
  const [leftCreation, setLeftCreation] = useState(false);
  const [focusTarget, setFocusTarget] = useState<FocusTarget | null>(null);
  const [deletion, setDeletion] = useState<{
    busy: boolean; preview: ProjectDeletePreviewDto | null; error: string; receipt: string;
  }>({ busy: false, preview: null, error: '', receipt: '' });
  const mainRef = useRef<HTMLElement>(null);
  const settingsOrigin = useRef<SettingsOrigin | null>(null);
  const pendingCreated = useRef<ProjectSnapshot | null>(null);
  const selectionGeneration = useRef(0), creationGeneration = useRef(0);
  const creationContext = creationGeneration.current;

  useLayoutEffect(() => {
    const context = apiContext.current;
    context.active = true;
    // Effect replay must not read an accessor twice; a real remount gets a new context.
    if (!context.initialized) {
      context.initialized = true;
      let bridge: AppApi | null = null;
      try {
        const candidate = window.autoVision;
        if (candidate?.contractVersion === APP_API_CONTRACT_VERSION) bridge = candidate;
      } catch { /* Neither domain may use an unvalidated bridge. */ }
      context.api = readProjects(bridge); setApi(context.api);
      setImportApi(readImports(bridge)); setJobApi(readJobs(bridge));
      setLabelSchemaApi(readLabelSchemas(bridge));
      setAnnotationApi(readAnnotations(bridge));
      setRevisionApi(readRevisions(bridge));
      setReferenceApi(readReferences(bridge));
      try {
        const source = bridge?.diagnostics, method = source?.collect;
        if (typeof method !== 'function') throw new Error();
        const collectNative = method.bind(source);
        // Optional v1 capability failures must not disable hardware collection.
        const exportNative = (() => {
          try {
            const save = source?.exportSummary;
            return typeof save === 'function' ? save.bind(source) : undefined;
          } catch { return undefined; }
        })();
        let exporting = false;
        let inFlight: Promise<HardwareDiagnostics> | null = null;
        const diagnostics: AppApi['diagnostics'] = Object.freeze({ collect() {
          if (inFlight) return inFlight;
          if (context.active) setDiagnosticReadout((old) => ({ report: old.report, phase: 'loading' }));
          // Install the guard before invoking native code, including reentrant calls.
          inFlight = Promise.resolve().then(() => {
            if (!context.active) throw new Error();
            return collectNative();
          }).then((value) => {
            const report = hardwareDiagnosticsSchema.parse(value);
            if (context.active) setDiagnosticReadout((old) => report.status === 'error'
              ? { report: old.report ?? report, failure: report, phase: 'failed' }
              : { report, phase: 'ready' });
            return report;
          }).catch(() => {
            if (context.active) setDiagnosticReadout((old) => ({ report: old.report, phase: 'failed' }));
            throw new Error('端末診断を取得できません。');
          }).finally(() => { inFlight = null; });
          return inFlight;
        }, ...(exportNative ? {
          async exportSummary(): Promise<DiagnosticExportResult> {
            if (arguments.length !== 0 || !context.active) return { status: 'failed', code: 'DIAGNOSTIC_EXPORT_FAILED' };
            if (exporting) return { status: 'failed', code: 'DIAGNOSTIC_EXPORT_BUSY' };
            exporting = true;
            try {
              const result = await exportNative();
              if (!context.active) return { status: 'failed', code: 'DIAGNOSTIC_EXPORT_FAILED' };
              return diagnosticExportResultSchema.parse(result);
            } catch { return { status: 'failed', code: 'DIAGNOSTIC_EXPORT_FAILED' }; }
            finally { exporting = false; }
          },
        } : {}) });
        setDiagnosticsApi(diagnostics);
        void diagnostics.collect().catch(() => {});
      } catch { setDiagnosticReadout({ phase: 'failed' }); }
    }
    return () => { context.active = false; selectionGeneration.current++; creationGeneration.current++; pendingCreated.current = null; };
  }, []);

  useLayoutEffect(() => {
    // A missing selected ID loses its editing entry, not the panel's retained drafts.
    if (selected) lastValidSnapshot.current = selected;
  }, [selected]);

  // Run only for navigation, not category changes, edits or metadata acknowledgements.
  useEffect(() => {
    const main = mainRef.current;
    if (!main || !focusTarget) return;
    if (focusTarget.kind !== 'row') {
      const target = focusTarget.kind === 'main' ? main : main.ownerDocument.getElementById(
        focusTarget.kind === 'settings' ? 'settings-heading' : focusTarget.id);
      target?.focus(); return;
    }
    main.focus();
    let observer: MutationObserver | null = null;
    const restoreRow = () => {
      if (main.ownerDocument.activeElement !== main) { observer?.disconnect(); return true; }
      const listPage = main.querySelector('.project-list-page');
      if (!listPage || listPage.closest('[hidden]') || !listPage.querySelector('[aria-busy="false"]')) return false;
      // The ID was canonicalized by the request schema, never an arbitrary selector/name.
      const row = listPage.querySelector(`.project-list-page__list > [data-project-id="${focusTarget.projectId}"]`);
      const target = focusTarget.element && row?.contains(focusTarget.element) ? focusTarget.element
        : row?.querySelectorAll<HTMLButtonElement>('.project-list-page__actions > button')[1];
      target?.focus(); observer?.disconnect(); return true;
    };
    if (!restoreRow()) {
      observer = new MutationObserver(restoreRow);
      observer.observe(main, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-busy', 'hidden'] });
    }
    const stopOnFocus = () => { if (main.ownerDocument.activeElement !== main) observer?.disconnect(); };
    main.ownerDocument.addEventListener('focusin', stopOnFocus);
    return () => { observer?.disconnect(); main.ownerDocument.removeEventListener('focusin', stopOnFocus); };
  }, [focusTarget]);

  function invalidateSelection() {
    selectionGeneration.current++; setSelection(null);
  }
  function showList() {
    invalidateSelection(); creationGeneration.current++; settingsOrigin.current = null;
    pendingCreated.current = null;
    setLeftCreation((previous) => previous || view === 'create');
    setView('list'); setSettingsOpen(false); setListGeneration((previous) => previous + 1);
    setFocusTarget({ kind: 'main' });
  }
  function startCreate() {
    if (!api || !apiContext.current.active || view !== 'list' || settingsOpen) return;
    invalidateSelection(); creationGeneration.current++; settingsOrigin.current = null;
    pendingCreated.current = null;
    setLeftCreation(false); setView('create'); setFocusTarget({ kind: 'main' });
  }
  function openSettings(nextCategory: SettingsCategoryId, origin: SettingsOrigin) {
    invalidateSelection();
    if (!settingsOrigin.current) {
      settingsOrigin.current = origin; setFocusTarget({ kind: 'settings' });
    }
    setCategory(nextCategory); setSettingsOpen(true);
  }
  function closeSettings() {
    invalidateSelection();
    const origin = settingsOrigin.current; settingsOrigin.current = null;
    const created = pendingCreated.current; pendingCreated.current = null;
    setSettingsOpen(false);
    if (created) { setSelected(created); setView('workspace'); }
    else if (origin) setView(origin.baseView);
    // Workspace alone owns its three accepted settings openers.
    setFocusTarget(origin?.kind === 'workspace' ? null : origin ?? { kind: 'main' });
  }
  async function selectProject(snapshot: ProjectSnapshot, destination: 'workspace' | 'settings') {
    if (!api || !apiContext.current.active || view !== 'list' || settingsOpen) return;
    const input = projectGetInputSchema.safeParse({ projectId: snapshot.project.id });
    if (!input.success) return;
    const { projectId } = input.data, ticket = ++selectionGeneration.current;
    const row = mainRef.current?.querySelector(`.project-list-page__list > [data-project-id="${projectId}"]`);
    const element = row?.querySelectorAll<HTMLButtonElement>('.project-list-page__actions > button')[1] ?? null;
    setFocusTarget(null); setSelection({ projectId, error: null });
    let response: ProjectGetResponse;
    try { response = projectGetResponseSchema.parse(await api.get(input.data)); }
    catch { response = { ok: false, error: { code: 'OPERATION_FAILED' } }; }
    if (!apiContext.current.active || apiContext.current.api !== api || selectionGeneration.current !== ticket) return;
    if (!response.ok || response.value.project.id !== projectId) {
      if (!response.ok && response.error.code === 'NOT_FOUND') {
        setSelected((current) => current?.project.id === projectId ? null : current);
      }
      setSelection({ projectId, error: response.ok ? 'OPERATION_FAILED' : response.error.code }); return;
    }
    setSelected(response.value); setSelection(null); setLeftCreation(false);
    if (destination === 'settings') openSettings('project', { baseView: 'list', kind: 'row', projectId, element });
    else { setView('workspace'); setFocusTarget({ kind: 'main' }); }
  }
  function onCreated(snapshot: ProjectSnapshot) {
    if (!api || !apiContext.current.active || apiContext.current.api !== api
      || creationGeneration.current !== creationContext || view !== 'create') return;
    creationGeneration.current++; setView('workspace'); setLeftCreation(false);
    // Unmount the terminal create form, but keep the current editing ID/draft/focus
    // until settings closes. Saving A must not overwrite this verified C snapshot.
    if (settingsOrigin.current) {
      pendingCreated.current = snapshot; settingsOrigin.current.baseView = 'workspace';
    } else { setSelected(snapshot); setFocusTarget({ kind: 'main' }); }
  }
  function onSaved(snapshot: ProjectSnapshot) {
    if (!api || !apiContext.current.active || apiContext.current.api !== api || snapshot.project.id !== selected?.project.id) return;
    setSelected((current) => current === selected ? snapshot : current);
  }

  /** CORE-10: preview only. Nothing is deleted until the dialog is confirmed. */
  async function openDeletePreview(snapshot: ProjectSnapshot) {
    if (!api || !apiContext.current.active || view !== 'list' || settingsOpen) return;
    const input = projectDeletePreviewInputSchema.safeParse({ projectId: snapshot.project.id });
    if (!input.success) return;
    setDeletion({ busy: true, preview: null, error: '', receipt: '' });
    let response: ProjectDeletePreviewResponse;
    try { response = parseProjectDeletePreviewResponse(await api.deletePreview(input.data), input.data); }
    catch { response = { ok: false, error: { code: 'OPERATION_FAILED' } }; }
    if (!apiContext.current.active || apiContext.current.api !== api) return;
    if (!response.ok) {
      setDeletion({ busy: false, preview: null, error: deletePreviewErrors[response.error.code], receipt: '' });
      return;
    }
    setDeletion({ busy: false, preview: response.value, error: '', receipt: '' });
  }

  async function runDelete() {
    const preview = deletion.preview;
    if (!api || !apiContext.current.active || !preview) return;
    const input = projectDeleteInputSchema.safeParse({ projectId: preview.projectId });
    if (!input.success) return;
    setDeletion((current) => ({ ...current, busy: true, error: '' }));
    let response: ProjectDeleteResponse;
    try { response = parseProjectDeleteResponse(await api.delete(input.data), input.data); }
    catch { response = { ok: false, error: { code: 'OPERATION_FAILED' } }; }
    if (!apiContext.current.active || apiContext.current.api !== api) return;
    if (!response.ok) {
      setDeletion((current) => ({ ...current, busy: false, error: deleteErrors[response.error.code] }));
      return;
    }
    // A retained owned path is reported, never presented as a clean deletion.
    const retained = response.value.retainedPathCount > 0
      ? `一部の所有ファイルを削除できませんでした（${response.value.retainedPathCount} 件）。`
      : '';
    setDeletion({ busy: false, preview: null, error: '',
      receipt: `Project「${preview.name}」を削除しました。参照元ファイルは削除していません。${retained}` });
    setSelected((current) => (current?.project.id === preview.projectId ? null : current));
    setSelection(null);
    setListGeneration((generation) => generation + 1);
  }

  const { report, failure, phase } = diagnosticReadout;
  const stale = !!report && (phase === 'loading' || (phase === 'failed' && report !== failure));
  const diagnosticStatus = (!diagnosticsApi && phase === 'failed' ? '利用不可（端末診断に接続できません）'
    : phase === 'loading' ? '取得中' : phase === 'failed' ? '取得失敗'
      : report?.status === 'partial' ? '一部未取得' : '取得済み')
    + (stale ? ' — 前回の結果（最新ではありません）' : '');
  const support = diagnosticsSupport(failure ?? (stale ? undefined : report));
  const freeBytes = report?.disk.data?.freeBytes;
  const capacity = `${stale ? '前回（最新ではありません）— ' : ''}アプリデータ（userData）ボリュームの空き：`
    + `${freeBytes === undefined ? '未取得' : `${freeBytes.toLocaleString('ja-JP')} B`}（Project 使用量ではありません）`;

  return (
    <JobProvider api={jobApi} projectId={selected?.project.id ?? null}>
    <div className="app-shell">
      <a className="skip-link" href="#main-content" onClick={(event) => {
        event.preventDefault();
        mainRef.current?.focus();
      }}>
        本文へ移動
      </a>
      <header className="app-shell__header">
        <span className="app-shell__brand">AutoVision Studio</span>
        <span className="app-shell__context">{selected ? `Project：${selected.project.name}` : 'Project 未選択'}</span>
        <span className="app-shell__badge">開発中</span>
        <nav aria-label="主要画面" className="app-shell__navigation">
          <ul className="app-shell__navigation-list">
            <li>
              <a
                id="app-shell-projects-link"
                className="app-shell__navigation-link"
                href={screenPath('UI-02')}
                aria-current={!settingsOpen && view === 'list' ? 'page' : undefined}
                onClick={(event) => { event.preventDefault(); showList(); }}
              >
                <SystemIcon name="projects" />
                <span>Project 一覧</span>
              </a>
            </li>
            <li>
              <a
                id="app-shell-settings-link"
                className="app-shell__navigation-link"
                href={`#settings-${category}`}
                aria-current={settingsOpen ? 'page' : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  openSettings(category, { baseView: view, kind: 'header', id: 'app-shell-settings-link' });
                }}
              >
                <SystemIcon name="settings" />
                <span>設定</span>
              </a>
            </li>
          </ul>
        </nav>
      </header>

      <main ref={mainRef} className="app-shell__main" id="main-content" tabIndex={-1}>
        {!api && <p role="alert">Project 管理に接続できません。作成・作業は利用できません。設定の情報は確認できます。</p>}
        <div hidden={view !== 'list' || settingsOpen}>
          <div className="app-shell__page">
            {leftCreation && <p role="status">作成を送信していた場合、処理は取り消されません。結果を一覧で確認してから、必要な場合だけ新しく作成してください。</p>}
            {selection && <div>
              <p role={selection.error ? 'alert' : 'status'} aria-live="polite">
                Project（{selection.projectId}）：{selection.error ? selectionErrors[selection.error] : '選択中です。最新情報を確認しています。'}
              </p>
              <button type="button" onClick={() => { invalidateSelection(); setFocusTarget({ kind: 'main' }); }}>選択をやめる</button>
              {selection.error && <button type="button" onClick={showList}>一覧を再取得</button>}
            </div>}
            {api ? <ProjectListPage api={api} visible={view === 'list' && !settingsOpen} refreshKey={listGeneration} onCreate={startCreate}
              onOpen={(snapshot) => { void selectProject(snapshot, 'workspace'); }}
              onSettings={(snapshot) => { void selectProject(snapshot, 'settings'); }}
              onDeletePreview={(snapshot) => { void openDeletePreview(snapshot); }} />
              : <section aria-labelledby="projects-heading"><h1 id="projects-heading">Project 一覧</h1>
                <button type="button" disabled>Project を作成</button></section>}
            {deletion.error && <p role="alert">{deletion.error}</p>}
            {deletion.receipt && <p role="status">{deletion.receipt}</p>}
            {deletion.preview && <DeleteProjectDialog open preview={deletion.preview} busy={deletion.busy}
              onDelete={() => { void runDelete(); }}
              onCancel={() => setDeletion({ busy: false, preview: null, error: '', receipt: '' })} />}
            <section className="app-shell__actions" aria-label="端末診断">
              <p role="status" aria-label="端末診断の状態" aria-live="polite" aria-atomic="true">{diagnosticStatus}</p>
              <span>対応レベル：{support.startsWith('非対応') ? '非対応（理由は詳細）' : support}</span>
              <span>{capacity}</span>
              <a
                id="diagnostics-settings-link"
                className="app-shell__text-link"
                href={screenPath('UI-01')}
                onClick={(event) => { event.preventDefault(); openSettings('device', { baseView: view, kind: 'header', id: 'diagnostics-settings-link' }); }}
              >
                端末・容量を確認
              </a>
              {diagnosticsApi && <button type="button" disabled={phase === 'loading'}
                onClick={() => { void diagnosticsApi.collect().catch(() => {}); }}>
                {phase === 'failed' ? '診断を再試行' : '診断を再取得'}
              </button>}
            </section>
          </div>
        </div>
        {view === 'create' && api && <div hidden={settingsOpen}>
          <p className="app-shell__note">一覧へ戻ると入力を閉じます。送信済みの作成処理は取り消されません。結果は一覧で確認してください。</p>
          <ProjectForm api={api} onCreated={onCreated} onCancel={showList} />
        </div>}
        <ProjectWorkspace project={selected?.project ?? null} visible={Boolean(api) && view === 'workspace' && !settingsOpen}
          importApi={importApi} jobApi={jobApi}
          annotationApi={annotationApi} labelSchemaApi={labelSchemaApi} revisionApi={revisionApi}
          referenceApi={referenceApi}
          onBackToProjects={showList} onOpenSettings={(nextCategory) => {
            if (!api || !selected || view !== 'workspace' || settingsOpen) return false;
            openSettings(nextCategory, { baseView: 'workspace', kind: 'workspace' }); return true;
          }} />
        {view === 'jobs' && !settingsOpen && selected && <JobPage projectName={selected.project.name}
          onBack={() => { setView('workspace'); setFocusTarget({ kind: 'main' }); }} />}
        <SettingsPage category={category} onCategoryChange={setCategory} onBack={closeSettings}
          visible={settingsOpen} hasProject={selected !== null}
          renderProject={(visible) => api && panelSnapshot
            ? <ProjectSettingsPanel api={api} snapshot={panelSnapshot} visible={visible} onSaved={onSaved} onBack={closeSettings} /> : null}
          renderLabels={(visible) => labelSchemaApi && selected
            ? <LabelSchemaPage project={selected.project} api={labelSchemaApi} visible={visible} onBack={closeSettings} /> : null}
          renderDevice={() => diagnosticsApi ? <DiagnosticsPage api={diagnosticsApi} onBack={closeSettings} />
            : <section className="diagnostics-page" aria-labelledby="diagnostics-unavailable-heading">
              <header className="diagnostics-page__header">
                <h1 id="diagnostics-unavailable-heading" tabIndex={-1}><SystemIcon name="settings" />端末・容量</h1>
                <button type="button" onClick={closeSettings}><SystemIcon name="back" />戻る</button>
              </header>
              <p role="alert">端末診断に接続できません。この画面では診断を取得できません。</p>
            </section>} />
      </main>

      <footer className="app-shell__footer" aria-label="共通状態">
        <JobStatusBar onOpenJobs={() => {
          if (!selected) return;
          invalidateSelection(); creationGeneration.current++; pendingCreated.current = null;
          setLeftCreation((previous) => previous || view === 'create');
          settingsOrigin.current = null; setSettingsOpen(false);
          setView('jobs'); setFocusTarget({ kind: 'main' });
        }} />
        <span>診断：{diagnosticStatus}</span>
        <span>デバイス：計算実行未確認</span>
        <span>容量：{capacity}</span>
      </footer>
    </div>
    </JobProvider>
  );
}