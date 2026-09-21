import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RegionList, type RegionClassOption } from './RegionList';
import { NoObjectButton } from './NoObjectButton';
import type { AnnotationRectangle } from '../../../shared/contracts/annotation';

const classes: readonly RegionClassOption[] = [
  { id: '2c1d7ade-ccfe-4c3e-8c6e-bc9efccd5cfe', displayName: 'ねじ' },
  { id: '4e3f9cf0-eeb0-4e5f-8e8f-debf1eef7ebf', displayName: 'ボルト' },
];
const rectangles: readonly AnnotationRectangle[] = [
  { id: '3d2e8bef-ddaf-4d4f-9d7f-cdaf0ddf6daf', classId: classes[0]!.id, x: 100.4, y: 80, width: 200, height: 120 },
  { id: '5f4a0de1-ffc1-4f6a-9f9a-efca2ffa8fca', classId: classes[1]!.id, x: 10, y: 20, width: 30, height: 40 },
];

describe('RegionList W2-13', () => {
  it('lists every region with its position and lets a class be changed per region', async () => {
    const onChangeClass = vi.fn<(id: string, classId: string) => void>();
    const onSelect = vi.fn<(id: string) => void>();
    const user = userEvent.setup();
    render(<RegionList rectangles={rectangles} classes={classes} selectedId={rectangles[1]!.id}
      onSelect={onSelect} onChangeClass={onChangeClass} />);
    expect(screen.getByRole('status')).toHaveTextContent('領域 2件');
    expect(screen.getByRole('button', { name: '領域 1（X 100, Y 80, 幅 200, 高さ 120）' })).toBeInTheDocument();
    const first = screen.getByLabelText('領域 1 のクラス');
    expect(first).toHaveValue(classes[0]!.id);
    expect(screen.getByLabelText('領域 2 のクラス')).toHaveValue(classes[1]!.id);
    await user.selectOptions(first, classes[1]!.id);
    expect(onChangeClass).toHaveBeenCalledExactlyOnceWith(rectangles[0]!.id, classes[1]!.id);
    await user.click(screen.getByRole('button', { name: /領域 1（/u }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(rectangles[0]!.id);
  });

  it('marks the selected region and reports an empty list instead of showing nothing', () => {
    const { rerender } = render(<RegionList rectangles={rectangles} classes={classes} selectedId={rectangles[1]!.id}
      onSelect={vi.fn()} onChangeClass={vi.fn()} />);
    const items = screen.getAllByRole('listitem');
    expect(items[0]).not.toHaveAttribute('aria-current');
    expect(items[1]).toHaveAttribute('aria-current', 'true');
    rerender(<RegionList rectangles={[]} classes={classes} selectedId={null} onSelect={vi.fn()} onChangeClass={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('領域 0件');
    expect(screen.getByText('領域がありません。画像上をドラッグして領域を作成してください。')).toBeInTheDocument();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  it('shows a class the schema no longer has instead of silently re-labelling the region', () => {
    const orphan: AnnotationRectangle = { ...rectangles[0]!, classId: '6a5b1ef2-00d2-4a7b-8a0b-f0db3aab9adb' };
    render(<RegionList rectangles={[orphan]} classes={classes} selectedId={null} onSelect={vi.fn()} onChangeClass={vi.fn()} />);
    const select = screen.getByLabelText('領域 1 のクラス');
    expect(select).toHaveValue('');
    expect(screen.getByRole('option', { name: `未対応のクラス（${orphan.classId}）` })).toBeInTheDocument();
  });
});

describe('NoObjectButton W2-13', () => {
  it('distinguishes an unreviewed image from a confirmed "no object" image', async () => {
    const onMarkNoObject = vi.fn<() => void>();
    const user = userEvent.setup();
    const { rerender } = render(<NoObjectButton rectangleCount={0} state="unstarted" negativeConfirmed={false}
      onMarkNoObject={onMarkNoObject} onClearNoObject={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('未着手（対象物なしの確認はされていません）');
    expect(screen.getByRole('status')).toHaveAttribute('data-no-object-state', 'unstarted');
    await user.click(screen.getByRole('button', { name: '対象物なしとして確定' }));
    expect(onMarkNoObject).toHaveBeenCalledOnce();

    rerender(<NoObjectButton rectangleCount={0} state="confirmed" negativeConfirmed
      onMarkNoObject={onMarkNoObject} onClearNoObject={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('対象物なし（確認済み）');
    expect(screen.getByRole('status')).toHaveAttribute('data-no-object-state', 'declared');
    expect(screen.queryByRole('button', { name: '対象物なしとして確定' })).not.toBeInTheDocument();
  });

  it('treats an edited image with no region as still unconfirmed, not as "no object"', () => {
    render(<NoObjectButton rectangleCount={0} state="editing" negativeConfirmed={false}
      onMarkNoObject={vi.fn()} onClearNoObject={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('編集中（領域なし・対象物なしの確認はされていません）');
    expect(screen.getByRole('status')).toHaveAttribute('data-no-object-state', 'editing');
    expect(screen.getByRole('button', { name: '対象物なしとして確定' })).toBeEnabled();
  });

  it('refuses to declare "no object" while regions exist and explains why', async () => {
    const onMarkNoObject = vi.fn<() => void>();
    const user = userEvent.setup();
    render(<NoObjectButton rectangleCount={2} state="editing" negativeConfirmed={false}
      onMarkNoObject={onMarkNoObject} onClearNoObject={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('領域 2件（対象物なしにはできません）');
    const button = screen.getByRole('button', { name: '対象物なしとして確定' });
    expect(button).toBeDisabled();
    await user.click(button);
    expect(onMarkNoObject).not.toHaveBeenCalled();
    expect(screen.getByText('領域をすべて削除すると「対象物なし」として確定できます。')).toBeInTheDocument();
  });

  it('allows a confirmed "no object" to be taken back', async () => {
    const onClearNoObject = vi.fn<() => void>();
    const user = userEvent.setup();
    render(<NoObjectButton rectangleCount={0} state="confirmed" negativeConfirmed
      onMarkNoObject={vi.fn()} onClearNoObject={onClearNoObject} />);
    await user.click(screen.getByRole('button', { name: '対象物なしを取り消す' }));
    expect(onClearNoObject).toHaveBeenCalledOnce();
  });
});
