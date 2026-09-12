// @vitest-environment node
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, parse } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cleanupNewProjectDirectory, createProjectDirectory, verifyProjectDirectory } from './project-directory.js';

const id = 'b66a587d-619c-4cc8-850b-c677f0698311';
const otherId = 'ef0c592c-2055-4f68-9c4a-7d7f6cd3ead2';
const markerName = '.autovision-project.json';
const canonical = `${JSON.stringify({ schemaVersion: 1, projectId: id })}\n`;

describe.skipIf(process.platform !== 'win32')('Windows Project directory ownership', () => {
  let temporary: string;
  let parent: string;
  beforeEach(() => {
    temporary = fs.realpathSync.native(fs.mkdtempSync(join(tmpdir(), 'autovision-core06a-')));
    parent = join(temporary, 'Parent 日本語');
    fs.mkdirSync(parent);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    // Every path/link target in these tests is inside this test-owned fixture.
    fs.rmSync(temporary, { recursive: true, force: true });
  });

  it('creates canonical minimal markers and independent roots without owning parent files', () => {
    fs.writeFileSync(join(parent, 'keep.txt'), 'user data');
    const first = createProjectDirectory(parent, id.toUpperCase(), []);
    const second = createProjectDirectory(parent, otherId, [first.rootPath]);
    expect(first.rootPath).toBe(join(parent, id));
    expect(fs.readFileSync(join(first.rootPath, markerName), 'utf8')).toBe(canonical);
    expect(verifyProjectDirectory(first.rootPath, id.toUpperCase())).toEqual(first);
    expect(first.rootIdentity.ino).toBe(String(fs.lstatSync(first.rootPath, { bigint: true }).ino));
    expect(Object.isFrozen(first)).toBe(true);
    expect(cleanupNewProjectDirectory(first)).toBe(true);
    expect(cleanupNewProjectDirectory(first)).toBe(false);
    expect(verifyProjectDirectory(second.rootPath, otherId).projectId).toBe(otherId);
    expect(fs.readFileSync(join(parent, 'keep.txt'), 'utf8')).toBe('user data');
  });

  it.each([
    { name: 'accepts stable ctime differences between lstat and fstat', api: null, field: null },
    { name: 'accepts metadata-only path ctime settlement while opening', api: 'opening', field: null },
    { name: 'rejects post-read fstat ctime changes', api: 'fstatSync', field: 'ctimeNs' },
    { name: 'rejects post-read fstat mtime changes', api: 'fstatSync', field: 'mtimeNs' },
    { name: 'rejects post-read lstat ctime changes', api: 'lstatSync', field: 'ctimeNs' },
    { name: 'rejects post-read lstat mtime changes', api: 'lstatSync', field: 'mtimeNs' },
  ] as const)('$name', ({ api, field }) => {
    const root = join(parent, id);
    fs.mkdirSync(root);
    const marker = join(root, markerName);
    fs.writeFileSync(marker, canonical);
    const lstat = fs.lstatSync;
    const before = lstat(marker, { bigint: true });
    const opened = Object.assign(lstat(marker, { bigint: true }), { ctimeNs: before.ctimeNs + 1n });
    const changed = Object.assign(lstat(marker, { bigint: true }), api === 'fstatSync' ? opened : before);
    if (field !== null) changed[field] += 1n;

    const descriptorStats = vi.spyOn(fs, 'fstatSync').mockReturnValueOnce(opened)
      .mockReturnValue(api === 'fstatSync' ? changed : opened);
    let markerStats = 0;
    vi.spyOn(fs, 'lstatSync').mockImplementation((path, options) => {
      if (path !== marker) return lstat(path, options);
      markerStats += 1;
      if (api === 'opening' && markerStats > 1) return opened;
      return api === 'lstatSync' && markerStats > 2 ? changed : before;
    });

    if (api === null || api === 'opening') {
      expect(verifyProjectDirectory(root, id)).toMatchObject({
        rootPath: root,
        projectId: id,
        markerIdentity: { dev: String(before.dev), ino: String(before.ino), birthtimeNs: String(before.birthtimeNs) },
      });
    } else {
      expect(() => verifyProjectDirectory(root, id)).toThrow(/読取り中に変更/);
    }
    expect(descriptorStats).toHaveBeenCalledTimes(2);
    expect(markerStats).toBe(3);
  });

  it.each(['size', 'mtimeNs'] as const)('rejects an opened marker %s mismatch before reading', (field) => {
    const root = join(parent, id);
    fs.mkdirSync(root);
    const marker = join(root, markerName);
    fs.writeFileSync(marker, canonical);
    const opened = fs.lstatSync(marker, { bigint: true });
    opened[field] += 1n;
    const descriptorStats = vi.spyOn(fs, 'fstatSync').mockReturnValue(opened);
    const read = vi.spyOn(fs, 'readSync');

    expect(() => verifyProjectDirectory(root, id)).toThrow(/Project所有markerの実体が変更/);
    expect(descriptorStats).toHaveBeenCalledTimes(1);
    expect(read).not.toHaveBeenCalled();
  });

  it.each(['', 'not-uuid', '../escape', `${id}:stream`])('rejects invalid ID %j before creation', (invalid) => {
    expect(() => createProjectDirectory(parent, invalid, [])).toThrow();
    expect(fs.readdirSync(parent)).toEqual([]);
  });

  it.each(['', 'relative', 'C:relative', '\\root-relative', 'C:\\', 'C:\\a:stream', '\\\\?\\C:\\folder',
    '\\\\.\\C:\\folder', 'C:\\bad*name', 'C:\\NUL', 'C:\\con.txt', 'C:\\LPT².txt', 'C:\\trailing.', 'C:\\trailing ', 'C:\\line\nfeed'])('rejects invalid Windows path %j', (invalid) => {
    expect(() => createProjectDirectory(invalid, id, [])).toThrow(TypeError);
    expect(fs.readdirSync(parent)).toEqual([]);
  });

  it('rejects nonexistent, non-directory and root parents without creating ancestors', () => {
    const missing = join(parent, 'missing', 'child');
    fs.writeFileSync(join(parent, 'file'), 'keep');
    for (const path of [missing, join(parent, 'file'), parse(parent).root]) {
      expect(() => createProjectDirectory(path, id, [])).toThrow();
    }
    expect(fs.existsSync(join(parent, 'missing'))).toBe(false);
  });

  it('never adopts or removes a preexisting UUID directory, even when empty', () => {
    const root = join(parent, id);
    fs.mkdirSync(root);
    expect(() => createProjectDirectory(parent, id, [])).toThrow();
    expect(fs.readdirSync(root)).toEqual([]);
    fs.writeFileSync(join(root, markerName), canonical);
    expect(() => createProjectDirectory(parent, id, [])).toThrow();
    expect(cleanupNewProjectDirectory(verifyProjectDirectory(root, id))).toBe(false);
    expect(fs.readFileSync(join(root, markerName), 'utf8')).toBe(canonical);
  });

  it('rejects same, ancestor and descendant registered roots without changing them', () => {
    const root = join(parent, id);
    fs.mkdirSync(root);
    const descendant = join(root, 'nested');
    fs.mkdirSync(descendant);
    for (const registered of [root, parent, temporary, descendant]) {
      expect(() => createProjectDirectory(parent, id, [registered])).toThrow(/重複/);
    }
    expect(fs.readdirSync(root)).toEqual(['nested']);
  });

  it('compares case and dot aliases but does not confuse sibling prefixes', () => {
    expect(() => createProjectDirectory(parent, id, [parent.toUpperCase()])).toThrow(/重複/);
    expect(() => createProjectDirectory(parent, id, [`${parent}\\.`])).toThrow(/重複/);
    const sibling = `${parent}-sibling`;
    fs.mkdirSync(sibling);
    const receipt = createProjectDirectory(`${parent}\\.`, id, [sibling]);
    expect(verifyProjectDirectory(receipt.rootPath.toUpperCase(), id)).toEqual(receipt);
  });

  it('fails closed on missing registered roots', () => {
    expect(() => createProjectDirectory(parent, id, [join(temporary, 'missing')])).toThrow();
    expect(fs.readdirSync(parent)).toEqual([]);
  });

  it('requires a matching UUID basename and marker; validation is read-only', () => {
    const root = join(parent, id);
    fs.mkdirSync(root);
    expect(() => verifyProjectDirectory(root, id)).toThrow();
    fs.writeFileSync(join(root, markerName), canonical);
    expect(() => verifyProjectDirectory(root, otherId)).toThrow();
    const renamed = join(parent, 'legacy');
    fs.renameSync(root, renamed);
    expect(() => verifyProjectDirectory(renamed, id)).toThrow();
    expect(fs.readFileSync(join(renamed, markerName), 'utf8')).toBe(canonical);
  });

  it.each(['{', '{}', 'null', JSON.stringify({ schemaVersion: 1, projectId: otherId }),
    JSON.stringify({ schemaVersion: 2, projectId: id }), JSON.stringify({ schemaVersion: 1, projectId: id, extra: true }),
    `{"schemaVersion":1,"schemaVersion":1,"projectId":"${id}"}\n`, 'x'.repeat(1024)])('rejects corrupt/noncanonical marker case %#', (contents) => {
    const receipt = createProjectDirectory(parent, id, []);
    const marker = join(receipt.rootPath, markerName);
    fs.writeFileSync(marker, contents);
    expect(() => verifyProjectDirectory(receipt.rootPath, id)).toThrow();
    expect(cleanupNewProjectDirectory(receipt)).toBe(false);
    expect(fs.readFileSync(marker, 'utf8')).toBe(contents);
  });

  it('rejects directory and hardlinked markers', () => {
    const receipt = createProjectDirectory(parent, id, []);
    const marker = join(receipt.rootPath, markerName);
    fs.linkSync(marker, join(temporary, 'marker-hardlink'));
    expect(() => verifyProjectDirectory(receipt.rootPath, id)).toThrow();
    expect(cleanupNewProjectDirectory(receipt)).toBe(false);
    fs.unlinkSync(marker);
    fs.mkdirSync(marker);
    expect(() => verifyProjectDirectory(receipt.rootPath, id)).toThrow();
    expect(cleanupNewProjectDirectory(receipt)).toBe(false);
  });

  it('preserves unexpected rollback content and rejects copied receipts', () => {
    const receipt = createProjectDirectory(parent, id, []);
    expect(cleanupNewProjectDirectory({ ...receipt })).toBe(false);
    fs.writeFileSync(join(receipt.rootPath, 'unknown'), 'keep');
    expect(cleanupNewProjectDirectory(receipt)).toBe(false);
    expect(fs.readFileSync(join(receipt.rootPath, markerName), 'utf8')).toBe(canonical);
    expect(fs.readFileSync(join(receipt.rootPath, 'unknown'), 'utf8')).toBe('keep');
  });

  it('does not remove replacement roots or replacement markers with identical bytes', () => {
    const receipt = createProjectDirectory(parent, id, []);
    fs.renameSync(receipt.rootPath, join(temporary, 'old-root'));
    fs.mkdirSync(receipt.rootPath);
    fs.writeFileSync(join(receipt.rootPath, markerName), canonical);
    expect(cleanupNewProjectDirectory(receipt)).toBe(false);
    const second = createProjectDirectory(parent, otherId, []);
    const marker = join(second.rootPath, markerName);
    fs.renameSync(marker, join(temporary, 'old-marker'));
    fs.copyFileSync(join(temporary, 'old-marker'), marker);
    expect(cleanupNewProjectDirectory(second)).toBe(false);
    expect(fs.existsSync(marker)).toBe(true);
  });

  it('rejects junction parents, ancestors (even before ..), registered roots, roots and markers', () => {
    const alias = join(temporary, 'alias');
    fs.symlinkSync(parent, alias, 'junction');
    for (const path of [alias, `${alias}\\..\\Parent 日本語`]) {
      expect(() => createProjectDirectory(path, id, [])).toThrow(/リンク/);
    }
    expect(() => createProjectDirectory(parent, id, [alias])).toThrow(/リンク/);
    const receipt = createProjectDirectory(parent, id, []);
    expect(() => verifyProjectDirectory(join(alias, id), id)).toThrow(/リンク/);
    const rootAliasParent = join(temporary, 'root-alias');
    fs.mkdirSync(rootAliasParent);
    fs.symlinkSync(receipt.rootPath, join(rootAliasParent, id), 'junction');
    expect(() => verifyProjectDirectory(join(rootAliasParent, id), id)).toThrow(/リンク/);
    fs.unlinkSync(join(receipt.rootPath, markerName));
    fs.symlinkSync(rootAliasParent, join(receipt.rootPath, markerName), 'junction');
    expect(() => verifyProjectDirectory(receipt.rootPath, id)).toThrow();
    expect(cleanupNewProjectDirectory(receipt)).toBe(false);
    expect(fs.existsSync(rootAliasParent)).toBe(true);
  });

  it('rejects file symlink markers when the OS permits unprivileged creation', ({ skip }) => {
    const receipt = createProjectDirectory(parent, id, []);
    const marker = join(receipt.rootPath, markerName);
    const target = join(temporary, 'marker-target');
    fs.renameSync(marker, target);
    try {
      fs.symlinkSync(target, marker, 'file');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') { skip(); return; }
      throw error;
    }
    expect(() => verifyProjectDirectory(receipt.rootPath, id)).toThrow();
    expect(cleanupNewProjectDirectory(receipt)).toBe(false);
    expect(fs.readFileSync(target, 'utf8')).toBe(canonical);
  });

  it('rolls back only its own partial marker after write failure', () => {
    const write = fs.writeFileSync;
    vi.spyOn(fs, 'writeFileSync').mockImplementationOnce((file, data) => {
      write(file, Buffer.from(data as Uint8Array).subarray(0, 5));
      throw new Error('simulated disk failure');
    });
    expect(() => createProjectDirectory(parent, id, [])).toThrow(/simulated disk failure/);
    expect(fs.readdirSync(parent)).toEqual([]);
  });

  it('preserves unknown files added during a failed create', () => {
    const write = fs.writeFileSync;
    vi.spyOn(fs, 'writeFileSync').mockImplementationOnce(() => {
      write(join(parent, id, 'unexpected'), 'keep');
      throw new Error('simulated disk failure');
    });
    expect(() => createProjectDirectory(parent, id, [])).toThrow(AggregateError);
    expect(fs.readFileSync(join(parent, id, 'unexpected'), 'utf8')).toBe('keep');
    expect(fs.existsSync(join(parent, id, markerName))).toBe(true);
  });
});