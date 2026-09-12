// @vitest-environment node
import native from 'node:fs';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import {
  calculateImportCapacity, preflightImportCapacity,
  type ImportCapacity, type ImportCapacityInput, type ImportCapacityRequirements,
} from './import-capacity.js';

const requirements = Object.freeze({ mode: 'copy' as const, sourceBytes: 7n, generatedBytes: 3n, temporaryBytes: 2n });
const input = Object.freeze({ ...requirements, availableBytes: 15n });
const disk: native.BigIntStatsFs = Object.freeze({ type: 0n, bsize: 1n, blocks: 1000n,
  bfree: 1000n, bavail: 15n, files: 0n, ffree: 0n });
const byteFields = ['sourceBytes', 'generatedBytes', 'temporaryBytes', 'availableBytes'] as const;

describe('DAT-11 exact import capacity arithmetic', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('exports required byte inputs and an immutable result without a platform/settings API', () => {
    expectTypeOf<ImportCapacityRequirements>().toEqualTypeOf<{
      readonly mode: 'copy' | 'reference'; readonly sourceBytes: bigint;
      readonly generatedBytes: bigint; readonly temporaryBytes: bigint;
    }>();
    expectTypeOf<ImportCapacityInput>().toEqualTypeOf<{
      readonly mode: 'copy' | 'reference'; readonly sourceBytes: bigint;
      readonly generatedBytes: bigint; readonly temporaryBytes: bigint; readonly availableBytes: bigint;
    }>();
    expectTypeOf<ImportCapacity>().toEqualTypeOf<{
      readonly mode: 'copy' | 'reference'; readonly sourceBytes: bigint; readonly copiedBytes: bigint;
      readonly generatedBytes: bigint; readonly temporaryBytes: bigint; readonly safetyBytes: bigint;
      readonly requiredBytes: bigint; readonly availableBytes: bigint; readonly sufficient: boolean;
    }>();
    expectTypeOf<Parameters<typeof calculateImportCapacity>>().toEqualTypeOf<[ImportCapacityInput]>();
    expectTypeOf<ReturnType<typeof calculateImportCapacity>>().toEqualTypeOf<ImportCapacity>();
    expectTypeOf<Parameters<typeof preflightImportCapacity>>().toEqualTypeOf<[string, ImportCapacityRequirements]>();
    expectTypeOf<ReturnType<typeof preflightImportCapacity>>().toEqualTypeOf<Promise<ImportCapacity>>();
    const statfs = vi.spyOn(fs, 'statfs');
    const lstat = vi.spyOn(native, 'lstatSync');
    const result = calculateImportCapacity(input);
    expect(result).toEqual({ mode: 'copy', sourceBytes: 7n, copiedBytes: 7n, generatedBytes: 3n,
      temporaryBytes: 2n, safetyBytes: 3n, requiredBytes: 15n, availableBytes: 15n, sufficient: true });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Reflect.set(result, 'requiredBytes', 0n)).toBe(false);
    expect(result.requiredBytes).toBe(15n);
    expect(statfs).not.toHaveBeenCalled();
    expect(lstat).not.toHaveBeenCalled();
  });

  it.each(['copy', 'reference'] as const)('accepts explicit zero bytes in %s mode', (mode) => {
    expect(calculateImportCapacity({ mode, sourceBytes: 0n, generatedBytes: 0n, temporaryBytes: 0n, availableBytes: 0n }))
      .toEqual({ mode, sourceBytes: 0n, copiedBytes: 0n, generatedBytes: 0n, temporaryBytes: 0n,
        safetyBytes: 0n, requiredBytes: 0n, availableBytes: 0n, sufficient: true });
  });

  it.each([[14n, false], [15n, true], [16n, true]] as const)('compares the exact threshold at %s bytes', (availableBytes, sufficient) => {
    expect(calculateImportCapacity({ ...input, availableBytes })).toMatchObject({ requiredBytes: 15n, availableBytes, sufficient });
  });

  it.each([1n, 2n, 3n, 4n, 5n])('rounds the 20%% margin for %s bytes UP to one byte', (sourceBytes) => {
    expect(calculateImportCapacity({ mode: 'copy', sourceBytes, generatedBytes: 0n, temporaryBytes: 0n, availableBytes: 6n }))
      .toMatchObject({ safetyBytes: 1n, requiredBytes: sourceBytes + 1n, sufficient: true });
  });

  it('rounds once after summing all three budgets, not once per budget', () => {
    expect(calculateImportCapacity({ ...input, sourceBytes: 1n, generatedBytes: 1n, temporaryBytes: 3n }))
      .toMatchObject({ safetyBytes: 1n, requiredBytes: 6n });
    expect(calculateImportCapacity({ ...input, sourceBytes: 2n, generatedBytes: 1n, temporaryBytes: 3n }))
      .toMatchObject({ safetyBytes: 2n, requiredBytes: 8n });
  });

  it('Reference retains the original total but budgets only local generated and temporary bytes', () => {
    const original = { sourceBytes: 101n, generatedBytes: 7n, temporaryBytes: 3n, availableBytes: 12n };
    expect(calculateImportCapacity({ ...original, mode: 'copy' })).toEqual({ ...original, mode: 'copy', copiedBytes: 101n,
      safetyBytes: 23n, requiredBytes: 134n, sufficient: false });
    expect(calculateImportCapacity({ ...original, mode: 'reference' })).toEqual({ ...original, mode: 'reference', copiedBytes: 0n,
      safetyBytes: 2n, requiredBytes: 12n, sufficient: true });
    expect(calculateImportCapacity({ mode: 'reference', sourceBytes: 10n ** 400n,
      generatedBytes: 0n, temporaryBytes: 0n, availableBytes: 0n }))
      .toMatchObject({ sourceBytes: 10n ** 400n, copiedBytes: 0n, safetyBytes: 0n, requiredBytes: 0n, sufficient: true });
  });

  it.each([2n ** 53n + 1n, 10n ** 400n + 1n])('does not round, overflow or cap a huge source total (case %#)', (sourceBytes) => {
    // Both fixture totals have a nonzero remainder. Compute the expectation
    // independently of the implementation's add-four ceiling expression.
    const safetyBytes = sourceBytes / 5n + 1n;
    const requiredBytes = sourceBytes + safetyBytes;
    const result = calculateImportCapacity({ mode: 'copy', sourceBytes, generatedBytes: 0n, temporaryBytes: 0n,
      availableBytes: requiredBytes });
    expect(result).toMatchObject({ sourceBytes, copiedBytes: sourceBytes, safetyBytes, requiredBytes, sufficient: true });
    expect(calculateImportCapacity({ ...result, availableBytes: requiredBytes - 1n }).sufficient).toBe(false);
    for (const field of [...byteFields, 'copiedBytes', 'safetyBytes', 'requiredBytes'] as const) expect(typeof result[field]).toBe('bigint');
  });

  it('keeps huge generated and temporary estimates exact too, including Reference', () => {
    const huge = 10n ** 400n;
    expect(calculateImportCapacity({ mode: 'reference', sourceBytes: 1n,
      generatedBytes: huge + 1n, temporaryBytes: huge + 2n, availableBytes: huge * 3n }))
      .toMatchObject({ copiedBytes: 0n, safetyBytes: huge * 2n / 5n + 1n,
        requiredBytes: huge * 12n / 5n + 4n, sufficient: true });
  });

  it.each(byteFields)('requires an actual nonnegative bigint for %s without coercion', (field) => {
    const coercion = vi.fn(() => 1n);
    const invalid: unknown[] = [-1n, undefined, null, 0, 1, 1.5, NaN, Infinity, -Infinity,
      true, false, '0', '1n', [], {}, Object(1n), { [Symbol.toPrimitive]: coercion }];
    for (const value of invalid) {
      expect(() => calculateImportCapacity({ ...input, [field]: value } as ImportCapacityInput)).toThrow(TypeError);
    }
    const missing = { ...input };
    Reflect.deleteProperty(missing, field);
    expect(() => calculateImportCapacity(missing)).toThrow(TypeError);
    expect(coercion).not.toHaveBeenCalled();
  });

  it('requires explicit mode, including for zero originals, without defaulting to Copy', () => {
    for (const mode of [undefined, null, '', 'COPY', 'reference ', 'move', 0, true, Object('copy')]) {
      expect(() => calculateImportCapacity({ ...input, mode, sourceBytes: 0n } as ImportCapacityInput)).toThrow(TypeError);
    }
    const missing = { ...input };
    Reflect.deleteProperty(missing, 'mode');
    expect(() => calculateImportCapacity(missing)).toThrow(TypeError);
  });

  it('rejects non-data inputs, inherited required fields and accessors without invoking them', () => {
    const getter = vi.fn(() => 0n);
    for (const value of [undefined, null, false, 0n, 'copy', [], new Date(), Object.create(input)]) {
      expect(() => calculateImportCapacity(value as ImportCapacityInput)).toThrow(TypeError);
    }
    for (const field of ['mode', ...byteFields] as const) {
      const value = { ...input };
      Object.defineProperty(value, field, { get: getter });
      expect(() => calculateImportCapacity(value)).toThrow(TypeError);
    }
    expect(getter).not.toHaveBeenCalled();
    expect(calculateImportCapacity(Object.assign(Object.create(null), input))).toEqual(calculateImportCapacity(input));
  });
});

