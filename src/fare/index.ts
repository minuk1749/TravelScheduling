/** Values are in the city's local currency; surcharge is a fraction (0.2 = 20%). */
export interface CityProfile {
  cityCode: string;
  country: string;
  currency: string;
  transitCoverage: string | null;
  transitHours: string | null;
  taxiBaseFare: number | null;
  taxiFarePerKm: number | null;
  taxiFarePerMinute: number | null;
  nightSurcharge: number | null;
  nightStart: string | null;
  nightEnd: string | null;
  callBufferMinutes: number | null;
  efficiencyThreshold: number | null;
  rideHailingApps: string[];
  source: string;
  updatedAt: string;
}

export type TaxiFareEstimate =
  | { status: 'AVAILABLE'; amount: number; currency: string; source: string; updatedAt: string; estimated: true }
  | { status: 'UNAVAILABLE'; message: '정보 없음' };

function minutesOfDay(value: string): number {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new RangeError('Time must be HH:mm');
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

/** Estimate using the departure instant in the supplied IANA time zone. */
export function estimateTaxiFare(
  profile: CityProfile | null | undefined,
  distanceKm: number,
  durationMinutes: number,
  departure: Date,
  timeZone: string,
): TaxiFareEstimate {
  if (!Number.isFinite(distanceKm) || distanceKm < 0 || !Number.isFinite(durationMinutes) || durationMinutes < 0) {
    throw new RangeError('Distance and duration must be nonnegative finite numbers');
  }
  if (!Number.isFinite(departure.getTime())) throw new RangeError('Invalid departure instant');
  const localTime = new Intl.DateTimeFormat('en-GB', {
    timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(departure);
  if (!profile || profile.taxiBaseFare == null || profile.taxiFarePerKm == null || profile.taxiFarePerMinute == null) {
    return { status: 'UNAVAILABLE', message: '정보 없음' };
  }
  const rates = [profile.taxiBaseFare, profile.taxiFarePerKm, profile.taxiFarePerMinute];
  if (rates.some((rate) => !Number.isFinite(rate) || rate < 0)) throw new RangeError('Invalid taxi rate');
  const { nightSurcharge, nightStart, nightEnd } = profile;
  const hasNight = nightSurcharge != null || nightStart != null || nightEnd != null;
  let multiplier = 1;
  if (hasNight) {
    if (nightSurcharge == null || nightStart == null || nightEnd == null || !Number.isFinite(nightSurcharge) || nightSurcharge < 0) {
      throw new RangeError('Incomplete or invalid night surcharge');
    }
    const start = minutesOfDay(nightStart), end = minutesOfDay(nightEnd), time = minutesOfDay(localTime);
    if (start === end) throw new RangeError('Night surcharge interval must not be empty');
    if (start < end ? time >= start && time < end : time >= start || time < end) multiplier += nightSurcharge;
  }
  const amount = (profile.taxiBaseFare + distanceKm * profile.taxiFarePerKm + durationMinutes * profile.taxiFarePerMinute) * multiplier;
  if (!Number.isFinite(amount)) throw new RangeError('Fare exceeds numeric range');
  return { status: 'AVAILABLE', amount, currency: profile.currency, source: profile.source, updatedAt: profile.updatedAt, estimated: true };
}
