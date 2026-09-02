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