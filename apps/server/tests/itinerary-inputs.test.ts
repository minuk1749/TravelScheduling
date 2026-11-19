import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ItineraryInputError, type TripInputs } from '../src/services/itinerary';
import { planDays } from '../src/services/itinerary/day-plan';
import { matrixGroups } from '../src/services/itinerary/routes';
import { mealCountForSlots, mealSlotsForCount } from '../src/scheduler';
import { countForSlots } from '../src/settings/input';
import { MAX_MATRIX_LOCATIONS, TravelProviderError, type TravelTimeProvider } from '../src/travel-time';
import { FixturePlaces, FixtureTravel, okVisits, placeId, samplePlaces, sampleTrip, type Sample } from './fixtures/itinerary';
import { service } from './helpers/itinerary-service';

// Stored-input validation, the shared meal-slot rule, matrix candidates and matrix splitting.

test('T12 100 required visits plus lodging and airport anchors are split across provider-valid matrix requests', async () => {
  const extra = new Map<string, Sample>();
  const visits = Array.from({ length: 100 }, (_, index) => {
    const googlePlaceId = `synthetic-${index}`;
    extra.set(googlePlaceId, { googlePlaceId, latitude: 35.6 + (index % 10) * 0.01, longitude: 139.7 + Math.floor(index / 10) * 0.01 });
    return { id: `visit-${index}`, place: { id: `place-synthetic-${index}`, googlePlaceId }, kind: 'ATTRACTION' as const, minutes: 30, priority: 'REQUIRED' as const };
  });
  // Actual departures match the matrix here, so the result depends only on the matrix split.
  const travel = new FixtureTravel(() => 0);
  const places = new FixturePlaces(new Set(), extra);
  const result = await service({ travel, places }).service.compute({ ...sampleTrip([], { luggageOption: 'DIRECT_TO_AIRPORT' }), visits });
  assert.equal(result.status, 'OVER_CAPACITY');
  assert.ok(result.verification.verified);
  assert.ok(result.capacity.recommendation!.requiredCount > 0 && result.capacity.recommendation!.requiredCount < 100);
  assert.ok(travel.matrixCalls.length > 3, 'a day with more than 100 locations needs several requests');
  assert.ok(travel.matrixCalls.every(call => call.locations.length <= MAX_MATRIX_LOCATIONS));
  // The last day (lodging start, airport end, 100 visits) still receives every ordered pair.
  const lastDayDeparture = travel.matrixCalls.find(call => call.locations.some(location => location.id === placeId('airport')))!.departure;
  const lastDay = travel.matrixCalls.filter(call => call.departure === lastDayDeparture);
  assert.equal(lastDay.length, 3);
  const pairs = new Set(lastDay.flatMap(call => call.locations.flatMap(from => call.locations.map(to => `${from.id}>${to.id}`))));
  assert.equal(pairs.size, 102 * 102);
});

test('T12 unpinned wishes are not routed; pinned wishes are routed only on their date', async () => {
  const matrixIds = async (visits: Parameters<typeof sampleTrip>[0]) => {
    const travel = new FixtureTravel();
    await service({ travel }).service.compute(sampleTrip(visits));
    return [...travel.matrixCalls].sort((a, b) => Date.parse(a.departure) - Date.parse(b.departure))
      .map(call => call.locations.map(location => location.id).sort());
  };
  const required = [{ key: 'tower' as const, minutes: 45 }];
  const wishes = (['sensoji', 'skytree', 'meiji', 'shibuya', 'teamlab'] as const).map(key => ({ key, minutes: 60, priority: 'WISH' as const }));
  const onlyRequired = await matrixIds(required);
  assert.deepEqual(onlyRequired, Array.from({ length: 3 }, () => [placeId('hotel'), placeId('tower')]));
  assert.deepEqual(await matrixIds([...required, ...wishes, { key: 'ueno', minutes: 60, priority: 'WISH' }]), onlyRequired);

  const pinned = await matrixIds([...required, ...wishes, { key: 'ueno', minutes: 60, priority: 'WISH', fixedDate: '2026-12-02' }]);
  assert.deepEqual(pinned, [onlyRequired[0], [placeId('hotel'), placeId('tower'), placeId('ueno')], onlyRequired[2]]);
});

test('T12 matrix groups cover every ordered pair within the provider limit', () => {
  for (const count of [1, 100, 101, 102, 205]) {
    const ids = Array.from({ length: count }, (_, index) => `id-${index}`);
    const groups = matrixGroups(ids);
    assert.ok(groups.every(group => group.length <= MAX_MATRIX_LOCATIONS && new Set(group).size === group.length));
    const pairs = new Set(groups.flatMap(group => group.flatMap(from => group.map(to => `${from}>${to}`))));
    assert.equal(pairs.size, count * count);
  }
  assert.equal(matrixGroups(Array.from({ length: 102 }, (_, index) => `${index}`)).length, 3);
});

test('T12 living settings and itinerary generation share one meal-slot rule', () => {
  for (const count of [0, 1, 2, 3] as const) {
    assert.equal(mealCountForSlots(mealSlotsForCount(count)), count);
    assert.equal(mealCountForSlots([...mealSlotsForCount(count)].reverse()), count);
    assert.equal(countForSlots(mealSlotsForCount(count)), count);
  }
  for (const slots of [['DINNER'], ['BREAKFAST'], ['LUNCH', 'LUNCH'], ['BREAKFAST', 'DINNER']] as const) {
    assert.equal(mealCountForSlots(slots), null);
    assert.throws(() => countForSlots(slots), RangeError);
  }
  assert.throws(() => countForSlots('LUNCH'), RangeError);
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

test('T12 provider failures propagate instead of becoming empty routes', async () => {
  const travel: TravelTimeProvider = {
    matrix: async () => { throw new TravelProviderError('UNAVAILABLE'); },
    route: input => new FixtureTravel().route(input),
  };
  await assert.rejects(service({ travel }).service.compute(sampleTrip()), (error: unknown) =>
    error instanceof TravelProviderError && error.kind === 'UNAVAILABLE');
});
