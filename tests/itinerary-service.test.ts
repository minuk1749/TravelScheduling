import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Temporal } from '@js-temporal/polyfill';
import {
  ItineraryInputError, ItineraryService, MAX_ROUTE_ATTEMPTS,
  type ItineraryRepository, type ItineraryResult, type TripInputs,
} from '../src/services/itinerary';
import { planDays } from '../src/services/itinerary/day-plan';
import { TravelProviderError, type TravelTimeProvider } from '../src/travel-time';
import { cityProfile } from './fixtures/trip-input';
import {
  FixturePlaces, FixtureTravel, okVisits, placeId, samplePlaces, sampleTrip, TIME_ZONE, type RouteTweak, type Sample,
} from './fixtures/itinerary';

const profiles = (profile: typeof cityProfile | null = cityProfile) => ({
  findByCityCode: async (code: string) => code === profile?.cityCode ? profile : null,
});
const unusedRepository: ItineraryRepository = {
  loadInputs: async () => assert.fail('not used'), saveItinerary: async () => assert.fail('not used'),
};

function service(options: { travel?: TravelTimeProvider; places?: FixturePlaces; profile?: typeof cityProfile | null; maxAttempts?: number } = {}) {
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

const local = (instant: string) => Temporal.Instant.from(instant).toZonedDateTimeISO(TIME_ZONE);
const localTime = (instant: string) => local(instant).toPlainTime().toString({ smallestUnit: 'minute' });
const hoursOf = (visitId: string) => {
  const place: Sample = samplePlaces[visitId.replace('visit-', '') as keyof typeof samplePlaces];
  assert.ok(place.hours, `${visitId} has hours`);
  return place.hours;
};
const conflictVisits = [
  ...okVisits.filter(visit => visit.key !== 'sensoji'),
  { key: 'sensoji' as const, minutes: 90, fixedDate: '2026-12-02', fixedTime: '19:00' },
];

function schedule(result: ItineraryResult) {
  const value = result.capacity.recommendation?.schedule;
  assert.ok(value, 'expected a schedule');
  return value;
}

test('T12 Tokyo sample: OK itinerary is verified at actual departures, respects hours and includes efficiency', async () => {
  const travel = new FixtureTravel();
  const { service: itinerary, places } = service({ travel });
  const result = await itinerary.compute(sampleTrip());
  assert.equal(result.status, 'OK');
  assert.equal(result.capacity.status, 'OK');
  assert.deepEqual(result.verification, { verified: true, attempts: result.verification.attempts });
  assert.ok(result.verification.attempts >= 2 && result.verification.attempts <= MAX_ROUTE_ATTEMPTS);

  // Stage 7: every final leg was re-queried at exactly its departure and uses that duration.
  const days = schedule(result).days;
  const dayLegs = result.comparisons.filter(leg => leg.kind === 'DAY');
  assert.equal(dayLegs.length, days.reduce((sum, day) => sum + day.legs.length, 0));
  for (const leg of dayLegs) {
    assert.ok(travel.routeCalls.some(call => call.from.id === leg.from && call.to.id === leg.to &&
      Date.parse(call.departure) === Date.parse(leg.departure)), `${leg.from}→${leg.to} at ${leg.departure}`);
    const alternative = leg.alternatives[leg.selected.mode]!;
    assert.ok(Math.abs(alternative.minutes - leg.selected.minutes) < 1 / 60_000 + 1e-9);
  }

  // Opening hours, activity window and no overlaps after re-query.
  const placed = new Set<string>();
  for (const day of days) {
    const timeline = [...day.stops, ...day.legs].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    for (let index = 1; index < timeline.length; index++) assert.ok(Date.parse(timeline[index - 1].end) <= Date.parse(timeline[index].start));
    for (const stop of day.stops) {
      assert.ok(localTime(stop.start) >= '09:00' && localTime(stop.end) <= '21:00');
      if (stop.kind !== 'VISIT') continue;
      placed.add(stop.visitId);
      const [open, close] = hoursOf(stop.visitId);
      assert.ok(localTime(stop.start) >= open && localTime(stop.end) <= close, `${stop.visitId} within hours`);
    }
  }
  assert.deepEqual([...placed].sort(), okVisits.filter(visit => visit.priority !== 'WISH').map(visit => `visit-${visit.key}`).sort());
  assert.deepEqual(schedule(result).unplaced, [{ visitId: 'visit-teamlab', reason: 'WISH', fixed: false }]);

  // Airport transfers: luggage day 1 leaves when immigration ends; day 3 arrives by the check-in buffer.
  const [arrival, departure] = [result.comparisons[0], result.comparisons.at(-1)!];
  assert.deepEqual([arrival.kind, arrival.from, arrival.to, localTime(arrival.departure)], ['AIRPORT', placeId('airport'), placeId('hotel'), '10:30']);
  assert.equal(arrival.selected.mode, 'TAXI');
  assert.deepEqual([departure.kind, departure.from, departure.to], ['AIRPORT', placeId('hotel'), placeId('airport')]);
  assert.ok(local(departure.departure).add({ milliseconds: Math.ceil(departure.selected.minutes * 60_000) }).toPlainTime().toString() <= '15:30');
  assert.deepEqual(result.skippedMeals, [{ date: '2026-12-03', slot: 'DINNER' }]);

  // Stage 8: alternatives and efficiency summary in the city currency.
  for (const leg of result.comparisons) {
    assert.ok(leg.alternatives.TRANSIT && leg.alternatives.TAXI && leg.alternatives.WALK);
    assert.equal(typeof leg.alternatives.TRANSIT.fare, 'number');
    assert.equal(typeof leg.alternatives.TAXI.fare, 'number');
    assert.ok(leg.baseline && leg.baseline.mode !== 'TAXI');
  }
  const efficiency = result.efficiency!;
  assert.equal(efficiency.currency, 'JPY');
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
  assert.ok(Math.abs(efficiency.selectedMinutes - sum(result.comparisons.map(leg => leg.selected.minutes))) < 1e-9);
  assert.ok(Math.abs(efficiency.transitMinutes! - sum(result.comparisons.map(leg => leg.baseline!.minutes))) < 1e-9);
  assert.ok(Math.abs(efficiency.selectedFare! - sum(result.comparisons.map(leg => leg.selected.fare!))) < 1e-9);
  assert.ok(efficiency.transitFare! > 0 && efficiency.selectedFare! > efficiency.transitFare!, 'luggage taxis cost more');

  // One provider lookup per place per computation; one representative matrix per usable day.
  assert.deepEqual([...places.detailCalls].sort(), okVisits.map(visit => samplePlaces[visit.key].googlePlaceId).sort());
  assert.deepEqual([...places.locationCalls].sort(), [samplePlaces.airport.googlePlaceId, samplePlaces.hotel.googlePlaceId].sort());
  assert.equal(travel.matrixCalls.length, 3);
  assert.ok(travel.matrixCalls.every(call => call.timeZone === TIME_ZONE && call.modes.length === 3));
});

test('T12 Tokyo sample: OVER_CAPACITY returns a verified recommendation, the failed request and efficiency', async () => {
  const visits = okVisits.map(visit => ({ ...visit, minutes: 300 }));
  const result = await service().service.compute(sampleTrip(visits));
  assert.equal(result.status, 'OVER_CAPACITY');
  assert.ok(result.verification.verified);
  const recommendation = result.capacity.recommendation!;
  assert.ok(recommendation.requiredCount > 0 && recommendation.requiredCount < 6);
  assert.equal(recommendation.requiredVisitIds.length, recommendation.requiredCount);
  assert.ok(result.capacity.unplaced.length > 0);
  assert.ok(result.capacity.unplaced.every(item => !recommendation.requiredVisitIds.includes(item.visitId)));
  assert.ok(result.capacity.time.requiredMinutesLowerBound! > result.capacity.time.availableMinutes);
  const stops = recommendation.schedule.days.flatMap(day => day.stops).filter(stop => stop.kind === 'VISIT');
  assert.deepEqual(stops.map(stop => stop.visitId).sort(), [...recommendation.requiredVisitIds].sort());
  assert.ok(result.efficiency && result.efficiency.currency === 'JPY' && result.efficiency.transitMinutes! > 0);
  assert.ok(result.comparisons.some(leg => leg.kind === 'DAY'));
});

test('T12 Tokyo sample: CONFLICT when a fixed visit falls outside opening hours; no efficiency summary', async () => {
  const result = await service().service.compute(sampleTrip(conflictVisits));
  assert.equal(result.status, 'CONFLICT');
  assert.equal(result.capacity.recommendation, null);
  assert.deepEqual(result.capacity.unplaced, [{ visitId: 'visit-sensoji', reason: 'TIME_WINDOW', fixed: true }]);
  assert.equal(result.efficiency, null);
  assert.deepEqual(result.comparisons, []);
});

test('T12 stage 7 re-plans when actual departures reveal a closing-time violation', async () => {
  // The representative matrix reaches Meiji Jingu easily, but every actual route there takes 10 hours.
  const slowToMeiji: RouteTweak = ({ to }) => to === placeId('meiji') ? 36_000 : 0;
  const travel = new FixtureTravel(slowToMeiji);
  const { service: itinerary } = service({ travel });
  const result = await itinerary.compute(sampleTrip());
  assert.ok(travel.routeCalls.some(call => call.to.id === placeId('meiji')), 'initial plan visited Meiji Jingu');
  assert.equal(result.status, 'OVER_CAPACITY');
  assert.ok(result.verification.verified);
  assert.deepEqual(result.capacity.unplaced.map(item => item.visitId), ['visit-meiji']);
  assert.ok(!result.capacity.recommendation!.requiredVisitIds.includes('visit-meiji'));
  assert.ok(result.comparisons.every(leg => leg.to !== placeId('meiji') && leg.from !== placeId('meiji')));
});

test('T12 an unverified re-query loop is never reported as OK', async () => {
  const result = await service({ maxAttempts: 1 }).service.compute(sampleTrip());
  assert.deepEqual(result.verification, { verified: false, attempts: 1 });
  assert.equal(result.capacity.status, 'OK');
  assert.equal(result.status, 'CONFLICT');
  assert.equal(result.efficiency, null);
  assert.throws(() => service({ maxAttempts: 0 }), RangeError);
});

test('T12 without a city profile taxi fares stay unknown and are not summed as zero', async () => {
  const result = await service({ profile: null }).service.compute(sampleTrip());
  assert.equal(result.status, 'OK');
  const efficiency = result.efficiency!;
  assert.equal(efficiency.currency, 'JPY');
  assert.equal(typeof efficiency.transitFare, 'number');
  assert.ok(result.comparisons.every(leg => leg.alternatives.TAXI?.fare === null));
  assert.equal(result.comparisons[0].selected.mode, 'TAXI');
  assert.equal(efficiency.selectedFare, null);
});

test('T12 direct-to-airport ends the last day at the airport with luggage legs; no lodging transfer', async () => {
  const result = await service().service.compute(sampleTrip(okVisits, { luggageOption: 'DIRECT_TO_AIRPORT' }));
  assert.equal(result.status, 'OK');
  const last = result.comparisons.at(-1)!;
  assert.deepEqual([last.kind, last.to, last.selected.mode], ['DAY', placeId('airport'), 'TAXI']);
  assert.equal(result.comparisons.filter(leg => leg.kind === 'AIRPORT').length, 1);
  const lastDay = schedule(result).days.at(-1)!;
  assert.ok(localTime(lastDay.legs.at(-1)!.end) <= '15:30');
});

test('T12 an unreachable airport transfer is a CONFLICT with a transfer issue', async () => {
  const fixture = new FixtureTravel();
  const travel: TravelTimeProvider = {
    matrix: input => fixture.matrix(input),
    route: async input => input.from.id === placeId('airport') ? {} : fixture.route(input),
  };
  const result = await service({ travel }).service.compute(sampleTrip());
  assert.deepEqual(result.transferIssues, [{ date: '2026-12-01', direction: 'ARRIVAL', from: placeId('airport'), to: placeId('hotel') }]);
  assert.equal(result.status, 'CONFLICT');
  assert.equal(result.efficiency, null);
});

test('T12 stored inputs that cannot be scheduled are reported per field', async () => {
  const fields = (input: TripInputs) => {
    try { planDays(input); } catch (error) { assert.ok(error instanceof ItineraryInputError); return Object.keys(error.fields).sort(); }
    return assert.fail('expected ItineraryInputError');
  };
  assert.deepEqual(fields(sampleTrip(okVisits, { lodgings: [] })), ['lodgings']);
  assert.deepEqual(fields(sampleTrip(okVisits, { daySettings: [{ date: '2026-12-02', departureTime: null, returnTime: null, mealSlots: ['DINNER'] }] })),
    ['daySettings.2026-12-02.mealSlots']);
  assert.deepEqual(fields(sampleTrip([{ key: 'tower', minutes: 30, fixedTime: '10:00' }, { key: 'meiji', minutes: 30, fixedDate: '2027-01-01' }])),
    ['visits.visit-meiji', 'visits.visit-tower']);
  const paris = sampleTrip([{ key: 'tower', minutes: 30, fixedDate: '2026-12-02', fixedTime: '10:00' }], {
    timeZone: 'Europe/Paris', startDate: '2027-03-27', endDate: '2027-03-29',
    flights: [], lodgings: [{ place: sampleTrip().lodgings[0].place, checkIn: '2027-03-27', checkOut: '2027-03-29' }],
  });
  assert.deepEqual(fields({ ...paris, visits: [{ ...paris.visits[0], fixedDate: '2027-03-28', fixedTime: '02:30' }] }), ['visits.visit-tower']);
  assert.deepEqual(fields(sampleTrip(okVisits, { flights: [{ ...sampleTrip().flights[0], localDateTime: '2026-12-02T09:00' }] })), ['flights']);

  await assert.rejects(service().service.compute(sampleTrip(okVisits, { daySettings: [{ date: '2026-12-02', departureTime: '22:00', returnTime: '08:00', mealSlots: null }] })),
    (error: unknown) => error instanceof ItineraryInputError && 'daySettings.2026-12-02' in error.fields);
  const missing = new FixturePlaces(new Set([samplePlaces.tower.googlePlaceId, samplePlaces.hotel.googlePlaceId]));
  await assert.rejects(service({ places: missing }).service.compute(sampleTrip()), (error: unknown) => error instanceof ItineraryInputError &&
    Object.keys(error.fields).sort().join() === `places.${samplePlaces.hotel.googlePlaceId},places.${samplePlaces.tower.googlePlaceId}`);
});

test('T12 day plans: per-day settings, day trips anchored at the airport, and meal counts', () => {
  const days = planDays(sampleTrip(okVisits, {
    daySettings: [{ date: '2026-12-02', departureTime: '10:00', returnTime: '18:00', mealSlots: ['BREAKFAST', 'LUNCH', 'DINNER'] }],
  }));
  assert.deepEqual(days.map(day => [day.start.id, day.end.id, day.mealCount, day.activity.start]), [
    [placeId('hotel'), placeId('hotel'), 2, '09:00'], [placeId('hotel'), placeId('hotel'), 3, '10:00'], [placeId('hotel'), placeId('hotel'), 2, '09:00'],
  ]);
  assert.equal(days[0].arrival?.transferTo?.id, placeId('hotel'));
  assert.equal(days[2].departure?.transferFrom?.id, placeId('hotel'));
  const trip = sampleTrip();
  const [dayTrip] = planDays(sampleTrip(okVisits, {
    endDate: '2026-12-01', lodgings: [],
    flights: [trip.flights[0], { ...trip.flights[1], localDateTime: '2026-12-01T21:00' }],
  }));
  assert.deepEqual([dayTrip.start.id, dayTrip.end.id, dayTrip.arrival?.transferTo, dayTrip.departure?.transferFrom, dayTrip.luggageInto],
    [placeId('airport'), placeId('airport'), undefined, undefined, undefined]);
});

test('T12 provider failures propagate instead of becoming empty routes', async () => {
  const travel: TravelTimeProvider = {
    matrix: async () => { throw new TravelProviderError('UNAVAILABLE'); },
    route: input => new FixtureTravel().route(input),
  };
  await assert.rejects(service({ travel }).service.compute(sampleTrip()), (error: unknown) =>
    error instanceof TravelProviderError && error.kind === 'UNAVAILABLE');
});

test('T12 generate saves with the loaded input hash and passes through load/save outcomes', async () => {
  const saved: { tripId: string; hash: string; result: ItineraryResult }[] = [];
  const repository = (load: Awaited<ReturnType<ItineraryRepository['loadInputs']>>, stale = false): ItineraryRepository => ({
    loadInputs: async () => load,
    saveItinerary: async (tripId, hash, result) => {
      saved.push({ tripId, hash, result });
      return stale ? { status: 'STALE' } : { status: 'SAVED', itineraryId: 'itinerary-1' };
    },
  });
  const build = (repo: ItineraryRepository) => new ItineraryService({ repository: repo, profiles: profiles(), places: new FixturePlaces(), travel: new FixtureTravel() });
  assert.deepEqual(await build(repository(null)).generate('trip'), { status: 'NOT_FOUND' });
  assert.deepEqual(await build(repository({ status: 'INCOMPLETE', fields: ['cityCode'] })).generate('trip'), { status: 'INCOMPLETE', fields: ['cityCode'] });
  assert.equal(saved.length, 0);
  const ready = { status: 'READY' as const, input: sampleTrip(conflictVisits), inputHash: 'hash-1' };
  assert.deepEqual(await build(repository(ready, true)).generate('trip'), { status: 'STALE' });
  const outcome = await build(repository(ready)).generate('trip');
  assert.equal(outcome.status, 'SAVED');
  assert.ok(outcome.status === 'SAVED' && outcome.itineraryId === 'itinerary-1' && outcome.result.status === 'CONFLICT');
  assert.deepEqual(saved.map(entry => [entry.tripId, entry.hash]), [['trip', 'hash-1'], ['trip', 'hash-1']]);
});
