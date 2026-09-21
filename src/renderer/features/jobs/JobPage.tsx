import { JobDetails, isActiveJob, useJobs } from './JobStatusBar';

export function JobPage({ projectName, onBack }: { projectName: string; onBack: () => void }) {
  const jobs = useJobs();
  const queued = jobs?.snapshots.filter(({ job }) => job.status === 'Queued').length ?? 0;
  const active = jobs?.snapshots.filter(({ job }) => isActiveJob(job) && job.status !== 'Queued').length ?? 0;
  return <section className="app-shell__page" aria-labelledby="job-page-heading">
    <header className="app-shell__actions">
      <h1 id="job-page-heading">ジョブ一覧</h1>
      <button type="button" onClick={onBack}>作業画面に戻る</button>
    </header>
    <p>Project：{projectName} ／ Project ID：{jobs?.projectId ?? '未選択'}</p>
    <p>選択中のProjectのジョブを作成順に表示します。キャンセルは明示操作のみです。
      キャンセル要求後も、終了を確認するまで状態は変わらない場合があります。
      自動再開・自動再試行は行いません。</p>
    {!jobs?.projectId ? <p role="status">Project を選択してください。</p>
      : !jobs.available ? <p role="alert">ジョブ機能に接続できません。状態は未確認です。</p>
        : <>
          <p role={jobs.phase === 'failed' ? 'alert' : 'status'} aria-atomic="true">
            {jobs.phase === 'loading' ? 'ジョブを取得中'
              : jobs.phase === 'failed' ? jobs.error
                : `全${jobs.snapshots.length}件 ／ 待機中${queued}件 ／ 処理中${active}件`}
          </p>
          {jobs.phase === 'ready' && jobs.snapshots.length === 0 && <p>ジョブはありません。</p>}
          {jobs.snapshots.length > 0 && <ol aria-label="ジョブ一覧の項目">
            {jobs.snapshots.map((snapshot) => <li key={snapshot.job.id} className="app-shell__card">
              <JobDetails snapshot={snapshot} />
              <p>作成日時：<time dateTime={snapshot.job.createdAt}>{snapshot.job.createdAt}</time>{' ／ '}
                更新日時：<time dateTime={snapshot.job.updatedAt}>{snapshot.job.updatedAt}</time></p>
            </li>)}
          </ol>}
        </>}
  </section>;
}
