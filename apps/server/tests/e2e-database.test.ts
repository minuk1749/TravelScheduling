import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import type { PoolClient } from 'pg';
import { createDatabasePool } from '../src/lib/db';
import { migrate, readMigrations } from '../src/lib/migrations';
import { cityProfile } from './fixtures/trip-input';
import { withDatabase } from './helpers/database';
import { schemaUrl, upsertCityProfile, isolateDatabase, openRunDatabase } from './e2e/support/database';
import { setUpRunDatabase } from './e2e/support/global-setup';

/**
 * Valid libpq `options` the run must keep: a multi-schema search_path with an escaped space, another option, and a value
 * that ends the string with an escaped space (trimming it would leave a backslash that swallows the separator).
 */
const APPLICATION_NAME = 'e2e run ';
const baseOptions = (schema: string) =>
  String.raw`-c search_path=${schema},\ public -c statement_timeout=5000 -c application_name=e2e\ run\ `;

function withOptions(connectionString: string, options: string, credentials?: { user: string; password: string }): string {
  const url = new URL(connectionString);
  url.searchParams.set('options', options);
  if (credentials) Object.assign(url, { username: credentials.user, password: credentials.password });
  return url.toString();
}

async function connectionState(url: string) {
  const pool = createDatabasePool(url);
  try {
    const { rows: [row] } = await pool.query<{ schema: string | null; timeout: string; name: string }>(
      "SELECT current_schema() AS schema, current_setting('statement_timeout') AS timeout, current_setting('application_name') AS name");
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

/**
 * Admin preparation: the URL of an account with only README's e2e privilege (database CREATE; not a superuser, no grant
 * option, no CREATEROLE). A superuser bypasses every permission check, so CI's postgres account creates such a login
 * role here and drops it afterwards; any other account already is one and is used as it is, delegating nothing.
 */
async function withE2eAccount(run: (url: string) => Promise<void>) {
  const admin = createDatabasePool();
  try {
    const { rows: [account] } = await admin.query<{ superuser: boolean; database: string }>(
      'SELECT rolsuper AS superuser, current_database() AS database FROM pg_roles WHERE rolname = current_user');
    if (!account.superuser) return await run(process.env.DATABASE_URL!);
    const user = `e2e_account_${randomBytes(8).toString('hex')}`, password = randomBytes(16).toString('hex');
    await admin.query(`CREATE ROLE ${user} LOGIN PASSWORD '${password}'`);
    try {
      await admin.query(`GRANT CREATE ON DATABASE "${account.database.replaceAll('"', '""')}" TO ${user}`);
      const url = new URL(process.env.DATABASE_URL!);
      Object.assign(url, { username: user, password });
      await run(url.toString());
    } finally {
      await admin.query(`DROP OWNED BY ${user}`);
      await admin.query(`DROP ROLE ${user}`);
    }
  } finally { await admin.end(); }
}

test('T25: schemaUrl keeps the existing options verbatim, appends the run search_path and keeps the rest of the URL', () => {
  const base = withOptions('postgres://user:pw@db.test:5432/travel?sslmode=disable', baseOptions('app'));
  const url = new URL(schemaUrl(base, 'e2e_run'));
  assert.equal(url.searchParams.get('options'), `${baseOptions('app')} -c search_path=e2e_run`, 'the trailing escaped space is kept');
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
    assert.deepEqual(await connectionState(baseUrl), { schema: defaultSchema, timeout: '5s', name: APPLICATION_NAME }, 'the original URL is valid');

    const env: Record<string, string | undefined> = { DATABASE_URL: baseUrl };
    const teardown = await setUpRunDatabase(env);
    const schema = env.E2E_DATABASE_SCHEMA!;
    try {
      assert.deepEqual(await connectionState(env.DATABASE_URL!), { schema, timeout: '5s', name: APPLICATION_NAME },
        'the run schema applies and the original options keep their values');
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
  await withE2eAccount(url => withDatabase(async (client, defaultSchema) => {
    await seedBaseTokyo(client);
    // The account owns the base tables but has revoked its own privileges on them, so it can see them but not read them.
    await client.query(`REVOKE ALL ON ALL TABLES IN SCHEMA ${defaultSchema} FROM CURRENT_USER`);
    const baseUrl = withOptions(url, `-c search_path=${defaultSchema}`);
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
    await client.query(`GRANT SELECT ON ALL TABLES IN SCHEMA ${defaultSchema} TO CURRENT_USER`);
    await assertBaseTokyoKept(client);
    await assertSchemaDropped(client, env.E2E_DATABASE_SCHEMA!);
  }, url));
});

/** Playwright's beforeAll/afterAll, run in order and stopping at the first failure as Playwright does. */
function suiteHooks() {
  const before: Array<() => Promise<void>> = [], after: Array<() => Promise<void>> = [];
  return {
    hooks: { beforeAll: (run: () => Promise<void>) => { before.push(run); }, afterAll: (run: () => Promise<void>) => { after.push(run); } },
    async runSuite() {
      try { for (const run of before) await run(); } finally { for (const run of after) await run(); }
    },
  };
}

test('T25: when a spec reaches the wrong schema it stops before writing and its cleanup deletes nothing there', async () => {
  await withDatabase(async (client, defaultSchema) => {
    // Another schema with a TOKYO profile and a user with the journey's Google ID: the run must leave both alone.
    await seedBaseTokyo(client);
    await client.query("INSERT INTO users (id, google_id, email) VALUES (gen_random_uuid(), 'e2e-google-traveler', 'kept@example.test')");
    const url = withOptions(process.env.DATABASE_URL!, `-c search_path=${defaultSchema}`);

    const wrong = suiteHooks();
    const pool = openRunDatabase(wrong.hooks, upsertCityProfile, { url, schema: 'e2e_some_other_run' });
    await assert.rejects(wrong.runSuite(), new RegExp(`resolves to schema ${defaultSchema}, not the run schema e2e_some_other_run`));
    assert.equal(pool.ended, true, 'the pool is closed even though setup failed');
    const { rows } = await client.query("SELECT email FROM users WHERE google_id = 'e2e-google-traveler'");
    assert.deepEqual(rows, [{ email: 'kept@example.test' }], 'the user with the same Google ID in the other schema is kept');
    await assertBaseTokyoKept(client);

    const right = suiteHooks();
    openRunDatabase(right.hooks, upsertCityProfile, { url, schema: defaultSchema });
    await right.runSuite();
    const { rows: [written] } = await client.query("SELECT source FROM city_profiles WHERE city_code = 'TOKYO'");
    assert.equal(written.source, cityProfile.source, 'on the run schema the prepare step runs after the check');
  });
});
