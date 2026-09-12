/// <reference types="vite/client" />

import fs from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { app, BrowserWindow, dialog, ipcMain, protocol, screen, type BrowserWindowConstructorOptions, type IpcMain } from 'electron';

import { MAX_SCAN_RESULT_BYTES } from '../shared/contracts/import.js';
import { initializeAppLifecycle, type WindowPort } from './app-lifecycle.js';
import { createImportService, type ImportService } from './data/import-service.js';
import { createImageProtocol, SCHEME } from './data/image-protocol.js';
import { migrateDatabaseWithBackup } from './db/backup.js';
import { openDatabase, type DatabaseConnection } from './db/database.js';
import type { Migration } from './db/migrate.js';
import coreSql from './db/migrations/001_core.sql?raw';
import importSql from './db/migrations/003_import.sql?raw';
import jobsSql from './db/migrations/002_jobs.sql?raw';
import importGenerationSql from './db/migrations/004_import_generation.sql?raw';
import importRightsSql from './db/migrations/005_import_rights.sql?raw';
import annotationsSql from './db/migrations/006_annotations.sql?raw';
import annotationTargetHistorySql from './db/migrations/007_annotation_target_history.sql?raw';
import { createDiagnosticsService } from './diagnostics/diagnostics-service.js';
import { registerAnnotationHandlers } from './ipc/annotation-handlers.js';
import { registerDiagnosticExportHandler, registerDiagnosticsHandlers } from './ipc/diagnostics-handlers.js';
import { registerImportHandlers } from './ipc/import-handlers.js';
import { registerJobHandlers } from './ipc/job-handlers.js';
import { registerLabelSchemaHandlers } from './ipc/label-schema-handlers.js';
import { registerProjectHandlers } from './ipc/project-handlers.js';
import { createJobService, type JobService } from './jobs/job-service.js';
import { recoverJobs } from './jobs/recover-jobs.js';
import { createDiagnosticExporter } from './logging/diagnostic-export.js';
import { getAppPaths } from './paths.js';
import { getProjects, recoverProject } from './projects/project-service.js';
import { registerImageScheme } from './security.js';
import { createMainWindow as createSecureMainWindow } from './window.js';

const mainBundleDirectory = dirname(fileURLToPath(import.meta.url));
const preloadPath = resolve(mainBundleDirectory, '../preload/index.cjs');
const rendererEntryPath = resolve(mainBundleDirectory, '../renderer/index.html');
const expectedRendererURL = pathToFileURL(rendererEntryPath).href;
// SCAN operational watchdog/resource ceilings, not a requirement, HPO budget,
// or throughput/completion guarantee. No model/health startup is authorized.
const SCAN_OPERATIONAL_POLICY = Object.freeze({
  timeoutMs: 86_400_000,
  cancelGraceMs: 5_000,
  closeTimeoutMs: 10_000,
  maxStdoutBytes: 67_108_864,
  maxManifestBytes: MAX_SCAN_RESULT_BYTES, // 256 MiB, existing scan-result bound.
});
const migrations: readonly Migration[] = [
  { version: 1, sql: coreSql },
  { version: 2, sql: jobsSql },
  { version: 3, sql: importSql },
  { version: 4, sql: importGenerationSql },
  { version: 5, sql: importRightsSql },
  { version: 6, sql: annotationsSql },
  { version: 7, sql: annotationTargetHistorySql },
];
const recoveryWarning = '旧保存場所の回収を確認できないProjectがあります。現在の保存先を保持しています。移動をやり直さず、明示的な復旧で確認してください。';
const failures = {
  MAIN_STARTUP_FAILED: 'データの初期化を完了できないため、起動を中止します。ファイルの削除や自動再試行は行いません。',
  MAIN_WINDOW_FAILED: '画面を開けないため、アプリを終了します。',
  MAIN_SHUTDOWN_FAILED: '終了処理を確認できませんでした。ファイルの削除や自動再試行は行っていません。状態を確認してください。',
} as const;

function reportFailure(code: keyof typeof failures): void {
  const message = `${failures[code]}\nエラーコード: ${code}`;
  console.error(message);
  try { dialog.showErrorBox('AutoVision Studio', message); }
  catch { console.error('MAIN_ERROR_DIALOG_FAILED: エラー通知を表示できませんでした。'); }
}

