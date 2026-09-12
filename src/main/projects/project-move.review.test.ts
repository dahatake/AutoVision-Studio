// @vitest-environment node
import native from 'node:fs';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { openDatabase, type DatabaseConnection } from '../db/database.js';
import { migrateDatabase } from '../db/migrate.js';
import { moveProjectDirectory, recoverProjectMove } from './project-move.js';
import { decodeProjectMoveReceipt } from './project-move-receipt.js';
import { createProject, getProject, moveProject, recoverProject } from './project-service.js';

const markerName = '.autovision-project.json';
const reviewTimeout = 20_000;

interface ReviewFixture {
  readonly database: DatabaseConnection;
  readonly source: string;
  readonly dest1: string;
  readonly dest2: string;
  readonly receiptDirectory: string;
}

async function withReviewFixture(review: (fixture: ReviewFixture) => Promise<void>): Promise<void> {
  const temporary = native.mkdtempSync(join(tmpdir(), 'autovision-move-review-'));
  let database: DatabaseConnection | undefined;
  try {
    const root = native.realpathSync.native(temporary);
    const source = join(root, 'source');
    const dest1 = join(root, 'dest1');
    const dest2 = join(root, 'dest2');
    const receiptDirectory = join(root, 'project-moves');
    for (const path of [source, dest1, dest2, receiptDirectory]) native.mkdirSync(path);
    const device = native.lstatSync(source, { bigint: true }).dev;
    for (const path of [dest1, dest2]) expect(native.lstatSync(path, { bigint: true }).dev).toBe(device);
    database = openDatabase(join(root, 'metadata.sqlite3'));
    const sql = native.readFileSync(new URL('../db/migrations/001_core.sql', import.meta.url), 'utf8');
    migrateDatabase(database, [{ version: 1, sql }]);
    await review({ database, source, dest1, dest2, receiptDirectory });
  } finally {
    vi.restoreAllMocks();
    try { if (database?.open) database.close(); } finally {
      // Only this test's mkdtemp. Native fixture I/O closes its own file handles;
      // all move/recovery promises are awaited before this disposable cleanup.
      native.rmSync(temporary, { recursive: true, force: true });
    }
  }
}

function expectPayload(root: string, marker: Buffer, payload: Buffer): void {
  expect(native.readdirSync(root).sort()).toEqual([markerName, 'payload.txt']);
  expect(native.readFileSync(join(root, markerName))).toEqual(marker);
  expect(native.readFileSync(join(root, 'payload.txt'))).toEqual(payload);
}

