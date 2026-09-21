import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Annotation, AnnotationItem } from '../../../shared/contracts/annotation';
import * as c from '../../../shared/contracts/annotation-ipc';

export type AnnotationDraftSaveStatus = 'clean' | 'dirty' | 'saving' | 'saved' | 'failed';

export interface AnnotationDraftValue {
  readonly annotation: Annotation;
  readonly state: 'editing' | 'excluded';
  readonly exclusionReason: string | null;
}

export interface UseAnnotationDraftOptions {
  readonly api: Pick<c.AnnotationApi, 'save'>;
  readonly projectId: string;
  readonly item: AnnotationItem;
  readonly autosaveMs?: number;
}

export interface UseAnnotationDraftResult {
  readonly draft: AnnotationDraftValue;
  readonly item: AnnotationItem;
  readonly saveStatus: AnnotationDraftSaveStatus;
  readonly errorCode: c.AnnotationIpcErrorCode | null;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly setDraft: (next: AnnotationDraftValue) => void;
  readonly updateAnnotation: (annotation: Annotation) => void;
  readonly setExcluded: (reason: string) => void;
  readonly clearExclusion: () => void;
  readonly undo: () => void;
  readonly redo: () => void;
  readonly flush: () => Promise<void>;
}

const DEFAULT_AUTOSAVE_MS = 750;

function draftFromItem(item: AnnotationItem): AnnotationDraftValue {
  return {
    annotation: item.annotation,
    state: item.state === 'excluded' ? 'excluded' : 'editing',
    exclusionReason: item.state === 'excluded' ? item.exclusionReason : null,
  };
}

function sameDraft(a: AnnotationDraftValue, b: AnnotationDraftValue): boolean {
  return a.state === b.state && a.exclusionReason === b.exclusionReason
    && JSON.stringify(a.annotation) === JSON.stringify(b.annotation);
}

