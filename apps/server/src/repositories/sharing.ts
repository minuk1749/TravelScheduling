import type { Pool } from 'pg';
import type { ShareRepository, SharedSnapshot } from '../sharing/model';
import { loadTripInputs } from './trip-snapshot';
import { readLatestItinerary, readSharedResult } from './shared-itinerary';

export class PostgresShareRepository implements ShareRepository {
  constructor(private readonly pool: Pool) {}

  async rotate(tripId: string, ownerId: string, tokenHash: string): Promise<boolean> {
    const result = await this.pool.query('UPDATE trips SET share_token = $3 WHERE id = $1 AND owner_id = $2', [tripId, ownerId, tokenHash]);
    return result.rowCount === 1;
  }

  async isActive(tokenHash: string): Promise<boolean> {
    return (await this.pool.query('SELECT 1 FROM trips WHERE share_token = $1', [tokenHash])).rowCount === 1;
  }

  async load(tokenHash: string): Promise<SharedSnapshot | 'UNAVAILABLE' | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const trip = (await client.query<{ id: string }>('SELECT id FROM trips WHERE share_token = $1', [tokenHash])).rows[0];
      if (!trip) return null;
      const loaded = await loadTripInputs(client, trip.id);
      if (loaded?.status !== 'READY') return 'UNAVAILABLE';
      const stored = await readLatestItinerary(client, trip.id);
      if (!stored || stored.input_hash !== loaded.inputHash) return 'UNAVAILABLE';
      const result = await readSharedResult(client, stored, loaded.input.timeZone);
      return result ? { input: loaded.input, result } : 'UNAVAILABLE';
    } finally {
      try { await client.query('ROLLBACK'); } finally { client.release(); }
    }
  }
}
