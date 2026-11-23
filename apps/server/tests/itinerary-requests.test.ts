import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool, type PoolClient } from 'pg';
import { itineraryHandlers } from '../src/itineraries/http';
import { migrate } from '../src/lib/migrations';
import { PostgresItineraryRequests } from '../src/repositories/itinerary-requests';
import { insertTrip } from '../src/repositories/trip-inputs';
import { ItineraryService } from '../src/services/itinerary';
import { FixturePlaces, FixtureTravel, sampleDraft } from './fixtures/itinerary';
import { withDatabase } from './helpers/database';

async function ownedTrip(client: PoolClient) {
  const owner = randomUUID();
  await client.query("INSERT INTO users (id, google_id, email) VALUES ($1, $2, 't27@example.test')", [owner, owner]);
  return { owner, id: await insertTrip(client, owner, sampleDraft()) };
}

function poolFor(schema: string) {
  // Independent one-connection servers; the lock holder must finish without borrowing another connection.
  return new Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema}`,
    application_name: schema, max: 1, connectionTimeoutMillis: 3000 });
}

function endpoint(client: PoolClient, pool: Pool, places = new FixturePlaces(), travel = new FixtureTravel()) {
  const requests = new PostgresItineraryRequests(pool);
  const handlers = itineraryHandlers({
    userId: async request => request.headers.get('x-test-user') ?? undefined,
    findOwner: async id => (await client.query('SELECT owner_id FROM trips WHERE id = $1', [id])).rows[0]?.owner_id ?? null,
    generator: (ownerId, requestId) => ({
      generator: { generate: tripId => requests.run(tripId, ownerId, requestId, (repository, profiles) =>
        new ItineraryService({ repository, profiles, places, travel }).generate(tripId)) },
      dispose() {},
    }),
  });
  return {
    post: (id: string, owner: string, key?: string) => handlers.generate(new Request(`https://test.local/api/trips/${id}/itinerary`, {
      method: 'POST', headers: { 'x-test-user': owner, ...(key ? { 'Idempotency-Key': key } : {}) },
    }), id),
    calls: () => [places.detailCalls.length, places.locationCalls.length, travel.matrixCalls.length, travel.routeCalls.length],
  };
}

async function successful(response: Response) {
  assert.equal(response.status, 200, response.status === 200 ? undefined : await response.text());
  return response.json();
}

async function waitForConcurrentRetry(client: PoolClient, schema: string) {
  const deadline = Date.now() + 5000;
  do {
    const blocked = await client.query(`SELECT 1 FROM pg_stat_activity WHERE application_name = $1
      AND cardinality(pg_blocking_pids(pid)) > 0`, [schema]);
    if (blocked.rowCount) return;
    await delay(10);
  } while (Date.now() < deadline);
  assert.fail('The second server did not reach the pending request while the provider was paused');
}

test('T27 a slow provider, concurrent retry and lost response recover exactly one committed generation', async () => {
  await withDatabase(async (client, schema) => {
    await migrate(client);
    const { id, owner } = await ownedTrip(client);
    const firstPool = poolFor(schema), retryPool = poolFor(schema);
    const entered = Promise.withResolvers<void>(), resume = Promise.withResolvers<void>();
    class SlowTravel extends FixtureTravel {
      override async matrix(input: Parameters<FixtureTravel['matrix']>[0]) {
        entered.resolve();
        await resume.promise;
        return super.matrix(input);
      }
    }
    const first = endpoint(client, firstPool, new FixturePlaces(), new SlowTravel());
    const retry = endpoint(client, retryPool);
    const key = randomUUID();
    try {
      const original = first.post(id, owner, key);
      await Promise.race([entered.promise, original.then(() => assert.fail('the provider was never reached'))]);
      const concurrent = retry.post(id, owner, key);
      try { await waitForConcurrentRetry(client, schema); } finally { resume.resolve(); }
      const lost = await original;
      assert.equal(lost.status, 200);
      await lost.body!.cancel(); // COMMIT succeeded but the caller never read the response.
      const recovered = await successful(await concurrent);
      assert.ok(first.calls().every(count => count > 0));
      assert.deepEqual(retry.calls(), [0, 0, 0, 0]);
      assert.equal((await client.query('SELECT id FROM itineraries WHERE trip_id = $1', [id])).rowCount, 1);

      const fresh = await successful(await retry.post(id, owner, randomUUID()));
      assert.equal(recovered.inputHash, fresh.inputHash);
      assert.notEqual(recovered.itineraryId, fresh.itineraryId);
      assert.deepEqual({ ...recovered, itineraryId: fresh.itineraryId }, fresh);
      const beforeReplay = retry.calls();
      assert.ok(beforeReplay.every(count => count > 0));
      // A later generation and even a changed input must not redirect a retry to the latest itinerary.
      await client.query('UPDATE trip_places SET duration_minutes = 300 WHERE trip_id = $1', [id]);
      assert.deepEqual(await successful(await retry.post(id, owner, key)), recovered);
      assert.deepEqual(retry.calls(), beforeReplay);
      assert.equal((await client.query('SELECT id FROM itineraries WHERE trip_id = $1', [id])).rowCount, 2);

      const other = await ownedTrip(client);
      const forbidden = await retry.post(id, other.owner, key);
      assert.equal(forbidden.status, 403);
      assert.equal((await forbidden.json()).itineraryId, undefined);
      assert.deepEqual(retry.calls(), beforeReplay);
      const unrelated = await successful(await retry.post(other.id, other.owner, key));
      assert.notEqual(unrelated.itineraryId, recovered.itineraryId);
      assert.notEqual(unrelated.inputHash, recovered.inputHash);
    } finally {
      resume.resolve();
      await Promise.all([firstPool.end(), retryPool.end()]);
    }
  });
});

