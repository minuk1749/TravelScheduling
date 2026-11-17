import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  calculateDayWindow, checkCapacity, scheduleVisits,
  type CapacityResult, type DayWindowInput, type RouteOptions,
  type ScheduleInput, type SchedulingDay, type Visit,
} from '../src/scheduler';

const date = '2026-12-01';
const time = (local: string) => `${date}T${local}:00+09:00`;

function visit(id: string, overrides: Partial<Visit> = {}): Visit {
  return { id, locationId: id, coordinates: { latitude: 35, longitude: 139 }, minutes: 30, priority: 'REQUIRED', ...overrides };
}

function day(locations: string[], settings: Partial<DayWindowInput> = {}, routes: RouteOptions = { WALK: { minutes: 5, fare: 0 } }): SchedulingDay {
  const windowInput: DayWindowInput = {
    date, timeZone: 'Asia/Tokyo', activity: { start: '09:00', end: '10:30' }, mealCount: 0, ...settings,
  };
  return {
    date: windowInput.date, window: calculateDayWindow(windowInput), startLocationId: 'hotel', endLocationId: 'hotel',
    routes: new Map(['hotel', ...locations].map(from =>
      [from, new Map(['hotel', ...locations].map(to => [to, routes]))])),
  };
}

function input(visits: Visit[], days = [day(visits.map(visit => visit.locationId))]): ScheduleInput {
  return { visits, days, mealMinutes: { BREAKFAST: 30, LUNCH: 45, DINNER: 60 }, taxiPolicy: 'NEVER' };
}

function assertRecommendation(trip: ScheduleInput, result: CapacityResult): void {
  assert.notEqual(result.status, 'CONFLICT');
  assert.ok(result.recommendation);
  const { requiredCount, requiredVisitIds, schedule } = result.recommendation;
  assert.equal(requiredCount, requiredVisitIds.length);
  const chosen = new Set(requiredVisitIds);
  assert.equal(chosen.size, requiredCount);
  const selected = trip.visits.map(visit => visit.priority === 'REQUIRED' && !chosen.has(visit.id)
    ? { ...visit, priority: 'WISH' as const } : visit);
  // Independently rerun the public placement function with the user's selection.
  const replay = scheduleVisits({ ...trip, visits: selected });
  assert.deepEqual(replay.days, schedule.days);
  assert.deepEqual(replay.issues, []);
  assert.ok(replay.unplaced.every(item => item.reason === 'WISH'));
  const allStops = replay.days.flatMap(day => day.stops);
  for (const visit of trip.visits) {
    const fixed = visit.fixedDate !== undefined || visit.fixedStart !== undefined || visit.fixedOrder !== undefined;
    const stops = allStops.filter(stop => stop.kind === 'VISIT' && stop.visitId === visit.id);
    assert.equal(stops.length, chosen.has(visit.id) || fixed ? 1 : 0, visit.id);
  }
  for (const plan of replay.days) {
    const source = trip.days.find(day => day.date === plan.date)!;
    assert.equal(plan.timeZone, source.window.timeZone);
    assert.deepEqual(plan.stops.flatMap(stop => stop.kind === 'MEAL' ? [stop.slot] : []).sort(),
      source.window.meals.map(meal => meal.slot).sort());
    const events = [...plan.stops, ...plan.legs].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    for (const [index, event] of events.entries()) {
      assert.ok(source.window.available);
      assert.ok(Date.parse(event.start) >= Date.parse(source.window.available.start));
      assert.ok(Date.parse(event.end) <= Date.parse(source.window.available.end));
      if (index > 0) assert.ok(Date.parse(events[index - 1].end) <= Date.parse(event.start));
    }
    const visits = plan.stops.filter(stop => stop.kind === 'VISIT');
    for (const [position, stop] of visits.entries()) {
      const visit = trip.visits.find(visit => visit.id === stop.visitId)!;
      if (visit.fixedDate !== undefined) assert.equal(plan.date, visit.fixedDate);
      if (visit.fixedStart !== undefined) assert.equal(Date.parse(stop.start), Date.parse(visit.fixedStart));
      if (visit.fixedOrder !== undefined) assert.equal(position, visit.fixedOrder);
      if (visit.openingHours) assert.ok(visit.openingHours.some(window =>
        Date.parse(stop.start) >= Date.parse(window.start) && Date.parse(stop.end) <= Date.parse(window.end)));
    }
  }
}

