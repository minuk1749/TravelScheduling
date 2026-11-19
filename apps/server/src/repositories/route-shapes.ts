import type { Pool } from 'pg';
import type { RouteShapeRepository, ShapeLoad } from '../route-shapes/model';
import { loadTripInputs } from './trip-snapshot';
import { readSharedResult } from './shared-itinerary';

/** Owner-scoped read-only snapshot; shapes never enter the persistence layer. */
export class PostgresRouteShapeRepository implements RouteShapeRepository {
  constructor(private readonly pool: Pool) {}

  async load(tripId: string, ownerId: string, inputHash: string): Promise<ShapeLoad> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const trip = await client.query('SELECT id FROM trips WHERE id = $1 AND owner_id = $2', [tripId, ownerId]);
      if (!trip.rowCount) return { status: 'NOT_FOUND' };
      const stored = (await client.query<{ input_hash: string }>(
        'SELECT input_hash FROM itineraries WHERE trip_id = $1 ORDER BY generation DESC LIMIT 1', [tripId],
      )).rows[0];
      if (!stored) return { status: 'RESULT_UNAVAILABLE' };
      const loaded = await loadTripInputs(client, tripId);
      if (stored.input_hash !== inputHash || loaded?.status !== 'READY' || loaded.inputHash !== inputHash) {
        return { status: 'STALE_INPUT' };
      }
      const result = await readSharedResult(client, loaded.input, inputHash);
      return result
        ? { status: 'READY', snapshot: { input: loaded.input, comparisons: result.comparisons } }
        : { status: 'RESULT_UNAVAILABLE' };
    } finally {
      try { await client.query('ROLLBACK'); } finally { client.release(); }
    }
  }
}
