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

function hex(value: number, width: number): string { return value.toString(16).padStart(width, '0'); }

/** Items 1..count with ids ascending by index, matching Main's `ORDER BY a.id`. */
function many(count: number, state: (index: number) => AnnotationItem['state'] = () => 'unstarted'): AnnotationItem[] {
  return Array.from({ length: count }, (_, i) => ({
    ...item(1, state(i + 1)),
    id: `${hex(i + 1, 8)}-0000-4000-8000-${hex(i + 1, 12)}`,
    imageKey: `image:${i + 1}`,
  }));
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
    list: vi.fn(async (input: { workspaceId: string; offset: number; limit: number }) => ({
      ok: true as const,
      value: {
        items: items.slice(input.offset, input.offset + input.limit)
          .map((entry) => ({ ...entry, workspaceId: input.workspaceId })),
        total: options.total ?? items.length,
      },
    })),
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

function show(port: ReturnType<typeof ports>) {
  const view = render(<AnnotationWorkspacePage project={project} annotations={port.annotations}
    labelSchemas={port.labelSchemas} revisions={port.revisions} />);
  return { ...port, view };
}

function mount(options: Options = {}) {
  return show(ports(options));
}

function listOffsets(port: ReturnType<typeof ports>): number[] {
  return vi.mocked(port.annotations.list).mock.calls.map(([input]) => input.offset);
}
/** Wraps the paged list so one offset can be held open or answered differently. */
function interceptList(port: ReturnType<typeof ports>, onOffset: number,
  answer: (page: () => Promise<unknown>) => Promise<unknown>) {
  const list = vi.mocked(port.annotations.list);
  const paged = list.getMockImplementation()!;
  list.mockImplementation(((input: Parameters<typeof paged>[0]) =>
    (input.offset === onOffset ? answer(() => paged(input)) : paged(input))) as typeof paged);
}
const editor = () => screen.queryByRole('button', { name: '確認済みにする' });
const nextPage = () => screen.getByRole('button', { name: '次の 200 件' });
const previousPage = () => screen.getByRole('button', { name: '前の 200 件' });
const gallery = () => screen.getByRole('list', { name: '画像一覧' });
const shownKeys = () => within(gallery()).getAllByRole('img').map((img) => img.getAttribute('alt'));

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

  it('GAL 0 items: says there is nothing to annotate and offers no paging', async () => {
    mount({ items: [] });
    expect(await screen.findByText('対象画像がありません。')).toBeVisible();
    expect(screen.queryByRole('button', { name: '次の 200 件' })).toBeNull();
    expect(screen.queryByRole('button', { name: '前の 200 件' })).toBeNull();
  });

  it('GAL 1 item: shows the item and offers no paging', async () => {
    mount({ items: many(1) });
    expect(await screen.findByRole('button', { name: '確認済みにする' })).toBeVisible();
    expect(shownKeys()).toEqual(['未着手：image:1']);
    expect(screen.queryByRole('button', { name: '次の 200 件' })).toBeNull();
    expect(screen.queryByRole('button', { name: '前の 200 件' })).toBeNull();
  });

  it('GAL 200 items: a full single page needs one request and no paging', async () => {
    const h = mount({ items: many(200) });
    await screen.findByRole('button', { name: '確認済みにする' });
    expect(shownKeys()).toHaveLength(200);
    expect(screen.queryByRole('button', { name: '次の 200 件' })).toBeNull();
    expect(screen.queryByRole('button', { name: '前の 200 件' })).toBeNull();
    expect(h.annotations.list).toHaveBeenCalledTimes(1);
    expect(h.annotations.list).toHaveBeenCalledWith(expect.objectContaining({ offset: 0, limit: 200 }));
  });

  it('GAL 201 items: the next page drops the old editor at once and selects nothing by itself', async () => {
    const port = ports({ items: many(201) });
    const gate = deferred();
    interceptList(port, 200, async (page) => { await gate.promise; return page(); });
    show(port);
    await screen.findByRole('button', { name: '確認済みにする' });

    await userEvent.click(nextPage());
    // Still fetching: the first page's editor must already be gone.
    expect(editor()).toBeNull();
    gate.resolve();

    await waitFor(() => { expect(shownKeys()).toEqual(['未着手：image:201']); });
    expect(port.annotations.list).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 200, limit: 200 }));
    expect(nextPage()).toBeDisabled();
    expect(previousPage()).toBeEnabled();
    expect(editor()).toBeNull();

    await userEvent.click(within(gallery()).getByRole('listitem'));
    expect(await screen.findByRole('button', { name: '確認済みにする' })).toBeVisible();
    expect(port.annotations.get).toHaveBeenLastCalledWith(
      expect.objectContaining({ itemId: many(201)[200]!.id }),
    );
  });

  it('GAL 201 items: a Workspace change during the page request restarts at offset 0 without selecting', async () => {
    const h = mount({ items: many(201) });
    await screen.findByRole('button', { name: '確認済みにする' });
    const newer = { ...workspace, id: '5d6e7f80-1a2b-4c3d-8e9f-0a1b2c3d4e5f', createdAt: '2026-09-23T00:00:00.000Z' };
    vi.mocked(h.annotations.workspaces).mockResolvedValue({ ok: true, value: [workspace, newer] } as never);

    await userEvent.click(nextPage());

    expect(await screen.findByText(/表示は 1〜200件目/u)).toBeVisible();
    expect(h.annotations.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ workspaceId: newer.id, offset: 0, limit: 200 }),
    );
    expect(previousPage()).toBeDisabled();
    expect(within(gallery()).queryAllByRole('listitem', { current: true })).toHaveLength(0);
    expect(editor()).toBeNull();
  });

  it('GAL multiple pages: next, next, previous walks 0, 200, 400, 200 with matching ranges', async () => {
    const h = mount({ items: many(450) });
    expect(await screen.findByText(/表示は 1〜200件目/u)).toBeVisible();
    await userEvent.click(nextPage());
    expect(await screen.findByText(/表示は 201〜400件目/u)).toBeVisible();
    await userEvent.click(nextPage());
    expect(await screen.findByText(/表示は 401〜450件目/u)).toBeVisible();
    expect(nextPage()).toBeDisabled();
    await userEvent.click(previousPage());
    expect(await screen.findByText(/表示は 201〜400件目/u)).toBeVisible();
    expect(listOffsets(h)).toEqual([0, 200, 400, 200]);
  });

  it('GAL filter boundary: the filter stays inside the current page and never opens a hidden item', async () => {
    const h = mount({ items: many(201, (index) => (index === 2 || index === 201 ? 'editing' : 'unstarted')) });
    await screen.findByRole('button', { name: '確認済みにする' });
    await userEvent.click(nextPage());
    await waitFor(() => { expect(shownKeys()).toEqual(['編集中：image:201']); });

    await userEvent.click(screen.getByRole('radio', { name: '編集中' }));
    // Filtering is local: no refetch and no item pulled in from another page.
    expect(listOffsets(h)).toEqual([0, 200]);
    expect(shownKeys()).toEqual(['編集中：image:201']);

    await userEvent.click(previousPage());
    await waitFor(() => { expect(shownKeys()).toEqual(['編集中：image:2']); });
    expect(screen.getByRole('radio', { name: '編集中' })).toBeChecked();
    // Item 1 is first on the page but hidden by the filter; its editor must not open.
    expect(editor()).toBeNull();
    expect(h.annotations.get).toHaveBeenCalledTimes(1);
  });

  it('GAL last item: the final item of the final page is selectable and arrows stay on it', async () => {
    const last = many(201)[200]!;
    const h = mount({ items: many(201) });
    await screen.findByRole('button', { name: '確認済みにする' });
    await userEvent.click(nextPage());
    await waitFor(() => { expect(shownKeys()).toEqual(['未着手：image:201']); });

    await userEvent.click(within(gallery()).getByRole('listitem'));
    await screen.findByRole('button', { name: '確認済みにする' });
    await userEvent.keyboard('{ArrowRight}');
    await userEvent.keyboard('{ArrowDown}');

    expect(within(gallery()).getByRole('listitem')).toHaveAttribute('aria-current', 'true');
    expect(h.annotations.get).toHaveBeenLastCalledWith(expect.objectContaining({ itemId: last.id }));
    expect(screen.getByRole('button', { name: '確認済みにする' })).toBeVisible();
    expect(nextPage()).toBeDisabled();
  });

  it('GAL no duplicates: the two pages of 201 items together show every item exactly once', async () => {
    mount({ items: many(201) });
    await screen.findByRole('button', { name: '確認済みにする' });
    const first = shownKeys();
    await userEvent.click(nextPage());
    await waitFor(() => { expect(shownKeys()).toHaveLength(1); });
    const second = shownKeys();

    expect(first).toHaveLength(200);
    expect(second.filter((key) => first.includes(key))).toEqual([]);
    expect(new Set([...first, ...second]).size).toBe(201);
  });

  it('GAL fetch failure: a failed second page reports the error and keeps no first-page item', async () => {
    const port = ports({ items: many(201) });
    interceptList(port, 200, async () => ({ ok: false, error: { code: 'OPERATION_FAILED' } }));
    show(port);
    await screen.findByRole('button', { name: '確認済みにする' });

    await userEvent.click(nextPage());

    expect(await screen.findByText('処理に失敗しました。再読込してください。')).toBeVisible();
    expect(screen.queryByRole('list', { name: '画像一覧' })).toBeNull();
    expect(screen.queryByAltText('未着手：image:1')).toBeNull();
    expect(editor()).toBeNull();
  });
});
