import type { Pool, PoolClient } from 'pg';
import type { CityProfileSource, GenerateOutcome, ItineraryRepository, ItineraryResult } from '../services/itinerary/types';
import { cityProfileRepository } from './city-profiles';
import { loadTripInputsConsistently, PostgresItineraryRepository, saveItinerary } from './itineraries';

type Generate = (repository: ItineraryRepository, profiles: CityProfileSource) => Promise<GenerateOutcome>;
type Receipt = { id: string; input_hash: string; request_result: ItineraryResult }
  | { id: null; input_hash: null; request_result: null };

/** The session lock spans provider I/O. The trip row lock is only held by the final save. */
export class PostgresItineraryRequests {
  constructor(private readonly pool: Pool) {}

  async run(tripId: string, ownerId: string, requestId: string | null, generate: Generate): Promise<GenerateOutcome> {
    if (requestId === null) {
      return generate(new PostgresItineraryRepository(this.pool), cityProfileRepository(this.pool));
    }
    const client = await this.pool.connect();
    const lock = [`itinerary:${tripId}:${requestId}`];
    let reusable = false;
    try {
      await client.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', lock);
      try {
        const saved = await this.recover(client, tripId, ownerId, requestId);
        if (saved) return saved;
        // Reads, profile lookup and save use this connection even if all other pool clients are waiting.
        return await generate({
          loadInputs: id => loadTripInputsConsistently(client, id),
          saveItinerary: (id, hash, result) => saveItinerary(client, id, hash, result, { ownerId, requestId }),
        }, cityProfileRepository(client));
      } finally {
        await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', lock);
        reusable = true;
      }
    } finally {
      // On a connection/lock error never return a possibly locked session to the pool.
      client.release(!reusable);
    }
  }

  private async recover(client: PoolClient, tripId: string, ownerId: string, requestId: string): Promise<GenerateOutcome | null> {
    const { rows: [row] } = await client.query<Receipt>(`SELECT i.id, i.input_hash, i.request_result
      FROM trips t LEFT JOIN itineraries i ON i.trip_id = t.id AND i.request_id = $3
      WHERE t.id = $1 AND t.owner_id = $2`, [tripId, ownerId, requestId]);
    if (!row) return { status: 'NOT_FOUND' };
    return row.id ? { status: 'SAVED', itineraryId: row.id, inputHash: row.input_hash, result: row.request_result } : null;
  }
}
