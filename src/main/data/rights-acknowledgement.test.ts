// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openDatabase, type DatabaseConnection } from '../db/database.js';
import { migrateDatabase, type Migration } from '../db/migrate.js';
import { acknowledgeImportRights, getImportRightsAcknowledgement } from './rights-acknowledgement.js';

// Fixed reviewed history, not directory discovery or Main startup dependencies.
const history: readonly Migration[] = [
  '001_core.sql', '002_jobs.sql', '003_import.sql', '004_import_generation.sql', '005_import_rights.sql',
].map((file, index) => ({
  version: index + 1,
  sql: readFileSync(new URL(`../db/migrations/${file}`, import.meta.url), 'utf8'),
}));
const projectId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const unknownId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const first = '2026-09-12T01:02:03.004Z';
const later = '2026-09-13T04:05:06.007Z';
let directory: string;
let database: DatabaseConnection;

function seedProject(id: string, connection = database): void {
  connection.prepare(`INSERT INTO projects
    (id, name, description, task_type, workspace_path, created_at, updated_at)
    VALUES (?, 'Project', 'original', 'classification', ?, ?, ?)`)
    .run(id, `C:\\fixture\\${id}`, first, first);
}
function rows(): unknown[] {
  return database.prepare('SELECT * FROM project_import_rights ORDER BY project_id').all();
}
function description(): unknown {
  return database.prepare('SELECT description FROM projects WHERE id = ?').get(projectId);
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'autovision-dat13-backend-'));
  database = openDatabase(join(directory, 'metadata.sqlite3'));
  expect(migrateDatabase(database, history)).toBe(5);
  seedProject(projectId);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (database.open) {
    if (database.inTransaction) database.exec('ROLLBACK');
    database.close();
  }
  rmSync(directory, { recursive: true, force: true });
});

