import { Pool } from 'pg';

// Explicit creation keeps builds independent of database availability.
export function createDatabasePool(connectionString = process.env.DATABASE_URL): Pool {
  if (!connectionString) throw new Error('DATABASE_URL must be set to a PostgreSQL connection string');
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('DATABASE_URL must use PostgreSQL');
  }
  return new Pool({ connectionString, max: 5, connectionTimeoutMillis: 5000 });
}
