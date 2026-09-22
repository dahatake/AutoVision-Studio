// @vitest-environment node
import type { Dialog, IpcMain, IpcMainInvokeEvent, WebContents, WebFrameMain } from 'electron';
import childProcess from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ScanImage, ScanResult } from '../../shared/contracts/import.js';
import {
  REFERENCE_RELINK_CHANNEL, REFERENCE_STATUS_CHANNEL, referenceStatusResponseSchema,
} from '../../shared/contracts/reference-ipc.js';
import { insertDataImport, prepareDataImport } from '../data/import-repository.js';
import { captureReferenceSource } from '../data/reference-access.js';
import * as referenceSource from '../data/reference-source.js';
import { openDatabase, type DatabaseConnection } from '../db/database.js';
import { migrateDatabase } from '../db/migrate.js';
import { registerReferenceHandlers } from './reference-handlers.js';

const url = 'file:///C:/Synthetic/app/index.html';
const migrationsDirectory = fileURLToPath(new URL('../db/migrations/', import.meta.url));

/** Worker threads expose process.env with the OS's raw key casing, so a
 * case-sensitive read of SystemRoot misses it even when the variable is set. */
function systemRoot(): string {
  const key = Object.keys(process.env).find((name) => name.toLowerCase() === 'systemroot');
  const value = key === undefined ? undefined : process.env[key];
  if (typeof value !== 'string' || value.length === 0) throw new Error('SystemRoot is required for this fixture.');
  return value;
}
const projectId = '01234567-89ab-4cde-8f01-23456789abcd';
const jobId = 'ae45cf74-c9f9-4c49-88b9-0523b1ac7383';
const importId = '9b2db431-04e9-488b-b4c2-3859fd26cb6e';
const at = '2026-09-12T05:30:00.123Z';
const fail = (code: string) => ({ ok: false, error: { code } });
const relinkInput = { projectId, importId, imageKey: 'image:0' } as const;

let localVolume = '';
let directory: string;
let database: DatabaseConnection;
let candidatePath: string;
let bindings: { dispose(): void }[];

function transaction<T>(connection: DatabaseConnection, action: () => T): T {
  connection.exec('BEGIN IMMEDIATE');
  try { const value = action(); connection.exec('COMMIT'); return value; }
  catch (error) { if (connection.inTransaction) connection.exec('ROLLBACK'); throw error; }
}

function harness(showOpenDialog = vi.fn<Dialog['showOpenDialog']>()
  .mockResolvedValue({ canceled: false, filePaths: [candidatePath] })) {
  const frame = { url };
  const state = Object.assign(new EventEmitter(), {
    mainFrame: frame as WebFrameMain, getURL: vi.fn(() => url), isDestroyed: vi.fn(() => false),
  });
  const contents = state as unknown as WebContents;
  const event = { sender: contents, senderFrame: frame as WebFrameMain | null };
  const handlers = new Map<string, Parameters<IpcMain['handle']>[1]>();
  const ipc = {
    handle: vi.fn<IpcMain['handle']>((channel, listener) => { handlers.set(channel, listener); }),
    removeHandler: vi.fn<IpcMain['removeHandler']>((channel) => { handlers.delete(channel); }),
  };
  const binding = registerReferenceHandlers(ipc, contents, url, database, { showOpenDialog });
  bindings.push(binding);
  const captured = new Map(handlers);
  const call = (channel: string, ...args: unknown[]): unknown =>
    captured.get(channel)!(event as IpcMainInvokeEvent, ...args);
  return { frame, state, event, showOpenDialog, binding, call };
}

