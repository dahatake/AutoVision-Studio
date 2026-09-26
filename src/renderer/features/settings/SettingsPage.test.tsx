import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useState, type ReactNode } from 'react';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import packageMetadata from '../../../../package.json';
import fluentSystemIconsLicense from '../../../../resources/licenses/fluent-system-icons.LICENSE.txt?raw';
import fluentSystemIconsNotice from '../../../../resources/licenses/fluent-system-icons.NOTICE.txt?raw';
import modelManifest from '../../../../resources/models/manifest.json';
import owlvitNotice from '../../../../resources/licenses/owlvit-base-patch32.NOTICE.txt?raw';
import { PRODUCT_VERSION } from '../../product-version';
import { settingsCategories, type SettingsCategoryId } from '../../routes';
import { SettingsPage } from './SettingsPage';

function renderSettings(category: SettingsCategoryId) {
  const onCategoryChange = vi.fn<(id: SettingsCategoryId) => void>();
  const onBack = vi.fn<() => void>();

  return {
    ...render(
      <SettingsPage category={category} onCategoryChange={onCategoryChange} onBack={onBack} />,
    ),
    onCategoryChange,
    onBack,
  };
}

function SettingsHarness({
  onCategoryChange,
  onBack,
}: Omit<Parameters<typeof SettingsPage>[0], 'category'>) {
  const [category, setCategory] = useState<SettingsCategoryId>('project');

  return (
    <SettingsPage
      category={category}
      onCategoryChange={(id) => {
        onCategoryChange(id);
        setCategory(id);
      }}
      onBack={onBack}
    />
  );
}

function DraftProjectPanel({ visible, onMount, onUnmount, onBack }: {
  visible: boolean;
  onMount: () => void;
  onUnmount: () => void;
  onBack: () => void;
}) {
  const [draft, setDraft] = useState('');
  useEffect(() => {
    onMount();
    return () => onUnmount();
  }, [onMount, onUnmount]);

  if (!visible) return null;
  return (
    <form aria-labelledby="test-project-heading" onSubmit={(event) => event.preventDefault()}>
      <h1 id="test-project-heading">Project 設定</h1>
      <label>
        Project名
        <input value={draft} onChange={(event) => setDraft(event.currentTarget.value)} />
      </label>
      <button type="button" onClick={() => onBack()}>戻る</button>
    </form>
  );
}

function DevicePanel({ onMount, onUnmount, onBack }: {
  onMount: () => void; onUnmount: () => void; onBack: () => void;
}) {
  useEffect(() => { onMount(); return () => onUnmount(); }, [onMount, onUnmount]);
  return <section aria-label="診断テスト">
    <h1>端末・容量</h1><button type="button" onClick={() => onBack()}>戻る</button>
  </section>;
}

