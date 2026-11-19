import { randomUUID } from 'node:crypto';
import { createDatabasePool } from '../db';

let pool: ReturnType<typeof createDatabasePool> | undefined;
function db() { return pool ??= createDatabasePool(); }

export async function upsertGoogleUser(googleId: string, email: string): Promise<string> {
  const result = await db().query<{ id: string }>(
    `INSERT INTO users (id, google_id, email) VALUES ($1, $2, $3)
     ON CONFLICT (google_id) DO UPDATE SET email = EXCLUDED.email RETURNING id`,
    [randomUUID(), googleId, email],
  );
  return result.rows[0].id;
}
export async function userExists(id: string): Promise<boolean> {
  const result = await db().query('SELECT 1 FROM users WHERE id = $1', [id]);
  return result.rowCount === 1;
}
export async function deleteUser(id: string): Promise<void> {
  await db().query('DELETE FROM users WHERE id = $1', [id]);
}
export async function tripOwner(id: string): Promise<string | null> {
  const result = await db().query<{ owner_id: string }>('SELECT owner_id FROM trips WHERE id::text = $1', [id]);
  return result.rows[0]?.owner_id ?? null;
}
