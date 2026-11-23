import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Pool } from 'pg';
import type { LegShape } from '@travel/core/contracts/route-shapes';
import { migrate } from '../src/lib/migrations';
import { PostgresRouteShapeRepository } from '../src/repositories/route-shapes';
import { PostgresShareRepository } from '../src/repositories/sharing';
import { insertTrip } from '../src/repositories/trip-inputs';
import { loadTripInputs } from '../src/repositories/trip-snapshot';
import { saveItinerary } from '../src/repositories/itineraries';
import { routeShapeHandlers } from '../src/route-shapes/http';
import { RouteShapeService } from '../src/services/route-shapes';
import { SharingService } from '../src/services/sharing';
import { FixturePlaces, FixtureTravel, sampleDraft, sampleTrip } from './fixtures/itinerary';
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
      const saved = await saveItinerary(client, trip, hash, result);
      assert.ok(saved.status === 'SAVED');
      const snapshot = await repo.load(trip, owner, hash); assert.ok(snapshot.status === 'READY');
      assert.equal(snapshot.snapshot.itineraryId, saved.itineraryId);
      assert.deepEqual(await repo.load(trip, visitor, hash, saved.itineraryId), { status: 'NOT_FOUND' });
      const otherTrip = await insertTrip(client, owner, sampleDraft());
      const otherInput = await loadTripInputs(client, otherTrip);
      assert.ok(otherInput?.status === 'READY');
      const other = await saveItinerary(client, otherTrip, otherInput.inputHash, await service().service.compute(otherInput.input));
      assert.ok(other.status === 'SAVED');
      assert.deepEqual(await repo.load(trip, owner, hash, other.itineraryId), { status: 'RESULT_UNAVAILABLE' });
      assert.deepEqual(await repo.load(trip, owner, hash, randomUUID()), { status: 'RESULT_UNAVAILABLE' });
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
      assert.deepEqual(await repo.load(trip, owner, hash, saved.itineraryId), { status: 'STALE_INPUT' });
      assert.deepEqual(await repo.load(trip, owner, changed.inputHash), { status: 'STALE_INPUT' }, 'requested=current != stored');
      const newer = await service().service.compute(changed.input);
      const current = await saveItinerary(client, trip, changed.inputHash, newer);
      assert.ok(current.status === 'SAVED');
      assert.equal((await repo.load(trip, owner, changed.inputHash)).status, 'READY');
      assert.deepEqual(await repo.load(trip, owner, hash), { status: 'STALE_INPUT' }, 'never select an older matching result');
      await client.query("UPDATE itineraries SET details = '{}' WHERE id = $1", [current.itineraryId]);
      assert.deepEqual(await repo.load(trip, owner, changed.inputHash), { status: 'RESULT_UNAVAILABLE' });
      assert.deepEqual(await repo.load(trip, owner, changed.inputHash, current.itineraryId), { status: 'RESULT_UNAVAILABLE' });
      await client.query('UPDATE trips SET city_code = NULL WHERE id = $1', [trip]);
      assert.deepEqual(await repo.load(trip, owner, changed.inputHash, current.itineraryId), { status: 'STALE_INPUT' });
    } finally { await pool.end(); }
  });
});

test('T22 shapes reject a superseded itinerary with the same input hash; hash-only and shared reads follow the latest legs', async () => {
  await withDatabase(async (client, schema) => {
    await migrate(client);
    const owner = randomUUID();
    await client.query("INSERT INTO users (id, google_id, email) VALUES ($1, $2, 'map@example.test')", [owner, owner]);
    const trip = await insertTrip(client, owner, sampleDraft(sampleTrip([{ key: 'tsukiji', minutes: 30 }])));
    const loaded = await loadTripInputs(client, trip);
    assert.ok(loaded?.status === 'READY');
    const { input, inputHash } = loaded;
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema}` });
    try {
      const places = new FixturePlaces();
      const shapes = new RouteShapeService(new PostgresRouteShapeRepository(pool), places, {
        shape: async ({ mode }) => ({ encodedPolyline: mode === 'WALK' ? '????' : encodedPolyline }),
      });
      const handlers = routeShapeHandlers({ userId: async () => owner, findOwner: async () => owner, service: () => shapes });
      const read = (itineraryId?: string) => {
        const query = new URLSearchParams({ inputHash });
        if (itineraryId) query.set('itineraryId', itineraryId);
        return handlers.get(new Request(`https://app.example.test/api/trips/${trip}/itinerary/shapes?${query}`), trip);
      };
      const dayLegs = (legs: LegShape[]) => legs.filter(leg => leg.kind === 'DAY');
      const sharing = new SharingService(new PostgresShareRepository(pool), () => places);
      const token = await sharing.rotate(trip, owner);
      assert.ok(token);

      const a = await saveItinerary(client, trip, inputHash, await service().service.compute(input));
      assert.ok(a.status === 'SAVED');
      const first = await read(a.itineraryId);
      assert.equal(first.status, 200);
      const bodyA = await first.json();
      assert.deepEqual(dayLegs(bodyA.legs).map(leg => leg.mode), ['WALK', 'WALK']);
      assert.ok(dayLegs(bodyA.legs).every(leg => leg.shape.status === 'OK' && leg.shape.encodedPolyline === '????'));

      // Only the provider's walking time changes between the two calculations.
      const travel = new FixtureTravel(({ mode }) => mode === 'WALK' ? 3_600 : 0);
      const b = await saveItinerary(client, trip, inputHash, await service({ travel }).service.compute(input));
      assert.ok(b.status === 'SAVED');
      assert.notEqual(a.itineraryId, b.itineraryId);
      const current = await read(b.itineraryId);
      assert.equal(current.status, 200);
      const bodyB = await current.json();
      assert.deepEqual(dayLegs(bodyB.legs), dayLegs(bodyA.legs).map(leg => ({
        ...leg, mode: 'TRANSIT', shape: { status: 'OK', encodedPolyline },
      })));
      const calls = places.locationCalls.length;
      const previous = await read(a.itineraryId);
      const previousBody = await previous.json();
      assert.equal(previous.status, 409, `request for A returned ${JSON.stringify(previousBody)}`);
      assert.equal(previousBody.code, 'RESULT_UNAVAILABLE');
      assert.ok(!('legs' in previousBody));
      assert.equal(places.locationCalls.length, calls);
      assert.equal(bodyA.itineraryId, a.itineraryId);
      assert.equal(bodyA.inputHash, inputHash);
      assert.equal(bodyB.itineraryId, b.itineraryId);
      assert.equal(bodyB.inputHash, inputHash);
      const latest = await read();
      assert.equal(latest.status, 200);
      assert.deepEqual(await latest.json(), bodyB);
      const shared = await sharing.read(token);
      assert.deepEqual(shared?.result.comparisons.filter(leg => leg.kind === 'DAY').map(leg => leg.selected.mode),
        ['TRANSIT', 'TRANSIT']);
    } finally { await pool.end(); }
  });
});
