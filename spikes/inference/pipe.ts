import { once } from 'node:events';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';

type ShapeSpec = Readonly<{
  code: 1 | 2;
  width: 320 | 640;
  height: 320 | 640;
  label: '320x320' | '640x640';
}>;

const SHAPES: readonly ShapeSpec[] = [
  { code: 1, width: 320, height: 320, label: '320x320' },
  { code: 2, width: 640, height: 640, label: '640x640' },
] as const;

const VERSION = 1;
const HEADER_SIZE = 14;
const TARGET_INTERVAL_NS = 100_000_000n; // 10Hz
const FRAMES_PER_SHAPE = 100;
const TOTAL_EXPECTED_FRAMES = SHAPES.length * FRAMES_PER_SHAPE;
const CHILD_TIMEOUT_MS = 5_000;

interface AckOk {
  readonly type: 'ack';
  readonly ok: true;
  readonly seq: number;
  readonly shape: string;
  readonly body_len: number;
  readonly payload_len: number;
  readonly service_ns: number;
}

interface AckError {
  readonly type: 'ack';
  readonly ok: false;
  readonly seq: number;
  readonly error: string;
  readonly service_ns: number;
}

interface SummaryMessage {
  readonly type: 'summary';
  readonly ok: boolean;
  readonly frames: number;
  readonly cpu_process_ns: number;
  readonly rss_sample_bytes: number;
  readonly rss_peak_bytes: number;
  readonly rss_sample_kind: string;
  readonly error: string | null;
}

type ChildMessage = AckOk | AckError | SummaryMessage;

interface Stats {
  readonly intervalsNs: number[];
  readonly jittersNs: number[];
  readonly latenciesNs: number[];
  readonly serviceNs: number[];
}

interface ProbeResult {
  readonly name: string;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly ackOkCount: number;
  readonly ackErrorCount: number;
  readonly summaryOk: boolean | null;
  readonly stderr: string;
  readonly observedFailClosed: boolean;
}

