import { Pool } from 'pg';

/** Match the lowercase, hyphenated UUID that PostgreSQL returns in public URLs. */
export function canonicalUuidOrNull(id: string): string | null {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id) ? id : null;
}

// Explicit creation keeps builds independent of database availability.
export function createDatabasePool(connectionString = process.env.DATABASE_URL): Pool {
  if (!connectionString) throw new Error('DATABASE_URL must be set to a PostgreSQL connection string');
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('DATABASE_URL must use PostgreSQL');
  }
  return new Pool({ connectionString, max: 5, connectionTimeoutMillis: 5000 });
}
