// @vitest-environment node
import childProcess, { type ExecFileException } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { hardwareDiagnosticsSchema, type HardwareDiagnostics } from '../../shared/contracts/diagnostics.js';
import { createDiagnosticsService } from './diagnostics-service.js';

// Capture the real implementation before any test installs an execFile spy.
const nativeExecFile = childProcess.execFile.bind(childProcess);

// Synthetic contract data only; never starts Python or probes the host.
function report(): HardwareDiagnostics {
  return {
    schemaVersion: 1, command: 'probe-hardware', status: 'ok',
    os: { status: 'ok', data: { name: 'Windows', major: 10, minor: 0, build: 26100, productType: 1, architecture: 'AMD64' }, error: null },
    cpu: { status: 'ok', data: { logicalCount: 8, name: 'Synthetic CPU' }, error: null },
    memory: { status: 'ok', data: { totalBytes: 100, availableBytes: 50, loadPercent: 50 }, error: null },
    disk: { status: 'ok', data: { totalBytes: 100, usedBytes: 40, freeBytes: 60 }, error: null },
    gpu: { status: 'ok', data: { adapters: [], scope: 'current-session-display-adapters', computeStatus: 'not_checked' }, error: null },
    onnxRuntime: { status: 'ok', data: { version: 'synthetic', providers: [], executionStatus: 'not_checked' }, error: null },
    cuda: { status: 'ok', data: { torchVersion: 'synthetic', runtimeVersion: null, available: false, scope: 'torch-runtime-only', executionStatus: 'not_checked', physicalGpuPresence: null }, error: null },
    camera: { status: 'deferred', streamOpened: false, reasonCode: 'check-on-inference-start' },
  };
}
function early(disk = false): HardwareDiagnostics {
  const unchecked = { status: 'not_checked', data: null, error: null } as const;
  const value: HardwareDiagnostics = { ...report(), status: 'error', os: unchecked, cpu: unchecked,
    memory: unchecked, disk: unchecked, gpu: unchecked, onnxRuntime: unchecked, cuda: unchecked };
  if (disk) value.disk = { status: 'error', data: null, error: { code: 'invalid-disk-path', causeType: 'ValueError' } };
  else value.os = { status: 'error', data: null, error: { code: 'unsupported-os', causeType: null } };
  return value;
}
function config() {
  return { executablePath: resolve('synthetic worker.exe'), argsPrefix: ['-m', 'autovision_ml.cli'],
    cwd: resolve('synthetic cwd'), diskPath: resolve('synthetic disk') };
}
function nativeError(code: string | number, extra: Partial<ExecFileException> = {}): ExecFileException {
  return Object.assign(new Error('PRIVATE path / command / stderr'), { code }, extra);
}
function expectSanitized(error: unknown, code: string): void {
  expect(error).toBeInstanceOf(Error);
  expect(error).toMatchObject({ message: 'Hardware diagnostics unavailable.', code });
  expect(String(error)).toBe('Error: Hardware diagnostics unavailable.');
  expect(JSON.stringify(error)).toBe(JSON.stringify({ code }));
  expect(error).not.toHaveProperty('cause');
  expect((error as Error).stack).not.toContain('PRIVATE');
}
type Callback = NonNullable<Parameters<typeof childProcess.execFile>[3]>;
function harness(beforeReturn?: (callback: Callback, child: childProcess.ChildProcess) => void) {
  const calls: { callback: Callback; child: childProcess.ChildProcess; kill: ReturnType<typeof vi.fn<() => boolean>> }[] = [];
  const exec = vi.spyOn(childProcess, 'execFile').mockImplementation((_file, _args, _options, callback) => {
    if (!callback) throw new Error('Expected execFile callback');
    const child = new childProcess.ChildProcess(); // No spawn; native methods are never executed.
    const kill = vi.fn(() => true);
    vi.spyOn(child, 'kill').mockImplementation(kill);
    calls.push({ callback, child, kill });
    beforeReturn?.(callback, child);
    return child;
  });
  function complete(error: ExecFileException | null = null, stdout = JSON.stringify(report()), stderr = '', index = 0): void {
    const call = calls[index];
    if (!call) throw new Error('Expected pending child');
    call.callback(error, stdout, stderr);
    call.child.emit('close', error?.code ?? 0, error?.signal ?? null);
  }
  return { exec, calls, complete };
}
afterEach(() => vi.restoreAllMocks());

