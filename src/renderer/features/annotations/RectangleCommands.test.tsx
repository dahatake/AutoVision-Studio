import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RectangleCommands } from './RectangleCommands';
// The Main-side helper is imported here, not from a Main test file, because the
// plan assigns W2-14 exactly one test file. It is deliberately free of Node and
// Electron APIs (zod and shared contracts only), and production renderer code
// keeps its own structural type instead of importing Main.
import {
  DUPLICATE_IOU_THRESHOLD, MAX_COMPARED_RECTANGLES, findDuplicateRectangles, intersectionOverUnion,
} from '../../../main/annotations/duplicate-warning.js';
import type { AnnotationRectangle } from '../../../shared/contracts/annotation';

const classA = '2c1d7ade-ccfe-4c3e-8c6e-bc9efccd5cfe';
const classB = '4e3f9cf0-eeb0-4e5f-8e8f-debf1eef7ebf';
const ids = [
  '3d2e8bef-ddaf-4d4f-9d7f-cdaf0ddf6daf',
  '5f4a0de1-ffc1-4f6a-9f9a-efca2ffa8fca',
  '6a5b1ef2-00d2-4a7b-8a0b-f0db3aab9adb',
] as const;
const rectangle = (id: string, classId: string, x: number, y: number, width = 100, height = 100): AnnotationRectangle =>
  ({ id, classId, x, y, width, height });
const rectangles: readonly AnnotationRectangle[] = [
  rectangle(ids[0], classA, 10, 10), rectangle(ids[1], classA, 12, 12), rectangle(ids[2], classB, 400, 400),
];

function setup(overrides: Partial<{ selectedIds: readonly string[]; warnings: readonly { classId: string; firstId: string; secondId: string; iou: number }[]; disabled: boolean }> = {}) {
  const handlers = {
    onDuplicate: vi.fn<(list: readonly string[]) => void>(),
    onDelete: vi.fn<(list: readonly string[]) => void>(),
    onSelectAll: vi.fn<() => void>(),
    onClearSelection: vi.fn<() => void>(),
  };
  render(<RectangleCommands rectangles={rectangles} selectedIds={overrides.selectedIds ?? [ids[0]]}
    warnings={overrides.warnings ?? []} disabled={overrides.disabled ?? false} {...handlers} />);
  return handlers;
}

describe('duplicate-warning W2-14', () => {
  it('warns about heavily overlapping rectangles of the same class only', () => {
    const warnings = findDuplicateRectangles(rectangles);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ classId: classA, firstId: ids[0], secondId: ids[1] });
    expect(warnings[0]!.iou).toBeGreaterThanOrEqual(DUPLICATE_IOU_THRESHOLD);
    const differentClass = [rectangle(ids[0], classA, 10, 10), rectangle(ids[1], classB, 10, 10)];
    expect(findDuplicateRectangles(differentClass)).toEqual([]);
  });

  it('computes intersection over union and stays silent below the threshold', () => {
    const first = rectangle(ids[0], classA, 0, 0), second = rectangle(ids[1], classA, 50, 0);
    expect(intersectionOverUnion(first, second)).toBeCloseTo(1 / 3, 10);
    expect(intersectionOverUnion(first, rectangle(ids[1], classA, 500, 500))).toBe(0);
    expect(intersectionOverUnion(first, first)).toBe(1);
    expect(findDuplicateRectangles([first, second])).toEqual([]);
    expect(findDuplicateRectangles([first, second], 1 / 3)).toHaveLength(1);
  });

  it('returns every offending pair, deterministically ordered, and removes nothing', () => {
    const input = [rectangle(ids[2], classA, 10, 10), rectangle(ids[0], classA, 10, 10), rectangle(ids[1], classA, 40, 40)];
    const warnings = findDuplicateRectangles(input, 0.3);
    expect(warnings.map((warning) => [warning.firstId, warning.secondId])).toEqual([
      [ids[0], ids[2]], [ids[0], ids[1]], [ids[1], ids[2]],
    ]);
    expect(warnings.map((warning) => warning.iou)).toEqual([...warnings.map((warning) => warning.iou)].sort((a, b) => b - a));
    expect(findDuplicateRectangles(input, 0.3)).toEqual(warnings);
    expect(input).toHaveLength(3);
  });

  it('refuses invalid input instead of guessing', () => {
    expect(() => findDuplicateRectangles([{ ...rectangle(ids[0], classA, 0, 0), width: Number.NaN }])).toThrow();
    expect(() => findDuplicateRectangles([{ id: ids[0], classId: classA }])).toThrow();
    expect(() => findDuplicateRectangles('not-a-list')).toThrow();
    expect(() => findDuplicateRectangles([rectangle(ids[0], classA, 0, 0)], 0)).toThrow();
    expect(() => findDuplicateRectangles([rectangle(ids[0], classA, 0, 0)], 1.5)).toThrow();
    const tooMany = Array.from({ length: MAX_COMPARED_RECTANGLES + 1 }, (_, index) =>
      rectangle(`${index.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`, classA, index, 0));
    expect(() => findDuplicateRectangles(tooMany)).toThrow();
    expect(findDuplicateRectangles([])).toEqual([]);
  });
});

