// @vitest-environment node
import type { Dialog, IpcMain, IpcMainInvokeEvent, WebContents, WebFrameMain } from 'electron';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  REFERENCE_RELINK_CHANNEL, REFERENCE_STATUS_CHANNEL, referenceStatusResponseSchema,
} from '../../shared/contracts/reference-ipc.js';
import { openDatabase, type DatabaseConnection } from '../db/database.js';
import { migrateDatabase } from '../db/migrate.js';
import { registerReferenceHandlers } from './reference-handlers.js';

const url = 'file:///C:/Synthetic/app/index.html';
const migrationsDirectory = fileURLToPath(new URL('../db/migrations/', import.meta.url));
const channels = [REFERENCE_STATUS_CHANNEL, REFERENCE_RELINK_CHANNEL];
const fail = (code: string) => ({ ok: false, error: { code } });
let db: DatabaseConnection;
let directory: string;
let projectId: string;
let importId: string;
let bindings: { dispose(): void }[];

function harness() {
  const frame = { url };
  const state = Object.assign(new EventEmitter(), {
    mainFrame: frame as WebFrameMain,
    getURL: vi.fn(() => url),
    isDestroyed: vi.fn(() => false),
  });
  const contents = state as unknown as WebContents;
  const event = { sender: contents, senderFrame: frame as WebFrameMain | null };
  const handlers = new Map<string, Parameters<IpcMain['handle']>[1]>();
  const ipc = {
    handle: vi.fn<IpcMain['handle']>((channel, listener) => {
      if (handlers.has(channel)) throw new Error('owned');
      handlers.set(channel, listener);
    }),
    removeHandler: vi.fn<IpcMain['removeHandler']>((channel) => { handlers.delete(channel); }),
  };
  // A genuine spy: every assertion below checks whether the OS picker was
  // reached, because opening it for an unverified request is the real risk.
  const showOpenDialog = vi.fn<Dialog['showOpenDialog']>()
    .mockResolvedValue({ canceled: true, filePaths: [] });
  const binding = registerReferenceHandlers(ipc, contents, url, db, { showOpenDialog });
  bindings.push(binding);
  const captured = new Map(handlers);
  const call = (channel: string, ...args: unknown[]): unknown =>
    captured.get(channel)!(event as IpcMainInvokeEvent, ...args);
  return { frame, state, contents, event, handlers, ipc, binding, showOpenDialog, call };
}

beforeEach(() => {
  bindings = [];
  directory = mkdtempSync(join(tmpdir(), 'refh-'));
  db = openDatabase(join(directory, 'db.sqlite3'));
  migrateDatabase(db, ['001_core', '002_jobs', '003_import', '004_import_generation', '005_import_rights',
    '006_annotations', '007_annotation_target_history'].map((name, index) => ({
    version: index + 1,
    sql: readFileSync(join(migrationsDirectory, `${name}.sql`), 'utf8'),
  })));
  projectId = randomUUID();
  importId = randomUUID();
});

