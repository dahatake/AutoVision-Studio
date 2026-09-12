// @vitest-environment node
import childProcess from 'node:child_process';
import type {
  BaseWindow, BrowserWindowConstructorOptions, IpcMain, IpcMainInvokeEvent, Protocol,
  MessageBoxOptions, MessageBoxReturnValue, MessageBoxSyncOptions, OpenDialogOptions, OpenDialogReturnValue, WebContents, WebFrameMain,
} from 'electron';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import asyncFs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock, type MockInstance } from 'vitest';

import { hardwareDiagnosticsSchema, type HardwareDiagnostics } from '../shared/contracts/diagnostics.js';
import { DIAGNOSTIC_EXPORT_CHANNEL, diagnosticExportResultSchema } from '../shared/contracts/diagnostic-export.js';
import { MAX_SCAN_RESULT_BYTES } from '../shared/contracts/import.js';
import { IMPORT_START_CHANNEL, IMPORT_PREVIEW_CHANNEL, IMPORT_COMMIT_CHANNEL, IMPORT_DISCARD_CHANNEL,
  importStartResponseSchema } from '../shared/contracts/import-ipc.js';
import type { ImportService } from './data/import-service.js';
import type { createImageProtocol } from './data/image-protocol.js';
import {
  JOB_LIST_CHANNEL, JOB_GET_CHANNEL, JOB_CANCEL_CHANNEL, JOB_SUBSCRIBE_CHANNEL,
  JOB_UNSUBSCRIBE_CHANNEL, JOB_CHANGED_CHANNEL, jobSubscribeResponseSchema,
} from '../shared/contracts/job-ipc.js';
import type { Project } from '../shared/contracts/project.js';
import {
  PROJECT_CREATE_CHANNEL, PROJECT_GET_CHANNEL, PROJECT_LIST_CHANNEL, PROJECT_MOVE_CHANNEL,
  PROJECT_PICK_PARENT_CHANNEL, PROJECT_RECOVER_CHANNEL, PROJECT_UPDATE_CHANNEL,
  projectCreateResponseSchema, projectPickParentResponseSchema,
} from '../shared/contracts/project-ipc.js';
import {
  LABEL_GET_CHANNEL, LABEL_CREATE_CHANNEL, LABEL_CREATE_CLASS_CHANNEL, LABEL_UPDATE_CLASS_CHANNEL,
  LABEL_UPDATE_CHANNEL, LABEL_DELETE_CLASS_CHANNEL, LABEL_MERGE_CLASSES_CHANNEL,
  ANNOTATION_WORKSPACES_CHANNEL, ANNOTATION_LIST_CHANNEL, ANNOTATION_GET_CHANNEL,
  ANNOTATION_SAVE_CHANNEL, ANNOTATION_CONFIRM_CHANNEL,
} from '../shared/contracts/annotation-ipc.js';
import type { DatabaseConnection } from './db/database.js';
import type { Migration } from './db/migrate.js';
import type { createDiagnosticsService } from './diagnostics/diagnostics-service.js';
import type { JobService } from './jobs/job-service.js';
import type { WorkerResult } from './jobs/worker-supervisor.js';

const electronState = vi.hoisted(() => ({ current: undefined as Harness | undefined }));

// Electron's native boundary and diagnostic/import service factories are replaced;
// Project/job storage and all IPC handlers remain real. No Python/model is started.
// Electron delegates even when Vitest retains a mocked module export.
vi.mock('electron', () => ({
  app: {
    requestSingleInstanceLock: () => current().lock(),
    whenReady: () => current().whenReady(),
    getPath: (name: string) => current().getPath(name),
    get isPackaged() { return current().packaged; },
    on: (event: string, listener: (...args: unknown[]) => void) => current().on(event, listener),
    quit: () => current().quit(),
  },
  BrowserWindow: TestBrowserWindow,
  dialog: {
    showOpenDialog: (options: OpenDialogOptions | BaseWindow, secondary?: OpenDialogOptions) =>
      current().showOpenDialog(options, secondary),
    showMessageBoxSync: (options: MessageBoxSyncOptions) => current().showMessageBoxSync(options),
    showMessageBox: (window: BaseWindow, options: MessageBoxOptions) => current().showMessageBox(window, options),
    showErrorBox: (title: string, content: string) => current().showErrorBox(title, content),
  },
  ipcMain: {
    handle: (channel: string, listener: Parameters<IpcMain['handle']>[1]) => current().handle(channel, listener),
    removeHandler: (channel: string) => current().removeHandler(channel),
  },
  protocol: {
    registerSchemesAsPrivileged: (...args: Parameters<Protocol['registerSchemesAsPrivileged']>) => current().registerSchemes(...args),
    handle: (...args: Parameters<Protocol['handle']>) => current().protocolHandle(...args),
    unhandle: (...args: Parameters<Protocol['unhandle']>) => current().protocolUnhandle(...args),
  },
  screen: { getPrimaryDisplay: () => current().getPrimaryDisplay() },
}));

const projectChannels = [PROJECT_LIST_CHANNEL, PROJECT_GET_CHANNEL, PROJECT_CREATE_CHANNEL, PROJECT_UPDATE_CHANNEL,
  PROJECT_PICK_PARENT_CHANNEL, PROJECT_MOVE_CHANNEL, PROJECT_RECOVER_CHANNEL];
const diagnosticsChannel = 'diagnostics:collect';
const jobChannels = [JOB_LIST_CHANNEL, JOB_GET_CHANNEL, JOB_CANCEL_CHANNEL, JOB_SUBSCRIBE_CHANNEL, JOB_UNSUBSCRIBE_CHANNEL];
const importChannels = [IMPORT_START_CHANNEL, IMPORT_PREVIEW_CHANNEL, IMPORT_COMMIT_CHANNEL, IMPORT_DISCARD_CHANNEL];
const labelChannels = [LABEL_GET_CHANNEL, LABEL_CREATE_CHANNEL, LABEL_CREATE_CLASS_CHANNEL,
  LABEL_UPDATE_CLASS_CHANNEL, LABEL_UPDATE_CHANNEL, LABEL_DELETE_CLASS_CHANNEL, LABEL_MERGE_CLASSES_CHANNEL];
const annotationChannels = [ANNOTATION_WORKSPACES_CHANNEL, ANNOTATION_LIST_CHANNEL, ANNOTATION_GET_CHANNEL,
  ANNOTATION_SAVE_CHANNEL, ANNOTATION_CONFIRM_CHANNEL];
const channels = [...projectChannels, diagnosticsChannel, DIAGNOSTIC_EXPORT_CHANNEL, ...jobChannels, ...importChannels, ...labelChannels, ...annotationChannels];
// Native destruction first invokes each handler's own earlier listener. On an
// ordinary close/quit, Main instead disposes registrations in registration order.
const destroyedChannels = [...projectChannels, DIAGNOSTIC_EXPORT_CHANNEL, ...jobChannels, ...importChannels, ...labelChannels, ...annotationChannels, diagnosticsChannel];
const diagnosticsFailure = { message: 'Hardware diagnostics unavailable.', code: 'DIAGNOSTICS_UNAVAILABLE' };
type DiagnosticsService = ReturnType<typeof createDiagnosticsService>;
type DiagnosticFake = { collect: Mock<DiagnosticsService['collect']>; dispose: Mock<DiagnosticsService['dispose']> };
type ObservedJobs = JobService & { shutdown: Mock<JobService['shutdown']>; startScan: Mock<JobService['startScan']> };
type ObservedImports = { [Key in keyof ImportService]: Mock<ImportService[Key]> };

function diagnosticsReport(partial = false): HardwareDiagnostics {
  // Synthetic observations, parsed by the actual schema, never production defaults.
  return hardwareDiagnosticsSchema.parse({
    schemaVersion: 1, command: 'probe-hardware', status: partial ? 'partial' : 'ok',
    os: { status: 'ok', data: { name: 'Windows', major: 10, minor: 0, build: 1,
      productType: 1, architecture: 'synthetic' }, error: null },
    cpu: { status: 'ok', data: { logicalCount: 2, name: 'Synthetic CPU' }, error: null },
    memory: { status: 'ok', data: { totalBytes: 100, availableBytes: 50, loadPercent: 50 }, error: null },
    disk: { status: 'ok', data: { totalBytes: 100, usedBytes: 40, freeBytes: 60 }, error: null },
    gpu: { status: 'ok', data: { adapters: [], scope: 'current-session-display-adapters',
      computeStatus: 'not_checked' }, error: null },
    onnxRuntime: { status: 'ok', data: { version: 'synthetic', providers: [],
      executionStatus: 'not_checked' }, error: null },
    cuda: partial ? { status: 'error', data: null, error: { code: 'cuda-probe-failed', causeType: 'ImportError' } }
      : { status: 'ok', data: { torchVersion: 'synthetic', runtimeVersion: null, available: false,
        scope: 'torch-runtime-only', executionStatus: 'not_checked', physicalGpuPresence: null }, error: null },
    camera: { status: 'deferred', streamOpened: false, reasonCode: 'check-on-inference-start' },
  });
}

const coreSql = fs.readFileSync(new URL('./db/migrations/001_core.sql', import.meta.url), 'utf8');
const jobsSql = fs.readFileSync(new URL('./db/migrations/002_jobs.sql', import.meta.url), 'utf8');
const importSql = fs.readFileSync(new URL('./db/migrations/003_import.sql', import.meta.url), 'utf8');
const importGenerationSql = fs.readFileSync(new URL('./db/migrations/004_import_generation.sql', import.meta.url), 'utf8');
const importRightsSql = fs.readFileSync(new URL('./db/migrations/005_import_rights.sql', import.meta.url), 'utf8');
const annotationsSql = fs.readFileSync(new URL('./db/migrations/006_annotations.sql', import.meta.url), 'utf8');
const annotationTargetHistorySql = fs.readFileSync(new URL('./db/migrations/007_annotation_target_history.sql', import.meta.url), 'utf8');
const history: readonly Migration[] = [
  { version: 1, sql: coreSql }, { version: 2, sql: jobsSql }, { version: 3, sql: importSql },
  { version: 4, sql: importGenerationSql },
  { version: 5, sql: importRightsSql },
  { version: 6, sql: annotationsSql },
  { version: 7, sql: annotationTargetHistorySql },
];
const annotationTables = ['annotation_items', 'annotation_provenance', 'annotation_workspaces', 'dataset_items',
  'dataset_revisions', 'label_classes', 'label_schemas', 'workspace_revision_sources', 'annotation_target_history'];
const rendererEntryPath = fileURLToPath(new URL('../renderer/index.html', import.meta.url));
const rendererURL = pathToFileURL(rendererEntryPath).href;
const markerName = '.autovision-project.json';
const payloadBytes = Buffer.from([0, 255, 1, 128, 42]);
const warning = '旧保存場所の回収を確認できないProjectがあります。現在の保存先を保持しています。移動をやり直さず、明示的な復旧で確認してください。';
const failureMessages = {
  MAIN_STARTUP_FAILED: 'データの初期化を完了できないため、起動を中止します。ファイルの削除や自動再試行は行いません。',
  MAIN_WINDOW_FAILED: '画面を開けないため、アプリを終了します。',
  MAIN_SHUTDOWN_FAILED: '終了処理を確認できませんでした。ファイルの削除や自動再試行は行っていません。状態を確認してください。',
} as const;
const NativeDatabase = createRequire(import.meta.url)('better-sqlite3') as new (
  path: string, options: { readonly: boolean; fileMustExist: true },
) => DatabaseConnection;

class TestWebContents extends EventEmitter {
  readonly frame = { url: '' };
  readonly mainFrame = this.frame as WebFrameMain;
  url = '';
  destroyed = false;
  readonly getURL = vi.fn(() => this.url);
  readonly isDestroyed = vi.fn(() => this.destroyed);
  readonly send = vi.fn<WebContents['send']>();
  readonly setWindowOpenHandler = vi.fn<(handler: () => { action: 'deny' }) => void>();
}

class TestBrowserWindow extends EventEmitter {
  private readonly owner = current();
  readonly contents = new TestWebContents();
  readonly webContents = this.contents as unknown as WebContents;
  readonly options: BrowserWindowConstructorOptions;
  destroyed = false;
  readonly isDestroyed = vi.fn(() => this.destroyed);
  readonly isMinimized = vi.fn(() => false);
  readonly restore = vi.fn();
  readonly focus = vi.fn();
  static readonly getAllWindows = vi.fn(() => current().windows.filter((window) => !window.destroyed));
  readonly loadFile = vi.fn<(path: string) => Promise<void>>((path) => {
    this.contents.url = pathToFileURL(path).href;
    this.contents.frame.url = this.contents.url;
    this.owner.sequence.push('window:load');
    this.owner.loadObservations.push({
      path, channels: [...this.owner.handlers.keys()],
      navigationGuards: this.contents.listenerCount('will-navigate') + this.contents.listenerCount('will-frame-navigate'),
    });
    this.owner.loaded.resolve(this);
    return this.owner.loadResult ?? Promise.resolve();
  });
  readonly destroy = vi.fn(() => {
    if (this.destroyed) return;
    this.destroyed = true;
    this.contents.destroyed = true;
    this.contents.emit('destroyed');
    this.emit('closed');
    this.owner.sequence.push('window:destroy');
    // app.window-all-closed is controlled separately to observe the boundary
    // between a window's disposal and the application's shutdown policy.
  });
  constructor(options: BrowserWindowConstructorOptions) {
    super();
    this.options = options;
    this.owner.windows.push(this);
    this.owner.sequence.push('window:construct');
  }
}

interface Harness {
  root: string;
  userData: string;
  parent: string;
  destination: string;
  resources: string;
  databasePath: string;
  receiptDirectory: string;
  backupDirectory: string;
  packaged: boolean;
  imported: boolean;
  events: EventEmitter;
  sequence: string[];
  windows: TestBrowserWindow[];
  handlers: Map<string, Parameters<IpcMain['handle']>[1]>;
  loadObservations: { path: string; channels: string[]; navigationGuards: number }[];
  ready: PromiseWithResolvers<void>;
  loaded: PromiseWithResolvers<TestBrowserWindow>;
  terminal: PromiseWithResolvers<'quit' | 'shutdown-failed'>;
  finished: 'quit' | 'shutdown-failed' | undefined;
  loadResult: Promise<void> | undefined;
  releases: (() => void)[];
  tasks: Promise<unknown>[];
  monitors: DatabaseMonitor[];
  diagnostics: DiagnosticFake[];
  jobs: ObservedJobs[];
  imports: ObservedImports[];
  images: ReturnType<typeof createImageProtocol>[];
  protocolHandlers: Map<string, Parameters<Protocol['handle']>[1]>;
  registerSchemes: Mock<Protocol['registerSchemesAsPrivileged']>;
  protocolHandle: Mock<Protocol['handle']>;
  protocolUnhandle: Mock<Protocol['unhandle']>;
  configureDatabase: ((monitor: DatabaseMonitor) => void) | undefined;
  lock: Mock<() => boolean>;
  whenReady: Mock<() => Promise<void>>;
  getPath: Mock<(name: string) => string>;
  quit: Mock<() => void>;
  on: Mock<(event: string, listener: (...args: unknown[]) => void) => EventEmitter>;
  handle: Mock<IpcMain['handle']>;
  removeHandler: Mock<IpcMain['removeHandler']>;
  showOpenDialog: Mock<(options: OpenDialogOptions | BaseWindow, secondary?: OpenDialogOptions) => Promise<OpenDialogReturnValue>>;
  showMessageBoxSync: Mock<(options: MessageBoxSyncOptions) => number>;
  showMessageBox: Mock<(window: BaseWindow, options: MessageBoxOptions) => Promise<MessageBoxReturnValue>>;
  showErrorBox: Mock<(title: string, content: string) => void>;
  getPrimaryDisplay: Mock<() => { workArea: { x: number; y: number; width: number; height: number } }>;
}

