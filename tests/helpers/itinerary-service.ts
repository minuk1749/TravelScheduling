import assert from 'node:assert/strict';
import { Temporal } from '@js-temporal/polyfill';
import { ItineraryService, type ItineraryRepository, type ItineraryResult } from '../../src/services/itinerary';
import type { TravelTimeProvider } from '../../src/travel-time';
import { cityProfile } from '../fixtures/trip-input';
import { FixturePlaces, FixtureTravel, okVisits, samplePlaces, TIME_ZONE, type Sample } from '../fixtures/itinerary';

export const profiles = (profile: typeof cityProfile | null = cityProfile) => ({
  findByCityCode: async (code: string) => code === profile?.cityCode ? profile : null,
});
const unusedRepository: ItineraryRepository = {
  loadInputs: async () => assert.fail('not used'), saveItinerary: async () => assert.fail('not used'),
};

/** ItineraryService over the Tokyo fixtures; `compute` only (the repository is not used). */
export function service(options: { travel?: TravelTimeProvider; places?: FixturePlaces; profile?: typeof cityProfile | null; maxAttempts?: number } = {}) {
  const travel = options.travel ?? new FixtureTravel();
  const places = options.places ?? new FixturePlaces();
  return {
    places,
    service: new ItineraryService({
      repository: unusedRepository, profiles: profiles(options.profile === undefined ? cityProfile : options.profile),
      places, travel,
    }, options.maxAttempts),
  };
}

export const local = (instant: string) => Temporal.Instant.from(instant).toZonedDateTimeISO(TIME_ZONE);
export const localTime = (instant: string) => local(instant).toPlainTime().toString({ smallestUnit: 'minute' });
export const localDateTime = (instant: string) => local(instant).toPlainDateTime().toString({ smallestUnit: 'minute' });
export const hoursOf = (visitId: string) => {
  const place: Sample = samplePlaces[visitId.replace('visit-', '') as keyof typeof samplePlaces];
  assert.ok(place.hours, `${visitId} has hours`);
  return place.hours;
};
export const conflictVisits = [
  ...okVisits.filter(visit => visit.key !== 'sensoji'),
  { key: 'sensoji' as const, minutes: 90, fixedDate: '2026-12-02', fixedTime: '19:00' },
];

export function schedule(result: ItineraryResult) {
  const value = result.capacity.recommendation?.schedule;
  assert.ok(value, 'expected a schedule');
  return value;
}