afterEach(() => {
  for (const binding of bindings) binding.dispose();
  db.close();
  rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

describe('Reference IPC boundary', () => {
  it('registers exactly two channels and disposes only its own, once', () => {
    const h = harness();
    expect(h.ipc.handle.mock.calls.map(([channel]) => channel)).toEqual(channels);
    for (const event of ['did-start-navigation', 'render-process-gone', 'destroyed']) {
      expect(h.state.listenerCount(event)).toBe(1);
    }
    h.binding.dispose();
    h.binding.dispose();
    expect(h.ipc.removeHandler.mock.calls).toEqual(channels.map((channel) => [channel]));
    for (const event of ['did-start-navigation', 'render-process-gone', 'destroyed']) {
      expect(h.state.listenerCount(event)).toBe(0);
    }
  });

  it('rejects a foreign sender, a foreign frame and a navigated document without opening the picker', async () => {
    for (const kind of ['sender', 'null-frame', 'foreign-url', 'destroyed'] as const) {
      const h = harness();
      if (kind === 'sender') h.event.sender = {} as WebContents;
      if (kind === 'null-frame') h.event.senderFrame = null;
      if (kind === 'foreign-url') h.frame.url = 'https://example.invalid/';
      if (kind === 'destroyed') h.state.isDestroyed.mockReturnValue(true);
      expect(await h.call(REFERENCE_STATUS_CHANNEL, { projectId })).toEqual(fail('INVALID_REQUEST'));
      expect(await h.call(REFERENCE_RELINK_CHANNEL, { projectId, importId, imageKey: 'image:0' }))
        .toEqual(fail('INVALID_REQUEST'));
      expect(h.showOpenDialog).not.toHaveBeenCalled();
    }
  });

  it('rejects a request once the document has navigated to another URL', async () => {
    const h = harness();
    // generation guards in-flight requests; the frame URL is what identifies the
    // document afterwards. A navigated frame must not reach the picker.
    h.state.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
    h.frame.url = 'file:///C:/Synthetic/app/other.html';
    expect(await h.call(REFERENCE_STATUS_CHANNEL, { projectId })).toEqual(fail('INVALID_REQUEST'));
    expect(await h.call(REFERENCE_RELINK_CHANNEL, { projectId, importId, imageKey: 'image:0' }))
      .toEqual(fail('INVALID_REQUEST'));
    expect(h.showOpenDialog).not.toHaveBeenCalled();
  });

  it('rejects a wrong argument count and any unknown or path-bearing key', async () => {
    const h = harness();
    for (const args of [[], [{ projectId }, { projectId }]]) {
      expect(await h.call(REFERENCE_STATUS_CHANNEL, ...args)).toEqual(fail('INVALID_REQUEST'));
    }
    for (const payload of [undefined, null, 'C:\\data', { projectId: 'not-a-uuid' },
      { projectId, path: 'C:\\data' }, { projectId, channel: REFERENCE_RELINK_CHANNEL }]) {
      expect(await h.call(REFERENCE_STATUS_CHANNEL, payload)).toEqual(fail('INVALID_REQUEST'));
    }
    for (const payload of [{ projectId, importId }, { projectId, imageKey: 'image:0' },
      { projectId, importId, imageKey: 'image:0', candidatePath: 'C:\\replacement.png' },
      { projectId, importId, imageKey: '' }]) {
      expect(await h.call(REFERENCE_RELINK_CHANNEL, payload)).toEqual(fail('INVALID_REQUEST'));
    }
    expect(h.showOpenDialog).not.toHaveBeenCalled();
  });

  it('never opens the picker for an import that does not exist', async () => {
    const h = harness();
    expect(await h.call(REFERENCE_RELINK_CHANNEL, { projectId, importId, imageKey: 'image:0' }))
      .toEqual(fail('NOT_FOUND'));
    expect(h.showOpenDialog).not.toHaveBeenCalled();
  });

  it('reports a Project without Reference imports as zero inspected, never as verified content', async () => {
    const h = harness();
    const parsed = referenceStatusResponseSchema.parse(await h.call(REFERENCE_STATUS_CHANNEL, { projectId }));
    expect(parsed).toEqual({ ok: true, value: { projectId, inspectedImports: 0, checked: 0, broken: [] } });
    expect(h.showOpenDialog).not.toHaveBeenCalled();
  });

  it('keeps the exclusion while one verification runs, and a refused request never releases it', async () => {
    const h = harness();
    // All three are issued before any await, so the ordering is deterministic:
    // the first acquires the exclusion, the other two must be refused. If a
    // refused request released the flag, the third would reach NOT_FOUND.
    const first = h.call(REFERENCE_STATUS_CHANNEL, { projectId }) as Promise<unknown>;
    const second = h.call(REFERENCE_STATUS_CHANNEL, { projectId }) as Promise<unknown>;
    const third = h.call(REFERENCE_RELINK_CHANNEL, { projectId, importId, imageKey: 'image:0' }) as Promise<unknown>;
    expect(await second).toEqual(fail('BUSY'));
    expect(await third).toEqual(fail('BUSY'));
    expect(referenceStatusResponseSchema.parse(await first).ok).toBe(true);
    // The owner released it on completion, so the next request is served.
    expect(await h.call(REFERENCE_RELINK_CHANNEL, { projectId, importId, imageKey: 'image:0' }))
      .toEqual(fail('NOT_FOUND'));
  });

  it('refuses to join another owner transaction on the shared connection', async () => {
    const h = harness();
    db.exec('BEGIN DEFERRED');
    try {
      expect(await h.call(REFERENCE_STATUS_CHANNEL, { projectId })).toEqual(fail('BUSY'));
    } finally { db.exec('ROLLBACK'); }
  });

  it('refuses registration without a real picker', () => {
    const contents = Object.assign(new EventEmitter(), {
      mainFrame: { url } as WebFrameMain, getURL: () => url, isDestroyed: () => false,
    }) as unknown as WebContents;
    const ipc = { handle: vi.fn<IpcMain['handle']>(), removeHandler: vi.fn<IpcMain['removeHandler']>() };
    expect(() => registerReferenceHandlers(ipc, contents, url, db,
      {} as Pick<Dialog, 'showOpenDialog'>)).toThrow();
    expect(() => registerReferenceHandlers(ipc, contents, 'https://example.invalid/', db,
      { showOpenDialog: vi.fn() })).toThrow();
    expect(ipc.handle).not.toHaveBeenCalled();
  });
});
