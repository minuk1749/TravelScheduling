import { applyLegModes } from './constraints';
import type { CityProfile } from '../../fare';
import type { ScheduleResult } from '../../scheduler';
import { MEAL_MINUTES, planDays, tripDates } from './day-plan';
import { prepareDays, type PreparedDay } from './days';
import { compareLeg, summarize } from './efficiency';
import { resolvePlaces, schedulerVisits } from './places';
import { FareConverter, RouteBook } from './routes';
import { MAX_ROUTE_ATTEMPTS, scheduleWithActualRoutes, type VerifiedCapacity } from './verification';
import type { GenerateOutcome, ItineraryDependencies, ItineraryResult, LegComparison, TripInputs } from './types';

export * from './types';
export { MAX_ROUTE_ATTEMPTS } from './verification';
export { MEAL_MINUTES } from './day-plan';

/**
 * T12 itinerary pipeline: stored inputs → places/routes → scheduler stages 1–6 → actual-departure
 * re-query loop (stage 7) → comparisons and efficiency (stage 8) → hash-checked save.
 * All I/O goes through the injected ports; the scheduler stays pure.
 */
export class ItineraryService {
  constructor(private readonly deps: ItineraryDependencies, private readonly maxAttempts = MAX_ROUTE_ATTEMPTS) {
    if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) throw new RangeError('maxAttempts must be a positive integer');
  }

  /** Call only after the session owner has been authorized for `tripId`. */
  async generate(tripId: string): Promise<GenerateOutcome> {
    const load = await this.deps.repository.loadInputs(tripId);
    if (!load) return { status: 'NOT_FOUND' };
    if (load.status === 'INCOMPLETE') return { status: 'INCOMPLETE', fields: load.fields };
    const result = await this.compute(load.input);
    const saved = await this.deps.repository.saveItinerary(tripId, load.inputHash, result);
    return saved.status === 'STALE' ? saved : { status: 'SAVED', itineraryId: saved.itineraryId, inputHash: load.inputHash, result };
  }

  async compute(input: TripInputs): Promise<ItineraryResult> {
    const plans = planDays(input);
    const [profile, places] = await Promise.all([
      this.deps.profiles.findByCityCode(input.cityCode),
      resolvePlaces(this.deps.places, input, tripDates(input.startDate, input.endDate)),
    ]);
    const fares = new FareConverter(profile, input.timeZone);
    const routes = new RouteBook(this.deps.travel, fares, input.timeZone, places.locations);
    const visits = schedulerVisits(input, places);
    const context = { input, profile, routes, visits, mealMinutes: MEAL_MINUTES };
    const prepared = await prepareDays(context, plans);

    const verified = await scheduleWithActualRoutes({
      days: prepared.map(day => applyLegModes(day.day, input.legModes)), visits, mealMinutes: MEAL_MINUTES, taxiPolicy: input.taxiPolicy,
      ...(profile ? { cityProfile: { callBufferMinutes: profile.callBufferMinutes, efficiencyThreshold: profile.efficiencyThreshold } } : {}),
    }, routes, this.maxAttempts);

    const transferIssues = prepared.flatMap(day => day.transferIssues);
    const flightConflicts = prepared.flatMap(day => day.flightConflicts);
    const status = verified.verified && transferIssues.length === 0 && flightConflicts.length === 0
      ? verified.capacity.status : 'CONFLICT';
    const schedule = status === 'CONFLICT' ? null : verified.capacity.recommendation?.schedule ?? null;
    const comparisons = schedule ? legComparisons(schedule, prepared, verified, profile) : [];
    return {
      status,
      capacity: verified.capacity,
      availableByDate: Object.fromEntries(prepared.map(({ day }) => [day.date, day.window.available])),
      verification: { verified: verified.verified, attempts: verified.attempts },
      transferIssues,
      flightConflicts,
      skippedMeals: prepared.flatMap(day => day.skippedMeals),
      comparisons,
      efficiency: schedule ? summarize(comparisons, fares.currency) : null,
    };
  }
}

/** Stage 8: airport transfer, then the daily legs in route order, for every date. */
function legComparisons(schedule: ScheduleResult, prepared: readonly PreparedDay[], verified: VerifiedCapacity, profile: CityProfile | null): LegComparison[] {
  const byDate = new Map(schedule.days.map(day => [day.date, day]));
  return prepared.flatMap(({ day: { date }, arrival, departure }) => {
    const legs = (byDate.get(date)?.legs ?? []).map(leg => {
      const options = verified.actual(date, leg.from, leg.to);
      if (!options) throw new Error('Verified leg without actual-departure route');
      const minutes = (Date.parse(leg.end) - Date.parse(leg.start)) / 60_000;
      return compareLeg({
        date, kind: 'DAY', from: leg.from, to: leg.to, departure: leg.start,
        selected: { mode: leg.mode, minutes, fare: leg.fare, fixed: leg.fixed },
      }, options, profile);
    });
    return [...(arrival ? [arrival] : []), ...legs, ...(departure ? [departure] : [])];
  });
}