describe('DAT-13 Main import rights acknowledgement', () => {
  it('reads without inserting or changing settings, including a never-acknowledged Project', () => {
    database.prepare('INSERT INTO settings(key, value) VALUES (?, ?)').run('fixture', 'unchanged');
    const changes = database.prepare('SELECT total_changes() AS count').get();
    database.pragma('query_only = ON');
    expect(getImportRightsAcknowledgement(database, projectId)).toBeUndefined();
    expect(() => getImportRightsAcknowledgement(database, unknownId)).toThrow(/Project not found/);
    expect(database.inTransaction).toBe(false);
    expect(rows()).toEqual([]);
    expect(database.prepare('SELECT total_changes() AS count').get()).toEqual(changes);
    expect(database.prepare('SELECT * FROM settings').all()).toEqual([{ key: 'fixture', value: 'unchanged' }]);
  });

  it('generates the initial timestamp in Main using the actual clock and returns only frozen metadata', () => {
    database.exec('BEGIN IMMEDIATE');
    const before = Date.now();
    // Extra JavaScript arguments cannot supply a Renderer-controlled timestamp.
    const value = Reflect.apply(acknowledgeImportRights, undefined, [database, projectId, true, '1900-01-01T00:00:00.000Z']);
    const after = Date.now();
    expect(Object.keys(value).sort()).toEqual(['acknowledgedAt', 'projectId']);
    expect(Object.isFrozen(value)).toBe(true);
    expect(value.projectId).toBe(projectId);
    expect(Date.parse(value.acknowledgedAt)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(value.acknowledgedAt)).toBeLessThanOrEqual(after);
    expect(new Date(value.acknowledgedAt).toISOString()).toBe(value.acknowledgedAt);
    expect(database.inTransaction).toBe(true);
    expect(database.prepare('SELECT * FROM settings').all()).toEqual([]);
    database.exec('COMMIT');
    database.pragma('query_only = ON');
    const read = getImportRightsAcknowledgement(database, projectId);
    expect(read).toEqual(value);
    expect(Object.isFrozen(read)).toBe(true);
  });

  it('canonicalizes direct UUID strings and keeps the first timestamp when the clock changes', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(first));
    database.exec('BEGIN IMMEDIATE');
    const value = acknowledgeImportRights(database, projectId.toUpperCase(), true);
    expect(value).toEqual({ projectId, acknowledgedAt: first });
    database.exec('COMMIT');
    vi.setSystemTime(new Date(later));
    database.exec('BEGIN IMMEDIATE');
    const changes = database.prepare('SELECT total_changes() AS count').get();
    expect(acknowledgeImportRights(database, projectId, true)).toEqual(value);
    expect(getImportRightsAcknowledgement(database, projectId.toUpperCase())).toEqual(value);
    expect(database.prepare('SELECT total_changes() AS count').get()).toEqual(changes);
    expect(database.inTransaction).toBe(true);
  });

  it.each([
    { name: 'false', value: false }, { name: 'undefined', value: undefined }, { name: 'null', value: null },
    { name: 'object', value: {} }, { name: 'array', value: [] }, { name: 'string false', value: 'false' },
    { name: 'string true', value: 'true' }, { name: 'zero', value: 0 }, { name: 'one', value: 1 },
    { name: 'boxed true', value: new Boolean(true) },
  ])('rejects $name acceptance both before and after acknowledgement', ({ value }) => {
    database.exec('BEGIN IMMEDIATE');
    expect(() => acknowledgeImportRights(database, projectId, value as boolean)).toThrow(/accepted === true/);
    expect(rows()).toEqual([]);
    const original = acknowledgeImportRights(database, projectId, true);
    expect(() => acknowledgeImportRights(database, projectId, value as boolean)).toThrow(/accepted === true/);
    expect(getImportRightsAcknowledgement(database, projectId)).toEqual(original);
    expect(database.inTransaction).toBe(true);
  });

  it.each([
    { name: 'undefined', value: undefined }, { name: 'null', value: null }, { name: 'number', value: 0 },
    { name: 'boolean', value: true }, { name: 'object', value: {} }, { name: 'array', value: [projectId] },
    { name: 'empty', value: '' }, { name: 'leading space', value: ` ${projectId}` },
    { name: 'trailing newline', value: `${projectId}\n` }, { name: 'missing hyphens', value: projectId.replaceAll('-', '') },
    { name: 'invalid variant', value: 'aaaaaaaa-aaaa-4aaa-0aaa-aaaaaaaaaaaa' },
    { name: 'SQL', value: "' OR 1=1 --" },
  ])('rejects $name Project IDs before database queries', ({ value }) => {
    database.exec('BEGIN IMMEDIATE');
    const prepare = vi.spyOn(database, 'prepare');
    expect(() => getImportRightsAcknowledgement(database, value as string)).toThrow();
    expect(() => acknowledgeImportRights(database, value as string, true)).toThrow();
    expect(prepare).not.toHaveBeenCalled();
    expect(database.inTransaction).toBe(true);
  });

  it('does not invoke getters or coercion on object inputs', () => {
    const getter = vi.fn(() => true);
    const input = Object.defineProperties({}, {
      projectId: { get: getter }, accepted: { get: getter }, acknowledgedAt: { get: getter },
      [Symbol.toPrimitive]: { get: getter },
    });
    database.exec('BEGIN IMMEDIATE');
    expect(() => getImportRightsAcknowledgement(database, input as string)).toThrow();
    expect(() => acknowledgeImportRights(database, input as string, true)).toThrow();
    expect(() => acknowledgeImportRights(database, projectId, input as boolean)).toThrow();
    expect(getter).not.toHaveBeenCalled();
    expect(rows()).toEqual([]);
  });

  it('requires a caller-owned transaction even when the acknowledgement already exists', () => {
    expect(() => acknowledgeImportRights(database, projectId, true)).toThrow(/caller transaction/);
    expect(rows()).toEqual([]);
    database.exec('BEGIN IMMEDIATE');
    const value = acknowledgeImportRights(database, projectId, true);
    database.exec('COMMIT');
    expect(() => acknowledgeImportRights(database, projectId, true)).toThrow(/caller transaction/);
    expect(getImportRightsAcknowledgement(database, projectId)).toEqual(value);
    expect(database.inTransaction).toBe(false);
  });

  it('throws for an unknown Project and isolates other Projects without implicit acknowledgement', () => {
    seedProject(otherId);
    database.exec('BEGIN IMMEDIATE');
    const other = acknowledgeImportRights(database, otherId, true);
    expect(() => acknowledgeImportRights(database, unknownId, true)).toThrow(/Project not found/);
    expect(() => getImportRightsAcknowledgement(database, unknownId)).toThrow(/Project not found/);
    expect(getImportRightsAcknowledgement(database, projectId)).toBeUndefined();
    expect(getImportRightsAcknowledgement(database, otherId)).toEqual(other);
    expect(rows()).toEqual([{ project_id: otherId, acknowledged_at: other.acknowledgedAt }]);
    expect(database.inTransaction).toBe(true);
  });

  it('does not borrow Project existence or acknowledgement from another database', () => {
    const foreign = openDatabase(join(directory, 'foreign.sqlite3'));
    try {
      migrateDatabase(foreign, history);
      seedProject(otherId, foreign);
      foreign.exec('BEGIN IMMEDIATE');
      acknowledgeImportRights(foreign, otherId, true);
      expect(() => getImportRightsAcknowledgement(foreign, projectId)).toThrow(/Project not found/);
      expect(() => acknowledgeImportRights(foreign, projectId, true)).toThrow(/Project not found/);
      expect(() => getImportRightsAcknowledgement(database, otherId)).toThrow(/Project not found/);
      expect(getImportRightsAcknowledgement(database, projectId)).toBeUndefined();
      expect(foreign.inTransaction).toBe(true);
    } finally {
      if (foreign.inTransaction) foreign.exec('ROLLBACK');
      foreign.close();
    }
  });

  it('does not turn an orphaned stored acknowledgement into an existing Project', () => {
    database.pragma('foreign_keys = OFF');
    database.prepare('INSERT INTO project_import_rights VALUES (?, ?)').run(unknownId, first);
    database.pragma('foreign_keys = ON');
    expect(() => getImportRightsAcknowledgement(database, unknownId)).toThrow(/Project not found/);
    database.exec('BEGIN IMMEDIATE');
    expect(() => acknowledgeImportRights(database, unknownId, true)).toThrow(/Project not found/);
    expect(rows()).toEqual([{ project_id: unknownId, acknowledged_at: first }]);
    expect(database.inTransaction).toBe(true);
  });

  it('persists the first timestamp through native close and reopen', () => {
    database.exec('BEGIN IMMEDIATE');
    const value = acknowledgeImportRights(database, projectId, true);
    database.exec('COMMIT');
    database.close();
    database = openDatabase(join(directory, 'metadata.sqlite3'));
    expect(database.pragma('user_version', { simple: true })).toBe(5);
    expect(getImportRightsAcknowledgement(database, projectId)).toEqual(value);
    database.exec('BEGIN IMMEDIATE');
    expect(acknowledgeImportRights(database, projectId, true)).toEqual(value);
    expect(database.inTransaction).toBe(true);
  });

  it('leaves the caller free to roll back the acknowledgement and the accepted action batch together', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(first));
    database.exec('BEGIN IMMEDIATE');
    database.prepare('UPDATE projects SET description = ? WHERE id = ?').run('pending action', projectId);
    expect(acknowledgeImportRights(database, projectId, true).acknowledgedAt).toBe(first);
    expect(database.inTransaction).toBe(true);
    expect(description()).toEqual({ description: 'pending action' });
    database.exec('ROLLBACK');
    expect(getImportRightsAcknowledgement(database, projectId)).toBeUndefined();
    expect(description()).toEqual({ description: 'original' });
    vi.setSystemTime(new Date(later));
    database.exec('BEGIN IMMEDIATE');
    expect(acknowledgeImportRights(database, projectId, true).acknowledgedAt).toBe(later);
  });

  it('propagates a native write fault without committing or rolling back the caller transaction', () => {
    database.exec(`CREATE TEMP TRIGGER fail_rights BEFORE INSERT ON project_import_rights
      BEGIN SELECT RAISE(ABORT, 'fixture write fault'); END;`);
    database.exec('BEGIN IMMEDIATE');
    database.prepare('UPDATE projects SET description = ? WHERE id = ?').run('pending action', projectId);
    expect(() => acknowledgeImportRights(database, projectId, true)).toThrow(/fixture write fault/);
    expect(database.inTransaction).toBe(true);
    expect(description()).toEqual({ description: 'pending action' });
    expect(rows()).toEqual([]);
    database.exec('ROLLBACK');
    expect(description()).toEqual({ description: 'original' });
  });

  it('fails a silently ignored insert without taking ownership of the caller transaction', () => {
    database.exec(`CREATE TEMP TRIGGER ignore_rights BEFORE INSERT ON project_import_rights
      BEGIN SELECT RAISE(IGNORE); END;`);
    database.exec('BEGIN IMMEDIATE');
    expect(() => acknowledgeImportRights(database, projectId, true)).toThrow(/exactly one row/);
    expect(database.inTransaction).toBe(true);
    expect(rows()).toEqual([]);
  });

  it('consumes the 005 duplicate SQL guard rather than replacing an existing acknowledgement', () => {
    database.exec('BEGIN IMMEDIATE');
    const value = acknowledgeImportRights(database, projectId, true);
    expect(() => database.prepare('INSERT INTO project_import_rights VALUES (?, ?)').run(projectId, later))
      .toThrow(/already acknowledged/);
    expect(database.inTransaction).toBe(true);
    expect(getImportRightsAcknowledgement(database, projectId)).toEqual(value);
  });

  it.each([
    { name: 'non-leap February', value: '2026-02-29T01:02:03.004Z' },
    { name: 'February overflow', value: '2024-02-30T01:02:03.004Z' },
    { name: 'April overflow', value: '2026-04-31T01:02:03.004Z' },
    { name: 'month zero', value: '2026-00-12T01:02:03.004Z' },
    { name: 'month overflow', value: '2026-13-12T01:02:03.004Z' },
    { name: 'day zero', value: '2026-09-00T01:02:03.004Z' },
    { name: 'hour overflow', value: '2026-09-12T24:00:00.000Z' },
    { name: 'minute overflow', value: '2026-09-12T01:60:03.004Z' },
    { name: 'second overflow', value: '2026-09-12T01:02:60.004Z' },
    { name: 'missing milliseconds', value: '2026-09-12T01:02:03Z' },
    { name: 'offset', value: '2026-09-12T01:02:03.004+00:00' },
    { name: 'trailing NUL', value: `${first}\0` },
    { name: 'empty', value: '' },
  ])('fails closed for a raw corrupt $name timestamp without overwriting it', ({ value }) => {
    // Test-only bypass for malformed shapes; calendar overflows already pass 005's shape check.
    database.pragma('ignore_check_constraints = ON');
    database.prepare('INSERT INTO project_import_rights VALUES (?, ?)').run(projectId, value);
    database.pragma('ignore_check_constraints = OFF');
    const before = rows();
    expect(before).toEqual([{ project_id: projectId, acknowledged_at: value }]);
    expect(() => getImportRightsAcknowledgement(database, projectId)).toThrow(/corrupt/);
    database.exec('BEGIN IMMEDIATE');
    expect(() => acknowledgeImportRights(database, projectId, true)).toThrow(/corrupt/);
    expect(database.inTransaction).toBe(true);
    expect(rows()).toEqual(before);
  });

  it('accepts a real leap-day timestamp stored in canonical Main ISO form', () => {
    const leap = '2024-02-29T23:59:59.999Z';
    database.prepare('INSERT INTO project_import_rights VALUES (?, ?)').run(projectId, leap);
    const value = getImportRightsAcknowledgement(database, projectId);
    expect(value).toEqual({ projectId, acknowledgedAt: leap });
    expect(Object.isFrozen(value)).toBe(true);
  });
});