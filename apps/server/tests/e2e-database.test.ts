import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import type { PoolClient } from 'pg';
import { createDatabasePool } from '../src/lib/db';
import { migrate, readMigrations } from '../src/lib/migrations';
import { cityProfile } from './fixtures/trip-input';
import { withDatabase } from './helpers/database';
import { schemaUrl, upsertCityProfile, isolateDatabase } from './e2e/support/database';
import { setUpRunDatabase } from './e2e/support/global-setup';

/** A multi-schema search_path with an escaped space plus another option: valid libpq `options` the run must keep. */
const baseOptions = (schema: string) => String.raw`-c search_path=${schema},\ public -c statement_timeout=5000`;

function withOptions(connectionString: string, options: string, credentials?: { user: string; password: string }): string {
  const url = new URL(connectionString);
  url.searchParams.set('options', options);
  if (credentials) Object.assign(url, { username: credentials.user, password: credentials.password });
  return url.toString();
}

async function connectionState(url: string) {
  const pool = createDatabasePool(url);
  try {
    const { rows: [row] } = await pool.query<{ schema: string | null; timeout: string }>(
      "SELECT current_schema() AS schema, current_setting('statement_timeout') AS timeout");
    return row;
  } finally { await pool.end(); }
}

/** Stand-in for a development database's default schema that already has a real TOKYO profile. */
async function seedBaseTokyo(client: PoolClient) {
  await migrate(client);
  await client.query(`INSERT INTO city_profiles (city_code, country, currency, taxi_base_fare, taxi_fare_per_km, source, updated_at)
    VALUES ('TOKYO', 'JP', 'JPY', 500, 400, 'https://example.test/real-tokyo-fares', '2021-04-01T00:00:00Z')`);
}

async function assertBaseTokyoKept(client: PoolClient) {
  const { rows: [base] } = await client.query(
    "SELECT taxi_base_fare::float8 AS fare, source, updated_at = '2021-04-01T00:00:00Z' AS kept FROM city_profiles WHERE city_code = 'TOKYO'");
  assert.deepEqual(base, { fare: 500, source: 'https://example.test/real-tokyo-fares', kept: true }, 'fares, source and updated_at are untouched');
}

async function assertSchemaDropped(client: PoolClient, schema: string) {
  const { rows: [left] } = await client.query('SELECT count(*)::int AS n FROM pg_namespace WHERE nspname = $1', [schema]);
  assert.equal(left.n, 0, 'the run schema is dropped');
}

test('T25: schemaUrl keeps the existing options verbatim, appends the run search_path and keeps the rest of the URL', () => {
  const base = withOptions('postgres://user:pw@db.test:5432/travel?sslmode=disable', baseOptions('app'));
  const url = new URL(schemaUrl(base, 'e2e_run'));
  assert.equal(url.searchParams.get('options'), `${baseOptions('app')} -c search_path=e2e_run`);
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

test('T25: e2e setup connects with the original options, writes TOKYO only to its own schema and drops it', async () => {
  await withDatabase(async (client, defaultSchema) => {
    await seedBaseTokyo(client);
    const baseUrl = withOptions(process.env.DATABASE_URL!, baseOptions(defaultSchema));
    assert.deepEqual(await connectionState(baseUrl), { schema: defaultSchema, timeout: '5s' }, 'the original URL is valid');

    const env: Record<string, string | undefined> = { DATABASE_URL: baseUrl };
    const teardown = await setUpRunDatabase(env);
    const schema = env.E2E_DATABASE_SCHEMA!;
    try {
      assert.deepEqual(await connectionState(env.DATABASE_URL!), { schema, timeout: '5s' }, 'run schema and the other option both apply');
      const pool = createDatabasePool(env.DATABASE_URL);
      try {
        const { rows: [applied] } = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM schema_migrations');
        assert.equal(applied.n, (await readMigrations()).length, 'every migration is applied to the run schema');
        await upsertCityProfile(pool);
        const { rows: [written] } = await pool.query('SELECT taxi_base_fare::float8 AS fare, source FROM city_profiles WHERE city_code = $1', ['TOKYO']);
        assert.deepEqual(written, { fare: cityProfile.taxiBaseFare, source: cityProfile.source });
      } finally { await pool.end(); }
    } finally {
      await teardown();
    }

    await assertBaseTokyoKept(client);
    await assertSchemaDropped(client, schema);
  });
});

test('T25: e2e setup and teardown succeed for an account that may create schemas but cannot read the base tables', async () => {
  await withDatabase(async (client, defaultSchema) => {
    await seedBaseTokyo(client);
    const credentials = { user: `e2e_restricted_${randomBytes(8).toString('hex')}`, password: randomBytes(16).toString('hex') };
    const { rows: [{ database }] } = await client.query<{ database: string }>('SELECT current_database() AS database');
    await client.query(`CREATE ROLE ${credentials.user} LOGIN PASSWORD '${credentials.password}'`);
    try {
      await client.query(`GRANT CREATE ON DATABASE "${database.replaceAll('"', '""')}" TO ${credentials.user}`);
      // The base tables are visible (schema USAGE) but not readable (no table SELECT).
      await client.query(`GRANT USAGE ON SCHEMA ${defaultSchema} TO ${credentials.user}`);
      const baseUrl = withOptions(process.env.DATABASE_URL!, `-c search_path=${defaultSchema}`, credentials);
      const base = createDatabasePool(baseUrl);
      try {
        await assert.rejects(base.query('SELECT * FROM city_profiles'), /permission denied for table city_profiles/, 'precondition: base tables unreadable');
      } finally { await base.end(); }

      const env: Record<string, string | undefined> = { DATABASE_URL: baseUrl };
      const teardown = await setUpRunDatabase(env);
      try {
        assert.equal((await connectionState(env.DATABASE_URL!)).schema, env.E2E_DATABASE_SCHEMA);
      } finally {
        await teardown();
      }
      await assertBaseTokyoKept(client);
      await assertSchemaDropped(client, env.E2E_DATABASE_SCHEMA!);
    } finally {
      await client.query(`DROP OWNED BY ${credentials.user}`);
      await client.query(`DROP ROLE ${credentials.user}`);
    }
  });
});
