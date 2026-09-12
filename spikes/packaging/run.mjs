import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants, createReadStream, existsSync } from 'node:fs';
import {
  cp,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  rmdir,
  statfs,
  writeFile,
} from 'node:fs/promises';
import { basename, isAbsolute, join, resolve, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  compareInventories,
  encodeInventory,
  getRetryableNsisToolsetCacheRenameFailure,
  inventoryDirectory,
  runProcess,
  runWorkerSuite,
  validateInventory,
} from './harness.mjs';

const repositoryRoot = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const workerRoot = resolve(repositoryRoot, 'ml/dist/spi03-current/autovision-worker');
const electronDist = resolve(repositoryRoot, 'node_modules/electron/dist');
const builderCli = resolve(repositoryRoot, 'node_modules/electron-builder/cli.js');
const configPath = resolve(repositoryRoot, 'spikes/packaging/electron-builder.windows.yml');
const sourceMain = resolve(repositoryRoot, 'spikes/packaging/main.mjs');
const sourceHarness = resolve(repositoryRoot, 'spikes/packaging/harness.mjs');
const version = '0.1.0';
const sourcePaths = ['package.json', 'package-lock.json', 'spikes/packaging/main.mjs',
  'spikes/packaging/harness.mjs', 'spikes/packaging/run.mjs', 'spikes/packaging/electron-builder.windows.yml',
  'spikes/packaging/installer.nsh'];
