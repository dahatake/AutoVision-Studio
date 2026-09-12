import childProcess, { type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants, type BigIntStats } from 'node:fs';
import fs, { type FileHandle } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import {
  MAX_WORKER_MESSAGE_BYTES, encodeWorkerCancel, encodeWorkerRequest,
  parseWorkerEventLine, parseWorkerRequest, type WorkerEvent, type WorkerRequest,
} from '../../shared/contracts/worker.js';

export interface WorkerSupervisorPolicy {
  // Required Main policy, NOT a default training budget (FR-TRN-009 / TBD-03).
  timeoutMs: number;
  cancelGraceMs: number;
  closeTimeoutMs: number;
  maxStdoutBytes: number;
  maxManifestBytes: number;
}
export interface WorkerSupervisorOptions {
  // Trusted Main startup configuration only; never accept these fields via IPC.
  executablePath: string;
  argsPrefix: readonly string[];
  env?: NodeJS.ProcessEnv;
  taskRoot: string;
  // Must be the not-yet-existing direct UUID child of taskRoot. No reuse/resume.
  jobDirectory: string;
  request: WorkerRequest;
  policy: WorkerSupervisorPolicy;
  // Synchronous trusted Main notification, only after the first validated started.
  onStarted?: () => void;
  // Synchronous, validated actual counts only. No retained event/log history.
  onProgress?: (event: Readonly<Extract<WorkerEvent, { type: 'progress' }>>) => void;
}
export type WorkerResult = { type: 'completed'; manifestPath: string } | { type: 'cancelled' };
export type WorkerFailureCode = 'WORKER_CONFIG' | 'WORKER_REQUEST' | 'WORKER_PREPARE'
  | 'WORKER_SPAWN' | 'WORKER_IO' | 'WORKER_PROTOCOL' | 'WORKER_OUTPUT_LIMIT'
  | 'WORKER_CALLBACK' | 'WORKER_FAILED' | 'WORKER_EXIT' | 'WORKER_MANIFEST'
  | 'WORKER_TIMEOUT' | 'WORKER_CLOSE_TIMEOUT';
export type WorkerSupervisorError = Error & {
  readonly code: WorkerFailureCode;
  // Confirmation includes drained preparation/manifest I/O and closed file handles.
  // False means termination was NOT confirmed. Retain files, even after late close.
  readonly terminationConfirmed: boolean;
};
export interface WorkerRun { donePromise: Promise<WorkerResult>; cancel(): void }