test('accepts an exact fit including the return leg and ignores unpinned wishes', () => {
  const trip = input([visit('a', { minutes: 25 }), visit('b', { minutes: 20 }), visit('wish', { priority: 'WISH', minutes: 999, openingHours: [] })],
    [day(['a', 'b'], { activity: { start: '09:00', end: '10:00' } })]);
  const result = checkCapacity(trip);
  assert.equal(result.status, 'OK');
  assertRecommendation(trip, result);
  assert.equal(result.recommendation?.requiredCount, 2);
  assert.equal(Date.parse(result.recommendation!.schedule.days[0].legs.at(-1)!.end), Date.parse(time('10:00')));
  assert.deepEqual(result.time, { availableMinutes: 60, visitMinutes: 45, mealMinutes: 0, travelMinutesLowerBound: 10, requiredMinutesLowerBound: 55 });
  assert.deepEqual(result.unplaced, []);
});

test('returns OVER_CAPACITY, a verified N and the rejected place when dwell and travel overflow', () => {
  const trip = input([visit('a'), visit('b'), visit('c')]);
  const result = checkCapacity(trip);
  assert.equal(result.status, 'OVER_CAPACITY');
  assert.equal(result.recommendation?.requiredCount, 2);
  assert.deepEqual(result.unplaced, [{ visitId: 'c', reason: 'TIME_WINDOW', fixed: false }]);
  assert.equal(result.time.availableMinutes, 90);
  assert.equal(result.time.requiredMinutesLowerBound, 105);
  assertRecommendation(trip, result);
});

test('finds more short visits than the original partial plan and revalidates a different same-size selection', () => {
  const trip = input([visit('long', { minutes: 100 }), visit('a'), visit('b'), visit('c')],
    [day(['long', 'a', 'b', 'c'], { activity: { start: '09:00', end: '11:00' } })]);
  assert.equal(scheduleVisits(trip).days[0].stops.length, 1);
  const result = checkCapacity(trip);
  assert.equal(result.status, 'OVER_CAPACITY');
  assert.deepEqual(result.recommendation?.requiredVisitIds, ['a', 'b', 'c']);
  assertRecommendation(trip, result);
  const changed = { ...trip, visits: trip.visits.map(visit => visit.id === 'c' ? { ...visit, priority: 'WISH' as const } : visit) };
  const revalidated = checkCapacity(changed);
  assert.equal(revalidated.status, 'OVER_CAPACITY');
  assert.ok(revalidated.unplaced.some(item => item.visitId === 'a' && item.reason === 'TIME_WINDOW'));
  assertRecommendation(changed, revalidated);
});

test('identifies closed and unreachable places even with abundant aggregate time', () => {
  const trip = input([visit('closed', { openingHours: [] }), visit('disconnected'), visit('open', {
    openingHours: [{ start: time('10:00'), end: time('11:00') }],
  })], [day(['closed', 'open'], { activity: { start: '09:00', end: '18:00' } })]);
  const result = checkCapacity(trip);
  assert.equal(result.status, 'OVER_CAPACITY');
  assert.deepEqual(result.unplaced, [
    { visitId: 'closed', reason: 'TIME_WINDOW', fixed: false },
    { visitId: 'disconnected', reason: 'UNREACHABLE', fixed: false },
  ]);
  assert.ok(result.issues.some(issue => issue.reason === 'UNREACHABLE' && (issue.from === 'disconnected' || issue.to === 'disconnected')));
  assert.equal(result.time.requiredMinutesLowerBound, null);
  assert.deepEqual(result.recommendation?.requiredVisitIds, ['open']);
  assertRecommendation(trip, result);
});

