// @vitest-environment node
import type { MessageBoxOptions } from 'electron';
import crypto, { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hardwareDiagnosticsSchema, type HardwareDiagnostics } from '../../shared/contracts/diagnostics.js';
import { createDiagnosticExporter } from './diagnostic-export.js';

// Mock the named ESM export used by production, not only crypto's default object.
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return { ...actual, randomUUID: vi.fn(actual.randomUUID) };
});

const uuid = '11111111-1111-4111-8111-111111111111';
function observed(): HardwareDiagnostics {
  const ok = <T,>(data: T) => ({ status: 'ok', data, error: null });
  return hardwareDiagnosticsSchema.parse({ schemaVersion: 1, command: 'probe-hardware', status: 'ok',
    os: ok({ name: 'Windows', major: 10, minor: 0, build: 26100, productType: 1, architecture: 'AMD64' }),
    cpu: ok({ name: 'PRIVATE_CPU', logicalCount: 8 }), memory: ok({ totalBytes: 100, availableBytes: 50, loadPercent: 50 }),
    disk: ok({ totalBytes: 1000, usedBytes: 800, freeBytes: 200 }),
    gpu: ok({ adapters: [{ DeviceName: 'PRIVATE_DEVICE', DeviceString: 'PRIVATE_GPU', StateFlags: 0 }],
      scope: 'current-session-display-adapters', computeStatus: 'not_checked' }),
    onnxRuntime: ok({ version: 'PRIVATE_ORT_VERSION', providers: ['CPUExecutionProvider', 'DmlExecutionProvider', 'PRIVATE_PROVIDER'], executionStatus: 'not_checked' }),
    cuda: ok({ torchVersion: 'PRIVATE_TORCH_VERSION', runtimeVersion: null, available: false,
      scope: 'torch-runtime-only', executionStatus: 'not_checked', physicalGpuPresence: null }),
    camera: { status: 'deferred', streamOpened: false, reasonCode: 'check-on-inference-start' },
  });
}
const absent = { status: 'not_checked', data: null, error: null } as const;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve };
}
let directory: string, logs: string, path: string;
let nativeDialog: { showMessageBox: ReturnType<typeof vi.fn<(options: MessageBoxOptions) => Promise<{ response: number; checkboxChecked: boolean }>>> };
beforeEach(() => {
  directory = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'autovision-sec07b-')));
  logs = join(directory, 'ログ'); fs.mkdirSync(logs); path = join(logs, `diagnostics-${uuid}.txt`);
  vi.mocked(randomUUID).mockReset().mockReturnValue(uuid);
  nativeDialog = { showMessageBox: vi.fn().mockResolvedValue({ response: 1, checkboxChecked: false }) };
});
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(directory, { recursive: true, force: true }); });

