import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import packageMetadata from '../../../package.json';
import fluentSystemIconsLicense from '../../../resources/licenses/fluent-system-icons.LICENSE.txt?raw';
import fluentSystemIconsNotice from '../../../resources/licenses/fluent-system-icons.NOTICE.txt?raw';
import { APP_API_CONTRACT_VERSION, APP_BRIDGE_KEY, type AppApi } from '../../shared/contracts/app';
import type { LabelSchemaApi } from '../../shared/contracts/annotation-ipc';
import type { DiagnosticExportResult } from '../../shared/contracts/diagnostic-export';
import { hardwareDiagnosticsSchema, type HardwareDiagnostics } from '../../shared/contracts/diagnostics';
import type { ImportApi, ImportCommitResponse, ImportPreview } from '../../shared/contracts/import-ipc';
import type { JobApi, JobSnapshot } from '../../shared/contracts/job-ipc';
import {
  PROJECT_SOURCE_CLEANUP_FAILED_MESSAGE, projectSnapshotSchema, type ProjectApi,
  type ProjectCreateResponse, type ProjectGetResponse, type ProjectListResponse,
  type ProjectSnapshot, type ProjectUpdateResponse,
} from '../../shared/contracts/project-ipc';
import { PRODUCT_VERSION } from '../product-version';
import { appRoutes, screenLocations, settingsCategories, workflowTabs } from '../routes';
import { AppShell } from './AppShell';
import '../styles/global.css';

const a = projectSnapshotSchema.parse({
  project: { id: 'abcdefab-1234-4123-8123-abcdefabcdef', name: '分類 Project', description: 'A の説明', taskType: 'classification',
    workspacePath: 'C:\\DBの保存先\\abcdefab-1234-4123-8123-abcdefabcdef',
    createdAt: '2026-09-12T01:00:00.000Z', updatedAt: '2026-09-12T01:00:00.000Z' }, taskTypeLocked: false,
});
function changed(base: ProjectSnapshot, project: Partial<ProjectSnapshot['project']>, taskTypeLocked = base.taskTypeLocked) {
  return projectSnapshotSchema.parse({ project: { ...base.project, ...project }, taskTypeLocked });
}
const b = changed(a, { id: '22222222-2222-4222-8222-222222222222', name: '検出 Project', description: 'B の説明',
  taskType: 'detection', workspacePath: 'D:\\DBの保存先\\22222222-2222-4222-8222-222222222222' });
const c = changed(b, { id: '33333333-3333-4333-8333-333333333333', name: '作成が確認された Project',
  workspacePath: 'E:\\DBの確定先\\33333333-3333-4333-8333-333333333333' });
function pagedProjects() {
  return Array.from({ length: 25 }, (_, index) => {
    const id = `00000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, '0')}`;
    return changed(a, { id, name: `Project${index + 1}`, description: '', workspacePath: `C:\\Projects\\${id}` });
  });
}
const token = '44444444-4444-4444-8444-444444444444';
const parentPath = 'C:\\選択した親 🧪';
const ok = <T,>(value: T) => ({ ok: true as const, value });
const failed = { ok: false as const, error: { code: 'OPERATION_FAILED' as const } };
const methods = ['list', 'get', 'create', 'update', 'pickParent', 'move', 'recover'] as const;
function apiFor() {
  return {
    list: vi.fn<ProjectApi['list']>().mockResolvedValue(ok([a, b])),
    get: vi.fn<ProjectApi['get']>().mockImplementation(async ({ projectId }) => {
      const value = [a, b, c].find(({ project }) => project.id === projectId);
      return value ? ok(value) : { ok: false, error: { code: 'NOT_FOUND' } };
    }),
    create: vi.fn<ProjectApi['create']>().mockResolvedValue(ok(c)),
    update: vi.fn<ProjectApi['update']>().mockResolvedValue(failed),
    pickParent: vi.fn<ProjectApi['pickParent']>().mockResolvedValue(ok({ status: 'selected', token, displayPath: parentPath })),
    move: vi.fn<ProjectApi['move']>().mockResolvedValue(failed),
    recover: vi.fn<ProjectApi['recover']>().mockResolvedValue(failed),
    deletePreview: vi.fn<ProjectApi['deletePreview']>().mockResolvedValue(failed),
    delete: vi.fn<ProjectApi['delete']>().mockResolvedValue(failed),
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function hardwareReport(overrides: Partial<HardwareDiagnostics> = {}): HardwareDiagnostics {
  return hardwareDiagnosticsSchema.parse({
    schemaVersion: 1, command: 'probe-hardware', status: 'ok',
    os: { status: 'ok', data: { name: 'Windows', major: 10, minor: 0, build: 26100, productType: 1, architecture: 'AMD64' }, error: null },
    cpu: { status: 'ok', data: { logicalCount: 8, name: '診断 fixture CPU' }, error: null },
    memory: { status: 'ok', data: { totalBytes: 8192, availableBytes: 4096, loadPercent: 50 }, error: null },
    disk: { status: 'ok', data: { totalBytes: 10000, usedBytes: 2000, freeBytes: 8000 }, error: null },
    gpu: { status: 'ok', data: { adapters: [], scope: 'current-session-display-adapters', computeStatus: 'not_checked' }, error: null },
    onnxRuntime: { status: 'ok', data: { version: '1.0', providers: ['CPUExecutionProvider', 'DmlExecutionProvider'], executionStatus: 'not_checked' }, error: null },
    cuda: { status: 'ok', data: { torchVersion: '2.0', runtimeVersion: null, available: false,
      scope: 'torch-runtime-only', executionStatus: 'not_checked', physicalGpuPresence: null }, error: null },
    camera: { status: 'deferred', streamOpened: false, reasonCode: 'check-on-inference-start' },
    ...overrides,
  });
}
const notChecked = { status: 'not_checked', data: null, error: null } as const;
function unsupportedOsReport() {
  return hardwareReport({ status: 'error', os: { status: 'error', data: null, error: { code: 'unsupported-os', causeType: null } },
    cpu: notChecked, memory: notChecked, disk: notChecked, gpu: notChecked, onnxRuntime: notChecked, cuda: notChecked });
}
function reportWithOs(data: Partial<NonNullable<HardwareDiagnostics['os']['data']>>) {
  return hardwareReport({ os: { status: 'ok', data: { ...hardwareReport().os.data!, ...data }, error: null } });
}
let api = apiFor();
let bridgeDescriptor: PropertyDescriptor | undefined, mediaDescriptor: PropertyDescriptor | undefined;
let readBridge = vi.fn<() => AppApi>(), readProjects = vi.fn<() => ProjectApi>();
let readDiagnostics = vi.fn<() => AppApi['diagnostics']>(), readMedia = vi.fn();
let collectDiagnostics = vi.fn<AppApi['diagnostics']['collect']>();
let imports: ReturnType<typeof importPorts>;
let jobs: JobApi;
let labelSchemas: LabelSchemaApi;
let readImports = vi.fn<() => ImportApi>(), readJobs = vi.fn<() => JobApi>();
let readLabelSchemasMock = vi.fn<() => LabelSchemaApi>();
function importPorts() {
  return {
    start: vi.fn<ImportApi['start']>().mockResolvedValue(ok({ status: 'cancelled' })),
    preview: vi.fn<ImportApi['preview']>(), commit: vi.fn<ImportApi['commit']>(),
    discard: vi.fn<ImportApi['discard']>().mockResolvedValue(ok(null)),
  };
}
function labelSchemaPorts(): LabelSchemaApi {
  return {
    get: vi.fn().mockResolvedValue({ ok: true, value: null }),
    create: vi.fn(), createClass: vi.fn(), updateClass: vi.fn(),
    update: vi.fn(), deleteClass: vi.fn(), mergeClasses: vi.fn(),
  };
}
function installBridge(projects: ProjectApi = api) {
  readProjects = vi.fn(() => projects);
  const bridge: AppApi = { contractVersion: APP_API_CONTRACT_VERSION,
    get projects() { return readProjects(); }, get labelSchemas() { return readLabelSchemasMock(); },
    get annotations() { return {} as any; }, get diagnostics() { return readDiagnostics(); },
    get imports() { return readImports(); }, get jobs() { return readJobs(); },
    get revisions() { return { create: vi.fn(), validate: vi.fn(), confirmAndQueue: vi.fn(), clone: vi.fn() }; },
    get references() { return { status: vi.fn(), relink: vi.fn() }; } };
  readBridge = vi.fn(() => bridge);
  Object.defineProperty(window, APP_BRIDGE_KEY, { configurable: true, get: readBridge });
}
beforeEach(() => {
  bridgeDescriptor = Object.getOwnPropertyDescriptor(window, APP_BRIDGE_KEY);
  mediaDescriptor = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
  api = apiFor();
  imports = importPorts();
  jobs = { list: vi.fn(), get: vi.fn(), cancel: vi.fn(), subscribe: vi.fn<JobApi['subscribe']>().mockResolvedValue(vi.fn()) };
  labelSchemas = labelSchemaPorts();
  readImports = vi.fn(() => imports); readJobs = vi.fn(() => jobs);
  readLabelSchemasMock = vi.fn(() => labelSchemas);
  collectDiagnostics = vi.fn<AppApi['diagnostics']['collect']>().mockResolvedValue(hardwareReport());
  readDiagnostics = vi.fn(() => ({ collect: collectDiagnostics }));
  readMedia = vi.fn(() => { throw new Error('Camera access is not implemented.'); });
  installBridge();
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, get: readMedia });
});
afterEach(() => {
  cleanup();
  try {
    expect(readMedia).not.toHaveBeenCalled();
  } finally {
    if (bridgeDescriptor) Object.defineProperty(window, APP_BRIDGE_KEY, bridgeDescriptor);
    else Reflect.deleteProperty(window, APP_BRIDGE_KEY);
    if (mediaDescriptor) Object.defineProperty(navigator, 'mediaDevices', mediaDescriptor);
    else Reflect.deleteProperty(navigator, 'mediaDevices');
    vi.restoreAllMocks();
  }
});
function headerLink(name: 'Project 一覧' | '設定') {
  return within(screen.getByRole('navigation', { name: '主要画面' })).getByRole('link', { name });
}
function appHeader(): HTMLElement {
  const header = headerLink('Project 一覧').closest('header');
  expect(header).toBeInstanceOf(HTMLElement);
  return header!;
}
function rowName(snapshot: ProjectSnapshot, settings = false) {
  return `${snapshot.project.name}（${snapshot.project.id}）${settings ? 'の設定' : 'を開く'}`;
}
async function enter(user: ReturnType<typeof userEvent.setup>, snapshot = a, settings = false) {
  await user.click(await screen.findByRole('button', { name: rowName(snapshot, settings) }));
  await screen.findByRole('heading', { level: 1, name: settings ? 'Project 設定' : snapshot.project.name });
}
const nameField = () => screen.getByRole('textbox', { name: '名前（必須）' });
const settingsBack = () => screen.getByRole('button', { name: /^(戻る|未保存の変更を保持して戻る)$/ });
const listStatus = () => within(screen.getByRole('region', { name: 'Project 一覧' })).getByRole('status');
const projectStatus = () => within(screen.getByRole('form', { name: 'Project 設定' })).getByRole('status');
const diagnosticSummary = () => screen.getByRole('region', { name: '端末診断' });
const diagnosticStatus = () => within(diagnosticSummary()).getByRole('status', { name: '端末診断の状態' });
const diagnosticPage = () => within(screen.getByRole('heading', { level: 1, name: '端末・容量' }).closest('section')!);
const capacityText = (value: string) => `アプリデータ（userData）ボリュームの空き：${value}（Project 使用量ではありません）`;
async function describeProject(user: ReturnType<typeof userEvent.setup>, value: string) {
  await user.click(screen.getByRole('button', { name: '説明を編集（任意）' }));
  fireEvent.change(screen.getByRole('textbox', { name: '説明（任意）' }), { target: { value } });
  await user.click(screen.getByRole('button', { name: '入力項目に戻る' }));
}
async function prepareCreate(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Project を作成' }));
  fireEvent.change(nameField(), { target: { value: '  入力した名前  ' } });
  await user.click(screen.getByRole('button', { name: '親フォルダーを選択' }));
}

