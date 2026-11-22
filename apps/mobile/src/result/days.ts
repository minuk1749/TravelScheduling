import { Temporal } from '@js-temporal/polyfill';
import type { ItineraryResult, LegComparison } from '@travel/core/contracts/itinerary';
import type { ResultView } from '@travel/core/contracts/results/model';
import { displayedSchedule, placeName } from '@travel/core/presentation';
import type { MealSlot, RouteEstimate } from '@travel/core/scheduler';
import { CITY_CENTRES, isOutsideCityCentre, legColor } from '../map/geometry';
import type { LatLng, TravelModeName } from '../map/types';
import type { ConflictCause } from './conflicts';
import { fixedLabel, minutesBetween } from './format';

export type LegModel = {
  key: string; order: number; date: string; kind: LegComparison['kind'];
  from: string; to: string; fromName: string; toName: string;
  departure: string; arrival: string;
  mode: TravelModeName; minutes: number; fare: number | null; fixed: boolean;
  /** Switch chip target; null for walking legs. A null estimate is "택시 정보 없음". */
  swap: { mode: 'TRANSIT' | 'TAXI'; estimate: RouteEstimate | null } | null;
  outside: boolean; color: string;
  fromPoint: LatLng | null; toPoint: LatLng | null;
};

export type CardModel = {
  visitId: string; placeId: string;
  /** 1-based visit number of the day; null for a conflict cause that has no position. */
  number: number | null;
  name: string; kind: 'RESTAURANT' | 'ATTRACTION'; stay: number;
  start: string | null; end: string | null;
  fixed: string | null;
  arrival: LegModel | null; departure: LegModel | null;
  /** Minutes between arriving and the visit start. */
  wait: number;
  /** Arrival at the lodging after the day's last visit. */
  returnAt: string | null;
  /** Minutes later (+) or earlier (−) than the previous calculation on the same date. */
  shift: number;
  changed: boolean;
  issue: string | null;
};

export type EndpointRole = 'LODGING_OUT' | 'LODGING_IN' | 'AIRPORT_ARRIVAL' | 'AIRPORT_DEPARTURE';
export type TimelineRow =
  | { kind: 'VISIT'; at: string; card: CardModel }
  | { kind: 'MEAL'; at: string; end: string; slot: MealSlot }
  | { kind: 'LEG'; at: string; leg: LegModel }
  | { kind: 'ENDPOINT'; at: string; role: EndpointRole; name: string };

export type DayModel = {
  date: string; number: number; timeZone: string;
  cards: CardModel[]; legs: LegModel[]; rows: TimelineRow[];
  start: string | null; end: string | null; travelMinutes: number;
};

export const legKey = (leg: Pick<LegComparison, 'date' | 'kind' | 'from' | 'to'>) => [leg.date, leg.kind, leg.from, leg.to].join('|');

export function tripDates(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const end = Temporal.PlainDate.from(endDate);
  for (let date = Temporal.PlainDate.from(startDate); Temporal.PlainDate.compare(date, end) <= 0; date = date.add({ days: 1 })) {
    dates.push(date.toString());
  }
  return dates;
}

type Role = 'VISIT' | 'LODGING' | 'AIRPORT';
function placeRoles(view: ResultView): Map<string, Role> {
  const roles = new Map<string, Role>();
  for (const flight of view.input.flights) roles.set(flight.airport.id, 'AIRPORT');
  for (const lodging of view.input.lodgings) roles.set(lodging.place.id, 'LODGING');
  for (const visit of view.input.visits) roles.set(visit.place.id, 'VISIT');
  return roles;
}

const instantAfter = (start: string, minutes: number) =>
  Temporal.Instant.from(start).add({ milliseconds: Math.round(minutes * 60_000) }).toString();
const point = (view: ResultView, id: string): LatLng | null => view.places[id]?.coordinates ?? null;

