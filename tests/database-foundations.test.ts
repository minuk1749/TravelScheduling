import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { migrate } from '../src/lib/migrations';
import { ownedTables, seedTravelGraph, withDatabase } from './helpers/database';

test('every FK column leads a valid, unconditional index, including nullable/shared-place references', async () => {
  await withDatabase(async client => {
    await migrate(client);
    const { rows } = await client.query<{ table: string; column: string; indexed: boolean }>(`
      SELECT t.relname AS table, a.attname AS column,
        EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.conrelid
          AND i.indkey[0] = a.attnum AND i.indisvalid AND i.indisready
          AND i.indpred IS NULL AND i.indexprs IS NULL) AS indexed
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      CROSS JOIN LATERAL unnest(c.conkey) AS key(attnum)
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = key.attnum
      WHERE c.contype = 'f' AND n.nspname = current_schema()
      ORDER BY t.relname, a.attname`);
    assert.ok(rows.length >= 14, 'The complete travel graph must be inspected');
    assert.deepEqual(rows.filter(row => !row.indexed), []);
  });
});

test('all owned tables have non-null instant timestamps with now() defaults; every update refreshes updated_at', async () => {
  await withDatabase(async client => {
    await migrate(client);
    const { rows: columns } = await client.query(`SELECT table_name, column_name, data_type, is_nullable, column_default
      FROM information_schema.columns WHERE table_schema = current_schema()
      AND table_name = ANY($1::text[]) AND column_name IN ('created_at', 'updated_at')`, [ownedTables]);
    assert.equal(columns.length, ownedTables.length * 2);
    for (const column of columns) {
      assert.equal(column.data_type, 'timestamp with time zone', `${column.table_name}.${column.column_name}`);
      assert.equal(column.is_nullable, 'NO');
      assert.equal(column.column_default, 'now()');
    }
    await client.query('BEGIN');
    const ids = await seedTravelGraph(client);
    for (const table of ownedTables) {
      const { rows: [inserted] } = await client.query(`SELECT created_at,
        created_at = now() AS created_now, updated_at = now() AS updated_now FROM ${table}`);
      // The fixture deliberately preserves the user's known, pre-migration creation time.
      if (table === 'users') assert.equal(inserted.created_at.toISOString(), '2020-01-01T00:00:00.000Z');
      else assert.equal(inserted.created_now, true, table);
      assert.equal(inserted.updated_now, true, table);
      const { rows: [updated] } = await client.query(`UPDATE ${table} SET updated_at = '2000-01-01T00:00:00Z'
        RETURNING created_at, updated_at = statement_timestamp() AS refreshed`);
      assert.equal(updated.refreshed, true, table);
      assert.deepEqual(updated.created_at, inserted.created_at, table);
    }
    const { rows: [place] } = await client.query(`UPDATE places SET name = 'updated'
      RETURNING updated_at = statement_timestamp() AS refreshed`);
    assert.equal(place.refreshed, true);
    // ON CONFLICT is how authentication and day settings already perform writes.
    const { rows: [user] } = await client.query(`INSERT INTO users (id, google_id, email)
      VALUES ($1, $2, 'new@example.test') ON CONFLICT (google_id) DO UPDATE SET email = EXCLUDED.email
      RETURNING id, created_at, updated_at = statement_timestamp() AS refreshed`, [randomUUID(), ids.user]);
    assert.equal(user.id, ids.user);
    assert.equal(user.refreshed, true);
    assert.equal(user.created_at.toISOString(), '2020-01-01T00:00:00.000Z');
    const { rows: [day] } = await client.query(`INSERT INTO day_settings (trip_id, date, meal_slots)
      VALUES ($1, '2026-11-18', '["DINNER"]') ON CONFLICT (trip_id, date)
      DO UPDATE SET meal_slots = EXCLUDED.meal_slots
      RETURNING updated_at = statement_timestamp() AS refreshed`, [ids.trip]);
    assert.equal(day.refreshed, true);
    const { rows: [profile] } = await client.query(`UPDATE city_profiles SET transit_coverage = 'fixture'
      RETURNING updated_at`);
    assert.equal(profile.updated_at.toISOString(), '2020-01-01T00:00:00.000Z', 'Fare-source date must retain its meaning');
    await client.query('COMMIT');
  });
});

test('latest itinerary uses insertion generation per trip even with equal creation times; old snapshots survive', async () => {
  await withDatabase(async client => {
    await migrate(client);
    await client.query('BEGIN');
    const ids = await seedTravelGraph(client);
    const secondTrip = randomUUID();
    await client.query('INSERT INTO trips (id, owner_id) VALUES ($1, $2)', [secondTrip, ids.user]);
    const newest = randomUUID(), other = randomUUID();
    const insert = `INSERT INTO itineraries (id, trip_id, input_hash, status) VALUES ($1, $2, 'new-input', 'CONFLICT')`;
    await client.query(insert, [newest, ids.trip]);
    await client.query(insert, [other, secondTrip]);
    assert.equal((await client.query('SELECT count(DISTINCT created_at)::int AS count FROM itineraries')).rows[0].count, 1);
    const latest = `SELECT id FROM itineraries WHERE trip_id = $1 ORDER BY generation DESC LIMIT 1`;
    assert.deepEqual((await client.query(latest, [ids.trip])).rows, [{ id: newest }]);
    assert.deepEqual((await client.query(latest, [secondTrip])).rows, [{ id: other }]);
    await client.query("UPDATE itineraries SET status = 'OVER_CAPACITY' WHERE id = $1", [ids.itinerary]);
    assert.deepEqual((await client.query(latest, [ids.trip])).rows, [{ id: newest }], 'Editing an older snapshot must not make it newest');
    assert.equal((await client.query('SELECT 1 FROM itineraries')).rowCount, 3);
    assert.equal((await client.query('SELECT 1 FROM day_plans WHERE itinerary_id = $1', [ids.itinerary])).rowCount, 1);
    await client.query('COMMIT');
  });
});
