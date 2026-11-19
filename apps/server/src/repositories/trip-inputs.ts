import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { TripCreation, TripSummary } from '@travel/core/contracts/trips/create';
import { defaultLivingSettings, flightBuffers } from '@travel/core/contracts/settings/defaults';
import { upsertDaySettings } from './day-settings';

/** T10 create-only transaction; input snapshots/updates and itinerary persistence belong to T11/T12. */
export async function insertTrip(client: PoolClient, ownerId: string, input: TripCreation): Promise<string> {
  const tripId = randomUUID();
  const settings = input.settings ?? defaultLivingSettings(input.taxiPolicy);
  await client.query('BEGIN');
  try {
    await client.query(`INSERT INTO trips (id, owner_id, city_code, time_zone, start_date, end_date,
      default_departure_time, default_return_time, default_meal_slots, meal_windows,
      luggage_option, arrival_buffer_minutes, departure_buffer_minutes, taxi_policy)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [tripId, ownerId, input.cityCode, input.timeZone, input.startDate, input.endDate,
      settings.departureTime, settings.returnTime, JSON.stringify(settings.mealSlots), JSON.stringify(settings.mealWindows),
      input.luggageOption, flightBuffers.ARRIVAL, flightBuffers.DEPARTURE, input.taxiPolicy]);
    await upsertDaySettings(client, tripId, settings.days);
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
    await client.query(`INSERT INTO trip_places (id,trip_id,place_id,kind,duration_minutes,priority,fixed_date,fixed_time,fixed_order)
      SELECT id, $1, place_id, kind, duration_minutes, priority, fixed_date, fixed_time, fixed_order
      FROM jsonb_to_recordset($2::jsonb) AS r(id uuid, place_id uuid, kind text, duration_minutes integer,
        priority text, fixed_date date, fixed_time time, fixed_order integer)`,
    [tripId, JSON.stringify(input.visits.map(visit => ({ id: randomUUID(), place_id: ids.get(visit.googlePlaceId),
      kind: visit.kind, duration_minutes: visit.minutes, priority: visit.priority === 'WISH' ? 'WISHLIST' : 'REQUIRED',
      fixed_date: visit.fixedDate, fixed_time: visit.fixedTime, fixed_order: visit.fixedOrder })))]);
    await client.query('COMMIT');
    return tripId;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
}
export function tripInputRepository(pool: Pool) {
  return {
    async create(ownerId: string, input: TripCreation) {
      const client = await pool.connect();
      try { return await insertTrip(client, ownerId, input); } finally { client.release(); }
    },
    async list(ownerId: string): Promise<TripSummary[]> {
      const { rows } = await pool.query<TripSummary>(`SELECT id, city_code AS "cityCode",
        start_date::text AS "startDate", end_date::text AS "endDate"
        FROM trips WHERE owner_id=$1 AND city_code IS NOT NULL AND start_date IS NOT NULL AND end_date IS NOT NULL
        ORDER BY start_date DESC, id`, [ownerId]);
      return rows;
    },
  };
}