function requireCondition(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function requireSummary(message: SummaryMessage | null): SummaryMessage {
  if (message === null) {
    throw new Error('missing summary from child');
  }
  return message;
}

function toNsMilliseconds(valueNs: number): number {
  return valueNs / 1_000_000;
}

function summarize(values: readonly number[]): { mean: number; p95: number; max: number } {
  if (values.length === 0) {
    return { mean: 0, p95: 0, max: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  const index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
  return {
    mean,
    p95: sorted[index] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
  };
}

function makeHeader(shape: ShapeSpec, frameIndex: number, version: number): Buffer {
  const header = Buffer.alloc(HEADER_SIZE);
  header.write('AV', 0, 2, 'ascii');
  header.writeUInt8(version, 2);
  header.writeUInt8(shape.code, 3);
  header.writeUInt16BE(shape.width, 4);
  header.writeUInt16BE(shape.height, 6);
  header.writeUInt8(3, 8);
  header.writeUInt8(0, 9);
  header.writeUInt32BE(frameIndex, 10);
  return header;
}

function makePayload(shape: ShapeSpec, fill: number): Buffer {
  const size = shape.width * shape.height * 3;
  const payload = Buffer.allocUnsafe(size);
  payload.fill(fill);
  return payload;
}

function makeBody(shape: ShapeSpec, frameIndex: number, version = VERSION): Buffer {
  const header = makeHeader(shape, frameIndex, version);
  const payload = makePayload(shape, frameIndex & 0xff);
  return Buffer.concat([header, payload]);
}

function makePacket(body: Buffer): Buffer {
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32BE(body.length, 0);
  return Buffer.concat([prefix, body]);
}

function parseMessage(line: string): ChildMessage {
  const raw: unknown = JSON.parse(line);
  requireCondition(typeof raw === 'object' && raw !== null, 'message is not an object');
  const record = raw as Record<string, unknown>;
  requireCondition(typeof record.type === 'string', 'message type is missing');
  if (record.type === 'ack') {
    requireCondition(typeof record.ok === 'boolean', 'ack ok is missing');
    if (record.ok) {
      requireCondition(
        hasExactKeys(record, [
          'type',
          'ok',
          'seq',
          'shape',
          'body_len',
          'payload_len',
          'service_ns',
        ]),
        'ack fields are invalid',
      );
      requireCondition(isNonNegativeSafeInteger(record.seq), 'ack seq invalid');
      requireCondition(typeof record.shape === 'string', 'ack shape missing');
      requireCondition(isNonNegativeSafeInteger(record.body_len), 'ack body_len invalid');
      requireCondition(isNonNegativeSafeInteger(record.payload_len), 'ack payload_len invalid');
      requireCondition(isNonNegativeSafeInteger(record.service_ns), 'ack service_ns invalid');
      return {
        type: 'ack',
        ok: true,
        seq: record.seq,
        shape: record.shape,
        body_len: record.body_len,
        payload_len: record.payload_len,
        service_ns: record.service_ns,
      };
    }
    requireCondition(
      hasExactKeys(record, ['type', 'ok', 'seq', 'error', 'service_ns']),
      'ack error fields are invalid',
    );
    requireCondition(isNonNegativeSafeInteger(record.seq), 'ack error seq invalid');
    requireCondition(typeof record.error === 'string' && record.error.length > 0, 'ack error missing');
    requireCondition(isNonNegativeSafeInteger(record.service_ns), 'ack error service_ns invalid');
    return {
      type: 'ack',
      ok: false,
      seq: record.seq,
      error: record.error,
      service_ns: record.service_ns,
    };
  }

  requireCondition(record.type === 'summary', 'unknown message type');
  requireCondition(
    hasExactKeys(record, [
      'type',
      'ok',
      'frames',
      'cpu_process_ns',
      'rss_sample_bytes',
      'rss_peak_bytes',
      'rss_sample_kind',
      'error',
    ]),
    'summary fields are invalid',
  );
  requireCondition(typeof record.ok === 'boolean', 'summary ok missing');
  requireCondition(isNonNegativeSafeInteger(record.frames), 'summary frames invalid');
  requireCondition(isNonNegativeSafeInteger(record.cpu_process_ns), 'summary cpu_process_ns invalid');
  requireCondition(isNonNegativeSafeInteger(record.rss_sample_bytes), 'summary rss sample invalid');
  requireCondition(isNonNegativeSafeInteger(record.rss_peak_bytes), 'summary rss peak invalid');
  requireCondition(
    record.rss_sample_kind === 'current-working-set-after-last-frame' ||
      record.rss_sample_kind === 'ru-maxrss-high-water-mark',
    'summary rss sample kind invalid',
  );
  let summaryError: string | null;
  if (record.ok) {
    requireCondition(record.error === null, 'successful summary error must be null');
    summaryError = null;
  } else {
    requireCondition(
      typeof record.error === 'string' && record.error.length > 0,
      'failed summary error is missing',
    );
    summaryError = record.error;
  }

  return {
    type: 'summary',
    ok: record.ok,
    frames: record.frames,
    cpu_process_ns: record.cpu_process_ns,
    rss_sample_bytes: record.rss_sample_bytes,
    rss_peak_bytes: record.rss_peak_bytes,
    rss_sample_kind: record.rss_sample_kind,
    error: summaryError,
  };
}

function nowNs(): bigint {
  return BigInt(Math.trunc(performance.now() * 1_000_000));
}

async function sleepUntil(targetNs: bigint): Promise<void> {
  while (true) {
    const remainingNs = targetNs - nowNs();
    if (remainingNs <= 0n) {
      return;
    }
    const sleepMs = Number(remainingNs / 1_000_000n);
    if (sleepMs > 1) {
      await new Promise<void>((resolveSleep) => setTimeout(resolveSleep, sleepMs - 1));
    } else {
      await new Promise<void>((resolveSleep) => setTimeout(resolveSleep, 0));
    }
  }
}

async function writePacket(stream: NodeJS.WritableStream, packet: Buffer): Promise<void> {
  if (!stream.write(packet)) {
    await once(stream, 'drain');
  }
}

async function withTimeout<T>(operation: Promise<T>, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), CHILD_TIMEOUT_MS);
    timer.unref();
  });

  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

