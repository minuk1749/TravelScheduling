import { checkCapacity, type CapacityResult, type RouteOptions, type ScheduleInput, type ScheduleResult, type SchedulingDay } from '../../scheduler';
import type { RouteBook } from './routes';

/**
 * Re-schedule rounds (ADR 0008). On the Tokyo sample (tests/itinerary-service.test.ts) the OK
 * trip verifies in round 5 and the over-capacity trip in round 3: partially replaced route tables
 * can move visits between days, so a few rounds are normal. Each round costs one capacity search
 * (tens of ms) plus at most one route query per unverified leg; 8 leaves margin over the sample.
 */
export const MAX_ROUTE_ATTEMPTS = 8;

type Override = { departure: string; options: RouteOptions };
/** date → from → to → actual-departure route. */
type Overrides = Map<string, Map<string, Map<string, Override>>>;
type PendingLeg = { date: string; from: string; to: string; start: string };

export interface VerifiedCapacity {
  capacity: CapacityResult;
  verified: boolean;
  attempts: number;
  /** Actual-departure options used for a leg of the verified schedule. */
  actual(date: string, from: string, to: string): RouteOptions | undefined;
}

function withOverrides(day: SchedulingDay, overrides: Overrides): SchedulingDay {
  const changed = overrides.get(day.date);
  if (!changed) return day;
  const routes = new Map(day.routes);
  for (const [from, targets] of changed) {
    const row = new Map(day.routes.get(from));
    for (const [to, { options }] of targets) row.set(to, options);
    routes.set(from, row);
  }
  return { ...day, routes };
}

function pendingLegs(schedule: ScheduleResult, overrides: Overrides): PendingLeg[] {
  return schedule.days.flatMap(day => day.legs
    .filter(leg => overrides.get(day.date)?.get(leg.from)?.get(leg.to)?.departure !== leg.start)
    .map(leg => ({ date: day.date, from: leg.from, to: leg.to, start: leg.start })));
}

function remember(overrides: Overrides, leg: PendingLeg, options: RouteOptions): void {
  let day = overrides.get(leg.date);
  if (!day) overrides.set(leg.date, day = new Map());
  let row = day.get(leg.from);
  if (!row) day.set(leg.from, row = new Map());
  row.set(leg.to, { departure: leg.start, options });
}

/**
 * Stage 7: schedule with representative matrices, re-query every chosen leg at its actual
 * departure, and re-run stages 3–6 with those routes (which re-checks opening hours and
 * windows) until every leg of the result was priced at its own departure. Stops at the attempt
 * cap or when the same unverified legs repeat; an unverified result is never reported as OK.
 */
export async function scheduleWithActualRoutes(input: ScheduleInput, routes: RouteBook, maxAttempts = MAX_ROUTE_ATTEMPTS): Promise<VerifiedCapacity> {
  const overrides: Overrides = new Map();
  const seen = new Set<string>();
  for (let attempt = 1; ; attempt++) {
    const capacity = checkCapacity({ ...input, days: input.days.map(day => withOverrides(day, overrides)) });
    const schedule = capacity.recommendation?.schedule;
    const pending = schedule ? pendingLegs(schedule, overrides) : [];
    const signature = JSON.stringify(pending);
    if (pending.length === 0 || attempt >= maxAttempts || seen.has(signature)) {
      return {
        capacity, verified: pending.length === 0, attempts: attempt,
        actual: (date, from, to) => overrides.get(date)?.get(from)?.get(to)?.options,
      };
    }
    seen.add(signature);
    const results = await Promise.all(pending.map(leg => routes.route(leg.from, leg.to, leg.start)));
    pending.forEach((leg, index) => remember(overrides, leg, results[index]));
  }
}
