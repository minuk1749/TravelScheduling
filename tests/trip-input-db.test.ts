import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { withDatabase } from './helpers/database';
import { migrate } from '../src/lib/migrations';
import { insertTrip } from '../src/repositories/trip-inputs';
import { tripDraft } from './fixtures/trip-input';

test('T10 transaction persists flow 2–5, only Google IDs, defaults and WISH mapping; rolls back failures', async () => {
  await withDatabase(async client => {
    await migrate(client);
    const owner = randomUUID();
    await client.query("INSERT INTO users (id,google_id,email) VALUES ($1,'t10','t10@example.test')", [owner]);
    const tripId = await insertTrip(client, owner, tripDraft);
    const trip = (await client.query(`SELECT *, start_date::text AS start, end_date::text AS finish FROM trips WHERE id=$1`, [tripId])).rows[0];
    assert.equal(trip.owner_id, owner); assert.equal(trip.time_zone, 'Asia/Tokyo'); assert.equal(trip.start, tripDraft.startDate);
    assert.equal(trip.finish, tripDraft.endDate); assert.equal(trip.arrival_buffer_minutes, 90); assert.equal(trip.departure_buffer_minutes, 150);
    assert.equal(trip.luggage_option, 'VIA_LODGING'); assert.equal(trip.taxi_policy, 'WHEN_NEEDED');
    assert.deepEqual(trip.default_meal_slots, ['LUNCH', 'DINNER']); assert.deepEqual(trip.meal_windows.LUNCH, { start: '11:30', end: '14:00' });
    const flights = (await client.query("SELECT direction, to_char(local_datetime, 'YYYY-MM-DD\"T\"HH24:MI') AS local FROM flights WHERE trip_id=$1 ORDER BY direction", [tripId])).rows;
    assert.deepEqual(flights.map(row => row.local), tripDraft.flights.map(row => row.localDateTime));
    assert.equal((await client.query('SELECT * FROM lodgings WHERE trip_id=$1', [tripId])).rowCount, 2);
    const visits = (await client.query('SELECT kind, duration_minutes, priority FROM trip_places WHERE trip_id=$1 ORDER BY kind', [tripId])).rows;
    assert.deepEqual(visits, [{ kind: 'ATTRACTION', duration_minutes: 90, priority: 'REQUIRED' }, { kind: 'RESTAURANT', duration_minutes: 60, priority: 'WISHLIST' }]);
    const places = (await client.query('SELECT * FROM places')).rows; assert.equal(places.length, 5);
    for (const row of places) for (const key of ['name', 'latitude', 'longitude', 'opening_hours', 'types', 'cache_expires_at']) assert.equal(row[key], null);
    const invalid = structuredClone(tripDraft); invalid.visits[0].minutes = 0;
    invalid.lodgings[0].googlePlaceId = 'rolled-back-place';
    await assert.rejects(insertTrip(client, owner, invalid));
    assert.equal((await client.query('SELECT * FROM trips')).rowCount, 1);
    assert.equal((await client.query("SELECT * FROM places WHERE google_place_id='rolled-back-place'")).rowCount, 0);
    await insertTrip(client, owner, tripDraft);
    assert.equal((await client.query('SELECT * FROM places')).rowCount, 5);
  });
});

test('T15A trip creation writes child rows with one statement per table regardless of visit count', async () => {
  await withDatabase(async client => {
    await migrate(client);
    const owner = randomUUID();
    await client.query("INSERT INTO users (id,google_id,email) VALUES ($1,'t15a','t15a@example.test')", [owner]);
    const statements: string[] = [];
    const counting = new Proxy(client, { get(target, key) {
      if (key !== 'query') return Reflect.get(target, key);
      return (text: string, values?: unknown[]) => { statements.push(text); return target.query(text, values); };
    } });
    // Only the ordered place upsert (lock order across concurrent creations) scales with distinct places.
    const visits = Array.from({ length: 30 }, (_, i) => ({ googlePlaceId: `visit-${String(i).padStart(2, '0')}`,
      kind: i % 2 ? 'ATTRACTION' as const : 'RESTAURANT' as const, minutes: 30 + i, priority: i % 3 ? 'REQUIRED' as const : 'WISH' as const }));
    const tripId = await insertTrip(counting, owner, { ...tripDraft, visits });
    const children = statements.filter(text => /INSERT INTO (?:flights|lodgings|trip_places)\b/.test(text));
    assert.equal(children.length, 3);
    assert.equal(statements.filter(text => /INSERT INTO places\b/.test(text)).length, 3 + visits.length);
    const rows = (await client.query(`SELECT p.google_place_id, tp.kind, tp.duration_minutes, tp.priority
      FROM trip_places tp JOIN places p ON p.id = tp.place_id WHERE tp.trip_id = $1 ORDER BY tp.duration_minutes`, [tripId])).rows;
    assert.deepEqual(rows, visits.map(v => ({ google_place_id: v.googlePlaceId, kind: v.kind, duration_minutes: v.minutes,
      priority: v.priority === 'WISH' ? 'WISHLIST' : 'REQUIRED' })));
    const lodgings = (await client.query(`SELECT p.google_place_id, check_in::text, check_out::text FROM lodgings l
      JOIN places p ON p.id = l.place_id WHERE l.trip_id = $1 ORDER BY check_in`, [tripId])).rows;
    assert.deepEqual(lodgings, tripDraft.lodgings.map(l => ({ google_place_id: l.googlePlaceId, check_in: l.checkIn, check_out: l.checkOut })));
    // A day trip has no lodgings: the empty set inserts nothing and does not fail.
    const dayTrip = await insertTrip(client, owner, { ...tripDraft, endDate: tripDraft.startDate, lodgings: [] });
    assert.equal((await client.query('SELECT 1 FROM lodgings WHERE trip_id = $1', [dayTrip])).rowCount, 0);
    assert.equal((await client.query('SELECT 1 FROM trip_places WHERE trip_id = $1', [dayTrip])).rowCount, 2);
  });
});
