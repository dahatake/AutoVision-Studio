import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

import { SystemIcon } from '../components/SystemIcon';
import { workflowTabs, type WorkflowTabId } from '../routes';

export interface WorkflowTabsProps {
  activeTab: WorkflowTabId;
  onSelect: (tab: WorkflowTabId) => void;
}

export function WorkflowTabs({ activeTab, onSelect }: WorkflowTabsProps) {
  const [focusedTab, setFocusedTab] = useState<WorkflowTabId>(activeTab);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Parent selection changes update the tab stop without stealing DOM focus.
  useEffect(() => {
    if (!tabRefs.current.some((tab) => tab === document.activeElement)) {
      setFocusedTab(activeTab);
    }
  }, [activeTab]);

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.nativeEvent.isComposing) return;

    let nextIndex: number;
    switch (event.key) {
      case 'ArrowLeft':
        nextIndex = (index - 1 + workflowTabs.length) % workflowTabs.length;
        break;
      case 'ArrowRight':
        nextIndex = (index + 1) % workflowTabs.length;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = workflowTabs.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    setFocusedTab(workflowTabs[nextIndex].id);
    tabRefs.current[nextIndex]?.focus();
  }

  return (
    <div
      className="workflow-tabs"
      role="tablist"
      aria-label="作業"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setFocusedTab(activeTab);
        }
      }}
    >
      {workflowTabs.map((tab, index) => (
        <button
          key={tab.id}
          ref={(button) => {
            tabRefs.current[index] = button;
          }}
          className="workflow-tabs__tab"
          type="button"
          role="tab"
          id={`workflow-tab-${tab.id}`}
          aria-controls={`workflow-panel-${tab.id}`}
          aria-selected={activeTab === tab.id}
          tabIndex={focusedTab === tab.id ? 0 : -1}
          onFocus={() => setFocusedTab(tab.id)}
          onKeyDown={(event) => handleKeyDown(event, index)}
          onClick={() => {
            setFocusedTab(tab.id);
            onSelect(tab.id);
          }}
        >
          <SystemIcon name={tab.id} />
          <span>{tab.label}</span>
        </button>
      ))}
    </div>
  );
}