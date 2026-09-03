import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const schemaVersion = 1;
const workerPath = join(dirname(fileURLToPath(import.meta.url)), 'worker.py');

interface WorkerEvent {
  readonly schemaVersion: number;
  readonly type: string;
  readonly jobId: string;
  readonly completed?: number;
  readonly total?: number;
  readonly code?: string;
}

interface WorkerRun {
  readonly exitCode: number;
  readonly events: readonly WorkerEvent[];
  readonly stderr: string;
}

export interface WorkerSmokeResult {
  readonly runtime: 'node' | 'electron';
  readonly pythonVersion: string;
  readonly successfulRun: WorkerRun;
  readonly cancelledRun: WorkerRun;
}

function requireCondition(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function parseEvent(line: string): WorkerEvent {
  const value: unknown = JSON.parse(line);
  requireCondition(value !== null && typeof value === 'object', 'NDJSON event is not an object');
  const event = value as Record<string, unknown>;
  requireCondition(event.schemaVersion === schemaVersion, 'NDJSON schemaVersion mismatch');
  requireCondition(typeof event.type === 'string', 'NDJSON event type is missing');
  requireCondition(typeof event.jobId === 'string', 'NDJSON event jobId is missing');
  return event as unknown as WorkerEvent;
}

async function runWorker(
  pythonExecutable: string,
  inputPath: string,
  cancelAfterProgress: boolean,
): Promise<WorkerRun> {
  const child = spawn(pythonExecutable, [workerPath, inputPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const events: WorkerEvent[] = [];
  let stdoutBuffer = '';
  let stderr = '';
  let cancelSent = false;

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });
  child.stdout.on('data', (chunk: string) => {
    stdoutBuffer += chunk;
    const lines = stdoutBuffer.split('\n');
    stdoutBuffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line) continue;
      const event = parseEvent(line);
      events.push(event);
      if (cancelAfterProgress && event.type === 'progress' && !cancelSent) {
        cancelSent = true;
        child.stdin.end(
          `${JSON.stringify({ schemaVersion, type: 'cancel', jobId: event.jobId })}\n`,
        );
      }
    }
  });

  const exitCode = await new Promise<number>((resolveExit, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('Python worker did not exit within 10 seconds'));
    }, 10_000);
    timeout.unref();
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timeout);
      resolveExit(code ?? -1);
    });
  });

  requireCondition(stdoutBuffer.length === 0, 'Worker emitted an unterminated NDJSON line');
  return { exitCode, events, stderr };
}

async function readPythonVersion(pythonExecutable: string): Promise<string> {
  const child = spawn(pythonExecutable, ['--version'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let output = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk: string) => {
    output += chunk;
  });
  const exitCode = await new Promise<number>((resolveExit, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolveExit(code ?? -1));
  });
  requireCondition(exitCode === 0, 'Python --version failed');
  return output.trim();
}

export async function runWorkerSmoke(pythonExecutable: string): Promise<WorkerSmokeResult> {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'autovision-spi02-'));
  try {
    const successfulInput = join(temporaryDirectory, 'complete.json');
    const cancelledInput = join(temporaryDirectory, 'cancel.json');
    await writeFile(
      successfulInput,
      JSON.stringify({ schemaVersion, jobId: 'spi02-complete', mode: 'complete' }),
      'utf8',
    );
    await writeFile(
      cancelledInput,
      JSON.stringify({ schemaVersion, jobId: 'spi02-cancel', mode: 'await-cancel' }),
      'utf8',
    );

    const successfulRun = await runWorker(pythonExecutable, successfulInput, false);
    const cancelledRun = await runWorker(pythonExecutable, cancelledInput, true);

    requireCondition(successfulRun.exitCode === 0, 'Successful worker exited non-zero');
    requireCondition(
      successfulRun.events.map((event) => event.type).join(',') ===
        'started,progress,progress,completed',
      'Successful worker event sequence is invalid',
    );
    requireCondition(
      successfulRun.stderr.trimEnd() === 'SPI-02 diagnostic channel' &&
        successfulRun.stderr.split(/\r?\n/u).length === 2,
      'Worker diagnostic channel is invalid',
    );
    requireCondition(cancelledRun.exitCode === 0, 'Cancelled worker exited non-zero');
    requireCondition(
      cancelledRun.events.map((event) => event.type).join(',') ===
        'started,progress,warning',
      'Cancelled worker event sequence is invalid',
    );
    requireCondition(
      cancelledRun.events.at(-1)?.code === 'CANCELLED',
      'Worker did not acknowledge cancellation',
    );
    requireCondition(cancelledRun.stderr === '', 'Cancelled worker wrote unexpected diagnostics');

    const electronVersion = (
      process.versions as NodeJS.ProcessVersions & { readonly electron?: string }
    ).electron;
    return {
      runtime: electronVersion === undefined ? 'node' : 'electron',
      pythonVersion: await readPythonVersion(pythonExecutable),
      successfulRun,
      cancelledRun,
    };
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

function isDirectExecution(): boolean {
  const entryPath = process.argv[1];
  return (
    process.argv.includes('--autovision-worker-smoke') ||
    (entryPath !== undefined && import.meta.url === pathToFileURL(resolve(entryPath)).href)
  );
}

if (isDirectExecution()) {
  const flagIndex = process.argv.indexOf('--autovision-worker-smoke');
  const pythonExecutable = flagIndex >= 0 ? process.argv[flagIndex + 1] : process.argv[2];
  if (pythonExecutable === undefined) {
    console.error('Usage: main.ts <python-executable>');
    process.exit(2);
  } else {
    runWorkerSmoke(pythonExecutable).then(
      (result) => {
        console.log(JSON.stringify(result));
        process.exit(0);
      },
      (error: unknown) => {
        console.error(`SPI-02 worker smoke failed: ${error instanceof Error ? error.message : error}`);
        process.exit(1);
      },
    );
  }
}
