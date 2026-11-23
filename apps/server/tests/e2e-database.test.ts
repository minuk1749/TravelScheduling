import assert from 'node:assert/strict';
import test from 'node:test';
import { createDatabasePool } from '../src/lib/db';
import { migrate, readMigrations } from '../src/lib/migrations';
import { cityProfile } from './fixtures/trip-input';
import { withDatabase } from './helpers/database';
import { cityProfileRow, createIsolatedSchema, schemaUrl, upsertCityProfile, isolateDatabase } from './e2e/support/database';

test('T25: schemaUrl replaces only the search_path option and keeps the rest of the URL', () => {
  const base = 'postgres://user:pw@db.test:5432/travel?sslmode=disable&options=-c%20statement_timeout%3D5000%20-c%20search_path%3Dold';
  const url = new URL(schemaUrl(base, 'e2e_run'));
  assert.equal(url.searchParams.get('options'), '-c statement_timeout=5000 -c search_path=e2e_run');
  assert.equal(url.searchParams.get('sslmode'), 'disable');
  assert.equal(`${url.username}:${url.password}@${url.host}${url.pathname}`, 'user:pw@db.test:5432/travel');
});

test('T25: the e2e database choice is made once and inherited unchanged (runner → server, workers)', () => {
  const env: Record<string, string | undefined> = { DATABASE_URL: 'postgres://db.test/travel' };
  const first = isolateDatabase(env);
  assert.match(first.schema, /^e2e_[0-9a-f]{32}$/);
  assert.equal(env.DATABASE_URL, first.url);
  assert.equal(new URL(first.url).searchParams.get('options'), `-c search_path=${first.schema}`);
  assert.deepEqual(isolateDatabase({ ...env }), first, 'a worker reloading the config keeps the base URL and schema');
  assert.throws(() => isolateDatabase({}), /DATABASE_URL must be set/);
});

test('T25: e2e writes its TOKYO fare profile only to its own schema and drops it; the base schema row is unchanged', async () => {
  await withDatabase(async (client, defaultSchema) => {
    // Stand-in for a development database's default schema that already has a real TOKYO profile.
    await migrate(client);
    await client.query(`INSERT INTO city_profiles (city_code, country, currency, taxi_base_fare, taxi_fare_per_km, source, updated_at)
      VALUES ('TOKYO', 'JP', 'JPY', 500, 400, 'https://example.test/real-tokyo-fares', '2021-04-01T00:00:00Z')`);
    const baseUrl = schemaUrl(process.env.DATABASE_URL!, defaultSchema);
    const before = await cityProfileRow(baseUrl, 'TOKYO');
    assert.ok(before);

    const database = isolateDatabase({ DATABASE_URL: baseUrl });
    const drop = await createIsolatedSchema(database);
    const pool = createDatabasePool(database.url);
    try {
      assert.equal((await pool.query('SELECT current_schema() AS schema')).rows[0].schema, database.schema);
      const { rows: [applied] } = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM schema_migrations');
      assert.equal(applied.n, (await readMigrations()).length, 'every migration is applied to the run schema');
      await upsertCityProfile(pool);
      const { rows: [written] } = await pool.query('SELECT taxi_base_fare::float8 AS fare, source FROM city_profiles WHERE city_code = $1', ['TOKYO']);
      assert.deepEqual(written, { fare: cityProfile.taxiBaseFare, source: cityProfile.source });
    } finally {
      await pool.end();
      await drop();
    }

    assert.equal(await cityProfileRow(baseUrl, 'TOKYO'), before, 'fares, source and updated_at of the base row are untouched');
    const { rows: [base] } = await client.query(
      "SELECT taxi_base_fare::float8 AS fare, source, updated_at = '2021-04-01T00:00:00Z' AS kept FROM city_profiles WHERE city_code = 'TOKYO'");
    assert.deepEqual(base, { fare: 500, source: 'https://example.test/real-tokyo-fares', kept: true });
    const { rows: [left] } = await client.query('SELECT count(*)::int AS n FROM pg_namespace WHERE nspname = $1', [database.schema]);
    assert.equal(left.n, 0, 'the run schema is dropped');
  });
});
