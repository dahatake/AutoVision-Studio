// @vitest-environment node
import type { IpcMain, IpcMainInvokeEvent, WebContents, WebFrameMain } from 'electron';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  REVISION_CLONE_CHANNEL, REVISION_CONFIRM_AND_QUEUE_CHANNEL, REVISION_CREATE_CHANNEL,
  REVISION_VALIDATE_CHANNEL,
} from '../../shared/contracts/revision-ipc.js';
import { openDatabase, type DatabaseConnection } from '../db/database.js';
import { migrateDatabase } from '../db/migrate.js';
import { registerRevisionHandlers } from './revision-handlers.js';

const url = 'file:///C:/Synthetic/app/index.html';
const migrationsDirectory = fileURLToPath(new URL('../db/migrations/', import.meta.url));
const channels = [REVISION_CREATE_CHANNEL, REVISION_VALIDATE_CHANNEL,
  REVISION_CONFIRM_AND_QUEUE_CHANNEL, REVISION_CLONE_CHANNEL];
const fail = (code: string) => ({ ok: false, error: { code } });
let db: DatabaseConnection;
let directory: string;
let projectId: string;
let workspaceId: string;
let bindings: { dispose(): void }[];

const createInput = () => ({ projectId, workspaceId, splitSeed: 1, createdBy: 'local-operator' });
const validateInput = () => ({ projectId, workspaceId });
const cloneInput = () => ({ projectId, revisionId: workspaceId });

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
  const binding = registerRevisionHandlers(ipc, contents, url, db);
  bindings.push(binding);
  const captured = new Map(handlers);
  const call = (channel: string, ...args: unknown[]): unknown =>
    captured.get(channel)!(event as IpcMainInvokeEvent, ...args);
  return { frame, state, contents, event, handlers, ipc, binding, call };
}

beforeEach(() => {
  bindings = [];
  directory = mkdtempSync(join(tmpdir(), 'revh-'));
  db = openDatabase(join(directory, 'db.sqlite3'));
  migrateDatabase(db, ['001_core', '002_jobs', '003_import', '004_import_generation', '005_import_rights',
    '006_annotations', '007_annotation_target_history'].map((name, index) => ({
    version: index + 1,
    sql: readFileSync(join(migrationsDirectory, `${name}.sql`), 'utf8'),
  })));
  projectId = randomUUID();
  workspaceId = randomUUID();
});

afterEach(() => {
  for (const binding of bindings) binding.dispose();
  db.close();
  rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

describe('Revision IPC boundary', () => {
  it('registers exactly four channels and disposes only its own, once', () => {
    const h = harness();
    expect(h.ipc.handle.mock.calls.map(([channel]) => channel)).toEqual(channels);
    for (const event of ['did-start-navigation', 'render-process-gone', 'destroyed']) {
      expect(h.state.listenerCount(event)).toBe(1);
    }
    h.binding.dispose();
    h.binding.dispose();
    expect(h.ipc.removeHandler.mock.calls).toEqual(channels.map((channel) => [channel]));
  });

  it('rejects a foreign sender, a foreign frame and a navigated document', async () => {
    for (const kind of ['sender', 'null-frame', 'foreign-url', 'destroyed'] as const) {
      const h = harness();
      if (kind === 'sender') h.event.sender = {} as WebContents;
      if (kind === 'null-frame') h.event.senderFrame = null;
      if (kind === 'foreign-url') h.frame.url = 'https://example.invalid/';
      if (kind === 'destroyed') h.state.isDestroyed.mockReturnValue(true);
      expect(await h.call(REVISION_VALIDATE_CHANNEL, validateInput())).toEqual(fail('INVALID_REQUEST'));
      expect(await h.call(REVISION_CONFIRM_AND_QUEUE_CHANNEL, createInput())).toEqual(fail('INVALID_REQUEST'));
    }
  });

  it('rejects a wrong argument count and any unknown or malformed payload', async () => {
    const h = harness();
    for (const args of [[], [validateInput(), validateInput()]]) {
      expect(await h.call(REVISION_VALIDATE_CHANNEL, ...args)).toEqual(fail('INVALID_REQUEST'));
    }
    for (const payload of [undefined, null, 'D:\\datasets', { ...validateInput(), path: 'D:\\x' },
      { projectId }, { ...validateInput(), workspaceId: 'not-a-uuid' }]) {
      expect(await h.call(REVISION_VALIDATE_CHANNEL, payload)).toEqual(fail('INVALID_REQUEST'));
    }
    for (const payload of [{ ...createInput(), createdBy: '' }, { ...createInput(), splitSeed: -1 },
      { ...createInput(), splitSeed: 1.5 }, { ...createInput(), manifestPath: 'D:\\m.json' }]) {
      expect(await h.call(REVISION_CREATE_CHANNEL, payload)).toEqual(fail('INVALID_REQUEST'));
      expect(await h.call(REVISION_CONFIRM_AND_QUEUE_CHANNEL, payload)).toEqual(fail('INVALID_REQUEST'));
    }
    expect(await h.call(REVISION_CLONE_CHANNEL, { projectId })).toEqual(fail('INVALID_REQUEST'));
  });

  it('reports a missing workspace as a failure instead of an empty success', async () => {
    const h = harness();
    for (const [channel, payload] of [
      [REVISION_VALIDATE_CHANNEL, validateInput()],
      [REVISION_CREATE_CHANNEL, createInput()],
      [REVISION_CONFIRM_AND_QUEUE_CHANNEL, createInput()],
      [REVISION_CLONE_CHANNEL, cloneInput()],
    ] as const) {
      const result = await h.call(channel, payload) as { ok: boolean };
      expect(result.ok).toBe(false);
    }
  });

  it('keeps the exclusion while one operation runs, and a refused request never releases it', async () => {
    const h = harness();
    // Handlers are synchronous, so drive the guard through an owner transaction
    // on the shared connection: every request must be refused, and refusing one
    // must not clear the flag for the next.
    db.exec('BEGIN DEFERRED');
    try {
      for (const [channel, payload] of [
        [REVISION_VALIDATE_CHANNEL, validateInput()],
        [REVISION_CREATE_CHANNEL, createInput()],
        [REVISION_CONFIRM_AND_QUEUE_CHANNEL, createInput()],
        [REVISION_CLONE_CHANNEL, cloneInput()],
      ] as const) {
        expect(await h.call(channel, payload)).toEqual(fail('BUSY'));
      }
    } finally { db.exec('ROLLBACK'); }
    // The connection is free again, so the guard must have been released.
    expect(await h.call(REVISION_VALIDATE_CHANNEL, validateInput())).not.toEqual(fail('BUSY'));
  });

  it('refuses registration for a renderer entry that is not a file URL', () => {
    const contents = Object.assign(new EventEmitter(), {
      mainFrame: { url } as WebFrameMain, getURL: () => url, isDestroyed: () => false,
    }) as unknown as WebContents;
    const ipc = { handle: vi.fn<IpcMain['handle']>(), removeHandler: vi.fn<IpcMain['removeHandler']>() };
    expect(() => registerRevisionHandlers(ipc, contents, 'https://example.invalid/', db)).toThrow();
    expect(ipc.handle).not.toHaveBeenCalled();
  });
});
