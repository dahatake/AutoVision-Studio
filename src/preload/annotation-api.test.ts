// @vitest-environment node
import type { IpcRenderer } from 'electron';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import * as c from '../shared/contracts/annotation-ipc.js';
import type { AnnotationItem, AnnotationProvenance, AnnotationWorkspace } from '../shared/contracts/annotation.js';
import { createAnnotationApi } from './annotation-api.js';

const projectId = '11111111-1111-4111-8111-111111111111';
const workspaceId = '22222222-2222-4222-8222-222222222222';
const itemId = '33333333-3333-4333-8333-333333333333';
const schemaId = '44444444-4444-4444-8444-444444444444';
const classId = '55555555-5555-4555-8555-555555555555';
const at = '2026-09-13T00:00:00.000Z', hash = 'a'.repeat(64);
const context = { projectId, workspaceId, itemId };
const page: c.AnnotationListInput = { projectId, workspaceId, offset: 0, limit: 1, state: 'editing' };
const save: c.AnnotationSaveInput = { ...context, expectedEditVersion: 0, expectedAnnotationSha256: hash,
  expectedState: 'editing', expectedConfirmedAt: null, annotation: { kind: 'classification', classId },
  state: 'editing', exclusionReason: null };
const confirm: c.AnnotationConfirmInput = { ...context, expectedEditVersion: 0, expectedAnnotationSha256: hash,
  expectedState: 'editing', expectedConfirmedAt: null, negativeConfirmed: false };
const item: AnnotationItem = { id: itemId, workspaceId, importId: schemaId, imageKey: 'image:1',
  imageSha256: hash, width: 10, height: 10, annotation: { kind: 'classification', classId },
  annotationSha256: hash, state: 'editing', negativeConfirmed: false, exclusionReason: null,
  editVersion: 1, confirmedAt: null, updatedAt: at };
const workspace: AnnotationWorkspace = { id: workspaceId, projectId, schemaId, taskType: 'classification',
  mode: 'copy', state: 'editing', editVersion: 0, createdAt: at, updatedAt: at };
const provenance = (targetKey = 'classification'): AnnotationProvenance => ({ itemId, targetKey, kind: 'manual',
  sourceImportId: null, sourceImageKey: null, sourceAnnotationKey: null, sourceSuggestionId: null,
  original: { source: { labels: ['cat'] } }, changes: {} });
const ok = <T>(value: T) => ({ ok: true as const, value });
const fail = (code: string) => ({ ok: false, error: { code } });
const detail = (fields: Partial<AnnotationItem> = {}, sources = [provenance()]) =>
  ok({ item: { ...structuredClone(item), ...fields }, provenance: sources });
const confirmed = (fields: Partial<AnnotationItem> = {}, sources = [provenance()]) =>
  detail({ state: 'confirmed', confirmedAt: at, ...fields }, sources);
const cases = [
  ['workspaces', c.ANNOTATION_WORKSPACES_CHANNEL, { projectId }, ok([workspace])],
  ['list', c.ANNOTATION_LIST_CHANNEL, page, ok({ items: [item], total: 1 })],
  ['get', c.ANNOTATION_GET_CHANNEL, context, detail()],
  ['save', c.ANNOTATION_SAVE_CHANNEL, save, detail()],
  ['confirm', c.ANNOTATION_CONFIRM_CHANNEL, confirm, confirmed()],
] as const;
function harness() {
  const invoke = vi.fn<IpcRenderer['invoke']>();
  const api = createAnnotationApi({ invoke });
  const call = (name: keyof c.AnnotationApi, ...args: unknown[]) => Reflect.apply(api[name], api, args) as Promise<unknown>;
  return { api, invoke, call };
}
function frozenTree(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) frozenTree(child);
}

