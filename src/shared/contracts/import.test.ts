import { describe, expect, it } from 'vitest';

import {
  MAX_ANNOTATION_BYTES, MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS, MAX_INPUT_ITEMS, MAX_SCAN_RESULT_BYTES,
  decodeScanResult, decodeSelectionManifest, parseScanPayload, parseScanResult, parseSelectionManifest,
  scanPayloadSchema, scanResultSchema, selectionManifestSchema,
} from './import.js';
import type { ScanBox, ScanContext, ScanImage, ScanResult } from './import.js';
import { MAX_WORKER_MESSAGE_BYTES, encodeWorkerRequest, parseWorkerRequest } from './worker.js';
import type { JsonObject } from './worker.js';

// Mirrored fixture values/case IDs in ml/tests/test_scan_dataset_contract.py.
// Synthetic DTOs, not evidence of image decoding, hashing, I/O or a working CLI.
const jobId = 'ae45cf74-c9f9-4c49-88b9-0523b1ac7383';
const projectId = '01234567-89ab-4cde-8f01-23456789abcd';
const expected: ScanContext = { jobId, projectId, taskType: 'classification', mode: 'copy' };
const root = 'C:\\画像';
const file = root + '\\a.png';
const invalid = /^Invalid import contract$/u;
const manifestJson = '{"formatVersion":1,"files":["C:\\\\画像\\\\a.png","C:\\\\画像\\\\A.png","C:\\\\画像\\\\a.png"]}';
const unlabeled = { format: 'unlabeled', selection: 'directory', root };

function image(changes: Partial<ScanImage> = {}): ScanImage {
  return {
    key: 'image:0', sourcePath: file, byteSize: 1234, mtimeNs: '1750000000123456789',
    sha256: 'a'.repeat(64), format: 'png', width: 640, height: 480, orientation: 1,
    duplicateOf: null, annotation: null, ...changes,
  };
}

function result(changes: Partial<ScanResult> = {}): ScanResult {
  return { formatVersion: 1, ...expected, classes: [], images: [image()], issues: [], ...changes };
}

function box(changes: Partial<ScanBox> = {}): ScanBox {
  return { classKey: 'crop', bbox: [0.25, 2.5, 100.125, 40.5], sourceAnnotationId: '19', ...changes };
}

function detection(changes: Partial<ScanResult> = {}): ScanResult {
  return result({
    taskType: 'detection', classes: [{ key: 'crop', name: '健康🌱', sourceCategoryId: '7' }],
    images: [image({ annotation: { type: 'detection', sourceImageId: '11', boxes: [box()] } })], ...changes,
  });
}