describe('diagnostics subprocess transport', () => {
  it('is lazy, snapshots all config, coalesces, and starts fresh after completion', async () => {
    const h = harness(); const input = config(); const original = structuredClone(input);
    const service = createDiagnosticsService(input);
    expect(h.exec).not.toHaveBeenCalled();
    input.argsPrefix.splice(0, 2, '-c', 'PRIVATE'); input.executablePath = 'PRIVATE'; input.cwd = 'PRIVATE'; input.diskPath = 'PRIVATE';
    const first = service.collect(); expect(service.collect()).toBe(first);
    expect(h.exec).toHaveBeenCalledExactlyOnceWith(original.executablePath,
      [...original.argsPrefix, 'probe-hardware', '--disk-path', original.diskPath],
      { cwd: original.cwd, shell: false, windowsHide: true, encoding: 'utf8', timeout: 30_000, maxBuffer: 262144 }, expect.any(Function));
    h.complete(null, ` \n${JSON.stringify(report())}\r\n`); await expect(first).resolves.toEqual(report());
    const next = service.collect(); expect(next).not.toBe(first); h.complete(null, JSON.stringify(report()), '', 1); await next;
    service.dispose(); expect(h.calls.every((call) => call.kill.mock.calls.length === 0)).toBe(true);
  });

  it.each([false, true])('returns exit-1 reports and exit-2 invalid-disk reports (%s)', async (disk) => {
    const h = harness(); const promise = createDiagnosticsService(config()).collect();
    h.complete(nativeError(disk ? 2 : 1), JSON.stringify(early(disk)));
    await expect(promise).resolves.toEqual(early(disk));
  });
  it('returns a partial report on exit 1, and supports the packaged empty prefix', async () => {
    const h = harness(); const partial = report(); partial.status = 'partial';
    partial.cpu = { status: 'error', data: null, error: { code: 'cpu-probe-failed', causeType: 'OSError' } };
    const promise = createDiagnosticsService({ ...config(), argsPrefix: [] }).collect();
    expect(h.exec.mock.calls[0]?.[1]).toEqual(['probe-hardware', '--disk-path', config().diskPath]);
    h.complete(nativeError(1), JSON.stringify(partial)); await expect(promise).resolves.toEqual(partial);
  });

  it.each([
    ['unknown exit', nativeError(3), JSON.stringify(report()), ''],
    ['signal', nativeError(1, { signal: 'SIGTERM' }), JSON.stringify(early()), ''],
    ['timeout', nativeError(1, { killed: true }), JSON.stringify(early()), ''],
    ['missing executable', nativeError('ENOENT'), '', ''],
    ['spawn permission', nativeError('EACCES'), '', ''],
    ['buffer error', nativeError('ERR_CHILD_PROCESS_STDIO_MAXBUFFER'), JSON.stringify(report()), ''],
    ['stderr', null, JSON.stringify(report()), 'PRIVATE'],
    ['whitespace stderr', null, JSON.stringify(report()), '\n'],
    ['invalid JSON', null, '{PRIVATE', ''], ['trailing junk', null, `${JSON.stringify(report())} PRIVATE`, ''],
    ['two JSON objects', null, `${JSON.stringify(report())}${JSON.stringify(report())}`, ''],
    ['array', null, '[]', ''], ['null', null, 'null', ''], ['schema', null, '{}', ''],
    ['exit0/error', null, JSON.stringify(early()), ''],
    ['exit1/ok', nativeError(1), JSON.stringify(report()), ''],
    ['exit2/other', nativeError(2), JSON.stringify(early()), ''],
    ['exit1/invalid disk', nativeError(1), JSON.stringify(early(true)), ''],
    ['zero-coded exception', nativeError(0), JSON.stringify(report()), ''],
    ['utf8 overflow', null, `${JSON.stringify(report())}${' '.repeat(262144)}`, ''],
  ] satisfies [string, ExecFileException | null, string, string][])('sanitizes %s', async (_name, error, stdout, stderr) => {
    const h = harness(); const promise = createDiagnosticsService(config()).collect(); h.complete(error, stdout, stderr);
    await expect(promise).rejects.toMatchObject({ message: 'Hardware diagnostics unavailable.', code: 'DIAGNOSTICS_FAILED' });
  });

  // Callback-only cases bypass native maxBuffer to test the service's own byte guard.
  it('rejects valid multibyte JSON below the character limit but above 256 KiB in UTF-8', async () => {
    const value = report();
    value.cpu = { status: 'ok', data: { logicalCount: 8, name: 'あ'.repeat(100_000) }, error: null };
    const stdout = JSON.stringify(value);
    expect(hardwareDiagnosticsSchema.safeParse(JSON.parse(stdout)).success).toBe(true);
    expect(stdout.length).toBeLessThan(256 * 1024);
    expect(Buffer.byteLength(stdout, 'utf8')).toBeGreaterThan(256 * 1024);
    const h = harness(); const pending = createDiagnosticsService(config()).collect(); h.complete(null, stdout);
    expectSanitized(await pending.catch((error: unknown) => error), 'DIAGNOSTICS_FAILED');
  });
  it.each([0, 1])('checks valid whitespace-padded ASCII JSON at 256 KiB + %i bytes', async (extra) => {
    const value = report(); const stdout = JSON.stringify(value).padEnd(256 * 1024 + extra, ' ');
    expect(stdout.length).toBe(256 * 1024 + extra);
    expect(Buffer.byteLength(stdout, 'utf8')).toBe(256 * 1024 + extra);
    expect(JSON.parse(stdout)).toEqual(value);
    const h = harness(); const pending = createDiagnosticsService(config()).collect(); h.complete(null, stdout);
    if (extra === 0) await expect(pending).resolves.toEqual(value);
    else expectSanitized(await pending.catch((error: unknown) => error), 'DIAGNOSTICS_FAILED');
  });

  it.each(['executablePath', 'cwd', 'diskPath'] as const)('rejects relative/NUL/empty %s before exec', (key) => {
    const h = harness();
    for (const value of ['', 'relative', `${resolve('private')}\0`]) {
      expect(() => createDiagnosticsService({ ...config(), [key]: value })).toThrow('Hardware diagnostics unavailable.');
    }
    expect(h.exec).not.toHaveBeenCalled();
  });
  it.each([['-c', 'PRIVATE'], ['-m', 'other'], ['\0'], ['-m', 'autovision_ml.cli', '--extra']])('rejects unsupported prefix %#', (...argsPrefix) => {
    const h = harness(); expect(() => createDiagnosticsService({ ...config(), argsPrefix })).toThrow('Hardware diagnostics unavailable.');
    expect(h.exec).not.toHaveBeenCalled();
  });
  it('sanitizes synchronous throws and permits a subsequent collection', async () => {
    const h = harness(); h.exec.mockImplementationOnce(() => { throw nativeError('PRIVATE'); });
    const service = createDiagnosticsService(config()); await expect(service.collect()).rejects.toThrow('Hardware diagnostics unavailable.');
    const next = service.collect(); h.complete(); await next;
  });
  it('cancels only its own child once and ignores late/double callbacks', async () => {
    const h = harness(); const own = createDiagnosticsService(config()); const other = createDiagnosticsService(config());
    const pending = own.collect(); const second = other.collect(); own.dispose(); own.dispose();
    await expect(pending).rejects.toMatchObject({ code: 'DIAGNOSTICS_DISPOSED' });
    expect(h.calls[0]?.kill).toHaveBeenCalledOnce(); expect(h.calls[1]?.kill).not.toHaveBeenCalled();
    h.complete(); h.complete(); h.complete(null, JSON.stringify(report()), '', 1); await second;
    await expect(own.collect()).rejects.toMatchObject({ code: 'DIAGNOSTICS_DISPOSED' }); expect(h.exec).toHaveBeenCalledTimes(2);
  });
  it.each(['returns false', 'throws', 'already killed'] as const)('disposes once without retry or another child when kill %s', async (mode) => {
    const h = harness(); const own = createDiagnosticsService(config()); const other = createDiagnosticsService(config());
    const success = vi.fn<(value: HardwareDiagnostics) => void>(); const rejected = vi.fn<(error: unknown) => void>();
    const pending = own.collect(); const observed = pending.then(success, rejected); const second = other.collect();
    const call = h.calls[0]; if (!call) throw new Error('Expected owned child');
    if (mode === 'returns false') call.kill.mockReturnValue(false);
    else if (mode === 'throws') call.kill.mockImplementation(() => { throw nativeError('EACCES'); });
    else Object.defineProperty(call.child, 'killed', { value: true });

    own.dispose(); own.dispose(); await observed;
    expect(rejected).toHaveBeenCalledOnce();
    expectSanitized(rejected.mock.calls[0]?.[0], 'DIAGNOSTICS_DISPOSED');
    // No bare 'error' emission: execFile forwards native errors through its callback.
    h.complete(nativeError('EACCES'), '', 'PRIVATE'); h.complete(); await observed;
    expect(success).not.toHaveBeenCalled(); expect(rejected).toHaveBeenCalledOnce();
    own.dispose();
    await expect(own.collect()).rejects.toMatchObject({ code: 'DIAGNOSTICS_DISPOSED' });
    expect(call.kill).toHaveBeenCalledTimes(mode === 'already killed' ? 0 : 1);
    expect(h.calls[1]?.kill).not.toHaveBeenCalled(); expect(h.exec).toHaveBeenCalledTimes(2);
    expect(other.collect()).toBe(second);
    h.complete(null, JSON.stringify(report()), '', 1); await expect(second).resolves.toEqual(report()); other.dispose();
  });
  it('sanitizes a native error callback once and ignores a late success without retry', async () => {
    const h = harness(); const service = createDiagnosticsService(config());
    const success = vi.fn<(value: HardwareDiagnostics) => void>(); const rejected = vi.fn<(error: unknown) => void>();
    const observed = service.collect().then(success, rejected);
    h.complete(nativeError('EACCES'), '', 'PRIVATE'); await observed;
    expectSanitized(rejected.mock.calls[0]?.[0], 'DIAGNOSTICS_FAILED');
    h.complete(); await observed; service.dispose();
    expect(rejected).toHaveBeenCalledOnce(); expect(success).not.toHaveBeenCalled();
    expect(h.exec).toHaveBeenCalledOnce(); expect(h.calls[0]?.kill).not.toHaveBeenCalled();
  });
  it('handles reentrant collect/dispose before child registration', async () => {
    let service: ReturnType<typeof createDiagnosticsService>; let shared: Promise<HardwareDiagnostics> | undefined;
    const h = harness(() => { shared = service.collect(); service.dispose(); }); service = createDiagnosticsService(config());
    const pending = service.collect(); expect(shared).toBe(pending);
    await expect(pending).rejects.toMatchObject({ code: 'DIAGNOSTICS_DISPOSED' }); expect(h.calls[0]?.kill).toHaveBeenCalledOnce();
  });
  it('handles synchronous completion followed by disposal without killing a finished child', async () => {
    let service: ReturnType<typeof createDiagnosticsService>;
    const h = harness((callback) => { callback(null, JSON.stringify(report()), ''); service.dispose(); callback(nativeError(3), '', 'PRIVATE'); });
    service = createDiagnosticsService(config()); await expect(service.collect()).resolves.toEqual(report());
    expect(h.calls[0]?.kill).not.toHaveBeenCalled();
  });
  it('does not kill a child that has exited before its completion callback', async () => {
    const h = harness(); const service = createDiagnosticsService(config()); const pending = service.collect();
    Object.defineProperty(h.calls[0]?.child, 'exitCode', { value: 0 }); service.dispose();
    await expect(pending).rejects.toMatchObject({ code: 'DIAGNOSTICS_DISPOSED' }); expect(h.calls[0]?.kill).not.toHaveBeenCalled(); h.complete();
  });
});

