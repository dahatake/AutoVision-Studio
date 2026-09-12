import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { flushSync } from 'react-dom';
import { describe, expect, it, vi } from 'vitest';

import { APP_BRIDGE_KEY } from '../../shared/contracts/app';
import { projectSchema, type Project } from '../../shared/contracts/project';
import type { ImportApi, ImportPreview, ImportPreviewResponse, ImportCommitResponse } from '../../shared/contracts/import-ipc';
import { workflowTabs, type SettingsCategoryId } from '../routes';
import { ProjectWorkspace } from './ProjectWorkspace';

const projectA: Project = Object.freeze({
  id: '11111111-1111-4111-8111-111111111111',
  name: '分類 Project',
  description: 'テスト用の分類 Project',
  taskType: 'classification',
  workspacePath: 'C:\\Projects\\11111111-1111-4111-8111-111111111111',
  createdAt: '2026-09-12T00:00:00.000Z',
  updatedAt: '2026-09-12T00:00:00.000Z',
});
const projectB: Project = Object.freeze({
  ...projectA,
  id: '22222222-2222-4222-8222-222222222222',
  name: '検出 Project',
  description: 'テスト用の検出 Project',
  taskType: 'detection',
  workspacePath: 'C:\\Projects\\22222222-2222-4222-8222-222222222222',
});

function setup(project: Project | null = projectA, visible?: boolean) {
  const onBackToProjects = vi.fn();
  const onOpenSettings = vi.fn<(category: SettingsCategoryId, openerId: string) => boolean>()
    .mockReturnValue(true);
  const view = (current: Project | null, shown?: boolean) => (
    <>
      <button type="button">外部の操作</button>
      <ProjectWorkspace project={current} visible={shown}
        onBackToProjects={onBackToProjects} onOpenSettings={onOpenSettings} />
    </>
  );
  const result = render(view(project, visible));
  return {
    ...result,
    onBackToProjects,
    onOpenSettings,
    show: (current: Project | null, shown?: boolean) => result.rerender(view(current, shown)),
  };
}

function expectNoWorkspace() {
  expect(screen.queryByRole('navigation', { name: 'Project の操作' })).toBeNull();
  expect(screen.queryByRole('tablist')).toBeNull();
  expect(screen.queryByRole('tabpanel')).toBeNull();
  const heading = document.getElementById('project-workspace-heading');
  if (heading) expect(heading).not.toBeVisible();
  else expect(heading).toBeNull();
}

describe('ProjectWorkspace UIR-026 import lifetime', () => {
  const token = '33333333-3333-4333-8333-333333333333';
  const scanned: ImportPreview = { projectId: projectA.id, jobId: token, mode: 'copy', taskType: 'classification',
    itemCount: 1, sourceBytes: '10', classes: [], issues: [], files: [{ key: 'image-1', displayName: 'old.png' }] };
  it.each(['preview', 'commit'] as const)('ignores an old %s across A-B-A, preserving only the selected tab', async (phase) => {
    let finishPreview!: (value: ImportPreviewResponse) => void;
    let finishCommit!: (value: ImportCommitResponse) => void;
    const pendingPreview = new Promise<ImportPreviewResponse>((resolve) => { finishPreview = resolve; });
    const pendingCommit = new Promise<ImportCommitResponse>((resolve) => { finishCommit = resolve; });
    const api: ImportApi = {
      start: vi.fn<ImportApi['start']>().mockResolvedValue({ ok: true, value: { status: 'started', token,
        job: { id: token, projectId: projectA.id, kind: 'scan-dataset', status: 'Running',
          createdAt: projectA.createdAt, updatedAt: projectA.updatedAt } } }),
      preview: vi.fn<ImportApi['preview']>().mockReturnValue(phase === 'preview' ? pendingPreview : Promise.resolve({ ok: true, value: scanned })),
      commit: vi.fn<ImportApi['commit']>().mockReturnValue(pendingCommit),
      discard: vi.fn<ImportApi['discard']>().mockResolvedValue({ ok: true, value: null }),
    };
    const view = (project: Project, visible = true) => <ProjectWorkspace project={project} visible={visible}
      importApi={api} onBackToProjects={vi.fn()} onOpenSettings={() => true} />;
    const h = render(view(projectA)); const user = userEvent.setup();
    fireEvent.click(screen.getByRole('radio', { name: 'コピー（推奨）' }));
    fireEvent.click(screen.getByRole('radio', { name: 'クラス別フォルダー' }));
    await user.click(screen.getByRole('button', { name: 'データを選択して検査' }));
    const original = screen.getByRole('region', { name: '画像を取り込む' });
    h.rerender(view(projectA, false)); expect(original).not.toBeVisible(); expect(api.discard).not.toHaveBeenCalled();
    h.rerender(view(projectA)); expect(screen.getByRole('region', { name: '画像を取り込む' })).toBe(original);
    if (phase === 'commit') {
      await user.click(screen.getByRole('checkbox')); await user.click(screen.getByRole('button', { name: '取り込む' }));
    }
    await user.click(screen.getByRole('tab', { name: '教師データ' }));
    h.rerender(view(projectB)); h.rerender(view(projectA));
    expect(original).not.toBeInTheDocument();
    await act(async () => {
      finishPreview({ ok: true, value: scanned });
      finishCommit({ ok: true, value: { status: 'completed', projectId: projectA.id, importId: token,
        workspaceId: token, itemCount: 1, cleanupWarning: false } });
    });
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('教師データ');
    expect(screen.getByRole('tabpanel')).not.toHaveTextContent(token);
    await user.click(screen.getByRole('tab', { name: '取り込む' }));
    expect(screen.queryByRole('checkbox')).toBeNull(); expect(screen.queryByText('old.png')).toBeNull();
    if (phase === 'preview') expect(api.discard).toHaveBeenCalledExactlyOnceWith({ projectId: projectA.id, jobId: token, token });
    else expect(api.discard).not.toHaveBeenCalled();
  });
});

