import type { MessageBoxOptions, MessageBoxReturnValue } from 'electron';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { win32 } from 'node:path';

import { hardwareDiagnosticsSchema, type HardwareDiagnostics } from '../../shared/contracts/diagnostics.js';

export type DiagnosticExportResult = Readonly<
  | { status: 'saved'; path: string; byteLength: number; sha256: string }
  | { status: 'cancelled' }
  | { status: 'failed'; code: 'DIAGNOSTIC_EXPORT_FAILED' | 'DIAGNOSTIC_EXPORT_BUSY' }
>;
type Directory = { path: string; stat: fs.BigIntStats };
const failed = (): DiagnosticExportResult => ({ status: 'failed', code: 'DIAGNOSTIC_EXPORT_FAILED' });
const statusText = { ok: '取得済み', partial: '一部未取得', error: '取得失敗', not_checked: '未取得' } as const;
const number = (value: number | undefined | null) => value == null ? '未取得' : String(value);

function summary(value: unknown): string {
  const r = hardwareDiagnosticsSchema.parse(value);
  const state = (name: 'os' | 'cpu' | 'memory' | 'disk' | 'gpu' | 'onnxRuntime' | 'cuda') => {
    const group = r[name];
    return statusText[group.status] + (group.status === 'error' ? ` (${group.error.code})` : '');
  };
  const os = r.os.data, memory = r.memory.data, disk = r.disk.data, providers = r.onnxRuntime.data?.providers;
  const architecture = os == null || os.architecture.trim() === '' ? '未取得'
    : os.architecture === 'AMD64' ? 'AMD64' : 'AMD64以外（名称省略）';
  return [
    'AutoVision Studio 診断要約（形式1）',
    `診断状態: ${statusText[r.status]}`,
    `OS: ${state('os')} / ${os ? `${os.major}.${os.minor} build ${os.build} / 製品種別 ${os.productType}` : '未取得'} / ${architecture}`,
    `CPU: ${state('cpu')} / 論理プロセッサ ${number(r.cpu.data?.logicalCount)}`,
    `メモリ: ${state('memory')} / 合計 ${number(memory?.totalBytes)} B / 利用可能 ${number(memory?.availableBytes)} B / 使用率 ${number(memory?.loadPercent)}%`,
    `ディスク: ${state('disk')} / 合計 ${number(disk?.totalBytes)} B / 空き ${number(disk?.freeBytes)} B（userDataボリューム）`,
    `GPU: ${state('gpu')} / 表示アダプター ${number(r.gpu.data?.adapters.length)} 件 / 計算実行は未確認`,
    `ONNX Runtime: ${state('onnxRuntime')} / provider ${number(providers?.length)} 件 / CPU ${providers ? (providers.includes('CPUExecutionProvider') ? '一覧にあり' : '一覧になし') : '未取得'} / DirectML ${providers ? (providers.includes('DmlExecutionProvider') ? '一覧にあり' : '一覧になし') : '未取得'}`,
    `CUDA: ${state('cuda')} / PyTorch環境での検出 ${r.cuda.data ? (r.cuda.data.available ? 'あり' : 'なし') : '未取得'} / モデル実行は未確認`,
    'カメラ: 未取得・推論開始時に確認。ストリームは開いていません。',
    'CPU動作可・推奨構成・モデル性能・Project使用量の判定ではありません。',
    '画像、パス、機器名、自由な版文字列、Project情報、raw logは含みません。',
    '',
  ].join('\n');
}