type NativeClose = { code: number | null; signal: NodeJS.Signals | null };
async function withinDeadline<T>(pending: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([pending, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Native child test deadline exceeded.')), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}
async function withNativeProbe(source: string, check: (
  pending: Promise<HardwareDiagnostics>, child: childProcess.ChildProcess, close: Promise<NativeClose>, directory: string,
) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'autovision-diagnostics-PRIVATE-'));
  const children: { child: childProcess.ChildProcess; close: Promise<NativeClose>; closed: boolean }[] = [];
  let service: ReturnType<typeof createDiagnosticsService> | undefined;
  try {
    await writeFile(join(directory, 'probe-hardware'), source, 'utf8');
    const exec = vi.spyOn(childProcess, 'execFile').mockImplementation((file, args, options, callback) => {
      const child = nativeExecFile(file, args, options, callback);
      const close = Promise.withResolvers<NativeClose>();
      const owned = { child, close: close.promise, closed: false }; children.push(owned);
      // Observe close immediately on spawn, not after collect's callback or a kill request.
      child.once('close', (code: number | null, signal: NodeJS.Signals | null) => {
        owned.closed = true; close.resolve({ code, signal });
      });
      return child;
    });
    service = createDiagnosticsService({ executablePath: process.execPath, argsPrefix: [], cwd: directory, diskPath: directory });
    const pending = service.collect();
    void pending.catch(() => undefined); // Also handled if an assertion fails before check attaches.
    expect(exec).toHaveBeenCalledExactlyOnceWith(process.execPath, ['probe-hardware', '--disk-path', directory],
      { cwd: directory, shell: false, windowsHide: true, encoding: 'utf8', timeout: 30_000, maxBuffer: 256 * 1024 }, expect.any(Function));
    const owned = children[0]; if (!owned) throw new Error('Expected native Node child');
    await withinDeadline(check(pending, owned.child, owned.close, directory), 35_000);
  } finally {
    try {
      for (const owned of children) {
        if (!owned.closed && owned.child.exitCode === null && owned.child.signalCode === null) {
          try { owned.child.kill(); } catch { /* Still require observed close below. */ }
        }
      }
      await withinDeadline(Promise.all(children.map((owned) => owned.close)), 5_000);
      await rm(directory, { recursive: true, force: true }); // Only after every owned child closed.
    } finally { service?.dispose(); }
  }
}

// Actual Node transport with synthetic fixtures only: no Python, worker, camera or network probe.
describe('diagnostics native Node subprocess transport', () => {
  it.each([0, 1])('reads a synthetic valid report from a real Node child with exit %i', async (exitCode) => {
    const value = report();
    if (exitCode === 1) {
      value.status = 'partial';
      value.cpu = { status: 'error', data: null, error: { code: 'cpu-probe-failed', causeType: 'OSError' } };
    }
    await withNativeProbe(`process.stdout.write(${JSON.stringify(JSON.stringify(value))}); process.exitCode = ${exitCode};`,
      async (pending, child, close) => {
        await expect(pending).resolves.toEqual(value);
        await expect(close).resolves.toEqual({ code: exitCode, signal: null });
        expect(child.exitCode).toBe(exitCode); expect(child.killed).toBe(false);
      });
  }, 45_000);

  it('rejects a synthetic hanging Node child at the real 30-second timeout and observes SIGTERM close', async () => {
    const started = performance.now();
    // This deliberate no-output hang tests native timeout, not an actual worker/camera hang.
    await withNativeProbe('setInterval(() => {}, 1000);', async (pending, child, close, directory) => {
      const error = await pending.catch((failure: unknown) => failure);
      expectSanitized(error, 'DIAGNOSTICS_FAILED');
      expect((error as Error).stack).not.toContain(directory);
      await expect(close).resolves.toEqual({ code: null, signal: 'SIGTERM' });
      expect(child.killed).toBe(true); expect(child.signalCode).toBe('SIGTERM'); expect(child.exitCode).toBeNull();
      expect(performance.now() - started).toBeGreaterThanOrEqual(29_000);
      expect(performance.now() - started).toBeLessThan(45_000);
    });
  }, 45_000);
});