// Real components + the real public global contract only. These are DOM/IPC-fixture
// tests, not native picker, viewport, user DB, or old M1 smoke-harness acceptance.
describe('AppShell (UIR-025A-W)', () => {
  it('retains the 11 route/five-tab metadata and honest common shell while the actual list loads', () => {
    api.list.mockReturnValueOnce(deferred<ProjectListResponse>().promise);
    const { container } = render(<AppShell />);
    expect(appRoutes.map(({ screenId }) => screenId)).toEqual([
      'UI-01', 'UI-02', 'UI-03', 'UI-04', 'UI-05', 'UI-06', 'UI-07', 'UI-08', 'UI-09', 'UI-10', 'UI-11',
    ]);
    expect(new Set(appRoutes.map(({ path }) => path)).size).toBe(11);
    expect(workflowTabs.map(({ label }) => label)).toEqual(['取り込む', '教師データ', '学習', '結果', 'カメラで試す']);
    expect(screenLocations['UI-11']).toEqual({ section: 'workflow', tab: 'annotations' });
    const header = appHeader(), navigation = screen.getByRole('navigation', { name: '主要画面' });
    const links = within(navigation).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(['Project 一覧', '設定']);
    expect(links.map((link) => link.id)).toEqual(['app-shell-projects-link', 'app-shell-settings-link']);
    expect(navigation.parentElement).toBe(header);
    for (const link of links) {
      const icon = link.querySelector('svg');
      expect(icon).toHaveAttribute('aria-hidden', 'true'); expect(icon).toHaveAttribute('focusable', 'false');
      expect(icon).toHaveAttribute('width', '20'); expect(icon).toHaveAttribute('height', '20');
      expect(icon).toHaveAttribute('viewBox', '0 0 20 20'); expect(icon?.querySelector('path')).toHaveAttribute('fill', 'currentColor');
      expect(icon?.querySelector('path')?.getAttribute('d')).toMatch(/^M/); expect(link).not.toHaveAttribute('target');
    }
    expect(header).toHaveTextContent('AutoVision Studio'); expect(header).toHaveTextContent('Project 未選択');
    expect(header).toHaveTextContent('開発中'); expect(headerLink('Project 一覧')).toHaveAttribute('aria-current', 'page');
    expect(headerLink('設定')).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');
    expect(screen.getByRole('main')).toHaveAttribute('tabindex', '-1');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Project 一覧' })).toBeVisible();
    expect(listStatus()).toHaveTextContent('取得中');
    expect(diagnosticStatus()).toHaveTextContent('取得中');
    expect(screen.getByText('件数 未取得')).toBeVisible(); expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('button', { name: '作業画面を確認' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Project を作成' })).toBeEnabled();
    expect(container).not.toHaveTextContent(/0件|保存済み|CPU 動作可|推奨構成/);
    expect(screen.queryByLabelText(/^製品バージョン /)).toBeNull();
    for (const text of ['ジョブ：Project 未選択', '診断：取得中', 'デバイス：計算実行未確認', `容量：${capacityText('未取得')}`]) {
      expect(within(screen.getByRole('contentinfo')).getByText(text)).toBeVisible();
    }
    expect(readDiagnostics).toHaveBeenCalledTimes(1);
    expect(api.list).toHaveBeenCalledExactlyOnceWith();
    for (const method of methods.filter((method) => method !== 'list')) expect(api[method]).not.toHaveBeenCalled();
  });

  it('reads the bridge and seven capabilities once, including StrictMode, and keeps the API stable through drafts and rerenders', async () => {
    const getters = methods.map((name) => {
      const method = api[name], read = vi.fn(() => method);
      Object.defineProperty(api, name, { configurable: true, get: read }); return read;
    });
    const user = userEvent.setup(); const h = render(<StrictMode><AppShell /></StrictMode>);
    await screen.findByRole('button', { name: rowName(a) });
    await prepareCreate(user); await describeProject(user, '保持する説明');
    const originalForm = screen.getByRole('form', { name: 'Project を作成' });
    await user.click(headerLink('設定')); await user.click(screen.getByRole('link', { name: '端末・容量' }));
    const replacement = apiFor();
    Object.defineProperty(window, APP_BRIDGE_KEY, { configurable: true,
      value: { contractVersion: APP_API_CONTRACT_VERSION, projects: replacement } });
    h.rerender(<StrictMode><AppShell /></StrictMode>);
    await user.click(settingsBack());
    expect(screen.getByRole('form', { name: 'Project を作成' })).toBe(originalForm);
    expect(nameField()).toHaveValue('  入力した名前  '); expect(screen.getByText(parentPath)).toBeVisible();
    expect(readBridge).toHaveBeenCalledTimes(1); expect(readProjects).toHaveBeenCalledTimes(1);
    expect(readDiagnostics).toHaveBeenCalledTimes(1); expect(collectDiagnostics).toHaveBeenCalledTimes(2);
    for (const read of getters) expect(read).toHaveBeenCalledTimes(1);
    for (const method of methods) expect(replacement[method]).not.toHaveBeenCalled();
    h.unmount(); render(<AppShell />);
    await screen.findByRole('button', { name: rowName(a) });
    expect(replacement.list).toHaveBeenCalledExactlyOnceWith();
    expect(diagnosticStatus()).toHaveTextContent('利用不可');
    await user.click(screen.getByRole('link', { name: '端末・容量を確認' }));
    expect(diagnosticPage().getByRole('alert')).toHaveTextContent('端末診断に接続できません');
    expect(diagnosticPage().queryByRole('button', { name: '再取得' })).toBeNull();
  });

  it.each(['missing', 'null', 'version', 'projects-getter', 'missing-method', 'method-getter', 'bridge-getter'] as const)(
    'fails closed for %s without fake Projects, but keeps information navigation', async (kind) => {
      if (kind === 'missing') Reflect.deleteProperty(window, APP_BRIDGE_KEY);
      else {
        const broken: Record<string, unknown> = { contractVersion: APP_API_CONTRACT_VERSION, projects: api,
          get diagnostics() { return readDiagnostics(); } };
        if (kind === 'version') broken.contractVersion = '1';
        if (kind === 'projects-getter') Object.defineProperty(broken, 'projects', { get() { throw new Error('PRIVATE_NATIVE_PATH'); } });
        if (kind === 'missing-method') broken.projects = { ...api, recover: undefined };
        if (kind === 'method-getter') Object.defineProperty(api, 'recover', { get() { throw new Error('PRIVATE_NATIVE_PATH'); } });
        Object.defineProperty(window, APP_BRIDGE_KEY, kind === 'bridge-getter'
          ? { configurable: true, get() { throw new Error('PRIVATE_NATIVE_PATH'); } }
          : { configurable: true, value: kind === 'null' ? null : broken });
      }
      const user = userEvent.setup(); const { container } = render(<AppShell />);
      expect(screen.getByRole('alert')).toHaveTextContent('接続できません');
      expect(appHeader()).toHaveTextContent('Project 未選択');
      expect(screen.getByRole('button', { name: 'Project を作成' })).toBeDisabled();
      expect(screen.queryByRole('tablist')).toBeNull(); expect(api.list).not.toHaveBeenCalled();
      await user.click(headerLink('設定')); await user.click(screen.getByRole('link', { name: 'ライセンス・情報' }));
      expect(screen.getByLabelText(`製品バージョン ${PRODUCT_VERSION}`)).toBeVisible();
      expect(screen.getByRole('alert')).toHaveTextContent('接続できません');
      await user.click(settingsBack()); expect(headerLink('設定')).toHaveFocus();
      expect(container).not.toHaveTextContent(/PRIVATE_NATIVE_PATH|0件|保存済み/);
      const diagnosticCalls = ['projects-getter', 'missing-method', 'method-getter'].includes(kind) ? 1 : 0;
      expect(readDiagnostics).toHaveBeenCalledTimes(diagnosticCalls);
      expect(collectDiagnostics).toHaveBeenCalledTimes(diagnosticCalls);
      expect(diagnosticStatus()).toHaveTextContent(diagnosticCalls ? '取得済み' : '利用不可');
    },
  );

  it.each(['failed', 'rejected', 'invalid'] as const)('keeps a %s list distinct from zero and retries the real list', async (kind) => {
    if (kind === 'failed') api.list.mockResolvedValueOnce(failed);
    else if (kind === 'rejected') api.list.mockRejectedValueOnce(new Error('PRIVATE_NATIVE_PATH'));
    else api.list.mockResolvedValueOnce(ok([{ project: a.project }]) as unknown as ProjectListResponse);
    const user = userEvent.setup(); const { container } = render(<AppShell />);
    await screen.findByRole('button', { name: '再試行' });
    expect(listStatus()).toHaveTextContent('取得失敗');
    await waitFor(() => expect(diagnosticStatus()).toHaveTextContent('取得済み'));
    expect(screen.getByText('件数 未取得')).toBeVisible();
    expect(container).not.toHaveTextContent(/0件|PRIVATE_NATIVE_PATH|保存済み/);
    await user.click(screen.getByRole('button', { name: '再試行' }));
    expect(await screen.findByRole('button', { name: rowName(a) })).toBeVisible();
    expect(api.list).toHaveBeenCalledTimes(2); expect(api.get).not.toHaveBeenCalled();
    const row = screen.getByRole('button', { name: rowName(a) }).closest('li')!;
    expect(within(row).getAllByRole('definition').map((item) => item.textContent).slice(2)).toEqual(['未取得', '未取得', '未取得']);
    expect(readDiagnostics).toHaveBeenCalledTimes(1); expect(collectDiagnostics).toHaveBeenCalledExactlyOnceWith();
  });

  it('shows zero only after a valid list response and does not gate creation on diagnostics', async () => {
    const task = deferred<HardwareDiagnostics>(); collectDiagnostics.mockReturnValueOnce(task.promise);
    api.list.mockResolvedValueOnce(ok([])); const user = userEvent.setup(); render(<AppShell />);
    expect(await screen.findByText('Project は0件です。作成から始められます。')).toBeVisible();
    expect(diagnosticSummary()).toBeVisible(); expect(diagnosticStatus()).toHaveTextContent('取得中');
    await user.click(screen.getByRole('button', { name: 'Project を作成' }));
    expect(screen.getByRole('heading', { name: 'Project を作成' })).toBeVisible();
    expect(nameField()).toHaveValue(''); expect(screen.queryByText(/作成しました/)).toBeNull();
    const form = screen.getByRole('form', { name: 'Project を作成' });
    fireEvent.change(nameField(), { target: { value: '診断を待たない入力' } });
    await act(async () => { task.reject(new Error('PRIVATE_NATIVE_PATH')); });
    expect(screen.getByRole('form', { name: 'Project を作成' })).toBe(form);
    expect(nameField()).toHaveValue('診断を待たない入力'); expect(nameField()).toBeEnabled();
    expect(screen.getByRole('contentinfo')).toHaveTextContent('診断：取得失敗');
    expect(collectDiagnostics).toHaveBeenCalledExactlyOnceWith();
    for (const method of methods.filter((method) => method !== 'list')) expect(api[method]).not.toHaveBeenCalled();
  });

  it.each(['workspace', 'settings'] as const)('gets fresh canonical metadata before opening %s, never the list snapshot', async (destination) => {
    const task = deferred<ProjectGetResponse>(); api.get.mockReturnValueOnce(task.promise);
    const fresh = changed(a, { name: 'DB の最新名', description: 'DB の最新説明', taskType: 'detection',
      workspacePath: 'F:\\DBの現在root', updatedAt: '2026-09-12T03:00:00.000Z' }, true);
    const user = userEvent.setup(); render(<AppShell />);
    await user.click(await screen.findByRole('button', { name: rowName(a, destination === 'settings') }));
    expect(screen.getByText(/選択中です/)).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Project 一覧' })).toBeVisible();
    expect(appHeader()).toHaveTextContent('Project 未選択'); expect(screen.queryByRole('tablist')).toBeNull();
    await act(async () => { task.resolve(ok({ ...fresh, project: { ...fresh.project, id: fresh.project.id.toUpperCase() } })); });
    expect(api.get).toHaveBeenCalledExactlyOnceWith({ projectId: a.project.id });
    expect(appHeader()).toHaveTextContent(fresh.project.name);
    if (destination === 'workspace') {
      expect(screen.getByRole('heading', { level: 1, name: fresh.project.name })).toBeVisible();
      expect(screen.getByText('タスク種別：物体検出')).toBeVisible();
      await user.click(screen.getByRole('button', { name: 'Project 設定' }));
    }
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Project 設定' })).toBeVisible();
    expect(document.getElementById('settings-heading')).toHaveFocus();
    expect(nameField()).toHaveValue(fresh.project.name); expect(screen.getByText(fresh.project.workspacePath)).toBeVisible();
    expect(screen.getByRole('radio', { name: '物体検出' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '物体検出' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: '画像分類' })).toBeDisabled();
    expect(nameField()).toBeEnabled(); expect(api.get).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: '説明を編集（任意）' }));
    expect(screen.getByRole('textbox', { name: '説明（任意）' })).toHaveValue(fresh.project.description);
  });

  it('disambiguates same-name rows and keeps one Workspace tab map through A/B/list/settings', async () => {
    const sameNameB = changed(b, { name: a.project.name }); api.list.mockResolvedValue(ok([a, sameNameB]));
    api.get.mockImplementation(async ({ projectId }) => ok(projectId === a.project.id ? a : sameNameB));
    const user = userEvent.setup(); render(<AppShell />);
    await enter(user); await user.click(screen.getByRole('tab', { name: '教師データ' }));
    await user.click(screen.getByRole('button', { name: 'Project 一覧に戻る' }));
    await enter(user, sameNameB); expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('取り込む');
    expect(screen.getByRole('region', { name: sameNameB.project.name })).toHaveAttribute('data-project-id', b.project.id);
    await user.click(screen.getByRole('tab', { name: '結果' }));
    await user.click(headerLink('設定')); await user.click(settingsBack());
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('結果');
    await user.click(headerLink('Project 一覧')); await enter(user);
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('教師データ');
    await user.click(headerLink('Project 一覧')); await enter(user, sameNameB);
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('結果');
    expect(api.get.mock.calls).toEqual([a, b, a, b].map(({ project }) => [{ projectId: project.id }]));
  });

  it.each(['NOT_FOUND', 'OPERATION_FAILED', 'invalid', 'mismatch'] as const)('does not replace selected A when B confirmation is %s', async (kind) => {
    const user = userEvent.setup(); const { container } = render(<AppShell />);
    await enter(user); await user.click(headerLink('Project 一覧'));
    api.get.mockResolvedValueOnce(kind === 'mismatch' ? ok(a) : kind === 'invalid'
      ? { ok: false, error: { code: 'UNKNOWN', message: 'PRIVATE_NATIVE_PATH' } } as unknown as ProjectGetResponse
      : { ok: false, error: { code: kind } });
    await user.click(await screen.findByRole('button', { name: rowName(b, true) }));
    expect(screen.getByRole('alert')).toHaveTextContent(b.project.id);
    expect(screen.getByRole('alert')).toHaveTextContent(kind === 'NOT_FOUND' ? '利用できません' : '最新情報を確認できません');
    expect(appHeader()).toHaveTextContent(a.project.name); expect(screen.queryByRole('form')).toBeNull();
    expect(screen.queryByRole('tablist')).toBeNull(); expect(container).not.toHaveTextContent(/PRIVATE_NATIVE_PATH|UNKNOWN|0件/);
    await user.click(screen.getByRole('button', { name: '一覧を再取得' }));
    await screen.findByRole('button', { name: rowName(a) }); expect(api.list).toHaveBeenCalledTimes(3);
    await user.click(headerLink('設定')); expect(nameField()).toHaveValue(a.project.name);
  });

  it('invalidates a missing current Project without losing its hidden settings draft before a later valid reselection', async () => {
    const user = userEvent.setup(); render(<AppShell />); await enter(user, a, true);
    fireEvent.change(nameField(), { target: { value: '保持する A の下書き' } }); await user.click(settingsBack());
    api.get.mockResolvedValueOnce({ ok: false, error: { code: 'NOT_FOUND' } });
    await user.click(await screen.findByRole('button', { name: rowName(a, true) }));
    expect(screen.getByRole('alert')).toHaveTextContent('利用できません');
    expect(appHeader()).toHaveTextContent('Project 未選択');
    await user.click(headerLink('設定'));
    expect(screen.queryByRole('form')).toBeNull(); expect(screen.getByText('Projectは選択されていません。')).toBeVisible();
    expect(document.querySelector('.settings-page input')).toBeNull();
    await user.click(settingsBack());
    const fresh = changed(a, { name: '再確認した保存名', workspacePath: 'J:\\再確認したroot' });
    api.get.mockResolvedValueOnce(ok(fresh)); await enter(user, a, true);
    expect(nameField()).toHaveValue('保持する A の下書き'); expect(screen.getByText(fresh.project.workspacePath)).toBeVisible();
    expect(appHeader()).toHaveTextContent(fresh.project.name); expect(api.update).not.toHaveBeenCalled();
  });

  it('keeps only the newest selection context, including A -> B -> A and out-of-order completions', async () => {
    const oldA = deferred<ProjectGetResponse>(), middleB = deferred<ProjectGetResponse>(), latestA = deferred<ProjectGetResponse>();
    api.get.mockReturnValueOnce(oldA.promise).mockReturnValueOnce(middleB.promise).mockReturnValueOnce(latestA.promise);
    const user = userEvent.setup(); render(<AppShell />);
    await user.click(await screen.findByRole('button', { name: rowName(a) }));
    await user.click(screen.getByRole('button', { name: rowName(b) }));
    await act(async () => { oldA.resolve(ok(a)); });
    expect(screen.getByText(/選択中です/)).toHaveTextContent(b.project.id);
    await user.click(screen.getByRole('button', { name: rowName(a, true) }));
    await act(async () => { latestA.resolve(ok(a)); });
    fireEvent.change(nameField(), { target: { value: '新しい編集を保つ' } });
    await act(async () => { middleB.reject(new Error('PRIVATE_NATIVE_PATH')); });
    expect(nameField()).toHaveValue('新しい編集を保つ');
    expect(screen.queryByRole('alert')).toBeNull(); expect(screen.queryByText(/PRIVATE_NATIVE_PATH/)).toBeNull();
    expect(appHeader()).toHaveTextContent(a.project.name); expect(api.update).not.toHaveBeenCalled();
  });

  it.each(['cancel', 'list', 'create', 'settings', 'unmount'] as const)('invalidates a pending selection on %s rather than navigating late', async (destination) => {
    const task = deferred<ProjectGetResponse>(); api.get.mockReturnValueOnce(task.promise);
    const user = userEvent.setup(); const h = render(<AppShell />);
    await user.click(await screen.findByRole('button', { name: rowName(a, true) }));
    if (destination === 'cancel') await user.click(screen.getByRole('button', { name: '選択をやめる' }));
    else if (destination === 'list') await user.click(headerLink('Project 一覧'));
    else if (destination === 'create') await user.click(screen.getByRole('button', { name: 'Project を作成' }));
    else if (destination === 'settings') {
      await user.click(headerLink('設定')); await user.click(screen.getByRole('link', { name: 'ライセンス・情報' }));
      await user.click(settingsBack());
    } else h.unmount();
    await act(async () => { task.resolve(ok(a)); });
    if (destination === 'unmount') expect(h.container).toBeEmptyDOMElement();
    else {
      expect(appHeader()).toHaveTextContent('Project 未選択');
      expect(screen.queryByRole('heading', { name: 'Project 設定' })).toBeNull();
      expect(screen.getByRole('heading', { level: 1, name: destination === 'create' ? 'Project を作成' : 'Project 一覧' })).toBeVisible();
      expect(screen.queryByText(/選択中です/)).toBeNull();
    }
    expect(api.create).not.toHaveBeenCalled(); expect(api.pickParent).not.toHaveBeenCalled();
  });

  it('drops a hidden list response and an old API session without overwriting a refreshed list', async () => {
    const oldList = deferred<ProjectListResponse>(); api.list.mockReturnValueOnce(oldList.promise).mockResolvedValue(ok([b]));
    const user = userEvent.setup(); const h = render(<AppShell />);
    await user.click(headerLink('設定')); await user.click(settingsBack());
    await screen.findByRole('button', { name: rowName(b) });
    await act(async () => { oldList.resolve(ok([a])); });
    expect(screen.queryByRole('button', { name: rowName(a) })).toBeNull();
    const oldGet = deferred<ProjectGetResponse>(); api.get.mockReturnValueOnce(oldGet.promise);
    await user.click(screen.getByRole('button', { name: rowName(b) })); h.unmount();
    const next = apiFor(); next.list.mockResolvedValue(ok([a])); installBridge(next); render(<AppShell />);
    await act(async () => { oldGet.resolve(ok(b)); });
    expect(await screen.findByRole('button', { name: rowName(a) })).toBeVisible();
    expect(appHeader()).toHaveTextContent('Project 未選択'); expect(next.get).not.toHaveBeenCalled();
  });

  it('preserves this and factory closures for all nine public methods, with mutations only on explicit actions', async () => {
    const saved = changed(a, { name: '保存した名前' });
    const moved = changed(saved, { workspacePath: 'F:\\現在のDB保存先' });
    api.update.mockResolvedValue(ok(saved)); api.move.mockResolvedValue(ok({ ...moved, cleanupStatus: 'completed' }));
    api.recover.mockResolvedValue(ok({ ...moved, cleanupStatus: 'none' }));
    const receiver: ProjectApi = {
      list() { expect(this).toBe(receiver); return api.list(); },
      get(input) { expect(this).toBe(receiver); return api.get(input); },
      create(input) { expect(this).toBe(receiver); return api.create(input); },
      update(input) { expect(this).toBe(receiver); return api.update(input); },
      pickParent(input) { expect(this).toBe(receiver); return api.pickParent(input); },
      move(input) { expect(this).toBe(receiver); return api.move(input); },
      recover(input) { expect(this).toBe(receiver); return api.recover(input); },
      deletePreview(input) { expect(this).toBe(receiver); return api.deletePreview(input); },
      delete(input) { expect(this).toBe(receiver); return api.delete(input); },
    };
    installBridge(receiver); const user = userEvent.setup(); render(<AppShell />);
    await enter(user, a, true);
    for (const method of ['create', 'update', 'pickParent', 'move', 'recover', 'deletePreview', 'delete'] as const) {
      expect(api[method]).not.toHaveBeenCalled();
    }
    fireEvent.change(nameField(), { target: { value: saved.project.name } });
    await user.click(screen.getByRole('button', { name: 'Project情報を保存' }));
    await user.click(screen.getByRole('button', { name: '移動先の親フォルダーを選択' }));
    await user.click(screen.getByRole('button', { name: '保存場所を変更' }));
    await user.click(screen.getByRole('button', { name: '旧領域の復旧を確認' }));
    expect(screen.getByText(moved.project.workspacePath)).toBeVisible();
    await user.click(settingsBack()); await prepareCreate(user);
    await user.click(screen.getByRole('button', { name: '作成' }));
    expect(screen.getByRole('heading', { name: c.project.name })).toBeVisible();
    for (const method of methods) expect(api[method]).toHaveBeenCalled();
    expect(api.pickParent.mock.calls).toEqual([[{ purpose: 'move', projectId: a.project.id }], [{ purpose: 'create' }]]);
    expect(api.move).toHaveBeenCalledExactlyOnceWith({ projectId: a.project.id, parentToken: token });
    expect(api.recover).toHaveBeenCalledExactlyOnceWith({ projectId: a.project.id });
  });

  it('retains one Project settings draft map across A/B, all hidden slots and fresh metadata without autosaving', async () => {
    const initial = deferred<HardwareDiagnostics>(); collectDiagnostics.mockReturnValueOnce(initial.promise);
    const user = userEvent.setup(); render(<AppShell />); await enter(user, a, true);
    const page = screen.getByRole('region', { name: '設定' });
    const slot = page.querySelector('.settings-page__content')!.firstElementChild;
    fireEvent.change(nameField(), { target: { value: '下書き A' } }); await describeProject(user, '  A の下書き\n説明  ');
    const fieldA = nameField(); await user.click(fieldA);
    await act(async () => { initial.resolve(hardwareReport()); });
    expect(nameField()).toBe(fieldA); expect(fieldA).toHaveFocus(); expect(fieldA).toHaveValue('下書き A');
    await user.click(settingsBack());
    expect(page).not.toBeVisible(); expect(page.querySelector('input, textarea')).toBeNull();
    await enter(user, b, true);
    fireEvent.change(nameField(), { target: { value: '下書き B' } }); await describeProject(user, 'B の下書き説明');
    const refresh = deferred<HardwareDiagnostics>(); collectDiagnostics.mockReturnValueOnce(refresh.promise);
    await user.click(screen.getByRole('link', { name: '端末・容量' }));
    expect(diagnosticPage().getByRole('status')).toHaveTextContent('取得中');
    await user.click(screen.getByRole('link', { name: 'Project' }));
    const fieldB = nameField(); await user.click(fieldB);
    await act(async () => { refresh.reject(new Error('PRIVATE_NATIVE_PATH')); });
    expect(nameField()).toBe(fieldB); expect(fieldB).toHaveFocus(); expect(fieldB).toHaveValue('下書き B');
    expect(fieldB).toBeEnabled(); expect(projectStatus()).toHaveTextContent('未保存');
    await user.click(screen.getByRole('link', { name: 'ライセンス・情報' }));
    expect(page.querySelector('input, textarea')).toBeNull(); expect(page.querySelector('.settings-page__content')!.firstElementChild).toBe(slot);
    await user.click(screen.getByRole('link', { name: 'Project' })); expect(nameField()).toHaveValue('下書き B');
    await user.click(headerLink('Project 一覧'));
    const freshA = changed(a, { name: '外部更新の保存名', description: '外部更新の説明', workspacePath: 'G:\\更新された現在root' });
    api.get.mockResolvedValueOnce(ok(freshA)); await enter(user, a, true);
    expect(screen.getByRole('region', { name: '設定' })).toBe(page);
    expect(nameField()).toHaveValue('下書き A'); expect(screen.getByText(freshA.project.workspacePath)).toBeVisible();
    expect(appHeader()).toHaveTextContent(freshA.project.name);
    await user.click(screen.getByRole('button', { name: '説明を編集（任意）' }));
    expect(screen.getByRole('textbox', { name: '説明（任意）' })).toHaveValue('  A の下書き\n説明  ');
    await user.click(settingsBack()); await enter(user, b, true);
    expect(nameField()).toHaveValue('下書き B');
    await user.click(screen.getByRole('button', { name: '説明を編集（任意）' }));
    expect(screen.getByRole('textbox', { name: '説明（任意）' })).toHaveValue('B の下書き説明');
    expect(api.get).toHaveBeenCalledTimes(4); expect(api.update).not.toHaveBeenCalled();
    expect(api.move).not.toHaveBeenCalled(); expect(api.recover).not.toHaveBeenCalled();
    expect(readDiagnostics).toHaveBeenCalledTimes(1); expect(collectDiagnostics).toHaveBeenCalledTimes(2);
  });

  it('publishes confirmed saves to the selected Project and reloads the actual list without resetting tabs', async () => {
    const user = userEvent.setup(); render(<AppShell />); await enter(user);
    await user.click(screen.getByRole('tab', { name: '学習' }));
    await user.click(screen.getByRole('button', { name: 'Project 設定' }));
    const saved = changed(a, { name: '保存後の名前', updatedAt: '2026-09-12T04:00:00.000Z' }, true);
    api.update.mockResolvedValueOnce(ok(saved));
    fireEvent.change(nameField(), { target: { value: '  保存後の名前  ' } });
    await user.click(screen.getByRole('button', { name: 'Project情報を保存' }));
    expect(api.update).toHaveBeenCalledExactlyOnceWith({ id: a.project.id, name: saved.project.name,
      description: a.project.description, taskType: a.project.taskType });
    expect(projectStatus()).toHaveTextContent('Project情報：保存済み');
    expect(nameField()).toHaveValue(saved.project.name); expect(screen.getByRole('radio', { name: '画像分類' })).toBeDisabled();
    expect(appHeader()).toHaveTextContent(saved.project.name);
    await user.click(settingsBack());
    expect(screen.getByRole('heading', { level: 1, name: saved.project.name })).toBeVisible();
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('学習');
    expect(screen.getByRole('button', { name: 'Project 設定' })).toHaveFocus();
    api.list.mockResolvedValueOnce(ok([saved, b])); await user.click(headerLink('Project 一覧'));
    expect(await screen.findByRole('button', { name: rowName(saved) })).toBeVisible();
    expect(api.list).toHaveBeenCalledTimes(2); expect(api.get).toHaveBeenCalledTimes(1);
  });

  it('does not mix an abandoned A save into B or acknowledge it on A return before explicit verification', async () => {
    const task = deferred<ProjectUpdateResponse>(); api.update.mockReturnValueOnce(task.promise);
    const savedA = changed(a, { name: '遅延保存 A' });
    const user = userEvent.setup(); render(<AppShell />); await enter(user, a, true);
    fireEvent.change(nameField(), { target: { value: savedA.project.name } });
    await user.click(screen.getByRole('button', { name: 'Project情報を保存' }));
    await user.click(headerLink('Project 一覧')); await enter(user, b, true);
    await act(async () => { task.resolve(ok(savedA)); });
    expect(nameField()).toHaveValue(b.project.name); expect(appHeader()).toHaveTextContent(b.project.name);
    expect(api.get).toHaveBeenCalledTimes(2);
    await user.click(headerLink('Project 一覧')); await enter(user, a, true);
    expect(nameField()).toHaveValue(savedA.project.name);
    expect(projectStatus()).toHaveTextContent('保存結果不明');
    expect(screen.getByRole('button', { name: 'Project情報を保存' })).toBeDisabled();
    expect(appHeader()).toHaveTextContent(a.project.name);
    api.get.mockResolvedValueOnce(ok(savedA)); await user.click(screen.getByRole('button', { name: '保存結果を確認' }));
    expect(appHeader()).toHaveTextContent(savedA.project.name);
    expect(projectStatus()).toHaveTextContent('保存済みの内容を確認しました');
    expect(api.get).toHaveBeenCalledTimes(4); expect(api.update).toHaveBeenCalledTimes(1);
  });

  it('uses the native selection token exactly once and enters the validated created snapshot, not an invented root/name', async () => {
    const user = userEvent.setup(); render(<AppShell />); await prepareCreate(user);
    await user.click(screen.getByRole('radio', { name: '物体検出' }));
    await describeProject(user, '  任意説明 🌾\n二行目  ');
    const form = screen.getByRole('form', { name: 'Project を作成' });
    const button = screen.getByRole('button', { name: '作成' });
    act(() => { button.click(); fireEvent.submit(form); button.click(); });
    expect(await screen.findByRole('heading', { level: 1, name: c.project.name })).toBeVisible();
    expect(api.create).toHaveBeenCalledExactlyOnceWith({ name: '入力した名前', description: '  任意説明 🌾\n二行目  ',
      taskType: 'detection', parentToken: token });
    expect(api.pickParent).toHaveBeenCalledExactlyOnceWith({ purpose: 'create' });
    expect(api.get).not.toHaveBeenCalled(); expect(appHeader()).toHaveTextContent(c.project.name);
    await user.click(screen.getByRole('button', { name: 'Project 設定' }));
    expect(screen.getByText(c.project.workspacePath)).toBeVisible(); expect(nameField()).toHaveValue(c.project.name);
    expect(screen.queryByText(`${parentPath}\\${c.project.id}`)).toBeNull();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('keeps create name/description/token and the same hidden unstyled form while editing an existing Project in settings', async () => {
    const user = userEvent.setup(); render(<AppShell />); await enter(user);
    await user.click(headerLink('Project 一覧')); await prepareCreate(user);
    await user.click(screen.getByRole('radio', { name: '物体検出' }));
    await user.click(screen.getByRole('button', { name: '説明を編集（任意）' }));
    const form = screen.getByRole('form', { name: 'Project を作成' });
    const description = screen.getByRole('textbox', { name: '説明（任意）' });
    fireEvent.change(description, { target: { value: '作成 draft の説明' } });
    await user.click(headerLink('設定'));
    expect(form).toBeInTheDocument(); expect(form).not.toBeVisible();
    expect(form.parentElement).toHaveAttribute('hidden'); expect(form.parentElement).not.toHaveAttribute('class');
    expect(form.parentElement).not.toHaveAttribute('style'); expect(description).not.toHaveFocus();
    expect(screen.getAllByRole('form')).toHaveLength(1); expect(nameField()).toHaveValue(a.project.name);
    fireEvent.change(nameField(), { target: { value: '設定 draft A' } });
    await user.click(screen.getByRole('link', { name: 'ライセンス・情報' }));
    expect(screen.queryByRole('textbox')).toBeNull();
    await user.click(settingsBack());
    expect(screen.getByRole('form', { name: 'Project を作成' })).toBe(form);
    expect(screen.getByRole('textbox', { name: '説明（任意）' })).toBe(description);
    expect(description).toHaveValue('作成 draft の説明'); expect(headerLink('設定')).toHaveFocus();
    await user.click(screen.getByRole('button', { name: '入力項目に戻る' }));
    expect(nameField()).toHaveValue('  入力した名前  '); expect(screen.getByText(parentPath)).toBeVisible();
    expect(screen.getByRole('radio', { name: '物体検出' })).toBeChecked();
    expect(api.pickParent).toHaveBeenCalledTimes(1); expect(api.update).not.toHaveBeenCalled(); expect(api.create).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '作成' }));
    expect(api.create.mock.calls[0][0].description).toBe('作成 draft の説明');
    expect(api.create.mock.calls[0][0].parentToken).toBe(token);
  });

  it('accepts a still-active create under settings without stealing the page or focus, and returns to the new workspace', async () => {
    const task = deferred<ProjectCreateResponse>(); api.create.mockReturnValueOnce(task.promise);
    const user = userEvent.setup(); render(<AppShell />); await prepareCreate(user);
    const form = screen.getByRole('form', { name: 'Project を作成' });
    await user.click(screen.getByRole('button', { name: '作成' }));
    expect(within(form).getByRole('status')).toHaveTextContent('作成処理は取り消されません');
    await user.click(headerLink('設定')); await user.click(screen.getByRole('link', { name: 'ライセンス・情報' }));
    const page = screen.getByRole('region', { name: '設定' }), link = screen.getByRole('link', { name: 'ライセンス・情報' });
    expect(form).toBeInTheDocument(); expect(form).not.toBeVisible();
    await act(async () => { task.resolve(ok(c)); });
    expect(screen.getByRole('region', { name: '設定' })).toBe(page); expect(link).toHaveFocus();
    expect(screen.getByRole('heading', { name: 'ライセンス・情報' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: c.project.name })).toBeNull();
    expect(appHeader()).toHaveTextContent('Project 未選択'); expect(form).not.toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Project' }));
    expect(screen.getByText('Projectは選択されていません。')).toBeVisible(); expect(screen.queryByRole('form')).toBeNull();
    await user.click(settingsBack());
    expect(screen.getByRole('heading', { level: 1, name: c.project.name })).toBeVisible();
    expect(appHeader()).toHaveTextContent(c.project.name);
    expect(headerLink('設定')).toHaveFocus(); expect(api.create).toHaveBeenCalledTimes(1);
    expect(api.list).toHaveBeenCalledTimes(1); expect(api.get).not.toHaveBeenCalled();
  });

  it('keeps editing A and its description focus through C completion, saves only A, then selects C on close and retains later A drafts', async () => {
    const task = deferred<ProjectCreateResponse>(); api.create.mockReturnValueOnce(task.promise);
    const user = userEvent.setup(); render(<AppShell />); await enter(user);
    await user.click(headerLink('Project 一覧')); await prepareCreate(user);
    const createForm = screen.getByRole('form', { name: 'Project を作成' });
    await user.click(screen.getByRole('button', { name: '作成' })); await user.click(headerLink('設定'));
    const panel = screen.getByRole('form', { name: 'Project 設定' });
    fireEvent.change(nameField(), { target: { value: 'A の編集中名' } });
    await user.click(screen.getByRole('button', { name: '説明を編集（任意）' }));
    const description = screen.getByRole('textbox', { name: '説明（任意）' });
    fireEvent.change(description, { target: { value: 'A の編集中説明' } }); expect(description).toHaveFocus();
    await act(async () => { task.resolve(ok(c)); });
    expect(screen.getByRole('form', { name: 'Project 設定' })).toBe(panel);
    expect(screen.getByRole('textbox', { name: '説明（任意）' })).toBe(description);
    expect(description).toHaveValue('A の編集中説明'); expect(description).toHaveFocus(); expect(description).toBeEnabled();
    expect(appHeader()).toHaveTextContent(a.project.name); expect(createForm).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: c.project.name })).toBeNull();
    fireEvent.change(description, { target: { value: 'A の継続説明' } });
    await user.click(screen.getByRole('button', { name: '入力項目に戻る' })); expect(nameField()).toHaveValue('A の編集中名');
    const savedA = changed(a, { name: 'A の編集中名', description: 'A の継続説明' }); api.update.mockResolvedValueOnce(ok(savedA));
    await user.click(screen.getByRole('button', { name: 'Project情報を保存' }));
    expect(api.update).toHaveBeenCalledExactlyOnceWith({ id: a.project.id, name: savedA.project.name,
      description: savedA.project.description, taskType: a.project.taskType });
    expect(appHeader()).toHaveTextContent(savedA.project.name); expect(projectStatus()).toHaveTextContent('保存済み');
    fireEvent.change(nameField(), { target: { value: 'A 保存後の下書き' } });
    await user.click(screen.getByRole('button', { name: '説明を編集（任意）' }));
    fireEvent.change(screen.getByRole('textbox', { name: '説明（任意）' }), { target: { value: 'A の未保存説明' } });
    await user.click(settingsBack());
    expect(screen.getByRole('heading', { level: 1, name: c.project.name })).toBeVisible(); expect(appHeader()).toHaveTextContent(c.project.name);
    expect(headerLink('設定')).toHaveFocus(); expect(screen.queryByRole('form')).toBeNull();
    api.list.mockResolvedValue(ok([savedA, b, c])); api.get.mockResolvedValueOnce(ok(savedA));
    await user.click(headerLink('Project 一覧')); await enter(user, savedA, true);
    expect(screen.getByRole('textbox', { name: '説明（任意）' })).toHaveValue('A の未保存説明');
    await user.click(screen.getByRole('button', { name: '入力項目に戻る' })); expect(nameField()).toHaveValue('A 保存後の下書き');
    expect(appHeader()).toHaveTextContent(savedA.project.name); expect(api.create).toHaveBeenCalledTimes(1);
    expect(api.get.mock.calls).toEqual([[{ projectId: a.project.id }], [{ projectId: a.project.id }]]);
  });

  it('clears a held C return target on explicit header-list navigation and never selects it in later unrelated settings', async () => {
    const task = deferred<ProjectCreateResponse>(); api.create.mockReturnValueOnce(task.promise);
    const user = userEvent.setup(); render(<AppShell />); await enter(user);
    await user.click(headerLink('Project 一覧')); await prepareCreate(user);
    await user.click(screen.getByRole('button', { name: '作成' })); await user.click(headerLink('設定'));
    fireEvent.change(nameField(), { target: { value: '保持する A' } });
    await act(async () => { task.resolve(ok(c)); }); expect(appHeader()).toHaveTextContent(a.project.name);
    api.list.mockResolvedValue(ok([a, b, c])); await user.click(headerLink('Project 一覧'));
    expect(await screen.findByRole('button', { name: rowName(c) })).toBeVisible(); expect(screen.getByRole('main')).toHaveFocus();
    expect(appHeader()).toHaveTextContent(a.project.name);
    await user.click(headerLink('設定')); expect(nameField()).toHaveValue('保持する A'); await user.click(settingsBack());
    expect(screen.getByRole('heading', { level: 1, name: 'Project 一覧' })).toBeVisible(); expect(headerLink('設定')).toHaveFocus();
    expect(appHeader()).toHaveTextContent(a.project.name); expect(screen.queryByRole('heading', { name: c.project.name })).toBeNull();
    expect(api.create).toHaveBeenCalledTimes(1); expect(api.get).toHaveBeenCalledTimes(1); expect(api.update).not.toHaveBeenCalled();
  });

  it('warns on header departure during create and ignores its late completion even after a new create flow', async () => {
    const task = deferred<ProjectCreateResponse>(); api.create.mockReturnValueOnce(task.promise);
    const user = userEvent.setup(); render(<AppShell />); await prepareCreate(user);
    const oldForm = screen.getByRole('form', { name: 'Project を作成' });
    await user.click(screen.getByRole('button', { name: '作成' }));
    expect(screen.getByRole('button', { name: '結果未確認のまま一覧へ戻る' })).toBeEnabled();
    await user.click(headerLink('Project 一覧'));
    expect(oldForm).not.toBeInTheDocument(); expect(screen.getByText(/作成を送信していた場合、処理は取り消されません/)).toBeVisible();
    await screen.findByRole('button', { name: rowName(a) });
    await user.click(screen.getByRole('button', { name: 'Project を作成' }));
    expect(nameField()).toHaveValue(''); expect(screen.getByText('未選択')).toBeVisible();
    fireEvent.change(nameField(), { target: { value: '次の入力' } });
    await act(async () => { task.resolve(ok(c)); });
    expect(screen.getByRole('heading', { name: 'Project を作成' })).toBeVisible(); expect(nameField()).toHaveValue('次の入力');
    expect(appHeader()).toHaveTextContent('Project 未選択');
    expect(api.create).toHaveBeenCalledTimes(1); expect(api.pickParent).toHaveBeenCalledTimes(1);
    expect(api.get).not.toHaveBeenCalled();
  });

  it.each(['failed', 'invalid'] as const)('requires explicit list verification after an uncertain %s create, including settings round trips', async (kind) => {
    api.create.mockResolvedValueOnce(kind === 'failed' ? failed : ok({ project: c.project }) as unknown as ProjectCreateResponse);
    const user = userEvent.setup(); const { container } = render(<AppShell />); await prepareCreate(user);
    await user.click(screen.getByRole('button', { name: '作成' }));
    expect(within(screen.getByRole('form', { name: 'Project を作成' })).getByRole('status'))
      .toHaveTextContent('作成結果を確認できません。一覧で状態を確認してください。');
    expect(screen.getByRole('button', { name: '作成' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '親フォルダーを選択' })).toBeDisabled();
    await user.click(headerLink('設定')); await user.click(settingsBack());
    fireEvent.submit(screen.getByRole('form', { name: 'Project を作成' }));
    expect(api.create).toHaveBeenCalledTimes(1); expect(api.list).toHaveBeenCalledTimes(1); expect(api.get).not.toHaveBeenCalled();
    const list = deferred<ProjectListResponse>(); api.list.mockReturnValueOnce(list.promise);
    await user.click(screen.getByRole('button', { name: '一覧で確認' }));
    expect(within(screen.getByRole('region', { name: 'Project 一覧' })).getByRole('status'))
      .toHaveTextContent('取得中 — 前回の一覧（最新ではありません）');
    expect(container).not.toHaveTextContent(/0件|ロールバック|取消済み|作成しました/);
    await act(async () => { list.resolve(ok([c])); });
    expect(screen.getByRole('button', { name: rowName(c) })).toBeVisible();
    expect(appHeader()).toHaveTextContent('Project 未選択');
    await enter(user, c); expect(api.get).toHaveBeenCalledExactlyOnceWith({ projectId: c.project.id });
    expect(api.create).toHaveBeenCalledTimes(1);
  });

  it('publishes the actual root of a partial move with neutral cleanup status and never automatically recovers', async () => {
    const moved = changed(a, { name: 'DB の現在名', workspacePath: 'H:\\DBの現在root' });
    api.move.mockResolvedValueOnce(ok({ ...moved, cleanupStatus: 'source-retained', cleanupError: { code: 'PROJECT_SOURCE_CLEANUP_FAILED' } }));
    api.recover.mockResolvedValueOnce(ok({ ...moved, cleanupStatus: 'none' }));
    const user = userEvent.setup(); render(<AppShell />); await enter(user, a, true);
    await user.click(screen.getByRole('button', { name: '移動先の親フォルダーを選択' }));
    await user.click(screen.getByRole('button', { name: '保存場所を変更' }));
    expect(api.move).toHaveBeenCalledExactlyOnceWith({ projectId: a.project.id, parentToken: token });
    expect(screen.getByText(moved.project.workspacePath)).toBeVisible();
    expect(screen.getByText(PROJECT_SOURCE_CLEANUP_FAILED_MESSAGE)).toBeVisible();
    expect(projectStatus()).toHaveTextContent('保存先はDBの現在値です。移動・回収状態の確認が必要です。');
    expect(screen.getByRole('form')).not.toHaveTextContent(/移動しました|移動済み|回収は完了/);
    expect(appHeader()).toHaveTextContent(moved.project.name);
    expect(screen.getByRole('button', { name: '移動先の親フォルダーを選択' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '保存場所を変更' })).toBeDisabled(); expect(api.recover).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '旧領域の復旧を確認' }));
    expect(projectStatus()).toHaveTextContent('回収完了を意味しません');
    expect(api.recover).toHaveBeenCalledExactlyOnceWith({ projectId: a.project.id });
    await user.click(settingsBack()); await user.click(headerLink('設定'));
    expect(screen.getByText(moved.project.workspacePath)).toBeVisible(); expect(api.move).toHaveBeenCalledTimes(1);
  });

  it('preserves every real workflow tab across header settings, with one current h1 and no fictitious future controls', async () => {
    const user = userEvent.setup(); const { container } = render(<AppShell />); await enter(user);
    const main = screen.getByRole('main');
    for (const { id, label } of workflowTabs) {
      const tab = screen.getByRole('tab', { name: label }); await user.click(tab);
      expect(tab).toHaveFocus(); expect(screen.getByRole('main')).toBe(main);
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(id === 'import' ? 2 : 1);
      expect(screen.getByRole('heading', { level: 1, name: a.project.name })).toBeVisible();
      expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
      const panel = screen.getByRole('tabpanel', { name: label });
      expect(tab).toHaveAttribute('aria-controls', `workflow-panel-${id}`);
      expect(panel).toHaveAttribute('aria-labelledby', `workflow-tab-${id}`); expect(panel).toHaveAttribute('tabindex', '0');
      if (id === 'import') expect(within(panel).getByRole('heading', { name: '画像を取り込む' })).toBeVisible();
      else { expect(panel).toHaveTextContent('未実装'); expect(within(panel).getAllByRole('heading', { level: 2 })).toHaveLength(1); }
      const panels = screen.getAllByRole('tabpanel', { hidden: true }); expect(panels).toHaveLength(5);
      for (const other of panels) if (other !== panel) {
        expect(other).toHaveAttribute('hidden');
        if (other.id === 'workflow-panel-import') expect(other.querySelector('.import-page')).not.toBeNull();
        else expect(other).toBeEmptyDOMElement();
      }
      if (id === 'reports') {
        expect(panel).toHaveTextContent('概要／データ／評価／Trial／画像／環境／ライセンスの7レポートタブ');
        expect(within(panel).queryByRole('tablist')).toBeNull(); expect(within(panel).queryByRole('button')).toBeNull();
      }
      if (id === 'annotations') { expect(panel).toHaveTextContent('補助ジョブは未実装'); expect(screen.queryByRole('link', { name: '補助ジョブ' })).toBeNull(); }
      if (id === 'camera') expect(panel).toHaveTextContent('カメラにはアクセスしません');
      expect(container.querySelector('form, textarea, video, audio, canvas, iframe, img, [contenteditable]')).toBeNull();
      expect(container.querySelectorAll('.import-page input').length).toBeGreaterThan(0);
      expect(screen.queryByRole('dialog')).toBeNull(); expect(screen.queryByRole('progressbar')).toBeNull();
      const opener = headerLink('設定'); await user.click(opener);
      expect(document.getElementById('settings-heading')).toHaveFocus(); expect(opener).toHaveAttribute('aria-current', 'page');
      expect(screen.queryByRole('tabpanel')).toBeNull();
      for (const hiddenPanel of screen.getAllByRole('tabpanel', { hidden: true })) expect(hiddenPanel).not.toBeVisible();
      await user.click(settingsBack());
      expect(screen.getByRole('tab', { name: label, selected: true })).toBeVisible(); expect(opener).toHaveFocus();
      expect(headerLink('Project 一覧')).not.toHaveAttribute('aria-current'); expect(opener).not.toHaveAttribute('aria-current');
    }
    expect(api.get).toHaveBeenCalledTimes(1);
    for (const method of ['create', 'update', 'pickParent', 'move', 'recover'] as const) expect(api[method]).not.toHaveBeenCalled();
    expect(within(screen.getByRole('contentinfo')).getByRole('button', { name: 'ジョブ一覧' })).toBeEnabled();
    expect(within(screen.getByRole('contentinfo')).queryByRole('button', { name: /をキャンセル/ })).toBeNull();
  });

  it('lets Workspace restore only its fixed accepted opener and does not substitute an old opener for a later header return', async () => {
    const user = userEvent.setup(); render(<AppShell />); await enter(user);
    const focusMain = vi.spyOn(screen.getByRole('main'), 'focus');
    for (const [tab, button, category, id] of [
      ['学習', 'Project 設定', 'project', 'project-workspace-project-settings'],
      ['教師データ', 'ラベル定義', 'labels', 'project-workspace-labels-settings'],
      ['カメラで試す', '推論設定', 'inference', 'project-workspace-inference-settings'],
    ]) {
      await user.click(screen.getByRole('tab', { name: tab }));
      const opener = screen.getByRole('button', { name: button }); expect(opener).toHaveAttribute('id', id);
      await user.click(opener); expect(screen.getByRole('link', { current: 'page', name: category === 'project' ? 'Project' : button.replace('設定', '') })).toBeVisible();
      await user.click(screen.getByRole('link', { name: 'ライセンス・情報' })); await user.click(headerLink('設定'));
      focusMain.mockClear(); await user.click(settingsBack());
      expect(screen.getByRole('button', { name: button })).toHaveFocus(); expect(focusMain).not.toHaveBeenCalled();
    }
    await user.click(screen.getByRole('tab', { name: '教師データ' }));
    await user.click(screen.getByRole('button', { name: 'ラベル定義' })); await user.click(headerLink('Project 一覧'));
    expect(screen.getByRole('main')).toHaveFocus();
    await user.click(headerLink('設定')); await user.click(settingsBack());
    expect(screen.getByRole('heading', { name: 'Project 一覧' })).toBeVisible();
    expect(headerLink('設定')).toHaveFocus(); expect(screen.queryByRole('tablist')).toBeNull();
  });

  it.each([['', 19], ['Project2', 24]] as const)('retains search "%s" and an off-first-page ID through settings categories, fresh sorting and workspace return', async (query, index) => {
    const values = pagedProjects(), target = values[index]; api.list.mockResolvedValue(ok(values));
    const user = userEvent.setup(); render(<AppShell />); await screen.findByRole('button', { name: rowName(values[0]) });
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: query } });
    const searchId = screen.getByRole('searchbox').id;
    expect(screen.queryByRole('button', { name: rowName(target, true) })).toBeNull();
    for (let step = 0; step < 5 && !screen.queryByRole('button', { name: rowName(target, true) }); step++) {
      await user.click(screen.getByRole('button', { name: 'Project: 次のページ' }));
    }
    const original = screen.getByRole('button', { name: rowName(target, true) });
    const confirmed = changed(target, { description: 'get で確認した説明', workspacePath: 'G:\\確認した保存先' });
    api.get.mockResolvedValueOnce(ok(confirmed)); await enter(user, target, true);
    expect(api.get).toHaveBeenCalledExactlyOnceWith({ projectId: target.project.id });
    expect(screen.getByText(confirmed.project.workspacePath)).toBeVisible();
    expect(document.querySelector('.project-list-page')).toBeNull(); expect(original).not.toBeInTheDocument();
    const renamed = changed(confirmed, { name: `${target.project.name} 設定後`, updatedAt: '2026-09-12T05:00:00.000Z' });
    api.update.mockResolvedValueOnce(ok(renamed)); fireEvent.change(nameField(), { target: { value: renamed.project.name } });
    await user.click(screen.getByRole('button', { name: 'Project情報を保存' }));
    await user.click(screen.getByRole('link', { name: 'ライセンス・情報' })); await user.click(screen.getByRole('link', { name: 'Project' }));
    expect(nameField()).toHaveValue(renamed.project.name); expect(api.list).toHaveBeenCalledTimes(1);
    const list = deferred<ProjectListResponse>(), refreshed = values.map((value) => value.project.id === target.project.id ? renamed : value);
    api.list.mockReturnValueOnce(list.promise).mockResolvedValue(ok(refreshed)); await user.click(settingsBack());
    expect(screen.getByRole('searchbox')).toHaveValue(query); expect(screen.getByRole('searchbox')).toHaveAttribute('id', searchId);
    const stale = screen.getByRole('button', { name: rowName(target, true) });
    expect(stale).not.toHaveFocus(); expect(screen.getByRole('main')).toHaveFocus();
    expect(stale.closest('[aria-busy]')).toHaveAttribute('aria-busy', 'true');
    await act(async () => { list.resolve(ok(refreshed)); });
    const restored = await screen.findByRole('button', { name: rowName(renamed, true) }); await waitFor(() => expect(restored).toHaveFocus());
    expect(restored.closest('[aria-busy]')).toHaveAttribute('aria-busy', 'false');
    expect(restored.closest('li')).toHaveAttribute('data-project-id', target.project.id); expect(screen.getByRole('searchbox')).toHaveValue(query);
    api.get.mockResolvedValueOnce(ok(renamed)); await enter(user, renamed); await user.click(headerLink('Project 一覧'));
    await waitFor(() => expect(listStatus()).toHaveTextContent(/^取得済み$/)); expect(screen.getByRole('searchbox')).toHaveValue(query);
    expect(screen.getByRole('searchbox')).toHaveAttribute('id', searchId); expect(screen.getByRole('button', { name: rowName(renamed) })).toBeVisible();
    expect(api.list).toHaveBeenCalledTimes(3); expect(api.get).toHaveBeenCalledTimes(2);
  });

  it('keeps the query and falls back to main when a renamed off-first-page target no longer matches it', async () => {
    const values = pagedProjects(), target = values[24]; api.list.mockResolvedValue(ok(values));
    const user = userEvent.setup(); render(<AppShell />); await screen.findByRole('button', { name: rowName(values[0]) });
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Project2' } });
    expect(screen.queryByRole('button', { name: rowName(target, true) })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Project: 最後のページ' }));
    api.get.mockResolvedValueOnce(ok(target)); await enter(user, target, true);
    const renamed = changed(target, { name: '検索範囲外', description: '' }); api.update.mockResolvedValueOnce(ok(renamed));
    fireEvent.change(nameField(), { target: { value: renamed.project.name } }); await user.click(screen.getByRole('button', { name: 'Project情報を保存' }));
    const list = deferred<ProjectListResponse>(); api.list.mockReturnValueOnce(list.promise); await user.click(settingsBack());
    expect(screen.getByRole('main')).toHaveFocus();
    expect(screen.getByRole('button', { name: rowName(target, true) }).closest('[aria-busy]')).toHaveAttribute('aria-busy', 'true');
    await act(async () => { list.resolve(ok([...values.slice(0, 24), renamed])); });
    expect(listStatus()).toHaveTextContent(/^取得済み$/); expect(screen.getByRole('main')).toHaveFocus();
    expect(screen.getByRole('searchbox')).toHaveValue('Project2'); expect(screen.queryByRole('button', { name: rowName(renamed, true) })).toBeNull();
    expect(screen.getByRole('button', { name: 'Project: 前のページ' })).toBeDisabled(); expect(api.list).toHaveBeenCalledTimes(2);
  });

  it('restores the matching row settings button after an asynchronous fresh list, even if its name and ordering changed', async () => {
    const user = userEvent.setup(); render(<AppShell />);
    const original = await screen.findByRole('button', { name: rowName(a, true) }); await user.click(original);
    const renamed = changed(a, { name: '設定で変更した名前', updatedAt: '2026-09-12T00:00:00.000Z' });
    api.update.mockResolvedValueOnce(ok(renamed)); fireEvent.change(nameField(), { target: { value: renamed.project.name } });
    await user.click(screen.getByRole('button', { name: 'Project情報を保存' }));
    const list = deferred<ProjectListResponse>(); api.list.mockReturnValueOnce(list.promise);
    await user.click(settingsBack()); expect(original).not.toBeInTheDocument(); expect(screen.getByRole('main')).toHaveFocus();
    await act(async () => { list.resolve(ok([b, renamed])); });
    const restored = await screen.findByRole('button', { name: rowName(renamed, true) });
    await waitFor(() => expect(restored).toHaveFocus());
    expect(restored).not.toBe(original); expect(restored.closest('li')).toHaveAttribute('data-project-id', a.project.id);
    expect(api.get).toHaveBeenCalledTimes(1); expect(api.list).toHaveBeenCalledTimes(2);
  });

  it('abandons delayed row focus when the user focuses elsewhere or starts a newer navigation', async () => {
    const user = userEvent.setup(); render(<AppShell />); await enter(user, a, true);
    const first = deferred<ProjectListResponse>(); api.list.mockReturnValueOnce(first.promise); await user.click(settingsBack());
    const search = screen.getByRole('searchbox', { name: '名前・説明を検索' }); await user.click(search);
    await act(async () => { first.resolve(ok([a, b])); }); expect(search).toHaveFocus();
    await enter(user, a, true);
    const second = deferred<ProjectListResponse>(); api.list.mockReturnValueOnce(second.promise); await user.click(settingsBack());
    await user.click(headerLink('設定'));
    await act(async () => { second.resolve(ok([a, b])); });
    expect(document.getElementById('settings-heading')).toHaveFocus();
    await user.click(settingsBack()); await screen.findByRole('button', { name: rowName(a) });
    expect(headerLink('設定')).toHaveFocus();
  });

  it('keeps native settings categories, full local notices and product version in one stable information page', async () => {
    const user = userEvent.setup(); const { container } = render(<AppShell />);
    const main = screen.getByRole('main'); await user.click(headerLink('設定'));
    const page = screen.getByRole('region', { name: '設定' });
    expect(screen.getByRole('heading', { level: 1, name: '設定' })).toHaveFocus();
    await user.tab(); expect(settingsBack()).toHaveFocus();
    await user.tab(); expect(screen.getByRole('link', { name: 'Project' })).toHaveFocus();
    await user.tab(); expect(screen.getByRole('link', { name: 'ラベル定義' })).toHaveFocus();
    expect(screen.getByRole('heading', { level: 2, name: 'Project' })).toBeVisible();
    await user.keyboard('{Enter}'); expect(screen.getByRole('link', { name: 'ラベル定義' })).toHaveFocus();
    const navigation = screen.getByRole('navigation', { name: '設定カテゴリ' });
    expect(within(navigation).getAllByRole('link').map((link) => link.textContent)).toEqual(['Project', 'ラベル定義', '推論', '端末・容量', 'ライセンス・情報']);
    for (const { id, label } of settingsCategories) {
      const link = within(navigation).getByRole('link', { name: label }); await user.click(link);
      expect(link).toHaveFocus(); expect(within(navigation).getAllByRole('link', { current: 'page' })).toEqual([link]);
      expect(screen.getByRole('heading', { level: id === 'device' ? 1 : 2, name: label })).toBeVisible();
      expect(page.querySelector('.settings-page__content')).toHaveAttribute('id', `settings-${id}`);
      if (id === 'device') {
        expect(screen.getByRole('tablist', { name: '診断の表示' })).toBeVisible();
        expect(diagnosticPage().getByRole('status')).toHaveTextContent('取得済み');
      } else expect(screen.queryByRole('tablist')).toBeNull();
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1); expect(screen.queryByRole('form')).toBeNull();
      if (['project', 'labels', 'inference'].includes(id)) expect(screen.getByText('Projectは選択されていません。')).toBeVisible();
    }
    expect(PRODUCT_VERSION).toBe(packageMetadata.version);
    const version = screen.getByLabelText(`製品バージョン ${PRODUCT_VERSION}`);
    expect(screen.getAllByLabelText(/^製品バージョン /)).toHaveLength(1); expect(version).toHaveTextContent(`バージョン ${PRODUCT_VERSION}`);
    expect(within(appHeader()).queryByText(/バージョン/)).toBeNull();
    const license = screen.getByLabelText('Fluent System Icons LICENSE'), notice = screen.getByLabelText('Fluent System Icons NOTICE');
    for (const [text, expected, label] of [[license, fluentSystemIconsLicense, 'LICENSE'], [notice, fluentSystemIconsNotice, 'NOTICE']] as const) {
      expect(text).not.toBeVisible(); await user.click(screen.getByText(`Fluent System Icons ${label}を開く`));
      expect(text).toBeVisible(); expect(text.textContent).toBe(expected); expect(text.tagName).toBe('PRE');
      expect(text).toHaveClass('license-text'); expect(text).toHaveAttribute('tabindex', '0'); expect(text.childElementCount).toBe(0);
      await user.tab(); expect(text).toHaveFocus();
    }
    expect(screen.getByText('その他の第三者通知・SBOM・モデル由来の表示は未実装です。')).toBeVisible();
    await user.click(settingsBack());
    expect(page).toHaveAttribute('hidden'); expect(page.style.display).toBe('none'); expect(version).not.toBeVisible();
    expect(headerLink('設定')).toHaveFocus(); expect(screen.getByRole('main')).toBe(main);
    await user.click(headerLink('設定')); expect(screen.getByRole('region', { name: '設定' })).toBe(page);
    expect(screen.getByLabelText('Fluent System Icons LICENSE')).toBe(license); expect(license).toBeVisible(); expect(notice).toBeVisible();
    await user.click(headerLink('Project 一覧'));
    const diagnostics = screen.getByRole('link', { name: '端末・容量を確認' });
    expect(diagnostics).toHaveAttribute('href', '/diagnostics'); expect(diagnostics).toHaveAttribute('id', 'diagnostics-settings-link');
    await user.click(diagnostics); expect(diagnosticPage().getByRole('status')).toHaveTextContent('取得済み');
    expect(within(screen.getByRole('region', { name: 'CPU' })).getByText('診断 fixture CPU')).toBeVisible();
    expect(screen.queryByText('診断・容量確認は未実装です。')).toBeNull();
    await user.click(settingsBack()); expect(screen.getByRole('link', { name: '端末・容量を確認' })).toHaveFocus();
    const ids = Array.from(container.querySelectorAll('[id]'), (element) => element.id); expect(new Set(ids).size).toBe(ids.length);
    expect(api.get).not.toHaveBeenCalled(); expect(collectDiagnostics).toHaveBeenCalledTimes(3);
  });

  it('preserves mouse/keyboard skip focus, manual arrow activation, panel tab stops and keyboard return without URL changes', async () => {
    const user = userEvent.setup(), prevented = vi.fn(); const initialUrl = window.location.href;
    render(<div onClick={(event) => prevented(event.defaultPrevented)}><AppShell /></div>);
    const main = screen.getByRole('main'), skip = screen.getByRole('link', { name: '本文へ移動' });
    expect(skip).toHaveAttribute('href', '#main-content');
    await user.tab(); expect(skip).toHaveFocus(); await user.keyboard('{Enter}');
    expect(main).toHaveFocus(); expect(prevented).toHaveBeenLastCalledWith(true);
    await user.click(skip); expect(main).toHaveFocus(); expect(prevented).toHaveBeenLastCalledWith(true);
    await enter(user); await user.click(screen.getByRole('tab', { name: '取り込む' }));
    await user.keyboard('{End}'); expect(screen.getByRole('tab', { name: 'カメラで試す' })).toHaveFocus();
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('取り込む');
    await user.keyboard('{Home}{ArrowRight}'); expect(screen.getByRole('tab', { name: '教師データ' })).toHaveFocus();
    expect(screen.getByRole('tabpanel', { name: '取り込む' })).toBeVisible();
    await user.keyboard('{Enter}{ArrowRight}'); expect(screen.getByRole('tab', { name: '学習' })).toHaveFocus();
    await user.tab(); expect(screen.getByRole('tabpanel', { name: '教師データ' })).toHaveFocus();
    await user.tab({ shift: true }); expect(screen.getByRole('tab', { name: '教師データ' })).toHaveFocus();
    await user.keyboard('{End}[Space]'); expect(screen.getByRole('tab', { name: 'カメラで試す', selected: true })).toHaveFocus();
    act(() => headerLink('Project 一覧').focus()); await user.keyboard('{Enter}');
    expect(main).toHaveFocus(); expect(headerLink('Project 一覧')).toHaveAttribute('aria-current', 'page');
    await enter(user); expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('カメラで試す');
    expect(window.location.href).toBe(initialUrl); expect(api.get).toHaveBeenCalledTimes(2);
  });
});