const sources: Array<[string, Record<string, unknown>, string[]]> = [
  ['unlabeled-directory', unlabeled, ['classification', 'detection']],
  ['unlabeled-files', { format: 'unlabeled', selection: 'files', selectionManifestPath: 'C:\\staging\\selection.json' }, ['classification', 'detection']],
  ['folder', { format: 'folder', root }, ['classification']],
  ['csv', { format: 'csv', root, annotationPath: 'C:\\labels.csv' }, ['classification']],
  ['coco', { format: 'coco', root, annotationPath: 'C:\\labels.json' }, ['detection']],
];
const paths: Array<[string, string, boolean]> = [
  ['drive-root', 'C:\\', true], ['unicode', 'C:\\日本語🌱\\a.png', true],
  ['forward-slash', 'c:/data/a.png', true], ['unc-share', '\\\\server\\share', true],
  ['unc-file', '//server/share/images/a.png', true],
  ['empty', '', false], ['blank', ' ', false], ['relative', 'images/a.png', false],
  ['drive-relative', 'C:a.png', false], ['posix', '/images/a.png', false],
  ['rooted', '\\images\\a.png', false], ['file-uri', 'file:///C:/a.png', false],
  ['url', 'https://example.invalid/a.png', false], ['nul', 'C:\\a\0.png', false],
  ['extended-device', '\\\\?\\C:\\images', false], ['pipe-device', '\\\\.\\pipe\\x', false],
  ['nt-device', '\\??\\C:\\images', false], ['unc-no-share', '\\\\server', false],
  ['unc-empty-share', '\\\\server\\', false], ['parent', 'C:\\a\\..\\b', false],
  ['dot', 'C:\\a\\.\\b', false], ['empty-segment', 'C:\\a\\\\b', false],
  ['dos-device', 'C:\\NUL.jpg', false], ['ads', 'C:\\a.png:stream', false],
  ['trailing-dot', 'C:\\a.', false], ['trailing-space', 'C:\\a ', false],
  ['control', 'C:\\a\nb', false],
];
const badPayloads: Array<[string, unknown]> = [
  ['null', null], ['array', []],
  ['missing-mode', { taskType: 'classification', source: unlabeled }],
  ['bad-mode', { taskType: 'classification', mode: 'auto', source: unlabeled }],
  ['bad-task', { taskType: 'segmentation', mode: 'copy', source: unlabeled }],
  ['extra', { taskType: 'classification', mode: 'copy', source: unlabeled, limits: {} }],
  ['rootPath-alias', { taskType: 'classification', mode: 'copy', source: { format: 'folder', rootPath: root } }],
  ['missing-selection', { taskType: 'classification', mode: 'copy', source: { format: 'unlabeled', root } }],
  ['both-selections', { taskType: 'classification', mode: 'copy', source: { ...unlabeled, selectionManifestPath: file } }],
  ['inline-files', { taskType: 'classification', mode: 'copy', source: { format: 'unlabeled', selection: 'files', files: [file] } }],
  ['files-with-root', { taskType: 'classification', mode: 'copy', source: { format: 'unlabeled', selection: 'files', root, selectionManifestPath: file } }],
  ['bad-format', { taskType: 'classification', mode: 'copy', source: { format: 'zip', root } }],
];

