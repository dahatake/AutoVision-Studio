import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AnnotationItem } from '../../../shared/contracts/annotation';
import type * as c from '../../../shared/contracts/annotation-ipc';
import type { Project } from '../../../shared/contracts/project';
import type * as r from '../../../shared/contracts/revision-ipc';
import { AnnotationWorkspacePage } from './AnnotationWorkspacePage';

const projectId = '2f1b2c8e-0c3f-4a1e-9e2f-4b8f6a1d2c3e';
const workspaceId = '9a3c7d51-6b21-4f0e-8c7a-1d2e3f4a5b6c';
const schemaId = '7c4d2e10-8a95-4b3c-9d1e-0f2a3b4c5d6e';
const classId = '1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d';
const at = '2026-09-22T00:00:00.000Z';

const project: Project = {
  id: projectId, name: '検証Project', description: '', taskType: 'classification',
  workspacePath: 'D:\\Synthetic\\Projects\\p', createdAt: at, updatedAt: at,
};

function item(index: number, state: AnnotationItem['state'] = 'unstarted'): AnnotationItem {
  const id = `0000000${index}-0000-4000-8000-00000000000${index}`;
  return {
    id, workspaceId, importId: workspaceId, imageKey: `image:${index}`,
    imageSha256: 'a'.repeat(64), width: 64, height: 48,
    // classId stays null so an empty provenance list satisfies the contract's
    // target/provenance correlation check in parseAnnotationGetResponse.
    annotation: { kind: 'classification', classId: null },
    annotationSha256: 'b'.repeat(64), state,
    negativeConfirmed: false, exclusionReason: null, editVersion: 1,
    confirmedAt: state === 'confirmed' ? at : null, updatedAt: at,
  };
}

const schema = {
  id: schemaId, projectId, instructions: '', lockedAt: null, editVersion: 1, createdAt: at, updatedAt: at,
  classes: [{
    id: classId, schemaId, displayName: 'cat', normalizedName: 'cat', modelAlias: null,
    color: '#112233', description: '', examples: [], ordinal: 0, createdAt: at, updatedAt: at,
  }],
};

const workspace = {
  id: workspaceId, projectId, schemaId, taskType: 'classification' as const, mode: 'copy' as const,
  state: 'editing' as const, editVersion: 1, createdAt: at, updatedAt: at,
};

interface Deferred { readonly promise: Promise<void>; resolve(): void }
function deferred(): Deferred {
  let settle: () => void = () => {};
  const promise = new Promise<void>((resolve) => { settle = resolve; });
  return { promise, resolve: () => settle() };
}

interface Options {
  readonly items?: readonly AnnotationItem[];
  readonly total?: number;
  readonly gates?: ReadonlyMap<string, Deferred>;
  readonly validation?: Record<string, unknown>;
}

function ports(options: Options = {}) {
  const items = options.items ?? [item(1)];
  const annotations = {
    workspaces: vi.fn(async () => ({ ok: true as const, value: [workspace] })),
    list: vi.fn(async () => ({ ok: true as const, value: { items, total: options.total ?? items.length } })),
    get: vi.fn(async (input: { itemId: string }) => {
      await options.gates?.get(input.itemId)?.promise;
      const found = items.find((entry) => entry.id === input.itemId)!;
      return { ok: true as const, value: { item: found, provenance: [] } };
    }),
    save: vi.fn(),
    confirm: vi.fn(),
  } as unknown as c.AnnotationApi;
  const labelSchemas = { get: vi.fn(async () => ({ ok: true as const, value: schema })) };
  const validate = vi.fn(async () => ({
    ok: true as const,
    value: {
      valid: true, workspaceId, total: 3, confirmed: 3, unconfirmed: 0, excluded: 0,
      schemaOutside: 0, invalidRectangles: 0, invalidStored: 0, issues: [],
      // Deliberately distinct vocabularies: the dialog must show the second one.
      byCode: { unconfirmed: 7 },
      provenanceByKind: { 'import-unmodified': 3 },
      ...options.validation,
    },
  }));
  const revisions = {
    create: vi.fn(), validate, confirmAndQueue: vi.fn(), clone: vi.fn(),
  } as unknown as r.RevisionApi;
  return { annotations, labelSchemas, revisions, validate };
}

function mount(options: Options = {}) {
  const port = ports(options);
  const view = render(<AnnotationWorkspacePage project={project} annotations={port.annotations}
    labelSchemas={port.labelSchemas} revisions={port.revisions} />);
  return { ...port, view };
}

afterEach(() => { vi.restoreAllMocks(); });

describe('AnnotationWorkspacePage', () => {
  it('shows the workspace-wide total and never presents the first page as the whole count', async () => {
    mount({ items: [item(1), item(2)], total: 350 });
    const status = await screen.findByText(/全 350件/u);
    expect(status).toHaveTextContent('表示 2件');
    // The unconfirmed number is explicitly scoped to what was actually read.
    expect(status).toHaveTextContent('表示分の未確認 2 件');
    expect(status).toHaveTextContent('残り 348件は未取得');
  });

  it('shows the stored provenance breakdown, never the validation-issue histogram', async () => {
    const h = mount();
    await screen.findByRole('button', { name: 'Dataset を確定する' });
    await userEvent.click(screen.getByRole('button', { name: 'Dataset を確定する' }));

    const dialog = await screen.findByRole('dialog');
    const provenance = within(dialog).getByRole('region', { name: 'provenance 内訳' });
    expect(provenance).toHaveTextContent('import-unmodified: 3');
    expect(provenance).not.toHaveTextContent('unconfirmed');
    expect(provenance).not.toHaveTextContent('記録なし');
    expect(h.validate).toHaveBeenCalledTimes(1);
  });

  it('drops the previous item while the next one loads, so no one confirms the wrong image', async () => {
    const secondId = '00000002-0000-4000-8000-000000000002';
    const gate = deferred();
    mount({ items: [item(1), item(2)], gates: new Map([[secondId, gate]]) });

    // The first item's editor is mounted.
    expect(await screen.findByRole('button', { name: '確認済みにする' })).toBeVisible();

    const gallery = screen.getByRole('list', { name: '画像一覧' });
    await userEvent.click(within(gallery).getAllByRole('listitem')[1]!);

    // While item 2 is still loading, item 1's editor must be gone: keeping it
    // would let a human confirm item 1 believing it is item 2.
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: '確認済みにする' })).toBeNull();
    });

    gate.resolve();
    expect(await screen.findByRole('button', { name: '確認済みにする' })).toBeVisible();
  });

  it('reports a failed load without leaving stale content on screen', async () => {
    const port = ports();
    (port.annotations.workspaces as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValue({ ok: false, error: { code: 'NOT_FOUND' } });
    render(<AnnotationWorkspacePage project={project} annotations={port.annotations}
      labelSchemas={port.labelSchemas} revisions={port.revisions} />);

    expect(await screen.findByText('対象が見つかりません。取り込み状況を確認してください。')).toBeVisible();
    expect(screen.queryByRole('list', { name: '画像一覧' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Dataset を確定する' })).toBeNull();
  });

  it('omits the Reference panel entirely when the bridge does not expose it', async () => {
    mount();
    await screen.findByRole('button', { name: 'Dataset を確定する' });
    expect(screen.queryByRole('button', { name: '参照元を確認' })).toBeNull();
  });
});