describe('AppShell UIR-026 import wiring', () => {
  const choose = () => screen.getByRole('button', { name: 'データを選択して検査' });
  const consent = () => screen.getByRole('checkbox', { name: 'データの利用権利・条件と自分の責任を確認しました' });
  const scanned: ImportPreview = { projectId: a.project.id, jobId: token, mode: 'reference', taskType: 'classification',
    itemCount: 1, sourceBytes: '10', classes: [], issues: [], files: [{ key: 'image-1', displayName: 'fixture.png' }] };
  function scanPorts() {
    imports.start.mockResolvedValue(ok({ status: 'started', token,
      job: { id: token, projectId: a.project.id, kind: 'scan-dataset', status: 'Running',
        createdAt: a.project.createdAt, updatedAt: a.project.updatedAt } }));
    imports.preview.mockResolvedValue(ok(scanned));
  }
  async function chooseReference(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('radio', { name: '参照' }));
    await user.click(screen.getByRole('radio', { name: 'クラス別フォルダー' }));
    await user.click(choose());
  }

  it('snapshots every import/job method once with receivers and starts only explicitly, including native cancel', async () => {
    const commands = { ...imports }, jobCommands = { ...jobs };
    const reads = [...Object.keys(imports).map((key) => {
      const name = key as keyof ImportApi, method = imports[name], read = vi.fn(() => method);
      Object.defineProperty(imports, name, { get: read }); return read;
    }), ...Object.keys(jobs).map((key) => {
      const name = key as keyof JobApi, method = jobs[name], read = vi.fn(() => method);
      Object.defineProperty(jobs, name, { get: read }); return read;
    })];
    const user = userEvent.setup(); const h = render(<StrictMode><AppShell /></StrictMode>);
    await enter(user);
    for (const method of Object.values(commands)) expect(method).not.toHaveBeenCalled();
    for (const method of [jobCommands.list, jobCommands.get, jobCommands.cancel]) expect(method).not.toHaveBeenCalled();
    expect(jobCommands.subscribe).toHaveBeenCalledExactlyOnceWith(a.project.id, expect.any(Function));
    for (const read of reads) expect(read).toHaveBeenCalledTimes(1);
    await chooseReference(user);
    expect(screen.getByText('選択をキャンセルしました。')).toBeVisible();
    expect(commands.start).toHaveBeenCalledExactlyOnceWith({ projectId: a.project.id, mode: 'reference', sourceKind: 'folder' });
    expect(commands.start.mock.contexts).toEqual([imports]);
    h.rerender(<StrictMode><AppShell /></StrictMode>);
    expect(readImports).toHaveBeenCalledTimes(1); expect(readJobs).toHaveBeenCalledTimes(1);
    // Picker cancellation does not change the shell's project-wide subscription.
    expect(commands.preview).not.toHaveBeenCalled(); expect(jobCommands.subscribe).toHaveBeenCalledTimes(1);
    for (const read of reads) expect(read).toHaveBeenCalledTimes(1);
  });

  it('shares the actual scan subscription with the always-visible bar across tabs, settings and the list', async () => {
    scanPorts();
    const preview = deferred<Awaited<ReturnType<ImportApi['preview']>>>();
    imports.preview.mockReturnValueOnce(preview.promise);
    let notify!: (snapshot: JobSnapshot) => void;
    const unsubscribe = vi.fn();
    vi.mocked(jobs.subscribe).mockImplementation(async (_id, listener) => { notify = listener; return unsubscribe; });
    const running: JobSnapshot = {
      job: { id: token, projectId: a.project.id, kind: 'scan-dataset', status: 'Running',
        createdAt: a.project.createdAt, updatedAt: a.project.updatedAt },
      progress: { schemaVersion: 1, projectId: a.project.id, jobId: token, type: 'progress',
        source: 'actual', processed: 3, total: 10 },
      workerCompleted: false,
    };
    vi.mocked(jobs.cancel).mockResolvedValue(ok(running.job));
    const user = userEvent.setup(), mounted = render(<AppShell />);
    await enter(user); await chooseReference(user);
    act(() => notify(running));
    expect(jobs.subscribe).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('progressbar', { name: '画像の検査進捗' })).toHaveAttribute('value', '3');
    const bar = within(screen.getByRole('region', { name: '共通ジョブ' }));
    expect(bar.getByRole('progressbar')).toHaveAttribute('value', '3');
    await user.click(screen.getByRole('tab', { name: '学習' }));
    expect(bar.getByRole('progressbar')).toBeVisible();
    await user.click(headerLink('設定'));
    act(() => notify({ ...running, progress: { ...running.progress!, processed: 7 } }));
    expect(bar.getByRole('progressbar')).toHaveAttribute('value', '7');
    await user.click(settingsBack());
    await user.click(screen.getByRole('tab', { name: '取り込む' }));
    expect(screen.getByRole('progressbar', { name: '画像の検査進捗' })).toHaveAttribute('value', '7');
    await user.click(headerLink('Project 一覧'));
    expect(bar.getByRole('progressbar')).toBeVisible();
    expect(jobs.subscribe).toHaveBeenCalledTimes(1); expect(unsubscribe).not.toHaveBeenCalled();
    await user.click(bar.getByRole('button', { name: /をキャンセル/ }));
    expect(jobs.cancel).toHaveBeenCalledExactlyOnceWith(a.project.id, token);
    expect(bar.getByRole('button', { name: /をキャンセル/ })).toHaveTextContent('キャンセル確認待ち');
    act(() => notify({ ...running, job: { ...running.job, status: 'Cancelled' } }));
    expect(bar.getByText('処理中・待機中のジョブはありません')).toBeVisible();
    await act(async () => preview.resolve({ ok: false, error: { code: 'IMPORT_SCAN_FAILED' } }));
    mounted.unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('opens the job list from the bar, keeps workspace drafts and shares cancel state across navigation', async () => {
    const queued: JobSnapshot = {
      job: { id: token, projectId: a.project.id, kind: 'train', status: 'Queued',
        createdAt: a.project.createdAt, updatedAt: a.project.updatedAt },
      progress: null, workerCompleted: false,
    };
    const stop = vi.fn();
    vi.mocked(jobs.subscribe).mockImplementation(async (id, listener) => {
      if (id === a.project.id) listener(queued);
      return stop;
    });
    vi.mocked(jobs.cancel).mockResolvedValue(ok({ ...queued.job, status: 'Cancelled',
      updatedAt: '2026-09-22T00:00:00.000Z' }));
    const user = userEvent.setup(); render(<AppShell />); await enter(user);
    await user.click(screen.getByRole('radio', { name: '参照' }));
    await user.click(screen.getByRole('button', { name: 'ジョブ一覧' }));
    expect(screen.getByRole('main')).toHaveFocus();
    const workspace = screen.getByRole('heading', { name: a.project.name, hidden: true }).closest('section');
    expect(workspace).not.toBeNull();
    expect(getComputedStyle(workspace!).display).toBe('none');
    expect(screen.getByRole('heading', { name: 'ジョブ一覧' })).toBeVisible();
    expect(screen.getByText('全1件 ／ 待機中1件 ／ 処理中0件')).toBeVisible();
    await user.click(headerLink('設定')); await user.click(settingsBack());
    expect(screen.getByRole('heading', { name: 'ジョブ一覧' })).toBeVisible();
    const list = within(screen.getByRole('region', { name: 'ジョブ一覧' }));
    await user.click(list.getByRole('button', { name: /をキャンセル/ }));
    expect(await list.findByText(/キャンセル済み（Cancelled）/)).toBeVisible();
    expect(jobs.cancel).toHaveBeenCalledExactlyOnceWith(a.project.id, token);
    await user.click(list.getByRole('button', { name: '作業画面に戻る' }));
    expect(screen.getByRole('radio', { name: '参照' })).toBeChecked();
    expect(jobs.subscribe).toHaveBeenCalledTimes(1);
    await user.click(headerLink('Project 一覧')); await enter(user, b);
    await user.click(screen.getByRole('button', { name: 'ジョブ一覧' }));
    expect(screen.getByText('ジョブはありません。')).toBeVisible();
    expect(screen.queryByText(/Job ID/)).not.toBeInTheDocument();
    expect(jobs.subscribe).toHaveBeenCalledTimes(2); expect(stop).toHaveBeenCalledTimes(1);
  });

  it('retains the same preview, mode and rights through settings without rereads or automatic commit', async () => {
    scanPorts(); const user = userEvent.setup(); render(<AppShell />); await enter(user); await chooseReference(user);
    await user.click(consent()); const rightsNode = consent(), page = screen.getByRole('region', { name: '画像を取り込む' });
    await user.click(screen.getByRole('button', { name: 'Project 設定' }));
    fireEvent.change(nameField(), { target: { value: '保持する設定下書き' } });
    expect(page).not.toBeVisible(); await user.click(settingsBack());
    expect(screen.getByRole('button', { name: 'Project 設定' })).toHaveFocus();
    expect(screen.getByRole('region', { name: '画像を取り込む' })).toBe(page);
    expect(consent()).toBe(rightsNode); expect(consent()).toBeChecked();
    expect(screen.getByRole('radio', { name: '参照' })).toBeChecked(); expect(screen.getByText('fixture.png')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Project 設定' })); expect(nameField()).toHaveValue('保持する設定下書き');
    await user.click(settingsBack());
    expect(imports.start).toHaveBeenCalledTimes(1); expect(imports.preview).toHaveBeenCalledTimes(1);
    expect(imports.preview.mock.contexts).toEqual([imports]);
    expect(vi.mocked(jobs.subscribe).mock.contexts).toEqual([jobs]);
    expect(imports.commit).not.toHaveBeenCalled(); expect(imports.discard).not.toHaveBeenCalled();
    expect(readImports).toHaveBeenCalledTimes(1); expect(readJobs).toHaveBeenCalledTimes(1);
  });

  it('recovers a retained preview after saving Project metadata through settings, using service-aligned API ports', async () => {
    // Actual AppShell/ProjectSettingsPanel/ImportPage; this explicit error fixture
    // models the service contract, not actual Main execution (tested separately).
    scanPorts();
    const saved = changed(a, { name: '検査後に保存した名前', updatedAt: '2026-09-13T01:00:00.000Z' });
    api.update.mockResolvedValueOnce(ok(saved));
    imports.commit.mockResolvedValueOnce({ ok: false, error: { code: 'IMPORT_PROJECT_CHANGED' } });
    const user = userEvent.setup(); render(<AppShell />); await enter(user); await chooseReference(user);
    await user.click(consent());
    const page = screen.getByRole('region', { name: '画像を取り込む' }), rightsNode = consent();
    await user.click(screen.getByRole('button', { name: 'Project 設定' }));
    expect(page).not.toBeVisible();
    fireEvent.change(nameField(), { target: { value: saved.project.name } });
    await user.click(screen.getByRole('button', { name: 'Project情報を保存' }));
    expect(api.update).toHaveBeenCalledExactlyOnceWith({ id: a.project.id, name: saved.project.name,
      description: a.project.description, taskType: a.project.taskType });
    expect(api.update.mock.contexts).toEqual([api]);
    expect(projectStatus()).toHaveTextContent('Project情報：保存済み');
    expect(appHeader()).toHaveTextContent(saved.project.name);
    await user.click(settingsBack());
    expect(screen.getByRole('region', { name: '画像を取り込む' })).toBe(page);
    expect(screen.getByRole('heading', { level: 1, name: saved.project.name })).toBeVisible();
    expect(page).toHaveTextContent(`プロジェクト：${saved.project.name}`);
    expect(consent()).toBe(rightsNode); expect(consent()).toBeChecked();
    expect(screen.getByText('fixture.png')).toBeVisible(); expect(choose()).toBeDisabled();
    expect(imports.preview).toHaveBeenCalledTimes(1);
    expect(imports.commit).not.toHaveBeenCalled(); expect(imports.discard).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '取り込む' }));
    expect(imports.commit).toHaveBeenCalledExactlyOnceWith({ projectId: a.project.id, jobId: token, token, rightsAccepted: true });
    expect(within(page).getByRole('alert')).toHaveTextContent('プロジェクトが変更されています。状態を確認してください。');
    expect(consent()).toBeChecked(); expect(screen.getByText('fixture.png')).toBeVisible();
    expect(choose()).toBeDisabled(); expect(imports.discard).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '検査を破棄してやり直す' }));
    expect(imports.discard).toHaveBeenCalledExactlyOnceWith({ projectId: a.project.id, jobId: token, token });
    expect(within(page).getByRole('status')).toHaveTextContent('検査を破棄しました。');
    expect(within(page).queryByRole('alert')).toBeNull(); expect(screen.queryByText('fixture.png')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull(); expect(choose()).toBeEnabled();
    const nextToken = '55555555-5555-4555-8555-555555555555';
    imports.start.mockResolvedValueOnce(ok({ status: 'started', token: nextToken,
      job: { id: nextToken, projectId: saved.project.id, kind: 'scan-dataset', status: 'Running',
        createdAt: saved.project.updatedAt, updatedAt: saved.project.updatedAt } }));
    imports.preview.mockResolvedValueOnce(ok({ ...scanned, jobId: nextToken }));
    await user.click(choose());
    expect(imports.start.mock.calls).toEqual([
      [{ projectId: a.project.id, mode: 'reference', sourceKind: 'folder' }],
      [{ projectId: saved.project.id, mode: 'reference', sourceKind: 'folder' }],
    ]);
    expect(imports.preview).toHaveBeenLastCalledWith({ projectId: saved.project.id, jobId: nextToken, token: nextToken });
    expect(consent()).not.toBeChecked(); expect(screen.getByRole('button', { name: '取り込む' })).toBeDisabled();
    expect(page).toHaveTextContent(`プロジェクト：${saved.project.name}`);
    expect(imports.commit).toHaveBeenCalledTimes(1); expect(imports.discard).toHaveBeenCalledTimes(1);
    expect(imports.start.mock.contexts).toEqual([imports, imports]);
    expect(imports.preview.mock.contexts).toEqual([imports, imports]);
    expect(imports.commit.mock.contexts).toEqual([imports]); expect(imports.discard.mock.contexts).toEqual([imports]);
    expect(api.get).toHaveBeenCalledTimes(1); expect(jobs.cancel).not.toHaveBeenCalled();
    for (const read of [readBridge, readProjects, readImports, readJobs]) expect(read).toHaveBeenCalledTimes(1);
  });

  it.each(['settings', 'tab', 'list', 'other-project'] as const)('handles a pending commit across %s without abort or wrong-Project publication', async (destination) => {
    scanPorts(); const pending = deferred<ImportCommitResponse>(); imports.commit.mockReturnValueOnce(pending.promise);
    const user = userEvent.setup(); render(<AppShell />); await enter(user); await chooseReference(user);
    await user.click(consent()); await user.click(screen.getByRole('button', { name: '取り込む' }));
    expect(imports.commit).toHaveBeenCalledExactlyOnceWith({ projectId: a.project.id, jobId: token, token, rightsAccepted: true });
    expect(imports.commit.mock.contexts).toEqual([imports]);
    if (destination === 'settings') await user.click(headerLink('設定'));
    else if (destination === 'tab') await user.click(screen.getByRole('tab', { name: '教師データ' }));
    else { await user.click(headerLink('Project 一覧')); if (destination === 'other-project') await enter(user, b); }
    await act(async () => { pending.resolve(ok({ status: 'completed', projectId: a.project.id,
      importId: token, workspaceId: token, itemCount: 1, cleanupWarning: true })); });
    expect(imports.discard).not.toHaveBeenCalled(); expect(jobs.cancel).not.toHaveBeenCalled();
    if (destination === 'settings') await user.click(settingsBack());
    if (destination === 'list') await enter(user);
    if (destination !== 'tab') {
      expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('取り込む');
      if (destination === 'other-project') {
        expect(screen.queryByRole('button', { name: '教師データ作成へ' })).toBeNull();
        await user.click(screen.getByRole('tab', { name: '教師データ' }));
      } else await user.click(screen.getByRole('button', { name: '教師データ作成へ' }));
    }
    const panel = screen.getByRole('tabpanel', { name: '教師データ' });
    expect(panel).toHaveTextContent('未実装');
    if (destination === 'other-project') expect(panel).not.toHaveTextContent(token);
    else {
      expect(panel).toHaveTextContent(`取り込み記録：1件 ／ Workspace：${token}`);
      expect(panel).toHaveTextContent('画像は未確認です'); expect(panel).toHaveTextContent('後処理に注意');
    }
    expect(panel).not.toHaveTextContent('確認済み'); expect(api.update).not.toHaveBeenCalled();
  });

  it.each(['imports', 'jobs'] as const)('isolates throwing %s getters without disabling projects or diagnostics', async (domain) => {
    if (domain === 'imports') readImports.mockImplementation(() => { throw new Error('PRIVATE'); });
    else readJobs.mockImplementation(() => { throw new Error('PRIVATE'); });
    const user = userEvent.setup(); render(<AppShell />);
    await waitFor(() => expect(diagnosticStatus()).toHaveTextContent('取得済み')); await enter(user);
    if (domain === 'imports') expect(screen.getByText('取り込み機能に接続できません')).toBeVisible();
    else { await chooseReference(user); expect(screen.getByText('選択をキャンセルしました。')).toBeVisible(); }
    expect(readImports).toHaveBeenCalledTimes(1); expect(readJobs).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledTimes(1); expect(document.body).not.toHaveTextContent('PRIVATE');
  });

  it('does not touch any domain getter on an invalid bridge version', () => {
    Object.defineProperty(window, APP_BRIDGE_KEY, { configurable: true, value: { contractVersion: 99,
      get imports() { return readImports(); }, get jobs() { return readJobs(); },
      get projects() { return readProjects(); }, get diagnostics() { return readDiagnostics(); } } });
    render(<AppShell />);
    for (const read of [readImports, readJobs, readProjects, readDiagnostics]) expect(read).not.toHaveBeenCalled();
  });
});

