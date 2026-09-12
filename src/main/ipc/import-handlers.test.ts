// @vitest-environment node
import type { BaseWindow, IpcMain, IpcMainInvokeEvent, OpenDialogOptions, OpenDialogReturnValue,
  WebContents, WebFrameMain } from 'electron';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { importStartResponseSchema, type ImportSourceKind } from '../../shared/contracts/import-ipc.js';
import { ImportServiceError, type ImportResult, type ImportService } from '../data/import-service.js';
import { openDatabase, type DatabaseConnection } from '../db/database.js';
import { migrateDatabase } from '../db/migrate.js';
import { insertProject } from '../projects/project-repository.js';
import { registerImportHandlers } from './import-handlers.js';

const sql = fs.readFileSync(new URL('../db/migrations/001_core.sql', import.meta.url), 'utf8');
const url = 'file:///C:/Synthetic/index.html', projectId = randomUUID();
const chosen = 'c:\\NativeSelected\\images'; // Deliberately nonexistent; no source I/O is necessary.
const channels = ['import:start', 'import:preview', 'import:commit', 'import:discard'];
const failure = (code: string) => ({ ok: false, error: { code } });
let root: string, selectionDirectory: string, database: DatabaseConnection;
let bindings: ReturnType<typeof registerImportHandlers>[];
function harness() {
  const frameState = { url }, frame = frameState as WebFrameMain;
  const state = Object.assign(new EventEmitter(), { mainFrame: frame, getURL: vi.fn(() => url), isDestroyed: () => false });
  const contents = state as unknown as WebContents;
  const eventState = { sender: contents, senderFrame: frame };
  const handlers = new Map<string, Parameters<IpcMain['handle']>[1]>();
  const ipc = { handle: vi.fn<IpcMain['handle']>((channel, callback) => {
    if (handlers.has(channel)) throw new Error('foreign'); handlers.set(channel, callback);
  }), removeHandler: vi.fn((channel: string) => { handlers.delete(channel); }) };
  const showOpenDialog = vi.fn<(options: OpenDialogOptions | BaseWindow, secondary?: OpenDialogOptions) => Promise<OpenDialogReturnValue>>()
    .mockResolvedValue({ canceled: false, filePaths: [chosen] });
  const scan = vi.fn<ImportService['scan']>(() => ({ id: randomUUID(), projectId, kind: 'scan-dataset', status: 'Running',
    createdAt: '2026-09-13T00:00:00.000Z', updatedAt: '2026-09-13T00:00:00.000Z' }));
  const preview = vi.fn<ImportService['preview']>(async (parent, jobId) => ({ projectId: parent, jobId,
    taskType: 'classification', mode: 'copy', itemCount: 1, sourceBytes: '1', classes: [], issues: [], files: [{ key: 'i', displayName: 'i.png' }] }));
  const id = randomUUID();
  const completed: ImportResult = { status: 'completed', projectId, importId: id, workspaceId: id, itemCount: 1, cleanupWarning: false };
  const commit = vi.fn<ImportService['commit']>().mockResolvedValue(completed), discard = vi.fn<ImportService['discard']>();
  const service: ImportService = { scan, preview, commit, discard };
  const binding = registerImportHandlers(ipc, contents, url, database, service, { selectionDirectory }, { showOpenDialog });
  bindings.push(binding); const captured = new Map(handlers);
  const dispatch = (channel: string, ...args: unknown[]) => Promise.resolve(captured.get(channel)!(eventState as IpcMainInvokeEvent, ...args));
  const start = (sourceKind: ImportSourceKind = 'folder') => dispatch('import:start', { projectId, mode: 'copy', sourceKind });
  async function select() {
    const reply = importStartResponseSchema.parse(await start());
    if (!reply.ok || reply.value.status !== 'started') throw new Error('Expected started');
    return { projectId, jobId: reply.value.job.id, token: reply.value.token };
  }
  const navigate = () => state.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
  return { frameState, state, contents, eventState, handlers, ipc, showOpenDialog, service, scan, preview, commit, discard,
    completed, binding, dispatch, start, select, navigate };
}
describe.skipIf(process.platform !== 'win32')('DAT-08H native picker boundary', () => {
  beforeEach(() => {
    bindings = []; root = fs.realpathSync.native(fs.mkdtempSync(join(tmpdir(), 'av-dat08h-')));
    selectionDirectory = join(root, 'selections'); fs.mkdirSync(selectionDirectory);
    database = openDatabase(join(root, 'metadata.sqlite3')); migrateDatabase(database, [{ version: 1, sql }]);
    insertProject(database, { id: projectId, name: 'Test', description: '', taskType: 'classification',
      workspacePath: join(root, 'project'), createdAt: '2026-09-13T00:00:00.000Z', updatedAt: '2026-09-13T00:00:00.000Z' });
  });
  afterEach(() => { vi.restoreAllMocks(); for (const binding of bindings) binding.dispose(); database.close(); fs.rmSync(root, { recursive: true, force: true }); });
  it('registers four channels without launching or browsing sources; disposal owns only its registrations', () => {
    const h = harness(); expect([...h.handlers.keys()]).toEqual(channels); expect(h.scan).not.toHaveBeenCalled();
    expect(h.showOpenDialog).not.toHaveBeenCalled(); h.binding.dispose(); h.binding.dispose();
    expect(h.ipc.removeHandler.mock.calls).toEqual(channels.map((channel) => [channel]));
    const foreign = vi.fn(); h.handlers.set('import:commit', foreign);
    expect(() => registerImportHandlers(h.ipc, h.contents, url, database, h.service, { selectionDirectory }, h)).toThrow('foreign');
    expect([...h.handlers.keys()]).toEqual(['import:commit']); expect(h.handlers.get('import:commit')).toBe(foreign);
  });
  it('rejects extra args, renderer paths/task/token and proxies before dialog/DB access', async () => {
    const h = harness(), read = vi.spyOn(database, 'prepare');
    const input = { projectId, mode: 'copy', sourceKind: 'folder' };
    for (const key of ['root', 'taskType', 'token', 'selectionDirectory', 'source']) {
      expect(await h.dispatch('import:start', { ...input, [key]: chosen })).toEqual(failure('INVALID_REQUEST'));
    }
    expect(await h.dispatch('import:start', input, undefined)).toEqual(failure('INVALID_REQUEST'));
    const proxy = Proxy.revocable({}, {}); proxy.revoke();
    expect(await h.dispatch('import:start', proxy.proxy)).toEqual(failure('INVALID_REQUEST'));
    expect(read).not.toHaveBeenCalled(); expect(h.showOpenDialog).not.toHaveBeenCalled();
  });
  it.each(['sender', 'frame', 'frame-url', 'contents-url'])('rejects wrong %s', async (kind) => {
    const h = harness();
    if (kind === 'sender') h.eventState.sender = {} as WebContents;
    if (kind === 'frame') h.eventState.senderFrame = { url } as WebFrameMain;
    if (kind === 'frame-url') h.frameState.url = `${url}?x=1`;
    if (kind === 'contents-url') h.state.getURL.mockReturnValue('https://example.invalid');
    expect(await h.start()).toEqual(failure('INVALID_REQUEST')); expect(h.scan).not.toHaveBeenCalled();
  });
  it.each(['folder', 'csv', 'unlabeled-directory', 'unlabeled-files'] as const)('constructs %s exclusively from native selections', async (kind) => {
    const h = harness();
    h.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: kind === 'unlabeled-files' ? [`${chosen}\\a.png`, `${chosen}\\b.png`] : [chosen] });
    h.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [`${chosen}\\labels.csv`] });
    const inspect = vi.spyOn(fs, 'lstatSync'), realpath = vi.spyOn(fs.realpathSync, 'native'), open = vi.spyOn(fs, 'openSync');
    expect(await h.start(kind)).toMatchObject({ ok: true, value: { status: 'started' } });
    expect(h.showOpenDialog).toHaveBeenCalledTimes(kind === 'csv' ? 2 : 1);
    expect(inspect.mock.calls.some(([path]) => String(path).startsWith(chosen))).toBe(false);
    expect(realpath.mock.calls.some(([path]) => String(path).startsWith(chosen))).toBe(false);
    expect(open.mock.calls.some(([path]) => String(path).startsWith(chosen))).toBe(false);
    const payload = h.scan.mock.calls[0]![1];
    if (kind === 'unlabeled-files') {
      const files = fs.readdirSync(selectionDirectory); expect(files).toHaveLength(1);
      const filename = join(selectionDirectory, files[0]!);
      expect(payload).toEqual({ taskType: 'classification', mode: 'copy', source: { format: 'unlabeled', selection: 'files', selectionManifestPath: filename } });
      expect(JSON.parse(fs.readFileSync(filename, 'utf8'))).toEqual({ formatVersion: 1, files: [`${chosen}\\a.png`, `${chosen}\\b.png`] });
      expect(open.mock.calls).toContainEqual([filename, 'wx', 0o600]);
      h.navigate(); expect(fs.existsSync(filename)).toBe(true);
    } else expect(payload).toEqual({ taskType: 'classification', mode: 'copy', source: kind === 'csv'
      ? { format: 'csv', root: chosen, annotationPath: `${chosen}\\labels.csv` }
      : kind === 'folder' ? { format: 'folder', root: chosen } : { format: 'unlabeled', selection: 'directory', root: chosen } });
  });
  it('allows detection COCO only with root then JSON, refuses incompatible types before dialogs', async () => {
    const h = harness(); expect(await h.start('coco')).toEqual(failure('IMPORT_INPUT'));
    database.prepare("UPDATE projects SET task_type='detection' WHERE id=?").run(projectId);
    expect(await h.start('folder')).toEqual(failure('IMPORT_INPUT')); expect(h.showOpenDialog).not.toHaveBeenCalled();
    h.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [chosen] })
      .mockResolvedValueOnce({ canceled: false, filePaths: [`${chosen}\\labels.json`] });
    expect(await h.start('coco')).toMatchObject({ ok: true });
    expect(h.scan.mock.calls[0]).toEqual([projectId, { taskType: 'detection', mode: 'copy', source: { format: 'coco', root: chosen, annotationPath: `${chosen}\\labels.json` } }]);
  });
  it.each([1, 2])('cancellation at dialog %s never scans', async (dialog) => {
    const h = harness(); if (dialog === 2) h.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [chosen] });
    h.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
    expect(await h.start('csv')).toEqual({ ok: true, value: { status: 'cancelled' } }); expect(h.scan).not.toHaveBeenCalled();
  });
  it.each(['\\\\server\\share\\x', '\\\\?\\C:\\x', 'C:\\a\\..\\b', 'C:/images', 'C:\\a\\NUL.png', 'C:\\a\\b.', 'C:\\a\\x:stream', 'C:\\'])('rejects unsafe path %s without source I/O', async (path) => {
    const h = harness(); h.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [path] });
    const inspect = vi.spyOn(fs, 'lstatSync'); expect(await h.start()).toEqual(failure('IMPORT_INPUT'));
    expect(inspect).not.toHaveBeenCalled(); expect(h.scan).not.toHaveBeenCalled();
  });
  it('rejects overbound multi-selection and replaced managed directory before writes', async () => {
    const h = harness(); h.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: Array<string>(100_001).fill(`${chosen}\\a.png`) });
    expect(await h.start('unlabeled-files')).toEqual(failure('IMPORT_INPUT'));
    const gate = Promise.withResolvers<OpenDialogReturnValue>(); h.showOpenDialog.mockReturnValueOnce(gate.promise);
    const pending = h.start('unlabeled-files'); fs.renameSync(selectionDirectory, `${selectionDirectory}-old`); fs.mkdirSync(selectionDirectory);
    gate.resolve({ canceled: false, filePaths: [`${chosen}\\a.png`] });
    expect(await pending).toEqual(failure('IMPORT_ATTENTION')); expect(fs.readdirSync(selectionDirectory)).toEqual([]); expect(h.scan).not.toHaveBeenCalled();
  });
  it('new picker wins, discards old context, and late preview cannot escape', async () => {
    const h = harness(), old = await h.select(); const previewGate = Promise.withResolvers<Awaited<ReturnType<ImportService['preview']>>>();
    h.preview.mockReturnValueOnce(previewGate.promise); const pendingPreview = h.dispatch('import:preview', old);
    const gate = Promise.withResolvers<OpenDialogReturnValue>(); h.showOpenDialog.mockReturnValueOnce(gate.promise);
    const pendingStart = h.start(); const next = await h.select();
    gate.resolve({ canceled: false, filePaths: [chosen] }); expect(await pendingStart).toEqual(failure('STALE_SELECTION'));
    previewGate.resolve({ projectId, jobId: old.jobId, taskType: 'classification', mode: 'copy', itemCount: 1, sourceBytes: '1', classes: [], issues: [], files: [{ key: 'a', displayName: 'a.png' }] });
    expect(await pendingPreview).toEqual(failure('STALE_SELECTION')); expect(h.discard).toHaveBeenCalledWith(old.jobId);
    expect(await h.dispatch('import:preview', next)).toMatchObject({ ok: true });
  });
  it.each(['name', 'task_type'])('rejects cached preview after Project %s edit without calling preview again', async (column) => {
    const h = harness(), input = await h.select();
    const cached = h.preview(projectId, input.jobId); h.preview.mockReturnValue(cached); h.preview.mockClear();
    expect(await h.dispatch('import:preview', input)).toMatchObject({ ok: true });
    h.preview.mockClear();
    database.prepare(`UPDATE projects SET ${column}=? WHERE id=?`).run(column === 'name' ? 'Changed' : 'detection', projectId);
    expect(await h.dispatch('import:preview', input)).toEqual(failure('IMPORT_PROJECT_CHANGED'));
    expect(h.preview).not.toHaveBeenCalled();
  });
  it.each(['preview', 'commit'] as const)('rejects Project edit before %s without calling service', async (operation) => {
    const h = harness(), input = await h.select();
    database.prepare("UPDATE projects SET description='Changed' WHERE id=?").run(projectId);
    expect(await h.dispatch(`import:${operation}`, { ...input, ...(operation === 'commit' ? { rightsAccepted: true } : {}) }))
      .toEqual(failure('IMPORT_PROJECT_CHANGED'));
    expect(h[operation]).not.toHaveBeenCalled();
  });
  it.each(['preview', 'commit'] as const)('rejects synchronous %s callback Project edit before acknowledgement', async (operation) => {
    const h = harness(), input = await h.select();
    const edit = () => { database.prepare("UPDATE projects SET name='Changed' WHERE id=?").run(projectId); };
    if (operation === 'preview') h.preview.mockImplementationOnce(async () => {
      edit(); return { projectId, jobId: input.jobId, taskType: 'classification', mode: 'copy', itemCount: 1,
        sourceBytes: '1', classes: [], issues: [], files: [{ key: 'i', displayName: 'i.png' }] };
    });
    if (operation === 'commit') h.commit.mockImplementationOnce(async () => { edit(); return h.completed; });
    expect(await h.dispatch(`import:${operation}`, { ...input, ...(operation === 'commit' ? { rightsAccepted: true } : {}) }))
      .toEqual(failure('IMPORT_PROJECT_CHANGED'));
    expect(h[operation]).toHaveBeenCalledOnce();
  });
  it.each(['before', 'callback'] as const)('accepts scoped discard with a Project edit %s service invocation', async (timing) => {
    const h = harness(), input = await h.select();
    const edit = () => { database.prepare("UPDATE projects SET name='Changed' WHERE id=?").run(projectId); };
    if (timing === 'before') edit(); else h.discard.mockImplementationOnce(edit);
    expect(await h.dispatch('import:discard', input)).toEqual({ ok: true, value: null });
    expect(h.discard).toHaveBeenCalledExactlyOnceWith(input.jobId);
    expect(await h.dispatch('import:discard', input)).toEqual(failure('STALE_SELECTION'));
    expect(h.discard).toHaveBeenCalledTimes(1);
  });
  it('rejects commit after a ready cached preview and name save, then discards only the old capability and rescans', async () => {
    // Real handler + real temporary metadata DB; scan/preview/commit are service ports.
    const h = harness(), input = await h.select();
    const cached = h.preview(projectId, input.jobId); h.preview.mockReturnValueOnce(cached); h.preview.mockClear();
    expect(await h.dispatch('import:preview', input)).toMatchObject({ ok: true, value: { jobId: input.jobId } });
    database.prepare("UPDATE projects SET name='Saved after preview' WHERE id=?").run(projectId);
    expect(await h.dispatch('import:commit', { ...input, rightsAccepted: true })).toEqual(failure('IMPORT_PROJECT_CHANGED'));
    expect(h.commit).not.toHaveBeenCalled(); expect(h.discard).not.toHaveBeenCalled();
    expect(await h.dispatch('import:discard', input)).toEqual({ ok: true, value: null });
    expect(h.discard).toHaveBeenCalledExactlyOnceWith(input.jobId);
    const next = await h.select();
    expect(next.token).not.toBe(input.token); expect(next.jobId).not.toBe(input.jobId);
    expect(h.showOpenDialog).toHaveBeenCalledTimes(2); expect(h.scan).toHaveBeenCalledTimes(2);
    for (const operation of ['preview', 'commit', 'discard'] as const) {
      expect(await h.dispatch(`import:${operation}`, { ...input, ...(operation === 'commit' ? { rightsAccepted: true } : {}) }))
        .toEqual(failure('STALE_SELECTION'));
    }
    expect(h.discard).toHaveBeenCalledTimes(1);
    expect(await h.dispatch('import:preview', next)).toMatchObject({ ok: true, value: { jobId: next.jobId } });
    expect(h.preview).toHaveBeenCalledTimes(2);
    expect(await h.dispatch('import:commit', { ...next, rightsAccepted: true })).toEqual({ ok: true, value: h.completed });
    expect(h.commit).toHaveBeenCalledExactlyOnceWith(projectId, next.jobId, { mode: 'copy', rightsAccepted: true });
  });
  it('rejects parent junction introduced inside open before writing any selected paths', async () => {
    const h = harness(), outside = join(root, 'outside'), saved = `${selectionDirectory}-saved`;
    fs.mkdirSync(outside); const sentinel = join(outside, 'existing.json'); fs.writeFileSync(sentinel, 'unchanged');
    h.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['C:\\PRIVATE\\secret.png'] });
    const realOpen = fs.openSync;
    const open = vi.spyOn(fs, 'openSync').mockImplementationOnce((path, flags, mode) => {
      fs.renameSync(selectionDirectory, saved); fs.symlinkSync(outside, selectionDirectory, 'junction');
      return realOpen(path, flags, mode);
    });
    const write = vi.spyOn(fs, 'writeFileSync'), close = vi.spyOn(fs, 'closeSync'), unlink = vi.spyOn(fs, 'unlinkSync');
    expect(await h.start('unlabeled-files')).toEqual(failure('IMPORT_ATTENTION'));
    expect(write).not.toHaveBeenCalled(); expect(h.scan).not.toHaveBeenCalled(); expect(unlink).not.toHaveBeenCalled();
    const fd = open.mock.results[0]!.value as number;
    expect(close).toHaveBeenCalledWith(fd); expect(() => fs.fstatSync(fd)).toThrow();
    const artifacts = fs.readdirSync(outside).filter((name) => name !== 'existing.json'); expect(artifacts).toHaveLength(1);
    expect(fs.readFileSync(join(outside, artifacts[0]!))).toHaveLength(0);
    expect(fs.readFileSync(sentinel, 'utf8')).toBe('unchanged'); expect(fs.readdirSync(saved)).toEqual([]);
  });
  it('rejects same-size named file replacement after open without overwriting unknown records', async () => {
    const h = harness(), realOpen = fs.openSync, realWrite = fs.writeFileSync;
    let named = '', moved = '';
    const open = vi.spyOn(fs, 'openSync').mockImplementationOnce((path, flags, mode) => {
      const fd = realOpen(path, flags, mode); named = String(path); moved = `${named}.original`;
      fs.renameSync(named, moved); realWrite(named, Buffer.alloc(0)); return fd;
    });
    const write = vi.spyOn(fs, 'writeFileSync'), close = vi.spyOn(fs, 'closeSync');
    expect(await h.start('unlabeled-files')).toEqual(failure('IMPORT_ATTENTION'));
    expect(write).not.toHaveBeenCalled(); expect(h.scan).not.toHaveBeenCalled();
    const fd = open.mock.results[0]!.value as number;
    expect(close).toHaveBeenCalledWith(fd); expect(() => fs.fstatSync(fd)).toThrow();
    expect(fs.readFileSync(named)).toHaveLength(0); expect(fs.readFileSync(moved)).toHaveLength(0);
  });
  it.each(['name', 'description', 'task_type', 'workspace_path', 'created_at', 'updated_at'])('revalidates changed Project %s after await', async (column) => {
    const h = harness(), gate = Promise.withResolvers<OpenDialogReturnValue>(); h.showOpenDialog.mockReturnValueOnce(gate.promise);
    const pending = h.start(); const value = column === 'task_type' ? 'detection' : column === 'workspace_path' ? join(root, 'changed')
      : column.endsWith('_at') ? '2026-09-14T00:00:00.000Z' : 'changed';
    database.prepare(`UPDATE projects SET ${column}=? WHERE id=?`).run(value, projectId);
    gate.resolve({ canceled: false, filePaths: [chosen] }); expect(await pending).toEqual(failure('IMPORT_PROJECT_CHANGED')); expect(h.scan).not.toHaveBeenCalled();
  });
  it('navigation suppresses even cancellation; tokens bind project/job/window and expire on discard', async () => {
    const h = harness(), gate = Promise.withResolvers<OpenDialogReturnValue>(); h.showOpenDialog.mockReturnValueOnce(gate.promise);
    const pending = h.start(); h.navigate(); gate.resolve({ canceled: true, filePaths: [] });
    expect(await pending).toEqual(failure('STALE_SELECTION')); const input = await h.select();
    for (const overrides of [{ token: randomUUID() }, { projectId: randomUUID() }, { jobId: randomUUID() }]) {
      expect(await h.dispatch('import:preview', { ...input, ...overrides })).toEqual(failure('STALE_SELECTION'));
    }
    expect(await harness().dispatch('import:preview', input)).toEqual(failure('STALE_SELECTION'));
    expect(await h.dispatch('import:discard', input)).toEqual({ ok: true, value: null });
    expect(await h.dispatch('import:preview', input)).toEqual(failure('STALE_SELECTION'));
  });
  it('commit excludes duplicates/start/discard, survives disposal without rollback or cancellation', async () => {
    const h = harness(), input = { ...await h.select(), rightsAccepted: true };
    const gate = Promise.withResolvers<ImportResult>(); h.commit.mockReturnValueOnce(gate.promise);
    const pending = h.dispatch('import:commit', input);
    expect(await h.dispatch('import:commit', input)).toEqual(failure('IMPORT_BUSY'));
    expect(await h.start()).toEqual(failure('IMPORT_BUSY'));
    expect(await h.dispatch('import:discard', { projectId, jobId: input.jobId, token: input.token })).toEqual(failure('IMPORT_BUSY'));
    h.binding.dispose(); expect(h.discard).not.toHaveBeenCalled(); gate.resolve(h.completed);
    expect(await pending).toEqual(failure('STALE_SELECTION')); expect(h.commit).toHaveBeenCalledOnce(); expect(h.discard).not.toHaveBeenCalled();
  });
  it('retains capability for explicit uncertain/success retry, sanitizes own capacity fields only', async () => {
    const h = harness(), input = { ...await h.select(), rightsAccepted: true };
    h.commit.mockRejectedValueOnce(new ImportServiceError('IMPORT_OUTCOME_UNCERTAIN', undefined, new Error(chosen)));
    expect(await h.dispatch('import:commit', input)).toEqual(failure('IMPORT_OUTCOME_UNCERTAIN'));
    expect(await h.dispatch('import:commit', input)).toEqual({ ok: true, value: h.completed });
    expect(await h.dispatch('import:commit', input)).toEqual({ ok: true, value: h.completed });
    h.commit.mockRejectedValueOnce(new ImportServiceError('IMPORT_CAPACITY', { requiredBytes: '10', availableBytes: '1' }));
    expect(await h.dispatch('import:commit', input)).toEqual({ ok: false, error: { code: 'IMPORT_CAPACITY', capacity: { requiredBytes: '10', availableBytes: '1' } } });
    const getter = vi.fn(() => { throw new Error(chosen); }); const error = Object.defineProperty(new Error(chosen), 'code', { get: getter });
    h.commit.mockRejectedValueOnce(error); expect(await h.dispatch('import:commit', input)).toEqual(failure('OPERATION_FAILED')); expect(getter).not.toHaveBeenCalled();
  });
});