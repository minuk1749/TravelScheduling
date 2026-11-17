import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test } from 'node:test';
import type { PoolClient } from 'pg';
import { migrate, readMigrations } from '../src/lib/migrations';
import { ownedTables, seedTravelGraph, withDatabase } from './helpers/database';

const exec = promisify(execFile);
const history = async (client: PoolClient) => (await client.query(
  'SELECT * FROM schema_migrations ORDER BY version',
)).rows;

async function cli(schema: string) {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL is required');
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.set('options', `-csearch_path=${schema}`);
  const { stdout } = await exec('npm', ['run', 'migrate', '--silent'], {
    env: { ...process.env, DATABASE_URL: url.toString() },
    timeout: 30_000,
  });
  return JSON.parse(stdout) as { applied: string[]; baselined: string[] };
}

test('npm run migrate prepares an empty DB schema in order and a second run changes nothing', async () => {
  await withDatabase(async (client, schema) => {
    const names = (await readMigrations()).map(migration => migration.name);
    assert.deepEqual(await cli(schema), { applied: names, baselined: [] });
    const before = await history(client);
    assert.deepEqual(before.map(row => row.version), names);
    assert.ok(before.every(row => /^[a-f0-9]{64}$/.test(row.checksum) && row.origin === 'applied'));
    const ids = await seedTravelGraph(client);
    const tripBefore = (await client.query('SELECT * FROM trips WHERE id = $1', [ids.trip])).rows;
    assert.deepEqual(await cli(schema), { applied: [], baselined: [] });
    assert.deepEqual(await history(client), before);
    assert.deepEqual((await client.query('SELECT * FROM trips WHERE id = $1', [ids.trip])).rows, tripBefore);
  });
});

for (const count of [1, 2, 3]) {
  test(`npm run migrate adopts legacy 001–00${count} and preserves every existing value`, async () => {
    await withDatabase(async (client, schema) => {
      const migrations = await readMigrations();
      // Raw SQL is only used here to model installations predating the runner.
      for (const migration of migrations.slice(0, count)) await client.query(migration.sql);
      await seedTravelGraph(client, count > 1);
      const tables = count === 1 ? ['users', 'trips'] : [...ownedTables, 'places', 'city_profiles'];
      const before = new Map<string, Record<string, unknown>[]>();
      for (const table of tables) {
        before.set(table, (await client.query(`SELECT to_jsonb(t) AS row FROM ${table} t`)).rows.map(row => row.row));
      }
      assert.deepEqual(await cli(schema), {
        applied: migrations.slice(count).map(migration => migration.name),
        baselined: migrations.slice(0, count).map(migration => migration.name),
      });
      for (const table of tables) {
        const after = (await client.query(`SELECT to_jsonb(t) AS row FROM ${table} t`)).rows.map(row => row.row);
        const old = before.get(table)!;
        assert.equal(after.length, old.length, table);
        for (let index = 0; index < old.length; index++) {
          for (const key of Object.keys(old[index])) assert.deepEqual(after[index][key], old[index][key], `${table}.${key}`);
        }
      }
      const appliedHistory = await history(client);
      assert.deepEqual(appliedHistory.map(row => row.origin), migrations.map((_, index) => index < count ? 'baseline' : 'applied'));
      assert.deepEqual(await cli(schema), { applied: [], baselined: [] });
      assert.deepEqual(await history(client), appliedHistory);
      assert.equal((await client.query("SELECT 1 FROM pg_namespace WHERE nspname LIKE 'migration_baseline_%'")).rowCount, 0);
    });
  });
}

