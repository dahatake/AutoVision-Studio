import { describe, expect, expectTypeOf, it } from 'vitest';

import * as ipc from './annotation-ipc.js';
import type { AnnotationItem, AnnotationProvenance, AnnotationWorkspace, LabelSchemaSnapshot } from './annotation.js';

const projectId = '11111111-1111-4111-8111-111111111111';
const workspaceId = '22222222-2222-4222-8222-222222222222';
const itemId = '33333333-3333-4333-8333-333333333333';
const schemaId = '44444444-4444-4444-8444-444444444444';
const classId = '55555555-5555-4555-8555-555555555555';
const at = '2026-09-13T00:00:00.000Z', hash = 'a'.repeat(64);
const context = { projectId, workspaceId, itemId };
const save: ipc.AnnotationSaveInput = { ...context, expectedEditVersion: 0, expectedAnnotationSha256: hash,
  expectedState: 'unstarted', expectedConfirmedAt: null, annotation: { kind: 'classification', classId: null },
  state: 'editing', exclusionReason: null };
const item: AnnotationItem = { id: itemId, workspaceId, importId: workspaceId, imageKey: 'opaque-key',
  imageSha256: hash, width: 10, height: 10, annotation: { kind: 'classification', classId: null },
  annotationSha256: hash, state: 'editing', negativeConfirmed: false, exclusionReason: null,
  editVersion: 1, confirmedAt: null, updatedAt: at };
const workspace: AnnotationWorkspace = { id: workspaceId, projectId, schemaId, taskType: 'classification',
  mode: 'copy', state: 'editing', editVersion: 0, createdAt: at, updatedAt: at };
const snapshot: LabelSchemaSnapshot = { id: schemaId, projectId, instructions: '', lockedAt: null,
  editVersion: 0, createdAt: at, updatedAt: at, classes: [{ id: classId, schemaId, displayName: 'Cat',
    normalizedName: 'cat', modelAlias: null, color: '#ffffff', description: '', examples: [], ordinal: 0,
    createdAt: at, updatedAt: at }] };
const ok = <T>(value: T) => ({ ok: true as const, value });
const detail = (overrides: Partial<AnnotationItem> = {}) => ok({ item: { ...item, ...overrides }, provenance: [] });
const manual = (targetKey: string): AnnotationProvenance => ({ itemId, targetKey, kind: 'manual',
  sourceImportId: null, sourceImageKey: null, sourceAnnotationKey: null, sourceSuggestionId: null, original: {}, changes: {} });
