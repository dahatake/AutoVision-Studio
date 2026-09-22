import { contextBridge, ipcRenderer } from 'electron';

import {
  APP_API_CONTRACT_VERSION,
  APP_BRIDGE_KEY,
  type AppApi,
} from '../shared/contracts/app.js';
import { createAnnotationApi } from './annotation-api.js';
import { createDiagnosticsApi } from './diagnostics-api.js';
import { createImportApi } from './import-api.js';
import { createJobApi } from './job-api.js';
import { createLabelSchemaApi } from './label-schema-api.js';
import { createProjectApi } from './project-api.js';
import { createReferenceApi } from './reference-api.js';
import { createRevisionApi } from './revision-api.js';

const appApi: AppApi = Object.freeze({
  contractVersion: APP_API_CONTRACT_VERSION,
  projects: createProjectApi({
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  }),
  labelSchemas: createLabelSchemaApi({
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  }),
  annotations: createAnnotationApi({
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  }),
  diagnostics: createDiagnosticsApi({
    invoke: (channel) => ipcRenderer.invoke(channel),
  }),
  jobs: createJobApi({
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    on: (channel, listener) => ipcRenderer.on(channel, listener),
    removeListener: (channel, listener) => ipcRenderer.removeListener(channel, listener),
  }),
  imports: createImportApi({
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  }),
  revisions: createRevisionApi({
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  }),
  references: createReferenceApi({
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  }),
});

contextBridge.exposeInMainWorld(APP_BRIDGE_KEY, appApi);