// electron-builder 26.15.3 app-builder-lib/out/toolsets/windows.js pins the
// archive hashes. Each manifest hash covers every regular extracted file.
const NSIS_TOOLSET_RECOVERY = {
  'nsis-resources-3.4.1': {
    archiveSha256:
      '593a9a92ef958321293ac6a2ee61e64bf1bd543142a5bd6b3d310709cc924103',
    fileCount: 22,
    totalBytes: 2_998_788,
    manifestSha256:
      '188bbd2366cfd2ad37b2456dc5b279458a962d11f6e5eb0627999a544c0c6e59',
    environmentVariable: 'ELECTRON_BUILDER_NSIS_RESOURCES_DIR',
  },
  'nsis-3.0.4.1': {
    archiveSha256:
      '9877df902530f96357d13a7a31ae2b9df67f48b11ffc9a1700a7c961574ec5fa',
    fileCount: 343,
    totalBytes: 7_280_179,
    manifestSha256:
      'a02e4fedc657ad55b3ee5d2ce1a23ed230dd32dd9accbf1a6ee42db5a7fc3ff8',
    environmentVariable: 'ELECTRON_BUILDER_NSIS_DIR',
  },
};
let activeRun = null;
let activePhase = 'preflight';

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function progress(phase, heartbeat = false) {
  activePhase = phase;
  console.log(JSON.stringify({
    status: 'running', runId: activeRun?.runId ?? null, phase, heartbeat,
    timestamp: new Date().toISOString(),
  }));
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function readSourceHashes() {
  return Object.fromEntries(await Promise.all(sourcePaths.map(async (path) =>
    [path, sha256(await readFile(join(repositoryRoot, path)))])));
}

async function fileMetadata(path) {
  const digest = createHash('sha256');
  let byteSize = 0;
  await new Promise((resolvePromise, reject) => {
    const stream = createReadStream(path);
    stream.on('data', (chunk) => {
      byteSize += chunk.length;
      digest.update(chunk);
    });
    stream.once('error', reject);
    stream.once('end', resolvePromise);
  });
  return { byteSize, sha256: digest.digest('hex') };
}

function receiptSummary(receipt) {
  return {
    exitCode: receipt.exitCode,
    signal: receipt.signal,
    timedOut: receipt.timedOut,
    outputExceeded: receipt.outputExceeded,
    stdoutByteSize: receipt.stdout.length,
    stdoutSha256: sha256(receipt.stdout),
    stderrByteSize: receipt.stderr.length,
    stderrSha256: sha256(receipt.stderr),
  };
}

function requireSuccessfulReceipt(receipt, label, { allowStderr = false } = {}) {
  requireCondition(
    receipt.exitCode === 0 &&
      receipt.signal === null &&
      receipt.timedOut === false &&
      receipt.outputExceeded === false,
    `${label} did not exit successfully`,
  );
  if (!allowStderr) requireCondition(receipt.stderr.length === 0, `${label} emitted stderr`);
}

async function waitUntilMissing(path, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (!existsSync(path)) return true;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  return !existsSync(path);
}

function powerShellScript(body) {
  return `$ErrorActionPreference = 'Stop'
try {
  if ($PSVersionTable.PSEdition -ne 'Core' -or $PSVersionTable.PSVersion.Major -lt 7) {
    throw 'SPI-05 requires PowerShell 7+ Core'
  }
${body}
  exit 0
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}`;
}

function runPowerShell(script, timeoutMs = 30_000) {
  return spawnSync(
    'pwsh.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
    { encoding: 'utf8', windowsHide: true, timeout: timeoutMs, maxBuffer: 1024 * 1024 },
  );
}

function requirePowerShellStdout(result, label) {
  requireCondition(result.error == null && result.status === 0 && result.signal === null,
    `${label} failed: status=${result.status}, signal=${result.signal}, error=${result.error?.code ?? 'none'}`);
  requireCondition(typeof result.stdout === 'string' && typeof result.stderr === 'string', `${label} output is unavailable`);
  requireCondition(result.stderr.length === 0, `${label} emitted stderr`);
  return result.stdout;
}

export function parseProcessCount(result) {
  const text = requirePowerShellStdout(result, 'Exact process inventory').replace(/\r?\n$/u, '');
  const match = text.match(/^\d+$/u);
  // The equality also rejects a second trailing newline (JavaScript's $ allows one).
  requireCondition(match !== null && match[0] === text, 'Exact process count is invalid');
  const count = Number(text);
  requireCondition(Number.isSafeInteger(count) && count >= 0, 'Exact process count is invalid');
  return count;
}

export function exactProcessScript(executablePath, terminate = false) {
  requireCondition(isAbsoluteWindowsPath(executablePath), 'Exact process path is invalid');
  const name = win32.basename(executablePath);
  requireCondition(/^[a-z0-9-]+\.exe$/iu.test(name), 'Exact process image name is invalid');
  const escaped = win32.resolve(executablePath).replaceAll("'", "''");
  return powerShellScript(`  $p = '${escaped}'
  function Get-ExactProcesses {
    $candidates = @(Get-CimInstance -ClassName Win32_Process -Filter "Name = '${name}'" -ErrorAction Stop)
    foreach ($candidate in $candidates) {
      if ([string]::IsNullOrEmpty($candidate.ExecutablePath)) { throw 'Candidate executable path is unavailable' }
      if ($candidate.ExecutablePath.Equals($p, [StringComparison]::OrdinalIgnoreCase)) { $candidate }
    }
  }
  $items = @(Get-ExactProcesses)
${terminate ? String.raw`  $PSNativeCommandUseErrorActionPreference = $false
  $taskkill = Join-Path $env:SystemRoot 'System32\taskkill.exe' -ErrorAction Stop
  foreach ($item in $items) {
    & $taskkill /PID $item.ProcessId /T /F | Out-Null
    $taskkillStatus = $LASTEXITCODE
    if ($taskkillStatus -ne 0) { throw "taskkill failed: exit=$taskkillStatus PID=$($item.ProcessId)" }
  }
  $items = @(Get-ExactProcesses)
  if ($items.Count -ne 0) { throw 'Exact executable processes remained after taskkill' }
` : ''}  [Console]::WriteLine($items.Count)`);
}

function queryExactProcessCount(executablePath) {
  return parseProcessCount(runPowerShell(exactProcessScript(executablePath)));
}

function requireRunId(runId) {
  requireCondition(typeof runId === 'string' && runId.length === 36 &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(runId),
  'SPI-05 run ID is invalid');
}

export function registryProbeScript(runId) {
  requireRunId(runId);
  // electron-builder 26.15.3: NsisTarget.js passes nsis.guid unchanged as
  // APP_GUID / UNINSTALL_APP_KEY; multiUser.nsh defines these exact two keys.
  // common.nsh selects SetRegView 64 for APP_64 on Windows x64.
  const installRegistryKey = `Software\\${runId}`;
  const uninstallRegistryKey = `Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${runId}`;
  return powerShellScript(String.raw`  if (-not [Environment]::Is64BitOperatingSystem -or -not [Environment]::Is64BitProcess) {
    throw 'SPI-05 registry inventory requires Windows x64 and 64-bit PowerShell'
  }
  $base = $null
  $installKey = $null
  $uninstallKey = $null
  try {
    $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, [Microsoft.Win32.RegistryView]::Registry64)
    $installKey = $base.OpenSubKey('${installRegistryKey}', $false)
    $uninstallKey = $base.OpenSubKey('${uninstallRegistryKey}', $false)
    $snapshot = [ordered]@{ install = $null; uninstall = $null }
    if ($null -ne $installKey) {
      $snapshot.install = [ordered]@{ InstallLocation = $installKey.GetValue('InstallLocation', $null) }
    }
    if ($null -ne $uninstallKey) {
      $snapshot.uninstall = [ordered]@{
        DisplayName = $uninstallKey.GetValue('DisplayName', $null)
        InstallLocation = $uninstallKey.GetValue('InstallLocation', $null)
        UninstallString = $uninstallKey.GetValue('UninstallString', $null)
      }
    }
    $json = ConvertTo-Json -InputObject $snapshot -Depth 4 -Compress -ErrorAction Stop
  } finally {
    if ($null -ne $uninstallKey) { $uninstallKey.Dispose() }
    if ($null -ne $installKey) { $installKey.Dispose() }
    if ($null -ne $base) { $base.Dispose() }
  }
  [Console]::WriteLine($json)`);
}

export function readRegistrySnapshot(runId) {
  const stdout = requirePowerShellStdout(runPowerShell(registryProbeScript(runId)), 'Exact registry inventory');
  return parseJsonObject(stdout, 'Exact registry inventory');
}

function sameWindowsPath(left, right) {
  return isAbsoluteWindowsPath(left) && isAbsoluteWindowsPath(right) &&
    win32.resolve(left).toLowerCase() === win32.resolve(right).toLowerCase();
}

export function validateRegistrySnapshot(snapshot, expected = null) {
  requireCondition(snapshot !== null && typeof snapshot === 'object' && !Array.isArray(snapshot) &&
    Object.keys(snapshot).sort().join(',') === 'install,uninstall', 'Registry snapshot fields differ');
  if (expected === null) {
    requireCondition(snapshot.install === null && snapshot.uninstall === null, 'SPI-05 registry keys are not both absent');
    return snapshot;
  }
  const { install, uninstall } = snapshot;
  requireCondition(install !== null && typeof install === 'object' && !Array.isArray(install) &&
    Object.keys(install).join(',') === 'InstallLocation', 'Registry install key is invalid');
  requireCondition(uninstall !== null && typeof uninstall === 'object' && !Array.isArray(uninstall) &&
    Object.keys(uninstall).sort().join(',') === 'DisplayName,InstallLocation,UninstallString', 'Registry uninstall key is invalid');
  requireCondition(sameWindowsPath(install.InstallLocation, expected.installDir), 'Registry install location differs');
  requireCondition(uninstall.DisplayName === expected.productName, 'Registry display name differs');
  // include/installer.nsh writes InstallLocation only to the install key.
  requireCondition(uninstall.InstallLocation === null || sameWindowsPath(uninstall.InstallLocation, expected.installDir),
    'Registry optional uninstall location differs');
  const command = typeof uninstall.UninstallString === 'string'
    ? uninstall.UninstallString.match(/^"([^"\r\n]+)" \/currentuser$/u) : null;
  requireCondition(command !== null && command[0] === uninstall.UninstallString &&
    sameWindowsPath(command[1], expected.uninstaller), 'Registry uninstall command differs');
  return snapshot;
}