// Regressions for the independently reviewed recovery fixes. Remaining known
// limitations are labelled explicitly; success never permits unknown deletion.
describe.skipIf(process.platform !== 'win32')('known limitation review', () => {
  it('R15B safely ends a failed copying intent on explicit recovery and permits a new move', async () => {
    await withReviewFixture(async ({ database, source, dest1, dest2, receiptDirectory }) => {
      const project = createProject(database, { name: 'Review A', taskType: 'classification', workspacePath: source });
      const payload = Buffer.from('A\n');
      native.writeFileSync(join(project.workspacePath, 'payload.txt'), payload, { flag: 'wx' });
      const marker = native.readFileSync(join(project.workspacePath, markerName));
      const firstTarget = join(dest1, project.id);
      const receiptPath = join(receiptDirectory, `${project.id}.json`);
      const failure = Object.assign(new Error('review-only destination mkdir failure'), { code: 'EACCES' });
      // Fail only the first target-root mkdir, after the REAL copying intent was
      // persisted. No permission changes, fake receipt or move/service mocks.
      const mkdir = vi.spyOn(native, 'mkdirSync').mockImplementationOnce((path) => {
        expect(path).toBe(firstTarget);
        throw failure;
      });
      try {
        await expect(moveProject(database, project.id, dest1, receiptDirectory, [])).rejects.toBe(failure);
        expect(mkdir).toHaveBeenCalledExactlyOnceWith(firstTarget);
      } finally { mkdir.mockRestore(); }

      expect(getProject(database, project.id)).toEqual(project);
      expect(database.inTransaction).toBe(false);
      expect(native.readdirSync(dest1)).toEqual([]);
      const rawReceipt = native.readFileSync(receiptPath);
      expect(decodeProjectMoveReceipt(rawReceipt)).toMatchObject({ projectId: project.id,
        phase: 'copying', source: { source: { rootPath: project.workspacePath } },
        targetPath: firstTarget, target: null, cursor: 0, pendingDelete: null });

      const unlink = vi.spyOn(native, 'unlinkSync');
      await expect(recoverProject(database, project.id, receiptDirectory)).resolves.toEqual({ project, cleanupStatus: 'none' });
      expect(unlink).toHaveBeenCalledExactlyOnceWith(receiptPath);
      expect(getProject(database, project.id)).toEqual(project);
      expect(database.inTransaction).toBe(false);
      expectPayload(project.workspacePath, marker, payload);
      expect(native.readdirSync(dest1)).toEqual([]);
      expect(native.readdirSync(dest2)).toEqual([]);
      expect(native.readdirSync(receiptDirectory)).toEqual([]);
      unlink.mockRestore();
      const moved = await moveProject(database, project.id, dest2, receiptDirectory, []);
      expect(moved.cleanupStatus).toBe('completed');
      expect(moved.project.workspacePath).toBe(join(dest2, project.id));
      expect(native.existsSync(project.workspacePath)).toBe(false);
      expectPayload(moved.project.workspacePath, marker, payload);
    });
  }, reviewTimeout);

  it.each(['unknown-target', 'source-change', 'target-junction', 'other-in-receipts', 'target-reappears', 'db-change', 'receipt-replaced'] as const)
    ('R15B preserves the failed record and all Project bytes on %s', async (kind) => {
      await withReviewFixture(async ({ database, source, dest1, receiptDirectory }) => {
        const project = createProject(database, { name: 'Abort boundary', taskType: 'classification', workspacePath: source });
        const payloadPath = join(project.workspacePath, 'payload.txt');
        native.writeFileSync(payloadPath, 'AAAA');
        const other = createProject(database, { name: 'Other', taskType: 'detection', workspacePath: source });
        const target = join(dest1, project.id);
        const receiptPath = join(receiptDirectory, `${project.id}.json`);
        const mkdir = vi.spyOn(native, 'mkdirSync').mockImplementationOnce(() => { throw new Error('target create failed'); });
        try { await expect(moveProject(database, project.id, dest1, receiptDirectory, [])).rejects.toThrow('target create failed'); }
        finally { mkdir.mockRestore(); }
        const raw = native.readFileSync(receiptPath);
        if (kind === 'unknown-target') {
          native.mkdirSync(target);
          native.writeFileSync(join(target, 'unknown'), 'KEEP');
        }
        if (kind === 'source-change') native.writeFileSync(payloadPath, 'BBBB');
        if (kind === 'target-junction') native.symlinkSync(other.workspacePath, target, 'junction');
        if (kind === 'other-in-receipts') database.prepare('UPDATE projects SET workspace_path=? WHERE id=?').run(receiptDirectory, other.id);
        let injected = false;
        const open = fs.open.bind(fs);
        const intercept = vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
          const handle = await open(...args);
          if (args[0] === payloadPath && args[1] === 'r' && !injected
            && (kind === 'target-reappears' || kind === 'db-change' || kind === 'receipt-replaced')) {
            const close = handle.close.bind(handle);
            vi.spyOn(handle, 'close').mockImplementationOnce(async () => {
              await close();
              injected = true;
              if (kind === 'target-reappears') native.mkdirSync(target);
              if (kind === 'db-change') database.prepare('UPDATE projects SET name=? WHERE id=?').run('Changed externally', project.id);
              if (kind === 'receipt-replaced') {
                native.renameSync(receiptPath, join(receiptDirectory, 'retained.json'));
                native.writeFileSync(receiptPath, raw, { flag: 'wx' });
              }
            });
          }
          return handle;
        });
        const unlink = vi.spyOn(native, 'unlinkSync');
        const rmdir = vi.spyOn(native, 'rmdirSync');
        try {
          const result = await recoverProject(database, project.id, receiptDirectory);
          expect(result.cleanupStatus).toBe('source-retained');
          expect(unlink).not.toHaveBeenCalled();
          expect(rmdir).not.toHaveBeenCalled();
          expect(native.readFileSync(receiptPath)).toEqual(raw);
          expect(native.readFileSync(payloadPath, 'utf8')).toBe(kind === 'source-change' ? 'BBBB' : 'AAAA');
          expect(getProject(database, project.id).workspacePath).toBe(project.workspacePath);
          if (kind === 'target-reappears' || kind === 'db-change' || kind === 'receipt-replaced') expect(injected).toBe(true);
          if (kind === 'unknown-target') expect(native.readFileSync(join(target, 'unknown'), 'utf8')).toBe('KEEP');
        } finally { intercept.mockRestore(); unlink.mockRestore(); rmdir.mockRestore(); }
      });
    }, reviewTimeout);

  it('R16 recovers A after B moves away from its recorded protected root', async () => {
    await withReviewFixture(async ({ database, source, dest1, dest2, receiptDirectory }) => {
      const projectA = createProject(database, { name: 'Review A', taskType: 'classification', workspacePath: source });
      const projectB = createProject(database, { name: 'Review B', taskType: 'classification', workspacePath: source });
      const payloadA = Buffer.from('A\n');
      const payloadB = Buffer.from('B\n');
      native.writeFileSync(join(projectA.workspacePath, 'payload.txt'), payloadA, { flag: 'wx' });
      native.writeFileSync(join(projectB.workspacePath, 'payload.txt'), payloadB, { flag: 'wx' });
      const markerA = native.readFileSync(join(projectA.workspacePath, markerName));
      const markerB = native.readFileSync(join(projectB.workspacePath, markerName));
      const targetA = join(dest1, projectA.id);
      const targetB = join(dest2, projectB.id);
      const receiptPathA = join(receiptDirectory, `${projectA.id}.json`);

      // The low-level move commits A's target but deliberately retains its source.
      // B's old root is recorded by the real DB inventory, not supplied by a fake.
      const movedA = await moveProjectDirectory(database, projectA.id, dest1, [], receiptDirectory);
      const currentA = getProject(database, projectA.id);
      expect(movedA.sourceRetained).toBe(true);
      expect(currentA).toEqual(movedA.project);
      expect(currentA.workspacePath).toBe(targetA);
      const rawReceiptA = native.readFileSync(receiptPathA);
      expect(decodeProjectMoveReceipt(rawReceiptA)).toMatchObject({ projectId: projectA.id,
        phase: 'prepared', source: { source: { rootPath: projectA.workspacePath }, protectedRoots: [projectB.workspacePath] },
        targetPath: targetA, target: { source: { rootPath: targetA }, protectedRoots: [projectA.workspacePath, projectB.workspacePath] },
        cursor: 0, pendingDelete: null });
      expectPayload(projectA.workspacePath, markerA, payloadA);
      expectPayload(targetA, markerA, payloadA);

      // B's ordinary service move, not fixture deletion, removes the old B root.
      const movedB = await moveProject(database, projectB.id, dest2, receiptDirectory, []);
      const currentB = getProject(database, projectB.id);
      expect(movedB).toEqual({ project: currentB, cleanupStatus: 'completed' });
      expect(currentB.workspacePath).toBe(targetB);
      expect(native.existsSync(projectB.workspacePath)).toBe(false);
      expect(native.readdirSync(receiptDirectory)).toEqual([`${projectA.id}.json`]);
      expect(native.readFileSync(receiptPathA)).toEqual(rawReceiptA);

      await expect(recoverProject(database, projectA.id, receiptDirectory)).resolves.toEqual({ project: currentA, cleanupStatus: 'completed' });
      expect(getProject(database, projectA.id)).toEqual(currentA);
      expect(getProject(database, projectB.id)).toEqual(currentB);
      expect(database.inTransaction).toBe(false);
      expect(native.existsSync(projectA.workspacePath)).toBe(false);
      expectPayload(targetA, markerA, payloadA);
      expectPayload(targetB, markerB, payloadB);
      expect(native.existsSync(projectB.workspacePath)).toBe(false);
      expect(native.existsSync(receiptPathA)).toBe(false);
    });
  }, reviewTimeout);

  it.each(['current-missing', 'historic-reappears', 'receipt-read-reappears', 'historic-junction', 'receipt-overlap', 'current-overlap'] as const)
    ('R16 refuses %s without deleting any A data', async (kind) => {
      await withReviewFixture(async ({ database, source, dest1, dest2, receiptDirectory }) => {
        const projectA = createProject(database, { name: 'A', taskType: 'classification', workspacePath: source });
        const projectB = createProject(database, { name: 'B', taskType: 'detection', workspacePath: source });
        native.writeFileSync(join(projectA.workspacePath, 'payload.txt'), 'AAAA');
        native.writeFileSync(join(projectB.workspacePath, 'payload.txt'), 'BBBB');
        await moveProjectDirectory(database, projectA.id, dest1, [], receiptDirectory);
        const movedB = await moveProject(database, projectB.id, dest2, receiptDirectory, []);
        expect(movedB.cleanupStatus).toBe('completed');
        const targetA = join(dest1, projectA.id);
        const receiptPath = join(receiptDirectory, `${projectA.id}.json`);
        const progressPath = join(receiptDirectory, `${projectA.id}.progress.json`);
        const raw = native.readFileSync(receiptPath);
        if (kind === 'current-missing') native.renameSync(movedB.project.workspacePath, join(dest2, 'retained-B'));
        if (kind === 'historic-junction') native.symlinkSync(movedB.project.workspacePath, projectB.workspacePath, 'junction');
        if (kind === 'receipt-overlap') database.prepare('UPDATE projects SET workspace_path=? WHERE id=?').run(receiptDirectory, projectB.id);
        if (kind === 'current-overlap') database.prepare('UPDATE projects SET workspace_path=? WHERE id=?').run(targetA, projectB.id);
        let injected = false;
        const open = fs.open.bind(fs);
        const intercept = vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
          const handle = await open(...args);
          if (!injected && args[1] === 'r' && ((kind === 'historic-reappears' && args[0] === join(targetA, 'payload.txt'))
            || (kind === 'receipt-read-reappears' && args[0] === progressPath))) {
            const close = handle.close.bind(handle);
            vi.spyOn(handle, 'close').mockImplementationOnce(async () => {
              await close();
              injected = true;
              native.mkdirSync(projectB.workspacePath);
              native.writeFileSync(join(projectB.workspacePath, 'unknown'), 'KEEP');
            });
          }
          return handle;
        });
        const unlink = vi.spyOn(native, 'unlinkSync');
        const rmdir = vi.spyOn(native, 'rmdirSync');
        const rename = vi.spyOn(fs, 'rename');
        try {
          await expect(recoverProjectMove(database, projectA.id, receiptDirectory)).rejects.toThrow();
          expect(unlink).not.toHaveBeenCalled();
          expect(rmdir).not.toHaveBeenCalled();
          expect(rename).not.toHaveBeenCalled();
          expect(native.readFileSync(receiptPath)).toEqual(raw);
          expect(native.readFileSync(join(projectA.workspacePath, 'payload.txt'), 'utf8')).toBe('AAAA');
          expect(native.readFileSync(join(targetA, 'payload.txt'), 'utf8')).toBe('AAAA');
          expect(getProject(database, projectA.id).workspacePath).toBe(targetA);
          if (kind === 'historic-reappears' || kind === 'receipt-read-reappears') {
            expect(injected).toBe(true);
            expect(native.readFileSync(join(projectB.workspacePath, 'unknown'), 'utf8')).toBe('KEEP');
          }
        } finally { intercept.mockRestore(); unlink.mockRestore(); rmdir.mockRestore(); rename.mockRestore(); }
      });
    }, reviewTimeout);

  it('R16 checks every CURRENT spelling before deduplication on a case-sensitive Windows directory', async () => {
    await withReviewFixture(async ({ database, source, dest1, dest2, receiptDirectory }) => {
      const a = createProject(database, { name: 'A', taskType: 'classification', workspacePath: source });
      const b = createProject(database, { name: 'B', taskType: 'classification', workspacePath: source });
      const c = createProject(database, { name: 'C', taskType: 'classification', workspacePath: source });
      await moveProjectDirectory(database, a.id, dest1, [], receiptDirectory);
      const lower = join(dest2, 'case-root');
      const upper = join(dest2, 'CASE-ROOT');
      native.mkdirSync(upper);
      database.prepare('UPDATE projects SET workspace_path=?,updated_at=? WHERE id=?').run(lower, '2030-01-02T00:00:00Z', b.id);
      database.prepare('UPDATE projects SET workspace_path=?,updated_at=? WHERE id=?').run(upper, '2030-01-01T00:00:00Z', c.id);
      const lstat = fs.lstat.bind(fs);
      let lowerChecked = false;
      // Simulate only the missing case-sensitive entry; no host case-sensitivity
      // policy or privileges are changed, all other filesystem calls are real.
      const inspect = vi.spyOn(fs, 'lstat').mockImplementation((async (path, options) => {
        if (path === lower) { lowerChecked = true; throw Object.assign(new Error('missing exact spelling'), { code: 'ENOENT' }); }
        return lstat(path, options);
      }) as typeof fs.lstat);
      const unlink = vi.spyOn(native, 'unlinkSync');
      const receiptPath = join(receiptDirectory, `${a.id}.json`);
      const raw = native.readFileSync(receiptPath);
      try {
        await expect(recoverProjectMove(database, a.id, receiptDirectory)).rejects.toThrow();
        expect(lowerChecked).toBe(true);
        expect(unlink).not.toHaveBeenCalled();
        expect(native.readFileSync(receiptPath)).toEqual(raw);
      } finally { inspect.mockRestore(); unlink.mockRestore(); }
    });
  }, reviewTimeout);
});