import type { IpcRenderer } from 'electron';
import type { z } from 'zod';

import {
  IMPORT_START_CHANNEL, IMPORT_PREVIEW_CHANNEL, IMPORT_COMMIT_CHANNEL, IMPORT_DISCARD_CHANNEL,
  importStartInputSchema, importPreviewInputSchema, importCommitInputSchema, importDiscardInputSchema,
  parseImportStartResponse, parseImportPreviewResponse, parseImportCommitResponse, parseImportDiscardResponse,
  type ImportApi,
} from '../shared/contracts/import-ipc.js';

// DAT08P only: Main owns receiver binding; Jobs owns progress; no bridge registration here.
export function createImportApi(transport: Pick<IpcRenderer, 'invoke'>): Readonly<ImportApi> {
  const failure = (code: 'INVALID_REQUEST' | 'OPERATION_FAILED') =>
    Object.freeze({ ok: false as const, error: Object.freeze({ code }) });

  async function request<Input, Response>(
    channel: string, args: unknown[], schema: z.ZodType<Input>,
    parseResponse: (value: unknown, expected: Input) => Response,
  ): Promise<Response | ReturnType<typeof failure>> {
    let input: Input;
    try {
      if (args.length !== 1) return failure('INVALID_REQUEST');
      // Shared schemas reject accessors/unknown fields and copy/freeze only validated DTOs.
      // Finish before invoking or awaiting; never retain/freeze the caller's request.
      input = schema.parse(args[0]);
    } catch { return failure('INVALID_REQUEST'); }
    try {
      return parseResponse(await transport.invoke(channel, input), input);
    } catch {
      // Never trust native rejection codes, paths, causes or uncertain outcomes.
      return failure('OPERATION_FAILED');
    }
  }

  const api: ImportApi = {
    async start(...args: unknown[]) {
      return request(IMPORT_START_CHANNEL, args, importStartInputSchema, parseImportStartResponse);
    },
    async preview(...args: unknown[]) {
      return request(IMPORT_PREVIEW_CHANNEL, args, importPreviewInputSchema, parseImportPreviewResponse);
    },
    async commit(...args: unknown[]) {
      return request(IMPORT_COMMIT_CHANNEL, args, importCommitInputSchema, parseImportCommitResponse);
    },
    async discard(...args: unknown[]) {
      return request(IMPORT_DISCARD_CHANNEL, args, importDiscardInputSchema, parseImportDiscardResponse);
    },
  };
  Object.setPrototypeOf(api, null);
  return Object.freeze(api);
}