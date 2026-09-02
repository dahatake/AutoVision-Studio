export const APP_BRIDGE_KEY = 'autoVision' as const;
export const APP_API_CONTRACT_VERSION = 1 as const;

export interface AppApi {
  readonly contractVersion: typeof APP_API_CONTRACT_VERSION;
}

declare global {
  interface Window {
    readonly autoVision: AppApi;
  }
}