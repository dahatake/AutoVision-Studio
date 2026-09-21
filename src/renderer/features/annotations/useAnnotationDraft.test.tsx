import { act, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { annotationItemSchema, type AnnotationItem } from '../../../shared/contracts/annotation';
import type { AnnotationApi, AnnotationSaveInput, AnnotationSaveResponse } from '../../../shared/contracts/annotation-ipc';
import { useAnnotationDraft } from './useAnnotationDraft';

const projectId = '11111111-1111-4111-8111-111111111111';
const workspaceId = '22222222-2222-4222-8222-222222222222';
const classA = '33333333-3333-4333-8333-333333333333';
const classB = '44444444-4444-4444-8444-444444444444';
const importId = '55555555-5555-4555-8555-555555555555';
const itemId = '66666666-6666-4666-8666-666666666666';
const shaA = 'a'.repeat(64);
const shaB = 'b'.repeat(64);
const updatedAt = '2026-09-13T00:00:00.000Z';

function item(fields: Partial<AnnotationItem> = {}): AnnotationItem {
  return annotationItemSchema.parse({
    id: itemId, workspaceId, importId, imageKey: 'image:1', imageSha256: shaA, width: 32, height: 32,
    annotation: { kind: 'classification', classId: classA }, annotationSha256: shaA,
    state: 'editing', negativeConfirmed: false, exclusionReason: null, editVersion: 7,
    confirmedAt: null, updatedAt, ...fields,
  });
}

function success(input: AnnotationSaveInput): AnnotationSaveResponse {
  return {
    ok: true,
    value: {
      item: item({
        id: input.itemId,
        workspaceId: input.workspaceId,
        annotation: input.annotation,
        annotationSha256: shaB,
        state: input.state,
        exclusionReason: input.exclusionReason,
        editVersion: input.expectedEditVersion + 1,
        updatedAt: '2026-09-13T00:00:01.000Z',
      }),
      provenance: [{
        itemId: input.itemId, targetKey: 'classification', kind: 'manual', sourceImportId: null, sourceImageKey: null,
        sourceAnnotationKey: null, sourceSuggestionId: null, original: {}, changes: {},
      }],
    },
  };
}

function Harness({ api, source = item() }: { readonly api: Pick<AnnotationApi, 'save'>; readonly source?: AnnotationItem }) {
  const draft = useAnnotationDraft({ api, projectId, item: source, autosaveMs: 750 });
  return (
    <div>
      <p data-testid="class">{draft.draft.annotation.kind === 'classification' ? draft.draft.annotation.classId : ''}</p>
      <p data-testid="state">{draft.draft.state}</p>
      <p data-testid="status">{draft.saveStatus}</p>
      <button type="button" onClick={() => draft.updateAnnotation({ kind: 'classification', classId: classB })}>class-b</button>
      <button type="button" onClick={() => draft.setExcluded('重複')}>exclude</button>
      <button type="button" disabled={!draft.canUndo} onClick={draft.undo}>undo</button>
      <button type="button" disabled={!draft.canRedo} onClick={draft.redo}>redo</button>
      <button type="button" onClick={() => void draft.flush()}>flush</button>
    </div>
  );
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('useAnnotationDraft W2-04', () => {
  it('starts autosave within one second and sends the existing save-draft CAS contract', async () => {
    const save = vi.fn<AnnotationApi['save']>((input) => Promise.resolve(success(input)));
    render(<StrictMode><Harness api={{ save }} /></StrictMode>);
    fireEvent.click(screen.getByRole('button', { name: 'class-b' }));
    expect(screen.getByTestId('status')).toHaveTextContent('dirty');
    await act(async () => { vi.advanceTimersByTime(749); });
    expect(save).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(save).toHaveBeenCalledExactlyOnceWith({
      projectId, workspaceId, itemId,
      expectedEditVersion: 7,
      expectedAnnotationSha256: shaA,
      expectedState: 'editing',
      expectedConfirmedAt: null,
      annotation: { kind: 'classification', classId: classB },
      state: 'editing',
      exclusionReason: null,
    });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId('status')).toHaveTextContent('saved');
  });

  it('undoes and redoes the current image draft without a generic history surface', async () => {
    const save = vi.fn<AnnotationApi['save']>((input) => Promise.resolve(success(input)));
    render(<Harness api={{ save }} />);
    fireEvent.click(screen.getByRole('button', { name: 'class-b' }));
    expect(screen.getByTestId('class')).toHaveTextContent(classB);
    fireEvent.click(screen.getByRole('button', { name: 'exclude' }));
    expect(screen.getByTestId('state')).toHaveTextContent('excluded');
    fireEvent.click(screen.getByRole('button', { name: 'undo' }));
    expect(screen.getByTestId('state')).toHaveTextContent('editing');
    expect(screen.getByTestId('class')).toHaveTextContent(classB);
    fireEvent.click(screen.getByRole('button', { name: 'undo' }));
    expect(screen.getByTestId('class')).toHaveTextContent(classA);
    fireEvent.click(screen.getByRole('button', { name: 'redo' }));
    expect(screen.getByTestId('class')).toHaveTextContent(classB);
  });

  it('unconfirms by saving content and confirmation-clearing assertions together', async () => {
    const confirmed = item({ state: 'confirmed', confirmedAt: '2026-09-13T00:10:00.000Z' });
    const save = vi.fn<AnnotationApi['save']>((input) => Promise.resolve(success(input)));
    render(<Harness api={{ save }} source={confirmed} />);
    fireEvent.click(screen.getByRole('button', { name: 'class-b' }));
    await act(async () => { vi.advanceTimersByTime(750); });
    expect(save.mock.calls[0]![0]).toMatchObject({
      expectedState: 'confirmed',
      expectedConfirmedAt: '2026-09-13T00:10:00.000Z',
      state: 'editing',
    });
  });

  it('discards a stale save response after switching to another image before it resolves', async () => {
    let resolve!: (value: AnnotationSaveResponse) => void;
    const pending = new Promise<AnnotationSaveResponse>((yes) => { resolve = yes; });
    const save = vi.fn<AnnotationApi['save']>()
      .mockImplementationOnce(() => pending)
      .mockImplementation((input) => Promise.resolve(success(input)));
    const nextItemId = '77777777-7777-4777-8777-777777777777';
    const next = item({ id: nextItemId, annotation: { kind: 'classification', classId: classA }, editVersion: 3 });
    const { rerender } = render(<Harness api={{ save }} />);
    fireEvent.click(screen.getByRole('button', { name: 'class-b' }));
    await act(async () => { vi.advanceTimersByTime(750); });
    expect(save).toHaveBeenCalledOnce();
    rerender(<Harness api={{ save }} source={next} />);
    await act(async () => { resolve(success(save.mock.calls[0]![0])); await Promise.resolve(); });
    fireEvent.click(screen.getByRole('button', { name: 'class-b' }));
    fireEvent.click(screen.getByRole('button', { name: 'flush' }));
    await act(async () => { await Promise.resolve(); });
    expect(save.mock.calls[1]![0]).toMatchObject({
      itemId: nextItemId,
      expectedEditVersion: 3,
      annotation: { kind: 'classification', classId: classB },
    });
  });
});