describe.skipIf(process.platform !== 'win32')('DAT-11 read-only local Windows preflight', () => {
  let temporary: string;
  let parent: string;
  let destination: string;
  beforeEach(async () => {
    temporary = native.realpathSync.native(await fs.mkdtemp(join(tmpdir(), 'autovision-dat11-')));
    parent = join(temporary, 'parent');
    destination = join(parent, '保存先');
    await fs.mkdir(destination, { recursive: true });
    await fs.writeFile(join(destination, 'keep'), 'unchanged');
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    // Only this test's own fixtures, including all detached trees/link targets.
    if (temporary) await fs.rm(temporary, { recursive: true, force: true });
  });

  const noWritesOrSourceWalk = () => [
    vi.spyOn(native, 'mkdirSync'), vi.spyOn(fs, 'mkdir'),
    vi.spyOn(native, 'openSync'), vi.spyOn(fs, 'open'),
    vi.spyOn(native, 'writeFileSync'), vi.spyOn(fs, 'writeFile'),
    vi.spyOn(native, 'renameSync'), vi.spyOn(fs, 'rename'),
    vi.spyOn(native, 'rmSync'), vi.spyOn(fs, 'rm'),
    vi.spyOn(native, 'readdirSync'), vi.spyOn(fs, 'readdir'),
    vi.spyOn(native, 'opendirSync'), vi.spyOn(fs, 'opendir'),
    vi.spyOn(native, 'copyFileSync'), vi.spyOn(fs, 'copyFile'),
  ];

  it('queries real statfs once in bigint bytes and leaves an existing directory untouched without claiming ownership', async () => {
    const actualStatfs = fs.statfs.bind(fs);
    let observed: native.BigIntStatsFs | undefined;
    const statfs = vi.spyOn(fs, 'statfs').mockImplementation((async (path, options) => {
      expect(options).toEqual({ bigint: true });
      observed = await actualStatfs(path, { bigint: true });
      return observed;
    }) as typeof fs.statfs);
    const lstat = vi.spyOn(native, 'lstatSync');
    const operations = noWritesOrSourceWalk();
    const result = await preflightImportCapacity(destination, requirements);
    expect(statfs).toHaveBeenCalledExactlyOnceWith(destination, { bigint: true });
    expect(observed).toBeDefined();
    expect(typeof observed!.bavail).toBe('bigint');
    expect(typeof observed!.bsize).toBe('bigint');
    expect(observed!.bavail).toBeGreaterThanOrEqual(0n);
    expect(observed!.bsize).toBeGreaterThan(0n);
    // Compare to the SAME native reply, not a second free-space sample that
    // another process could legitimately change between the two queries.
    expect(result).toEqual(calculateImportCapacity({ ...requirements, availableBytes: observed!.bavail * observed!.bsize }));
    expect(Object.isFrozen(result)).toBe(true);
    let cursor = destination;
    for (;;) {
      const calls = lstat.mock.calls.map(([path], index) => path === cursor ? lstat.mock.invocationCallOrder[index]! : -1);
      expect(calls.some((order) => order > 0 && order < statfs.mock.invocationCallOrder[0]!)).toBe(true);
      expect(calls.some((order) => order > statfs.mock.invocationCallOrder[0]!)).toBe(true);
      if (cursor === win32.parse(cursor).root) break;
      cursor = win32.dirname(cursor);
    }
    for (const operation of operations) expect(operation).not.toHaveBeenCalled();
    expect(await fs.readdir(destination)).toEqual(['keep']);
    expect(await fs.readFile(join(destination, 'keep'), 'utf8')).toBe('unchanged');
    expect(await fs.readdir(parent)).toEqual(['保存先']);
  });

  it.each([[0n, false], [14n, false], [15n, true]] as const)('uses bavail=%s, not bfree, and returns shortage without writing', async (bavail, sufficient) => {
    const statfs = vi.spyOn(fs, 'statfs').mockResolvedValue({ ...disk, bavail });
    const operations = noWritesOrSourceWalk();
    expect(await preflightImportCapacity(destination, requirements)).toEqual({ mode: 'copy', sourceBytes: 7n,
      copiedBytes: 7n, generatedBytes: 3n, temporaryBytes: 2n, safetyBytes: 3n,
      requiredBytes: 15n, availableBytes: bavail, sufficient });
    expect(statfs).toHaveBeenCalledExactlyOnceWith(destination, { bigint: true });
    for (const operation of operations) expect(operation).not.toHaveBeenCalled();
  });

  it('multiplies block counts and block size exactly, rather than returning blocks or KiB', async () => {
    const bavail = 2n ** 53n + 1n;
    vi.spyOn(fs, 'statfs').mockResolvedValue({ ...disk, bavail, bsize: 4096n });
    expect(await preflightImportCapacity(destination, requirements)).toMatchObject({ availableBytes: bavail * 4096n, sufficient: true });
  });

  it('Reference requires local output estimates but does not charge or inspect source originals', async () => {
    const statfs = vi.spyOn(fs, 'statfs').mockResolvedValue({ ...disk, bavail: 8n });
    const operations = noWritesOrSourceWalk();
    expect(await preflightImportCapacity(destination, { mode: 'reference', sourceBytes: 10n ** 400n,
      generatedBytes: 5n, temporaryBytes: 1n })).toEqual({ mode: 'reference', sourceBytes: 10n ** 400n, copiedBytes: 0n,
      generatedBytes: 5n, temporaryBytes: 1n, safetyBytes: 2n, requiredBytes: 8n, availableBytes: 8n, sufficient: true });
    expect(statfs).toHaveBeenCalledExactlyOnceWith(destination, { bigint: true });
    for (const operation of operations) expect(operation).not.toHaveBeenCalled();
  });

  it('rejects unknown estimates and malformed mode before any path or capacity I/O in both modes', async () => {
    const lstat = vi.spyOn(native, 'lstatSync');
    const realpath = vi.spyOn(native.realpathSync, 'native');
    const statfs = vi.spyOn(fs, 'statfs');
    const coercion = vi.fn(() => 0n);
    for (const mode of ['copy', 'reference'] as const) {
      for (const field of ['sourceBytes', 'generatedBytes', 'temporaryBytes'] as const) {
        for (const value of [undefined, null, -1n, 0, 0.1, NaN, Infinity, true, '0', { [Symbol.toPrimitive]: coercion }]) {
          await expect(preflightImportCapacity(destination, { ...requirements, mode, [field]: value } as ImportCapacityRequirements))
            .rejects.toBeInstanceOf(TypeError);
        }
        const missing = { ...requirements, mode };
        Reflect.deleteProperty(missing, field);
        await expect(preflightImportCapacity(destination, missing)).rejects.toBeInstanceOf(TypeError);
      }
    }
    for (const mode of [undefined, null, '', 'COPY', true]) {
      await expect(preflightImportCapacity(destination, { ...requirements, mode } as ImportCapacityRequirements)).rejects.toBeInstanceOf(TypeError);
    }
    for (const operation of [lstat, realpath, statfs, coercion]) expect(operation).not.toHaveBeenCalled();
  });

  it('snapshots caller totals before awaiting statfs and does not read additional fields', async () => {
    const supplied: { -readonly [K in keyof ImportCapacityRequirements]: ImportCapacityRequirements[K] } = { ...requirements };
    const extra = vi.fn(() => { throw new Error('Unrelated metadata must not be read'); });
    Object.defineProperty(supplied, 'sourcePath', { get: extra });
    vi.spyOn(fs, 'statfs').mockImplementation(async () => {
      await Promise.resolve();
      supplied.mode = 'reference';
      supplied.sourceBytes = 0n;
      supplied.generatedBytes = 0n;
      supplied.temporaryBytes = 0n;
      return disk;
    });
    expect(await preflightImportCapacity(destination, supplied)).toEqual(calculateImportCapacity(input));
    expect(extra).not.toHaveBeenCalled();
  });

  it.each(['bavail', 'bsize'] as const)('rejects invalid statfs %s before comparison, even for zero required space', async (field) => {
    const statfs = vi.spyOn(fs, 'statfs');
    const invalid: unknown[] = [-1n, undefined, null, 0, 1, 0.5, NaN, Infinity, true, false, '1', Object(1n)];
    if (field === 'bsize') invalid.push(0n);
    for (const value of invalid) {
      statfs.mockResolvedValue({ ...disk, [field]: value } as native.BigIntStatsFs);
      await expect(preflightImportCapacity(destination, { mode: 'copy', sourceBytes: 0n, generatedBytes: 0n, temporaryBytes: 0n }))
        .rejects.toThrow(/空き容量を正確に取得/);
    }
  });

  it.each(['inspect', 'canonical', 'statfs', 'after-statfs'] as const)('propagates EACCES at %s without substituting capacity or writing', async (stage) => {
    const failure = Object.assign(new Error('injected access denied'), { code: 'EACCES' });
    let queried = false;
    const statfs = vi.spyOn(fs, 'statfs').mockImplementation(async () => {
      queried = true;
      if (stage === 'statfs') throw failure;
      return disk;
    });
    const actualLstat = native.lstatSync.bind(native);
    vi.spyOn(native, 'lstatSync').mockImplementation(((path, options) => {
      if (path === destination && (stage === 'inspect' || (stage === 'after-statfs' && queried))) throw failure;
      return actualLstat(path, options);
    }) as typeof native.lstatSync);
    if (stage === 'canonical') vi.spyOn(native.realpathSync, 'native').mockImplementation(() => { throw failure; });
    const operations = noWritesOrSourceWalk();
    await expect(preflightImportCapacity(destination, requirements)).rejects.toBe(failure);
    expect(statfs).toHaveBeenCalledTimes(stage === 'inspect' || stage === 'canonical' ? 0 : 1);
    for (const operation of operations) expect(operation).not.toHaveBeenCalled();
  });

  it('does not create a missing destination, choose its parent as fallback, or accept a file', async () => {
    const statfs = vi.spyOn(fs, 'statfs');
    const operations = noWritesOrSourceWalk();
    const missing = join(destination, 'missing', 'child');
    await expect(preflightImportCapacity(missing, requirements)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(preflightImportCapacity(join(destination, 'keep'), requirements)).rejects.toThrow(/非通常フォルダー/);
    expect(statfs).not.toHaveBeenCalled();
    for (const operation of operations) expect(operation).not.toHaveBeenCalled();
    expect(native.existsSync(join(destination, 'missing'))).toBe(false);
    expect(await fs.readFile(join(destination, 'keep'), 'utf8')).toBe('unchanged');
  });

  it('rejects UNC/device/relative/dot/ADS and unsafe names before touching the filesystem', async () => {
    const coercion = vi.fn(() => destination);
    const invalid: unknown[] = [undefined, null, 12, { toString: coercion }, '', 'relative', 'C:relative', '\\root-relative',
      '\\\\server\\share\\folder', '//server/share/folder', `\\\\?\\${destination}`, `\\\\.\\${destination}`,
      'file:///C:/folder', `${destination}\\..`, `${destination}\\.`, `${destination}\\link\\..\\child`,
      `${destination}\\NUL.txt`, `${destination}\\CONIN$`, `${destination}\\COM¹`, `${destination}\\trail.`,
      `${destination}\\trail `, `${destination}\\bad:stream`, `${destination}\\bad*name`, `${destination}\\bad?name`,
      `${destination}\\bad\0name`, `${destination}\\bad\nname`, `${destination}\\\ud800`, `${destination}\\\\child`,
      `${destination}\\${'a'.repeat(256)}`, `C:\\${'a\\'.repeat(16_384)}`];
    const lstat = vi.spyOn(native, 'lstatSync');
    const realpath = vi.spyOn(native.realpathSync, 'native');
    const statfs = vi.spyOn(fs, 'statfs');
    for (const value of invalid) await expect(preflightImportCapacity(value as string, requirements)).rejects.toBeInstanceOf(TypeError);
    for (const operation of [lstat, realpath, statfs, coercion]) expect(operation).not.toHaveBeenCalled();
  });

  it('accepts ASCII case/separator spelling only after checking original and canonical identities', async () => {
    const statfs = vi.spyOn(fs, 'statfs').mockResolvedValue(disk);
    const lstat = vi.spyOn(native, 'lstatSync');
    const spelling = `${destination.toUpperCase().replaceAll('\\', '/')}/`;
    expect(await preflightImportCapacity(spelling, requirements)).toEqual(calculateImportCapacity(input));
    expect(statfs).toHaveBeenCalledExactlyOnceWith(destination, { bigint: true });
    expect(lstat).toHaveBeenCalledWith(destination.toUpperCase(), { bigint: true });
    expect(lstat).toHaveBeenCalledWith(destination, { bigint: true });
  });

  it('does not adopt a short-name or redirected canonical alias returned by realpath', async () => {
    const elsewhere = join(temporary, 'elsewhere');
    vi.spyOn(native.realpathSync, 'native').mockReturnValue(elsewhere);
    const lstat = vi.spyOn(native, 'lstatSync');
    const statfs = vi.spyOn(fs, 'statfs');
    await expect(preflightImportCapacity(destination, requirements)).rejects.toThrow(/別名/);
    expect(statfs).not.toHaveBeenCalled();
    expect(lstat.mock.calls.some(([path]) => path === elsewhere)).toBe(false);
    expect(native.existsSync(elsewhere)).toBe(false);
  });

  it('does not treat equal folded spellings with different physical identities as the same directory', async () => {
    const spelling = destination.toUpperCase();
    const actualLstat = native.lstatSync.bind(native);
    vi.spyOn(native, 'lstatSync').mockImplementation(((path, options) =>
      actualLstat(path === spelling ? parent : path, options)) as typeof native.lstatSync);
    const statfs = vi.spyOn(fs, 'statfs');
    await expect(preflightImportCapacity(spelling, requirements)).rejects.toThrow(/変更/);
    expect(statfs).not.toHaveBeenCalled();
  });

  it.each(['destination', 'ancestor'] as const)('rejects an actual %s junction without querying its target', async (location) => {
    const alias = join(temporary, 'junction');
    await fs.symlink(location === 'destination' ? destination : parent, alias, 'junction');
    const selected = location === 'destination' ? alias : join(alias, win32.basename(destination));
    const statfs = vi.spyOn(fs, 'statfs');
    const realpath = vi.spyOn(native.realpathSync, 'native');
    const operations = noWritesOrSourceWalk();
    await expect(preflightImportCapacity(selected, requirements)).rejects.toThrow(/リンク/);
    expect(statfs).not.toHaveBeenCalled();
    expect(realpath).not.toHaveBeenCalled();
    for (const operation of operations) expect(operation).not.toHaveBeenCalled();
    expect(await fs.readFile(join(destination, 'keep'), 'utf8')).toBe('unchanged');
  });

  it('rejects an actual directory symlink before statfs', async ({ skip }) => {
    const alias = join(temporary, 'symlink');
    try { await fs.symlink(destination, alias, 'dir'); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') { skip(); return; }
      throw error;
    }
    const statfs = vi.spyOn(fs, 'statfs');
    await expect(preflightImportCapacity(alias, requirements)).rejects.toThrow(/リンク/);
    expect(statfs).not.toHaveBeenCalled();
  });

  it.each([['dev', -1n], ['dev', 0], ['ino', 0n], ['ino', -1n], ['ino', '1'], ['birthtimeNs', undefined], ['birthtimeNs', 1]] as const)
    ('rejects unusable directory identity metadata: %s (case %#)', async (field, value) => {
      const actualLstat = native.lstatSync.bind(native);
      vi.spyOn(native, 'lstatSync').mockImplementation(((path, options) => {
        const stat = actualLstat(path, options);
        return path === destination ? Object.assign(stat, { [field]: value }) : stat;
      }) as typeof native.lstatSync);
      const statfs = vi.spyOn(fs, 'statfs');
      await expect(preflightImportCapacity(destination, requirements)).rejects.toThrow(/同一性/);
      expect(statfs).not.toHaveBeenCalled();
    });

  it.each(['dev', 'ino', 'birthtimeNs'] as const)('detects even a drive-root %s change after the statfs await', async (field) => {
    let queried = false;
    vi.spyOn(fs, 'statfs').mockImplementation(async () => { await Promise.resolve(); queried = true; return disk; });
    const actualLstat = native.lstatSync.bind(native);
    vi.spyOn(native, 'lstatSync').mockImplementation(((path, options) => {
      const stat = actualLstat(path, options);
      if (queried && path === win32.parse(destination).root) {
        const value = Reflect.get(stat, field) as bigint;
        Object.assign(stat, { [field]: value + 1n });
      }
      return stat;
    }) as typeof native.lstatSync);
    const operations = noWritesOrSourceWalk();
    await expect(preflightImportCapacity(destination, requirements)).rejects.toThrow(/変更/);
    for (const operation of operations) expect(operation).not.toHaveBeenCalled();
  });

  it.each(['destination', 'ancestor', 'junction'] as const)('rejects a real %s replacement during statfs without modifying either tree', async (location) => {
    const retained = join(temporary, 'retained');
    const before = native.lstatSync(destination, { bigint: true });
    // Save fixture-only mutations before the spies: any production mutation
    // remains observable, while the deliberate external replacement is separate.
    const rename = native.renameSync.bind(native);
    const mkdir = native.mkdirSync.bind(native);
    const write = native.writeFileSync.bind(native);
    const symlink = native.symlinkSync.bind(native);
    const statfs = vi.spyOn(fs, 'statfs').mockImplementation(async () => {
      await Promise.resolve();
      if (location === 'ancestor') {
        rename(parent, retained);
        mkdir(parent);
        rename(join(retained, win32.basename(destination)), destination);
      } else {
        rename(destination, retained);
        if (location === 'junction') symlink(retained, destination, 'junction');
        else { mkdir(destination); write(join(destination, 'unknown'), 'replacement'); }
      }
      return disk;
    });
    const operations = noWritesOrSourceWalk();
    await expect(preflightImportCapacity(destination, requirements)).rejects.toThrow(/変更|リンク/);
    expect(statfs).toHaveBeenCalledExactlyOnceWith(destination, { bigint: true });
    for (const operation of operations) expect(operation).not.toHaveBeenCalled();
    if (location === 'ancestor') {
      // The leaf is the original real directory: a leaf-only check would miss this.
      expect(native.lstatSync(destination, { bigint: true })).toMatchObject({ dev: before.dev, ino: before.ino, birthtimeNs: before.birthtimeNs });
      expect(await fs.readFile(join(destination, 'keep'), 'utf8')).toBe('unchanged');
      expect(await fs.readdir(retained)).toEqual([]);
    } else {
      expect(await fs.readFile(join(retained, 'keep'), 'utf8')).toBe('unchanged');
      if (location === 'destination') expect(await fs.readFile(join(destination, 'unknown'), 'utf8')).toBe('replacement');
    }
  });

  it('rejects a changed canonical mapping after statfs even when lstat identities remain unchanged', async () => {
    let queried = false;
    vi.spyOn(fs, 'statfs').mockImplementation(async () => { await Promise.resolve(); queried = true; return disk; });
    const actualRealpath = native.realpathSync.native.bind(native.realpathSync);
    vi.spyOn(native.realpathSync, 'native').mockImplementation(((path: native.PathLike) =>
      queried && path === destination ? join(temporary, 'redirected') : actualRealpath(path)) as typeof native.realpathSync.native);
    await expect(preflightImportCapacity(destination, requirements)).rejects.toThrow(/変更/);
    expect(native.existsSync(join(temporary, 'redirected'))).toBe(false);
  });

  it('tolerates normal sibling activity and directory timestamp changes without rebasing identity', async () => {
    const sibling = join(parent, 'sibling');
    const write = native.writeFileSync.bind(native);
    const utimes = native.utimesSync.bind(native);
    const before = native.lstatSync(parent, { bigint: true });
    vi.spyOn(fs, 'statfs').mockImplementation(async () => {
      await Promise.resolve();
      write(sibling, 'unrelated activity');
      utimes(parent, new Date(0), new Date(0));
      utimes(destination, new Date(0), new Date(0));
      return disk;
    });
    const operations = noWritesOrSourceWalk();
    expect(await preflightImportCapacity(destination, requirements)).toEqual(calculateImportCapacity(input));
    for (const operation of operations) expect(operation).not.toHaveBeenCalled();
    expect(native.lstatSync(parent, { bigint: true })).toMatchObject({ dev: before.dev, ino: before.ino, birthtimeNs: before.birthtimeNs, mtimeNs: 0n });
    expect(await fs.readFile(sibling, 'utf8')).toBe('unrelated activity');
    expect(await fs.readFile(join(destination, 'keep'), 'utf8')).toBe('unchanged');
  });
});