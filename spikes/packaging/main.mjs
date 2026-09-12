import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { app } from 'electron';

import {
  compareInventories,
  inventoryDirectory,
  isolatedWorkerEnvironment,
  runWorkerSuite,
  validateInventory,
} from './harness.mjs';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function main() {
  if (!app.isPackaged) throw new Error('SPI-05 smoke must run from the installed package');
  const resultPath = process.env.AUTOVISION_SPI05_RESULT;
  const temporaryRoot = process.env.AUTOVISION_SPI05_TEMP;
  if (!resultPath || !temporaryRoot) {
    throw new Error('SPI-05 result and temporary paths are required');
  }
  mkdirSync(join(temporaryRoot, 'user-data'), { recursive: true });
  mkdirSync(join(temporaryRoot, 'session-data'), { recursive: true });
  app.setPath('userData', join(temporaryRoot, 'user-data'));
  app.setPath('sessionData', join(temporaryRoot, 'session-data'));
  await app.whenReady();

  const workerRoot = join(process.resourcesPath, 'worker');
  const manifestPath = join(process.resourcesPath, 'spi05', 'source-worker-manifest.json');
  const sourceBytes = await readFile(manifestPath);
  const sourceManifest = validateInventory(JSON.parse(sourceBytes.toString('utf8')));
  const installed = await inventoryDirectory(workerRoot);
  compareInventories(sourceManifest, installed.manifest);
  const runtimeRoot = join(temporaryRoot, 'worker-runtime');
  await mkdir(runtimeRoot, { recursive: true });
  const runtime = await runWorkerSuite(workerRoot, runtimeRoot);
  const environment = isolatedWorkerEnvironment(workerRoot, runtimeRoot);
  const evidence = {
    schemaVersion: 1,
    status: 'ok',
    verdict: 'PASS',
    packaged: app.isPackaged,
    processResourcesPath: process.resourcesPath,
    workerRoot,
    sourceManifest: {
      byteSize: sourceBytes.length,
      sha256: sha256(sourceBytes),
      fileCount: sourceManifest.fileCount,
      totalBytes: sourceManifest.totalBytes,
    },
    installedManifest: {
      byteSize: installed.bytes.length,
      sha256: installed.sha256,
      fileCount: installed.manifest.fileCount,
      totalBytes: installed.manifest.totalBytes,
    },
    runtime,
    environmentKeys: Object.keys(environment).sort(),
    versions: {
      electron: process.versions.electron,
      node: process.versions.node,
      chrome: process.versions.chrome,
    },
  };
  await writeFile(resultPath, `${JSON.stringify(evidence, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
}

// ESM evaluation must complete before ready; awaiting main here deadlocks ready.
void main().then(() => app.exit(0)).catch(async (error) => {
  const resultPath = process.env.AUTOVISION_SPI05_RESULT;
  if (resultPath) {
    const failure = {
      schemaVersion: 1,
      status: 'error',
      verdict: 'FAIL',
      name: error instanceof Error ? error.name : 'UnknownError',
      message: error instanceof Error ? error.message : String(error),
    };
    await writeFile(resultPath, `${JSON.stringify(failure, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    }).catch(() => undefined);
  }
  console.error('SPI-05 installed smoke failed:', error instanceof Error ? error.message : String(error));
  app.exit(1);
});
