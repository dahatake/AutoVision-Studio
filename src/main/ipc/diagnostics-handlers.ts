import type {
  Event as ElectronEvent, IpcMain, IpcMainInvokeEvent, WebContents, WebContentsDidStartNavigationEventParams,
} from 'electron';
import { fileURLToPath } from 'node:url';

import { DIAGNOSTIC_EXPORT_CHANNEL, diagnosticExportResultSchema, type DiagnosticExportResult } from '../../shared/contracts/diagnostic-export.js';
import { hardwareDiagnosticsSchema, type HardwareDiagnostics } from '../../shared/contracts/diagnostics.js';

const channel = 'diagnostics:collect';

function failure(): Error {
  return Object.assign(new Error('Hardware diagnostics unavailable.'), { code: 'DIAGNOSTICS_UNAVAILABLE' });
}

function fileUrl(value: string): string | undefined {
  try {
    const base = value.split('#', 1)[0];
    const url = new URL(value);
    url.hash = '';
    if (url.protocol !== 'file:' || url.host !== '' || url.search !== ''
      || base?.includes('?') || url.href !== base || fileURLToPath(url).includes('\0')) return undefined;
    return url.href;
  } catch { return undefined; }
}

// Called explicitly by Main startup, never registered as an import side effect.
// The caller owns this channel until disposal and separately owns the service.
export function registerDiagnosticsHandlers(
  ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>,
  trustedWebContents: WebContents,
  expectedRendererUrl: string,
  service: { collect(): Promise<HardwareDiagnostics> },
): { dispose(): void } {
  const expected = fileUrl(expectedRendererUrl);
  if (expected === undefined) throw failure();
  let disposed = false;
  function trusted(event: IpcMainInvokeEvent): boolean {
    try {
      const frame = event.senderFrame;
      return !disposed && event.sender === trustedWebContents
        && !trustedWebContents.isDestroyed() && frame !== null
        && frame === trustedWebContents.mainFrame
        && fileUrl(frame.url) === expected
        && fileUrl(trustedWebContents.getURL()) === expected;
    } catch { return false; }
  }
  ipcMain.handle(channel, async (event, ...args: unknown[]): Promise<HardwareDiagnostics> => {
    if (args.length !== 0 || !trusted(event)) throw failure();
    try {
      const frame = event.senderFrame;
      const report = await service.collect();
      if (!trusted(event) || event.senderFrame !== frame) throw failure();
      return report;
    } catch { throw failure(); }
  });
  return Object.freeze({
    dispose(): void {
      if (disposed) return;
      disposed = true;
      ipcMain.removeHandler(channel);
    },
  });
}

/** Explicit SEC-07C2 registration. Main supplies its collector/exporter; no input
 * snapshot/path/confirmation is accepted. The exporter must honor this Main-only
 * signal after its native confirmation and before any write (SEC-07C0).
 * Invalidating a request does not cancel a shared hardware collection or undo a
 * completed save. The window owner separately disposes both services on close.
 */
export function registerDiagnosticExportHandler(
  ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>,
  trustedWebContents: WebContents,
  expectedRendererUrl: string,
  service: { collect(): Promise<HardwareDiagnostics> },
  exporter: { export(report: HardwareDiagnostics, signal: AbortSignal): Promise<DiagnosticExportResult> },
): { dispose(): void } {
  const expected = fileUrl(expectedRendererUrl);
  if (expected === undefined) throw failure();
  const collect = service.collect.bind(service), save = exporter.export.bind(exporter);
  const failed = () => diagnosticExportResultSchema.parse({ status: 'failed', code: 'DIAGNOSTIC_EXPORT_FAILED' });
  let disposed = false, registered = false, generation = 0;
  let active: AbortController | null = null;
  function invalidate(): void { generation++; active?.abort(); }
  function navigation(details: ElectronEvent<WebContentsDidStartNavigationEventParams>): void {
    if (details.isMainFrame && (!details.isSameDocument || fileUrl(details.url) !== expected)) invalidate();
  }
  function trusted(event: IpcMainInvokeEvent): boolean {
    try {
      const frame = event.senderFrame;
      return !disposed && event.sender === trustedWebContents && !trustedWebContents.isDestroyed()
        && frame !== null && frame === trustedWebContents.mainFrame
        && fileUrl(frame.url) === expected && fileUrl(trustedWebContents.getURL()) === expected;
    } catch { return false; }
  }
  function dispose(): void {
    if (disposed) return;
    disposed = true; invalidate();
    trustedWebContents.removeListener('did-start-navigation', navigation);
    trustedWebContents.removeListener('render-process-gone', invalidate);
    trustedWebContents.removeListener('destroyed', dispose);
    if (registered) ipcMain.removeHandler(DIAGNOSTIC_EXPORT_CHANNEL);
  }
  try {
    trustedWebContents.on('did-start-navigation', navigation);
    trustedWebContents.on('render-process-gone', invalidate);
    trustedWebContents.on('destroyed', dispose);
    ipcMain.handle(DIAGNOSTIC_EXPORT_CHANNEL, async (event, ...args: unknown[]): Promise<DiagnosticExportResult> => {
      if (args.length !== 0 || !trusted(event)) return failed();
      if (active) return diagnosticExportResultSchema.parse({ status: 'failed', code: 'DIAGNOSTIC_EXPORT_BUSY' });
      const frame = event.senderFrame, currentGeneration = generation;
      const controller = new AbortController(); active = controller;
      const current = () => !controller.signal.aborted && generation === currentGeneration
        && trusted(event) && event.senderFrame === frame;
      try {
        const report = hardwareDiagnosticsSchema.parse(await collect());
        if (!current()) return failed();
        const result = diagnosticExportResultSchema.parse(await save(report, controller.signal));
        return current() ? result : failed();
      } catch { return failed(); }
      finally { if (active === controller) active = null; }
    });
    registered = true;
  } catch (error) { dispose(); throw error; }
  return Object.freeze({ dispose });
}