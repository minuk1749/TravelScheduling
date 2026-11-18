import type { Visit, ScheduleInput, ScheduleResult } from './placement-types';
import { evaluate, instant, interval, lengthInMilliseconds, timestamp,
  type DayState, type Item, type Evaluation, type Rejection, type InsertFailure } from './route-evaluation';

export type { Visit, SchedulingDay, ScheduleInput, ScheduleResult } from './placement-types';

export function isFixed(visit: Visit): boolean {
  return visit.fixedDate !== undefined || visit.fixedStart !== undefined || visit.fixedOrder !== undefined;
}

/** Visits the scheduler may place: REQUIRED or pinned. Unpinned wishes are never placed automatically. */
export function isPlaceable(visit: Visit): boolean {
  return visit.priority === 'REQUIRED' || isFixed(visit);
}

function distance(a: Visit['coordinates'], b: Visit['coordinates']): number {
  const radians = Math.PI / 180;
  // Haversine's intermediate value orders distances without an inverse trig call.
  return Math.sin((a.latitude - b.latitude) * radians / 2) ** 2 +
    Math.cos(a.latitude * radians) * Math.cos(b.latitude * radians) *
    Math.sin((a.longitude - b.longitude) * radians / 2) ** 2;
}

function proximity(route: Item[], visit: Visit): number {
  let sum = 0;
  let count = 0;
  for (const item of route) {
    if ('visit' in item) {
      sum += distance(visit.coordinates, item.visit.coordinates);
      count++;
    }
  }
  return count ? sum / count : Infinity;
}

function geographicOrder(visits: Visit[]): Visit[] {
  const ordered: Visit[] = [];
  let closest = 0;
  while (visits.length > 0) {
    const [current] = visits.splice(closest, 1);
    ordered.push(current);
    let bestDistance = Infinity;
    closest = 0;
    for (const [index, visit] of visits.entries()) {
      const separation = distance(current.coordinates, visit.coordinates);
      if (separation < bestDistance) {
        closest = index;
        bestDistance = separation;
      }
    }
  }
  return ordered;
}

function insert(item: Item, days: DayState[], input: ScheduleInput): InsertFailure | undefined {
  let best: { state: DayState; route: Item[]; plan: Evaluation; gaps: number; distance: number; travel: number } | undefined;
  let rejection: InsertFailure = { failure: { reason: 'TIME_WINDOW' } };
  for (const state of days) {
    const { day, route, plan: previous } = state;
    const distance = 'visit' in item ? proximity(route, item.visit) : 0;
    for (let index = 0; index <= route.length; index++) {
      const candidate = [...route.slice(0, index), item, ...route.slice(index)];
      const plan = evaluate(state, candidate, input);
      if ('reason' in plan) {
        if (plan.reason === 'UNREACHABLE' || rejection.failure.reason !== 'UNREACHABLE') {
          rejection = { date: day.date, failure: plan };
        }
        continue;
      }
      const gaps = plan.orderGap - ('orderGap' in previous ? previous.orderGap : 0);
      const travel = plan.travel - ('travel' in previous ? previous.travel : 0);
      if (!best || gaps < best.gaps || (gaps === best.gaps &&
        (distance < best.distance || (distance === best.distance && travel < best.travel)))) {
        best = { state, route: candidate, plan, gaps, distance, travel };
      }
    }
  }
  if (!best) return rejection;
  best.state.route = best.route;
  best.state.plan = best.plan;
}