function legModels(view: ResultView, comparisons: readonly LegComparison[], date: string): LegModel[] {
  const legs = comparisons.filter(leg => leg.date === date);
  const centre = CITY_CENTRES[view.input.cityCode];
  return legs.map((leg, index) => {
    const fromPoint = point(view, leg.from), toPoint = point(view, leg.to);
    const mode = leg.selected.mode;
    const target = mode === 'TAXI' ? 'TRANSIT' as const : 'TAXI' as const;
    return {
      key: legKey(leg), order: index + 1, date, kind: leg.kind, from: leg.from, to: leg.to,
      fromName: placeName(view, leg.from), toName: placeName(view, leg.to),
      departure: leg.departure, arrival: instantAfter(leg.departure, leg.selected.minutes),
      mode, minutes: leg.selected.minutes, fare: leg.selected.fare, fixed: leg.selected.fixed,
      swap: mode === 'WALK' ? null : { mode: target, estimate: leg.alternatives[target] ?? null },
      outside: !!fromPoint && !!toPoint && isOutsideCityCentre({ mode, from: fromPoint, to: toPoint }, centre),
      color: legColor(index, legs.length), fromPoint, toPoint,
    };
  });
}

type Stop = NonNullable<ReturnType<typeof displayedSchedule>>['days'][number]['stops'][number];
type Placement = { date: string; start: string; end: string };

function placements(result: ItineraryResult | null): Map<string, Placement> {
  const placed = new Map<string, Placement>();
  for (const day of displayedSchedule(result)?.days ?? []) {
    for (const stop of day.stops) if (stop.kind === 'VISIT') placed.set(stop.visitId, { date: day.date, start: stop.start, end: stop.end });
  }
  return placed;
}

type Context = {
  view: ResultView; roles: Map<string, Role>; before: Map<string, Placement> | null; issues: Map<string, string>;
};

function card(context: Context, date: string, stop: Extract<Stop, { kind: 'VISIT' }> | null, visitId: string,
  number: number | null, legs: readonly LegModel[], last: boolean): CardModel | null {
  const visit = context.view.input.visits.find(row => row.id === visitId);
  if (!visit) return null;
  const placeId = visit.place.id;
  const arrival = stop ? legs.find(leg => leg.to === placeId) ?? null : null;
  const departure = stop ? legs.find(leg => leg.from === placeId) ?? null : null;
  const before = context.before?.get(visitId);
  const moved = !!stop && !!before && (minutesBetween(before.start, stop.start) !== 0 || minutesBetween(before.end, stop.end) !== 0);
  return {
    visitId, placeId, number, name: placeName(context.view, placeId), kind: visit.kind, stay: visit.minutes,
    start: stop?.start ?? null, end: stop?.end ?? null, fixed: fixedLabel(visit), arrival, departure,
    wait: arrival && stop ? Math.max(0, Math.round(minutesBetween(arrival.arrival, stop.start))) : 0,
    returnAt: last && departure && context.roles.get(departure.to) === 'LODGING' ? departure.arrival : null,
    shift: stop && before?.date === date ? Math.round(minutesBetween(before.start, stop.start)) : 0,
    changed: !!context.before && !!stop && (!before || before.date !== date || moved),
    issue: context.issues.get(visitId) ?? null,
  };
}

function flightInstant(view: ResultView, date: string, direction: 'ARRIVAL' | 'DEPARTURE'): string | null {
  const flight = view.input.flights.find(row => row.direction === direction && row.localDateTime.startsWith(date));
  return flight ? Temporal.PlainDateTime.from(flight.localDateTime).toZonedDateTime(view.input.timeZone).toInstant().toString() : null;
}

