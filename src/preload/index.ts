import { contextBridge } from 'electron';

import {
  APP_API_CONTRACT_VERSION,
  APP_BRIDGE_KEY,
  type AppApi,
} from '../shared/contracts/app.js';

const appApi: AppApi = Object.freeze({
  contractVersion: APP_API_CONTRACT_VERSION,
});

contextBridge.exposeInMainWorld(APP_BRIDGE_KEY, appApi);