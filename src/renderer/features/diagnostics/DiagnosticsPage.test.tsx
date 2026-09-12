import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { DiagnosticExportResult } from '../../../shared/contracts/diagnostic-export';
import { hardwareDiagnosticsSchema, type HardwareDiagnostics } from '../../../shared/contracts/diagnostics';
import { DiagnosticsPage } from './DiagnosticsPage';

function report(): HardwareDiagnostics {
  return hardwareDiagnosticsSchema.parse({
    schemaVersion: 1, command: 'probe-hardware', status: 'ok',
    os: { status: 'ok', data: { name: 'Windows', major: 10, minor: 0, build: 26100, productType: 1, architecture: 'AMD64' }, error: null },
    cpu: { status: 'ok', data: { logicalCount: 8, name: 'CPU 日本語 🧪' }, error: null },
    memory: { status: 'ok', data: { totalBytes: 8192, availableBytes: 4096, loadPercent: 50 }, error: null },
    disk: { status: 'ok', data: { totalBytes: 10000, usedBytes: 2000, freeBytes: 8000 }, error: null },
    gpu: { status: 'ok', data: { adapters: [{ DeviceName: '表示 0', DeviceString: 'GPU 日本語', StateFlags: 0 }], scope: 'current-session-display-adapters', computeStatus: 'not_checked' }, error: null },
    onnxRuntime: { status: 'ok', data: { version: '1.0', providers: ['CPUExecutionProvider'], executionStatus: 'not_checked' }, error: null },
    cuda: { status: 'ok', data: { torchVersion: '2.0', runtimeVersion: null, available: false, scope: 'torch-runtime-only', executionStatus: 'not_checked', physicalGpuPresence: null }, error: null },
    camera: { status: 'deferred', streamOpened: false, reasonCode: 'check-on-inference-start' },
  });
}
function deferred() {
  let resolve!: (value: HardwareDiagnostics) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<HardwareDiagnostics>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const apiFor = (value = report()) => ({ collect: vi.fn<() => Promise<HardwareDiagnostics>>().mockResolvedValue(value) });
const metric = (group: string, name: string) => within(screen.getByRole('region', { name: group })).getByText(name, { selector: 'dt' }).nextElementSibling;
async function ready(api = apiFor()) {
  const onBack = vi.fn();
  const view = render(<DiagnosticsPage api={api} onBack={onBack} />);
  await screen.findByText('取得済み');
  return { ...view, api, onBack, user: userEvent.setup() };
}
const runtimeTab = () => screen.getByRole('tab', { name: '実行環境' });

describe('DiagnosticsPage', () => {
  it('exposes only collect and explicit back, starts pending without fabricated results', () => {
    expectTypeOf<Parameters<typeof DiagnosticsPage>[0]>().toEqualTypeOf<{
      api: { collect(): Promise<HardwareDiagnostics>; exportSummary?: () => Promise<DiagnosticExportResult> }; onBack: () => void;
    }>();
    const task = deferred();
    const api = { collect: vi.fn(() => task.promise) };
    const { container } = render(<DiagnosticsPage api={api} onBack={vi.fn()} />);
    expect(api.collect.mock.calls).toEqual([[]]);
    expect(screen.getByRole('status')).toHaveTextContent('取得中');
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(container.querySelectorAll('[aria-live]')).toHaveLength(1);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: '再取得' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '戻る' })).toBeEnabled();
    expect(metric('メモリ', '合計')).toHaveTextContent('未取得');
    expect(container).not.toHaveTextContent(/取得済み|CPU動作可|推奨|\b0 B\b/);
    expect(container.querySelector('time')).toBeNull();
  });

  it('shows observations, not support promises, and uses existing decorative icons', async () => {
    const { container } = await ready();
    expect(metric('CPU', '名前')).toHaveTextContent('CPU 日本語 🧪');
    expect(metric('メモリ', '合計')).toHaveTextContent('8,192 B');
    expect(metric('ディスク', '空き')).toHaveTextContent('8,000 B');
    expect(screen.getByText('対応レベル: 未判定')).toBeVisible();
    expect(container.querySelectorAll('svg.system-icon[aria-hidden="true"][focusable="false"]')).toHaveLength(2);
    expect(container.querySelector('[aria-busy="false"]')).not.toBeNull();
  });

  it('keeps labelled previous observations during refresh and updates every metric', async () => {
    const { api, user, container } = await ready();
    const task = deferred(); api.collect.mockReturnValueOnce(task.promise);
    await user.click(screen.getByRole('button', { name: '再取得' }));
    expect(screen.getByText('前回の結果（再取得中）')).toBeVisible();
    expect(metric('CPU', '名前')).toHaveTextContent('CPU 日本語 🧪');
    expect(screen.getByRole('status')).toHaveTextContent('取得中');
    const next = report();
    next.os.data = { name: 'Windows', major: 11, minor: 1, build: 27000, productType: 1, architecture: 'AMD64' };
    next.cpu.data = { name: '新CPU', logicalCount: 16 };
    next.memory.data = { totalBytes: 100, availableBytes: 0, loadPercent: 100 };
    next.disk.data = { totalBytes: 200, usedBytes: 0, freeBytes: 200 };
    next.gpu.data!.adapters = [{ DeviceName: '新表示', DeviceString: '新GPU', StateFlags: 0 }];
    next.onnxRuntime.data!.version = '9.0'; next.onnxRuntime.data!.providers = ['新Provider'];
    next.cuda.data!.torchVersion = '9.1'; next.cuda.data!.runtimeVersion = '12.0'; next.cuda.data!.available = true;
    await act(async () => { task.resolve(next); });
    expect(metric('OS', 'バージョン')).toHaveTextContent('11.1 / ビルド 27000');
    expect(metric('CPU', '名前')).toHaveTextContent('新CPU');
    expect(metric('CPU', '論理プロセッサ数')).toHaveTextContent('16');
    expect(metric('メモリ', '合計')).toHaveTextContent('100 B');
    expect(metric('メモリ', '利用可能')).toHaveTextContent('0 B');
    expect(metric('メモリ', '使用率')).toHaveTextContent('100%');
    expect(metric('ディスク', '合計')).toHaveTextContent('200 B');
    expect(metric('ディスク', '使用中')).toHaveTextContent('0 B');
    expect(metric('ディスク', '空き')).toHaveTextContent('200 B');
    await user.click(runtimeTab());
    for (const text of ['新表示', '新GPU', '新Provider', 'バージョン 9.0', '9.1', '12.0', '検出あり（実行は未確認）']) {
      expect(screen.getByText(text)).toBeVisible();
    }
    expect(container).not.toHaveTextContent('前回の結果');
    expect(api.collect.mock.calls).toEqual([[], []]);
  });

  it('guards synchronous duplicate dispatch independently of disabled rendering', async () => {
    const { api } = await ready(); const task = deferred(); api.collect.mockReturnValue(task.promise);
    const refresh = screen.getByRole('button', { name: '再取得' });
    act(() => { refresh.click(); refresh.click(); fireEvent.click(refresh); });
    expect(api.collect).toHaveBeenCalledTimes(2);
    await act(async () => { task.resolve(report()); });
    expect(refresh).toBeEnabled();
  });

  it('shows partial groups safely and distinguishes real zero from null', async () => {
    const value = report(); value.status = 'partial';
    value.cpu = { status: 'error', data: { name: null, logicalCount: 0 }, error: { code: 'cpu-data-unavailable', causeType: 'OSError' } };
    value.memory = { status: 'not_checked', data: null, error: null };
    value.disk.data = { totalBytes: 0, usedBytes: 0, freeBytes: 0 };
    const { container } = render(<DiagnosticsPage api={apiFor(value)} onBack={vi.fn()} />);
    await screen.findByText('一部未取得');
    expect(metric('CPU', '名前')).toHaveTextContent('未取得');
    expect(metric('CPU', '論理プロセッサ数')).toHaveTextContent(/^0$/);
    expect(metric('メモリ', '合計')).toHaveTextContent('未取得');
    expect(metric('ディスク', '合計')).toHaveTextContent('0 B');
    expect(within(screen.getByRole('region', { name: 'CPU' })).getByText(/取得できません/)).toBeVisible();
    expect(container).not.toHaveTextContent(/cpu-data-unavailable|OSError/);
    await userEvent.setup().click(runtimeTab());
    expect(metric('CUDA（PyTorch環境のみ）', 'CUDA Runtime')).toHaveTextContent('未取得');
    expect(metric('CUDA（PyTorch環境のみ）', 'ランタイムの検出')).toHaveTextContent('検出なし');
  });

  it('handles initial failure without leaking rejection details and allows retry', async () => {
    const api = apiFor(); api.collect.mockRejectedValueOnce(new Error('C:\\private\\secret OSError'));
    const { container } = render(<DiagnosticsPage api={api} onBack={vi.fn()} />);
    await screen.findByText(/取得失敗/);
    expect(metric('CPU', '名前')).toHaveTextContent('未取得');
    expect(container).not.toHaveTextContent(/private|secret|OSError/);
    await userEvent.setup().click(screen.getByRole('button', { name: '再取得' }));
    await screen.findByText('取得済み');
    expect(api.collect).toHaveBeenCalledTimes(2);
  });

  it.each(['rejection', 'invalid', 'error-report'] as const)('labels stale values after failed refresh: %s', async (kind) => {
    const { api, user, container } = await ready();
    if (kind === 'rejection') api.collect.mockRejectedValueOnce(new Error('secret'));
    else if (kind === 'invalid') api.collect.mockResolvedValueOnce({ bad: 'secret' } as unknown as HardwareDiagnostics);
    else {
      const value = report(); value.status = 'error';
      for (const key of ['os', 'cpu', 'memory', 'disk', 'gpu', 'onnxRuntime', 'cuda'] as const) value[key] = { status: 'not_checked', data: null, error: null };
      api.collect.mockResolvedValueOnce(value);
    }
    await user.click(screen.getByRole('button', { name: '再取得' }));
    expect(screen.getByRole('status')).toHaveTextContent('取得失敗');
    expect(screen.getByText('前回の結果（更新失敗・最新ではありません）')).toBeVisible();
    expect(metric('CPU', '名前')).toHaveTextContent('CPU 日本語 🧪');
    expect(screen.getByText('対応レベル: 未判定')).toBeVisible();
    expect(container).not.toHaveTextContent('secret');
  });

  it.each(['resolve', 'reject'] as const)('discards pending old API completion on replacement: %s', async (completion) => {
    const old = deferred(); const current = deferred();
    const api = { collect: vi.fn(() => old.promise) }; const next = { collect: vi.fn(() => current.promise) };
    const onBack = vi.fn(); const { rerender, container } = render(<DiagnosticsPage api={api} onBack={onBack} />);
    rerender(<DiagnosticsPage api={next} onBack={onBack} />);
    await act(async () => { if (completion === 'resolve') old.resolve(report()); else old.reject(new Error('secret')); });
    expect(screen.getByRole('status')).toHaveTextContent('取得中');
    expect(container).not.toHaveTextContent('CPU 日本語');
    await act(async () => { current.reject(new Error('new failure')); });
    expect(screen.getByRole('status')).toHaveTextContent('取得失敗');
    expect(metric('CPU', '名前')).toHaveTextContent('未取得');
  });

  it('clears completed values on API change even if the new API fails', async () => {
    const { rerender, api, onBack, container } = await ready();
    const next = apiFor(); next.collect.mockRejectedValue(new Error('new failure'));
    rerender(<DiagnosticsPage api={next} onBack={onBack} />);
    expect(container).not.toHaveTextContent('CPU 日本語');
    await screen.findByText(/取得失敗/);
    expect(metric('CPU', '名前')).toHaveTextContent('未取得');
    rerender(<DiagnosticsPage api={api} onBack={onBack} />);
    await screen.findByText('取得済み');
    expect(api.collect).toHaveBeenCalledTimes(2);
  });

  it.each(['resolve', 'reject'] as const)('ignores completion after unmount: %s', async (completion) => {
    const task = deferred(); const api = { collect: vi.fn(() => task.promise) }; const onBack = vi.fn();
    const { unmount, container } = render(<DiagnosticsPage api={api} onBack={onBack} />);
    unmount();
    await act(async () => { if (completion === 'resolve') task.resolve(report()); else task.reject(new Error('secret')); });
    expect(container).toBeEmptyDOMElement(); expect(api.collect).toHaveBeenCalledTimes(1); expect(onBack).not.toHaveBeenCalled();
  });

  it('ignores the first effect response after StrictMode cleanup', async () => {
    const first = deferred(); const second = deferred();
    const api = { collect: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise) };
    render(<StrictMode><DiagnosticsPage api={api} onBack={vi.fn()} /></StrictMode>);
    await act(async () => { first.resolve(report()); });
    expect(screen.getByRole('status')).toHaveTextContent('取得中');
    await act(async () => { second.resolve(report()); });
    expect(screen.getByRole('status')).toHaveTextContent('取得済み');
  });

  it('implements manual tabs with independent focus, arrows, Home/End, Enter and Space', async () => {
    const { user, api } = await ready(); const device = screen.getByRole('tab', { name: '端末' }); const runtime = runtimeTab();
    await user.click(device);
    await user.keyboard('{ArrowRight}');
    expect(runtime).toHaveFocus(); expect(device).toHaveAttribute('aria-selected', 'true');
    expect(runtime).toHaveAttribute('tabindex', '0'); expect(device).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('tabpanel', { name: '端末' })).toBeVisible();
    await user.keyboard('{Enter}'); expect(runtime).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowRight}'); expect(device).toHaveFocus(); expect(runtime).toHaveAttribute('aria-selected', 'true');
    await user.keyboard(' '); expect(device).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowLeft}'); expect(runtime).toHaveFocus();
    await user.keyboard('{Home}'); expect(device).toHaveFocus();
    await user.keyboard('{End}'); expect(runtime).toHaveFocus(); expect(device).toHaveAttribute('aria-selected', 'true');
    await user.keyboard(' '); expect(screen.getByRole('tabpanel', { name: '実行環境' })).toBeVisible();
    await user.tab(); expect(screen.getByRole('tabpanel', { name: '実行環境' })).toHaveFocus();
    await user.tab({ shift: true }); expect(runtime).toHaveFocus();
    for (const tab of [device, runtime]) expect(document.getElementById(tab.getAttribute('aria-controls')!)).toHaveAttribute('aria-labelledby', tab.id);
    expect(api.collect).toHaveBeenCalledTimes(1);
  });

  describe('full diagnostic values', () => {
    const prototype = HTMLDialogElement.prototype;
    const originals = (['showModal', 'close'] as const).map((name) => [name, Object.getOwnPropertyDescriptor(prototype, name)] as const);
    beforeEach(() => {
      // Missing jsdom APIs only: these shims do NOT verify native inertness, focus trapping or Escape handling.
      if (typeof prototype.showModal !== 'function') Object.defineProperty(prototype, 'showModal', {
        configurable: true, writable: true, value: function (this: HTMLDialogElement) {
          this.setAttribute('open', ''); this.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
        },
      });
      if (typeof prototype.close !== 'function') Object.defineProperty(prototype, 'close', {
        configurable: true, writable: true, value: function (this: HTMLDialogElement) {
          if (!this.open) return;
          this.removeAttribute('open'); this.dispatchEvent(new Event('close'));
        },
      });
    });
    afterEach(() => {
      cleanup();
      for (const [name, descriptor] of originals) {
        if (descriptor) Object.defineProperty(prototype, name, descriptor);
        else Reflect.deleteProperty(prototype, name);
      }
    });

    const segments = (text: string) => Array.from(new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(text), ({ segment }) => segment);
    const valueButton = (group: string, label: string) => within(screen.getByRole('region', { name: group })).getByRole('button', { name: `${label}の全文を表示` });
    async function readFullValue(user: ReturnType<typeof userEvent.setup>, trigger: HTMLElement, label: string, expected: string) {
      expect(trigger).toHaveAttribute('type', 'button');
      expect(trigger).toBeVisible();
      expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
      expect(trigger).toHaveAttribute('aria-label', `${label}の全文を表示`);
      expect(trigger.textContent).toBe('全文を表示');
      expect(document.body.textContent).not.toContain(expected);
      await user.click(trigger);
      const dialog = screen.getByRole('dialog', { name: label });
      expect(screen.getAllByRole('dialog')).toHaveLength(1);
      expect(dialog.tagName).toBe('DIALOG');
      expect(dialog).toHaveClass('diagnostics-page__value-dialog');
      expect(dialog).toHaveAttribute('open');
      expect(dialog).not.toHaveAttribute('tabindex');
      expect(dialog.parentElement).toHaveClass('diagnostics-page');
      expect(dialog.closest('p, dd, strong, [aria-live]')).toBeNull();
      const heading = within(dialog).getByRole('heading', { name: label });
      expect(heading.textContent).toBe(label);
      expect(dialog).toHaveAttribute('aria-labelledby', heading.id);
      const content = dialog.querySelector<HTMLParagraphElement>('p.diagnostics-page__full-value')!;
      expect(content).toHaveAttribute('tabindex', '0');
      expect(content).toBeVisible();
      expect(content.childElementCount).toBe(0);
      expect(document.querySelectorAll('.diagnostics-page__full-value')).toHaveLength(1);
      const pager = within(dialog).getByRole('navigation', { name: '全文のページ送り' });
      expect(pager).toHaveClass('diagnostics-page__value-pages');
      const previous = within(pager).getByRole('button', { name: '全文: 前のページ' });
      const next = within(pager).getByRole('button', { name: '全文: 次のページ' });
      for (const button of [previous, next]) expect(button).toHaveAttribute('aria-controls', content.id);
      const total = Number(pager.querySelector('span')!.textContent!.split('/')[1]);
      const original = segments(expected); const pages: string[] = []; let offset = 0;
      expect(total).toBeGreaterThan(0); expect(total).toBeLessThanOrEqual(original.length);
      for (let page = 0; page < total; page++) {
        const text = content.textContent!; const length = segments(text).length;
        expect(length).toBeGreaterThan(0); expect(length).toBeLessThanOrEqual(120);
        expect(text).toBe(original.slice(offset, offset + length).join(''));
        expect((text.match(/\r\n|[\r\n\u2028\u2029]/gu) ?? []).length).toBeLessThanOrEqual(6);
        expect(pager.querySelector('span')!.textContent).toBe(`${page + 1} / ${total}`);
        expect(previous).toHaveProperty('disabled', page === 0);
        expect(next).toHaveProperty('disabled', page + 1 === total);
        pages.push(text); offset += length;
        if (page + 1 < total) await user.click(next);
      }
      expect(pages.join('')).toBe(expected); expect(offset).toBe(original.length);
      if (total > 1) {
        await user.click(previous); expect(content.textContent).toBe(pages[total - 2]);
      }
      const close = within(dialog).getByRole('button', { name: '全文を閉じる' });
      expect(close.textContent).toBe('閉じる');
      await user.click(close);
      expect(screen.queryByRole('dialog')).toBeNull(); expect(trigger).toHaveFocus();
      expect(document.querySelector('.diagnostics-page__full-value')).toBeNull();
      expect(document.body.textContent).not.toContain(expected);
      return pages;
    }

    const long = '長い名前🧪'.repeat(60);
    function pagedReport() {
      const value = report();
      value.gpu.data!.adapters = Array.from({ length: 3 }, (_, i) => ({ DeviceName: `表示${i}${long}`, DeviceString: `GPU${i}${long}`, StateFlags: 0 }));
      value.onnxRuntime.data!.providers = Array.from({ length: 9 }, (_, i) => `Provider${i}${long}`);
      return value;
    }

    // Each device/provider page has its own finite test budget. Keep every value
    // and the complete readFullValue assertions rather than lengthening timeouts.
    it.each([0, 1, 2])('makes long Unicode GPU %d reachable with its complete values', async (index) => {
      const value = pagedReport();
      const { user, api } = await ready(apiFor(value)); await user.click(runtimeTab());
      const gpuControls = screen.getByRole('button', { name: 'GPU: 次のページ' }).getAttribute('aria-controls');
      for (let page = 0; page < index; page++) await user.click(screen.getByRole('button', { name: 'GPU: 次のページ' }));
      expect(metric('GPU', 'デバイス名（DeviceName）')).toHaveTextContent(/^全文を表示$/);
      expect(metric('GPU', 'アダプター名（DeviceString）')).toHaveTextContent(/^全文を表示$/);
      await readFullValue(user, valueButton('GPU', 'デバイス名（DeviceName）'), 'デバイス名（DeviceName）', `表示${index}${long}`);
      await readFullValue(user, valueButton('GPU', 'アダプター名（DeviceString）'), 'アダプター名（DeviceString）', `GPU${index}${long}`);
      expect(screen.getByRole('navigation', { name: 'GPUのページ送り' })).toHaveTextContent(`${index + 1} / 3`);
      for (const direction of ['前', '次']) expect(screen.getByRole('button', { name: `GPU: ${direction}のページ` })).toHaveAttribute('aria-controls', gpuControls);
      expect(document.getElementById(gpuControls!)).toContainElement(metric('GPU', 'デバイス名（DeviceName）') as HTMLElement | null);
      if (index === 2) {
        expect(screen.getByRole('button', { name: 'GPU: 次のページ' })).toBeDisabled();
        await user.click(screen.getByRole('button', { name: 'GPU: 前のページ' }));
        await readFullValue(user, valueButton('GPU', 'アダプター名（DeviceString）'), 'アダプター名（DeviceString）', `GPU1${long}`);
      }
      expect(api.collect).toHaveBeenCalledTimes(1);
    });

    it.each([0, 1, 2])('makes every long Unicode provider on page %d completely readable', async (page) => {
      const value = pagedReport();
      const { user, api } = await ready(apiFor(value)); await user.click(runtimeTab());
      const providerId = screen.getByRole('list', { name: '実行プロバイダー' }).id;
      for (let before = 0; before < page; before++) await user.click(screen.getByRole('button', { name: '実行プロバイダー: 次のページ' }));
      const expected = value.onnxRuntime.data!.providers.slice(page * 4, page * 4 + 4);
      const list = screen.getByRole('list', { name: '実行プロバイダー' }); expect(list.id).toBe(providerId);
      const items = within(list).getAllByRole('listitem'); expect(items).toHaveLength(expected.length);
      expect(items.map((item) => item.textContent)).toEqual(expected.map(() => '全文を表示'));
      for (let i = 0; i < items.length; i++) await readFullValue(user, within(items[i]).getByRole('button'), '実行プロバイダー', expected[i]);
      expect(screen.getByRole('navigation', { name: '実行プロバイダーのページ送り' })).toHaveTextContent(`${page + 1} / 3`);
      for (const direction of ['前', '次']) expect(screen.getByRole('button', { name: `実行プロバイダー: ${direction}のページ` })).toHaveAttribute('aria-controls', providerId);
      if (page === 2) {
        expect(screen.getByRole('button', { name: '実行プロバイダー: 次のページ' })).toBeDisabled();
        await user.click(screen.getByRole('button', { name: '実行プロバイダー: 前のページ' }));
        const firstProvider = within(screen.getByRole('list', { name: '実行プロバイダー' })).getAllByRole('listitem')[0];
        await readFullValue(user, within(firstProvider).getByRole('button'), '実行プロバイダー', `Provider4${long}`);
      }
      expect(api.collect).toHaveBeenCalledTimes(1);
    });

    it('resets both multi-item pagers when a fresh report has a single adapter and provider', async () => {
      const { user, api } = await ready(apiFor(pagedReport())); await user.click(runtimeTab());
      for (let page = 0; page < 2; page++) {
        await user.click(screen.getByRole('button', { name: 'GPU: 次のページ' }));
        await user.click(screen.getByRole('button', { name: '実行プロバイダー: 次のページ' }));
      }
      expect(screen.getByRole('navigation', { name: 'GPUのページ送り' })).toHaveTextContent('3 / 3');
      expect(screen.getByRole('navigation', { name: '実行プロバイダーのページ送り' })).toHaveTextContent('3 / 3');
      api.collect.mockResolvedValueOnce(report()); await user.click(screen.getByRole('button', { name: '再取得' }));
      expect(screen.getByText('GPU 日本語')).toBeVisible(); expect(screen.getByText('CPUExecutionProvider')).toBeVisible();
      expect(screen.queryByRole('navigation', { name: /ページ送り/ })).toBeNull();
      expect(api.collect).toHaveBeenCalledTimes(2);
    });

    it('uses the same full-value contract for CPU, OS, support and runtime versions without changing observations', async () => {
      const value = report(); const long = '詳細👩🏽‍💻e\u0301'.repeat(40);
      value.cpu.data!.name = `CPU${long}`; value.os.data!.architecture = `ARCH${long}`;
      value.onnxRuntime.data!.version = `ONNX${long}`;
      value.cuda.data!.torchVersion = `Torch${long}`; value.cuda.data!.runtimeVersion = `CUDA${long}`;
      const snapshot = structuredClone(value);
      const { user, api, container } = await ready(apiFor(value));
      for (const [group, label, text] of [
        ['CPU', '名前', value.cpu.data!.name], ['OS', 'アーキテクチャ', value.os.data!.architecture],
      ] as const) await readFullValue(user, valueButton(group, label), label, text);
      expect(metric('OS', 'OS')).toHaveTextContent('Windows');
      expect(screen.getByText(/^対応レベル:/)).toHaveTextContent('対応レベル: 非対応');
      await readFullValue(user, screen.getByRole('button', { name: '非対応の理由の全文を表示' }), '非対応の理由',
        `（アーキテクチャ ${value.os.data!.architecture}（AMD64以外））`);
      await user.click(runtimeTab());
      for (const [group, label, text] of [
        ['ONNX Runtime', 'バージョン', value.onnxRuntime.data!.version],
        ['CUDA（PyTorch環境のみ）', 'PyTorch', value.cuda.data!.torchVersion],
        ['CUDA（PyTorch環境のみ）', 'CUDA Runtime', value.cuda.data!.runtimeVersion],
      ] as const) await readFullValue(user, valueButton(group, label), label, text);
      expect(container.querySelectorAll('[aria-live]')).toHaveLength(1);
      expect(value).toEqual(snapshot); expect(api.collect.mock.calls).toEqual([[]]);
    });

    it.each([80, 81])('uses grapheme length, not UTF-16 length, at the %d boundary', async (count) => {
      const value = report(); const name = Array.from({ length: count }, (_, i) => i % 2 ? 'e\u0301' : '👩🏽‍💻').join('');
      value.cpu.data!.name = name;
      const { user, api } = await ready(apiFor(value));
      if (count === 80) {
        expect(metric('CPU', '名前')!.textContent).toBe(name);
        expect(screen.queryByRole('button', { name: '名前の全文を表示' })).toBeNull();
        expect(screen.queryByRole('dialog')).toBeNull();
      } else {
        expect(await readFullValue(user, valueButton('CPU', '名前'), '名前', name)).toEqual([name]);
      }
      expect(api.collect).toHaveBeenCalledTimes(1);
    });

    it('never splits ZWJ emoji or combining sequences at 120-grapheme page boundaries', async () => {
      const clusters = Array.from({ length: 260 }, () => '語');
      clusters[119] = '👩🏽‍💻'; clusters[120] = 'e\u0301'; clusters[239] = '👨‍👩‍👧‍👦'; clusters[240] = 'か\u3099';
      const name = clusters.join(''); const value = report(); value.cpu.data!.name = name;
      const { user, api } = await ready(apiFor(value));
      expect(await readFullValue(user, valueButton('CPU', '名前'), '名前', name)).toEqual([
        clusters.slice(0, 120).join(''), clusters.slice(120, 240).join(''), clusters.slice(240).join(''),
      ]);
      expect(api.collect).toHaveBeenCalledTimes(1);
    });

    it('preserves all whitespace and newline forms while limiting each page to six line breaks', async () => {
      const block = ['\r\n', '\n', '\r', '\u2028', '\u2029', '\r\n'].map((ending) => `  e\u0301👩🏽‍💻\t  ${ending}`).join('');
      const name = `${block.repeat(3)}尾  `; const value = report(); value.cpu.data!.name = name;
      const { user, api } = await ready(apiFor(value));
      expect(await readFullValue(user, valueButton('CPU', '名前'), '名前', name)).toEqual([block, block, block, '尾  ']);
      expect(api.collect).toHaveBeenCalledTimes(1);
    });

    it.each([' A\tB\nC  ', '二重  空白', '行\u2028'.repeat(39) + '終'])('preserves short whitespace values without expanding the card: %j', async (name) => {
      const value = report(); value.cpu.data!.name = name;
      const { user, api } = await ready(apiFor(value));
      expect(segments(name).length).toBeLessThanOrEqual(80);
      expect(metric('CPU', '名前')!.textContent).toBe('全文を表示');
      await readFullValue(user, valueButton('CPU', '名前'), '名前', name);
      expect(api.collect).toHaveBeenCalledTimes(1);
    });

    it('calls native modal APIs once per opening and restores focus after close or the Escape close contract', async () => {
      const value = report(); value.cpu.data!.name = '長いCPU👩🏽‍💻'.repeat(60);
      const { user, api } = await ready(apiFor(value)); const trigger = valueButton('CPU', '名前');
      const show = vi.spyOn(prototype, 'showModal'); const close = vi.spyOn(prototype, 'close');
      await user.click(trigger);
      const dialog = screen.getByRole('dialog', { name: '名前' });
      expect(dialog.querySelector('.diagnostics-page__full-value')).toHaveFocus();
      await user.click(within(dialog).getByRole('button', { name: '全文: 次のページ' }));
      await user.click(within(dialog).getByRole('button', { name: '全文: 前のページ' }));
      expect(show).toHaveBeenCalledTimes(1);
      await user.click(within(dialog).getByRole('button', { name: '全文を閉じる' }));
      expect(close).toHaveBeenCalledTimes(1); expect(trigger).toHaveFocus();
      await user.click(trigger);
      const reopened = screen.getByRole('dialog', { name: '名前' }) as HTMLDialogElement;
      // Simulate the UA's cancel -> close sequence, not a real keyboard Escape or focus-trap test.
      expect(fireEvent(reopened, new Event('cancel', { cancelable: true }))).toBe(true);
      act(() => { reopened.close(); });
      expect(screen.queryByRole('dialog')).toBeNull(); expect(trigger).toHaveFocus();
      expect(show).toHaveBeenCalledTimes(2); expect(close).toHaveBeenCalledTimes(2);
      expect(api.collect).toHaveBeenCalledTimes(1);
    });

    it.each(['resolve', 'reject'] as const)('clears the snapshot on refresh and on its later %s without reusing the page', async (completion) => {
      const value = report(); value.cpu.data!.name = '古いCPU👩🏽‍💻'.repeat(50);
      const { user, api, container } = await ready(apiFor(value));
      const refresh = screen.getByRole('button', { name: '再取得' });
      const task = deferred(); api.collect.mockReturnValueOnce(task.promise);
      await user.click(valueButton('CPU', '名前'));
      const initialDialog = screen.getByRole('dialog');
      await user.click(within(initialDialog).getByRole('button', { name: '全文: 次のページ' }));
      // A programmatic refresh: native modal inertness intentionally blocks user clicks behind it.
      fireEvent.click(refresh);
      expect(screen.queryByRole('dialog')).toBeNull(); expect(initialDialog).not.toHaveAttribute('open');
      expect(screen.getByRole('status')).toHaveTextContent('取得中');
      await user.click(valueButton('CPU', '名前'));
      const pendingDialog = screen.getByRole('dialog');
      expect(within(pendingDialog).getByText('前回の結果（最新ではありません）')).toBeVisible();
      expect(pendingDialog.querySelector('.diagnostics-page__full-value')!.textContent).toBe(segments(value.cpu.data!.name).slice(0, 120).join(''));
      await user.click(within(pendingDialog).getByRole('button', { name: '全文: 次のページ' }));
      const next = report(); next.cpu.data!.name = '新しいCPUe\u0301'.repeat(40);
      await act(async () => { if (completion === 'resolve') task.resolve(next); else task.reject(new Error('private')); });
      expect(screen.queryByRole('dialog')).toBeNull(); expect(pendingDialog).not.toHaveAttribute('open');
      expect(container.querySelector('.diagnostics-page__full-value')).toBeNull();
      expect(screen.getByRole('status')).toHaveTextContent(completion === 'resolve' ? '取得済み' : '取得失敗');
      await readFullValue(user, valueButton('CPU', '名前'), '名前', completion === 'resolve' ? next.cpu.data!.name : value.cpu.data!.name);
      expect(api.collect).toHaveBeenCalledTimes(2);
      api.collect.mockResolvedValueOnce(report()); await user.click(refresh);
      expect(metric('CPU', '名前')!.textContent).toBe('CPU 日本語 🧪');
      expect(screen.queryByRole('button', { name: '名前の全文を表示' })).toBeNull();
      expect(api.collect).toHaveBeenCalledTimes(3);
    });

    it('closes old native dialogs on API replacement and unmount without retaining their values', async () => {
      const value = report(); value.cpu.data!.name = '旧APIのCPU'.repeat(50);
      const { user, api, onBack, rerender, unmount, container } = await ready(apiFor(value));
      await user.click(valueButton('CPU', '名前')); const oldDialog = screen.getByRole('dialog');
      await user.click(within(oldDialog).getByRole('button', { name: '全文: 次のページ' }));
      const task = deferred(); const nextApi = { collect: vi.fn(() => task.promise) };
      rerender(<DiagnosticsPage api={nextApi} onBack={onBack} />);
      expect(oldDialog).not.toHaveAttribute('open'); expect(screen.queryByRole('dialog')).toBeNull();
      expect(container.textContent).not.toContain('旧APIのCPU');
      const next = report(); next.cpu.data!.name = '新APIのCPU'.repeat(40);
      await act(async () => { task.resolve(next); });
      await readFullValue(user, valueButton('CPU', '名前'), '名前', next.cpu.data!.name);
      await user.click(valueButton('CPU', '名前')); const lastDialog = screen.getByRole('dialog');
      unmount();
      expect(lastDialog).not.toHaveAttribute('open'); expect(container).toBeEmptyDOMElement();
      expect(api.collect).toHaveBeenCalledTimes(1); expect(nextApi.collect).toHaveBeenCalledTimes(1);
    });

    it('shows every character of a long saved path only on demand, without navigating or exporting again', async () => {
      const path = `C:\\Users\\利用者\\${'長い保存先🧪'.repeat(40)}\\diagnostics.txt`;
      const api = { ...apiFor(), exportSummary: vi.fn<() => Promise<DiagnosticExportResult>>()
        .mockResolvedValue({ status: 'saved', path, byteLength: 880, sha256: 'a'.repeat(64) }) };
      const { user } = await ready(api);
      await user.click(screen.getByRole('button', { name: '診断要約を保存' }));
      const trigger = screen.getByRole('button', { name: '診断要約の保存先を表示' });
      expect(document.body.textContent).not.toContain(path); expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
      await user.click(trigger);
      const dialog = screen.getByRole('dialog', { name: '診断要約の保存先' });
      const count = Number(dialog.querySelector('nav span')!.textContent!.split('/')[1]);
      let text = '';
      for (let page = 0; page < count; page++) {
        text += dialog.querySelector('.diagnostics-page__full-value')!.textContent;
        if (page + 1 < count) await user.click(within(dialog).getByRole('button', { name: '全文: 次のページ' }));
      }
      expect(text).toBe(path); expect(dialog.querySelector('a, [src]')).toBeNull();
      expect(within(dialog).queryByText('前回の結果（最新ではありません）')).toBeNull();
      await user.click(within(dialog).getByRole('button', { name: '全文を閉じる' }));
      expect(trigger).toHaveFocus(); expect(api.exportSummary).toHaveBeenCalledExactlyOnceWith();
      expect(api.collect).toHaveBeenCalledTimes(1);
    });
  });

  it.each(['', '   '])('keeps an unobserved architecture undecided: %j', async (architecture) => {
    const value = report(); value.os.data!.architecture = architecture;
    await ready(apiFor(value));
    expect(screen.getByText('対応レベル: 未判定')).toBeVisible();
    expect(screen.queryByText(/対応レベル: 非対応/)).toBeNull();
  });

  it('retains a definite old-build rejection with an unobserved architecture', async () => {
    const value = report(); value.os.data!.architecture = ''; value.os.data!.build = 26099;
    await ready(apiFor(value));
    expect(screen.getByText(/対応レベル: 非対応/)).toHaveTextContent('ビルド 26099 < 26100');
    expect(screen.getByText(/対応レベル: 非対応/)).not.toHaveTextContent('AMD64以外');
  });

  it.each(['端末', '実行環境'] as const)('reenters the selected tab after leaving unselected focus: %s', async (label) => {
    const { user } = await ready();
    const selected = screen.getByRole('tab', { name: label });
    const other = screen.getByRole('tab', { name: label === '端末' ? '実行環境' : '端末' });
    await user.click(selected);
    await user.keyboard('{ArrowRight}');
    expect(other).toHaveFocus();
    expect(selected).toHaveAttribute('aria-selected', 'true');
    await user.tab();
    expect(screen.getByRole('tabpanel', { name: label })).toHaveFocus();
    await user.tab({ shift: true });
    expect(selected).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: '再取得' })).toHaveFocus();
    await user.tab();
    expect(selected).toHaveFocus();
  });

  it('does not change diagnostic tabs during IME composition', async () => {
    const { user } = await ready();
    const device = screen.getByRole('tab', { name: '端末' });
    await user.click(device);
    fireEvent.keyDown(device, { key: 'ArrowRight', isComposing: true });
    expect(device).toHaveFocus();
    expect(device).toHaveAttribute('aria-selected', 'true');
  });

  it.each([
    { build: 26099, productType: 1, architecture: 'AMD64', fact: 'ビルド 26099 < 26100' },
    { build: 26100, productType: 2, architecture: 'AMD64', fact: 'OS製品種別 2' },
    { build: 26100, productType: 1, architecture: 'ARM64', fact: 'ARM64（AMD64以外）' },
  ] as const)('reports definitive unsupported OS facts: $fact', async ({ fact, ...data }) => {
    const value = report(); Object.assign(value.os.data!, data);
    await ready(apiFor(value)); expect(screen.getByText(/対応レベル: 非対応/)).toHaveTextContent(fact);
  });

  it('handles unsupported-os without displaying raw codes', async () => {
    const value = report(); value.status = 'error';
    value.os = { status: 'error', data: null, error: { code: 'unsupported-os', causeType: null } };
    for (const key of ['cpu', 'memory', 'disk', 'gpu', 'onnxRuntime', 'cuda'] as const) value[key] = { status: 'not_checked', data: null, error: null };
    const { container } = render(<DiagnosticsPage api={apiFor(value)} onBack={vi.fn()} />);
    await screen.findByText(/取得失敗/); expect(screen.getByText('対応レベル: 非対応（対応対象外のOS）')).toBeVisible();
    expect(container).not.toHaveTextContent('unsupported-os');
  });

  it('keeps Back usable while pending and introduces no media or navigation operations', async () => {
    const task = deferred(); const api = { collect: vi.fn(() => task.promise) }; const onBack = vi.fn();
    const { container } = render(<DiagnosticsPage api={api} onBack={onBack} />);
    await userEvent.setup().click(screen.getByRole('button', { name: '戻る' }));
    expect(onBack.mock.calls).toEqual([[]]); expect(api.collect.mock.calls).toEqual([[]]);
    expect(container.querySelector('input, select, textarea, a, video, audio, canvas, iframe, img, [src]')).toBeNull();
    expect(container).not.toHaveTextContent(/アップロード|CPU動作可|推奨/);
  });
});

