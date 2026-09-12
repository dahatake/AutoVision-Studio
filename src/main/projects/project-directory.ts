import fs from 'node:fs';
import { win32 } from 'node:path';

import { projectIdSchema } from '../../shared/contracts/project.js';

const markerName = '.autovision-project.json';
const markerLimit = 128;

export interface ProjectFileIdentity {
  readonly dev: string;
  readonly ino: string;
  readonly birthtimeNs: string;
}

export interface ProjectDirectoryReceipt {
  readonly rootPath: string;
  readonly projectId: string;
  readonly rootIdentity: ProjectFileIdentity;
  readonly markerIdentity: ProjectFileIdentity;
}

// Only the exact receipt returned by this process's create may authorize rollback.
// Verification of an old directory does not authorize deleting it.
const newlyCreated = new WeakSet<ProjectDirectoryReceipt>();

function identity(stat: fs.BigIntStats): ProjectFileIdentity {
  if (stat.ino === 0n) throw new Error('Projectのファイル同一性を確認できません。');
  return Object.freeze({ dev: String(stat.dev), ino: String(stat.ino), birthtimeNs: String(stat.birthtimeNs) });
}

function sameIdentity(left: ProjectFileIdentity, right: ProjectFileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.birthtimeNs === right.birthtimeNs;
}

function windowsPath(input: string): string {
  if (process.platform !== 'win32') throw new Error('Project directory操作はWindows専用です。');
  if (typeof input !== 'string' || !/^(?:[a-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+[\\/])/i.test(input)
    || /[\u0000-\u001f\u007f]/.test(input) || input.startsWith('\\\\?\\') || input.startsWith('\\\\.\\')
    || input.slice(/^[a-z]:/i.test(input) ? 2 : 0).includes(':')) {
    throw new TypeError('Projectにはドライブまたは共有配下の絶対フォルダーパスが必要です。');
  }
  const path = input.replaceAll('/', '\\');
  const names = /^[a-z]:/i.test(path) ? path.split('\\').slice(1) : path.split('\\').slice(2);
  if (names.some((name) => name !== '' && name !== '.' && name !== '..' && (
    /[<>:"|?*]/.test(name) || /[ .]$/.test(name)
    || /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name)
  )) || win32.resolve(path) === win32.parse(win32.resolve(path)).root) {
    throw new TypeError('Projectには通常のフォルダー名が必要です。ルートは選択できません。');
  }
  return path;
}

function directoryChain(path: string): { path: string; identity: ProjectFileIdentity }[] {
  let cursor = win32.parse(path).root;
  const chain: { path: string; identity: ProjectFileIdentity }[] = [];
  const inspect = () => {
    const stat = fs.lstatSync(cursor, { bigint: true });
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Projectパスにリンクまたは非通常フォルダーがあります。');
    chain.push({ path: cursor, identity: identity(stat) });
  };
  inspect();
  // Inspect each original component BEFORE resolving '..' or realpath. A link
  // must not disappear from validation through lexical normalization.
  for (const part of path.slice(cursor.length).split('\\')) {
    if (part === '' || part === '.') continue;
    cursor = part === '..' ? win32.dirname(cursor) : win32.join(cursor, part);
    inspect();
  }
  return chain;
}

function inspectDirectory(input: string) {
  const path = windowsPath(input);
  const original = directoryChain(path);
  const rootPath = fs.realpathSync.native(path);
  const canonical = directoryChain(windowsPath(rootPath));
  for (const entry of original) {
    const stat = fs.lstatSync(entry.path, { bigint: true });
    if (stat.isSymbolicLink() || !stat.isDirectory() || !sameIdentity(entry.identity, identity(stat))) {
      throw new Error('Projectパスの実体が変更されました。');
    }
  }
  const rootIdentity = canonical[canonical.length - 1]!.identity;
  if (!sameIdentity(rootIdentity, original[original.length - 1]!.identity)) throw new Error('Projectパスの実体が一致しません。');
  return { rootPath, rootIdentity, ancestors: canonical };
}

function contains(parent: string, child: string): boolean {
  const relative = win32.relative(parent.toLowerCase(), child.toLowerCase());
  return relative === '' || (relative !== '..' && !relative.startsWith('..\\') && !win32.isAbsolute(relative));
}

function markerBytes(projectId: string): Buffer {
  return Buffer.from(`${JSON.stringify({ schemaVersion: 1, projectId })}\n`, 'utf8');
}

function regularMarker(stat: fs.BigIntStats): void {
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n) throw new Error('Project所有markerは単一の通常ファイルでなければなりません。');
}

