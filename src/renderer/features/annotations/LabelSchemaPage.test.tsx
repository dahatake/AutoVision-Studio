import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { projectSchema, type Project } from '../../../shared/contracts/project';
import { labelSchemaSnapshotSchema, type LabelSchemaSnapshot } from '../../../shared/contracts/annotation';
import * as c from '../../../shared/contracts/annotation-ipc';
import { LabelSchemaPage, type LabelSchemaPageProps } from './LabelSchemaPage';

const projectId = '11111111-1111-4111-8111-111111111111';
const schemaId = '22222222-2222-4222-8222-222222222222';
const cat = '33333333-3333-4333-8333-333333333333';
const dog = '44444444-4444-4444-8444-444444444444';
const other = '55555555-5555-4555-8555-555555555555';
const at = '2026-09-13T00:00:00.000Z';
const project = projectSchema.parse({ id: projectId, name: '検証Project', description: '', taskType: 'classification',
  workspacePath: 'C:\\unused', createdAt: at, updatedAt: at });
function snapshot(changes: Partial<LabelSchemaSnapshot> = {}) {
  return labelSchemaSnapshotSchema.parse({ id: schemaId, projectId, instructions: '保存指示', lockedAt: null,
    editVersion: 0, createdAt: at, updatedAt: at,
    classes: [cat, dog].map((id, ordinal) => ({ id, schemaId, displayName: ordinal ? 'dog' : 'cat',
      normalizedName: ordinal ? 'dog' : 'cat', modelAlias: null, color: '#abcdef', description: '', examples: [],
      ordinal, createdAt: at, updatedAt: at })), ...changes });
}
const ack = (value = snapshot()) => c.labelCreateResponseSchema.parse({ ok: true, value });
function ports(value: LabelSchemaSnapshot | null = snapshot()) {
  // DTO factories + typed UI ports only; no imitation of Main persistence/CAS.
  return { get: vi.fn<c.LabelSchemaApi['get']>().mockResolvedValue(c.labelGetResponseSchema.parse({ ok: true, value })),
    create: vi.fn<c.LabelSchemaApi['create']>().mockResolvedValue(ack(snapshot({ classes: [] }))),
    createClass: vi.fn<c.LabelSchemaApi['createClass']>(), updateClass: vi.fn<c.LabelSchemaApi['updateClass']>(),
    update: vi.fn<c.LabelSchemaApi['update']>(), deleteClass: vi.fn<c.LabelSchemaApi['deleteClass']>(),
    mergeClasses: vi.fn<c.LabelSchemaApi['mergeClasses']>() };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; }
const form = (name: string) => screen.getByRole('form', { name });
const input = (name: string, label = '名前（必須）') => within(form(name)).getByLabelText(label);
const edit = (name: string, text: string, label?: string) => fireEvent.change(input(name, label), { target: { value: text } });
async function submit(name: string) { await act(async () => { fireEvent.submit(form(name)); }); }
async function mount(api = ports(), visible = true) {
  const onBack = vi.fn(); const view = render(<LabelSchemaPage project={project} api={api} visible={visible} onBack={onBack} />);
  await act(async () => {});
  const show = async (nextVisible = true, nextProject = project, nextApi = api) => {
    view.rerender(<LabelSchemaPage project={nextProject} api={nextApi} visible={nextVisible} onBack={onBack} />);
    await act(async () => {});
  };
  return { ...view, api, onBack, show };
}

