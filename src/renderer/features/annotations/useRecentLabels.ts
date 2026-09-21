import { useState } from 'react';
import type { LabelClass } from '../../../shared/contracts/annotation';

const RECENT_LABEL_LIMIT = 9;

export function useRecentLabels(schemaId: string, classes: readonly LabelClass[]) {
  const [history, setHistory] = useState<{ schemaId: string; ids: readonly string[] }>({ schemaId, ids: [] });
  const available = classes.filter((entry) => entry.schemaId === schemaId);
  const ids = history.schemaId === schemaId
    ? history.ids.filter((id) => available.some((entry) => entry.id === id)) : [];
  if (history.schemaId !== schemaId || ids.length !== history.ids.length) {
    setHistory({ schemaId, ids });
  }

  function remember(classId: string) {
    if (!available.some((entry) => entry.id === classId)) {
      throw new Error('Cannot remember a label outside the current schema');
    }
    setHistory((current) => ({
      schemaId,
      ids: [classId, ...(current.schemaId === schemaId ? current.ids : []).filter((id) => id !== classId)]
        .slice(0, RECENT_LABEL_LIMIT),
    }));
  }

  const recentLabels = ids.flatMap((id) => {
    const entry = available.find((candidate) => candidate.id === id);
    return entry ? [entry] : [];
  });
  return { recentLabels, remember };
}
