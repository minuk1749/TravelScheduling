import { Temporal } from '@js-temporal/polyfill';

export type MealSlot = 'BREAKFAST' | 'LUNCH' | 'DINNER';
export type TimeWindow = { start: string; end: string };
export type MealWindows = Record<MealSlot, TimeWindow>;

export const DEFAULT_MEAL_WINDOWS: MealWindows = {
  BREAKFAST: { start: '07:30', end: '09:30' },
  LUNCH: { start: '11:30', end: '14:00' },
  DINNER: { start: '17:30', end: '20:30' },
};

export function mealSlotsForCount(count: 0 | 1 | 2 | 3): MealSlot[] {
  switch (count) {
    case 0: return [];
    case 1: return ['LUNCH'];
    case 2: return ['LUNCH', 'DINNER'];
    case 3: return ['BREAKFAST', 'LUNCH', 'DINNER'];
    default: throw new RangeError('Meal count must be between 0 and 3');
  }
}

export interface DayWindowInput {
  date: string;
  timeZone: string;
  activity: TimeWindow;
  mealCount: 0 | 1 | 2 | 3;
  mealWindows?: MealWindows;
  arrival?: { localDateTime: string; travelMinutes: number; immigrationMinutes?: number; viaLodging: boolean };
  departure?: { localDateTime: string; travelMinutes: number; airportBufferMinutes?: number; viaLodging: boolean };
}

export interface DayWindowResult {
  timeZone: string;
  available: TimeWindow | null;
  meals: { slot: MealSlot; window: TimeWindow | null }[];
  airportTransfers: { direction: 'arrival' | 'departure'; start: string; end: string; viaLodging: boolean }[];
}

function duration(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('Minutes must be a nonnegative integer');
  return value;
}

/** Calculate half-open instant windows. Transfer durations cover the entire airport route, including any lodging stop. */
export function calculateDayWindow(input: DayWindowInput): DayWindowResult {
  const date = Temporal.PlainDate.from(input.date);
  const instant = (time: string): Temporal.Instant => {
    const local = date.toPlainDateTime(Temporal.PlainTime.from(time));
    return local.toZonedDateTime(input.timeZone, { disambiguation: 'reject' }).toInstant();
  };
  const flightInstant = (localDateTime: string): Temporal.Instant => {
    const local = Temporal.PlainDateTime.from(localDateTime);
    if (!local.toPlainDate().equals(date)) throw new RangeError('Flight must be on the requested local date');
    return local.toZonedDateTime(input.timeZone, { disambiguation: 'reject' }).toInstant();
  };
  const later = (a: Temporal.Instant, b: Temporal.Instant) => Temporal.Instant.compare(a, b) >= 0 ? a : b;
  const earlier = (a: Temporal.Instant, b: Temporal.Instant) => Temporal.Instant.compare(a, b) <= 0 ? a : b;
  const asWindow = (start: Temporal.Instant, end: Temporal.Instant): TimeWindow | null =>
    Temporal.Instant.compare(start, end) < 0 ? { start: start.toString(), end: end.toString() } : null;

  let start = instant(input.activity.start);
  let end = instant(input.activity.end);
  if (Temporal.Instant.compare(start, end) >= 0) throw new RangeError('Activity must end after it starts on the same day');
  const airportTransfers: DayWindowResult['airportTransfers'] = [];
  if (input.arrival) {
    const transferStart = flightInstant(input.arrival.localDateTime).add({ minutes: duration(input.arrival.immigrationMinutes ?? 90) });
    const transferEnd = transferStart.add({ minutes: duration(input.arrival.travelMinutes) });
    airportTransfers.push({ direction: 'arrival', start: transferStart.toString(), end: transferEnd.toString(), viaLodging: input.arrival.viaLodging });
    start = later(start, transferEnd);
  }
  if (input.departure) {
    const transferEnd = flightInstant(input.departure.localDateTime).subtract({ minutes: duration(input.departure.airportBufferMinutes ?? 150) });
    const transferStart = transferEnd.subtract({ minutes: duration(input.departure.travelMinutes) });
    airportTransfers.push({ direction: 'departure', start: transferStart.toString(), end: transferEnd.toString(), viaLodging: input.departure.viaLodging });
    end = earlier(end, transferStart);
  }
  const available = asWindow(start, end);
  const meals = mealSlotsForCount(input.mealCount).map(slot => {
    const configured = (input.mealWindows ?? DEFAULT_MEAL_WINDOWS)[slot];
    const mealStart = instant(configured.start);
    const mealEnd = instant(configured.end);
    if (Temporal.Instant.compare(mealStart, mealEnd) >= 0) throw new RangeError('Meal window must end after it starts on the same day');
    return { slot, window: available ? asWindow(later(start, mealStart), earlier(end, mealEnd)) : null };
  });
  return { timeZone: input.timeZone, available, meals, airportTransfers };
}
