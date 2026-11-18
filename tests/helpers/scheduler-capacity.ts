import assert from 'node:assert/strict';
import {
  calculateDayWindow, scheduleVisits,
  type CapacityResult, type DayWindowInput, type RouteOptions,
  type ScheduleInput, type SchedulingDay, type Visit,
} from '../../src/scheduler';

export const date = '2026-12-01';
export const time = (local: string) => `${date}T${local}:00+09:00`;

export function visit(id: string, overrides: Partial<Visit> = {}): Visit {
  return { id, locationId: id, coordinates: { latitude: 35, longitude: 139 }, minutes: 30, priority: 'REQUIRED', ...overrides };
}

export function day(locations: string[], settings: Partial<DayWindowInput> = {}, routes: RouteOptions = { WALK: { minutes: 5, fare: 0 } }): SchedulingDay {
  const windowInput: DayWindowInput = {
    date, timeZone: 'Asia/Tokyo', activity: { start: '09:00', end: '10:30' }, mealCount: 0, ...settings,
  };
  return {
    date: windowInput.date, window: calculateDayWindow(windowInput), startLocationId: 'hotel', endLocationId: 'hotel',
    routes: new Map(['hotel', ...locations].map(from =>
      [from, new Map(['hotel', ...locations].map(to => [to, routes]))])),
  };
}

export function input(visits: Visit[], days = [day(visits.map(visit => visit.locationId))]): ScheduleInput {
  return { visits, days, mealMinutes: { BREAKFAST: 30, LUNCH: 45, DINNER: 60 }, taxiPolicy: 'NEVER' };
}

export function assertRecommendation(trip: ScheduleInput, result: CapacityResult): void {
  assert.notEqual(result.status, 'CONFLICT');
  assert.ok(result.recommendation);
  const { requiredCount, requiredVisitIds, schedule } = result.recommendation;
  assert.equal(requiredCount, requiredVisitIds.length);
  const chosen = new Set(requiredVisitIds);
  assert.equal(chosen.size, requiredCount);
  const selected = trip.visits.map(visit => visit.priority === 'REQUIRED' && !chosen.has(visit.id)
    ? { ...visit, priority: 'WISH' as const } : visit);
  // Independently rerun the public placement export function with the user's selection.
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