describe('DAT-01a payload and selection manifest', () => {
  it.each(sources)('matches source/task/mode matrix: %s', (_case, source, tasks) => {
    for (const taskType of ['classification', 'detection']) {
      for (const mode of ['copy', 'reference']) {
        const candidate = { taskType, mode, source };
        expect(scanPayloadSchema.safeParse(candidate).success).toBe(tasks.includes(taskType));
        if (!tasks.includes(taskType)) {
          expect(() => parseScanPayload(candidate)).toThrow(invalid);
          continue;
        }
        const parsed = parseScanPayload(candidate);
        // Compile-time proof: no casts or widening of the shared renderer boundary.
        const payload: JsonObject = parsed;
        const wire = encodeWorkerRequest({ schemaVersion: 1, jobId, projectId, kind: 'scan-dataset', payload });
        expect(parseScanPayload(parseWorkerRequest(wire).payload)).toEqual(candidate);
        expect(parsed).toEqual(candidate);
      }
    }
  });
  it.each(badPayloads)('rejects payload case %s without coercion/defaults', (_case, candidate) => {
    expect(() => parseScanPayload(candidate)).toThrow(invalid);
  });
  it.each(paths)('checks all absolute path positions structurally: %s', (_case, path, accepted) => {
    const candidates = [
      { taskType: 'classification', mode: 'copy', source: { ...unlabeled, root: path } },
      { taskType: 'classification', mode: 'reference', source: { format: 'csv', root, annotationPath: path } },
      { taskType: 'detection', mode: 'copy', source: { format: 'unlabeled', selection: 'files', selectionManifestPath: path } },
    ];
    for (const candidate of candidates) expect(scanPayloadSchema.safeParse(candidate).success).toBe(accepted);
    expect(selectionManifestSchema.safeParse({ formatVersion: 1, files: [path] }).success).toBe(accepted);
    expect(scanResultSchema.safeParse(result({ images: [image({ sourcePath: path })] })).success).toBe(accepted);
  });
  it('preserves selection spelling/order/duplicates and returns separate arrays', () => {
    const value = { formatVersion: 1, files: [file, root + '\\A.png', file] };
    const parsed = parseSelectionManifest(value);
    expect(parsed).toEqual(value);
    expect(parsed.files).not.toBe(value.files);
    expect(decodeSelectionManifest(manifestJson)).toEqual(parsed);
    expect(decodeSelectionManifest(new TextEncoder().encode(manifestJson))).toEqual(parsed);
  });
  it('bounds selections before deduplication, with no silent truncation', () => {
    expect(parseSelectionManifest({ formatVersion: 1, files: Array<string>(MAX_INPUT_ITEMS).fill(file) }).files).toHaveLength(MAX_INPUT_ITEMS);
    for (const value of [
      { formatVersion: 1, files: [] }, { formatVersion: 1, files: Array<string>(MAX_INPUT_ITEMS + 1).fill(file) },
      { formatVersion: true, files: [file] }, { formatVersion: 2, files: [file] },
      { files: [file] }, { formatVersion: 1, files: [file], root }, { formatVersion: 1, files: 'not-an-array' },
    ]) expect(() => parseSelectionManifest(value)).toThrow(invalid);
  });
  it('leaves duplicate payload-member rejection to the existing envelope codec', () => {
    const wire = encodeWorkerRequest({ schemaVersion: 1, jobId, projectId, kind: 'scan-dataset', payload: { taskType: 'classification', mode: 'copy', source: unlabeled } });
    expect(() => parseWorkerRequest(wire.replace('"mode":"copy"', '"mode":"reference","\\u006dode":"copy"'))).toThrow();
  });
  it('adversarial fixed keys rejects own __proto__ in scan payload roots and sources', () => {
    for (const [name, source, tasks] of sources) {
      const value = { taskType: tasks[0], mode: 'copy', source };
      expect(scanPayloadSchema.safeParse(value).success, name).toBe(true);
      expect(parseScanPayload(value), name).toEqual(value);
      const original = JSON.stringify(value);
      for (const position of ['root', 'source'] as const) {
        const prefix = position === 'root' ? '{' : '"source":{';
        // JSON.parse creates an own key; an object-literal __proto__ would not.
        const candidate = JSON.parse(original.replace(prefix, `${prefix}"__proto__":null,`));
        const target = position === 'root' ? candidate : candidate.source;
        const label = `${name}/${position}`;
        expect(Object.hasOwn(target, '__proto__'), label).toBe(true);
        expect(target['__proto__'], label).toBeNull();
        expect.soft(scanPayloadSchema.safeParse(candidate).success, label).toBe(false);
        expect.soft(() => parseScanPayload(candidate), label).toThrow(invalid);
      }
    }
  });
  it('adversarial fixed keys rejects own __proto__ at the selection manifest root', () => {
    const wire = '{"__proto__":null,' + manifestJson.slice(1);
    const candidate = JSON.parse(wire);
    expect(Object.hasOwn(candidate, '__proto__')).toBe(true);
    expect(candidate['__proto__']).toBeNull();
    expect.soft(selectionManifestSchema.safeParse(candidate).success).toBe(false);
    expect.soft(() => parseSelectionManifest(candidate)).toThrow(invalid);
    for (const input of [wire, new TextEncoder().encode(wire)]) {
      expect.soft(() => decodeSelectionManifest(input)).toThrow(invalid);
    }
  });
});

