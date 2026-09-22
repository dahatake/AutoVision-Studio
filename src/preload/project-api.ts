import type { IpcRenderer } from 'electron';
import type { z } from 'zod';

import {
  PROJECT_CREATE_CHANNEL, PROJECT_DELETE_CHANNEL, PROJECT_DELETE_PREVIEW_CHANNEL, PROJECT_GET_CHANNEL,
  PROJECT_LIST_CHANNEL, PROJECT_MOVE_CHANNEL,
  PROJECT_PICK_PARENT_CHANNEL, PROJECT_RECOVER_CHANNEL, PROJECT_UPDATE_CHANNEL,
  projectCreateInputSchema, projectCreateResponseSchema,
  projectDeleteInputSchema, projectDeletePreviewInputSchema, projectDeletePreviewResponseSchema,
  projectDeleteResponseSchema, projectGetInputSchema, projectGetResponseSchema,
  projectListInputSchema, projectListResponseSchema, projectMoveInputSchema, projectMoveResponseSchema,
  projectPickParentInputSchema, projectPickParentResponseSchema, projectRecoverInputSchema, projectRecoverResponseSchema,
  projectUpdateInputSchema, projectUpdateResponseSchema, type ProjectApi,
} from '../shared/contracts/project-ipc.js';

// CORE-07P only. UIR-019 owns contextBridge registration and the real transport.
export function createProjectApi(transport: Pick<IpcRenderer, 'invoke'>): Readonly<ProjectApi> {
  // Local codec composition; only the nine fixed callers below can invoke it.
  async function request<Response extends z.ZodType>(
    channel: string, inputSchema: z.ZodType, responseSchema: Response,
    args: unknown[], argumentCount: 0 | 1,
  ): Promise<z.output<Response>> {
    const invalidRequest = () => responseSchema.parse({ ok: false, error: { code: 'INVALID_REQUEST' } });
    if (args.length !== argumentCount) return invalidRequest();

    let payload: unknown;
    try {
      const parsed = inputSchema.safeParse(args[0]);
      if (!parsed.success) return invalidRequest();
      const original = args[0];
      const validated: unknown = parsed.data;
      // Zod drops the special own key __proto__ even in strict objects.
      // A fixed IPC input must not silently lose ANY caller-supplied key.
      if (typeof original === 'object' && original !== null
        && Reflect.ownKeys(original).some((key) => typeof key !== 'string'
          || typeof validated !== 'object' || validated === null || !Object.hasOwn(validated, key))) {
        return invalidRequest();
      }
      // Parse/copy before any await; never freeze or forward the caller's object.
      payload = parsed.data;
    } catch { return invalidRequest(); }

    try {
      const response: unknown = argumentCount === 0
        ? await transport.invoke(channel)
        : await transport.invoke(channel, payload);
      // Strict codecs reject extras and detach/freeze all declared DTO fields.
      // Keep current DB roots and ok:true cleanup warnings exactly as received.
      return responseSchema.parse(response);
    } catch {
      // An unacknowledged operation is uncertain, not rollback or an empty list.
      return responseSchema.parse({ ok: false, error: { code: 'OPERATION_FAILED' } });
    }
  }

  const api: ProjectApi = {
    async list(...args: unknown[]) {
      return request(PROJECT_LIST_CHANNEL, projectListInputSchema, projectListResponseSchema, args, 0);
    },
    async get(...args: unknown[]) {
      return request(PROJECT_GET_CHANNEL, projectGetInputSchema, projectGetResponseSchema, args, 1);
    },
    async create(...args: unknown[]) {
      return request(PROJECT_CREATE_CHANNEL, projectCreateInputSchema, projectCreateResponseSchema, args, 1);
    },
    async update(...args: unknown[]) {
      return request(PROJECT_UPDATE_CHANNEL, projectUpdateInputSchema, projectUpdateResponseSchema, args, 1);
    },
    async pickParent(...args: unknown[]) {
      return request(PROJECT_PICK_PARENT_CHANNEL, projectPickParentInputSchema, projectPickParentResponseSchema, args, 1);
    },
    async move(...args: unknown[]) {
      return request(PROJECT_MOVE_CHANNEL, projectMoveInputSchema, projectMoveResponseSchema, args, 1);
    },
    async recover(...args: unknown[]) {
      return request(PROJECT_RECOVER_CHANNEL, projectRecoverInputSchema, projectRecoverResponseSchema, args, 1);
    },
    async deletePreview(...args: unknown[]) {
      return request(PROJECT_DELETE_PREVIEW_CHANNEL, projectDeletePreviewInputSchema,
        projectDeletePreviewResponseSchema, args, 1);
    },
    async delete(...args: unknown[]) {
      return request(PROJECT_DELETE_CHANNEL, projectDeleteInputSchema, projectDeleteResponseSchema, args, 1);
    },
  };
  // No transport, event hooks, generic RPC or inherited method surface.
  Object.setPrototypeOf(api, null);
  return Object.freeze(api);
}