describe('ProjectWorkspace (UIR-020)', () => {
  it('uses complete Project fixtures with valid literal UUIDs', () => {
    expect(projectSchema.parse(projectA)).toEqual(projectA);
    expect(projectSchema.parse(projectB)).toEqual(projectB);
  });

  it('renders nothing without a Project and does not invent a preview or invoke callbacks', () => {
    const { show, onBackToProjects, onOpenSettings } = setup(null);
    expectNoWorkspace();
    const outside = screen.getByRole('button', { name: '外部の操作' });
    act(() => outside.focus());
    show(projectA, false);
    expectNoWorkspace();
    expect(outside).toHaveFocus();
    expect(onBackToProjects).not.toHaveBeenCalled();
    expect(onOpenSettings).not.toHaveBeenCalled();
  });

  it('defaults to visible import with live Project metadata and explicit navigation', () => {
    const { onBackToProjects, onOpenSettings } = setup();
    const workspace = screen.getByRole('region', { name: projectA.name });
    expect(workspace).toHaveAttribute('data-project-id', projectA.id);
    expect(screen.getByRole('heading', { level: 1, name: projectA.name })).toBeVisible();
    expect(screen.getByText('タスク種別：画像分類')).toBeVisible();
    expect(screen.getByRole('tab', { name: '取り込む', selected: true })).toBeVisible();
    const navigation = screen.getByRole('navigation', { name: 'Project の操作' });
    expect(within(navigation).getAllByRole('button').map((button) => button.textContent))
      .toEqual(['Project 一覧に戻る', 'Project 設定']);
    for (const button of within(navigation).getAllByRole('button')) {
      expect(button).toHaveAttribute('type', 'button');
      expect(button).toHaveClass('app-shell__text-link');
      expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    }
    expect(workspace).not.toHaveTextContent('Project 未選択');
    expect(onBackToProjects).not.toHaveBeenCalled();
    expect(onOpenSettings).not.toHaveBeenCalled();
  });

  it('renders only the active body, retaining empty shells for the existing tab IDs', async () => {
    const user = userEvent.setup();
    setup();
    for (const { id, label } of workflowTabs) {
      const tab = screen.getByRole('tab', { name: label });
      await user.click(tab);
      expect(tab).toHaveFocus();
      expect(screen.getAllByRole('tab', { selected: true })).toEqual([tab]);
      const panel = screen.getByRole('tabpanel', { name: label });
      expect(panel).toHaveAttribute('id', `workflow-panel-${id}`);
      expect(panel).toHaveAttribute('aria-labelledby', `workflow-tab-${id}`);
      expect(tab).toHaveAttribute('aria-controls', panel.id);
      expect(panel).toHaveTextContent(id === 'import' ? '取り込み機能に接続できません' : '未実装');
      expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(1);
      expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
      for (const shell of screen.getAllByRole('tabpanel', { hidden: true })) {
        if (shell !== panel) {
          expect(shell).toHaveAttribute('hidden');
          expect(shell).toBeEmptyDOMElement();
        }
      }
      expect(new Set(Array.from(document.querySelectorAll('[id]'), (element) => element.id)).size)
        .toBe(document.querySelectorAll('[id]').length);
    }
  });

  it('preserves selection across A -> B -> A by ID even for identically named Projects', async () => {
    const user = userEvent.setup();
    const { show } = setup();
    const sameNameB = { ...projectB, name: projectA.name };
    await user.click(screen.getByRole('tab', { name: '教師データ' }));
    show(sameNameB);
    expect(screen.getByRole('region', { name: projectA.name })).toHaveAttribute('data-project-id', projectB.id);
    expect(screen.getByText('タスク種別：物体検出')).toBeVisible();
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('取り込む');
    await user.click(screen.getByRole('tab', { name: '結果' }));
    show(projectA);
    expect(screen.getByRole('region', { name: projectA.name })).toHaveAttribute('data-project-id', projectA.id);
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('教師データ');
    show(sameNameB);
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('結果');
  });

  it('takes same-ID metadata updates from props without resetting selection or moving focus', async () => {
    const user = userEvent.setup();
    const { show } = setup();
    await user.click(screen.getByRole('tab', { name: 'カメラで試す' }));
    const tab = screen.getByRole('tab', { selected: true });
    const updated = { ...projectA, name: '更新した名前', taskType: 'detection' as const,
      updatedAt: '2026-09-12T01:00:00.000Z' };
    show(updated);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(updated.name);
    expect(screen.getByText('タスク種別：物体検出')).toBeVisible();
    expect(screen.getByRole('tab', { selected: true })).toBe(tab);
    expect(tab).toHaveFocus();
    expect(screen.queryByRole('heading', { name: projectA.name })).toBeNull();
  });

  it('keeps only small state while hidden or null and does not focus on an ordinary return', async () => {
    const user = userEvent.setup();
    const { show } = setup();
    await user.click(screen.getByRole('tab', { name: '学習' }));
    const oldTab = screen.getByRole('tab', { selected: true });
    show(projectA, false);
    expectNoWorkspace();
    expect(oldTab).toBeInTheDocument(); expect(oldTab).not.toBeVisible();
    const outside = screen.getByRole('button', { name: '外部の操作' });
    act(() => outside.focus());
    show(projectB, false);
    show(null);
    expectNoWorkspace();
    show({ ...projectA, name: '非表示中に更新' });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('非表示中に更新');
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('学習');
    expect(outside).toHaveFocus();
  });

  it('returns to the list only on explicit activation and retains the tab when shown again', async () => {
    const user = userEvent.setup();
    const { show, onBackToProjects, onOpenSettings } = setup();
    await user.click(screen.getByRole('tab', { name: '結果' }));
    const back = screen.getByRole('button', { name: 'Project 一覧に戻る' });
    act(() => back.focus());
    expect(onBackToProjects).not.toHaveBeenCalled();
    await user.keyboard('{Enter}');
    expect(onBackToProjects).toHaveBeenCalledExactlyOnceWith();
    expect(onOpenSettings).not.toHaveBeenCalled();
    show(projectA, false);
    expectNoWorkspace();
    show(projectA);
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('結果');
    expect(onBackToProjects).toHaveBeenCalledTimes(1);
  });

  it('separates manual keyboard focus from Enter/Space selection and reaches the active panel', async () => {
    const user = userEvent.setup();
    setup();
    act(() => screen.getByRole('tab', { name: '取り込む' }).focus());
    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'カメラで試す' })).toHaveFocus();
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('取り込む');
    await user.keyboard('{Home}{ArrowRight}');
    expect(screen.getByRole('tab', { name: '教師データ' })).toHaveFocus();
    expect(screen.getByRole('tabpanel', { name: '取り込む' })).toBeVisible();
    await user.keyboard('{Enter}');
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: '学習' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('tabpanel', { name: '教師データ' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('tab', { name: '教師データ' })).toHaveFocus();
    await user.keyboard('{End}[Space]');
    expect(screen.getByRole('tab', { name: 'カメラで試す', selected: true })).toHaveFocus();
  });

  it.each([
    { tab: '学習', button: 'Project 設定', category: 'project', id: 'project-workspace-project-settings' },
    { tab: '教師データ', button: 'ラベル定義', category: 'labels', id: 'project-workspace-labels-settings' },
    { tab: 'カメラで試す', button: '推論設定', category: 'inference', id: 'project-workspace-inference-settings' },
  ])('opens $category and restores its fixed local opener once after a same-Project return', async ({ tab, button, category, id }) => {
    const user = userEvent.setup();
    const { show, onOpenSettings, onBackToProjects } = setup();
    await user.click(screen.getByRole('tab', { name: tab }));
    const opener = screen.getByRole('button', { name: button });
    expect(opener).toHaveAttribute('id', id);
    await user.click(opener);
    expect(onOpenSettings).toHaveBeenCalledExactlyOnceWith(category, id);
    expect(onBackToProjects).not.toHaveBeenCalled();
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent(tab);
    show(projectA, false);
    expectNoWorkspace();
    expect(opener).toBeInTheDocument(); expect(opener).not.toBeVisible();
    const outside = screen.getByRole('button', { name: '外部の操作' });
    act(() => outside.focus());
    const updated = { ...projectA, name: '設定保存後の名前' };
    show(updated, false);
    expect(outside).toHaveFocus();
    show(updated);
    expect(screen.getByRole('button', { name: button })).toHaveFocus();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(updated.name);
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent(tab);
    act(() => outside.focus());
    show({ ...updated });
    show(updated, false);
    show(updated);
    expect(outside).toHaveFocus();
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it.each([false, undefined])('does not retain an opener after a no-op returning %s', async (response) => {
    const user = userEvent.setup();
    const { show, onOpenSettings, onBackToProjects } = setup();
    onOpenSettings.mockReturnValue(false);
    if (response === undefined) {
      // Test-only bypass of the boolean contract for an untyped runtime no-op.
      Reflect.apply(onOpenSettings.mockReturnValueOnce, onOpenSettings, [undefined]);
    }
    await user.click(screen.getByRole('button', { name: 'Project 設定' }));
    expect(onOpenSettings).toHaveBeenCalledExactlyOnceWith('project', 'project-workspace-project-settings');
    const outside = screen.getByRole('button', { name: '外部の操作' });
    act(() => outside.focus());
    show(projectA, false);
    expectNoWorkspace();
    show(projectA);
    expect(outside).toHaveFocus();
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(onBackToProjects).not.toHaveBeenCalled();
  });

  it('clears the opener when a settings callback throws without swallowing the error', async () => {
    const user = userEvent.setup();
    const { show, onOpenSettings, onBackToProjects } = setup();
    const error = new Error('Settings navigation failed.');
    onOpenSettings.mockImplementationOnce(() => { throw error; });
    const reportedErrors: unknown[] = [];
    const captureError = (event: ErrorEvent) => {
      if (event.error !== error) return;
      reportedErrors.push(event.error);
      event.preventDefault();
    };
    window.addEventListener('error', captureError);
    try {
      await user.click(screen.getByRole('button', { name: 'Project 設定' }));
      expect(reportedErrors).toContain(error);
      expect(onOpenSettings).toHaveBeenCalledExactlyOnceWith('project', 'project-workspace-project-settings');
      const outside = screen.getByRole('button', { name: '外部の操作' });
      act(() => outside.focus());
      show(projectA, false);
      expectNoWorkspace();
      show(projectA);
      expect(outside).toHaveFocus();
      expect(onOpenSettings).toHaveBeenCalledTimes(1);
      expect(onBackToProjects).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('error', captureError);
    }
  });

  it.each([true, false])('respects acceptance %s after the callback synchronously hides the workspace', async (accepted) => {
    const user = userEvent.setup();
    const { show, onOpenSettings, onBackToProjects } = setup();
    onOpenSettings.mockImplementationOnce(() => {
      flushSync(() => show(projectA, false));
      return accepted;
    });
    await user.click(screen.getByRole('button', { name: 'Project 設定' }));
    expectNoWorkspace();
    const outside = screen.getByRole('button', { name: '外部の操作' });
    act(() => outside.focus());
    show(projectA);
    if (accepted) expect(screen.getByRole('button', { name: 'Project 設定' })).toHaveFocus();
    else expect(outside).toHaveFocus();
    expect(onOpenSettings).toHaveBeenCalledExactlyOnceWith('project', 'project-workspace-project-settings');
    expect(onBackToProjects).not.toHaveBeenCalled();
  });

  it.each(['false', 'throw'] as const)('never moves focus during a synchronous hide/show before callback %s or on a later return', async (response) => {
    const user = userEvent.setup();
    const { show, onOpenSettings, onBackToProjects } = setup();
    const outside = screen.getByRole('button', { name: '外部の操作' });
    const error = new Error('Settings navigation failed after a synchronous round trip.');
    const reportedErrors: unknown[] = [];
    const captureError = (event: ErrorEvent) => {
      if (event.error !== error) return;
      reportedErrors.push(event.error);
      event.preventDefault();
    };
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    let checkedBeforeResponse = false;
    onOpenSettings.mockImplementationOnce(() => {
      flushSync(() => show(projectA, false));
      expectNoWorkspace();
      outside.focus();
      expect(outside).toHaveFocus();
      focus.mockClear();
      flushSync(() => show(projectA));
      expect(outside).toHaveFocus();
      expect(focus).not.toHaveBeenCalled();
      checkedBeforeResponse = true;
      if (response === 'throw') throw error;
      return false;
    });
    window.addEventListener('error', captureError);
    try {
      await user.click(screen.getByRole('button', { name: 'Project 設定' }));
      expect(checkedBeforeResponse).toBe(true);
      expect(reportedErrors).toEqual(response === 'throw' ? [error] : []);
      expect(outside).toHaveFocus();
      expect(focus).not.toHaveBeenCalled();
      show(projectA, false);
      expectNoWorkspace();
      expect(outside).toHaveFocus();
      expect(focus).not.toHaveBeenCalled();
      show(projectA);
      expect(outside).toHaveFocus();
      expect(focus).not.toHaveBeenCalled();
      expect(onOpenSettings).toHaveBeenCalledExactlyOnceWith('project', 'project-workspace-project-settings');
      expect(onBackToProjects).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('error', captureError);
      focus.mockRestore();
    }
  });

  it('discards a synchronous round trip completed before acceptance without moving focus or reviving it later', async () => {
    const user = userEvent.setup();
    const { show, onOpenSettings, onBackToProjects } = setup();
    const outside = screen.getByRole('button', { name: '外部の操作' });
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    let checkedBeforeAcceptance = false;
    onOpenSettings.mockImplementationOnce(() => {
      flushSync(() => show(projectA, false));
      expectNoWorkspace();
      outside.focus();
      focus.mockClear();
      flushSync(() => show(projectA));
      expect(outside).toHaveFocus();
      expect(focus).not.toHaveBeenCalled();
      checkedBeforeAcceptance = true;
      return true;
    });
    try {
      await user.click(screen.getByRole('button', { name: 'Project 設定' }));
      expect(checkedBeforeAcceptance).toBe(true);
      expect(outside).toHaveFocus();
      expect(focus).not.toHaveBeenCalled();
      show(projectA, false);
      expectNoWorkspace();
      expect(outside).toHaveFocus();
      expect(focus).not.toHaveBeenCalled();
      show(projectA);
      expect(outside).toHaveFocus();
      expect(focus).not.toHaveBeenCalled();
      expect(onOpenSettings).toHaveBeenCalledExactlyOnceWith('project', 'project-workspace-project-settings');
      expect(onBackToProjects).not.toHaveBeenCalled();
    } finally {
      focus.mockRestore();
    }
  });

  it.each(['other-project', 'null'] as const)('does not revive an opener invalidated by synchronous %s before acceptance', async (interruption) => {
    const user = userEvent.setup();
    const { show, onOpenSettings, onBackToProjects } = setup();
    await user.click(screen.getByRole('tab', { name: '教師データ' }));
    onOpenSettings.mockImplementationOnce(() => {
      flushSync(() => show(interruption === 'null' ? null : projectB, false));
      return true;
    });
    await user.click(screen.getByRole('button', { name: 'ラベル定義' }));
    expectNoWorkspace();
    const outside = screen.getByRole('button', { name: '外部の操作' });
    act(() => outside.focus());
    show(projectA, false);
    show(projectA);
    expect(outside).toHaveFocus();
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('教師データ');
    expect(onOpenSettings).toHaveBeenCalledExactlyOnceWith('labels', 'project-workspace-labels-settings');
    expect(onBackToProjects).not.toHaveBeenCalled();
  });

  it.each([false, true])('preserves a newer accepted opener when an older reentrant request returns %s', async (accepted) => {
    const user = userEvent.setup();
    const { show, onOpenSettings, onBackToProjects } = setup();
    await user.click(screen.getByRole('tab', { name: '教師データ' }));
    const labelsOpener = screen.getByRole('button', { name: 'ラベル定義' });
    onOpenSettings.mockImplementationOnce(() => {
      labelsOpener.click();
      return accepted;
    });
    await user.click(screen.getByRole('button', { name: 'Project 設定' }));
    show(projectA, false);
    const outside = screen.getByRole('button', { name: '外部の操作' });
    act(() => outside.focus());
    show(projectA);
    expect(screen.getByRole('button', { name: 'ラベル定義' })).toHaveFocus();
    expect(onOpenSettings).toHaveBeenCalledTimes(2);
    expect(onOpenSettings).toHaveBeenNthCalledWith(1, 'project', 'project-workspace-project-settings');
    expect(onOpenSettings).toHaveBeenNthCalledWith(2, 'labels', 'project-workspace-labels-settings');
    expect(onBackToProjects).not.toHaveBeenCalled();
  });

  it.each(['other-project', 'null'] as const)('invalidates pending focus through hidden %s even when A returns', async (interruption) => {
    const user = userEvent.setup();
    const { show } = setup();
    await user.click(screen.getByRole('tab', { name: '教師データ' }));
    await user.click(screen.getByRole('button', { name: 'ラベル定義' }));
    show(projectA, false);
    const outside = screen.getByRole('button', { name: '外部の操作' });
    act(() => outside.focus());
    show(interruption === 'null' ? null : projectB, false);
    show(projectA, false);
    show(projectA);
    expect(outside).toHaveFocus();
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('教師データ');
  });

  it('does not revive focus on visible A/B changes or when a settings callback did not hide the workspace', async () => {
    const user = userEvent.setup();
    const { show } = setup();
    await user.click(screen.getByRole('tab', { name: 'カメラで試す' }));
    await user.click(screen.getByRole('button', { name: '推論設定' }));
    const outside = screen.getByRole('button', { name: '外部の操作' });
    act(() => outside.focus());
    show({ ...projectA, name: '新しい応答の名前' });
    expect(outside).toHaveFocus();
    show(projectB);
    expect(outside).toHaveFocus();
    show(projectA, false);
    show(projectA);
    expect(outside).toHaveFocus();
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('カメラで試す');
  });

  it('has no bridge/media access, fabricated results, or future draft controls during navigation', async () => {
    const bridgeDescriptor = Object.getOwnPropertyDescriptor(window, APP_BRIDGE_KEY);
    const mediaDescriptor = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
    const readBridge = vi.fn(() => { throw new Error('Workspace must not access APIs.'); });
    const readMedia = vi.fn(() => { throw new Error('Workspace must not access media devices.'); });
    Object.defineProperty(window, APP_BRIDGE_KEY, { configurable: true, get: readBridge });
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, get: readMedia });
    try {
      const user = userEvent.setup();
      const { container, show, unmount } = setup();
      for (const { label } of workflowTabs) {
        await user.click(screen.getByRole('tab', { name: label }));
        expect(container.querySelector('form, input, select, textarea, [contenteditable], video, audio, canvas, img, iframe')).toBeNull();
        expect(screen.queryByRole('progressbar')).toBeNull();
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(container).not.toHaveTextContent(/保存済み|確認済み|学習成功|Succeeded|\b\d+\s*(?:FPS|%)\b/);
      }
      await user.click(screen.getByRole('button', { name: '推論設定' }));
      show(projectA, false);
      show(projectA);
      expect(screen.getByRole('tabpanel')).toHaveTextContent('カメラにはアクセスしません。');
      await user.click(screen.getByRole('tab', { name: '教師データ' }));
      expect(screen.getByRole('tabpanel')).toHaveTextContent('未保存変更の保持・離脱時の保存確認も未実装');
      await user.click(screen.getByRole('button', { name: 'ラベル定義' }));
      show(projectA, false);
      show(projectA);
      await user.click(screen.getByRole('button', { name: 'Project 設定' }));
      show(projectB, false);
      show(projectB);
      await user.click(screen.getByRole('button', { name: 'Project 一覧に戻る' }));
      show(null);
      expectNoWorkspace();
      unmount();
      expect(readBridge).not.toHaveBeenCalled();
      expect(readMedia).not.toHaveBeenCalled();
    } finally {
      if (bridgeDescriptor) Object.defineProperty(window, APP_BRIDGE_KEY, bridgeDescriptor);
      else Reflect.deleteProperty(window, APP_BRIDGE_KEY);
      if (mediaDescriptor) Object.defineProperty(navigator, 'mediaDevices', mediaDescriptor);
      else Reflect.deleteProperty(navigator, 'mediaDevices');
    }
  });
});