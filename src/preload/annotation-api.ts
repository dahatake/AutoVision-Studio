import type { IpcRenderer } from 'electron';
import type { z } from 'zod';
import * as contract from '../shared/contracts/annotation-ipc.js';

type Failure = Extract<contract.AnnotationGetResponse, { ok: false }>;
const failure = (code: 'INVALID_REQUEST' | 'OPERATION_FAILED'): Failure =>
  Object.freeze({ ok: false, error: Object.freeze({ code }) });

/** ANN-06P: lazy fixed calls only; Main owns authorization and content hashing. */
export function createAnnotationApi(transport: Pick<IpcRenderer, 'invoke'>): Readonly<contract.AnnotationApi> {
  async function request<I, R>(channel: string, schema: z.ZodType<I>,
    parse: (value: unknown, input: I) => R, args: unknown[]): Promise<R | Failure> {
    let input: I;
    try {
      if (args.length !== 1) return failure('INVALID_REQUEST');
      input = schema.parse(args[0]); // Snapshot before invoke; never freeze or reread the caller.
    } catch { return failure('INVALID_REQUEST'); }
    try {
      const response: unknown = await transport.invoke(channel, input);
      return parse(response, input); // Strict, correlated, deeply frozen received copy.
    } catch { return failure('OPERATION_FAILED'); }
  }
  // No retry, coalescing or shared generation: every explicit command is independent.
  const api: contract.AnnotationApi = {
    workspaces: (...args: unknown[]) => request(contract.ANNOTATION_WORKSPACES_CHANNEL, contract.annotationWorkspacesInputSchema, contract.parseAnnotationWorkspacesResponse, args),
    list: (...args: unknown[]) => request(contract.ANNOTATION_LIST_CHANNEL, contract.annotationListInputSchema, contract.parseAnnotationListResponse, args),
    get: (...args: unknown[]) => request(contract.ANNOTATION_GET_CHANNEL, contract.annotationGetInputSchema, contract.parseAnnotationGetResponse, args),
    save: (...args: unknown[]) => request(contract.ANNOTATION_SAVE_CHANNEL, contract.annotationSaveInputSchema, contract.parseAnnotationSaveResponse, args),
    confirm: (...args: unknown[]) => request(contract.ANNOTATION_CONFIRM_CHANNEL, contract.annotationConfirmInputSchema, contract.parseAnnotationConfirmResponse, args),
  };
  Object.setPrototypeOf(api, null);
  return Object.freeze(api);
}