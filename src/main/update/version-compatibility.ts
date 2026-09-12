import { migrateDatabaseWithBackup } from '../db/backup.js';
import type { DatabaseConnection } from '../db/database.js';
import type { Migration } from '../db/migrate.js';
import { compareProductVersions } from './product-version.js';

export type VersionChangeOperation = 'repair' | 'upgrade';
export type PreparedVersionChange = Readonly<{
  operation: VersionChangeOperation;
  schemaVersion: number;
  backup: Awaited<ReturnType<typeof migrateDatabaseWithBackup>>['backup'];
}>;

/** Product ordering only; neither equality nor a higher version proves DB compatibility. */
export function getVersionChangeOperation(installedVersion: unknown, targetVersion: unknown): VersionChangeOperation {
  const order = compareProductVersions(targetVersion, installedVersion);
  if (order < 0) throw new RangeError('新しい版が導入済みのため、旧版への上書きはできません。');
  return order === 0 ? 'repair' : 'upgrade';
}

/** Main-only failure. The cause must not be serialized to a Renderer or public log. */
export class VersionPreparationError extends Error {
  readonly code = 'PRODUCT_UPDATE_PREPARATION_FAILED';
  readonly canStart = false;
  readonly rollbackStatus = 'unconfirmed';

  constructor(readonly operation: VersionChangeOperation, cause: unknown) {
    super('更新の準備を完了できません。処理を停止し、旧版とデータの復旧状態を確認してください。復旧完了は未確認です。', { cause });
    this.name = 'VersionPreparationError';
  }
}

/**
 * PKG-09B: prepare only the database for an already-admitted repair/upgrade.
 * Main supplies the installed/target release metadata, its existing connection,
 * trusted complete migration history and private backup directory. It must hold
 * maintenance exclusion, quiesce ALL writers and retain/close its connection.
 * REL-02 alone owns backup-before-SQL and transactional recovery. Repair still
 * checks the actual schema; no pending SQL means no new backup is required.
 * Failure never means a successful rollback, even when SQL rollback occurred:
 * COMMIT acknowledgement can be lost, and restoring the old app is PKG-19/13.
 * No installer, version metadata write, live DB replacement or retry is performed.
 */
export async function prepareVersionChange(installedVersion: unknown, targetVersion: unknown,
  database: DatabaseConnection, migrations: readonly Migration[], backupDirectory: string): Promise<PreparedVersionChange> {
  // Invalid/downgrade input is rejected before even inspecting the connection.
  const operation = getVersionChangeOperation(installedVersion, targetVersion);
  try {
    const result = await migrateDatabaseWithBackup(database, migrations, backupDirectory);
    return Object.freeze({ operation, schemaVersion: result.version, backup: result.backup });
  } catch (cause) {
    throw new VersionPreparationError(operation, cause);
  }
}