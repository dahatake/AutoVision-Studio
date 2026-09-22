import type { AnnotationApi, LabelSchemaApi } from './annotation-ipc.js';
import type { DiagnosticExportResult } from './diagnostic-export.js';
import type { HardwareDiagnostics } from './diagnostics.js';
import type { ImportApi } from './import-ipc.js';
import type { JobApi } from './job-ipc.js';
import type { ProjectApi } from './project-ipc.js';
import type { ReferenceApi } from './reference-ipc.js';
import type { RevisionApi } from './revision-ipc.js';

export const APP_BRIDGE_KEY = 'autoVision' as const;
export const APP_API_CONTRACT_VERSION = 1 as const;

export interface AppApi {
  readonly contractVersion: typeof APP_API_CONTRACT_VERSION;
  readonly projects: ProjectApi;
  readonly labelSchemas: LabelSchemaApi;
  readonly annotations: AnnotationApi;
  readonly diagnostics: Readonly<{
    collect(): Promise<HardwareDiagnostics>;
    /** Additive v1 capability. Old bridges retain collection, never fake export. */
    exportSummary?: () => Promise<DiagnosticExportResult>;
  }>;
  readonly jobs: JobApi;
  readonly imports: ImportApi;
  readonly revisions: RevisionApi;
  readonly references: ReferenceApi;
}

declare global {
  interface Window {
    readonly autoVision: AppApi;
  }
}