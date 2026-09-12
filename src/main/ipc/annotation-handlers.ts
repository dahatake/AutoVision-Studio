import type { Event as ElectronEvent, IpcMain, IpcMainInvokeEvent, WebContents,
  WebContentsDidStartNavigationEventParams, WebFrameMain } from 'electron';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual, types } from 'node:util';
import type { z } from 'zod';
import * as c from '../../shared/contracts/annotation-ipc.js';
import type { AnnotationWorkspace } from '../../shared/contracts/annotation.js';
import { LabelSchemaError, type LabelSchemaErrorCode } from '../annotations/label-schema-service.js';
import { saveAnnotationDraft } from '../annotations/save-draft.js';
import { confirmAnnotationItem } from '../annotations/validate-annotation.js';
import { annotationDigest, canonicalAnnotationJson, readWorkspaceHeader, workspaceTransaction } from '../annotations/workspace-repository.js';
import { getAnnotationItem, getAnnotationWorkspace, listAnnotationItems } from '../annotations/workspace-service.js';
import type { DatabaseConnection } from '../db/database.js';
import { getProject } from '../projects/project-service.js';

class RequestFailure extends Error {
  constructor(readonly code: c.AnnotationIpcErrorCode) { super(code); }
}
const codes: Record<LabelSchemaErrorCode, c.AnnotationIpcErrorCode> = {
  LABEL_INPUT: 'INVALID_REQUEST', LABEL_DATABASE: 'OPERATION_FAILED', LABEL_TRANSACTION: 'BUSY',
  LABEL_PROJECT_NOT_FOUND: 'NOT_FOUND', LABEL_SCHEMA_NOT_FOUND: 'NOT_FOUND', LABEL_CLASS_NOT_FOUND: 'NOT_FOUND',
  LABEL_CONFLICT: 'CONFLICT', LABEL_LOCKED: 'LOCKED', LABEL_DUPLICATE_NAME: 'CONFLICT',
  LABEL_ORDINAL_CONFLICT: 'CONFLICT', LABEL_CLASS_USED: 'CLASS_USED', LABEL_HISTORY_REFERENCE: 'HISTORY_REFERENCE',
  LABEL_STORED_DATA: 'OPERATION_FAILED',
};
function failure(error: unknown) {
  let code: c.AnnotationIpcErrorCode = 'OPERATION_FAILED';
  try {
    if (error !== null && typeof error === 'object' && !types.isProxy(error)) {
      const field = Object.getOwnPropertyDescriptor(error, 'code');
      const raw: unknown = field && 'value' in field ? field.value : undefined;
      if (error instanceof RequestFailure) {
        const parsed = c.annotationIpcErrorCodeSchema.safeParse(raw);
        if (parsed.success) code = parsed.data;
      } else if (error instanceof LabelSchemaError && typeof raw === 'string' && Object.hasOwn(codes, raw)) {
        code = codes[raw as LabelSchemaErrorCode];
      }
    }
  } catch { /* Never inspect native messages, stacks, paths or accessors. */ }
  return Object.freeze({ ok: false as const, error: Object.freeze({ code }) });
}
function fileUrl(value: string): string | undefined {
  try {
    const base = value.split('#', 1)[0], url = new URL(value); url.hash = '';
    if (url.protocol !== 'file:' || url.host !== '' || url.search !== '' || base?.includes('?')
      || url.href !== base || fileURLToPath(url).includes('\0')) return undefined;
    return url.href;
  } catch { return undefined; }
}
// Local copy of the label boundary: descriptor-only, linear DAG traversal.
function assertNoProxy(input: unknown): void {
  const pending: unknown[] = [input], seen = new WeakSet<object>();
  let budget = 100_000;
  while (pending.length) {
    const value = pending.pop();
    if (--budget < 0) throw new RequestFailure('INVALID_REQUEST');
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) continue;
    if (types.isProxy(value)) throw new RequestFailure('INVALID_REQUEST');
    if (seen.has(value)) continue;
    seen.add(value);
    const keys = Reflect.ownKeys(value);
    if (keys.length > budget - pending.length) throw new RequestFailure('INVALID_REQUEST');
    for (const key of keys) {
      const field = Object.getOwnPropertyDescriptor(value, key);
      if (!field || !('value' in field)) throw new RequestFailure('INVALID_REQUEST');
      pending.push(field.value);
    }
  }
}
function verifyItem(value: c.AnnotationGetResponse): void {
  if (!value.ok) throw new RequestFailure('OPERATION_FAILED');
  if (annotationDigest(canonicalAnnotationJson(value.value.item.annotation)) !== value.value.item.annotationSha256) {
    throw new RequestFailure('OPERATION_FAILED');
  }
  // Immutable scan annotations only, never the scan image/source manifest.
  // Opaque class keys and source IDs retain their exact original spelling.
  for (const p of value.value.provenance) {
    const allowed = p.original['type'] === 'classification' ? ['type', 'classKey', 'sourceRow']
      : p.original['type'] === 'detection' ? ['type', 'sourceImageId', 'classKey', 'sourceAnnotationId', 'bbox'] : [];
    if (Object.keys(p.original).some((key) => !allowed.includes(key))) throw new RequestFailure('OPERATION_FAILED');
  }
}

