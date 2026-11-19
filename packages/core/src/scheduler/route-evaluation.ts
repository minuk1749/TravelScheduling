import { Temporal } from '@js-temporal/polyfill';
import type { MealSlot, TimeWindow } from './index';
import type { Visit, SchedulingDay, ScheduleInput, ScheduleResult } from './placement-types';
import { selectTravelMode } from './transport';

export type Interval = { start: number; end: number };
export type Item = {
  length: number;
  windows?: Interval[];
} & ({ visit: Visit; fixedStart?: number } | { slot: MealSlot });

export type Evaluation = {
  stops: (Interval & { item: Item })[];
  legs: (Interval & Omit<ScheduleResult['days'][number]['legs'][number], 'start' | 'end'>)[];
  travel: number;
  orderGap: number;
};
type Unreachable = { reason: 'UNREACHABLE'; from: string; to: string };
export type Rejection = Unreachable | { reason: 'TIME_WINDOW' | 'FIXED_ORDER' };
export type DayState = { day: SchedulingDay; available: Interval | null; route: Item[]; plan: Evaluation | Rejection };
export type InsertFailure = { date?: string; failure: Rejection };

const minute = 60_000;
export const instant = (value: string): number => Temporal.Instant.from(value).epochMilliseconds;

export function interval(window: TimeWindow): Interval {
  const start = instant(window.start);
  const end = instant(window.end);
  if (end <= start) throw new RangeError('Window must end after it starts');
  return { start, end };
}

export function lengthInMilliseconds(minutes: number): number {
  if (!Number.isFinite(minutes) || minutes < 0) throw new RangeError('Minutes must be nonnegative and finite');
  return Math.ceil(minutes * minute);
}
export const timestamp = ({ start, end }: Interval): TimeWindow => ({
  start: new Date(start).toISOString(),
  end: new Date(end).toISOString(),
});

export function evaluate({ day, available }: Pick<DayState, 'day' | 'available'>, route: readonly Item[], input: ScheduleInput): Evaluation | Rejection {
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

