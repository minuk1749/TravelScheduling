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
    const itinerary = randomUUID(), day = randomUUID();
    await client.query("INSERT INTO itineraries (id, trip_id, input_hash, status) VALUES ($1, $2, 'hash', 'OK')", [itinerary, trip]);
    await client.query("INSERT INTO day_plans (id, itinerary_id, date) VALUES ($1, $2, '2026-04-02')", [day, itinerary]);
    await client.query("INSERT INTO legs (id, day_plan_id, position, selected_mode) VALUES ($1, $2, 0, 'WALK')", [randomUUID(), day]);
    await client.query('DELETE FROM users WHERE id = $1', [user]);
    for (const table of ['trips', 'day_settings', 'itineraries', 'day_plans', 'legs']) {
      assert.equal((await client.query(`SELECT 1 FROM ${table}`)).rowCount, 0, table);
    }
  } finally {
    await client.query('RESET search_path');
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    client.release();
    await pool.end();
  }
});
