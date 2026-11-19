import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { upsertDaySettings } from './day-settings';
import { parseSettings } from '../settings/input';
import { SettingsError, type LivingSettingsStore, type LivingSettings, type SettingsContext, type SettingsSnapshot } from '../settings/model';

const revision = (context: SettingsContext) => createHash('sha256').update(JSON.stringify(context)).digest('hex');
const time = (value: string | null): string | null => {
  if (value === null) return null;
  if (!/^\d{2}:\d{2}:00$/.test(value)) throw new SettingsError(409, '초 단위 설정은 지원하지 않습니다.');
  return value.slice(0, 5);
};
type TripRow = {
  owner_id: string; time_zone: string | null; start_date: string | null; end_date: string | null;
  default_departure_time: string | null; default_return_time: string | null;
  default_meal_slots: unknown; meal_windows: unknown; taxi_policy: string | null;
  arrival_buffer_minutes: number | null; departure_buffer_minutes: number | null;
};

async function readSnapshot(client: PoolClient, id: string, ownerId: string): Promise<SettingsSnapshot> {
  const row = (await client.query<TripRow>(`SELECT owner_id, time_zone, start_date::text, end_date::text,
    default_departure_time::text, default_return_time::text, default_meal_slots, meal_windows,
    taxi_policy, arrival_buffer_minutes, departure_buffer_minutes FROM trips WHERE id::text=$1`, [id])).rows[0];
  if (!row) throw new SettingsError(404, '여행을 찾을 수 없습니다.');
  if (row.owner_id !== ownerId) throw new SettingsError(403, '접근할 수 없습니다.');
  if (!row.time_zone || !row.start_date || !row.end_date || row.arrival_buffer_minutes === null || row.departure_buffer_minutes === null) {
    throw new SettingsError(409, '여행 기본 정보를 먼저 완성해 주세요.');
  }
  const context = { timeZone: row.time_zone, startDate: row.start_date, endDate: row.end_date };
  const overrides = (await client.query<{ date: string; departure_time: string | null; return_time: string | null; meal_slots: unknown }>(
    'SELECT date::text, departure_time::text, return_time::text, meal_slots FROM day_settings WHERE trip_id=$1 ORDER BY date', [id])).rows;
  let settings: LivingSettings;
  try {
    // Legacy JSONB meal windows were [start, end]; normalize before shared validation.
    const windows = row.meal_windows && typeof row.meal_windows === 'object' && !Array.isArray(row.meal_windows)
      ? Object.fromEntries(Object.entries(row.meal_windows).map(([slot, value]) => [slot, Array.isArray(value) && value.length === 2 ? { start: value[0], end: value[1] } : value])) : row.meal_windows;
    settings = parseSettings({ departureTime: time(row.default_departure_time), returnTime: time(row.default_return_time),
      mealSlots: row.default_meal_slots, mealWindows: windows, taxiPolicy: row.taxi_policy,
      days: overrides.map(day => ({ date: day.date, departureTime: time(day.departure_time), returnTime: time(day.return_time), mealSlots: day.meal_slots })),
    }, context);
  } catch { throw new SettingsError(409, '저장된 생활 설정을 해석할 수 없습니다. 여행 입력을 확인해 주세요.'); }
  const flights = (await client.query<{ direction: 'ARRIVAL' | 'DEPARTURE'; local: string }>(
    `SELECT direction, to_char(local_datetime, 'YYYY-MM-DD"T"HH24:MI:SS') AS local FROM flights WHERE trip_id=$1 ORDER BY direction`, [id])).rows;
  const fixed = (await client.query<{ id: string; date: string | null; time: string | null; fixed_order: number | null; duration_minutes: number }>(
    `SELECT id, fixed_date::text AS date, fixed_time::text AS time, fixed_order, duration_minutes FROM trip_places
     WHERE trip_id=$1 AND (fixed_date IS NOT NULL OR fixed_time IS NOT NULL OR fixed_order IS NOT NULL) ORDER BY id`, [id])).rows;
  const result: SettingsContext = { ...context, settings,
    flights: flights.map(flight => ({ direction: flight.direction, localDateTime: flight.local, bufferMinutes: flight.direction === 'ARRIVAL' ? row.arrival_buffer_minutes! : row.departure_buffer_minutes! })),
    fixedVisits: fixed.map(visit => ({ id: visit.id, date: visit.date, time: time(visit.time), order: visit.fixed_order, minutes: visit.duration_minutes })),
  };
  return { ...result, revision: revision(result) };
}

export type { LivingSettingsStore } from '../settings/model';

/** All setting updates lock the parent trip, recheck ownership/revision and preserve fixed visits/results. */
export class LivingSettingsRepository implements LivingSettingsStore {
  constructor(private readonly pool: Pick<Pool, 'connect'>) {}
  private async transaction<T>(write: boolean, action: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query(write ? 'BEGIN' : 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const result = await action(client);
      await client.query('COMMIT');
      return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  load(id: string, ownerId: string): Promise<SettingsSnapshot> {
    return this.transaction(false, client => readSnapshot(client, id, ownerId));
  }
  save(id: string, ownerId: string, expectedRevision: string, settings: LivingSettings): Promise<SettingsSnapshot> {
    return this.transaction(true, async client => {
      await client.query('SELECT id FROM trips WHERE id::text=$1 FOR UPDATE', [id]);
      const current = await readSnapshot(client, id, ownerId);
      if (current.revision !== expectedRevision) throw new SettingsError(409, '다른 화면에서 입력이 변경되었습니다. 다시 불러온 뒤 수정해 주세요.', 'STALE_INPUT');
      await client.query(`UPDATE trips SET default_departure_time=$2, default_return_time=$3,
        default_meal_slots=$4::jsonb, meal_windows=$5::jsonb, taxi_policy=$6 WHERE id=$1`,
      [id, settings.departureTime, settings.returnTime, JSON.stringify(settings.mealSlots), JSON.stringify(settings.mealWindows), settings.taxiPolicy]);
      await client.query('DELETE FROM day_settings WHERE trip_id=$1 AND NOT (date = ANY($2::date[]))', [id, settings.days.map(day => day.date)]);
      await upsertDaySettings(client, id, settings.days);
      return readSnapshot(client, id, ownerId);
    });
  }
}