const rectangles = [
  { id: classId, classId, x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
  { id: schemaId, classId, x: 0.5, y: 0.5, width: 0.2, height: 0.2 },
];
const confirm: ipc.AnnotationConfirmInput = { ...context, expectedEditVersion: 0, expectedAnnotationSha256: hash,
  expectedState: 'editing', expectedConfirmedAt: null, negativeConfirmed: false };
const confirmed = (overrides: Partial<AnnotationItem> = {}, provenance = [manual('classification')]) => ok({
  item: { ...item, annotation: { kind: 'classification' as const, classId }, state: 'confirmed' as const,
    confirmedAt: at, ...overrides }, provenance,
});

describe('ANN-04/06 IPC leaf', () => {
  it('has exactly seven label and five annotation one-object methods', () => {
    expectTypeOf<keyof ipc.LabelSchemaApi>().toEqualTypeOf<'get' | 'create' | 'createClass' | 'updateClass' | 'update' | 'deleteClass' | 'mergeClasses'>();
    expectTypeOf<keyof ipc.AnnotationApi>().toEqualTypeOf<'workspaces' | 'list' | 'get' | 'save' | 'confirm'>();
    expectTypeOf<Parameters<ipc.AnnotationApi['workspaces']>>().toEqualTypeOf<[ipc.AnnotationWorkspacesInput]>();
    expectTypeOf<Parameters<ipc.AnnotationApi['list']>>().toEqualTypeOf<[ipc.AnnotationListInput]>();
    expectTypeOf<Parameters<ipc.AnnotationApi['get']>>().toEqualTypeOf<[ipc.AnnotationGetInput]>();
    expectTypeOf<Parameters<ipc.AnnotationApi['save']>>().toEqualTypeOf<[ipc.AnnotationSaveInput]>();
    expectTypeOf<Parameters<ipc.AnnotationApi['confirm']>>().toEqualTypeOf<[ipc.AnnotationConfirmInput]>();
    expectTypeOf<ReturnType<ipc.AnnotationApi['confirm']>>().toEqualTypeOf<Promise<ipc.AnnotationConfirmResponse>>();
    expectTypeOf<Parameters<typeof ipc.parseAnnotationConfirmResponse>>().toEqualTypeOf<[unknown, ipc.AnnotationConfirmInput]>();
    expectTypeOf<ReturnType<typeof ipc.parseAnnotationConfirmResponse>>().toEqualTypeOf<ipc.AnnotationConfirmResponse>();
    expectTypeOf<Parameters<ipc.LabelSchemaApi['get']>>().toEqualTypeOf<[ipc.LabelGetInput]>();
    expectTypeOf<Parameters<ipc.LabelSchemaApi['create']>>().toEqualTypeOf<[ipc.LabelCreateInput]>();
    expectTypeOf<Parameters<ipc.LabelSchemaApi['createClass']>>().toEqualTypeOf<[ipc.LabelCreateClassInput]>();
    expectTypeOf<Parameters<ipc.LabelSchemaApi['updateClass']>>().toEqualTypeOf<[ipc.LabelUpdateClassInput]>();
    expectTypeOf<Parameters<ipc.LabelSchemaApi['update']>>().toEqualTypeOf<[ipc.LabelUpdateInput]>();
    expectTypeOf<Parameters<ipc.LabelSchemaApi['deleteClass']>>().toEqualTypeOf<[ipc.LabelDeleteClassInput]>();
    expectTypeOf<Parameters<ipc.LabelSchemaApi['mergeClasses']>>().toEqualTypeOf<[ipc.LabelMergeClassesInput]>();
    expect([ipc.ANNOTATION_WORKSPACES_CHANNEL, ipc.ANNOTATION_LIST_CHANNEL, ipc.ANNOTATION_GET_CHANNEL, ipc.ANNOTATION_SAVE_CHANNEL, ipc.ANNOTATION_CONFIRM_CHANNEL])
      .toEqual(['annotation:workspaces', 'annotation:list', 'annotation:get', 'annotation:save', 'annotation:confirm']);
  });

  it('requires explicit strict confirmation assertions without annotation override authority', () => {
    expect(ipc.annotationConfirmInputSchema.safeParse(confirm).success).toBe(true);
    for (const key of Object.keys(confirm)) {
      const incomplete: Record<string, unknown> = { ...confirm }; delete incomplete[key];
      expect(ipc.annotationConfirmInputSchema.safeParse(incomplete).success).toBe(false);
    }
    for (const fields of [{ annotation: item.annotation }, { provenance: [] }, { state: 'confirmed' },
      { confirmedAt: at }, { exclusionReason: null }, { sourcePath: 'private' }, { negativeConfirmed: 'true' },
      { negativeConfirmed: null }, { expectedState: 'confirmed' }, { expectedConfirmedAt: at },
      { expectedAnnotationSha256: 'A'.repeat(64) }, { expectedAnnotationSha256: hash + '\n' },
      { expectedEditVersion: -1 }, { expectedEditVersion: 0.5 }, { expectedEditVersion: Number.MAX_SAFE_INTEGER + 1 }]) {
      expect(ipc.annotationConfirmInputSchema.safeParse({ ...confirm, ...fields }).success).toBe(false);
    }
  });

  it('accepts classification, nonempty detection and explicit unstarted negative confirmation', () => {
    const response = confirmed();
    const parsed = ipc.parseAnnotationConfirmResponse(response, confirm);
    expect(parsed).toEqual(response);
    expect(Object.isFrozen(response.value.item)).toBe(false);
    if (parsed.ok) {
      expect(Object.isFrozen(parsed.value.item.annotation)).toBe(true);
      expect(Object.isFrozen(parsed.value.provenance[0]!.original)).toBe(true);
    }
    expect(ipc.parseAnnotationConfirmResponse(confirmed({ annotation: { kind: 'detection', rectangles } },
      rectangles.map((rect) => manual(rect.id))), confirm).ok).toBe(true);
    const empty = confirmed({ annotation: { kind: 'detection', rectangles: [] }, negativeConfirmed: true }, []);
    expect(ipc.parseAnnotationConfirmResponse(empty, { ...confirm, expectedState: 'unstarted', negativeConfirmed: true }).ok).toBe(true);
    expect(ipc.annotationConfirmResponseSchema.safeParse(confirmed({ annotation: { kind: 'detection', rectangles: [] } }, [])).success).toBe(false);
    expect(ipc.annotationConfirmResponseSchema.safeParse(confirmed({ annotation: { kind: 'classification', classId: null } }, [])).success).toBe(false);
  });

  it('rejects uncorrelated confirmation versions, hashes, flags, states and timestamps', () => {
    for (const fields of [{ id: classId }, { workspaceId: classId }, { editVersion: 0 }, { editVersion: 2 },
      { annotationSha256: 'b'.repeat(64) }, { annotationSha256: 'bad' }, { negativeConfirmed: true },
      { state: 'editing' as const, confirmedAt: null }, { state: 'excluded' as const, confirmedAt: null },
      { confirmedAt: null }, { confirmedAt: 'invalid' }, { updatedAt: '2026-09-13T00:00:01.000Z' },
      { exclusionReason: 'why' }, { annotation: { kind: 'classification' as const, classId: schemaId }, annotationSha256: 'c'.repeat(64) }]) {
      expect(() => ipc.parseAnnotationConfirmResponse(confirmed(fields), confirm)).toThrow();
    }
    expect(() => ipc.parseAnnotationConfirmResponse(confirmed(), { ...confirm, negativeConfirmed: true })).toThrow();
    const negative = confirmed({ annotation: { kind: 'detection', rectangles: [] }, negativeConfirmed: true }, []);
    expect(() => ipc.parseAnnotationConfirmResponse(negative, confirm)).toThrow();
    expect(() => ipc.parseAnnotationConfirmResponse(confirmed({ editVersion: Number.MAX_SAFE_INTEGER }),
      { ...confirm, expectedEditVersion: Number.MAX_SAFE_INTEGER })).toThrow();
  });

  it('retains complete one-to-one confirmation provenance and imported source correlation', () => {
    for (const provenance of [[], [manual('classification'), manual('classification')], [manual(classId)],
      [{ ...manual('classification'), itemId: classId }]]) {
      expect(() => ipc.parseAnnotationConfirmResponse(confirmed({}, provenance), confirm)).toThrow();
    }
    const detection = { annotation: { kind: 'detection' as const, rectangles } };
    for (const provenance of [[manual(classId)], [manual(classId), manual(classId)],
      [manual(classId), manual(itemId)], [...rectangles.map((rect) => manual(rect.id)), manual(itemId)]]) {
      expect(() => ipc.parseAnnotationConfirmResponse(confirmed(detection, provenance), confirm)).toThrow();
    }
    const imported: AnnotationProvenance = { ...manual('classification'), kind: 'import-unmodified',
      sourceImportId: item.importId, sourceImageKey: item.imageKey, sourceAnnotationKey: 'row:1' };
    expect(ipc.parseAnnotationConfirmResponse(confirmed({}, [imported]), confirm).ok).toBe(true);
    for (const changed of [{ sourceImportId: projectId }, { sourceImageKey: 'foreign-key' }]) {
      expect(() => ipc.parseAnnotationConfirmResponse(confirmed({}, [{ ...imported, ...changed }]), confirm)).toThrow();
    }
  });

  it('propagates code-only failures including backend refusal of repeated or excluded confirmation', () => {
    for (const code of ipc.annotationIpcErrorCodeSchema.options) {
      const failure = { ok: false as const, error: { code } };
      expect(ipc.parseAnnotationConfirmResponse(failure, confirm)).toEqual(failure);
    }
    for (const request of [{ ...confirm, expectedState: 'confirmed' as const, expectedConfirmedAt: at },
      { ...confirm, expectedState: 'excluded' as const }]) {
      expect(ipc.annotationConfirmInputSchema.safeParse(request).success).toBe(true);
      const failure = { ok: false as const, error: { code: 'INVALID_REQUEST' as const } };
      expect(ipc.parseAnnotationConfirmResponse(failure, request)).toEqual(failure);
      expect(() => ipc.parseAnnotationConfirmResponse(confirmed(), request)).toThrow();
    }
    expect(() => ipc.parseAnnotationConfirmResponse({ ok: false, error: { code: 'NOT_FOUND', message: 'private' } }, confirm)).toThrow();
  });

  it('protects confirmation boundaries against inherited fields, getters, cycles and aliased DAGs', () => {
    let invoked = 0;
    const accessor = Object.defineProperty({ ...confirm }, 'negativeConfirmed', {
      enumerable: true, get: () => { invoked += 1; return false; },
    });
    const inherited: unknown = Object.create(confirm);
    const cycle: Record<string, unknown> = {}; cycle['self'] = cycle;
    let dag: object = {};
    for (let n = 0; n < 40; n += 1) dag = { left: dag, right: dag };
    for (const value of [accessor, inherited, { ...confirm, extra: cycle }, { ...confirm, extra: dag }]) {
      expect(ipc.annotationConfirmInputSchema.safeParse(value).success).toBe(false);
    }
    const response = confirmed();
    Object.defineProperty(response.value.item, 'confirmedAt', { enumerable: true, get: () => { invoked += 1; return at; } });
    expect(() => ipc.parseAnnotationConfirmResponse(response, confirm)).toThrow();
    const shared = {};
    expect(() => ipc.parseAnnotationConfirmResponse(confirmed({}, [{ ...manual('classification'), original: shared, changes: shared }]), confirm)).toThrow();
    expect(invoked).toBe(0);
    expect(Object.isFrozen(shared)).toBe(false);
    expect(Object.isFrozen(dag)).toBe(false);
    expect(Object.isFrozen(ipc.annotationConfirmInputSchema.parse(confirm))).toBe(true);
    expect(Object.isFrozen(confirm)).toBe(false);
  });

  it('accepts only strict flattened label commands', () => {
    const fields = { projectId, schemaId, expectedEditVersion: 0, displayName: 'Cat', color: '#ffffff', description: '', examples: [], ordinal: 0 };
    expect(ipc.labelGetInputSchema.safeParse({ projectId }).success).toBe(true);
    expect(ipc.labelCreateInputSchema.safeParse({ projectId }).success).toBe(true);
    expect(ipc.labelCreateClassInputSchema.safeParse(fields).success).toBe(true);
    expect(ipc.labelUpdateClassInputSchema.safeParse({ ...fields, id: classId, modelAlias: null }).success).toBe(true);
    expect(ipc.labelUpdateInputSchema.safeParse({ projectId, id: schemaId, expectedEditVersion: 0, instructions: '' }).success).toBe(true);
    expect(ipc.labelDeleteClassInputSchema.safeParse({ projectId, schemaId, classId, expectedEditVersion: 0 }).success).toBe(true);
    expect(ipc.labelMergeClassesInputSchema.safeParse({ projectId, schemaId, sourceId: classId, targetId: itemId, expectedEditVersion: 0 }).success).toBe(true);
    expect(ipc.labelMergeClassesInputSchema.safeParse({ projectId, schemaId, sourceId: classId, targetId: classId, expectedEditVersion: 0 }).success).toBe(false);
    for (const extra of [{ lockedAt: at }, { normalizedName: 'cat' }, { sourcePath: 'private' }, { id: classId }]) {
      expect(ipc.labelCreateClassInputSchema.safeParse({ ...fields, ...extra }).success).toBe(false);
    }
  });

  it.each([0, 201, -1, 1.5, Infinity, NaN])('rejects page limit %s', (limit) => {
    expect(ipc.annotationListInputSchema.safeParse({ projectId, workspaceId, offset: 0, limit }).success).toBe(false);
  });
  it('accepts paging bounds and rejects extra/path fields', () => {
    for (const limit of [1, 200]) expect(ipc.annotationListInputSchema.safeParse({ projectId, workspaceId, offset: 0, limit }).success).toBe(true);
    expect(ipc.annotationWorkspacesInputSchema.safeParse({ projectId, workspaceId }).success).toBe(false);
    expect(ipc.annotationGetInputSchema.safeParse({ ...context, sourcePath: 'private' }).success).toBe(false);
    expect(ipc.annotationListResponseSchema.safeParse(ok({ items: [{ ...item, sourcePath: 'private' }], total: 1 })).success).toBe(false);
    expect(ipc.annotationWorkspacesResponseSchema.safeParse(ok([{ ...workspace, sourcePath: 'private' }])).success).toBe(false);
  });

  it('requires paired state assertions and disallows confirmation authority', () => {
    expect(ipc.annotationSaveInputSchema.safeParse(save).success).toBe(true);
    for (const key of ['expectedState', 'expectedConfirmedAt', 'expectedAnnotationSha256', 'expectedEditVersion']) {
      const incomplete: Record<string, unknown> = { ...save }; delete incomplete[key];
      expect(ipc.annotationSaveInputSchema.safeParse(incomplete).success).toBe(false);
    }
    for (const fields of [{ state: 'confirmed' }, { confirmedAt: at }, { negativeConfirmed: true }, { provenance: [] },
      { expectedState: 'confirmed' }, { expectedConfirmedAt: at }, { exclusionReason: 'why' },
      { expectedAnnotationSha256: 'A'.repeat(64) }, { expectedAnnotationSha256: hash + '\n' }, { expectedEditVersion: Number.MAX_SAFE_INTEGER + 1 }]) {
      expect(ipc.annotationSaveInputSchema.safeParse({ ...save, ...fields }).success).toBe(false);
    }
    expect(ipc.annotationSaveInputSchema.safeParse({ ...save, expectedState: 'confirmed', expectedConfirmedAt: at, state: 'excluded', exclusionReason: 'blurred' }).success).toBe(true);
  });

  it('binds snapshots to project/schema and all class members', () => {
    expect(ipc.parseLabelGetResponse(ok(snapshot), { projectId }).ok).toBe(true);
    expect(ipc.parseLabelGetResponse(ok(null), { projectId }).ok).toBe(true);
    expect(() => ipc.parseLabelGetResponse(ok({ ...snapshot, projectId: workspaceId }), { projectId })).toThrow();
    expect(() => ipc.parseLabelUpdateResponse(ok(snapshot), { projectId, id: workspaceId, expectedEditVersion: 0, instructions: '' })).toThrow();
    expect(ipc.labelCreateResponseSchema.safeParse(ok({ ...snapshot, classes: [{ ...snapshot.classes[0], schemaId: workspaceId }] })).success).toBe(false);
  });

  it('correlates every workspace, list item and detail item', () => {
    expect(ipc.parseAnnotationWorkspacesResponse(ok([workspace]), { projectId }).ok).toBe(true);
    expect(() => ipc.parseAnnotationWorkspacesResponse(ok([{ ...workspace, projectId: itemId }]), { projectId })).toThrow();
    const page = { projectId, workspaceId, offset: 0, limit: 1 };
    expect(ipc.parseAnnotationListResponse(ok({ items: [item], total: 1 }), page).ok).toBe(true);
    expect(() => ipc.parseAnnotationListResponse(ok({ items: [{ ...item, workspaceId: projectId }], total: 1 }), page)).toThrow();
    expect(() => ipc.parseAnnotationListResponse(ok({ items: [item], total: 0 }), page)).toThrow();
    expect(() => ipc.parseAnnotationListResponse(ok({ items: [item], total: 1 }), { ...page, state: 'excluded' })).toThrow();
    expect(() => ipc.parseAnnotationGetResponse(detail({ id: classId }), context)).toThrow();
    expect(() => ipc.parseAnnotationGetResponse(detail({ workspaceId: classId }), context)).toThrow();
  });

  it('enforces exact save CAS increment and never restores confirmation', () => {
    expect(ipc.parseAnnotationSaveResponse(detail(), save).ok).toBe(true);
    // Hash syntax is checked, not recomputed in JS; Main owns content hashing.
    expect(ipc.parseAnnotationSaveResponse(detail({ annotationSha256: 'b'.repeat(64) }), save).ok).toBe(true);
    for (const fields of [{ editVersion: 0 }, { editVersion: 2 }, { state: 'excluded' as const },
      { confirmedAt: at }, { negativeConfirmed: true }, { annotationSha256: 'bad' }]) {
      expect(() => ipc.parseAnnotationSaveResponse(detail(fields), save)).toThrow();
    }
    expect(() => ipc.parseAnnotationSaveResponse(detail({ state: 'confirmed', confirmedAt: at, annotation: { kind: 'classification', classId } }), save)).toThrow();
    expect(() => ipc.parseAnnotationSaveResponse(detail({ editVersion: Number.MAX_SAFE_INTEGER }), { ...save, expectedEditVersion: Number.MAX_SAFE_INTEGER })).toThrow();
  });

  it('accepts the five read provenance kinds without granting write permission', () => {
    for (const kind of ['manual', 'import-unmodified', 'import-edited', 'model-accepted', 'model-edited'] as const) {
      const imported = kind.startsWith('import-'), model = kind.startsWith('model-');
      const provenance: AnnotationProvenance = { itemId, targetKey: 'classification', kind,
        sourceImportId: imported ? item.importId : null, sourceImageKey: imported ? item.imageKey : null,
        sourceAnnotationKey: imported ? 'row:1' : null, sourceSuggestionId: model ? classId : null, original: {}, changes: {} };
      const activeItem: AnnotationItem = { ...item, annotation: { kind: 'classification', classId } };
      expect(ipc.parseAnnotationGetResponse(ok({ item: activeItem, provenance: [provenance] }), context).ok).toBe(true);
      expect(() => ipc.parseAnnotationGetResponse(ok({ item: activeItem, provenance: [{ ...provenance, itemId: classId }] }), context)).toThrow();
    }
  });

  it('requires exactly the active classification provenance and accepts unlabeled Main details', () => {
    expect(ipc.parseAnnotationGetResponse(detail(), context).ok).toBe(true);
    expect(() => ipc.parseAnnotationGetResponse(detail({ annotation: { kind: 'classification', classId } }), context)).toThrow();
    expect(() => ipc.parseAnnotationGetResponse(ok({ item, provenance: [manual('classification')] }), context)).toThrow();
    expect(ipc.parseAnnotationGetResponse(detail({ annotation: { kind: 'detection', rectangles: [] } }), context).ok).toBe(true);
  });

  it('requires complete unique detection provenance without foreign targets or items', () => {
    const detectionItem: AnnotationItem = { ...item, annotation: { kind: 'detection', rectangles } };
    const provenance = rectangles.map((rect) => manual(rect.id));
    expect(ipc.parseAnnotationGetResponse(ok({ item: detectionItem, provenance }), context).ok).toBe(true);
    expect(ipc.parseAnnotationGetResponse(ok({ item: detectionItem, provenance: [...provenance].reverse() }), context).ok).toBe(true);
    for (const invalid of [[], [manual(classId)], [...provenance, manual(itemId)],
      [manual(classId), manual(classId)], [manual(classId), manual(itemId)],
      [manual(classId), { ...manual(schemaId), itemId: projectId }]]) {
      expect(() => ipc.parseAnnotationGetResponse(ok({ item: detectionItem, provenance: invalid }), context)).toThrow();
    }
  });

  it.each(['import-unmodified', 'import-edited'] as const)('correlates %s sources with the item', (kind) => {
    const activeItem: AnnotationItem = { ...item, annotation: { kind: 'classification', classId } };
    const provenance: AnnotationProvenance = { ...manual('classification'), kind,
      sourceImportId: item.importId, sourceImageKey: item.imageKey, sourceAnnotationKey: 'row:1' };
    expect(ipc.parseAnnotationGetResponse(ok({ item: activeItem, provenance: [provenance] }), context).ok).toBe(true);
    for (const changed of [{ sourceImportId: projectId }, { sourceImageKey: 'foreign-key' }]) {
      expect(() => ipc.parseAnnotationGetResponse(ok({ item: activeItem, provenance: [{ ...provenance, ...changed }] }), context)).toThrow();
    }
  });

  it('rejects a save response replacing the requested class with null or another class', () => {
    const request: ipc.AnnotationSaveInput = { ...save, annotation: { kind: 'classification', classId } };
    expect(() => ipc.parseAnnotationSaveResponse(detail(), request)).toThrow();
    const response = ok({ item: { ...item, annotation: { classId, kind: 'classification' as const } }, provenance: [manual('classification')] });
    expect(ipc.parseAnnotationSaveResponse(response, request).ok).toBe(true);
    expect(() => ipc.parseAnnotationSaveResponse(ok({ ...response.value,
      item: { ...item, annotation: { kind: 'classification', classId: schemaId } } }), request)).toThrow();
    expect(() => ipc.parseAnnotationSaveResponse(detail({ annotation: { kind: 'detection', rectangles: [] } }), save)).toThrow();
  });

  it('compares parsed detection fields and region order, not object key order', () => {
    const request: ipc.AnnotationSaveInput = { ...save, annotation: { kind: 'detection', rectangles } };
    const response = (regions: typeof rectangles) => ok({ item: { ...item, annotation: { kind: 'detection', rectangles: regions } },
      provenance: regions.map((rect) => manual(rect.id)) });
    expect(ipc.parseAnnotationSaveResponse(response(rectangles), request).ok).toBe(true);
    const reorderedKeys = rectangles.map((rect) => ({ height: rect.height, width: rect.width, y: rect.y, x: rect.x, classId: rect.classId, id: rect.id }));
    expect(ipc.parseAnnotationSaveResponse(response(reorderedKeys), request).ok).toBe(true);
    for (const changed of [{ id: itemId }, { classId: schemaId }, { x: 0.15 }, { y: 0.15 }, { width: 0.25 }, { height: 0.25 }]) {
      const altered = rectangles.map((rect, index) => index === 0 ? { ...rect, ...changed } : rect);
      expect(() => ipc.parseAnnotationSaveResponse(response(altered), request)).toThrow();
    }
    expect(() => ipc.parseAnnotationSaveResponse(response([...rectangles].reverse()), request)).toThrow();
    expect(() => ipc.parseAnnotationSaveResponse(response(rectangles.slice(0, 1)), request)).toThrow();
  });

  it('rejects forged JSON without invoking accessors or freezing callers', () => {
    let invoked = 0;
    const getter = Object.defineProperty({}, 'projectId', { enumerable: true, get: () => { invoked += 1; return projectId; } });
    const revoked = Proxy.revocable({}, {}); revoked.revoke();
    const cycle: Record<string, unknown> = {}; cycle['self'] = cycle;
    const hidden = Object.defineProperty({ projectId }, 'hidden', { value: true });
    const arrayAccessor = Object.defineProperty([], '0', { enumerable: true, get: () => { invoked += 1; return 'bad'; } });
    for (const value of [getter, revoked.proxy, cycle, hidden, new Date(), { projectId, toJSON() { invoked += 1; } },
      { projectId, [Symbol('x')]: 1 }, { projectId, extra: Array(1) }, { projectId, extra: arrayAccessor }]) {
      expect(() => ipc.labelGetInputSchema.safeParse(value)).not.toThrow();
      expect(ipc.labelGetInputSchema.safeParse(value).success).toBe(false);
    }
    expect(invoked).toBe(0);
    let dag: object = {};
    for (let n = 0; n < 40; n += 1) dag = { left: dag, right: dag };
    expect(ipc.labelGetInputSchema.safeParse({ projectId, extra: dag }).success).toBe(false);
    expect(Object.isFrozen(dag)).toBe(false);
    const source = structuredClone(snapshot);
    const parsed = ipc.parseLabelGetResponse(ok(source), { projectId });
    expect(Object.isFrozen(source)).toBe(false);
    expect(Object.isFrozen(source.classes[0]!.examples)).toBe(false);
    if (parsed.ok && parsed.value) {
      expect(Object.isFrozen(parsed.value.classes[0]!.examples)).toBe(true);
      expect(parsed.value).not.toBe(source);
    }
    const copied = ipc.annotationSaveInputSchema.parse(save);
    expect(Object.isFrozen(copied.annotation)).toBe(true);
    expect(Object.isFrozen(save.annotation)).toBe(false);
    const shared = {};
    const aliased = ok({ item, provenance: [{ itemId, targetKey: 'classification', kind: 'manual', sourceImportId: null,
      sourceImageKey: null, sourceAnnotationKey: null, sourceSuggestionId: null, original: shared, changes: shared }] });
    expect(() => ipc.annotationGetResponseSchema.safeParse(aliased)).not.toThrow();
    expect(ipc.annotationGetResponseSchema.safeParse(aliased).success).toBe(false);
    expect(Object.isFrozen(shared)).toBe(false);
  });

  it('uses code-only errors and UUID-only image URLs', () => {
    expect(ipc.annotationImageUrl(projectId, workspaceId, itemId)).toBe(`av-image://image/${projectId}/${workspaceId}/${itemId}`);
    for (const invalid of ['../image', '%31' + projectId.slice(1), projectId + '?x=1', 'file:///private', projectId + '\n', 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA']) {
      expect(() => ipc.annotationImageUrl(invalid, workspaceId, itemId)).toThrow();
      expect(() => ipc.annotationImageUrl(projectId, invalid, itemId)).toThrow();
      expect(() => ipc.annotationImageUrl(projectId, workspaceId, invalid)).toThrow();
    }
    for (const code of ['INVALID_REQUEST', 'NOT_FOUND', 'CONFLICT', 'LOCKED', 'CLASS_USED', 'HISTORY_REFERENCE', 'BUSY', 'OPERATION_FAILED']) {
      expect(ipc.annotationSaveResponseSchema.safeParse({ ok: false, error: { code } }).success).toBe(true);
    }
    for (const error of [new Error('private'), { code: 'SQLITE_BUSY' }, { code: 'NOT_FOUND', message: 'private' }, { code: 'NOT_FOUND', sourcePath: 'private' }]) {
      expect(ipc.annotationSaveResponseSchema.safeParse({ ok: false, error }).success).toBe(false);
    }
  });
});