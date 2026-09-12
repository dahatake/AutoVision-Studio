// @vitest-environment node
import type { IpcMain, IpcMainInvokeEvent, WebContents, WebFrameMain } from 'electron';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as c from '../../shared/contracts/annotation-ipc.js';
import type { AnnotationItem } from '../../shared/contracts/annotation.js';
import type { ScanImage, ScanResult } from '../../shared/contracts/import.js';
import { createLabelClass, createLabelSchema, LabelSchemaError } from '../annotations/label-schema-service.js';
import * as services from '../annotations/workspace-service.js';
import * as drafts from '../annotations/save-draft.js';
import { validateAnnotationItem } from '../annotations/validate-annotation.js';
import { insertDataImport, prepareDataImport } from '../data/import-repository.js';
import { openDatabase, type DatabaseConnection } from '../db/database.js';
import { migrateDatabase } from '../db/migrate.js';
import * as projects from '../projects/project-service.js';
import { registerAnnotationHandlers } from './annotation-handlers.js';

const url = 'file:///C:/Synthetic/app/index.html';
const channels = [c.ANNOTATION_WORKSPACES_CHANNEL, c.ANNOTATION_LIST_CHANNEL, c.ANNOTATION_GET_CHANNEL,
  c.ANNOTATION_SAVE_CHANNEL, c.ANNOTATION_CONFIRM_CHANNEL];
const fail = (code: string) => ({ ok: false, error: { code } });
const now = '2026-09-13T00:00:00.000Z';
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
  const binding = registerAnnotationHandlers(ipc, contents, url, db); bindings.push(binding);
  const captured = new Map(handlers);
  const call = (channel: string, ...args: unknown[]): unknown => captured.get(channel)!(event as IpcMainInvokeEvent, ...args);
  return { frame, state, contents, event, handlers, ipc, binding, call };
}
const identity = (item: AnnotationItem) => ({ projectId, workspaceId: item.workspaceId, itemId: item.id });
const tokens = (item: AnnotationItem) => ({ expectedEditVersion: item.editVersion,
  expectedAnnotationSha256: item.annotationSha256, expectedState: item.state, expectedConfirmedAt: item.confirmedAt });
const save = (item: AnnotationItem) => ({ ...identity(item), ...tokens(item), annotation: item.annotation,
  state: 'editing' as const, exclusionReason: null });
const confirm = (item: AnnotationItem, negativeConfirmed = false) => ({ ...identity(item), ...tokens(item), negativeConfirmed });
function result(value: unknown) {
  const parsed = c.annotationGetResponseSchema.parse(value);
  if (!parsed.ok) throw new Error('Expected actual SQLite success');
  return parsed.value;
}
function requests(item: AnnotationItem) {
  return [{ projectId }, { projectId, workspaceId: item.workspaceId, offset: 0, limit: 200 },
    identity(item), save(item), confirm(item)];
}
function fixture(taskType: ScanResult['taskType'] = 'classification', imported = true) {
  db.prepare('UPDATE projects SET task_type=? WHERE id=?').run(taskType, projectId);
  let schema = createLabelSchema(db, projectId);
  if (!schema.classes.length) schema = createLabelClass(db, projectId, { schemaId: schema.id,
    expectedEditVersion: schema.editVersion, displayName: 'cat', color: '#123456', description: '', examples: [], ordinal: 0 });
  const jobId = randomUUID(), importId = randomUUID();
  db.prepare('INSERT INTO jobs(id,project_id,kind,status,created_at,updated_at) VALUES (?,?,?,?,?,?)')
    .run(jobId, projectId, 'scan-dataset', 'Succeeded', now, now);
  const annotation: ScanImage['annotation'] = !imported ? null : taskType === 'classification'
    ? { type: 'classification', classKey: 'scan:cat', sourceRow: 2 }
    : { type: 'detection', sourceImageId: '123', boxes: [{ classKey: 'scan:cat', sourceAnnotationId: '456', bbox: [1, 2, 20, 30] }] };
  const images: ScanImage[] = [{ key: 'opaque-image', sourcePath: 'C:\\PRIVATE\\source.png', byteSize: 100,
    mtimeNs: '1234567890123456789', sha256: 'a'.repeat(64), format: 'png', width: 640, height: 480,
    orientation: 1, duplicateOf: null, annotation }];
  const scanResult: ScanResult = { formatVersion: 1, projectId, jobId, taskType, mode: 'copy',
    classes: imported ? [{ key: 'scan:cat', name: 'cat', sourceCategoryId: taskType === 'detection' ? '12' : null }] : [], images, issues: [] };
  const prepared = prepareDataImport({ id: importId, createdAt: now, updatedAt: now, scanResult,
    sourceManifest: { formatVersion: 1, mode: 'copy', entries: [{ imageKey: images[0]!.key,
      relativePath: `datasets/${importId}/source/0.png`, byteSize: 100, sha256: 'a'.repeat(64) }] } });
  db.exec('BEGIN IMMEDIATE');
  try { insertDataImport(db, prepared); db.exec('COMMIT'); }
  finally { if (db.inTransaction) db.exec('ROLLBACK'); }
  const { workspace } = services.createAnnotationWorkspace(db, projectId, importId, schema.id,
    imported ? { 'scan:cat': schema.classes[0]!.id } : {});
  return services.listAnnotationItems(db, projectId, workspace.id, { offset: 0, limit: 200 }).items[0]!;
}
beforeEach(() => {
  bindings = []; directory = mkdtempSync(join(tmpdir(), 'ann06h-'));
  db = openDatabase(join(directory, 'db.sqlite3'));
  migrateDatabase(db, ['001_core', '002_jobs', '003_import', '004_import_generation', '005_import_rights',
    '006_annotations', '007_annotation_target_history'].map((name, index) => ({ version: index + 1,
    sql: readFileSync(new URL(`../db/migrations/${name}.sql`, import.meta.url), 'utf8') })));
  projectId = randomUUID();
  db.prepare('INSERT INTO projects(id,name,task_type,workspace_path,created_at,updated_at) VALUES (?,?,?,?,?,?)')
    .run(projectId, 'fixture', 'classification', 'C:\\PRIVATE\\project', now, now);
});
afterEach(() => {
  vi.restoreAllMocks(); bindings.forEach((binding) => binding.dispose());
  if (db.open) { if (db.inTransaction) db.exec('ROLLBACK'); db.close(); }
  rmSync(directory, { recursive: true, force: true });
});

