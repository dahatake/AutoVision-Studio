import { randomUUID } from 'node:crypto';

import { projectIdSchema } from '../../shared/contracts/project.js';
import type { DatabaseConnection } from '../db/database.js';
import {
  applyReferenceRelink,
  findDataImport,
  prepareReferenceRelink,
  type DataImport,
} from './import-repository.js';
import { importImageKeySchema } from './import-source-manifest.js';
import { assertCapturedReferenceSourceCurrent, captureReferenceCandidate } from './reference-access.js';

export {
  captureReferenceSource,
  verifyReferenceSource,
  type ReferenceRelinkReason,
  type ReferenceSourceImage,
  type ReferenceVerification,
} from './reference-access.js';

function invalid(): never {
  throw new TypeError('Reference sourceには検証済み画像または保存済みmanifestの安全な絶対パスが必要です。');
}

/**
 * Explicitly binds one saved Reference entry to a user-selected candidate with
 * identical size/SHA-256. Candidate I/O and manifest encoding occur before the
 * short synchronous SQLite write transaction. The last path/identity guard,
 * entry CAS, full-manifest CAS and COMMIT have no await gap. No source path is
 * ever opened writable, renamed, removed, linked or timestamp-modified.
 */
export async function relinkReferenceSource(database: DatabaseConnection, projectIdInput: string,
  importIdInput: string, imageKeyInput: string, candidatePathInput: string,
  updatedAtInput: string): Promise<DataImport> {
  if (database.inTransaction) throw new Error('Reference relink cannot join an existing transaction.');
  const projectId = projectIdSchema.parse(projectIdInput);
  const importId = typeof importIdInput === 'string' ? importIdInput : invalid();
  const parsedKey = importImageKeySchema.safeParse(imageKeyInput);
  const key = parsedKey.success ? parsedKey.data : invalid();
  const candidatePath = typeof candidatePathInput === 'string' ? candidatePathInput : invalid();
  const updatedAt = typeof updatedAtInput === 'string' ? updatedAtInput : invalid();
  const current = findDataImport(database, projectId, importId);
  if (!current) throw new Error('Reference importが見つかりません。');
  if (current.mode !== 'reference' || current.sourceManifest.mode !== 'reference') {
    throw new Error('Copy importはrelinkできません。');
  }
  const saved = current.sourceManifest.entries.find((entry) => entry.imageKey === key);
  if (!saved) throw new Error('Reference sourceが見つかりません。');

  const candidate = await captureReferenceCandidate(saved, candidatePath);
  const prepared = prepareReferenceRelink(current, key, candidate, updatedAt);
  assertCapturedReferenceSourceCurrent(candidate);

  // Candidate hashing awaited without a DB lock. Another owner may have begun
  // a transaction on this shared connection in that interval; never roll it
  // back. From this point through COMMIT there are no await/re-entrancy gaps.
  if (database.inTransaction) throw new Error('Reference relink cannot join an existing transaction.');
  const savepoint = `reference_relink_${randomUUID().replaceAll('-', '')}`;
  let ownsTransaction = false;
  try {
    database.exec('BEGIN IMMEDIATE');
    ownsTransaction = true;
    database.exec(`SAVEPOINT ${savepoint}`);
    assertCapturedReferenceSourceCurrent(candidate);
    const updated = applyReferenceRelink(database, prepared);
    assertCapturedReferenceSourceCurrent(candidate);
    database.exec('COMMIT');
    ownsTransaction = false;
    return updated;
  } catch (error) {
    if (ownsTransaction && database.inTransaction) {
      // inTransaction alone cannot identify our transaction: COMMIT may have
      // succeeded before its wrapper threw and started another owner's work.
      // SQLite stops this single exec if the private savepoint is absent, so
      // the following ROLLBACK cannot end that foreign transaction.
      try { database.exec(`ROLLBACK TO ${savepoint}; ROLLBACK`); }
      catch (rollbackError) {
        throw new AggregateError([error, rollbackError],
          'Reference relinkに失敗し、DB rollbackも確認できませんでした。再試行せず一覧を再取得してください。');
      }
    } else if (ownsTransaction) {
      throw new AggregateError([error],
        'Reference relinkのDB結果を確認できませんでした。自動再試行せず一覧を再取得してください。');
    }
    throw error;
  }
}
