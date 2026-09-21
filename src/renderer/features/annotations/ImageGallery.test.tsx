import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { annotationItemSchema, type AnnotationState } from '../../../shared/contracts/annotation';
import { ImageGallery } from './ImageGallery';

const workspaceId = '22222222-2222-4222-8222-222222222222';
const importId = '44444444-4444-4444-8444-444444444444';
const classId = '33333333-3333-4333-8333-333333333333';
const sha = 'a'.repeat(64);

function item(id: string, state: AnnotationState) {
  return annotationItemSchema.parse({ id, workspaceId, importId, imageKey: `image:${id}`, imageSha256: sha,
    width: 10, height: 10,
    annotation: { kind: 'classification', classId: state === 'confirmed' ? classId : null },
    annotationSha256: sha,
    state, negativeConfirmed: false, exclusionReason: state === 'excluded' ? '重複' : null, editVersion: 0,
    confirmedAt: state === 'confirmed' ? '2026-09-13T00:00:00.000Z' : null, updatedAt: '2026-09-13T00:00:00.000Z' });
}
const idA = '55555555-5555-4555-8555-555555555555';
const idB = '66666666-6666-4666-8666-666666666666';
const idC = '77777777-7777-4777-8777-777777777777';
const idD = '88888888-8888-4888-8888-888888888888';
const items = [item(idA, 'unstarted'), item(idB, 'editing'), item(idC, 'confirmed'), item(idD, 'excluded')];
const thumbnailUrl = (target: { id: string }) => `av-image://thumbnail/x/x/${target.id}`;

function mount(overrides: Partial<Parameters<typeof ImageGallery>[0]> = {}) {
  const onSelect = vi.fn();
  const view = render(<ImageGallery items={items} selectedId={idA} onSelect={onSelect} thumbnailUrl={thumbnailUrl} {...overrides} />);
  return { ...view, onSelect };
}

describe('ImageGallery standalone W2-03', () => {
  it('renders every item by default with an honest total, no hidden-by-filter note', () => {
    mount();
    expect(screen.getByRole('status')).toHaveTextContent('表示 4件 ／ 全 4件');
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    expect(screen.getByRole('img', { name: /未着手：image:55555555/ })).toHaveAttribute('src', `av-image://thumbnail/x/x/${idA}`);
  });

  it('filters by state while keeping the hidden count visible, not silently dropped', () => {
    mount();
    fireEvent.click(screen.getByLabelText('確認済み'));
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent('表示 1件 ／ 全 4件（絞り込みで非表示 3件）');
    expect(screen.getByText('確認済み', { selector: 'button span' })).toBeVisible();
  });

  it('groups suggested under the unstarted filter label', () => {
    const suggested = [...items, item('99999999-9999-4999-8999-999999999999', 'suggested')];
    const onSelect = vi.fn();
    render(<ImageGallery items={suggested} selectedId={idA} onSelect={onSelect} thumbnailUrl={thumbnailUrl} />);
    fireEvent.click(screen.getByLabelText('未着手'));
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('marks the currently selected item for assistive tech', () => {
    mount();
    const current = screen.getByRole('img', { name: /image:55555555/ }).closest('button')!;
    expect(current).toHaveAttribute('aria-current', 'true');
    const other = screen.getByRole('img', { name: /image:66666666/ }).closest('button')!;
    expect(other).not.toHaveAttribute('aria-current');
  });

  it('moves to the next and previous item with ArrowRight/ArrowLeft, focusing the target button', () => {
    const { onSelect } = mount();
    const list = screen.getByRole('list', { name: '画像一覧' });
    fireEvent.keyDown(list, { key: 'ArrowRight' });
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(items[1]);
    expect(screen.getByRole('img', { name: /image:66666666/ }).closest('button')).toHaveFocus();
    onSelect.mockClear();
    fireEvent.keyDown(list, { key: 'ArrowLeft' });
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(items[0]);
  });

  it('clamps at the boundary instead of wrapping or throwing', () => {
    const onSelect = vi.fn();
    render(<ImageGallery items={items} selectedId={idD} onSelect={onSelect} thumbnailUrl={thumbnailUrl} />);
    const list = screen.getByRole('list', { name: '画像一覧' });
    fireEvent.keyDown(list, { key: 'ArrowRight' });
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(items[3]);
  });

  it('navigates within the filtered subset only, skipping hidden items', () => {
    const idE = '99999999-9999-4999-8999-999999999999';
    const withSuggested = [...items, item(idE, 'suggested')];
    const onSelect = vi.fn();
    render(<ImageGallery items={withSuggested} selectedId={idA} onSelect={onSelect} thumbnailUrl={thumbnailUrl} />);
    fireEvent.click(screen.getByLabelText('未着手'));
    const list = screen.getByRole('list', { name: '画像一覧' });
    fireEvent.keyDown(list, { key: 'ArrowRight' });
    // idB (editing) is hidden by the filter; the only next visible item is idE (suggested).
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(withSuggested[4]);
  });
});
