import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { createDatabasePool } from '../src/lib/db';
import { migrate } from '../src/lib/migrations';
import { authorizeTrip } from '../src/lib/auth/authorization';

test('trip access requires its owner', async () => {
  const owner = async () => 'owner';
  assert.equal(await authorizeTrip(undefined, 'trip', owner), 401);
  assert.equal(await authorizeTrip('other', 'trip', owner), 403);
  assert.equal(await authorizeTrip('owner', 'trip', owner), 200);
  assert.equal(await authorizeTrip('owner', 'missing', async () => null), 404);
});

test('withdrawal deletes only the user and their trips in PostgreSQL', async () => {
  const pool = createDatabasePool();
  const client = await pool.connect();
  const schema = `test_auth_${randomUUID().replaceAll('-', '')}`;
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await migrate(client);
    const first = randomUUID(), second = randomUUID();
    await client.query('INSERT INTO users (id, google_id, email) VALUES ($1, $2, $3), ($4, $5, $6)', [first, 'g1', 'a@example.test', second, 'g2', 'b@example.test']);
    await client.query('INSERT INTO trips (id, owner_id) VALUES ($1, $2), ($3, $4)', [randomUUID(), first, randomUUID(), second]);
    await client.query('DELETE FROM users WHERE id = $1', [first]);
    assert.deepEqual((await client.query('SELECT id FROM users')).rows, [{ id: second }]);
    assert.deepEqual((await client.query('SELECT owner_id FROM trips')).rows, [{ owner_id: second }]);
  } finally {
    await client.query('RESET search_path');
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    client.release();
    await pool.end();
  }
});
