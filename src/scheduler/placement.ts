import { Temporal } from '@js-temporal/polyfill';
import type { CityProfile } from '../fare';
import type { DayWindowResult, MealSlot, TimeWindow } from './index';
import { selectTravelMode, type RouteOptions, type TaxiPolicy, type TravelMode } from './transport';

export interface Visit {
  id: string;
  locationId: string;
  coordinates: { latitude: number; longitude: number };
  minutes: number;
  priority: 'REQUIRED' | 'WISH';
  fixedDate?: string;
  /** Instant with an explicit UTC offset. */
  fixedStart?: string;
  /** Zero-based position among visits on the day. */
  fixedOrder?: number;
  /** Instant windows for the entire trip. Omit when hours are unknown. */
  openingHours?: readonly TimeWindow[];
}

export interface SchedulingDay {
  date: string;
  window: DayWindowResult;
  startLocationId: string;
  endLocationId: string;
  routes: ReadonlyMap<string, ReadonlyMap<string, RouteOptions>>;
  /** Overrides and luggage flags apply to directed pairs on this date. */
  legSettings?: ReadonlyMap<string, ReadonlyMap<string, { mode?: TravelMode; luggage?: boolean }>>;
}

export interface ScheduleInput {
  days: readonly SchedulingDay[];
  visits: readonly Visit[];
  mealMinutes: Readonly<Record<MealSlot, number>>;
  taxiPolicy: TaxiPolicy;
  cityProfile?: Pick<CityProfile, 'callBufferMinutes' | 'efficiencyThreshold'>;
}

type Timed = { start: string; end: string };
type Stop = Timed & ({ kind: 'VISIT'; visitId: string } | { kind: 'MEAL'; slot: MealSlot });
type Leg = Timed & {
  from: string;
  to: string;
  mode: TravelMode;
  fixed: boolean;
  fare: number | null;
};
type Failure = 'TIME_WINDOW' | 'UNREACHABLE' | 'FIXED_ORDER';

export interface ScheduleResult {
  days: { date: string; timeZone: string; stops: Stop[]; legs: Leg[] }[];
  unplaced: { visitId: string; reason: Failure | 'WISH'; fixed: boolean }[];
  issues: (
    | { date: string; reason: 'MEAL_UNAVAILABLE'; slot: MealSlot }
    | { date: string; reason: 'UNREACHABLE'; from: string; to: string }
  )[];
}

type Interval = { start: number; end: number };
type Item = {
  length: number;
  windows?: Interval[];
} & ({ visit: Visit; fixedStart?: number } | { slot: MealSlot });

type Evaluation = {
  stops: (Interval & { item: Item })[];
  legs: (Interval & Omit<Leg, keyof Timed>)[];
  travel: number;
  orderGap: number;
};
type Unreachable = { reason: 'UNREACHABLE'; from: string; to: string };
type Rejection = Unreachable | { reason: Exclude<Failure, 'UNREACHABLE'> };
type DayState = { day: SchedulingDay; available: Interval | null; route: Item[]; plan: Evaluation | Rejection };
type InsertFailure = { date?: string; failure: Rejection };

const minute = 60_000;
const instant = (value: string): number => Temporal.Instant.from(value).epochMilliseconds;

function interval(window: TimeWindow): Interval {
  const start = instant(window.start);
  const end = instant(window.end);
  if (end <= start) throw new RangeError('Window must end after it starts');
  return { start, end };
}

function lengthInMilliseconds(minutes: number): number {
  if (!Number.isFinite(minutes) || minutes < 0) throw new RangeError('Minutes must be nonnegative and finite');
  return Math.ceil(minutes * minute);
}
const timestamp = ({ start, end }: Interval): Timed => ({
  start: new Date(start).toISOString(),
  end: new Date(end).toISOString(),
});

function isFixed(visit: Visit): boolean {
  return visit.fixedDate !== undefined || visit.fixedStart !== undefined || visit.fixedOrder !== undefined;
}

function evaluate({ day, available }: Pick<DayState, 'day' | 'available'>, route: readonly Item[], input: ScheduleInput): Evaluation | Rejection {
  if (!available) return { reason: 'TIME_WINDOW' };

  const stops: Evaluation['stops'] = [];
  const legs: Evaluation['legs'] = [];
  let time = available.start;
  let location = day.startLocationId;
  let travel = 0;
  let visitIndex = 0;
  let orderGap = 0;

  function move(to: string): Unreachable | undefined {
    const settings = day.legSettings?.get(location)?.get(to);
    if (location === to && !settings?.mode) return;
    const options = day.routes.get(location)?.get(to);
    const choice = options && selectTravelMode(options, input.taxiPolicy, {
      ...input.cityProfile,
      luggage: settings?.luggage,
      fixedMode: settings?.mode,
    });
    if (!choice) return { reason: 'UNREACHABLE', from: location, to };
    const end = time + lengthInMilliseconds(choice.minutes);
    legs.push({ from: location, to, start: time, end, mode: choice.mode, fixed: choice.fixed, fare: choice.fare });
    travel += end - time;
    time = end;
    location = to;
  }

  for (const item of route) {
    let fixedStart: number | undefined;
    if ('visit' in item) {
      const order = item.visit.fixedOrder;
      if (order !== undefined) {
        const gap = order - visitIndex;
        if (gap < orderGap) return { reason: 'FIXED_ORDER' };
        orderGap = gap;
      }
      visitIndex++;
      fixedStart = item.fixedStart;
      const failure = move(item.visit.locationId);
      if (failure) return failure;
    }

    // The earliest feasible start leaves the most time for subsequent stops.
    let start = fixedStart ?? time;
    if (start < time) return { reason: 'TIME_WINDOW' };
    if (item.windows) {
      let earliest = Infinity;
      for (const window of item.windows) {
        const candidate = fixedStart ?? Math.max(time, window.start);
        if (candidate >= window.start && candidate + item.length <= window.end) {
          earliest = Math.min(earliest, candidate);
        }
      }
      start = earliest;
    }
    const end = start + item.length;
    if (!(end <= available.end)) return { reason: 'TIME_WINDOW' };
    stops.push({ start, end, item });
    time = end;
  }

  const failure = move(day.endLocationId);
  if (failure) return failure;
  if (time > available.end) return { reason: 'TIME_WINDOW' };
  return { stops, legs, travel, orderGap };
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
