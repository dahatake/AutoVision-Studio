import { describe, expect, it, vi } from 'vitest';

const electronMocks = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn<(apiKey: string, api: unknown) => void>(),
}));

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: electronMocks.exposeInMainWorld,
  },
}));

import {
  APP_API_CONTRACT_VERSION,
  APP_BRIDGE_KEY,
  type AppApi,
} from '../shared/contracts/app.js';
import './index.js';

describe('preload app bridge', () => {
  it('exposes one versioned API through the isolated context bridge', () => {
    expect(electronMocks.exposeInMainWorld).toHaveBeenCalledOnce();

    const [[apiKey, exposedApi]] = electronMocks.exposeInMainWorld.mock.calls;
    expect(apiKey).toBe(APP_BRIDGE_KEY);
    expect(exposedApi).toEqual<AppApi>({
      contractVersion: APP_API_CONTRACT_VERSION,
    });
    expect(Object.isFrozen(exposedApi)).toBe(true);
  });

  it('does not expose raw Electron or Node capabilities', () => {
    const [[, exposedApi]] = electronMocks.exposeInMainWorld.mock.calls;

    expect(Object.keys(exposedApi as object)).toEqual(['contractVersion']);
    expect(exposedApi).not.toHaveProperty('ipcRenderer');
    expect(exposedApi).not.toHaveProperty('require');
    expect(exposedApi).not.toHaveProperty('process');
    expect(exposedApi).not.toHaveProperty('filesystem');
    expect(exposedApi).not.toHaveProperty('childProcess');
  });
});