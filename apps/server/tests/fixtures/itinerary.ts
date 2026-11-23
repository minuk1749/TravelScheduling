import { Temporal } from '@js-temporal/polyfill';
import type { PlaceDetails, PlaceDetailsRequest, PlaceLocation } from '../../src/places';
import type { TripInputs } from '../../src/services/itinerary';
import type { TripDraft } from '../../src/trips/input';
import type {
  Location, MatrixRequest, RouteRequest, TravelAlternatives, TravelEstimate, TravelMatrix, TravelTimeProvider,
} from '../../src/travel-time';
import { matrixRequest, routeRequest } from '../../src/travel-time/validation';

/**
 * Tokyo sample trip with real landmark coordinates and simplified regular hours. Durations and fares
 * are synthetic (distance-based), not Google content, and no API key or network access is used.
 */
export const TIME_ZONE = 'Asia/Tokyo';
export type Sample = { googlePlaceId: string; latitude: number; longitude: number; hours?: readonly [string, string];
  /** The provider reports the place as closed: empty hours, which is not the same as unknown hours. */
  closed?: boolean;
};
export const samplePlaces = {
  airport: { googlePlaceId: 'sample-haneda-airport', latitude: 35.5494, longitude: 139.7798 },
  hotel: { googlePlaceId: 'sample-ginza-hotel', latitude: 35.6717, longitude: 139.7650 },
  sensoji: { googlePlaceId: 'sample-sensoji', latitude: 35.7148, longitude: 139.7967, hours: ['06:00', '17:00'] },
  skytree: { googlePlaceId: 'sample-skytree', latitude: 35.7101, longitude: 139.8107, hours: ['10:00', '21:00'] },
  meiji: { googlePlaceId: 'sample-meiji-jingu', latitude: 35.6764, longitude: 139.6993, hours: ['06:40', '16:20'] },
  shibuya: { googlePlaceId: 'sample-shibuya-sky', latitude: 35.6585, longitude: 139.7020, hours: ['10:00', '22:30'] },
  tsukiji: { googlePlaceId: 'sample-tsukiji-market', latitude: 35.6655, longitude: 139.7707, hours: ['06:00', '14:00'] },
  tower: { googlePlaceId: 'sample-tokyo-tower', latitude: 35.6586, longitude: 139.7454, hours: ['09:00', '22:30'] },
  ueno: { googlePlaceId: 'sample-ueno-museum', latitude: 35.7188, longitude: 139.7765, hours: ['09:30', '17:00'] },
  teamlab: { googlePlaceId: 'sample-teamlab', latitude: 35.6491, longitude: 139.7898, hours: ['09:00', '22:00'] },
} satisfies Record<string, Sample>;
export type SampleKey = keyof typeof samplePlaces;

/** Scheduler location IDs (`places.id`) for service-level tests. */
export const placeId = (key: SampleKey) => `place-${key}`;
const ref = (key: SampleKey) => ({ id: placeId(key), googlePlaceId: samplePlaces[key].googlePlaceId });
const byGoogleId = new Map(Object.values(samplePlaces).map(place => [place.googlePlaceId, place as Sample]));

export class FixturePlaces {
  readonly detailCalls: string[] = [];
  readonly locationCalls: string[] = [];
  /** `extra` adds synthetic places (keyed by Google place ID) beyond the Tokyo sample. */
  constructor(private readonly missing: ReadonlySet<string> = new Set(), private readonly extra: ReadonlyMap<string, Sample> = new Map()) {}

  private find(googlePlaceId: string): Sample | undefined {
    return byGoogleId.get(googlePlaceId) ?? this.extra.get(googlePlaceId);
  }

  async details(input: PlaceDetailsRequest): Promise<PlaceDetails | null> {
    this.detailCalls.push(input.googlePlaceId);
    const place = this.find(input.googlePlaceId);
    if (!place || this.missing.has(input.googlePlaceId)) return null;
    const openingHours = place.closed ? [] : place.hours && input.dates.map(date => ({
      start: Temporal.PlainDateTime.from(`${date}T${place.hours![0]}`).toZonedDateTime(input.timeZone).toInstant().toString(),
      end: Temporal.PlainDateTime.from(`${date}T${place.hours![1]}`).toZonedDateTime(input.timeZone).toInstant().toString(),
    }));
    return {
      googlePlaceId: input.googlePlaceId, name: input.googlePlaceId, attributions: [], types: [],
      coordinates: { latitude: place.latitude, longitude: place.longitude }, cacheExpiresAt: '2026-12-31T00:00:00Z',
      ...(openingHours ? { openingHours } : {}),
    };
  }

  async location(googlePlaceId: string): Promise<PlaceLocation | null> {
    this.locationCalls.push(googlePlaceId);
    const place = this.find(googlePlaceId);
    if (!place || this.missing.has(googlePlaceId)) return null;
    return { googlePlaceId, coordinates: { latitude: place.latitude, longitude: place.longitude }, cacheExpiresAt: '2026-12-31T00:00:00Z' };
  }
}