/** ANN06H: five fixed real services only; no startup wiring or workspace creation. */
export function registerAnnotationHandlers(
  ipc: Pick<IpcMain, 'handle' | 'removeHandler'>, contents: WebContents, expectedURL: string,
  database: DatabaseConnection,
): { dispose(): void } {
  const expected = fileUrl(expectedURL);
  if (expected === undefined) throw new RequestFailure('INVALID_REQUEST');
  const registered: string[] = [];
  let disposed = false, generation = 0, active = false;
  type Document = { frame: WebFrameMain | null; generation: number };
  type Call = <T>(action: () => T) => T;
  function invalidate(): void { generation += 1; }
  function navigation(details: ElectronEvent<WebContentsDidStartNavigationEventParams>): void {
    if (details.isMainFrame && !details.isSameDocument) invalidate();
  }
  function current(event: IpcMainInvokeEvent, document: Document): boolean {
    try {
      const frame = event.senderFrame;
      const trusted = event.sender === contents && !contents.isDestroyed() && frame !== null
        && frame === contents.mainFrame && frame === document.frame
        && fileUrl(frame.url) === expected && fileUrl(contents.getURL()) === expected;
      return trusted && !disposed && generation === document.generation;
    } catch { return false; }
  }
  function register<I extends c.AnnotationWorkspacesInput, R>(channel: string, schema: z.ZodType<I>,
    parse: (value: unknown, input: I) => R, operation: (input: I, call: Call, guard: () => void) => unknown): void {
    ipc.handle(channel, (event, ...args: unknown[]) => {
      let entered = false;
      let document: Document | undefined;
      try {
        const capturedGeneration = generation;
        document = { frame: event.senderFrame, generation: capturedGeneration };
        const captured = document;
        const guard = () => { if (!current(event, captured)) throw new RequestFailure('INVALID_REQUEST'); };
        guard();
        if (args.length !== 1) throw new RequestFailure('INVALID_REQUEST');
        assertNoProxy(args[0]);
        const input = schema.safeParse(args[0]);
        if (!input.success) throw new RequestFailure('INVALID_REQUEST');
        guard();
        if (active) throw new RequestFailure('BUSY');
        active = true; entered = true;
        const call: Call = (action) => {
          guard();
          if (database.inTransaction) throw new RequestFailure('BUSY');
          guard();
          const value = action();
          guard();
          if (database.inTransaction) throw new RequestFailure('BUSY');
          try { assertNoProxy(value); } catch { throw new RequestFailure('OPERATION_FAILED'); }
          guard();
          return value;
        };
        // Presence checks are scoped SQL, not guesses based on error messages.
        const present = call(() => database.prepare('SELECT id FROM projects WHERE id=?').get(input.data.projectId));
        if (!present) throw new RequestFailure('NOT_FOUND');
        const project = call(() => getProject(database, input.data.projectId));
        if (project.id !== input.data.projectId) throw new RequestFailure('OPERATION_FAILED');
        const value = operation(input.data, call, guard);
        guard();
        try { assertNoProxy(value); } catch { throw new RequestFailure('OPERATION_FAILED'); }
        const result = parse({ ok: true, value }, input.data);
        guard();
        return result;
      } catch (error) {
        return failure(document && !current(event, document) ? new RequestFailure('INVALID_REQUEST') : error);
      } finally { if (entered) active = false; }
    });
    registered.push(channel);
  }
  function member(i: c.AnnotationGetInput | c.AnnotationListInput, call: Call): AnnotationWorkspace {
    const found = call(() => database.prepare('SELECT id FROM annotation_workspaces WHERE id=? AND project_id=?')
      .get(i.workspaceId, i.projectId));
    if (!found) throw new RequestFailure('NOT_FOUND');
    const workspace = call(() => getAnnotationWorkspace(database, i.projectId, i.workspaceId));
    if (workspace.projectId !== i.projectId || workspace.id !== i.workspaceId) throw new RequestFailure('OPERATION_FAILED');
    if ('itemId' in i && !call(() => database.prepare('SELECT id FROM annotation_items WHERE id=? AND workspace_id=?')
      .get(i.itemId, i.workspaceId))) throw new RequestFailure('NOT_FOUND');
    return workspace;
  }
  function previous(i: c.AnnotationSaveInput | c.AnnotationConfirmInput, call: Call) {
    const workspace = member(i, call);
    if (workspace.state !== 'editing') throw new RequestFailure('LOCKED');
    const value = call(() => getAnnotationItem(database, i.projectId, i.workspaceId, i.itemId));
    const parsed = c.parseAnnotationGetResponse({ ok: true, value }, { projectId: i.projectId, workspaceId: i.workspaceId, itemId: i.itemId });
    verifyItem(parsed);
    if (value.item.editVersion !== i.expectedEditVersion || value.item.annotationSha256 !== i.expectedAnnotationSha256
      || value.item.state !== i.expectedState || value.item.confirmedAt !== i.expectedConfirmedAt) throw new RequestFailure('CONFLICT');
    return value;
  }
  function dispose(): void {
    if (disposed) return;
    disposed = true; invalidate();
    contents.removeListener('did-start-navigation', navigation);
    contents.removeListener('render-process-gone', invalidate);
    contents.removeListener('destroyed', dispose);
    for (const channel of registered.splice(0)) ipc.removeHandler(channel);
  }
  try {
    contents.on('did-start-navigation', navigation);
    contents.on('render-process-gone', invalidate);
    contents.on('destroyed', dispose);
    register(c.ANNOTATION_WORKSPACES_CHANNEL, c.annotationWorkspacesInputSchema, c.parseAnnotationWorkspacesResponse,
      (i, call, guard) => call(() => workspaceTransaction(database, false, () => {
        guard();
        const ids = database.prepare('SELECT id FROM annotation_workspaces WHERE project_id=? ORDER BY updated_at DESC,id')
          .all(i.projectId) as { id: string }[];
        guard();
        const result: AnnotationWorkspace[] = [];
        for (const row of ids) {
          guard();
          const header = readWorkspaceHeader(database, i.projectId, row.id);
          guard();
          if (header.id !== row.id) throw new RequestFailure('OPERATION_FAILED');
          result.push(header);
        }
        return result;
      })));
    register(c.ANNOTATION_LIST_CHANNEL, c.annotationListInputSchema, c.parseAnnotationListResponse, (i, call) => {
      member(i, call);
      return call(() => listAnnotationItems(database, i.projectId, i.workspaceId,
        { offset: i.offset, limit: i.limit, ...(i.state === undefined ? {} : { state: i.state }) }));
    });
    register(c.ANNOTATION_GET_CHANNEL, c.annotationGetInputSchema, c.parseAnnotationGetResponse, (i, call) => {
      member(i, call);
      const value = call(() => getAnnotationItem(database, i.projectId, i.workspaceId, i.itemId));
      verifyItem(c.parseAnnotationGetResponse({ ok: true, value }, i));
      return value;
    });
    register(c.ANNOTATION_SAVE_CHANNEL, c.annotationSaveInputSchema, c.parseAnnotationSaveResponse, (i, call) => {
      previous(i, call);
      const { projectId, workspaceId, itemId, ...command } = i;
      const value = call(() => saveAnnotationDraft(database, projectId, workspaceId, itemId, command));
      verifyItem(c.parseAnnotationSaveResponse({ ok: true, value }, i));
      return value;
    });
    register(c.ANNOTATION_CONFIRM_CHANNEL, c.annotationConfirmInputSchema, c.parseAnnotationConfirmResponse, (i, call) => {
      const before = previous(i, call);
      const { projectId, workspaceId, itemId, ...command } = i;
      const value = call(() => confirmAnnotationItem(database, projectId, workspaceId, itemId, command));
      verifyItem(c.parseAnnotationConfirmResponse({ ok: true, value }, i));
      if (!isDeepStrictEqual(value.item.annotation, before.item.annotation)
        || !isDeepStrictEqual(value.provenance, before.provenance)) throw new RequestFailure('OPERATION_FAILED');
      return value;
    });
  } catch (error) { dispose(); throw error; }
  return Object.freeze({ dispose });
}