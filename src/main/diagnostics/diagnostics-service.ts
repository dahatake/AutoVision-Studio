import childProcess, { type ChildProcess } from 'node:child_process';
import { isAbsolute } from 'node:path';

import { hardwareDiagnosticsSchema, type HardwareDiagnostics } from '../../shared/contracts/diagnostics.js';

type WorkerConfig = {
  executablePath: string;
  argsPrefix: readonly string[];
  cwd: string;
  diskPath: string;
};

function failure(code = 'DIAGNOSTICS_FAILED'): Error {
  return Object.assign(new Error('Hardware diagnostics unavailable.'), { code });
}

// Trusted Main app-startup configuration ONLY, never IPC input. W08/PKG owns
// executable resolution: development Python [-m autovision_ml.cli], packaged [].
// This is not project ownership validation; the producer rejects network disks.
export function createDiagnosticsService(config: WorkerConfig): {
  collect(): Promise<HardwareDiagnostics>;
  /**
   * Reject pending work and request termination best-effort.
   * Does not wait for or confirm child termination.
   */
  dispose(): void;
} {
  const snapshot = Object.freeze({
    executablePath: config.executablePath,
    cwd: config.cwd,
    diskPath: config.diskPath,
    argsPrefix: Object.freeze([...config.argsPrefix]),
  });
  if (![snapshot.executablePath, snapshot.cwd, snapshot.diskPath].every(
    (value) => typeof value === 'string' && !value.includes('\0') && isAbsolute(value),
  ) || !(snapshot.argsPrefix.length === 0 || (
    snapshot.argsPrefix.length === 2 && snapshot.argsPrefix[0] === '-m'
    && snapshot.argsPrefix[1] === 'autovision_ml.cli'
  ))) throw failure('DIAGNOSTICS_CONFIG');

  let disposed = false;
  let active: { promise: Promise<HardwareDiagnostics>; cancel(): void } | undefined;

  function collect(): Promise<HardwareDiagnostics> {
    if (disposed) return Promise.reject(failure('DIAGNOSTICS_DISPOSED'));
    if (active) return active.promise;

    // Register before execFile: even a synchronous callback or reentrant disposal
    // must see this run, without an executor/assignment race or a global child.
    const { promise, resolve, reject } = Promise.withResolvers<HardwareDiagnostics>();
    let child: ChildProcess | undefined;
    let settled = false;
    let completed = false;
    let cancelled = false;
    let killSent = false;
    function stopChild(): void {
      if (!child || completed || killSent || child.killed
        || child.exitCode !== null || child.signalCode !== null) return;
      killSent = true;
      try { child.kill(); } catch { /* Never expose native command/path errors. */ }
    }
    function finish(result: HardwareDiagnostics | Error): void {
      if (settled) return;
      settled = true;
      if (active === run) active = undefined;
      if (result instanceof Error) reject(result);
      else resolve(result);
    }
    const run = {
      promise,
      cancel(): void {
        cancelled = true;
        finish(failure('DIAGNOSTICS_DISPOSED'));
        stopChild();
      },
    };
    active = run;
    try {
      child = childProcess.execFile(snapshot.executablePath, [
        ...snapshot.argsPrefix, 'probe-hardware', '--disk-path', snapshot.diskPath,
      ], {
        cwd: snapshot.cwd, shell: false, windowsHide: true, encoding: 'utf8',
        timeout: 30_000, maxBuffer: 256 * 1024,
      }, (error, stdout, stderr) => {
        if (completed) return;
        completed = true;
        if (settled) return;
        try {
          if (error && (error.killed || error.signal != null
            || (error.code !== 1 && error.code !== 2))) throw failure();
          if (typeof stdout !== 'string' || typeof stderr !== 'string'
            || stderr.length !== 0 || Buffer.byteLength(stdout, 'utf8') > 256 * 1024) throw failure();
          // JSON.parse consumes the complete stdout: no log prefixes/trailing junk.
          const value: unknown = JSON.parse(stdout);
          const report = hardwareDiagnosticsSchema.parse(value);
          const invalidDisk = report.disk.status === 'error'
            && report.disk.error.code === 'invalid-disk-path';
          const expectedExit = invalidDisk ? 2 : report.status === 'ok' ? 0 : 1;
          if ((error === null ? 0 : error.code) !== expectedExit) throw failure();
          finish(report);
        } catch { finish(failure()); }
      });
      if (cancelled) stopChild();
    } catch {
      completed = true;
      finish(failure());
    }
    return promise;
  }

  return Object.freeze({
    collect,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      active?.cancel();
    },
  });
}