describe('AppShell (UIR-066C)', () => {
  it.each([false, true])('collects once before a pending list and keeps creation independent, StrictMode=%s', async (strict) => {
    const task = deferred<HardwareDiagnostics>(), list = deferred<ProjectListResponse>();
    collectDiagnostics.mockReturnValueOnce(task.promise); api.list.mockReturnValue(list.promise);
    const user = userEvent.setup();
    const h = render(strict ? <StrictMode><AppShell /></StrictMode> : <AppShell />);
    expect(diagnosticStatus()).toHaveTextContent(/^取得中$/); expect(listStatus()).toHaveTextContent('取得中');
    expect(screen.getAllByRole('status')).toHaveLength(3);
    expect(within(diagnosticSummary()).queryByRole('heading')).toBeNull();
    expect(screen.getByRole('button', { name: 'Project を作成' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '診断を再取得' })).toBeDisabled();
    await waitFor(() => expect(collectDiagnostics).toHaveBeenCalledExactlyOnceWith());
    await act(async () => { task.resolve(hardwareReport()); });
    expect(diagnosticStatus()).toHaveTextContent(/^取得済み$/); expect(listStatus()).toHaveTextContent('取得中');
    expect(diagnosticSummary()).toHaveTextContent(capacityText('8,000 B'));
    expect(screen.getByRole('contentinfo')).toHaveTextContent(`容量：${capacityText('8,000 B')}`);
    expect(screen.getByRole('contentinfo')).toHaveTextContent('診断：取得済み');
    expect(diagnosticSummary()).not.toHaveTextContent(/CPU可|推奨|ExecutionProvider/);
    h.rerender(strict ? <StrictMode><AppShell /></StrictMode> : <AppShell />);
    await prepareCreate(user); await user.click(screen.getByRole('button', { name: '作成' }));
    expect(screen.getByRole('heading', { level: 1, name: c.project.name })).toBeVisible();
    expect(readBridge).toHaveBeenCalledTimes(1); expect(readProjects).toHaveBeenCalledTimes(1);
    expect(readDiagnostics).toHaveBeenCalledTimes(1); expect(collectDiagnostics).toHaveBeenCalledExactlyOnceWith();
    expect(api.create).toHaveBeenCalledTimes(1);
  });

  it.each(['throw', 'reject', 'malformed'] as const)('publishes a sanitized initial %s under StrictMode and retries only explicitly', async (kind) => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    if (kind === 'throw') collectDiagnostics.mockImplementationOnce(() => { throw new Error('PRIVATE_NATIVE_PATH'); });
    else if (kind === 'reject') collectDiagnostics.mockRejectedValueOnce(new Error('PRIVATE_NATIVE_PATH'));
    else collectDiagnostics.mockResolvedValueOnce({ ...hardwareReport(), status: 'partial' }); // Inconsistent group summary.
    const user = userEvent.setup(); const { container } = render(<StrictMode><AppShell /></StrictMode>);
    await waitFor(() => expect(diagnosticStatus()).toHaveTextContent(/^取得失敗$/));
    expect(diagnosticSummary()).toHaveTextContent(capacityText('未取得'));
    expect(diagnosticSummary()).toHaveTextContent('対応レベル：未判定');
    expect(collectDiagnostics).toHaveBeenCalledExactlyOnceWith();
    expect(screen.getByRole('button', { name: 'Project を作成' })).toBeEnabled();
    expect(await screen.findByRole('button', { name: rowName(a) })).toBeVisible();
    await user.click(screen.getByRole('button', { name: '診断を再試行' }));
    await waitFor(() => expect(diagnosticStatus()).toHaveTextContent(/^取得済み$/));
    expect(collectDiagnostics.mock.calls).toEqual([[], []]); expect(readDiagnostics).toHaveBeenCalledTimes(1);
    expect(container).not.toHaveTextContent(/PRIVATE_NATIVE_PATH|Inconsistent observation/);
    expect(consoleError).not.toHaveBeenCalled(); expect(api.create).not.toHaveBeenCalled();
  });

  it.each(['missing-collect', 'diagnostics-getter', 'collect-getter'] as const)(
    'isolates %s from Project capabilities and offers honest unavailable detail with Back, not a fake retry', async (kind) => {
      if (kind === 'missing-collect') readDiagnostics.mockReturnValue({} as AppApi['diagnostics']);
      else if (kind === 'diagnostics-getter') readDiagnostics.mockImplementation(() => { throw new Error('PRIVATE_NATIVE_PATH'); });
      else readDiagnostics.mockReturnValue({ get collect(): AppApi['diagnostics']['collect'] { throw new Error('PRIVATE_NATIVE_PATH'); } });
      const user = userEvent.setup(); const { container } = render(<AppShell />);
      expect(diagnosticStatus()).toHaveTextContent('利用不可');
      expect(within(diagnosticSummary()).queryByRole('button')).toBeNull();
      expect(await screen.findByRole('button', { name: rowName(a) })).toBeVisible();
      const opener = screen.getByRole('link', { name: '端末・容量を確認' }); await user.click(opener);
      expect(diagnosticPage().getByRole('alert')).toHaveTextContent('端末診断に接続できません');
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(screen.getAllByRole('button', { name: '戻る' })).toHaveLength(1);
      expect(diagnosticPage().queryByRole('button', { name: '再取得' })).toBeNull();
      expect(screen.queryByText('診断・容量確認は未実装です。')).toBeNull();
      await user.click(settingsBack()); expect(opener).toHaveFocus();
      await prepareCreate(user); await user.click(screen.getByRole('button', { name: '作成' }));
      expect(screen.getByRole('heading', { level: 1, name: c.project.name })).toBeVisible();
      expect(readBridge).toHaveBeenCalledTimes(1); expect(readDiagnostics).toHaveBeenCalledTimes(1);
      expect(collectDiagnostics).not.toHaveBeenCalled(); expect(container).not.toHaveTextContent('PRIVATE_NATIVE_PATH');
    },
  );

  it('snapshots the diagnostic source and method once, preserving its native receiver through rerenders and explicit calls', async () => {
    const native = vi.fn<AppApi['diagnostics']['collect']>().mockResolvedValue(hardwareReport());
    const readCollect = vi.fn(() => native);
    const source: AppApi['diagnostics'] = Object.freeze({ get collect() { return readCollect(); } });
    readDiagnostics.mockReturnValue(source);
    const user = userEvent.setup(); const h = render(<StrictMode><AppShell /></StrictMode>);
    await waitFor(() => expect(diagnosticStatus()).toHaveTextContent(/^取得済み$/));
    const listCalls = api.list.mock.calls.length;
    readCollect.mockImplementation(() => { throw new Error('REPLACED_METHOD'); });
    readDiagnostics.mockImplementation(() => { throw new Error('REPLACED_SOURCE'); });
    readBridge.mockImplementation(() => { throw new Error('REPLACED_BRIDGE'); });
    h.rerender(<StrictMode><AppShell /></StrictMode>);
    await user.click(screen.getByRole('button', { name: '診断を再取得' }));
    await waitFor(() => expect(diagnosticStatus()).toHaveTextContent(/^取得済み$/));
    expect(api.list).toHaveBeenCalledTimes(listCalls);
    await user.click(screen.getByRole('link', { name: '端末・容量を確認' }));
    expect(diagnosticPage().getByRole('status')).toHaveTextContent('取得済み');
    expect(native.mock.calls).toEqual([[], [], []]); expect(native.mock.contexts).toEqual([source, source, source]);
    expect(readCollect).toHaveBeenCalledTimes(1); expect(readDiagnostics).toHaveBeenCalledTimes(1);
    expect(readBridge).toHaveBeenCalledTimes(1); expect(readProjects).toHaveBeenCalledTimes(1);
    expect(h.container).not.toHaveTextContent(/REPLACED_METHOD|REPLACED_SOURCE|REPLACED_BRIDGE/);
  });

  it('coalesces pending initial/detail requests and still publishes after closing detail, then really collects on reopening', async () => {
    const initial = deferred<HardwareDiagnostics>(); collectDiagnostics.mockReturnValueOnce(initial.promise);
    api.list.mockResolvedValue(ok([])); const user = userEvent.setup(); render(<StrictMode><AppShell /></StrictMode>);
    await waitFor(() => expect(collectDiagnostics).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Project は0件です。作成から始められます。')).toBeVisible();
    const searchId = screen.getByRole('searchbox').id, query = '診断と独立した検索';
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: query } });
    const opener = screen.getByRole('link', { name: '端末・容量を確認' }); await user.click(opener);
    const firstHeading = screen.getByRole('heading', { level: 1, name: '端末・容量' });
    expect(diagnosticPage().getByRole('status')).toHaveTextContent('取得中');
    expect(document.getElementById('settings-heading')).toHaveFocus();
    await user.click(settingsBack()); expect(opener).toHaveFocus(); expect(firstHeading).not.toBeInTheDocument();
    expect(diagnosticStatus()).toHaveTextContent('取得中');
    expect(screen.getByRole('searchbox')).toHaveValue(query); expect(screen.getByRole('searchbox')).toHaveAttribute('id', searchId);
    await user.click(opener); expect(collectDiagnostics).toHaveBeenCalledTimes(1);
    await act(async () => { initial.resolve(hardwareReport()); });
    expect(diagnosticPage().getByRole('status')).toHaveTextContent(/^取得済み$/);
    expect(within(screen.getByRole('region', { name: 'ディスク' })).getByText('8,000 B')).toBeVisible();
    const refresh = deferred<HardwareDiagnostics>(); collectDiagnostics.mockReturnValueOnce(refresh.promise);
    await user.click(diagnosticPage().getByRole('button', { name: '再取得' }));
    expect(collectDiagnostics).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('contentinfo')).toHaveTextContent(`前回（最新ではありません）— ${capacityText('8,000 B')}`);
    await user.click(settingsBack()); expect(opener).toHaveFocus();
    expect(diagnosticStatus()).toHaveTextContent('取得中 — 前回の結果（最新ではありません）');
    expect(screen.queryByRole('heading', { level: 1, name: '端末・容量' })).toBeNull();
    await act(async () => { refresh.resolve(hardwareReport({
      disk: { status: 'ok', data: { totalBytes: 10000, usedBytes: 7000, freeBytes: 3000 }, error: null },
    })); });
    expect(diagnosticStatus()).toHaveTextContent(/^取得済み$/); expect(diagnosticSummary()).toHaveTextContent(capacityText('3,000 B'));
    expect(screen.getByRole('contentinfo')).toHaveTextContent(`容量：${capacityText('3,000 B')}`);
    expect(opener).toHaveFocus(); expect(collectDiagnostics).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('searchbox')).toHaveValue(query); expect(screen.getByRole('searchbox')).toHaveAttribute('id', searchId);
    expect(screen.queryByText('診断・容量確認は未実装です。')).toBeNull();
    await user.click(opener);
    expect(diagnosticPage().getByRole('status')).toHaveTextContent(/^取得済み$/);
    expect(within(screen.getByRole('region', { name: 'ディスク' })).getByText('8,000 B')).toBeVisible();
    expect(collectDiagnostics.mock.calls).toEqual([[], [], []]);
    await user.click(screen.getByRole('tab', { name: '実行環境' }));
    expect(within(screen.getByRole('region', { name: 'カメラ' })).getByText('未取得 — 推論開始時に確認します。')).toBeVisible();
    expect(screen.getByRole('contentinfo')).toHaveTextContent('デバイス：計算実行未確認');
  });

  it('shares only the current retry promise and retains labelled previous values after a malformed refresh', async () => {
    const user = userEvent.setup(); render(<AppShell />);
    await waitFor(() => expect(diagnosticStatus()).toHaveTextContent(/^取得済み$/));
    const task = deferred<HardwareDiagnostics>(); collectDiagnostics.mockReturnValueOnce(task.promise);
    const retry = screen.getByRole('button', { name: '診断を再取得' });
    act(() => { retry.click(); retry.click(); });
    await waitFor(() => expect(collectDiagnostics).toHaveBeenCalledTimes(2));
    expect(retry).toBeDisabled(); expect(diagnosticSummary()).toHaveTextContent(`前回（最新ではありません）— ${capacityText('8,000 B')}`);
    await act(async () => { task.resolve(hardwareReport()); });
    collectDiagnostics.mockResolvedValueOnce({ ...hardwareReport(), disk: notChecked }); // status=ok is invalid here.
    await user.click(retry);
    await waitFor(() => expect(diagnosticStatus()).toHaveTextContent('取得失敗 — 前回の結果（最新ではありません）'));
    expect(diagnosticSummary()).toHaveTextContent(`前回（最新ではありません）— ${capacityText('8,000 B')}`);
    expect(diagnosticSummary()).toHaveTextContent('対応レベル：未判定');
    expect(collectDiagnostics).toHaveBeenCalledTimes(3);
    await user.click(screen.getByRole('button', { name: '診断を再試行' }));
    await waitFor(() => expect(diagnosticStatus()).toHaveTextContent(/^取得済み$/));
    expect(diagnosticSummary()).not.toHaveTextContent('前回'); expect(collectDiagnostics).toHaveBeenCalledTimes(4);
    expect(api.list).toHaveBeenCalledExactlyOnceWith(); expect(readDiagnostics).toHaveBeenCalledTimes(1);
  });

  it('replaces partial groups without filling old values and distinguishes observed zero from unknown in summary and detail', async () => {
    const user = userEvent.setup(); render(<AppShell />);
    await waitFor(() => expect(diagnosticStatus()).toHaveTextContent(/^取得済み$/));
    const partial = hardwareReport({ status: 'partial', memory: notChecked,
      cpu: { status: 'error', data: { name: null, logicalCount: 0 }, error: { code: 'cpu-data-unavailable', causeType: 'OSError' } },
      disk: { status: 'ok', data: { totalBytes: 0, usedBytes: 0, freeBytes: 0 }, error: null },
    });
    collectDiagnostics.mockResolvedValue(partial);
    await user.click(screen.getByRole('button', { name: '診断を再取得' }));
    expect(diagnosticStatus()).toHaveTextContent(/^一部未取得$/);
    expect(diagnosticSummary()).toHaveTextContent(capacityText('0 B')); expect(diagnosticSummary()).not.toHaveTextContent(/前回|8,000 B/);
    expect(screen.getByRole('contentinfo')).toHaveTextContent(`容量：${capacityText('0 B')}`);
    await user.click(screen.getByRole('link', { name: '端末・容量を確認' }));
    expect(diagnosticPage().getByRole('status')).toHaveTextContent('一部未取得');
    const cpu = within(screen.getByRole('region', { name: 'CPU' }));
    expect(cpu.getByText('論理プロセッサ数').nextElementSibling).toHaveTextContent(/^0$/);
    expect(cpu.getByText('名前').nextElementSibling).toHaveTextContent('未取得');
    expect(within(screen.getByRole('region', { name: 'メモリ' })).getByText('合計').nextElementSibling).toHaveTextContent('未取得');
    expect(within(screen.getByRole('region', { name: 'ディスク' })).getByText('空き').nextElementSibling).toHaveTextContent('0 B');
    collectDiagnostics.mockResolvedValueOnce(hardwareReport({ status: 'partial', disk: notChecked }));
    await user.click(diagnosticPage().getByRole('button', { name: '再取得' }));
    expect(within(screen.getByRole('region', { name: 'ディスク' })).getByText('空き').nextElementSibling).toHaveTextContent('未取得');
    await user.click(settingsBack());
    expect(diagnosticStatus()).toHaveTextContent(/^一部未取得$/); expect(diagnosticSummary()).toHaveTextContent(capacityText('未取得'));
    expect(diagnosticSummary()).not.toHaveTextContent(/前回|0 B|8,000 B/);
    expect(screen.getByRole('contentinfo')).toHaveTextContent(`容量：${capacityText('未取得')}`);
    expect(collectDiagnostics).toHaveBeenCalledTimes(4);
  });

  it('classifies the latest error report rather than the retained old OS, keeping old capacity explicitly stale', async () => {
    collectDiagnostics.mockResolvedValueOnce(reportWithOs({ build: 26099 }));
    const user = userEvent.setup(); render(<AppShell />);
    await waitFor(() => expect(diagnosticStatus()).toHaveTextContent(/^取得済み$/));
    expect(diagnosticSummary()).toHaveTextContent('対応レベル：非対応');
    collectDiagnostics.mockResolvedValueOnce(hardwareReport({ ...unsupportedOsReport(), os: notChecked }));
    await user.click(screen.getByRole('button', { name: '診断を再取得' }));
    expect(diagnosticStatus()).toHaveTextContent('取得失敗 — 前回の結果（最新ではありません）');
    expect(diagnosticSummary()).toHaveTextContent('対応レベル：未判定');
    collectDiagnostics.mockResolvedValue(unsupportedOsReport());
    await user.click(screen.getByRole('button', { name: '診断を再試行' }));
    expect(diagnosticSummary()).toHaveTextContent('対応レベル：非対応（理由は詳細）');
    expect(diagnosticSummary()).toHaveTextContent(`前回（最新ではありません）— ${capacityText('8,000 B')}`);
    expect(screen.getByRole('contentinfo')).toHaveTextContent(`前回（最新ではありません）— ${capacityText('8,000 B')}`);
    await user.click(screen.getByRole('link', { name: '端末・容量を確認' }));
    expect(diagnosticPage().getByText(/^対応レベル:/)).toHaveTextContent('非対応（対応対象外のOS）');
    expect(diagnosticPage().getByRole('status')).toHaveTextContent('取得失敗');
    expect(collectDiagnostics).toHaveBeenCalledTimes(4);
  });

  it.each([
    { label: 'old build', report: reportWithOs({ build: 26099 }), support: '非対応', reason: 'ビルド 26099 < 26100' },
    { label: 'server', report: reportWithOs({ productType: 3 }), support: '非対応', reason: 'OS製品種別 3' },
    { label: 'long architecture', report: reportWithOs({ architecture: 'ARM64'.repeat(250) }), support: '非対応', reason: '全文を表示' },
    { label: 'unsupported OS', report: unsupportedOsReport(), support: '非対応', reason: '対応対象外のOS' },
    { label: 'unknown architecture', report: reportWithOs({ architecture: '   ' }), support: '未判定', reason: '未判定' },
  ])('matches detail classification for $label without placing unbounded reasons in the list', async ({ label, report, support, reason }) => {
    collectDiagnostics.mockResolvedValue(report);
    const user = userEvent.setup(); const { container } = render(<AppShell />);
    await waitFor(() => expect(diagnosticStatus()).toHaveTextContent(report.status === 'error' ? '取得失敗' : '取得済み'));
    expect(diagnosticSummary()).toHaveTextContent(`対応レベル：${support}`);
    if (label === 'long architecture') expect(container).not.toHaveTextContent('ARM64'.repeat(250));
    await user.click(screen.getByRole('link', { name: '端末・容量を確認' }));
    expect(diagnosticPage().getByText(/^対応レベル:/)).toHaveTextContent(`対応レベル: ${support}`);
    expect(diagnosticPage().getByText(/^対応レベル:/)).toHaveTextContent(reason);
    if (label === 'long architecture') expect(diagnosticPage().getByRole('button', { name: '非対応の理由の全文を表示' })).toBeVisible();
    expect(collectDiagnostics.mock.calls).toEqual([[], []]);
    expect(container).not.toHaveTextContent(/CPU可|CPU動作可|推奨構成|unsupported-os/);
  });

  it.each(['resolve', 'reject'] as const)('blocks old root %s from publishing into a real remount and skips native work after immediate unmount', async (completion) => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const oldTask = deferred<HardwareDiagnostics>(); collectDiagnostics.mockReturnValueOnce(oldTask.promise);
    const old = render(<AppShell />); await waitFor(() => expect(collectDiagnostics).toHaveBeenCalledTimes(1)); old.unmount();
    const current = deferred<HardwareDiagnostics>();
    const nextCollect = vi.fn<AppApi['diagnostics']['collect']>().mockReturnValueOnce(current.promise);
    readDiagnostics = vi.fn(() => ({ collect: nextCollect })); installBridge();
    const next = render(<AppShell />); await waitFor(() => expect(nextCollect).toHaveBeenCalledExactlyOnceWith());
    await act(async () => {
      if (completion === 'resolve') oldTask.resolve(hardwareReport()); else oldTask.reject(new Error('PRIVATE_NATIVE_PATH'));
    });
    expect(old.container).toBeEmptyDOMElement(); expect(diagnosticStatus()).toHaveTextContent(/^取得中$/);
    expect(diagnosticSummary()).toHaveTextContent(capacityText('未取得'));
    expect(next.container).not.toHaveTextContent(/8,000 B|PRIVATE_NATIVE_PATH/);
    await act(async () => { current.resolve(hardwareReport({
      disk: { status: 'ok', data: { totalBytes: 10000, usedBytes: 3457, freeBytes: 6543 }, error: null },
    })); });
    expect(diagnosticStatus()).toHaveTextContent(/^取得済み$/); expect(diagnosticSummary()).toHaveTextContent(capacityText('6,543 B'));
    expect(nextCollect).toHaveBeenCalledTimes(1); expect(readBridge).toHaveBeenCalledTimes(1); next.unmount();
    const neverCollect = vi.fn<AppApi['diagnostics']['collect']>().mockResolvedValue(hardwareReport());
    readDiagnostics = vi.fn(() => ({ collect: neverCollect })); installBridge();
    const immediate = render(<AppShell />); immediate.unmount();
    await act(async () => {});
    expect(neverCollect).not.toHaveBeenCalled(); expect(consoleError).not.toHaveBeenCalled();
  });
});