function makeHarness(root: string): Harness {
  const state: Harness = {
    root, userData: join(root, 'app-data'), parent: join(root, 'Parent 日本語'),
    destination: join(root, 'Destination'), resources: join(root, 'resources'),
    databasePath: join(root, 'app-data', 'metadata.sqlite3'),
    receiptDirectory: join(root, 'app-data', 'project-moves'), backupDirectory: join(root, 'app-data', 'backups'),
    packaged: true, imported: false, events: new EventEmitter(), sequence: [],
    windows: [], handlers: new Map<string, Parameters<IpcMain['handle']>[1]>(),
    loadObservations: [],
    ready: Promise.withResolvers<void>(), loaded: Promise.withResolvers<TestBrowserWindow>(),
    terminal: Promise.withResolvers<'quit' | 'shutdown-failed'>(),
    finished: undefined,
    loadResult: undefined,
    releases: [], tasks: [], monitors: [], diagnostics: [], jobs: [], imports: [], images: [],
    protocolHandlers: new Map(),
    registerSchemes: vi.fn<Protocol['registerSchemesAsPrivileged']>(),
    protocolHandle: vi.fn<Protocol['handle']>(), protocolUnhandle: vi.fn<Protocol['unhandle']>(),
    configureDatabase: undefined,
    lock: vi.fn(() => true), whenReady: vi.fn<() => Promise<void>>(),
    getPath: vi.fn<(name: string) => string>(), quit: vi.fn<() => void>(),
    on: vi.fn<(event: string, listener: (...args: unknown[]) => void) => EventEmitter>(),
    handle: vi.fn<IpcMain['handle']>(), removeHandler: vi.fn<IpcMain['removeHandler']>(),
    showOpenDialog: vi.fn<(options: OpenDialogOptions | BaseWindow, secondary?: OpenDialogOptions) => Promise<OpenDialogReturnValue>>(),
    showMessageBoxSync: vi.fn<(options: MessageBoxSyncOptions) => number>(() => 0),
    showMessageBox: vi.fn<(window: BaseWindow, options: MessageBoxOptions) => Promise<MessageBoxReturnValue>>()
      .mockResolvedValue({ response: 0, checkboxChecked: false }),
    showErrorBox: vi.fn<(title: string, content: string) => void>(),
    getPrimaryDisplay: vi.fn(() => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } })),
  };
  state.registerSchemes.mockImplementation(() => { state.sequence.push('protocol:privileges'); });
  state.protocolHandle.mockImplementation((scheme, handler) => {
    if (state.protocolHandlers.has(scheme)) throw new Error('PRIVATE protocol conflict');
    state.protocolHandlers.set(scheme, handler); state.sequence.push('protocol:handle');
  });
  state.protocolUnhandle.mockImplementation((scheme) => {
    state.protocolHandlers.delete(scheme); state.sequence.push('protocol:unhandle');
  });
  state.whenReady.mockImplementation(() => { state.sequence.push('app:whenReady'); return state.ready.promise; });
  state.getPath.mockImplementation((name) => {
    if (name !== 'userData') throw new Error('Unexpected native path request');
    return state.userData;
  });
  state.on.mockImplementation((event, listener) => state.events.on(event, listener));
  state.handle.mockImplementation((channel, listener) => {
    if (state.handlers.has(channel)) throw new Error(`PRIVATE conflicting native handler ${root}`);
    state.handlers.set(channel, listener);
    state.sequence.push(`handle:${channel}`);
  });
  state.removeHandler.mockImplementation((channel) => {
    state.handlers.delete(channel);
    state.sequence.push(`remove:${channel}`);
  });
  state.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [state.parent] });
  state.showErrorBox.mockImplementation((_title, content) => {
    if (content.includes('MAIN_SHUTDOWN_FAILED')) {
      state.finished = 'shutdown-failed';
      state.terminal.resolve('shutdown-failed');
    }
  });
  state.quit.mockImplementation(() => {
    state.sequence.push('app:quit');
    const event = beforeQuit(state);
    if (event.defaultPrevented || state.finished === 'quit') return;
    for (const window of state.windows) window.destroy();
    state.events.emit('window-all-closed');
    state.events.emit('quit');
    state.finished = 'quit';
    state.terminal.resolve('quit');
  });
  return state;
}
function current(): Harness {
  if (!electronState.current) throw new Error('Missing isolated Electron test boundary');
  return electronState.current;
}
function beforeQuit(state = current()) {
  const event = { defaultPrevented: false, preventDefault: vi.fn<() => void>() };
  event.preventDefault.mockImplementation(() => { event.defaultPrevented = true; });
  state.events.emit('before-quit', event);
  return event;
}

async function loadModules() {
  const [database, backup, migration, paths, service, handlers, move, receipts, directory,
    diagnostics, diagnosticsHandlers, jobs, jobRecovery, jobHandlers, worker, imports, importHandlers, images] = await Promise.all([
    import('./db/database.js'), import('./db/backup.js'), import('./db/migrate.js'), import('./paths.js'),
    import('./projects/project-service.js'), import('./ipc/project-handlers.js'), import('./projects/project-move.js'),
    import('./projects/project-move-receipt.js'), import('./projects/project-directory.js'),
    import('./diagnostics/diagnostics-service.js'), import('./ipc/diagnostics-handlers.js'),
    import('./jobs/job-service.js'), import('./jobs/recover-jobs.js'), import('./ipc/job-handlers.js'),
    import('./jobs/worker-supervisor.js'),
    import('./data/import-service.js'), import('./ipc/import-handlers.js'),
    import('./data/image-protocol.js'),
  ]);
  return { database, backup, migration, paths, service, handlers, move, receipts, directory,
    diagnostics, diagnosticsHandlers, jobs, jobRecovery, jobHandlers, worker, imports, importHandlers, images };
}
interface DatabaseMonitor {
  database: DatabaseConnection;
  backup: Mock<DatabaseConnection['backup']>;
  exec: Mock<DatabaseConnection['exec']>;
  close: Mock<DatabaseConnection['close']>;
  nativeBackup: DatabaseConnection['backup'];
  nativeExec: DatabaseConnection['exec'];
  nativeClose: DatabaseConnection['close'];
  transactionsAtClose: boolean[];
}
function monitorDatabase(database: DatabaseConnection, state: Harness): DatabaseMonitor {
  const nativeBackup = database.backup.bind(database);
  const nativeExec = database.exec.bind(database);
  const nativeClose = database.close.bind(database);
  const transactionsAtClose: boolean[] = [];
  const backup = vi.spyOn(database, 'backup');
  const exec = vi.spyOn(database, 'exec');
  const close = vi.spyOn(database, 'close').mockImplementation(() => {
    transactionsAtClose.push(database.inTransaction);
    state.sequence.push('database:close');
    return nativeClose();
  });
  return { database, backup, exec, close, nativeBackup, nativeExec, nativeClose, transactionsAtClose };
}
function observeModules(modules: Awaited<ReturnType<typeof loadModules>>, state: Harness) {
  const actualOpen = modules.database.openDatabase;
  const actualMigrate = modules.backup.migrateDatabaseWithBackup;
  const actualRecover = modules.service.recoverProject;
  const actualRecoverJobs = modules.jobRecovery.recoverJobs;
  const actualCreateJobs = modules.jobs.createJobService;
  const actualCreateImages = modules.images.createImageProtocol;
  const open = vi.spyOn(modules.database, 'openDatabase').mockImplementation((path) => {
    const database = actualOpen(path);
    const monitor = monitorDatabase(database, state);
    state.monitors.push(monitor);
    state.sequence.push('database:open');
    state.configureDatabase?.(monitor);
    return database;
  });
  const migrate = vi.spyOn(modules.backup, 'migrateDatabaseWithBackup').mockImplementation(async (...args) => {
    state.sequence.push('migration:start');
    try { return await actualMigrate(...args); }
    finally { state.sequence.push('migration:settled'); }
  });
  const recover = vi.spyOn(modules.service, 'recoverProject').mockImplementation(async (...args) => {
    state.sequence.push(`recover:start:${String(args[1])}`);
    try { return await actualRecover(...args); }
    finally { state.sequence.push(`recover:settled:${String(args[1])}`); }
  });
  return { actualOpen, actualRecover, open, migrate, recover,
    createImages: vi.spyOn(modules.images, 'createImageProtocol').mockImplementation((database) => {
      const reader = actualCreateImages(database);
      const dispose = reader.dispose.bind(reader);
      vi.spyOn(reader, 'handle'); vi.spyOn(reader, 'dispose').mockImplementation(dispose);
      state.images.push(reader); state.sequence.push('images:create'); return reader;
    }),
    recoverJobs: vi.spyOn(modules.jobRecovery, 'recoverJobs').mockImplementation((database) => {
      state.sequence.push('jobs:recover');
      const result = actualRecoverJobs(database);
      state.sequence.push('jobs:recovered');
      return result;
    }),
    createJobs: vi.spyOn(modules.jobs, 'createJobService').mockImplementation((...args) => {
      const service = actualCreateJobs(...args);
      const jobs: ObservedJobs = { ...service, startScan: vi.fn(service.startScan),
        shutdown: vi.fn(async () => {
          state.sequence.push('jobs:shutdown');
          await service.shutdown();
          state.sequence.push('jobs:stopped');
        }) };
      state.jobs.push(jobs); state.sequence.push('jobs:create');
      return jobs;
    }),
    registerJobs: vi.spyOn(modules.jobHandlers, 'registerJobHandlers'),
    createImports: vi.spyOn(modules.imports, 'createImportService').mockImplementation(() => {
      const service: ObservedImports = {
        scan: vi.fn<ImportService['scan']>(() => { throw new Error('Unexpected import scan'); }),
        preview: vi.fn<ImportService['preview']>().mockRejectedValue(new Error('Unexpected import preview')),
        commit: vi.fn<ImportService['commit']>().mockRejectedValue(new Error('Unexpected import commit')),
        discard: vi.fn<ImportService['discard']>(),
      };
      state.imports.push(service); state.sequence.push('imports:create'); return service;
    }),
    registerImports: vi.spyOn(modules.importHandlers, 'registerImportHandlers'),
    startWorker: vi.spyOn(modules.worker, 'startWorkerJob').mockImplementation(() => {
      throw new Error('Unexpected worker start in Main wiring test');
    }),
    spawn: vi.spyOn(childProcess, 'spawn').mockImplementation(() => {
      throw new Error('Unexpected native spawn in Main wiring test');
    }),
    paths: vi.spyOn(modules.paths, 'getAppPaths'), getProjects: vi.spyOn(modules.service, 'getProjects'),
    register: vi.spyOn(modules.handlers, 'registerProjectHandlers'),
    createDiagnostics: vi.spyOn(modules.diagnostics, 'createDiagnosticsService').mockImplementation(() => {
      const diagnostic: DiagnosticFake = {
        collect: vi.fn<DiagnosticsService['collect']>().mockRejectedValue(new Error('PRIVATE synthetic diagnostic failure')),
        dispose: vi.fn<DiagnosticsService['dispose']>(() => { state.sequence.push('diagnostics:dispose'); }),
      };
      state.diagnostics.push(diagnostic);
      state.sequence.push('diagnostics:create');
      return diagnostic;
    }),
    registerDiagnostics: vi.spyOn(modules.diagnosticsHandlers, 'registerDiagnosticsHandlers'),
  };
}

let h: Harness;
let modules: Awaited<ReturnType<typeof loadModules>>;
let observed: ReturnType<typeof observeModules>;
let resourcesDescriptor: PropertyDescriptor | undefined;
let errors: MockInstance<typeof console.error>;
let warnings: MockInstance<typeof console.warn>;

function pause() {
  const reached = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<void>();
  h.releases.push(() => gate.resolve());
  return { reached: reached.promise, release: () => gate.resolve(), hold: async () => { reached.resolve(); await gate.promise; } };
}
function pendingLoad() {
  const load = Promise.withResolvers<void>();
  h.releases.push(() => load.resolve());
  h.loadResult = load.promise;
  return load;
}
async function launch(ready = true): Promise<void> {
  for (const spy of [observed.open, observed.migrate, observed.recover, observed.paths, observed.getProjects, observed.register,
    observed.createDiagnostics, observed.registerDiagnostics, observed.recoverJobs, observed.createJobs,
    observed.registerJobs, observed.createImports, observed.registerImports, observed.startWorker, observed.spawn]) spy.mockClear();
  if (ready) h.ready.resolve();
  h.imported = true;
  await import('./index.js');
}
async function windowReady(): Promise<TestBrowserWindow> {
  return Promise.race([h.loaded.promise, h.terminal.promise.then(() => { throw new Error('App stopped before loading a window'); })]);
}
async function atGate(reached: Promise<void>, completion: Promise<unknown> = h.loaded.promise): Promise<void> {
  await Promise.race([
    reached,
    completion.then(() => { throw new Error('Operation completed before the expected gate'); }),
    h.terminal.promise.then(() => { throw new Error('App stopped before the expected gate'); }),
  ]);
}
function activeDatabase(): DatabaseConnection {
  expect(h.monitors).toHaveLength(1);
  return h.monitors[0]!.database;
}
function invocationEvent(window = h.windows.at(-1)!): IpcMainInvokeEvent {
  return { sender: window.webContents, senderFrame: window.contents.mainFrame } as IpcMainInvokeEvent;
}
function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const listener = h.handlers.get(channel);
  if (!listener) throw new Error('Missing registered test handler');
  const pending: Promise<unknown> = Promise.resolve(listener(invocationEvent(), ...args));
  h.tasks.push(pending);
  void pending.catch(() => undefined);
  return pending;
}
async function pick(project?: Project, parent?: string): Promise<string> {
  if (project || parent !== undefined) h.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [parent ?? h.destination] });
  const response = projectPickParentResponseSchema.parse(await invoke(PROJECT_PICK_PARENT_CHANNEL,
    project ? { purpose: 'move', projectId: project.id } : { purpose: 'create' }));
  if (!response.ok || response.value.status !== 'selected') throw new Error('Expected a native-selected test parent');
  return response.value.token;
}
async function seedDatabase<T>(version: number, action: (database: DatabaseConnection) => T | Promise<T>): Promise<T> {
  // Fixture setup only, never a production seed or second writer during startup.
  fs.mkdirSync(h.receiptDirectory, { recursive: true });
  const database = observed.actualOpen(h.databasePath);
  try {
    modules.migration.migrateDatabase(database, history.slice(0, version));
    return await action(database);
  } finally { database.close(); }
}
function seedProject(database: DatabaseConnection, name = '保存済みProject'): Project {
  return modules.service.createProject(database, { name, taskType: 'classification', workspacePath: h.parent });
}
function seedJobFiles() {
  const taskRoot = observed.createJobs.mock.calls[0]![1].taskRoot;
  const jobDirectory = join(taskRoot, randomUUID());
  fs.mkdirSync(jobDirectory);
  fs.writeFileSync(join(jobDirectory, 'task.json'), '{"fixture":"existing job task"}\n');
  fs.writeFileSync(join(jobDirectory, 'result.bin'), payloadBytes);
  return { taskRoot, jobDirectory };
}
function snapshotTree(root: string) {
  return ['', ...fs.readdirSync(root, { recursive: true, encoding: 'utf8' }).map(String).sort()].map((relativePath) => {
    const path = join(root, relativePath), stat = fs.lstatSync(path, { bigint: true });
    expect(stat.isSymbolicLink()).toBe(false);
    expect(stat.isDirectory() || stat.isFile()).toBe(true);
    return { relativePath, dev: stat.dev, ino: stat.ino, birthtimeNs: stat.birthtimeNs,
      bytes: stat.isFile() ? fs.readFileSync(path) : null };
  });
}
function readSnapshot<T>(path: string, read: (database: DatabaseConnection) => T): T {
  const database = new NativeDatabase(path, { readonly: true, fileMustExist: true });
  try { return read(database); } finally { database.close(); }
}
function expectAnnotationTablesEmpty(database: DatabaseConnection): void {
  for (const table of annotationTables) expect(database.prepare(`SELECT * FROM ${table}`).all()).toEqual([]);
}
function expectAnnotationTablesAbsent(database: DatabaseConnection): void {
  for (const table of annotationTables) {
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)).toBeUndefined();
  }
}
function expectTablesEmpty(database: DatabaseConnection): void {
  const tables = ['projects', 'settings', 'jobs', 'data_imports', 'import_sources', 'import_generations',
    'project_import_rights', ...annotationTables];
  expect(database.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all())
    .toEqual(tables.sort().map((name) => ({ name })));
  for (const table of tables) {
    expect(database.prepare(`SELECT * FROM ${table}`).all()).toEqual([]);
  }
}
function expectFailure(code: keyof typeof failureMessages): void {
  const message = `${failureMessages[code]}\nエラーコード: ${code}`;
  expect(h.showErrorBox).toHaveBeenCalledWith('AutoVision Studio', message);
  expect(errors).toHaveBeenCalledWith(message);
  expect(JSON.stringify([h.showErrorBox.mock.calls, h.showMessageBoxSync.mock.calls, errors.mock.calls, warnings.mock.calls]))
    .not.toMatch(/PRIVATE/);
  expect(JSON.stringify([h.showErrorBox.mock.calls, h.showMessageBoxSync.mock.calls, errors.mock.calls, warnings.mock.calls]))
    .not.toContain(JSON.stringify(h.root).slice(1, -1));
}
async function expectQuit(): Promise<void> {
  await expect(h.terminal.promise).resolves.toBe('quit');
  expect(h.quit).toHaveBeenCalledOnce();
  for (const monitor of h.monitors) {
    expect(monitor.close).toHaveBeenCalledOnce();
    expect(monitor.database.open).toBe(false);
  }
}

