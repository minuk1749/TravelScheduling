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