async function terminateChild(
  child: ChildProcessWithoutNullStreams,
  closePromise: Promise<[number | null, NodeJS.Signals | null]>,
  label: string,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  try {
    await withTimeout(closePromise, `${label} did not close after SIGTERM`);
  } catch {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await withTimeout(closePromise, `${label} did not close after SIGKILL`);
  }
}

async function runMainTransport(pythonExe: string): Promise<void> {
  const scriptPath = resolve(process.cwd(), 'spikes/inference/pipe.py');
  const child = spawn(pythonExe, [scriptPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const closePromise = once(child, 'close') as Promise<[
    number | null,
    NodeJS.Signals | null,
  ]>;

  const readline = createInterface({ input: child.stdout });
  const ackQueue: (AckOk | AckError)[] = [];
  const ackWaiters: Array<{
    resolve(ack: AckOk | AckError): void;
    reject(error: Error): void;
  }> = [];
  let summaryMessage: SummaryMessage | null = null;
  let messageFailure: Error | undefined;
  const stderrChunks: Buffer[] = [];

  child.stderr.on('data', (chunk: Buffer) => {
    stderrChunks.push(chunk);
  });

  readline.on('line', (line) => {
    if (messageFailure !== undefined) return;
    try {
      const message = parseMessage(line);
      if (message.type === 'summary') {
        summaryMessage = message;
        return;
      }
      const waiter = ackWaiters.shift();
      if (waiter !== undefined) {
        waiter.resolve(message);
        return;
      }
      ackQueue.push(message);
    } catch (error: unknown) {
      messageFailure = error instanceof Error ? error : new Error(String(error));
      for (const waiter of ackWaiters.splice(0)) waiter.reject(messageFailure);
      child.kill('SIGTERM');
    }
  });

  const waitForAck = async (): Promise<AckOk | AckError> => {
    const immediate = ackQueue.shift();
    if (immediate !== undefined) {
      return immediate;
    }
    return new Promise<AckOk | AckError>((resolveAck, rejectAck) => {
      ackWaiters.push({ resolve: resolveAck, reject: rejectAck });
    });
  };

  const nodeCpuStart = process.cpuUsage();
  let nodeRssSampledPeakBytes = process.memoryUsage.rss();

  const byShape = new Map<string, Stats>();
  const sendTimesByShape = new Map<string, number[]>();
  for (const shape of SHAPES) {
    byShape.set(shape.label, {
      intervalsNs: [],
      jittersNs: [],
      latenciesNs: [],
      serviceNs: [],
    });
    sendTimesByShape.set(shape.label, []);
  }

  let globalSeq = 0;
  let targetNs = nowNs();

  try {
    for (const shape of SHAPES) {
      for (let i = 0; i < FRAMES_PER_SHAPE; i += 1) {
        targetNs += TARGET_INTERVAL_NS;
        await sleepUntil(targetNs);

        const sendNs = nowNs();
        const body = makeBody(shape, globalSeq, VERSION);
        const packet = makePacket(body);

        await writePacket(child.stdin, packet);

        const ack = await withTimeout(
          waitForAck(),
          `Python worker did not acknowledge frame ${globalSeq}`,
        );
        const ackNs = nowNs();

        if (!ack.ok) {
          throw new Error(`python rejected valid frame seq=${ack.seq}: ${ack.error}`);
        }

        requireCondition(ack.seq === globalSeq, `ack seq mismatch: ${ack.seq} != ${globalSeq}`);
        requireCondition(ack.shape === shape.label, `ack shape mismatch: ${ack.shape}`);

        const expectedPayload = shape.width * shape.height * 3;
        requireCondition(
          ack.payload_len === expectedPayload,
          `payload length mismatch: ${ack.payload_len} != ${expectedPayload}`,
        );
        requireCondition(
          ack.body_len === expectedPayload + HEADER_SIZE,
          `body length mismatch: ${ack.body_len} != ${expectedPayload + HEADER_SIZE}`,
        );

        const stats = byShape.get(shape.label);
        requireCondition(stats !== undefined, `missing stats for shape ${shape.label}`);
        stats.latenciesNs.push(Number(ackNs - sendNs));
        stats.serviceNs.push(ack.service_ns);

        const sendTimes = sendTimesByShape.get(shape.label);
        requireCondition(sendTimes !== undefined, `missing sendTimes for shape ${shape.label}`);
        sendTimes.push(Number(sendNs));

        nodeRssSampledPeakBytes = Math.max(nodeRssSampledPeakBytes, process.memoryUsage.rss());
        globalSeq += 1;
      }
    }

    for (const shape of SHAPES) {
      const stats = byShape.get(shape.label);
      const sendTimes = sendTimesByShape.get(shape.label);
      requireCondition(stats !== undefined && sendTimes !== undefined, 'shape stats missing');

      for (let i = 1; i < sendTimes.length; i += 1) {
        const interval = sendTimes[i] - sendTimes[i - 1];
        stats.intervalsNs.push(interval);
        stats.jittersNs.push(Math.abs(interval - Number(TARGET_INTERVAL_NS)));
      }
    }

    child.stdin.end();
    const [exitCode, signal] = (await withTimeout(
      closePromise,
      'Python worker did not close after stdin ended',
    )) as [number | null, NodeJS.Signals | null];

    requireCondition(signal === null, `child terminated by signal ${signal ?? 'unknown'}`);
    requireCondition(exitCode === 0, `child exited with code ${exitCode ?? -1}`);
    if (messageFailure !== undefined) throw messageFailure;
    const summary = requireSummary(summaryMessage);
    requireCondition(summary.ok, `child summary indicates failure: ${summary.error}`);
    requireCondition(
      summary.frames === TOTAL_EXPECTED_FRAMES,
      `summary frame count mismatch: ${summary.frames} != ${TOTAL_EXPECTED_FRAMES}`,
    );

    const nodeCpuEnd = process.cpuUsage(nodeCpuStart);
    const nodeCpuNs = (nodeCpuEnd.user + nodeCpuEnd.system) * 1000;
    const stderr = Buffer.concat(stderrChunks).toString('utf8');

    const shapeMetrics = SHAPES.map((shape) => {
      const stats = byShape.get(shape.label);
      requireCondition(stats !== undefined, `stats missing for ${shape.label}`);
      const intervalSummary = summarize(stats.intervalsNs);
      const jitterSummary = summarize(stats.jittersNs);
      const latencySummary = summarize(stats.latenciesNs);
      const serviceSummary = summarize(stats.serviceNs);
      return {
        shape: shape.label,
        frames: FRAMES_PER_SHAPE,
        interval_ms: {
          mean: toNsMilliseconds(intervalSummary.mean),
          p95: toNsMilliseconds(intervalSummary.p95),
          max: toNsMilliseconds(intervalSummary.max),
        },
        jitter_ms: {
          mean: toNsMilliseconds(jitterSummary.mean),
          p95: toNsMilliseconds(jitterSummary.p95),
          max: toNsMilliseconds(jitterSummary.max),
        },
        send_to_ack_latency_ms: {
          mean: toNsMilliseconds(latencySummary.mean),
          p95: toNsMilliseconds(latencySummary.p95),
          max: toNsMilliseconds(latencySummary.max),
        },
        python_service_ms: {
          mean: toNsMilliseconds(serviceSummary.mean),
          p95: toNsMilliseconds(serviceSummary.p95),
          max: toNsMilliseconds(serviceSummary.max),
        },
      };
    });

    const probes = await runMalformedProbes(pythonExe, scriptPath);
    requireCondition(
      probes.length === 3 &&
        probes.every(
          (probe) =>
            probe.exitCode === 2 &&
            probe.signal === null &&
            probe.ackOkCount === 0 &&
            probe.ackErrorCount === 1 &&
            probe.summaryOk === false &&
            probe.stderr === '' &&
            probe.observedFailClosed,
        ),
      'one or more malformed probes did not fail closed',
    );

    const finalReport = {
      status: 'ok',
      transport: {
        protocol: {
          prefix: '4-byte big-endian body length',
          header: 'magic(2)+version(1)+shape(1)+width(2)+height(2)+channels(1)+reserved(1)+frame_index(4)',
          header_size: HEADER_SIZE,
          target_hz: 10,
        },
        frames_total: TOTAL_EXPECTED_FRAMES,
        frames_per_shape: FRAMES_PER_SHAPE,
        node_cpu_ns: nodeCpuNs,
        node_rss_sampled_peak_bytes: nodeRssSampledPeakBytes,
        python_cpu_ns: summary.cpu_process_ns,
        python_rss_sample_bytes: summary.rss_sample_bytes,
        python_rss_peak_bytes: summary.rss_peak_bytes,
        python_rss_sample_kind: summary.rss_sample_kind,
        child_exit_code: exitCode,
        child_signal: signal,
        child_stderr: stderr,
        shape_metrics: shapeMetrics,
      },
      malformed_probes: probes,
      children_reaped: true,
    };

    process.stdout.write(`${JSON.stringify(finalReport, null, 2)}\n`);
  } finally {
    if (!child.stdin.destroyed) {
      child.stdin.destroy();
    }
    await terminateChild(child, closePromise, 'Python worker');
    readline.close();
  }
}

async function runMalformedProbes(pythonExe: string, scriptPath: string): Promise<ProbeResult[]> {
  const results: ProbeResult[] = [];

  const runProbe = async (name: string, packetWriter: (stdin: NodeJS.WritableStream) => Promise<void>): Promise<void> => {
    const child = spawn(pythonExe, [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const closePromise = once(child, 'close') as Promise<[
      number | null,
      NodeJS.Signals | null,
    ]>;

    const readline = createInterface({ input: child.stdout });
    let ackOkCount = 0;
    let ackErrorCount = 0;
    let summaryOk: boolean | null = null;
    let messageFailure: Error | undefined;
    const stderrChunks: Buffer[] = [];

    child.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    readline.on('line', (line) => {
      if (messageFailure !== undefined) return;
      try {
        const message = parseMessage(line);
        if (message.type === 'ack') {
          if (message.ok) {
            ackOkCount += 1;
          } else {
            ackErrorCount += 1;
          }
          return;
        }
        summaryOk = message.ok;
      } catch (error: unknown) {
        messageFailure = error instanceof Error ? error : new Error(String(error));
        child.kill('SIGTERM');
      }
    });

    try {
      try {
        await packetWriter(child.stdin);
        child.stdin.end();
      } catch {
        if (!child.stdin.destroyed) child.stdin.destroy();
      }

      const [exitCode, signal] = await withTimeout(
        closePromise,
        `Malformed probe ${name} did not close`,
      );
      if (messageFailure !== undefined) throw messageFailure;
      const stderr = Buffer.concat(stderrChunks).toString('utf8');
      const observedFailClosed = ackOkCount === 0 && ackErrorCount >= 1 && exitCode !== 0;

      results.push({
        name,
        exitCode,
        signal,
        ackOkCount,
        ackErrorCount,
        summaryOk,
        stderr,
        observedFailClosed,
      });
    } finally {
      if (!child.stdin.destroyed) child.stdin.destroy();
      await terminateChild(child, closePromise, `Malformed probe ${name}`);
      readline.close();
    }
  };

  await runProbe('bad_version', async (stdin) => {
    const shape = SHAPES[0];
    const body = makeBody(shape, 0, 99);
    await writePacket(stdin, makePacket(body));
  });

  await runProbe('bad_shape_code', async (stdin) => {
    const shape = SHAPES[0];
    const body = makeBody(shape, 0, VERSION);
    body.writeUInt8(9, 3);
    await writePacket(stdin, makePacket(body));
  });

  await runProbe('bad_length_prefix', async (stdin) => {
    const shape = SHAPES[0];
    const body = makeBody(shape, 0, VERSION);
    const prefix = Buffer.alloc(4);
    prefix.writeUInt32BE(body.length + 13, 0);
    const malformedPacket = Buffer.concat([prefix, body]);
    await writePacket(stdin, malformedPacket);
  });

  return results;
}

async function main(): Promise<void> {
  const pythonArgument = process.argv[2];
  requireCondition(pythonArgument !== undefined, 'Usage: pipe.ts <python-executable>');
  const pythonExe = resolve(process.cwd(), pythonArgument);
  await runMainTransport(pythonExe);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  process.stderr.write(`SPI-07 transport pipe failed: ${message}\n`);
  process.exitCode = 1;
});