test('T27 a failed save rolls back both the itinerary and receipt, and the same key can succeed', async () => {
  await withDatabase(async (client, schema) => {
    await migrate(client);
    const { id, owner } = await ownedTrip(client);
    const pool = poolFor(schema), key = randomUUID();
    const api = endpoint(client, pool);
    try {
      await client.query("ALTER TABLE day_plans ADD CONSTRAINT simulate_save_failure CHECK (false)");
      assert.equal((await api.post(id, owner, key)).status, 500);
      assert.equal((await client.query('SELECT id FROM itineraries WHERE trip_id = $1', [id])).rowCount, 0);
      await client.query('ALTER TABLE day_plans DROP CONSTRAINT simulate_save_failure');
      const result = await successful(await api.post(id, owner, key));
      const counts = api.calls();
      assert.deepEqual(await successful(await api.post(id, owner, key)), result);
      assert.deepEqual(api.calls(), counts);
    } finally { await pool.end(); }
  });
});

test('T27 over-capacity and conflict responses retain their original diagnostics on replay', async () => {
  await withDatabase(async (client, schema) => {
    await migrate(client);
    const { id, owner } = await ownedTrip(client);
    const pool = poolFor(schema);
    const api = endpoint(client, pool);
    try {
      await client.query('UPDATE trip_places SET duration_minutes = 300 WHERE trip_id = $1', [id]);
      const overKey = randomUUID();
      const over = await successful(await api.post(id, owner, overKey));
      assert.equal(over.status, 'OVER_CAPACITY');
      assert.ok(over.capacity.unplaced.length > 0);

      await client.query(`UPDATE trip_places SET duration_minutes = 90, fixed_date = '2026-12-02', fixed_time = '19:00'
        WHERE trip_id = $1 AND priority = 'REQUIRED'`, [id]);
      const conflictKey = randomUUID();
      const conflict = await successful(await api.post(id, owner, conflictKey));
      assert.equal(conflict.status, 'CONFLICT');
      const counts = api.calls();
      assert.deepEqual(await successful(await api.post(id, owner, overKey)), over);
      assert.deepEqual(await successful(await api.post(id, owner, conflictKey)), conflict);
      assert.deepEqual(api.calls(), counts);
    } finally { await pool.end(); }
  });
});

test('T27 legacy POSTs without a key still create independent itineraries', async () => {
  await withDatabase(async (client, schema) => {
    await migrate(client);
    const { id, owner } = await ownedTrip(client);
    const pool = poolFor(schema);
    const api = endpoint(client, pool);
    try {
      const first = await successful(await api.post(id, owner));
      const second = await successful(await api.post(id, owner));
      assert.equal(first.inputHash, second.inputHash);
      assert.notEqual(first.itineraryId, second.itineraryId);
      const legacy = await client.query('SELECT id FROM itineraries WHERE trip_id = $1 AND request_id IS NULL AND request_result IS NULL', [id]);
      assert.equal(legacy.rowCount, 2);
    } finally { await pool.end(); }
  });
});
