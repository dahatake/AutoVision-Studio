import { describe, expect, it } from 'vitest';

import {
  appRoutes,
  screenLocations,
  settingsCategories,
  workflowTabs,
} from './routes';

describe('route metadata', () => {
  it('preserves all 11 screen IDs, labels, paths, and their order', () => {
    expect(appRoutes).toEqual([
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
    ]);
    expect(new Set(appRoutes.map(({ screenId }) => screenId)).size).toBe(11);
    expect(new Set(appRoutes.map(({ path }) => path)).size).toBe(11);
  });

  it('defines five ordered workflow tabs with matching primary screens', () => {
    expect(workflowTabs).toEqual([
      { id: 'import', label: '取り込む', screenId: 'UI-04' },
      { id: 'annotations', label: '教師データ', screenId: 'UI-10' },
      { id: 'training', label: '学習', screenId: 'UI-05' },
      { id: 'reports', label: '結果', screenId: 'UI-06' },
      { id: 'camera', label: 'カメラで試す', screenId: 'UI-07' },
    ]);
    expect(new Set(workflowTabs.map(({ id }) => id)).size).toBe(5);
    expect(new Set(workflowTabs.map(({ screenId }) => screenId)).size).toBe(5);

    for (const { id, screenId } of workflowTabs) {
      expect(screenLocations[screenId]).toEqual({
        section: 'workflow',
        tab: id,
      });
    }
  });

  it('defines five ordered settings categories including inference', () => {
    expect(settingsCategories).toEqual([
      { id: 'project', label: 'Project' },
      { id: 'labels', label: 'ラベル定義' },
      { id: 'inference', label: '推論' },
      { id: 'device', label: '端末・容量' },
      { id: 'information', label: 'ライセンス・情報' },
    ]);
    expect(new Set(settingsCategories.map(({ id }) => id)).size).toBe(5);
  });

  it('assigns exactly one primary location to every existing screen', () => {
    expect(Object.keys(screenLocations).sort()).toEqual(
      appRoutes.map(({ screenId }) => screenId).sort(),
    );
    expect(screenLocations).toEqual({
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
    });
  });

  it('references only declared workflow tabs and settings categories', () => {
    const tabIds = workflowTabs.map(({ id }) => id);
    const categoryIds = settingsCategories.map(({ id }) => id);

    for (const { screenId } of appRoutes) {
      const location = screenLocations[screenId];

      if (location.section === 'workflow') {
        expect(tabIds).toContain(location.tab);
      } else if (location.section === 'settings') {
        expect(categoryIds).toContain(location.category);
      } else {
        expect(location).toEqual({ section: 'projects' });
      }
    }
  });
});