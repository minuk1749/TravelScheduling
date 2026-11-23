import { Temporal } from '@js-temporal/polyfill';
import type { ItineraryResult, LegComparison } from '@travel/core/contracts/itinerary';
import type { ResultView } from '@travel/core/contracts/results/model';
import { displayedSchedule, placeName } from '@travel/core/presentation';
import type { MealSlot, RouteEstimate } from '@travel/core/scheduler';
import { CITY_CENTRES, isOutsideCityCentre, legColor, roadShapeKey } from '../map/geometry';
import type { LatLng, MapRoutePath, TravelModeName } from '../map/types';
import type { ConflictCause } from './conflicts';
import { fixedLabel, minutesBetween } from './format';

export type LegModel = {
  /** date and key identify the saved leg, including airport transfers displayed on another local date. */
  key: string; order: number; date: string; kind: LegComparison['kind'];
  from: string; to: string; fromName: string; toName: string;
  departure: string; arrival: string;
  mode: TravelModeName; minutes: number; fare: number | null; fixed: boolean;
  alternatives: LegComparison['alternatives'];
  /** Card switch chip target; null for walking legs. A null estimate is "택시 정보 없음". */
  swap: { mode: 'TRANSIT' | 'TAXI'; estimate: RouteEstimate | null } | null;
  outside: boolean; color: string;
  path: MapRoutePath | null;
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
  /** Minutes later (+) or earlier (−) than this visit's previous start instant. */
  shift: number;
  changed: boolean;
  issue: string | null;
};

export type EndpointRole = 'LODGING_OUT' | 'LODGING_IN' | 'AIRPORT_ARRIVAL' | 'AIRPORT_DEPARTURE';
export type TimelineRow =
  | { kind: 'VISIT'; at: string; card: CardModel }
  | { kind: 'MEAL'; at: string; end: string; slot: MealSlot }
  | { kind: 'LEG'; at: string; leg: LegModel }
  | { kind: 'ENDPOINT'; at: string; role: EndpointRole; placeId: string; name: string };

export type DayModel = {
  date: string; number: number; timeZone: string;
  cards: CardModel[]; legs: LegModel[]; rows: TimelineRow[];
  coordinates: ReadonlyMap<string, LatLng>;
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

const localDate = (instant: string, zone: string) =>
  Temporal.Instant.from(instant).toZonedDateTimeISO(zone).toPlainDate().toString();

const instantAfter = (start: string, minutes: number) =>
  Temporal.Instant.from(start).add({ milliseconds: Math.round(minutes * 60_000) }).toString();

/** Group by when the traveler sees the event, independent of the saved calculation date. */
function byLocalDate<T>(items: readonly T[], zone: string, instant: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const date = localDate(instant(item), zone);
    const group = groups.get(date);
    if (group) group.push(item);
    else groups.set(date, [item]);
  }
  return groups;
}

type RoadShapes = ReadonlyMap<string, readonly LatLng[]>;

type LegRoad = { leg: LegComparison; key: string; road: readonly LatLng[] | null };

function legRoad(leg: LegComparison, shapes?: RoadShapes): LegRoad {
  const key = legKey(leg);
  const points = shapes?.get(roadShapeKey(key, leg.selected.mode));
  return { leg, key, road: points && points.length >= 2 ? points : null };
}

export function placeDetailCoordinates(view: ResultView) {
  const coordinates = new Map<string, LatLng>();
  for (const [id, place] of Object.entries(view.places)) {
    if (place) coordinates.set(id, place.coordinates);
  }
  return coordinates;
}

/** Index actual road endpoints before building straight lines. A place detail always wins,
 * then the first access point on the displayed local date, then the first in this itinerary. */
function coordinatesByDay(view: ResultView, dates: readonly string[], departures: ReadonlyMap<string, LegRoad[]>) {
  const itineraryCoordinates = placeDetailCoordinates(view);
  const daily = new Map<string, Map<string, LatLng>>();
  for (const date of dates) {
    const local = new Map<string, LatLng>();
    daily.set(date, local);
    for (const { leg, road } of departures.get(date) ?? []) {
      if (!road) continue;
      for (const [id, coordinate] of [[leg.from, road[0]!], [leg.to, road.at(-1)!]] as const) {
        if (view.places[id]) continue;
        if (!local.has(id)) local.set(id, coordinate);
        if (!itineraryCoordinates.has(id)) itineraryCoordinates.set(id, coordinate);
      }
    }
  }
  return new Map([...daily].map(([date, local]) => [date,
    local.size ? new Map([...itineraryCoordinates, ...local]) : itineraryCoordinates,
  ]));
}