// Windows-only ownership paths are exercised on Windows, not emulated as a
// different platform. No Electron executable or real application profile runs.
describe.skipIf(process.platform !== 'win32')('UI19M real Main initialization and shutdown', () => {
  beforeEach(async () => {
    vi.resetModules();
    TestBrowserWindow.getAllWindows.mockClear();
    const root = fs.realpathSync.native(fs.mkdtempSync(join(tmpdir(), 'autovision-ui19m-')));
    h = makeHarness(root);
    electronState.current = h;
    for (const directory of [h.parent, h.destination, h.resources]) fs.mkdirSync(directory);
    fs.writeFileSync(join(h.resources, 'original.bin'), payloadBytes);
    resourcesDescriptor = Object.getOwnPropertyDescriptor(process, 'resourcesPath');
    Object.defineProperty(process, 'resourcesPath', { configurable: true, value: h.resources });
    modules = await loadModules();
    observed = observeModules(modules, h);
    errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    warnings = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(async () => {
    // First close admission, then release ALL test-owned gates (also on assertion
    // failure), await actual work, and only then close/remove disposable fixtures.
    const ownsStartup = h.imported && h.events.listenerCount('before-quit') > 0;
    if (ownsStartup && h.finished === undefined) beforeQuit();
    h.ready.resolve();
    for (const release of h.releases) release();
    await Promise.allSettled(h.tasks);
    if (ownsStartup) await h.terminal.promise;
    await Promise.resolve();
    vi.restoreAllMocks();
    for (const monitor of h.monitors) if (monitor.database.open) monitor.nativeClose();
    h.events.removeAllListeners();
    if (resourcesDescriptor) Object.defineProperty(process, 'resourcesPath', resourcesDescriptor);
    else Reflect.deleteProperty(process, 'resourcesPath');
    electronState.current = undefined;
    fs.rmSync(h.root, { recursive: true, force: true });
  });

  it('refuses the second instance without requesting ready, accessing app data or registering windows/handlers', async () => {
    h.lock.mockReturnValue(false);
    const mkdir = vi.spyOn(fs, 'mkdirSync');
    await launch(false);
    await expectQuit();
    expect(h.lock).toHaveBeenCalledOnce();
    for (const operation of [h.whenReady, h.getPath, h.on, observed.paths, observed.open, observed.migrate,
      observed.getProjects, observed.recover, observed.register, observed.createDiagnostics, observed.registerDiagnostics,
      observed.recoverJobs, observed.createJobs, observed.registerJobs, observed.createImports, observed.registerImports,
      observed.startWorker, observed.spawn, observed.createImages, h.registerSchemes, h.protocolHandle,
      h.handle, mkdir, TestBrowserWindow.getAllWindows]) {
      expect(operation).not.toHaveBeenCalled();
    }
    expect(h.windows).toEqual([]);
    expect(fs.existsSync(h.userData)).toBe(false);
  });

  it('registers image privileges before ready and a lazy real reader before IPC/load, retaining it across windows', async () => {
    await launch(false);
    expect(h.registerSchemes).toHaveBeenCalledOnce();
    expect(h.sequence.indexOf('protocol:privileges')).toBeLessThan(h.sequence.indexOf('app:whenReady'));
    expect(observed.createImages).not.toHaveBeenCalled();
    h.ready.resolve(); const first = await windowReady();
    expect(observed.createImages.mock.calls).toEqual([[activeDatabase()]]);
    expect(h.images[0]!.handle).not.toHaveBeenCalled();
    expect(h.sequence.indexOf('imports:create')).toBeLessThan(h.sequence.indexOf('images:create'));
    expect(h.sequence.indexOf('images:create')).toBeLessThan(h.sequence.indexOf('protocol:handle'));
    expect(h.sequence.indexOf('protocol:handle')).toBeLessThan(h.sequence.indexOf(`handle:${PROJECT_LIST_CHANNEL}`));
    expect(h.sequence.indexOf('protocol:handle')).toBeLessThan(h.sequence.indexOf('window:load'));
    expect(first.options.webPreferences?.partition).toBeUndefined();
    expect(first.options.webPreferences?.session).toBeUndefined();
    const handler = h.protocolHandlers.get('av-image')!;
    const prepare = vi.spyOn(activeDatabase(), 'prepare'), exec = vi.spyOn(activeDatabase(), 'exec');
    prepare.mockClear(); exec.mockClear(); // Exclude earlier migration/recovery operations.
    expect((await handler(new Request('av-image://image/invalid'))).status).toBe(404);
    expect(prepare).not.toHaveBeenCalled(); expect(exec).not.toHaveBeenCalled();
    first.destroy(); h.events.emit('activate');
    expect(h.images[0]!.dispose).not.toHaveBeenCalled();
    expect(observed.createImages).toHaveBeenCalledOnce(); expect(h.protocolHandle).toHaveBeenCalledOnce();
    expect(h.registerSchemes).toHaveBeenCalledOnce();
    beforeQuit(); await expectQuit();
    expect(h.protocolUnhandle.mock.calls).toEqual([['av-image']]);
    expect((await handler(new Request('av-image://image/invalid'))).status).toBe(503);
    expect((await h.images[0]!.handle(new Request('av-image://image/invalid'))).status).toBe(503);
  });

  it.each(['none', 'unhandle', 'dispose'] as const)('awaits image drain even after jobs stop and fails closed on %s failure', async (fault) => {
    await launch(); await windowReady();
    const reader = h.images[0]!, actualDispose = vi.mocked(reader.dispose).getMockImplementation()!, gate = pause();
    vi.mocked(reader.dispose).mockImplementationOnce(() => {
      const drain = actualDispose();
      return (async () => { await drain; await gate.hold();
        if (fault === 'dispose') throw new Error('PRIVATE reader stop'); })();
    });
    if (fault === 'unhandle') h.protocolUnhandle.mockImplementationOnce(() => { throw new Error('PRIVATE unhandle'); });
    const jobsStopped = Promise.withResolvers<void>(), shutdown = h.jobs[0]!.shutdown.getMockImplementation()!;
    h.jobs[0]!.shutdown.mockImplementationOnce(async () => { await shutdown(); jobsStopped.resolve(); });
    const handler = h.protocolHandlers.get('av-image')!;
    beforeQuit(); beforeQuit();
    await gate.reached; await jobsStopped.promise;
    expect((await handler(new Request('av-image://image/invalid'))).status).toBe(503);
    expect((await reader.handle(new Request('av-image://image/invalid'))).status).toBe(503);
    expect(h.monitors[0]!.close).not.toHaveBeenCalled(); expect(h.quit).not.toHaveBeenCalled();
    gate.release();
    if (fault === 'none') await expectQuit();
    else {
      await expect(h.terminal.promise).resolves.toBe('shutdown-failed'); expectFailure('MAIN_SHUTDOWN_FAILED');
      expect(h.monitors[0]!.close).not.toHaveBeenCalled(); expect(activeDatabase().open).toBe(true);
    }
    expect(reader.dispose).toHaveBeenCalledOnce(); expect(h.protocolUnhandle).toHaveBeenCalledOnce();
  });

  it('disposes a reader after protocol conflict without unregistering the foreign handler', async () => {
    const foreign = vi.fn(() => new Response(null, { status: 404 }));
    h.protocolHandlers.set('av-image', foreign);
    await launch(); await expectQuit(); expectFailure('MAIN_STARTUP_FAILED');
    expect(h.images[0]!.dispose).toHaveBeenCalledOnce();
    expect(h.protocolUnhandle).not.toHaveBeenCalled(); expect(h.protocolHandlers.get('av-image')).toBe(foreign);
    expect(h.handle).not.toHaveBeenCalled(); expect(h.windows).toEqual([]);
  });

  it('fails before readiness or DB access when privileged scheme registration fails', async () => {
    h.registerSchemes.mockImplementationOnce(() => { throw new Error('PRIVATE privilege registration'); });
    await launch(false); await expectQuit(); expectFailure('MAIN_STARTUP_FAILED');
    expect(h.whenReady).not.toHaveBeenCalled(); expect(observed.open).not.toHaveBeenCalled();
    expect(observed.createImages).not.toHaveBeenCalled(); expect(h.protocolUnhandle).not.toHaveBeenCalled();
  });

  it('gates ready and real native backup, then applies bundled 001/002/003/004/005/006/007 to empty tables with a schema-zero snapshot', async () => {
    const gate = pause();
    h.configureDatabase = ({ backup, nativeBackup }) => {
      backup.mockImplementationOnce(async (...args) => { await gate.hold(); return nativeBackup(...args); });
    };
    const mkdir = vi.spyOn(fs, 'mkdirSync');
    await launch(false);
    h.events.emit('activate'); h.events.emit('second-instance');
    expect(h.getPath).not.toHaveBeenCalled(); expect(observed.open).not.toHaveBeenCalled();
    expect(fs.existsSync(h.userData)).toBe(false);
    h.ready.resolve();
    try {
      await atGate(gate.reached);
      const database = activeDatabase();
      expect(database.pragma('user_version', { simple: true })).toBe(0);
      expect(database.inTransaction).toBe(false);
      h.events.emit('activate'); h.events.emit('second-instance');
      expect(h.windows).toEqual([]); expect(h.handle).not.toHaveBeenCalled();
      expect(observed.getProjects).not.toHaveBeenCalled(); expect(observed.recover).not.toHaveBeenCalled();
      expect(observed.recoverJobs).not.toHaveBeenCalled(); expect(observed.createJobs).not.toHaveBeenCalled();
      expect(observed.startWorker).not.toHaveBeenCalled(); expect(observed.spawn).not.toHaveBeenCalled();
      const directories = [h.userData, join(h.userData, 'projects'), join(h.userData, 'cache'), join(h.userData, 'logs'),
        h.receiptDirectory, h.backupDirectory];
      expect(mkdir.mock.calls.slice(0, 6)).toEqual(directories.map((path) => [path, { recursive: true, mode: 0o700 }]));
      for (const path of directories) expect(fs.statSync(path).isDirectory()).toBe(true);
    } finally { gate.release(); }
    await windowReady();
    const database = activeDatabase();
    expect(h.lock).toHaveBeenCalledOnce(); expect(h.whenReady).toHaveBeenCalledOnce();
    expect(h.getPath.mock.calls).toEqual([['userData']]);
    expect(observed.paths.mock.calls).toEqual([[h.userData]]);
    expect(observed.open.mock.calls).toEqual([[h.databasePath]]);
    expect(observed.migrate.mock.calls).toEqual([[database, history, h.backupDirectory]]);
    expect(h.monitors[0]!.backup).toHaveBeenCalledOnce();
    expect(database.pragma('user_version', { simple: true })).toBe(7);
    expect(database.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(database.pragma('journal_mode', { simple: true })).toBe('wal');
    expectTablesEmpty(database);
    expect(fs.readdirSync(join(h.userData, 'cache', 'jobs'))).toEqual([]);
    expect(observed.recoverJobs.mock.calls).toEqual([[database]]);
    expect(observed.createJobs).toHaveBeenCalledOnce();
    expect(observed.startWorker).not.toHaveBeenCalled(); expect(observed.spawn).not.toHaveBeenCalled();
    const result = await observed.migrate.mock.results[0]!.value;
    expect(result.backup?.version).toBe(0);
    expect(dirname(dirname(result.backup!.path))).toBe(h.backupDirectory);
    readSnapshot(result.backup!.path, (copy) => {
      expect(copy.pragma('user_version', { simple: true })).toBe(0);
      expect(copy.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).toEqual([]);
    });
    expect(h.showOpenDialog).not.toHaveBeenCalled(); expect(h.showMessageBoxSync).not.toHaveBeenCalled();
    expect(h.loadObservations).toEqual([{ path: rendererEntryPath, channels, navigationGuards: 2 }]);
    expect(h.sequence.indexOf('migration:settled')).toBeLessThan(h.sequence.indexOf('window:construct'));
    beforeQuit(); await expectQuit();
    readSnapshot(h.databasePath, expectTablesEmpty);
  });

  it('upgrades a real 001 database without changing Project/settings data and keeps an independently readable old backup', async () => {
    const project = await seedDatabase(1, (database) => {
      const saved = seedProject(database);
      database.prepare('INSERT INTO settings(key,value) VALUES (?,?)').run('explicit-setting', '教師データ · 保存値');
      return saved;
    });
    await launch(); await windowReady();
    const database = activeDatabase();
    expect(modules.service.getProject(database, project.id)).toEqual(project);
    expect(database.prepare('SELECT * FROM jobs').all()).toEqual([]);
    const result = await observed.migrate.mock.results[0]!.value;
    expect(result.backup?.version).toBe(1);
    const backupBytes = fs.readFileSync(result.backup!.path);
    readSnapshot(result.backup!.path, (copy) => {
      expect(copy.pragma('user_version', { simple: true })).toBe(1);
      expect(modules.service.getProject(copy, project.id)).toEqual(project);
      expect(copy.prepare('SELECT * FROM settings').all()).toEqual([{ key: 'explicit-setting', value: '教師データ · 保存値' }]);
      expect(copy.prepare("SELECT name FROM sqlite_master WHERE name='jobs'").get()).toBeUndefined();
    });
    expect(fs.readFileSync(result.backup!.path)).toEqual(backupBytes);
    expect(observed.recover.mock.calls).toEqual([[database, project.id, h.receiptDirectory]]);
    expect(h.showMessageBoxSync).not.toHaveBeenCalled();
    beforeQuit(); await expectQuit();
    readSnapshot(h.databasePath, (copy) => {
      expect(copy.pragma('user_version', { simple: true })).toBe(7);
      expect(modules.service.getProject(copy, project.id)).toEqual(project);
      expect(copy.prepare('SELECT * FROM settings').all()).toEqual([{ key: 'explicit-setting', value: '教師データ · 保存値' }]);
      expectAnnotationTablesEmpty(copy);
    });
  });

  it('upgrades an existing schema-3 database to schema 7 with one old backup and empty import-generation/rights/annotation tables without resetting data', async () => {
    const tables = ['projects', 'settings', 'jobs', 'data_imports', 'import_sources'];
    const readData = (database: DatabaseConnection) => tables.map((table) => database.prepare(`SELECT * FROM ${table}`).all());
    const preservedData = await seedDatabase(3, (database) => {
      const project = seedProject(database);
      database.prepare('INSERT INTO settings(key,value) VALUES (?,?)').run('explicit-setting', '教師データ · 保存値');
      database.prepare('INSERT INTO jobs(id,project_id,kind,status,created_at,updated_at) VALUES (?,?,?,?,?,?)')
        .run(randomUUID(), project.id, 'train', 'Running', project.createdAt, project.createdAt);
      return readData(database);
    });
    await launch(); await windowReady();
    const database = activeDatabase();
    expect(database.pragma('user_version', { simple: true })).toBe(7);
    const recoveredData = readData(database);
    expect(recoveredData.slice(0, 2)).toEqual(preservedData.slice(0, 2));
    expect(recoveredData.slice(3)).toEqual(preservedData.slice(3));
    expect(recoveredData[2]).toEqual([expect.objectContaining({ status: 'Interrupted' })]);
    expect(database.prepare('SELECT * FROM import_generations').all()).toEqual([]);
    expect(database.prepare('SELECT * FROM project_import_rights').all()).toEqual([]);
    expectAnnotationTablesEmpty(database);
    expect(observed.migrate.mock.calls).toEqual([[database, history, h.backupDirectory]]);
    const monitor = h.monitors[0]!;
    expect(monitor.backup).toHaveBeenCalledOnce();
    expect(monitor.exec.mock.calls.filter(([sql]) => history.some((migration) => migration.sql === sql)))
      .toEqual([[importGenerationSql], [importRightsSql], [annotationsSql], [annotationTargetHistorySql]]);
    const result = await observed.migrate.mock.results[0]!.value;
    expect(result.backup?.version).toBe(3);
    expect(dirname(dirname(result.backup!.path))).toBe(h.backupDirectory);
    expect(fs.readdirSync(h.backupDirectory)).toHaveLength(1);
    const backupBytes = fs.readFileSync(result.backup!.path);
    readSnapshot(result.backup!.path, (copy) => {
      expect(copy.pragma('user_version', { simple: true })).toBe(3);
      expect(readData(copy)).toEqual(preservedData);
      expect(copy.prepare("SELECT name FROM sqlite_master WHERE name='import_generations'").get()).toBeUndefined();
      expect(copy.prepare("SELECT name FROM sqlite_master WHERE name='project_import_rights'").get()).toBeUndefined();
      expectAnnotationTablesAbsent(copy);
    });
    beforeQuit(); await expectQuit();
    readSnapshot(h.databasePath, (copy) => {
      expect(copy.pragma('user_version', { simple: true })).toBe(7);
      expect(readData(copy)).toEqual(recoveredData);
      expect(copy.prepare('SELECT * FROM import_generations').all()).toEqual([]);
      expect(copy.prepare('SELECT * FROM project_import_rights').all()).toEqual([]);
      expectAnnotationTablesEmpty(copy);
    });
    expect(fs.readFileSync(result.backup!.path)).toEqual(backupBytes);
  });

  it('upgrades an existing schema-4 database to schema 7 with one old backup, preserving data without auto-acknowledging import rights or seeding annotations', async () => {
    const tables = ['projects', 'settings', 'jobs', 'data_imports', 'import_sources', 'import_generations'];
    const readData = (database: DatabaseConnection) => tables.map((table) => database.prepare(`SELECT * FROM ${table}`).all());
    const preservedData = await seedDatabase(4, (database) => {
      const project = seedProject(database), jobId = randomUUID(), importId = randomUUID();
      database.prepare('INSERT INTO settings(key,value) VALUES (?,?)').run('explicit-setting', '教師データ · 保存値');
      database.prepare('INSERT INTO jobs(id,project_id,kind,status,created_at,updated_at) VALUES (?,?,?,?,?,?)')
        .run(jobId, project.id, 'scan-dataset', 'Succeeded', project.createdAt, project.createdAt);
      // Schema-valid synthetic import/source rows exercise preservation only.
      database.prepare(`INSERT INTO data_imports(id,project_id,scan_job_id,task_type,mode,created_at,updated_at,
        scan_result_json,scan_result_sha256,source_manifest_json,source_manifest_sha256)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
        .run(importId, project.id, jobId, 'classification', 'copy', project.createdAt, project.createdAt,
          '{}', 'a'.repeat(64), '{}', 'b'.repeat(64));
      database.prepare(`INSERT INTO import_sources(import_id,image_key,ordinal,mode,relative_path,relative_path_key,
        byte_size,sha256,entry_sha256) VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(importId, 'image-1', 0, 'copy', 'images/one.png', 'images/one.png', payloadBytes.length,
          'c'.repeat(64), 'd'.repeat(64));
      return readData(database);
    });
    for (const rows of preservedData) expect(rows).toHaveLength(1);
    await launch(); await windowReady();
    const database = activeDatabase();
    expect(database.pragma('user_version', { simple: true })).toBe(7);
    expect(readData(database)).toEqual(preservedData);
    expect(database.prepare('SELECT * FROM project_import_rights').all()).toEqual([]);
    expectAnnotationTablesEmpty(database);
    expect(observed.migrate.mock.calls).toEqual([[database, history, h.backupDirectory]]);
    const monitor = h.monitors[0]!;
    expect(monitor.backup).toHaveBeenCalledOnce();
    expect(monitor.exec.mock.calls.filter(([sql]) => history.some((migration) => migration.sql === sql)))
      .toEqual([[importRightsSql], [annotationsSql], [annotationTargetHistorySql]]);
    const result = await observed.migrate.mock.results[0]!.value;
    expect(result.backup?.version).toBe(4);
    expect(dirname(dirname(result.backup!.path))).toBe(h.backupDirectory);
    expect(fs.readdirSync(h.backupDirectory)).toHaveLength(1);
    const backupBytes = fs.readFileSync(result.backup!.path);
    readSnapshot(result.backup!.path, (copy) => {
      expect(copy.pragma('user_version', { simple: true })).toBe(4);
      expect(readData(copy)).toEqual(preservedData);
      expect(copy.prepare("SELECT name FROM sqlite_master WHERE name='project_import_rights'").get()).toBeUndefined();
      expectAnnotationTablesAbsent(copy);
    });
    expect(h.showMessageBox).not.toHaveBeenCalled(); expect(h.showMessageBoxSync).not.toHaveBeenCalled();
    beforeQuit(); await expectQuit();
    readSnapshot(h.databasePath, (copy) => {
      expect(copy.pragma('user_version', { simple: true })).toBe(7);
      expect(readData(copy)).toEqual(preservedData);
      expect(copy.prepare('SELECT * FROM project_import_rights').all()).toEqual([]);
      expectAnnotationTablesEmpty(copy);
    });
    expect(fs.readFileSync(result.backup!.path)).toEqual(backupBytes);
  });

  it('upgrades an existing schema-5 database to schema 7 with one version-5 backup, retaining data and rights without seeding annotations', async () => {
    const tables = ['projects', 'settings', 'jobs', 'data_imports', 'import_sources', 'import_generations',
      'project_import_rights'];
    const readData = (database: DatabaseConnection) => tables.map((table) => database.prepare(`SELECT * FROM ${table}`).all());
    const saved = await seedDatabase(5, (database) => {
      const project = seedProject(database), jobId = randomUUID(), importId = randomUUID();
      database.prepare('INSERT INTO settings(key,value) VALUES (?,?)').run('explicit-setting', '教師データ · 保存値');
      database.prepare('INSERT INTO jobs(id,project_id,kind,status,created_at,updated_at) VALUES (?,?,?,?,?,?)')
        .run(jobId, project.id, 'scan-dataset', 'Succeeded', project.createdAt, project.createdAt);
      // Schema-valid fixture rows, including an explicit acknowledgement, not production seeds.
      database.prepare(`INSERT INTO data_imports(id,project_id,scan_job_id,task_type,mode,created_at,updated_at,
        scan_result_json,scan_result_sha256,source_manifest_json,source_manifest_sha256)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
        .run(importId, project.id, jobId, 'classification', 'copy', project.createdAt, project.createdAt,
          '{}', 'a'.repeat(64), '{}', 'b'.repeat(64));
      database.prepare(`INSERT INTO import_sources(import_id,image_key,ordinal,mode,relative_path,relative_path_key,
        byte_size,sha256,entry_sha256) VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(importId, 'image-1', 0, 'copy', 'images/one.png', 'images/one.png', payloadBytes.length,
          'c'.repeat(64), 'd'.repeat(64));
      database.prepare('INSERT INTO project_import_rights(project_id,acknowledged_at) VALUES (?,?)')
        .run(project.id, project.createdAt);
      return { project, data: readData(database) };
    });
    for (const rows of saved.data) expect(rows).toHaveLength(1);
    const markerBytes = fs.readFileSync(join(saved.project.workspacePath, markerName));
    await launch(); await windowReady();
    const database = activeDatabase();
    expect(database.pragma('user_version', { simple: true })).toBe(7);
    expect(readData(database)).toEqual(saved.data);
    expectAnnotationTablesEmpty(database);
    expect(observed.migrate.mock.calls).toEqual([[database, history, h.backupDirectory]]);
    const monitor = h.monitors[0]!;
    expect(monitor.backup).toHaveBeenCalledOnce();
    expect(monitor.exec.mock.calls.filter(([sql]) => history.some((migration) => migration.sql === sql)))
      .toEqual([[annotationsSql], [annotationTargetHistorySql]]);
    const result = await observed.migrate.mock.results[0]!.value;
    expect(result.backup?.version).toBe(5);
    expect(dirname(dirname(result.backup!.path))).toBe(h.backupDirectory);
    expect(fs.readdirSync(h.backupDirectory)).toHaveLength(1);
    const backupBytes = fs.readFileSync(result.backup!.path);
    readSnapshot(result.backup!.path, (copy) => {
      expect(copy.pragma('user_version', { simple: true })).toBe(5);
      expect(readData(copy)).toEqual(saved.data);
      expectAnnotationTablesAbsent(copy);
    });
    expect(h.showOpenDialog).not.toHaveBeenCalled();
    expect(h.showMessageBox).not.toHaveBeenCalled(); expect(h.showMessageBoxSync).not.toHaveBeenCalled();
    beforeQuit(); await expectQuit();
    readSnapshot(h.databasePath, (copy) => {
      expect(copy.pragma('user_version', { simple: true })).toBe(7);
      expect(readData(copy)).toEqual(saved.data);
      expectAnnotationTablesEmpty(copy);
    });
    expect(fs.readFileSync(result.backup!.path)).toEqual(backupBytes);
    expect(fs.readdirSync(saved.project.workspacePath)).toEqual([markerName]);
    expect(fs.readFileSync(join(saved.project.workspacePath, markerName))).toEqual(markerBytes);
  });

  it.each([false, true])('preserves schema-6 imports, annotations and raw provenance without guessing lost history; rollback after 007=%s', async (failSql) => {
    const tables = ['projects', 'settings', 'jobs', 'data_imports', 'import_sources', 'import_generations',
      'project_import_rights', ...annotationTables.filter((table) => table !== 'annotation_target_history')];
    const readData = (database: DatabaseConnection) => tables.map((table) =>
      database.prepare(`SELECT * FROM ${table} ORDER BY 1, 2`).all());
    const readSchema = (database: DatabaseConnection) => database.prepare(
      'SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name',
    ).all();
    const saved = await seedDatabase(6, (database) => {
      const project = seedProject(database), jobId = randomUUID(), importId = randomUUID();
      const schemaId = randomUUID(), classId = randomUUID(), workspaceId = randomUUID();
      database.prepare('INSERT INTO settings(key,value) VALUES (?,?)').run('explicit-setting', '教師データ · 保存値');
      database.prepare('INSERT INTO jobs(id,project_id,kind,status,created_at,updated_at) VALUES (?,?,?,?,?,?)')
        .run(jobId, project.id, 'scan-dataset', 'Succeeded', project.createdAt, project.createdAt);
      // Schema-valid synthetic raw fields, not production seed data or scan acceptance.
      database.prepare(`INSERT INTO data_imports(id,project_id,scan_job_id,task_type,mode,created_at,updated_at,
        scan_result_json,scan_result_sha256,source_manifest_json,source_manifest_sha256)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
        .run(importId, project.id, jobId, 'classification', 'copy', project.createdAt, project.createdAt,
          '{ "classes": ["元ラベル"], "raw": "保持" }', 'a'.repeat(64), '{ "raw": "元のmanifest" }', 'b'.repeat(64));
      for (const ordinal of [0, 1]) database.prepare(`INSERT INTO import_sources(import_id,image_key,ordinal,mode,
        relative_path,relative_path_key,byte_size,sha256,entry_sha256) VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(importId, `image-${ordinal}`, ordinal, 'copy', `images/${ordinal}.png`, `images/${ordinal}.png`,
          payloadBytes.length, 'c'.repeat(64), 'd'.repeat(64));
      database.prepare('INSERT INTO project_import_rights(project_id,acknowledged_at) VALUES (?,?)')
        .run(project.id, project.createdAt);
      database.prepare('INSERT INTO label_schemas(id,project_id,created_at,updated_at) VALUES (?,?,?,?)')
        .run(schemaId, project.id, project.createdAt, project.createdAt);
      database.prepare(`INSERT INTO label_classes(id,schema_id,display_name,normalized_name,color,ordinal,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?)`).run(classId, schemaId, '修正ラベル', '修正ラベル', '#123456', 0, project.createdAt, project.createdAt);
      database.prepare(`INSERT INTO annotation_workspaces(id,project_id,schema_id,task_type,mode,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?)`).run(workspaceId, project.id, schemaId, 'classification', 'copy', project.createdAt, project.createdAt);
      for (const ordinal of [0, 1]) {
        const itemId = randomUUID();
        database.prepare(`INSERT INTO annotation_items(id,workspace_id,import_id,image_key,image_sha256,width,height,
          annotation_json,annotation_sha256,state,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
          .run(itemId, workspaceId, importId, `image-${ordinal}`, 'c'.repeat(64), 10, 20,
            ordinal === 0 ? `{ "kind": "classification", "classId": "${classId}" }`
              : '{ "kind": "classification", "classId": null }', 'e'.repeat(64), 'editing', project.createdAt);
        // The second item has already lost its target/origin. Scan class names
        // cannot reconstruct that identity; neither item gets history backfilled.
        if (ordinal === 0) database.prepare(`INSERT INTO annotation_provenance(item_id,target_key,kind,
          source_import_id,source_image_key,source_annotation_key,original_json,changes_json)
          VALUES (?,?,?,?,?,?,?,?)`).run(itemId, 'classification', 'import-edited', importId, 'image-0', 'raw-label-0',
          '{ "label": "元ラベル", "raw": { "keep": true } }', '{ "label": "修正ラベル" }');
      }
      expect(database.prepare('SELECT * FROM annotation_items').all()).toHaveLength(2);
      expect(database.prepare('SELECT * FROM annotation_provenance').all()).toHaveLength(1);
      return { project, data: readData(database), schema: readSchema(database) };
    });
    const markerBytes = fs.readFileSync(join(saved.project.workspacePath, markerName));
    if (failSql) h.configureDatabase = ({ exec, nativeExec }) => exec.mockImplementation((sql) => {
      const result = nativeExec(sql);
      if (sql === annotationTargetHistorySql) nativeExec('INSERT INTO missing_ui19m_test_table VALUES (1)');
      return result;
    });
    await launch();
    if (failSql) {
      await expectQuit(); expectFailure('MAIN_STARTUP_FAILED');
      expect(observed.getProjects).not.toHaveBeenCalled(); expect(h.handle).not.toHaveBeenCalled();
      expect(h.monitors[0]!.exec.mock.calls.map(([sql]) => sql))
        .toEqual(['BEGIN IMMEDIATE', annotationTargetHistorySql, 'ROLLBACK']);
      expect(h.monitors[0]!.transactionsAtClose).toEqual([false]);
    } else {
      await windowReady();
      const database = activeDatabase();
      expect(database.pragma('user_version', { simple: true })).toBe(7);
      expect(readData(database)).toEqual(saved.data);
      expect(database.prepare('SELECT * FROM annotation_target_history').all()).toEqual([]);
      expect(h.monitors[0]!.exec.mock.calls.filter(([sql]) => history.some((migration) => migration.sql === sql)))
        .toEqual([[annotationTargetHistorySql]]);
      expect((await observed.migrate.mock.results[0]!.value).backup?.version).toBe(6);
      beforeQuit(); await expectQuit();
    }
    expect(h.monitors[0]!.backup).toHaveBeenCalledOnce();
    expect(observed.migrate.mock.calls).toEqual([[h.monitors[0]!.database, history, h.backupDirectory]]);
    const attempts = fs.readdirSync(h.backupDirectory);
    expect(attempts).toHaveLength(1);
    const backupPath = join(h.backupDirectory, attempts[0]!, 'metadata.sqlite3');
    const backupBytes = fs.readFileSync(backupPath);
    readSnapshot(backupPath, (copy) => {
      expect(copy.pragma('user_version', { simple: true })).toBe(6);
      expect(readData(copy)).toEqual(saved.data); expect(readSchema(copy)).toEqual(saved.schema);
    });
    readSnapshot(h.databasePath, (copy) => {
      expect(copy.pragma('user_version', { simple: true })).toBe(failSql ? 6 : 7);
      expect(readData(copy)).toEqual(saved.data);
      if (failSql) expect(readSchema(copy)).toEqual(saved.schema); // Includes all tables, views and triggers.
      else expect(copy.prepare('SELECT * FROM annotation_target_history').all()).toEqual([]);
      expect(copy.pragma('foreign_key_check')).toEqual([]);
    });
    expect(fs.readFileSync(backupPath)).toEqual(backupBytes);
    expect(fs.readFileSync(join(saved.project.workspacePath, markerName))).toEqual(markerBytes);
    expect(observed.startWorker).not.toHaveBeenCalled(); expect(observed.spawn).not.toHaveBeenCalled();
  });

  it('reopens a current database with job recovery once, without another backup, seed, queue or worker start', async () => {
    const jobId = randomUUID();
    const project = await seedDatabase(7, (database) => {
      const saved = seedProject(database);
      database.prepare('INSERT INTO jobs(id,project_id,kind,status,created_at,updated_at) VALUES (?,?,?,?,?,?)')
        .run(jobId, saved.id, 'train', 'Running', saved.createdAt, saved.createdAt);
      return saved;
    });
    await launch(); const window = await windowReady();
    await import('./index.js');
    window.isMinimized.mockReturnValue(true);
    h.events.emit('second-instance'); h.events.emit('activate');
    expect(window.restore).toHaveBeenCalledOnce(); expect(window.focus).toHaveBeenCalledOnce();
    expect(h.windows).toHaveLength(1); expect(h.lock).toHaveBeenCalledOnce();
    expect(observed.open).toHaveBeenCalledOnce(); expect(observed.migrate).toHaveBeenCalledOnce();
    expect(observed.recover).toHaveBeenCalledOnce(); expect(h.monitors[0]!.backup).not.toHaveBeenCalled();
    expect(observed.recoverJobs).toHaveBeenCalledOnce(); expect(observed.createJobs).toHaveBeenCalledOnce();
    expect(h.jobs[0]!.startScan).not.toHaveBeenCalled();
    expect(observed.startWorker).not.toHaveBeenCalled(); expect(observed.spawn).not.toHaveBeenCalled();
    expect((await observed.migrate.mock.results[0]!.value).backup).toBeNull();
    expect(fs.readdirSync(h.backupDirectory)).toEqual([]);
    beforeQuit(); await expectQuit();
    readSnapshot(h.databasePath, (copy) => {
      expect(copy.pragma('user_version', { simple: true })).toBe(7);
      expect(modules.service.getProjects(copy)).toEqual([project]);
      expect(copy.prepare('SELECT id,status FROM jobs').all()).toEqual([{ id: jobId, status: 'Interrupted' }]);
      expect(copy.prepare('SELECT * FROM settings').all()).toEqual([]);
      expect(copy.prepare('SELECT * FROM import_generations').all()).toEqual([]);
      expect(copy.prepare('SELECT * FROM project_import_rights').all()).toEqual([]);
      expectAnnotationTablesEmpty(copy);
    });
  });

  it.each([true, false])('registers the trusted real-window boundary before load and performs native-picker create (packaged=%s)', async (packaged) => {
    h.packaged = packaged;
    await launch(); const window = await windowReady();
    const { dialog, ipcMain } = await import('electron');
    const call = observed.register.mock.calls[0]!;
    expect(observed.register).toHaveBeenCalledOnce();
    expect(call[0]).not.toBe(ipcMain); // Local admission/tracking adapter, not a raw exposed transport.
    expect(call.slice(1)).toEqual([window.webContents, rendererURL, activeDatabase(), {
      receiptDirectory: h.receiptDirectory,
      protectedRoots: [packaged ? h.resources : resolve(dirname(fileURLToPath(import.meta.url)), '../../resources'),
        join(h.userData, 'cache', 'jobs'), join(h.userData, 'cache', 'import-selections')],
    }, dialog]);
    expect(h.handle.mock.calls.map(([channel]) => channel)).toEqual(channels);
    expect(h.loadObservations).toEqual([{ path: rendererEntryPath, channels, navigationGuards: 2 }]);
    const workerDirectory = packaged ? join(h.resources, 'worker')
      : resolve(dirname(fileURLToPath(import.meta.url)), '../../ml');
    expect(observed.createDiagnostics.mock.calls).toEqual([[{
      executablePath: packaged ? join(workerDirectory, 'autovision-worker.exe')
        : join(workerDirectory, '.venv', 'Scripts', 'python.exe'),
      argsPrefix: packaged ? [] : ['-m', 'autovision_ml.cli'], cwd: workerDirectory, diskPath: h.userData,
    }]]);
    const config = observed.createDiagnostics.mock.calls[0]![0];
    expect(Object.isFrozen(config)).toBe(true); expect(Object.isFrozen(config.argsPrefix)).toBe(true);
    const launchConfig = observed.createJobs.mock.calls[0]![1];
    expect(observed.createJobs.mock.calls[0]![0]).toBe(activeDatabase());
    expect(launchConfig).toEqual({ executablePath: config.executablePath, argsPrefix: config.argsPrefix,
      taskRoot: join(h.userData, 'cache', 'jobs'), policy: {
        timeoutMs: 86_400_000, cancelGraceMs: 5_000, closeTimeoutMs: 10_000,
        maxStdoutBytes: 67_108_864, maxManifestBytes: MAX_SCAN_RESULT_BYTES,
      } });
    expect(MAX_SCAN_RESULT_BYTES).toBe(268_435_456);
    expect(Object.isFrozen(launchConfig)).toBe(true); expect(Object.isFrozen(launchConfig.policy)).toBe(true);
    expect(launchConfig.argsPrefix).toBe(config.argsPrefix);
    expect(call[4].protectedRoots[1]).toBe(launchConfig.taskRoot);
    expect(Object.isFrozen(call[4])).toBe(true); expect(Object.isFrozen(call[4].protectedRoots)).toBe(true);
    expect(observed.registerJobs.mock.calls).toEqual([[call[0], window.webContents, rendererURL, h.jobs[0]]]);
    expect(observed.createImports.mock.calls).toEqual([[activeDatabase(), h.jobs[0], {
      taskRoot: launchConfig.taskRoot, metadataDirectory: h.userData, protectedRoots: call[4].protectedRoots,
    }]]);
    expect(Object.isFrozen(observed.createImports.mock.calls[0]![2])).toBe(true);
    expect(observed.registerImports.mock.calls).toEqual([[call[0], window.webContents, rendererURL,
      activeDatabase(), h.imports[0], { selectionDirectory: join(h.userData, 'cache', 'import-selections') }, dialog]]);
    expect(Object.isFrozen(observed.registerImports.mock.calls[0]![5])).toBe(true);
    expect(fs.readdirSync(join(h.userData, 'cache', 'import-selections'))).toEqual([]);
    expect(h.sequence.indexOf('jobs:create')).toBeLessThan(h.sequence.indexOf('imports:create'));
    expect(h.sequence.indexOf('imports:create')).toBeLessThan(h.sequence.indexOf('window:construct'));
    for (const operation of Object.values(h.imports[0]!)) expect(operation).not.toHaveBeenCalled();
    expect(h.handlers.has(JOB_CHANGED_CHANNEL)).toBe(false);
    expect(h.jobs[0]!.startScan).not.toHaveBeenCalled();
    expect(observed.startWorker).not.toHaveBeenCalled(); expect(observed.spawn).not.toHaveBeenCalled();
    expect(observed.registerDiagnostics.mock.calls).toEqual([[call[0], window.webContents, rendererURL, h.diagnostics[0]]]);
    expect(h.diagnostics[0]!.collect).not.toHaveBeenCalled();
    expect(h.sequence.indexOf('diagnostics:create')).toBeLessThan(h.sequence.indexOf(`handle:${PROJECT_LIST_CHANNEL}`));
    expect(h.sequence.indexOf(`handle:${diagnosticsChannel}`)).toBeLessThan(h.sequence.indexOf('window:load'));
    expect(window.options).toMatchObject({ x: 280, y: 120, width: 1360, height: 800, webPreferences: {
      preload: resolve(dirname(fileURLToPath(import.meta.url)), '../preload/index.cjs'),
      sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true,
    } });
    expect(window.contents.setWindowOpenHandler.mock.calls[0]![0]()).toEqual({ action: 'deny' });
    expect(h.showOpenDialog).not.toHaveBeenCalled();
    const token = await pick();
    const response = projectCreateResponseSchema.parse(await invoke(PROJECT_CREATE_CHANNEL,
      { name: '新しいProject', taskType: 'classification', parentToken: token }));
    if (!response.ok) throw new Error('Expected actual Project creation');
    const project = response.value.project;
    expect(project.workspacePath).toBe(join(h.parent, project.id));
    expect(modules.directory.verifyProjectDirectory(project.workspacePath, project.id).rootPath).toBe(project.workspacePath);
    expect(fs.readdirSync(project.workspacePath)).toEqual([markerName]);
    expect(modules.service.getProject(activeDatabase(), project.id)).toEqual(project);
    expect(h.showOpenDialog.mock.calls).toEqual([[{ properties: ['openDirectory'], title: 'Projectの親フォルダーを選択' }, undefined]]);
    const list = h.handlers.get(PROJECT_LIST_CHANNEL)!;
    for (const event of [
      { sender: new TestWebContents() as unknown as WebContents, senderFrame: window.contents.mainFrame },
      { sender: window.webContents, senderFrame: { url: rendererURL } as WebFrameMain },
      { sender: window.webContents, senderFrame: null },
    ]) expect(await list(event as IpcMainInvokeEvent)).toEqual({ ok: false, error: { code: 'INVALID_REQUEST' } });
    window.contents.url = pathToFileURL(join(h.root, 'untrusted.html')).href;
    expect(await invoke(PROJECT_LIST_CHANNEL)).toEqual({ ok: false, error: { code: 'INVALID_REQUEST' } });
    window.contents.url = rendererURL;
    expect(await invoke(PROJECT_GET_CHANNEL, { projectId: project.id })).toEqual({ ok: true, value: response.value });
    expect(fs.readFileSync(join(h.resources, 'original.bin'))).toEqual(payloadBytes);
    expect(h.diagnostics[0]!.collect).not.toHaveBeenCalled();
  });

  it.each(['jobs', 'import-selections'] as const)('protects Main-owned %s roots and children against Project creation and moves', async (directory) => {
    const project = await seedDatabase(6, (database) => seedProject(database));
    await launch(); await windowReady();
    const root = join(h.userData, 'cache', directory), child = join(root, randomUUID());
    fs.mkdirSync(child); fs.writeFileSync(join(child, 'retained.bin'), payloadBytes);
    const before = snapshotTree(root), sourceBefore = snapshotTree(project.workspacePath);
    const rowsBefore = activeDatabase().prepare('SELECT * FROM projects').all();
    for (const parent of [root, child]) {
      const createToken = await pick(undefined, parent);
      await expect(invoke(PROJECT_CREATE_CHANNEL, { name: '保護領域', taskType: 'classification', parentToken: createToken }))
        .resolves.toEqual({ ok: false, error: { code: 'OPERATION_FAILED' } });
      const moveToken = await pick(project, parent);
      await expect(invoke(PROJECT_MOVE_CHANNEL, { projectId: project.id, parentToken: moveToken }))
        .resolves.toEqual({ ok: false, error: { code: 'OPERATION_FAILED' } });
    }
    expect(activeDatabase().prepare('SELECT * FROM projects').all()).toEqual(rowsBefore);
    expect(snapshotTree(root)).toEqual(before); expect(snapshotTree(project.workspacePath)).toEqual(sourceBefore);
    expect(fs.readdirSync(h.receiptDirectory)).toEqual([]);
  });

  it.each(['start', 'preview', 'commit'] as const)('drains admitted import %s before jobs stop and DB close', async (operation) => {
    const project = await seedDatabase(6, (database) => seedProject(database));
    await launch(); await windowReady();
    const service = h.imports[0]!, jobs = h.jobs[0]!, gate = pause();
    const job = { id: randomUUID(), projectId: project.id, kind: 'scan-dataset' as const, status: 'Queued' as const,
      createdAt: project.createdAt, updatedAt: project.updatedAt };
    service.scan.mockReturnValue(job);
    const preview = { projectId: project.id, jobId: job.id, taskType: project.taskType, mode: 'copy' as const,
      itemCount: 1, sourceBytes: '1', classes: [], issues: [], files: [{ key: 'image-1', displayName: 'one.png' }] };
    const importId = randomUUID();
    const result = { status: 'completed' as const, projectId: project.id, importId, workspaceId: importId,
      itemCount: 1, cleanupWarning: false };
    let pending: Promise<unknown>;
    if (operation === 'start') {
      h.showOpenDialog.mockImplementationOnce(async () => {
        await gate.hold(); return { canceled: false, filePaths: [h.parent] };
      });
      pending = invoke(IMPORT_START_CHANNEL, { projectId: project.id, mode: 'copy', sourceKind: 'folder' });
    } else {
      const started = importStartResponseSchema.parse(await invoke(IMPORT_START_CHANNEL,
        { projectId: project.id, mode: 'copy', sourceKind: 'folder' }));
      if (!started.ok || started.value.status !== 'started') throw new Error('Expected native-picked import');
      expect(service.scan.mock.calls).toEqual([[project.id, { taskType: project.taskType, mode: 'copy',
        source: { format: 'folder', root: h.parent } }]]);
      const input = { projectId: project.id, jobId: job.id, token: started.value.token };
      if (operation === 'preview') {
        service.preview.mockImplementationOnce(async () => { await gate.hold(); return preview; });
        pending = invoke(IMPORT_PREVIEW_CHANNEL, input);
      } else {
        service.commit.mockImplementationOnce(async () => {
          await gate.hold();
          expect(activeDatabase().open).toBe(true);
          // Actual DB write at the synthetic service boundary proves drain ordering.
          activeDatabase().prepare('INSERT INTO settings(key,value) VALUES (?,?)').run('import-drain', project.id);
          h.sequence.push('import:committed'); return result;
        });
        pending = invoke(IMPORT_COMMIT_CHANNEL, { ...input, rightsAccepted: true });
      }
    }
    await atGate(gate.reached, pending);
    beforeQuit(); beforeQuit();
    expect(h.handlers.size).toBe(0);
    await Promise.resolve();
    expect(jobs.shutdown).not.toHaveBeenCalled(); expect(h.monitors[0]!.close).not.toHaveBeenCalled();
    expect(activeDatabase().open).toBe(true);
    if (operation === 'preview') expect(service.discard.mock.calls).toEqual([[job.id]]);
    else expect(service.discard).not.toHaveBeenCalled();
    gate.release();
    await expect(pending).resolves.toEqual({ ok: false, error: { code: 'STALE_SELECTION' } });
    await expectQuit();
    if (operation === 'start') expect(service.scan).not.toHaveBeenCalled();
    if (operation === 'preview') expect(service.preview.mock.calls).toEqual([[project.id, job.id]]);
    if (operation === 'commit') {
      expect(service.commit.mock.calls).toEqual([[project.id, job.id, { mode: 'copy', rightsAccepted: true }]]);
      expect(h.sequence.indexOf('import:committed')).toBeLessThan(h.sequence.indexOf('jobs:shutdown'));
      readSnapshot(h.databasePath, (database) => expect(database.prepare('SELECT value FROM settings WHERE key=?')
        .get('import-drain')).toEqual({ value: project.id }));
    }
    expect(h.sequence.indexOf('jobs:stopped')).toBeLessThan(h.sequence.indexOf('database:close'));
    expect(observed.startWorker).not.toHaveBeenCalled(); expect(observed.spawn).not.toHaveBeenCalled();
  });

  it('discards an uncommitted native-picked import exactly once on window disposal and reuses its service', async () => {
    const project = await seedDatabase(6, (database) => seedProject(database));
    await launch(); const window = await windowReady(), service = h.imports[0]!;
    const job = { id: randomUUID(), projectId: project.id, kind: 'scan-dataset' as const, status: 'Queued' as const,
      createdAt: project.createdAt, updatedAt: project.updatedAt };
    service.scan.mockReturnValue(job);
    const started = importStartResponseSchema.parse(await invoke(IMPORT_START_CHANNEL,
      { projectId: project.id, mode: 'reference', sourceKind: 'folder' }));
    expect(started.ok).toBe(true);
    window.destroy(); window.emit('closed'); window.contents.emit('destroyed');
    expect(service.discard.mock.calls).toEqual([[job.id]]);
    expect(h.jobs[0]!.shutdown).not.toHaveBeenCalled(); expect(activeDatabase().open).toBe(true);
    h.events.emit('activate');
    expect(observed.createImports).toHaveBeenCalledOnce();
    expect(observed.registerImports.mock.calls.map((call) => call[4])).toEqual([service, service]);
  });

  it.each(['root', 'child'] as const)('rejects native-picker creation inside cache/jobs (%s) without DB rows or job-file changes', async (selection) => {
    await launch(); await windowReady();
    const { taskRoot, jobDirectory } = seedJobFiles();
    const before = snapshotTree(taskRoot);
    const parentToken = await pick(undefined, selection === 'root' ? taskRoot : jobDirectory);
    const mkdir = vi.spyOn(fs, 'mkdirSync');
    await expect(invoke(PROJECT_CREATE_CHANNEL,
      { name: 'ジョブ領域への作成は禁止', taskType: 'classification', parentToken }))
      .resolves.toEqual({ ok: false, error: { code: 'OPERATION_FAILED' } });
    expect(mkdir).not.toHaveBeenCalled();
    expectTablesEmpty(activeDatabase()); expect(activeDatabase().inTransaction).toBe(false);
    expect(snapshotTree(taskRoot)).toEqual(before);
    expect(fs.readdirSync(h.receiptDirectory)).toEqual([]);
    expect(fs.readFileSync(join(h.resources, 'original.bin'))).toEqual(payloadBytes);
  });

  it.each(['root', 'child'] as const)('rejects native-picker moves into cache/jobs (%s) without source, DB or job-file changes', async (selection) => {
    const project = await seedDatabase(6, (database) => {
      const saved = seedProject(database); fs.writeFileSync(join(saved.workspacePath, 'payload.bin'), payloadBytes); return saved;
    });
    await launch(); await windowReady();
    const database = activeDatabase(), { taskRoot, jobDirectory } = seedJobFiles();
    const jobsBefore = snapshotTree(taskRoot), sourceBefore = snapshotTree(project.workspacePath);
    const rowsBefore = database.prepare('SELECT * FROM projects').all();
    const parent = selection === 'root' ? taskRoot : jobDirectory;
    const parentToken = await pick(project, parent);
    const createReceipt = vi.spyOn(modules.receipts, 'createProjectMoveReceipt');
    await expect(invoke(PROJECT_MOVE_CHANNEL, { projectId: project.id, parentToken }))
      .resolves.toEqual({ ok: false, error: { code: 'OPERATION_FAILED' } });
    expect(createReceipt).not.toHaveBeenCalled();
    expect(database.prepare('SELECT * FROM projects').all()).toEqual(rowsBefore);
    expect(database.prepare('SELECT * FROM jobs').all()).toEqual([]); expect(database.inTransaction).toBe(false);
    expect(snapshotTree(project.workspacePath)).toEqual(sourceBefore);
    expect(snapshotTree(taskRoot)).toEqual(jobsBefore);
    expect(fs.existsSync(join(parent, project.id))).toBe(false);
    expect(fs.readdirSync(h.receiptDirectory)).toEqual([]);
    expect(fs.readFileSync(join(h.resources, 'original.bin'))).toEqual(payloadBytes);
  });

  it('allows native-picker creation beside cache/jobs even when cache already contains another Project', async () => {
    await launch(); await windowReady();
    const database = activeDatabase(), { taskRoot } = seedJobFiles();
    const jobsBefore = snapshotTree(taskRoot), cache = dirname(taskRoot), projects: Project[] = [];
    // The selected parent contains protected jobs/other Projects; each new UUID
    // root is disjoint. Protecting cache itself would incorrectly reject these.
    for (const name of ['先行Project', '兄弟Project']) {
      const parentToken = await pick(undefined, cache);
      const response = projectCreateResponseSchema.parse(await invoke(PROJECT_CREATE_CHANNEL,
        { name, taskType: 'classification', parentToken }));
      if (!response.ok) throw new Error('Expected creation beside, not inside, the job root');
      const project = response.value.project;
      expect(project.workspacePath).toBe(join(cache, project.id));
      expect(modules.directory.verifyProjectDirectory(project.workspacePath, project.id).rootPath).toBe(project.workspacePath);
      expect(fs.readdirSync(project.workspacePath)).toEqual([markerName]);
      projects.push(project);
    }
    expect(modules.service.getProjects(database)).toHaveLength(2);
    for (const project of projects) expect(modules.service.getProject(database, project.id)).toEqual(project);
    expect(fs.readdirSync(cache).sort()).toEqual(['jobs', 'import-selections', ...projects.map(({ id }) => id)].sort());
    expect(snapshotTree(taskRoot)).toEqual(jobsBefore);
    expect(database.prepare('SELECT * FROM jobs').all()).toEqual([]);
    expect(fs.readdirSync(h.receiptDirectory)).toEqual([]);
  });

  it('allows a native-picker move beside cache/jobs without protecting the entire cache', async () => {
    const project = await seedDatabase(6, (database) => {
      const saved = seedProject(database); fs.writeFileSync(join(saved.workspacePath, 'payload.bin'), payloadBytes); return saved;
    });
    await launch(); await windowReady();
    const { taskRoot } = seedJobFiles(), cache = dirname(taskRoot);
    const jobsBefore = snapshotTree(taskRoot), target = join(cache, project.id);
    const parentToken = await pick(project, cache);
    await expect(invoke(PROJECT_MOVE_CHANNEL, { projectId: project.id, parentToken })).resolves.toMatchObject({ ok: true,
      value: { project: { id: project.id, workspacePath: target }, cleanupStatus: 'completed' } });
    expect(modules.service.getProject(activeDatabase(), project.id)).toEqual({ ...project,
      workspacePath: target, updatedAt: expect.any(String) });
    expect(modules.directory.verifyProjectDirectory(target, project.id).rootPath).toBe(target);
    expect(fs.readFileSync(join(target, 'payload.bin'))).toEqual(payloadBytes);
    expect(fs.existsSync(project.workspacePath)).toBe(false);
    expect(fs.readdirSync(cache).sort()).toEqual(['jobs', 'import-selections', project.id].sort());
    expect(snapshotTree(taskRoot)).toEqual(jobsBefore);
    expect(activeDatabase().prepare('SELECT * FROM jobs').all()).toEqual([]);
    expect(fs.readdirSync(h.receiptDirectory)).toEqual([]);
  }, 20_000);

  it('rejects native-picker moves of a Project containing the actual Main job root without source or DB changes', async () => {
    const project = await seedDatabase(6, (database) => {
      const saved = seedProject(database); fs.writeFileSync(join(saved.workspacePath, 'payload.bin'), payloadBytes); return saved;
    });
    // Relocate only the test's configured cache. Main still creates and protects
    // the exact taskRoot; no Project/storage guard is replaced or bypassed.
    observed.paths.mockReturnValue({ ...modules.paths.getAppPaths(h.userData), cache: join(project.workspacePath, 'cache') });
    await launch(); await windowReady();
    const database = activeDatabase(), { taskRoot } = seedJobFiles();
    expect(taskRoot).toBe(join(project.workspacePath, 'cache', 'jobs'));
    const sourceBefore = snapshotTree(project.workspacePath), jobsBefore = snapshotTree(taskRoot);
    const rowsBefore = database.prepare('SELECT * FROM projects').all();
    const parentToken = await pick(project);
    await expect(invoke(PROJECT_MOVE_CHANNEL, { projectId: project.id, parentToken }))
      .resolves.toEqual({ ok: false, error: { code: 'OPERATION_FAILED' } });
    expect(database.prepare('SELECT * FROM projects').all()).toEqual(rowsBefore);
    expect(database.prepare('SELECT * FROM jobs').all()).toEqual([]); expect(database.inTransaction).toBe(false);
    expect(snapshotTree(project.workspacePath)).toEqual(sourceBefore);
    expect(snapshotTree(taskRoot)).toEqual(jobsBefore);
    expect(fs.readdirSync(h.destination)).toEqual([]);
    expect(fs.readdirSync(h.receiptDirectory)).toEqual([]);
  });

  it('exposes real recovered history, initial snapshots and Queued cancellation, revoking navigation-stale subscriptions', async () => {
    const saved = await seedDatabase(6, (database) => {
      const project = seedProject(database);
      const rows = ['Running', 'Preparing', 'Exporting', 'Evaluating', 'Queued', 'Queued', 'Succeeded', 'Cancelled']
        .map((status) => ({ id: randomUUID(), status }));
      for (const row of rows) database.prepare(
        'INSERT INTO jobs(id,project_id,kind,status,created_at,updated_at) VALUES (?,?,?,?,?,?)',
      ).run(row.id, project.id, 'train', row.status, project.createdAt, project.createdAt);
      return { project, rows };
    });
    await launch(); const window = await windowReady(), jobs = h.jobs[0]!, projectId = saved.project.id;
    const history = jobs.list(projectId);
    expect(saved.rows.map(({ id }) => history.find((job) => job.id === id)?.status))
      .toEqual(['Interrupted', 'Failed', 'Failed', 'Failed', 'Queued', 'Queued', 'Succeeded', 'Cancelled']);
    await expect(invoke(JOB_LIST_CHANNEL, { projectId })).resolves.toEqual({ ok: true, value: history });
    const initial = jobSubscribeResponseSchema.parse(await invoke(JOB_SUBSCRIBE_CHANNEL, { projectId }));
    if (!initial.ok) throw new Error('Expected real initial job snapshots');
    expect(initial.value.snapshots).toEqual(history.map((job) => ({ job, progress: null, workerCompleted: false })));
    expect(window.contents.send).not.toHaveBeenCalled();
    const jobId = saved.rows[4]!.id;
    await expect(invoke(JOB_GET_CHANNEL, { projectId, jobId })).resolves.toEqual({ ok: true,
      value: jobs.getSnapshot(projectId, jobId) });
    await expect(invoke(JOB_CANCEL_CHANNEL, { projectId, jobId })).resolves.toMatchObject({ ok: true,
      value: { id: jobId, status: 'Cancelled' } });
    expect(window.contents.send.mock.calls).toEqual([[JOB_CHANGED_CHANNEL, {
      subscriptionId: initial.value.subscriptionId, snapshot: jobs.getSnapshot(projectId, jobId),
    }]]);
    const snapshot = jobs.getSnapshot(projectId, jobId);
    vi.spyOn(jobs, 'getSnapshot').mockImplementationOnce(() => {
      window.contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false, url: rendererURL });
      return snapshot;
    });
    await expect(invoke(JOB_GET_CHANNEL, { projectId, jobId })).resolves.toEqual({ ok: false,
      error: { code: 'STALE_SUBSCRIPTION' } });
    await expect(invoke(JOB_UNSUBSCRIBE_CHANNEL, { projectId, subscriptionId: initial.value.subscriptionId }))
      .resolves.toEqual({ ok: false, error: { code: 'STALE_SUBSCRIPTION' } });
    await invoke(JOB_CANCEL_CHANNEL, { projectId, jobId: saved.rows[5]!.id });
    expect(window.contents.send).toHaveBeenCalledOnce();
    expect(jobs.startScan).not.toHaveBeenCalled(); expect(observed.startWorker).not.toHaveBeenCalled();
    expect(observed.spawn).not.toHaveBeenCalled();
  });

  it('forwards controlled worker progress and terminal notification through the real service, never launching at startup', async () => {
    const project = await seedDatabase(6, (database) => seedProject(database));
    await launch(); const window = await windowReady(), jobs = h.jobs[0]!, projectId = project.id;
    expect(jobs.startScan).not.toHaveBeenCalled(); expect(observed.startWorker).not.toHaveBeenCalled();
    const initial = jobSubscribeResponseSchema.parse(await invoke(JOB_SUBSCRIBE_CHANNEL, { projectId }));
    if (!initial.ok) throw new Error('Expected subscription');
    expect(initial.value.snapshots).toEqual([]);
    // Synthetic transport boundary only: this is not a packaged-worker or scan acceptance test.
    const done = Promise.withResolvers<WorkerResult>();
    h.releases.push(() => done.resolve({ type: 'cancelled' }));
    observed.startWorker.mockImplementationOnce(() => ({ donePromise: done.promise,
      cancel: () => done.resolve({ type: 'cancelled' }) }));
    const run = jobs.startScan(projectId, { taskType: 'classification', mode: 'copy',
      source: { format: 'folder', root: h.parent } });
    h.tasks.push(run.donePromise);
    const worker = observed.startWorker.mock.calls[0]![0];
    worker.onStarted!();
    const progress = { schemaVersion: 1 as const, type: 'progress' as const, source: 'actual' as const,
      projectId, jobId: run.job.id, processed: 1, total: 2 };
    worker.onProgress!(progress);
    await expect(invoke(JOB_GET_CHANNEL, { projectId, jobId: run.job.id })).resolves.toMatchObject({ ok: true,
      value: { job: { status: 'Running' }, progress, workerCompleted: false } });
    done.resolve({ type: 'completed', manifestPath: join(h.userData, 'cache', 'jobs', run.job.id, 'result.json') });
    await run.donePromise;
    expect(jobs.get(projectId, run.job.id)?.status).toBe('Running'); // Transport is not import acceptance.
    await invoke(JOB_CANCEL_CHANNEL, { projectId, jobId: run.job.id });
    expect(window.contents.send).toHaveBeenLastCalledWith(JOB_CHANGED_CHANNEL, {
      subscriptionId: initial.value.subscriptionId,
      snapshot: { job: jobs.get(projectId, run.job.id), progress, workerCompleted: false },
    });
    expect(jobs.getSnapshot(projectId, run.job.id)?.progress).toBeNull();
    await expect(invoke(JOB_UNSUBSCRIBE_CHANNEL, { projectId, subscriptionId: initial.value.subscriptionId }))
      .resolves.toEqual({ ok: true, value: null });
    expect(observed.spawn).not.toHaveBeenCalled();
  });

  it.each([false, true])('awaits job shutdown after IPC drain and keeps DB open if termination rejects (%s)', async (reject) => {
    await launch(); const window = await windowReady(), jobs = h.jobs[0]!;
    const gate = pause(), shutdown = jobs.shutdown.getMockImplementation()!;
    jobs.shutdown.mockImplementationOnce(async () => {
      await gate.hold();
      if (reject) throw new Error(`PRIVATE unconfirmed worker ${h.root}`);
      await shutdown();
    });
    const picker = Promise.withResolvers<OpenDialogReturnValue>();
    h.releases.push(() => picker.resolve({ canceled: true, filePaths: [] }));
    h.showOpenDialog.mockReturnValueOnce(picker.promise);
    const pending = invoke(PROJECT_PICK_PARENT_CHANNEL, { purpose: 'create' });
    const oldList = h.handlers.get(JOB_LIST_CHANNEL)!;
    beforeQuit(); beforeQuit();
    expect(h.handlers.size).toBe(0);
    expect(() => oldList(invocationEvent(window), { projectId: randomUUID() })).toThrow('MAIN_IPC_UNAVAILABLE');
    await Promise.resolve();
    expect(jobs.shutdown).not.toHaveBeenCalled(); expect(h.monitors[0]!.close).not.toHaveBeenCalled();
    picker.resolve({ canceled: true, filePaths: [] }); await pending;
    await gate.reached;
    expect(jobs.shutdown).toHaveBeenCalledOnce(); expect(h.monitors[0]!.close).not.toHaveBeenCalled();
    expect(activeDatabase().open).toBe(true); expect(h.quit).not.toHaveBeenCalled();
    gate.release();
    if (reject) {
      await expect(h.terminal.promise).resolves.toBe('shutdown-failed');
      expectFailure('MAIN_SHUTDOWN_FAILED');
      expect(h.monitors[0]!.close).not.toHaveBeenCalled(); expect(activeDatabase().open).toBe(true);
      expect(h.quit).not.toHaveBeenCalled();
    } else {
      await expectQuit();
      expect(h.sequence.indexOf('jobs:stopped')).toBeLessThan(h.sequence.indexOf('database:close'));
    }
    beforeQuit(); expect(jobs.shutdown).toHaveBeenCalledOnce();
  });

  it('blocks service creation and handlers when job recovery fails, without retrying or spawning', async () => {
    observed.recoverJobs.mockImplementationOnce(() => { throw new Error(`PRIVATE recovery ${h.root}`); });
    await launch(); await expectQuit(); expectFailure('MAIN_STARTUP_FAILED');
    expect(observed.recoverJobs).toHaveBeenCalledOnce(); expect(observed.createJobs).not.toHaveBeenCalled();
    expect(observed.registerJobs).not.toHaveBeenCalled(); expect(h.windows).toEqual([]);
    expect(observed.startWorker).not.toHaveBeenCalled(); expect(observed.spawn).not.toHaveBeenCalled();
  });

  it.each([false, true])('returns only the requested diagnostic observations without changing Project storage (partial=%s)', async (partial) => {
    await launch(); await windowReady();
    const report = diagnosticsReport(partial);
    const service = h.diagnostics[0]!;
    service.collect.mockResolvedValueOnce(report);
    expect(service.collect).not.toHaveBeenCalled();
    await expect(invoke(diagnosticsChannel)).resolves.toEqual(report);
    expect(service.collect.mock.calls).toEqual([[]]);
    expect(service.dispose).not.toHaveBeenCalled();
    await expect(invoke(PROJECT_LIST_CHANNEL)).resolves.toEqual({ ok: true, value: [] });
    expectTablesEmpty(activeDatabase());
    expect(h.showErrorBox).not.toHaveBeenCalled(); expect(h.showOpenDialog).not.toHaveBeenCalled();
  });

  it('exports only after an explicit request and window-bound native approval, never during startup or collection', async () => {
    await launch(); const window = await windowReady(), logs = join(h.userData, 'logs');
    expect(h.showMessageBox).not.toHaveBeenCalled(); expect(fs.readdirSync(logs)).toEqual([]);
    h.diagnostics[0]!.collect.mockResolvedValue(diagnosticsReport());
    await invoke(diagnosticsChannel);
    expect(h.showMessageBox).not.toHaveBeenCalled(); expect(fs.readdirSync(logs)).toEqual([]);
    const prompt = Promise.withResolvers<MessageBoxOptions>(), decision = Promise.withResolvers<MessageBoxReturnValue>();
    h.releases.push(() => decision.resolve({ response: 0, checkboxChecked: false }));
    h.showMessageBox.mockImplementationOnce((owner, options) => {
      expect(owner).toBe(window); prompt.resolve(options); return decision.promise;
    });
    const pending = invoke(DIAGNOSTIC_EXPORT_CHANNEL), options = await prompt.promise;
    expect(options).toMatchObject({ buttons: ['キャンセル', '保存'], defaultId: 0, cancelId: 0 });
    expect(fs.readdirSync(logs)).toEqual([]); expect(activeDatabase().inTransaction).toBe(false);
    decision.resolve({ response: 1, checkboxChecked: false });
    const result = diagnosticExportResultSchema.parse(await pending);
    if (result.status !== 'saved') throw new Error('Expected explicit export');
    expect(dirname(result.path)).toBe(logs); const text = fs.readFileSync(result.path, 'utf8');
    expect(options.detail).toBe(`${text}\n保存先: ${result.path}`);
    expect(text).not.toContain(h.root); expect(text).not.toContain('synthetic');
    expect(fs.readdirSync(logs)).toHaveLength(1); expectTablesEmpty(activeDatabase());
  });

  it('keeps Project creation available after an export probe failure without opening a confirmation', async () => {
    await launch(); await windowReady();
    await expect(invoke(DIAGNOSTIC_EXPORT_CHANNEL)).resolves.toEqual({ status: 'failed', code: 'DIAGNOSTIC_EXPORT_FAILED' });
    expect(h.showMessageBox).not.toHaveBeenCalled(); expect(fs.readdirSync(join(h.userData, 'logs'))).toEqual([]);
    const parentToken = await pick();
    const created = projectCreateResponseSchema.parse(await invoke(PROJECT_CREATE_CHANNEL,
      { name: '書き出し失敗後も作成', taskType: 'classification', parentToken }));
    expect(created.ok).toBe(true); expect(h.quit).not.toHaveBeenCalled();
  });

  it.each(['cancel', 'query-change', 'close', 'quit'] as const)('does not write after %s while the real exporter waits for native confirmation', async (kind) => {
    await launch(); const window = await windowReady(), logs = join(h.userData, 'logs');
    h.diagnostics[0]!.collect.mockResolvedValue(diagnosticsReport());
    const prompt = Promise.withResolvers<MessageBoxOptions>(), decision = Promise.withResolvers<MessageBoxReturnValue>();
    h.releases.push(() => decision.resolve({ response: 0, checkboxChecked: false }));
    h.showMessageBox.mockImplementationOnce((_owner, options) => { prompt.resolve(options); return decision.promise; });
    const pending = invoke(DIAGNOSTIC_EXPORT_CHANNEL), options = await prompt.promise;
    if (kind === 'query-change') {
      window.contents.url = `${rendererURL}?changed=1`; window.contents.frame.url = window.contents.url;
      window.contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true, url: window.contents.url });
    }
    if (kind === 'close') window.destroy();
    if (kind === 'quit') beforeQuit();
    expect(options.signal?.aborted).toBe(kind !== 'cancel');
    expect(h.monitors[0]!.close).not.toHaveBeenCalled();
    decision.resolve({ response: kind === 'cancel' ? 0 : 1, checkboxChecked: false });
    await expect(pending).resolves.toEqual(kind === 'cancel' ? { status: 'cancelled' }
      : { status: 'failed', code: 'DIAGNOSTIC_EXPORT_FAILED' });
    expect(fs.readdirSync(logs)).toEqual([]);
    if (kind === 'quit') await expectQuit();
  });

  it('removes only owned channels and listeners on an export channel registration conflict', async () => {
    const foreign = vi.fn<Parameters<IpcMain['handle']>[1]>(); h.handlers.set(DIAGNOSTIC_EXPORT_CHANNEL, foreign);
    await launch(); await expectQuit(); expectFailure('MAIN_WINDOW_FAILED');
    expect(h.removeHandler.mock.calls).toEqual([...projectChannels, diagnosticsChannel].map((name) => [name]));
    expect([...h.handlers]).toEqual([[DIAGNOSTIC_EXPORT_CHANNEL, foreign]]);
    expect(h.windows[0]!.contents.listenerCount('did-start-navigation')).toBe(0);
    expect(h.showMessageBox).not.toHaveBeenCalled(); expect(h.diagnostics[0]!.dispose).toHaveBeenCalledOnce();
  });

  it.each(['missing-worker', 'probe-failure', 'synchronous-failure'] as const)(
    'keeps native-picker Project creation usable after a diagnostic %s', async (fault) => {
      await launch(); await windowReady();
      const service = h.diagnostics[0]!;
      const failure = Object.assign(new Error(`PRIVATE worker ${h.root}`), {
        code: fault === 'missing-worker' ? 'ENOENT' : 'DIAGNOSTICS_FAILED',
      });
      if (fault === 'synchronous-failure') service.collect.mockImplementationOnce(() => { throw failure; });
      else service.collect.mockRejectedValueOnce(failure);
      await expect(invoke(diagnosticsChannel)).rejects.toMatchObject(diagnosticsFailure);
      expect(service.collect.mock.calls).toEqual([[]]);
      const parentToken = await pick();
      const response = projectCreateResponseSchema.parse(await invoke(PROJECT_CREATE_CHANNEL,
        { name: '診断失敗後のProject', taskType: 'classification', parentToken }));
      if (!response.ok) throw new Error('Diagnostic failure must not prevent Project creation');
      expect(modules.service.getProject(activeDatabase(), response.value.project.id)).toEqual(response.value.project);
      expect(h.showErrorBox).not.toHaveBeenCalled(); expect(h.quit).not.toHaveBeenCalled();
      expect([...h.handlers.keys()]).toEqual(channels);
    },
  );

  it('rejects all supplied diagnostic arguments through the real handler before collecting', async () => {
    await launch(); await windowReady();
    const requests: readonly (readonly unknown[])[] = [
      [undefined], [null], [{}], [{ diskPath: h.parent }],
      [{ executablePath: 'PRIVATE', argsPrefix: ['health'], cwd: h.parent }], ['diagnostics:collect'], [1, 2],
    ];
    for (const args of requests) await expect(invoke(diagnosticsChannel, ...args)).rejects.toMatchObject(diagnosticsFailure);
    expect(h.diagnostics[0]!.collect).not.toHaveBeenCalled();
    await expect(invoke(PROJECT_LIST_CHANNEL)).resolves.toEqual({ ok: true, value: [] });
  });

  it('validates diagnostic sender identity, frame and both URLs through the actual registration', async () => {
    await launch(); const window = await windowReady();
    const listener = h.handlers.get(diagnosticsChannel)!;
    const events: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>[] = [
      { sender: new TestWebContents() as unknown as WebContents, senderFrame: window.contents.mainFrame },
      { sender: window.webContents, senderFrame: { url: rendererURL } as WebFrameMain },
      { sender: window.webContents, senderFrame: null },
    ];
    for (const event of events) await expect(listener(event as IpcMainInvokeEvent)).rejects.toMatchObject(diagnosticsFailure);
    const untrusted = pathToFileURL(join(h.root, 'untrusted.html')).href;
    window.contents.frame.url = untrusted;
    await expect(invoke(diagnosticsChannel)).rejects.toMatchObject(diagnosticsFailure);
    window.contents.frame.url = rendererURL; window.contents.url = untrusted;
    await expect(invoke(diagnosticsChannel)).rejects.toMatchObject(diagnosticsFailure);
    window.contents.url = rendererURL; window.contents.destroyed = true;
    await expect(invoke(diagnosticsChannel)).rejects.toMatchObject(diagnosticsFailure);
    window.contents.destroyed = false;
    const service = h.diagnostics[0]!;
    expect(service.collect).not.toHaveBeenCalled();
    const report = diagnosticsReport(); service.collect.mockResolvedValueOnce(report);
    await expect(invoke(diagnosticsChannel)).resolves.toEqual(report);
    expect(service.collect).toHaveBeenCalledOnce();
  });

  it('awaits each real startup recovery exactly once before allowing window events and does not call none completed', async () => {
    const ids = await seedDatabase(2, (database) => {
      seedProject(database, '先行'); seedProject(database, '後続');
      return modules.service.getProjects(database).map(({ id }) => id);
    });
    const gate = pause();
    observed.recover.mockImplementationOnce(async (...args) => {
      const result = await observed.actualRecover(...args);
      await gate.hold();
      return result;
    });
    await launch();
    try {
      await atGate(gate.reached);
      h.events.emit('activate'); h.events.emit('second-instance');
      expect(observed.recover).toHaveBeenCalledOnce(); expect(observed.register).not.toHaveBeenCalled();
      expect(observed.recoverJobs).not.toHaveBeenCalled(); expect(observed.createJobs).not.toHaveBeenCalled();
      expect(h.windows).toEqual([]); expect(activeDatabase().inTransaction).toBe(false);
    } finally { gate.release(); }
    await windowReady();
    expect(observed.getProjects).toHaveBeenCalledOnce();
    expect(observed.recover.mock.calls).toEqual(ids.map((id) => [activeDatabase(), id, h.receiptDirectory]));
    expect((await Promise.all(observed.recover.mock.results.map((result) => result.value))).map((result) => result.cleanupStatus))
      .toEqual(['none', 'none']);
    h.events.emit('activate'); h.events.emit('second-instance');
    expect(observed.recover).toHaveBeenCalledTimes(2); expect(observed.open).toHaveBeenCalledOnce();
    expect(observed.recoverJobs).toHaveBeenCalledOnce(); expect(observed.createJobs).toHaveBeenCalledOnce();
    expect(h.sequence.indexOf(`recover:settled:${ids[1]}`)).toBeLessThan(h.sequence.indexOf('jobs:recover'));
    expect(h.sequence.indexOf('jobs:recovered')).toBeLessThan(h.sequence.indexOf('jobs:create'));
    expect(h.sequence.indexOf('jobs:create')).toBeLessThan(h.sequence.indexOf(`handle:${JOB_LIST_CHANNEL}`));
    expect(h.showMessageBoxSync).not.toHaveBeenCalled(); expect(warnings).not.toHaveBeenCalled();
  });

  it('recovers a prepared real one-file move from the reopened DB and receipt before loading, preserving other roots', async () => {
    const saved = await seedDatabase(2, async (database) => {
      const project = seedProject(database); const other = seedProject(database, '独立Project');
      fs.writeFileSync(join(project.workspacePath, 'payload.bin'), payloadBytes);
      fs.writeFileSync(join(other.workspacePath, 'keep.bin'), 'other');
      await modules.move.moveProjectDirectory(database, project.id, h.destination, [h.resources], h.receiptDirectory);
      return { project, current: modules.service.getProject(database, project.id), other };
    });
    const target = saved.current.workspacePath;
    expect(fs.existsSync(saved.project.workspacePath)).toBe(true);
    await launch(); await windowReady();
    expect(modules.service.getProject(activeDatabase(), saved.project.id)).toEqual(saved.current);
    expect(fs.existsSync(saved.project.workspacePath)).toBe(false);
    expect(fs.readFileSync(join(target, 'payload.bin'))).toEqual(payloadBytes);
    expect(fs.readdirSync(h.receiptDirectory)).toEqual([]);
    expect(fs.readFileSync(join(saved.other.workspacePath, 'keep.bin'), 'utf8')).toBe('other');
    expect(fs.readFileSync(join(h.resources, 'original.bin'))).toEqual(payloadBytes);
    expect(h.showMessageBoxSync).not.toHaveBeenCalled();
    expect(h.sequence.indexOf(`recover:settled:${saved.project.id}`)).toBeLessThan(h.sequence.indexOf('window:construct'));
  }, 20_000);

  it.each(['copying', 'prepared-at-source', 'corrupt'] as const)('warns with fixed Japanese text and retains unconfirmed %s receipts and bytes', async (phase) => {
    const project = await seedDatabase(2, async (database) => {
      const saved = seedProject(database);
      fs.writeFileSync(join(saved.workspacePath, 'payload.bin'), payloadBytes);
      if (phase === 'copying') {
        const inventory = await modules.move.inventoryProjectMove(modules.directory.verifyProjectDirectory(saved.workspacePath, saved.id), [h.resources]);
        await modules.receipts.createProjectMoveReceipt(h.receiptDirectory, randomUUID(), inventory, join(h.destination, saved.id));
      } else {
        await modules.move.moveProjectDirectory(database, saved.id, h.destination, [h.resources], h.receiptDirectory);
        if (phase === 'prepared-at-source') database.prepare('UPDATE projects SET workspace_path=? WHERE id=?').run(saved.workspacePath, saved.id);
        else fs.writeFileSync(join(h.receiptDirectory, `${saved.id}.json`), `PRIVATE invalid receipt ${h.root}`);
      }
      return saved;
    });
    const receipt = join(h.receiptDirectory, `${project.id}.json`);
    const before = fs.readFileSync(receipt);
    fs.writeFileSync(join(project.workspacePath, 'unknown.bin'), 'unknown, never remove');
    await launch(); await windowReady();
    expect(h.showMessageBoxSync.mock.calls).toEqual([[{ type: 'warning', title: 'AutoVision Studio', message: warning }]]);
    expect(warnings.mock.calls).toEqual([[`MAIN_PROJECT_RECOVERY_PENDING: ${warning}`]]);
    expect(errors).not.toHaveBeenCalled();
    expect(fs.readFileSync(receipt)).toEqual(before);
    expect(fs.readFileSync(join(project.workspacePath, 'payload.bin'))).toEqual(payloadBytes);
    expect(fs.readFileSync(join(project.workspacePath, 'unknown.bin'), 'utf8')).toBe('unknown, never remove');
    const expectedRoot = phase === 'corrupt' ? join(h.destination, project.id) : project.workspacePath;
    expect(modules.service.getProject(activeDatabase(), project.id).workspacePath).toBe(expectedRoot);
    if (phase !== 'copying') expect(fs.readFileSync(join(h.destination, project.id, 'payload.bin'))).toEqual(payloadBytes);
    expect(JSON.stringify([warnings.mock.calls, h.showMessageBoxSync.mock.calls])).not.toContain(JSON.stringify(h.root).slice(1, -1));
    expect(JSON.stringify([warnings.mock.calls, h.showMessageBoxSync.mock.calls])).not.toContain('PRIVATE');
  }, 20_000);

  it.each(['invalid-row', 'corrupt-database', 'newer-schema'] as const)('stops on %s without substituting an empty database or leaking native details', async (fault) => {
    const original = Buffer.from('PRIVATE not a SQLite database');
    if (fault === 'corrupt-database') {
      fs.mkdirSync(h.userData); fs.writeFileSync(h.databasePath, original);
    } else await seedDatabase(7, (database) => {
      const project = seedProject(database);
      if (fault === 'invalid-row') database.prepare('UPDATE projects SET updated_at=? WHERE id=?').run('PRIVATE invalid date', project.id);
      else database.pragma('user_version = 8');
    });
    await launch(); await expectQuit();
    expectFailure('MAIN_STARTUP_FAILED');
    expect(observed.open).toHaveBeenCalledOnce(); expect(observed.recover).not.toHaveBeenCalled();
    expect(observed.register).not.toHaveBeenCalled(); expect(h.windows).toEqual([]);
    expect(fs.readdirSync(h.backupDirectory)).toEqual([]);
    if (fault === 'corrupt-database') expect(fs.readFileSync(h.databasePath)).toEqual(original);
    else readSnapshot(h.databasePath, (copy) => {
      expect(copy.pragma('user_version', { simple: true })).toBe(fault === 'newer-schema' ? 8 : 7);
      expect(copy.prepare('SELECT id FROM projects').all()).toHaveLength(1);
      if (fault === 'invalid-row') expect(copy.prepare('SELECT updated_at FROM projects').get()).toEqual({ updated_at: 'PRIVATE invalid date' });
    });
    expect(fs.readFileSync(join(h.resources, 'original.bin'))).toEqual(payloadBytes);
  });

  it('retains a failed native backup attempt and old DB without entering the migration transaction', async () => {
    const project = await seedDatabase(1, (database) => seedProject(database));
    h.configureDatabase = ({ backup }) => backup.mockRejectedValueOnce(new Error(`PRIVATE backup failure ${h.root}`));
    await launch(); await expectQuit();
    expectFailure('MAIN_STARTUP_FAILED');
    expect(h.monitors[0]!.backup).toHaveBeenCalledOnce(); expect(h.monitors[0]!.exec).not.toHaveBeenCalled();
    expect(observed.getProjects).not.toHaveBeenCalled(); expect(h.handle).not.toHaveBeenCalled();
    readSnapshot(h.databasePath, (copy) => {
      expect(copy.pragma('user_version', { simple: true })).toBe(1);
      expect(modules.service.getProject(copy, project.id)).toEqual(project);
    });
    const attempts = fs.readdirSync(h.backupDirectory);
    expect(attempts).toHaveLength(1);
    expect(fs.readdirSync(join(h.backupDirectory, attempts[0]!))).toEqual(['metadata.sqlite3.partial']);
  });

  it.each([false, true])('closes only after a real SQL failure settles, preserving backup even if rollback fails (%s)', async (failRollback) => {
    const project = await seedDatabase(1, (database) => seedProject(database));
    h.configureDatabase = ({ exec, nativeExec }) => exec.mockImplementation((sql) => {
      if (sql === 'ROLLBACK' && failRollback) throw new Error(`PRIVATE rollback failure ${h.root}`);
      const result = nativeExec(sql);
      if (sql === jobsSql) nativeExec('INSERT INTO missing_ui19m_test_table VALUES (1)'); // Actual SQLite error after actual 002 DDL.
      return result;
    });
    await launch(); await expectQuit();
    expectFailure('MAIN_STARTUP_FAILED');
    expect(observed.getProjects).not.toHaveBeenCalled(); expect(h.handle).not.toHaveBeenCalled();
    const monitor = h.monitors[0]!;
    expect(monitor.exec.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN IMMEDIATE', jobsSql, 'ROLLBACK']);
    expect(monitor.transactionsAtClose).toEqual([failRollback]);
    expect(h.sequence.indexOf('migration:settled')).toBeLessThan(h.sequence.indexOf('database:close'));
    const attempts = fs.readdirSync(h.backupDirectory);
    expect(attempts).toHaveLength(1);
    for (const path of [h.databasePath, join(h.backupDirectory, attempts[0]!, 'metadata.sqlite3')]) {
      readSnapshot(path, (copy) => {
        expect(copy.pragma('user_version', { simple: true })).toBe(1);
        expect(modules.service.getProject(copy, project.id)).toEqual(project);
        expect(copy.prepare("SELECT name FROM sqlite_master WHERE name='jobs'").get()).toBeUndefined();
      });
    }
    // The real native close rolls back any still-open transaction; the Main
    // notification never claims that its failed ROLLBACK was confirmed.
  });

  it('cleans a partial registration and orphan window but never unregisters conflicting or unrelated handlers', async () => {
    const foreign = vi.fn<Parameters<IpcMain['handle']>[1]>();
    h.handlers.set(PROJECT_UPDATE_CHANNEL, foreign); h.handlers.set('unrelated:owned', foreign);
    await launch(); await expectQuit();
    expectFailure('MAIN_WINDOW_FAILED');
    expect(h.removeHandler.mock.calls).toEqual(projectChannels.slice(0, 3).map((channel) => [channel]));
    expect([...h.handlers]).toEqual([[PROJECT_UPDATE_CHANNEL, foreign], ['unrelated:owned', foreign]]);
    expect(h.diagnostics[0]!.dispose).toHaveBeenCalledOnce();
    expect(h.diagnostics[0]!.collect).not.toHaveBeenCalled();
    expect(observed.registerDiagnostics).not.toHaveBeenCalled();
    expect(h.windows).toHaveLength(1); expect(h.windows[0]!.loadFile).not.toHaveBeenCalled();
    expect(h.windows[0]!.destroyed).toBe(true);
    expect(h.windows[0]!.contents.listenerCount('did-start-navigation')).toBe(0);
    h.events.emit('activate'); h.events.emit('second-instance'); beforeQuit();
    expect(h.windows).toHaveLength(1); expect(h.quit).toHaveBeenCalledOnce();
  });

  it('cleans Project registration and diagnostic service on a diagnostic channel conflict without removing its foreign owner', async () => {
    const foreign = vi.fn<Parameters<IpcMain['handle']>[1]>();
    h.handlers.set(diagnosticsChannel, foreign); h.handlers.set('unrelated:owned', foreign);
    await launch(); await expectQuit();
    expectFailure('MAIN_WINDOW_FAILED');
    expect(h.removeHandler.mock.calls).toEqual(projectChannels.map((channel) => [channel]));
    expect([...h.handlers]).toEqual([[diagnosticsChannel, foreign], ['unrelated:owned', foreign]]);
    expect(observed.registerDiagnostics).toHaveBeenCalledOnce();
    expect(h.diagnostics[0]!.dispose).toHaveBeenCalledOnce();
    expect(h.diagnostics[0]!.collect).not.toHaveBeenCalled();
    expect(h.windows[0]!.loadFile).not.toHaveBeenCalled(); expect(h.windows[0]!.destroyed).toBe(true);
    expect(h.windows[0]!.contents.listenerCount('did-start-navigation')).toBe(0);
  });

  it('handles an asynchronous renderer load rejection with fixed diagnostics and a single controlled shutdown', async () => {
    const load = pendingLoad();
    await launch(); await windowReady();
    load.reject(new Error(`PRIVATE renderer failure ${h.root}`));
    await expectQuit();
    expectFailure('MAIN_WINDOW_FAILED');
    expect(h.removeHandler.mock.calls).toEqual(channels.map((channel) => [channel]));
    expect(h.diagnostics[0]!.dispose).toHaveBeenCalledOnce();
    h.events.emit('activate'); h.events.emit('second-instance'); h.events.emit('window-all-closed'); beforeQuit();
    expect(h.windows).toHaveLength(1); expect(h.quit).toHaveBeenCalledOnce();
    expect(h.monitors[0]!.close).toHaveBeenCalledOnce();
  });

  it('prevents repeated quit before Electron ready and does not open storage when ready eventually resolves', async () => {
    await launch(false);
    expect(beforeQuit().defaultPrevented).toBe(true);
    expect(beforeQuit().defaultPrevented).toBe(true);
    h.events.emit('activate'); h.events.emit('second-instance');
    expect(h.quit).not.toHaveBeenCalled(); expect(observed.open).not.toHaveBeenCalled();
    h.ready.resolve(); await expectQuit();
    expect(h.getPath).not.toHaveBeenCalled(); expect(fs.existsSync(h.userData)).toBe(false);
    expect(observed.createJobs).not.toHaveBeenCalled(); expect(observed.recoverJobs).not.toHaveBeenCalled();
    expect(observed.startWorker).not.toHaveBeenCalled(); expect(observed.spawn).not.toHaveBeenCalled();
    expect(h.windows).toEqual([]); expect(h.handle).not.toHaveBeenCalled();
  });

  it('waits for native backup/migration on quit and suppresses all subsequent recovery and window startup', async () => {
    const gate = pause();
    h.configureDatabase = ({ backup, nativeBackup }) => {
      backup.mockImplementationOnce(async (...args) => { await gate.hold(); return nativeBackup(...args); });
    };
    await launch();
    try {
      await atGate(gate.reached);
      expect(beforeQuit().defaultPrevented).toBe(true); expect(beforeQuit().defaultPrevented).toBe(true);
      h.events.emit('activate'); h.events.emit('second-instance');
      await Promise.resolve();
      expect(activeDatabase().open).toBe(true); expect(h.monitors[0]!.close).not.toHaveBeenCalled();
      expect(h.quit).not.toHaveBeenCalled(); expect(h.windows).toEqual([]);
    } finally { gate.release(); }
    await expectQuit();
    expect(observed.getProjects).not.toHaveBeenCalled(); expect(observed.recover).not.toHaveBeenCalled();
    expect(observed.register).not.toHaveBeenCalled(); expect(h.windows).toEqual([]);
    expect(observed.createJobs).not.toHaveBeenCalled(); expect(observed.recoverJobs).not.toHaveBeenCalled();
    expect(h.sequence.indexOf('migration:settled')).toBeLessThan(h.sequence.indexOf('database:close'));
    expect(h.sequence.indexOf('database:close')).toBeLessThan(h.sequence.indexOf('app:quit'));
    readSnapshot(h.databasePath, expectTablesEmpty);
  });

  it('disposes each window once without closing DB, recreates with the same connection, and ignores delayed loads after app shutdown', async () => {
    const load = pendingLoad();
    const foreign = vi.fn<Parameters<IpcMain['handle']>[1]>(); h.handlers.set('unrelated:owned', foreign);
    await launch(); const first = await windowReady();
    const oldList = h.handlers.get(PROJECT_LIST_CHANNEL)!;
    const oldDiagnostics = h.handlers.get(diagnosticsChannel)!;
    first.destroy(); first.emit('closed'); first.contents.emit('destroyed');
    expect(h.monitors[0]!.close).not.toHaveBeenCalled(); expect(activeDatabase().open).toBe(true);
    expect(h.removeHandler.mock.calls).toEqual(destroyedChannels.map((channel) => [channel]));
    h.events.emit('activate');
    const second = h.windows[1]!;
    expect(h.windows).toHaveLength(2); expect(second.destroyed).toBe(false);
    expect(observed.register.mock.calls[1]![3]).toBe(activeDatabase());
    expect(observed.createJobs).toHaveBeenCalledOnce(); expect(observed.recoverJobs).toHaveBeenCalledOnce();
    expect(observed.registerJobs.mock.calls.map((call) => call[3])).toEqual([h.jobs[0], h.jobs[0]]);
    expect(observed.createImports).toHaveBeenCalledOnce();
    expect(observed.registerImports.mock.calls.map((call) => call[4])).toEqual([h.imports[0], h.imports[0]]);
    expect(h.jobs[0]!.shutdown).not.toHaveBeenCalled();
    expect(() => oldList(invocationEvent(first))).toThrow('MAIN_IPC_UNAVAILABLE');
    expect(() => oldDiagnostics(invocationEvent(first))).toThrow('MAIN_IPC_UNAVAILABLE');
    expect(h.diagnostics).toHaveLength(2); expect(h.diagnostics[0]).not.toBe(h.diagnostics[1]);
    expect(h.diagnostics[0]!.dispose).toHaveBeenCalledOnce(); expect(h.diagnostics[1]!.dispose).not.toHaveBeenCalled();
    expect(observed.registerDiagnostics.mock.calls[1]!.slice(1)).toEqual([second.webContents, rendererURL, h.diagnostics[1]]);
    first.emit('closed'); first.contents.emit('destroyed');
    expect([...h.handlers.keys()]).toEqual(['unrelated:owned', ...channels]);
    second.isMinimized.mockReturnValue(true); h.events.emit('second-instance'); h.events.emit('activate');
    expect(second.restore).toHaveBeenCalledOnce(); expect(second.focus).toHaveBeenCalledOnce();
    expect(observed.open).toHaveBeenCalledOnce(); expect(observed.migrate).toHaveBeenCalledOnce();
    second.destroy(); h.events.emit('window-all-closed');
    load.resolve(); await expectQuit();
    expect([...h.handlers]).toEqual([['unrelated:owned', foreign]]);
    expect(h.removeHandler.mock.calls).toEqual([...destroyedChannels, ...destroyedChannels].map((channel) => [channel]));
    for (const service of h.diagnostics) {
      expect(service.dispose).toHaveBeenCalledOnce(); expect(service.collect).not.toHaveBeenCalled();
    }
    h.events.emit('activate'); h.events.emit('second-instance');
    expect(h.windows).toHaveLength(2); expect(h.quit).toHaveBeenCalledOnce();
  });

  it.each(['closed', 'destroyed'] as const)('disposes diagnostics on %s alone, once, without closing Project storage', async (event) => {
    await launch(); const window = await windowReady();
    const captured = h.handlers.get(diagnosticsChannel)!;
    const emitter = event === 'closed' ? window : window.contents;
    emitter.emit(event); emitter.emit(event);
    expect(h.removeHandler.mock.calls).toEqual((event === 'destroyed' ? destroyedChannels : channels).map((channel) => [channel]));
    expect(h.diagnostics[0]!.dispose).toHaveBeenCalledOnce();
    expect(h.diagnostics[0]!.collect).not.toHaveBeenCalled();
    expect(() => captured(invocationEvent(window))).toThrow('MAIN_IPC_UNAVAILABLE');
    expect(activeDatabase().open).toBe(true); expect(h.monitors[0]!.close).not.toHaveBeenCalled();
    beforeQuit(); await expectQuit();
    expect(h.diagnostics[0]!.dispose).toHaveBeenCalledOnce();
  });

  it('withholds a late diagnostic result after close even when best-effort disposal has not settled that work', async () => {
    await launch(); const window = await windowReady();
    const pending = Promise.withResolvers<HardwareDiagnostics>();
    const report = diagnosticsReport(); h.releases.push(() => pending.resolve(report));
    h.diagnostics[0]!.collect.mockReturnValueOnce(pending.promise);
    const response = invoke(diagnosticsChannel);
    window.emit('closed');
    expect(h.diagnostics[0]!.dispose).toHaveBeenCalledOnce();
    expect(h.monitors[0]!.close).not.toHaveBeenCalled();
    pending.resolve(report);
    await expect(response).rejects.toMatchObject(diagnosticsFailure);
  });

  it('rejects pending diagnostics on stop while preserving the admitted Project picker drain before DB close', async () => {
    await launch(); await windowReady();
    const diagnostic = Promise.withResolvers<HardwareDiagnostics>();
    const picker = Promise.withResolvers<OpenDialogReturnValue>();
    h.releases.push(() => diagnostic.resolve(diagnosticsReport()), () => picker.resolve({ canceled: true, filePaths: [] }));
    const service = h.diagnostics[0]!;
    service.collect.mockReturnValueOnce(diagnostic.promise);
    service.dispose.mockImplementation(() => {
      h.sequence.push('diagnostics:dispose');
      // Model the existing cancellation contract, not confirmation of child exit.
      diagnostic.reject(new Error('PRIVATE synthetic stop request'));
    });
    h.showOpenDialog.mockReturnValueOnce(picker.promise);
    const pendingDiagnostic = invoke(diagnosticsChannel);
    const pendingPicker = invoke(PROJECT_PICK_PARENT_CHANNEL, { purpose: 'create' });
    expect(beforeQuit().defaultPrevented).toBe(true); beforeQuit();
    await expect(pendingDiagnostic).rejects.toMatchObject(diagnosticsFailure);
    expect(service.collect).toHaveBeenCalledOnce(); expect(service.dispose).toHaveBeenCalledOnce();
    expect(h.handlers.size).toBe(0); expect(activeDatabase().open).toBe(true);
    expect(h.monitors[0]!.close).not.toHaveBeenCalled(); expect(h.quit).not.toHaveBeenCalled();
    picker.resolve({ canceled: true, filePaths: [] });
    await expect(pendingPicker).resolves.toEqual({ ok: false, error: { code: 'STALE_SELECTION' } });
    await expectQuit();
    expect(h.sequence.indexOf('diagnostics:dispose')).toBeLessThan(h.sequence.indexOf('database:close'));
    expect(h.sequence.indexOf('database:close')).toBeLessThan(h.sequence.indexOf('app:quit'));
    expect(service.dispose).toHaveBeenCalledOnce();
  });

  it('still removes both channel families when diagnostic disposal throws and reports shutdown as unconfirmed', async () => {
    await launch(); await windowReady();
    h.diagnostics[0]!.dispose.mockImplementationOnce(() => { throw new Error(`PRIVATE dispose ${h.root}`); });
    beforeQuit();
    await expect(h.terminal.promise).resolves.toBe('shutdown-failed');
    expectFailure('MAIN_SHUTDOWN_FAILED');
    expect(h.removeHandler.mock.calls).toEqual(channels.map((channel) => [channel]));
    expect(h.diagnostics[0]!.dispose).toHaveBeenCalledOnce();
    expect(h.monitors[0]!.close).not.toHaveBeenCalled(); expect(h.quit).not.toHaveBeenCalled();
    expect(h.jobs[0]!.shutdown).toHaveBeenCalledOnce();
    beforeQuit(); expect(h.diagnostics[0]!.dispose).toHaveBeenCalledOnce();
  });

  it('waits for a pending native picker, rejects every captured callback after closing and disposes no foreign owner', async () => {
    await launch(); const window = await windowReady();
    const foreign = vi.fn<Parameters<IpcMain['handle']>[1]>();
    h.handlers.set('unrelated:owned', foreign);
    const picker = Promise.withResolvers<OpenDialogReturnValue>();
    h.releases.push(() => picker.resolve({ canceled: true, filePaths: [] }));
    h.showOpenDialog.mockReturnValueOnce(picker.promise);
    const callbacks = channels.map((channel) => h.handlers.get(channel)!);
    const pending = invoke(PROJECT_PICK_PARENT_CHANNEL, { purpose: 'create' });
    expect(h.showOpenDialog).toHaveBeenCalledOnce(); expect(activeDatabase().inTransaction).toBe(false);
    expect(beforeQuit().defaultPrevented).toBe(true);
    window.destroy(); expect(beforeQuit().defaultPrevented).toBe(true);
    for (const listener of callbacks) expect(() => listener(invocationEvent(window))).toThrow('MAIN_IPC_UNAVAILABLE');
    await Promise.resolve();
    expect(h.monitors[0]!.close).not.toHaveBeenCalled(); expect(h.quit).not.toHaveBeenCalled();
    picker.resolve({ canceled: false, filePaths: [h.parent] });
    await expect(pending).resolves.toEqual({ ok: false, error: { code: 'STALE_SELECTION' } });
    await expectQuit();
    expect(h.showOpenDialog).toHaveBeenCalledOnce();
    expect([...h.handlers]).toEqual([['unrelated:owned', foreign]]);
    expect(fs.readdirSync(h.parent)).toEqual([]);
    readSnapshot(h.databasePath, expectTablesEmpty);
  });

  it('keeps DB open for an admitted real move held before prepared, even after window destruction and repeated quit', async () => {
    const project = await seedDatabase(2, (database) => {
      const saved = seedProject(database); fs.writeFileSync(join(saved.workspacePath, 'payload.bin'), payloadBytes); return saved;
    });
    await launch(); const window = await windowReady();
    const parentToken = await pick(project);
    const gate = pause(); const update = modules.receipts.updateProjectMoveReceipt;
    let paused = false;
    vi.spyOn(modules.receipts, 'updateProjectMoveReceipt').mockImplementation(async (...args) => {
      if (!paused && args[1].phase === 'prepared') { paused = true; await gate.hold(); }
      return update(...args);
    });
    const pending = invoke(PROJECT_MOVE_CHANNEL, { projectId: project.id, parentToken });
    const completed = pending.then(
      () => { h.sequence.push('move:settled'); },
      () => { h.sequence.push('move:settled'); },
    );
    h.tasks.push(completed);
    try {
      await Promise.race([gate.reached, pending.then(() => { throw new Error('Move settled before prepared gate'); })]);
      expect(modules.receipts.decodeProjectMoveReceipt(fs.readFileSync(join(h.receiptDirectory, `${project.id}.json`))).phase).toBe('copying');
      expect(modules.service.getProject(activeDatabase(), project.id).workspacePath).toBe(project.workspacePath);
      expect(activeDatabase().inTransaction).toBe(false);
      expect(beforeQuit().defaultPrevented).toBe(true); window.destroy();
      expect(beforeQuit().defaultPrevented).toBe(true);
      h.events.emit('activate'); h.events.emit('second-instance'); h.events.emit('window-all-closed');
      await Promise.resolve();
      expect(h.monitors[0]!.close).not.toHaveBeenCalled(); expect(h.quit).not.toHaveBeenCalled();
    } finally { gate.release(); await pending; }
    await expect(pending).resolves.toEqual({ ok: false, error: { code: 'STALE_SELECTION' } });
    await expectQuit(); await completed;
    const target = join(h.destination, project.id);
    expect(fs.readFileSync(join(target, 'payload.bin'))).toEqual(payloadBytes);
    expect(fs.existsSync(project.workspacePath)).toBe(false); expect(fs.readdirSync(h.receiptDirectory)).toEqual([]);
    expect(h.sequence.indexOf('move:settled')).toBeLessThan(h.sequence.indexOf('database:close'));
    readSnapshot(h.databasePath, (copy) => expect(modules.service.getProject(copy, project.id).workspacePath).toBe(target));
    expect(h.windows).toHaveLength(1); expect(fs.readFileSync(join(h.resources, 'original.bin'))).toEqual(payloadBytes);
  }, 20_000);

  it.each(['startup', 'request'] as const)('drains real %s recovery from a paused receipt read before close, without starting another window', async (kind) => {
    const project = await seedDatabase(2, async (database) => {
      const saved = seedProject(database); fs.writeFileSync(join(saved.workspacePath, 'payload.bin'), payloadBytes);
      if (kind === 'startup') await modules.move.moveProjectDirectory(database, saved.id, h.destination, [h.resources], h.receiptDirectory);
      return saved;
    });
    if (kind === 'request') {
      await launch(); await windowReady();
      await modules.move.moveProjectDirectory(activeDatabase(), project.id, h.destination, [h.resources], h.receiptDirectory);
    }
    const gate = pause(); const nativeOpen = asyncFs.open.bind(asyncFs); let paused = false;
    const receiptPath = join(h.receiptDirectory, `${project.id}.json`);
    vi.spyOn(asyncFs, 'open').mockImplementation(async (...args) => {
      const handle = await nativeOpen(...args);
      if (!paused && args[0] === receiptPath && args[1] === 'r') { paused = true; await gate.hold(); }
      return handle;
    });
    if (kind === 'startup') await launch();
    const pending = kind === 'request' ? invoke(PROJECT_RECOVER_CHANNEL, { projectId: project.id }) : undefined;
    try {
      await atGate(gate.reached, pending);
      expect(beforeQuit().defaultPrevented).toBe(true);
      for (const window of h.windows) window.destroy();
      h.events.emit('activate'); h.events.emit('second-instance'); beforeQuit();
      await Promise.resolve();
      expect(activeDatabase().open).toBe(true); expect(h.monitors[0]!.close).not.toHaveBeenCalled();
      expect(fs.existsSync(project.workspacePath)).toBe(true); expect(h.quit).not.toHaveBeenCalled();
    } finally { gate.release(); if (pending) await pending; }
    if (pending) await expect(pending).resolves.toEqual({ ok: false, error: { code: 'STALE_SELECTION' } });
    await expectQuit();
    expect(fs.existsSync(project.workspacePath)).toBe(false); expect(fs.existsSync(receiptPath)).toBe(false);
    expect(fs.readFileSync(join(h.destination, project.id, 'payload.bin'))).toEqual(payloadBytes);
    expect(h.windows).toHaveLength(kind === 'startup' ? 0 : 1);
    expect(h.sequence.lastIndexOf(`recover:settled:${project.id}`)).toBeLessThan(h.sequence.indexOf('database:close'));
  }, 20_000);

  it('reports an unconfirmed close without forcing quit, deleting WAL/backup or automatically retrying close', async () => {
    await launch(); await windowReady();
    const monitor = h.monitors[0]!;
    const before = new Map([h.databasePath, `${h.databasePath}-wal`].map((path) => [path, fs.readFileSync(path)]));
    const backups = fs.readdirSync(h.backupDirectory);
    monitor.close.mockImplementation(() => { throw new Error(`PRIVATE close failure ${h.root}`); });
    expect(beforeQuit().defaultPrevented).toBe(true);
    await expect(h.terminal.promise).resolves.toBe('shutdown-failed');
    expectFailure('MAIN_SHUTDOWN_FAILED');
    expect(monitor.close).toHaveBeenCalledOnce(); expect(monitor.database.open).toBe(true);
    expect(h.quit).not.toHaveBeenCalled(); expect(h.handlers.size).toBe(0);
    for (const [path, bytes] of before) expect(fs.readFileSync(path)).toEqual(bytes);
    expect(fs.readdirSync(h.backupDirectory)).toEqual(backups);
    expect(beforeQuit().defaultPrevented).toBe(true);
    h.events.emit('activate'); h.events.emit('second-instance'); h.events.emit('window-all-closed');
    await Promise.resolve();
    expect(monitor.close).toHaveBeenCalledOnce(); expect(h.quit).not.toHaveBeenCalled(); expect(h.windows).toHaveLength(1);
    // Only afterEach, outside the application's shutdown path, closes the
    // intentionally faulted test connection so disposable files can be removed.
  });
});