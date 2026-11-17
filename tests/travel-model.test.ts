import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createDatabasePool } from '../src/lib/db';

test('travel migration preserves existing trips and supports trip settings and cascading deletion', async () => {
  const pool = createDatabasePool();
  const client = await pool.connect();
  const schema = `test_travel_${randomUUID().replaceAll('-', '')}`;
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await client.query(await readFile('migrations/001_auth.sql', 'utf8'));
    const user = randomUUID(), trip = randomUUID(), legacy = randomUUID();
    await client.query('INSERT INTO users (id, google_id, email) VALUES ($1, $2, $3)', [user, 'google', 'user@example.test']);
    await client.query('INSERT INTO trips (id, owner_id) VALUES ($1, $2)', [legacy, user]);
    await client.query(await readFile('migrations/002_travel_model.sql', 'utf8'));
    assert.equal((await client.query('SELECT id FROM trips WHERE id = $1', [legacy])).rowCount, 1);
    await client.query(`INSERT INTO trips (id, owner_id, city_code, time_zone, start_date, end_date,
      default_departure_time, default_return_time, default_meal_slots, meal_windows, taxi_policy)
      VALUES ($1, $2, 'TYO', 'Asia/Tokyo', '2026-04-01', '2026-04-03', '09:00', '21:00',
      '["LUNCH", "DINNER"]', '{"LUNCH": ["11:30", "14:00"]}', 'WHEN_NEEDED')`, [trip, user]);
    const created = await client.query('SELECT city_code, time_zone, default_meal_slots FROM trips WHERE id = $1', [trip]);
    assert.deepEqual(created.rows[0], { city_code: 'TYO', time_zone: 'Asia/Tokyo', default_meal_slots: ['LUNCH', 'DINNER'] });
    const upsert = `INSERT INTO day_settings (trip_id, date, departure_time, meal_slots) VALUES ($1, $2, $3, $4)
      ON CONFLICT (trip_id, date) DO UPDATE SET departure_time = EXCLUDED.departure_time, meal_slots = EXCLUDED.meal_slots`;
    await client.query(upsert, [trip, '2026-04-02', '10:00', JSON.stringify(['LUNCH'])]);
    await client.query(upsert, [trip, '2026-04-02', '11:00', JSON.stringify(['DINNER'])]);
    const settings = await client.query('SELECT departure_time, meal_slots FROM day_settings WHERE trip_id = $1', [trip]);
    assert.deepEqual(settings.rows, [{ departure_time: '11:00:00', meal_slots: ['DINNER'] }]);
    const place = randomUUID(), tripPlace = randomUUID();
    await client.query('INSERT INTO places (id, google_place_id) VALUES ($1, $2)', [place, 'shared-place']);
    await client.query(`INSERT INTO flights (id, trip_id, direction, airport_place_id, local_datetime)
      VALUES ($1, $2, 'ARRIVAL', $3, '2026-04-01T08:00')`, [randomUUID(), trip, place]);
    await client.query(`INSERT INTO lodgings (id, trip_id, place_id, check_in, check_out)
      VALUES ($1, $2, $3, '2026-04-01', '2026-04-03')`, [randomUUID(), trip, place]);
    await client.query(`INSERT INTO trip_places (id, trip_id, place_id, kind, duration_minutes, priority)
      VALUES ($1, $2, $3, 'ATTRACTION', 30, 'REQUIRED')`, [tripPlace, trip, place]);
    const itinerary = randomUUID(), day = randomUUID();
    await client.query("INSERT INTO itineraries (id, trip_id, input_hash, status) VALUES ($1, $2, 'hash', 'OK')", [itinerary, trip]);
    await client.query("INSERT INTO day_plans (id, itinerary_id, date) VALUES ($1, $2, '2026-04-02')", [day, itinerary]);
    await client.query(`INSERT INTO stops (id, day_plan_id, trip_place_id, place_id, position)
      VALUES ($1, $2, $3, $4, 0)`, [randomUUID(), day, tripPlace, place]);
    await client.query("INSERT INTO legs (id, day_plan_id, position, selected_mode) VALUES ($1, $2, 0, 'WALK')", [randomUUID(), day]);
    await client.query('DELETE FROM users WHERE id = $1', [user]);
    for (const table of ['trips', 'day_settings', 'flights', 'lodgings', 'trip_places', 'itineraries', 'day_plans', 'stops', 'legs']) {
      assert.equal((await client.query(`SELECT 1 FROM ${table}`)).rowCount, 0, table);
    }
    assert.deepEqual((await client.query('SELECT id FROM places')).rows, [{ id: place }]);
  } finally {
    await client.query('RESET search_path');
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    client.release();
    await pool.end();
  }
});

test('city profile migration stores night hours and fare provenance', async () => {
  const pool = createDatabasePool();
  const client = await pool.connect();
  const schema = `test_city_${randomUUID().replaceAll('-', '')}`;
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    for (const migration of ['001_auth.sql', '002_travel_model.sql', '003_city_profile_night_hours.sql']) {
      await client.query(await readFile(`migrations/${migration}`, 'utf8'));
    }
    await client.query(`INSERT INTO city_profiles
      (city_code, country, currency, taxi_base_fare, taxi_fare_per_km, taxi_fare_per_minute,
       night_surcharge, night_start, night_end, source, updated_at)
      VALUES ('TEST', 'Test', 'TST', 100, 20, 2, 0.2, '22:00', '05:00', 'https://example.test/fares', '2026-11-18T00:00:00Z')`);
    const result = await client.query('SELECT night_start, night_end, source, updated_at FROM city_profiles WHERE city_code = $1', ['TEST']);
    assert.deepEqual(result.rows[0], {
      night_start: '22:00:00', night_end: '05:00:00', source: 'https://example.test/fares', updated_at: new Date('2026-11-18T00:00:00Z'),
    });
  } finally {
    await client.query('RESET search_path');
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    client.release();
    await pool.end();
  }
});
