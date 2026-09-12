export interface AppRoute {
  readonly label: string;
  readonly path: string;
  readonly screenId: `UI-${string}`;
}

export const appRoutes = [
  { screenId: 'UI-01', path: '/diagnostics', label: '初回診断' },
  { screenId: 'UI-02', path: '/projects', label: 'Project 一覧' },
  {
    screenId: 'UI-03',
    path: '/project-settings',
    label: 'Project 作成・設定',
  },
  { screenId: 'UI-04', path: '/import', label: 'データ取り込み' },
  { screenId: 'UI-05', path: '/training-runs', label: 'Training Run' },
  { screenId: 'UI-06', path: '/reports', label: '結果・レポート' },
  { screenId: 'UI-07', path: '/inference', label: '推論' },
  {
    screenId: 'UI-08',
    path: '/storage-and-licenses',
    label: 'ストレージ・ライセンス',
  },
  { screenId: 'UI-09', path: '/label-schema', label: 'Label Schema' },
  { screenId: 'UI-10', path: '/annotations', label: '教師データ作成' },
  { screenId: 'UI-11', path: '/assist', label: '補助ジョブ' },
] as const satisfies readonly AppRoute[];

export type ScreenId = (typeof appRoutes)[number]['screenId'];

export type WorkflowTabId =
  | 'import'
  | 'annotations'
  | 'training'
  | 'reports'
  | 'camera';

export const workflowTabs = [
  { id: 'import', label: '取り込む', screenId: 'UI-04' },
  { id: 'annotations', label: '教師データ', screenId: 'UI-10' },
  { id: 'training', label: '学習', screenId: 'UI-05' },
  { id: 'reports', label: '結果', screenId: 'UI-06' },
  { id: 'camera', label: 'カメラで試す', screenId: 'UI-07' },
] as const satisfies readonly {
  readonly id: WorkflowTabId;
  readonly label: string;
  readonly screenId: ScreenId;
}[];

export type SettingsCategoryId =
  | 'project'
  | 'labels'
  | 'inference'
  | 'device'
  | 'information';

export const settingsCategories = [
  { id: 'project', label: 'Project' },
  { id: 'labels', label: 'ラベル定義' },
  { id: 'inference', label: '推論' },
  { id: 'device', label: '端末・容量' },
  { id: 'information', label: 'ライセンス・情報' },
] as const satisfies readonly {
  readonly id: SettingsCategoryId;
  readonly label: string;
}[];

// Primary destinations only. Later UI wiring must retain the Project-list
// diagnosis summary (UI-01), creation (UI-03), and storage/deletion under device
// (UI-08). Inference Profile is auxiliary content in settings/inference, not a
// new screen ID.
export const screenLocations: Record<
  ScreenId,
  | { section: 'projects' }
  | { section: 'workflow'; tab: WorkflowTabId }
  | { section: 'settings'; category: SettingsCategoryId }
> = {
  'UI-01': { section: 'settings', category: 'device' },
  'UI-02': { section: 'projects' },
  'UI-03': { section: 'settings', category: 'project' },
  'UI-04': { section: 'workflow', tab: 'import' },
  'UI-05': { section: 'workflow', tab: 'training' },
  'UI-06': { section: 'workflow', tab: 'reports' },
  'UI-07': { section: 'workflow', tab: 'camera' },
  'UI-08': { section: 'settings', category: 'information' },
  'UI-09': { section: 'settings', category: 'labels' },
  'UI-10': { section: 'workflow', tab: 'annotations' },
  'UI-11': { section: 'workflow', tab: 'annotations' },
};

interface EmptyRouteProps {
  route: AppRoute;
}

export function EmptyRoute({ route }: EmptyRouteProps) {
  const headingId = `${route.screenId.toLowerCase()}-heading`;

  return (
    <section aria-labelledby={headingId}>
      <h1 id={headingId}>{route.label}</h1>
    </section>
  );
}