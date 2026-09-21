import { act, render, screen } from '@testing-library/react';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { projectSchema, type Project } from '../../../shared/contracts/project';
import { annotationItemSchema, annotationWorkspaceSchema } from '../../../shared/contracts/annotation';
import * as c from '../../../shared/contracts/annotation-ipc';
import { AnnotationPage, type AnnotationPageProps } from './AnnotationPage';

const projectId = '11111111-1111-4111-8111-111111111111';
const workspaceId = '22222222-2222-4222-8222-222222222222';
const schemaId = '33333333-3333-4333-8333-333333333333';
const importId = '44444444-4444-4444-8444-444444444444';
const itemA = '55555555-5555-4555-8555-555555555555';
const itemB = '66666666-6666-4666-8666-666666666666';
const at = '2026-09-13T00:00:00.000Z';
const later = '2026-09-14T00:00:00.000Z';
const sha = 'a'.repeat(64);
const project = projectSchema.parse({ id: projectId, name: '検証Project', description: '', taskType: 'classification',
  workspacePath: 'C:\\unused', createdAt: at, updatedAt: at });

function workspace(overrides: Partial<Parameters<typeof annotationWorkspaceSchema.parse>[0]> = {}) {
  return annotationWorkspaceSchema.parse({ id: workspaceId, projectId, schemaId, taskType: 'classification',
    mode: 'copy', state: 'editing', editVersion: 0, createdAt: at, updatedAt: at, ...overrides });
}
function item(id: string, state: 'unstarted' | 'confirmed' = 'unstarted') {
  return annotationItemSchema.parse({ id, workspaceId, importId, imageKey: `image:${id}`, imageSha256: sha,
    width: 10, height: 10, annotation: { kind: 'classification', classId: null }, annotationSha256: sha,
    state, negativeConfirmed: false, exclusionReason: null, editVersion: 0,
    confirmedAt: state === 'confirmed' ? at : null, updatedAt: at });
}
function ports() {
  return {
    workspaces: vi.fn<c.AnnotationApi['workspaces']>().mockResolvedValue(
      c.annotationWorkspacesResponseSchema.parse({ ok: true, value: [workspace()] })),
    list: vi.fn<c.AnnotationApi['list']>().mockResolvedValue(
      c.annotationListResponseSchema.parse({ ok: true, value: { items: [item(itemA)], total: 1 } })),
    get: vi.fn<c.AnnotationApi['get']>(), save: vi.fn<c.AnnotationApi['save']>(), confirm: vi.fn<c.AnnotationApi['confirm']>(),
  };
}
async function mount(api = ports(), visible = true) {
  const view = render(<AnnotationPage project={project} api={api} visible={visible} />);
  await act(async () => {});
  return { ...view, api };
}

