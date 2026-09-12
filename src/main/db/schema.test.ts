// @vitest-environment node
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openDatabase, type DatabaseConnection } from './database.js';
import { migrateDatabase } from './migrate.js';

const sql = readFileSync(join(fileURLToPath(new URL('.', import.meta.url)), 'migrations', '001_core.sql'), 'utf8');
const history = [{ version: 1, sql }];
let directory: string;
let database: DatabaseConnection;
const timestamp = '2026-09-08T00:00:00.000Z';
function insert(id: string, name = 'Project', task = 'classification') {
  return database.prepare('INSERT INTO projects(id,name,task_type,workspace_path,created_at,updated_at) VALUES (?,?,?,?,?,?)')
    .run(id, name, task, 'C:\\Projects\\日本語', timestamp, timestamp);
}
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'autovision-core04-'));
  database = openDatabase(join(directory, 'metadata.sqlite3'));
  migrateDatabase(database, history);
});
afterEach(() => {
  if (database.open) database.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('initial core schema', () => {
  it('creates only the two empty core tables without feature data', () => {
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all())
      .toEqual([{ name: 'projects' }, { name: 'settings' }]);
    expect(database.prepare('SELECT * FROM projects').all()).toEqual([]);
    expect(database.prepare('SELECT * FROM settings').all()).toEqual([]);
    expect(database.pragma('user_version', { simple: true })).toBe(1);
  });
  it('keeps same-name Projects independent by ID and persists Unicode fields', () => {
    insert('ae45cf74-c9f9-4c49-88b9-0523b1ac7383', '同名プロジェクト');
    insert('49a97b8c-3cb7-4717-a06b-7323175d80d8', '同名プロジェクト', 'detection');
    database.prepare('UPDATE projects SET description=? WHERE id=?').run('説明 · 確認', 'ae45cf74-c9f9-4c49-88b9-0523b1ac7383');
    database.close();
    database = openDatabase(join(directory, 'metadata.sqlite3'));
    expect(migrateDatabase(database, history)).toBe(1);
    expect(database.prepare('SELECT name,description,task_type FROM projects ORDER BY task_type').all()).toEqual([
      { name: '同名プロジェクト', description: '説明 · 確認', task_type: 'classification' },
      { name: '同名プロジェクト', description: '', task_type: 'detection' },
    ]);
  });
  it('rejects a duplicate ID without replacing existing data', () => {
    insert('ae45cf74-c9f9-4c49-88b9-0523b1ac7383', 'original');
    expect(() => insert('ae45cf74-c9f9-4c49-88b9-0523b1ac7383', 'replacement')).toThrow(/UNIQUE/);
    expect(database.prepare('SELECT name FROM projects').all()).toEqual([{ name: 'original' }]);
  });
  it.each(['', '   '])('rejects empty or ASCII-space-only names %j', (name) => {
    expect(() => insert('fixture-id', name)).toThrow(/CHECK/);
  });
  it('rejects unsupported task types and missing required fields', () => {
    expect(() => insert('fixture-id', 'Project', 'segmentation')).toThrow(/CHECK/);
    expect(() => database.exec("INSERT INTO projects(id,name) VALUES ('x','Project')")).toThrow(/NOT NULL/);
  });
  it('stores explicit settings without populating other keys and rejects duplicates', () => {
    const statement = database.prepare('INSERT INTO settings(key,value) VALUES (?,?)');
    statement.run('test-setting', '日本語');
    expect(() => statement.run('test-setting', 'replacement')).toThrow(/UNIQUE/);
    expect(() => statement.run(' ', 'value')).toThrow(/CHECK/);
    expect(() => statement.run('other', null)).toThrow(/NOT NULL/);
    expect(database.prepare('SELECT * FROM settings').all()).toEqual([{ key: 'test-setting', value: '日本語' }]);
  });
  it('isolates deletion to the selected Project', () => {
    insert('first');
    insert('second');
    database.prepare('DELETE FROM projects WHERE id=?').run('first');
    expect(database.prepare('SELECT id FROM projects').all()).toEqual([{ id: 'second' }]);
  });
});