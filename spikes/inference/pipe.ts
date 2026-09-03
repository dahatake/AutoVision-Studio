import { once } from 'node:events';
import { spawn } from 'node:child_process';
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
  readonly rss_last_bytes: number;
  readonly rss_peak_bytes: number;
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
      requireCondition(typeof record.seq === 'number', 'ack seq missing');
      requireCondition(typeof record.shape === 'string', 'ack shape missing');
      requireCondition(typeof record.body_len === 'number', 'ack body_len missing');
      requireCondition(typeof record.payload_len === 'number', 'ack payload_len missing');
      requireCondition(typeof record.service_ns === 'number', 'ack service_ns missing');
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
    requireCondition(typeof record.seq === 'number', 'ack error seq missing');
    requireCondition(typeof record.error === 'string', 'ack error missing');
    requireCondition(typeof record.service_ns === 'number', 'ack error service_ns missing');
    return {
      type: 'ack',
      ok: false,
      seq: record.seq,
      error: record.error,
      service_ns: record.service_ns,
    };
  }

  requireCondition(record.type === 'summary', 'unknown message type');
  requireCondition(typeof record.ok === 'boolean', 'summary ok missing');
  requireCondition(typeof record.frames === 'number', 'summary frames missing');
  requireCondition(typeof record.cpu_process_ns === 'number', 'summary cpu_process_ns missing');
  requireCondition(typeof record.rss_last_bytes === 'number', 'summary rss_last_bytes missing');
  requireCondition(typeof record.rss_peak_bytes === 'number', 'summary rss_peak_bytes missing');
  requireCondition(
    typeof record.error === 'string' || record.error === null,
    'summary error missing',
  );

  return {
    type: 'summary',
    ok: record.ok,
    frames: record.frames,
    cpu_process_ns: record.cpu_process_ns,
    rss_last_bytes: record.rss_last_bytes,
    rss_peak_bytes: record.rss_peak_bytes,
    error: record.error,
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

async function runMainTransport(pythonExe: string): Promise<void> {
  const scriptPath = resolve(process.cwd(), 'spikes/inference/pipe.py');
  const child = spawn(pythonExe, [scriptPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const readline = createInterface({ input: child.stdout });
  const ackQueue: (AckOk | AckError)[] = [];
  const ackWaiters: Array<(ack: AckOk | AckError) => void> = [];
  let summaryMessage: SummaryMessage | null = null;
  const stderrChunks: Buffer[] = [];

  child.stderr.on('data', (chunk: Buffer) => {
    stderrChunks.push(chunk);
  });

  readline.on('line', (line) => {
    const message = parseMessage(line);
    if (message.type === 'summary') {
      summaryMessage = message;
      return;
    }
    const waiter = ackWaiters.shift();
    if (waiter !== undefined) {
      waiter(message);
      return;
    }
    ackQueue.push(message);
  });

  const waitForAck = async (): Promise<AckOk | AckError> => {
    const immediate = ackQueue.shift();
    if (immediate !== undefined) {
      return immediate;
    }
    return new Promise<AckOk | AckError>((resolveAck) => {
      ackWaiters.push(resolveAck);
    });
  };

  const nodeCpuStart = process.cpuUsage();
  let nodeRssPeakBytes = process.memoryUsage.rss();

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

        nodeRssPeakBytes = Math.max(nodeRssPeakBytes, process.memoryUsage.rss());
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
      once(child, 'close'),
      'Python worker did not close after stdin ended',
    )) as [number | null, NodeJS.Signals | null];

    requireCondition(signal === null, `child terminated by signal ${signal ?? 'unknown'}`);
    requireCondition(exitCode === 0, `child exited with code ${exitCode ?? -1}`);
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
        node_rss_peak_bytes: nodeRssPeakBytes,
        python_cpu_ns: summary.cpu_process_ns,
        python_rss_last_bytes: summary.rss_last_bytes,
        python_rss_peak_bytes: summary.rss_peak_bytes,
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
    if (child.exitCode === null && child.signalCode === null) {
      const close = once(child, 'close');
      child.kill('SIGTERM');
      await withTimeout(close, 'Python worker did not close after SIGTERM');
    }
    readline.close();
  }
}

async function runMalformedProbes(pythonExe: string, scriptPath: string): Promise<ProbeResult[]> {
  const results: ProbeResult[] = [];

  const runProbe = async (name: string, packetWriter: (stdin: NodeJS.WritableStream) => Promise<void>): Promise<void> => {
    const child = spawn(pythonExe, [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const readline = createInterface({ input: child.stdout });
    let ackOkCount = 0;
    let ackErrorCount = 0;
    let summaryOk: boolean | null = null;
    const stderrChunks: Buffer[] = [];

    child.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    readline.on('line', (line) => {
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
    });

    try {
      await packetWriter(child.stdin);
      child.stdin.end();
    } catch {
      if (!child.stdin.destroyed) {
        child.stdin.destroy();
      }
    }

    const [exitCode, signal] = (await withTimeout(
      once(child, 'close'),
      `Malformed probe ${name} did not close`,
    )) as [number | null, NodeJS.Signals | null];
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

    readline.close();
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
