import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runSqliteSmoke } from './main.js';

test('SPI-01 performs CRUD and rolls back a failed transaction', () => {
  const result = runSqliteSmoke();

  assert.equal(result.runtime, 'node');
  assert.equal(result.platform, process.platform);
  assert.equal(result.architecture, process.arch);
  assert.match(result.sqliteVersion, /^\d+\.\d+\.\d+$/);
  assert.deepEqual(result.rows, [{ id: 1, name: 'alpha', value: 42 }]);
  assert.equal(result.rollbackVerified, true);
  assert.equal(result.closed, true);
});

test('SPI-01 uses a fresh in-memory database on every run', () => {
  const first = runSqliteSmoke();
  const second = runSqliteSmoke();

  assert.deepEqual(second.rows, first.rows);
  assert.equal(second.rows[0]?.id, 1);
});