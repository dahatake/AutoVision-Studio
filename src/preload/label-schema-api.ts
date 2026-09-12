import type { IpcRenderer } from 'electron';
import type { z } from 'zod';
import * as contract from '../shared/contracts/annotation-ipc.js';

type Failure = Extract<contract.LabelGetResponse, { ok: false }>;
const failure = (code: 'INVALID_REQUEST' | 'OPERATION_FAILED'): Failure =>
  Object.freeze({ ok: false, error: Object.freeze({ code }) });

/** ANN-04P: lazy fixed calls only; contextBridge/startup is owned elsewhere. */
export function createLabelSchemaApi(transport: Pick<IpcRenderer, 'invoke'>): Readonly<contract.LabelSchemaApi> {
  async function request<I, R>(channel: string, schema: z.ZodType<I>,
    parse: (value: unknown, input: I) => R, args: unknown[]): Promise<R | Failure> {
    let input: I;
    try {
      if (args.length !== 1) return failure('INVALID_REQUEST');
      input = schema.parse(args[0]); // Detached/frozen once before invoking transport.
    } catch { return failure('INVALID_REQUEST'); }
    try {
      const response: unknown = await transport.invoke(channel, input);
      return parse(response, input); // Correlate to saved request, never reread caller input.
    } catch { return failure('OPERATION_FAILED'); }
  }
  const api: contract.LabelSchemaApi = {
    get: (...args: unknown[]) => request(contract.LABEL_GET_CHANNEL, contract.labelGetInputSchema, contract.parseLabelGetResponse, args),
    create: (...args: unknown[]) => request(contract.LABEL_CREATE_CHANNEL, contract.labelCreateInputSchema, contract.parseLabelCreateResponse, args),
    createClass: (...args: unknown[]) => request(contract.LABEL_CREATE_CLASS_CHANNEL, contract.labelCreateClassInputSchema, contract.parseLabelCreateClassResponse, args),
    updateClass: (...args: unknown[]) => request(contract.LABEL_UPDATE_CLASS_CHANNEL, contract.labelUpdateClassInputSchema, contract.parseLabelUpdateClassResponse, args),
    update: (...args: unknown[]) => request(contract.LABEL_UPDATE_CHANNEL, contract.labelUpdateInputSchema, contract.parseLabelUpdateResponse, args),
    deleteClass: (...args: unknown[]) => request(contract.LABEL_DELETE_CLASS_CHANNEL, contract.labelDeleteClassInputSchema, contract.parseLabelDeleteClassResponse, args),
    mergeClasses: (...args: unknown[]) => request(contract.LABEL_MERGE_CLASSES_CHANNEL, contract.labelMergeClassesInputSchema, contract.parseLabelMergeClassesResponse, args),
  };
  Object.setPrototypeOf(api, null);
  return Object.freeze(api);
}