describe('SettingsPage', () => {
  it('adds only optional Project/device slots, selection and visibility to the controlled props', () => {
    expectTypeOf<Parameters<typeof SettingsPage>[0]>().toEqualTypeOf<{
      category: SettingsCategoryId;
      onCategoryChange: (id: SettingsCategoryId) => void;
      onBack: () => void;
      renderProject?: (visible: boolean) => ReactNode;
      renderLabels?: (visible: boolean) => ReactNode;
      renderDevice?: () => ReactNode;
      hasProject?: boolean;
      visible?: boolean;
    }>();
  });

  it('renders five semantic category links with labelled headings and stable shell hooks', () => {
    const { container } = renderSettings('project');
    const pageHeading = screen.getByRole('heading', { level: 1, name: '設定' });
    const categoryHeading = screen.getByRole('heading', { level: 2, name: 'Project' });
    const navigation = screen.getByRole('navigation', { name: '設定カテゴリ' });
    const links = within(navigation).getAllByRole('link');

    expect(screen.getByRole('region', { name: '設定' })).toHaveClass('settings-page');
    expect(pageHeading.closest('header')).toHaveClass('settings-page__header');
    expect(pageHeading).toHaveAttribute('id', 'settings-heading');
    expect(pageHeading).toHaveAttribute('tabindex', '-1');
    expect(categoryHeading).toHaveAttribute('id', 'settings-category-heading');
    expect(categoryHeading).toHaveAttribute('tabindex', '-1');
    expect(screen.getAllByRole('heading')).toHaveLength(2);
    expect(navigation).toHaveClass('settings-page__category-navigation');
    expect(screen.getByRole('region', { name: 'Project' })).toHaveClass('settings-page__content');
    expect(screen.getByRole('region', { name: 'Project' })).toHaveAttribute('id', 'settings-project');
    expect(links).toHaveLength(5);
    expect(links.map((link) => link.textContent)).toEqual([
      'Project', 'ラベル定義', '推論', '端末・容量', 'ライセンス・情報',
    ]);
    for (const { id, label } of settingsCategories) {
      const link = within(navigation).getByRole('link', { name: label });
      expect(link).toHaveAttribute('id', `settings-category-${id}`);
      expect(link).toHaveAttribute('href', `#settings-${id}`);
      expect(link).not.toHaveAttribute('target');
      expect(link).not.toHaveAttribute('tabindex');
    }
    expect(within(navigation).getAllByRole('link', { current: 'page' })).toHaveLength(1);
    expect(within(navigation).getByRole('link', { current: 'page' })).toHaveTextContent('Project');
    expect(screen.queryByRole('tablist')).toBeNull();

    const back = screen.getByRole('button', { name: '戻る' });
    expect(back).toHaveAttribute('type', 'button');
    for (const element of [pageHeading, back]) {
      expect(element.querySelector('svg')).toHaveClass('system-icon');
      expect(element.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
      expect(element.querySelector('svg')).toHaveAttribute('focusable', 'false');
    }
    expect(screen.queryByRole('img')).toBeNull();
    const ids = Array.from(container.querySelectorAll('[id]'), (element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('waits for the parent category prop rather than keeping an internal selection', async () => {
    const user = userEvent.setup();
    const { rerender, onCategoryChange, onBack } = renderSettings('project');
    const labels = screen.getByRole('link', { name: 'ラベル定義' });
    const initialUrl = window.location.href;

    expect(onCategoryChange).not.toHaveBeenCalled();
    expect(onBack).not.toHaveBeenCalled();
    await user.click(labels);

    expect(onCategoryChange).toHaveBeenCalledTimes(1);
    expect(onCategoryChange).toHaveBeenCalledWith('labels');
    expect(labels).toHaveFocus();
    expect(labels).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('heading', { level: 2, name: 'Project' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: 'ラベル定義' })).toBeNull();
    expect(window.location.href).toBe(initialUrl);

    rerender(
      <SettingsPage category="inference" onCategoryChange={onCategoryChange} onBack={onBack} />,
    );

    expect(screen.getByRole('heading', { level: 2, name: '推論' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '推論' })).toHaveAttribute('aria-current', 'page');
    expect(labels).toHaveFocus();
    expect(onCategoryChange).toHaveBeenCalledTimes(1);
    expect(onBack).not.toHaveBeenCalled();
  });

  it('dispatches each category without browser navigation and calls back only on explicit return', async () => {
    const user = userEvent.setup();
    const onCategoryChange = vi.fn();
    const onBack = vi.fn();
    const clickPrevented = vi.fn();
    const initialUrl = window.location.href;
    render(
      <div onClick={(event) => clickPrevented(event.defaultPrevented)}>
        <SettingsHarness onCategoryChange={onCategoryChange} onBack={onBack} />
      </div>,
    );

    const navigation = screen.getByRole('navigation', { name: '設定カテゴリ' });
    for (const [index, { id, label }] of settingsCategories.entries()) {
      const link = within(navigation).getByRole('link', { name: label });
      await user.click(link);

      expect(onCategoryChange).toHaveBeenNthCalledWith(index + 1, id);
      expect(onCategoryChange).toHaveBeenCalledTimes(index + 1);
      expect(clickPrevented).toHaveBeenNthCalledWith(index + 1, true);
      expect(within(navigation).getAllByRole('link', { current: 'page' })).toHaveLength(1);
      expect(link).toHaveAttribute('aria-current', 'page');
      for (const otherLink of within(navigation).getAllByRole('link')) {
        if (otherLink !== link) expect(otherLink).not.toHaveAttribute('aria-current');
      }
      expect(link).toHaveFocus();
      expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(1);
      expect(screen.getByRole('heading', { level: 2, name: label })).toBeInTheDocument();
      expect(screen.getByRole('region', { name: label })).toHaveAttribute('id', `settings-${id}`);
      expect(window.location.href).toBe(initialUrl);
      expect(onBack).not.toHaveBeenCalled();
    }

    await user.click(screen.getByRole('button', { name: '戻る' }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onBack).toHaveBeenCalledWith();
    expect(onCategoryChange).toHaveBeenCalledTimes(5);
    expect(screen.getByRole('heading', { level: 2, name: 'ライセンス・情報' })).toBeInTheDocument();
    expect(window.location.href).toBe(initialUrl);
  });

  it('uses native Tab and Enter without activating a category on focus', async () => {
    const user = userEvent.setup();
    const onCategoryChange = vi.fn();
    const onBack = vi.fn();
    render(<SettingsHarness onCategoryChange={onCategoryChange} onBack={onBack} />);

    await user.tab();
    expect(screen.getByRole('button', { name: '戻る' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('link', { name: 'Project' })).toHaveFocus();
    await user.tab();
    const labels = screen.getByRole('link', { name: 'ラベル定義' });
    expect(labels).toHaveFocus();
    expect(onCategoryChange).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { level: 2, name: 'Project' })).toBeInTheDocument();

    await user.keyboard('{Enter}');
    expect(onCategoryChange).toHaveBeenCalledTimes(1);
    expect(onCategoryChange).toHaveBeenCalledWith('labels');
    expect(labels).toHaveFocus();
    expect(screen.getByRole('heading', { level: 2, name: 'ラベル定義' })).toBeInTheDocument();
    expect(onBack).not.toHaveBeenCalled();

    await user.tab({ shift: true });
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: '戻る' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onCategoryChange).toHaveBeenCalledTimes(1);
  });

  it.each([
    { category: 'project', message: 'Project設定の編集・保存は未実装です。' },
    { category: 'labels', message: 'ラベル定義の編集・保存は未実装です。' },
    { category: 'inference', message: '推論設定の編集・保存は未実装です。' },
  ] as const)('separates no Project from the unfinished $category backend', ({ category, message }) => {
    renderSettings(category);

    const noProject = screen.getByText('Projectは選択されていません。');
    const unfinished = screen.getByText(message);
    expect(noProject).toBeVisible();
    expect(unfinished).toBeVisible();
    expect(noProject.tagName).toBe('P');
    expect(unfinished.tagName).toBe('P');
    expect(noProject).not.toBe(unfinished);
  });

  it('shows device diagnostics and capacity as unimplemented, not successful or zero', () => {
    const { container } = renderSettings('device');

    expect(screen.getByText('診断・容量確認は未実装です。')).toBeVisible();
    expect(screen.queryByText('Projectは選択されていません。')).toBeNull();
    expect(container).not.toHaveTextContent(/CPU|GPU|\b0\s*(?:bytes|[KMGT]?i?B)\b/i);
  });

  it.each(settingsCategories)('does not invent editable settings or saved values in $id', ({ id }) => {
    const { container, onCategoryChange, onBack } = renderSettings(id);

    expect(container.querySelectorAll(
      'form, input, select, textarea, [contenteditable], [role="textbox"], [role="checkbox"], [role="switch"], [role="slider"], [role="combobox"]',
    )).toHaveLength(0);
    expect(container.querySelectorAll('button')).toHaveLength(1);
    expect(screen.getByRole('button', { name: '戻る' })).toBeEnabled();
    expect(screen.getAllByRole('link')).toHaveLength(5);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(container.querySelector('video, audio, canvas, iframe, img, [src]')).toBeNull();
    expect(container).not.toHaveTextContent(/保存済み|保存データ|データ(?:が|は)ありません|CPU可|\b0\s*(?:bytes|[KMGT]?i?B)\b/i);
    if (id !== 'information') {
      expect(screen.queryByLabelText(/^製品バージョン /)).toBeNull();
      expect(container.querySelector('details')).toBeNull();
    }
    expect(onCategoryChange).not.toHaveBeenCalled();
    expect(onBack).not.toHaveBeenCalled();
  });

  it('shows the real root product version and distinguishes unfinished third-party information', () => {
    renderSettings('information');

    expect(PRODUCT_VERSION).toBe(packageMetadata.version);
    expect(screen.getAllByLabelText(/^製品バージョン /)).toHaveLength(1);
    expect(screen.getByLabelText(`製品バージョン ${packageMetadata.version}`)).toHaveTextContent(
      `バージョン ${packageMetadata.version}`,
    );
    expect(screen.queryByText(/worker|APIバージョン|スキーマバージョン/i)).toBeNull();
    expect(screen.getByText('その他の第三者通知・SBOM・モデル由来の表示は未実装です。')).toBeVisible();
    expect(screen.queryByText('Projectは選択されていません。')).toBeNull();
  });

  it('opens separate full-text LICENSE and NOTICE disclosures without normalizing or duplicating them', async () => {
    const user = userEvent.setup();
    const { container, onCategoryChange, onBack } = renderSettings('information');
    const license = screen.getByLabelText('Fluent System Icons LICENSE');
    const notice = screen.getByLabelText('Fluent System Icons NOTICE');
    const licenseSummary = screen.getByText('Fluent System Icons LICENSEを開く');
    const noticeSummary = screen.getByText('Fluent System Icons NOTICEを開く');

    expect(container.querySelectorAll('details')).toHaveLength(3);
    expect(container.querySelectorAll('pre')).toHaveLength(3);
    expect(license.closest('details')).not.toBe(notice.closest('details'));
    for (const [text, summary] of [[license, licenseSummary], [notice, noticeSummary]]) {
      expect(text.tagName).toBe('PRE');
      expect(text).toHaveClass('license-text');
      expect(text).toHaveAttribute('tabindex', '0');
      expect(text.childElementCount).toBe(0);
      expect(text.closest('details')).not.toHaveAttribute('open');
      expect(text).not.toBeVisible();
      expect(summary.tagName).toBe('SUMMARY');
      expect(summary).toBeVisible();
    }

    await user.click(licenseSummary);
    expect(license.closest('details')).toHaveAttribute('open');
    expect(license).toBeVisible();
    expect(license.textContent).toBe(fluentSystemIconsLicense);
    expect(notice).not.toBeVisible();
    await user.tab();
    expect(license).toHaveFocus();

    await user.click(noticeSummary);
    expect(notice.closest('details')).toHaveAttribute('open');
    expect(notice).toBeVisible();
    expect(notice.textContent).toBe(fluentSystemIconsNotice);
    expect(license.textContent).toBe(fluentSystemIconsLicense);
    expect(screen.getAllByLabelText('Fluent System Icons LICENSE')).toHaveLength(1);
    expect(screen.getAllByLabelText('Fluent System Icons NOTICE')).toHaveLength(1);
    await user.tab();
    expect(notice).toHaveFocus();

    await user.click(licenseSummary);
    expect(license).not.toBeVisible();
    expect(notice).toBeVisible();
    await user.click(noticeSummary);
    expect(notice).not.toBeVisible();
    expect(onCategoryChange).not.toHaveBeenCalled();
    expect(onBack).not.toHaveBeenCalled();
  });

  // FR-LIC-003 / FR-LIC-012: the OWL-ViT research-only condition and its NOTICE
  // come from the approved manifest entry, not from a separately written text.
  it('shows the OWL-ViT research-only condition and the NOTICE that carries the manifest notice', async () => {
    const user = userEvent.setup();
    renderSettings('information');
    const entry = modelManifest.models.find((model) => model.id === 'owlvit-base-patch32');
    const normalize = (text: string) => text.replace(/\s+/gu, ' ').trim();

    expect(screen.getByText('OWL-ViT base patch32 を用いる物体検出の補助候補の利用条件は「研究目的に限る」です（補助候補の機能は未実装です）。')).toBeVisible();
    const notice = screen.getByLabelText('OWL-ViT base patch32 NOTICE');
    expect(notice).not.toBeVisible();
    await user.click(screen.getByText('OWL-ViT base patch32 NOTICEを開く'));
    expect(notice).toBeVisible();
    expect(notice.textContent).toBe(owlvitNotice);
    expect(entry).toBeDefined();
    expect(normalize(owlvitNotice)).toContain(normalize(entry!.licenses.checkpoint.noticeText));
    expect(normalize(owlvitNotice)).toContain('OWL-ViT assist suggestions are provided for research purposes only.');
  });

  it.each(settingsCategories)('calls the fixed Project slot on every $id render with effective visibility', ({ id }) => {
    const renderProject = vi.fn((_visible: boolean) => null);
    const onCategoryChange = vi.fn();
    const onBack = vi.fn();
    const props = { category: id, renderProject, onCategoryChange, onBack };
    const { rerender } = render(<SettingsPage {...props} />);

    expect(renderProject.mock.calls).toEqual([[false]]);
    rerender(<SettingsPage {...props} hasProject />);
    rerender(<SettingsPage {...props} hasProject />);
    rerender(<SettingsPage {...props} hasProject visible={false} />);
    rerender(<SettingsPage {...props} hasProject={false} visible />);
    rerender(<SettingsPage {...props} hasProject visible />);

    expect(renderProject.mock.calls).toEqual([
      [false], [id === 'project'], [id === 'project'], [false], [false], [id === 'project'],
    ]);
    expect(onCategoryChange).not.toHaveBeenCalled();
    expect(onBack).not.toHaveBeenCalled();
  });

  it.each([
    { category: 'project', message: 'Project設定の編集・保存は未実装です。' },
    { category: 'labels', message: 'ラベル定義の編集・保存は未実装です。' },
    { category: 'inference', message: '推論設定の編集・保存は未実装です。' },
  ] as const)('does not claim a selected Project is absent in unfinished $category settings', ({ category, message }) => {
    render(<SettingsPage category={category} hasProject onCategoryChange={vi.fn()} onBack={vi.fn()} />);

    expect(screen.queryByText('Projectは選択されていません。')).toBeNull();
    expect(screen.getByText(message)).toBeVisible();
    expect(screen.getByRole('heading', { level: 1, name: '設定' })).toBeVisible();
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(1);
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('retains one stateful panel and its draft through hidden pages, every category and no selection', async () => {
    const user = userEvent.setup();
    const onMount = vi.fn();
    const onUnmount = vi.fn();
    const onBack = vi.fn();
    const onCategoryChange = vi.fn();
    const renderProject = vi.fn((visible: boolean) => (
      <DraftProjectPanel visible={visible} onMount={onMount} onUnmount={onUnmount} onBack={onBack} />
    ));
    const props = { category: 'project' as const, renderProject, onCategoryChange, onBack };
    const { container, rerender, unmount } = render(<SettingsPage {...props} />);
    const slot = container.querySelector('.settings-page__content')!.firstElementChild;

    expect(onMount).toHaveBeenCalledTimes(1);
    expect(renderProject).toHaveBeenLastCalledWith(false);
    expect(slot).toHaveAttribute('hidden');
    expect(slot).not.toHaveAttribute('class');
    expect(container.querySelector('input')).toBeNull();
    expect(screen.getByText('Projectは選択されていません。')).toBeVisible();

    rerender(<SettingsPage {...props} hasProject />);
    await user.type(screen.getByRole('textbox', { name: 'Project名' }), '保持する下書き');
    for (const inactive of [
      { category: 'project', hasProject: true, visible: false },
      { category: 'labels', hasProject: true, visible: true },
      { category: 'inference', hasProject: true, visible: true },
      { category: 'device', hasProject: true, visible: true },
      { category: 'information', hasProject: true, visible: true },
      { category: 'project', hasProject: false, visible: true },
    ] as const) {
      rerender(<SettingsPage {...props} {...inactive} />);

      expect(renderProject).toHaveBeenLastCalledWith(false);
      expect(container.querySelector('.settings-page__content')!.firstElementChild).toBe(slot);
      expect(slot).toHaveAttribute('hidden');
      expect(container.querySelector('input')).toBeNull();
      expect(onMount).toHaveBeenCalledTimes(1);
      expect(onUnmount).not.toHaveBeenCalled();
      if (inactive.visible) {
        expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(1);
        expect(screen.queryByText('Projectは選択されていません。') !== null).toBe(!inactive.hasProject);
      }

      rerender(<SettingsPage {...props} hasProject />);

      expect(renderProject).toHaveBeenLastCalledWith(true);
      expect(container.querySelector('.settings-page__content')!.firstElementChild).toBe(slot);
      expect(slot).not.toHaveAttribute('hidden');
      expect(screen.getByRole('textbox', { name: 'Project名' })).toHaveValue('保持する下書き');
      expect(onMount).toHaveBeenCalledTimes(1);
      expect(onUnmount).not.toHaveBeenCalled();
    }
    expect(onCategoryChange).not.toHaveBeenCalled();
    expect(onBack).not.toHaveBeenCalled();
    unmount();
    expect(onUnmount).toHaveBeenCalledTimes(1);
  });

  it('keeps focus labels and controlled links while the active panel owns the only heading and back button', async () => {
    const user = userEvent.setup();
    const onMount = vi.fn();
    const onUnmount = vi.fn();
    const onPanelBack = vi.fn();
    const onBack = vi.fn();
    const onCategoryChange = vi.fn();
    const renderProject = (visible: boolean) => (
      <DraftProjectPanel visible={visible} onMount={onMount} onUnmount={onUnmount} onBack={onPanelBack} />
    );
    const props = { renderProject, hasProject: true, onCategoryChange, onBack };
    const { container, rerender } = render(<SettingsPage {...props} category="project" />);
    const page = screen.getByRole('region', { name: '設定' });
    const content = within(page).getByRole('region', { name: 'Project' });
    const entry = container.querySelector<HTMLElement>('#settings-heading')!;
    const categoryLabel = container.querySelector('#settings-category-heading')!;

    expect(entry.tagName).toBe('P');
    expect(entry).toHaveAttribute('tabindex', '-1');
    entry.focus();
    expect(entry).toHaveFocus();
    expect(categoryLabel.tagName).toBe('P');
    expect(categoryLabel).toHaveTextContent('Project');
    expect(content).toHaveAttribute('aria-labelledby', categoryLabel.id);
    expect(content).toHaveAttribute('id', 'settings-project');
    expect(screen.getAllByRole('heading')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Project 設定' })).toBeVisible();
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
    expect(screen.queryByText('Project設定の編集・保存は未実装です。')).toBeNull();
    expect(screen.queryByText('Projectは選択されていません。')).toBeNull();
    expect(entry.closest('header')!.querySelector('button')).toBeNull();
    expect(screen.getAllByRole('button', { name: '戻る' })).toHaveLength(1);
    const ids = Array.from(container.querySelectorAll('[id]'), (element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);

    const initialUrl = window.location.href;
    const labels = screen.getByRole('link', { name: 'ラベル定義' });
    await user.click(labels);
    expect(onCategoryChange).toHaveBeenCalledExactlyOnceWith('labels');
    expect(labels).toHaveFocus();
    expect(labels).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Project' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('heading', { level: 1, name: 'Project 設定' })).toBeVisible();
    expect(window.location.href).toBe(initialUrl);
    expect(onBack).not.toHaveBeenCalled();
    expect(onPanelBack).not.toHaveBeenCalled();
    await user.click(within(content).getByRole('button', { name: '戻る' }));
    expect(onPanelBack).toHaveBeenCalledExactlyOnceWith();
    expect(onBack).not.toHaveBeenCalled();

    rerender(<SettingsPage {...props} category="labels" />);
    expect(screen.getByRole('heading', { level: 1, name: '設定' })).toBeVisible();
    expect(screen.getByRole('heading', { level: 2, name: 'ラベル定義' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'ラベル定義' })).toHaveAttribute('id', 'settings-labels');
    expect(labels).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('ラベル定義の編集・保存は未実装です。')).toBeVisible();
    expect(screen.queryByText('Projectは選択されていません。')).toBeNull();
    await user.click(screen.getByRole('button', { name: '戻る' }));
    expect(onBack).toHaveBeenCalledExactlyOnceWith();
    expect(onPanelBack).toHaveBeenCalledTimes(1);
    expect(onCategoryChange).toHaveBeenCalledTimes(1);
  });

  it('hides the grid page explicitly without unmounting open full-text notices', async () => {
    const user = userEvent.setup();
    const onCategoryChange = vi.fn();
    const onBack = vi.fn();
    const props = { category: 'information' as const, onCategoryChange, onBack };
    const { rerender } = render(<SettingsPage {...props} />);
    const page = screen.getByRole('region', { name: '設定' });
    const license = screen.getByLabelText('Fluent System Icons LICENSE');
    const notice = screen.getByLabelText('Fluent System Icons NOTICE');
    await user.click(screen.getByText('Fluent System Icons LICENSEを開く'));
    await user.click(screen.getByText('Fluent System Icons NOTICEを開く'));

    rerender(<SettingsPage {...props} visible={false} />);

    expect(page).toBeInTheDocument();
    expect(page).toHaveAttribute('hidden');
    expect(page.style.display).toBe('none');
    expect(page).not.toBeVisible();
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(license).toBeInTheDocument();
    expect(notice).toBeInTheDocument();

    rerender(<SettingsPage {...props} />);

    expect(screen.getByRole('region', { name: '設定' })).toBe(page);
    expect(page).not.toHaveAttribute('hidden');
    expect(page.style.display).toBe('');
    expect(screen.getByLabelText('Fluent System Icons LICENSE')).toBe(license);
    expect(screen.getByLabelText('Fluent System Icons NOTICE')).toBe(notice);
    expect(license).toBeVisible();
    expect(notice).toBeVisible();
    expect(license.textContent).toBe(fluentSystemIconsLicense);
    expect(notice.textContent).toBe(fluentSystemIconsNotice);
    expect(screen.getByText('その他の第三者通知・SBOM・モデル由来の表示は未実装です。')).toBeVisible();
    expect(onCategoryChange).not.toHaveBeenCalled();
    expect(onBack).not.toHaveBeenCalled();
  });

  it('invokes the device renderer only in the visible device category, independently of Project selection', () => {
    const renderDevice = vi.fn<() => ReactNode>(() => null);
    const renderProject = vi.fn((_visible: boolean) => null);
    const props = { renderDevice, renderProject, hasProject: true, onBack: vi.fn(), onCategoryChange: vi.fn() };
    const { container, rerender } = render(<SettingsPage {...props} category="project" />);
    const slot = container.querySelector('.settings-page__content')!.firstElementChild;
    let deviceRenders = 0;
    for (const { id } of settingsCategories) {
      for (const visible of [false, true]) {
        rerender(<SettingsPage {...props} category={id} visible={visible} />);
        if (visible && id === 'device') deviceRenders++;
        expect(renderDevice).toHaveBeenCalledTimes(deviceRenders);
        expect(renderProject).toHaveBeenLastCalledWith(visible && id === 'project');
        expect(container.querySelector('.settings-page__content')!.firstElementChild).toBe(slot);
        expect(container.querySelector('.settings-page')!.classList.contains('settings-page--device')).toBe(visible && id === 'device');
        if (id === 'device') expect(container).not.toHaveTextContent('診断・容量確認は未実装です。');
      }
    }
    rerender(<SettingsPage {...props} category="device" hasProject={false} />);
    expect(renderDevice.mock.calls).toEqual([[], []]); expect(renderProject).toHaveBeenLastCalledWith(false);
    expect(props.onCategoryChange).not.toHaveBeenCalled(); expect(props.onBack).not.toHaveBeenCalled();
  });

  it('lets the active device own the only h1 and Back while retaining the settings focus labels and controlled navigation', async () => {
    const user = userEvent.setup(), onBack = vi.fn(), onDeviceBack = vi.fn(), onCategoryChange = vi.fn();
    const renderDevice = vi.fn(() => <DevicePanel onMount={vi.fn()} onUnmount={vi.fn()} onBack={onDeviceBack} />);
    const { container } = render(<SettingsPage category="device" renderDevice={renderDevice}
      onBack={onBack} onCategoryChange={onCategoryChange} />);
    const entry = container.querySelector<HTMLElement>('#settings-heading')!;
    const categoryLabel = container.querySelector('#settings-category-heading')!;
    expect(entry.tagName).toBe('P'); expect(entry).toHaveAttribute('tabindex', '-1');
    entry.focus(); expect(entry).toHaveFocus(); expect(categoryLabel.tagName).toBe('P');
    expect(categoryLabel).toHaveTextContent('端末・容量');
    expect(categoryLabel).toHaveAttribute('hidden'); expect(categoryLabel).not.toBeVisible();
    expect(screen.getByRole('region', { name: '端末・容量' })).toHaveAttribute('aria-labelledby', categoryLabel.id);
    expect(screen.getAllByRole('heading')).toEqual([screen.getByRole('heading', { level: 1, name: '端末・容量' })]);
    expect(screen.getAllByRole('button', { name: '戻る' })).toHaveLength(1);
    expect(entry.closest('header')!.querySelector('button')).toBeNull();
    expect(screen.queryByText('診断・容量確認は未実装です。')).toBeNull();
    expect(screen.queryByText('Projectは選択されていません。')).toBeNull();
    const project = screen.getByRole('link', { name: 'Project' }); await user.click(project);
    expect(onCategoryChange).toHaveBeenCalledExactlyOnceWith('project'); expect(project).toHaveFocus();
    expect(screen.getByRole('link', { name: '端末・容量' })).toHaveAttribute('aria-current', 'page');
    expect(renderDevice).toHaveBeenCalledExactlyOnceWith();
    await user.click(screen.getByRole('button', { name: '戻る' }));
    expect(onDeviceBack).toHaveBeenCalledExactlyOnceWith(); expect(onBack).not.toHaveBeenCalled();
  });

  it('unmounts only the inactive device and preserves the fixed Project instance and draft through diagnostic rerenders', async () => {
    const user = userEvent.setup(), onBack = vi.fn(), onCategoryChange = vi.fn();
    const projectMount = vi.fn(), projectUnmount = vi.fn(), deviceMount = vi.fn(), deviceUnmount = vi.fn();
    const renderProject = (visible: boolean) => <DraftProjectPanel visible={visible}
      onMount={projectMount} onUnmount={projectUnmount} onBack={onBack} />;
    const renderDevice = () => <DevicePanel onMount={deviceMount} onUnmount={deviceUnmount} onBack={onBack} />;
    const props = { renderProject, renderDevice, hasProject: true, onBack, onCategoryChange };
    const { container, rerender, unmount } = render(<SettingsPage {...props} category="project" />);
    const slot = container.querySelector('.settings-page__content')!.firstElementChild;
    await user.type(screen.getByRole('textbox', { name: 'Project名' }), '診断中も保持する下書き');
    rerender(<SettingsPage {...props} category="device" />);
    const heading = screen.getByRole('heading', { level: 1, name: '端末・容量' });
    expect(container.querySelector('input')).toBeNull(); expect(deviceMount).toHaveBeenCalledTimes(1);
    rerender(<SettingsPage {...props} category="device" renderDevice={() => renderDevice()} />);
    expect(screen.getByRole('heading', { level: 1, name: '端末・容量' })).toBe(heading);
    expect(deviceMount).toHaveBeenCalledTimes(1); expect(deviceUnmount).not.toHaveBeenCalled();
    rerender(<SettingsPage {...props} category="device" visible={false} />);
    expect(heading).not.toBeInTheDocument(); expect(deviceUnmount).toHaveBeenCalledTimes(1);
    rerender(<SettingsPage {...props} category="project" />);
    expect(screen.getByRole('textbox', { name: 'Project名' })).toHaveValue('診断中も保持する下書き');
    rerender(<SettingsPage {...props} category="device" />);
    expect(deviceMount).toHaveBeenCalledTimes(2);
    rerender(<SettingsPage {...props} category="information" />);
    expect(deviceUnmount).toHaveBeenCalledTimes(2);
    rerender(<SettingsPage {...props} category="project" />);
    expect(container.querySelector('.settings-page__content')!.firstElementChild).toBe(slot);
    expect(screen.getByRole('textbox', { name: 'Project名' })).toHaveValue('診断中も保持する下書き');
    expect(projectMount).toHaveBeenCalledTimes(1); expect(projectUnmount).not.toHaveBeenCalled();
    expect(onBack).not.toHaveBeenCalled(); expect(onCategoryChange).not.toHaveBeenCalled();
    unmount(); expect(projectUnmount).toHaveBeenCalledTimes(1); expect(deviceUnmount).toHaveBeenCalledTimes(2);
  });
});