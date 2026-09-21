import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { DeleteProjectDialog, type DeleteProjectPreview } from './DeleteProjectDialog';

const preview: DeleteProjectPreview = {
  projectId: '2f9c6a1e-4b7d-4a55-9c31-8ad0e5f21b77',
  name: '検査ライン',
  workspacePath: 'C:\\Projects\\2f9c6a1e-4b7d-4a55-9c31-8ad0e5f21b77',
  owned: {
    labelSchemas: 1, annotationWorkspaces: 1, annotationItems: 12, datasetRevisions: 0, datasetItems: 0,
    trainingRuns: 0, otherJobs: 2, copyImports: 1,
    copiedImages: { count: 12, bytes: 2048 },
    directory: { status: 'measured', ownership: 'verified', files: 13, bytes: 4096 },
  },
  referenced: { imports: 1, images: { count: 5, bytes: 10_240 } },
  blockers: [],
  unmeasuredCategories: ['model-versions', 'reports'],
};

const withPreview = (patch: Partial<DeleteProjectPreview>): DeleteProjectPreview => ({ ...preview, ...patch });

describe('CORE-10 DeleteProjectDialog', () => {
  it('shows owned and Reference data separately and keeps Reference originals', () => {
    render(<DeleteProjectDialog open preview={preview} onDelete={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Project「検査ライン」を削除' })).toBeInTheDocument();
    const owned = screen.getByRole('region', { name: '削除される所有データ' });
    expect(owned).toHaveTextContent('13 件 / 4.0 KB');
    expect(owned).toHaveTextContent('Annotation 画像');
    const referenced = screen.getByRole('region', { name: '削除されない参照データ' });
    expect(referenced).toHaveTextContent('元ファイルは削除・変更しません');
    expect(referenced).toHaveTextContent('5 件 / 10.0 KB');
    expect(screen.getByText(/未実装のため件数を取得できない項目/)).toHaveTextContent('Model Version、レポート');
  });

  it('does not delete without explicit confirmation', async () => {
    const remove = vi.fn();
    render(<DeleteProjectDialog open preview={preview} onDelete={remove} onCancel={vi.fn()} />);

    const button = screen.getByRole('button', { name: '削除する' });
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(remove).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(button);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('refuses deletion while the schema rules block it, even after confirmation', async () => {
    const remove = vi.fn();
    render(<DeleteProjectDialog open onDelete={remove} onCancel={vi.fn()} preview={withPreview({
      blockers: [{ code: 'DATASET_REVISION_IMMUTABLE', count: 2, message: '確定済みDataset Revisionは変更できません。' }],
    })} />);

    expect(screen.getByRole('alert')).toHaveTextContent('確定済みDataset Revisionは変更できません。（2 件）');
    expect(screen.getByRole('checkbox')).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: '削除する' }));
    expect(remove).not.toHaveBeenCalled();
  });

  it('never presents an unmeasured folder as empty', () => {
    const { rerender } = render(<DeleteProjectDialog open onDelete={vi.fn()} onCancel={vi.fn()}
      preview={withPreview({ owned: { ...preview.owned, directory: { status: 'missing' } } })} />);
    expect(screen.getByRole('region', { name: '削除される所有データ' })).toHaveTextContent('容量は不明');

    rerender(<DeleteProjectDialog open onDelete={vi.fn()} onCancel={vi.fn()}
      preview={withPreview({ owned: { ...preview.owned, directory: { status: 'unreadable' } } })} />);
    expect(screen.getByRole('region', { name: '削除される所有データ' })).toHaveTextContent('読み取れません');

    rerender(<DeleteProjectDialog open onDelete={vi.fn()} onCancel={vi.fn()} preview={withPreview({
      owned: { ...preview.owned, directory: { status: 'partial', ownership: 'unverified', files: 2, bytes: 100 } },
    })} />);
    const owned = screen.getByRole('region', { name: '削除される所有データ' });
    expect(owned).toHaveTextContent('一部を読み取れない');
    expect(owned).toHaveTextContent('所有フォルダーであることを確認できていません');
  });

  it('stays closed and blocks input while a deletion is running', async () => {
    const remove = vi.fn();
    const cancel = vi.fn();
    const { rerender } = render(<DeleteProjectDialog open={false} preview={preview} onDelete={remove} onCancel={cancel} />);
    expect(screen.queryByRole('dialog')).toBeNull();

    rerender(<DeleteProjectDialog open busy preview={preview} onDelete={remove} onCancel={cancel} />);
    expect(screen.getByRole('checkbox')).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: '削除する' }));
    await userEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
    expect(remove).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
  });
});
