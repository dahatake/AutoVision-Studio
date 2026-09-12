// @vitest-environment node
import { describe, expect, expectTypeOf, it } from 'vitest';

import { hardwareDiagnosticsSchema, type HardwareDiagnostics } from './diagnostics.js';

// Explicitly synthetic fixtures matching the Python collector test shape, NOT
// native observations or evidence of hardware/inference support.
const groups = ['os', 'cpu', 'memory', 'disk', 'gpu', 'onnxRuntime', 'cuda'] as const;
const causes = ['ImportError', 'OSError', 'ValueError', 'TypeError', 'RuntimeError', 'Exception', null] as const;
function syntheticReport() {
  return {
    schemaVersion: 1, command: 'probe-hardware', status: 'ok',
    os: { status: 'ok', data: { name: 'Windows', major: 10, minor: 0, build: 26100, productType: 1, architecture: 'AMD64' }, error: null },
    cpu: { status: 'ok', data: { logicalCount: 8, name: 'Synthetic CPU 日本語' }, error: null },
    memory: { status: 'ok', data: { totalBytes: 8000, availableBytes: 6000, loadPercent: 25 }, error: null },
    disk: { status: 'ok', data: { totalBytes: 100, usedBytes: 40, freeBytes: 60 }, error: null },
    gpu: { status: 'ok', data: { adapters: [{ DeviceName: 'DISPLAY1', DeviceString: 'Synthetic GPU', StateFlags: 1 }], scope: 'current-session-display-adapters', computeStatus: 'not_checked' }, error: null },
    onnxRuntime: { status: 'ok', data: { version: '1.24.4', providers: ['DmlExecutionProvider', 'CPUExecutionProvider'], executionStatus: 'not_checked' }, error: null },
    cuda: { status: 'ok', data: { torchVersion: '2.11.0+cpu', runtimeVersion: null, available: false, scope: 'torch-runtime-only', executionStatus: 'not_checked', physicalGpuPresence: null }, error: null },
    camera: { status: 'deferred', streamOpened: false, reasonCode: 'check-on-inference-start' },
  } satisfies HardwareDiagnostics;
}

function syntheticUnchecked(): Record<string, unknown> {
  const report: Record<string, unknown> = syntheticReport();
  report.status = 'error';
  for (const group of groups) report[group] = { status: 'not_checked', data: null, error: null };
  return report;
}

function syntheticFailures(): Record<string, unknown> {
  const report = syntheticUnchecked();
  for (const group of groups) {
    report[group] = { status: 'error', data: null, error: { code: `${group}-probe-failed`, causeType: 'RuntimeError' } };
  }
  return report;
}

