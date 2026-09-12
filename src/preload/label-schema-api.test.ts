// @vitest-environment node
import type { IpcRenderer } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import * as c from '../shared/contracts/annotation-ipc.js';
import { createLabelSchemaApi } from './label-schema-api.js';

const projectId = '11111111-1111-4111-8111-111111111111';
const schemaId = '22222222-2222-4222-8222-222222222222';
const classId = '33333333-3333-4333-8333-333333333333';
const otherId = '44444444-4444-4444-8444-444444444444';
const at = '2026-09-12T00:00:00.000Z';
const value = { id: schemaId, projectId, instructions: '', classes: [], lockedAt: null, editVersion: 0, createdAt: at, updatedAt: at };
const base = { projectId, schemaId, expectedEditVersion: 0 };
const editable = { displayName: '猫', color: '#abcdef', description: '', examples: ['説明'], ordinal: 0 };
const cases = [
  ['get', c.LABEL_GET_CHANNEL, { projectId }], ['create', c.LABEL_CREATE_CHANNEL, { projectId }],
  ['createClass', c.LABEL_CREATE_CLASS_CHANNEL, { ...base, ...editable }],
  ['updateClass', c.LABEL_UPDATE_CLASS_CHANNEL, { ...base, ...editable, id: classId, modelAlias: null }],
  ['update', c.LABEL_UPDATE_CHANNEL, { projectId, id: schemaId, expectedEditVersion: 0, instructions: '' }],
  ['deleteClass', c.LABEL_DELETE_CLASS_CHANNEL, { ...base, classId }],
  ['mergeClasses', c.LABEL_MERGE_CLASSES_CHANNEL, { ...base, sourceId: classId, targetId: otherId }],
] as const;
const fail = (code: string) => ({ ok: false, error: { code } });
function harness() {
  const invoke = vi.fn<IpcRenderer['invoke']>().mockResolvedValue({ ok: true, value });
  const api = createLabelSchemaApi({ invoke });
  // Deliberately bypass TS arity/types to model direct hostile callers.
  const call = (name: keyof c.LabelSchemaApi, ...args: unknown[]) => Reflect.apply(api[name], api, args) as Promise<unknown>;
  return { api, invoke, call };
}
describe('ANN-04P fixed label API', () => {
  it('is lazy, frozen, null-prototype and exposes exactly seven methods', () => {
    const h = harness(); expect(h.invoke).not.toHaveBeenCalled();
    expect(Object.isFrozen(h.api)).toBe(true); expect(Object.getPrototypeOf(h.api)).toBeNull();
    expect(Object.keys(h.api)).toEqual(cases.map(([name]) => name));
  });
  it.each(cases)('%s invokes its one fixed channel once with detached input', async (name, channel, input) => {
    const h = harness(), raw = structuredClone(input);
    expect(await h.call(name, raw)).toEqual({ ok: true, value });
    expect(h.invoke.mock.calls).toEqual([[channel, input]]);
    const sent = h.invoke.mock.calls[0]![1] as object;
    expect(sent).not.toBe(raw); expect(Object.isFrozen(sent)).toBe(true); expect(Object.isFrozen(raw)).toBe(false);
  });
  it.each(cases)('%s rejects wrong arity, getters, unknown keys and invalid input without invoke', async (name, _channel, input) => {
    const h = harness(), getter = vi.fn(() => projectId);
    for (const args of [[], [undefined], [false], [input, undefined], [{ ...input, path: 'C:\\secret' }],
      [Object.defineProperty({}, 'projectId', { enumerable: true, get: getter })]]) {
      expect(await h.call(name, ...args)).toEqual(fail('INVALID_REQUEST'));
    }
    expect(h.invoke).not.toHaveBeenCalled(); expect(getter).not.toHaveBeenCalled();
  });
  it.each(cases)('%s sanitizes throws, rejections, unknown errors, extra native paths and wrong projects', async (name, _channel, input) => {
    const h = harness();
    h.invoke.mockImplementationOnce(() => { throw new Error('C:\\secret'); });
    expect(await h.call(name, input)).toEqual(fail('OPERATION_FAILED'));
    h.invoke.mockRejectedValueOnce(new Error('C:\\secret'));
    expect(await h.call(name, input)).toEqual(fail('OPERATION_FAILED'));
    for (const response of [undefined, false, fail('UNKNOWN'), { ok: false, error: { code: 'LOCKED', path: 'C:\\secret' } },
      { ok: true, value: { ...value, projectId: otherId } }, { ok: true, value: { ...value, nativePath: 'C:\\secret' } }]) {
      h.invoke.mockResolvedValueOnce(response); expect(await h.call(name, input)).toEqual(fail('OPERATION_FAILED'));
    }
  });
  it.each(cases.slice(2))('%s rejects a foreign schema even in the requested project', async (name, _channel, input) => {
    const h = harness(); h.invoke.mockResolvedValueOnce({ ok: true, value: { ...value, id: otherId } });
    expect(await h.call(name, input)).toEqual(fail('OPERATION_FAILED'));
  });
  it('preserves allowed errors but rejects malformed DTO semantics without evaluating getters', async () => {
    const h = harness(), getter = vi.fn(() => value);
    for (const code of c.annotationIpcErrorCodeSchema.options) {
      h.invoke.mockResolvedValueOnce(fail(code)); expect(await h.api.get({ projectId })).toEqual(fail(code));
    }
    h.invoke.mockResolvedValueOnce(Object.defineProperty({ ok: true }, 'value', { enumerable: true, get: getter }));
    expect(await h.api.get({ projectId })).toEqual(fail('OPERATION_FAILED')); expect(getter).not.toHaveBeenCalled();
    h.invoke.mockResolvedValueOnce({ ok: true, value: { ...value, classes: [{ ...editable, id: classId, schemaId,
      modelAlias: null, normalizedName: 'forged', createdAt: at, updatedAt: at }] } });
    expect(await h.api.get({ projectId })).toEqual(fail('OPERATION_FAILED'));
  });
  it('never rereads caller input after await and freezes only detached response copies', async () => {
    const h = harness(), pending = Promise.withResolvers<unknown>(), input = { projectId };
    h.invoke.mockReturnValueOnce(pending.promise);
    const response = h.api.get(input); input.projectId = otherId;
    pending.resolve({ ok: true, value });
    const result = await response; expect(result).toEqual({ ok: true, value });
    expect(Object.isFrozen(input)).toBe(false); expect(Object.isFrozen(value)).toBe(false);
    expect(Object.isFrozen(result)).toBe(true);
    if (result.ok && result.value) { expect(Object.isFrozen(result.value.classes)).toBe(true); expect(result.value).not.toBe(value); }
  });
  it('get preserves null without an implicit create', async () => {
    const h = harness(); h.invoke.mockResolvedValueOnce({ ok: true, value: null });
    expect(await h.api.get({ projectId })).toEqual({ ok: true, value: null });
    expect(h.invoke.mock.calls).toEqual([[c.LABEL_GET_CHANNEL, { projectId }]]);
  });
});