function kilometres(a: Location, b: Location): number {
  const radians = Math.PI / 180;
  const h = Math.sin((b.coordinates.latitude - a.coordinates.latitude) * radians / 2) ** 2 +
    Math.cos(a.coordinates.latitude * radians) * Math.cos(b.coordinates.latitude * radians) *
    Math.sin((b.coordinates.longitude - a.coordinates.longitude) * radians / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

export type RouteTweak = (input: { from: string; to: string; departure: string; mode: 'TRANSIT' | 'WALK' | 'DRIVE' }) => number;

/**
 * Distance model: walk 4.8 km/h, transit 8 min + 22 km/h (fare ¥180 + ¥30/km), drive 4 min + 24 km/h.
 * `actualDelay` adds seconds to actual-departure route() results so re-querying changes durations;
 * by default evening (17:00+) transit is 3 minutes slower than the representative matrix.
 */
export class FixtureTravel implements TravelTimeProvider {
  readonly matrixCalls: MatrixRequest[] = [];
  readonly routeCalls: RouteRequest[] = [];
  constructor(private readonly actualDelay: RouteTweak = ({ departure, mode }) =>
    mode === 'TRANSIT' && Temporal.Instant.from(departure).toZonedDateTimeISO(TIME_ZONE).hour >= 17 ? 180 : 0) {}

  private alternatives(from: Location, to: Location, departure: string, actual: boolean): TravelAlternatives {
    const km = kilometres(from, to);
    const delay = (mode: 'TRANSIT' | 'WALK' | 'DRIVE') => actual ? this.actualDelay({ from: from.id, to: to.id, departure, mode }) : 0;
    const estimate = (seconds: number, meters: number, fare: TravelEstimate['fare']): TravelEstimate =>
      ({ durationSeconds: Math.round(seconds), distanceMeters: Math.round(meters), fare });
    return {
      WALK: estimate(km / 4.8 * 3600 + delay('WALK'), km * 1250, null),
      TRANSIT: estimate((8 + km / 22 * 60) * 60 + delay('TRANSIT'), km * 1300, { amount: 180 + 30 * Math.ceil(km), currency: 'JPY' }),
      DRIVE: estimate((4 + km / 24 * 60) * 60 + delay('DRIVE'), km * 1300, null),
    };
  }

  /** Applies the real provider request validation (location limit, duplicate IDs, instants). */
  async matrix(input: MatrixRequest): Promise<TravelMatrix> {
    this.matrixCalls.push(input);
    const { locations, departure } = matrixRequest(input);
    return new Map(locations.map(from => [from.id, new Map(locations.map(to =>
      [to.id, this.alternatives(from, to, departure, false)]))]));
  }

  async route(input: RouteRequest): Promise<TravelAlternatives> {
    this.routeCalls.push(input);
    const { from, to } = routeRequest(input);
    return this.alternatives(from, to, input.departure, true);
  }
}

type VisitSpec = { key: SampleKey; minutes: number; priority?: 'REQUIRED' | 'WISH'; fixedDate?: string; fixedTime?: string; fixedOrder?: number };
export const okVisits: readonly VisitSpec[] = [
  { key: 'sensoji', minutes: 90 }, { key: 'skytree', minutes: 60 }, { key: 'meiji', minutes: 60 },
  { key: 'shibuya', minutes: 60 }, { key: 'tsukiji', minutes: 60 }, { key: 'tower', minutes: 45 },
  { key: 'teamlab', minutes: 120, priority: 'WISH' },
];

/** 3-day Tokyo trip: Haneda arrival 09:00 day 1, departure 18:00 day 3, one Ginza hotel. */
export function sampleTrip(visits: readonly VisitSpec[] = okVisits, changes: Partial<TripInputs> = {}): TripInputs {
  return {
    id: 'trip-tokyo', cityCode: 'TOKYO', timeZone: TIME_ZONE, startDate: '2026-12-01', endDate: '2026-12-03',
    activity: { start: '09:00', end: '21:00' }, mealSlots: ['LUNCH', 'DINNER'],
    mealWindows: { BREAKFAST: { start: '07:30', end: '09:30' }, LUNCH: { start: '11:30', end: '14:00' }, DINNER: { start: '17:30', end: '20:30' } },
    taxiPolicy: 'WHEN_NEEDED', luggageOption: 'VIA_LODGING', arrivalBufferMinutes: 90, departureBufferMinutes: 150,
    daySettings: [],
    flights: [
      { direction: 'ARRIVAL', airport: ref('airport'), localDateTime: '2026-12-01T09:00' },
      { direction: 'DEPARTURE', airport: ref('airport'), localDateTime: '2026-12-03T18:00' },
    ],
    lodgings: [{ place: ref('hotel'), checkIn: '2026-12-01', checkOut: '2026-12-03' }],
    visits: visits.map(({ key, priority = 'REQUIRED', ...visit }) => ({
      id: `visit-${key}`, place: ref(key), kind: key === 'tsukiji' ? 'RESTAURANT' : 'ATTRACTION', priority, ...visit,
    })),
    ...changes,
  };
}

/** The T10 creation draft that `insertTrip` stores for the same sample (Google IDs instead of place rows). */
export function sampleDraft(input: TripInputs = sampleTrip()): TripDraft {
  return { cityCode: input.cityCode,timeZone: input.timeZone, startDate: input.startDate, endDate: input.endDate,
    taxiPolicy: input.taxiPolicy, luggageOption: input.luggageOption,
    flights: input.flights.map(f => ({ direction: f.direction, localDateTime: f.localDateTime, googlePlaceId: f.airport.googlePlaceId })),
    lodgings: input.lodgings.map(l => ({ checkIn: l.checkIn, checkOut: l.checkOut, googlePlaceId: l.place.googlePlaceId })),
    visits: input.visits.map(v => ({ googlePlaceId: v.place.googlePlaceId, kind: v.kind, minutes: v.minutes, priority: v.priority })),
  };
}
