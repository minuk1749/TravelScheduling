import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TripInputs } from '../src/services/itinerary';
import { planDays } from '../src/services/itinerary/day-plan';
import type { TravelTimeProvider } from '../src/travel-time';
import { FixturePlaces, FixtureTravel, okVisits, placeId, sampleTrip, type Sample } from './fixtures/itinerary';
import { localDateTime, localTime, schedule, service } from './helpers/itinerary-service';

// Daily anchors, airport transfers (including ones that cross midnight) and luggage legs.

const [arrivalFlight, departureFlight] = sampleTrip().flights;
const itemsOf = (day: { stops: readonly { start: string; end: string }[]; legs: readonly { start: string; end: string }[] }) => [...day.stops, ...day.legs];

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
  assert.deepEqual(result.transferIssues, [{ date: '2026-12-01', direction: 'ARRIVAL', from: placeId('airport'), to: placeId('hotel'), reason: 'NO_ROUTE' }]);
  assert.equal(result.status, 'CONFLICT');
  assert.equal(result.efficiency, null);
});

test('T12 a departure transfer that never fits the check-in deadline within the query limit is a CONFLICT', async () => {
  // Transit-only lodging → airport: 20, 30, 40, 50 minutes on successive queries (never converges).
  const fixture = new FixtureTravel();
  let departureQueries = 0;
  const travel: TravelTimeProvider = {
    matrix: input => fixture.matrix(input),
    route: async input => {
      if (input.from.id !== placeId('hotel') || input.to.id !== placeId('airport')) return fixture.route(input);
      departureQueries++;
      return { TRANSIT: { durationSeconds: (10 + 10 * departureQueries) * 60, distanceMeters: 15_000, fare: { amount: 500, currency: 'JPY' } } };
    },
  };
  const result = await service({ travel }).service.compute(sampleTrip());
  assert.equal(departureQueries, 4);
  assert.deepEqual(result.transferIssues, [{ date: '2026-12-03', direction: 'DEPARTURE', from: placeId('hotel'), to: placeId('airport'), reason: 'UNVERIFIED' }]);
  assert.equal(result.status, 'CONFLICT');
  assert.equal(result.efficiency, null);
  assert.ok(result.comparisons.every(leg => leg.kind !== 'AIRPORT' || leg.to !== placeId('airport')));
});

test('T12 a same-airport day trip whose immigration ends after the departure deadline is a CONFLICT even without required visits', async () => {
  const trip = sampleTrip([{ key: 'tower', minutes: 30, priority: 'WISH' }], {
    endDate: '2026-12-01', lodgings: [], flights: [arrivalFlight, { ...departureFlight, localDateTime: '2026-12-01T11:00' }],
  });
  const result = await service().service.compute(trip);
  assert.equal(result.status, 'CONFLICT');
  assert.deepEqual(result.flightConflicts.map(conflict => [conflict.date, localTime(conflict.arrivalReadyAt), localTime(conflict.departureStartBy)]),
    [['2026-12-01', '10:30', '08:30']]);
  assert.equal(result.efficiency, null);
  assert.deepEqual(result.comparisons, []);
});

test('T12 an early-morning departure transfer that starts the previous evening bounds that evening', async () => {
  const trip = (fixedTime: string) => sampleTrip([{ key: 'tower', minutes: 60, fixedDate: '2026-12-02', fixedTime }], {
    flights: [arrivalFlight, { ...departureFlight, localDateTime: '2026-12-03T00:30' }],
    daySettings: [{ date: '2026-12-02', departureTime: null, returnTime: '23:30', mealSlots: null }],
  });

  // 00:30 flight − 150 min buffer = 22:00 at the airport, so the lodging is left around 21:10 on Dec 2.
  const late = await service().service.compute(trip('21:00'));
  assert.equal(late.status, 'CONFLICT');
  assert.deepEqual(late.capacity.unplaced.map(item => [item.visitId, item.fixed]), [['visit-tower', true]]);
  assert.equal(late.efficiency, null);

  const early = await service().service.compute(trip('19:00'));
  assert.equal(early.status, 'OK');
  const departure = early.comparisons.at(-1)!;
  assert.deepEqual([departure.kind, departure.from, departure.to], ['AIRPORT', placeId('hotel'), placeId('airport')]);
  assert.ok(localDateTime(departure.departure) < '2026-12-02T22:00', 'transfer starts the evening before');
  const [, secondDay, lastDay] = schedule(early).days;
  assert.ok(itemsOf(secondDay).every(item => Date.parse(item.end) <= Date.parse(departure.departure)));
  assert.deepEqual(itemsOf(lastDay), []);
});