describe('LabelSchemaPage standalone ANN-04', () => {
  it('has exact props, lazy first-visible get and explicit empty schema creation', async () => {
    expectTypeOf<LabelSchemaPageProps>().toEqualTypeOf<{ project: Project; api: c.LabelSchemaApi; visible?: boolean; onBack: () => void }>();
    const h = await mount(ports(null), false); expect(h.api.get).not.toHaveBeenCalled();
    await h.show(); expect(h.api.get).toHaveBeenCalledExactlyOnceWith({ projectId }); expect(h.api.create).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByText('ラベル定義を作成')); });
    expect(h.api.create).toHaveBeenCalledExactlyOnceWith({ projectId }); expect(form('新しいクラス')).toBeVisible();
    await h.show(false); await h.show(); expect(h.api.get).toHaveBeenCalledTimes(1);
  });
  it('defaults visible and renders readonly project/task', async () => {
    const api = ports(); render(<LabelSchemaPage project={project} api={api} onBack={vi.fn()} />);
    expect(await screen.findByRole('form', { name: '作業指示' })).toBeVisible(); expect(screen.getByText(/検証Project.*画像分類/)).toBeVisible();
  });
  it.each(['ＣＡＴ', ' cat ', '\u0085Cat\u3000', 'CAT'])('rejects normalized duplicate %j before invoking', async (name) => {
    const h = await mount(); edit('新しいクラス', name); await submit('新しいクラス');
    expect(h.api.createClass).not.toHaveBeenCalled(); expect(screen.getByRole('status')).toHaveTextContent('同じ名前');
  });
  it.each(['', ' \t ', '\u3000'])('validates whitespace name %j via the shared input schema', async (name) => {
    const h = await mount(); edit('新しいクラス', name); await submit('新しいクラス'); expect(h.api.createClass).not.toHaveBeenCalled();
    expect(input('新しいクラス')).toHaveValue(name);
  });
  it('creates full literal fields at max ordinal + 1 then uses the acknowledged version and values', async () => {
    const h = await mount(); edit('新しいクラス', 'bird'); edit('新しいクラス', 'model', 'モデル別名（任意）');
    edit('新しいクラス', 'one\nhttps://example.invalid/<img>', '例（1行に1件・文字列のみ）');
    const next = snapshot({ editVersion: 1 }); next.classes.push({ ...structuredClone(next.classes[0]!), id: other, displayName: 'bird', normalizedName: 'bird', ordinal: 2 });
    h.api.createClass.mockResolvedValueOnce(ack(next)); await submit('新しいクラス');
    expect(h.api.createClass.mock.calls[0]![0]).toEqual(c.labelCreateClassInputSchema.parse({ projectId, schemaId, expectedEditVersion: 0,
      displayName: 'bird', modelAlias: 'model', color: '#0078d4', description: '', examples: ['one', 'https://example.invalid/<img>'], ordinal: 2 }));
    expect(input('新しいクラス')).toHaveValue(''); edit('クラス: bird', 'updated', '説明');
    const latest = snapshot({ ...next, editVersion: 2, classes: next.classes.map((item) => item.id === other ? { ...item, description: 'server value' } : item) });
    h.api.updateClass.mockResolvedValueOnce(ack(latest)); await submit('クラス: bird');
    expect(h.api.updateClass.mock.calls[0]![0].expectedEditVersion).toBe(1); expect(input('クラス: bird', '説明')).toHaveValue('server value');
  });
  it('preserves instruction/class/new drafts across hide and another class acknowledgement; rebases only pristine fields', async () => {
    const h = await mount(); edit('クラス: cat', 'cat draft'); edit('作業指示', 'instruction draft', '指示文'); edit('新しいクラス', 'new draft');
    edit('クラス: dog', 'dog draft', '説明'); const next = snapshot({ editVersion: 1 }); next.classes[0]!.description = 'new saved description';
    h.api.updateClass.mockResolvedValueOnce(ack(next)); await submit('クラス: dog'); await h.show(false); await h.show();
    expect(input('クラス: cat')).toHaveValue('cat draft'); expect(input('クラス: cat', '説明')).toHaveValue('new saved description');
    expect(input('作業指示', '指示文')).toHaveValue('instruction draft'); expect(input('新しいクラス')).toHaveValue('new draft');
    h.api.update.mockResolvedValueOnce(ack(snapshot({ ...next, editVersion: 2, instructions: 'confirmed' }))); await submit('作業指示');
    expect(h.api.update.mock.calls[0]![0]).toEqual({ projectId, id: schemaId, expectedEditVersion: 1, instructions: 'instruction draft' });
    expect(input('作業指示', '指示文')).toHaveValue('confirmed'); expect(input('クラス: cat')).toHaveValue('cat draft');
  });
  it('serializes same-turn submissions and acknowledges hidden pending saves without navigation callbacks', async () => {
    const h = await mount(); edit('作業指示', 'draft', '指示文'); const pending = deferred<c.LabelUpdateResponse>(); h.api.update.mockReturnValueOnce(pending.promise);
    act(() => { fireEvent.submit(form('作業指示')); fireEvent.submit(form('作業指示')); }); expect(h.api.update).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('未保存の変更を保持して戻る')); expect(h.onBack).toHaveBeenCalledTimes(1); await h.show(false);
    await act(async () => { pending.resolve(ack(snapshot({ editVersion: 1, instructions: 'confirmed hidden' }))); }); await h.show();
    expect(input('作業指示', '指示文')).toHaveValue('confirmed hidden'); expect(h.onBack).toHaveBeenCalledTimes(1);
  });
  it.each(['project', 'schema', 'version', 'reject'] as const)('rejects invalid acknowledgement %s without clearing drafts or raw errors', async (kind) => {
    const h = await mount(); edit('作業指示', 'draft', '指示文');
    if (kind === 'reject') h.api.update.mockRejectedValueOnce(new Error('PRIVATE_NATIVE'));
    else h.api.update.mockResolvedValueOnce(ack(snapshot({ editVersion: kind === 'version' ? 0 : 1,
      ...(kind === 'project' ? { projectId: other } : {}), ...(kind === 'schema' ? { id: other, classes: [] } : {}) })));
    await submit('作業指示'); expect(input('作業指示', '指示文')).toHaveValue('draft'); expect(h.container).not.toHaveTextContent('PRIVATE_NATIVE');
    expect(screen.getByRole('status')).toHaveTextContent('処理結果を確認できません');
  });
  it.each(['project', 'api'] as const)('ignores A-B-A pending responses across %s changes', async (kind) => {
    const h = await mount(); edit('作業指示', 'old draft', '指示文'); const pending = deferred<c.LabelUpdateResponse>(); h.api.update.mockReturnValueOnce(pending.promise);
    await submit('作業指示');
    if (kind === 'project') await h.show(true, { ...project, id: other }, ports(snapshot({ projectId: other })));
    else await h.show(true, project, ports());
    await h.show(); await act(async () => { pending.resolve(ack(snapshot({ editVersion: 1, instructions: 'STALE' }))); });
    expect(input('作業指示', '指示文')).toHaveValue('保存指示'); expect(h.container).not.toHaveTextContent('STALE'); expect(h.onBack).not.toHaveBeenCalled();
  });
  it('locks all writes including synthetic submits', async () => {
    const h = await mount(ports(snapshot({ lockedAt: at }))); expect(input('クラス: cat')).toBeDisabled();
    for (const name of ['作業指示', 'クラス: cat', '新しいクラス', 'クラス統合']) await submit(name);
    expect(screen.getByText(/閲覧のみ可能/)).toBeVisible();
    for (const [name, method] of Object.entries(h.api)) if (name !== 'get') expect(method).not.toHaveBeenCalled();
  });
  it('confirms delete, preserves CLASS_USED failure and only removes on acknowledgement', async () => {
    const h = await mount(); edit('クラス: cat', 'draft'); const button = within(form('クラス: cat')).getByText('クラスを削除');
    fireEvent.click(button); expect(screen.getByText('キャンセル')).toHaveFocus(); fireEvent.click(screen.getByText('キャンセル')); expect(h.api.deleteClass).not.toHaveBeenCalled();
    fireEvent.click(button); h.api.deleteClass.mockResolvedValueOnce({ ok: false, error: { code: 'CLASS_USED' } });
    await act(async () => { fireEvent.click(screen.getByText('削除する')); }); expect(input('クラス: cat')).toHaveValue('draft'); expect(screen.getByRole('status')).toHaveTextContent('使用中');
    h.api.deleteClass.mockResolvedValueOnce(ack(snapshot({ editVersion: 1, classes: snapshot().classes.filter((item) => item.id !== cat) })));
    await act(async () => { fireEvent.click(screen.getByText('削除する')); }); expect(screen.queryByRole('form', { name: 'クラス: cat' })).toBeNull();
    expect(h.api.deleteClass.mock.calls[0]![0]).toEqual({ projectId, schemaId, classId: cat, expectedEditVersion: 0 });
  });
  it('only explicitly merges and preserves HISTORY_REFERENCE failure', async () => {
    const h = await mount(); fireEvent.change(screen.getByLabelText('統合元'), { target: { value: cat } }); fireEvent.change(screen.getByLabelText('統合先'), { target: { value: dog } });
    expect(h.api.mergeClasses).not.toHaveBeenCalled(); h.api.mergeClasses.mockResolvedValueOnce({ ok: false, error: { code: 'HISTORY_REFERENCE' } });
    await submit('クラス統合'); expect(form('クラス: cat')).toBeVisible(); expect(form('クラス: dog')).toBeVisible(); expect(screen.getByRole('status')).toHaveTextContent('履歴');
    h.api.mergeClasses.mockResolvedValueOnce(ack(snapshot({ editVersion: 1, classes: snapshot().classes.filter((item) => item.id === dog) })));
    await submit('クラス統合'); expect(h.api.mergeClasses.mock.calls[1]![0]).toEqual({ projectId, schemaId, sourceId: cat, targetId: dog, expectedEditVersion: 0 });
    expect(screen.queryByRole('form', { name: 'クラス: cat' })).toBeNull();
  });
  it('keeps a removed dirty class with a warning after another acknowledgement', async () => {
    const h = await mount(); edit('クラス: cat', 'orphan draft'); edit('作業指示', 'new', '指示文');
    h.api.update.mockResolvedValueOnce(ack(snapshot({ editVersion: 1, classes: snapshot().classes.filter((item) => item.id === dog) })));
    await submit('作業指示'); const region = screen.getByRole('region', { name: '削除されたクラスの下書き' });
    expect(within(region).getByLabelText('名前（必須）')).toHaveValue('orphan draft'); expect(region).toHaveTextContent('下書きは保持');
  });
  it('renders namespace/HTML/URL text literally without media capabilities', async () => {
    const value = snapshot(); const text = '<svg:script>https://example.invalid/<img src=x></svg:script>';
    const examples = [text, '', 'embedded\nnewline'];
    value.instructions = text; value.classes[0]!.examples = examples; const h = await mount(ports(value));
    expect(input('作業指示', '指示文')).toHaveValue(text); expect(input('クラス: cat', '例（1行に1件・文字列のみ）')).toHaveValue(examples.join('\n'));
    expect(h.container.querySelector('img, video, canvas, iframe, script, a, input[type=file]')).toBeNull();
    edit('クラス: cat', 'description only', '説明');
    h.api.updateClass.mockResolvedValueOnce(ack(snapshot({ ...value, editVersion: 1 })));
    await submit('クラス: cat'); expect(h.api.updateClass.mock.calls[0]![0].examples).toEqual(examples);
  });
});