describe('DAT-01a scan result', () => {
  it('preserves unmodified COCO IDs/coordinates, Unicode and pre-EXIF dimensions', () => {
    const value = detection({ images: [image({ orientation: 6, annotation: { type: 'detection', sourceImageId: '11', boxes: [box()] } })] });
    const before = JSON.stringify(value);
    const context: ScanContext = { ...expected, taskType: 'detection' };
    expect(parseScanResult(value, context)).toEqual(value);
    expect(decodeScanResult(before, context)).toEqual(value);
    expect(JSON.stringify(value)).toBe(before);
    expect(value.images[0]).not.toHaveProperty('confirmed');
  });
  it('accepts one classification label and distinguishes unlabeled from empty detection', () => {
    const classified = result({
      classes: [{ key: 'constructor', name: '  健康🌱  ', sourceCategoryId: null }],
      images: [image({ annotation: { type: 'classification', classKey: 'constructor', sourceRow: 2 } })],
    });
    expect(parseScanResult(classified)).toEqual(classified);
    expect(parseScanResult(result()).classes).toEqual([]);
    const negative = detection({ images: [image({ annotation: { type: 'detection', sourceImageId: '11', boxes: [] } })] });
    expect(parseScanResult(negative)).toEqual(negative);
    expect(parseScanResult(result({ taskType: 'detection' })).images[0].annotation).toBeNull();
  });
  it('retains failed-image repair context without fake metadata or empty success', () => {
    const failure = { severity: 'error' as const, code: 'IMAGE_READ_FAILED', target: { imageKey: 'failed:1', sourcePath: root + '\\broken.png', row: null, itemId: null } };
    const value = result({ issues: [failure] });
    expect(parseScanResult(value)).toEqual(value);
    expect(() => parseScanResult(result({ images: [], issues: [failure] }))).toThrow(invalid);
    for (const field of ['byteSize', 'sha256', 'width', 'height']) {
      expect(() => parseScanResult({ ...value, images: [{ ...image(), [field]: null }] })).toThrow(invalid);
    }
    const invalidAnnotation = { severity: 'error' as const, code: 'ANNOTATION_PATH_INVALID', target: { imageKey: null, sourcePath: '../outside.png', row: 4, itemId: 'bad-id' } };
    expect(parseScanResult(result({ issues: [invalidAnnotation] })).issues).toEqual([invalidAnnotation]);
  });
  it('enforces metadata boundaries without treating booleans as numbers', () => {
    expect(parseScanResult(result({ images: [image({ byteSize: MAX_IMAGE_BYTES, width: 8000, height: 5000 })] }))).toBeDefined();
    const badNumbers = [true, false, -1, 0, 0.5, NaN, Infinity, -Infinity, 9007199254740992];
    for (const field of ['byteSize', 'width', 'height', 'orientation']) {
      for (const value of badNumbers) {
        expect(() => parseScanResult({ ...result(), images: [{ ...image(), [field]: value }] })).toThrow(invalid);
      }
    }
    for (const fields of [{ byteSize: MAX_IMAGE_BYTES + 1 }, { width: 8000, height: 5001 }, { orientation: 9 }]) {
      expect(() => parseScanResult({ ...result(), images: [{ ...image(), ...fields }] })).toThrow(invalid);
    }
    for (const format of ['jpeg', 'png', 'webp', 'bmp', 'tiff'] as const) {
      for (const orientation of [1, 2, 3, 4, 5, 6, 7, 8] as const) {
        expect(parseScanResult(result({ images: [image({ format, orientation })] })).images[0].format).toBe(format);
      }
    }
    expect(() => parseScanResult(result({ images: Array<ScanImage>(MAX_INPUT_ITEMS + 1).fill(image()) }))).toThrow(invalid);
  });
  it('preserves canonical decimal nanosecond timestamps without numeric conversion', () => {
    for (const mtimeNs of ['0', '-1', '1750000000123456789', '999999999999999999999999999999']) {
      expect(parseScanResult(result({ images: [image({ mtimeNs })] })).images[0].mtimeNs).toBe(mtimeNs);
    }
    for (const mtimeNs of ['', '01', '-0', '+1', '1e9', '1.0', ' 1', '1\n', '١', 1750000000123456789]) {
      expect(() => parseScanResult({ ...result(), images: [{ ...image(), mtimeNs }] })).toThrow(invalid);
    }
  });
  it('rejects duplicate/dangling local, category, image and annotation references', () => {
    const malformed: unknown[] = [
      result({ images: [image(), image()] }),
      result({ classes: [{ key: 'crop', name: 'a', sourceCategoryId: null }, { key: 'crop', name: 'b', sourceCategoryId: null }] }),
      detection({ classes: [{ key: 'crop', name: 'a', sourceCategoryId: '7' }, { key: 'other', name: 'b', sourceCategoryId: '7' }] }),
      result({ images: [image({ annotation: { type: 'classification', classKey: 'missing', sourceRow: null } })] }),
      detection({ images: [image({ annotation: { type: 'detection', sourceImageId: '11', boxes: [box({ classKey: 'missing' })] } })] }),
      result({ images: detection().images }),
      detection({ images: [image({ annotation: { type: 'detection', sourceImageId: '11', boxes: [box(), box()] } })] }),
      detection({ images: [image({ key: 'a', annotation: { type: 'detection', sourceImageId: '11', boxes: [] } }), image({ key: 'b', annotation: { type: 'detection', sourceImageId: '11', boxes: [] } })] }),
      detection({ images: [image({ key: 'a', annotation: { type: 'detection', sourceImageId: '11', boxes: [box()] } }), image({ key: 'b', annotation: { type: 'detection', sourceImageId: '12', boxes: [box()] } })] }),
      detection({ classes: [{ key: 'crop', name: 'a', sourceCategoryId: null }] }),
      result({ classes: [{ key: 'crop', name: 'a', sourceCategoryId: '7' }] }),
    ];
    for (const candidate of malformed) expect(() => parseScanResult(candidate)).toThrow(invalid);
    for (const duplicateOf of ['missing', 'image:0']) {
      expect(() => parseScanResult(result({ images: [image({ duplicateOf })] }))).toThrow(invalid);
    }
    const primary = image();
    const duplicate = image({ key: 'image:1', sourcePath: root + '\\copy.png', duplicateOf: primary.key });
    expect(parseScanResult(result({ images: [duplicate, primary] })).images).toEqual([duplicate, primary]);
    expect(() => parseScanResult(result({ images: [primary, { ...duplicate, sha256: 'b'.repeat(64) }] }))).toThrow(invalid);
    expect(() => parseScanResult(result({ images: [{ ...primary, duplicateOf: duplicate.key }, duplicate] }))).toThrow(invalid);
    expect(() => parseScanResult(result({ images: [primary, duplicate, image({ key: 'image:2', duplicateOf: duplicate.key })] }))).toThrow(invalid);
  });
  it('rejects invalid boxes without clamping or coercion', () => {
    const boxes: unknown[] = [
      [-1, 0, 2, 2], [0, 0, 0, 2], [0, 0, 2, -1], [639, 0, 2, 2], [0, 479, 2, 2],
      [640, 0, 1e-20, 1], // Right boundary: positive tiny width, zero overlap.
      [0, 480, 1, 1e-20], // Bottom boundary: positive tiny height, zero overlap.
      [1e-20, 0, 640, 1], // Tiny offset with full width.
      [0, 1e-20, 1, 480], // Tiny offset with full height.
      [0, 0, 1], [0, 0, 1, 1, 1],
    ];
    for (const bad of [true, false, NaN, Infinity, -Infinity, '1', 9007199254740992]) {
      for (let index = 0; index < 4; index += 1) boxes.push([0, 0, 1, 1].map((value, position) => position === index ? bad : value));
    }
    for (const bbox of boxes) {
      const candidate = { ...detection(), images: [{ ...image(), annotation: { type: 'detection', sourceImageId: '11', boxes: [{ ...box(), bbox }] } }] };
      expect(() => parseScanResult(candidate)).toThrow(invalid);
    }
    const validBoxes: ScanBox['bbox'][] = [[0, 0, 640, 480], [639, 0, 1e-20, 1], [0, 479, 1, 1e-20]];
    for (const bbox of validBoxes) {
      const candidate = detection({ images: [image({ annotation: { type: 'detection', sourceImageId: '11', boxes: [box({ bbox })] } })] });
      const before = JSON.stringify(candidate);
      expect(parseScanResult(candidate)).toEqual(candidate);
      expect(JSON.stringify(candidate)).toBe(before);
    }
  });
  it('rejects unknown fields and invalid strings at nested boundaries', () => {
    const classified = { type: 'classification', classKey: 'crop', sourceRow: null };
    const cases: unknown[] = [
      { ...result(), confirmed: true }, { ...result(), formatVersion: true }, { ...result(), formatVersion: 2 },
      { ...result(), images: [{ ...image(), confirmed: true }] },
      { ...result(), classes: [{ key: 'crop', name: 'ok', sourceCategoryId: null, extra: 1 }] },
      { ...result(), images: [{ ...image(), annotation: { ...classified, classKeys: ['crop'] } }] },
      { ...result(), images: [{ ...image(), annotation: { ...classified, classKey: ['crop'] } }] },
      { ...detection(), images: [{ ...image(), annotation: { type: 'detection', sourceImageId: '11', boxes: [{ ...box(), extra: 1 }] } }] },
      { ...result(), images: [{ ...image(), format: 'gif' }] },
      result({ images: [image({ sha256: 'A'.repeat(64) })] }),
      detection({ classes: [{ key: 'crop', name: 'ok', sourceCategoryId: '07' }] }),
    ];
    for (const name of ['', ' \t\u0085\ufeff', '\ud800', 'a\0b']) {
      cases.push(result({ classes: [{ key: 'crop', name, sourceCategoryId: null }] }));
    }
    for (const candidate of cases) expect(() => parseScanResult(candidate)).toThrow(invalid);
  });
  it('requires issue repair context, safe codes and consistent image targets', () => {
    const target = { imageKey: 'image:0', sourcePath: file, row: null, itemId: null };
    const base = { severity: 'error', code: 'INVALID_ANNOTATION', target };
    const issues = [
      { ...base, code: 'C:\\private\\raw.png' }, { ...base, code: 'BAD\n' }, { ...base, code: 'A'.repeat(65) },
      { ...base, message: 'raw data' }, { ...base, severity: 'info' },
      { ...base, target: { ...target, extra: 'raw metadata' } },
      { ...base, target: { imageKey: null, sourcePath: null, row: null, itemId: null } },
      { ...base, target: { ...target, imageKey: 'missing', sourcePath: null } },
      { ...base, severity: 'warning', target: { ...target, imageKey: 'missing' } },
      { ...base, target: { ...target, sourcePath: root + '\\other.png' } },
      ...[0, -1, true, false, 0.5, NaN, Infinity, 9007199254740992].map((row) => ({ ...base, target: { ...target, row } })),
    ];
    for (const entry of issues) expect(() => parseScanResult({ ...result(), issues: [entry] })).toThrow(invalid);
    expect(parseScanResult({ ...result(), issues: [{ ...base, severity: 'warning' }] }).issues).toHaveLength(1);
  });
  it('normalizes UUID NIL/MAX/case and checks all correlation fields', () => {
    const ids = [jobId.toUpperCase(), '00000000-0000-0000-0000-000000000000', 'FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF', 'FfFfFfFf-FfFf-FfFf-FfFf-FfFfFfFfFfFf'];
    for (const field of ['jobId', 'projectId'] as const) {
      for (const id of ids) {
        const context = { ...expected, [field]: id };
        expect(decodeScanResult(JSON.stringify(result({ [field]: id })), context)[field]).toBe(id.toLowerCase());
      }
      for (const id of ['bad', jobId + '\n', 'FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFE', '00000000-0000-0000-0000-000000000001', 'ae45cf74-c9f9-0c49-88b9-0523b1ac7383']) {
        expect(() => parseScanResult(result({ [field]: id }))).toThrow(invalid);
        expect(() => decodeScanResult(JSON.stringify(result()), { ...expected, [field]: id })).toThrow(invalid);
      }
    }
    const mismatches: ScanContext[] = [
      { ...expected, jobId: projectId }, { ...expected, projectId: jobId },
      { ...expected, taskType: 'detection' }, { ...expected, mode: 'reference' },
    ];
    for (const context of mismatches) expect(() => decodeScanResult(JSON.stringify(result()), context)).toThrow(invalid);
    expect(() => Reflect.apply(decodeScanResult, undefined, [JSON.stringify(result()), null])).toThrow(invalid);
    expect(() => Reflect.apply(decodeScanResult, undefined, [JSON.stringify(result())])).toThrow(invalid);
  });
  it('adversarial fixed keys rejects own __proto__ at every scan result object boundary', () => {
    const detected = detection({ issues: [{
      severity: 'error', code: 'INVALID_ANNOTATION',
      target: { imageKey: 'image:0', sourcePath: file, row: null, itemId: null },
    }] });
    const classified = result({
      classes: [{ key: 'crop', name: '健康🌱', sourceCategoryId: null }],
      images: [image({ annotation: { type: 'classification', classKey: 'crop', sourceRow: 2 } })],
    });
    const cases = [
      ['root', detected, '{', []],
      ['image', detected, '"images":[{', ['images', 0]],
      ['class', detected, '"classes":[{', ['classes', 0]],
      ['box', detected, '"boxes":[{', ['images', 0, 'annotation', 'boxes', 0]],
      ['detection annotation', detected, '"annotation":{', ['images', 0, 'annotation']],
      ['classification annotation', classified, '"annotation":{', ['images', 0, 'annotation']],
      ['issue', detected, '"issues":[{', ['issues', 0]],
      ['issue.target', detected, '"target":{', ['issues', 0, 'target']],
    ] as const;
    for (const [position, value, prefix, path] of cases) {
      const context: ScanContext = { ...expected, taskType: value.taskType };
      const original = JSON.stringify(value);
      expect(scanResultSchema.safeParse(value).success, position).toBe(true);
      expect(decodeScanResult(original, context), position).toEqual(value);
      const wire = original.replace(prefix, `${prefix}"__proto__":null,`);
      const candidate = JSON.parse(wire);
      let target = candidate;
      for (const key of path) target = target[key];
      expect(Object.hasOwn(target, '__proto__'), position).toBe(true);
      expect(target['__proto__'], position).toBeNull();
      expect.soft(scanResultSchema.safeParse(candidate).success, position).toBe(false);
      expect.soft(() => parseScanResult(candidate, context), position).toThrow(invalid);
      for (const input of [wire, new TextEncoder().encode(wire)]) {
        expect.soft(() => decodeScanResult(input, context), position).toThrow(invalid);
      }
    }
  });
  it('adversarial fixed keys keeps __proto__ as a legal class key', () => {
    const key = '__proto__';
    const classified = result({
      classes: [{ key, name: '健康🌱', sourceCategoryId: null }],
      images: [image({ annotation: { type: 'classification', classKey: key, sourceRow: 2 } })],
    });
    const detected = detection({
      classes: [{ key, name: '健康🌱', sourceCategoryId: '7' }],
      images: [image({ annotation: { type: 'detection', sourceImageId: '11', boxes: [box({ classKey: key })] } })],
    });
    for (const value of [classified, detected]) {
      const context: ScanContext = { ...expected, taskType: value.taskType };
      expect(scanResultSchema.safeParse(value)).toEqual({ success: true, data: value });
      expect(parseScanResult(value, context)).toEqual(value);
      expect(decodeScanResult(JSON.stringify(value), context)).toEqual(value);
    }
  });
  it('adversarial fixed keys keeps __proto__ as classification label text', () => {
    const value = result({
      classes: [{ key: 'crop', name: '__proto__', sourceCategoryId: null }],
      images: [image({ annotation: { type: 'classification', classKey: 'crop', sourceRow: 2 } })],
    });
    expect(scanResultSchema.safeParse(value)).toEqual({ success: true, data: value });
    expect(parseScanResult(value, expected)).toEqual(value);
    expect(decodeScanResult(JSON.stringify(value), expected)).toEqual(value);
  });
});

