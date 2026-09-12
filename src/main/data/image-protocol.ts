import { randomUUID } from 'node:crypto';

import { MAX_IMAGE_BYTES } from '../../shared/contracts/import.js';
import type { DatabaseConnection } from '../db/database.js';
import { verifyProjectDirectory, type ProjectDirectoryReceipt } from '../projects/project-directory.js';
import { readProjectImage } from '../security/safe-path.js';
import { assertImportImageSourceCurrent, findImportImageSource } from './import-repository.js';
import { readVerifiedReferenceImage } from './reference-access.js';

export const SCHEME = 'av-image';
/** Main operational tuning, not dataset/product limits. No waiting queue. */
export const IMAGE_PROTOCOL_MAX_READS = 4;
/** Payload reservation includes 2x encoded size; excludes DB metadata/consumer-owned copies. */
export const IMAGE_PROTOCOL_RESERVED_BYTES = 256 * 1024 * 1024;
const chunkBytes = 64 * 1024;
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const address = new RegExp(`^av-image://image/(${uuid})/(${uuid})/(${uuid})(?![\\s\\S])`, 'u');
const headers = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; sandbox",
  // File-renderer fetch support, NOT authentication or an authorization claim.
  'Access-Control-Allow-Origin': 'null',
};

function failure(status: number): Response {
  return new Response(null, { status, headers: { ...headers,
    ...(status === 405 ? { Allow: 'GET' } : {}) } });
}

function mime(bytes: Buffer): string | undefined {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.length >= 12 && bytes.subarray(0, 4).equals(Buffer.from('RIFF'))
    && bytes.subarray(8, 12).equals(Buffer.from('WEBP'))) return 'image/webp';
  if (bytes.length >= 54 && bytes[0] === 66 && bytes[1] === 77) return 'image/bmp';
  // Honest source MIME only. Chromium TIFF display is NOT guaranteed; a future
  // verified decoder/thumbnail service is required for all-format previews.
  if (bytes.length >= 8 && ((bytes[0] === 73 && bytes[1] === 73 && bytes[2] === 42 && bytes[3] === 0)
    || (bytes[0] === 77 && bytes[1] === 77 && bytes[2] === 0 && bytes[3] === 42))) return 'image/tiff';
  if (bytes.length >= 16 && ((bytes[0] === 73 && bytes[1] === 73 && bytes[2] === 43 && bytes[3] === 0
    && bytes[4] === 8 && bytes[5] === 0 && bytes[6] === 0 && bytes[7] === 0)
    || (bytes[0] === 77 && bytes[1] === 77 && bytes[2] === 0 && bytes[3] === 43
    && bytes[4] === 0 && bytes[5] === 8 && bytes[6] === 0 && bytes[7] === 0))) return 'image/tiff';
  return undefined;
}

function sameProject(before: ProjectDirectoryReceipt): void {
  const after = verifyProjectDirectory(before.rootPath, before.projectId);
  if (after.rootPath !== before.rootPath || after.projectId !== before.projectId
    || after.rootIdentity.dev !== before.rootIdentity.dev || after.rootIdentity.ino !== before.rootIdentity.ino
    || after.rootIdentity.birthtimeNs !== before.rootIdentity.birthtimeNs
    || after.markerIdentity.dev !== before.markerIdentity.dev || after.markerIdentity.ino !== before.markerIdentity.ino
    || after.markerIdentity.birthtimeNs !== before.markerIdentity.birthtimeNs) throw new Error('Image unavailable.');
}

/** Main registers handle before creating a Window; this leaf has no Electron runtime dependency.
 * Match request.url as delivered, never URL-normalize it to grant authority. The
 * transport must preserve the original URL: aliases already normalized BEFORE
 * Request creation cannot be recovered or distinguished by a Request-only API.
 */
