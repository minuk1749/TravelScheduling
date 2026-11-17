import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  calculateDayWindow, scheduleVisits, selectTravelMode,
  type ScheduleInput, type SchedulingDay, type TravelMode, type Visit,
} from '../src/scheduler';

const date = '2026-12-01';
const zone = 'Asia/Tokyo';
const time = (local: string, day = date) => new Date(`${day}T${local}:00+09:00`).toISOString();
const estimate = (minutes: number, fare: number | null = 0) => ({ minutes, fare });

function visit(id: string, settings: Partial<Visit> = {}): Visit {
  return { id, locationId: id, coordinates: { latitude: 35, longitude: 139 }, minutes: 30, priority: 'REQUIRED', ...settings };
}

function day(dayDate: string, locations: string[], overrides: Partial<SchedulingDay> = {}): SchedulingDay {
  return {
    date: dayDate,
    window: calculateDayWindow({
      date: dayDate, timeZone: zone, activity: { start: '09:00', end: '18:00' }, mealCount: 1,
    }),
    startLocationId: 'hotel', endLocationId: 'hotel',
    routes: new Map(['hotel', ...locations].map(from =>
      [from, new Map(['hotel', ...locations].map(to => [to, { WALK: estimate(10) }]))])),
    ...overrides,
  };
}

function input(days: SchedulingDay[], visits: Visit[]): ScheduleInput {
  return { days, visits, mealMinutes: { BREAKFAST: 30, LUNCH: 45, DINNER: 60 }, taxiPolicy: 'NEVER' };
}

test('preserves fixed date, exact instant and visit position, including a pinned wish', () => {
  const tomorrow = '2026-12-02';
  const visits = [
    visit('pinned', { priority: 'WISH', fixedDate: tomorrow, fixedStart: time('13:00', tomorrow), fixedOrder: 1 }),
    visit('before', { fixedDate: tomorrow, fixedStart: time('10:00', tomorrow) }),
    visit('wish', { priority: 'WISH' }),
  ];
  const days = [day(date, ['pinned', 'before']), day(tomorrow, ['pinned', 'before'])];
  const result = scheduleVisits(input(days, visits));
  assert.deepEqual(result.days[0].stops.filter(stop => stop.kind === 'VISIT'), []);
  const scheduled = result.days[1].stops.filter(stop => stop.kind === 'VISIT');
  assert.deepEqual(scheduled.map(stop => [stop.visitId, stop.start]), [
    ['before', time('10:00', tomorrow)], ['pinned', time('13:00', tomorrow)],
  ]);
  assert.deepEqual(result.unplaced, [{ visitId: 'wish', reason: 'WISH', fixed: false }]);
});

test('respects opening intervals, meals, travel time and airport-constrained activity without overlaps', () => {
  const window = calculateDayWindow({
    date, timeZone: zone, activity: { start: '08:30', end: '20:00' }, mealCount: 1,
    arrival: { localDateTime: `${date}T08:00`, travelMinutes: 50, viaLodging: true },
    departure: { localDateTime: `${date}T19:10`, travelMinutes: 40, viaLodging: true },
  });
  const openings = [{ start: time('08:00'), end: time('10:00') }, { start: time('14:15'), end: time('14:45') }];
  const visits = [
    visit('museum', { openingHours: openings }),
    visit('park', { openingHours: [{ start: time('11:00'), end: time('12:00') }], minutes: 45 }),
  ];
  const result = scheduleVisits(input([day(date, visits.map(({ id }) => id), { window })], visits));
  assert.deepEqual(result.unplaced, []);
  assert.deepEqual(result.issues, []);
  assert.equal(result.days[0].timeZone, zone);
  const { stops, legs } = result.days[0];
  assert.deepEqual(stops.map(stop => [stop.start, stop.end]), [
    [time('11:00'), time('11:45')], [time('11:45'), time('12:30')], [time('14:15'), time('14:45')],
  ]);
  assert.equal(stops[1].kind, 'MEAL');
  const events = [...stops, ...legs].sort((a, b) => a.start.localeCompare(b.start));
  for (const [index, event] of events.entries()) {
    assert.ok(event.start >= time('10:20'));
    assert.ok(event.end <= time('16:00'));
    if (index > 0) assert.ok(events[index - 1].end <= event.start);
  }
});

test('reports impossible locks, closed places and missing travel without moving a fixed visit', () => {
  const visits = [
    visit('late', { fixedDate: date, fixedStart: time('18:00') }),
    visit('missingIndex', { fixedDate: date, fixedOrder: 9 }),
    visit('closed', { openingHours: [] }),
    visit('disconnected'),
  ];
  const result = scheduleVisits(input([day(date, ['late', 'missingIndex', 'closed'])], visits));
  assert.deepEqual(result.days[0].stops.filter(stop => stop.kind === 'VISIT'), []);
  assert.deepEqual(new Map(result.unplaced.map(item => [item.visitId, [item.reason, item.fixed]])), new Map([
    ['missingIndex', ['FIXED_ORDER', true]], ['late', ['TIME_WINDOW', true]],
    ['closed', ['TIME_WINDOW', false]], ['disconnected', ['UNREACHABLE', false]],
  ]));
  assert.ok(result.issues.some(issue => issue.reason === 'UNREACHABLE' && issue.date === date &&
    (issue.from === 'disconnected' || issue.to === 'disconnected')));
});

