import type { IpcRenderer } from 'electron';

import {
  REVISION_CLONE_CHANNEL, REVISION_CONFIRM_AND_QUEUE_CHANNEL, REVISION_CREATE_CHANNEL,
  REVISION_VALIDATE_CHANNEL, parseRevisionCloneResponse, parseRevisionConfirmAndQueueResponse,
  parseRevisionCreateResponse, parseRevisionValidateResponse, revisionCloneInputSchema,
  revisionCloneResponseSchema, revisionConfirmAndQueueFullResponseSchema, revisionCreateInputSchema,
  revisionCreateResponseSchema, revisionValidateInputSchema, revisionValidateResponseSchema, type RevisionApi,
} from '../shared/contracts/revision-ipc.js';

export function createRevisionApi(transport: Pick<IpcRenderer, 'invoke'>): Readonly<RevisionApi> {
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
  const api: RevisionApi = {
    async create(...args: unknown[]) {
      return request(REVISION_CREATE_CHANNEL, revisionCreateInputSchema, revisionCreateResponseSchema,
        parseRevisionCreateResponse, args);
    },
    async validate(...args: unknown[]) {
      return request(REVISION_VALIDATE_CHANNEL, revisionValidateInputSchema, revisionValidateResponseSchema,
        parseRevisionValidateResponse, args);
    },
    async confirmAndQueue(...args: unknown[]) {
      return request(REVISION_CONFIRM_AND_QUEUE_CHANNEL, revisionCreateInputSchema,
        revisionConfirmAndQueueFullResponseSchema, parseRevisionConfirmAndQueueResponse, args);
    },
    async clone(...args: unknown[]) {
      return request(REVISION_CLONE_CHANNEL, revisionCloneInputSchema, revisionCloneResponseSchema,
        parseRevisionCloneResponse, args);
    },
  };
  Object.setPrototypeOf(api, null);
  return Object.freeze(api);
}
