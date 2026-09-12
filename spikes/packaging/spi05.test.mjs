import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { link, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import {
  compareInventories,
  encodeInventory,
  getRetryableNsisToolsetCacheRenameFailure,
  inventoryDirectory,
  runProcess,
  validateHealthReceipt,
  validateInventory,
  validateProbeReceipt,
} from './harness.mjs';

import {
  exactProcessScript,
  parseProcessCount,
  readRegistrySnapshot,
  registryProbeScript,
  removeUpdaterCache,
  uninstallerInvocation,
  validateRegistrySnapshot,
} from './run.mjs';

const nativeTestOptions = { timeout: 25_000 };
const windowsTestOptions = {
  ...nativeTestOptions,
  skip: process.platform !== 'win32' ? 'Windows-only native fixture' : false,
};
const unavailableLinkCodes = new Set(['EPERM', 'EACCES', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP']);

async function withTemporaryDirectory(callback) {
  const root = await mkdtemp(join(tmpdir(), 'autovision-spi05-test-'));
  try {
    return await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function createJunction(context, target, path) {
  try {
    await symlink(target, path, 'junction');
    return true;
  } catch (error) {
    if (!unavailableLinkCodes.has(error.code)) throw error;
    context.skip(`junction creation unavailable: ${error.code}`);
    return false;
  }
}

async function readFixturePid(root, name) {
  const text = await readFile(join(root, `${name}.pid`), 'utf8');
  assert.match(text, /^[1-9][0-9]*$/u);
  const pid = Number(text);
  assert.ok(Number.isSafeInteger(pid) && pid !== process.pid, 'Expected an owned child PID');
  return pid;
}

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

async function assertProcessExited(pid, detail = '') {
  for (let attempt = 0; attempt < 40 && isProcessRunning(pid); attempt += 1) await delay(50);
  assert.equal(isProcessRunning(pid), false, `Fixture PID ${pid} cleanup unverified: ${detail}`);
}

async function withNativeFixture(callback) {
  await withTemporaryDirectory(async (root) => {
    try {
      await callback(root);
    } finally {
      const failures = [];
      // Stop only fixture-owned PIDs, parent first to prevent further spawning; never kill by image.
      for (const name of ['parent', 'child']) {
        try {
          const pid = await readFixturePid(root, name);
          let detail = '';
          if (isProcessRunning(pid)) {
            if (process.platform === 'win32') {
              const result = spawnSync(
                join(process.env.SystemRoot ?? process.env.WINDIR, 'System32', 'taskkill.exe'),
                ['/PID', String(pid), '/F'],
                { windowsHide: true, encoding: 'utf8', timeout: 3_000 },
              );
              detail = `taskkill status=${result.status}, ${result.error?.message ?? ''}`;
            } else {
              try {
                process.kill(pid, 'SIGKILL');
              } catch (error) {
                if (error.code !== 'ESRCH') throw error;
              }
            }
          }
          await assertProcessExited(pid, detail);
        } catch (error) {
          if (error.code !== 'ENOENT') failures.push(error);
        }
      }
      if (failures.length > 0) throw new AggregateError(failures, 'Owned fixture cleanup failed');
    }
  });
}

function nodeFixtureProgram(pidPath, body) {
  return `
    require('node:fs').writeFileSync(${JSON.stringify(pidPath)}, String(process.pid));
    setTimeout(() => process.exit(99), 20_000).unref();
    ${body}
  `;
}

async function runNodeFixture(root, body, options = {}) {
  let watchdog;
  try {
    return await Promise.race([
      runProcess(process.execPath, ['-e', nodeFixtureProgram(join(root, 'parent.pid'), body)], {
        timeoutMs: 3_000,
        ...options,
      }),
      new Promise((_, reject) => {
        watchdog = setTimeout(() => reject(new Error('Native fixture exceeded the test deadline')), 9_000);
      }),
    ]);
  } finally {
    clearTimeout(watchdog);
  }
}

function descendantFixtureProgram(root, parentExits) {
  const childProgram = nodeFixtureProgram(join(root, 'child-ready.pid'), 'setInterval(() => {}, 50);');
  return `
    const child = require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(childProgram)}], {
      windowsHide: true, stdio: ['ignore', 'inherit', 'inherit'],
    });
    require('node:fs').writeFileSync(${JSON.stringify(join(root, 'child.pid'))}, String(child.pid));
    ${parentExits ? 'child.unref(); process.exit(0);' : 'setInterval(() => {}, 50);'}
  `;
}

function receipt(stdout, overrides = {}) {
  return {
    exitCode: 0,
    signal: null,
    timedOut: false,
    outputExceeded: false,
    stdout: Buffer.from(stdout, 'utf8'),
    stderr: Buffer.alloc(0),
    ...overrides,
  };
}

function syncReceipt(stdout, overrides = {}) {
  return { status: 0, signal: null, stdout, stderr: '', ...overrides };
}

const exampleRunId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const otherRunId = '11111111-2222-4333-8444-555555555555';
const exampleInstallDir = String.raw`C:\Temp\AutoVision run\installed`;
const exampleInstallerTemp = String.raw`C:\Temp\AutoVision run\installer-temp`;
const exampleUninstallerName = `Uninstall autovision-spi05-${exampleRunId}.exe`;
const exampleRegistryIdentity = {
  productName: `AutoVision SPI-05 ${exampleRunId}`,
  installDir: exampleInstallDir,
  uninstaller: win32.join(exampleInstallDir, exampleUninstallerName),
};

const health = '{"version":"0.1.0","os":"Windows"}\r\n';
const probeValue = {
  status: 'ok',
  frozen: true,
  versions: {
    'autovision-ml': '0.1.0',
    onnx: '1.22.0',
    onnxruntime: '1.24.4',
    optuna: '4.9.0',
    torch: '2.11.0+cpu',
    torchvision: '0.26.0+cpu',
  },
  torchCpuOutput: [4, 6],
  optunaTrials: 1,
  onnxChecked: true,
  ortCpuOutput: [4.0, 6.0],
  ortAvailableProviders: ['DmlExecutionProvider', 'CPUExecutionProvider'],
  ortDml: {
    available: true,
    output: [4.0, 6.0],
    profiledProviders: ['DmlExecutionProvider'],
  },
  torchCudaAvailable: false,
  torchCudaVersion: null,
};
const probe = `${JSON.stringify(probeValue)}\n`;

test('electron-builder 26.15.3 keeps resource editing while disabling signing', async () => {
  const configPath = fileURLToPath(
    new URL('./electron-builder.windows.yml', import.meta.url),
  );
  const packagePath = fileURLToPath(new URL('../../package.json', import.meta.url));
  const config = await readFile(configPath, 'utf8');
  const packageMetadata = JSON.parse(await readFile(packagePath, 'utf8'));
  assert.equal(packageMetadata.devDependencies?.['electron-builder'], '26.15.3');
  assert.doesNotMatch(config, /^\s*signAndEditExecutable\s*:/mu);
  assert.match(config, /^\s*signExecutable\s*:\s*false\s*$/mu);
});

test('SPI-05 ESM entry starts without top-level ready await and prepares profile paths first', async () => {
  const source = await readFile(fileURLToPath(new URL('./main.mjs', import.meta.url)), 'utf8');
  assert.match(source, /^void main\(\)\.then\(/mu);
  assert.doesNotMatch(source, /^\s*await main\(\)/mu);
  const ready = source.indexOf('await app.whenReady()');
  assert.ok(ready > 0);
  for (const [path, electronPath] of [
    ['user-data', 'userData'],
    ['session-data', 'sessionData'],
  ]) {
    const creation = source.indexOf(`mkdirSync(join(temporaryRoot, '${path}')`);
    assert.ok(creation > 0 && creation < ready);
    const configuration = source.indexOf(
      `app.setPath('${electronPath}', join(temporaryRoot, '${path}'))`,
    );
    assert.ok(configuration > creation && configuration < ready);
  }
});

test('NSIS overrides legacy PowerShell with a pinned Core-only read-only process check', async () => {
  const include = await readFile(fileURLToPath(new URL('./installer.nsh', import.meta.url)), 'utf8');
  const config = await readFile(fileURLToPath(new URL('./electron-builder.windows.yml', import.meta.url)), 'utf8');
  assert.match(config, /^\s+include: build\/installer\.nsh\s*$/mu);
  assert.match(include, /!macro customCheckAppRunning/u);
  assert.match(include, /AUTOVISION_SPI05_PWSH/u);
  assert.match(include, /-NoLogo -NoProfile -NonInteractive/u);
  assert.match(include, /PSEdition -ne 'Core'/u);
  assert.match(include, /Version\.Major -lt 7/u);
  assert.match(include, /-ErrorAction Stop/u);
  assert.match(include, /SetErrorLevel 2/u);
  assert.doesNotMatch(include, /taskkill|Stop-Process|nsProcess::_KillProcess/u);
});

test('inventory hashes every regular file in ordinal relative-path order', async () => {
  await withTemporaryDirectory(async (root) => {
    await mkdir(join(root, 'nested'));
    await writeFile(join(root, 'z.txt'), 'z');
    await writeFile(join(root, 'nested', 'a.bin'), Buffer.from([0, 1, 2]));

    const inventory = await inventoryDirectory(root);
    assert.deepEqual(inventory.manifest.files.map((file) => file.path), [
      'nested/a.bin',
      'z.txt',
    ]);
    assert.equal(inventory.manifest.fileCount, 2);
    assert.equal(inventory.manifest.totalBytes, 4);
    assert.deepEqual(inventory.bytes, encodeInventory(inventory.manifest));
    assert.match(inventory.sha256, /^[0-9a-f]{64}$/u);
  });
});

test('inventory rejects hard links', async (context) => {
  await withTemporaryDirectory(async (root) => {
    const source = join(root, 'source.txt');
    await writeFile(source, 'source');
    const linked = join(root, 'linked.txt');
    try {
      await link(source, linked);
    } catch (error) {
      if (!unavailableLinkCodes.has(error.code)) throw error;
      context.skip(`hard links unavailable: ${error.code}`);
      return;
    }
    await assert.rejects(inventoryDirectory(root), /hard-linked/u);
  });
});

test('inventory rejects a Windows junction inside its content', windowsTestOptions, async (context) => {
  await withTemporaryDirectory(async (root) => {
    const source = join(root, 'source');
    const content = join(root, 'content');
    await mkdir(source);
    await mkdir(content);
    await writeFile(join(source, 'worker.bin'), 'worker');
    if (!await createJunction(context, source, join(content, 'linked'))) return;
    await assert.rejects(inventoryDirectory(content), /links and junctions are forbidden/u);
  });
});

test('inventory rejects a Windows junction as its root', windowsTestOptions, async (context) => {
  await withTemporaryDirectory(async (root) => {
    const source = join(root, 'source');
    const linkedRoot = join(root, 'linked-root');
    await mkdir(source);
    await writeFile(join(source, 'worker.bin'), 'worker');
    if (!await createJunction(context, source, linkedRoot)) return;
    await assert.rejects(inventoryDirectory(linkedRoot), /root contains a linked or non-directory node/u);
  });
});

test('inventory comparison catches same-size modification, deletion, and addition', async () => {
  await withTemporaryDirectory(async (root) => {
    await writeFile(join(root, 'a.txt'), 'abc');
    await writeFile(join(root, 'b.txt'), 'def');
    const baseline = (await inventoryDirectory(root)).manifest;

    await writeFile(join(root, 'a.txt'), 'xyz');
    const modified = (await inventoryDirectory(root)).manifest;
    assert.throws(() => compareInventories(baseline, modified), /SHA-256 differs/u);

    await rm(join(root, 'a.txt'));
    const deleted = (await inventoryDirectory(root)).manifest;
    assert.throws(() => compareInventories(baseline, deleted), /file count differs/u);

    await writeFile(join(root, 'a.txt'), 'abc');
    await writeFile(join(root, 'c.txt'), 'new');
    const added = (await inventoryDirectory(root)).manifest;
    assert.throws(() => compareInventories(baseline, added), /file count differs/u);
  });
});

test('inventory validation rejects malformed schemas, fields, sizes, hashes, and totals', () => {
  const valid = {
    schemaVersion: 1,
    fileCount: 1,
    totalBytes: 3,
    files: [{ path: 'a.txt', byteSize: 3, sha256: 'a'.repeat(64) }],
  };
  const cases = [
    { ...valid, schemaVersion: 2 },
    { ...valid, extra: true },
    { ...valid, files: [], fileCount: 0, totalBytes: 0 },
    { ...valid, fileCount: 2 },
    { ...valid, totalBytes: 4 },
    { ...valid, files: [{ ...valid.files[0], extra: true }] },
    { ...valid, files: [{ ...valid.files[0], byteSize: 1.5 }], totalBytes: 1.5 },
    { ...valid, files: [{ ...valid.files[0], sha256: 'g'.repeat(64) }] },
  ];
  for (const value of cases) assert.throws(() => validateInventory(value));
});

test('inventory validation rejects unsafe and case-colliding Windows paths', () => {
  const manifest = (paths) => ({
    schemaVersion: 1,
    fileCount: paths.length,
    totalBytes: paths.length,
    files: paths.map((path, index) => ({
      path,
      byteSize: 1,
      sha256: String(index + 1).padStart(64, '0'),
    })),
  });
  for (const path of [
    '/rooted',
    'trailing/',
    'a\\b',
    'a//b',
    'a/./b',
    'a/../b',
    'file:name',
    'file?.txt',
    'trailing. ',
    'NUL.txt',
  ]) {
    assert.throws(() => validateInventory(manifest([path])), /unsafe relative path/u);
  }
  assert.throws(
    () => validateInventory(manifest(['File.txt', 'file.txt'])),
    /case-insensitive duplicate/u,
  );
});

test('health validation requires one exact compact JSON record', () => {
  assert.deepEqual(validateHealthReceipt(receipt(health)), {
    version: '0.1.0',
    os: 'Windows',
  });
  assert.throws(
    () => validateHealthReceipt(receipt(`${health}{"extra":true}\n`)),
    /exactly one/u,
  );
  assert.throws(
    () => validateHealthReceipt(receipt('{"version":"0.1.0","os":"Linux"}\n')),
    /payload differs/u,
  );
  assert.throws(
    () => validateHealthReceipt(receipt(health, { stderr: Buffer.from('warning') })),
    /emitted stderr/u,
  );
  assert.throws(
    () => validateHealthReceipt(receipt(health, { outputExceeded: true })),
    /output limit/u,
  );
});

test('health rejects duplicate decoded keys before a later value can hide failure', () => {
  for (const raw of [
    '{"version":"0.1.0","os":"Linux","os":"Windows"}',
    String.raw`{"version":"0.1.0","os":"Linux","\u006fs":"Windows"}`,
    String.raw`{"version":"0.1.0","\u006fs":"Linux","os":"Windows"}`,
  ]) {
    assert.throws(() => validateHealthReceipt(receipt(`${raw}\n`)), /duplicate object key/u);
  }
});

test('probe rejects duplicate root keys including escaped names', () => {
  for (const raw of [
    probe.replace('"onnxChecked":true', '"onnxChecked":false,"onnxChecked":true'),
    probe.replace('"onnxChecked":true', String.raw`"onnxChecked":false,"onnx\u0043hecked":true`),
    probe.replace('"versions":{', '"versions":{},"versions":{'),
  ]) {
    assert.throws(() => validateProbeReceipt(receipt(raw)), /duplicate object key/u);
  }
});

test('probe rejects duplicate keys in nested objects and objects within arrays', () => {
  for (const raw of [
    probe.replace('"torch":"2.11.0+cpu"', '"torch":"0.0.0","torch":"2.11.0+cpu"'),
    probe.replace('"torch":"2.11.0+cpu"', String.raw`"to\u0072ch":"0.0.0","torch":"2.11.0+cpu"`),
    probe.replace('"available":true', '"available":false,"available":true'),
    probe.replace('"torchCpuOutput":[4,6]', String.raw`"torchCpuOutput":[{"nested":[{"k":0,"\u006b":1}]}]`),
    probe.replace('"torchCpuOutput":[4,6]', String.raw`"torchCpuOutput":[{"a\"":0,"a\u0022":1}]`),
  ]) {
    assert.throws(() => validateProbeReceipt(receipt(raw)), /duplicate object key/u);
  }
});

test('probe accepts raw Python float spellings and non-duplicate escaped keys', () => {
  const pythonJson = probe.replaceAll('[4,6]', '[4.0, 6.0]')
    .replace('"onnxChecked":true', String.raw`"onnx\u0043hecked":true`);
  assert.ok(pythonJson.includes('[4.0, 6.0]'));
  assert.deepEqual(validateProbeReceipt(receipt(pythonJson)), probeValue);
});

test('probe validation requires execution evidence rather than provider availability', () => {
  assert.equal(validateProbeReceipt(receipt(probe)).status, 'ok');
  const unavailable = structuredClone(probeValue);
  unavailable.ortDml.profiledProviders = ['CPUExecutionProvider'];
  assert.throws(
    () => validateProbeReceipt(receipt(`${JSON.stringify(unavailable)}\n`)),
    /attribute execution to DirectML/u,
  );
  const falseSuccess = structuredClone(probeValue);
  falseSuccess.frozen = false;
  assert.throws(
    () => validateProbeReceipt(receipt(`${JSON.stringify(falseSuccess)}\n`)),
    /successful frozen run/u,
  );
  const reordered = structuredClone(probeValue);
  reordered.ortAvailableProviders.reverse();
  assert.throws(
    () => validateProbeReceipt(receipt(`${JSON.stringify(reordered)}\n`)),
    /required providers differ/u,
  );
  const additional = structuredClone(probeValue);
  additional.ortAvailableProviders.push('UnexpectedExecutionProvider');
  assert.throws(
    () => validateProbeReceipt(receipt(`${JSON.stringify(additional)}\n`)),
    /required providers differ/u,
  );
});

test('probe validation rejects extra output, wrong versions, failure and timeout', () => {
  assert.throws(
    () => validateProbeReceipt(receipt(`prefix${probe}`)),
    /not valid JSON/u,
  );
  const wrongVersion = structuredClone(probeValue);
  wrongVersion.versions.onnxruntime = '0.0.0';
  assert.throws(
    () => validateProbeReceipt(receipt(`${JSON.stringify(wrongVersion)}\n`)),
    /dependency versions differ/u,
  );
  assert.throws(
    () => validateProbeReceipt(receipt(probe, { exitCode: 1 })),
    /did not exit successfully/u,
  );
  assert.throws(
    () => validateProbeReceipt(receipt(probe, { timedOut: true, signal: 'SIGTERM' })),
    /did not exit successfully/u,
  );
});

test('runProcess captures a native Node normal exit', nativeTestOptions, async () => {
  await withNativeFixture(async (root) => {
    const result = await runNodeFixture(root, String.raw`process.stdout.write('normal\n');`);
    assert.deepEqual(result, receipt('normal\n'));
    await assertProcessExited(await readFixturePid(root, 'parent'));
  });
});

test('runProcess preserves native stderr and a nonzero exit', nativeTestOptions, async () => {
  await withNativeFixture(async (root) => {
    const result = await runNodeFixture(root, String.raw`
      process.stdout.write('out\n');
      process.stderr.write('failure\n');
      process.exitCode = 7;
    `);
    assert.deepEqual(result, receipt('out\n', { exitCode: 7, stderr: Buffer.from('failure\n') }));
    await assertProcessExited(await readFixturePid(root, 'parent'));
  });
});

test('runProcess bounds real stdout and stderr floods and terminates the producer', nativeTestOptions, async () => {
  for (const stream of ['stdout', 'stderr']) {
    await withNativeFixture(async (root) => {
      const result = await runNodeFixture(root, `
        setInterval(() => process.${stream}.write('x'.repeat(1024)), 1);
      `, { maximumOutputBytes: 256 });
      assert.equal(result.outputExceeded, true);
      assert.equal(result.timedOut, false);
      assert.ok(result.exitCode !== 0 || result.signal !== null);
      assert.ok(result.stdout.length <= 256 && result.stderr.length <= 256);
      await assertProcessExited(await readFixturePid(root, 'parent'));
    });
  }
});

test('runProcess times out and terminates a real interval child', nativeTestOptions, async () => {
  await withNativeFixture(async (root) => {
    const result = await runNodeFixture(root, 'setInterval(() => {}, 50);');
    assert.equal(result.timedOut, true);
    assert.equal(result.outputExceeded, false);
    assert.ok(result.exitCode !== 0 || result.signal !== null);
    await assertProcessExited(await readFixturePid(root, 'parent'));
  });
});

test('runProcess timeout terminates the Windows child and grandchild tree', windowsTestOptions, async () => {
  await withNativeFixture(async (root) => {
    const result = await runNodeFixture(root, descendantFixtureProgram(root, false));
    const parentPid = await readFixturePid(root, 'parent');
    const childPid = await readFixturePid(root, 'child');
    assert.notEqual(parentPid, childPid);
    assert.equal(await readFixturePid(root, 'child-ready'), childPid);
    assert.equal(result.timedOut, true);
    assert.equal(result.outputExceeded, false);
    await assertProcessExited(parentPid);
    await assertProcessExited(childPid);
  });
});

test('runProcess settles finitely when a Windows parent exits before its descendant', windowsTestOptions, async () => {
  await withNativeFixture(async (root) => {
    const started = performance.now();
    const outcome = await runNodeFixture(root, descendantFixtureProgram(root, true))
      .then((result) => ({ result }), (error) => ({ error }));
    const parentPid = await readFixturePid(root, 'parent');
    const childPid = await readFixturePid(root, 'child');
    await assertProcessExited(parentPid);
    if (outcome.error) {
      assert.match(outcome.error.message, /cleanup unverified.*parent already exited.*close not observed/u);
      assert.ok(outcome.error.message.includes(`PID ${parentPid} `));
    } else {
      // Windows may close the inherited pipe with the parent. A parent receipt
      // does not claim that its independently running descendant was reaped.
      assert.deepEqual(outcome.result, receipt(''));
    }
    assert.notEqual(parentPid, childPid);
    assert.ok(performance.now() - started < 10_000, 'Expected bounded settlement, not fixture self-expiry');
  });
});

test('runProcess finitely rejects native taskkill launch failure without claiming cleanup', windowsTestOptions, async () => {
  await withNativeFixture(async (root) => {
    const env = { ...process.env };
    const previousSystemRoot = process.env.SystemRoot;
    try {
      // Keep the actual child environment; make only the absolute taskkill path unavailable.
      process.env.SystemRoot = root;
      let failure;
      await assert.rejects(runNodeFixture(root, 'setInterval(() => {}, 50);', { env }), (error) => {
        failure = error;
        return /cleanup unverified: taskkill status=null.*ENOENT.*close not observed/u.test(error.message);
      });
      const pid = await readFixturePid(root, 'parent');
      assert.ok(failure.message.includes(`PID ${pid} `));
      assert.equal(isProcessRunning(pid), true, 'Failed taskkill must not be reported as cleanup success');
    } finally {
      if (previousSystemRoot === undefined) delete process.env.SystemRoot;
      else process.env.SystemRoot = previousSystemRoot;
    }
  });
});

test('NSIS cache retry accepts only isolated toolset rename EPERM failures', async () => {
  await withTemporaryDirectory(async (root) => {
    const builderCache = join(root, 'builder-cache');
    for (const releaseName of ['nsis-resources-3.4.1', 'nsis-3.0.4.1']) {
      const destination = join(
        builderCache,
        releaseName,
        `${releaseName}-abcde`,
      );
      const output = `  ⨯ EPERM: operation not permitted, rename '${destination}.tmp' -> '${destination}'  failedTask=build\n`;
      const failure = receipt(output, { exitCode: 1 });
      assert.deepEqual(getRetryableNsisToolsetCacheRenameFailure(failure, builderCache), {
        temporaryDirectory: `${destination}.tmp`,
        destinationDirectory: destination,
        releaseName,
      });
    }
    const destination = join(
      builderCache,
      'nsis-resources-3.4.1',
      'nsis-resources-3.4.1-abcde',
    );
    const output = `  ⨯ EPERM: operation not permitted, rename '${destination}.tmp' -> '${destination}'  failedTask=build\n`;
    assert.equal(
      getRetryableNsisToolsetCacheRenameFailure(
        receipt(output.replace('nsis-resources-3.4.1', 'unrelated-tool'), { exitCode: 1 }),
        builderCache,
      ),
      null,
    );
    assert.equal(
      getRetryableNsisToolsetCacheRenameFailure(
        receipt(output.replace('EPERM', 'ENOENT'), { exitCode: 1 }),
        builderCache,
      ),
      null,
    );
    assert.equal(
      getRetryableNsisToolsetCacheRenameFailure(
        receipt(output.replace(`${destination}.tmp`, join(root, 'outside.tmp')), {
          exitCode: 1,
        }),
        builderCache,
      ),
      null,
    );
    assert.equal(
      getRetryableNsisToolsetCacheRenameFailure(
        receipt(output, { exitCode: 1, timedOut: true }),
        builderCache,
      ),
      null,
    );
  });
});

test('SPI-05 runner binds executable and NSIS registry keys to the run UUID', async () => {
  const [runner, target, appInfo, common, multiUser, installer] = await Promise.all([
    './run.mjs',
    '../../node_modules/app-builder-lib/out/targets/nsis/NsisTarget.js',
    '../../node_modules/app-builder-lib/out/appInfo.js',
    '../../node_modules/app-builder-lib/templates/nsis/common.nsh',
    '../../node_modules/app-builder-lib/templates/nsis/multiUser.nsh',
    '../../node_modules/app-builder-lib/templates/nsis/include/installer.nsh',
  ].map((path) => readFile(fileURLToPath(new URL(path, import.meta.url)), 'utf8')));
  assert.ok(runner.includes('const appPackageName = `autovision-spi05-${runId}`;'));
  assert.ok(runner.includes('const installedExecutable = join(installDir, `${appPackageName}.exe`);'));
  assert.ok(runner.includes('`--config.appId=com.dahatake.autovision.spi05.${runId}`'));
  assert.ok(runner.includes('`--config.nsis.guid=${runId}`'));
  assert.ok(runner.includes('`--config.win.executableName=${appPackageName}`'));
  assert.doesNotMatch(runner, /['"]autovision-spi05\.exe['"]/u);
  assert.match(target, /const guid = options\.guid \|\|/u);
  assert.match(target, /APP_GUID: guid/u);
  assert.match(target, /UNINSTALL_APP_KEY: uninstallAppKey/u);
  assert.match(appInfo, /this\.productFilename = executableName != null/u);
  assert.ok(common.includes('!define APP_EXECUTABLE_FILENAME "${PRODUCT_FILENAME}.exe"'));
  assert.ok(common.includes('!define UNINSTALL_FILENAME "Uninstall ${PRODUCT_FILENAME}.exe"'));
  assert.match(common, /!ifdef APP_64[\s\S]*?SetRegView 64/u);
  assert.ok(multiUser.includes('INSTALL_REGISTRY_KEY "Software\\${APP_GUID}"'));
  assert.ok(multiUser.includes('UNINSTALL_REGISTRY_KEY "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${UNINSTALL_APP_KEY}"'));
  assert.match(installer, /WriteRegStr SHELL_CONTEXT "\$\{INSTALL_REGISTRY_KEY\}" InstallLocation "\$INSTDIR"/u);
  assert.doesNotMatch(installer, /WriteRegStr[^\r\n]*UNINSTALL_REGISTRY_KEY[^\r\n]*InstallLocation/u);
  assert.match(installer, /UninstallString '"\$2" \$0'/u);
});

test('process count parser accepts complete decimal records with at most one line ending', () => {
  for (const [text, expected] of [['0', 0], ['0\r\n', 0], ['12\n', 12], ['9007199254740991', Number.MAX_SAFE_INTEGER]]) {
    assert.equal(parseProcessCount(syncReceipt(text)), expected);
  }
});

test('process count parser rejects parseInt prefixes, extra records and unsafe integers', () => {
  for (const text of [
    '', '0garbage', '0x10', '-1', '+1', '1.5', '1e2', 'NaN', 'Infinity',
    ' 0', '0 ', '0\n1', '0\n\n', '0\r\n\r\n', '0\r', '\uFEFF0', '０', '9007199254740992',
  ]) {
    assert.throws(() => parseProcessCount(syncReceipt(text)), /count is invalid/u);
  }
});

test('process count parser rejects failed queries even when stdout claims zero', () => {
  for (const overrides of [
    { status: 1 }, { status: null }, { signal: 'SIGTERM' },
    { error: Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }) },
    { error: Object.assign(new Error('unavailable'), { code: 'ENOENT' }) },
    { error: Object.assign(new Error('output limit'), { code: 'ENOBUFS' }) },
    { stderr: 'CIM failed\n' }, { stderr: null }, { stdout: null }, { stdout: Buffer.from('0') },
  ]) {
    assert.throws(() => parseProcessCount(syncReceipt('0\r\n', overrides)), /Exact process inventory/u);
  }
});

test('CIM scripts stop on errors, match exact paths and check taskkill status before recounting', () => {
  const path = `C:\\Users\\O'Brien\\Temp\\autovision-spi05-${exampleRunId}.exe`;
  const query = exactProcessScript(path);
  assert.ok(query.includes("$ErrorActionPreference = 'Stop'"));
  assert.ok(query.includes("$PSVersionTable.PSEdition -ne 'Core'"));
  assert.ok(query.includes("$p = 'C:\\Users\\O''Brien\\Temp\\autovision-spi05-"));
  assert.ok(query.includes(`-Filter "Name = 'autovision-spi05-${exampleRunId}.exe'" -ErrorAction Stop`));
  assert.ok(query.includes('$candidate.ExecutablePath.Equals($p, [StringComparison]::OrdinalIgnoreCase)'));
  assert.ok(query.includes("throw 'Candidate executable path is unavailable'"));
  assert.ok(query.includes('[Console]::Error.WriteLine($_.Exception.Message)'));
  assert.match(query, /catch \{[\s\S]*exit 1/u);
  assert.doesNotMatch(query, /taskkill/iu);
  const cleanup = exactProcessScript(path, true);
  assert.ok(cleanup.includes('& $taskkill /PID $item.ProcessId /T /F'));
  assert.ok(cleanup.includes('$taskkillStatus = $LASTEXITCODE'));
  assert.ok(cleanup.includes('if ($taskkillStatus -ne 0) { throw'));
  assert.ok(cleanup.lastIndexOf('$items = @(Get-ExactProcesses)') > cleanup.indexOf('$taskkillStatus = $LASTEXITCODE'));
  assert.ok(cleanup.includes("if ($items.Count -ne 0) { throw"));
  assert.doesNotMatch(cleanup, /\/IM\b/iu);
  for (const invalid of ['relative.exe', 'C:\\Temp\\bad\nname.exe', "C:\\Temp\\bad'name.exe"]) {
    assert.throws(() => exactProcessScript(invalid), /Exact process/u);
  }
});

test('registry script uses two concrete GUID keys, read-only Registry64 and disposal', () => {
  const script = registryProbeScript(exampleRunId);
  assert.ok(script.includes(`$base.OpenSubKey('Software\\${exampleRunId}', $false)`));
  assert.ok(script.includes(`$base.OpenSubKey('Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${exampleRunId}', $false)`));
  assert.equal((script.match(/\.OpenSubKey\(/gu) ?? []).length, 2);
  assert.equal((script.match(/\.Dispose\(\)/gu) ?? []).length, 3);
  assert.ok(script.includes('[Microsoft.Win32.RegistryHive]::CurrentUser'));
  assert.ok(script.includes('[Microsoft.Win32.RegistryView]::Registry64'));
  assert.ok(script.includes('[Environment]::Is64BitOperatingSystem'));
  assert.ok(script.includes('[Environment]::Is64BitProcess'));
  assert.ok(script.includes("$ErrorActionPreference = 'Stop'"));
  assert.ok(script.includes('ConvertTo-Json -InputObject $snapshot -Depth 4 -Compress -ErrorAction Stop'));
  assert.ok(script.indexOf('[Console]::WriteLine($json)') > script.lastIndexOf('.Dispose()'));
  assert.doesNotMatch(script, /\$\{runId\}|CreateSubKey|DeleteSubKey|SetValue|GetSubKeyNames|reg\.exe|HKLM/u);
  assert.match(readRegistrySnapshot.toString(), /requirePowerShellStdout\(runPowerShell\(registryProbeScript\(runId\)\)/u);
  for (const invalid of ['', 'Software', `${exampleRunId}\\other`, `${exampleRunId}\n`]) {
    assert.throws(() => registryProbeScript(invalid), /run ID is invalid/u);
  }
});

test('registry probe reads a fresh GUID from real HKCU without writing a fixture', {
  timeout: 40_000,
  skip: process.platform !== 'win32' || process.arch !== 'x64' ? 'Windows x64 registry probe' : false,
}, () => {
  // No registry creation, deletion, mocking, enumeration or non-run values.
  assert.deepEqual(readRegistrySnapshot(randomUUID()), { install: null, uninstall: null });
});

test('registry absence requires both exact GUID keys to be null', () => {
  const absent = { install: null, uninstall: null };
  assert.equal(validateRegistrySnapshot(absent), absent);
  for (const snapshot of [
    null, [], {}, { install: null }, { install: null, uninstall: null, extra: true },
    { install: {}, uninstall: null }, { install: null, uninstall: {} },
  ]) {
    assert.throws(() => validateRegistrySnapshot(snapshot), /[Rr]egistry/u);
  }
});

test('installed registry validation normalizes paths and permits the actually absent optional value', () => {
  const snapshot = {
    install: { InstallLocation: `${exampleInstallDir.toUpperCase()}\\` },
    uninstall: {
      DisplayName: exampleRegistryIdentity.productName,
      InstallLocation: null,
      UninstallString: `"${exampleRegistryIdentity.uninstaller.toUpperCase()}" /currentuser`,
    },
  };
  assert.equal(validateRegistrySnapshot(snapshot, exampleRegistryIdentity), snapshot);
  snapshot.uninstall.InstallLocation = `${exampleInstallDir.replaceAll('\\', '/')}/`;
  assert.equal(validateRegistrySnapshot(snapshot, exampleRegistryIdentity), snapshot);
});

test('installed registry validation rejects wrong identities, missing values and uninstall switches', () => {
  const valid = {
    install: { InstallLocation: exampleInstallDir },
    uninstall: {
      DisplayName: exampleRegistryIdentity.productName,
      InstallLocation: null,
      UninstallString: `"${exampleRegistryIdentity.uninstaller}" /currentuser`,
    },
  };
  const invalidSnapshots = [
    { install: null, uninstall: null },
    { ...valid, install: {} },
    { ...valid, uninstall: {} },
    ...['', 42, 'relative', `${exampleInstallDir}-other`].map((InstallLocation) =>
      ({ ...valid, install: { InstallLocation } })),
    { ...valid, uninstall: { ...valid.uninstall, DisplayName: 'Another UUID product' } },
    { ...valid, uninstall: { ...valid.uninstall, InstallLocation: `${exampleInstallDir}-other` } },
    ...[
      null,
      `"${exampleRegistryIdentity.uninstaller}" /allusers`,
      `"${exampleRegistryIdentity.uninstaller}" /currentuser /S`,
      `"${exampleRegistryIdentity.uninstaller}" /currentuser\n`,
      `"${exampleRegistryIdentity.uninstaller.replace(exampleRunId, otherRunId)}" /currentuser`,
    ].map((UninstallString) => ({ ...valid, uninstall: { ...valid.uninstall, UninstallString } })),
  ];
  for (const snapshot of invalidSnapshots) {
    assert.throws(() => validateRegistrySnapshot(snapshot, exampleRegistryIdentity), /Registry/u);
  }
});

test('uninstaller invocation waits on the copied EXE with a final unquoted _?= argument', () => {
  // Argument construction needs no installer, registry writes or application launch.
  const copied = win32.join(exampleInstallerTemp, exampleUninstallerName);
  const command = uninstallerInvocation(copied, exampleInstallDir, exampleInstallerTemp, exampleRunId);
  assert.equal(command.executable, copied);
  assert.notEqual(command.executable, exampleRegistryIdentity.uninstaller);
  assert.deepEqual(command.args, ['/S', '/currentuser', `_?=${exampleInstallDir}`]);
  assert.equal(command.args.at(-1).includes('"'), false);
  assert.equal(command.options.windowsVerbatimArguments, true);
  assert.equal(command.options.cwd, exampleInstallerTemp);
  assert.equal(command.options.env.TEMP, exampleInstallerTemp);
  assert.equal(command.options.env.TMP, exampleInstallerTemp);
  assert.equal(command.options.timeoutMs, 10 * 60_000);
});

test('uninstaller invocation rejects originals, foreign UUID copies and unsafe argument tails', () => {
  const copied = win32.join(exampleInstallerTemp, exampleUninstallerName);
  const nestedTemp = win32.join(exampleInstallDir, 'installer-temp');
  for (const [executable, installDir, installerTemp, runId] of [
    [exampleRegistryIdentity.uninstaller, exampleInstallDir, exampleInstallerTemp, exampleRunId],
    [copied.replace(exampleRunId, otherRunId), exampleInstallDir, exampleInstallerTemp, exampleRunId],
    [copied, `${exampleInstallDir}" /allusers`, exampleInstallerTemp, exampleRunId],
    [copied, `${exampleInstallDir}\n`, exampleInstallerTemp, exampleRunId],
    [copied, 'relative', exampleInstallerTemp, exampleRunId],
    [copied, exampleInstallerTemp, exampleInstallerTemp, exampleRunId],
    [win32.join(nestedTemp, exampleUninstallerName), exampleInstallDir, nestedTemp, exampleRunId],
  ]) {
    assert.throws(() => uninstallerInvocation(executable, installDir, installerTemp, runId), /Uninstaller/u);
  }
});

test('runner guards import, preserves failure receipts and requires harness verbatim forwarding', async () => {
  const [runner, harness] = await Promise.all(['./run.mjs', './harness.mjs'].map((path) =>
    readFile(fileURLToPath(new URL(path, import.meta.url)), 'utf8')));
  const guard = runner.indexOf('if (entryPath !== null');
  assert.ok(guard > runner.indexOf('const modulePath = fileURLToPath(import.meta.url)'));
  assert.ok(runner.indexOf('await main().catch(recordFailure)') > guard);
  assert.ok(runner.indexOf('const heartbeat = setInterval(') > guard);
  assert.ok(runner.includes('clearInterval(heartbeat)'));
  for (const phase of ['install', 'installed-electron-smoke', 'uninstall-body', 'verify-source-integrity', 'failure-cleanup']) {
    assert.ok(runner.includes(`progress('${phase}')`));
  }
  assert.equal((runner.match(/runUninstaller\(activeRun\.uninstallerCopy,/gu) ?? []).length, 2);
  assert.ok(runner.includes('runProcess(invocation.executable, invocation.args, invocation.options)'));
  assert.ok(runner.includes('copyFile(uninstaller, path, constants.COPYFILE_EXCL)'));
  assert.ok(runner.includes('sourcePath: uninstaller, path, ...copied'));
  assert.ok(runner.includes('cleanup[key] = parseProcessCount(result) === 0'));
  assert.ok(runner.includes('cleanup.uninstallReceipt = receiptSummary(result)'));
  assert.doesNotMatch(runner, /spawnSync\(\s*activeRun\.uninstaller|runProcess\(uninstaller,/u);
  const failure = runner.slice(runner.indexOf('async function recordFailure('), guard);
  assert.ok(failure.includes('activeRun.sourceHashesAfter = await readSourceHashes()'));
  assert.ok(failure.includes('sourceHashesBefore: activeRun.sourceHashesBefore'));
  assert.ok(failure.includes('sourceHashesAfter: activeRun.sourceHashesAfter'));
  assert.ok(failure.includes('no retry'));
  const spawnOptions = harness.match(/const child = spawn\(executable, args, \{([\s\S]*?)\n    \}\);/u);
  assert.ok(spawnOptions, 'Expected the existing runProcess spawn options');
  assert.match(spawnOptions[1], /windowsVerbatimArguments:\s*options\.windowsVerbatimArguments(?:\s*\?\?\s*false)?/u,
    'Parent must forward options.windowsVerbatimArguments to spawn before the full NSIS run');
});

test('updater cache cleanup removes only the UUID-owned matching installer and empty directory', async () => {
  await withTemporaryDirectory(async (root) => {
    const cache = join(root, `autovision-spi05-${exampleRunId}-updater`);
    await mkdir(cache);
    await writeFile(join(cache, 'installer.exe'), 'known installer');
    const expected = (await inventoryDirectory(cache)).manifest;
    const installer = expected.files[0];
    await removeUpdaterCache(cache, exampleRunId, installer, expected);
    assert.equal(existsSync(cache), false);
    await removeUpdaterCache(cache, exampleRunId, installer, expected);
  });
});

test('updater cache cleanup retains unknown paths, changed installers and additional files', async () => {
  await withTemporaryDirectory(async (root) => {
    const cache = join(root, `autovision-spi05-${exampleRunId}-updater`);
    await mkdir(cache);
    const installerPath = join(cache, 'installer.exe');
    await writeFile(installerPath, 'known installer');
    const expected = (await inventoryDirectory(cache)).manifest;
    const installer = expected.files[0];
    await assert.rejects(removeUpdaterCache(cache, otherRunId, installer, expected), /does not belong/u);
    await assert.rejects(removeUpdaterCache(cache, exampleRunId, { ...installer, sha256: '0'.repeat(64) }, expected), /identity differs/u);
    await writeFile(installerPath, 'other installer');
    await assert.rejects(removeUpdaterCache(cache, exampleRunId, installer, expected), /SHA-256 differs/u);
    assert.equal(await readFile(installerPath, 'utf8'), 'other installer');
    await writeFile(installerPath, 'known installer');
    await writeFile(join(cache, 'unknown.txt'), 'must survive');
    await assert.rejects(removeUpdaterCache(cache, exampleRunId, installer, expected), /file count differs/u);
    assert.equal(await readFile(installerPath, 'utf8'), 'known installer');
    assert.equal(await readFile(join(cache, 'unknown.txt'), 'utf8'), 'must survive');
  });
});

test('updater cache final rmdir cannot recursively erase an unexpected directory', async () => {
  await withTemporaryDirectory(async (root) => {
    const cache = join(root, `autovision-spi05-${exampleRunId}-updater`);
    await mkdir(cache);
    await writeFile(join(cache, 'installer.exe'), 'known installer');
    const expected = (await inventoryDirectory(cache)).manifest;
    // Empty directories are not in the file manifest: exercise the final removal boundary.
    await mkdir(join(cache, 'new-directory'));
    await assert.rejects(removeUpdaterCache(cache, exampleRunId, expected.files[0], expected),
      (error) => ['ENOTEMPTY', 'EEXIST'].includes(error.code));
    assert.deepEqual(await readdir(cache), ['new-directory']);
    assert.equal(existsSync(join(cache, 'new-directory')), true);
  });
});