function readMarker(path: string, projectId: string): ProjectFileIdentity {
  const before = fs.lstatSync(path, { bigint: true });
  regularMarker(before);
  const expected = markerBytes(projectId);
  if (before.size !== BigInt(expected.length) || before.size > BigInt(markerLimit)) throw new Error('Project所有markerが不正です。');
  const markerIdentity = identity(before);
  // Windows does not provide an O_NOFOLLOW guarantee. Compare lstat/fstat and
  // recheck afterwards; bounded reads never trust an unchecked file size.
  const fd = fs.openSync(path, 'r');
  try {
    const opened = fs.fstatSync(fd, { bigint: true });
    regularMarker(opened);
    if (!sameIdentity(markerIdentity, identity(opened)) || opened.size !== before.size
      || opened.mtimeNs !== before.mtimeNs) {
      throw new Error('Project所有markerの実体が変更されました。');
    }
    // Opening a newly written Windows file can settle its metadata-only ctime.
    // Establish the path snapshot after open, without relaxing identity/content.
    const openedPath = fs.lstatSync(path, { bigint: true });
    regularMarker(openedPath);
    if (!sameIdentity(markerIdentity, identity(openedPath)) || openedPath.size !== before.size
      || openedPath.mtimeNs !== before.mtimeNs) {
      throw new Error('Project所有markerの実体が変更されました。');
    }
    const buffer = Buffer.alloc(markerLimit + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = fs.readSync(fd, buffer, length, buffer.length - length, length);
      if (count === 0) break;
      length += count;
    }
    // Windows lstat/fstat may report different ctimes for the same file;
    // compare each API's timestamps against its own pre-read snapshot.
    for (const [stat, snapshot] of [
      [fs.fstatSync(fd, { bigint: true }), opened],
      [fs.lstatSync(path, { bigint: true }), openedPath],
    ] as const) {
      regularMarker(stat);
      if (!sameIdentity(identity(snapshot), identity(stat)) || stat.size !== snapshot.size
        || stat.mtimeNs !== snapshot.mtimeNs || stat.ctimeNs !== snapshot.ctimeNs) {
        throw new Error('Project所有markerが読取り中に変更されました。');
      }
    }
    // Canonical bytes also reject extra/duplicate fields, other IDs and versions.
    if (!buffer.subarray(0, length).equals(expected)) throw new Error('Project所有markerが一致しません。');
    return markerIdentity;
  } finally {
    fs.closeSync(fd);
  }
}

/** Read-only ownership check, not a cryptographic proof against a hostile OS user. */
export function verifyProjectDirectory(root: string, id: string): ProjectDirectoryReceipt {
  const projectId = projectIdSchema.parse(id);
  const directory = inspectDirectory(root);
  if (projectIdSchema.parse(win32.basename(directory.rootPath)) !== projectId) throw new Error('ProjectのUUIDフォルダー名が一致しません。');
  const markerIdentity = readMarker(win32.join(directory.rootPath, markerName), projectId);
  if (!sameIdentity(directory.rootIdentity, inspectDirectory(root).rootIdentity)) throw new Error('Projectフォルダーの実体が変更されました。');
  return Object.freeze({ rootPath: directory.rootPath, projectId, rootIdentity: directory.rootIdentity, markerIdentity });
}

