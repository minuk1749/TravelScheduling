import { Temporal } from '@js-temporal/polyfill';
import type { CityProfile } from '../../fare';
import {
  calculateDayWindow, selectTravelMode, type DayWindowResult, type MealSlot, type RouteOptions,
  type SchedulingDay, type Visit,
} from '../../scheduler';
import type { DayPlan } from './day-plan';
import { compareLeg } from './efficiency';
import type { RouteBook } from './routes';
import { ItineraryInputError, type ItineraryResult, type LegComparison, type TripInputs } from './types';

type Transfer = { minutes: number; comparison: LegComparison } | { minutes: null; from: string; to: string };

export interface PreparedDay {
  day: SchedulingDay;
  arrival?: LegComparison;
  departure?: LegComparison;
  transferIssues: ItineraryResult['transferIssues'][number][];
  skippedMeals: { date: string; slot: MealSlot }[];
}

export interface DayContext {
  input: TripInputs;
  profile: CityProfile | null;
  routes: RouteBook;
  visits: readonly Visit[];
  mealMinutes: Readonly<Record<MealSlot, number>>;
}

const DEPARTURE_TRANSFER_QUERIES = 4;

function choose(context: DayContext, options: RouteOptions) {
  return selectTravelMode(options, context.input.taxiPolicy, {
    callBufferMinutes: context.profile?.callBufferMinutes, efficiencyThreshold: context.profile?.efficiencyThreshold, luggage: true,
  });
}

function transferComparison(context: DayContext, date: string, from: string, to: string, departure: string, options: RouteOptions): Transfer {
  const choice = choose(context, options);
  if (!choice) return { minutes: null, from, to };
  return {
    minutes: Math.ceil(choice.minutes),
    comparison: compareLeg({ date, kind: 'AIRPORT', from, to, departure, selected: { mode: choice.mode, minutes: choice.minutes, fare: choice.fare, fixed: false } },
      options, context.profile),
  };
}

/** Airport → lodging, queried at the exact instant immigration ends. */
async function arrivalTransfer(context: DayContext, plan: DayPlan): Promise<Transfer | undefined> {
  const arrival = plan.arrival;
  if (!arrival?.transferTo) return;
  const departure = Temporal.Instant.from(arrival.instant).add({ minutes: arrival.immigrationMinutes }).toString();
  const options = await context.routes.route(arrival.airport.id, arrival.transferTo.id, departure);
  return transferComparison(context, plan.date, arrival.airport.id, arrival.transferTo.id, departure, options);
}

/**
 * Lodging → airport must arrive by the check-in buffer. Query backwards from that instant until the
 * duration at the queried departure fits the reserved time (a conservative, exactly queried departure).
 */
async function departureTransfer(context: DayContext, plan: DayPlan): Promise<Transfer | undefined> {
  const flight = plan.departure;
  if (!flight?.transferFrom) return;
  const from = flight.transferFrom.id, to = flight.airport.id;
  const arriveBy = Temporal.Instant.from(flight.instant).subtract({ minutes: flight.bufferMinutes });
  let reserved = 0;
  let transfer: Transfer = { minutes: null, from, to };
  for (let query = 0; query < DEPARTURE_TRANSFER_QUERIES; query++) {
    const departure = arriveBy.subtract({ minutes: reserved }).toString();
    const result = transferComparison(context, plan.date, from, to, departure, await context.routes.route(from, to, departure));
    if (result.minutes === null) return result;
    transfer = result;
    if (result.minutes <= reserved) return { ...result, minutes: reserved };
    reserved = result.minutes;
  }
  return transfer;
}

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

/** On flight days, a meal whose window cannot hold it around the flight is skipped, not a conflict. */
function flightDayMeals(context: DayContext, plan: DayPlan, window: DayWindowResult) {
  const skipped: PreparedDay['skippedMeals'] = [];
  if (!plan.arrival && !plan.departure) return { window, skipped };
  const meals = window.meals.filter(({ slot, window: meal }) => {
    const usable = meal !== null && Temporal.Instant.from(meal.end).epochMilliseconds -
      Temporal.Instant.from(meal.start).epochMilliseconds >= context.mealMinutes[slot] * 60_000;
    if (!usable) skipped.push({ date: plan.date, slot });
    return usable;
  });
  return { window: { ...window, meals }, skipped };
}

/** Stages 1–2 for one date plus the representative-departure matrix used for ordering. */
export async function prepareDay(context: DayContext, plan: DayPlan): Promise<PreparedDay> {
  const [arrival, departure] = await Promise.all([arrivalTransfer(context, plan), departureTransfer(context, plan)]);
  const transferIssues: PreparedDay['transferIssues'] = [];
  if (arrival?.minutes === null) transferIssues.push({ date: plan.date, direction: 'ARRIVAL', from: arrival.from, to: arrival.to });
  if (departure?.minutes === null) transferIssues.push({ date: plan.date, direction: 'DEPARTURE', from: departure.from, to: departure.to });
  const meals = flightDayMeals(context, plan, dayWindow(context, plan, arrival, departure));
  // Without a permitted airport route the day cannot be used; the service reports CONFLICT.
  const window = transferIssues.length
    ? { ...meals.window, available: null, meals: meals.window.meals.map(({ slot }) => ({ slot, window: null })) }
    : meals.window;

  // Every visit that may land on this date; the scheduler decides which ones it places.
  const ids = [plan.start.id, plan.end.id, ...context.visits
    .filter(visit => visit.fixedDate === undefined || visit.fixedDate === plan.date)
    .map(visit => visit.locationId)];
  const routes = window.available ? await context.routes.matrix(ids, window.available.start) : new Map();
  const luggage = plan.luggageInto;
  const legSettings = luggage && new Map(ids.map(id => [id, new Map([[luggage.id, { luggage: true }]])]));
  return {
    day: { date: plan.date, window, startLocationId: plan.start.id, endLocationId: plan.end.id, routes, ...(legSettings ? { legSettings } : {}) },
    ...(arrival?.minutes != null ? { arrival: arrival.comparison } : {}),
    ...(departure?.minutes != null ? { departure: departure.comparison } : {}),
    transferIssues,
    skippedMeals: meals.skipped,
  };
}
