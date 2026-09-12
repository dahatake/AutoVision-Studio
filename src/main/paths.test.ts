import { isAbsolute, join, resolve, sep } from 'node:path';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import type { AppPaths } from './paths.js';
import { getAppPaths } from './paths.js';

// Fail on filesystem imports without accessing the real filesystem.
vi.mock('node:fs', () => {
  throw new Error('Path calculation must not depend on filesystem access.');
});
vi.mock('fs', () => {
  throw new Error('Path calculation must not depend on filesystem access.');
});
vi.mock('node:fs/promises', () => {
  throw new Error('Path calculation must not depend on filesystem access.');
});
vi.mock('fs/promises', () => {
  throw new Error('Path calculation must not depend on filesystem access.');
});

describe('getAppPaths', () => {
  it('computes exactly the default locations without filesystem access', () => {
    const userDataPath = resolve('test-user-data', 'AutoVision Studio');
    const paths = getAppPaths(userDataPath);

    expect(paths).toEqual({
      userData: userDataPath,
      projects: join(userDataPath, 'projects'),
      cache: join(userDataPath, 'cache'),
      logs: join(userDataPath, 'logs'),
    });
    for (const path of Object.values(paths)) {
      expect(isAbsolute(path)).toBe(true);
    }
  });

  it('normalizes dot segments and redundant separators before joining children', () => {
    const userDataPath = resolve('test-user-data', 'AutoVision Studio');
    const input = `${userDataPath}${sep}.${sep}discarded${sep}..${sep}${sep}`;

    expect(getAppPaths(input)).toEqual({
      userData: userDataPath,
      projects: join(userDataPath, 'projects'),
      cache: join(userDataPath, 'cache'),
      logs: join(userDataPath, 'logs'),
    });
  });

  it('preserves Japanese text and leading, internal, and trailing segment spaces', () => {
    const userDataPath = join(
      resolve('test-user-data'),
      ' 利用者 データ ',
      ' AutoVision スタジオ ',
    );

    expect(getAppPaths(userDataPath)).toEqual({
      userData: userDataPath,
      projects: join(userDataPath, 'projects'),
      cache: join(userDataPath, 'cache'),
      logs: join(userDataPath, 'logs'),
    });
  });

  it('returns readonly, frozen paths', () => {
    const userDataPath = resolve('test-user-data', 'AutoVision Studio');
    const paths = getAppPaths(userDataPath);

    expectTypeOf(paths).toEqualTypeOf<Readonly<AppPaths>>();
    expect(Object.isFrozen(paths)).toBe(true);
    expect(Reflect.set(paths, 'projects', join(userDataPath, 'other'))).toBe(false);
    expect(paths.projects).toBe(join(userDataPath, 'projects'));
  });

  it.each([
    '',
    '   ',
    '.',
    '..',
    'user-data',
    join('user-data', 'AutoVision Studio'),
    'C:',
    'C:foo',
  ])('rejects empty or relative input %j instead of falling back to cwd', (input) => {
    expect(() => getAppPaths(input)).toThrow(TypeError);
  });

  it('rejects NUL characters even in an absolute path', () => {
    const input = join(resolve('test-user-data'), 'AutoVision\0Studio');

    expect(isAbsolute(input)).toBe(true);
    expect(() => getAppPaths(input)).toThrow(TypeError);
  });

  it.each([null, undefined])('rejects %s crossing an untyped boundary', (input) => {
    expect(() => getAppPaths(input as unknown as string)).toThrow(TypeError);
  });

  it.runIf(process.platform === 'win32')('accepts an absolute Windows drive path', () => {
    const userDataPath = 'C:\\Users\\Test User\\AppData\\Roaming\\AutoVision Studio';

    expect(getAppPaths(userDataPath)).toEqual({
      userData: userDataPath,
      projects: `${userDataPath}\\projects`,
      cache: `${userDataPath}\\cache`,
      logs: `${userDataPath}\\logs`,
    });
  });

  it.runIf(process.platform === 'win32')('accepts an absolute UNC path', () => {
    const userDataPath = '\\\\server\\share\\利用者 データ\\AutoVision Studio';

    expect(getAppPaths(userDataPath)).toEqual({
      userData: userDataPath,
      projects: `${userDataPath}\\projects`,
      cache: `${userDataPath}\\cache`,
      logs: `${userDataPath}\\logs`,
    });
  });
});