import { useEffect, useRef, useState } from 'react';
import type { Project } from '../../../shared/contracts/project';
import type { AnnotationItem, AnnotationState, AnnotationWorkspace } from '../../../shared/contracts/annotation';
import * as c from '../../../shared/contracts/annotation-ipc';

export interface AnnotationPageProps {
  project: Project;
  api: c.AnnotationApi;
  visible?: boolean;
}

const messages: Record<c.AnnotationIpcErrorCode, string> = {
  INVALID_REQUEST: '入力内容を確認できません。Project を選び直してください。',
  NOT_FOUND: '対象の Workspace が見つかりません。取り込みを確認してください。',
  CONFLICT: '他の変更と競合しました。再読込してください。',
  LOCKED: 'この Workspace は変更できません。',
  CLASS_USED: 'クラスが使用中です。',
  HISTORY_REFERENCE: '履歴から参照されているため変更できません。',
  BUSY: '別の処理中です。完了を待ってから再度操作してください。',
  OPERATION_FAILED: '一覧を取得できません。再読込してください。',
};
const stateLabels: Record<AnnotationState, string> = {
  unstarted: '未着手', suggested: '未着手（提案あり）', editing: '編集中', confirmed: '確認済み', excluded: '除外',
};

/** Skeleton list only (W2-02): fetches the current workspace's item list
 * through the existing `annotations` IPC and renders count/state, honestly
 * reporting fetch failures. Editing, gallery navigation and filters are later
 * Wave 2A/2B leaves, not this component's scope. */
export function AnnotationPage(props: AnnotationPageProps) {
  const [scope, setScope] = useState({ projectId: String(props.project.id), api: props.api, generation: 0 });
  if (scope.projectId !== String(props.project.id) || scope.api !== props.api) {
    setScope({ projectId: String(props.project.id), api: props.api, generation: scope.generation + 1 });
    return null;
  }
  return <AnnotationList key={scope.generation} {...props} />;
}

function AnnotationList({ project, api, visible = true }: AnnotationPageProps) {
  const [workspace, setWorkspace] = useState<AnnotationWorkspace | null>(null);
  const [items, setItems] = useState<readonly AnnotationItem[]>([]);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('未読込');
  const requested = useRef(false);
  const mutex = useRef(false);
  const session = useRef({ active: false });

  useEffect(() => {
    const current = { active: true };
    session.current = current;
    return () => { current.active = false; requested.current = false; mutex.current = false; };
  }, []);
  useEffect(() => {
    if (visible && !requested.current) void load();
    // Only the first visibility loads automatically; refresh is an explicit command.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  function fail(code: c.AnnotationIpcErrorCode) {
    // Never leave a stale workspace/list rendered under a failure message:
    // a failed reload must not be mistaken for still-current content.
    setWorkspace(null); setItems([]); setTotal(0);
    setMessage(messages[code]);
  }

  async function load() {
    if (mutex.current) return;
    mutex.current = true; requested.current = true; setBusy(true); setMessage('読込中');
    const current = session.current;
    try {
      const workspacesRequest = c.annotationWorkspacesInputSchema.parse({ projectId: project.id });
      const workspacesResponse = c.parseAnnotationWorkspacesResponse(await api.workspaces(workspacesRequest), workspacesRequest);
      if (!current.active) return;
      if (!workspacesResponse.ok) { fail(workspacesResponse.error.code); return; }
      const available = workspacesResponse.value;
      if (available.length === 0) {
        setWorkspace(null); setItems([]); setTotal(0);
        setMessage('取り込み済みの Workspace がありません。先にデータ取り込みを行ってください。');
        return;
      }
      const latest = available.reduce((best, candidate) => candidate.createdAt > best.createdAt ? candidate : best);
      const listRequest = c.annotationListInputSchema.parse({ projectId: project.id, workspaceId: latest.id, offset: 0, limit: 200 });
      const listResponse = c.parseAnnotationListResponse(await api.list(listRequest), listRequest);
      if (!current.active) return;
      if (!listResponse.ok) { fail(listResponse.error.code); return; }
      setWorkspace(latest); setItems(listResponse.value.items); setTotal(listResponse.value.total);
      setMessage(listResponse.value.total === 0 ? '対象画像がありません。' : '読込済み');
    } catch { if (current.active) fail('OPERATION_FAILED'); }
    finally { mutex.current = false; if (current.active) setBusy(false); }
  }

  return (
    <section aria-labelledby="annotations-page-heading">
      <h1 id="annotations-page-heading">教師データ作成</h1>
      <p role="status">{message}</p>
      {workspace && (
        <>
          <p>
            件数：{total.toLocaleString('ja-JP')}件（表示中 {items.length.toLocaleString('ja-JP')}件）
          </p>
          <ul aria-label="画像一覧">
            {items.map((item) => (
              <li key={item.id}>
                <span>{item.imageKey}</span>
                <span>{stateLabels[item.state]}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <button type="button" onClick={() => void load()} disabled={busy}>再読込</button>
    </section>
  );
}
