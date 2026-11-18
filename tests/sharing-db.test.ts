import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Pool } from 'pg';
import { migrate } from '../src/lib/migrations';
import { PostgresShareRepository } from '../src/repositories/sharing';
import { insertTrip } from '../src/repositories/trip-inputs';
import { loadTripInputs } from '../src/repositories/trip-snapshot';
import { saveItinerary } from '../src/repositories/itineraries';
import { SharingService, hashShareToken } from '../src/services/sharing';
import { FixturePlaces, sampleTrip } from './fixtures/itinerary';
import { service } from './helpers/itinerary-service';
import { withDatabase } from './helpers/database';

test('T14 SQL: owner-only atomic rotation, persisted latest read, stale/legacy guard, isolation and cascade', async () => {
  await withDatabase(async (client, schema) => {
    await migrate(client);
    const owner = randomUUID(), visitor = randomUUID();
    for (const id of [owner, visitor]) await client.query("INSERT INTO users (id, google_id, email) VALUES ($1, $2, 'share@example.test')", [id, id]);
    const input = sampleTrip();
    const draft = { ...input,
      flights: input.flights.map(f => ({ ...f, googlePlaceId: f.airport.googlePlaceId })),
      lodgings: input.lodgings.map(l => ({ ...l, googlePlaceId: l.place.googlePlaceId })),
      visits: input.visits.map(v => ({ ...v, googlePlaceId: v.place.googlePlaceId })),
    };
    const trip = await insertTrip(client, owner, draft);
    const otherTrip = await insertTrip(client, visitor, draft);
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema}`, max: 3 });
    try {
      const repo = new PostgresShareRepository(pool), sharing = new SharingService(repo, () => new FixturePlaces());
      const first = await sharing.rotate(trip, owner); assert.ok(first);
      assert.equal((await client.query('SELECT share_token FROM trips WHERE id = $1', [trip])).rows[0].share_token, hashShareToken(first));
      assert.equal(await repo.load(hashShareToken(first)), 'UNAVAILABLE');
      assert.equal(await sharing.rotate(trip, visitor), null);
      assert.equal(await sharing.rotate(randomUUID(), owner), null);
      assert.equal((await client.query('SELECT share_token FROM trips WHERE id = $1', [otherTrip])).rows[0].share_token, null);
      const save = async () => {
        const loaded = await loadTripInputs(client, trip); assert.ok(loaded?.status === 'READY');
        const result = await service().service.compute(loaded.input);
        const saved = await saveItinerary(client, trip, loaded.inputHash, result); assert.equal(saved.status, 'SAVED');
        return result;
      };
      const original = await save();
      const shared = await sharing.read(first); assert.ok(shared);
      assert.equal(shared.result.status, 'OK');
      assert.deepEqual(shared.result.efficiency, original.efficiency);
      assert.deepEqual(shared.result.capacity.time, original.capacity.time);
      assert.deepEqual(shared.result.capacity.recommendation?.requiredVisitIds, original.capacity.recommendation?.requiredVisitIds);
      const normalize = (value: unknown) => JSON.parse(JSON.stringify(value).replace(/\.000Z/g, 'Z'));
      assert.deepEqual(normalize(shared.result.capacity.recommendation?.schedule.days), normalize(original.capacity.recommendation?.schedule.days));
      const sorted = (value: typeof original.comparisons) => [...value].sort((a, b) => `${a.date}:${a.departure}:${a.from}`.localeCompare(`${b.date}:${b.departure}:${b.from}`));
      // The storage derives selected duration from the saved instants (millisecond rounding).
      for (const [index, leg] of sorted(shared.result.comparisons).entries()) {
        const expected = sorted(original.comparisons)[index];
        assert.ok(Math.abs(leg.selected.minutes - expected.selected.minutes) < 0.00002);
        assert.deepEqual(leg.alternatives, expected.alternatives);
        assert.deepEqual(leg.baseline, expected.baseline);
      }
      const second = await sharing.rotate(trip, owner); assert.ok(second && second !== first);
      assert.equal(await sharing.read(first), null);
      assert.ok(await sharing.read(second));
      // Concurrent rotations leave exactly one active capability, never two valid links.
      const tokens = await Promise.all([sharing.rotate(trip, owner), sharing.rotate(trip, owner)]);
      const active = await Promise.all(tokens.map(token => repo.isActive(hashShareToken(token!))));
      assert.equal(active.filter(Boolean).length, 1);
      const token = tokens[active.indexOf(true)]!;
      await client.query('UPDATE trip_places SET duration_minutes = 300 WHERE trip_id = $1', [trip]);
      assert.equal(await repo.load(hashShareToken(token)), 'UNAVAILABLE', 'old result cannot be mixed with edited inputs');
      const over = await save(); assert.equal(over.status, 'OVER_CAPACITY');
      const overRead = await sharing.read(token); assert.equal(overRead?.result.status, 'OVER_CAPACITY');
      assert.deepEqual(overRead?.result.capacity.unplaced, over.capacity.unplaced);
      await client.query(`UPDATE trip_places tp SET fixed_date = '2026-12-02', fixed_time = '19:00'
        FROM places p WHERE tp.place_id = p.id AND tp.trip_id = $1 AND p.google_place_id = 'sample-sensoji'`, [trip]);
      const conflict = await save(); assert.equal(conflict.status, 'CONFLICT');
      const conflictRead = await sharing.read(token); assert.equal(conflictRead?.result.status, 'CONFLICT');
      assert.equal(conflictRead?.result.capacity.recommendation, null);
      assert.deepEqual(conflictRead?.result.capacity.issues, conflict.capacity.issues);
      // Legacy data is not silently treated as a usable result.
      await client.query("UPDATE itineraries SET details = '{}' WHERE trip_id = $1", [trip]);
      assert.equal(await repo.load(hashShareToken(token)), 'UNAVAILABLE');
      await client.query('DELETE FROM users WHERE id = $1', [owner]);
      assert.equal(await sharing.read(token), null);
      assert.equal((await client.query('SELECT 1 FROM trips WHERE id = $1', [otherTrip])).rowCount, 1);
    } finally { await pool.end(); }
  });
});