describe('AnnotationPage standalone skeleton W2-02', () => {
  it('has exact props and shows the workspace item count on first visibility', async () => {
    expectTypeOf<AnnotationPageProps>().toEqualTypeOf<{ project: Project; api: c.AnnotationApi; visible?: boolean }>();
    const h = await mount();
    expect(h.api.workspaces).toHaveBeenCalledExactlyOnceWith({ projectId });
    expect(h.api.list).toHaveBeenCalledExactlyOnceWith({ projectId, workspaceId, offset: 0, limit: 200 });
    expect(screen.getByText('件数：1件（表示中 1件）')).toBeVisible();
    expect(screen.getByText('image:55555555-5555-4555-8555-555555555555')).toBeVisible();
    expect(screen.getByText('未着手')).toBeVisible();
  });

  it('does not fetch while hidden and stays an actual list, not a bare heading', async () => {
    const h = await mount(ports(), false);
    expect(h.api.workspaces).not.toHaveBeenCalled();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '教師データ作成' })).toBeVisible();
  });

  it('selects the most recently created workspace and reports zero-item counts honestly', async () => {
    const api = ports();
    api.workspaces.mockResolvedValueOnce(c.annotationWorkspacesResponseSchema.parse({ ok: true, value: [
      workspace({ id: workspaceId, createdAt: at, updatedAt: at }),
      workspace({ id: '77777777-7777-4777-8777-777777777777', createdAt: later, updatedAt: later }),
    ] }));
    api.list.mockResolvedValueOnce(c.annotationListResponseSchema.parse({ ok: true, value: { items: [], total: 0 } }));
    const h = await mount(api);
    expect(h.api.list.mock.calls[0]![0]).toEqual({ projectId, workspaceId: '77777777-7777-4777-8777-777777777777', offset: 0, limit: 200 });
    expect(screen.getByText('対象画像がありません。')).toBeVisible();
  });

  it('reports an honest message when no workspace exists yet, without inventing a count', async () => {
    const api = ports();
    api.workspaces.mockResolvedValueOnce(c.annotationWorkspacesResponseSchema.parse({ ok: true, value: [] }));
    const h = await mount(api);
    expect(h.api.list).not.toHaveBeenCalled();
    expect(screen.getByText('取り込み済みの Workspace がありません。先にデータ取り込みを行ってください。')).toBeVisible();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('shows a readable error and keeps the retry path when workspaces fetch fails', async () => {
    const api = ports();
    api.workspaces.mockResolvedValueOnce(c.annotationWorkspacesResponseSchema.parse({ ok: false, error: { code: 'OPERATION_FAILED' } }));
    const h = await mount(api);
    expect(screen.getByRole('status')).toHaveTextContent('一覧を取得できません。再読込してください。');
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    api.workspaces.mockResolvedValueOnce(c.annotationWorkspacesResponseSchema.parse({ ok: true, value: [workspace()] }));
    await act(async () => { screen.getByRole('button', { name: '再読込' }).click(); });
    expect(h.api.workspaces).toHaveBeenCalledTimes(2);
    expect(screen.getByText('件数：1件（表示中 1件）')).toBeVisible();
  });

  it('shows a readable error when the item list fetch fails after a workspace is found', async () => {
    const api = ports();
    api.list.mockResolvedValueOnce(c.annotationListResponseSchema.parse({ ok: false, error: { code: 'NOT_FOUND' } }));
    await mount(api);
    expect(screen.getByRole('status')).toHaveTextContent('対象の Workspace が見つかりません。取り込みを確認してください。');
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('clears a previously loaded list instead of showing it as stale after a failed reload', async () => {
    const api = ports();
    const h = await mount(api);
    expect(screen.getByText('件数：1件（表示中 1件）')).toBeVisible();
    api.workspaces.mockResolvedValueOnce(c.annotationWorkspacesResponseSchema.parse({ ok: false, error: { code: 'CONFLICT' } }));
    await act(async () => { screen.getByRole('button', { name: '再読込' }).click(); });
    expect(h.api.workspaces).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('status')).toHaveTextContent('他の変更と競合しました。再読込してください。');
    expect(screen.queryByText('件数：1件（表示中 1件）')).not.toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('reports a failure message when the API throws instead of resolving', async () => {
    const api = ports();
    api.workspaces.mockRejectedValueOnce(new Error('network down'));
    await mount(api);
    expect(screen.getByRole('status')).toHaveTextContent('一覧を取得できません。再読込してください。');
  });

  it('resets its session and reloads once when the Project identity changes', async () => {
    const api = ports();
    const view = render(<AnnotationPage project={project} api={api} visible />);
    await act(async () => {});
    const nextProject = projectSchema.parse({ ...project, id: '88888888-8888-4888-8888-888888888888' });
    const nextApi = ports();
    view.rerender(<AnnotationPage project={nextProject} api={nextApi} visible />);
    await act(async () => {});
    expect(nextApi.workspaces).toHaveBeenCalledExactlyOnceWith({ projectId: nextProject.id });
  });
});
