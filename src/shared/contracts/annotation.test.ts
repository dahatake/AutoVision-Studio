import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import contractSource from './annotation.ts?raw';
import {
  type AnnotationJsonObject, type AnnotationProvenance,
  annotationIdSchema, annotationItemSchema, annotationProvenanceSchema, annotationRectangleSchema,
  annotationSchema, annotationStateSchema, annotationWorkspaceSchema, createLabelClassInputSchema,
  detectionAnnotationSchema, labelClassSchema, labelSchemaSchema, labelSchemaSnapshotSchema,
  normalizeLabelClassName, parseAnnotationItem, parseLabelSchema, updateLabelClassInputSchema,
  updateLabelSchemaInputSchema, validateAnnotationForSchema,
} from './annotation.js';

const id = 'ae45cf74-c9f9-4c49-88b9-0523b1ac7383';
const other = 'be45cf74-c9f9-4c49-88b9-0523b1ac7383';
const third = 'ce45cf74-c9f9-4c49-88b9-0523b1ac7383';
const time = '2026-09-12T00:00:00.000Z';
const timestamps = { createdAt: time, updatedAt: time };
const schema = { id, projectId: other, instructions: '画像端を確認', lockedAt: null, editVersion: 0, ...timestamps };
const label = {
  id: other, schemaId: id, displayName: '　Ｃａｔ 猫　', normalizedName: 'cat 猫', modelAlias: null,
  color: '#aabbcc', description: '説明', examples: ['正常例', '境界例'], ordinal: 0, ...timestamps,
};
const rectangle = { id: third, classId: other, x: 0, y: 0, width: 10, height: 20 };
const classification = { kind: 'classification', classId: null };
const detection = { kind: 'detection', rectangles: [] };
const item = {
  id, workspaceId: other, importId: third, imageKey: 'image-1', imageSha256: 'a'.repeat(64),
  width: 100, height: 80, annotation: classification, annotationSha256: 'b'.repeat(64),
  state: 'unstarted', negativeConfirmed: false, exclusionReason: null,
  editVersion: 0, confirmedAt: null, updatedAt: time,
};
const workspace = { id, projectId: other, schemaId: third, taskType: 'classification', mode: 'copy', state: 'editing', editVersion: 0, ...timestamps };
const provenance = {
  itemId: id, targetKey: 'classification', kind: 'manual', sourceImportId: null,
  sourceImageKey: null, sourceAnnotationKey: null, sourceSuggestionId: null, original: {}, changes: {},
};

