import type { PoolClient } from 'pg';
import type { LivingSettings } from '../settings/model';

export async function upsertDaySettings(client: PoolClient, tripId: string, days: LivingSettings['days']) {
  if (!days.length) return;
  await client.query(`INSERT INTO day_settings (trip_id,date,departure_time,return_time,meal_slots)
    SELECT $1, date, departure_time, return_time, NULLIF(meal_slots, 'null'::jsonb)
    FROM jsonb_to_recordset($2::jsonb) AS d(date date, departure_time time, return_time time, meal_slots jsonb) WHERE true
    ON CONFLICT (trip_id, date) DO UPDATE SET departure_time=EXCLUDED.departure_time,
      return_time=EXCLUDED.return_time, meal_slots=EXCLUDED.meal_slots`,
  [tripId, JSON.stringify(days.map(day => ({
    date: day.date, departure_time: day.departureTime, return_time: day.returnTime, meal_slots: day.mealSlots,
  })))]);
}
