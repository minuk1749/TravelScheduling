import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalUuidOrNull, createDatabasePool } from '../src/lib/db';

test('UUID lookups accept the PostgreSQL text form regardless of UUID version', () => {
  const id = 'abcdef01-2345-1789-abcd-ef0123456789';
  assert.equal(canonicalUuidOrNull(id), id);
  for (const alias of [id.toUpperCase(), id.replaceAll('-', ''), `{${id}}`, `${id}\n`]) {
    assert.equal(canonicalUuidOrNull(alias), null);
  }
});

test('database configuration is required and must be PostgreSQL', () => {
  assert.throws(() => createDatabasePool(''), /DATABASE_URL/);
  assert.throws(() => createDatabasePool('https://localhost'), /PostgreSQL/);
});

test('DATABASE_URL connects to PostgreSQL and executes a query', { timeout: 10000 }, async () => {
  const pool = createDatabasePool();
  try {
    const result = await pool.query<{ connected: number; version: string }>(
      'SELECT 1 AS connected, version() AS version',
    );
    assert.equal(result.rows[0].connected, 1);
    assert.match(result.rows[0].version, /^PostgreSQL /);
  } finally {
    await pool.end();
  }
});
