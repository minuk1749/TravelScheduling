import { Temporal } from '@js-temporal/polyfill';
import { isFixed, isPlaceable as isRequested, scheduleVisits, type ScheduleInput, type ScheduleResult, type Visit } from './placement';
import { selectTravelMode } from './transport';

export interface CapacityTimeSummary {
  availableMinutes: number;
  visitMinutes: number;
  mealMinutes: number;
  /** Minimum incoming travel per visit and return per usable day; excludes waiting. */
  travelMinutesLowerBound: number | null;
  /** Null when a necessary incoming/return route has no permitted mode. */
  requiredMinutesLowerBound: number | null;
}

export interface CapacityRecommendation {
  /** A feasible heuristic count, not a mathematical maximum. Includes fixed REQUIRED visits. */
  requiredCount: number;
  requiredVisitIds: string[];
  /** Witness computed from the original input order, with every fixed visit preserved. */
  schedule: ScheduleResult;
}

type CapacityDetails = {
  time: CapacityTimeSummary;
  /** Rejected visits in the full requested combination, excluding unpinned wishes. */
  unplaced: ScheduleResult['unplaced'];
  issues: ScheduleResult['issues'];
};

export type CapacityResult = CapacityDetails & (
  | { status: 'OK' | 'OVER_CAPACITY'; recommendation: CapacityRecommendation }
  | { status: 'CONFLICT'; recommendation: null }
);

const minutesBetween = (start: string, end: string) =>
  (Temporal.Instant.from(end).epochMilliseconds - Temporal.Instant.from(start).epochMilliseconds) / 60_000;

function timeSummary(input: ScheduleInput): CapacityTimeSummary {
  const visits = input.visits.filter(isRequested);
  let availableMinutes = 0;
  let mealMinutes = 0;
  let travelMinutes = 0;
  const incoming = new Map(visits.map(visit => [visit.id, Infinity]));
  for (const day of input.days) {
    mealMinutes += day.window.meals.reduce((sum, { slot }) => sum + input.mealMinutes[slot], 0);
    if (!day.window.available) continue;
    availableMinutes += minutesBetween(day.window.available.start, day.window.available.end);
    const eligible = visits.filter(visit => visit.fixedDate === undefined || visit.fixedDate === day.date);
    const travel = (from: string, to: string): number => {
      const settings = day.legSettings?.get(from)?.get(to);
      if (from === to && !settings?.mode) return 0;
      const routes = day.routes.get(from)?.get(to);
      const choice = routes && selectTravelMode(routes, input.taxiPolicy, {
        ...input.cityProfile, luggage: settings?.luggage, fixedMode: settings?.mode,
      });
      return choice ? Math.ceil(choice.minutes * 60_000) / 60_000 : Infinity;
    };
    for (const visit of eligible) {
      // Each visit has an incoming leg. Relax ordering and hours to obtain a
      // lower bound, allowing other visits at the same location as predecessors.
      const predecessors = [day.startLocationId, ...eligible.filter(other => other.id !== visit.id).map(other => other.locationId)];
      incoming.set(visit.id, Math.min(incoming.get(visit.id)!, ...predecessors.map(from => travel(from, visit.locationId))));
    }
    travelMinutes += Math.min(...[day.startLocationId, ...eligible.map(visit => visit.locationId)]
      .map(from => travel(from, day.endLocationId)));
  }
  travelMinutes += [...incoming.values()].reduce((sum, value) => sum + value, 0);
  const visitMinutes = visits.reduce((sum, visit) => sum + visit.minutes, 0);
  const travelMinutesLowerBound = Number.isFinite(travelMinutes) ? travelMinutes : null;
  return {
    availableMinutes, visitMinutes, mealMinutes, travelMinutesLowerBound,
    requiredMinutesLowerBound: travelMinutesLowerBound === null ? null : visitMinutes + mealMinutes + travelMinutesLowerBound,
  };
}

const isFeasible = (schedule: ScheduleResult) =>
  schedule.unplaced.every(item => item.reason === 'WISH') && schedule.issues.length === 0;

/**
 * Stage 3: check actual placement, then search for a verified smaller combination.
 * To revalidate a user's selection, mark only their chosen movable visits REQUIRED
 * and call again. Fixed visits (including pinned wishes) always remain constraints.
 */
export function checkCapacity(input: ScheduleInput): CapacityResult {
  if (new Set(input.visits.map(visit => visit.id)).size !== input.visits.length) {
    throw new RangeError('Visit ids must be unique');
  }
  const full = scheduleVisits(input);
  const details: CapacityDetails = {
    time: timeSummary(input),
    unplaced: full.unplaced.filter(item => item.reason !== 'WISH'),
    issues: full.issues,
  };
  const recommendation = (visits: readonly Visit[], schedule: ScheduleResult): CapacityRecommendation => {
    const requiredVisitIds = visits.filter(visit => visit.priority === 'REQUIRED').map(visit => visit.id);
    return { requiredCount: requiredVisitIds.length, requiredVisitIds, schedule };
  };
  if (isFeasible(full)) return { ...details, status: 'OK', recommendation: recommendation(input.visits, full) };

  const movable = input.visits.filter(visit => visit.priority === 'REQUIRED' && !isFixed(visit));
  const shortestFirst = [...movable].sort((a, b) => a.minutes - b.minutes);
  const probe = (selected: ReadonlySet<string>) => {
    // Preserve the original order so selecting these ids reproduces the witness.
    const visits = input.visits.filter(visit => !isRequested(visit) || isFixed(visit) || selected.has(visit.id));
    return { visits, schedule: scheduleVisits({ ...input, visits }) };
  };
  let best: CapacityRecommendation | null = null;

  // Recheck after removing rejected visits: deleting a stop can break a directed
  // route or an absolute fixed-order position, so the partial plan is not proof.
  const selected = new Set(movable.map(visit => visit.id));
  let trial = { visits: input.visits, schedule: full };
  while (true) {
    if (isFeasible(trial.schedule)) {
      best = recommendation(trial.visits, trial.schedule);
      break;
    }
    const rejected = trial.schedule.unplaced.filter(item => selected.has(item.visitId));
    if (rejected.length === 0) break;
    for (const item of rejected) selected.delete(item.visitId);
    trial = probe(selected);
  }

  // A long early visit can crowd out many short ones. Try bounded, deterministic
  // alternatives, retaining all fixed constraints and stopping below our best N.
  const shorter = new Set(movable.map(visit => visit.id));
  for (const visit of [...shortestFirst].reverse()) {
    shorter.delete(visit.id);
    const candidate = probe(shorter);
    const count = candidate.visits.filter(visit => visit.priority === 'REQUIRED').length;
    if (best && count <= best.requiredCount) break;
    if (isFeasible(candidate.schedule)) {
      best = recommendation(candidate.visits, candidate.schedule);
      break;
    }
  }

  if (best) {
    const chosen = new Set(best.requiredVisitIds);
    for (const visit of shortestFirst) {
      if (chosen.has(visit.id)) continue;
      chosen.add(visit.id);
      const candidate = probe(chosen);
      if (isFeasible(candidate.schedule)) best = recommendation(candidate.visits, candidate.schedule);
      else chosen.delete(visit.id);
    }
  }
  return best
    ? { ...details, status: 'OVER_CAPACITY', recommendation: best }
    : { ...details, status: 'CONFLICT', recommendation: null };
}
