import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ItineraryService, MAX_ROUTE_ATTEMPTS, type ItineraryRepository, type ItineraryResult,
} from '../src/services/itinerary';
import { FixturePlaces, FixtureTravel, okVisits, placeId, samplePlaces, sampleTrip, TIME_ZONE, type RouteTweak } from './fixtures/itinerary';
import { conflictVisits, hoursOf, local, localTime, profiles, schedule, service } from './helpers/itinerary-service';

// Tokyo sample end-to-end results (OK / OVER_CAPACITY / CONFLICT), the stage 7 loop and saving.
// Day anchors and flights: itinerary-days.test.ts. Input validation and matrices: itinerary-inputs.test.ts.

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
  // The day window ends at the same verified, queried departure instant used for the comparison.
  assert.ok(travel.routeCalls.some(call => call.from.id === placeId('hotel') && call.to.id === placeId('airport') &&
    Date.parse(call.departure) === Date.parse(departure.departure)));
  const lastDayEnd = Math.max(...[...days.at(-1)!.stops, ...days.at(-1)!.legs].map(item => Date.parse(item.end)));
  assert.ok(lastDayEnd <= Date.parse(departure.departure));
  assert.deepEqual(result.flightConflicts, []);
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
