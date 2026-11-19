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

type FareContext = { base: number; perKm: number; perMinute: number; multiplier: number;
  currency: string; source: string; updatedAt: string } | null;

/** Pure preparation for one departure: validate rates and resolve the local surcharge once. */
function fareContext(profile: CityProfile | null | undefined, departure: Date, timeZone: string): FareContext {
  if (!Number.isFinite(departure.getTime())) throw new RangeError('Invalid departure instant');
  const localTime = new Intl.DateTimeFormat('en-GB', {
    timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(departure);
  if (!profile || profile.taxiBaseFare == null || profile.taxiFarePerKm == null || profile.taxiFarePerMinute == null) {
    return null;
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
  return { base: profile.taxiBaseFare, perKm: profile.taxiFarePerKm, perMinute: profile.taxiFarePerMinute,
    multiplier, currency: profile.currency, source: profile.source, updatedAt: profile.updatedAt };
}

/**
 * A calculation-local estimator for routes sharing an instant and time zone. Preparation is lazy
 * so empty/no-DRIVE matrices retain their behavior. No global cache or external I/O is used.
 */
export function createTaxiFareEstimator(profile: CityProfile | null | undefined, departure: Date, timeZone: string) {
  let context: FareContext | undefined;
  return (distanceKm: number, durationMinutes: number): TaxiFareEstimate => {
    if (!Number.isFinite(distanceKm) || distanceKm < 0 || !Number.isFinite(durationMinutes) || durationMinutes < 0) {
      throw new RangeError('Distance and duration must be nonnegative finite numbers');
    }
    if (context === undefined) context = fareContext(profile, departure, timeZone);
    if (context === null) return { status: 'UNAVAILABLE', message: '정보 없음' };
    const amount = (context.base + distanceKm * context.perKm + durationMinutes * context.perMinute) * context.multiplier;
    if (!Number.isFinite(amount)) throw new RangeError('Fare exceeds numeric range');
    return { status: 'AVAILABLE', amount, currency: context.currency, source: context.source, updatedAt: context.updatedAt, estimated: true };
  };
}

/** Estimate using the departure instant in the supplied IANA time zone. */
export function estimateTaxiFare(
  profile: CityProfile | null | undefined,
  distanceKm: number,
  durationMinutes: number,
  departure: Date,
  timeZone: string,
): TaxiFareEstimate {
  return createTaxiFareEstimator(profile, departure, timeZone)(distanceKm, durationMinutes);
}
