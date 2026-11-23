import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { createDatabasePool } from '../../../src/lib/db';
import { migrate } from '../../../src/lib/migrations';
import { cityProfile } from '../../fixtures/trip-input';

/**
 * Each e2e run writes only to its own PostgreSQL schema, so running it against a development database (README) never
 * changes that database's rows (for example the real TOKYO fare profile). playwright.config.ts points DATABASE_URL at
 * the run's schema before the Next server and the test workers start; global-setup.ts creates, migrates and drops it.
 */
const SCHEMA_ENV = 'E2E_DATABASE_SCHEMA';
const BASE_URL_ENV = 'E2E_BASE_DATABASE_URL';

export interface IsolatedDatabase { baseUrl: string; schema: string; url: string }

const quoteIdentifier = (value: string) => `"${value.replaceAll('"', '""')}"`;

/**
 * The same database, but every connection resolves unqualified tables only in `schema` (libpq `options`). The existing
 * options are kept verbatim (escaped spaces in a multi-schema search_path included) and the run's setting is appended:
 * PostgreSQL applies `-c` switches in order, so the last search_path wins.
 */
export function schemaUrl(baseUrl: string, schema: string): string {
  const url = new URL(baseUrl);
  const options = url.searchParams.get('options')?.trim();
  url.searchParams.set('options', [options, `-c search_path=${schema}`].filter(Boolean).join(' '));
  return url.toString();
}

/**
 * Idempotent: the runner process picks the schema once, and the workers (which reload the config with the runner's
 * environment) keep it. Afterwards DATABASE_URL names the run's schema; the original URL stays in E2E_BASE_DATABASE_URL.
 */
export function isolateDatabase(env: Record<string, string | undefined> = process.env): IsolatedDatabase {
  const baseUrl = env[BASE_URL_ENV] ?? env.DATABASE_URL;
  if (!baseUrl) throw new Error('DATABASE_URL must be set to a PostgreSQL connection string for e2e');
  const schema = env[SCHEMA_ENV] ?? `e2e_${randomUUID().replaceAll('-', '')}`;
  const url = schemaUrl(baseUrl, schema);
  Object.assign(env, { [BASE_URL_ENV]: baseUrl, [SCHEMA_ENV]: schema, DATABASE_URL: url });
  return { baseUrl, schema, url };
}

async function withPool<T>(url: string, run: (pool: Pool) => Promise<T>): Promise<T> {
  const pool = createDatabasePool(url);
  try { return await run(pool); } finally { await pool.end(); }
}

/**
 * Creates the schema, checks that the run's URL really resolves to it, applies every migration there and returns the
 * function that drops it again. Only the run's schema is read or written, so the account needs no access to base tables.
 */
export async function createIsolatedSchema({ baseUrl, schema, url }: IsolatedDatabase): Promise<() => Promise<void>> {
  const drop = () => withPool(baseUrl, async pool => { await pool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`); });
  await withPool(baseUrl, pool => pool.query(`CREATE SCHEMA ${quoteIdentifier(schema)}`));
  try {
    await withPool(url, async pool => {
      const client = await pool.connect();
      try {
        const { rows: [target] } = await client.query<{ schema: string | null }>('SELECT current_schema() AS schema');
        if (target.schema !== schema) throw new Error(`e2e DATABASE_URL resolves to schema ${target.schema}, not the run schema ${schema}`);
        await migrate(client);
      } finally { client.release(); }
    });
  } catch (error) {
    await drop();
    throw error;
  }
  return drop;
}

/** Synthetic TOKYO fare profile (tests/fixtures/trip-input.ts), upserted so the e2e schema can price taxis. */
export async function upsertCityProfile(pool: Pool) {
  const p = cityProfile;
  await pool.query(`INSERT INTO city_profiles (city_code, country, currency, transit_coverage, transit_hours, taxi_base_fare, taxi_fare_per_km,
      taxi_fare_per_minute, night_surcharge, night_start, night_end, call_buffer_minutes, efficiency_threshold, ride_hailing_apps, source, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
    ON CONFLICT (city_code) DO UPDATE SET country = EXCLUDED.country, currency = EXCLUDED.currency, transit_coverage = EXCLUDED.transit_coverage,
      transit_hours = EXCLUDED.transit_hours, taxi_base_fare = EXCLUDED.taxi_base_fare, taxi_fare_per_km = EXCLUDED.taxi_fare_per_km,
      taxi_fare_per_minute = EXCLUDED.taxi_fare_per_minute, night_surcharge = EXCLUDED.night_surcharge, night_start = EXCLUDED.night_start,
      night_end = EXCLUDED.night_end, call_buffer_minutes = EXCLUDED.call_buffer_minutes, efficiency_threshold = EXCLUDED.efficiency_threshold,
      ride_hailing_apps = EXCLUDED.ride_hailing_apps, source = EXCLUDED.source, updated_at = EXCLUDED.updated_at`,
  [p.cityCode, p.country, p.currency, p.transitCoverage, p.transitHours, p.taxiBaseFare, p.taxiFarePerKm, p.taxiFarePerMinute,
    p.nightSurcharge, p.nightStart, p.nightEnd, p.callBufferMinutes, p.efficiencyThreshold, JSON.stringify(p.rideHailingApps), p.source, p.updatedAt]);
}