describe('DiagnosticsPage export (SEC-07C5)', () => {
  const saved: DiagnosticExportResult = { status: 'saved', path: 'C:\\Synthetic\\logs\\diagnostics.txt', byteLength: 880, sha256: 'a'.repeat(64) };
  const button = () => screen.getByRole('button', { name: '診断要約を保存' });
  const exportStatus = () => screen.getByRole('status', { name: '診断要約の保存状態' });
  const apiWithExport = () => ({ ...apiFor(), exportSummary: vi.fn<() => Promise<DiagnosticExportResult>>().mockResolvedValue(saved) });

  it.each([false, true])('never saves on mount, rerender, tab selection or collection (StrictMode=%s)', async (strict) => {
    const api = apiWithExport(), user = userEvent.setup(), onBack = vi.fn();
    const element = strict ? <StrictMode><DiagnosticsPage api={api} onBack={onBack} /></StrictMode> : <DiagnosticsPage api={api} onBack={onBack} />;
    const h = render(element); await screen.findByText('取得済み'); h.rerender(element);
    await user.click(runtimeTab()); await user.click(screen.getByRole('button', { name: '再取得' }));
    expect(api.exportSummary).not.toHaveBeenCalled(); expect(button()).toBeEnabled();
    expect(button()).toHaveAttribute('title', expect.stringContaining('診断し直し'));
    expect(screen.queryByRole('status', { name: '診断要約の保存状態' })).toBeNull();
  });

  it('keeps the old collect-only API usable and labels only export unavailable', async () => {
    const { user, api } = await ready();
    expect(screen.getByRole('button', { name: '要約保存：利用不可' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '再取得' })); expect(api.collect).toHaveBeenCalledTimes(2);
  });

  it('prevents duplicate export and refresh in the same synchronous event turn, but keeps Back available', async () => {
    const api = apiWithExport(), gate = Promise.withResolvers<DiagnosticExportResult>();
    api.exportSummary.mockReturnValueOnce(gate.promise);
    const { onBack, user } = await ready(api), save = button(), refresh = screen.getByRole('button', { name: '再取得' });
    act(() => { save.click(); save.click(); fireEvent.click(save); refresh.click(); });
    expect(api.exportSummary.mock.calls).toEqual([[]]); expect(api.exportSummary.mock.contexts).toEqual([api]);
    expect(api.collect).toHaveBeenCalledTimes(1); expect(save).toBeDisabled(); expect(refresh).toBeDisabled();
    expect(exportStatus()).toHaveTextContent('確認待ち・保存中');
    await user.click(screen.getByRole('button', { name: '戻る' })); expect(onBack).toHaveBeenCalledExactlyOnceWith();
    await act(async () => { gate.resolve(saved); });
    expect(exportStatus()).toHaveTextContent('診断要約を保存しました。'); expect(save).toBeEnabled();
  });

  it('does not send export while a diagnostic collection is pending', async () => {
    const api = apiWithExport(), gate = deferred(); api.collect.mockReturnValueOnce(gate.promise);
    render(<DiagnosticsPage api={api} onBack={vi.fn()} />);
    expect(button()).toBeDisabled(); fireEvent.click(button()); expect(api.exportSummary).not.toHaveBeenCalled();
    await act(async () => { gate.resolve(report()); }); expect(button()).toBeEnabled();
  });

  it.each([
    { result: { status: 'cancelled' } as const, message: '保存をキャンセルしました' },
    { result: { status: 'failed', code: 'DIAGNOSTIC_EXPORT_BUSY' } as const, message: '別の診断要約を確認・保存中' },
    { result: { status: 'failed', code: 'DIAGNOSTIC_EXPORT_FAILED' } as const, message: 'ファイルが残っている場合があります' },
  ])('distinguishes the result: $message, without losing diagnostic observations', async ({ result, message }) => {
    const api = apiWithExport(); api.exportSummary.mockResolvedValueOnce(result);
    const { user } = await ready(api); await user.click(button());
    expect(exportStatus()).toHaveTextContent(message); expect(metric('CPU', '名前')).toHaveTextContent('CPU 日本語 🧪');
    expect(screen.queryByRole('button', { name: '診断要約の保存先を表示' })).toBeNull(); expect(button()).toBeEnabled();
    await user.click(button()); expect(exportStatus()).toHaveTextContent('保存しました');
    expect(api.exportSummary).toHaveBeenCalledTimes(2); expect(api.collect).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: '再取得' }));
    expect(screen.queryByRole('status', { name: '診断要約の保存状態' })).toBeNull();
  });

  it.each(['throw', 'reject', 'malformed'] as const)('sanitizes %s instead of displaying native output or declaring cancellation', async (kind) => {
    const api = apiWithExport();
    if (kind === 'throw') api.exportSummary.mockImplementationOnce(() => { throw new Error('PRIVATE'); });
    else if (kind === 'reject') api.exportSummary.mockRejectedValueOnce(new Error('PRIVATE'));
    else api.exportSummary.mockResolvedValueOnce({ ...saved, stack: 'PRIVATE' } as DiagnosticExportResult);
    const { user, container } = await ready(api); await user.click(button());
    expect(exportStatus()).toHaveTextContent('保存結果を確認できません');
    expect(container).not.toHaveTextContent(/PRIVATE|保存をキャンセルしました|ロールバック/);
    expect(api.exportSummary).toHaveBeenCalledTimes(1);
  });

  it.each(['unmount', 'replace', 'round-trip'] as const)('ignores an old export completion after %s', async (kind) => {
    const api = apiWithExport(), gate = Promise.withResolvers<DiagnosticExportResult>(), next = apiWithExport();
    api.exportSummary.mockReturnValueOnce(gate.promise);
    const { user, rerender, unmount, container, onBack } = await ready(api); await user.click(button());
    if (kind === 'unmount') unmount();
    else {
      rerender(<DiagnosticsPage api={next} onBack={onBack} />);
      if (kind === 'round-trip') rerender(<DiagnosticsPage api={api} onBack={onBack} />);
    }
    await act(async () => { gate.resolve(saved); });
    expect(screen.queryByRole('status', { name: '診断要約の保存状態' })).toBeNull();
    if (kind === 'unmount') expect(container).toBeEmptyDOMElement();
    else expect(button()).toBeEnabled();
    expect(api.exportSummary).toHaveBeenCalledTimes(1); expect(next.exportSummary).not.toHaveBeenCalled();
  });
});