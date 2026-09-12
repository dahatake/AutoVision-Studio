// @vitest-environment node
import type { IpcMain, IpcMainInvokeEvent, WebContents, WebFrameMain } from 'electron';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as c from '../../shared/contracts/annotation-ipc.js';
import type { LabelSchemaSnapshot } from '../../shared/contracts/annotation.js';
import { lockLabelSchema, LabelSchemaError } from '../annotations/label-schema-service.js';
import { openDatabase, type DatabaseConnection } from '../db/database.js';
import { migrateDatabase } from '../db/migrate.js';
import { registerLabelSchemaHandlers } from './label-schema-handlers.js';

const url = 'file:///C:/Synthetic/app/index.html';
const channels = [c.LABEL_GET_CHANNEL, c.LABEL_CREATE_CHANNEL, c.LABEL_CREATE_CLASS_CHANNEL,
  c.LABEL_UPDATE_CLASS_CHANNEL, c.LABEL_UPDATE_CHANNEL, c.LABEL_DELETE_CLASS_CHANNEL, c.LABEL_MERGE_CLASSES_CHANNEL];
const fail = (code: string) => ({ ok: false, error: { code } });
let db: DatabaseConnection, directory: string, projectId: string;
let bindings: { dispose(): void }[];
function harness() {
  const frame = { url };
  const state = Object.assign(new EventEmitter(), { mainFrame: frame as WebFrameMain,
    getURL: vi.fn(() => url), isDestroyed: vi.fn(() => false) });
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
  const binding = registerLabelSchemaHandlers(ipc, contents, url, db); bindings.push(binding);
  const captured = new Map(handlers);
  const call = (channel: string, ...args: unknown[]): unknown => captured.get(channel)!(event as IpcMainInvokeEvent, ...args);
  return { frame, state, contents, event, handlers, ipc, binding, call };
}
function snapshot(value: unknown): LabelSchemaSnapshot {
  const result = c.labelCreateResponseSchema.parse(value);
  if (!result.ok) throw new Error('Expected actual SQLite success');
  return result.value;
}
function add(s: LabelSchemaSnapshot, displayName = 'ＣＡＴ', ordinal = 0) {
  return { projectId, schemaId: s.id, expectedEditVersion: s.editVersion, displayName,
    color: '#abcdef', description: '', examples: [], ordinal };
}
function requests(schemaId = randomUUID(), classId = randomUUID()) {
  const base = { projectId, schemaId, expectedEditVersion: 0 };
  return [{ projectId }, { projectId }, { ...base, displayName: 'cat', color: '#abcdef', description: '', examples: [], ordinal: 0 },
    { ...base, id: classId, displayName: 'cat', modelAlias: null, color: '#abcdef', description: '', examples: [], ordinal: 0 },
    { projectId, id: schemaId, expectedEditVersion: 0, instructions: '' }, { ...base, classId },
    { ...base, sourceId: classId, targetId: randomUUID() }];
}
beforeEach(() => {
  bindings = []; directory = mkdtempSync(join(tmpdir(), 'ann04h-'));
  db = openDatabase(join(directory, 'db.sqlite3'));
  migrateDatabase(db, ['001_core.sql', '002_jobs.sql', '003_import.sql', '004_import_generation.sql',
    '005_import_rights.sql', '006_annotations.sql'].map((name, index) => ({ version: index + 1,
    sql: readFileSync(new URL(`../db/migrations/${name}`, import.meta.url), 'utf8') })));
  projectId = randomUUID();
  db.prepare("INSERT INTO projects(id,name,task_type,workspace_path,created_at,updated_at) VALUES (?,'fixture','classification','C:\\fixture',?,?)")
    .run(projectId, '2026-09-12T00:00:00.000Z', '2026-09-12T00:00:00.000Z');
});
afterEach(() => {
  vi.restoreAllMocks(); bindings.forEach((b) => b.dispose());
  if (db.open) { if (db.inTransaction) db.exec('ROLLBACK'); db.close(); }
  rmSync(directory, { recursive: true, force: true });
});
describe('ANN-04H real backend IPC', () => {
  it('registers only seven lazy channels and disposes captured callbacks and own listeners', () => {
    const prepare = vi.spyOn(db, 'prepare'), h = harness();
    expect([...h.handlers.keys()]).toEqual(channels); expect(prepare).not.toHaveBeenCalled();
    const observer = vi.fn(); h.state.on('did-start-navigation', observer);
    h.binding.dispose(); h.binding.dispose();
    expect(h.ipc.removeHandler.mock.calls).toEqual(channels.map((key) => [key]));
    expect(h.state.listeners('did-start-navigation')).toEqual([observer]);
    expect(h.call(c.LABEL_GET_CHANNEL, { projectId })).toEqual(fail('INVALID_REQUEST'));
  });
  it('executes all seven real CRUD calls without creating on get', () => {
    const h = harness();
    expect(h.call(c.LABEL_GET_CHANNEL, { projectId })).toEqual({ ok: true, value: null });
    expect(db.prepare('SELECT * FROM label_schemas').all()).toEqual([]);
    let s = snapshot(h.call(c.LABEL_CREATE_CHANNEL, { projectId }));
    s = snapshot(h.call(c.LABEL_CREATE_CLASS_CHANNEL, add(s)));
    const first = s.classes[0]!;
    s = snapshot(h.call(c.LABEL_UPDATE_CLASS_CHANNEL, { ...add(s, 'e\u0301'), id: first.id, modelAlias: null }));
    expect(s.classes[0]!.normalizedName).toBe('é');
    s = snapshot(h.call(c.LABEL_UPDATE_CHANNEL, { projectId, id: s.id, expectedEditVersion: s.editVersion, instructions: '説明' }));
    s = snapshot(h.call(c.LABEL_CREATE_CLASS_CHANNEL, add(s, 'dog', 1)));
    const target = s.classes[1]!.id;
    s = snapshot(h.call(c.LABEL_MERGE_CLASSES_CHANNEL, { projectId, schemaId: s.id, sourceId: first.id,
      targetId: target, expectedEditVersion: s.editVersion }));
    expect(s.classes.map((x) => x.id)).toEqual([target]);
    s = snapshot(h.call(c.LABEL_DELETE_CLASS_CHANNEL, { projectId, schemaId: s.id, classId: target, expectedEditVersion: s.editVersion }));
    expect(s.classes).toEqual([]); expect(s.editVersion).toBe(6);
    expect(h.call(c.LABEL_GET_CHANNEL, { projectId })).toEqual({ ok: true, value: s });
    expect(db.inTransaction).toBe(false);
  });
  it('maps normalized duplicates, stale CAS, missing membership and real locks', () => {
    const h = harness(); let s = snapshot(h.call(c.LABEL_CREATE_CHANNEL, { projectId }));
    s = snapshot(h.call(c.LABEL_CREATE_CLASS_CHANNEL, add(s)));
    expect(h.call(c.LABEL_CREATE_CLASS_CHANNEL, add(s, ' cat ', 1))).toEqual(fail('CONFLICT'));
    expect(h.call(c.LABEL_UPDATE_CHANNEL, { projectId, id: s.id, expectedEditVersion: 0, instructions: '' })).toEqual(fail('CONFLICT'));
    expect(h.call(c.LABEL_CREATE_CLASS_CHANNEL, { ...add(s), projectId: randomUUID() })).toEqual(fail('NOT_FOUND'));
    expect(h.call(c.LABEL_CREATE_CHANNEL, { projectId: randomUUID() })).toEqual(fail('NOT_FOUND'));
    db.exec('BEGIN'); s = lockLabelSchema(db, projectId, s.id, s.editVersion); db.exec('COMMIT');
    expect(h.call(c.LABEL_CREATE_CLASS_CHANNEL, add(s, 'dog', 1))).toEqual(fail('LOCKED'));
  });
  it.each(channels)('%s rejects malformed arity, getter, nested/revoked proxy and DAG before SQL', (channel) => {
    const h = harness(), trap = vi.fn(() => { throw new Error('PRIVATE'); });
    const proxy = new Proxy({}, { ownKeys: trap, getPrototypeOf: trap, get: trap });
    const revoked = Proxy.revocable({}, {}); revoked.revoke();
    let dag: object = {}; for (let n = 0; n < 30; n++) dag = { a: dag, b: dag };
    const input = requests()[channels.indexOf(channel)]!;
    const prepare = vi.spyOn(db, 'prepare'), exec = vi.spyOn(db, 'exec');
    for (const args of [[], [input, undefined], [null], [{ ...input, extra: true }], [proxy], [revoked.proxy],
      [{ ...input, nested: proxy }], [{ ...input, examples: [proxy] }], [{ ...input, nested: dag }],
      [Object.defineProperty({}, 'projectId', { get: trap, enumerable: true })]]) {
      expect(h.call(channel, ...args)).toEqual(fail('INVALID_REQUEST'));
    }
    expect(trap).not.toHaveBeenCalled(); expect(prepare).not.toHaveBeenCalled(); expect(exec).not.toHaveBeenCalled();
  });
  it.each(['subframe', 'other-content', 'null-frame', 'origin', 'query', 'contents-url', 'destroyed'])('rejects %s without SQL', (kind) => {
    const h = harness();
    if (kind === 'subframe') h.event.senderFrame = { url } as WebFrameMain;
    if (kind === 'other-content') h.event.sender = {} as WebContents;
    if (kind === 'null-frame') h.event.senderFrame = null;
    if (kind === 'origin') h.frame.url = 'https://example.invalid';
    if (kind === 'query') h.frame.url = `${url}?x=1`;
    if (kind === 'contents-url') h.state.getURL.mockReturnValue('file:///C:/other.html');
    if (kind === 'destroyed') h.state.isDestroyed.mockReturnValue(true);
    const prepare = vi.spyOn(db, 'prepare');
    channels.forEach((channel, i) => expect(h.call(channel, requests()[i])).toEqual(fail('INVALID_REQUEST')));
    expect(prepare).not.toHaveBeenCalled();
  });
  it('rejects all commands in an existing transaction without any SQL or cross-owner rollback', () => {
    const h = harness(); db.exec('BEGIN');
    db.prepare("UPDATE projects SET name='owner' WHERE id=?").run(projectId);
    const prepare = vi.spyOn(db, 'prepare'), exec = vi.spyOn(db, 'exec');
    channels.forEach((channel, i) => expect(h.call(channel, requests()[i])).toEqual(fail('BUSY')));
    expect(prepare).not.toHaveBeenCalled(); expect(exec).not.toHaveBeenCalled(); expect(db.inTransaction).toBe(true);
    prepare.mockRestore(); expect(db.prepare('SELECT name FROM projects WHERE id=?').get(projectId)).toEqual({ name: 'owner' });
  });
  it('catches generation change inside native URL validation before service entry', () => {
    const h = harness(), prepare = vi.spyOn(db, 'prepare');
    h.state.getURL.mockImplementationOnce(() => {
      h.state.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false }); return url;
    });
    expect(h.call(c.LABEL_CREATE_CHANNEL, { projectId })).toEqual(fail('INVALID_REQUEST'));
    expect(prepare).not.toHaveBeenCalled();
  });
  it('withholds post-commit old-document output without claiming rollback', () => {
    const h = harness(), exec = db.exec.bind(db);
    vi.spyOn(db, 'exec').mockImplementation((sql) => {
      const value = exec(sql);
      if (sql === 'COMMIT') h.state.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
      return value;
    });
    expect(h.call(c.LABEL_CREATE_CHANNEL, { projectId })).toEqual(fail('INVALID_REQUEST'));
    expect(db.prepare('SELECT * FROM label_schemas').all()).toHaveLength(1);
  });
  it('rolls back real SQL failure and sanitizes malformed stored DTOs', () => {
    const h = harness(), s = snapshot(h.call(c.LABEL_CREATE_CHANNEL, { projectId }));
    db.exec("CREATE TRIGGER abort_label BEFORE INSERT ON label_classes BEGIN SELECT RAISE(ABORT,'PRIVATE C:\\secret'); END");
    expect(h.call(c.LABEL_CREATE_CLASS_CHANNEL, add(s))).toEqual(fail('OPERATION_FAILED'));
    expect(snapshot(h.call(c.LABEL_GET_CHANNEL, { projectId }))).toEqual(s);
    db.prepare("UPDATE label_schemas SET updated_at='PRIVATE', edit_version=edit_version+1 WHERE id=?").run(s.id);
    expect(h.call(c.LABEL_GET_CHANNEL, { projectId })).toEqual(fail('OPERATION_FAILED'));
  });
  it('never trusts native, inherited, accessor or proxy error codes', () => {
    const h = harness(), getter = vi.fn(() => 'LABEL_LOCKED');
    const inherited = new LabelSchemaError('LABEL_LOCKED'); Reflect.deleteProperty(inherited, 'code');
    const accessor = new LabelSchemaError('LABEL_LOCKED'); Object.defineProperty(accessor, 'code', { get: getter });
    const errors = [Object.assign(new Error('C:\\secret'), { code: 'LABEL_LOCKED' }), inherited, accessor,
      new Proxy(new LabelSchemaError('LABEL_LOCKED'), { get: getter }), new LabelSchemaError('constructor' as never)];
    const exec = vi.spyOn(db, 'exec');
    for (const error of errors) { exec.mockImplementationOnce(() => { throw error; });
      expect(h.call(c.LABEL_GET_CHANNEL, { projectId })).toEqual(fail('OPERATION_FAILED')); }
    expect(getter).not.toHaveBeenCalled();
  });
  it.each([0, 3, 6])('partial registration retains foreign handler at index %s', (index) => {
    const h = harness(); h.binding.dispose(); h.ipc.removeHandler.mockClear();
    const foreign = vi.fn(); h.handlers.set(channels[index]!, foreign); h.handlers.set('foreign', foreign);
    expect(() => registerLabelSchemaHandlers(h.ipc, h.contents, url, db)).toThrow('owned');
    expect(h.ipc.removeHandler.mock.calls).toEqual(channels.slice(0, index).map((x) => [x]));
    expect([...h.handlers.keys()]).toEqual([channels[index], 'foreign']);
    expect(h.state.eventNames()).toEqual([]);
  });
});