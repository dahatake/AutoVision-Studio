import type {
  Dialog, Event as ElectronEvent, IpcMain, IpcMainInvokeEvent, WebContents,
  WebContentsDidStartNavigationEventParams, WebFrameMain,
} from 'electron';
import { fileURLToPath } from 'node:url';

import {
  REFERENCE_RELINK_CHANNEL, REFERENCE_STATUS_CHANNEL,
  referenceRelinkInputSchema, referenceRelinkResponseSchema,
  referenceStatusInputSchema, referenceStatusResponseSchema,
  type ReferenceBrokenEntry, type ReferenceIpcErrorCode,
} from '../../shared/contracts/reference-ipc.js';
import { findDataImport, listDataImportHeaders } from '../data/import-repository.js';
import { relinkReferenceSource, verifyReferenceSource } from '../data/reference-source.js';
import type { DatabaseConnection } from '../db/database.js';

class RequestFailure extends Error {
  constructor(readonly code: ReferenceIpcErrorCode) { super(code); }
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
  let code: ReferenceIpcErrorCode = 'OPERATION_FAILED';
  if (error instanceof RequestFailure) code = error.code;
  return { ok: false as const, error: { code } };
}

/**
 * The exact candidate rejections `relinkReferenceSource` raises before any
 * write. Anything else — above all `AggregateError`, which reports an
 * unconfirmed database outcome — is NOT a "wrong file" answer.
 */
const candidateRejections: readonly string[] = [
  '選択したrelink候補を安全に読込めませんでした。',
  '選択したrelink候補のサイズまたはSHA-256が保存値と一致しません。',
];
function candidateRejected(error: unknown): boolean {
  return error instanceof Error && !(error instanceof AggregateError)
    && candidateRejections.includes(error.message);
}

/**
 * REL-04 / W3-05 wiring for the existing Reference verification and relink
 * services. Two fixed operations:
 *
 * - `status` re-verifies every saved Reference original of one Project and
 *   reports which ones need a relink, with the reason. It never writes.
 * - `relink` opens the OS picker in Main, then hands the chosen file to
 *   `relinkReferenceSource`, which only accepts an identical size/SHA-256.
 *
 * The Renderer supplies a Project ID and a saved `imageKey`; it can never name
 * a path, a channel or a destination.
 */
export function registerReferenceHandlers(
  ipc: Pick<IpcMain, 'handle' | 'removeHandler'>,
  contents: WebContents,
  expectedURL: string,
  database: DatabaseConnection,
  nativeDialog: Pick<Dialog, 'showOpenDialog'>,
): { dispose(): void } {
  const expected = fileUrl(expectedURL);
  if (expected === undefined || typeof nativeDialog.showOpenDialog !== 'function') {
    throw new RequestFailure('INVALID_REQUEST');
  }
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
  function register(channel: string,
    handler: (input: unknown, assertCurrent: () => void) => Promise<unknown>): void {
    ipc.handle(channel, async (event, ...args: unknown[]) => {
      let document: Document | undefined;
      // Only the call that actually acquired the exclusion may release it: a
      // request rejected as BUSY must never clear another one's flag.
      let acquired = false;
      try {
        document = { frame: event.senderFrame, generation };
        const assertCurrent = () => {
          if (!current(event, document!)) throw new RequestFailure('INVALID_REQUEST');
        };
        assertCurrent();
        if (args.length !== 1) throw new RequestFailure('INVALID_REQUEST');
        if (active || database.inTransaction) throw new RequestFailure('BUSY');
        active = true;
        acquired = true;
        const result = await handler(args[0], assertCurrent);
        assertCurrent();
        return result;
      } catch (error) {
        return failure(error);
      } finally { if (acquired) active = false; }
    });
    registered.push(channel);
  }

  try {
    contents.on('did-start-navigation', navigation);
    contents.on('render-process-gone', invalidate);
    contents.on('destroyed', dispose);

    register(REFERENCE_STATUS_CHANNEL, async (raw, assertCurrent) => {
      const input = referenceStatusInputSchema.safeParse(raw);
      if (!input.success) throw new RequestFailure('INVALID_REQUEST');
      const headers = listDataImportHeaders(database, input.data.projectId)
        .filter((header) => header.mode === 'reference');
      const broken: ReferenceBrokenEntry[] = [];
      let checked = 0;
      for (const header of headers) {
        const record = findDataImport(database, input.data.projectId, header.id);
        if (!record || record.sourceManifest.mode !== 'reference') continue;
        for (const entry of record.sourceManifest.entries) {
          assertCurrent();
          checked += 1;
          const verification = await verifyReferenceSource(entry);
          if (verification.status === 'relink-required') {
            broken.push({ importId: header.id, imageKey: entry.imageKey, reason: verification.reason });
          }
        }
      }
      return referenceStatusResponseSchema.parse({ ok: true, value: {
        projectId: input.data.projectId, inspectedImports: headers.length, checked, broken,
      } });
    });

    register(REFERENCE_RELINK_CHANNEL, async (raw, assertCurrent) => {
      const input = referenceRelinkInputSchema.safeParse(raw);
      if (!input.success) throw new RequestFailure('INVALID_REQUEST');
      const record = findDataImport(database, input.data.projectId, input.data.importId);
      if (!record || record.mode !== 'reference' || record.sourceManifest.mode !== 'reference') {
        throw new RequestFailure('NOT_FOUND');
      }
      if (!record.sourceManifest.entries.some((entry) => entry.imageKey === input.data.imageKey)) {
        throw new RequestFailure('NOT_FOUND');
      }
      const picked = await nativeDialog.showOpenDialog({
        title: '参照元ファイルを選び直す', properties: ['openFile'],
      });
      if (picked.canceled === true) return referenceRelinkResponseSchema.parse({ ok: true, value: { status: 'cancelled' } });
      const candidate = Array.isArray(picked.filePaths) ? picked.filePaths[0] : undefined;
      if (typeof candidate !== 'string' || candidate.length === 0 || picked.filePaths.length !== 1) {
        throw new RequestFailure('INVALID_REQUEST');
      }
      // Revalidate the sender AFTER the native dialog closes and BEFORE the
      // write, exactly as the Project picker boundary requires.
      assertCurrent();
      try {
        await relinkReferenceSource(database, input.data.projectId, input.data.importId,
          input.data.imageKey, candidate, new Date().toISOString());
      } catch (error) {
        // Only the service's own candidate-rejection means "wrong file". An
        // AggregateError reports an unconfirmed DB outcome and must never be
        // presented as a benign "pick the same file again".
        throw new RequestFailure(candidateRejected(error) ? 'MISMATCH' : 'OPERATION_FAILED');
      }
      return referenceRelinkResponseSchema.parse({ ok: true, value: {
        status: 'relinked', importId: input.data.importId, imageKey: input.data.imageKey,
      } });
    });
  } catch (error) { dispose(); throw error; }
  return Object.freeze({ dispose });
}
