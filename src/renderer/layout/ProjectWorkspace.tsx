import { useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { Project } from '../../shared/contracts/project';
import type { ImportApi, ImportResult } from '../../shared/contracts/import-ipc';
import type { JobApi } from '../../shared/contracts/job-ipc';
import { SystemIcon } from '../components/SystemIcon';
import { ImportPage } from '../features/import/ImportPage';
import { workflowTabs, type SettingsCategoryId, type WorkflowTabId } from '../routes';
import { WorkflowTabs } from './WorkflowTabs';

export interface ProjectWorkspaceProps {
  project: Project | null;
  visible?: boolean;
  importApi?: ImportApi | null;
  jobApi?: JobApi | null;
  onBackToProjects: () => void;
  // true only when actual settings navigation is accepted/enqueued; false for rejection/no-op.
  // Synchronous contract: exceptions propagate after this request's opener is cleared.
  onOpenSettings: (category: SettingsCategoryId, openerId: string) => boolean;
}

const settingsOpenerIds = {
  project: 'project-workspace-project-settings',
  labels: 'project-workspace-labels-settings',
  inference: 'project-workspace-inference-settings',
} as const;

const unfinishedPanels: Record<WorkflowTabId, { heading: string; description: string }> = {
  import: {
    heading: 'データ取り込み',
    description: '取り込み機能に接続できません',
  },
  annotations: {
    heading: '教師データ作成',
    description: '画像表示、分類ラベル・矩形編集、保存、人手確認・Dataset確定、補助ジョブは未実装です。未保存変更の保持・離脱時の保存確認も未実装です。',
  },
  training: {
    heading: '学習',
    description: '学習の実行・履歴・進捗表示、キャンセル・再開は未実装です。',
  },
  reports: {
    heading: '結果・レポート',
    description: 'モデル版の比較・削除と、概要／データ／評価／Trial／画像／環境／ライセンスの7レポートタブは未実装です。',
  },
  camera: {
    heading: 'カメラで試す',
    description: 'モデル・カメラ選択、用途・非保存・停止方法の説明と同意、開始・停止、映像・実測値の表示は未実装です。カメラにはアクセスしません。',
  },
};

// UIR-025: mount ONE stable instance, without a Project-ID key, even in the
// list/settings section; pass visible=false instead of unmounting it. Retain
// the same Project while visiting settings. The parent owns API response/ID
// matching and supplies current metadata; this component never fetches it.
// The UIR-025 parent must honor onOpenSettings' acceptance contract and commit
// visible=false for settings; focus return still requires an observed hide.
// Import remains mounted while hidden; the keyed section discards its session
// on Project changes. Only tab selection survives a Project switch. Other drafts and their
// save/leave guards belong to later tasks, not a speculative draft store.
export function ProjectWorkspace({
  project,
  visible = true,
  importApi,
  jobApi,
  onBackToProjects,
  onOpenSettings,
}: ProjectWorkspaceProps) {
  const [selectedTabs, setSelectedTabs] = useState(() => new Map<string, WorkflowTabId>());
  const sectionRef = useRef<HTMLElement>(null);
  const lastSettingsOpener = useRef<{
    projectId: string;
    openerId: (typeof settingsOpenerIds)[keyof typeof settingsOpenerIds];
    hidden: boolean;
    accepted: boolean;
  } | null>(null);
  const projectId = project?.id ?? null;
  const importContext = useMemo(() => ({ projectId }), [projectId, importApi]);
  const currentImport = useRef<typeof importContext | null>(null);
  const [imported, setImported] = useState<{ projectId: string; workspaceId: string; count: number; cleanupWarning: boolean } | null>(null);
  useLayoutEffect(() => {
    currentImport.current = importContext;
    setImported(null);
    return () => { currentImport.current = null; };
  }, [importContext]);
  function onImported(result: ImportResult) {
    if (currentImport.current !== importContext || result.projectId !== importContext.projectId) return;
    setImported({ projectId: result.projectId, workspaceId: result.workspaceId,
      count: result.itemCount, cleanupWarning: result.cleanupWarning });
  }

  useLayoutEffect(() => {
    const opener = lastSettingsOpener.current;
    if (!opener) return;
    // Also invalidate while hidden: A -> B -> A must not revive A's opener.
    if (opener.projectId !== projectId) {
      lastSettingsOpener.current = null;
      return;
    }
    if (!visible) {
      opener.hidden = true;
      return;
    }
    if (!opener.hidden || !opener.accepted) return;
    lastSettingsOpener.current = null;
    // Only our three fixed IDs, inside our visible section. No queued
    // focus task can outlive this Project/visibility commit.
    sectionRef.current?.querySelector<HTMLButtonElement>(`#${opener.openerId}`)?.focus();
  }, [projectId, visible]);

  if (!project) return null;

  const activeTab = selectedTabs.get(project.id) ?? 'import';

  function openSettings(category: keyof typeof settingsOpenerIds) {
    if (!visible) return;
    const openerId = settingsOpenerIds[category];
    const opener = { projectId: project!.id, openerId, hidden: false, accepted: false };
    // Provisional registration lets a synchronous hide be observed. Never
    // reassign afterward: a Project change may already have invalidated it.
    lastSettingsOpener.current = opener;
    let accepted = false;
    try {
      accepted = onOpenSettings(category, openerId) === true;
    } finally {
      if (lastSettingsOpener.current === opener) {
        // A round trip completed before acceptance cannot claim focus now
        // or on a later, unrelated hide/show.
        if (!accepted || (opener.hidden && sectionRef.current?.hidden === false)) {
          lastSettingsOpener.current = null;
        } else {
          opener.accepted = true;
        }
      }
    }
  }

  return (
    <section
      key={project.id}
      ref={sectionRef}
      hidden={!visible}
      className="app-shell__workflow"
      aria-labelledby="project-workspace-heading"
      data-project-id={project.id}
    >
      <div className="app-shell__actions">
        <h1 id="project-workspace-heading">{project.name}</h1>
        <p className="app-shell__context">
          タスク種別：{project.taskType === 'classification' ? '画像分類' : '物体検出'}
        </p>
      </div>
      <nav className="app-shell__actions" aria-label="Project の操作">
        <button id="project-workspace-back-to-projects" type="button" className="app-shell__text-link"
          onClick={() => {
            lastSettingsOpener.current = null;
            onBackToProjects();
          }}>
          <SystemIcon name="back" />
          <span>Project 一覧に戻る</span>
        </button>
        <button id={settingsOpenerIds.project} type="button" className="app-shell__text-link"
          onClick={() => openSettings('project')}>
          <SystemIcon name="settings" />
          <span>Project 設定</span>
        </button>
      </nav>
      <WorkflowTabs activeTab={activeTab} onSelect={(tab) => {
        lastSettingsOpener.current = null;
        setSelectedTabs((previous) => new Map(previous).set(project.id, tab));
      }} />
      {workflowTabs.map(({ id }) => (
        <section
          key={id}
          className="app-shell__card"
          role="tabpanel"
          id={`workflow-panel-${id}`}
          aria-labelledby={`workflow-tab-${id}`}
          tabIndex={0}
          hidden={activeTab !== id}
        >
          {id === 'import' && importApi ? <ImportPage project={project} api={importApi}
            jobs={jobApi ?? undefined} onImported={onImported} /> : activeTab === id && (
            <>
              <h2>{unfinishedPanels[id].heading}</h2>
              <p>{unfinishedPanels[id].description}</p>
              {id === 'annotations' && imported?.projectId === project.id && <div role="status">
                <p>取り込み記録：{imported.count.toLocaleString('ja-JP')}件 ／ Workspace：{imported.workspaceId}</p>
                <p>画像は未確認です。Dataset確定・学習は実行していません。</p>
                {imported.cleanupWarning && <p>一時データの後処理に注意が必要です。取り込みを再実行しないでください。</p>}
              </div>}
              {id === 'annotations' && (
                <button id={settingsOpenerIds.labels} type="button" className="app-shell__text-link"
                  onClick={() => openSettings('labels')}>
                  <SystemIcon name="settings" />
                  <span>ラベル定義</span>
                </button>
              )}
              {id === 'camera' && (
                <button id={settingsOpenerIds.inference} type="button" className="app-shell__text-link"
                  onClick={() => openSettings('inference')}>
                  <SystemIcon name="settings" />
                  <span>推論設定</span>
                </button>
              )}
            </>
          )}
          {id === 'import' && imported?.projectId === project.id && <button type="button"
            onClick={() => setSelectedTabs((previous) => new Map(previous).set(project.id, 'annotations'))}>
            教師データ作成へ
          </button>}
        </section>
      ))}
    </section>
  );
}