test('detects incompatible opening windows even when the time lower bound fits', () => {
  const openingHours = [{ start: time('09:00'), end: time('09:35') }];
  const trip = input([visit('a', { openingHours }), visit('b', { openingHours })]);
  const result = checkCapacity(trip);
  assert.equal(result.status, 'OVER_CAPACITY');
  assert.equal(result.recommendation?.requiredCount, 1);
  assert.ok(result.time.requiredMinutesLowerBound! < result.time.availableMinutes);
  assert.deepEqual(result.unplaced, [{ visitId: 'b', reason: 'TIME_WINDOW', fixed: false }]);
  assertRecommendation(trip, result);
});

test('keeps fixed required visits and pinned wishes, counting only the required visits', () => {
  const trip = input([
    visit('pinned', { priority: 'WISH', fixedDate: date, fixedStart: time('09:15'), fixedOrder: 0, minutes: 20 }),
    visit('locked', { fixedDate: date, fixedStart: time('10:00'), fixedOrder: 1, minutes: 20 }),
    visit('a'), visit('b'), visit('wish', { priority: 'WISH' }),
  ], [day(['pinned', 'locked', 'a', 'b'], { activity: { start: '09:00', end: '11:00' } })]);
  const result = checkCapacity(trip);
  assert.equal(result.status, 'OVER_CAPACITY');
  assert.equal(result.recommendation?.requiredCount, 2);
  assert.ok(result.recommendation?.requiredVisitIds.includes('locked'));
  assert.ok(!result.recommendation?.requiredVisitIds.includes('pinned'));
  assert.equal(result.time.visitMinutes, 100);
  assertRecommendation(trip, result);
});

test('preserves the companion visits needed to satisfy an absolute fixed position', () => {
  const trip = input([
    visit('pinned', { priority: 'WISH', fixedDate: date, fixedOrder: 2 }),
    visit('a'), visit('b'), visit('closed', { openingHours: [] }),
  ], [day(['pinned', 'a', 'b', 'closed'], { activity: { start: '09:00', end: '12:00' } })]);
  const result = checkCapacity(trip);
  assert.equal(result.status, 'OVER_CAPACITY');
  assert.deepEqual(result.recommendation?.requiredVisitIds, ['a', 'b']);
  assertRecommendation(trip, result);
});

test('returns a conflict without a false recommendation for incompatible fixed visits or positions', () => {
  for (const visits of [
    [visit('a', { fixedStart: time('10:00') }), visit('b', { fixedStart: time('10:00'), priority: 'WISH' }), visit('optional')],
    [visit('a', { fixedDate: date, fixedOrder: 5 }), visit('optional')],
    [visit('a', { fixedDate: '2026-12-02' })],
  ]) {
    const trip = input(visits, [day(visits.map(visit => visit.id), { activity: { start: '09:00', end: '18:00' } })]);
    const result = checkCapacity(trip);
    assert.equal(result.status, 'CONFLICT');
    assert.equal(result.recommendation, null);
    assert.ok(result.unplaced.some(item => item.fixed));
  }
});

test('cannot recommend even zero visits when a meal or the base return route is impossible', () => {
  const mealTrip = input([], [day([], { mealCount: 1 })]);
  const meal = checkCapacity(mealTrip);
  assert.equal(meal.status, 'CONFLICT');
  assert.equal(meal.recommendation, null);
  assert.deepEqual(meal.issues, [{ date, reason: 'MEAL_UNAVAILABLE', slot: 'LUNCH' }]);
  const routeDay = { ...day(['a']), endLocationId: 'other-hotel' };
  const route = checkCapacity(input([visit('a')], [routeDay]));
  assert.equal(route.status, 'CONFLICT');
  assert.equal(route.recommendation, null);
  assert.ok(route.issues.some(issue => issue.reason === 'UNREACHABLE' && issue.to === 'other-hotel'));
});

