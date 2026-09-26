// @vitest-environment node
import childProcess, { type ChildProcess } from 'node:child_process';
import type { EventEmitter } from 'node:events';
import fs, { type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  MAX_WORKER_MESSAGE_BYTES, encodeWorkerRequest, parseWorkerCancelLine,
  parseWorkerRequest, type WorkerRequest,
} from '../../shared/contracts/worker.js';
import {
  startWorkerJob, type WorkerFailureCode, type WorkerRun, type WorkerSupervisorError,
  type WorkerSupervisorOptions, type WorkerSupervisorPolicy,
} from './worker-supervisor.js';

const nativeSpawn = childProcess.spawn.bind(childProcess);
const nativeOpen = fs.open.bind(fs);
const nativeMkdir = fs.mkdir.bind(fs);
const nativeLstat = fs.lstat.bind(fs);
const nativeRealpath = fs.realpath.bind(fs);
const request: WorkerRequest = {
  schemaVersion: 1, jobId: 'ae45cf74-c9f9-4c49-88b9-0523b1ac7383',
  projectId: '01234567-89ab-4cde-8f01-23456789abcd', kind: 'scan-dataset', payload: {},
};
// closeTimeoutMs is 2 s (production: 10 s, src/main/index.ts) so that a loaded aggregate run does not
// turn the expected code into WORKER_CLOSE_TIMEOUT; close-timeout tests pass their own 50 ms.
const policy: WorkerSupervisorPolicy = {
  timeoutMs: 3_000, cancelGraceMs: 250, closeTimeoutMs: 2_000,
  maxStdoutBytes: 1024 * 1024, maxManifestBytes: MAX_WORKER_MESSAGE_BYTES,
};
type Overrides = Partial<Omit<WorkerSupervisorOptions, 'policy'>> & { policy?: Partial<WorkerSupervisorPolicy> };
type ObservedChild = { child: ChildProcess; close: Promise<void>; closed: boolean };

