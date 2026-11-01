import { describe, expect, it } from 'vitest';

import {
  assessClassCoverage, checkImageInputLimits, countManifestClassImages, IMAGE_INPUT_POLICY,
} from './class-coverage-policy.js';

const counts = (...n: number[]) => new Map(n.map((v, i) => [`c${i}`, v]));

describe('FR-CVP-001 class coverage policy', () => {
  it('AC classification: 4 is Error, 5 is Warn, 50 has no recommended Warn', () => {
    const four = assessClassCoverage('classification', counts(4, 5));
    expect(four.errors).toEqual([{ code: 'CLASS_BELOW_MINIMUM', classId: 'c0', actual: 4, required: 5, shortfall: 1 }]);
    const five = assessClassCoverage('classification', counts(5, 5));
    expect(five.errors).toEqual([]);
    expect(five.warnings.map((w) => w.code)).toEqual(['CLASS_BELOW_RECOMMENDED', 'CLASS_BELOW_RECOMMENDED']);
    expect(assessClassCoverage('classification', counts(50, 60)).warnings).toEqual([]);
  });
  it('AC detection: 14 is Error, 15 is Warn, 50 has no Warn', () => {
    expect(assessClassCoverage('detection', counts(14)).errors[0]?.shortfall).toBe(1);
    expect(assessClassCoverage('detection', counts(15)).warnings[0]?.code).toBe('CLASS_BELOW_RECOMMENDED');
    expect(assessClassCoverage('detection', counts(50)).warnings).toEqual([]);
  });
  it('warns on imbalance ratio >= 2 only', () => {
    expect(assessClassCoverage('classification', counts(50, 100)).warnings.map((w) => w.code)).toEqual(['CLASS_IMBALANCE']);
    expect(assessClassCoverage('classification', counts(50, 99)).warnings).toEqual([]);
  });
  it('counts distinct images per class, skipping negative/excluded', () => {
    const base = { schema: { classes: [{ id: 'a' }, { id: 'b' }] } };
    const det = countManifestClassImages({ ...base, taskType: 'detection', items: [
      { disposition: 'labeled', imageSha256: 'h1', annotation: { rectangles: [{ classId: 'a' }, { classId: 'a' }] } },
      { disposition: 'negative', imageSha256: 'h2', annotation: { rectangles: [] } },
      { disposition: 'excluded', imageSha256: 'h3', annotation: { rectangles: [{ classId: 'b' }] } },
    ] });
    expect([...det]).toEqual([['a', 1], ['b', 0]]);
    const cls = countManifestClassImages({ ...base, taskType: 'classification', items: [
      { disposition: 'labeled', imageSha256: 'h1', annotation: { classId: 'b' } },
    ] });
    expect(cls.get('b')).toBe(1);
  });
});

describe('FR-CVP-008 image input limits', () => {
  const p = IMAGE_INPUT_POLICY;
  it('accepts values exactly at the limits', () => {
    expect(checkImageInputLimits({ byteSize: p.maxFileBytes, width: p.minWidth, height: p.minHeight })).toEqual([]);
    expect(checkImageInputLimits({ byteSize: 1, width: p.maxWidth, height: p.maxHeight })).toEqual([]);
  });
  it('reports each violation with actual and limit', () => {
    expect(checkImageInputLimits({ byteSize: p.maxFileBytes + 1, width: p.minWidth - 1, height: p.maxHeight + 1 })).toEqual([
      { code: 'FILE_TOO_LARGE', actual: p.maxFileBytes + 1, limit: p.maxFileBytes },
      { code: 'WIDTH_TOO_SMALL', actual: p.minWidth - 1, limit: p.minWidth },
      { code: 'HEIGHT_TOO_LARGE', actual: p.maxHeight + 1, limit: p.maxHeight },
    ]);
  });
});
