import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { TripDraft } from '../trips/input';

/** T10 create-only transaction; input snapshots/updates and itinerary persistence belong to T11/T12. */
export async function insertTrip(client: PoolClient, ownerId: string, input: TripDraft): Promise<string> {
  const tripId = randomUUID();
  await client.query('BEGIN');
  try {
    await client.query(`INSERT INTO trips (id, owner_id, city_code, time_zone, start_date, end_date,
      default_departure_time, default_return_time, default_meal_slots, meal_windows,
      luggage_option, arrival_buffer_minutes, departure_buffer_minutes, taxi_policy)
      VALUES ($1,$2,$3,$4,$5,$6,'09:00','21:00','["LUNCH","DINNER"]',
      '{"BREAKFAST":{"start":"07:30","end":"09:30"},"LUNCH":{"start":"11:30","end":"14:00"},"DINNER":{"start":"17:30","end":"20:30"}}', $7,90,150,$8)`,
    [tripId, ownerId, input.cityCode, input.timeZone, input.startDate, input.endDate, input.luggageOption, input.taxiPolicy]);
    const ids = new Map<string, string>();
    const placeIds = [...input.flights, ...input.lodgings, ...input.visits].map(row => row.googlePlaceId);
    // Stable order prevents competing trip creations taking place locks in opposite orders.
    for (const googleId of [...new Set(placeIds)].sort()) {
      const result = await client.query<{ id: string }>(`INSERT INTO places (id, google_place_id) VALUES ($1,$2)
        ON CONFLICT (google_place_id) DO UPDATE SET google_place_id = EXCLUDED.google_place_id RETURNING id`, [randomUUID(), googleId]);
      ids.set(googleId, result.rows[0].id);
    }
    // Child rows belong only to the new trip, so one set-based insert per table needs no lock ordering.
    // Read order is unchanged: created_at is the transaction start for every row, so loads already order by id.
    await client.query(`INSERT INTO flights (id,trip_id,direction,airport_place_id,local_datetime)
      SELECT id, $1, direction, place_id, local_datetime
      FROM jsonb_to_recordset($2::jsonb) AS r(id uuid, direction text, place_id uuid, local_datetime timestamp)`,
    [tripId, JSON.stringify(input.flights.map(flight => ({ id: randomUUID(), direction: flight.direction,
      place_id: ids.get(flight.googlePlaceId), local_datetime: flight.localDateTime })))]);
    await client.query(`INSERT INTO lodgings (id,trip_id,place_id,check_in,check_out)
      SELECT id, $1, place_id, check_in, check_out FROM jsonb_to_recordset($2::jsonb) AS r(id uuid, place_id uuid, check_in date, check_out date)`,
    [tripId, JSON.stringify(input.lodgings.map(lodging => ({ id: randomUUID(), place_id: ids.get(lodging.googlePlaceId),
      check_in: lodging.checkIn, check_out: lodging.checkOut })))]);
    await client.query(`INSERT INTO trip_places (id,trip_id,place_id,kind,duration_minutes,priority)
      SELECT id, $1, place_id, kind, duration_minutes, priority
      FROM jsonb_to_recordset($2::jsonb) AS r(id uuid, place_id uuid, kind text, duration_minutes integer, priority text)`,
    [tripId, JSON.stringify(input.visits.map(visit => ({ id: randomUUID(), place_id: ids.get(visit.googlePlaceId),
      kind: visit.kind, duration_minutes: visit.minutes, priority: visit.priority === 'WISH' ? 'WISHLIST' : 'REQUIRED' })))]);
    await client.query('COMMIT');
    return tripId;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
}
export function tripInputRepository(pool: Pool) {
  return { async create(ownerId: string, input: TripDraft) {
    const client = await pool.connect();
    try { return await insertTrip(client, ownerId, input); } finally { client.release(); }
  } };
}