function legModels(view: ResultView, roads: readonly LegRoad[], coordinates: ReadonlyMap<string, LatLng>): LegModel[] {
  const { cityCode } = view.input;
  const centre = Object.hasOwn(CITY_CENTRES, cityCode) ? CITY_CENTRES[cityCode] : undefined;
  return roads.map(({ leg, key, road }, index) => {
    const mode = leg.selected.mode;
    const from = coordinates.get(leg.from), to = coordinates.get(leg.to);
    const path: MapRoutePath | null = road ? { kind: 'ROAD', points: road }
      : from && to ? { kind: 'STRAIGHT', from, to } : null;
    const target = mode === 'TAXI' ? 'TRANSIT' as const : 'TAXI' as const;
    return {
      key, order: index + 1, date: leg.date, kind: leg.kind, from: leg.from, to: leg.to,
      fromName: placeName(view, leg.from), toName: placeName(view, leg.to),
      departure: leg.departure, arrival: instantAfter(leg.departure, leg.selected.minutes),
      mode, minutes: leg.selected.minutes, fare: leg.selected.fare, fixed: leg.selected.fixed,
      alternatives: leg.alternatives,
      swap: mode === 'WALK' ? null : { mode: target, estimate: leg.alternatives[target] ?? null },
      outside: !!from && !!to && isOutsideCityCentre({ mode, from, to }, centre),
      color: legColor(index, roads.length), path,
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
  view: ResultView; before: Map<string, Placement> | null;
};

const fixOnDate = (visit: ResultView['input']['visits'][number], date: string) =>
  !visit.fixedDate || visit.fixedDate === date ? fixedLabel(visit) : null;

function card(context: Context, date: string, stop: Extract<Stop, { kind: 'VISIT' }> | null, visitId: string,
  number: number | null, legs: readonly LegModel[], last: boolean): CardModel | null {
  const visit = context.view.input.visits.find(row => row.id === visitId);
  if (!visit) return null;
  const placeId = visit.place.id;
  const arrival = stop ? legs.findLast(leg => leg.to === placeId && Temporal.Instant.compare(leg.arrival, stop.start) <= 0) ?? null : null;
  const departure = stop ? legs.find(leg => leg.from === placeId && Temporal.Instant.compare(leg.departure, stop.end) >= 0) ?? null : null;
  const before = context.before?.get(visitId);
  const startDifference = stop && before ? minutesBetween(before.start, stop.start) : 0;
  const moved = !!stop && !!before && (startDifference !== 0 || minutesBetween(before.end, stop.end) !== 0);
  return {
    visitId, placeId, number, name: placeName(context.view, placeId), kind: visit.kind, stay: visit.minutes,
    start: stop?.start ?? null, end: stop?.end ?? null, fixed: fixOnDate(visit, date), arrival, departure,
    wait: arrival && stop ? Math.max(0, Math.round(minutesBetween(arrival.arrival, stop.start))) : 0,
    returnAt: last && departure && context.view.input.lodgings.some(lodging => lodging.place.id === departure.to) ? departure.arrival : null,
    shift: Math.round(startDifference),
    changed: !!context.before && !!stop && (!before || before.date !== date || moved),
    issue: null,
  };
}

type EndpointRow = Extract<TimelineRow, { kind: 'ENDPOINT' }>;

/** A flight and its transfer can be on different local dates. Flight events follow the itinerary's flight clock. */
function endpoints(view: ResultView, legs: readonly LegComparison[]): EndpointRow[] {
  const { flights, lodgings, timeZone } = view.input;
  const rows: EndpointRow[] = [];
  const add = (role: EndpointRole, at: string, placeId: string) =>
    rows.push({ kind: 'ENDPOINT', role, at, placeId, name: placeName(view, placeId) });
  for (const flight of flights) {
    const at = Temporal.PlainDateTime.from(flight.localDateTime).toZonedDateTime(timeZone).toInstant().toString();
    add(flight.direction === 'ARRIVAL' ? 'AIRPORT_ARRIVAL' : 'AIRPORT_DEPARTURE', at, flight.airport.id);
  }
  // A visit at a lodging is still a visit. Only daily route anchors and the lodging side of an airport transfer
  // represent lodging departures/arrivals, even when the same place is also a visit or an airport.
  const daily = legs.filter(leg => leg.kind === 'DAY');
  const first = new Map<string, LegComparison>(), last = new Map<string, LegComparison>();
  for (const leg of daily) {
    if (!first.has(leg.date)) first.set(leg.date, leg);
    last.set(leg.date, leg);
  }
  for (const leg of legs) {
    const transfer = (direction: 'DEPARTURE' | 'ARRIVAL', airportId: string) => leg.kind === 'AIRPORT' && flights.some(flight =>
      flight.direction === direction && flight.airport.id === airportId && flight.localDateTime.startsWith(leg.date));
    if ((first.get(leg.date) === leg || transfer('DEPARTURE', leg.to)) && lodgings.some(lodging => lodging.place.id === leg.from)) {
      add('LODGING_OUT', leg.departure, leg.from);
    }
    if ((last.get(leg.date) === leg || transfer('ARRIVAL', leg.from)) && lodgings.some(lodging => lodging.place.id === leg.to)) {
      add('LODGING_IN', instantAfter(leg.departure, leg.selected.minutes), leg.to);
    }
  }
  return rows;
}

function timeline(endpoints: EndpointRow[], stops: readonly Stop[], cards: readonly CardModel[], legs: readonly LegModel[]): TimelineRow[] {
  const byVisit = new Map(cards.map(item => [item.visitId, item]));
  const rows: TimelineRow[] = [...endpoints, ...legs.map(leg => ({ kind: 'LEG' as const, at: leg.departure, leg }))];
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
  causes: readonly ConflictCause[] = [], shapes?: RoadShapes): DayModel[] {
  const schedule = displayedSchedule(shown);
  const context: Context = { view, before: displayedSchedule(previous) ? placements(previous) : null };
  const zone = view.input.timeZone;
  const comparisons = [...shown?.comparisons ?? []].sort((a, b) => Temporal.Instant.compare(a.departure, b.departure));
  const dates = tripDates(view.input.startDate, view.input.endDate);
  const byDeparture = byLocalDate(comparisons.map(leg => legRoad(leg, shapes)), zone, source => source.leg.departure);
  const coordinates = coordinatesByDay(view, dates, byDeparture);
  const events = byLocalDate(schedule ? endpoints(view, comparisons) : [], zone, row => row.at);
  const days = dates.map((date, index): DayModel => {
    const scheduled = schedule?.days.find(day => day.date === date);
    const stops = scheduled?.stops ?? [];
    const dayCoordinates = coordinates.get(date)!;
    const legs = legModels(view, byDeparture.get(date) ?? [], dayCoordinates);
    const visits = stops.filter((stop): stop is Extract<Stop, { kind: 'VISIT' }> => stop.kind === 'VISIT');
    const cards = visits.flatMap((stop, position) =>
      card(context, date, stop, stop.visitId, position + 1, legs, position === visits.length - 1) ?? []);
    const travelMinutes = Math.ceil(legs.reduce((sum, leg) => sum + leg.minutes, 0));
    return { date, number: index + 1, timeZone: scheduled?.timeZone ?? view.input.timeZone, cards, legs, coordinates: dayCoordinates,
      rows: timeline(events.get(date) ?? [], stops, cards, legs), ...bounds(stops, legs), travelMinutes };
  });
  return causes.length ? withConflictCauses(view, days, causes) : days;
}

/** The historical stops, legs, coordinates and timeline stay together. Only the panel's fixes and
 * cause cards follow the current input, including a failed move to a date without a placement. */
export function withConflictCauses(view: ResultView, scheduled: DayModel[], causes: readonly ConflictCause[]): DayModel[] {
  const byDate = new Map(scheduled.map(day => [day.date, day]));
  const calendar = scheduled[0]?.date === view.input.startDate && scheduled.at(-1)?.date === view.input.endDate ? scheduled
    : buildDays(view, null, null).map(day => byDate.get(day.date) ?? day);
  const visits = new Map(view.input.visits.map(visit => [visit.id, visit]));
  const days = calendar.map((day, index) => ({ ...day, number: index + 1, cards: day.cards.map(item => {
    const visit = visits.get(item.visitId);
    const fixed = visit ? fixOnDate(visit, day.date) : null;
    return { ...item, fixed };
  }) }));
  for (const cause of causes) {
    if (!cause.visitId) continue;
    const day = cause.date ? days.find(row => row.date === cause.date)
      : days.find(row => row.cards.some(item => item.visitId === cause.visitId)) ?? days[0];
    if (!day) continue;
    const existing = day.cards.find(item => item.visitId === cause.visitId);
    if (existing) {
      existing.issue = cause.message;
      existing.name = placeName(view, existing.placeId);
    } else {
      const item = card({ view, before: null }, day.date, null, cause.visitId, null, [], false);
      if (item) day.cards.push({ ...item, issue: cause.message });
    }
  }
  return days;
}
