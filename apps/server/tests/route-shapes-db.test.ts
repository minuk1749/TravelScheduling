import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Pool } from 'pg';
import { migrate } from '../src/lib/migrations';
import { PostgresRouteShapeRepository } from '../src/repositories/route-shapes';
import { insertTrip } from '../src/repositories/trip-inputs';
import { loadTripInputs } from '../src/repositories/trip-snapshot';
import { saveItinerary } from '../src/repositories/itineraries';
import { RouteShapeService } from '../src/services/route-shapes';
import { FixturePlaces, sampleDraft } from './fixtures/itinerary';
import { encodedPolyline } from './fixtures/route-shapes';
import { service } from './helpers/itinerary-service';
import { withDatabase } from './helpers/database';

test('T19 SQL owner scope, latest saved DAY/AIRPORT legs, all hash mismatches, legacy/missing results, no geometry writes', async () => {
  await withDatabase(async (client, schema) => {
    await migrate(client);
    const owner = randomUUID(), visitor = randomUUID();
    await client.query("INSERT INTO users (id, google_id, email) VALUES ($1, $2, 'shape@example.test')", [owner, owner]);
    const trip = await insertTrip(client, owner, sampleDraft());
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema}`, max: 3 });
    try {
      const repo = new PostgresRouteShapeRepository(pool);
      const loaded = await loadTripInputs(client, trip); assert.ok(loaded?.status === 'READY');
      const hash = loaded.inputHash;
      assert.deepEqual(await repo.load(trip, visitor, hash), { status: 'NOT_FOUND' });
      assert.deepEqual(await repo.load(randomUUID(), owner, hash), { status: 'NOT_FOUND' });
      assert.deepEqual(await repo.load(trip, owner, hash), { status: 'RESULT_UNAVAILABLE' });
      const result = await service().service.compute(loaded.input);
      await saveItinerary(client, trip, hash, result);
      const snapshot = await repo.load(trip, owner, hash); assert.ok(snapshot.status === 'READY');
      const keys = (legs: typeof result.comparisons) => legs.map(leg => [leg.date, leg.kind, leg.from, leg.to,
        leg.selected.mode, new Date(leg.departure).toISOString()].join('|')).sort();
      assert.deepEqual(keys(snapshot.snapshot.comparisons), keys(result.comparisons));
      assert.ok(snapshot.snapshot.comparisons.some(leg => leg.kind === 'AIRPORT'));
      assert.ok(snapshot.snapshot.comparisons.some(leg => leg.kind === 'DAY'));
      assert.deepEqual(await repo.load(trip, owner, 'b'.repeat(64)), { status: 'STALE_INPUT' });

      const savedRows = async () => (await client.query(`SELECT to_jsonb(i) AS row FROM itineraries i WHERE trip_id = $1 ORDER BY generation`, [trip])).rows;
      const before = await savedRows();
      let calls = 0;
      const shapes = new RouteShapeService(repo, new FixturePlaces(), { shape: async () => { calls++; return { encodedPolyline }; } });
      for (let i = 0; i < 2; i++) assert.equal((await shapes.read(trip, owner, hash)).status, 'OK');
      assert.equal(calls, 2 * result.comparisons.length, 'same saved result still fetches new geometry');
      assert.deepEqual(await savedRows(), before, 'no cached geometry or other itinerary mutation');

      await client.query('UPDATE trip_places SET duration_minutes = duration_minutes + 1 WHERE trip_id = $1', [trip]);
      const changed = await loadTripInputs(client, trip); assert.ok(changed?.status === 'READY');
      assert.notEqual(changed.inputHash, hash);
      assert.deepEqual(await repo.load(trip, owner, hash), { status: 'STALE_INPUT' }, 'requested=stored != current');
      assert.deepEqual(await repo.load(trip, owner, changed.inputHash), { status: 'STALE_INPUT' }, 'requested=current != stored');
      const newer = await service().service.compute(changed.input);
      await saveItinerary(client, trip, changed.inputHash, newer);
      assert.equal((await repo.load(trip, owner, changed.inputHash)).status, 'READY');
      assert.deepEqual(await repo.load(trip, owner, hash), { status: 'STALE_INPUT' }, 'never select an older matching result');
      await client.query("UPDATE itineraries SET details = '{}' WHERE trip_id = $1", [trip]);
      assert.deepEqual(await repo.load(trip, owner, changed.inputHash), { status: 'RESULT_UNAVAILABLE' });
    } finally { await pool.end(); }
  });
});