function improve(state: DayState, input: ScheduleInput): void {
  // Bound the number of passes. Every accepted reversal reduces travel time.
  for (let pass = 0; pass < state.route.length; pass++) {
    let improved = false;
    for (let left = 0; left < state.route.length - 1; left++) {
      for (let right = left + 1; right < state.route.length; right++) {
        const { route, plan } = state;
        const candidate = [...route.slice(0, left), ...route.slice(left, right + 1).reverse(), ...route.slice(right + 1)];
        const next = evaluate(state, candidate, input);
        if ('travel' in plan && 'travel' in next && next.orderGap <= plan.orderGap && next.travel < plan.travel) {
          state.route = candidate;
          state.plan = next;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }
}

/** Allocate visits using only caller-provided windows and representative route estimates. */
export function scheduleVisits(input: ScheduleInput): ScheduleResult {
  const result: ScheduleResult = { days: [], unplaced: [], issues: [] };
  const days: DayState[] = input.days.map(day => {
    const bounds = { day, available: day.window.available && interval(day.window.available) };
    return { ...bounds, route: [], plan: evaluate(bounds, [], input) };
  });
  const report = (date: string, failure: Rejection) => {
    if (failure.reason === 'UNREACHABLE' && !result.issues.some(issue =>
      issue.date === date && issue.reason === 'UNREACHABLE' && issue.from === failure.from && issue.to === failure.to)) {
      result.issues.push({ date, ...failure });
    }
  };

  for (const state of days) {
    for (const { slot, window } of state.day.window.meals) {
      if (!window || insert({ slot, length: lengthInMilliseconds(input.mealMinutes[slot]), windows: [interval(window)] }, [state], input)) {
        result.issues.push({ date: state.day.date, reason: 'MEAL_UNAVAILABLE', slot });
      }
    }
  }

  const fixed = input.visits.filter(isFixed).sort((a, b) => (a.fixedOrder ?? Infinity) - (b.fixedOrder ?? Infinity));
  const required = input.visits.filter(visit => !isFixed(visit) && visit.priority === 'REQUIRED');
  for (const visit of input.visits) {
    if (!isFixed(visit) && visit.priority === 'WISH') {
      result.unplaced.push({ visitId: visit.id, reason: 'WISH', fixed: false });
    }
  }

  for (const visit of [...fixed, ...geographicOrder(required)]) {
    const item: Item = {
      visit,
      length: lengthInMilliseconds(visit.minutes),
      windows: visit.openingHours?.map(interval),
      fixedStart: visit.fixedStart === undefined ? undefined : instant(visit.fixedStart),
    };
    const eligible = days.filter(({ day }) => visit.fixedDate === undefined || day.date === visit.fixedDate);
    const rejection = insert(item, eligible, input);
    if (rejection) {
      const { date, failure } = rejection;
      result.unplaced.push({ visitId: visit.id, reason: failure.reason, fixed: isFixed(visit) });
      if (date !== undefined) report(date, failure);
    }
  }

  for (const state of days) {
    const { day } = state;
    improve(state, input);
    // A provisional slot can leave a gap while inserting visits. Remove a lock
    // that still cannot be honoured, then recheck the resulting directed route.
    if ('orderGap' in state.plan && state.plan.orderGap > 0) {
      let position = 0;
      state.route = state.route.filter(item => {
        if (!('visit' in item)) return true;
        if (item.visit.fixedOrder === undefined || item.visit.fixedOrder === position) {
          position++;
          return true;
        }
        result.unplaced.push({ visitId: item.visit.id, reason: 'FIXED_ORDER', fixed: true });
        return false;
      });
      state.plan = evaluate(state, state.route, input);
    }
    if ('reason' in state.plan) {
      report(day.date, state.plan);
      // A required daily transfer can overflow even with no visit to reject.
      // A closed day at the same location needs no transfer and may remain empty.
      if (state.plan.reason === 'TIME_WINDOW' && (state.available || day.startLocationId !== day.endLocationId)) {
        result.issues.push({ date: day.date, reason: 'TIME_WINDOW' });
      }
      for (const item of state.route) {
        if ('visit' in item) result.unplaced.push({
          visitId: item.visit.id, reason: state.plan.reason, fixed: isFixed(item.visit),
        });
        else result.issues.push({ date: day.date, reason: 'MEAL_UNAVAILABLE', slot: item.slot });
      }
      result.days.push({ date: day.date, timeZone: day.window.timeZone, stops: [], legs: [] });
      continue;
    }
    result.days.push({
      date: day.date,
      timeZone: day.window.timeZone,
      stops: state.plan.stops.map(({ item, ...time }) => 'visit' in item
        ? { kind: 'VISIT', visitId: item.visit.id, ...timestamp(time) }
        : { kind: 'MEAL', slot: item.slot, ...timestamp(time) }),
      legs: state.plan.legs.map(({ start, end, ...leg }) => ({ ...leg, ...timestamp({ start, end }) })),
    });
  }
  return result;
}
