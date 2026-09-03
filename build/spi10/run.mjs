import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, openSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryUrl = new URL('../../', import.meta.url);
const repositoryPath = fileURLToPath(repositoryUrl);
const runId = randomUUID();
const finalResultUrl = new URL('./benchmark-result.json', import.meta.url);
const temporaryResultUrl = new URL(`./benchmark-result-${runId}.json.tmp`, import.meta.url);
const processResultUrl = new URL(`./dist/benchmark-process-result-${runId}.json`, import.meta.url);
const processErrorUrl = new URL(`./dist/benchmark-error-${runId}.json`, import.meta.url);
const launcherErrorUrl = new URL(`./dist/launcher-error-${runId}.json`, import.meta.url);
const distUrl = new URL('./dist/', import.meta.url);
const lockUrl = new URL('./verification.lock', import.meta.url);
const commandReceipts = [];
let lockDescriptor = null;
let ownsLock = false;

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex').toUpperCase();
}

function outputTail(output, maximumLines = 30) {
  return output.trimEnd().split(/\r?\n/u).slice(-maximumLines).join('\n');
}

function printablePath(path) {
  const value = relative(repositoryPath, path);
  return value.startsWith('..') ? path : value;
}

function resolveExecutable(executable) {
  const result = spawnSync('where.exe', [executable], {
    encoding: 'utf8',
    timeout: 10_000,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`cannot resolve executable: ${executable}`);
  const first = (result.stdout ?? '').split(/\r?\n/u).find(Boolean);
  if (!first) throw new Error(`cannot resolve executable path: ${executable}`);
  return realpathSync(first);
}

function fileIdentity(path) {
  const realPath = realpathSync(path);
  const stat = statSync(realPath);
  return {
    path: printablePath(realPath),
    byteLength: stat.size,
    sha256: sha256(readFileSync(realPath)),
  };
}

function killProcessTree(rootPid) {
  const result = spawnSync('taskkill.exe', ['/PID', String(rootPid), '/T', '/F'], {
    encoding: 'utf8',
    timeout: 30_000,
    windowsHide: true,
  });
  return {
    exitCode: result.status,
    stdoutTail: outputTail(result.stdout ?? ''),
    stderrTail: outputTail(result.stderr ?? ''),
  };
}

async function waitForPromise(promise, timeoutMs) {
  const timedOut = Symbol('timed-out');
  let timeoutHandle;
  const outcome = await Promise.race([
    promise,
    new Promise((resolve) => {
      timeoutHandle = setTimeout(() => resolve(timedOut), timeoutMs);
    }),
  ]);
  clearTimeout(timeoutHandle);
  return outcome === timedOut ? null : outcome;
}

async function runCommand(id, executablePath, args, timeoutMs, env = process.env) {
  const startedAt = new Date();
  const child = spawn(executablePath, args, {
    cwd: repositoryPath,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false,
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout = (stdout + chunk).slice(-256 * 1024);
    process.stdout.write(chunk);
  });
  child.stderr.on('data', (chunk) => {
    stderr = (stderr + chunk).slice(-256 * 1024);
    process.stderr.write(chunk);
  });

  let timeoutHandle;
  const closePromise = new Promise((resolve) => {
    child.once('error', (error) => resolve({ code: null, signal: null, error }));
    child.once('close', (code, signal) => resolve({ code, signal, error: null }));
  });
  const timedOut = Symbol('timed-out');
  const timeoutPromise = new Promise((resolve) => {
    timeoutHandle = setTimeout(() => {
      resolve(timedOut);
    }, timeoutMs);
  });
  let outcome = await Promise.race([closePromise, timeoutPromise]);
  clearTimeout(timeoutHandle);
  if (outcome === timedOut) {
    const kill = killProcessTree(child.pid);
    const closeAfterKill = await waitForPromise(closePromise, 10_000);
    if (closeAfterKill === null) {
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref();
    }
    outcome = {
      code: closeAfterKill?.code ?? null,
      signal: 'TIMEOUT',
      error: null,
      kill,
      closeAfterKill: closeAfterKill === null
        ? null
        : {
            code: closeAfterKill.code,
            signal: closeAfterKill.signal,
            error: closeAfterKill.error?.message ?? null,
          },
    };
  }
  const finishedAt = new Date();
  const receipt = {
    id,
    executable: fileIdentity(executablePath),
    args,
    rootPid: child.pid,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    exitCode: outcome.code,
    signal: outcome.signal,
    timeoutKill: outcome.kill ?? null,
    closeAfterTimeoutKill: outcome.closeAfterKill ?? null,
    stdoutTail: outputTail(stdout),
    stderrTail: outputTail(stderr),
  };
  commandReceipts.push(receipt);
  if (outcome.error) throw outcome.error;
  if (outcome.signal === 'TIMEOUT') throw new Error(`${id} exceeded ${timeoutMs} ms`);
  if (outcome.code !== 0) throw new Error(`${id} failed with exit ${outcome.code ?? 'null'}`);
  return receipt;
}

function queryElectronProcesses(pwshPath, electronPath) {
  const escapedPath = electronPath.replaceAll("'", "''");
  const script = `$path='${escapedPath}';$items=@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $path } | Select-Object ProcessId,ParentProcessId,CreationDate,ExecutablePath,CommandLine);ConvertTo-Json -InputObject $items -Compress -Depth 3`;
  const result = spawnSync(
    pwshPath,
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
    { encoding: 'utf8', timeout: 10_000, windowsHide: true },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`process inventory failed: ${result.stderr}`);
  const parsed = JSON.parse((result.stdout ?? '').trim() || '[]');
  return (Array.isArray(parsed) ? parsed : [parsed]).map((item) => ({
    processId: item.ProcessId,
    parentProcessId: item.ParentProcessId,
    creationDate: item.CreationDate,
    executablePath: item.ExecutablePath,
    commandLine: item.CommandLine,
  }));
}

async function waitForElectronCleanup(pwshPath, electronPath, timeoutMs = 60_000) {
  const startedAt = Date.now();
  const observed = new Map();
  while (Date.now() - startedAt <= timeoutMs) {
    const current = queryElectronProcesses(pwshPath, electronPath);
    for (const item of current) observed.set(item.processId, item);
    if (current.length === 0) {
      return {
        observed: [...observed.values()],
        remaining: [],
        remainingAfterForcedCleanup: [],
        waitMs: Date.now() - startedAt,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const remaining = queryElectronProcesses(pwshPath, electronPath);
  for (const item of remaining) killProcessTree(item.processId);
  const remainingAfterForcedCleanup = queryElectronProcesses(pwshPath, electronPath);
  return {
    observed: [...observed.values()],
    remaining,
    remainingAfterForcedCleanup,
    waitMs: Date.now() - startedAt,
  };
}

async function readJsonBytes(url, label) {
  try {
    const bytes = await readFile(url);
    return { bytes, value: JSON.parse(bytes.toString('utf8')) };
  } catch (error) {
    throw new Error(`${label} is missing or invalid`, { cause: error });
  }
}

async function writeDurableFile(url, contents) {
  const handle = await open(url, 'w');
  try {
    await handle.writeFile(contents, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function assertProcessEvidence(evidence, electronPath, rootPid) {
  if (evidence.runId !== runId) throw new Error('Electron process evidence run ID mismatch');
  if (evidence.status !== 'ok' || evidence.verdict !== 'PASS') {
    throw new Error(`Electron benchmark did not pass: ${evidence.status}/${evidence.verdict}`);
  }
  if (
    evidence.lifecycle?.finalizedInQuitEvent !== true ||
    evidence.lifecycle?.quitEventExitCode !== 0 ||
    evidence.lifecycle?.lateFatalRendererDiagnosticCount !== 0
  ) {
    throw new Error('Electron benchmark lifecycle evidence is incomplete');
  }
  if (evidence.process?.pid !== rootPid || realpathSync(evidence.process.execPath) !== electronPath) {
    throw new Error('Electron process identity mismatch');
  }
  if (evidence.versions?.electron !== '44.0.0') throw new Error('unexpected Electron version');
  if (evidence.rendererDiagnostics?.length !== 0) throw new Error('renderer diagnostics are not empty');
}

async function verifyCurrentEvidence(evidence) {
  const mismatches = [];
  for (const [relativePath, expected] of Object.entries(evidence.sourceHashes)) {
    const actual = sha256(await readFile(new URL(relativePath, repositoryUrl)));
    if (actual !== expected) mismatches.push(relativePath);
  }
  if (mismatches.length !== 0) throw new Error(`source changed after benchmark: ${mismatches.join(',')}`);
  const indexHash = sha256(await readFile(new URL('./dist/index.html', import.meta.url)));
  if (indexHash !== evidence.bundle.indexHtmlSha256) throw new Error('dist/index.html changed after benchmark');
  for (const asset of evidence.bundle.assets) {
    const actual = sha256(await readFile(new URL(`../../${asset.file}`, import.meta.url)));
    if (actual !== asset.sha256) throw new Error(`bundle asset changed after benchmark: ${asset.file}`);
  }
}

async function validateToolchain(npmExecPath, nodePath, pwshPath) {
  if (!/^v24\.19\.\d+$/u.test(process.version)) {
    throw new Error(`SPI-10 requires Node 24.19.x, received ${process.version}`);
  }
  const npmRealPath = realpathSync(npmExecPath);
  const npmPackagePath = resolve(dirname(dirname(npmRealPath)), 'package.json');
  const npmPackage = JSON.parse(await readFile(npmPackagePath, 'utf8'));
  if (
    npmPackage.name !== 'npm' ||
    npmPackage.version !== '12.0.0' ||
    npmPackage.bin?.npm !== 'bin/npm-cli.js'
  ) {
    throw new Error(`npm_execpath is not npm@12.0.0: ${npmPackage.name}@${npmPackage.version}`);
  }
  const expectedLifecycleEvent = 'verify:spi10';
  const expectedLifecycleScript = 'node build/spi10/run.mjs';
  const packageManifest = JSON.parse(await readFile(new URL('./package.json', repositoryUrl), 'utf8'));
  if (packageManifest.scripts?.[expectedLifecycleEvent] !== expectedLifecycleScript) {
    throw new Error(`package.json ${expectedLifecycleEvent} script identity mismatch`);
  }
  if (
    process.env.npm_lifecycle_event !== expectedLifecycleEvent ||
    process.env.npm_lifecycle_script !== expectedLifecycleScript
  ) {
    throw new Error(`run SPI-10 with npm 12.0.0 run ${expectedLifecycleEvent}`);
  }
  if (!process.env.NODE || realpathSync(process.env.NODE) !== nodePath) {
    throw new Error('npm lifecycle Node executable differs from the launcher executable');
  }
  const pwshResult = spawnSync(
    pwshPath,
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '[ordered]@{Edition=$PSVersionTable.PSEdition;Major=$PSVersionTable.PSVersion.Major}|ConvertTo-Json -Compress'],
    { encoding: 'utf8', timeout: 10_000, windowsHide: true },
  );
  if (pwshResult.error) throw pwshResult.error;
  const pwshVersion = JSON.parse((pwshResult.stdout ?? '').trim());
  if (pwshResult.status !== 0 || pwshVersion.Edition !== 'Core' || pwshVersion.Major < 7) {
    throw new Error('PowerShell 7+ Core is required');
  }
  return {
    node: fileIdentity(nodePath),
    npmCli: fileIdentity(npmRealPath),
    npmPackage: { name: npmPackage.name, version: npmPackage.version, bin: npmPackage.bin.npm },
    npmLifecycle: {
      event: process.env.npm_lifecycle_event,
      script: process.env.npm_lifecycle_script,
      nodePath: printablePath(realpathSync(process.env.NODE)),
      userAgent: process.env.npm_config_user_agent ?? null,
    },
    pwsh: { ...fileIdentity(pwshPath), edition: pwshVersion.Edition, major: pwshVersion.Major },
  };
}

async function main() {
  lockDescriptor = openSync(fileURLToPath(lockUrl), 'wx');
  ownsLock = true;
  writeFileSync(lockDescriptor, JSON.stringify({ runId, pid: process.pid, startedAt: new Date().toISOString() }));
  await mkdir(distUrl, { recursive: true });
  await Promise.all([rm(finalResultUrl, { force: true }), rm(temporaryResultUrl, { force: true })]);

  const npmExecPath = process.env.npm_execpath;
  if (!npmExecPath) throw new Error('run SPI-10 with npm 12.0.0 run verify:spi10');
  const nodePath = realpathSync(process.execPath);
  const pwshPath = resolveExecutable('pwsh.exe');
  const gitPath = resolveExecutable('git.exe');
  const electronPath = realpathSync(new URL('../../node_modules/electron/dist/electron.exe', import.meta.url));
  const toolchain = await validateToolchain(npmExecPath, nodePath, pwshPath);
  toolchain.git = fileIdentity(gitPath);
  toolchain.electron = fileIdentity(electronPath);
  const packageLockUrl = new URL('./package-lock.json', repositoryUrl);
  const packageLockBefore = sha256(await readFile(packageLockUrl));

  const npmRealPath = realpathSync(npmExecPath);
  const npmVersionReceipt = await runCommand('npm-version', nodePath, [npmRealPath, '--version'], 30_000);
  if (npmVersionReceipt.stdoutTail.trim() !== '12.0.0') {
    throw new Error(`npm CLI reported an unexpected version: ${npmVersionReceipt.stdoutTail.trim()}`);
  }
  await runCommand('unit', nodePath, ['node_modules/vitest/vitest.mjs', 'run', '--config', 'build/spi10/vitest.config.ts'], 120_000);
  await runCommand('strict-typecheck', nodePath, [
    'node_modules/typescript/bin/tsc', '--ignoreConfig', '--noEmit', '--strict', '--skipLibCheck',
    '--target', 'ES2024', '--module', 'ESNext', '--moduleResolution', 'Bundler', '--jsx', 'react-jsx',
    '--lib', 'ES2024,DOM,DOM.Iterable', '--types', 'node,react,react-dom,vite/client',
    'build/spi10/benchmark-entry.ts', 'build/spi10/vite.config.ts', 'spikes/annotation/CanvasSpike.tsx',
  ], 120_000);
  await runCommand('main-syntax', nodePath, ['--check', 'build/spi10/main.mjs'], 30_000);
  await runCommand('launcher-syntax', nodePath, ['--check', 'build/spi10/run.mjs'], 30_000);
  await runCommand('vite-build', nodePath, ['node_modules/vite/bin/vite.js', 'build', '--config', 'build/spi10/vite.config.ts'], 120_000);
  await runCommand('diff-check', gitPath, ['diff', '--check', '--', 'build/spi10', 'spikes/annotation', 'docs/implementation-plan.md'], 30_000);

  const preexistingElectronProcesses = queryElectronProcesses(pwshPath, electronPath);
  if (preexistingElectronProcesses.length !== 0) {
    throw new Error(
      `SPI-10 Electron executable is already running: ${preexistingElectronProcesses.map((item) => item.processId).join(',')}`,
    );
  }

  let electronReceipt;
  let electronCommandError = null;
  try {
    electronReceipt = await runCommand(
      'electron-benchmark',
      electronPath,
      ['build/spi10/main.mjs'],
      15 * 60_000,
      { ...process.env, AUTOVISION_SPI10_RUN_ID: runId },
    );
  } catch (error) {
    electronCommandError = error;
    electronReceipt = commandReceipts.at(-1);
    if (electronReceipt?.id !== 'electron-benchmark') throw error;
  }
  const electronCleanup = await waitForElectronCleanup(
    pwshPath,
    electronPath,
  );
  if (electronCleanup.remaining.length !== 0) {
    throw new Error(`Electron processes remained: ${electronCleanup.remaining.map((item) => item.processId).join(',')}`);
  }
  if (electronCleanup.remainingAfterForcedCleanup.length !== 0) {
    throw new Error(
      `Electron processes resisted cleanup: ${electronCleanup.remainingAfterForcedCleanup.map((item) => item.processId).join(',')}`,
    );
  }
  if (electronCommandError !== null) throw electronCommandError;

  const processArtifact = await readJsonBytes(processResultUrl, 'Electron process evidence');
  if (await readFile(processErrorUrl).then(() => true, () => false)) {
    throw new Error('Electron benchmark produced an error artifact');
  }
  assertProcessEvidence(processArtifact.value, electronPath, electronReceipt.rootPid);
  await verifyCurrentEvidence(processArtifact.value);
  const packageLockAfter = sha256(await readFile(packageLockUrl));
  if (
    packageLockBefore !== packageLockAfter ||
    processArtifact.value.sourceHashes['package-lock.json'] !== packageLockAfter
  ) {
    throw new Error('package-lock.json identity mismatch');
  }

  const finalEvidence = {
    ...processArtifact.value,
    command: `"${nodePath}" "${npmRealPath}" run verify:spi10`,
    benchmarkProcessCommand: processArtifact.value.command,
    verification: {
      finalizedAfterElectronExit: true,
      finalizedAt: new Date().toISOString(),
      runId,
      toolchain,
      packageLockSha256Before: packageLockBefore,
      packageLockSha256After: packageLockAfter,
      processEvidence: {
        file: `build/spi10/dist/${basename(fileURLToPath(processResultUrl))}`,
        sha256: sha256(processArtifact.bytes),
      },
      commands: commandReceipts,
      preexistingElectronProcesses,
      electronCleanup,
      electronLauncherExitCode: electronReceipt.exitCode,
    },
  };
  await writeDurableFile(temporaryResultUrl, JSON.stringify(finalEvidence, null, 2));
  await verifyCurrentEvidence(processArtifact.value);
  const lock = JSON.parse(readFileSync(fileURLToPath(lockUrl), 'utf8'));
  if (lock.runId !== runId || lock.pid !== process.pid) throw new Error('verification lock ownership changed');
  await rename(temporaryResultUrl, finalResultUrl);
  const finalizedResult = await readJsonBytes(finalResultUrl, 'final launcher evidence');
  if (finalizedResult.value.runId !== runId || finalizedResult.value.verification?.runId !== runId) {
    throw new Error('final launcher evidence run ID mismatch');
  }
  console.log(`spi10:launcher-result-finalized:${runId}`);
}

try {
  await main();
} catch (error) {
  process.exitCode = 1;
  if (ownsLock) {
    await Promise.allSettled([
      rm(finalResultUrl, { force: true }),
      rm(temporaryResultUrl, { force: true }),
    ]);
  }
  const failure = {
    status: 'error',
    verdict: 'FAIL',
    runId,
    measuredAt: new Date().toISOString(),
    name: error instanceof Error ? error.name : 'UnknownError',
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : null,
    commands: commandReceipts,
  };
  await mkdir(distUrl, { recursive: true }).catch(() => undefined);
  await writeFile(launcherErrorUrl, JSON.stringify(failure, null, 2), 'utf8').catch(() => undefined);
  console.error('spi10:launcher-failed', error);
} finally {
  if (ownsLock) {
    closeSync(lockDescriptor);
    try {
      await rm(lockUrl, { force: true });
    } catch (error) {
      process.exitCode = 1;
      console.error('spi10:lock-cleanup-failed', error);
    }
  }
}