describe('AppShell diagnostic export (SEC-07C6)', () => {
  const saved: DiagnosticExportResult = { status: 'saved', path: 'C:\\Synthetic\\logs\\diagnostics.txt', byteLength: 880, sha256: 'a'.repeat(64) };
  const saveButton = () => screen.getByRole('button', { name: '診断要約を保存' });
  const saveStatus = () => screen.getByRole('status', { name: '診断要約の保存状態' });
  const open = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole('link', { name: '端末・容量を確認' }));
    await waitFor(() => expect(saveButton()).toBeEnabled());
  };

  it.each([false, true])('snapshots the export capability once with its receiver, but saves only on explicit action (StrictMode=%s)', async (strict) => {
    const native = vi.fn<() => Promise<DiagnosticExportResult>>().mockResolvedValue(saved);
    const readExport = vi.fn(() => native);
    const source = { collect: collectDiagnostics, get exportSummary() { return readExport(); } };
    readDiagnostics.mockReturnValue(source);
    const user = userEvent.setup(), element = strict ? <StrictMode><AppShell /></StrictMode> : <AppShell />;
    const h = render(element);
    await waitFor(() => expect(diagnosticStatus()).toHaveTextContent(/^取得済み$/));
    expect(native).not.toHaveBeenCalled(); expect(readExport).toHaveBeenCalledTimes(1);
    readExport.mockImplementation(() => { throw new Error('PRIVATE_REPLACED'); }); h.rerender(element);
    await open(user); await user.click(runtimeTabForExport());
    expect(native).not.toHaveBeenCalled(); await user.click(saveButton());
    expect(saveStatus()).toHaveTextContent('保存しました');
    expect(native.mock.calls).toEqual([[]]); expect(native.mock.contexts).toEqual([source]);
    await user.click(saveButton()); expect(native).toHaveBeenCalledTimes(2);
    expect(readExport).toHaveBeenCalledTimes(1); expect(readBridge).toHaveBeenCalledTimes(1);
    expect(readDiagnostics).toHaveBeenCalledTimes(1); expect(h.container).not.toHaveTextContent('PRIVATE_REPLACED');
    expect(collectDiagnostics).toHaveBeenCalledTimes(2); expect(api.create).not.toHaveBeenCalled();
  });

  function runtimeTabForExport() { return screen.getByRole('tab', { name: '実行環境' }); }

  it.each(['missing', 'getter-throws', 'not-function'] as const)('keeps collection available with %s export capability', async (kind) => {
    const source = { collect: collectDiagnostics } as AppApi['diagnostics'];
    if (kind === 'getter-throws') Object.defineProperty(source, 'exportSummary', { get() { throw new Error('PRIVATE'); } });
    if (kind === 'not-function') Object.defineProperty(source, 'exportSummary', { value: 'PRIVATE' });
    readDiagnostics.mockReturnValue(source);
    const user = userEvent.setup(), h = render(<AppShell />);
    await waitFor(() => expect(diagnosticStatus()).toHaveTextContent(/^取得済み$/));
    await user.click(screen.getByRole('link', { name: '端末・容量を確認' }));
    expect(screen.getByRole('button', { name: '要約保存：利用不可' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '再取得' }));
    expect(diagnosticPage().getByRole('status')).toHaveTextContent('取得済み');
    expect(collectDiagnostics).toHaveBeenCalledTimes(3); expect(h.container).not.toHaveTextContent('PRIVATE');
  });

  it('does not read export from an unvalidated bridge or invoke it from navigation', async () => {
    const read = vi.fn();
    Object.defineProperty(window, APP_BRIDGE_KEY, { configurable: true, value: {
      contractVersion: 99, projects: api, get diagnostics() { read(); return {}; },
    } });
    const user = userEvent.setup(); render(<AppShell />);
    await user.click(screen.getByRole('link', { name: '端末・容量を確認' }));
    expect(read).not.toHaveBeenCalled(); expect(screen.queryByRole('button', { name: '診断要約を保存' })).toBeNull();
  });

  it('prevents a second native request after detail remount until the first save has settled', async () => {
    const task = deferred<DiagnosticExportResult>();
    const native = vi.fn<() => Promise<DiagnosticExportResult>>().mockReturnValueOnce(task.promise).mockResolvedValue(saved);
    readDiagnostics.mockReturnValue({ collect: collectDiagnostics, exportSummary: native });
    const user = userEvent.setup(); render(<AppShell />); await open(user); await user.click(saveButton());
    expect(saveStatus()).toHaveTextContent('確認待ち'); await user.click(settingsBack());
    await open(user); expect(screen.queryByRole('status', { name: '診断要約の保存状態' })).toBeNull();
    await user.click(saveButton()); expect(saveStatus()).toHaveTextContent('別の診断要約を確認・保存中');
    expect(native).toHaveBeenCalledTimes(1);
    await act(async () => { task.resolve(saved); });
    expect(saveStatus()).not.toHaveTextContent('保存しました');
    await user.click(saveButton()); expect(saveStatus()).toHaveTextContent('保存しました'); expect(native).toHaveBeenCalledTimes(2);
  });

  it.each(['reject', 'invalid'] as const)('isolates %s export result from Project drafts and collection', async (kind) => {
    const native = vi.fn<() => Promise<DiagnosticExportResult>>();
    if (kind === 'reject') native.mockRejectedValueOnce(new Error('PRIVATE'));
    else native.mockResolvedValueOnce({ ...saved, report: 'PRIVATE' } as DiagnosticExportResult);
    readDiagnostics.mockReturnValue({ collect: collectDiagnostics, exportSummary: native });
    const user = userEvent.setup(), h = render(<AppShell />); await enter(user, a, true);
    fireEvent.change(nameField(), { target: { value: '保持する下書き' } });
    await user.click(screen.getByRole('link', { name: '端末・容量' })); await waitFor(() => expect(saveButton()).toBeEnabled());
    await user.click(saveButton()); expect(saveStatus()).toHaveTextContent('保存結果を確認できません');
    expect(screen.getByRole('contentinfo')).toHaveTextContent('診断：取得済み');
    await user.click(screen.getByRole('link', { name: 'Project' }));
    expect(nameField()).toHaveValue('保持する下書き'); expect(api.update).not.toHaveBeenCalled();
    expect(h.container).not.toHaveTextContent('PRIVATE'); expect(native).toHaveBeenCalledExactlyOnceWith();
  });

  it.each(['resolve', 'reject'] as const)('does not publish old export %s after AppShell unmount/remount', async (outcome) => {
    const task = deferred<DiagnosticExportResult>(); const native = vi.fn<() => Promise<DiagnosticExportResult>>().mockReturnValueOnce(task.promise);
    readDiagnostics.mockReturnValue({ collect: collectDiagnostics, exportSummary: native });
    const user = userEvent.setup(), old = render(<AppShell />); await open(user); await user.click(saveButton()); old.unmount();
    const nextSave = vi.fn<() => Promise<DiagnosticExportResult>>().mockResolvedValue(saved);
    readDiagnostics.mockReturnValue({ collect: collectDiagnostics, exportSummary: nextSave }); installBridge(); render(<AppShell />);
    await open(user);
    await act(async () => { if (outcome === 'resolve') task.resolve(saved); else task.reject(new Error('PRIVATE')); });
    expect(screen.queryByRole('status', { name: '診断要約の保存状態' })).toBeNull();
    expect(nextSave).not.toHaveBeenCalled(); expect(old.container).toBeEmptyDOMElement(); expect(saveButton()).toBeEnabled();
  });
});