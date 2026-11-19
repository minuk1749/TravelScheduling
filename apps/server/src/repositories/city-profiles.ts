import type { Pool } from 'pg';
import type { CityProfile } from '../fare';

export function cityProfileRepository(db: Pick<Pool, 'query'>) {
  return { async findByCityCode(cityCode: string): Promise<CityProfile | null> {
    const result = await db.query(`SELECT * FROM city_profiles WHERE city_code = $1`, [cityCode]);
    const row = result.rows[0];
    if (!row) return null;
    const number = (key: string) => {
      if (row[key] === null) return null;
      const value = Number(row[key]);
      if (!Number.isFinite(value) || value < 0) throw Error('Invalid profile number');
      return value;
    };
    const time = (key: string) => {
      if (row[key] === null) return null;
      if (typeof row[key] !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d:00$/.test(row[key])) throw Error('Invalid profile time');
      return row[key].slice(0, 5);
    };
    if (!Array.isArray(row.ride_hailing_apps) || row.ride_hailing_apps.some((item: unknown) => typeof item !== 'string')) throw Error('Invalid profile apps');
    return { cityCode: row.city_code, country: row.country, currency: row.currency,
      transitCoverage: row.transit_coverage, transitHours: row.transit_hours,
      taxiBaseFare: number('taxi_base_fare'), taxiFarePerKm: number('taxi_fare_per_km'), taxiFarePerMinute: number('taxi_fare_per_minute'),
      nightSurcharge: number('night_surcharge'), nightStart: time('night_start'), nightEnd: time('night_end'),
      callBufferMinutes: number('call_buffer_minutes'), efficiencyThreshold: number('efficiency_threshold'),
      rideHailingApps: row.ride_hailing_apps, source: row.source, updatedAt: new Date(row.updated_at).toISOString() };
  } };
}
