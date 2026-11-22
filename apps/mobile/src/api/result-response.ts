import { Temporal } from '@js-temporal/polyfill';
import type { ItineraryResult, TripInputs } from '@travel/core/contracts/itinerary';
import type { LegShape, RouteShapesResponse } from '@travel/core/contracts/route-shapes';
import type { ResultSnapshot, ResultView } from '@travel/core/contracts/results/model';
import { tripDates } from '@travel/core/contracts/settings/input';

type Check = (value: unknown) => boolean;
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const fields = (shape: Record<string, Check>): Check => value =>
  record(value) && Object.entries(shape).every(([key, check]) => check(value[key]));
const list = (check: Check): Check => value => Array.isArray(value) && value.every(check);
const values = (check: Check): Check => value => record(value) && Object.values(value).every(check);
const nullable = (check: Check): Check => value => value === null || check(value);
const optional = (check: Check): Check => value => value === undefined || check(value);
const oneOf = (...choices: string[]): Check => value => typeof value === 'string' && choices.includes(value);
const text: Check = value => typeof value === 'string' && value.length > 0;
const number: Check = value => typeof value === 'number' && Number.isFinite(value);
const bool: Check = value => typeof value === 'boolean';

function temporal(parse: (value: string) => unknown): Check {
  return value => {
    if (typeof value !== 'string') return false;
    try { parse(value); return true; } catch { return false; }
  };
}

const date = temporal(value => Temporal.PlainDate.from(value));
const zone = temporal(value => Temporal.Instant.fromEpochMilliseconds(0).toZonedDateTimeISO(value));
const instant = temporal(value => Temporal.Instant.from(value));
const localDateTime = temporal(value => Temporal.PlainDateTime.from(value));
const clock = temporal(value => Temporal.PlainTime.from(value));
const slot = oneOf('BREAKFAST', 'LUNCH', 'DINNER');
const mode = oneOf('TRANSIT', 'TAXI', 'WALK');
const legKind = oneOf('DAY', 'AIRPORT');
const direction = oneOf('ARRIVAL', 'DEPARTURE');
const status = oneOf('OK', 'CONFLICT', 'OVER_CAPACITY');
const window = fields({ start: instant, end: instant });
const activity = fields({ start: clock, end: clock });
const ref = fields({ id: text, googlePlaceId: text });
const place = fields({
  googlePlaceId: text, name: text, coordinates: fields({ latitude: number, longitude: number }),
  attributions: list(fields({ provider: text, providerUri: value => typeof value === 'string' })),
});
const input = fields({
  id: text, cityCode: text, timeZone: zone, startDate: date, endDate: date, activity,
  mealSlots: list(slot), mealWindows: fields({ BREAKFAST: activity, LUNCH: activity, DINNER: activity }),
  taxiPolicy: oneOf('NEVER', 'WHEN_NEEDED', 'PREFER'), luggageOption: oneOf('VIA_LODGING', 'DIRECT_TO_AIRPORT'),
  arrivalBufferMinutes: number, departureBufferMinutes: number,
  daySettings: list(fields({ date, departureTime: nullable(clock), returnTime: nullable(clock), mealSlots: nullable(list(slot)) })),
  flights: list(fields({ direction, airport: ref, localDateTime })),
  lodgings: list(fields({ place: ref, checkIn: date, checkOut: date })),
  legModes: optional(list(fields({ date, from: text, to: text, mode }))),
  visits: list(fields({ id: text, place: ref, kind: oneOf('ATTRACTION', 'RESTAURANT'), minutes: number,
    priority: oneOf('REQUIRED', 'WISH'), fixedDate: optional(date), fixedTime: optional(clock), fixedOrder: optional(number) })),
} satisfies Record<keyof TripInputs, Check>);

export function validSnapshot(value: unknown): value is ResultSnapshot {
  if (!record(value) || !text(value.revision) || !record(value.input) || !input(value.input)) return false;
  const { startDate, endDate } = value.input;
  if (typeof startDate !== 'string' || typeof endDate !== 'string') return false;
  try { tripDates(startDate, endDate); return true; } catch { return false; }
}