// TEST ONLY: generated inside each OS-temp directory, never a production worker,
// health fallback, fake Project/model, app profile or repository fixture file.
const fixturePrelude = `
const fs = require('node:fs');
const path = require('node:path');
const input = process.argv[4];
const request = JSON.parse(fs.readFileSync(input, 'utf8'));
if (process.argv.length !== 5 || process.argv[2] !== request.kind || process.argv[3] !== '--request') process.exit(93);
const root = path.dirname(input);
const wire = (fields) => JSON.stringify({schemaVersion: request.schemaVersion, jobId: request.jobId, projectId: request.projectId, ...fields}) + '\\n';
const send = (fields) => process.stdout.write(wire(fields));
const begin = () => send({type: 'started'});
const progress = (processed, total) => send({type: 'progress', source: 'actual', processed, total});
const manifest = (name = 'result.json') => {
  fs.mkdirSync(path.dirname(path.join(root, name)), {recursive: true});
  fs.writeFileSync(path.join(root, name), '{"fixture":"JOB04 TEST ONLY"}', {flag: 'wx'});
  return name;
};
const complete = (name = 'result.json') => send({type: 'completed', resultManifest: name});
// Finite fixture failsafe; successful fixtures do not wait for this timer.
setTimeout(() => process.exit(94), 4_000).unref();
`;
async function within<T>(pending: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([pending, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('JOB04 native test deadline exceeded.')), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}
async function withFixture(body: string, check: (context: {
  launch(overrides?: Overrides): WorkerRun;
  directory: string;
  taskRoot: string;
  children: ObservedChild[];
  preparationIO: Promise<unknown>[];
  drainPreparation(): Promise<void>;
}) => Promise<void>): Promise<void> {
  const directory = await fs.mkdtemp(join(tmpdir(), 'autovision-job04-TEST-'));
  const taskRoot = join(directory, 'tasks');
  const fixture = join(directory, 'worker-fixture.cjs');
  const children: ObservedChild[] = [];
  const runs: WorkerRun[] = [];
  const preparationIO: Promise<unknown>[] = [];
  async function drainPreparation(): Promise<void> {
    await within((async () => {
      let drained = 0;
      while (drained < preparationIO.length) {
        const pending = preparationIO.slice(drained); drained = preparationIO.length;
        // Promise reactions can enqueue the next I/O, notably finally's close.
        await Promise.allSettled(pending);
      }
    })(), 2_000);
  }
  try {
    await fs.mkdir(taskRoot);
    await fs.writeFile(fixture, fixturePrelude + body, 'utf8');
    // Observe the REAL spawn/kill/close, without substituting a process or clock.
    vi.spyOn(childProcess, 'spawn').mockImplementation((file, args, options) => {
      const child = nativeSpawn(file, args, options);
      const completion = Promise.withResolvers<void>();
      const observed = { child, close: completion.promise, closed: false };
      children.push(observed); vi.spyOn(child, 'kill');
      child.once('close', () => { observed.closed = true; completion.resolve(); });
      return child;
    });
    function launch(overrides: Overrides = {}): WorkerRun {
      const input = overrides.request ?? request;
      const run = startWorkerJob({
        executablePath: process.execPath, argsPrefix: [fixture], taskRoot,
        ...overrides, request: input,
        jobDirectory: overrides.jobDirectory ?? join(overrides.taskRoot ?? taskRoot, input.jobId.toLowerCase()),
        policy: { ...policy, ...overrides.policy },
      });
      runs.push(run); void run.donePromise.catch(() => undefined);
      return run;
    }
    await within(check({ launch, directory, taskRoot, children, preparationIO, drainPreparation }), 6_000);
  } finally {
    try {
      for (const run of runs) run.cancel();
      await within(Promise.allSettled(runs.map((run) => run.donePromise)), 2_000);
      // Even a rejected donePromise/kill return value is NOT permission to rm.
      // Deferred preparation/manifest tests release in finally; also drain after false.
      await drainPreparation();
      await within(Promise.all(children.map((child) => child.close)), 2_000);
      await fs.rm(directory, { recursive: true, force: true });
    } finally { vi.restoreAllMocks(); }
  }
}
async function expectFailure(run: WorkerRun, code: WorkerFailureCode, confirmed = true): Promise<WorkerSupervisorError> {
  const error: unknown = await run.donePromise.catch((value: unknown) => value);
  expect(error).toBeInstanceOf(Error);
  expect(error).toMatchObject({ message: 'Worker job failed.', code, terminationConfirmed: confirmed });
  expect(JSON.stringify(error)).toBe(JSON.stringify({ code, terminationConfirmed: confirmed }));
  expect(String(error)).not.toContain('PRIVATE_IMAGE');
  expect(error).not.toHaveProperty('cause');
  return error as WorkerSupervisorError;
}

describe('JOB04 real native Node transport (test fixtures only)', () => {
  describe('JOB05 onStarted prerequisite', () => {
    it('notifies started synchronously exactly once before progress', async () => {
      await withFixture(`begin(); progress(0,1); progress(1,1); manifest(); complete();`, async ({ launch, children }) => {
        const order: string[] = [];
        const onStarted = vi.fn(() => { order.push('started'); });
        const run = launch({ onStarted, onProgress: ({ processed }) => { order.push(`progress:${processed}`); } });
        await expect(run.donePromise).resolves.toMatchObject({ type: 'completed' });
        expect(order).toEqual(['started', 'progress:0', 'progress:1']);
        expect(onStarted).toHaveBeenCalledExactlyOnceWith();
        expect(children[0].closed).toBe(true);
        run.cancel(); expect(onStarted).toHaveBeenCalledTimes(1);
      });
    }, 10_000);

    it.each([
      { name: 'null', value: null }, { name: 'boolean', value: false },
      { name: 'number', value: 1 }, { name: 'string', value: 'callback' },
      { name: 'object', value: {} }, { name: 'array', value: [] },
    ])('rejects a $name callback before supervisor filesystem I/O or spawn', async ({ value }) => {
      await withFixture(``, async ({ launch, children }) => {
        const lstat = vi.spyOn(fs, 'lstat'); const realpath = vi.spyOn(fs, 'realpath');
        const mkdir = vi.spyOn(fs, 'mkdir'); const open = vi.spyOn(fs, 'open');
        expect(() => launch({ onStarted: value as unknown as WorkerSupervisorOptions['onStarted'] }))
          .toThrow(expect.objectContaining({ code: 'WORKER_CONFIG', terminationConfirmed: true }));
        expect(lstat).not.toHaveBeenCalled(); expect(realpath).not.toHaveBeenCalled();
        expect(mkdir).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled();
        expect(childProcess.spawn).not.toHaveBeenCalled(); expect(children).toHaveLength(0);
      });
    }, 10_000);

    it('terminates finitely with confirmed WORKER_CALLBACK when started throws', async () => {
      await withFixture(`begin(); progress(0,null); process.stdin.resume(); setTimeout(()=>{},3500);`, async ({ launch, children }) => {
        const onStarted = vi.fn(() => { throw new Error('PRIVATE_IMAGE'); });
        const onProgress = vi.fn();
        const run = launch({ onStarted, onProgress });
        await within(expectFailure(run, 'WORKER_CALLBACK'), 2_000);
        expect(onStarted).toHaveBeenCalledExactlyOnceWith(); expect(onProgress).not.toHaveBeenCalled();
        expect(children[0].closed).toBe(true);
        expect(children[0].child.kill).toHaveBeenCalledExactlyOnceWith('SIGKILL');
      });
    }, 10_000);

    it('keeps duplicate started a protocol failure without notifying twice', async () => {
      await withFixture(`begin(); begin();`, async ({ launch, children }) => {
        const onStarted = vi.fn();
        await expectFailure(launch({ onStarted }), 'WORKER_PROTOCOL');
        expect(onStarted).toHaveBeenCalledExactlyOnceWith(); expect(children[0].closed).toBe(true);
      });
    }, 10_000);

    it.each([
      { name: 'wrong correlation', body: `send({type:'started',jobId:request.projectId});` },
      { name: 'extra field', body: `send({type:'started',unexpected:true});` },
      { name: 'wrong schema version', body: `send({type:'started',schemaVersion:99});` },
    ])('does not notify for malformed started: $name', async ({ body }) => {
      await withFixture(body, async ({ launch }) => {
        const onStarted = vi.fn();
        await expectFailure(launch({ onStarted }), 'WORKER_PROTOCOL');
        expect(onStarted).not.toHaveBeenCalled();
      });
    }, 10_000);

    it('does not notify when cancelled during preparation before started', async () => {
      await withFixture(`begin(); manifest(); complete();`, async ({ launch, children }) => {
        const onStarted = vi.fn(); const run = launch({ onStarted }); run.cancel();
        await expect(run.donePromise).resolves.toEqual({ type: 'cancelled' });
        expect(onStarted).not.toHaveBeenCalled(); expect(children).toHaveLength(0);
      });
    }, 10_000);

    it('suppresses a valid started received after cancellation of a live child', async () => {
      await withFixture(`
        process.stdin.resume();
        process.stdin.on('end',()=>{ begin(); progress(0,null); send({type:'warning',code:'CANCELLED'}); });
      `, async ({ launch, children }) => {
        const spawned = Promise.withResolvers<void>();
        const observedSpawn = vi.mocked(childProcess.spawn).getMockImplementation();
        if (!observedSpawn) throw new Error('Missing native spawn observation.');
        vi.mocked(childProcess.spawn).mockImplementation((file, args, options) => {
          const child = observedSpawn(file, args, options);
          child.once('spawn', () => spawned.resolve());
          return child;
        });
        const onStarted = vi.fn(); const onProgress = vi.fn();
        const run = launch({ onStarted, onProgress, policy: { cancelGraceMs: 1_000 } });
        await within(spawned.promise, 2_000); run.cancel();
        await expect(run.donePromise).resolves.toEqual({ type: 'cancelled' });
        expect(onStarted).not.toHaveBeenCalled(); expect(onProgress).not.toHaveBeenCalled();
        expect(children[0].closed).toBe(true); expect(children[0].child.exitCode).toBe(0);
        expect(children[0].child.kill).not.toHaveBeenCalled();
      });
    }, 10_000);

    it('retains the callback snapshot when the actual options change after start', async () => {
      await withFixture(`begin(); progress(0,0); manifest(); complete();`, async ({ directory, taskRoot, children }) => {
        const original = vi.fn(); const replacement = vi.fn();
        const options: WorkerSupervisorOptions = {
          executablePath: process.execPath, argsPrefix: [join(directory, 'worker-fixture.cjs')],
          taskRoot, jobDirectory: join(taskRoot, request.jobId), request, policy, onStarted: original,
        };
        const run = startWorkerJob(options);
        try {
          options.onStarted = replacement;
          await expect(run.donePromise).resolves.toMatchObject({ type: 'completed' });
          expect(original).toHaveBeenCalledExactlyOnceWith(); expect(replacement).not.toHaveBeenCalled();
          expect(children[0].closed).toBe(true);
        } finally {
          run.cancel(); await within(Promise.allSettled([run.donePromise]), 2_000);
        }
      });
    }, 10_000);
  });

  it('snapshots Main config/request/env, forwards actual counts and resolves only after close', async () => {
    await withFixture(`
      if (process.env.JOB04_TEST_VALUE !== 'snapshot' || request.payload.label !== '日本語🌱') process.exit(95);
      begin(); progress(0, null); progress(1, null); progress(1, 2); progress(2, 2);
      manifest(); complete();
      setTimeout(() => fs.writeFileSync(path.join(root, 'after-completed.txt'), 'test exit barrier'), 100);
    `, async ({ launch, directory, taskRoot, children }) => {
      const input = { ...request, jobId: request.jobId.toUpperCase(), payload: { label: '日本語🌱', executablePath: 'PRIVATE_IMAGE' } };
      const env = { JOB04_TEST_VALUE: 'snapshot' };
      const argsPrefix = [join(directory, 'worker-fixture.cjs')];
      const progress = vi.fn(); const limits = { ...policy };
      const run = launch({ request: input, env, argsPrefix, policy: limits, onProgress: progress });
      input.payload.label = 'changed'; env.JOB04_TEST_VALUE = 'changed'; argsPrefix[0] = 'changed'; limits.timeoutMs = 1;
      const manifestPath = join(taskRoot, request.jobId, 'result.json');
      await expect(run.donePromise).resolves.toEqual({ type: 'completed', manifestPath });
      expect(children[0].closed).toBe(true); expect(children[0].child.exitCode).toBe(0);
      expect(children[0].child.kill).not.toHaveBeenCalled();
      expect(await fs.readFile(join(taskRoot, request.jobId, 'after-completed.txt'), 'utf8')).toBe('test exit barrier');
      const stored = await fs.readFile(join(taskRoot, request.jobId, 'request.json'));
      expect(parseWorkerRequest(stored).payload).toEqual({ label: '日本語🌱', executablePath: 'PRIVATE_IMAGE' });
      expect(progress.mock.calls.map(([event]) => [event.processed, event.total])).toEqual([[0, null], [1, null], [1, 2], [2, 2]]);
      expect(progress.mock.calls.every(([event]) => event.source === 'actual' && event.jobId === request.jobId)).toBe(true);
      expect(childProcess.spawn).toHaveBeenCalledExactlyOnceWith(process.execPath,
        [join(directory, 'worker-fixture.cjs'), 'scan-dataset', '--request', join(taskRoot, request.jobId, 'request.json')],
        expect.objectContaining({ cwd: join(taskRoot, request.jobId), shell: false, windowsHide: true,
          env: expect.objectContaining({ JOB04_TEST_VALUE: 'snapshot' }), stdio: ['pipe', 'pipe', 'pipe'] }));
      run.cancel(); expect(children[0].child.kill).not.toHaveBeenCalled();
    });
  }, 10_000);

  it('handles UTF-8 split inside a code point, CRLF, and several events in one write', async () => {
    await withFixture(`
      process.stdout.write(wire({type:'started'}).replace('\\n', '\\r\\n') + wire({type:'progress', source:'actual', processed:0, total:0}));
      const name = manifest('nested/日本語🌱.json');
      const bytes = Buffer.from(wire({type:'completed', resultManifest:name}));
      const split = bytes.indexOf(Buffer.from('🌱')) + 1;
      process.stdout.write(bytes.subarray(0, split));
      setTimeout(() => process.stdout.write(bytes.subarray(split)), 25);
    `, async ({ launch, taskRoot }) => {
      await expect(launch().donePromise).resolves.toEqual({ type: 'completed', manifestPath: join(taskRoot, request.jobId, 'nested', '日本語🌱.json') });
    });
  }, 10_000);

  const invalidProtocol = [
    { name: 'malformed JSON', body: `process.stdout.write('{PRIVATE_IMAGE\\n');` },
    { name: 'invalid UTF-8', body: `process.stdout.write(Buffer.from([255,10]));` },
    { name: 'blank line', body: `begin(); process.stdout.write('\\n');` },
    { name: 'wrong job', body: `send({type:'started', jobId:request.projectId});` },
    { name: 'wrong Project', body: `send({type:'started', projectId:request.jobId});` },
    { name: 'duplicate started', body: `begin(); begin();` },
    { name: 'progress before started', body: `progress(0,null);` },
    { name: 'decreasing processed', body: `begin(); progress(2,null); progress(1,null);` },
    { name: 'changing known total', body: `begin(); progress(1,2); progress(1,3);` },
    { name: 'known total becomes unknown', body: `begin(); progress(1,2); progress(1,null);` },
    { name: 'nonfinite processed', body: `begin(); progress(Infinity,null);` },
    { name: 'premature completed counts', body: `begin(); progress(1,2); manifest(); complete();` },
    { name: 'completed before started', body: `manifest(); complete();` },
    { name: 'progress after terminal', body: `begin(); manifest(); complete(); progress(1,1);` },
    { name: 'duplicate terminal', body: `begin(); manifest(); complete(); complete();` },
    { name: 'failed after completed', body: `begin(); manifest(); complete(); send({type:'failed',code:'READ_FAILED'});` },
    { name: 'unsolicited cancellation', body: `begin(); send({type:'warning',code:'CANCELLED'});` },
    { name: 'unterminated final line', body: `process.stdout.write(wire({type:'started'}).trimEnd());` },
    { name: 'health is not a job result', body: `process.stdout.write('{"version":"test-only","os":"test-only"}\\n');` },
    { name: 'exit zero without events', body: `` },
  ];
  it.each(invalidProtocol)('rejects $name without exposing output', async ({ body }) => {
    await withFixture(body, async ({ launch, directory }) => {
      const error = await expectFailure(launch(), 'WORKER_PROTOCOL');
      expect(error.stack).not.toContain(directory);
    });
  }, 10_000);

  it.each([
    { name: 'worker failure (including before started)', body: `send({type:'failed',code:'READ_FAILED'}); process.exitCode=1;`, code: 'WORKER_FAILED' },
    { name: 'nonzero exit after completed', body: `begin(); manifest(); complete(); process.exitCode=7;`, code: 'WORKER_EXIT' },
    { name: 'incomplete output while the process remains alive', body: `begin(); process.stdout.end(); setTimeout(()=>{},3500);`, code: 'WORKER_TIMEOUT' },
    { name: 'missing manifest', body: `begin(); complete();`, code: 'WORKER_MANIFEST' },
    { name: 'directory instead of regular manifest', body: `begin(); fs.mkdirSync(path.join(root,'result.json')); complete();`, code: 'WORKER_MANIFEST' },
  ] satisfies { name: string; body: string; code: WorkerFailureCode }[])('handles $name', async ({ body, code }) => {
    await withFixture(body, async ({ launch }) => { await expectFailure(launch(), code); });
  }, 10_000);

  it.each([{ extra: 0 }, { extra: 1 }])('enforces the byte line cap including LF (+$extra)', async ({ extra }) => {
    await withFixture(`
      process.stdout.write(wire({type:'started'}).trimEnd().padEnd(${MAX_WORKER_MESSAGE_BYTES - 1 + extra}, ' ') + '\\n');
      manifest(); complete();
    `, async ({ launch }) => {
      const run = launch();
      if (extra === 0) await expect(run.donePromise).resolves.toMatchObject({ type: 'completed' });
      else await expectFailure(run, 'WORKER_OUTPUT_LIMIT');
    });
  }, 10_000);
  it.each([
    { name: 'unterminated stdout with no remaining space for LF', body: `process.stdout.write('x'.repeat(65536)); setTimeout(()=>{},3000);` },
    { name: 'oversized unterminated stdout', body: `process.stdout.write('x'.repeat(65537)); setTimeout(()=>{},3000);` },
    { name: 'total stdout from many individually valid lines', body: `begin(); for(let i=0;i<1000;i++) progress(i,1000);` },
    { name: 'stderr overflow', body: `process.stderr.write('x'.repeat(262145)); begin(); manifest(); complete();` },
  ])('bounds $name', async ({ body }) => {
    await withFixture(body, async ({ launch }) => { await expectFailure(launch({ policy: { maxStdoutBytes: 65536 } }), 'WORKER_OUTPUT_LIMIT'); });
  }, 10_000);
  it('discards exactly 256 KiB of stderr rather than echoing or parsing it', async () => {
    await withFixture(`process.stderr.write('PRIVATE_IMAGE'.padEnd(262144,'x')); begin(); manifest(); complete();`, async ({ launch }) => {
      await expect(launch().donePromise).resolves.toMatchObject({ type: 'completed' });
    });
  }, 10_000);
  it('writes a 64 KiB versioned request and refuses one extra byte before filesystem/spawn', async () => {
    await withFixture(`begin(); manifest(); complete();`, async ({ launch, taskRoot, children }) => {
      const exact = { ...request, payload: { label: '' } };
      exact.payload.label = 'a'.repeat(MAX_WORKER_MESSAGE_BYTES - Buffer.byteLength(encodeWorkerRequest(exact)));
      expect(() => launch({ request: { ...exact, payload: { label: exact.payload.label + 'a' } } })).toThrow('Worker job failed.');
      expect(() => launch({ request: { ...request, payload: { label: '🌱'.repeat(16384) } } })).toThrow('Worker job failed.');
      expect(children).toHaveLength(0);
      await expect(launch({ request: exact }).donePromise).resolves.toMatchObject({ type: 'completed' });
      const bytes = await fs.readFile(join(taskRoot, request.jobId, 'request.json'));
      expect(bytes.length).toBe(MAX_WORKER_MESSAGE_BYTES); expect(parseWorkerRequest(bytes)).toEqual(exact);
    });
  }, 10_000);

  it.each(['../outside.json', '/outside.json', 'C:/outside.json', 'sub/../result.json', 'sub\\result.json',
    'result.json:stream', 'result.json.', 'NUL.json', 'request.json'].map((locator) => ({ locator })))('refuses manifest locator $locator', async ({ locator }) => {
    await withFixture(`begin(); manifest(); complete(${JSON.stringify(locator)});`, async ({ launch }) => {
      await expectFailure(launch(), 'WORKER_MANIFEST');
    });
  }, 10_000);
  it.each([{ link: 'junction' }, { link: 'hardlink' }])('rejects $link escape without touching its target', async ({ link }) => {
    await withFixture(`
      const outside = path.join(__dirname, 'outside');
      ${link === 'junction'
        ? `fs.symlinkSync(outside,path.join(root,'linked'),process.platform==='win32'?'junction':'dir'); begin(); complete('linked/result.json');`
        : `fs.linkSync(path.join(outside,'result.json'),path.join(root,'result.json')); begin(); complete();`}
    `, async ({ launch, directory }) => {
      const target = join(directory, 'outside', 'result.json');
      await fs.mkdir(join(directory, 'outside')); await fs.writeFile(target, 'PRIVATE_IMAGE sentinel');
      await expectFailure(launch(), 'WORKER_MANIFEST');
      expect(await fs.readFile(target, 'utf8')).toBe('PRIVATE_IMAGE sentinel');
    });
  }, 10_000);
  it.each([{ change: 'bytes' }, { change: 'identity' }])('rejects manifest $change replacement between hash passes', async ({ change }) => {
    await withFixture(`begin(); manifest(); complete();`, async ({ launch, taskRoot }) => {
      const target = join(taskRoot, request.jobId, 'result.json'); let reads = 0;
      vi.spyOn(fs, 'open').mockImplementation(async (path, flags, mode) => {
        if (String(path) === target && ++reads === 2) {
          const original = await fs.readFile(target);
          if (change === 'identity') await fs.rename(target, target + '.previous');
          await fs.writeFile(target, change === 'bytes' ? Buffer.alloc(original.length, 32) : original);
        }
        return nativeOpen(path, flags, mode);
      });
      await expectFailure(launch(), 'WORKER_MANIFEST');
    });
  }, 10_000);
  it('enforces the Main manifest byte budget', async () => {
    await withFixture(`begin(); manifest(); complete();`, async ({ launch }) => {
      await expectFailure(launch({ policy: { maxManifestBytes: 1 } }), 'WORKER_MANIFEST');
    });
  }, 10_000);

  it('sends exactly one correlated cancel, accepts its ACK, and waits for normal close', async () => {
    await withFixture(`
      let control=''; process.stdin.setEncoding('utf8'); process.stdin.on('data', chunk=>control+=chunk);
      process.stdin.on('end',()=>{
        fs.writeFileSync(path.join(root,'test-cancel.ndjson'),control);
        send({type:'warning',code:'CANCELLED'});
      });
      begin(); progress(0,null);
    `, async ({ launch, taskRoot, children }) => {
      let run: WorkerRun;
      run = launch({ onProgress: () => { run.cancel(); run.cancel(); } });
      await expect(run.donePromise).resolves.toEqual({ type: 'cancelled' });
      const control = await fs.readFile(join(taskRoot, request.jobId, 'test-cancel.ndjson'));
      expect(parseWorkerCancelLine(control, { jobId: request.jobId, projectId: request.projectId })).toEqual({ schemaVersion: 1, jobId: request.jobId, projectId: request.projectId, type: 'cancel' });
      expect(children[0].closed).toBe(true); expect(children[0].child.exitCode).toBe(0);
      expect(children[0].child.kill).not.toHaveBeenCalled();
    });
  }, 10_000);
  it('forces only its own no-ACK child once; another job completes normally', async () => {
    await withFixture(`
      begin();
      if(request.payload.wait) { progress(0,null); process.stdin.resume(); setTimeout(()=>{},3000); }
      else { manifest(); complete(); setTimeout(()=>{},200); }
    `, async ({ launch, children }) => {
      let own: WorkerRun;
      own = launch({ request: { ...request, payload: { wait: true } }, onProgress: () => { own.cancel(); own.cancel(); } });
      const other = launch({ request: { ...request, jobId: request.projectId } });
      await expect(own.donePromise).resolves.toEqual({ type: 'cancelled' });
      await expect(other.donePromise).resolves.toMatchObject({ type: 'completed' });
      const ownChild = children.find(({ child }) => child.spawnargs.at(-1)?.includes(request.jobId));
      const otherChild = children.find((entry) => entry !== ownChild);
      expect(ownChild?.child.kill).toHaveBeenCalledExactlyOnceWith('SIGKILL');
      expect(otherChild?.child.kill).not.toHaveBeenCalled();
      expect(children.every((entry) => entry.closed)).toBe(true);
    });
  }, 10_000);
  it.each([{ ack: false }, { ack: true }])('times out finitely without promoting ACK=$ack to success', async ({ ack }) => {
    await withFixture(`
      begin(); process.stdin.resume();
      const hold=setTimeout(()=>{},3000);
      ${ack ? `process.stdin.on('end',()=>{send({type:'warning',code:'CANCELLED'}); clearTimeout(hold);});` : ''}
    `, async ({ launch, children }) => {
      await expectFailure(launch({ policy: { timeoutMs: 800 } }), 'WORKER_TIMEOUT');
      expect(children[0].closed).toBe(true);
      expect(children[0].child.kill).toHaveBeenCalledTimes(ack ? 0 : 1);
    });
  }, 10_000);
  it('does not succeed on completed while the process is still alive', async () => {
    await withFixture(`begin(); manifest(); complete(); setTimeout(()=>{},3000);`, async ({ launch }) => {
      await expectFailure(launch({ policy: { timeoutMs: 800 } }), 'WORKER_TIMEOUT');
    });
  }, 10_000);
  it('rejects a deliberately delayed close notification and retains the job directory', async () => {
    await withFixture(`begin(); progress(0,0); manifest(); complete(); setTimeout(()=>{},100);`, async ({ launch, taskRoot, children }) => {
      // Real child, deliberately delayed notification. Windows may close the
      // parent pipe before an inherited descendant; that is not a portable fixture.
      const run = launch({ policy: { closeTimeoutMs: 50 }, onProgress: () => {
        const child: EventEmitter = children[0].child;
        const emit = child.emit.bind(child);
        vi.spyOn(child, 'emit').mockImplementation((event, ...values) => {
          if (event !== 'close') return emit(event, ...values);
          setTimeout(() => emit(event, ...values), 200);
          return true;
        });
      },
      });
      await expectFailure(run, 'WORKER_CLOSE_TIMEOUT', false);
      expect(children[0].child.exitCode).toBe(0); expect(children[0].closed).toBe(false);
      expect(await fs.readFile(join(taskRoot, request.jobId, 'result.json'), 'utf8')).toContain('JOB04 TEST ONLY');
      // The harness requires the delayed close before removing this fixture.
    });
  }, 10_000);
  it('stops on a throwing progress consumer without leaking its message', async () => {
    await withFixture(`begin(); progress(0,null); setTimeout(()=>{},3000);`, async ({ launch }) => {
      await expectFailure(launch({ onProgress: () => { throw new Error('PRIVATE_IMAGE'); } }), 'WORKER_CALLBACK');
    });
  }, 10_000);
  it('cancels immediately during preparation without starting a child', async () => {
    await withFixture(`begin(); manifest(); complete();`, async ({ launch, children }) => {
      const run = launch(); run.cancel();
      await expect(run.donePromise).resolves.toEqual({ type: 'cancelled' });
      expect(children).toHaveLength(0);
    });
  }, 10_000);

  const preparationPhases = ['mkdir', 'open', 'write', 'sync', 'close', 'fingerprint'] as const;
  const preparationCases: {
    phase: typeof preparationPhases[number];
    reason: 'cancel' | 'timeout' | 'prepare-fault';
    confirmed: boolean;
    writeFault: boolean;
  }[] = [
    ...preparationPhases.flatMap((phase) => [true, false].map((confirmed) => ({
      phase, reason: 'cancel' as const, confirmed, writeFault: false,
    }))),
    { phase: 'fingerprint', reason: 'timeout', confirmed: true, writeFault: false },
    { phase: 'write', reason: 'timeout', confirmed: true, writeFault: true },
    { phase: 'close', reason: 'timeout', confirmed: false, writeFault: false },
    { phase: 'write', reason: 'cancel', confirmed: true, writeFault: true },
    { phase: 'write', reason: 'prepare-fault', confirmed: true, writeFault: true },
  ];
  it.each(preparationCases)('bounds $reason during $phase (confirmed=$confirmed, writeFault=$writeFault)', async ({ phase, reason, confirmed, writeFault }) => {
    await withFixture(`begin(); manifest(); complete();`, async ({ launch, taskRoot, children, preparationIO, drainPreparation }) => {
      const jobDirectory = join(taskRoot, request.jobId); const requestPath = join(jobDirectory, 'request.json');
      const entered = Promise.withResolvers<void>(); const release = Promise.withResolvers<void>();
      const closing = Promise.withResolvers<void>(); const releaseClose = Promise.withResolvers<void>();
      const stopRequested = Promise.withResolvers<void>();
      const handles: FileHandle[] = []; const calls: string[] = []; const lateIO: string[] = [];
      let settled = false;
      function track<T>(pending: Promise<T>): Promise<T> {
        preparationIO.push(pending); void pending.catch(() => undefined);
        return pending;
      }
      async function pause(name: typeof phase): Promise<void> {
        if (name === phase) { entered.resolve(); await release.promise; }
      }
      function ioFinished(name: string): void { if (settled) lateIO.push(name); }
      const nativeAbort = AbortController.prototype.abort;
      vi.spyOn(AbortController.prototype, 'abort').mockImplementation(function (this: AbortController, value?: unknown) {
        nativeAbort.call(this, value); stopRequested.resolve();
      });
      // All operations still use native fs/FileHandles. Track metadata as well
      // as writes and each open-to-close lifetime, including after a false result.
      vi.spyOn(fs, 'lstat').mockImplementation((path, options) => {
        calls.push('lstat'); return track(nativeLstat(path, options));
      });
      vi.spyOn(fs, 'realpath').mockImplementation((path, options) => {
        calls.push('realpath'); return track(nativeRealpath(path, options));
      });
      vi.spyOn(fs, 'mkdir').mockImplementation((path, options) => track((async () => {
        calls.push('mkdir'); await pause('mkdir');
        const result = await nativeMkdir(path, options); ioFinished('mkdir');
        return result;
      })()));
      vi.spyOn(fs, 'open').mockImplementation((path, flags, mode) => {
        if (String(path) !== requestPath) return nativeOpen(path, flags, mode);
        const closed = Promise.withResolvers<void>(); track(closed.promise);
        return track((async () => {
          const kind = flags === 'wx' ? 'wx' : 'read'; calls.push(`open:${kind}`);
          if (flags === 'wx') await pause('open');
          const handle = await nativeOpen(path, flags, mode).catch((error: unknown) => { closed.resolve(); throw error; });
          handles.push(handle); ioFinished(`open:${kind}`);
          const nativeClose = handle.close.bind(handle);
          vi.spyOn(handle, 'close').mockImplementation(() => track((async () => {
            calls.push(`close:${kind}`);
            try {
              if (flags === 'wx') await pause('close');
              if (flags === 'wx' ? phase !== 'fingerprint' : phase === 'fingerprint') {
                closing.resolve(); await releaseClose.promise;
              }
              await nativeClose(); ioFinished(`close:${kind}`);
            } finally { closed.resolve(); }
          })()));
          const nativeWrite = handle.writeFile.bind(handle); const nativeSync = handle.sync.bind(handle);
          vi.spyOn(handle, 'writeFile').mockImplementation((data, options) => track((async () => {
            calls.push('write'); await pause('write');
            await nativeWrite(data, options); ioFinished('write');
            if (writeFault) throw new Error('PRIVATE_IMAGE preparation fault');
          })()));
          vi.spyOn(handle, 'sync').mockImplementation(() => track((async () => {
            calls.push('sync'); await pause('sync');
            await nativeSync(); ioFinished('sync');
          })()));
          const nativeStat = handle.stat.bind(handle);
          vi.spyOn(handle, 'stat').mockImplementation((options) => track((async () => {
            calls.push('stat'); await pause('fingerprint');
            const result = await nativeStat(options); ioFinished('stat');
            return result;
          })()));
          vi.spyOn(handle, 'read');
          return handle;
        })());
      });
      let run: WorkerRun | undefined;
      try {
        run = launch({ policy: {
          timeoutMs: reason === 'timeout' ? 800 : policy.timeoutMs,
          // No-child confirmation must not wait for the child-only grace period.
          cancelGraceMs: 2_000, closeTimeoutMs: confirmed ? 1_000 : 50,
        } });
        void run.donePromise.then(() => { settled = true; }, () => { settled = true; });
        await within(entered.promise, 2_000);
        expect(children).toHaveLength(0); expect(childProcess.spawn).not.toHaveBeenCalled();
        if (reason === 'cancel') { run.cancel(); run.cancel(); }
        if (reason !== 'prepare-fault') await within(stopRequested.promise, 2_000);
        // One microtask phase observes any already-settled donePromise; no sleep
        // or fake clock can mask premature confirmation while native I/O is held.
        await Promise.resolve(); expect(settled).toBe(false);
        const callsAtStop = calls.length;
        let reported: WorkerSupervisorError | undefined;
        if (!confirmed) {
          reported = await within(expectFailure(run, 'WORKER_CLOSE_TIMEOUT', false), 1_000);
          if (phase === 'mkdir') await expect(nativeLstat(jobDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
          else expect((await nativeLstat(jobDirectory)).isDirectory()).toBe(true);
          expect(children).toHaveLength(0);
        }
        release.resolve();
        if (phase !== 'mkdir') {
          await within(closing.promise, 2_000);
          if (confirmed) { await Promise.resolve(); expect(settled).toBe(false); }
          releaseClose.resolve();
        }
        if (confirmed) {
          if (reason === 'cancel') await expect(within(run.donePromise, 2_000)).resolves.toEqual({ type: 'cancelled' });
          else await within(expectFailure(run, reason === 'timeout' ? 'WORKER_TIMEOUT' : 'WORKER_PREPARE'), 2_000);
        } else {
          await drainPreparation();
          expect(await run.donePromise.catch((error: unknown) => error)).toBe(reported);
          expect((await nativeLstat(jobDirectory)).isDirectory()).toBe(true);
        }
        expect(calls.slice(callsAtStop)).toEqual(phase === 'mkdir' || phase === 'close'
          ? [] : [phase === 'fingerprint' ? 'close:read' : 'close:wx']);
        expect(handles.every((handle) => handle.fd === -1 && vi.mocked(handle.read).mock.calls.length === 0)).toBe(true);
        if (confirmed) {
          // Exercise the caller's immediate cleanup, BEFORE the harness drain.
          await fs.rm(jobDirectory, { recursive: true, force: true });
          await drainPreparation();
          expect(lateIO).toEqual([]);
          await expect(nativeLstat(jobDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
        }
        expect(children).toHaveLength(0); expect(childProcess.spawn).not.toHaveBeenCalled();
      } finally {
        run?.cancel(); release.resolve(); releaseClose.resolve();
        await drainPreparation();
      }
    });
  }, 10_000);

  const verificationCases = (['read', 'close'] as const).flatMap((phase) =>
    (['cancel', 'timeout'] as const).flatMap((reason) => [true, false].map((confirmed) => ({ phase, reason, confirmed }))));
  it.each(verificationCases)('drains manifest $phase after child close on $reason (confirmed=$confirmed)', async ({ phase, reason, confirmed }) => {
    await withFixture(`begin(); manifest(); complete();`, async ({ launch, taskRoot, children, preparationIO, drainPreparation }) => {
      const jobDirectory = join(taskRoot, request.jobId); const target = join(jobDirectory, 'result.json');
      const entered = Promise.withResolvers<void>(); const release = Promise.withResolvers<void>();
      const closing = Promise.withResolvers<void>(); const releaseClose = Promise.withResolvers<void>();
      const stopRequested = Promise.withResolvers<void>();
      const handles: FileHandle[] = []; const calls: string[] = []; const lateIO: string[] = [];
      let settled = false; let paused = false;
      function track<T>(pending: Promise<T>): Promise<T> {
        preparationIO.push(pending); void pending.catch(() => undefined);
        return pending;
      }
      async function pause(operation: typeof phase): Promise<void> {
        if (operation === phase && !paused) { paused = true; entered.resolve(); await release.promise; }
      }
      function ioFinished(operation: string): void { if (settled) lateIO.push(operation); }
      const nativeAbort = AbortController.prototype.abort;
      vi.spyOn(AbortController.prototype, 'abort').mockImplementation(function (this: AbortController, value?: unknown) {
        nativeAbort.call(this, value); stopRequested.resolve();
      });
      // Gate only the actual result.json handle, not request preparation or the
      // real child/clock. The existing drain also owns these post-child-close I/Os.
      // Hold the final hash pass's close so verification can RETURN after abort;
      // that late return must not turn cancellation/timeout into completion.
      vi.spyOn(fs, 'open').mockImplementation((path, flags, mode) => {
        if (String(path) !== target) return nativeOpen(path, flags, mode);
        const closed = Promise.withResolvers<void>(); track(closed.promise);
        return track((async () => {
          calls.push('open');
          const handle = await nativeOpen(path, flags, mode).catch((error: unknown) => { closed.resolve(); throw error; });
          handles.push(handle); ioFinished('open');
          const gated = handles.length === (phase === 'read' ? 1 : 2);
          const nativeRead = handle.read.bind(handle); const nativeClose = handle.close.bind(handle);
          vi.spyOn(handle, 'read').mockImplementation((...args) => track((async () => {
            calls.push('read'); if (gated) await pause('read');
            const result = await nativeRead(...args); ioFinished('read');
            return result;
          })()));
          vi.spyOn(handle, 'close').mockImplementation(() => track((async () => {
            calls.push('close');
            try {
              if (gated) { await pause('close'); closing.resolve(); await releaseClose.promise; }
              await nativeClose(); ioFinished('close');
            } finally { closed.resolve(); }
          })()));
          vi.spyOn(handle, 'write'); vi.spyOn(handle, 'writeFile');
          return handle;
        })());
      });
      let run: WorkerRun | undefined;
      try {
        run = launch({ policy: {
          timeoutMs: reason === 'timeout' ? 800 : policy.timeoutMs,
          cancelGraceMs: 2_000, closeTimeoutMs: confirmed ? 1_000 : 50,
        } });
        void run.donePromise.then(() => { settled = true; }, () => { settled = true; });
        await within(entered.promise, 2_000);
        expect(children).toHaveLength(1); expect(children[0].closed).toBe(true);
        expect(children[0].child.exitCode).toBe(0);
        expect(handles).toHaveLength(phase === 'read' ? 1 : 2);
        expect(handles[handles.length - 1].fd).toBeGreaterThanOrEqual(0);
        if (reason === 'cancel') { run.cancel(); run.cancel(); }
        await within(stopRequested.promise, 2_000);
        await Promise.resolve(); expect(settled).toBe(false);
        const callsAtStop = calls.length;
        let reported: WorkerSupervisorError | undefined;
        if (!confirmed) reported = await within(expectFailure(run, 'WORKER_CLOSE_TIMEOUT', false), 1_000);
        expect((await nativeLstat(jobDirectory)).isDirectory()).toBe(true);
        expect((await nativeLstat(target)).isFile()).toBe(true);
        release.resolve();
        await within(closing.promise, 2_000);
        if (confirmed) { await Promise.resolve(); expect(settled).toBe(false); }
        releaseClose.resolve();
        if (confirmed) {
          if (reason === 'cancel') await expect(within(run.donePromise, 2_000)).resolves.toEqual({ type: 'cancelled' });
          else await within(expectFailure(run, 'WORKER_TIMEOUT'), 2_000);
          expect(handles.every((handle) => handle.fd === -1)).toBe(true);
          const callsAtDone = [...calls]; run.cancel();
          // A confirmed caller may clean up immediately, without the harness drain.
          await fs.rm(jobDirectory, { recursive: true, force: true });
          await drainPreparation();
          expect(lateIO).toEqual([]); expect(calls).toEqual(callsAtDone);
          await expect(nativeLstat(jobDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
        } else {
          await drainPreparation(); run.cancel();
          expect(await run.donePromise.catch((error: unknown) => error)).toBe(reported);
          expect((await nativeLstat(jobDirectory)).isDirectory()).toBe(true);
          expect((await nativeLstat(target)).isFile()).toBe(true);
        }
        expect(calls.slice(callsAtStop)).toEqual(phase === 'read' ? ['close'] : []);
        expect(handles).toHaveLength(phase === 'read' ? 1 : 2);
        for (const handle of handles) {
          expect(handle.fd).toBe(-1);
          expect(handle.read).toHaveBeenCalledTimes(phase === 'read' ? 1 : 2);
          expect(handle.close).toHaveBeenCalledTimes(1);
          expect(handle.write).not.toHaveBeenCalled(); expect(handle.writeFile).not.toHaveBeenCalled();
        }
        expect(children).toHaveLength(1); expect(childProcess.spawn).toHaveBeenCalledTimes(1);
        expect(children[0].child.kill).not.toHaveBeenCalled();
      } finally {
        run?.cancel(); release.resolve(); releaseClose.resolve();
        await drainPreparation();
      }
    });
  }, 10_000);

  const closeFailureCases = [
    { phase: 'request-write', reason: 'failure' },
    { phase: 'request-fingerprint', reason: 'failure' },
    { phase: 'manifest', reason: 'failure' },
    { phase: 'request-write', reason: 'cancel' },
    { phase: 'manifest', reason: 'cancel' },
    { phase: 'manifest', reason: 'timeout' },
  ] as const;
  it.each(closeFailureCases)('never confirms a rejected $phase handle close on $reason', async ({ phase, reason }) => {
    await withFixture(`begin(); manifest(); complete();`, async ({ launch, taskRoot, children, preparationIO, drainPreparation }) => {
      const jobDirectory = join(taskRoot, request.jobId);
      const target = join(jobDirectory, phase === 'manifest' ? 'result.json' : 'request.json');
      const entered = Promise.withResolvers<void>(); const release = Promise.withResolvers<void>();
      const stopRequested = Promise.withResolvers<void>();
      const handles: { handle: FileHandle; closeNative(): Promise<void>; drained(): void }[] = [];
      let settled = false;
      function track<T>(pending: Promise<T>): Promise<T> {
        preparationIO.push(pending); void pending.catch(() => undefined);
        return pending;
      }
      async function closeTestHandles(): Promise<void> {
        for (const owned of handles) {
          if (owned.handle.fd !== -1) await owned.closeNative();
          owned.drained();
        }
      }
      const nativeAbort = AbortController.prototype.abort;
      vi.spyOn(AbortController.prototype, 'abort').mockImplementation(function (this: AbortController, value?: unknown) {
        nativeAbort.call(this, value); stopRequested.resolve();
      });
      vi.spyOn(fs, 'open').mockImplementation((path, flags, mode) => {
        if (String(path) !== target || (phase === 'request-write' ? flags !== 'wx' : flags === 'wx')) return nativeOpen(path, flags, mode);
        const closed = Promise.withResolvers<void>(); track(closed.promise);
        return track((async () => {
          const handle = await nativeOpen(path, flags, mode).catch((error: unknown) => { closed.resolve(); throw error; });
          handles.push({ handle, closeNative: handle.close.bind(handle), drained: closed.resolve });
          vi.spyOn(handle, 'read'); vi.spyOn(handle, 'write'); vi.spyOn(handle, 'writeFile');
          vi.spyOn(handle, 'close').mockImplementation(() => track((async () => {
            entered.resolve(); await release.promise;
            // Fault injection leaves the REAL handle open: rejection is not proof
            // of closure. Only test-owned native cleanup below can close it.
            throw new Error('PRIVATE_IMAGE native close fault');
          })()));
          return handle;
        })());
      });
      let run: WorkerRun | undefined;
      try {
        run = launch({ policy: { timeoutMs: reason === 'timeout' ? 800 : policy.timeoutMs } });
        void run.donePromise.then(() => { settled = true; }, () => { settled = true; });
        await within(entered.promise, 2_000);
        expect(children).toHaveLength(phase === 'manifest' ? 1 : 0);
        if (phase === 'manifest') expect(children[0].closed).toBe(true);
        if (reason === 'cancel') { run.cancel(); run.cancel(); }
        if (reason !== 'failure') await within(stopRequested.promise, 2_000);
        await Promise.resolve(); expect(settled).toBe(false);
        release.resolve();
        const code = reason === 'timeout' ? 'WORKER_TIMEOUT' : phase === 'manifest' ? 'WORKER_MANIFEST' : 'WORKER_PREPARE';
        const reported = await within(expectFailure(run, code, false), 2_000);
        expect(handles).toHaveLength(1); expect(handles[0].handle.fd).toBeGreaterThanOrEqual(0);
        expect((await nativeLstat(jobDirectory)).isDirectory()).toBe(true);
        expect((await nativeLstat(target)).isFile()).toBe(true);
        run.cancel();
        // The caller retains files after false, even when independent cleanup
        // later proves the test handle closed. No automatic retry or promotion.
        await closeTestHandles(); await drainPreparation();
        expect(await run.donePromise.catch((error: unknown) => error)).toBe(reported);
        expect((await nativeLstat(jobDirectory)).isDirectory()).toBe(true);
        expect((await nativeLstat(target)).isFile()).toBe(true);
        for (const { handle } of handles) {
          expect(handle.fd).toBe(-1); expect(handle.close).toHaveBeenCalledTimes(1);
          expect(handle.read).toHaveBeenCalledTimes(phase === 'request-write' ? 0 : 2);
          expect(handle.writeFile).toHaveBeenCalledTimes(phase === 'request-write' ? 1 : 0);
          expect(handle.write).not.toHaveBeenCalled();
        }
        expect(children).toHaveLength(phase === 'manifest' ? 1 : 0);
        expect(childProcess.spawn).toHaveBeenCalledTimes(phase === 'manifest' ? 1 : 0);
        for (const { child } of children) expect(child.kill).not.toHaveBeenCalled();
      } finally {
        run?.cancel(); release.resolve();
        await closeTestHandles(); await drainPreparation();
      }
    });
  }, 10_000);

  it('confirms a synchronous spawn exception only after preparation closes', async () => {
    await withFixture(``, async ({ launch, children }) => {
      vi.mocked(childProcess.spawn).mockImplementationOnce(() => { throw new Error('PRIVATE_IMAGE spawn fault'); });
      await expectFailure(launch(), 'WORKER_SPAWN'); expect(children).toHaveLength(0);
    });
  }, 10_000);
  it('rejects a missing native executable with confirmed no process and no raw path', async () => {
    await withFixture(``, async ({ launch, directory }) => {
      const error = await expectFailure(launch({ executablePath: join(directory, 'PRIVATE_IMAGE-missing.exe') }), 'WORKER_SPAWN');
      expect(error.stack).not.toContain(directory);
    });
  }, 10_000);
  it('bounds a missing-executable error with undefined PID when close is deferred', async () => {
    await withFixture(``, async ({ launch, directory, taskRoot, children }) => {
      const closeHeld = Promise.withResolvers<void>(); const releaseClose = Promise.withResolvers<void>();
      const observedSpawn = vi.mocked(childProcess.spawn).getMockImplementation();
      if (!observedSpawn) throw new Error('Missing native spawn observation.');
      vi.mocked(childProcess.spawn).mockImplementation((file, args, options) => {
        const child = observedSpawn(file, args, options);
        const emitter: EventEmitter = child; const emit = emitter.emit.bind(emitter);
        vi.spyOn(emitter, 'emit').mockImplementation((event, ...values) => {
          if (event !== 'close') return emit(event, ...values);
          closeHeld.resolve();
          void releaseClose.promise.then(() => emit(event, ...values));
          return true;
        });
        return child;
      });
      const run = launch({ executablePath: join(directory, 'PRIVATE_IMAGE-missing.exe'),
        policy: { cancelGraceMs: 2_000, closeTimeoutMs: 50 } });
      try {
        await within(closeHeld.promise, 2_000);
        expect(children).toHaveLength(1); expect(children[0].child.pid).toBeUndefined();
        expect(children[0].closed).toBe(false);
        const error = await within(expectFailure(run, 'WORKER_CLOSE_TIMEOUT', false), 1_000);
        expect(children[0].child.kill).not.toHaveBeenCalled();
        expect((await nativeLstat(join(taskRoot, request.jobId))).isDirectory()).toBe(true);
        releaseClose.resolve(); await within(children[0].close, 2_000);
        expect(await run.donePromise.catch((value: unknown) => value)).toBe(error);
      } finally {
        run.cancel(); releaseClose.resolve();
        await within(Promise.all(children.map((child) => child.close)), 2_000);
      }
    });
  }, 10_000);

  it('refuses an existing exclusive job directory and retains its bytes', async () => {
    await withFixture(``, async ({ launch, taskRoot, children }) => {
      const owned = join(taskRoot, request.jobId); await fs.mkdir(owned);
      await fs.writeFile(join(owned, 'sentinel'), 'keep');
      await expectFailure(launch(), 'WORKER_PREPARE'); expect(children).toHaveLength(0);
      expect(await fs.readFile(join(owned, 'sentinel'), 'utf8')).toBe('keep');
    });
  }, 10_000);
  it('refuses a junction in the trusted root chain before any spawn/write into its target', async () => {
    await withFixture(``, async ({ launch, taskRoot, directory, children }) => {
      const outside = join(directory, 'outside'); await fs.mkdir(outside); await fs.rmdir(taskRoot);
      await fs.symlink(outside, taskRoot, process.platform === 'win32' ? 'junction' : 'dir');
      await expectFailure(launch(), 'WORKER_PREPARE'); expect(children).toHaveLength(0);
      expect(await fs.readdir(outside)).toEqual([]);
    });
  }, 10_000);
  it('rejects escaped job paths, health requests and invalid finite policy before spawn', async () => {
    await withFixture(``, async ({ launch, directory, children }) => {
      expect(() => launch({ jobDirectory: join(directory, request.jobId) })).toThrow('Worker job failed.');
      expect(() => launch({ request: { ...request, kind: 'health' } as unknown as WorkerRequest })).toThrow('Worker job failed.');
      for (const key of ['timeoutMs', 'cancelGraceMs', 'closeTimeoutMs', 'maxStdoutBytes', 'maxManifestBytes'] as const) {
        for (const value of [0, -1, NaN, Infinity]) expect(() => launch({ policy: { [key]: value } })).toThrow('Worker job failed.');
      }
      expect(() => launch({ policy: { timeoutMs: 2_147_483_648 } })).toThrow('Worker job failed.');
      expect(children).toHaveLength(0);
    });
  }, 10_000);
});