import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';

const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const TASKKILL_TIMEOUT_MS = 3_000;
const CLOSE_GRACE_MS = 1_000;

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function compareNames(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function validateRelativePath(path) {
  const segments = typeof path === 'string' ? path.split('/') : [];
  requireCondition(
    typeof path === 'string' &&
      path.length > 0 &&
      !path.startsWith('/') &&
      !path.endsWith('/') &&
      !path.includes('\\') &&
      !/[<>:"|?*\u0000-\u001f\u007f]/u.test(path) &&
      segments.every(
        (segment) =>
          segment.length > 0 &&
          segment !== '.' &&
          segment !== '..' &&
          !/[ .]$/u.test(segment) &&
          !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu.test(segment),
      ),
    'Inventory contains an unsafe relative path',
  );
}

async function hashRegularFile(path, before) {
  const digest = createHash('sha256');
  let bytesRead = 0;
  await new Promise((resolve, reject) => {
    const source = createReadStream(path);
    source.on('data', (chunk) => {
      bytesRead += chunk.length;
      digest.update(chunk);
    });
    source.once('error', reject);
    source.once('end', resolve);
  });
  const after = await lstat(path, { bigint: true });
  requireCondition(
    after.isFile() &&
      after.nlink === 1n &&
      before.dev === after.dev &&
      before.ino === after.ino &&
      before.size === after.size &&
      before.mtimeNs === after.mtimeNs &&
      BigInt(bytesRead) === after.size,
    'Inventory file changed while hashing',
  );
  requireCondition(after.size <= BigInt(Number.MAX_SAFE_INTEGER), 'Inventory file is too large');
  return {
    byteSize: Number(after.size),
    sha256: digest.digest('hex'),
  };
}

async function walkDirectory(root, relativeDirectory, files) {
  const directory = relativeDirectory === '' ? root : join(root, ...relativeDirectory.split('/'));
  const directoryInfo = await lstat(directory, { bigint: true });
  requireCondition(
    directoryInfo.isDirectory() && !directoryInfo.isSymbolicLink(),
    'Inventory root contains a linked or non-directory node',
  );
  const entries = await readdir(directory);
  entries.sort(compareNames);
  for (const name of entries) {
    requireCondition(name !== '.' && name !== '..' && !/[\u0000-\u001f\u007f]/u.test(name), 'Inventory entry has an unsafe name');
    const relativePath = relativeDirectory === '' ? name : `${relativeDirectory}/${name}`;
    validateRelativePath(relativePath);
    const absolutePath = join(directory, name);
    const info = await lstat(absolutePath, { bigint: true });
    if (info.isSymbolicLink()) throw new Error('Inventory links and junctions are forbidden');
    if (info.isDirectory()) {
      await walkDirectory(root, relativePath, files);
    } else if (info.isFile()) {
      requireCondition(info.nlink === 1n, 'Inventory hard-linked files are forbidden');
      files.push({ path: relativePath, ...(await hashRegularFile(absolutePath, info)) });
    } else {
      throw new Error('Inventory contains a non-file node');
    }
  }
}

export function encodeInventory(manifest) {
  validateInventory(manifest);
  return Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

export function validateInventory(manifest) {
  requireCondition(
    manifest !== null && typeof manifest === 'object' && !Array.isArray(manifest),
    'Inventory must be an object',
  );
  requireCondition(
    Object.keys(manifest).sort(compareNames).join(',') === 'fileCount,files,schemaVersion,totalBytes',
    'Inventory has unexpected fields',
  );
  requireCondition(manifest.schemaVersion === 1, 'Inventory schema version must be 1');
  requireCondition(Array.isArray(manifest.files) && manifest.files.length > 0, 'Inventory files must be non-empty');
  requireCondition(
    Number.isSafeInteger(manifest.fileCount) && manifest.fileCount === manifest.files.length,
    'Inventory file count differs',
  );
  const seen = new Set();
  let totalBytes = 0;
  let previousPath = null;
  for (const file of manifest.files) {
    requireCondition(
      file !== null &&
        typeof file === 'object' &&
        !Array.isArray(file) &&
        Object.keys(file).sort(compareNames).join(',') === 'byteSize,path,sha256',
      'Inventory file has unexpected fields',
    );
    validateRelativePath(file.path);
    requireCondition(previousPath === null || compareNames(previousPath, file.path) < 0, 'Inventory paths are not unique and sorted');
    requireCondition(!seen.has(file.path.toLowerCase()), 'Inventory contains a case-insensitive duplicate path');
    requireCondition(Number.isSafeInteger(file.byteSize) && file.byteSize >= 0, 'Inventory file size is invalid');
    requireCondition(typeof file.sha256 === 'string' && HASH_PATTERN.test(file.sha256), 'Inventory file SHA-256 is invalid');
    seen.add(file.path.toLowerCase());
    previousPath = file.path;
    totalBytes += file.byteSize;
    requireCondition(Number.isSafeInteger(totalBytes), 'Inventory total size is too large');
  }
  requireCondition(manifest.totalBytes === totalBytes, 'Inventory total size differs');
  return manifest;
}

export async function inventoryDirectory(root) {
  requireCondition(typeof root === 'string' && isAbsolute(root), 'Inventory root must be absolute');
  const files = [];
  await walkDirectory(root, '', files);
  files.sort((left, right) => compareNames(left.path, right.path));
  const manifest = {
    schemaVersion: 1,
    fileCount: files.length,
    totalBytes: files.reduce((total, file) => total + file.byteSize, 0),
    files,
  };
  const bytes = encodeInventory(manifest);
  return {
    manifest,
    bytes,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

export function compareInventories(expected, actual) {
  validateInventory(expected);
  validateInventory(actual);
  requireCondition(expected.fileCount === actual.fileCount, 'Installed worker file count differs');
  requireCondition(expected.totalBytes === actual.totalBytes, 'Installed worker byte total differs');
  for (let index = 0; index < expected.files.length; index += 1) {
    const left = expected.files[index];
    const right = actual.files[index];
    requireCondition(left.path === right.path, 'Installed worker file path differs');
    requireCondition(left.byteSize === right.byteSize, `Installed worker file size differs: ${left.path}`);
    requireCondition(left.sha256 === right.sha256, `Installed worker file SHA-256 differs: ${left.path}`);
  }
  return true;
}

function decodeUtf8(bytes, label) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label} is not valid UTF-8`);
  }
}

function rejectDuplicateObjectKeys(text, label) {
  // JSON.parse already checked syntax; only track decoded keys, not numeric spelling.
  const stack = [];
  for (const match of text.matchAll(/"(?:\\.|[^"\\])*"|[{}\[\]]/gu)) {
    const token = match[0];
    if (token === '{' || token === '[') {
      stack.push(token === '{' ? new Set() : null);
    } else if (token === '}' || token === ']') {
      stack.pop();
    } else if (/^\s*:/u.test(text.slice(match.index + token.length))) {
      const keys = stack.at(-1);
      const key = JSON.parse(token);
      requireCondition(!keys.has(key), `${label} contains a duplicate object key`);
      keys.add(key);
    }
  }
}

function parseSingleJsonLine(bytes, label) {
  requireCondition(bytes.length > 0 && bytes.length <= MAX_OUTPUT_BYTES, `${label} output size is invalid`);
  const text = decodeUtf8(bytes, label);
  requireCondition(!text.includes('\u0000'), `${label} contains a NUL byte`);
  const lines = text.split(/\r?\n/u);
  if (lines.at(-1) === '') lines.pop();
  requireCondition(lines.length === 1 && lines[0].length > 0 && lines[0].trim() === lines[0], `${label} must contain exactly one compact JSON line`);
  let value;
  try {
    value = JSON.parse(lines[0]);
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
  rejectDuplicateObjectKeys(lines[0], label);
  requireCondition(value !== null && typeof value === 'object' && !Array.isArray(value), `${label} must contain a JSON object`);
  return value;
}

function exactKeys(value, expected, label) {
  const actual = Object.keys(value).sort(compareNames);
  const keys = [...expected].sort(compareNames);
  requireCondition(JSON.stringify(actual) === JSON.stringify(keys), `${label} fields differ`);
}

function exactNumberArray(value, expected, label) {
  requireCondition(
    Array.isArray(value) &&
      value.length === expected.length &&
      value.every((item, index) => typeof item === 'number' && Number.isFinite(item) && item === expected[index]),
    `${label} differs`,
  );
}

export function validateHealthReceipt(receipt, expectedVersion = '0.1.0') {
  requireSuccessfulReceipt(receipt, 'health');
  const value = parseSingleJsonLine(receipt.stdout, 'health stdout');
  exactKeys(value, ['os', 'version'], 'health');
  requireCondition(value.version === expectedVersion && value.os === 'Windows', 'health payload differs');
  return value;
}

export function validateProbeReceipt(receipt, expectedVersion = '0.1.0') {
  requireSuccessfulReceipt(receipt, 'probe');
  const value = parseSingleJsonLine(receipt.stdout, 'probe stdout');
  exactKeys(
    value,
    [
      'frozen',
      'onnxChecked',
      'optunaTrials',
      'ortAvailableProviders',
      'ortCpuOutput',
      'ortDml',
      'status',
      'torchCpuOutput',
      'torchCudaAvailable',
      'torchCudaVersion',
      'versions',
    ],
    'probe',
  );
  requireCondition(value.status === 'ok' && value.frozen === true, 'probe is not a successful frozen run');
  exactKeys(value.versions, ['autovision-ml', 'onnx', 'onnxruntime', 'optuna', 'torch', 'torchvision'], 'probe versions');
  requireCondition(value.versions['autovision-ml'] === expectedVersion, 'probe worker version differs');
  requireCondition(
    value.versions.onnx === '1.22.0' &&
      value.versions.onnxruntime === '1.24.4' &&
      value.versions.optuna === '4.9.0' &&
      value.versions.torch === '2.11.0+cpu' &&
      value.versions.torchvision === '0.26.0+cpu',
    'probe dependency versions differ',
  );
  exactNumberArray(value.torchCpuOutput, [4, 6], 'probe Torch output');
  exactNumberArray(value.ortCpuOutput, [4, 6], 'probe ORT CPU output');
  requireCondition(value.optunaTrials === 1 && value.onnxChecked === true, 'probe Optuna or ONNX result differs');
  requireCondition(
    JSON.stringify(value.ortAvailableProviders) ===
      JSON.stringify(['DmlExecutionProvider', 'CPUExecutionProvider']),
    'probe required providers differ',
  );
  requireCondition(value.ortDml !== null && typeof value.ortDml === 'object' && !Array.isArray(value.ortDml), 'probe DirectML result is invalid');
  exactKeys(value.ortDml, ['available', 'output', 'profiledProviders'], 'probe DirectML');
  requireCondition(value.ortDml.available === true, 'probe DirectML is unavailable');
  exactNumberArray(value.ortDml.output, [4, 6], 'probe DirectML output');
  requireCondition(
    Array.isArray(value.ortDml.profiledProviders) &&
      value.ortDml.profiledProviders.includes('DmlExecutionProvider'),
    'probe did not attribute execution to DirectML',
  );
  requireCondition(value.torchCudaAvailable === false && value.torchCudaVersion === null, 'probe unexpectedly includes CUDA');
  return value;
}

function requireSuccessfulReceipt(receipt, label) {
  requireCondition(receipt !== null && typeof receipt === 'object', `${label} receipt is invalid`);
  requireCondition(
    receipt.exitCode === 0 &&
      receipt.signal === null &&
      receipt.timedOut === false &&
      receipt.outputExceeded === false,
    `${label} process did not exit successfully or exceeded its output limit`,
  );
  requireCondition(Buffer.isBuffer(receipt.stdout) && Buffer.isBuffer(receipt.stderr), `${label} output buffers are invalid`);
  requireCondition(receipt.stderr.length === 0, `${label} emitted stderr`);
}

export async function runProcess(executable, args, options = {}) {
  requireCondition(typeof executable === 'string' && isAbsolute(executable), 'Executable path must be absolute');
  requireCondition(Array.isArray(args) && args.every((argument) => typeof argument === 'string'), 'Process arguments are invalid');
  const timeoutMs = options.timeoutMs ?? 60_000;
  requireCondition(Number.isSafeInteger(timeoutMs) && timeoutMs > 0, 'Process timeout is invalid');
  const maximumOutputBytes = options.maximumOutputBytes ?? MAX_OUTPUT_BYTES;
  requireCondition(Number.isSafeInteger(maximumOutputBytes) && maximumOutputBytes > 0, 'Process output limit is invalid');

  return await new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env,
      windowsVerbatimArguments: options.windowsVerbatimArguments ?? false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let timedOut = false;
    let outputExceeded = false;
    let terminationRequested = false;
    let terminationSucceeded = false;
    let terminationStatus = 'termination not attempted';
    let closeTimer;

    const cleanupError = (reason) => new Error(
      `Process PID ${child.pid ?? 'unavailable'} cleanup unverified: ${terminationStatus}; ${reason}`,
    );
    const fail = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(closeTimer);
      stdout.length = 0;
      stderr.length = 0;
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref();
      reject(error);
    };
    const terminate = () => {
      if (settled || terminationRequested) return;
      terminationRequested = true;
      clearTimeout(timer);
      try {
        if (child.exitCode !== null || child.signalCode !== null) {
          terminationStatus = 'parent already exited; descendant cleanup cannot be verified';
        } else if (process.platform === 'win32') {
          const systemRoot = process.env.SystemRoot ?? process.env.WINDIR;
          requireCondition(typeof systemRoot === 'string' && isAbsolute(systemRoot), 'Windows SystemRoot is unavailable');
          requireCondition(Number.isSafeInteger(child.pid), 'Child PID is unavailable');
          const result = spawnSync(join(systemRoot, 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], {
            encoding: 'utf8',
            windowsHide: true,
            timeout: TASKKILL_TIMEOUT_MS,
            maxBuffer: MAX_OUTPUT_BYTES,
          });
          terminationSucceeded = !result.error && result.status === 0 && result.signal === null;
          terminationStatus = `taskkill status=${result.status}, signal=${result.signal}${result.error ? `, ${result.error.message}` : ''}`;
        } else {
          terminationSucceeded = child.kill('SIGKILL');
          terminationStatus = `SIGKILL accepted=${terminationSucceeded}`;
        }
      } catch (error) {
        terminationStatus = error.message;
      }
      if (!settled) {
        closeTimer = setTimeout(
          () => fail(cleanupError(`close not observed within ${CLOSE_GRACE_MS} ms`)),
          CLOSE_GRACE_MS,
        );
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeoutMs);

    const collect = (target, chunk, kind) => {
      if (settled || terminationRequested) return;
      if (kind === 'stdout') stdoutBytes += chunk.length;
      else stderrBytes += chunk.length;
      if (stdoutBytes > maximumOutputBytes || stderrBytes > maximumOutputBytes) {
        outputExceeded = true;
        terminate();
        return;
      }
      target.push(chunk);
    };
    child.stdout.on('data', (chunk) => collect(stdout, chunk, 'stdout'));
    child.stderr.on('data', (chunk) => collect(stderr, chunk, 'stderr'));
    child.once('error', (error) => {
      fail(terminationRequested ? cleanupError(error.message) : error);
    });
    child.once('close', (exitCode, signal) => {
      if (settled) return;
      if (terminationRequested && !terminationSucceeded) {
        fail(cleanupError('termination failed'));
        return;
      }
      settled = true;
      clearTimeout(timer);
      clearTimeout(closeTimer);
      resolve({
        exitCode,
        signal,
        timedOut,
        outputExceeded,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
      });
    });
  });
}

export function getRetryableNsisToolsetCacheRenameFailure(receipt, builderCache) {
  if (
    receipt === null ||
    typeof receipt !== 'object' ||
    receipt.exitCode === 0 ||
    receipt.signal !== null ||
    receipt.timedOut !== false ||
    receipt.outputExceeded !== false ||
    !Buffer.isBuffer(receipt.stdout) ||
    !Buffer.isBuffer(receipt.stderr) ||
    receipt.stderr.length !== 0 ||
    typeof builderCache !== 'string' ||
    !isAbsolute(builderCache)
  ) {
    return null;
  }
  let output;
  try {
    output = decodeUtf8(receipt.stdout, 'electron-builder stdout');
  } catch {
    return null;
  }
  const match = output.match(
    /EPERM: operation not permitted, rename '([^'\r\n]+\.tmp)' -> '([^'\r\n]+)'[^\r\n]*failedTask=build/u,
  );
  if (match === null) return null;
  const source = resolve(match[1]);
  const destination = resolve(match[2]);
  const relativeDestination = relative(resolve(builderCache), destination);
  const segments = relativeDestination.split(/[\\/]/u);
  if (!(
    !relativeDestination.startsWith('..') &&
    !isAbsolute(relativeDestination) &&
    segments.length === 2 &&
    segments[0].startsWith('nsis-') &&
    segments[1].startsWith(`${segments[0]}-`) &&
    source.toLowerCase() === `${destination}.tmp`.toLowerCase()
  )) {
    return null;
  }
  return {
    temporaryDirectory: source,
    destinationDirectory: destination,
    releaseName: segments[0],
  };
}

export function isolatedWorkerEnvironment(workerRoot, temporaryRoot) {
  requireCondition(isAbsolute(workerRoot) && isAbsolute(temporaryRoot), 'Worker environment roots must be absolute');
  const systemRoot = process.env.SystemRoot ?? process.env.WINDIR;
  requireCondition(typeof systemRoot === 'string' && isAbsolute(systemRoot), 'Windows SystemRoot is unavailable');
  return {
    SystemRoot: systemRoot,
    WINDIR: systemRoot,
    TEMP: temporaryRoot,
    TMP: temporaryRoot,
    PATH: [workerRoot, join(workerRoot, '_internal'), join(systemRoot, 'System32')].join(';'),
    PATHEXT: '.COM;.EXE;.BAT;.CMD',
    PYTHONNOUSERSITE: '1',
  };
}

export async function runWorkerSuite(workerRoot, temporaryRoot, expectedVersion = '0.1.0') {
  requireCondition(isAbsolute(workerRoot), 'Worker root must be absolute');
  const executable = join(workerRoot, 'autovision-worker.exe');
  const env = isolatedWorkerEnvironment(workerRoot, temporaryRoot);
  const healthReceipt = await runProcess(executable, ['health'], {
    cwd: temporaryRoot,
    env,
    timeoutMs: 60_000,
  });
  const health = validateHealthReceipt(healthReceipt, expectedVersion);
  const probeReceipt = await runProcess(executable, ['probe'], {
    cwd: temporaryRoot,
    env,
    timeoutMs: 120_000,
  });
  const probe = validateProbeReceipt(probeReceipt, expectedVersion);
  return {
    health,
    probe,
    healthStdoutSha256: createHash('sha256').update(healthReceipt.stdout).digest('hex'),
    probeStdoutSha256: createHash('sha256').update(probeReceipt.stdout).digest('hex'),
  };
}