export function createImageProtocol(database: DatabaseConnection): {
  handle(request: Request): Promise<Response>;
  dispose(): Promise<void>;
} {
  let closed = false;
  let reserved = 0;
  const active = new Set<AbortController>();
  const pending = new Set<Promise<Response>>();
  let disposal: Promise<void> | undefined;

  async function respond(request: Request): Promise<Response> {
    if (closed) return failure(503);
    if (request.method !== 'GET') return failure(405);
    if (request.headers.has('Range')) return failure(416);
    const match = address.exec(request.url);
    if (!match) return failure(404);
    const origin = request.headers.get('Origin');
    if (origin !== null && origin !== 'null') return failure(403);
    if (request.signal.aborted || !database.open || database.inTransaction
      || active.size >= IMAGE_PROTOCOL_MAX_READS) return failure(503);

    const controller = new AbortController();
    active.add(controller);
    let allocation = 0;
    let released = false;
    let streaming = false;
    let bytes: Buffer | undefined;
    let output: ReadableStreamDefaultController<Uint8Array> | undefined;
    const forwardAbort = () => controller.abort();
    const release = () => {
      if (released) return;
      released = true;
      bytes = undefined;
      reserved -= allocation;
      active.delete(controller);
      request.signal.removeEventListener('abort', forwardAbort);
      controller.signal.removeEventListener('abort', stop);
    };
    const stop = () => {
      // Keep reservation during pending native I/O until the reader settles.
      if (streaming) {
        output?.error(new DOMException('Image request aborted.', 'AbortError'));
        release();
      }
    };
    request.signal.addEventListener('abort', forwardAbort, { once: true });
    controller.signal.addEventListener('abort', stop, { once: true });
    try {
      controller.signal.throwIfAborted();
      const savepoint = `image_${randomUUID().replaceAll('-', '')}`;
      let source;
      let readingSnapshot = false;
      try {
        database.exec(`BEGIN DEFERRED; SAVEPOINT ${savepoint}`);
        readingSnapshot = true;
        source = findImportImageSource(database, match[1]!, match[2]!, match[3]!);
        readingSnapshot = false;
        database.exec('COMMIT');
      } catch {
        // A single exec stops at a missing private savepoint. Never roll back
        // an unrelated transaction following COMMIT acknowledgement loss.
        try { database.exec(`ROLLBACK TO ${savepoint}; ROLLBACK`); } catch { /* fail closed */ }
        return failure(readingSnapshot && !database.inTransaction ? 404 : 503);
      }
      if (database.inTransaction || !database.open) return failure(503);
      if (!source) return failure(404);
      if (!Number.isSafeInteger(source.byteSize) || source.byteSize <= 0 || source.byteSize > MAX_IMAGE_BYTES) return failure(404);
      allocation = source.byteSize * 2;
      if (allocation > IMAGE_PROTOCOL_RESERVED_BYTES - reserved) { allocation = 0; return failure(503); }
      reserved += allocation;
      assertImportImageSourceCurrent(database, source);
      const project = verifyProjectDirectory(source.projectRoot, source.projectId);
      bytes = source.mode === 'copy'
        ? await readProjectImage(project, { imageKey: source.imageKey, relativePath: source.relativePath!,
          byteSize: source.byteSize, sha256: source.sha256 }, controller.signal)
        : await readVerifiedReferenceImage({ imageKey: source.imageKey, sourcePath: source.sourcePath!,
          identity: { ...source.identity! }, mtimeNs: source.mtimeNs!, byteSize: source.byteSize,
          sha256: source.sha256 }, controller.signal);
      controller.signal.throwIfAborted();
      if (closed || !database.open || database.inTransaction) return failure(503);
      assertImportImageSourceCurrent(database, source);
      sameProject(project); // Also protects Reference requests from Project replacement.
      if (bytes.length !== source.byteSize) return failure(404);
      const contentType = mime(bytes);
      if (!contentType) return failure(415);
      let offset = 0;
      const body = new ReadableStream<Uint8Array>({
        start(value) { output = value; },
        pull(value) {
          if (!bytes || controller.signal.aborted) {
            value.error(new DOMException('Image request aborted.', 'AbortError'));
            release();
          } else if (offset === bytes.length) {
            value.close();
            release();
          } else {
            const end = Math.min(offset + chunkBytes, bytes.length);
            value.enqueue(bytes.subarray(offset, end)); // No Response(Buffer) full-size copy.
            offset = end;
          }
        },
        cancel() { release(); controller.abort(); },
      }, { highWaterMark: 0 }); // Unread responses continue holding a slot and budget.
      const response = new Response(body, { headers: { ...headers, 'Content-Type': contentType,
        'Content-Length': String(bytes.length), 'Accept-Ranges': 'none' } });
      streaming = true;
      return response;
    } catch {
      return failure(controller.signal.aborted || closed ? 503 : 404);
    } finally {
      if (!streaming) release();
    }
  }

  return {
    handle(request) {
      const result = respond(request);
      pending.add(result);
      void result.then(() => pending.delete(result), () => pending.delete(result));
      return result;
    },
    dispose() {
      if (!disposal) {
        closed = true;
        for (const controller of active) controller.abort();
        disposal = Promise.allSettled([...pending]).then(() => undefined);
      }
      return disposal;
    },
  };
}