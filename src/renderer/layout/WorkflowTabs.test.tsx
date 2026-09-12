import { act, createEvent, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { workflowTabs, type WorkflowTabId } from '../routes';
import { WorkflowTabs, type WorkflowTabsProps } from './WorkflowTabs';

function PanelHarness({
  initialTab,
  onSelect,
}: {
  initialTab: WorkflowTabId;
  onSelect: WorkflowTabsProps['onSelect'];
}) {
  const [activeTab, setActiveTab] = useState(initialTab);

  return (
    <>
      <button type="button">前の操作</button>
      <WorkflowTabs
        activeTab={activeTab}
        onSelect={(tab) => {
          onSelect(tab);
          setActiveTab(tab);
        }}
      />
      {workflowTabs.map((tab) => (
        <section
          key={tab.id}
          role="tabpanel"
          id={`workflow-panel-${tab.id}`}
          aria-labelledby={`workflow-tab-${tab.id}`}
          hidden={tab.id !== activeTab}
          tabIndex={0}
        >
          {tab.id === activeTab ? '作業パネル（テスト用）' : null}
        </section>
      ))}
      <button type="button">次の操作</button>
    </>
  );
}

function expectTabState(activeTab: WorkflowTabId, tabStop: WorkflowTabId) {
  expect(
    screen.getAllByRole('tab').filter((tab) => tab.tabIndex === 0),
  ).toHaveLength(1);

  for (const tab of workflowTabs) {
    const button = screen.getByRole('tab', { name: tab.label });
    expect(button).toHaveAttribute('aria-selected', String(tab.id === activeTab));
    expect(button).toHaveAttribute('tabindex', tab.id === tabStop ? '0' : '-1');
  }
}

describe('WorkflowTabs', () => {
  it('renders five Japanese native tabs with stable IDs and decorative icons', () => {
    const onSelect = vi.fn();
    render(<WorkflowTabs activeTab="training" onSelect={onSelect} />);

    const tablist = screen.getByRole('tablist', { name: '作業' });
    const tabs = within(tablist).getAllByRole('tab');
    expect(tablist).toHaveClass('workflow-tabs');
    expect(tabs).toHaveLength(5);
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      '取り込む',
      '教師データ',
      '学習',
      '結果',
      'カメラで試す',
    ]);

    for (const tab of workflowTabs) {
      const button = within(tablist).getByRole('tab', { name: tab.label });
      expect(button.tagName).toBe('BUTTON');
      expect(button).toHaveAttribute('type', 'button');
      expect(button).toHaveAttribute('id', `workflow-tab-${tab.id}`);
      expect(button).toHaveAttribute('aria-controls', `workflow-panel-${tab.id}`);
      expect(button).toHaveClass('workflow-tabs__tab');
      expect(button).toBeEnabled();
      expect(button).toHaveAccessibleName(tab.label);
      expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
      expect(button.querySelector('svg')).toHaveAttribute('focusable', 'false');
    }

    expectTabState('training', 'training');
    expect(tabs.some((tab) => tab === document.activeElement)).toBe(false);
    expect(screen.queryByRole('tabpanel')).not.toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('moves focus in both directions with wrapping and Home/End without selecting', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<WorkflowTabs activeTab="annotations" onSelect={onSelect} />);

    await user.tab();
    expect(screen.getByRole('tab', { name: '教師データ' })).toHaveFocus();

    for (const [key, id] of [
      ['{ArrowRight}', 'training'],
      ['{ArrowRight}', 'reports'],
      ['{ArrowRight}', 'camera'],
      ['{ArrowRight}', 'import'],
      ['{ArrowLeft}', 'camera'],
      ['{Home}', 'import'],
      ['{End}', 'camera'],
      ['{ArrowLeft}', 'reports'],
    ] as const) {
      await user.keyboard(key);
      expect(document.activeElement).toHaveAttribute('id', `workflow-tab-${id}`);
      expectTabState('annotations', id);
      expect(onSelect).not.toHaveBeenCalled();
    }
  });

  it('prevents the browser default for handled navigation keys', () => {
    const onSelect = vi.fn();
    render(<WorkflowTabs activeTab="import" onSelect={onSelect} />);
    const tab = screen.getByRole('tab', { name: '取り込む' });

    for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) {
      act(() => tab.focus());
      const event = createEvent.keyDown(tab, { key });
      fireEvent(tab, event);
      expect(event.defaultPrevented).toBe(true);
    }

    expect(screen.getByRole('tab', { selected: true })).toBe(tab);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('activates the focused tab exactly once through native Enter', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<PanelHarness initialTab="annotations" onSelect={onSelect} />);

    await user.tab();
    await user.tab();
    await user.keyboard('{ArrowRight}');
    expectTabState('annotations', 'training');
    expect(onSelect).not.toHaveBeenCalled();

    await user.keyboard('{Enter}');

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('training');
    expectTabState('training', 'training');
    expect(screen.getByRole('tab', { name: '学習' })).toHaveFocus();
    expect(screen.getByRole('tabpanel', { name: '学習' })).toBeInTheDocument();
  });

  it('activates exactly once on native Space release rather than keydown', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<PanelHarness initialTab="import" onSelect={onSelect} />);

    await user.tab();
    await user.tab();
    await user.keyboard('{ArrowRight}');
    await user.keyboard('[Space>]');
    expectTabState('import', 'annotations');
    expect(onSelect).not.toHaveBeenCalled();

    await user.keyboard('[/Space]');

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('annotations');
    expectTabState('annotations', 'annotations');
    expect(screen.getByRole('tab', { name: '教師データ' })).toHaveFocus();
  });

  it('selects once on a mouse click without submitting an enclosing form', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onSubmit = vi.fn();
    render(
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <WorkflowTabs activeTab="import" onSelect={onSelect} />
      </form>,
    );

    const cameraTab = screen.getByRole('tab', { name: 'カメラで試す' });
    await user.click(cameraTab);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('camera');
    expect(cameraTab).toHaveFocus();
    expectTabState('import', 'camera');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('updates the tab stop on click even without a focus event or parent approval', () => {
    const onSelect = vi.fn();
    render(<WorkflowTabs activeTab="import" onSelect={onSelect} />);
    const originalFocus = document.activeElement;

    fireEvent.click(screen.getByRole('tab', { name: '結果' }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('reports');
    expectTabState('import', 'reports');
    expect(document.activeElement).toBe(originalFocus);
  });

  it('updates only the tab stop when focus moves within the tablist', () => {
    const onSelect = vi.fn();
    render(<WorkflowTabs activeTab="training" onSelect={onSelect} />);
    const cameraTab = screen.getByRole('tab', { name: 'カメラで試す' });
    const reportsTab = screen.getByRole('tab', { name: '結果' });

    act(() => cameraTab.focus());
    expectTabState('training', 'camera');
    act(() => reportsTab.focus());

    expect(reportsTab).toHaveFocus();
    expectTabState('training', 'reports');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('tabs out to the active panel and reenters at the selected tab', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<PanelHarness initialTab="annotations" onSelect={onSelect} />);

    await user.tab();
    await user.tab();
    await user.keyboard('{End}');
    expectTabState('annotations', 'camera');
    await user.tab();

    expect(screen.getByRole('tabpanel', { name: '教師データ' })).toHaveFocus();
    expectTabState('annotations', 'annotations');
    await user.tab({ shift: true });

    expect(screen.getByRole('tab', { name: '教師データ' })).toHaveFocus();
    expectTabState('annotations', 'annotations');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('leaves backwards with Shift+Tab and reenters at the selected tab', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<PanelHarness initialTab="reports" onSelect={onSelect} />);

    await user.tab();
    await user.tab();
    await user.keyboard('{Home}');
    expectTabState('reports', 'import');
    await user.tab({ shift: true });

    expect(screen.getByRole('button', { name: '前の操作' })).toHaveFocus();
    expectTabState('reports', 'reports');
    await user.tab();

    expect(screen.getByRole('tab', { name: '結果' })).toHaveFocus();
    expectTabState('reports', 'reports');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('resets on outside blur including a null related target without pulling focus back', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <>
        <WorkflowTabs activeTab="training" onSelect={onSelect} />
        <button type="button">設定</button>
      </>,
    );
    const cameraTab = screen.getByRole('tab', { name: 'カメラで試す' });
    const settings = screen.getByRole('button', { name: '設定' });

    act(() => cameraTab.focus());
    expectTabState('training', 'camera');
    await user.click(settings);
    expect(settings).toHaveFocus();
    expectTabState('training', 'training');

    act(() => cameraTab.focus());
    act(() => cameraTab.blur());

    expect(document.body).toHaveFocus();
    expectTabState('training', 'training');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('does not cancel or navigate for unhandled keys or native activation keys', () => {
    const onSelect = vi.fn();
    render(<WorkflowTabs activeTab="reports" onSelect={onSelect} />);
    const tab = screen.getByRole('tab', { name: '結果' });
    act(() => tab.focus());

    // Check cancellation only; user-event covers native activation and Tab above.
    for (const key of ['ArrowUp', 'ArrowDown', 'Escape', 'a', 'Tab', 'Enter', ' ']) {
      const event = createEvent.keyDown(tab, { key });
      fireEvent(tab, event);
      expect(event.defaultPrevented).toBe(false);
      expect(tab).toHaveFocus();
      expectTabState('reports', 'reports');
      expect(onSelect).not.toHaveBeenCalled();
    }
  });

  it('ignores navigation keys during IME composition', () => {
    const onSelect = vi.fn();
    render(<WorkflowTabs activeTab="annotations" onSelect={onSelect} />);
    const tab = screen.getByRole('tab', { name: '教師データ' });
    act(() => tab.focus());

    for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) {
      const event = createEvent.keyDown(tab, { key, isComposing: true });
      fireEvent(tab, event);
      expect(event.defaultPrevented).toBe(false);
      expect(tab).toHaveFocus();
      expectTabState('annotations', 'annotations');
      expect(onSelect).not.toHaveBeenCalled();
    }
  });

  it('synchronizes external selection without stealing focus from outside', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const { rerender } = render(
      <>
        <button type="button">設定</button>
        <WorkflowTabs activeTab="annotations" onSelect={onSelect} />
      </>,
    );
    await user.tab();
    const settings = screen.getByRole('button', { name: '設定' });
    expect(settings).toHaveFocus();

    rerender(
      <>
        <button type="button">設定</button>
        <WorkflowTabs activeTab="camera" onSelect={onSelect} />
      </>,
    );

    expect(settings).toHaveFocus();
    expectTabState('camera', 'camera');
    await user.tab();
    expect(screen.getByRole('tab', { name: 'カメラで試す' })).toHaveFocus();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('preserves DOM focus on external selection and navigates from the actual focused tab', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const { rerender } = render(
      <WorkflowTabs activeTab="import" onSelect={onSelect} />,
    );
    await user.tab();
    const importTab = screen.getByRole('tab', { name: '取り込む' });

    rerender(<WorkflowTabs activeTab="reports" onSelect={onSelect} />);

    expect(importTab).toHaveFocus();
    expectTabState('reports', 'import');
    // Home targets the already-focused node, which does not emit another focus.
    await user.keyboard('{Home}');
    expect(importTab).toHaveFocus();
    expectTabState('reports', 'import');
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: '教師データ' })).toHaveFocus();
    expectTabState('reports', 'annotations');

    rerender(<WorkflowTabs activeTab="reports" onSelect={onSelect} />);

    expect(screen.getByRole('tab', { name: '教師データ' })).toHaveFocus();
    expectTabState('reports', 'annotations');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it.each([
    ['import', 'reports', false],
    ['reports', 'import', true],
  ] as const)('leaves the tablist after external selection from %s to %s', async (initial, next, shift) => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const view = (activeTab: WorkflowTabId) => (
      <>
        <button type="button">前の操作</button>
        <WorkflowTabs activeTab={activeTab} onSelect={onSelect} />
        <button type="button">次の操作</button>
      </>
    );
    const { rerender } = render(view(initial));
    await user.tab();
    await user.tab();
    rerender(view(next));
    expectTabState(next, initial);

    await user.tab({ shift });
    expect(screen.getByRole('button', { name: shift ? '前の操作' : '次の操作' })).toHaveFocus();
    expectTabState(next, next);
    await user.tab({ shift: !shift });
    expect(document.activeElement).toHaveAttribute('id', `workflow-tab-${next}`);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('keeps every panel reference valid while exactly one panel is visible', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<PanelHarness initialTab="import" onSelect={onSelect} />);
    const relationships = screen.getAllByRole('tab').map((tab) => [
      tab.id,
      tab.getAttribute('aria-controls'),
    ]);

    for (const tab of workflowTabs) {
      const button = screen.getByRole('tab', { name: tab.label });
      await user.click(button);

      const panel = screen.getByRole('tabpanel', { name: tab.label });
      expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
      expect(screen.getAllByRole('tabpanel', { hidden: true })).toHaveLength(5);
      for (const [tabId, panelId] of relationships) {
        expect(document.getElementById(panelId!)).toHaveAttribute('aria-labelledby', tabId);
      }
      expect(panel).toHaveAttribute('id', `workflow-panel-${tab.id}`);
      expect(panel).toHaveAttribute('aria-labelledby', button.id);
      expect(panel).toHaveAttribute('tabindex', '0');
      expect(button).toHaveAttribute('aria-controls', panel.id);
      expectTabState(tab.id, tab.id);
      expect(
        screen.getAllByRole('tab').map((item) => [
          item.id,
          item.getAttribute('aria-controls'),
        ]),
      ).toEqual(relationships);
    }

    expect(onSelect.mock.calls).toEqual(workflowTabs.map((tab) => [tab.id]));
  });
});