describe('RectangleCommands W2-14', () => {
  it('duplicates, deletes, selects all and clears the selection from buttons', async () => {
    const user = userEvent.setup();
    const handlers = setup({ selectedIds: [ids[0], ids[1]] });
    await user.click(screen.getByRole('button', { name: '複製' }));
    expect(handlers.onDuplicate).toHaveBeenCalledExactlyOnceWith([ids[0], ids[1]]);
    await user.click(screen.getByRole('button', { name: 'すべて選択' }));
    expect(handlers.onSelectAll).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: '削除' }));
    expect(handlers.onDelete).toHaveBeenCalledExactlyOnceWith([ids[0], ids[1]]);
    await user.click(screen.getByRole('button', { name: '選択を解除' }));
    expect(handlers.onClearSelection).toHaveBeenCalledOnce();
    expect(screen.getByRole('status')).toHaveTextContent('選択中 2件 ／ 全 3件');
  });

  it('runs the same commands from the keyboard', async () => {
    const user = userEvent.setup();
    const handlers = setup({ selectedIds: [ids[0]] });
    await user.tab();
    expect(screen.getByRole('button', { name: '複製' })).toHaveFocus();
    await user.keyboard('{Control>}d{/Control}');
    expect(handlers.onDuplicate).toHaveBeenCalledExactlyOnceWith([ids[0]]);
    await user.keyboard('{Control>}a{/Control}');
    expect(handlers.onSelectAll).toHaveBeenCalledOnce();
    await user.keyboard('{Delete}');
    expect(handlers.onDelete).toHaveBeenCalledExactlyOnceWith([ids[0]]);
    await user.keyboard('{Escape}');
    expect(handlers.onClearSelection).toHaveBeenCalledOnce();
  });

  it('keeps every command inert without a selection', async () => {
    const user = userEvent.setup();
    const handlers = setup({ selectedIds: [] });
    expect(screen.getByRole('button', { name: '複製' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '削除' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '選択を解除' })).toBeDisabled();
    await user.tab();
    expect(screen.getByRole('button', { name: 'すべて選択' })).toHaveFocus();
    await user.keyboard('{Control>}d{/Control}{Delete}{Escape}');
    expect(handlers.onDuplicate).not.toHaveBeenCalled();
    expect(handlers.onDelete).not.toHaveBeenCalled();
    expect(handlers.onClearSelection).not.toHaveBeenCalled();
  });

  it('shows the duplicate report as advice, with no automatic removal or merge', () => {
    const warnings = findDuplicateRectangles(rectangles);
    setup({ warnings });
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('同じクラスで重なりの大きい領域が 1組あります。自動では削除も統合もしません。');
    expect(alert).toHaveTextContent(`${ids[0]} と ${ids[1]}（重なり ${Math.round(warnings[0]!.iou * 100)}%）`);
    expect(screen.queryByRole('button', { name: /統合|自動/u })).not.toBeInTheDocument();
  });

  it('disables every command while the item cannot be edited', async () => {
    const user = userEvent.setup();
    const handlers = setup({ selectedIds: [ids[0]], disabled: true });
    for (const name of ['複製', '削除', 'すべて選択', '選択を解除']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
    await user.keyboard('{Control>}d{/Control}');
    expect(handlers.onDuplicate).not.toHaveBeenCalled();
  });
});
