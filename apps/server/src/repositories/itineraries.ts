import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { ScheduleResult } from '../scheduler';
import type {
  ItineraryRepository, ItineraryResult, SaveOutcome, TripLoad,
} from '../services/itinerary/types';
import { encodeItineraryDetails } from './itinerary-details';
import { loadTripInputs } from './trip-snapshot';

/**
 * Saves one itinerary snapshot. The trip row lock serializes saves (and input writers that lock
 * the trip) and the input hash is recomputed under the lock: changed inputs return STALE and
 * nothing is written. Use a dedicated client without an open transaction.
 */
export async function saveItinerary(
  client: PoolClient, tripId: string, expectedHash: string, result: ItineraryResult,
  request?: { ownerId: string; requestId: string },
): Promise<SaveOutcome> {
  await client.query('BEGIN');
  try {
    const locked = await client.query(
      'SELECT 1 FROM trips WHERE id = $1 AND ($2::uuid IS NULL OR owner_id = $2) FOR UPDATE', [tripId, request?.ownerId],
    );
    const current = locked.rowCount ? await loadTripInputs(client, tripId) : null;
    if (current?.status !== 'READY' || current.inputHash !== expectedHash) {
      await client.query('ROLLBACK');
      return { status: 'STALE' };
    }
    const itineraryId = randomUUID();
    const { capacity } = result;
    const schedule = result.status === 'CONFLICT' ? null : capacity.recommendation?.schedule ?? null;
    await client.query(`INSERT INTO itineraries (id, trip_id, input_hash, status, unplaced, efficiency_summary, details, request_id, request_result)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [
      itineraryId, tripId, expectedHash, result.status, JSON.stringify(capacity.unplaced),
      result.efficiency && JSON.stringify(result.efficiency),
      JSON.stringify(encodeItineraryDetails(result, schedule)),
      request?.requestId, request ? JSON.stringify(result) : null,
    ]);
    if (schedule) await insertSchedule(client, itineraryId, schedule, result, new Map(current.input.visits.map(visit => [visit.id, visit.place.id])));
    await client.query('COMMIT');
    return { status: 'SAVED', itineraryId };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

/** Three set-based inserts instead of one statement per stop/leg. */
async function insertSchedule(
  client: PoolClient, itineraryId: string, schedule: ScheduleResult,
  result: ItineraryResult, visitPlaces: ReadonlyMap<string, string>,
): Promise<void> {
  const days: Record<string, unknown>[] = [], stops: Record<string, unknown>[] = [], legs: Record<string, unknown>[] = [];
  for (const day of schedule.days) {
    const dayId = randomUUID();
    days.push({ id: dayId, itinerary_id: itineraryId, date: day.date });
    day.stops.forEach((stop, position) => stops.push({
      id: randomUUID(), day_plan_id: dayId, position, kind: stop.kind,
      trip_place_id: stop.kind === 'VISIT' ? stop.visitId : null,
      place_id: stop.kind === 'VISIT' ? visitPlaces.get(stop.visitId) : null,
      meal_slot: stop.kind === 'MEAL' ? stop.slot : null,
      arrival_time: stop.start, departure_time: stop.end,
    }));
    const comparisons = result.comparisons.filter(leg => leg.kind === 'DAY' && leg.date === day.date);
    day.legs.forEach((leg, position) => legs.push({
      id: randomUUID(), day_plan_id: dayId, position, selected_mode: leg.mode, user_fixed: leg.fixed,
      alternatives: { baseline: comparisons[position]?.baseline ?? null, options: comparisons[position]?.alternatives ?? {} },
      from_place_id: leg.from, to_place_id: leg.to, departure_time: leg.start, arrival_time: leg.end, fare: leg.fare,
    }));
  }
  await client.query(`INSERT INTO day_plans (id, itinerary_id, date)
    SELECT id, itinerary_id, date FROM jsonb_to_recordset($1::jsonb) AS r(id uuid, itinerary_id uuid, date date)`, [JSON.stringify(days)]);
  await client.query(`INSERT INTO stops (id, day_plan_id, position, kind, trip_place_id, place_id, meal_slot, arrival_time, departure_time)
    SELECT id, day_plan_id, position, kind, trip_place_id, place_id, meal_slot, arrival_time, departure_time
    FROM jsonb_to_recordset($1::jsonb) AS r(id uuid, day_plan_id uuid, position integer, kind text, trip_place_id uuid,
      place_id uuid, meal_slot text, arrival_time timestamptz, departure_time timestamptz)`, [JSON.stringify(stops)]);
  await client.query(`INSERT INTO legs (id, day_plan_id, position, selected_mode, user_fixed, alternatives,
      from_place_id, to_place_id, departure_time, arrival_time, fare)
    SELECT id, day_plan_id, position, selected_mode, user_fixed, alternatives, from_place_id, to_place_id, departure_time, arrival_time, fare
    FROM jsonb_to_recordset($1::jsonb) AS r(id uuid, day_plan_id uuid, position integer, selected_mode text, user_fixed boolean,
      alternatives jsonb, from_place_id uuid, to_place_id uuid, departure_time timestamptz, arrival_time timestamptz, fare numeric)`, [JSON.stringify(legs)]);
}

/** Loads use one REPEATABLE READ snapshot so all rows hash consistently. */
export async function loadTripInputsConsistently(client: PoolClient, tripId: string): Promise<TripLoad | null> {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    return await loadTripInputs(client, tripId);
  } finally {
    await client.query('COMMIT');
  }
}

export class PostgresItineraryRepository implements ItineraryRepository {
  constructor(private readonly pool: Pool) {}

  async loadInputs(tripId: string): Promise<TripLoad | null> {
    return this.withClient(client => loadTripInputsConsistently(client, tripId));
  }

  async saveItinerary(tripId: string, inputHash: string, result: ItineraryResult): Promise<SaveOutcome> {
    return this.withClient(client => saveItinerary(client, tripId, inputHash, result));
  }

  private async withClient<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try { return await run(client); } finally { client.release(); }
  }
}