test('tracked prefixes apply only remaining files; failed DDL, data and history all roll back and retry succeeds', async () => {
  await withDatabase(async client => {
    const migrations = await readMigrations();
    await migrate(client, migrations.slice(0, 3));
    const ids = await seedTravelGraph(client);
    const before = await history(client);
    const broken = { name: `${String(migrations.length + 1).padStart(3, '0')}_failure.sql`, sql: `CREATE TABLE rollback_probe (id integer);
      UPDATE users SET email = 'changed@example.test'; SELECT * FROM missing_migration_table;` };
    await assert.rejects(migrate(client, [...migrations, broken]), /missing_migration_table/);
    assert.deepEqual(await history(client), before);
    assert.equal((await client.query("SELECT to_regclass('rollback_probe') AS table")).rows[0].table, null);
    assert.equal((await client.query(`SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'trips' AND column_name = 'created_at'`)).rowCount, 0);
    assert.equal((await client.query('SELECT email FROM users WHERE id = $1', [ids.user])).rows[0].email, 'legacy@example.test');
    const fixed = { ...broken, sql: 'CREATE TABLE rollback_probe (id integer);' };
    assert.deepEqual(await migrate(client, [...migrations, fixed]), {
      applied: [...migrations.slice(3).map(migration => migration.name), fixed.name], baselined: [],
    });
    assert.equal((await history(client)).length, migrations.length + 1);
  });
});

test('failure on a fresh schema also rolls back the history table', async () => {
  await withDatabase(async client => {
    await assert.rejects(migrate(client, [{ name: '001_broken.sql', sql: 'CREATE TABLE probe (id int); SELECT 1 / 0;' }]), /division by zero/);
    assert.equal((await client.query("SELECT count(*)::int AS count FROM pg_tables WHERE schemaname = current_schema()")).rows[0].count, 0);
    assert.equal((await migrate(client)).applied.length, (await readMigrations()).length);
  });
});

test('partial legacy schemas are rejected without registering a guessed baseline', async () => {
  await withDatabase(async client => {
    const migrations = await readMigrations();
    for (const migration of migrations.slice(0, 3)) await client.query(migration.sql);
    await client.query('ALTER TABLE flights DROP CONSTRAINT flights_airport_place_id_fkey');
    await assert.rejects(migrate(client), /Unrecognized legacy schema/);
    assert.equal((await client.query("SELECT to_regclass('schema_migrations') AS table")).rows[0].table, null);
    assert.equal((await client.query("SELECT count(*)::int AS count FROM pg_tables WHERE schemaname = current_schema()")).rows[0].count, 12);
  });
});

test('changed, missing, duplicate, or out-of-order migration history is rejected', async () => {
  await withDatabase(async client => {
    const migrations = await readMigrations();
    await migrate(client);
    const before = await history(client);
    await assert.rejects(migrate(client, [{ ...migrations[0], sql: migrations[0].sql + '\n-- changed' }, ...migrations.slice(1)]), /mismatch/);
    await assert.rejects(migrate(client, migrations.slice(0, 3)), /mismatch/);
    await assert.rejects(migrate(client, [...migrations, migrations[3]]), /unique, consecutive/);
    assert.deepEqual(await history(client), before);
    await client.query('DELETE FROM schema_migrations WHERE version = $1', [migrations[1].name]);
    await assert.rejects(migrate(client), /mismatch/);
  });
});

test('concurrent runners serialize and apply each migration once', async () => {
  await withDatabase(async (client, schema, pool) => {
    const second = await pool.connect();
    try {
      await second.query(`SET search_path TO ${schema}`);
      const results = await Promise.all([migrate(client), migrate(second)]);
      const names = (await readMigrations()).map(migration => migration.name);
      assert.deepEqual(results.flatMap(result => result.applied), names);
      assert.equal((await history(client)).length, names.length);
    } finally {
      second.release();
    }
  });
});

test('migration CLI exits unsuccessfully for invalid configuration', async () => {
  await assert.rejects(exec('npm', ['run', 'migrate', '--silent'], {
    env: { ...process.env, DATABASE_URL: '' }, timeout: 30_000,
  }), error => {
    assert.ok(error instanceof Error && 'code' in error && 'stderr' in error);
    assert.equal(error.code, 1);
    assert.match(String(error.stderr), /DATABASE_URL must be set/);
    return true;
  });
});
