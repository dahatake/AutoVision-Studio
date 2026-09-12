import type { Event as ElectronEvent, IpcMain, IpcMainInvokeEvent, WebContents,
  WebContentsDidStartNavigationEventParams, WebFrameMain } from 'electron';
import { fileURLToPath } from 'node:url';
import { types } from 'node:util';
import type { z } from 'zod';

import * as contract from '../../shared/contracts/annotation-ipc.js';
import { createLabelSchema, getLabelSchema, createLabelClass, updateLabelClass, updateLabelSchema,
  deleteLabelClass, mergeLabelClasses, LabelSchemaError, type LabelSchemaErrorCode } from '../annotations/label-schema-service.js';
import type { DatabaseConnection } from '../db/database.js';

class RequestFailure extends Error {
  constructor(readonly code: contract.AnnotationIpcErrorCode) { super(code); }
}
const codes: Record<LabelSchemaErrorCode, contract.AnnotationIpcErrorCode> = {
  LABEL_INPUT: 'INVALID_REQUEST', LABEL_DATABASE: 'OPERATION_FAILED', LABEL_TRANSACTION: 'BUSY',
  LABEL_PROJECT_NOT_FOUND: 'NOT_FOUND', LABEL_SCHEMA_NOT_FOUND: 'NOT_FOUND', LABEL_CLASS_NOT_FOUND: 'NOT_FOUND',
  LABEL_CONFLICT: 'CONFLICT', LABEL_LOCKED: 'LOCKED', LABEL_DUPLICATE_NAME: 'CONFLICT',
  LABEL_ORDINAL_CONFLICT: 'CONFLICT', LABEL_CLASS_USED: 'CLASS_USED', LABEL_HISTORY_REFERENCE: 'HISTORY_REFERENCE',
  LABEL_STORED_DATA: 'OPERATION_FAILED',
};
function failure(error: unknown) {
  let code: contract.AnnotationIpcErrorCode = 'OPERATION_FAILED';
  try {
    if (error !== null && typeof error === 'object' && !types.isProxy(error)) {
      const field = Object.getOwnPropertyDescriptor(error, 'code');
      const raw: unknown = field && 'value' in field ? field.value : undefined;
      if (error instanceof RequestFailure) {
        const parsed = contract.annotationIpcErrorCodeSchema.safeParse(raw);
        if (parsed.success) code = parsed.data;
      } else if (error instanceof LabelSchemaError && typeof raw === 'string' && Object.hasOwn(codes, raw)) {
        code = codes[raw as LabelSchemaErrorCode];
      }
    }
  } catch { /* Never read native message, stack, path or accessor fields. */ }
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
// Descriptor-only, iterative, bounded traversal BEFORE portable shared codecs.
// Seen nodes prevent exponential DAG expansion; shared codecs reject cycles.
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

/** ANN-04H only: no startup wiring, lock command, import capability or fake business dependency. */
export function registerLabelSchemaHandlers(
  ipc: Pick<IpcMain, 'handle' | 'removeHandler'>, contents: WebContents, expectedURL: string,
  database: DatabaseConnection,
): { dispose(): void } {
  const expected = fileUrl(expectedURL);
  if (expected === undefined) throw new RequestFailure('INVALID_REQUEST');
  const registered: string[] = [];
  let disposed = false, generation = 0, active = false;
  type Document = { frame: WebFrameMain | null; generation: number };
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
  function assertCurrent(event: IpcMainInvokeEvent, document: Document): void {
    if (!current(event, document)) throw new RequestFailure('INVALID_REQUEST');
  }
  function register<I, R>(channel: string, schema: z.ZodType<I>, parse: (value: unknown, input: I) => R,
    operation: (input: I) => unknown): void {
    ipc.handle(channel, (event, ...args: unknown[]) => {
      let entered = false;
      let document: Document | undefined;
      try {
        const capturedGeneration = generation;
        document = { frame: event.senderFrame, generation: capturedGeneration };
        assertCurrent(event, document);
        if (args.length !== 1) throw new RequestFailure('INVALID_REQUEST');
        assertNoProxy(args[0]);
        const input = schema.safeParse(args[0]);
        if (!input.success) throw new RequestFailure('INVALID_REQUEST');
        assertCurrent(event, document);
        if (active) throw new RequestFailure('BUSY');
        active = true; entered = true;
        // Do not read provisional data or commit/rollback another Main owner's TX.
        if (database.inTransaction) throw new RequestFailure('BUSY');
        assertCurrent(event, document);
        const value = operation(input.data); // Deliberately synchronous; no await gap.
        assertCurrent(event, document);
        const result = parse({ ok: true, value }, input.data);
        assertCurrent(event, document);
        return result;
      } catch (error) {
        return failure(document && !current(event, document) ? new RequestFailure('INVALID_REQUEST') : error);
      } finally { if (entered) active = false; }
    });
    registered.push(channel); // A failing handle belongs to somebody else.
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
    register(contract.LABEL_GET_CHANNEL, contract.labelGetInputSchema, contract.parseLabelGetResponse,
      (i) => getLabelSchema(database, i.projectId) ?? null);
    register(contract.LABEL_CREATE_CHANNEL, contract.labelCreateInputSchema, contract.parseLabelCreateResponse,
      (i) => createLabelSchema(database, i.projectId));
    register(contract.LABEL_CREATE_CLASS_CHANNEL, contract.labelCreateClassInputSchema, contract.parseLabelCreateClassResponse,
      ({ projectId, ...i }) => createLabelClass(database, projectId, i));
    register(contract.LABEL_UPDATE_CLASS_CHANNEL, contract.labelUpdateClassInputSchema, contract.parseLabelUpdateClassResponse,
      ({ projectId, ...i }) => updateLabelClass(database, projectId, i));
    register(contract.LABEL_UPDATE_CHANNEL, contract.labelUpdateInputSchema, contract.parseLabelUpdateResponse,
      ({ projectId, ...i }) => updateLabelSchema(database, projectId, i));
    register(contract.LABEL_DELETE_CLASS_CHANNEL, contract.labelDeleteClassInputSchema, contract.parseLabelDeleteClassResponse,
      (i) => deleteLabelClass(database, i.projectId, i.schemaId, i.classId, i.expectedEditVersion));
    register(contract.LABEL_MERGE_CLASSES_CHANNEL, contract.labelMergeClassesInputSchema, contract.parseLabelMergeClassesResponse,
      (i) => mergeLabelClasses(database, i.projectId, i.schemaId, i.sourceId, i.targetId, i.expectedEditVersion));
  } catch (error) { dispose(); throw error; }
  return Object.freeze({ dispose });
}