describe.skipIf(process.platform !== 'win32')('Reference relink failure classification', () => {
  beforeAll(() => {
    localVolume = childProcess.execFileSync(win32.join(systemRoot(), 'System32', 'mountvol.exe'),
      [win32.parse(realpathSync.native(tmpdir())).root, '/L'],
      { shell: false, windowsHide: true, encoding: 'utf8', timeout: 5_000, maxBuffer: 4_096 });
  });

  beforeEach(async () => {
    bindings = [];
    // Only the OS volume probe is substituted; the source bytes, identity and
    // streamed SHA-256 all come from a real temporary file.
    vi.spyOn(childProcess, 'execFile').mockImplementation((_file, _args, _options, callback) => {
      if (!callback) throw new Error('Expected mountvol callback.');
      const child = new childProcess.ChildProcess();
      queueMicrotask(() => { callback(null, localVolume, ''); child.emit('close', 0, null); });
      return child;
    });
    vi.spyOn(childProcess, 'spawnSync').mockReturnValue({
      pid: 0, status: 0, signal: null, stdout: localVolume, stderr: '',
      output: [null, localVolume, ''],
    });
    directory = realpathSync.native(mkdtempSync(join(tmpdir(), 'autovision-refh-relink-')));
    const sourcePath = join(directory, 'source.bin');
    candidatePath = join(directory, 'candidate.bin');
    const bytes = Buffer.from('real Reference relink classification fixture');
    writeFileSync(sourcePath, bytes, { flag: 'wx' });
    writeFileSync(candidatePath, bytes, { flag: 'wx' });
    const image: ScanImage = {
      key: 'image:0', sourcePath, byteSize: bytes.length,
      mtimeNs: String(lstatSync(sourcePath, { bigint: true }).mtimeNs),
      sha256: createHash('sha256').update(bytes).digest('hex'), format: 'png',
      width: 32, height: 24, orientation: 1, duplicateOf: null, annotation: null,
    };
    const source = await captureReferenceSource(image);
    const scan: ScanResult = {
      formatVersion: 1, jobId, projectId, taskType: 'classification', mode: 'reference',
      classes: [], images: [image], issues: [],
    };
    database = openDatabase(join(directory, 'metadata.sqlite3'));
    migrateDatabase(database, ['001_core', '002_jobs', '003_import', '004_import_generation', '005_import_rights',
      '006_annotations', '007_annotation_target_history'].map((name, index) => ({
      version: index + 1,
      sql: readFileSync(join(migrationsDirectory, `${name}.sql`), 'utf8'),
    })));
    database.prepare(`INSERT INTO projects(id,name,task_type,workspace_path,created_at,updated_at)
      VALUES (?,?,?,?,?,?)`).run(projectId, 'Relink fixture', 'classification', directory, at, at);
    database.prepare(`INSERT INTO jobs(id,project_id,kind,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?)`).run(jobId, projectId, 'scan-dataset', 'Succeeded', at, at);
    const prepared = prepareDataImport({
      id: importId, createdAt: at, updatedAt: at, scanResult: scan,
      sourceManifest: { formatVersion: 1, mode: 'reference', entries: [source] },
    });
    transaction(database, () => insertDataImport(database, prepared));
  });

  afterEach(() => {
    for (const binding of bindings) binding.dispose();
    database.close();
    vi.restoreAllMocks();
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });

  it('inspects the stored Reference source and reports it as verifiable', async () => {
    const h = harness();
    const parsed = referenceStatusResponseSchema.parse(await h.call(REFERENCE_STATUS_CHANNEL, { projectId }));
    expect(parsed).toEqual({ ok: true, value: { projectId, inspectedImports: 1, checked: 1, broken: [] } });
  });

  it('reports a genuinely different file as a mismatch, not as an unknown failure', async () => {
    const other = join(directory, 'other.bin');
    writeFileSync(other, Buffer.from('a different file with different bytes'), { flag: 'wx' });
    const h = harness(vi.fn<Dialog['showOpenDialog']>()
      .mockResolvedValue({ canceled: false, filePaths: [other] }));
    expect(await h.call(REFERENCE_RELINK_CHANNEL, relinkInput)).toEqual(fail('MISMATCH'));
  });

  it('reports an unreadable candidate as a mismatch the user can answer by picking again', async () => {
    const h = harness(vi.fn<Dialog['showOpenDialog']>()
      .mockResolvedValue({ canceled: false, filePaths: [join(directory, 'absent.bin')] }));
    expect(await h.call(REFERENCE_RELINK_CHANNEL, relinkInput)).toEqual(fail('MISMATCH'));
  });

  it('never presents an unconfirmed database outcome as a wrong-file answer', async () => {
    // AggregateError is what the service raises when it cannot confirm whether
    // the write was rolled back. Telling the user "pick the same file again"
    // would hide an unknown state.
    vi.spyOn(referenceSource, 'relinkReferenceSource').mockRejectedValue(
      new AggregateError([new Error('write failed')],
        'Reference relinkに失敗し、DB rollbackも確認できませんでした。再試行せず一覧を再取得してください。'));
    const h = harness();
    expect(await h.call(REFERENCE_RELINK_CHANNEL, relinkInput)).toEqual(fail('OPERATION_FAILED'));
  });

  it('never presents an unexpected service failure as a wrong-file answer', async () => {
    vi.spyOn(referenceSource, 'relinkReferenceSource')
      .mockRejectedValue(new Error('Reference relink cannot join an existing transaction.'));
    const h = harness();
    expect(await h.call(REFERENCE_RELINK_CHANNEL, relinkInput)).toEqual(fail('OPERATION_FAILED'));
  });

  it('accepts an identical file at another path and reports the relinked target', async () => {
    const moved = join(directory, 'moved.bin');
    writeFileSync(moved, readFileSync(candidatePath), { flag: 'wx' });
    const h = harness(vi.fn<Dialog['showOpenDialog']>()
      .mockResolvedValue({ canceled: false, filePaths: [moved] }));
    expect(await h.call(REFERENCE_RELINK_CHANNEL, relinkInput))
      .toEqual({ ok: true, value: { status: 'relinked', importId, imageKey: 'image:0' } });
  });

  it('treats a cancelled picker as no change at all', async () => {
    const h = harness(vi.fn<Dialog['showOpenDialog']>().mockResolvedValue({ canceled: true, filePaths: [] }));
    expect(await h.call(REFERENCE_RELINK_CHANNEL, relinkInput)).toEqual({ ok: true, value: { status: 'cancelled' } });
  });

  it('refuses more than one selected file instead of guessing which one was meant', async () => {
    const h = harness(vi.fn<Dialog['showOpenDialog']>()
      .mockResolvedValue({ canceled: false, filePaths: [candidatePath, candidatePath] }));
    expect(await h.call(REFERENCE_RELINK_CHANNEL, relinkInput)).toEqual(fail('INVALID_REQUEST'));
  });
});
