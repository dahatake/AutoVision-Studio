import { DIAGNOSTIC_EXPORT_CHANNEL, diagnosticExportResultSchema, type DiagnosticExportResult } from '../shared/contracts/diagnostic-export.js';
import { hardwareDiagnosticsSchema, type HardwareDiagnostics } from '../shared/contracts/diagnostics.js';

// W08 owns contextBridge registration. Neither IPC nor startup paths are exposed.
export function createDiagnosticsApi(ipcRenderer: {
  invoke(channel: string): Promise<unknown>;
}): Readonly<{ collect(): Promise<HardwareDiagnostics>; exportSummary(): Promise<DiagnosticExportResult> }> {
  const api = {
    async collect(): Promise<HardwareDiagnostics> {
      try {
        const result: unknown = await ipcRenderer.invoke('diagnostics:collect');
        return hardwareDiagnosticsSchema.parse(result);
      } catch {
        throw Object.assign(new Error('Hardware diagnostics unavailable.'), { code: 'DIAGNOSTICS_UNAVAILABLE' });
      }
    },
    async exportSummary(): Promise<DiagnosticExportResult> {
      if (arguments.length !== 0) return Object.freeze({ status: 'failed', code: 'DIAGNOSTIC_EXPORT_FAILED' });
      try {
        return diagnosticExportResultSchema.parse(await ipcRenderer.invoke(DIAGNOSTIC_EXPORT_CHANNEL));
      } catch {
        return Object.freeze({ status: 'failed', code: 'DIAGNOSTIC_EXPORT_FAILED' });
      }
    },
  };
  // No inherited method surface, including __proto__/constructor/toString.
  Object.setPrototypeOf(api, null);
  return Object.freeze(api);
}