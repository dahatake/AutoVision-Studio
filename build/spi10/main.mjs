import { app, BrowserWindow } from 'electron';
import { writeFile } from 'node:fs/promises';

app.commandLine.appendSwitch('disable-background-timer-throttling');

try {
  await app.whenReady();
  const window = new BrowserWindow({
    width: 1100,
    height: 700,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  await window.loadFile(new URL('./dist/index.html', import.meta.url).pathname);
  const result = await window.webContents.executeJavaScript('window.runSpi10Benchmark()');
  const gpu = await app.getGPUInfo('basic');
  const output = JSON.stringify({
    status: 'ok',
    versions: process.versions,
    gpuFeatureStatus: app.getGPUFeatureStatus(),
    gpu,
    result,
  }, null, 2);
  await writeFile(new URL('./benchmark-result.json', import.meta.url), output, 'utf8');
  window.destroy();
  app.exit(0);
} catch (error) {
  await writeFile(new URL('./benchmark-error.json', import.meta.url), JSON.stringify({
    status: 'error',
    name: error instanceof Error ? error.name : 'UnknownError',
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : null,
  }, null, 2), 'utf8');
  app.exit(1);
}