const MAX_STDERR_BYTES = 256 * 1024;
const MAX_TIMER_MS = 2_147_483_647; // Node timer range, not a product training cap.
type DirectoryStamp = { path: string; stat: BigIntStats };
function failure(code: WorkerFailureCode, terminationConfirmed: boolean): WorkerSupervisorError {
  return Object.assign(new Error('Worker job failed.'), { code, terminationConfirmed });
}
function requireValid(value: unknown): asserts value {
  if (!value) throw new Error('Invalid worker boundary.');
}
function samePath(a: string, b: string): boolean {
  return process.platform === 'win32' ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b);
}
function localAbsolute(value: string): boolean {
  return typeof value === 'string' && isAbsolute(value) && !/[\x00-\x1f]/u.test(value) && !/^[\\/]{2}/u.test(value);
}
function sameIdentity(a: BigIntStats, b: BigIntStats): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.birthtimeNs === b.birthtimeNs;
}
function sameFile(a: BigIntStats, b: BigIntStats): boolean {
  return a.isFile() && b.isFile() && a.nlink === 1n && b.nlink === 1n
    && sameIdentity(a, b) && a.size === b.size && a.mtimeNs === b.mtimeNs;
}
async function directoryChain(path: string, signal: AbortSignal): Promise<DirectoryStamp[]> {
  const paths: string[] = [];
  for (let current = resolve(path); ; current = dirname(current)) {
    paths.unshift(current);
    if (dirname(current) === current) break;
  }
  const stamps: DirectoryStamp[] = [];
  for (const entry of paths) {
    signal.throwIfAborted();
    const stat = await fs.lstat(entry, { bigint: true });
    requireValid(stat.isDirectory() && !stat.isSymbolicLink());
    stamps.push({ path: entry, stat });
  }
  signal.throwIfAborted();
  requireValid(samePath(await fs.realpath(path), path));
  return stamps;
}
async function checkDirectories(stamps: readonly DirectoryStamp[], signal: AbortSignal): Promise<void> {
  for (const stamp of stamps) {
    signal.throwIfAborted();
    const actual = await fs.lstat(stamp.path, { bigint: true });
    requireValid(actual.isDirectory() && !actual.isSymbolicLink() && sameIdentity(stamp.stat, actual));
  }
}
async function fingerprint(path: string, directories: readonly DirectoryStamp[], limit: number, signal: AbortSignal, closeHandle: (handle: FileHandle) => Promise<void>) {
  signal.throwIfAborted();
  await checkDirectories(directories, signal);
  signal.throwIfAborted();
  const before = await fs.lstat(path, { bigint: true });
  requireValid(before.isFile() && !before.isSymbolicLink() && before.nlink === 1n && before.size <= BigInt(limit));
  // NONBLOCK also avoids waiting on a FIFO substituted between lstat and open.
  signal.throwIfAborted();
  const handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    signal.throwIfAborted();
    const opened = await handle.stat({ bigint: true });
    signal.throwIfAborted();
    const pathOpened = await fs.lstat(path, { bigint: true });
    requireValid(sameFile(before, opened) && sameFile(opened, pathOpened) && !pathOpened.isSymbolicLink());
    const hash = createHash('sha256');
    const buffer = Buffer.alloc(MAX_WORKER_MESSAGE_BYTES);
    let size = 0;
    for (;;) {
      signal.throwIfAborted();
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, size);
      if (bytesRead === 0) break;
      requireValid(bytesRead <= limit - size);
      size += bytesRead;
      hash.update(buffer.subarray(0, bytesRead));
    }
    signal.throwIfAborted();
    const after = await handle.stat({ bigint: true });
    signal.throwIfAborted();
    const pathAfter = await fs.lstat(path, { bigint: true });
    // Windows path/handle ctime can differ. Compare each API to itself, after open.
    requireValid(BigInt(size) === opened.size && sameFile(opened, after) && opened.ctimeNs === after.ctimeNs
      && sameFile(pathOpened, pathAfter) && pathOpened.ctimeNs === pathAfter.ctimeNs && !pathAfter.isSymbolicLink());
    await checkDirectories(directories, signal);
    return { sha256: hash.digest('hex'), stat: pathAfter };
  } finally { await closeHandle(handle); }
}
async function verifyManifest(jobDirectory: string, locator: string, owned: readonly DirectoryStamp[], limit: number, signal: AbortSignal, closeHandle: (handle: FileHandle) => Promise<void>): Promise<string> {
  const parts = locator.split('/');
  requireValid(!/[\\:\x00-\x1f<>"|?*]/u.test(locator) && parts.every((part) => part !== '' && part !== '.' && part !== '..'
    && !/[. ]$/u.test(part) && !/^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/iu.test(part)));
  const path = join(jobDirectory, ...parts);
  requireValid(!samePath(path, join(jobDirectory, 'request.json')));
  const directories = await directoryChain(dirname(path), signal);
  requireValid(owned.every((stamp, index) => directories[index] !== undefined
    && samePath(stamp.path, directories[index].path) && sameIdentity(stamp.stat, directories[index].stat)));
  const first = await fingerprint(path, directories, limit, signal, closeHandle);
  const second = await fingerprint(path, directories, limit, signal, closeHandle);
  requireValid(sameFile(first.stat, second.stat) && first.sha256 === second.sha256);
  return path;
}