export function validResultView(value: unknown): value is ResultView {
  if (!validSnapshot(value) || !('places' in value) || !record(value.places) || !values(nullable(place))(value.places)) return false;
  const { input, places } = value;
  // A failed provider lookup still has a key with null metadata in the saved view.
  return input.visits.every(visit => Object.hasOwn(places, visit.place.id))
    && input.flights.every(flight => Object.hasOwn(places, flight.airport.id))
    && input.lodgings.every(lodging => Object.hasOwn(places, lodging.place.id));
}

const unplaced = list(fields({ visitId: text, fixed: bool, reason: oneOf('TIME_WINDOW', 'UNREACHABLE', 'FIXED_ORDER', 'WISH') }));
const issues = list(value => record(value) && date(value.date) && (value.reason === 'TIME_WINDOW' ||
  (value.reason === 'UNREACHABLE' && text(value.from) && text(value.to)) ||
  (value.reason === 'MEAL_UNAVAILABLE' && slot(value.slot))));
const schedule = fields({
  unplaced, issues,
  days: list(fields({ date, timeZone: zone,
    stops: list(value => record(value) && window(value) &&
      ((value.kind === 'VISIT' && text(value.visitId)) || (value.kind === 'MEAL' && slot(value.slot)))),
    legs: list(fields({ from: text, to: text, start: instant, end: instant, mode, fixed: bool, fare: nullable(number) })),
  })),
});
const recommendation = fields({ requiredCount: number, requiredVisitIds: list(text), schedule });
const capacity = fields({
  status, unplaced, issues, time: fields({ availableMinutes: number, mealMinutes: number, visitMinutes: number,
    travelMinutesLowerBound: nullable(number), requiredMinutesLowerBound: nullable(number) }),
});
const estimate = { minutes: number, fare: nullable(number) };
const comparison = fields({ date, kind: legKind, from: text, to: text, departure: instant,
  selected: fields({ ...estimate, mode, fixed: bool }), baseline: nullable(fields({ ...estimate, mode })),
  alternatives: fields({ TRANSIT: optional(fields(estimate)), TAXI: optional(fields(estimate)), WALK: optional(fields(estimate)) }),
});
const generated = fields({
  itineraryId: text, inputHash: text, status, capacity, verification: fields({ verified: bool, attempts: number }),
  transferIssues: list(fields({ date, direction, from: text, to: text, reason: oneOf('NO_ROUTE', 'UNVERIFIED') })),
  flightConflicts: list(fields({ date, arrivalReadyAt: instant, departureStartBy: instant })),
  skippedMeals: list(fields({ date, slot })), comparisons: list(comparison), availableByDate: optional(values(nullable(window))),
  efficiency: nullable(fields({ currency: nullable(text), selectedMinutes: number, transitMinutes: nullable(number),
    selectedFare: nullable(number), transitFare: nullable(number) })),
} satisfies Record<keyof ItineraryResult | 'itineraryId' | 'inputHash', Check>);

/** A transfer issue can make the overall result CONFLICT even when the daily schedule is feasible. */
export function validGeneratedTrip(value: unknown): boolean {
  if (!record(value)) return false;
  const detail = value.capacity;
  if (!generated(value) || !record(detail)) return false;
  if (value.status !== 'CONFLICT' && (value.status !== detail.status || !record(value.verification) ||
    value.verification.verified !== true || !Array.isArray(value.transferIssues) || value.transferIssues.length ||
    !Array.isArray(value.flightConflicts) || value.flightConflicts.length)) return false;
  return detail.status === 'CONFLICT' ? detail.recommendation === null : recommendation(detail.recommendation);
}

const legShape = fields({
  date, kind: legKind, from: text, to: text, mode,
  shape: value => record(value) && (value.status === 'NONE' ||
    (value.status === 'OK' && typeof value.encodedPolyline === 'string')),
} satisfies Record<keyof LegShape, Check>);

/** Hash-only responses can omit the ID; the caller also matches the ID it requested. */
export const validRouteShapes = fields({
  inputHash: text, itineraryId: optional(text), legs: list(legShape),
} satisfies Record<keyof RouteShapesResponse, Check>);
