import type { IpcRenderer } from 'electron';

import {
  REFERENCE_RELINK_CHANNEL, REFERENCE_STATUS_CHANNEL,
  parseReferenceRelinkResponse, parseReferenceStatusResponse,
  referenceRelinkInputSchema, referenceRelinkResponseSchema,
  referenceStatusInputSchema, referenceStatusResponseSchema, type ReferenceApi,
} from '../shared/contracts/reference-ipc.js';

/** Two fixed operations only; no transport, channel name or path crosses over. */
export function createReferenceApi(transport: Pick<IpcRenderer, 'invoke'>): Readonly<ReferenceApi> {
  async function request<Input, Response>(channel: string, inputSchema: { parse(value: unknown): Input },
    responseSchema: { parse(value: unknown): Response }, parseResponse: (value: unknown, input: Input) => Response,
    args: unknown[]): Promise<Response> {
    let input: Input;
    try {
      if (args.length !== 1) return responseSchema.parse({ ok: false, error: { code: 'INVALID_REQUEST' } });
      input = inputSchema.parse(args[0]);
    } catch {
      return responseSchema.parse({ ok: false, error: { code: 'INVALID_REQUEST' } });
    }
    try { return parseResponse(await transport.invoke(channel, input), input); }
    catch { return responseSchema.parse({ ok: false, error: { code: 'OPERATION_FAILED' } }); }
  }
  const api: ReferenceApi = {
    async status(...args: unknown[]) {
      return request(REFERENCE_STATUS_CHANNEL, referenceStatusInputSchema, referenceStatusResponseSchema,
        parseReferenceStatusResponse, args);
    },
    async relink(...args: unknown[]) {
      return request(REFERENCE_RELINK_CHANNEL, referenceRelinkInputSchema, referenceRelinkResponseSchema,
        parseReferenceRelinkResponse, args);
    },
  };
  Object.setPrototypeOf(api, null);
  return Object.freeze(api);
}