function isAbsoluteWindowsPath(path) {
  return typeof path === 'string' && /^[a-z]:[\\/]/iu.test(path) && !/["\u0000-\u001f]/u.test(path);
}

function readEnvironmentValue(name) {
  const actual = Object.keys(process.env).find(
    (key) => key.toLowerCase() === name.toLowerCase(),
  );
  return actual === undefined ? undefined : process.env[actual];
}

function safeWindowsEnvironment(overrides = {}) {
  const environment = {};
  for (const name of [
    'APPDATA',
    'ComSpec',
    'HOMEDRIVE',
    'HOMEPATH',
    'LOCALAPPDATA',
    'NUMBER_OF_PROCESSORS',
    'OS',
    'PATH',
    'PATHEXT',
    'PROCESSOR_ARCHITECTURE',
    'ProgramData',
    'ProgramFiles',
    'ProgramFiles(x86)',
    'SystemDrive',
    'SystemRoot',
    'TEMP',
    'TMP',
    'USERDOMAIN',
    'USERNAME',
    'USERPROFILE',
    'WINDIR',
  ]) {
    const value = readEnvironmentValue(name);
    if (typeof value === 'string' && value.length > 0) environment[name] = value;
  }
  return { ...environment, ...overrides };
}

async function findUninstaller(installDirectory, runId) {
  requireRunId(runId);
  const names = (await readdir(installDirectory)).filter((name) =>
    /^Uninstall .+\.exe$/iu.test(name),
  );
  requireCondition(names.length === 1, 'Installed output does not contain exactly one uninstaller');
  requireCondition(names[0] === `Uninstall autovision-spi05-${runId}.exe`, 'Installed uninstaller identity differs');
  return join(installDirectory, names[0]);
}

async function copyUninstaller(uninstaller, installerTemp) {
  const info = await lstat(uninstaller);
  requireCondition(info.isFile() && !info.isSymbolicLink() && info.nlink === 1, 'Uninstaller must be an unlinked regular file');
  const source = await fileMetadata(uninstaller);
  const path = join(installerTemp, basename(uninstaller));
  await copyFile(uninstaller, path, constants.COPYFILE_EXCL);
  const copied = await fileMetadata(path);
  requireCondition(source.byteSize === copied.byteSize && source.sha256 === copied.sha256, 'Uninstaller copy differs');
  return { sourcePath: uninstaller, path, ...copied };
}

export function uninstallerInvocation(copiedUninstaller, installDir, installerTemp, runId) {
  requireRunId(runId);
  requireCondition([copiedUninstaller, installDir, installerTemp].every(isAbsoluteWindowsPath), 'Uninstaller paths must be absolute Windows paths');
  const relativeTemp = win32.relative(installDir, installerTemp);
  requireCondition(sameWindowsPath(win32.dirname(copiedUninstaller), installerTemp) &&
    win32.basename(copiedUninstaller) === `Uninstall autovision-spi05-${runId}.exe` &&
    (relativeTemp === '..' || relativeTemp.startsWith('..\\') || win32.isAbsolute(relativeTemp)),
  'Uninstaller must be the run-owned copy outside the install directory');
  return {
    executable: copiedUninstaller,
    // NSIS parses _?= from the command-line tail, including spaces: last, unquoted.
    args: ['/S', '/currentuser', `_?=${installDir}`],
    options: {
      cwd: installerTemp,
      env: safeWindowsEnvironment({ TEMP: installerTemp, TMP: installerTemp }),
      timeoutMs: 10 * 60_000,
      windowsVerbatimArguments: true,
    },
  };
}

async function runUninstaller(copy, installDir, installerTemp, runId) {
  const current = await fileMetadata(copy.path);
  requireCondition(current.byteSize === copy.byteSize && current.sha256 === copy.sha256, 'Copied uninstaller changed before execution');
  const invocation = uninstallerInvocation(copy.path, installDir, installerTemp, runId);
  return await runProcess(invocation.executable, invocation.args, invocation.options);
}

export async function removeUpdaterCache(updaterCache, runId, installer, expected) {
  requireRunId(runId);
  requireCondition(isAbsolute(updaterCache) && basename(updaterCache) === `autovision-spi05-${runId}-updater`,
    'Updater cache does not belong to this run');
  validateInventory(expected);
  requireCondition(expected.fileCount === 1 && expected.files[0].path === 'installer.exe' &&
    expected.files[0].sha256 === installer?.sha256 && expected.files[0].byteSize === installer?.byteSize,
  'Updater cache installer identity differs');
  try {
    await lstat(updaterCache);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  compareInventories(expected, (await inventoryDirectory(updaterCache)).manifest);
  await rm(join(updaterCache, 'installer.exe'));
  // Never recurse: an unexpected file/directory arriving after inventory must survive.
  await rmdir(updaterCache);
}

function parseJsonObject(bytes, label) {
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
  requireCondition(value !== null && typeof value === 'object' && !Array.isArray(value), `${label} is not an object`);
  return value;
}

function validateInstalledEvidence(value, sourceInventory, sourceManifestBytes) {
  requireCondition(value.schemaVersion === 1 && value.status === 'ok' && value.verdict === 'PASS', 'Installed evidence verdict differs');
  requireCondition(value.packaged === true, 'Installed Electron did not report packaged mode');
  requireCondition(value.versions?.electron === '44.0.0', 'Installed Electron version differs');
  requireCondition(
    value.sourceManifest?.byteSize === sourceManifestBytes.length &&
      value.sourceManifest?.sha256 === sha256(sourceManifestBytes) &&
      value.sourceManifest?.fileCount === sourceInventory.fileCount &&
      value.sourceManifest?.totalBytes === sourceInventory.totalBytes,
    'Installed source manifest evidence differs',
  );
  requireCondition(
    value.installedManifest?.sha256 === sha256(sourceManifestBytes) &&
      value.installedManifest?.fileCount === sourceInventory.fileCount &&
      value.installedManifest?.totalBytes === sourceInventory.totalBytes,
    'Installed worker inventory evidence differs',
  );
  requireCondition(value.runtime?.health?.version === version && value.runtime?.probe?.status === 'ok', 'Installed worker runtime evidence differs');
  requireCondition(value.runtime?.probe?.frozen === true, 'Installed worker did not report frozen mode');
  requireCondition(
    JSON.stringify(value.runtime?.probe?.ortDml?.profiledProviders) ===
      JSON.stringify(['DmlExecutionProvider']),
    'Installed worker did not execute the DirectML probe',
  );
  requireCondition(
    JSON.stringify(value.environmentKeys) ===
      JSON.stringify(['PATH', 'PATHEXT', 'PYTHONNOUSERSITE', 'SystemRoot', 'TEMP', 'TMP', 'WINDIR']),
    'Installed worker environment keys differ',
  );
}

async function main() {
  progress('preflight');
  requireCondition(process.platform === 'win32' && process.arch === 'x64', 'SPI-05 requires Windows x64');
  const sourceHashesBefore = await readSourceHashes();
  const product = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8'));
  requireCondition(product.name === 'autovision-studio' && product.version === version
    && product.devDependencies?.['electron-builder'] === '26.15.3', 'Product metadata or builder version differs');
  for (const path of [workerRoot, electronDist, builderCli, configPath, sourceMain, sourceHarness]) {
    requireCondition(existsSync(path), `SPI-05 input is missing: ${basename(path)}`);
  }

  const runId = randomUUID();
  const localAppData = readEnvironmentValue('LOCALAPPDATA');
  requireCondition(
    typeof localAppData === 'string' && isAbsoluteWindowsPath(localAppData),
    'LOCALAPPDATA is unavailable',
  );
  const hostTemporaryRoot = join(localAppData, 'Temp');
  requireCondition(existsSync(hostTemporaryRoot), 'Host temporary root is unavailable');
  const root = await mkdtemp(join(hostTemporaryRoot, `autovision-spi05-${runId}-`));
  const appDir = join(root, 'app');
  const stagedWorkerRoot = join(appDir, 'worker');
  const evidenceDir = join(root, 'evidence');
  const outputDir = join(root, 'output');
  const builderCache = join(root, 'builder-cache');
  const builderTemp = join(root, 'builder-temp');
  const installerTemp = join(root, 'installer-temp');
  const installDir = join(root, 'installed');
  const smokeTemp = join(root, 'smoke-temp');
  const sourceManifestPath = join(evidenceDir, 'source-worker-manifest.json');
  const packagedManifestPath = join(appDir, 'source-worker-manifest.json');
  const installedResultPath = join(evidenceDir, 'installed-result.json');
  const installedElectronLogPath = join(evidenceDir, 'installed-electron.log');
  const finalEvidencePath = join(evidenceDir, 'run-result.json');
  const productName = `AutoVision SPI-05 ${runId}`;
  const appPackageName = `autovision-spi05-${runId}`;
  const installedExecutable = join(installDir, `${appPackageName}.exe`);
  const installedUninstaller = join(installDir, `Uninstall ${appPackageName}.exe`);
  const installedWorkerRoot = join(installDir, 'resources', 'worker');
  const installedWorkerExecutable = join(installedWorkerRoot, 'autovision-worker.exe');
  const updaterCache = join(localAppData, `${appPackageName}-updater`);
  const profileNames = [productName, appPackageName, 'autovision-spi05'];
  const defaultProfiles = profileNames.flatMap((name) => [
    join(process.env.APPDATA ?? '', name),
    join(process.env.LOCALAPPDATA ?? '', name),
  ]);
  const desktopShortcut = join(process.env.USERPROFILE ?? '', 'Desktop', `${productName}.lnk`);
  const startMenuShortcut = join(
    process.env.APPDATA ?? '',
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    `${productName}.lnk`,
  );

  await Promise.all([
    mkdir(appDir, { recursive: true }),
    mkdir(join(appDir, 'build'), { recursive: true }),
    mkdir(evidenceDir, { recursive: true }),
    mkdir(outputDir, { recursive: true }),
    mkdir(builderCache, { recursive: true }),
    mkdir(builderTemp, { recursive: true }),
    mkdir(installerTemp, { recursive: true }),
    mkdir(smokeTemp, { recursive: true }),
  ]);
  activeRun = {
    runId,
    root,
    sourceHashesBefore,
    sourceHashesAfter: null,
    evidenceDir,
    installDir,
    installedExecutable,
    installedUninstaller,
    installedWorkerExecutable,
    installerTemp,
    productName,
    installerMetadata: null,
    installationStarted: false,
    updaterCache,
    updaterCacheObserved: null,
    updaterCacheRemoved: false,
    uninstaller: null,
    uninstallerCopy: null,
    uninstallStarted: false,
    registry: { before: null, installed: null, after: null },
    buildReceipts: [],
    nsisToolsetRecoveries: [],
    installReceipt: null,
    appReceipt: null,
    uninstallReceipt: null,
  };
  const filesystem = await statfs(root);
  const freeBytes = Number(filesystem.bavail) * Number(filesystem.bsize);
  requireCondition(Number.isSafeInteger(freeBytes) && freeBytes >= 3 * 1024 ** 3, 'SPI-05 requires at least 3 GiB free temporary space');

  progress('inventory-source-worker');
  const sourceInventory = await inventoryDirectory(workerRoot);
  const sourceManifestBytes = encodeInventory(sourceInventory.manifest);
  await writeFile(sourceManifestPath, sourceManifestBytes, { flag: 'wx' });
  progress('stage-worker');
  await cp(workerRoot, stagedWorkerRoot, {
    recursive: true,
    errorOnExist: true,
    force: false,
    verbatimSymlinks: true,
  });
  progress('inventory-staged-worker');
  const stagedInventory = await inventoryDirectory(stagedWorkerRoot);
  compareInventories(sourceInventory.manifest, stagedInventory.manifest);
  await writeFile(packagedManifestPath, sourceManifestBytes, { flag: 'wx' });
  const preflightRuntimeDir = join(root, 'preflight-runtime');
  await mkdir(preflightRuntimeDir);
  progress('preflight-worker-runtime');
  const preflightRuntime = await runWorkerSuite(workerRoot, preflightRuntimeDir);

  progress('stage-electron-entry');
  await Promise.all([
    copyFile(sourceMain, join(appDir, 'main.mjs')),
    copyFile(sourceHarness, join(appDir, 'harness.mjs')),
    copyFile(join(repositoryRoot, 'spikes/packaging/installer.nsh'), join(appDir, 'build/installer.nsh')),
    writeFile(
      join(appDir, 'package.json'),
      `${JSON.stringify(
        {
          name: appPackageName,
          version,
          private: true,
          description: 'Isolated AutoVision SPI-05 worker resource smoke test.',
          main: 'main.mjs',
          author: 'AutoVision Studio SPI-05',
          license: 'UNLICENSED',
        },
        null,
        2,
      )}\n`,
      { flag: 'wx' },
    ),
  ]);

  const pwshPath = requirePowerShellStdout(runPowerShell(powerShellScript(
    '  [Console]::WriteLine([Environment]::ProcessPath)',
  )), 'PowerShell executable resolution').trim();
  requireCondition(isAbsoluteWindowsPath(pwshPath) && win32.basename(pwshPath).toLowerCase() === 'pwsh.exe'
    && existsSync(pwshPath), 'Verified PowerShell 7 executable is unavailable');
  const buildEnv = safeWindowsEnvironment({
    AUTOVISION_SPI05_PWSH: pwshPath,
    APP_BUILDER_TMP_DIR: builderTemp,
    CSC_IDENTITY_AUTO_DISCOVERY: 'false',
    ELECTRON_BUILDER_CACHE: builderCache,
    TEMP: builderTemp,
    TMP: builderTemp,
  });
  const buildStartedAt = new Date().toISOString();
  const buildArguments = [
    builderCli,
    '--config',
    configPath,
    `--config.directories.output=${outputDir}`,
    `--config.appId=com.dahatake.autovision.spi05.${runId}`,
    `--config.nsis.guid=${runId}`,
    `--config.win.executableName=${appPackageName}`,
    `--config.productName=${productName}`,
    `--config.electronDist=${electronDist}`,
    '--win',
    'nsis',
    '--x64',
    '--publish',
    'never',
  ];
  const runBuilderAttempt = async (environment) => {
    const attempt = activeRun.buildReceipts.length + 1;
    progress(`build-attempt-${attempt}`);
    activeRun.sourceHashesAfter = await readSourceHashes();
    requireCondition(JSON.stringify(sourceHashesBefore) === JSON.stringify(activeRun.sourceHashesAfter),
      'SPI-05 sources or product metadata changed before build; retry refused');
    const startedAt = new Date().toISOString();
    const receipt = await runProcess(process.execPath, buildArguments, {
      cwd: appDir,
      env: environment,
      timeoutMs: 30 * 60_000,
      maximumOutputBytes: 4 * 1024 * 1024,
    });
    const finishedAt = new Date().toISOString();
    const stdoutFile = `builder-attempt-${attempt}.stdout.log`;
    const stderrFile = `builder-attempt-${attempt}.stderr.log`;
    await Promise.all([
      writeFile(join(evidenceDir, stdoutFile), receipt.stdout, { flag: 'wx' }),
      writeFile(join(evidenceDir, stderrFile), receipt.stderr, { flag: 'wx' }),
    ]);
    activeRun.buildReceipts.push({
      attempt,
      startedAt,
      finishedAt,
      ...receiptSummary(receipt),
      stdoutFile,
      stderrFile,
    });
    return receipt;
  };
  const buildOverrides = {};
  let buildReceipt;
  while (activeRun.buildReceipts.length < 3) {
    buildReceipt = await runBuilderAttempt({ ...buildEnv, ...buildOverrides });
    if (
      buildReceipt.exitCode === 0 &&
      buildReceipt.signal === null &&
      buildReceipt.timedOut === false &&
      buildReceipt.outputExceeded === false
    ) {
      break;
    }
    const recovery = getRetryableNsisToolsetCacheRenameFailure(
      buildReceipt,
      builderCache,
    );
    if (recovery === null) break;
    progress('verify-nsis-toolset-recovery');
    const expected = NSIS_TOOLSET_RECOVERY[recovery.releaseName];
    requireCondition(expected !== undefined, 'Retryable NSIS toolset version differs');
    requireCondition(
      !activeRun.nsisToolsetRecoveries.some(
        (item) => item.releaseName === recovery.releaseName,
      ),
      'NSIS toolset rename failed again after recovery',
    );
    const archivePath = join(
      builderCache,
      recovery.releaseName,
      `${recovery.releaseName}.7z`,
    );
    const archive = await fileMetadata(archivePath);
    requireCondition(
      archive.sha256 === expected.archiveSha256,
      'Retryable NSIS toolset archive SHA-256 differs',
    );
    const bundle = await inventoryDirectory(recovery.temporaryDirectory);
    requireCondition(
      bundle.manifest.fileCount === expected.fileCount &&
        bundle.manifest.totalBytes === expected.totalBytes &&
        bundle.sha256 === expected.manifestSha256,
      'Retryable NSIS toolset bundle differs',
    );
    activeRun.nsisToolsetRecoveries.push({
      reason: 'EPERM_RENAME',
      releaseName: recovery.releaseName,
      environmentVariable: expected.environmentVariable,
      temporaryDirectory: recovery.temporaryDirectory,
      archive,
      bundle: {
        fileCount: bundle.manifest.fileCount,
        totalBytes: bundle.manifest.totalBytes,
        manifestSha256: bundle.sha256,
      },
      bundleUnmodifiedAfterBuild: false,
    });
    buildOverrides[expected.environmentVariable] = recovery.temporaryDirectory;
  }
  requireCondition(buildReceipt !== undefined, 'electron-builder did not run');
  requireSuccessfulReceipt(buildReceipt, 'electron-builder');
  for (const recovery of activeRun.nsisToolsetRecoveries) {
    const bundleAfter = await inventoryDirectory(recovery.temporaryDirectory);
    requireCondition(
      bundleAfter.sha256 === recovery.bundle.manifestSha256,
      'Recovered NSIS toolset bundle changed during build',
    );
    recovery.bundleUnmodifiedAfterBuild = true;
  }
  const buildFinishedAt = new Date().toISOString();

  progress('verify-build-output');
  const installerPath = join(outputDir, `autovision-spi05-${version}-windows-x64.exe`);
  requireCondition(existsSync(installerPath), 'NSIS installer was not generated');
  const installerMetadata = await fileMetadata(installerPath);
  activeRun.installerMetadata = installerMetadata;
  const unpackedWorkerRoot = join(outputDir, 'win-unpacked', 'resources', 'worker');
  const unpackedInventory = await inventoryDirectory(unpackedWorkerRoot);
  compareInventories(sourceInventory.manifest, unpackedInventory.manifest);
  const cacheInventory = await inventoryDirectory(builderCache);

  progress('verify-pre-install-boundaries');
  activeRun.sourceHashesAfter = await readSourceHashes();
  requireCondition(JSON.stringify(sourceHashesBefore) === JSON.stringify(activeRun.sourceHashesAfter),
    'SPI-05 sources or product metadata changed before installation');
  for (const path of [installDir, installedResultPath, updaterCache, ...defaultProfiles, desktopShortcut, startMenuShortcut]) {
    requireCondition(!existsSync(path), 'SPI-05 unique output existed before installation');
  }
  activeRun.registry.before = readRegistrySnapshot(runId);
  validateRegistrySnapshot(activeRun.registry.before);

  progress('install');
  activeRun.installationStarted = true;
  const installReceipt = await runProcess(
    installerPath,
    ['/S', '/currentuser', `/D=${installDir}`],
    {
      cwd: root,
      env: safeWindowsEnvironment({ TEMP: installerTemp, TMP: installerTemp }),
      timeoutMs: 15 * 60_000,
      windowsVerbatimArguments: true,
    },
  );
  activeRun.installReceipt = receiptSummary(installReceipt);
  requireSuccessfulReceipt(installReceipt, 'NSIS installer');
  progress('verify-installed-output');
  const uninstaller = await findUninstaller(installDir, runId);
  activeRun.registry.installed = readRegistrySnapshot(runId);
  validateRegistrySnapshot(activeRun.registry.installed, { productName, installDir, uninstaller });
  activeRun.uninstallerCopy = await copyUninstaller(uninstaller, installerTemp);
  activeRun.uninstaller = activeRun.uninstallerCopy.path;
  for (const path of [installedExecutable, installedWorkerExecutable, uninstaller]) {
    requireCondition(existsSync(path), `Installed output is missing: ${basename(path)}`);
  }
  const installedInventory = await inventoryDirectory(installedWorkerRoot);
  compareInventories(sourceInventory.manifest, installedInventory.manifest);
  const updaterInventory = await inventoryDirectory(updaterCache);
  requireCondition(updaterInventory.manifest.fileCount === 1
    && updaterInventory.manifest.files[0].path === 'installer.exe'
    && updaterInventory.manifest.files[0].sha256 === installerMetadata.sha256
    && updaterInventory.manifest.files[0].byteSize === installerMetadata.byteSize,
  'Dedicated updater cache differs from this run installer');
  activeRun.updaterCacheObserved = updaterInventory.manifest;

  progress('installed-electron-smoke');
  const appStartedAt = new Date().toISOString();
  const appReceipt = await runProcess(installedExecutable, [], {
    cwd: installDir,
    env: safeWindowsEnvironment({
      TEMP: smokeTemp,
      TMP: smokeTemp,
      AUTOVISION_SPI05_RESULT: installedResultPath,
      AUTOVISION_SPI05_TEMP: smokeTemp,
      ELECTRON_ENABLE_LOGGING: '1',
      ELECTRON_LOG_FILE: installedElectronLogPath,
    }),
    timeoutMs: 10 * 60_000,
  });
  await Promise.all([
    writeFile(join(evidenceDir, 'installed-app.stdout.log'), appReceipt.stdout, {
      flag: 'wx',
    }),
    writeFile(join(evidenceDir, 'installed-app.stderr.log'), appReceipt.stderr, {
      flag: 'wx',
    }),
  ]);
  activeRun.appReceipt = receiptSummary(appReceipt);
  activeRun.appReceipt.startedAt = appStartedAt;
  activeRun.appReceipt.finishedAt = new Date().toISOString();
  requireSuccessfulReceipt(appReceipt, 'Installed Electron smoke');
  progress('verify-installed-smoke');
  requireCondition(existsSync(installedResultPath), 'Installed Electron result is missing');
  const installedResultBytes = await readFile(installedResultPath);
  const installedEvidence = parseJsonObject(installedResultBytes, 'Installed Electron result');
  validateInstalledEvidence(installedEvidence, sourceInventory.manifest, sourceManifestBytes);
  const workerProcessesAfterSmoke = queryExactProcessCount(installedWorkerExecutable);
  requireCondition(workerProcessesAfterSmoke === 0, 'Installed worker process remained after smoke');
  const electronProcessesAfterSmoke = queryExactProcessCount(installedExecutable);
  requireCondition(electronProcessesAfterSmoke === 0, 'Installed Electron process remained after smoke');
  for (const path of [...defaultProfiles, desktopShortcut, startMenuShortcut]) {
    requireCondition(!existsSync(path), 'Installed smoke wrote outside its isolated profile');
  }

  progress('uninstall-body');
  // Recheck the key that NSIS initMultiUser reads before it can select $INSTDIR.
  validateRegistrySnapshot(readRegistrySnapshot(runId), { productName, installDir, uninstaller });
  activeRun.uninstallStarted = true;
  const uninstallReceipt = await runUninstaller(activeRun.uninstallerCopy, installDir, installerTemp, runId);
  activeRun.uninstallReceipt = receiptSummary(uninstallReceipt);
  requireSuccessfulReceipt(uninstallReceipt, 'NSIS uninstaller');
  progress('verify-uninstall-residue');
  requireCondition(await waitUntilMissing(installDir), 'SPI-05 install directory remained after uninstall');
  activeRun.registry.after = readRegistrySnapshot(runId);
  validateRegistrySnapshot(activeRun.registry.after);
  progress('cleanup-owned-updater-cache');
  await removeUpdaterCache(updaterCache, runId, installerMetadata, updaterInventory.manifest);
  requireCondition(!existsSync(updaterCache), 'Dedicated updater cache remained after cleanup');
  activeRun.updaterCacheRemoved = true;
  for (const path of [...defaultProfiles, desktopShortcut, startMenuShortcut]) {
    requireCondition(!existsSync(path), 'SPI-05 host residue remained after uninstall');
  }
  progress('verify-source-integrity');
  const sourceInventoryAfter = await inventoryDirectory(workerRoot);
  compareInventories(sourceInventory.manifest, sourceInventoryAfter.manifest);
  const sourceHashesAfter = await readSourceHashes();
  activeRun.sourceHashesAfter = sourceHashesAfter;
  requireCondition(JSON.stringify(sourceHashesBefore) === JSON.stringify(sourceHashesAfter), 'SPI-05 sources or product metadata changed during run');

  const effectiveConfigPath = join(outputDir, 'builder-effective-config.yaml');
  const effectiveConfigMetadata = existsSync(effectiveConfigPath)
    ? await fileMetadata(effectiveConfigPath)
    : null;
  const evidence = {
    schemaVersion: 1,
    status: 'ok',
    verdict: 'PASS',
    runId,
    root,
    buildStartedAt,
    buildFinishedAt,
    sourceHashesBefore,
    sourceHashesAfter,
    sourceInputs: {
      workerRoot,
      workerInventory: {
        byteSize: sourceManifestBytes.length,
        sha256: sourceInventory.sha256,
        fileCount: sourceInventory.manifest.fileCount,
        totalBytes: sourceInventory.manifest.totalBytes,
      },
      stagedWorkerInventory: {
        fileCount: stagedInventory.manifest.fileCount,
        totalBytes: stagedInventory.manifest.totalBytes,
        manifestSha256: stagedInventory.sha256,
      },
      workerExecutable: sourceInventory.manifest.files.find(
        (file) => file.path === 'autovision-worker.exe',
      ),
      workerSpec: await fileMetadata(resolve(repositoryRoot, 'ml/packaging/worker-windows.spec')),
      workerLock: await fileMetadata(resolve(repositoryRoot, 'ml/uv.lock')),
      generatedProbe: await fileMetadata(
        resolve(repositoryRoot, 'ml/build/spi03-generated/worker_probe.py'),
      ),
      preflightRuntime,
    },
    builder: {
      version: '26.15.3',
      installerProcessCheck: { executable: pwshPath, scope: 'development-only PowerShell 7+, no force termination' },
      config: await fileMetadata(configPath),
      receipt: activeRun.buildReceipts.at(-1),
      attempts: activeRun.buildReceipts,
      nsisToolsetRecoveries: activeRun.nsisToolsetRecoveries,
      cache: {
        fileCount: cacheInventory.manifest.fileCount,
        totalBytes: cacheInventory.manifest.totalBytes,
        manifestSha256: cacheInventory.sha256,
      },
      effectiveConfig: effectiveConfigMetadata,
    },
    package: {
      installer: { fileName: basename(installerPath), ...installerMetadata },
      unpackedWorker: {
        fileCount: unpackedInventory.manifest.fileCount,
        totalBytes: unpackedInventory.manifest.totalBytes,
        manifestSha256: unpackedInventory.sha256,
      },
    },
    install: {
      receipt: receiptSummary(installReceipt),
      installedWorker: {
        fileCount: installedInventory.manifest.fileCount,
        totalBytes: installedInventory.manifest.totalBytes,
        manifestSha256: installedInventory.sha256,
      },
      appReceipt: activeRun.appReceipt,
      installedEvidence: {
        byteSize: installedResultBytes.length,
        sha256: sha256(installedResultBytes),
        value: installedEvidence,
      },
      workerProcessesAfterSmoke,
      electronProcessesAfterSmoke,
      registryBefore: activeRun.registry.before,
      registryInstalled: activeRun.registry.installed,
    },
    uninstall: {
      receipt: receiptSummary(uninstallReceipt),
      copiedUninstaller: activeRun.uninstallerCopy,
      arguments: uninstallerInvocation(activeRun.uninstaller, installDir, installerTemp, runId).args,
      windowsVerbatimArguments: true,
      installDirectoryRemoved: true,
      registryEntryRemoved: true,
      registryAfter: activeRun.registry.after,
      defaultProfilesAbsent: true,
      shortcutsAbsent: true,
      updaterCacheRemoved: activeRun.updaterCacheRemoved,
      updaterCacheObserved: activeRun.updaterCacheObserved,
    },
    boundaries: {
      projectCodeSigningDisabled: true,
      cleanHostNotTested: true,
      productionConfigNotCreated: true,
      modelPayloadNotAdded: true,
      sourceWorkerDirectoryUnmodified:
        sourceInventoryAfter.sha256 === sourceInventory.sha256,
      temporaryRootRetainedForIndependentReview: true,
    },
  };
  progress('write-final-evidence');
  await writeFile(finalEvidencePath, `${JSON.stringify(evidence, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  console.log(
    JSON.stringify(
      {
        verdict: evidence.verdict,
        runId,
        root,
        evidence: finalEvidencePath,
        workerFiles: sourceInventory.manifest.fileCount,
        workerBytes: sourceInventory.manifest.totalBytes,
        workerManifestSha256: sourceInventory.sha256,
        installer: evidence.package.installer,
        builderCache: evidence.builder.cache,
        installedEvidenceSha256: evidence.install.installedEvidence.sha256,
        uninstall: evidence.uninstall,
      },
      null,
      2,
    ),
  );
}

async function recordFailure(error) {
  const cleanup = {
    installedAppProcessesTerminated: false,
    installedWorkerProcessesTerminated: false,
    processReceipts: {},
    uninstallAttempted: false,
    uninstallExitCode: null,
    uninstallReceipt: null,
    registryBefore: null,
    registryAfter: null,
    installDirectoryRemoved: null,
    errors: [],
  };
  if (activeRun !== null) {
    progress('failure-cleanup');
    if (activeRun.installationStarted) {
      for (const [path, key] of [
        [activeRun.installedExecutable, 'installedAppProcessesTerminated'],
        [activeRun.installedWorkerExecutable, 'installedWorkerProcessesTerminated'],
      ]) {
        progress(`failure-${key}`);
        try {
          // Query even if the on-disk executable has already disappeared.
          const result = runPowerShell(exactProcessScript(path, true), 60_000);
          cleanup.processReceipts[key] = {
            status: result.status, signal: result.signal, error: result.error?.message ?? null,
            stdout: result.stdout ?? null, stderr: result.stderr ?? null,
          };
          cleanup[key] = parseProcessCount(result) === 0;
        } catch (cleanupError) {
          cleanup.errors.push(`${key}: ${cleanupError.message}`);
        }
      }
      try {
        progress('failure-uninstall-body');
        cleanup.registryBefore = readRegistrySnapshot(activeRun.runId);
        if (!activeRun.uninstallStarted && existsSync(activeRun.installDir)) {
          requireCondition(cleanup.installedAppProcessesTerminated && cleanup.installedWorkerProcessesTerminated,
            'Uninstall refused: exact process cleanup is unverified');
          validateRegistrySnapshot(cleanup.registryBefore, {
            productName: activeRun.productName, installDir: activeRun.installDir,
            uninstaller: activeRun.installedUninstaller,
          });
          if (activeRun.uninstallerCopy === null) {
            const original = await findUninstaller(activeRun.installDir, activeRun.runId);
            activeRun.uninstallerCopy = await copyUninstaller(original, activeRun.installerTemp);
            activeRun.uninstaller = activeRun.uninstallerCopy.path;
          }
          cleanup.uninstallAttempted = true;
          activeRun.uninstallStarted = true;
          const result = await runUninstaller(activeRun.uninstallerCopy, activeRun.installDir,
            activeRun.installerTemp, activeRun.runId);
          cleanup.uninstallExitCode = result.exitCode;
          cleanup.uninstallReceipt = receiptSummary(result);
          requireSuccessfulReceipt(result, 'Failure cleanup NSIS uninstaller');
          requireCondition(await waitUntilMissing(activeRun.installDir), 'Failure cleanup install directory remained');
        }
      } catch (cleanupError) {
        cleanup.errors.push(`uninstall: ${cleanupError.message}`);
      }
      try {
        cleanup.registryAfter = readRegistrySnapshot(activeRun.runId);
        validateRegistrySnapshot(cleanup.registryAfter);
      } catch (cleanupError) {
        cleanup.errors.push(`registry: ${cleanupError.message}`);
      }
      cleanup.installDirectoryRemoved = !existsSync(activeRun.installDir);
      if (activeRun.updaterCacheObserved !== null && !activeRun.updaterCacheRemoved) {
        try {
          progress('failure-owned-updater-cache');
          await removeUpdaterCache(activeRun.updaterCache, activeRun.runId,
            activeRun.installerMetadata, activeRun.updaterCacheObserved);
          activeRun.updaterCacheRemoved = true;
        } catch (cleanupError) {
          cleanup.errors.push(`updater cache retained: ${cleanupError.message}`);
        }
      }
    }
    try {
      progress('failure-source-integrity');
      // A failed final read must not leave a pre-install snapshot labelled "after".
      activeRun.sourceHashesAfter = null;
      activeRun.sourceHashesAfter = await readSourceHashes();
      requireCondition(JSON.stringify(activeRun.sourceHashesBefore) === JSON.stringify(activeRun.sourceHashesAfter),
        'SPI-05 sources or product metadata changed during run; no retry');
    } catch (sourceError) {
      cleanup.errors.push(`source integrity: ${sourceError.message}`);
    }
    await mkdir(activeRun.evidenceDir, { recursive: true }).catch(() => undefined);
    await writeFile(
      join(activeRun.evidenceDir, 'failure-result.json'),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          status: 'error',
          verdict: 'FAIL',
          runId: activeRun.runId,
          root: activeRun.root,
          sourceHashesBefore: activeRun.sourceHashesBefore,
          sourceHashesAfter: activeRun.sourceHashesAfter,
          name: error instanceof Error ? error.name : 'UnknownError',
          message: error instanceof Error ? error.message : String(error),
          buildAttempts: activeRun.buildReceipts,
          nsisToolsetRecoveries: activeRun.nsisToolsetRecoveries,
          processReceipts: {
            install: activeRun.installReceipt,
            installedApp: activeRun.appReceipt,
            uninstall: activeRun.uninstallReceipt,
          },
          copiedUninstaller: activeRun.uninstallerCopy,
          registry: activeRun.registry,
          updaterCache: {
            path: activeRun.updaterCache,
            observed: activeRun.updaterCacheObserved,
            removed: activeRun.updaterCacheRemoved,
          },
          cleanup,
        },
        null,
        2,
      )}\n`,
      { encoding: 'utf8', flag: 'wx' },
    ).catch(() => undefined);
  }
  console.error(
    JSON.stringify(
      {
        status: 'error',
        verdict: 'FAIL',
        runId: activeRun?.runId ?? null,
        root: activeRun?.root ?? null,
        name: error instanceof Error ? error.name : 'UnknownError',
        message: error instanceof Error ? error.message : String(error),
        cleanup,
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
}

const entryPath = process.argv[1] === undefined ? null : resolve(process.argv[1]);
const modulePath = fileURLToPath(import.meta.url);
if (entryPath !== null && (process.platform === 'win32'
  ? entryPath.toLowerCase() === modulePath.toLowerCase() : entryPath === modulePath)) {
  const heartbeat = setInterval(() => progress(activePhase, true), 20_000);
  heartbeat.unref();
  try {
    await main().catch(recordFailure);
  } finally {
    clearInterval(heartbeat);
  }
}