describe('ANN06H real SQLite 001–007', () => {
  it('registers five lazy channels, creates nothing on workspaces and disposes only its own listeners', () => {
    const prepare = vi.spyOn(db, 'prepare'), h = harness();
    expect([...h.handlers.keys()]).toEqual(channels); expect(prepare).not.toHaveBeenCalled();
    expect(h.call(channels[0]!, { projectId })).toEqual({ ok: true, value: [] });
    expect(db.prepare('SELECT id FROM label_schemas').all()).toEqual([]);
    const observer = vi.fn(); h.state.on('did-start-navigation', observer);
    h.binding.dispose(); h.binding.dispose();
    expect(h.ipc.removeHandler.mock.calls).toEqual(channels.map((channel) => [channel]));
    expect(h.state.listeners('did-start-navigation')).toEqual([observer]);
    expect(h.call(channels[0]!, { projectId })).toEqual(fail('INVALID_REQUEST'));
  });
  it.each(['classification', 'detection'] as const)('executes all five genuine %s commands, preserves provenance and unconfirms on save', (task) => {
    const item = fixture(task), h = harness();
    const workspaces = c.annotationWorkspacesResponseSchema.parse(h.call(channels[0]!, { projectId }));
    expect(workspaces).toMatchObject({ ok: true, value: [{ id: item.workspaceId, projectId }] });
    expect(h.call(channels[1]!, requests(item)[1])).toEqual({ ok: true, value: { items: [item], total: 1 } });
    const before = result(h.call(channels[2]!, identity(item)));
    expect(JSON.stringify(before)).not.toMatch(/PRIVATE|sourcePath|relativePath|workspacePath/);
    expect(validateAnnotationItem(db, projectId, item.workspaceId, item.id).valid).toBe(false);
    const saved = result(h.call(channels[3]!, save(item)));
    expect(saved.item).toMatchObject({ annotationSha256: item.annotationSha256, state: 'editing', confirmedAt: null, negativeConfirmed: false });
    const confirmed = result(h.call(channels[4]!, confirm(saved.item)));
    expect(confirmed.provenance).toEqual(before.provenance);
    expect(confirmed.item.annotationSha256).toBe(item.annotationSha256);
    expect(validateAnnotationItem(db, projectId, item.workspaceId, item.id).valid).toBe(true);
    const draft = result(h.call(channels[3]!, save(confirmed.item)));
    expect(draft.item).toMatchObject({ confirmedAt: null, negativeConfirmed: false, state: 'editing' });
    expect(validateAnnotationItem(db, projectId, item.workspaceId, item.id).valid).toBe(false);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });
  it.each(['classification', 'detection'] as const)('rejects genuine suggested %s confirmation without any database writes despite valid CAS input', (task) => {
    const original = fixture(task), h = harness();
    const originalValue = services.getAnnotationItem(db, projectId, original.workspaceId, original.id);
    const updatedAt = new Date(Date.parse(original.updatedAt) + 1000).toISOString();
    db.prepare(`UPDATE annotation_items SET state='suggested', confirmed_at=NULL, exclusion_reason=NULL,
      negative_confirmed=0, edit_version = edit_version + 1, updated_at=? WHERE id=? AND edit_version=?`)
      .run(updatedAt, original.id, original.editVersion);
    const stored = services.getAnnotationItem(db, projectId, original.workspaceId, original.id), item = stored.item;
    expect(item).toEqual({ ...original, state: 'suggested', editVersion: original.editVersion + 1, updatedAt });
    expect(stored.provenance).toEqual(originalValue.provenance);
    expect(stored.provenance).toHaveLength(1);
    expect(stored.provenance[0]!.kind).toBe('import-unmodified');
    expect(c.parseAnnotationGetResponse({ ok: true, value: stored }, identity(item))).toEqual({ ok: true, value: stored });
    expect(validateAnnotationItem(db, projectId, item.workspaceId, item.id)).toEqual({
      valid: false, issues: [{ itemId: item.id, code: 'unconfirmed' }],
    });
    const input = confirm(item);
    expect(c.annotationConfirmInputSchema.parse(input)).toEqual(input);
    // The success-response guard is not a substitute for rejecting BEFORE writes.
    expect(() => c.parseAnnotationConfirmResponse({ ok: true, value: { ...stored, item: {
      ...item, state: 'confirmed', confirmedAt: item.updatedAt, editVersion: item.editVersion + 1,
    } } }, input)).toThrow(/Invalid annotation IPC contract/);
    const snapshot = () => ['annotation_items', 'annotation_workspaces', 'annotation_provenance']
      .map((table) => db.prepare(`SELECT * FROM ${table}`).all());
    const before = snapshot(), changes = db.prepare('SELECT total_changes() AS count').get();
    expect(h.call(c.ANNOTATION_CONFIRM_CHANNEL, input)).toEqual(fail('OPERATION_FAILED'));
    expect(db.prepare('SELECT total_changes() AS count').get()).toEqual(changes);
    expect(snapshot()).toEqual(before);
    expect(services.getAnnotationItem(db, projectId, item.workspaceId, item.id)).toEqual(stored);
    expect(db.inTransaction).toBe(false);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });
  it('requires a separate explicit negative confirmation for an empty detection', () => {
    const item = fixture('detection', false), h = harness();
    expect(h.call(channels[4]!, confirm(item))).toEqual(fail('OPERATION_FAILED'));
    const confirmed = result(h.call(channels[4]!, confirm(item, true)));
    expect(confirmed.item.negativeConfirmed).toBe(true); expect(confirmed.provenance).toEqual([]);
    expect(result(h.call(channels[3]!, save(confirmed.item))).item.negativeConfirmed).toBe(false);
  });
  it('reads sorted workspace headers in one short transaction without decoding images', () => {
    const first = fixture(), second = fixture(), h = harness();
    const prepare = vi.spyOn(db, 'prepare'), exec = vi.spyOn(db, 'exec');
    const parsed = c.annotationWorkspacesResponseSchema.parse(h.call(channels[0]!, { projectId }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error('Expected success');
    const expected = [services.getAnnotationWorkspace(db, projectId, first.workspaceId), services.getAnnotationWorkspace(db, projectId, second.workspaceId)]
      .sort((a, b) => a.updatedAt === b.updatedAt ? (a.id < b.id ? -1 : 1) : a.updatedAt > b.updatedAt ? -1 : 1);
    expect(parsed.value).toEqual(expected);
    expect(exec.mock.calls.filter(([sql]) => sql === 'BEGIN')).toHaveLength(1);
    expect(exec.mock.calls.filter(([sql]) => sql === 'COMMIT')).toHaveLength(1);
    expect(prepare.mock.calls.map(([sql]) => sql).join('\n')).not.toMatch(/annotation_items|scan_result_json|import_sources/);
  });
  it.each(['version', 'hash', 'state', 'timestamp'] as const)('reports explicit stale %s as CONFLICT before writes', (kind) => {
    const item = fixture(), h = harness(), writer = vi.spyOn(drafts, 'saveAnnotationDraft');
    const changed = kind === 'version' ? { expectedEditVersion: 20 } : kind === 'hash' ? { expectedAnnotationSha256: 'f'.repeat(64) }
      : kind === 'state' ? { expectedState: 'editing' } : { expectedState: 'confirmed', expectedConfirmedAt: now };
    expect(h.call(channels[3]!, { ...save(item), ...changed })).toEqual(fail('CONFLICT'));
    expect(h.call(channels[4]!, { ...confirm(item), ...changed })).toEqual(fail('CONFLICT'));
    expect(writer).not.toHaveBeenCalled();
  });
  it('returns NOT_FOUND for missing/foreign project, workspace and item without exposing payloads', () => {
    const item = fixture(), other = fixture(), h = harness();
    expect(h.call(channels[0]!, { projectId: randomUUID() })).toEqual(fail('NOT_FOUND'));
    for (const [index, request] of requests(item).entries()) {
      expect(h.call(channels[index]!, { ...request, projectId: randomUUID() })).toEqual(fail('NOT_FOUND'));
    }
    expect(h.call(channels[2]!, { ...identity(item), workspaceId: other.workspaceId })).toEqual(fail('NOT_FOUND'));
    expect(h.call(channels[2]!, { ...identity(item), itemId: randomUUID() })).toEqual(fail('NOT_FOUND'));
  });
  it.each(channels)('%s rejects arity, getters, nested/revoked proxies and DAG before SQL', (channel) => {
    const item = fixture(), h = harness(), trap = vi.fn(() => { throw new Error('PRIVATE'); });
    const proxy = new Proxy({}, { get: trap, ownKeys: trap, getPrototypeOf: trap });
    const revoked = Proxy.revocable({}, {}); revoked.revoke();
    let dag: object = {}; for (let n = 0; n < 30; n++) dag = { a: dag, b: dag };
    const input = requests(item)[channels.indexOf(channel)]!;
    const prepare = vi.spyOn(db, 'prepare'), exec = vi.spyOn(db, 'exec');
    for (const args of [[], [input, undefined], [null], [{ ...input, extra: true }], [proxy], [revoked.proxy],
      [{ ...input, annotation: proxy }], [{ ...input, annotation: { kind: 'detection', rectangles: [proxy] } }],
      [{ ...input, extra: dag }], [Object.defineProperty({}, 'projectId', { enumerable: true, get: trap })]]) {
      expect(h.call(channel, ...args)).toEqual(fail('INVALID_REQUEST'));
    }
    expect(trap).not.toHaveBeenCalled(); expect(prepare).not.toHaveBeenCalled(); expect(exec).not.toHaveBeenCalled();
  });
  it.each(['subframe', 'sender', 'null', 'origin', 'query', 'contents', 'destroyed'])('rejects untrusted %s before any service', (kind) => {
    const item = fixture(), h = harness();
    if (kind === 'subframe') h.event.senderFrame = { url } as WebFrameMain;
    if (kind === 'sender') h.event.sender = {} as WebContents;
    if (kind === 'null') h.event.senderFrame = null;
    if (kind === 'origin') h.frame.url = 'https://example.invalid';
    if (kind === 'query') h.frame.url = `${url}?x=1`;
    if (kind === 'contents') h.state.getURL.mockReturnValue('file:///C:/other.html');
    if (kind === 'destroyed') h.state.isDestroyed.mockReturnValue(true);
    const prepare = vi.spyOn(db, 'prepare');
    channels.forEach((channel, index) => expect(h.call(channel, requests(item)[index])).toEqual(fail('INVALID_REQUEST')));
    expect(prepare).not.toHaveBeenCalled();
  });
  it('rejects caller-owned transactions before queries without commit or rollback', () => {
    const item = fixture(), h = harness(); db.exec('BEGIN');
    db.prepare("UPDATE projects SET name='uncommitted' WHERE id=?").run(projectId);
    const prepare = vi.spyOn(db, 'prepare'), exec = vi.spyOn(db, 'exec');
    channels.forEach((channel, index) => expect(h.call(channel, requests(item)[index])).toEqual(fail('BUSY')));
    expect(prepare).not.toHaveBeenCalled(); expect(exec).not.toHaveBeenCalled(); expect(db.inTransaction).toBe(true);
  });
  it('blocks reentrance while allowing the outer genuine read', () => {
    const item = fixture(), h = harness(), actual = projects.getProject;
    vi.spyOn(projects, 'getProject').mockImplementationOnce((database, id) => {
      expect(h.call(channels[2]!, identity(item))).toEqual(fail('BUSY')); return actual(database, id);
    });
    expect(result(h.call(channels[2]!, identity(item))).item.id).toBe(item.id);
  });
  it('stops after navigation during Project read before invoking annotation services', () => {
    const item = fixture(), h = harness(), actual = projects.getProject, reader = vi.spyOn(services, 'getAnnotationWorkspace');
    vi.spyOn(projects, 'getProject').mockImplementationOnce((database, id) => {
      const value = actual(database, id); h.state.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false }); return value;
    });
    expect(h.call(channels[2]!, identity(item))).toEqual(fail('INVALID_REQUEST')); expect(reader).not.toHaveBeenCalled();
  });
  it('withholds a saved response after navigation without falsely claiming rollback', () => {
    const item = fixture(), h = harness(), actual = drafts.saveAnnotationDraft;
    vi.spyOn(drafts, 'saveAnnotationDraft').mockImplementationOnce((...args) => {
      const value = actual(...args); h.state.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false }); return value;
    });
    expect(h.call(channels[3]!, save(item))).toEqual(fail('INVALID_REQUEST'));
    expect(services.getAnnotationItem(db, projectId, item.workspaceId, item.id).item.editVersion).toBe(1);
  });
  it('rejects wrong Project, item and save outputs through correlation and recomputed hash', () => {
    const item = fixture(), h = harness(), actual = projects.getProject;
    vi.spyOn(projects, 'getProject').mockReturnValueOnce({ ...actual(db, projectId), id: randomUUID() });
    expect(h.call(channels[0]!, { projectId })).toEqual(fail('OPERATION_FAILED'));
    const value = services.getAnnotationItem(db, projectId, item.workspaceId, item.id);
    vi.spyOn(services, 'getAnnotationItem').mockReturnValueOnce({ ...value, item: { ...item, id: randomUUID() } });
    expect(h.call(channels[2]!, identity(item))).toEqual(fail('OPERATION_FAILED'));
    vi.spyOn(drafts, 'saveAnnotationDraft').mockReturnValueOnce({ ...value, item: { ...item, state: 'editing', editVersion: 1, annotationSha256: 'f'.repeat(64) } });
    expect(h.call(channels[3]!, save(item))).toEqual(fail('OPERATION_FAILED'));
  });
  it('sanitizes real SQL failures and never maps generic conflict messages', () => {
    const item = fixture(), h = harness();
    db.exec("CREATE TRIGGER fail_save BEFORE UPDATE ON annotation_items BEGIN SELECT RAISE(ABORT,'conflict C:\\PRIVATE'); END");
    expect(h.call(channels[3]!, save(item))).toEqual(fail('OPERATION_FAILED'));
    expect(services.getAnnotationItem(db, projectId, item.workspaceId, item.id).item).toEqual(item);
  });
  it('maps only structured LabelSchemaError codes, never native/accessor/proxy error fields', () => {
    const h = harness(), getter = vi.fn(() => 'LABEL_LOCKED');
    const accessor = new LabelSchemaError('LABEL_LOCKED'); Object.defineProperty(accessor, 'code', { get: getter });
    const reader = vi.spyOn(projects, 'getProject');
    for (const error of [Object.assign(new Error('conflict C:\\PRIVATE'), { code: 'LABEL_LOCKED' }), accessor,
      new Proxy(new LabelSchemaError('LABEL_LOCKED'), { get: getter })]) {
      reader.mockImplementationOnce(() => { throw error; });
      expect(h.call(channels[0]!, { projectId })).toEqual(fail('OPERATION_FAILED'));
    }
    reader.mockImplementationOnce(() => { throw new LabelSchemaError('LABEL_CONFLICT'); });
    expect(h.call(channels[0]!, { projectId })).toEqual(fail('CONFLICT')); expect(getter).not.toHaveBeenCalled();
  });
  it.each([0, 2, 4])('partial registration preserves foreign ownership at index %s', (index) => {
    const h = harness(); h.binding.dispose(); h.ipc.removeHandler.mockClear();
    const foreign = vi.fn(); h.handlers.set(channels[index]!, foreign); h.handlers.set('foreign', foreign);
    expect(() => registerAnnotationHandlers(h.ipc, h.contents, url, db)).toThrow('owned');
    expect(h.ipc.removeHandler.mock.calls).toEqual(channels.slice(0, index).map((channel) => [channel]));
    expect([...h.handlers.keys()]).toEqual([channels[index], 'foreign']); expect(h.state.eventNames()).toEqual([]);
  });
});