function timeline(context: Context, date: string, stops: readonly Stop[], cards: readonly CardModel[], legs: readonly LegModel[]): TimelineRow[] {
  const byVisit = new Map(cards.map(item => [item.visitId, item]));
  const rows: TimelineRow[] = [];
  for (const leg of legs) {
    const from = context.roles.get(leg.from), to = context.roles.get(leg.to);
    if (from === 'LODGING') rows.push({ kind: 'ENDPOINT', at: leg.departure, role: 'LODGING_OUT', name: leg.fromName });
    if (from === 'AIRPORT') rows.push({ kind: 'ENDPOINT', at: flightInstant(context.view, date, 'ARRIVAL') ?? leg.departure,
      role: 'AIRPORT_ARRIVAL', name: leg.fromName });
    rows.push({ kind: 'LEG', at: leg.departure, leg });
    if (to === 'LODGING') rows.push({ kind: 'ENDPOINT', at: leg.arrival, role: 'LODGING_IN', name: leg.toName });
    if (to === 'AIRPORT') rows.push({ kind: 'ENDPOINT', at: flightInstant(context.view, date, 'DEPARTURE') ?? leg.arrival,
      role: 'AIRPORT_DEPARTURE', name: leg.toName });
  }
  for (const stop of stops) {
    if (stop.kind === 'MEAL') rows.push({ kind: 'MEAL', at: stop.start, end: stop.end, slot: stop.slot });
    else if (byVisit.has(stop.visitId)) rows.push({ kind: 'VISIT', at: stop.start, card: byVisit.get(stop.visitId)! });
  }
  return rows.sort((a, b) => Temporal.Instant.compare(a.at, b.at));
}

function bounds(stops: readonly Stop[], legs: readonly LegModel[]) {
  const starts = [...legs.map(leg => leg.departure), ...stops.map(stop => stop.start)];
  const ends = [...legs.map(leg => leg.arrival), ...stops.map(stop => stop.end)];
  const pick = (values: string[], sign: 1 | -1) => values.length
    ? values.reduce((best, value) => Temporal.Instant.compare(value, best) * sign > 0 ? value : best) : null;
  return { start: pick(starts, -1), end: pick(ends, 1) };
}

/**
 * Builds every trip date's cards, legs and full-schedule rows from the displayed result.
 * `previous` drives the "N분 당겨짐/늦춰짐" marks; conflict causes without a position become cards
 * on their fixed date (or the first date) so 3-8 can select them first.
 */
export function buildDays(view: ResultView, shown: ItineraryResult | null, previous: ItineraryResult | null,
  causes: readonly ConflictCause[] = []): DayModel[] {
  const schedule = displayedSchedule(shown);
  const context: Context = {
    view, roles: placeRoles(view), before: displayedSchedule(previous) ? placements(previous) : null,
    issues: new Map(causes.flatMap(cause => cause.visitId ? [[cause.visitId, cause.message] as const] : [])),
  };
  const days = tripDates(view.input.startDate, view.input.endDate).map((date, index): DayModel => {
    const scheduled = schedule?.days.find(day => day.date === date);
    const stops = scheduled?.stops ?? [];
    const legs = legModels(view, shown?.comparisons ?? [], date);
    const visits = stops.filter((stop): stop is Extract<Stop, { kind: 'VISIT' }> => stop.kind === 'VISIT');
    const cards = visits.flatMap((stop, position) =>
      card(context, date, stop, stop.visitId, position + 1, legs, position === visits.length - 1) ?? []);
    const travelMinutes = Math.ceil(legs.reduce((sum, leg) => sum + leg.minutes, 0));
    return { date, number: index + 1, timeZone: scheduled?.timeZone ?? view.input.timeZone, cards, legs,
      rows: timeline(context, date, stops, cards, legs), ...bounds(stops, legs), travelMinutes };
  });
  const shownVisits = new Set(days.flatMap(day => day.cards.map(item => item.visitId)));
  for (const cause of causes) {
    if (!cause.visitId || shownVisits.has(cause.visitId)) continue;
    const day = days.find(row => row.date === (cause.date ?? view.input.startDate)) ?? days[0];
    const item = day && card(context, day.date, null, cause.visitId, null, [], false);
    if (item) { day.cards.push(item); shownVisits.add(cause.visitId); }
  }
  return days;
}

/** Visits placed on any date; the remaining WISH visits are wish markers. */
export const placedVisitIds = (days: readonly DayModel[]) =>
  new Set(days.flatMap(day => day.cards.filter(item => item.start).map(item => item.visitId)));