/**
 * JOB-04 transport only (ADR-0001 §2.5/2.6). Launches
 * executable + trusted argsPrefix + kind + --request + request.json, shell:false.
 * DAT-01/AST-04/TRN-14 must register that CLI and validate task payloads; today's
 * health/probe commands are NOT job substitutes and cannot yield fake progress.
 *
 * completed means exit 0 + valid protocol + a stable, owned manifest LOCATOR.
 * Manifest bytes are opaque here: two SHA-256 reads check stability, not a task
 * schema, artifact checksums or model validity. The task-specific consumer MUST
 * revalidate contents/identity/hashes before use/commit. No DB writes, model seed,
 * atomic artifact commit, directory deletion, global service or process watcher.
 * Main owns the local task root/exclusion; this is not an OS-user sandbox.
 */
export function startWorkerJob(options: WorkerSupervisorOptions): WorkerRun {
  let requestText: string;
  let request: WorkerRequest;
  try { requestText = encodeWorkerRequest(options.request); request = parseWorkerRequest(requestText); }
  catch { throw failure('WORKER_REQUEST', true); }
  let executablePath: string; let argsPrefix: string[]; let taskRoot: string; let jobDirectory: string;
  let env: NodeJS.ProcessEnv; let policy: WorkerSupervisorPolicy;
  const onStarted = options.onStarted;
  const onProgress = options.onProgress;
  try {
    requireValid(Array.isArray(options.argsPrefix) && (onProgress === undefined || typeof onProgress === 'function'));
    requireValid(onStarted === undefined || typeof onStarted === 'function');
    executablePath = options.executablePath; argsPrefix = [...options.argsPrefix];
    taskRoot = options.taskRoot; jobDirectory = options.jobDirectory;
    policy = { ...options.policy }; env = { ...process.env, ...options.env };
    requireValid([executablePath, taskRoot, jobDirectory].every(localAbsolute));
    requireValid(argsPrefix.every((arg) => typeof arg === 'string' && !arg.includes('\0')));
    requireValid(samePath(jobDirectory, join(taskRoot, request.jobId)));
    requireValid([policy.timeoutMs, policy.cancelGraceMs, policy.closeTimeoutMs]
      .every((value) => Number.isSafeInteger(value) && value > 0 && value <= MAX_TIMER_MS));
    requireValid([policy.maxStdoutBytes, policy.maxManifestBytes].every((value) => Number.isSafeInteger(value) && value > 0));
    taskRoot = resolve(taskRoot); jobDirectory = resolve(jobDirectory);
  } catch { throw failure('WORKER_CONFIG', true); }

  const { promise: donePromise, resolve: succeed, reject } = Promise.withResolvers<WorkerResult>();
  const reading = new AbortController();
  const requestPath = join(jobDirectory, 'request.json');
  const correlation = { jobId: request.jobId, projectId: request.projectId };
  const cancelText = encodeWorkerCancel({ schemaVersion: request.schemaVersion, jobId: request.jobId, projectId: request.projectId, type: 'cancel' });
  const line = Buffer.alloc(MAX_WORKER_MESSAGE_BYTES);
  let pendingBytes = 0; let stdoutBytes = 0; let stderrBytes = 0;
  let started = false; let processed = 0; let total: number | null = null;
  let terminal: 'completed' | 'failed' | 'cancelled' | undefined; let locator = '';
  let child: ChildProcessWithoutNullStreams | undefined; let directories: DirectoryStamp[] = [];
  let closed = false; let exited = false; let settled = false; let stopping = false; let cancelSent = false; let killSent = false;
  let preparing = true; let verifying = false; let handleCloseFailed = false;
  let failureCode: WorkerFailureCode | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let grace: ReturnType<typeof setTimeout> | undefined;
  let closeDeadline: ReturnType<typeof setTimeout> | undefined;
  async function closeHandle(handle: FileHandle): Promise<void> {
    try { await handle.close(); }
    catch (error) { handleCloseFailed = true; throw error; }
  }
  function finish(result: WorkerResult | WorkerSupervisorError): void {
    if (settled) return;
    settled = true; pendingBytes = 0;
    reading.abort();
    clearTimeout(timeout); clearTimeout(grace); clearTimeout(closeDeadline);
    if (result instanceof Error) reject(result); else succeed(result);
  }
  function finishStopped(): void {
    if (!stopping || preparing || verifying || (child && !closed)) return;
    finish(failureCode ? failure(failureCode, !handleCloseFailed) : { type: 'cancelled' });
  }
  function awaitClose(): void {
    if (settled || (!preparing && !verifying && (!child || closed)) || closeDeadline !== undefined) return;
    // Rejection is NOT confirmation. Keep draining file I/O/observing the child
    // and retain its directory even if they finish later. No retry or other PID kill.
    closeDeadline = setTimeout(() => finish(failure('WORKER_CLOSE_TIMEOUT', false)), policy.closeTimeoutMs);
  }
  function killOwnChild(): void {
    if (!child || closed || exited || killSent || child.exitCode !== null || child.signalCode !== null) return;
    killSent = true;
    // Native direct-child termination only; does NOT terminate a descendant tree.
    try { child.kill('SIGKILL'); } catch { /* awaitClose reports unconfirmed termination. */ }
  }
  function stop(code?: WorkerFailureCode): void {
    if (settled) return;
    if (code !== undefined && failureCode === undefined) failureCode = code;
    if (stopping) return;
    stopping = true; clearTimeout(timeout); reading.abort();
    if (!child || closed) { finishStopped(); awaitClose(); return; }
    if (exited || child.pid === undefined) { awaitClose(); return; }
    if (!child.stdin.destroyed && child.stdin.writable) {
      cancelSent = true;
      try { child.stdin.end(cancelText); } catch { /* Broken stdin still has a finite grace/kill path. */ }
    }
    grace = setTimeout(() => { killOwnChild(); awaitClose(); }, policy.cancelGraceMs);
  }
  function eventReceived(event: WorkerEvent): void {
    requireValid(terminal === undefined);
    if (event.type === 'started') {
      requireValid(!started); started = true;
      if (!stopping) {
        try { onStarted?.(); } catch { stop('WORKER_CALLBACK'); }
      }
    } else if (event.type === 'progress') {
      requireValid(started && event.processed >= processed && (total === null || event.total === total));
      processed = event.processed; total = event.total;
      if (!stopping) {
        try { onProgress?.(Object.freeze(event)); } catch { stop('WORKER_CALLBACK'); }
      }
    } else if (event.type === 'completed') {
      requireValid(started && (total === null || processed === total));
      terminal = 'completed'; locator = event.resultManifest;
    } else if (event.type === 'failed') {
      terminal = 'failed'; stop('WORKER_FAILED');
    } else if (event.code === 'CANCELLED') {
      requireValid(stopping && cancelSent); terminal = 'cancelled';
    } else requireValid(started);
  }
  function stdoutReceived(chunk: Buffer): void {
    if (settled || failureCode) return;
    if (chunk.length > policy.maxStdoutBytes - stdoutBytes) { stop('WORKER_OUTPUT_LIMIT'); return; }
    stdoutBytes += chunk.length;
    for (let offset = 0; offset < chunk.length && !settled && !failureCode;) {
      const newline = chunk.indexOf(10, offset);
      const end = newline < 0 ? chunk.length : newline + 1;
      const length = end - offset;
      if (length > line.length - pendingBytes) { stop('WORKER_OUTPUT_LIMIT'); return; }
      chunk.copy(line, pendingBytes, offset, end); pendingBytes += length; offset = end;
      if (newline < 0) {
        if (pendingBytes === line.length) stop('WORKER_OUTPUT_LIMIT'); // No room left for the required LF.
        return;
      }
      const bytes = pendingBytes; pendingBytes = 0;
      // Decode only complete byte-framed lines: split UTF-8 is never replaced.
      try { eventReceived(parseWorkerEventLine(line.subarray(0, bytes), correlation)); }
      catch { stop('WORKER_PROTOCOL'); }
    }
  }
  async function processClosed(code: number | null, signal: NodeJS.Signals | null): Promise<void> {
    closed = true; clearTimeout(grace);
    if (!preparing && !verifying) { clearTimeout(closeDeadline); closeDeadline = undefined; }
    if (settled) return;
    if (stopping) { finishStopped(); return; }
    if (code !== 0 || signal !== null) { finish(failure('WORKER_EXIT', true)); return; }
    if (terminal !== 'completed' || pendingBytes !== 0) { finish(failure('WORKER_PROTOCOL', true)); return; }
    verifying = true;
    try {
      const manifestPath = await verifyManifest(jobDirectory, locator, directories, policy.maxManifestBytes, reading.signal, closeHandle);
      if (!stopping && !settled) finish({ type: 'completed', manifestPath });
    } catch { if (!stopping || handleCloseFailed) stop('WORKER_MANIFEST'); }
    finally { verifying = false; finishStopped(); }
  }
  async function prepare(): Promise<void> {
    try {
      directories = await directoryChain(taskRoot, reading.signal);
      reading.signal.throwIfAborted();
      await fs.mkdir(jobDirectory, { mode: 0o700 }); // recursive:false / EEXIST is a hard failure.
      reading.signal.throwIfAborted();
      await checkDirectories(directories, reading.signal);
      reading.signal.throwIfAborted();
      const owned = await fs.lstat(jobDirectory, { bigint: true });
      requireValid(owned.isDirectory() && !owned.isSymbolicLink());
      directories.push({ path: jobDirectory, stat: owned });
      reading.signal.throwIfAborted();
      const handle = await fs.open(requestPath, 'wx', 0o600);
      try {
        reading.signal.throwIfAborted();
        await handle.writeFile(requestText, 'utf8');
        reading.signal.throwIfAborted();
        await handle.sync();
      } finally { await closeHandle(handle); }
      reading.signal.throwIfAborted();
      const written = await fingerprint(requestPath, directories, MAX_WORKER_MESSAGE_BYTES, reading.signal, closeHandle);
      requireValid(written.sha256 === createHash('sha256').update(requestText, 'utf8').digest('hex'));
      reading.signal.throwIfAborted();
    } catch { if (!stopping || handleCloseFailed) stop('WORKER_PREPARE'); return; }
    try {
      child = childProcess.spawn(executablePath, [...argsPrefix, request.kind, '--request', requestPath], {
        cwd: jobDirectory, env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      });
      child.on('error', () => stop(child?.pid === undefined ? 'WORKER_SPAWN' : 'WORKER_IO'));
      child.once('exit', () => { exited = true; clearTimeout(grace); awaitClose(); });
      child.once('close', (code, signal) => { void processClosed(code, signal); });
      child.stdout.on('data', stdoutReceived);
      child.stderr.on('data', (chunk: Buffer) => {
        if (settled || failureCode) return;
        if (chunk.length > MAX_STDERR_BYTES - stderrBytes) stop('WORKER_OUTPUT_LIMIT');
        else stderrBytes += chunk.length; // Discard bytes. Never echo native errors, images or paths.
      });
      child.stdout.once('end', () => {
        if (!stopping && (pendingBytes !== 0 || terminal === undefined)) stop('WORKER_PROTOCOL');
      });
      child.stdout.on('error', () => stop('WORKER_IO'));
      child.stderr.on('error', () => stop('WORKER_IO'));
      child.stdin.on('error', () => { if (!stopping) stop('WORKER_IO'); });
    } catch {
      stop(child ? 'WORKER_IO' : 'WORKER_SPAWN');
    }
  }
  timeout = setTimeout(() => stop('WORKER_TIMEOUT'), policy.timeoutMs);
  void prepare().finally(() => { preparing = false; finishStopped(); });
  return Object.freeze({ donePromise, cancel(): void { if (!closed || verifying) stop(); } });
}