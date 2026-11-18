import { Temporal } from '@js-temporal/polyfill';
import {
  calculateDayWindow, isPlaceable, type DayWindowResult, type MealSlot, type SchedulingDay, type TimeWindow, type Visit,
} from '../../scheduler';
import type { DayPlan } from './day-plan';
import { arrivalTransfer, departureTransfer, type Transfer, type TransferContext } from './transfers';
import { ItineraryInputError, type FlightConflict, type LegComparison, type TransferIssue } from './types';

export interface PreparedDay {
  day: SchedulingDay;
  arrival?: LegComparison;
  departure?: LegComparison;
  transferIssues: TransferIssue[];
  flightConflicts: FlightConflict[];
  skippedMeals: { date: string; slot: MealSlot }[];
}

export interface DayContext extends TransferContext {
  visits: readonly Visit[];
  mealMinutes: Readonly<Record<MealSlot, number>>;
}

/** Stages 1–2 for one date before other dates' airport transfers are applied. */
interface Draft {
  plan: DayPlan;
  arrival?: Transfer;
  departure?: Transfer;
  window: DayWindowResult;
}

type Occupied = DayWindowResult['airportTransfers'][number] & { date: string };

const compare = (a: string, b: string) => Temporal.Instant.compare(Temporal.Instant.from(a), Temporal.Instant.from(b));
const later = (a: string, b: string) => compare(a, b) >= 0 ? a : b;
const earlier = (a: string, b: string) => compare(a, b) <= 0 ? a : b;
const asWindow = (start: string, end: string): TimeWindow | null => compare(start, end) < 0 ? { start, end } : null;

function dayWindow(context: DayContext, plan: DayPlan, arrival?: Transfer, departure?: Transfer): DayWindowResult {
  const { input } = context;
  try {
    return calculateDayWindow({
      date: plan.date, timeZone: input.timeZone, activity: plan.activity, mealCount: plan.mealCount, mealWindows: input.mealWindows,
      ...(plan.arrival ? { arrival: {
        localDateTime: plan.arrival.localDateTime, travelMinutes: arrival?.minutes ?? 0,
        immigrationMinutes: plan.arrival.immigrationMinutes, viaLodging: plan.arrival.transferTo !== undefined,
      } } : {}),
      ...(plan.departure ? { departure: {
        localDateTime: plan.departure.localDateTime, travelMinutes: departure?.minutes ?? 0,
        airportBufferMinutes: plan.departure.bufferMinutes, viaLodging: plan.departure.transferFrom !== undefined,
      } } : {}),
    });
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    throw new ItineraryInputError({ [`daySettings.${plan.date}`]: '활동·식사 시간은 같은 날 안에서 끝나는 유효한 현지 시각이어야 합니다.' });
  }
}

async function draftDay(context: DayContext, plan: DayPlan): Promise<Draft> {
  const [arrival, departure] = await Promise.all([arrivalTransfer(context, plan), departureTransfer(context, plan)]);
  return { plan, arrival, departure, window: dayWindow(context, plan, arrival, departure) };
}

/**
 * An airport transfer can cross midnight (late arrival, early-morning departure). Its instant range
 * then also bounds the adjacent dates: nothing may start before an arrival transfer ends or end
 * after a departure transfer starts. Same-date transfers are already applied by the scheduler.
 */
function clipToTransfers(window: DayWindowResult, date: string, occupied: readonly Occupied[]): { window: DayWindowResult; clipped: boolean } {
  let available = window.available;
  let clipped = false;
  for (const transfer of occupied) {
    if (!available || transfer.date === date) continue;
    if (compare(transfer.end, available.start) <= 0 || compare(available.end, transfer.start) <= 0) continue;
    clipped = true;
    available = transfer.direction === 'arrival'
      ? asWindow(later(available.start, transfer.end), available.end)
      : asWindow(available.start, earlier(available.end, transfer.start));
  }
  if (!clipped) return { window, clipped };
  const meals = window.meals.map(({ slot, window: meal }) => ({
    slot, window: available && meal ? asWindow(later(meal.start, available.start), earlier(meal.end, available.end)) : null,
  }));
  return { window: { ...window, available, meals }, clipped };
}

type TripConflict = { conflict: FlightConflict; dates: readonly string[] };