describe('ANN-02 label contracts', () => {
  it('preserves display spelling and keeps model alias separate', () => {
    expect(labelClassSchema.parse(label)).toEqual(label);
    expect(labelClassSchema.parse({ ...label, modelAlias: 'cat' }).normalizedName).toBe('cat 猫');
    expect(parseLabelSchema(schema)).toEqual(schema);
  });
  it.each(['', ' ', '\u0085', '\u3000', '\ufeff', '\u00a0'])('rejects blank names %j', (displayName) => {
    expect(labelClassSchema.safeParse({ ...label, displayName, normalizedName: displayName }).success).toBe(false);
  });
  it('uses NFKC and Unicode trim with locale-independent lowercase, not transliteration', () => {
    expect(normalizeLabelClassName('\u0085ＣＡＴ\u3000')).toBe('cat');
    expect(normalizeLabelClassName('e\u0301')).toBe('é');
    expect(normalizeLabelClassName('Ⅳ')).toBe('iv');
    expect(normalizeLabelClassName('Straße')).not.toBe(normalizeLabelClassName('STRASSE'));
    expect(normalizeLabelClassName('é')).not.toBe(normalizeLabelClassName('e'));
    expect(normalizeLabelClassName('A  B')).toBe('a  b');
    expect(normalizeLabelClassName('İ')).toBe('i\u0307');
  });
  it.each([
    { normalizedName: 'forged' }, { modelAlias: '　' }, { color: '#AABBCC' }, { color: '#aabbcc\n' },
    { displayName: '\ud800' }, { description: '\0' }, { ordinal: -1 }, { ordinal: 0.5 },
    { examples: [{ imagePath: 'not-a-capability' }] }, { examples: ['あ'.repeat(22_000)] },
    { description: 'あ'.repeat(22_000) }, { createdAt: '2026-02-29T00:00:00Z' },
  ])('rejects invalid class fields %#', (change) => {
    expect(labelClassSchema.safeParse({ ...label, ...change }).success).toBe(false);
  });
  it('bounds Unicode by code points and checks normalized expansion', () => {
    const displayName = '😀'.repeat(256);
    expect(labelClassSchema.safeParse({ ...label, displayName, normalizedName: displayName }).success).toBe(true);
    expect(labelClassSchema.safeParse({ ...label, displayName: displayName + 'a', normalizedName: displayName + 'a' }).success).toBe(false);
    const expanded = 'ﬃ'.repeat(100);
    expect(labelClassSchema.safeParse({ ...label, displayName: expanded, normalizedName: normalizeLabelClassName(expanded) }).success).toBe(false);
  });
  it('requires unique identities, normalized names, ordinals and schema membership', () => {
    expect(labelSchemaSnapshotSchema.safeParse({ ...schema, classes: [label] }).success).toBe(true);
    for (const second of [
      { ...label, ordinal: 1, displayName: 'dog', normalizedName: 'dog' },
      { ...label, id: third, ordinal: 1, displayName: 'ＣＡＴ 猫', normalizedName: 'cat 猫' },
      { ...label, id: third, displayName: 'dog', normalizedName: 'dog' },
      { ...label, id: third, schemaId: third, ordinal: 1, displayName: 'dog', normalizedName: 'dog' },
    ]) expect(labelSchemaSnapshotSchema.safeParse({ ...schema, classes: [label, second] }).success).toBe(false);
  });
  it('does not accept normalizedName or authority fields in editable requests', () => {
    const input = { schemaId: id, expectedEditVersion: 0, displayName: label.displayName, color: label.color, description: '', examples: [], ordinal: 0 };
    expect(createLabelClassInputSchema.parse(input)).toEqual(input);
    expect(createLabelClassInputSchema.parse({ ...input, modelAlias: null }).modelAlias).toBeNull();
    expect(createLabelClassInputSchema.safeParse({ ...input, normalizedName: label.normalizedName }).success).toBe(false);
    expect(updateLabelClassInputSchema.safeParse({ ...input, id: other, modelAlias: null }).success).toBe(true);
    expect(updateLabelSchemaInputSchema.safeParse({ id, expectedEditVersion: 0, instructions: '' }).success).toBe(true);
    expect(updateLabelSchemaInputSchema.safeParse({ id, expectedEditVersion: 0, instructions: '', lockedAt: time }).success).toBe(false);
  });
  it.each(['create', 'update'] as const)('validates raw and normalized names for %s without changing spelling', (operation) => {
    const contract = operation === 'create' ? createLabelClassInputSchema : updateLabelClassInputSchema;
    const input = {
      schemaId: id, expectedEditVersion: 0, color: label.color, description: '', examples: [], ordinal: 0,
      modelAlias: null, ...(operation === 'update' ? { id: other } : {}),
    };
    for (const displayName of [
      'ﬃ'.repeat(85), 'ﬃ'.repeat(85) + 'a', '😀'.repeat(256), 'İ'.repeat(128),
      ' ' + 'a'.repeat(254) + ' ',
    ]) expect(contract.parse({ ...input, displayName }).displayName).toBe(displayName);
    for (const displayName of [
      'ﬃ'.repeat(100), 'ﬃ'.repeat(86), 'ﬃ'.repeat(85) + 'ab', '😀'.repeat(257), 'İ'.repeat(129),
      ' ' + 'a'.repeat(255) + ' ', 'e\u0301'.repeat(129),
      '', ' ', '\u0085', '\u3000', '\ufeff', '\u00a0', '\u0085\u3000\ufeff',
    ]) expect(contract.safeParse({ ...input, displayName }).success).toBe(false);
    for (const [displayName, normalizedName] of [
      ['\u0085　ＣＡＴ\u00a0', 'cat'], ['e\u0301', 'é'], ['　Ｉ İ Ａ　', 'i i\u0307 a'], ['A  B', 'a  b'],
    ] as const) {
      const parsed = contract.parse({ ...input, displayName });
      expect(parsed.displayName).toBe(displayName);
      expect(normalizeLabelClassName(parsed.displayName)).toBe(normalizedName);
      expect(labelClassSchema.safeParse({ ...label, displayName: parsed.displayName, normalizedName }).success).toBe(true);
    }
  });
  it.each([id.toUpperCase(), id + '\n', 'not-a-uuid'])('rejects noncanonical UUID %j', (value) => {
    expect(annotationIdSchema.safeParse(value).success).toBe(false);
  });
  it.each(['2026-02-30T00:00:00Z', '2026-13-01T00:00:00Z', '2026-01-01T25:00:00Z', 'yesterday'])('rejects invalid timestamps %s', (updatedAt) => {
    expect(labelSchemaSchema.safeParse({ ...schema, updatedAt }).success).toBe(false);
  });
});

