import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';

/**
 * Writes UTF-8 text or a snapshot of binary input, verifies the temporary file,
 * then commits with a single same-directory rename (FR-SEC-009/NFR-REL-003).
 *
 * Main must supply a validated, Project-owned destination and hold the Project
 * write lock. Sender/path/ownership checks, OS overwrite consent and subsequent
 * identity revalidation (FR-UI-007) belong to the caller, not this helper.
 * This is not malicious filesystem-race protection or a power-loss durability
 * guarantee: sync is OS/filesystem dependent and the directory is not fsynced.
 */
export async function writeFileAtomically(
  absolutePath: string,
  content: string | Uint8Array,
): Promise<{ sha256: string; byteLength: number }> {
  if (
    typeof absolutePath !== 'string' ||
    !isAbsolute(absolutePath) ||
    absolutePath.includes('\0')
  ) {
    throw new TypeError('Destination must be an absolute path without NUL characters.');
  }
  if (typeof content !== 'string' && !(content instanceof Uint8Array)) {
    throw new TypeError('Content must be a string or Uint8Array.');
  }

  // Buffer.from(Uint8Array) copies the view, including Buffer/subarray inputs.
  // Both the snapshot and its expected hash are fixed before the first await.
  const bytes = typeof content === 'string'
    ? Buffer.from(content, 'utf8')
    : Buffer.from(content);
  const expectedHash = crypto.createHash('sha256').update(bytes).digest('hex');
  const destination = resolve(absolutePath);
  const temporaryPath = join(dirname(destination), `.autovision-${crypto.randomUUID()}.tmp`);
  const samePath = process.platform === 'win32'
    ? temporaryPath.toLowerCase() === destination.toLowerCase()
    : temporaryPath === destination;
  if (samePath) {
    throw new Error('Temporary path must differ from the destination.');
  }

  // Outside the cleanup scope: EEXIST must never delete somebody else's file.
  const handle = await fs.open(temporaryPath, 'wx', 0o600);
  try {
    const errors: unknown[] = [];
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } catch (error) {
      errors.push(error);
    }
    // Explicitly close even after write/sync failure; never rename an open file.
    try {
      await handle.close();
    } catch (error) {
      errors.push(error);
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(errors, 'Atomic write and close failed.', { cause: errors[0] });
    }

    const written = await fs.readFile(temporaryPath);
    const sha256 = crypto.createHash('sha256').update(written).digest('hex');
    if (
      written.byteLength !== bytes.byteLength ||
      sha256 !== expectedHash ||
      !written.equals(bytes)
    ) {
      throw new Error('Atomic write verification failed.');
    }

    // No destination unlink, truncation, copy fallback or retry on failure.
    await fs.rename(temporaryPath, destination);
    return { sha256, byteLength: written.byteLength };
  } catch (error) {
    try {
      await fs.unlink(temporaryPath);
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Atomic write and cleanup failed.', {
        cause: error,
      });
    }
    throw error;
  }
}