function localDirectory(input: string): string {
  if (process.platform !== 'win32' || typeof input !== 'string' || !/^[a-z]:[\\/]/i.test(input)
    || /[\0-\x1f\x7f]/u.test(input) || input.slice(2).includes(':')
    || input.slice(3).split(/[\\/]/).some((part) => !part || part === '.' || part === '..' || /[ .]$|[<>"|?*]/u.test(part)
      || /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(part))) {
    throw new TypeError('診断の保存先にはMainが管理するローカルフォルダーが必要です。');
  }
  const path = win32.resolve(input);
  if (path === win32.parse(path).root) throw new TypeError('ドライブ直下は診断の保存先にできません。');
  return path;
}
function same(a: fs.BigIntStats, b: fs.BigIntStats) {
  return a.ino !== 0n && a.dev === b.dev && a.ino === b.ino && a.birthtimeNs === b.birthtimeNs;
}
function directories(path: string): Directory[] {
  const parts: string[] = [];
  for (let cursor = path;; cursor = win32.dirname(cursor)) {
    parts.unshift(cursor); if (win32.dirname(cursor) === cursor) break;
  }
  return parts.map((part) => {
    const stat = fs.lstatSync(part, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.ino === 0n) throw new Error('診断保存先を確認できません。');
    return { path: part, stat };
  });
}
function checkDirectories(guards: readonly Directory[]) {
  for (const guard of guards) {
    const now = fs.lstatSync(guard.path, { bigint: true });
    if (!now.isDirectory() || now.isSymbolicLink() || !same(now, guard.stat)) throw new Error('診断保存先が変わりました。');
  }
}
function checkFile(path: string, fd: number, identity: fs.BigIntStats, size: number, links: bigint) {
  for (const stat of [fs.lstatSync(path, { bigint: true }), fs.fstatSync(fd, { bigint: true })]) {
    if (!stat.isFile() || stat.isSymbolicLink() || !same(stat, identity) || stat.size !== BigInt(size) || stat.nlink !== links) {
      throw new Error('診断ファイルを確認できません。');
    }
  }
}
function publish(path: string, text: string, guards: readonly Directory[]): DiagnosticExportResult {
  const bytes = Buffer.from(text, 'utf8');
  // Internal sanity bound on this fixed-field summary, not a raw-log size policy.
  if (bytes.length > 8192) throw new Error('診断要約が上限を超えました。');
  const partial = `${path}.partial`;
  checkDirectories(guards);
  const fd = fs.openSync(partial, 'wx+', 0o600);
  // Retain uncertain attempts. Never unlink someone else's file on failure.
  try {
    const identity = fs.fstatSync(fd, { bigint: true });
    checkFile(partial, fd, identity, 0, 1n);
    fs.writeFileSync(fd, bytes); fs.fsyncSync(fd);
    checkDirectories(guards); checkFile(partial, fd, identity, bytes.length, 1n);
    const actual = Buffer.alloc(bytes.length + 1);
    let length = 0;
    while (length < actual.length) {
      const count = fs.readSync(fd, actual, { offset: length, length: actual.length - length, position: length });
      if (count === 0) break;
      length += count;
    }
    if (!actual.subarray(0, length).equals(bytes)) throw new Error('診断ファイルの内容が一致しません。');
    checkDirectories(guards); checkFile(partial, fd, identity, bytes.length, 1n);
    fs.linkSync(partial, path); // Atomic publication fails if any final path exists.
    checkDirectories(guards); checkFile(partial, fd, identity, bytes.length, 2n); checkFile(path, fd, identity, bytes.length, 2n);
    fs.unlinkSync(partial);
    checkFile(path, fd, identity, bytes.length, 1n);
  } finally { fs.closeSync(fd); }
  return Object.freeze({ status: 'saved', path, byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}

/**
 * SEC-07B Main-only: bind an EXISTING private local app-data/logs directory and
 * an owning-window native dialog adapter. No factory-time I/O or export.
 * Call only for an explicit UI action, with a Main-observed report, never a
 * Renderer path/snapshot. The caller owns IPC sender validation and lifecycle.
 * Node path checks are not ACL/mapped-drive attestation or hostile-OS atomicity.
 * dispose cancels a pending prompt; once admitted, the small synchronous write
 * has no await/reentrant UI interval. No automatic retries or old-file deletion.
 */
export function createDiagnosticExporter(logDirectory: string, nativeDialog: {
  showMessageBox(options: MessageBoxOptions): Promise<MessageBoxReturnValue>;
}) {
  const directory = localDirectory(logDirectory), show = nativeDialog.showMessageBox.bind(nativeDialog);
  let disposed = false, active: AbortController | null = null;
  return Object.freeze({
    async export(report: HardwareDiagnostics, signal?: AbortSignal): Promise<DiagnosticExportResult> {
      if (disposed) return failed();
      if (signal?.aborted) return { status: 'cancelled' };
      if (active) return { status: 'failed', code: 'DIAGNOSTIC_EXPORT_BUSY' };
      const controller = new AbortController(); active = controller;
      const cancel = () => controller.abort();
      try {
        signal?.addEventListener('abort', cancel, { once: true });
        const text = summary(report), guards = directories(directory);
        const path = win32.join(directory, `diagnostics-${randomUUID()}.txt`);
        const answer = await show({ type: 'info', title: '診断要約の保存', message: '以下の内容だけを端末内に保存します。',
          detail: `${text}\n保存先: ${path}`, buttons: ['キャンセル', '保存'], defaultId: 0, cancelId: 0,
          noLink: true, signal: controller.signal });
        if (disposed || controller.signal.aborted || answer.response !== 1) return { status: 'cancelled' };
        checkDirectories(guards);
        return publish(path, text, guards);
      } catch { return failed(); }
      finally {
        signal?.removeEventListener('abort', cancel);
        if (active === controller) active = null;
      }
    },
    dispose(): void { disposed = true; active?.abort(); },
  });
}