function removeCreatedDirectory(rootPath: string, rootIdentity: ProjectFileIdentity, markerIdentity?: ProjectFileIdentity): boolean {
  try {
    if (!sameIdentity(inspectDirectory(rootPath).rootIdentity, rootIdentity)) return false;
    const entries = fs.readdirSync(rootPath);
    if (entries.length !== 0) {
      if (entries.length !== 1 || entries[0] !== markerName || !markerIdentity) return false;
      const markerPath = win32.join(rootPath, markerName);
      const stat = fs.lstatSync(markerPath, { bigint: true });
      regularMarker(stat);
      if (!sameIdentity(identity(stat), markerIdentity)) return false;
      if (!sameIdentity(inspectDirectory(rootPath).rootIdentity, rootIdentity)) return false;
      fs.unlinkSync(markerPath);
    }
    if (!sameIdentity(inspectDirectory(rootPath).rootIdentity, rootIdentity)) return false;
    // Never recursive: content arriving after enumeration makes rmdir fail.
    fs.rmdirSync(rootPath);
    return true;
  } catch {
    return false;
  }
}

/** Existing ordinary parent only; never adopts an existing UUID child. */
export function createProjectDirectory(parent: string, id: string, existingRoots: readonly string[]): ProjectDirectoryReceipt {
  const projectId = projectIdSchema.parse(id);
  const directory = inspectDirectory(parent);
  const rootPath = win32.join(directory.rootPath, projectId);
  for (const registered of existingRoots) {
    // Fail closed for inaccessible/missing registered roots too. Never resolve
    // a registered junction silently and treat its alias as an independent root.
    const existing = inspectDirectory(registered);
    if (contains(rootPath, existing.rootPath) || contains(existing.rootPath, rootPath)
      || directory.ancestors.some((entry) => sameIdentity(entry.identity, existing.rootIdentity))) {
      throw new Error('Projectの保存領域が既存Projectと重複しています。');
    }
  }
  fs.mkdirSync(rootPath); // Exclusive, nonrecursive; outside rollback's try.
  let rootIdentity: ProjectFileIdentity | undefined;
  let markerIdentity: ProjectFileIdentity | undefined;
  try {
    rootIdentity = inspectDirectory(rootPath).rootIdentity;
    if (!sameIdentity(directory.rootIdentity, inspectDirectory(parent).rootIdentity)) throw new Error('親フォルダーの実体が変更されました。');
    const fd = fs.openSync(win32.join(rootPath, markerName), 'wx');
    try {
      const stat = fs.fstatSync(fd, { bigint: true });
      regularMarker(stat);
      markerIdentity = identity(stat);
      fs.writeFileSync(fd, markerBytes(projectId));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    const receipt = verifyProjectDirectory(rootPath, projectId);
    if (!sameIdentity(receipt.rootIdentity, rootIdentity) || !sameIdentity(receipt.markerIdentity, markerIdentity)) throw new Error('作成したProjectの実体が変更されました。');
    newlyCreated.add(receipt);
    return receipt;
  } catch (error) {
    if (!rootIdentity || !removeCreatedDirectory(rootPath, rootIdentity, markerIdentity)) {
      throw new AggregateError([error], 'Project作成に失敗しました。同一性または内容を確認できないため残存フォルダーは回収していません。');
    }
    throw error;
  }
}

/** Immediate create/DB rollback only. False means leave remaining data untouched. */
export function cleanupNewProjectDirectory(receipt: ProjectDirectoryReceipt): boolean {
  if (!newlyCreated.has(receipt)) return false;
  try {
    const current = verifyProjectDirectory(receipt.rootPath, receipt.projectId);
    if (!sameIdentity(current.rootIdentity, receipt.rootIdentity) || !sameIdentity(current.markerIdentity, receipt.markerIdentity)) return false;
    const removed = removeCreatedDirectory(receipt.rootPath, receipt.rootIdentity, receipt.markerIdentity);
    if (removed) newlyCreated.delete(receipt);
    return removed;
  } catch {
    return false;
  }
}