/** Immigration and the arrival transfer must finish before the departure transfer has to start, on any dates. */
function flightConflicts(occupied: readonly Occupied[]): TripConflict[] {
  return occupied.filter(transfer => transfer.direction === 'departure').flatMap(departure => occupied
    .filter(arrival => arrival.direction === 'arrival' && compare(arrival.end, departure.start) > 0)
    .map(arrival => ({
      conflict: { date: departure.date, arrivalReadyAt: arrival.end, departureStartBy: departure.start },
      dates: [arrival.date, departure.date],
    })));
}

/** On flight-constrained days, a meal whose window cannot hold it around the flight is skipped, not a conflict. */
function skipUnusableMeals(context: DayContext, date: string, window: DayWindowResult) {
  const skipped: PreparedDay['skippedMeals'] = [];
  const meals = window.meals.filter(({ slot, window: meal }) => {
    const usable = meal !== null && Temporal.Instant.from(meal.end).epochMilliseconds -
      Temporal.Instant.from(meal.start).epochMilliseconds >= context.mealMinutes[slot] * 60_000;
    if (!usable) skipped.push({ date, slot });
    return usable;
  });
  return { window: { ...window, meals }, skipped };
}

/** Luggage-carrying daily legs: every leg on a day trip without lodging, or the legs into a direct-to-airport end. */
function luggageLegs(plan: DayPlan, ids: readonly string[]): SchedulingDay['legSettings'] {
  if (!plan.luggage) return undefined;
  const targets = plan.luggage === 'ALL_LEGS' ? ids : [plan.end.id];
  return new Map(ids.map(id => [id, new Map(targets.map(target => [target, { luggage: true }]))]));
}

async function finishDay(context: DayContext, draft: Draft, occupied: readonly Occupied[], conflicts: readonly TripConflict[]): Promise<PreparedDay> {
  const { plan, arrival, departure } = draft;
  const transferIssues: TransferIssue[] = [];
  if (arrival?.minutes === null) transferIssues.push({ date: plan.date, direction: 'ARRIVAL', from: arrival.from, to: arrival.to, reason: arrival.reason });
  if (departure?.minutes === null) transferIssues.push({ date: plan.date, direction: 'DEPARTURE', from: departure.from, to: departure.to, reason: departure.reason });
  const clipped = clipToTransfers(draft.window, plan.date, occupied);
  const meals = plan.arrival || plan.departure || clipped.clipped
    ? skipUnusableMeals(context, plan.date, clipped.window) : { window: clipped.window, skipped: [] };
  // A failed airport transfer or overlapping flight constraints make the day unusable; the service reports CONFLICT.
  const window = transferIssues.length || conflicts.some(({ dates }) => dates.includes(plan.date))
    ? { ...meals.window, available: null, meals: meals.window.meals.map(({ slot }) => ({ slot, window: null })) }
    : meals.window;

  // Only visits the scheduler may place on this date; unpinned wishes are never routed.
  const ids = [...new Set([plan.start.id, plan.end.id, ...context.visits
    .filter(visit => isPlaceable(visit) && (visit.fixedDate === undefined || visit.fixedDate === plan.date))
    .map(visit => visit.locationId)])];
  const routes = window.available ? await context.routes.matrix(ids, window.available.start) : new Map();
  const legSettings = luggageLegs(plan, ids);
  return {
    day: { date: plan.date, window, startLocationId: plan.start.id, endLocationId: plan.end.id, routes, ...(legSettings ? { legSettings } : {}) },
    ...(arrival?.minutes != null ? { arrival: arrival.comparison } : {}),
    ...(departure?.minutes != null ? { departure: departure.comparison } : {}),
    transferIssues,
    flightConflicts: conflicts.filter(({ conflict }) => conflict.date === plan.date).map(({ conflict }) => conflict),
    skippedMeals: meals.skipped,
  };
}

/**
 * Stages 1–2 for every date plus the representative-departure matrix used for ordering. Airport
 * transfers are queried first so that each date's window also respects transfers of other dates.
 */
export async function prepareDays(context: DayContext, plans: readonly DayPlan[]): Promise<PreparedDay[]> {
  const drafts = await Promise.all(plans.map(plan => draftDay(context, plan)));
  const occupied = drafts.flatMap(({ plan, window }) => window.airportTransfers.map(transfer => ({ ...transfer, date: plan.date })));
  const conflicts = flightConflicts(occupied);
  return Promise.all(drafts.map(draft => finishDay(context, draft, occupied, conflicts)));
}
