import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { createDatabasePool } from '../../src/lib/db';

export async function withDatabase(
  run: (client: PoolClient, schema: string, pool: Pool) => Promise<void>,
  connectionString?: string,
): Promise<void> {
  const pool = createDatabasePool(connectionString);
  try {
    const client = await pool.connect();
    const schema = `test_db_${randomUUID().replaceAll('-', '')}`;
    try {
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET search_path TO ${schema}`);
      await run(client, schema, pool);
    } finally {
      await client.query('ROLLBACK');
      await client.query('RESET search_path');
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      client.release();
    }
  } finally {
    await pool.end();
  }
}

export const ownedTables = [
  'users', 'trips', 'day_settings', 'flights', 'lodgings', 'trip_places',
  'itineraries', 'day_plans', 'stops', 'legs',
];

export async function seedTravelGraph(client: PoolClient, full = true) {
  const ids = {
    user: randomUUID(), trip: randomUUID(), place: randomUUID(), tripPlace: randomUUID(),
    itinerary: randomUUID(), day: randomUUID(),
  };
  await client.query(`INSERT INTO users (id, google_id, email, created_at)
    VALUES ($1, $2, 'legacy@example.test', '2020-01-01T00:00:00Z')`, [ids.user, ids.user]);
  await client.query('INSERT INTO trips (id, owner_id) VALUES ($1, $2)', [ids.trip, ids.user]);
  if (!full) return ids;
  await client.query('INSERT INTO places (id, google_place_id) VALUES ($1, $2)', [ids.place, ids.place]);
  await client.query(`INSERT INTO day_settings (trip_id, date, meal_slots)
    VALUES ($1, '2026-11-18', '["LUNCH"]')`, [ids.trip]);
  await client.query(`INSERT INTO flights (id, trip_id, direction, airport_place_id, local_datetime)
    VALUES ($1, $2, 'ARRIVAL', $3, '2026-11-18 08:00')`, [randomUUID(), ids.trip, ids.place]);
  await client.query(`INSERT INTO lodgings (id, trip_id, place_id, check_in, check_out)
    VALUES ($1, $2, $3, '2026-11-18', '2026-11-20')`, [randomUUID(), ids.trip, ids.place]);
  await client.query(`INSERT INTO trip_places (id, trip_id, place_id, kind, duration_minutes, priority)
    VALUES ($1, $2, $3, 'ATTRACTION', 30, 'REQUIRED')`, [ids.tripPlace, ids.trip, ids.place]);
  await client.query(`INSERT INTO itineraries (id, trip_id, input_hash, status)
    VALUES ($1, $2, 'legacy-input', 'OK')`, [ids.itinerary, ids.trip]);
  await client.query(`INSERT INTO day_plans (id, itinerary_id, date)
    VALUES ($1, $2, '2026-11-18')`, [ids.day, ids.itinerary]);
  await client.query(`INSERT INTO stops (id, day_plan_id, trip_place_id, place_id, position)
    VALUES ($1, $2, $3, $4, 0)`, [randomUUID(), ids.day, ids.tripPlace, ids.place]);
  await client.query(`INSERT INTO legs (id, day_plan_id, position, selected_mode)
    VALUES ($1, $2, 0, 'WALK')`, [randomUUID(), ids.day]);
  await client.query(`INSERT INTO city_profiles (city_code, country, currency, source, updated_at)
    VALUES ('TEST', 'Test', 'TST', 'https://example.test/fares', '2020-01-01T00:00:00Z')`);
  return ids;
}