describe('diagnostic summary export (SEC-07B)', () => {
  it('performs no I/O or dialog at construction and saves exactly the preview only after native confirmation', async () => {
    const open = vi.spyOn(fs, 'openSync'), stat = vi.spyOn(fs, 'lstatSync');
    const exporter = createDiagnosticExporter(logs, nativeDialog);
    expect(open).not.toHaveBeenCalled(); expect(stat).not.toHaveBeenCalled(); expect(nativeDialog.showMessageBox).not.toHaveBeenCalled();
    const gate = deferred<{ response: number; checkboxChecked: boolean }>(); nativeDialog.showMessageBox.mockReturnValueOnce(gate.promise);
    const report = observed(), result = exporter.export(report);
    const options = nativeDialog.showMessageBox.mock.calls[0][0];
    expect(options).toMatchObject({ type: 'info', title: '診断要約の保存', message: '以下の内容だけを端末内に保存します。',
      buttons: ['キャンセル', '保存'], defaultId: 0, cancelId: 0, noLink: true });
    expect(options.signal).toBeInstanceOf(AbortSignal); expect(options.signal?.aborted).toBe(false);
    expect(fs.readdirSync(logs)).toEqual([]); expect(open).not.toHaveBeenCalled();
    if (report.disk.status === 'ok') report.disk.data.freeBytes = 999;
    gate.resolve({ response: 1, checkboxChecked: false });
    const saved = await result; expect(saved.status).toBe('saved');
    if (saved.status !== 'saved') throw new Error('Expected saved summary');
    const text = fs.readFileSync(path, 'utf8');
    expect(options.detail).toBe(`${text}\n保存先: ${path}`);
    expect(text).toContain('空き 200 B'); expect(text).not.toContain('999'); expect(text).not.toContain('PRIVATE_');
    expect(text).toContain('CPU 一覧にあり / DirectML 一覧にあり'); expect(text).toContain('計算実行は未確認');
    expect(saved).toEqual({ status: 'saved', path, byteLength: Buffer.byteLength(text), sha256: crypto.createHash('sha256').update(text).digest('hex') });
    expect(Object.isFrozen(saved)).toBe(true); expect(fs.readdirSync(logs)).toEqual([`diagnostics-${uuid}.txt`]);
    expect(fs.lstatSync(path).nlink).toBe(1);
  });

  it.each([0, -1, 2, NaN, '1', undefined])('does not create files for non-affirmative response %j', async (response) => {
    nativeDialog.showMessageBox.mockResolvedValueOnce({ response, checkboxChecked: false } as { response: number; checkboxChecked: boolean });
    const open = vi.spyOn(fs, 'openSync');
    await expect(createDiagnosticExporter(logs, nativeDialog).export(observed())).resolves.toEqual({ status: 'cancelled' });
    expect(open).not.toHaveBeenCalled(); expect(fs.readdirSync(logs)).toEqual([]);
  });

  it('blocks duplicate requests while confirming and permits a fresh explicit request after cancellation', async () => {
    const gate = deferred<{ response: number; checkboxChecked: boolean }>(); nativeDialog.showMessageBox.mockReturnValueOnce(gate.promise);
    const exporter = createDiagnosticExporter(logs, nativeDialog), first = exporter.export(observed());
    await expect(exporter.export(observed())).resolves.toEqual({ status: 'failed', code: 'DIAGNOSTIC_EXPORT_BUSY' });
    expect(nativeDialog.showMessageBox).toHaveBeenCalledTimes(1); expect(fs.readdirSync(logs)).toEqual([]);
    gate.resolve({ response: 0, checkboxChecked: false }); await expect(first).resolves.toEqual({ status: 'cancelled' });
    expect((await exporter.export(observed())).status).toBe('saved'); expect(nativeDialog.showMessageBox).toHaveBeenCalledTimes(2);
  });

  it('aborts a prompt on dispose and refuses a late affirmative response and all future requests', async () => {
    const gate = deferred<{ response: number; checkboxChecked: boolean }>(); nativeDialog.showMessageBox.mockReturnValueOnce(gate.promise);
    const exporter = createDiagnosticExporter(logs, nativeDialog), first = exporter.export(observed());
    const signal = nativeDialog.showMessageBox.mock.calls[0][0].signal!;
    exporter.dispose(); exporter.dispose(); expect(signal.aborted).toBe(true);
    gate.resolve({ response: 1, checkboxChecked: false }); await expect(first).resolves.toEqual({ status: 'cancelled' });
    await expect(exporter.export(observed())).resolves.toEqual({ status: 'failed', code: 'DIAGNOSTIC_EXPORT_FAILED' });
    expect(fs.readdirSync(logs)).toEqual([]); expect(nativeDialog.showMessageBox).toHaveBeenCalledTimes(1);
  });

  it('keeps the dialog receiver and snapshots its method', async () => {
    const show = nativeDialog.showMessageBox, exporter = createDiagnosticExporter(logs, nativeDialog);
    nativeDialog.showMessageBox = vi.fn().mockRejectedValue(new Error('REPLACED'));
    expect((await exporter.export(observed())).status).toBe('saved'); expect(show.mock.contexts).toEqual([nativeDialog]);
    expect(nativeDialog.showMessageBox).not.toHaveBeenCalled();
  });

  it('rejects an already-aborted Main request without inspecting the report or directory', async () => {
    const controller = new AbortController(); controller.abort();
    const read = vi.fn(() => { throw new Error('PRIVATE'); });
    const report = new Proxy({} as HardwareDiagnostics, { get: read });
    const stat = vi.spyOn(fs, 'lstatSync');
    await expect(createDiagnosticExporter(logs, nativeDialog).export(report, controller.signal)).resolves.toEqual({ status: 'cancelled' });
    expect(read).not.toHaveBeenCalled(); expect(stat).not.toHaveBeenCalled(); expect(nativeDialog.showMessageBox).not.toHaveBeenCalled();
  });

  it('cancels the native prompt when its Main frame request expires, even after a late affirmative answer', async () => {
    const gate = deferred<{ response: number; checkboxChecked: boolean }>(); nativeDialog.showMessageBox.mockReturnValueOnce(gate.promise);
    const controller = new AbortController(), remove = vi.spyOn(controller.signal, 'removeEventListener');
    const exporter = createDiagnosticExporter(logs, nativeDialog), first = exporter.export(observed(), controller.signal);
    const prompt = nativeDialog.showMessageBox.mock.calls[0][0].signal!;
    controller.abort(); expect(prompt.aborted).toBe(true);
    gate.resolve({ response: 1, checkboxChecked: false }); await expect(first).resolves.toEqual({ status: 'cancelled' });
    expect(fs.readdirSync(logs)).toEqual([]); expect(remove).toHaveBeenCalledTimes(1);
    expect((await exporter.export(observed())).status).toBe('saved');
  });

  it('removes the Main cancellation listener on failure without invalidating a completed write', async () => {
    const controller = new AbortController(), remove = vi.spyOn(controller.signal, 'removeEventListener');
    nativeDialog.showMessageBox.mockRejectedValueOnce(new Error('PRIVATE'));
    const exporter = createDiagnosticExporter(logs, nativeDialog);
    expect((await exporter.export(observed(), controller.signal)).status).toBe('failed');
    expect(remove).toHaveBeenCalledTimes(1);
    expect((await exporter.export(observed(), controller.signal)).status).toBe('saved');
    expect(remove).toHaveBeenCalledTimes(2);
    const bytes = fs.readFileSync(path); controller.abort(); expect(fs.readFileSync(path)).toEqual(bytes);
  });

  it('omits arbitrary name/version/provider content even when valid under the hardware schema', async () => {
    const report = observed(), secret = 'data:image/png;base64,PRIVATE_IMAGE C:\\Users\\private\\secret';
    report.os.data!.architecture = secret; report.cpu.data!.name = secret;
    report.gpu.data!.adapters[0].DeviceName = secret; report.gpu.data!.adapters[0].DeviceString = secret;
    report.onnxRuntime.data!.version = secret; report.onnxRuntime.data!.providers = [secret];
    report.cuda.data!.torchVersion = secret; report.cuda.data!.runtimeVersion = secret;
    expect((await createDiagnosticExporter(logs, nativeDialog).export(report)).status).toBe('saved');
    const text = fs.readFileSync(path, 'utf8'); expect(text).not.toMatch(/PRIVATE|data:image|C:\\Users|base64/);
    expect(text).toContain('AMD64以外（名称省略）'); expect(text).toContain('CPU 一覧になし / DirectML 一覧になし');
  });

  it('preserves missing values, fixed failure codes and observed zero without synthesizing success', async () => {
    const report = hardwareDiagnosticsSchema.parse({ ...observed(), status: 'partial', memory: absent, gpu: absent,
      disk: { status: 'ok', data: { totalBytes: 0, usedBytes: 0, freeBytes: 0 }, error: null },
      cpu: { status: 'error', data: { name: null, logicalCount: 0 }, error: { code: 'cpu-data-unavailable', causeType: 'OSError' } },
    });
    await createDiagnosticExporter(logs, nativeDialog).export(report);
    const text = fs.readFileSync(path, 'utf8'); expect(text).toContain('診断状態: 一部未取得');
    expect(text).toContain('cpu-data-unavailable'); expect(text).toContain('論理プロセッサ 0');
    expect(text).toContain('メモリ: 未取得 / 合計 未取得 B'); expect(text).toContain('GPU: 未取得 / 表示アダプター 未取得 件');
    expect(text).toContain('合計 0 B / 空き 0 B');
  });

  it('exports an unsupported OS observation as a failure, not an empty successful report', async () => {
    const report = hardwareDiagnosticsSchema.parse({ ...observed(), status: 'error',
      os: { status: 'error', data: null, error: { code: 'unsupported-os', causeType: null } },
      cpu: absent, memory: absent, disk: absent, gpu: absent, onnxRuntime: absent, cuda: absent });
    expect((await createDiagnosticExporter(logs, nativeDialog).export(report)).status).toBe('saved');
    const text = fs.readFileSync(path, 'utf8'); expect(text).toContain('診断状態: 取得失敗'); expect(text).toContain('unsupported-os');
    expect(text).toContain('provider 未取得 件');
  });

  it.each([undefined, null, {}, { ...observed(), image: 'PRIVATE_IMAGE' }, { ...observed(), status: 'partial' },
    { ...observed(), camera: { status: 'deferred', streamOpened: true, reasonCode: 'check-on-inference-start' } }])(
    'rejects malformed input %# before preview or filesystem access', async (input) => {
      const stat = vi.spyOn(fs, 'lstatSync'), open = vi.spyOn(fs, 'openSync');
      await expect(createDiagnosticExporter(logs, nativeDialog).export(input as HardwareDiagnostics))
        .resolves.toEqual({ status: 'failed', code: 'DIAGNOSTIC_EXPORT_FAILED' });
      expect(stat).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled(); expect(nativeDialog.showMessageBox).not.toHaveBeenCalled();
    },
  );

  it.each(['', 'relative', 'C:relative', 'C:\\', '\\\\server\\share\\logs', '\\\\?\\C:\\logs',
    'C:\\logs\\..\\export', 'C:\\logs\\.', 'C:\\logs.\\exports', 'C:\\logs\\NUL', 'C:\\logs:stream', 'C:\\logs\0'])('rejects unsafe configured folder %j without I/O', (input) => {
    const stat = vi.spyOn(fs, 'lstatSync'); expect(() => createDiagnosticExporter(input, nativeDialog)).toThrow(TypeError); expect(stat).not.toHaveBeenCalled();
  });

  it.each(['directory', 'ancestor'])('rejects a junction at the %s before preview or writing', async (kind) => {
    const target = join(directory, 'outside'); fs.mkdirSync(target); fs.mkdirSync(join(target, 'child'));
    const alias = join(directory, 'alias'); fs.symlinkSync(target, alias, 'junction');
    await expect(createDiagnosticExporter(kind === 'directory' ? alias : join(alias, 'child'), nativeDialog).export(observed()))
      .resolves.toEqual({ status: 'failed', code: 'DIAGNOSTIC_EXPORT_FAILED' });
    expect(nativeDialog.showMessageBox).not.toHaveBeenCalled(); expect(fs.readdirSync(target)).toEqual(['child']); expect(fs.readdirSync(join(target, 'child'))).toEqual([]);
  });

  it('refuses a replaced destination after confirmation without writing into either directory', async () => {
    const gate = deferred<{ response: number; checkboxChecked: boolean }>(); nativeDialog.showMessageBox.mockReturnValueOnce(gate.promise);
    const result = createDiagnosticExporter(logs, nativeDialog).export(observed()), old = `${logs}-old`;
    fs.renameSync(logs, old); fs.mkdirSync(logs); gate.resolve({ response: 1, checkboxChecked: false });
    await expect(result).resolves.toEqual({ status: 'failed', code: 'DIAGNOSTIC_EXPORT_FAILED' });
    expect(fs.readdirSync(logs)).toEqual([]); expect(fs.readdirSync(old)).toEqual([]);
  });

  it.each(['final', 'partial'])('never overwrites an existing %s file or removes it on failure', async (kind) => {
    const original = kind === 'final' ? path : `${path}.partial`; fs.writeFileSync(original, 'PRIVATE_ORIGINAL');
    await expect(createDiagnosticExporter(logs, nativeDialog).export(observed())).resolves.toEqual({ status: 'failed', code: 'DIAGNOSTIC_EXPORT_FAILED' });
    expect(fs.readFileSync(original, 'utf8')).toBe('PRIVATE_ORIGINAL');
    if (kind === 'partial') expect(fs.existsSync(path)).toBe(false);
  });

  it.each(['openSync', 'writeFileSync', 'fsyncSync', 'readSync', 'linkSync', 'unlinkSync'] as const)(
    'returns a sanitized failure after %s fails, without retrying or deleting unrelated data', async (method) => {
      const sentinel = join(logs, 'other.txt'); fs.writeFileSync(sentinel, 'KEEP');
      const fault = vi.spyOn(fs, method).mockImplementationOnce(() => { throw new Error('PRIVATE_NATIVE_PATH'); });
      const result = await createDiagnosticExporter(logs, nativeDialog).export(observed());
      expect(result).toEqual({ status: 'failed', code: 'DIAGNOSTIC_EXPORT_FAILED' }); expect(fault).toHaveBeenCalledTimes(1); fault.mockRestore();
      expect(fs.readFileSync(sentinel, 'utf8')).toBe('KEEP');
      if (method !== 'unlinkSync') expect(fs.existsSync(path)).toBe(false);
      else expect(fs.existsSync(path)).toBe(true); // Published but cleanup is unconfirmed: never claim no file exists.
    },
  );

  it('reports a final close failure without deleting a published file or claiming success', async () => {
    const native = fs.closeSync;
    const close = vi.spyOn(fs, 'closeSync').mockImplementationOnce((fd) => { native(fd); throw new Error('PRIVATE_NATIVE_PATH'); });
    await expect(createDiagnosticExporter(logs, nativeDialog).export(observed())).resolves.toEqual({ status: 'failed', code: 'DIAGNOSTIC_EXPORT_FAILED' });
    expect(close).toHaveBeenCalledTimes(1); expect(fs.existsSync(path)).toBe(true);
  });

  it('rejects changed bytes before publication', async () => {
    const native = fs.readSync;
    vi.spyOn(fs, 'readSync').mockImplementationOnce((fd, buffer, options) => {
      const count = native(fd, buffer, options);
      new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)[0] ^= 1;
      return count;
    });
    await expect(createDiagnosticExporter(logs, nativeDialog).export(observed())).resolves.toEqual({ status: 'failed', code: 'DIAGNOSTIC_EXPORT_FAILED' });
    expect(fs.existsSync(path)).toBe(false); expect(fs.existsSync(`${path}.partial`)).toBe(true);
  });

  it('does not expose native dialog failures or write after rejection', async () => {
    nativeDialog.showMessageBox.mockRejectedValueOnce(new Error('PRIVATE_NATIVE_PATH'));
    await expect(createDiagnosticExporter(logs, nativeDialog).export(observed())).resolves.toEqual({ status: 'failed', code: 'DIAGNOSTIC_EXPORT_FAILED' });
    expect(fs.readdirSync(logs)).toEqual([]);
  });
});