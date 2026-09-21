import type { Event as ElectronEvent, IpcMain, IpcMainInvokeEvent, WebContents,
  WebContentsDidStartNavigationEventParams, WebFrameMain } from 'electron';
import { fileURLToPath } from 'node:url';

import {
  REVISION_CLONE_CHANNEL, REVISION_CONFIRM_AND_QUEUE_CHANNEL, REVISION_CREATE_CHANNEL,
  REVISION_VALIDATE_CHANNEL, revisionCloneInputSchema, revisionCloneResponseSchema,
  revisionConfirmAndQueueFullResponseSchema, revisionCreateInputSchema, revisionCreateResponseSchema,
  revisionValidateInputSchema, revisionValidateResponseSchema,
  type RevisionIpcErrorCode,
} from '../../shared/contracts/revision-ipc.js';
import type { DatabaseConnection } from '../db/database.js';
import { createDatasetRevision } from '../data/revision-service.js';
import { validateAnnotationWorkspace } from '../annotations/validate-annotation.js';
import { confirmDatasetAndQueueTraining } from '../annotations/confirm-and-queue.js';
import { cloneWorkspaceFromRevision } from '../annotations/clone-workspace.js';

class RequestFailure extends Error {
  constructor(readonly code: RevisionIpcErrorCode) { super(code); }
}

function fileUrl(value: string): string | undefined {
  try {
    const base = value.split('#', 1)[0], url = new URL(value); url.hash = '';
    if (url.protocol !== 'file:' || url.host !== '' || url.search !== '' || base?.includes('?')
      || url.href !== base || fileURLToPath(url).includes('\0')) return undefined;
    return url.href;
  } catch { return undefined; }
}

function failure(error: unknown) {
  let code: RevisionIpcErrorCode = 'OPERATION_FAILED';
  if (error instanceof RequestFailure) code = error.code;
  return { ok: false as const, error: { code } };
}

export function registerRevisionHandlers(
  ipc: Pick<IpcMain, 'handle' | 'removeHandler'>,
  contents: WebContents,
  expectedURL: string,
  database: DatabaseConnection,
): { dispose(): void } {
  const expected = fileUrl(expectedURL);
  if (expected === undefined) throw new RequestFailure('INVALID_REQUEST');
  let disposed = false, generation = 0, active = false;
  const registered: string[] = [];
  type Document = { frame: WebFrameMain | null; generation: number };
  function invalidate(): void { generation += 1; }
  function navigation(details: ElectronEvent<WebContentsDidStartNavigationEventParams>): void {
    if (details.isMainFrame && !details.isSameDocument) invalidate();
  }
  function current(event: IpcMainInvokeEvent, document: Document): boolean {
    try {
      const frame = event.senderFrame;
      return !disposed && event.sender === contents && !contents.isDestroyed() && frame !== null
        && frame === contents.mainFrame && frame === document.frame
        && fileUrl(frame.url) === expected && fileUrl(contents.getURL()) === expected
        && generation === document.generation;
    } catch { return false; }
  }
  function dispose(): void {
    if (disposed) return;
    disposed = true; invalidate();
    contents.removeListener('did-start-navigation', navigation);
    contents.removeListener('render-process-gone', invalidate);
    contents.removeListener('destroyed', dispose);
    for (const channel of registered.splice(0)) ipc.removeHandler(channel);
  }
  function summary(result: ReturnType<typeof createDatasetRevision>['revision']) {
    return {
      id: result.id,
      projectId: result.projectId,
      workspaceId: result.workspaceId,
      revisionNo: result.revisionNo,
      mode: result.mode,
      manifestSha256: result.manifestSha256,
      manifestRelativePath: result.manifestRelativePath,
      splitSeed: result.splitSeed,
      createdBy: result.createdBy,
      confirmedAt: result.confirmedAt,
    };
  }
  function register(channel: string, handler: (input: unknown) => unknown): void {
    ipc.handle(channel, (event, ...args: unknown[]) => {
      let document: Document | undefined;
      try {
        document = { frame: event.senderFrame, generation };
        if (!current(event, document) || args.length !== 1) throw new RequestFailure('INVALID_REQUEST');
        if (active || database.inTransaction) throw new RequestFailure('BUSY');
        active = true;
        const result = handler(args[0]);
        if (!current(event, document)) throw new RequestFailure('INVALID_REQUEST');
        return result;
      } catch (error) {
        return failure(error);
      } finally { active = false; }
    });
    registered.push(channel);
  }
  try {
    contents.on('did-start-navigation', navigation);
    contents.on('render-process-gone', invalidate);
    contents.on('destroyed', dispose);
    register(REVISION_CREATE_CHANNEL, (raw) => {
      const input = revisionCreateInputSchema.safeParse(raw);
      if (!input.success) throw new RequestFailure('INVALID_REQUEST');
      return revisionCreateResponseSchema.parse({ ok: true, value: summary(createDatasetRevision(database, input.data).revision) });
    });
    register(REVISION_VALIDATE_CHANNEL, (raw) => {
      const input = revisionValidateInputSchema.safeParse(raw);
      if (!input.success) throw new RequestFailure('INVALID_REQUEST');
      return revisionValidateResponseSchema.parse({ ok: true,
        value: validateAnnotationWorkspace(database, input.data.projectId, input.data.workspaceId) });
    });
    register(REVISION_CONFIRM_AND_QUEUE_CHANNEL, (raw) => {
      const input = revisionCreateInputSchema.safeParse(raw);
      if (!input.success) throw new RequestFailure('INVALID_REQUEST');
      const result = confirmDatasetAndQueueTraining(database, input.data);
      return revisionConfirmAndQueueFullResponseSchema.parse({ ok: true,
        value: { revision: summary(result.revision.revision), training: result.training.job } });
    });
    register(REVISION_CLONE_CHANNEL, (raw) => {
      const input = revisionCloneInputSchema.safeParse(raw);
      if (!input.success) throw new RequestFailure('INVALID_REQUEST');
      return revisionCloneResponseSchema.parse({ ok: true,
        value: cloneWorkspaceFromRevision(database, input.data.projectId, input.data.revisionId) });
    });
  } catch (error) { dispose(); throw error; }
  return Object.freeze({ dispose });
}