function startPrimaryInstance(): void {
  let database: DatabaseConnection | undefined;
  let jobService: JobService | undefined;
  let imageReader: ReturnType<typeof createImageProtocol> | undefined;
  let ownsImageHandler = false;
  let imageDrain: Promise<void> = Promise.resolve();
  let initialized = false;
  let shuttingDown = false;
  let allowQuit = false;
  let disposalFailed = false;
  let startup: Promise<void> = Promise.resolve();
  const inFlight = new Set<Promise<unknown>>();
  const windowDisposers = new Set<() => void>();

  // The lifecycle has an already-queued, synchronous ensureWindow callback.
  // On failure/shutdown only this inert port is returned: no native window,
  // fallback database or permanently pending readiness Promise is created.
  const stoppedWindow: WindowPort = {
    isMinimized: () => false,
    restore: () => undefined,
    focus: () => undefined,
  };

  function stop(): void {
    if (shuttingDown) return;
    shuttingDown = true;
    initialized = false;
    // Close admission/abort reads even if native unhandle fails. Observe any
    // rejection immediately; never let it skip worker shutdown or close the DB.
    try {
      imageDrain = Promise.resolve(imageReader?.dispose()).catch(() => { disposalFailed = true; });
    } catch { disposalFailed = true; }
    if (ownsImageHandler) {
      try { protocol.unhandle(SCHEME); ownsImageHandler = false; }
      catch { disposalFailed = true; }
    }
    for (const dispose of [...windowDisposers]) {
      try { dispose(); } catch { disposalFailed = true; }
    }
    // Defer reading startup until its assignment has completed. Never await
    // this drain from startup's catch, which would wait on itself.
    void Promise.resolve().then(async () => {
      await startup;
      await Promise.allSettled([...inFlight]);
      // Always stop owned workers, even if window/IPC disposal failed. A rejected
      // shutdown cannot confirm termination and must leave the database open.
      const stopped = await Promise.allSettled([imageDrain,
        Promise.resolve().then(() => jobService?.shutdown())]);
      if (stopped.some((result) => result.status === 'rejected')) throw new Error('MAIN_SERVICE_STOP_FAILED');
      if (disposalFailed) throw new Error('MAIN_HANDLER_DISPOSAL_FAILED');
      if (database !== undefined) {
        database.close(); // A single attempt, only after every admitted writer settles.
        if (database.open) throw new Error('MAIN_DATABASE_CLOSE_UNCONFIRMED');
      }
      allowQuit = true;
      app.quit();
    }).catch(() => reportFailure('MAIN_SHUTDOWN_FAILED'));
  }

  function failWindow(): void {
    if (shuttingDown) return;
    stop();
    reportFailure('MAIN_WINDOW_FAILED');
  }

  function whileRunning(listener: () => void): () => void {
    return () => {
      if (!initialized || shuttingDown) return;
      try { listener(); } catch { failWindow(); }
    };
  }

  function createAppWindow(connection: DatabaseConnection,
    trustedMain: Parameters<typeof registerProjectHandlers>[4],
    diagnosticsConfig: Parameters<typeof createDiagnosticsService>[0], logDirectory: string,
    imports: ImportService, importConfig: Parameters<typeof registerImportHandlers>[5]): WindowPort {
    if (!initialized || shuttingDown) return stoppedWindow;
    let constructed: BrowserWindow | undefined;
    class ProjectWindow extends BrowserWindow {
      constructor(options: BrowserWindowConstructorOptions) {
        super(options);
        constructed = this;
        if (shuttingDown) throw new Error('MAIN_WINDOW_STOPPED');
        const ownedChannels = new Set<string>();
        let registration: ReturnType<typeof registerProjectHandlers> | undefined;
        let diagnosticsRegistration: ReturnType<typeof registerDiagnosticsHandlers> | undefined;
        let exportRegistration: ReturnType<typeof registerDiagnosticExportHandler> | undefined;
        let jobRegistration: ReturnType<typeof registerJobHandlers> | undefined;
        let importRegistration: ReturnType<typeof registerImportHandlers> | undefined;
        let labelSchemaRegistration: ReturnType<typeof registerLabelSchemaHandlers> | undefined;
        let annotationRegistration: ReturnType<typeof registerAnnotationHandlers> | undefined;
        let exporter: ReturnType<typeof createDiagnosticExporter> | undefined;
        let diagnosticsService: ReturnType<typeof createDiagnosticsService> | undefined;
        let disposed = false;
        const trackedIpc: Pick<IpcMain, 'handle' | 'removeHandler'> = {
          handle: (channel, listener) => {
            if (disposed || shuttingDown) throw new Error('MAIN_WINDOW_STOPPED');
            ipcMain.handle(channel, (event, ...args: unknown[]) => {
              if (disposed || shuttingDown) throw new Error('MAIN_IPC_UNAVAILABLE: 操作の受付は終了しています。');
              // Track BEFORE invoking even a synchronous handler: native dialogs
              // and other callbacks can re-enter before-quit during that call.
              const request = Promise.withResolvers<unknown>();
              inFlight.add(request.promise);
              void request.promise.then(
                () => { inFlight.delete(request.promise); },
                () => { inFlight.delete(request.promise); },
              ); // Observe rejection without an unhandled .finally() side-Promise.
              try { request.resolve(listener(event, ...args)); }
              catch { request.reject(new Error('MAIN_IPC_FAILED: 操作を完了できませんでした。')); }
              return request.promise;
            });
            ownedChannels.add(channel); // A conflicting handler still belongs to its owner.
          },
          removeHandler: (channel) => {
            if (!ownedChannels.has(channel)) return;
            ipcMain.removeHandler(channel);
            ownedChannels.delete(channel);
          },
        };
        const dispose = () => {
          if (disposed) return;
          disposed = true;
          windowDisposers.delete(dispose);
          this.removeListener('closed', dispose);
          this.webContents.removeListener('destroyed', dispose);
          try { registration?.dispose(); } catch { disposalFailed = true; }
          try { diagnosticsRegistration?.dispose(); } catch { disposalFailed = true; }
          try { exportRegistration?.dispose(); } catch { disposalFailed = true; }
          try { jobRegistration?.dispose(); } catch { disposalFailed = true; }
          try { importRegistration?.dispose(); } catch { disposalFailed = true; }
          try { labelSchemaRegistration?.dispose(); } catch { disposalFailed = true; }
          try { annotationRegistration?.dispose(); } catch { disposalFailed = true; }
          try { exporter?.dispose(); } catch { disposalFailed = true; }
          // Reject pending diagnostics and request stop; this does not confirm
          // child exit. The diagnostic worker does not own the Project database.
          try { diagnosticsService?.dispose(); } catch { disposalFailed = true; }
          // Also cover a constructor/partial-registration failure. Never remove
          // a channel for which our own handle call did not succeed.
          for (const channel of [...ownedChannels]) {
            try { trackedIpc.removeHandler(channel); } catch { disposalFailed = true; }
          }
          if (disposalFailed) stop();
        };
        try {
          diagnosticsService = createDiagnosticsService(diagnosticsConfig);
          registration = registerProjectHandlers(trackedIpc, this.webContents, expectedRendererURL,
            connection, trustedMain, dialog);
          diagnosticsRegistration = registerDiagnosticsHandlers(trackedIpc, this.webContents,
            expectedRendererURL, diagnosticsService);
          exporter = createDiagnosticExporter(logDirectory, {
            showMessageBox: (options) => dialog.showMessageBox(this, options),
          });
          exportRegistration = registerDiagnosticExportHandler(trackedIpc, this.webContents,
            expectedRendererURL, diagnosticsService, exporter);
          if (!jobService || shuttingDown) throw new Error('MAIN_WINDOW_STOPPED');
          jobRegistration = registerJobHandlers(trackedIpc, this.webContents, expectedRendererURL, jobService);
          importRegistration = registerImportHandlers(trackedIpc, this.webContents, expectedRendererURL,
            connection, imports, importConfig, dialog);
          labelSchemaRegistration = registerLabelSchemaHandlers(trackedIpc, this.webContents,
            expectedRendererURL, connection);
          annotationRegistration = registerAnnotationHandlers(trackedIpc, this.webContents,
            expectedRendererURL, connection);
          if (shuttingDown) throw new Error('MAIN_WINDOW_STOPPED');
          this.once('closed', dispose);
          this.webContents.once('destroyed', dispose);
          windowDisposers.add(dispose);
        } catch (error) {
          dispose();
          throw error;
        }
      }
    }
    try {
      return createSecureMainWindow({
        BrowserWindow: ProjectWindow,
        preloadPath,
        rendererEntryPath,
        workArea: screen.getPrimaryDisplay().workArea,
        onLoadError: () => failWindow(),
      });
    } catch {
      failWindow();
      // A constructed but unsecured/unregistered window must not survive.
      try { if (constructed && !constructed.isDestroyed()) constructed.destroy(); }
      catch { reportFailure('MAIN_WINDOW_FAILED'); }
      return stoppedWindow;
    }
  }

  // Installed immediately after the real single-instance lock, including while
  // Electron ready, backup or recovery is pending. A failed close keeps this
  // guard closed; repeated events cannot retry close or force an exit.
  app.on('before-quit', (event) => {
    if (allowQuit) return;
    event.preventDefault();
    stop();
  });

  startup = (async () => {
    registerImageScheme(protocol);
    await app.whenReady();
    if (shuttingDown) return;
    const paths = getAppPaths(app.getPath('userData'));
    const receiptDirectory = join(paths.userData, 'project-moves');
    const backupDirectory = join(paths.userData, 'backups');
    const jobDirectory = join(paths.cache, 'jobs'); // Main-owned root, not a registered Project.
    const selectionDirectory = join(paths.cache, 'import-selections');
    for (const directory of [paths.userData, paths.projects, paths.cache, paths.logs, receiptDirectory, backupDirectory, jobDirectory, selectionDirectory]) {
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    }
    database = openDatabase(join(paths.userData, 'metadata.sqlite3'));
    const connection = database;
    await migrateDatabaseWithBackup(connection, migrations, backupDirectory);
    if (shuttingDown) return;
    let pendingRecovery = false;
    for (const project of getProjects(connection)) {
      if (shuttingDown) return;
      const result = await recoverProject(connection, project.id, receiptDirectory);
      if (shuttingDown) return;
      if (result.cleanupStatus === 'source-retained' || result.cleanupError?.code === 'PROJECT_SOURCE_CLEANUP_FAILED') {
        pendingRecovery = true;
      }
    }
    if (pendingRecovery) {
      console.warn(`MAIN_PROJECT_RECOVERY_PENDING: ${recoveryWarning}`);
      dialog.showMessageBoxSync({ type: 'warning', title: 'AutoVision Studio', message: recoveryWarning });
    }
    if (shuttingDown) return;
    recoverJobs(connection); // Existing rows only; never start, resume or enqueue work.
    if (shuttingDown) return;
    const trustedMain = Object.freeze({ receiptDirectory, protectedRoots: Object.freeze([
      app.isPackaged ? process.resourcesPath : resolve(mainBundleDirectory, '../../resources'),
      jobDirectory,
      selectionDirectory,
    ]) });
    const workerDirectory = app.isPackaged
      ? join(process.resourcesPath, 'worker') : resolve(mainBundleDirectory, '../../ml');
    const diagnosticsConfig = Object.freeze({
      executablePath: app.isPackaged ? join(workerDirectory, 'autovision-worker.exe')
        : join(workerDirectory, '.venv', 'Scripts', 'python.exe'),
      argsPrefix: Object.freeze(app.isPackaged ? [] : ['-m', 'autovision_ml.cli']),
      cwd: workerDirectory,
      diskPath: paths.userData,
    });
    if (shuttingDown) return;
    jobService = createJobService(connection, Object.freeze({
      executablePath: diagnosticsConfig.executablePath,
      argsPrefix: diagnosticsConfig.argsPrefix,
      taskRoot: jobDirectory,
      policy: SCAN_OPERATIONAL_POLICY,
    }));
    if (shuttingDown) return;
    // App-lifetime, lazy service; capacity checks must use the actual DB volume.
    const imports = createImportService(connection, jobService, Object.freeze({
      taskRoot: jobDirectory, metadataDirectory: paths.userData, protectedRoots: trustedMain.protectedRoots,
    }));
    const importConfig = Object.freeze({ selectionDirectory });
    if (shuttingDown) return;
    // Global protocol targets defaultSession, also used by our unpartitioned
    // loadFile window. No source reads or processing occur at registration.
    imageReader = createImageProtocol(connection);
    const reader = imageReader;
    protocol.handle(SCHEME, (request) => shuttingDown
      ? new Response(null, { status: 503 }) : reader.handle(request));
    ownsImageHandler = true; // A failed/conflicting handle belongs to someone else.
    if (shuttingDown) return;
    initialized = true;
    initializeAppLifecycle({
      app: {
        requestSingleInstanceLock: () => true, // The real lock was already acquired, exactly once.
        quit: stop,
        whenReady: () => Promise.resolve(), // Initialization has succeeded, not a swallowed rejection.
        onSecondInstance: (listener) => { app.on('second-instance', whileRunning(listener)); },
        onActivate: (listener) => { app.on('activate', whileRunning(listener)); },
        onWindowAllClosed: (listener) => { app.on('window-all-closed', whileRunning(listener)); },
      },
      createWindow: () => createAppWindow(connection, trustedMain, diagnosticsConfig, paths.logs, imports, importConfig),
      getWindows: () => {
        if (shuttingDown) return [];
        try { return BrowserWindow.getAllWindows(); } catch { failWindow(); return []; }
      },
      platform: process.platform,
    });
  })().catch(() => {
    stop();
    reportFailure('MAIN_STARTUP_FAILED');
  });
}

if (app.requestSingleInstanceLock()) startPrimaryInstance();
else app.quit();