type ObjectPath = (string | number)[];
function objectPaths(value: unknown, path: ObjectPath = []): ObjectPath[] {
  if (value === null || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap((item: unknown, index) => objectPaths(item, [...path, index]));
  return [path, ...Object.entries(value).flatMap(([key, item]) => objectPaths(item, [...path, key]))];
}
function objectAt(value: unknown, path: ObjectPath): Record<string, unknown> {
  for (const key of path) value = (value as Record<string | number, unknown>)[key];
  return value as Record<string, unknown>;
}
function changed(path: ObjectPath, key: string, value: unknown): unknown {
  const report = syntheticReport();
  objectAt(report, path)[key] = value;
  return report;
}

describe('CORE-12-C actual-observation contract (synthetic fixtures)', () => {
  it('preserves the full Python-shaped JSON report without inventing a twelfth key', () => {
    const fixture = syntheticReport();
    const json: unknown = JSON.parse(JSON.stringify(fixture));
    const report = hardwareDiagnosticsSchema.parse(json);
    expect(report).toEqual(fixture);
    expect(Object.keys(report).sort()).toEqual([
      'schemaVersion', 'command', 'status', ...groups, 'camera',
    ].sort());
    expectTypeOf(report).toEqualTypeOf<HardwareDiagnostics>();
    if (report.cpu.status === 'ok') {
      expectTypeOf(report.cpu.data.logicalCount).toEqualTypeOf<number>();
      expectTypeOf(report.cpu.error).toEqualTypeOf<null>();
    }
    if (report.os.status === 'error') {
      expectTypeOf(report.os.error.code).toEqualTypeOf<'unsupported-os' | 'os-probe-failed'>();
      expectTypeOf(report.os.data).toEqualTypeOf<null>();
    }
  });

  it.each([
    { logicalCount: null, name: 'Synthetic CPU' },
    { logicalCount: 0, name: 'Synthetic CPU' },
    { logicalCount: 8, name: null },
    { logicalCount: null, name: null },
    null,
  ])('preserves CPU unavailable data %# without substituting a count', (data) => {
    const report = { ...syntheticReport(), status: 'partial', cpu: {
      status: 'error', data, error: { code: 'cpu-data-unavailable', causeType: null },
    } };
    expect(hardwareDiagnosticsSchema.parse(report)).toEqual(report);
  });

  it.each([
    ['os', 'unsupported-os', null],
    ['disk', 'invalid-disk-path', 'ValueError'],
    ['disk', 'invalid-disk-path', 'OSError'],
    ['disk', 'invalid-disk-path', 'TypeError'],
  ] as const)('accepts %s early exit %s with untouched groups', (group, code, causeType) => {
    const report = syntheticUnchecked();
    report[group] = { status: 'error', data: null, error: { code, causeType } };
    expect(hardwareDiagnosticsSchema.parse(report)).toEqual(report);
    const other = group === 'os' ? 'cpu' : 'os';
    report[other] = syntheticReport()[other];
    report.status = 'partial';
    expect(hardwareDiagnosticsSchema.safeParse(report).success).toBe(false);
    report[other] = { status: 'error', data: null, error: { code: `${other}-probe-failed`, causeType: null } };
    report.status = 'error';
    expect(hardwareDiagnosticsSchema.safeParse(report).success).toBe(false);
  });

  it.each(groups)('isolates %s I/O/import failures and sanitizes cause types', (group) => {
    for (const causeType of causes) {
      const failure = { status: 'error', data: null, error: { code: `${group}-probe-failed`, causeType } };
      const report = { ...syntheticReport(), status: 'partial', [group]: failure };
      expect(hardwareDiagnosticsSchema.parse(report)).toEqual(report);
      expect(hardwareDiagnosticsSchema.safeParse({ ...report, [group]: { ...failure, data: syntheticReport()[group].data } }).success).toBe(false);
      for (const code of ['unknown', 'onnxruntime-probe-failed', group === 'cpu' ? 'os-probe-failed' : 'cpu-probe-failed']) {
        expect(hardwareDiagnosticsSchema.safeParse({ ...report, [group]: { ...failure, error: { code, causeType } } }).success).toBe(false);
      }
      for (const cause of ['PermissionError', 'PrivateException', 'C:\\private\\user', 1]) {
        expect(hardwareDiagnosticsSchema.safeParse({ ...report, [group]: { ...failure, error: { ...failure.error, causeType: cause } } }).success).toBe(false);
      }
    }
  });

  it('accepts bounded adapter failure and no-success summaries', () => {
    const report = { ...syntheticReport(), status: 'partial', gpu: {
      status: 'error', data: null, error: { code: 'display-adapter-limit-exceeded', causeType: null },
    } };
    expect(hardwareDiagnosticsSchema.parse(report)).toEqual(report);
    expect(hardwareDiagnosticsSchema.parse(syntheticFailures()).status).toBe('error');
    expect(hardwareDiagnosticsSchema.parse(syntheticUnchecked()).status).toBe('error');
  });

  it.each([0, 1, 2, 3, 4, 5, 6, 7])('counts all seven groups including repeated statuses: %i ok', (okCount) => {
    for (const base of [syntheticFailures(), syntheticUnchecked()]) {
      for (const group of groups.slice(0, okCount)) base[group] = syntheticReport()[group];
      const expected = okCount === 7 ? 'ok' : okCount > 0 ? 'partial' : 'error';
      for (const status of ['ok', 'partial', 'error']) {
        expect(hardwareDiagnosticsSchema.safeParse({ ...base, status }).success).toBe(status === expected);
      }
    }
  });

  it('requires every key and rejects unknown keys recursively in every variant', () => {
    const cpuMissing = { ...syntheticReport(), status: 'partial', cpu: {
      status: 'error', data: { logicalCount: null, name: null }, error: { code: 'cpu-data-unavailable', causeType: null },
    } };
    for (const fixture of [syntheticReport(), syntheticFailures(), syntheticUnchecked(), cpuMissing]) {
      expect(hardwareDiagnosticsSchema.safeParse(fixture).success).toBe(true);
      for (const path of objectPaths(fixture)) {
        for (const key of Object.keys(objectAt(fixture, path))) {
          const candidate = structuredClone(fixture);
          delete objectAt(candidate, path)[key];
          expect(hardwareDiagnosticsSchema.safeParse(candidate).success, `missing ${[...path, key].join('.')}`).toBe(false);
        }
        for (const key of ['extra', 'DeviceID', 'DeviceKey', 'path', 'diskPath', 'message', 'stack', 'supportLevel', 'runtimeFlags']) {
          const candidate = structuredClone(fixture);
          objectAt(candidate, path)[key] = 'C:\\private\\user\\secret';
          expect(hardwareDiagnosticsSchema.safeParse(candidate).success, `unknown ${[...path, key].join('.')}`).toBe(false);
        }
      }
    }
  });

  it.each(groups)('rejects invalid %s status/data/error combinations without filling defaults', (group) => {
    const original = syntheticReport()[group];
    for (const value of [
      { ...original, data: null },
      { ...original, error: { code: `${group}-probe-failed`, causeType: null } },
      { ...original, status: 'not_checked' },
      { status: 'not_checked', data: null, error: { code: `${group}-probe-failed`, causeType: null } },
      { status: 'error', data: null, error: null },
      ...['partial', 'deferred', 'success', '', null].map((status) => ({ ...original, status })),
    ]) {
      // Other groups remain ok, so changing the summary cannot rescue a bad variant.
      for (const status of ['ok', 'partial']) {
        expect(hardwareDiagnosticsSchema.safeParse({ ...syntheticReport(), status, [group]: value }).success).toBe(false);
      }
    }
  });

  it('rejects fractional, nonfinite, unsafe, negative and coerced numeric fields', () => {
    const fields: [ObjectPath, string][] = [
      ...['major', 'minor', 'build', 'productType'].map((key): [ObjectPath, string] => [['os', 'data'], key]),
      [['cpu', 'data'], 'logicalCount'],
      ...['totalBytes', 'availableBytes', 'loadPercent'].map((key): [ObjectPath, string] => [['memory', 'data'], key]),
      ...['totalBytes', 'usedBytes', 'freeBytes'].map((key): [ObjectPath, string] => [['disk', 'data'], key]),
      [['gpu', 'data', 'adapters', 0], 'StateFlags'],
    ];
    for (const [path, key] of fields) {
      for (const value of [-1, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, true, '1', null]) {
        expect(hardwareDiagnosticsSchema.safeParse(changed(path, key, value)).success, `${path.join('.')}.${key}`).toBe(false);
      }
    }
  });

  it('checks byte relationships and native bounds, not invented hardware thresholds', () => {
    for (const [path, key, value] of [
      [['memory', 'data'], 'availableBytes', 8001],
      [['memory', 'data'], 'loadPercent', 101],
      [['disk', 'data'], 'usedBytes', 101],
      [['disk', 'data'], 'freeBytes', 101],
      [['disk', 'data'], 'freeBytes', 59],
      [['cpu', 'data'], 'logicalCount', 0],
      [['os', 'data'], 'productType', 0],
      [['os', 'data'], 'productType', 4],
      [['gpu', 'data', 'adapters', 0], 'StateFlags', 0x1_0000_0000],
    ] satisfies [ObjectPath, string, unknown][]) {
      expect(hardwareDiagnosticsSchema.safeParse(changed(path, key, value)).success).toBe(false);
    }
    const report = syntheticReport();
    report.memory.data = { totalBytes: 0, availableBytes: 0, loadPercent: 100 };
    report.disk.data = { totalBytes: Number.MAX_SAFE_INTEGER, usedBytes: Number.MAX_SAFE_INTEGER, freeBytes: 0 };
    report.gpu.data.adapters = [{ DeviceName: '', DeviceString: '', StateFlags: 0xffff_ffff }];
    expect(hardwareDiagnosticsSchema.parse(report)).toEqual(report);
    report.disk.data = { totalBytes: 0, usedBytes: 0, freeBytes: 0 };
    expect(hardwareDiagnosticsSchema.safeParse(report).success).toBe(true);
  });

  it('accepts unknown architecture/provider names and empty display enumeration without guessing capability', () => {
    const report = syntheticReport();
    report.os.data.architecture = '';
    report.onnxRuntime.data.providers = ['FutureExecutionProvider'];
    report.gpu.data.adapters = [];
    expect(hardwareDiagnosticsSchema.parse(report)).toEqual(report);
    report.os.data.architecture = 'unfamiliar-architecture';
    report.onnxRuntime.data.providers = [];
    expect(hardwareDiagnosticsSchema.parse(report)).toEqual(report);
    const cuda = { ...report.cuda, data: { ...report.cuda.data, runtimeVersion: '12.9', available: true } };
    expect(hardwareDiagnosticsSchema.parse({ ...report, cuda }).cuda).toEqual(cuda);
  });

  it('bounds successful adapter lists at 255 rather than truncating them', () => {
    const adapter = { DeviceName: '', DeviceString: '', StateFlags: 0 };
    for (const length of [255, 256]) {
      expect(hardwareDiagnosticsSchema.safeParse(changed(['gpu', 'data'], 'adapters', Array.from({ length }, () => ({ ...adapter })))).success).toBe(length === 255);
    }
  });

  it('rejects empty required names/versions and malformed provider or CPU missing-data fields', () => {
    for (const [path, key, value] of [
      [['cpu', 'data'], 'name', ''],
      [['onnxRuntime', 'data'], 'version', ''],
      [['onnxRuntime', 'data'], 'providers', ['']],
      [['onnxRuntime', 'data'], 'providers', [1]],
      [['onnxRuntime', 'data'], 'providers', 'CPUExecutionProvider'],
      [['cuda', 'data'], 'torchVersion', ''],
      [['cuda', 'data'], 'torchVersion', null],
      [['cuda', 'data'], 'runtimeVersion', ''],
      [['cuda', 'data'], 'available', 'false'],
    ] satisfies [ObjectPath, string, unknown][]) {
      expect(hardwareDiagnosticsSchema.safeParse(changed(path, key, value)).success).toBe(false);
    }
    for (const data of [{ logicalCount: 8, name: 'Synthetic CPU' }, { logicalCount: -1, name: null }, { logicalCount: 0.5, name: null }, { logicalCount: null, name: '' }]) {
      expect(hardwareDiagnosticsSchema.safeParse({ ...syntheticReport(), status: 'partial', cpu: {
        status: 'error', data, error: { code: 'cpu-data-unavailable', causeType: null },
      } }).success).toBe(false);
    }
  });

  it('rejects fake compute/camera evidence, altered headers/scopes and path-valued error codes', () => {
    for (const [path, key, value] of [
      [[], 'schemaVersion', 2], [[], 'schemaVersion', true], [[], 'command', 'health'],
      [['os', 'data'], 'name', 'Linux'],
      [['camera'], 'streamOpened', true], [['camera'], 'status', 'ok'], [['camera'], 'reasonCode', 'checked'],
      [['gpu', 'data'], 'scope', 'physical-gpus'], [['gpu', 'data'], 'computeStatus', 'ok'],
      [['onnxRuntime', 'data'], 'executionStatus', 'ok'],
      [['cuda', 'data'], 'executionStatus', 'ok'], [['cuda', 'data'], 'scope', 'all-gpus'],
      [['cuda', 'data'], 'physicalGpuPresence', true], [['cuda', 'data'], 'physicalGpuPresence', false],
    ] satisfies [ObjectPath, string, unknown][]) {
      expect(hardwareDiagnosticsSchema.safeParse(changed(path, key, value)).success).toBe(false);
    }
    const report = syntheticFailures();
    objectAt(report, ['disk', 'error']).code = 'C:\\private\\user';
    expect(hardwareDiagnosticsSchema.safeParse(report).success).toBe(false);
    for (const value of [null, undefined, [], 'probe-hardware']) {
      expect(hardwareDiagnosticsSchema.safeParse(value).success).toBe(false);
    }
  });
});