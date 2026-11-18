import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { MealSlot, MealWindows, TimeWindow } from '../scheduler';
import type { TripInputs, TripLoad } from '../services/itinerary/types';

type Db = Pick<Pool | PoolClient, 'query'>;
type Row = Record<string, unknown>;
const SLOTS: readonly MealSlot[] = ['BREAKFAST', 'LUNCH', 'DINNER'];

/** Validates SQL text/JSONB shapes. Each reader records the field and returns undefined on failure. */
class RowReader {
  readonly missing: string[] = [];

  fail(field: string): undefined {
    if (!this.missing.includes(field)) this.missing.push(field);
    return undefined;
  }

  /** PostgreSQL `time::text` → `HH:mm`; nonzero seconds are an input error, not truncated. */
  time(value: unknown, field: string): string | undefined {
    if (typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d:00$/.test(value)) return value.slice(0, 5);
    return this.fail(field);
  }

  optionalTime(value: unknown, field: string): string | null | undefined {
    return value === null ? null : this.time(value, field);
  }

  text<T extends string>(value: unknown, field: string, allowed?: readonly T[]): T | undefined {
    if (typeof value === 'string' && value !== '' && (!allowed || allowed.includes(value as T))) return value as T;
    return this.fail(field);
  }

  minutes(value: unknown, field: string): number | undefined {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : this.fail(field);
  }

  slots(value: unknown, field: string): MealSlot[] | undefined {
    if (Array.isArray(value) && value.every(slot => SLOTS.includes(slot)) && new Set(value).size === value.length) return value;
    return this.fail(field);
  }

  /** Accepts `{start,end}` and the legacy `["11:30","14:00"]` JSONB window shapes. */
  windows(value: unknown, field: string): MealWindows | undefined {
    const record = value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
    const result: Partial<MealWindows> = {};
    for (const slot of SLOTS) {
      const raw = record[slot];
      const [start, end] = Array.isArray(raw) ? raw : [(raw as Row | undefined)?.start, (raw as Row | undefined)?.end];
      const valid = (time: unknown) => typeof time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
      if (!valid(start) || !valid(end)) return this.fail(field);
      result[slot] = { start, end } as TimeWindow;
    }
    return result as MealWindows;
  }
}

export function inputHash(input: TripInputs): string {
  return createHash('sha256').update(`trip-inputs:v1\n${JSON.stringify(input)}`).digest('hex');
}

/**
 * Reads the complete scheduling snapshot. Row order is deterministic so the same stored inputs
 * always hash identically. Returns null when the trip does not exist.
 */
export async function loadTripInputs(db: Db, tripId: string): Promise<TripLoad | null> {
  const trip = (await db.query(`SELECT id, city_code, time_zone, start_date::text AS start_date, end_date::text AS end_date,
    default_departure_time::text AS departure_time, default_return_time::text AS return_time,
    default_meal_slots, meal_windows, luggage_option, arrival_buffer_minutes, departure_buffer_minutes, taxi_policy
    FROM trips WHERE id = $1`, [tripId])).rows[0];
  if (!trip) return null;
  // Sequential: a single client runs one query at a time.
  const days = await db.query(`SELECT date::text AS date, departure_time::text AS departure_time, return_time::text AS return_time, meal_slots
    FROM day_settings WHERE trip_id = $1 ORDER BY date`, [tripId]);
  const flights = await db.query(`SELECT f.direction, to_char(f.local_datetime, 'YYYY-MM-DD"T"HH24:MI:SS.US') AS local, p.id, p.google_place_id
    FROM flights f JOIN places p ON p.id = f.airport_place_id WHERE f.trip_id = $1 ORDER BY f.direction`, [tripId]);
  const lodgings = await db.query(`SELECT l.check_in::text AS check_in, l.check_out::text AS check_out, p.id, p.google_place_id
    FROM lodgings l JOIN places p ON p.id = l.place_id WHERE l.trip_id = $1 ORDER BY l.check_in, l.id`, [tripId]);
  const visits = await db.query(`SELECT tp.id, tp.kind, tp.duration_minutes, tp.priority, tp.fixed_date::text AS fixed_date,
    tp.fixed_time::text AS fixed_time, tp.fixed_order, p.id AS place_id, p.google_place_id
    FROM trip_places tp JOIN places p ON p.id = tp.place_id WHERE tp.trip_id = $1 ORDER BY tp.created_at, tp.id`, [tripId]);
  const read = new RowReader();
  const start = read.time(trip.departure_time, 'activity'), end = read.time(trip.return_time, 'activity');
  const input = {
    id: trip.id as string,
    cityCode: read.text(trip.city_code, 'cityCode'),
    timeZone: read.text(trip.time_zone, 'timeZone'),
    startDate: read.text(trip.start_date, 'startDate'),
    endDate: read.text(trip.end_date, 'endDate'),
    activity: start && end ? { start, end } : undefined,
    mealSlots: read.slots(trip.default_meal_slots, 'mealSlots'),
    mealWindows: read.windows(trip.meal_windows, 'mealWindows'),
    taxiPolicy: read.text(trip.taxi_policy, 'taxiPolicy', ['NEVER', 'WHEN_NEEDED', 'PREFER'] as const),
    luggageOption: read.text(trip.luggage_option, 'luggageOption', ['VIA_LODGING', 'DIRECT_TO_AIRPORT'] as const),
    arrivalBufferMinutes: read.minutes(trip.arrival_buffer_minutes, 'arrivalBufferMinutes'),
    departureBufferMinutes: read.minutes(trip.departure_buffer_minutes, 'departureBufferMinutes'),
    daySettings: days.rows.map(row => {
      const field = `daySettings.${row.date}`;
      return {
        date: row.date as string,
        departureTime: read.optionalTime(row.departure_time, field) ?? null,
        returnTime: read.optionalTime(row.return_time, field) ?? null,
        mealSlots: row.meal_slots === null ? null : read.slots(row.meal_slots, `${field}.mealSlots`) ?? null,
      };
    }),
    flights: flights.rows.map(row => ({
      direction: row.direction as 'ARRIVAL' | 'DEPARTURE',
      airport: { id: row.id as string, googlePlaceId: row.google_place_id as string },
      localDateTime: /:00\.000000$/.test(row.local) ? (row.local as string).slice(0, 16) : read.fail('flights') ?? '',
    })),
    lodgings: lodgings.rows.map(row => ({
      place: { id: row.id as string, googlePlaceId: row.google_place_id as string },
      checkIn: row.check_in as string, checkOut: row.check_out as string,
    })),
    visits: visits.rows.map(row => {
      const fixedTime = row.fixed_time === null ? undefined : read.time(row.fixed_time, `visits.${row.id}`);
      return {
        id: row.id as string,
        place: { id: row.place_id as string, googlePlaceId: row.google_place_id as string },
        kind: row.kind as 'RESTAURANT' | 'ATTRACTION',
        minutes: row.duration_minutes as number,
        priority: row.priority === 'WISHLIST' ? 'WISH' as const : 'REQUIRED' as const,
        ...(row.fixed_date === null ? {} : { fixedDate: row.fixed_date as string }),
        ...(fixedTime === undefined ? {} : { fixedTime }),
        ...(row.fixed_order === null ? {} : { fixedOrder: row.fixed_order as number }),
      };
    }),
  };
  if (read.missing.length) return { status: 'INCOMPLETE', fields: read.missing };
  const ready = input as TripInputs;
  return { status: 'READY', input: ready, inputHash: inputHash(ready) };
}