test('enforces all taxi policies, cost and time boundaries, and manual priority', () => {
  const routes = { TRANSIT: estimate(40, 2), WALK: estimate(50), TAXI: estimate(10, 12) };
  const mode = (policy: ScheduleInput['taxiPolicy'], options?: Parameters<typeof selectTravelMode>[2]) =>
    selectTravelMode(routes, policy, options)?.mode;
  assert.equal(mode('NEVER', { luggage: true }), 'TRANSIT');
  assert.equal(mode('WHEN_NEEDED', { efficiencyThreshold: 0.5 }), 'TAXI');
  assert.equal(mode('WHEN_NEEDED', { efficiencyThreshold: 0.49 }), 'TRANSIT');
  assert.equal(mode('WHEN_NEEDED', { efficiencyThreshold: 1, callBufferMinutes: 11 }), 'TRANSIT');
  assert.equal(mode('WHEN_NEEDED', { luggage: true }), 'TAXI');
  assert.equal(mode('PREFER'), 'TAXI');
  assert.equal(mode('NEVER', { fixedMode: 'TAXI' }), 'TAXI');
  assert.equal(mode('PREFER', { fixedMode: 'WALK' }), 'WALK');
  assert.equal(selectTravelMode({ ...routes, WALK: estimate(15) }, 'PREFER')?.mode, 'WALK');
  assert.equal(selectTravelMode({ ...routes, TRANSIT: estimate(19) }, 'PREFER')?.mode, 'TRANSIT');
  assert.equal(selectTravelMode({ ...routes, TAXI: estimate(10, null) }, 'WHEN_NEEDED', { efficiencyThreshold: 1 })?.mode, 'TRANSIT');
  assert.equal(selectTravelMode({ TAXI: routes.TAXI }, 'WHEN_NEEDED')?.mode, 'TAXI');
  assert.equal(selectTravelMode({ TAXI: routes.TAXI }, 'NEVER'), null);
  assert.equal(selectTravelMode({ WALK: routes.WALK }, 'NEVER')?.mode, 'WALK');
  assert.equal(selectTravelMode({ WALK: routes.WALK }, 'PREFER', { fixedMode: 'TAXI' }), null);
});

test('applies directed manual modes and luggage flags to scheduled legs', () => {
  const routes = { TRANSIT: estimate(30), TAXI: estimate(25) };
  const settings = new Map<string, ReadonlyMap<string, { mode?: TravelMode; luggage?: boolean }>>([
    ['hotel', new Map([['a', { mode: 'TAXI' }]])],
    ['a', new Map([['hotel', { luggage: true }]])],
  ]);
  const trip = input([day(date, ['a'], {
    routes: new Map([['hotel', new Map([['a', routes]])], ['a', new Map([['hotel', routes]])]]),
    legSettings: settings,
  })], [visit('a')]);
  const never = scheduleVisits(trip).days[0].legs;
  assert.deepEqual(never.map(({ mode, fixed }) => [mode, fixed]), [['TAXI', true], ['TRANSIT', false]]);
  assert.equal(Date.parse(never[0].end) - Date.parse(never[0].start), 35 * 60_000);
  const needed = scheduleVisits({ ...trip, taxiPolicy: 'WHEN_NEEDED' }).days[0].legs;
  assert.deepEqual(needed.map(({ mode, fixed }) => [mode, fixed]), [['TAXI', true], ['TAXI', false]]);
});

test('groups nearby visits by date and schedules 20 visits over three days in under one second', () => {
  const visits = Array.from({ length: 20 }, (_, index) => visit(`v${index}`, {
    coordinates: { latitude: 35 + (index % 3) * 0.2, longitude: 139 + index * 0.0001 },
    minutes: 51,
  }));
  const days = ['2026-12-01', '2026-12-02', '2026-12-03'].map(date => day(date, visits.map(({ id }) => id)));
  const start = performance.now();
  const result = scheduleVisits(input(days, visits));
  const elapsed = performance.now() - start;
  assert.ok(elapsed < 1000, `Scheduling took ${elapsed.toFixed(1)} ms`);
  assert.deepEqual(result.unplaced, []);
  assert.deepEqual(result.issues, []);
  const clusters = result.days.map(day => new Set(day.stops.flatMap(stop =>
    stop.kind === 'VISIT' ? [Number(stop.visitId.slice(1)) % 3] : [],
  )));
  assert.deepEqual(clusters.map(cluster => [...cluster]), [[0], [1], [2]]);
});