test('can recommend a visit that connects otherwise unreachable daily endpoints', () => {
  const route = { WALK: { minutes: 5, fare: 0 } };
  const trip = input([visit('bridge'), visit('disconnected')], [{
    ...day(['bridge']), endLocationId: 'other-hotel',
    routes: new Map([
      ['hotel', new Map([['bridge', route]])],
      ['bridge', new Map([['other-hotel', route]])],
    ]),
  }]);
  assert.equal(checkCapacity({ ...trip, visits: [] }).status, 'CONFLICT');
  const result = checkCapacity(trip);
  assert.equal(result.status, 'OVER_CAPACITY');
  assert.deepEqual(result.recommendation?.requiredVisitIds, ['bridge']);
  assertRecommendation(trip, result);
  const connected = checkCapacity({ ...trip, visits: [trip.visits[0]] });
  assert.equal(connected.time.travelMinutesLowerBound, 10);
  assert.equal(connected.time.requiredMinutesLowerBound, 40);
});

test('rejects an overlong daily transfer even without visits, but accepts an exact fit', () => {
  const transferDay: SchedulingDay = {
    ...day([], { activity: { start: '09:00', end: '09:30' } }),
    endLocationId: 'other-hotel',
    routes: new Map([['hotel', new Map([['other-hotel', { WALK: { minutes: 60, fare: 0 } }]])]]),
  };
  const trip = input([], [transferDay]);
  const result = checkCapacity(trip);
  assert.equal(result.status, 'CONFLICT');
  assert.equal(result.recommendation, null);
  assert.deepEqual(result.issues, [{ date, reason: 'TIME_WINDOW' }]);
  assert.equal(result.time.requiredMinutesLowerBound, 60);

  const exact = { ...trip, days: [{ ...transferDay, window: day([], { activity: { start: '09:00', end: '10:00' } }).window }] };
  const fitted = checkCapacity(exact);
  assert.equal(fitted.status, 'OK');
  assert.equal(fitted.recommendation?.schedule.days[0].legs.length, 1);
  assertRecommendation(exact, fitted);
});

test('reports a transfer with no available window and rechecks a faster route through a visit', () => {
  const transferDay: SchedulingDay = {
    ...day(['bridge'], { activity: { start: '09:00', end: '09:30' } }),
    endLocationId: 'other-hotel',
    routes: new Map([
      ['hotel', new Map([
        ['other-hotel', { WALK: { minutes: 60, fare: 0 } }],
        ['bridge', { WALK: { minutes: 5, fare: 0 } }],
      ])],
      ['bridge', new Map([['other-hotel', { WALK: { minutes: 5, fare: 0 } }]])],
    ]),
  };
  const unavailable = checkCapacity(input([], [{ ...transferDay, window: { ...transferDay.window, available: null } }]));
  assert.equal(unavailable.status, 'CONFLICT');
  assert.deepEqual(unavailable.issues, [{ date, reason: 'TIME_WINDOW' }]);

  const connected = input([visit('bridge', { minutes: 20 })], [transferDay]);
  const result = checkCapacity(connected);
  assert.equal(result.status, 'OK');
  assertRecommendation(connected, result);
  assert.equal(result.recommendation?.schedule.days[0].legs.length, 2);
});

test('returns a verified zero when no visit fits, and handles empty input and unavailable days', () => {
  for (const trip of [
    input([visit('too-long', { minutes: 500 })]),
    input([visit('no-day')], []),
    input([visit('no-time')], [day(['no-time'], { arrival: { localDateTime: `${date}T09:00`, travelMinutes: 60, viaLodging: true } })]),
  ]) {
    const result = checkCapacity(trip);
    assert.equal(result.status, 'OVER_CAPACITY');
    assert.equal(result.recommendation?.requiredCount, 0);
    assert.equal(result.unplaced[0].visitId, trip.visits[0].id);
    assertRecommendation(trip, result);
  }
  const empty = input([], []);
  const result = checkCapacity(empty);
  assert.equal(result.status, 'OK');
  assert.equal(result.time.requiredMinutesLowerBound, 0);
  assertRecommendation(empty, result);
});

