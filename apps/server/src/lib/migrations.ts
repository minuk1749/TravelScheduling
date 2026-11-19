import { createHash, randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import type { PoolClient } from 'pg';

export interface Migration {
  name: string;
  sql: string;
}

const migrationDirectory = new URL('../../migrations/', import.meta.url);
const legacyNames = ['001_auth.sql', '002_travel_model.sql', '003_city_profile_night_hours.sql'];
const legacyTables = [
  'users', 'trips', 'city_profiles', 'places', 'day_settings', 'flights',
  'lodgings', 'trip_places', 'itineraries', 'day_plans', 'stops', 'legs',
];

const quoteIdentifier = (value: string) => `"${value.replaceAll('"', '""')}"`;
const checksum = (migration: Migration) => createHash('sha256').update(migration.sql).digest('hex');

export async function readMigrations(): Promise<Migration[]> {
  const names = (await readdir(migrationDirectory)).filter(name => name.endsWith('.sql')).sort();
  return Promise.all(names.map(async name => ({
    name, sql: await readFile(new URL(name, migrationDirectory), 'utf8'),
  })));
}

function orderedMigrations(migrations: readonly Migration[]): Migration[] {
  const ordered = [...migrations].sort((a, b) => a.name.localeCompare(b.name));
  ordered.forEach((migration, index) => {
    if (!/^\d{3}_[a-z0-9_]+\.sql$/.test(migration.name) || Number(migration.name.slice(0, 3)) !== index + 1) {
      throw new Error(`Migrations must have unique, consecutive versions starting at 001: ${migration.name}`);
    }
  });
  return ordered;
}

// Compare complete legacy table shapes, not just a marker column. search_path must
// point only to the inspected schema so FK definitions are consistently deparsed.
async function legacyShape(client: PoolClient): Promise<string> {
  const result = await client.query(`
    SELECT t.relname, t.relkind,
      (SELECT jsonb_agg(jsonb_build_array(a.attname, format_type(a.atttypid, a.atttypmod),
          a.attnotnull, pg_get_expr(d.adbin, d.adrelid), a.attidentity, a.attgenerated)
          ORDER BY a.attnum)
       FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
       WHERE a.attrelid = t.oid AND a.attnum > 0 AND NOT a.attisdropped) AS columns,
      (SELECT jsonb_agg(jsonb_build_array(c.conname, pg_get_constraintdef(c.oid, true), c.convalidated)
          ORDER BY c.conname)
       FROM pg_constraint c WHERE c.conrelid = t.oid) AS constraints
    FROM pg_class t JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = current_schema() AND t.relname = ANY($1::text[])
    ORDER BY t.relname`, [legacyTables]);
  return JSON.stringify(result.rows);
}

async function detectLegacyPrefix(client: PoolClient, migrations: readonly Migration[]): Promise<number> {
  const actual = await legacyShape(client);
  if (actual === '[]') return 0;
  const scratch = `migration_baseline_${randomUUID().replaceAll('-', '')}`;
  await client.query('SAVEPOINT legacy_probe');
  let matched = 0;
  try {
    await client.query(`CREATE SCHEMA ${quoteIdentifier(scratch)}`);
    await client.query("SELECT set_config('search_path', $1, true)", [quoteIdentifier(scratch)]);
    for (let index = 0; index < legacyNames.length; index++) {
      const migration = migrations[index];
      if (!migration || migration.name !== legacyNames[index]) break;
      await client.query(migration.sql);
      if (await legacyShape(client) === actual) {
        matched = index + 1;
        break;
      }
    }
  } finally {
    // Removes the probe schema and restores the target search_path, including on error.
    await client.query('ROLLBACK TO SAVEPOINT legacy_probe');
    await client.query('RELEASE SAVEPOINT legacy_probe');
  }
  if (!matched) throw new Error('Unrecognized legacy schema: expected an intact 001–003 prefix; no changes applied');
  return matched;
}

/** Use a dedicated, idle client (no caller transaction). The entire run is atomic. */
export async function migrate(
  client: PoolClient,
  migrations?: readonly Migration[],
): Promise<{ applied: string[]; baselined: string[] }> {
  const ordered = orderedMigrations(migrations ?? await readMigrations());
  const result: { applied: string[]; baselined: string[] } = { applied: [], baselined: [] };
  await client.query('BEGIN');
  try {
    const { rows: [target] } = await client.query<{ schema: string | null }>('SELECT current_schema() AS schema');
    if (!target.schema) throw new Error('Migration target schema does not exist');
    await client.query("SELECT set_config('search_path', $1, true)", [quoteIdentifier(target.schema)]);
    // Serialize runners for this database/schema; COMMIT/ROLLBACK releases the lock.
    await client.query('SELECT pg_advisory_xact_lock(hashtext(current_database()), hashtext($1))',
      [`travel-scheduling:migrations:${target.schema}`]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now(),
      origin text NOT NULL CHECK (origin IN ('applied', 'baseline'))
    )`);
    const { rows: history } = await client.query<{ version: string; checksum: string }>(
      'SELECT version, checksum FROM schema_migrations ORDER BY version',
    );
    history.forEach((entry, index) => {
      const migration = ordered[index];
      if (!migration || migration.name !== entry.version || checksum(migration) !== entry.checksum) {
        throw new Error(`Migration history/file mismatch at ${entry.version}; restore the original files`);
      }
    });
    const baseline = history.length === 0 ? await detectLegacyPrefix(client, ordered) : 0;
    for (let index = history.length; index < ordered.length; index++) {
      const migration = ordered[index];
      const origin = index < baseline ? 'baseline' : 'applied';
      if (origin === 'applied') await client.query(migration.sql);
      await client.query('INSERT INTO schema_migrations (version, checksum, origin) VALUES ($1, $2, $3)',
        [migration.name, checksum(migration), origin]);
      result[origin === 'applied' ? 'applied' : 'baselined'].push(migration.name);
    }
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
