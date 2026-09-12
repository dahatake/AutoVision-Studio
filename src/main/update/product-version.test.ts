// @vitest-environment node
import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import { compareProductVersions, parseProductVersion, type ProductVersion } from './product-version.js';

describe('parseProductVersion (PKG-09A)', () => {
  it.each([
    { value: '0.0.0', parts: [0n, 0n, 0n] },
    { value: '0.1.0', parts: [0n, 1n, 0n] },
    { value: '1.2.3', parts: [1n, 2n, 3n] },
    { value: '10.20.300', parts: [10n, 20n, 300n] },
    { value: '9007199254740993.18446744073709551616.999999999999999999999999999999',
      parts: [9007199254740993n, 18446744073709551616n, 999999999999999999999999999999n] },
  ])('parses exactly $value without rounding', ({ value, parts }) => {
    const version = parseProductVersion(value);
    expect(version).toEqual({ major: parts[0], minor: parts[1], patch: parts[2] });
    expect(Object.keys(version)).toEqual(['major', 'minor', 'patch']);
    expect(Object.isFrozen(version)).toBe(true);
    expect(Reflect.set(version, 'patch', 0n)).toBe(false);
    expect(Reflect.deleteProperty(version, 'major')).toBe(false);
    expect(`${version.major}.${version.minor}.${version.patch}`).toBe(value);
    expectTypeOf(version).toEqualTypeOf<ProductVersion>();
  });

  it.each([
    '', ' ', '1', '1.2', '1.2.3.4', '.1.2', '1..2', '1.2.',
    '00.1.2', '01.2.3', '1.02.3', '1.2.03', '-1.2.3', '1.-2.3', '1.2.-3',
    '+1.2.3', '1.+2.3', '1.2.+3', 'v1.2.3', 'V1.2.3', '=1.2.3', '^1.2.3', '~1.2.3',
    '1.2.3-beta', '1.2.3+build', '1.2.3-beta+build', '1e1.2.3', '0x10.2.3', 'Infinity.2.3', 'NaN.2.3',
    '1,2,3', '１.２.３', '١.٢.٣', '1．2．3', ' 1.2.3', '1.2.3 ', '1. 2.3',
    '\n1.2.3', '1.2.3\n', '1.2.3\r', '1.2.3\r\n', '1.2.3\u2028', '1.2.3\u2029',
    '1.2.3\t', '1.2.3\0', '1.2.3\u00a0', '\ufeff1.2.3',
  ])('rejects the entire noncanonical string %j', (value) => {
    expect(() => parseProductVersion(value)).toThrow(TypeError);
  });

  it.each([undefined, null, false, true, 123, 1.2, NaN, Infinity, 1n, ['1.2.3'], {}, new String('1.2.3'), Symbol('version')])(
    'rejects non-string input %# without coercion', (value) => {
      expect(() => parseProductVersion(value)).toThrow(TypeError);
    },
  );

  it('does not invoke an object accessor/coercion or echo its private value', () => {
    const coerce = vi.fn(() => { throw new Error('PRIVATE_NATIVE_PATH'); });
    const input = { get toString() { coerce(); return coerce; }, [Symbol.toPrimitive]: coerce };
    expect(() => parseProductVersion(input)).toThrow('製品バージョンは、先頭ゼロのない非負整数3要素（MAJOR.MINOR.PATCH）で指定してください。');
    expect(() => parseProductVersion('PRIVATE_NATIVE_PATH')).toThrow('製品バージョンは、先頭ゼロのない非負整数3要素（MAJOR.MINOR.PATCH）で指定してください。');
    expect(coerce).not.toHaveBeenCalled();
  });
});

describe('compareProductVersions (PKG-09A)', () => {
  it.each([
    { left: '0.0.0', right: '0.0.0', order: 0 },
    { left: '0.1.0', right: '0.1.0', order: 0 },
    { left: '0.1.0', right: '0.2.0', order: -1 },
    { left: '0.9.9', right: '1.0.0', order: -1 },
    { left: '1.0.0', right: '0.999999.999999', order: 1 },
    { left: '1.9.99', right: '1.10.0', order: -1 },
    { left: '1.10.0', right: '1.9.999', order: 1 },
    { left: '1.2.9', right: '1.2.10', order: -1 },
    { left: '1.2.100', right: '1.2.99', order: 1 },
    { left: '9.999.999', right: '10.0.0', order: -1 },
    { left: '9007199254740992.0.0', right: '9007199254740993.0.0', order: -1 },
    { left: '1.9007199254740993.0', right: '1.9007199254740992.999', order: 1 },
    { left: '1.2.9007199254740992', right: '1.2.9007199254740993', order: -1 },
    { left: `1.2.${'9'.repeat(400)}`, right: `1.2.1${'0'.repeat(400)}`, order: -1 },
  ])('compares $left to $right in numeric component order', ({ left, right, order }) => {
    const actual = compareProductVersions(left, right);
    expect(actual).toBe(order);
    expect(compareProductVersions(right, left)).toBe(order === 0 ? 0 : -order);
    expectTypeOf(actual).toEqualTypeOf<-1 | 0 | 1>();
  });

  it.each([
    { left: 'bad', right: '1.2.3' }, { left: '1.2.3', right: 'bad' },
    { left: '0.0.0', right: undefined }, { left: null, right: '0.0.0' },
    { left: '1.2.3\n', right: '1.2.3' }, { left: '1.2.3', right: '01.2.3' },
  ])('refuses invalid operand %# instead of treating it as older or equal', ({ left, right }) => {
    expect(() => compareProductVersions(left, right)).toThrow(TypeError);
  });

  it('preserves reflexivity, numeric order and transitivity across component boundaries', () => {
    const versions = ['0.0.0', '0.0.9', '0.0.10', '0.1.0', '0.9.999', '0.10.0', '1.0.0', '2.0.0', '10.0.0'];
    for (const [i, a] of versions.entries()) for (const [j, b] of versions.entries()) {
      expect(compareProductVersions(a, b)).toBe(i < j ? -1 : i > j ? 1 : 0);
      for (let k = j + 1; i < j && k < versions.length; k++) {
        expect(compareProductVersions(b, versions[k])).toBe(-1);
        expect(compareProductVersions(a, versions[k])).toBe(-1);
      }
    }
  });
});