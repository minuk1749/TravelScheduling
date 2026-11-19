import type { Pool } from 'pg';
import type { MobileSessionStore } from './ports';

type Queryable = Pick<Pool, 'query'>;

/** `mobile_sessions` SQL (migration 007). The database clock decides expiry. */
export class PostgresMobileSessionStore implements MobileSessionStore {
  /** The pool is resolved per call so importing the composition root never connects. */
  constructor(private readonly db: () => Queryable) {}

  async issue(userId: string, tokenHash: string, expiresAt: string): Promise<void> {
    await this.db().query(`WITH purged AS (DELETE FROM mobile_sessions WHERE user_id = $1 AND expires_at <= now())
      INSERT INTO mobile_sessions (id, user_id, token_hash, expires_at) VALUES (gen_random_uuid(), $1, $2, $3)`,
    [userId, tokenHash, expiresAt]);
  }

  async userIdFor(tokenHash: string): Promise<string | null> {
    const result = await this.db().query<{ user_id: string }>(
      'SELECT user_id FROM mobile_sessions WHERE token_hash = $1 AND expires_at > now()', [tokenHash]);
    return result.rows[0]?.user_id ?? null;
  }

  async revoke(tokenHash: string): Promise<void> {
    await this.db().query('DELETE FROM mobile_sessions WHERE token_hash = $1', [tokenHash]);
  }
}