test('T12 a late arrival whose transfer ends after midnight bounds the next morning', async () => {
  const night: Sample = { googlePlaceId: 'sample-night-spot', latitude: 35.6700, longitude: 139.7600 };
  const places = new FixturePlaces(new Set(), new Map([[night.googlePlaceId, night]]));
  const trip = (fixedTime?: string): TripInputs => ({
    ...sampleTrip([], {
      flights: [{ ...arrivalFlight, localDateTime: '2026-12-01T23:00' }, departureFlight],
      daySettings: [{ date: '2026-12-02', departureTime: '00:00', returnTime: null, mealSlots: null }],
    }),
    visits: [{
      id: 'visit-night', place: { id: 'place-night', googlePlaceId: night.googlePlaceId }, kind: 'ATTRACTION', minutes: 30, priority: 'REQUIRED',
      ...(fixedTime ? { fixedDate: '2026-12-02', fixedTime } : {}),
    }],
  });

  const result = await service({ places }).service.compute(trip());
  assert.equal(result.status, 'OK');
  const arrival = result.comparisons[0];
  assert.deepEqual([arrival.kind, localDateTime(arrival.departure)], ['AIRPORT', '2026-12-02T00:30']);
  const readyAt = Date.parse(arrival.departure) + Math.ceil(arrival.selected.minutes) * 60_000;
  const secondDay = schedule(result).days[1];
  assert.ok(itemsOf(secondDay).length > 0 && itemsOf(secondDay).every(item => Date.parse(item.start) >= readyAt));

  // A visit pinned inside the transfer cannot be kept.
  const pinned = await service({ places }).service.compute(trip('00:45'));
  assert.equal(pinned.status, 'CONFLICT');
  assert.deepEqual(pinned.capacity.unplaced.map(item => [item.visitId, item.fixed]), [['visit-night', true]]);
});

test('T12 a day trip without lodging carries luggage on every leg', async () => {
  const dayTrip = (taxiPolicy: TripInputs['taxiPolicy']) => sampleTrip([{ key: 'tower', minutes: 30 }], {
    taxiPolicy, endDate: '2026-12-01', lodgings: [], flights: [arrivalFlight, { ...departureFlight, localDateTime: '2026-12-01T23:00' }],
  });
  const modes = async (taxiPolicy: TripInputs['taxiPolicy']) => {
    const result = await service().service.compute(dayTrip(taxiPolicy));
    assert.equal(result.status, 'OK');
    const legs = result.comparisons.filter(leg => leg.kind === 'DAY');
    assert.deepEqual(legs.map(leg => [leg.from, leg.to]), [[placeId('airport'), placeId('tower')], [placeId('tower'), placeId('airport')]]);
    return legs.map(leg => leg.selected.mode);
  };
  assert.deepEqual(await modes('WHEN_NEEDED'), ['TAXI', 'TAXI']);
  assert.ok((await modes('NEVER')).every(mode => mode !== 'TAXI'));
});

test('T12 day plans: per-day settings, day trips anchored at the airport, and meal counts', () => {
  const days = planDays(sampleTrip(okVisits, {
    daySettings: [{ date: '2026-12-02', departureTime: '10:00', returnTime: '18:00', mealSlots: ['BREAKFAST', 'LUNCH', 'DINNER'] }],
  }));
  assert.deepEqual(days.map(day => [day.start.id, day.end.id, day.mealCount, day.activity.start, day.luggage]), [
    [placeId('hotel'), placeId('hotel'), 2, '09:00', undefined], [placeId('hotel'), placeId('hotel'), 3, '10:00', undefined],
    [placeId('hotel'), placeId('hotel'), 2, '09:00', undefined],
  ]);
  assert.equal(days[0].arrival?.transferTo?.id, placeId('hotel'));
  assert.equal(days[2].departure?.transferFrom?.id, placeId('hotel'));
  const [dayTrip] = planDays(sampleTrip(okVisits, {
    endDate: '2026-12-01', lodgings: [], flights: [arrivalFlight, { ...departureFlight, localDateTime: '2026-12-01T21:00' }],
  }));
  assert.deepEqual([dayTrip.start.id, dayTrip.end.id, dayTrip.arrival?.transferTo, dayTrip.departure?.transferFrom, dayTrip.luggage],
    [placeId('airport'), placeId('airport'), undefined, undefined, 'ALL_LEGS']);
});

test('T12 direct-to-airport falls back to a lodging transfer when check-in closes before the last day starts', () => {
  const direct = (localDateTime: string) => planDays(sampleTrip(okVisits, {
    luggageOption: 'DIRECT_TO_AIRPORT', flights: [arrivalFlight, { ...departureFlight, localDateTime }],
  })).at(-1)!;
  const afternoon = direct('2026-12-03T18:00');
  assert.deepEqual([afternoon.end.id, afternoon.departure?.transferFrom, afternoon.luggage], [placeId('airport'), undefined, 'INTO_END']);
  const earlyMorning = direct('2026-12-03T00:30');
  assert.deepEqual([earlyMorning.end.id, earlyMorning.departure?.transferFrom?.id, earlyMorning.luggage], [placeId('hotel'), placeId('hotel'), undefined]);
});