describe('ANN-02 annotation content and state', () => {
  it.each(['unstarted', 'suggested', 'editing', 'confirmed', 'excluded'])('defines state %s', (state) => {
    expect(annotationStateSchema.parse(state)).toBe(state);
  });
  it('allows unlabeled drafts, not confirmed zero-class or multiple-class classification', () => {
    expect(parseAnnotationItem(item)).toEqual(item);
    expect(annotationItemSchema.safeParse({ ...item, state: 'confirmed', confirmedAt: time }).success).toBe(false);
    expect(annotationItemSchema.safeParse({ ...item, state: 'confirmed', confirmedAt: time, annotation: { ...classification, classId: other } }).success).toBe(true);
    expect(annotationSchema.safeParse({ kind: 'classification', classIds: [id, other] }).success).toBe(false);
  });
  it('distinguishes unstarted empty detection from explicitly confirmed negatives', () => {
    expect(annotationItemSchema.safeParse({ ...item, annotation: detection }).success).toBe(true);
    expect(annotationItemSchema.safeParse({ ...item, annotation: detection, state: 'confirmed', confirmedAt: time, negativeConfirmed: true }).success).toBe(true);
    for (const change of [
      { negativeConfirmed: true }, { state: 'confirmed', confirmedAt: time },
      { state: 'editing', confirmedAt: time }, { state: 'confirmed', negativeConfirmed: true },
      { state: 'confirmed', confirmedAt: time, negativeConfirmed: true, annotation: { kind: 'detection', rectangles: [rectangle] } },
    ]) expect(annotationItemSchema.safeParse({ ...item, annotation: detection, ...change }).success).toBe(false);
    expect(annotationItemSchema.safeParse({ ...item, state: 'confirmed', confirmedAt: time, negativeConfirmed: true, annotation: { ...classification, classId: other } }).success).toBe(false);
  });
  it('keeps optional exclusion reasons exclusive to excluded items', () => {
    expect(annotationItemSchema.safeParse({ ...item, exclusionReason: 'ぼけ' }).success).toBe(false);
    expect(annotationItemSchema.safeParse({ ...item, state: 'excluded', exclusionReason: 'ぼけ' }).success).toBe(true);
    expect(annotationItemSchema.safeParse({ ...item, state: 'excluded' }).success).toBe(true);
    expect(annotationItemSchema.safeParse({ ...item, state: 'excluded', exclusionReason: 'あ'.repeat(1366) }).success).toBe(false);
  });
  it.each([0, -1, 1.5, NaN, Infinity, 2_147_483_648])('rejects image dimension %s', (width) => {
    expect(annotationItemSchema.safeParse({ ...item, width }).success).toBe(false);
  });
  it.each([{ x: -1 }, { y: -1 }, { width: 0 }, { height: 0 }, { x: NaN }, { width: Infinity }, { height: -Infinity }, { id: 'box' }])('rejects invalid rectangle %#', (change) => {
    expect(annotationRectangleSchema.safeParse({ ...rectangle, ...change }).success).toBe(false);
  });
  it('rejects duplicate rectangles and subtraction-detected out-of-bounds without clamping', () => {
    expect(detectionAnnotationSchema.safeParse({ kind: 'detection', rectangles: [rectangle, rectangle] }).success).toBe(false);
    const annotation = { kind: 'detection', rectangles: [{ ...rectangle, x: 100, width: Number.MIN_VALUE }] };
    expect(100 + Number.MIN_VALUE).toBe(100);
    expect(annotationItemSchema.safeParse({ ...item, annotation }).success).toBe(false);
    expect(validateAnnotationForSchema(annotation, 100, 80, new Set([other]), false)).toContain('out-of-bounds');
  });
  it('does not interpret the 100-rectangle benchmark as a storage cap', () => {
    const rectangles = Array.from({ length: 101 }, (_, index) => ({ ...rectangle, id: `ae45cf74-c9f9-4c49-88b9-${String(index).padStart(12, '0')}` }));
    expect(annotationSchema.safeParse({ kind: 'detection', rectangles }).success).toBe(true);
    expect(annotationSchema.safeParse({ kind: 'detection', rectangles: Array.from({ length: 9_000 }, (_, index) => ({ ...rectangle, id: `ae45cf74-c9f9-4c49-88b9-${String(index).padStart(12, '0')}` })) }).success).toBe(false);
  });
  it('requires explicit known-schema context and validates prospective confirmed content', () => {
    const ids = new Set([other]);
    expect(validateAnnotationForSchema(classification, 100, 80, ids, false)).toEqual(['missing-class']);
    expect(validateAnnotationForSchema({ ...classification, classId: other }, 100, 80, ids, false)).toEqual([]);
    expect(validateAnnotationForSchema({ ...classification, classId: id }, 100, 80, ids, false)).toEqual(['unknown-class']);
    expect(validateAnnotationForSchema(detection, 100, 80, ids, true)).toEqual([]);
    expect(validateAnnotationForSchema(detection, 100, 80, ids, false)).toEqual(['invalid-negative-confirmation']);
    expect(validateAnnotationForSchema(detection, 0, 80, ids, true)).toEqual(['invalid-dimensions']);
    expect(validateAnnotationForSchema(detection, 100, 80, new Set(['invalid']), true)).toEqual(['invalid-class-ids']);
    expect(validateAnnotationForSchema({ kind: 'detection', rectangles: [{ ...rectangle, classId: id }] }, 100, 80, ids, false)).toEqual(['unknown-class']);
  });
  it('uses Project task vocabulary and SQL workspace fields without inferred relationships', () => {
    expect(annotationWorkspaceSchema.parse(workspace)).toEqual(workspace);
    expect(annotationWorkspaceSchema.safeParse({ ...workspace, taskType: 'detection', mode: 'reference', state: 'frozen' }).success).toBe(true);
    for (const change of [{ taskType: 'segmentation' }, { state: 'confirmed' }, { mode: 'cloud' }, { editVersion: -1 }]) {
      expect(annotationWorkspaceSchema.safeParse({ ...workspace, ...change }).success).toBe(false);
    }
  });
});