describe('DAT-01a raw JSON artifact boundary', () => {
  it('rejects ambiguous members, malformed UTF-8/JSON and non-finite tokens', () => {
    const wire = JSON.stringify(result());
    const manifests = [
      '', '[]', '{}', manifestJson + '{}', '\ufeff' + manifestJson,
      manifestJson.replace('"formatVersion":1', '"formatVersion":1,"\\u0066ormatVersion":1'),
      manifestJson.replace('a.png', '\\ud800'),
    ];
    const results = [
      '', '[]', '{}', wire + '{}', '\ufeff' + wire,
      wire.replace('"formatVersion":1', '"formatVersion":1,"formatVersion":1'),
      wire.replace('"jobId":', '"jobId":"' + jobId + '","\\u006aobId":'),
      wire.replace('"width":640', '"width":1,"\\u0077idth":640'),
      ...['NaN', 'Infinity', '-Infinity', '1e400', '9007199254740992'].map((token) => wire.replace('"byteSize":1234', '"byteSize":' + token)),
      wire.replace('a.png', '\\ud800'),
    ];
    for (const input of manifests) expect(() => decodeSelectionManifest(input)).toThrow(invalid);
    for (const input of results) expect(() => decodeScanResult(input, expected)).toThrow(invalid);
    const malformedBytes = [new Uint8Array([0xff]), new Uint8Array([0xc0, 0xaf]), new TextEncoder().encode('\ufeff' + manifestJson)];
    for (const input of malformedBytes) {
      expect(() => decodeSelectionManifest(input)).toThrow(invalid);
      expect(() => decodeScanResult(input, expected)).toThrow(invalid);
    }
  });
  it('accepts escaped Unicode, integer JSON spellings and delimiters inside strings', () => {
    const value = result({ classes: [{ key: 'crop', name: '日本語🌱 {"x":[],"x":{}}', sourceCategoryId: null }] });
    const wire = JSON.stringify(value).replace('🌱', '\\ud83c\\udf31');
    expect(decodeScanResult(new TextEncoder().encode(wire), expected)).toEqual(value);
    for (const token of ['1.0', '1e0']) {
      expect(decodeScanResult(wire.replace('"formatVersion":1', '"formatVersion":' + token), expected)).toEqual(value);
      expect(decodeSelectionManifest(manifestJson.replace('"formatVersion":1', '"formatVersion":' + token)).formatVersion).toBe(1);
    }
  });
  it('accepts 350-image results above the control-message budget', () => {
    const value = result({ images: Array.from({ length: 350 }, (_, index) => image({ key: `image:${index}`, sourcePath: `${root}\\${index}.png`, sha256: index.toString(16).padStart(64, '0') })) });
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    expect(bytes.length).toBeGreaterThan(MAX_WORKER_MESSAGE_BYTES);
    expect(bytes.length).toBeLessThan(MAX_SCAN_RESULT_BYTES);
    expect(decodeScanResult(bytes, expected)).toEqual(value);
  });
  it('uses only the five approved limits and enforces actual UTF-8 artifact budgets', () => {
    expect([MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS, MAX_INPUT_ITEMS, MAX_ANNOTATION_BYTES, MAX_SCAN_RESULT_BYTES])
      .toEqual([134217728, 40000000, 100000, 67108864, 268435456]);
    // Valid JSON if byte limits were removed. Allocate only inside this test,
    // never in parametrization IDs; no files, processes or network are involved.
    const oversizedManifest = JSON.stringify({ formatVersion: 1, files: ['C:\\' + 'é'.repeat(MAX_ANNOTATION_BYTES / 2)] });
    expect(oversizedManifest.length).toBeLessThan(MAX_ANNOTATION_BYTES);
    expect(() => decodeSelectionManifest(oversizedManifest)).toThrow(invalid);
    const wire = JSON.stringify(result());
    expect(() => decodeScanResult(wire + ' '.repeat(MAX_SCAN_RESULT_BYTES - wire.length + 1), expected)).toThrow(invalid);
  });
  it('rejects non-JSON runtime inputs without invoking getters or producing defaults', () => {
    let accessed = false;
    const candidate = { mode: 'copy', source: unlabeled };
    expect(() => parseScanPayload({ ...candidate, taskType: new String('classification') })).toThrow(invalid);
    Object.defineProperty(candidate, 'taskType', { enumerable: true, get() { accessed = true; return 'classification'; } });
    expect(() => parseScanPayload(candidate)).toThrow(invalid);
    expect(accessed).toBe(false);
    const cyclic: unknown[] = [];
    cyclic.push(cyclic);
    for (const files of [cyclic, new Array(1), [undefined]]) {
      expect(() => parseSelectionManifest({ formatVersion: 1, files })).toThrow(invalid);
    }
    for (const input of [new Uint16Array([123, 125]), new DataView(new ArrayBuffer(2)), { length: 2, 0: 123, 1: 125 }]) {
      expect(() => Reflect.apply(decodeSelectionManifest, undefined, [input])).toThrow(invalid);
    }
  });
});