test('uses airport-constrained time and reserves meals in every recommendation', () => {
  const visits = [visit('a', { minutes: 90 }), visit('b', { minutes: 90 }), visit('c', { minutes: 90 })];
  const trip = input(visits, [day(visits.map(visit => visit.id), {
    activity: { start: '09:00', end: '18:00' }, mealCount: 1,
    arrival: { localDateTime: `${date}T09:00`, travelMinutes: 30, viaLodging: true },
    departure: { localDateTime: `${date}T18:00`, travelMinutes: 30, viaLodging: true },
  })]);
  const result = checkCapacity(trip);
  assert.equal(result.status, 'OVER_CAPACITY');
  assert.equal(result.time.availableMinutes, 240);
  assert.equal(result.time.mealMinutes, 45);
  assert.equal(result.recommendation?.requiredCount, 2);
  assertRecommendation(trip, result);
});

test('bases capacity and travel estimates on taxi policies, pickup buffers and manual modes', () => {
  const routes: RouteOptions = { TRANSIT: { minutes: 40, fare: 0 }, TAXI: { minutes: 10, fare: 10 } };
  const trip = { ...input([visit('a', { minutes: 50 })], [day(['a'], {}, routes)]), cityProfile: { callBufferMinutes: 10, efficiencyThreshold: 0.5 } };
  for (const taxiPolicy of ['NEVER', 'WHEN_NEEDED', 'PREFER'] as const) {
    const candidate = { ...trip, taxiPolicy };
    const result = checkCapacity(candidate);
    assert.equal(result.status, taxiPolicy === 'NEVER' ? 'OVER_CAPACITY' : 'OK');
    assert.equal(result.time.travelMinutesLowerBound, taxiPolicy === 'NEVER' ? 40 : 20);
    assertRecommendation(candidate, result);
  }
  const manual: ScheduleInput = { ...trip, days: [{ ...trip.days[0], legSettings: new Map([
    ['hotel', new Map([['a', { mode: 'TAXI' as const }]])],
    ['a', new Map([['hotel', { mode: 'TAXI' as const }]])],
  ]) }] };
  const result = checkCapacity(manual);
  assert.equal(result.status, 'OK');
  assertRecommendation(manual, result);
  assert.ok(result.recommendation!.schedule.days[0].legs.every(leg => leg.mode === 'TAXI' && leg.fixed));
});

test('uses elapsed time across DST and supports separate daily capacities', () => {
  const trip = input([visit('a', { minutes: 60 }), visit('b', { minutes: 60 })], [day(['a', 'b'], {
    date: '2026-03-08', timeZone: 'America/New_York', activity: { start: '01:00', end: '04:00' },
  })]);
  const result = checkCapacity(trip);
  assert.equal(result.time.availableMinutes, 120);
  assert.equal(result.status, 'OVER_CAPACITY');
  assert.equal(result.recommendation?.requiredCount, 1);
  assertRecommendation(trip, result);
  const twoDays = { ...trip, days: [...trip.days, day(['a', 'b'], { date: '2026-03-09' })] };
  const expanded = checkCapacity(twoDays);
  assert.equal(expanded.status, 'OK');
  assertRecommendation(twoDays, expanded);
});

test('is deterministic, leaves inputs unchanged and verifies 20 visits over three days within one second', () => {
  const visits = Array.from({ length: 20 }, (_, index) => visit(`v${index}`, {
    minutes: 45 + index % 4 * 10, coordinates: { latitude: 35 + index % 3, longitude: 139 },
  }));
  const trip = input(visits, ['2026-12-01', '2026-12-02', '2026-12-03'].map(date =>
    day(visits.map(visit => visit.id), { date, activity: { start: '09:00', end: '12:00' } })));
  const snapshot = structuredClone(trip);
  const start = performance.now();
  const result = checkCapacity(trip);
  const elapsed = performance.now() - start;
  assert.ok(elapsed < 1000, `Capacity check took ${elapsed.toFixed(1)} ms`);
  assert.equal(result.status, 'OVER_CAPACITY');
  assertRecommendation(trip, result);
  assert.deepEqual(trip, snapshot);
  assert.deepEqual(checkCapacity(trip), result);
});

test('rejects duplicate visit ids instead of returning an ambiguous recommendation', () => {
  assert.throws(() => checkCapacity(input([visit('same'), visit('same')])), /Visit ids must be unique/);
});