describe('ANN-02 provenance and hostile DTOs', () => {
  it('infers original and changes as JSON objects after runtime validation', () => {
    const parsed = annotationProvenanceSchema.parse(provenance);
    expectTypeOf(parsed.original).toEqualTypeOf<AnnotationJsonObject>();
    expectTypeOf(parsed.changes).toEqualTypeOf<AnnotationJsonObject>();
    expectTypeOf<AnnotationProvenance['original']>().toEqualTypeOf<AnnotationJsonObject>();
    expectTypeOf<AnnotationProvenance['changes']>().toEqualTypeOf<AnnotationJsonObject>();
    expect(parsed.original).toEqual({});
    expect(parsed.changes).toEqual({});
  });
  it('keeps the production shared contract free of Main, Node and dynamic imports', () => {
    const imports = [...contractSource.matchAll(/^import\s[\s\S]*?from\s+['"]([^'"]+)['"]/gmu)].map((match) => match[1]);
    expect(imports).toEqual(['zod', './project.js']);
    expect(contractSource).not.toMatch(/\b(?:import|require)\s*\(/u);
    expect(contractSource).not.toMatch(/\bexport\s[^;]*\bfrom\s/u);
  });
  it.each(['manual', 'import-unmodified', 'import-edited', 'model-accepted', 'model-edited'])('validates %s source vocabulary without authorizing SQL writes', (kind) => {
    const sources = kind.startsWith('import-') ? { sourceImportId: third, sourceImageKey: 'image-1', sourceAnnotationKey: '42' }
      : kind.startsWith('model-') ? { sourceSuggestionId: other } : {};
    expect(annotationProvenanceSchema.safeParse({ ...provenance, kind, ...sources }).success).toBe(true);
    if (kind !== 'manual') expect(annotationProvenanceSchema.safeParse({ ...provenance, kind }).success).toBe(false);
  });
  it.each([
    { sourceImportId: third }, { sourceSuggestionId: other }, { sourceImageKey: 'image-1' },
    { kind: 'import-edited', sourceImportId: third, sourceAnnotationKey: '42' },
    { kind: 'model-accepted', sourceSuggestionId: 'not-a-uuid' },
    { kind: 'model-edited', sourceSuggestionId: other, sourceAnnotationKey: '42' },
    { targetKey: 'unknown-target' }, { original: [] }, { changes: { bad: Infinity } },
    { original: { text: 'a'.repeat(1_048_576) } },
  ])('rejects malformed provenance %#', (change) => {
    expect(annotationProvenanceSchema.safeParse({ ...provenance, ...change }).success).toBe(false);
  });
  it('does not execute root or deeply nested getters, including unknown fields', () => {
    const getter = vi.fn(() => { throw new Error('must not execute'); });
    const nested = Object.defineProperty({}, 'value', { enumerable: true, get: getter });
    const root = Object.defineProperty({ ...item }, 'annotation', { enumerable: true, get: getter });
    expect(annotationItemSchema.safeParse(root).success).toBe(false);
    expect(annotationProvenanceSchema.safeParse({ ...provenance, original: { nested: [nested] } }).success).toBe(false);
    expect(labelSchemaSchema.safeParse(Object.defineProperty({ ...schema }, 'extra', { get: getter })).success).toBe(false);
    expect(getter).not.toHaveBeenCalled();
  });
  it('rejects cycles, sparse arrays, symbols, exotic objects and undefined recursively', () => {
    const cyclic: Record<string, unknown> = {}; cyclic['self'] = cyclic;
    const symbolObject = { [Symbol('secret')]: true };
    const hidden = Object.defineProperty({}, 'hidden', { value: true });
    const accessorArray = Object.defineProperty([1], '0', { get: () => { throw new Error('must not execute'); } });
    for (const value of [cyclic, symbolObject, hidden, new Date(), new Map(), new Uint8Array(1), Array(1), accessorArray,
      { nested: undefined }, { nested: 1n }, { nested: () => 1 }, JSON.parse('{"__proto__":{}}') as unknown]) {
      expect(annotationProvenanceSchema.safeParse({ ...provenance, original: { value } }).success).toBe(false);
    }
  });
  it('accepts detached JSON trees with equal distinct objects and repeated primitives without mutating input', () => {
    const child = { caption: '猫😀', value: [1, null, true] };
    const original = { left: child, right: { caption: '猫😀', value: [1, null, true] } };
    const parsed = annotationProvenanceSchema.parse({ ...provenance, original });
    expect(original.left).not.toBe(original.right);
    expect(original.left.caption).toBe(original.right.caption);
    expect(child.caption).toBe('猫😀');
    child.caption = 'changed';
    expect(parsed.original).toEqual({ left: { caption: '猫😀', value: [1, null, true] }, right: { caption: '猫😀', value: [1, null, true] } });
    expect(labelSchemaSchema.safeParse(Object.assign(Object.create(null) as object, schema)).success).toBe(true);
  });
  it('rejects shared object and array aliases within provenance and across original and changes', () => {
    for (const shared of [{ caption: '猫😀' }, [1, null, true]]) {
      expect(annotationProvenanceSchema.safeParse({ ...provenance, original: { left: shared, right: shared } }).success).toBe(false);
      expect(annotationProvenanceSchema.safeParse({ ...provenance, original: { value: shared }, changes: { value: shared } }).success).toBe(false);
    }
    const shared = { caption: '猫😀' };
    expect(annotationProvenanceSchema.safeParse({ ...provenance, original: shared, changes: shared }).success).toBe(false);
    expect(annotationProvenanceSchema.safeParse({ ...provenance, original: { ...shared }, changes: { ...shared } }).success).toBe(true);
  });
  it.each([20, 32])('rejects a depth-%i shared DAG in an unknown field with linear descriptor visits', (depth) => {
    let dag: object = { caption: '猫😀' };
    const nodes = new WeakSet<object>([dag]);
    for (let index = 0; index < depth; index += 1) {
      dag = { left: dag, right: dag };
      nodes.add(dag);
    }
    const descriptorLimit = 2 * depth + 1;
    let descriptorVisits = 0;
    const getDescriptor = Object.getOwnPropertyDescriptor;
    const spy = vi.spyOn(Object, 'getOwnPropertyDescriptor').mockImplementation((value, key) => {
      if (nodes.has(value)) {
        descriptorVisits += 1;
        // Bound even a regressed traversal; the count assertion must still fail.
        if (descriptorVisits > descriptorLimit) throw new Error('DAG descriptor budget exceeded');
      }
      return getDescriptor(value, key);
    });
    try {
      expect(labelSchemaSchema.safeParse({ ...schema, unexpected: dag }).success).toBe(false);
      expect(descriptorVisits).toBe(descriptorLimit);
    } finally {
      spy.mockRestore();
    }
  });
  it('rejects deep unsafe input before reading properties without recursive traversal failure', () => {
    const getter = vi.fn(() => 1);
    let nested: object = Object.defineProperty({}, 'bad', { enumerable: true, get: getter });
    for (let index = 0; index < 12_000; index += 1) nested = { nested };
    expect(annotationProvenanceSchema.safeParse({ ...provenance, original: nested }).success).toBe(false);
    expect(getter).not.toHaveBeenCalled();
  });
  it('rejects unknown fields at each domain boundary and redacts parser errors', () => {
    for (const [contract, value] of [
      [labelSchemaSchema, schema], [labelClassSchema, label], [annotationItemSchema, item],
      [annotationWorkspaceSchema, workspace], [annotationProvenanceSchema, provenance],
      [annotationRectangleSchema, rectangle], [annotationSchema, classification],
    ] as const) expect(contract.safeParse({ ...value, unexpected: true }).success).toBe(false);
    expect(annotationItemSchema.safeParse({ ...item, annotation: { ...classification, score: 0.99 } }).success).toBe(false);
    expect(() => parseAnnotationItem({ ...item, secretPath: 'private' })).toThrow(/^Invalid annotation contract$/);
    expect(() => parseLabelSchema(null)).toThrow(/^Invalid annotation contract$/);
  });
});