export function useAnnotationDraft({ api, projectId, item, autosaveMs = DEFAULT_AUTOSAVE_MS }: UseAnnotationDraftOptions): UseAnnotationDraftResult {
  const initialDraft = useMemo(() => draftFromItem(item), [item]);
  const [savedItem, setSavedItem] = useState(item);
  const [draft, setDraftState] = useState(initialDraft);
  const [undoStack, setUndoStack] = useState<AnnotationDraftValue[]>([]);
  const [redoStack, setRedoStack] = useState<AnnotationDraftValue[]>([]);
  const [saveStatus, setSaveStatus] = useState<AnnotationDraftSaveStatus>('clean');
  const [errorCode, setErrorCode] = useState<c.AnnotationIpcErrorCode | null>(null);
  const latest = useRef({ savedItem: item, draft: initialDraft, saveStatus: 'clean' as AnnotationDraftSaveStatus });
  const undoHistory = useRef<AnnotationDraftValue[]>([]);
  const redoHistory = useRef<AnnotationDraftValue[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  useEffect(() => {
    if (item.id !== latest.current.savedItem.id) {
      if (timer.current) clearTimeout(timer.current);
      const next = draftFromItem(item);
      latest.current = { savedItem: item, draft: next, saveStatus: 'clean' };
      undoHistory.current = []; redoHistory.current = [];
      setSavedItem(item); setDraftState(next); setUndoStack([]); setRedoStack([]);
      setSaveStatus('clean'); setErrorCode(null); saving.current = false;
    }
  }, [item]);

  useEffect(() => { latest.current = { savedItem, draft, saveStatus }; }, [savedItem, draft, saveStatus]);

  const saveNow = useCallback(async () => {
    if (saving.current || sameDraft(latest.current.draft, draftFromItem(latest.current.savedItem))) return;
    saving.current = true;
    setSaveStatus('saving'); setErrorCode(null);
    const base = latest.current.savedItem;
    const target = latest.current.draft;
    let followUp = false;
    try {
      const request = c.annotationSaveInputSchema.parse({
        projectId, workspaceId: base.workspaceId, itemId: base.id,
        expectedEditVersion: base.editVersion,
        expectedAnnotationSha256: base.annotationSha256,
        expectedState: base.state,
        expectedConfirmedAt: base.confirmedAt,
        annotation: target.annotation,
        state: target.state,
        exclusionReason: target.exclusionReason,
      });
      const response = c.parseAnnotationSaveResponse(await api.save(request), request);
      if (!mounted.current) return;
      if (latest.current.savedItem.id !== base.id) return;
      if (!response.ok) {
        setSaveStatus('failed'); setErrorCode(response.error.code);
        return;
      }
      latest.current = { ...latest.current, savedItem: response.value.item };
      setSavedItem(response.value.item);
      const current = latest.current.draft;
      if (sameDraft(current, draftFromItem(response.value.item))) {
        latest.current = { ...latest.current, saveStatus: 'saved' };
        setSaveStatus('saved');
      } else {
        latest.current = { ...latest.current, saveStatus: 'dirty' };
        setSaveStatus('dirty');
        followUp = true;
      }
    } catch {
      if (mounted.current) {
        latest.current = { ...latest.current, saveStatus: 'failed' };
        setSaveStatus('failed');
        setErrorCode('OPERATION_FAILED');
      }
    } finally {
      saving.current = false;
      if (mounted.current && followUp) {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => { timer.current = null; void saveNow(); }, Math.min(autosaveMs, 1_000));
      }
    }
  }, [api, autosaveMs, projectId]);

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; void saveNow(); }, Math.min(autosaveMs, 1_000));
  }, [autosaveMs, saveNow]);

  const applyDraft = useCallback((next: AnnotationDraftValue, recordHistory: boolean) => {
    const current = latest.current.draft;
    if (sameDraft(current, next)) return;
    if (recordHistory) {
      undoHistory.current = [...undoHistory.current, current];
      redoHistory.current = [];
      setUndoStack(undoHistory.current);
      setRedoStack([]);
    }
    latest.current = { ...latest.current, draft: next, saveStatus: 'dirty' };
    setDraftState(next); setSaveStatus('dirty'); setErrorCode(null);
    schedule();
  }, [schedule]);

  const setDraft = useCallback((next: AnnotationDraftValue) => {
    applyDraft(next, true);
  }, [applyDraft]);
  const updateAnnotation = useCallback((annotation: Annotation) => {
    applyDraft({ ...latest.current.draft, annotation }, true);
  }, [applyDraft]);
  const setExcluded = useCallback((reason: string) => {
    applyDraft({ ...latest.current.draft, state: 'excluded', exclusionReason: reason }, true);
  }, [applyDraft]);
  const clearExclusion = useCallback(() => {
    applyDraft({ ...latest.current.draft, state: 'editing', exclusionReason: null }, true);
  }, [applyDraft]);
  const undo = useCallback(() => {
    const previous = undoHistory.current.at(-1);
    if (!previous) return;
    undoHistory.current = undoHistory.current.slice(0, -1);
    redoHistory.current = [...redoHistory.current, latest.current.draft];
    setUndoStack(undoHistory.current);
    setRedoStack(redoHistory.current);
    applyDraft(previous, false);
  }, [applyDraft]);
  const redo = useCallback(() => {
    const next = redoHistory.current.at(-1);
    if (!next) return;
    redoHistory.current = redoHistory.current.slice(0, -1);
    undoHistory.current = [...undoHistory.current, latest.current.draft];
    setRedoStack(redoHistory.current);
    setUndoStack(undoHistory.current);
    applyDraft(next, false);
  }, [applyDraft]);
  const flush = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    await saveNow();
  }, [saveNow]);

  return {
    draft, item: savedItem, saveStatus, errorCode,
    canUndo: undoStack.length > 0, canRedo: redoStack.length > 0,
    setDraft, updateAnnotation, setExcluded, clearExclusion, undo, redo, flush,
  };
}
