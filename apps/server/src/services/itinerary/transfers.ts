import { Temporal } from '@js-temporal/polyfill';
import type { CityProfile } from '../../fare';
import { selectTravelMode, type RouteOptions } from '../../scheduler';
import type { DayPlan } from './day-plan';
import { compareLeg } from './efficiency';
import type { RouteBook } from './routes';
import type { LegComparison, TransferIssue, TripInputs } from './types';

export type Transfer =
  | { minutes: number; comparison: LegComparison }
  | { minutes: null; from: string; to: string; reason: TransferIssue['reason'] };

export interface TransferContext {
  input: TripInputs;
  profile: CityProfile | null;
  routes: RouteBook;
}

const DEPARTURE_TRANSFER_QUERIES = 4;

/** Airport transfers always carry luggage. */
function transferComparison(context: TransferContext, date: string, from: string, to: string, departure: string, options: RouteOptions): Transfer {
  const fixedMode = context.input.legModes?.find(leg => leg.date === date && leg.from === from && leg.to === to)?.mode;
  const choice = selectTravelMode(options, context.input.taxiPolicy, {
    fixedMode,
    callBufferMinutes: context.profile?.callBufferMinutes, efficiencyThreshold: context.profile?.efficiencyThreshold, luggage: true,
  });
  if (!choice) return { minutes: null, from, to, reason: 'NO_ROUTE' };
  return {
    minutes: Math.ceil(choice.minutes),
    comparison: compareLeg({ date, kind: 'AIRPORT', from, to, departure, selected: { mode: choice.mode, minutes: choice.minutes, fare: choice.fare, fixed: choice.fixed } },
      options, context.profile),
  };
}

/** Airport → lodging, queried at the exact instant immigration ends. */
export async function arrivalTransfer(context: TransferContext, plan: DayPlan): Promise<Transfer | undefined> {
  const arrival = plan.arrival;
  if (!arrival?.transferTo) return;
  const departure = Temporal.Instant.from(arrival.instant).add({ minutes: arrival.immigrationMinutes }).toString();
  const options = await context.routes.route(arrival.airport.id, arrival.transferTo.id, departure);
  return transferComparison(context, plan.date, arrival.airport.id, arrival.transferTo.id, departure, options);
}

/**
 * Lodging → airport must arrive by the check-in buffer. Query backwards from that instant until the
 * duration at the queried departure fits the reserved time. The returned `minutes` (reserved time)
 * and `comparison.departure` are the same verified instant, which the day window then ends at.
 * Without such a departure within the query limit the transfer fails as UNVERIFIED.
 */
export async function departureTransfer(context: TransferContext, plan: DayPlan): Promise<Transfer | undefined> {
  const flight = plan.departure;
  if (!flight?.transferFrom) return;
  const from = flight.transferFrom.id, to = flight.airport.id;
  const arriveBy = Temporal.Instant.from(flight.instant).subtract({ minutes: flight.bufferMinutes });
  let reserved = 0;
  for (let query = 0; query < DEPARTURE_TRANSFER_QUERIES; query++) {
    const departure = arriveBy.subtract({ minutes: reserved }).toString();
    const result = transferComparison(context, plan.date, from, to, departure, await context.routes.route(from, to, departure));
    if (result.minutes === null) return result;
    if (result.minutes <= reserved) return { ...result, minutes: reserved };
    reserved = result.minutes;
  }
  return { minutes: null, from, to, reason: 'UNVERIFIED' };
}