describe('ANN-06P fixed annotation API', () => {
  it('exports a lazy frozen null-prototype five-method API and no other capabilities', () => {
    expectTypeOf(createAnnotationApi).returns.toEqualTypeOf<Readonly<c.AnnotationApi>>();
    const h = harness();
    expect(h.invoke).not.toHaveBeenCalled();
    expect(Object.getPrototypeOf(h.api)).toBeNull();
    expect(Object.isFrozen(h.api)).toBe(true);
    expect(Reflect.ownKeys(h.api)).toEqual(['workspaces', 'list', 'get', 'save', 'confirm']);
    expect(Object.values(h.api).every((method) => typeof method === 'function')).toBe(true);
  });
  it.each(cases)('%s invokes exactly its fixed channel with a detached frozen snapshot', async (name, channel, input, response) => {
    const h = harness(), raw = structuredClone(input), received = structuredClone(response);
    h.invoke.mockResolvedValueOnce(received);
    const result = await h.call(name, raw);
    expect(result).toEqual(response);
    expect(h.invoke.mock.calls).toEqual([[channel, input]]);
    expect(h.invoke.mock.calls[0]![1]).not.toBe(raw);
    frozenTree(h.invoke.mock.calls[0]![1]); frozenTree(result);
    expect(Object.isFrozen(raw)).toBe(false);
    expect(Object.isFrozen(received.value)).toBe(false);
    expect(result).not.toBe(received);
  });
  it.each(cases)('%s rejects arity, accessors, cycles, hostile proxies and extra keys before invoke', async (name, _channel, input) => {
    const h = harness(), getter = vi.fn(() => projectId), toJSON = vi.fn();
    const revoked = Proxy.revocable({}, {}); revoked.revoke();
    const cycle: Record<string, unknown> = {}; cycle['self'] = cycle;
    const accessor = Object.defineProperty({ ...input }, 'projectId', { enumerable: true, get: getter });
    const hostile = new Proxy({}, { ownKeys() { throw new Error('private'); } });
    for (const args of [[], [input, undefined], [undefined], [null], [false], ['text'], [[]],
      [{ ...input, projectId: '../private' }], [{ ...input, path: 'private' }], [accessor], [cycle],
      [revoked.proxy], [hostile], [Object.create(input)], [{ ...input, toJSON }],
      [{ ...input, [Symbol('extra')]: 1 }], [Object.defineProperty({ ...input }, 'hidden', { value: 1 })]]) {
      const result = await h.call(name, ...args);
      expect(result).toEqual(fail('INVALID_REQUEST')); frozenTree(result);
    }
    expect(h.invoke).not.toHaveBeenCalled(); expect(getter).not.toHaveBeenCalled(); expect(toJSON).not.toHaveBeenCalled();
    expect(Object.isFrozen(cycle)).toBe(false);
  });
  it.each(cases)('%s safely handles transport failures and malformed responses without retries', async (name, _channel, input) => {
    const h = harness(), getter = vi.fn();
    h.invoke.mockImplementationOnce(() => { throw new Error('private'); });
    expect(await h.call(name, input)).toEqual(fail('OPERATION_FAILED'));
    h.invoke.mockRejectedValueOnce(new Error('private'));
    expect(await h.call(name, input)).toEqual(fail('OPERATION_FAILED'));
    const revoked = Proxy.revocable({}, {}); revoked.revoke();
    const cycle: Record<string, unknown> = {}; cycle['self'] = cycle;
    const bad = [undefined, null, false, fail('UNKNOWN'), { ok: false, error: { code: 'BUSY', path: 'private' } },
      { ...fail('LOCKED'), value: {} }, Object.defineProperty({ ok: true }, 'value', { enumerable: true, get: getter }),
      revoked.proxy, cycle];
    for (const response of bad) {
      h.invoke.mockResolvedValueOnce(response);
      const result = await h.call(name, input);
      expect(result).toEqual(fail('OPERATION_FAILED')); frozenTree(result);
    }
    expect(h.invoke).toHaveBeenCalledTimes(2 + bad.length); expect(getter).not.toHaveBeenCalled();
  });
  it.each(cases)('%s preserves every known strict error without success fallthrough', async (name, _channel, input) => {
    const h = harness();
    for (const code of c.annotationIpcErrorCodeSchema.options) {
      const raw = fail(code); h.invoke.mockResolvedValueOnce(raw);
      const result = await h.call(name, input);
      expect(result).toEqual(raw); expect(result).not.toBe(raw); frozenTree(result);
      expect(Object.isFrozen(raw.error)).toBe(false);
    }
    expect(h.invoke).toHaveBeenCalledTimes(c.annotationIpcErrorCodeSchema.options.length);
  });
  it('rejects foreign projects, workspaces, item identities and invalid list boundaries', async () => {
    const h = harness();
    const invalid = [
      ['workspaces', { projectId }, ok([{ ...workspace, projectId: classId }])],
      ['workspaces', { projectId }, ok([workspace, structuredClone(workspace)])],
      ['list', page, ok({ items: [{ ...item, workspaceId: classId }], total: 1 })],
      ['list', page, ok({ items: [item], total: 0 })],
      ['list', { ...page, offset: 1 }, ok({ items: [item], total: 1 })],
      ['list', { ...page, state: 'excluded' }, ok({ items: [item], total: 1 })],
      ['list', page, ok({ items: [item, { ...item, id: classId }], total: 2 })],
      ['get', context, detail({ id: classId })], ['get', context, detail({ workspaceId: classId })],
      ['save', save, detail({ id: classId })], ['save', save, detail({ workspaceId: classId })],
      ['confirm', confirm, confirmed({ id: classId })], ['confirm', confirm, confirmed({ workspaceId: classId })],
      ['get', context, ok({ ...detail().value, path: 'private' })],
    ] as const;
    for (const [name, input, response] of invalid) {
      h.invoke.mockResolvedValueOnce(response); expect(await h.call(name, input)).toEqual(fail('OPERATION_FAILED'));
    }
  });
  it.each(['get', 'save', 'confirm'] as const)('%s requires complete one-to-one source-correlated provenance', async (name) => {
    const h = harness(), input = name === 'get' ? context : name === 'save' ? save : confirm;
    const make = name === 'confirm' ? confirmed : detail;
    const imported: AnnotationProvenance = { ...provenance(), kind: 'import-edited', sourceImportId: item.importId,
      sourceImageKey: item.imageKey, sourceAnnotationKey: 'row:1' };
    h.invoke.mockResolvedValueOnce(make({}, [imported]));
    expect(await h.call(name, input)).toEqual(make({}, [imported]));
    for (const sources of [[], [provenance(), provenance()], [provenance(classId)],
      [{ ...provenance(), itemId: classId }], [{ ...imported, sourceImportId: projectId }],
      [{ ...imported, sourceImageKey: 'foreign' }]]) {
      h.invoke.mockResolvedValueOnce(make({}, sources)); expect(await h.call(name, input)).toEqual(fail('OPERATION_FAILED'));
    }
  });
  it('save rejects replaced annotations, wrong versions and fabricated confirmed state', async () => {
    const h = harness();
    for (const response of [detail({ editVersion: 0 }), detail({ editVersion: 2 }), confirmed(),
      detail({ annotation: { kind: 'classification', classId: schemaId } }),
      detail({ annotation: { kind: 'classification', classId: null } }, []),
      detail({ state: 'excluded' }), detail({ annotationSha256: 'bad' })]) {
      h.invoke.mockResolvedValueOnce(response); expect(await h.api.save(save)).toEqual(fail('OPERATION_FAILED'));
    }
    // Save may produce a new hash; it must preserve the exact requested content.
    h.invoke.mockResolvedValueOnce(detail({ annotationSha256: 'b'.repeat(64) }));
    expect((await h.api.save(save)).ok).toBe(true);
    const rectangles = [{ id: classId, classId, x: 1, y: 1, width: 2, height: 2 },
      { id: schemaId, classId, x: 4, y: 4, width: 2, height: 2 }];
    const input: c.AnnotationSaveInput = { ...save, annotation: { kind: 'detection', rectangles } };
    for (const changed of [rectangles, [...rectangles].reverse(), rectangles.slice(0, 1),
      rectangles.map((r, i) => i === 0 ? { ...r, x: 2 } : r)]) {
      h.invoke.mockResolvedValueOnce(detail({ annotation: { kind: 'detection', rectangles: changed } }, changed.map((r) => provenance(r.id))));
      expect((await h.api.save(input)).ok).toBe(changed === rectangles);
    }
  });
  it('confirm enforces unchanged hash, version, confirmed output and explicit negative intent', async () => {
    const h = harness();
    for (const response of [detail(), confirmed({ annotationSha256: 'b'.repeat(64) }), confirmed({ editVersion: 0 }),
      confirmed({ editVersion: 2 }), confirmed({ confirmedAt: null }), confirmed({ updatedAt: '2026-09-13T00:00:01.000Z' }),
      confirmed({ negativeConfirmed: true }), confirmed({ exclusionReason: 'why' })]) {
      h.invoke.mockResolvedValueOnce(response); expect(await h.api.confirm(confirm)).toEqual(fail('OPERATION_FAILED'));
    }
    const negative = confirmed({ annotation: { kind: 'detection', rectangles: [] }, negativeConfirmed: true }, []);
    h.invoke.mockResolvedValueOnce(negative);
    expect((await h.api.confirm({ ...confirm, expectedState: 'unstarted', negativeConfirmed: true })).ok).toBe(true);
    h.invoke.mockResolvedValueOnce(negative);
    expect(await h.api.confirm(confirm)).toEqual(fail('OPERATION_FAILED'));
    for (const input of [{ ...confirm, negativeConfirmed: undefined }, { ...confirm, annotation: item.annotation },
      { ...save, state: 'confirmed' }, { ...save, provenance: [] }]) {
      const before = h.invoke.mock.calls.length;
      expect(await h.call('annotation' in input && 'state' in input ? 'save' : 'confirm', input)).toEqual(fail('INVALID_REQUEST'));
      expect(h.invoke).toHaveBeenCalledTimes(before);
    }
    for (const input of [{ ...confirm, expectedState: 'excluded' as const },
      { ...confirm, expectedState: 'confirmed' as const, expectedConfirmedAt: at }]) {
      h.invoke.mockResolvedValueOnce(fail('INVALID_REQUEST'));
      expect(await h.api.confirm(input)).toEqual(fail('INVALID_REQUEST'));
      h.invoke.mockResolvedValueOnce(confirmed()); expect(await h.api.confirm(input)).toEqual(fail('OPERATION_FAILED'));
    }
  });
  it.each(cases)('%s snapshots before await without freezing or rereading callers', async (name, _channel, input, response) => {
    const h = harness(), pending = Promise.withResolvers<unknown>(), raw = structuredClone(input);
    h.invoke.mockReturnValueOnce(pending.promise);
    const result = h.call(name, raw);
    const getter = vi.fn(() => classId);
    Object.defineProperty(raw, 'projectId', { enumerable: true, get: getter });
    if ('annotation' in raw && raw.annotation.kind === 'classification') raw.annotation.classId = schemaId;
    pending.resolve(structuredClone(response));
    expect(await result).toEqual(response); expect(getter).not.toHaveBeenCalled(); expect(Object.isFrozen(raw)).toBe(false);
  });
  it.each(['save', 'confirm'] as const)('%s keeps double calls independent even when responses finish in reverse order', async (name) => {
    const h = harness(), first = Promise.withResolvers<unknown>(), second = Promise.withResolvers<unknown>();
    const input = name === 'save' ? save : confirm, response = name === 'save' ? detail() : confirmed();
    h.invoke.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const a = h.call(name, input), b = h.call(name, input);
    expect(h.invoke).toHaveBeenCalledTimes(2);
    expect(h.invoke.mock.calls[0]![1]).not.toBe(h.invoke.mock.calls[1]![1]);
    second.resolve(response); expect(await b).toEqual(response);
    first.resolve(fail('CONFLICT')); expect(await a).toEqual(fail('CONFLICT'));
    expect(h.invoke).toHaveBeenCalledTimes(2);
  });
});