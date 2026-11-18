import { Temporal } from '@js-temporal/polyfill';
import { mealCountForSlots, type MealSlot, type TimeWindow } from '../../scheduler';
import { ItineraryInputError, type PlaceRef, type TripInputs } from './types';

/** Minutes reserved per meal slot. Not configurable yet (docs/questions.md, T12). */
export const MEAL_MINUTES: Readonly<Record<MealSlot, number>> = { BREAKFAST: 45, LUNCH: 60, DINNER: 60 };

export interface DayPlan {
  date: string;
  start: PlaceRef;
  end: PlaceRef;
  activity: TimeWindow;
  mealCount: 0 | 1 | 2 | 3;
  /** `transferTo` is the lodging reached from the airport before the day starts. */
  arrival?: { airport: PlaceRef; localDateTime: string; instant: string; immigrationMinutes: number; transferTo?: PlaceRef };
  /** `transferFrom` is the lodging left for the airport after the day ends. */
  departure?: { airport: PlaceRef; localDateTime: string; instant: string; bufferMinutes: number; transferFrom?: PlaceRef };
  /**
   * Daily legs that carry luggage: `ALL_LEGS` on a day trip without lodging (nowhere to leave it),
   * `INTO_END` for the legs into the airport after a direct-to-airport checkout.
   */
  luggage?: 'ALL_LEGS' | 'INTO_END';
}

export function tripDates(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const end = Temporal.PlainDate.from(endDate);
  for (let date = Temporal.PlainDate.from(startDate); Temporal.PlainDate.compare(date, end) <= 0; date = date.add({ days: 1 })) {
    dates.push(date.toString());
  }
  return dates;
}

/** Local wall-clock time to an offset instant; DST gaps and repeated times are rejected. */
export function localInstant(localDateTime: string, timeZone: string): string {
  return Temporal.PlainDateTime.from(localDateTime)
    .toZonedDateTime(timeZone, { disambiguation: 'reject' }).toInstant().toString();
}

function lodgingFor(input: TripInputs, night: string): PlaceRef | undefined {
  return input.lodgings.find(lodging => lodging.checkIn <= night && night < lodging.checkOut)?.place;
}

/**
 * Going straight to the airport needs time on the last day itself. When the check-in deadline is
 * not after that day's activity start (an early-morning flight), the transfer leaves from the lodging.
 */
function directFits(date: string, activityStart: string, departureInstant: string, bufferMinutes: number, timeZone: string): boolean {
  const deadline = Temporal.Instant.from(departureInstant).subtract({ minutes: bufferMinutes });
  try {
    return Temporal.Instant.compare(deadline, Temporal.Instant.from(localInstant(`${date}T${activityStart}`, timeZone))) > 0;
  } catch {
    return true; // An invalid activity start is reported when the day window is computed.
  }
}

function validateVisits(input: TripInputs, errors: Record<string, string>): void {
  for (const visit of input.visits) {
    const key = `visits.${visit.id}`;
    if (visit.fixedTime !== undefined && visit.fixedDate === undefined) {
      errors[key] = '고정 시각에는 고정 날짜가 필요합니다.';
    } else if (visit.fixedDate !== undefined && (visit.fixedDate < input.startDate || visit.fixedDate > input.endDate)) {
      errors[key] = '고정 날짜는 여행 기간 안이어야 합니다.';
    } else if (visit.fixedDate !== undefined && visit.fixedTime !== undefined) {
      try { localInstant(`${visit.fixedDate}T${visit.fixedTime}`, input.timeZone); }
      catch { errors[key] = '고정 시각이 여행 시간대에 존재하지 않거나 두 번 나타납니다.'; }
    }
  }
}

/**
 * Daily anchors: day 1 goes airport → lodging (luggage drop) → schedule; the last day ends at
 * the lodging (luggage pickup) then the airport, or goes directly to the airport.
 */
export function planDays(input: TripInputs): DayPlan[] {
  const errors: Record<string, string> = {};
  const dates = tripDates(input.startDate, input.endDate);
  const arrival = input.flights.find(flight => flight.direction === 'ARRIVAL');
  const departure = input.flights.find(flight => flight.direction === 'DEPARTURE');
  const flightInstant = (flight: typeof arrival, date: string): string => {
    if (!flight) return '';
    try {
      if (flight.localDateTime.slice(0, 10) !== date) throw new RangeError();
      return localInstant(flight.localDateTime, input.timeZone);
    } catch {
      errors.flights = '도착은 첫날, 출발은 마지막 날의 유효한 현지 시각이어야 합니다.';
      return '';
    }
  };
  const arrivalInstant = flightInstant(arrival, input.startDate);
  const departureInstant = flightInstant(departure, input.endDate);
  validateVisits(input, errors);
  const settings = new Map(input.daySettings.map(setting => [setting.date, setting]));

  const days = dates.map((date, index): DayPlan | null => {
    const first = index === 0, last = index === dates.length - 1;
    const tonight = last ? undefined : lodgingFor(input, date);
    const lastNight = first ? undefined : lodgingFor(input, dates[index - 1]);
    if (!last && !tonight || !first && !lastNight) {
      errors.lodgings = '여행의 모든 숙박 날짜에 숙소가 필요합니다.';
      return null;
    }
    const setting = settings.get(date);
    const activity = { start: setting?.departureTime ?? input.activity.start, end: setting?.returnTime ?? input.activity.end };
    const start = lastNight ?? tonight ?? (first ? arrival?.airport : undefined);
    const direct = !lastNight || input.luggageOption === 'DIRECT_TO_AIRPORT' &&
      departureInstant !== '' && directFits(date, activity.start, departureInstant, input.departureBufferMinutes, input.timeZone);
    const end = tonight ?? (departure && direct ? departure.airport : lastNight);
    if (!start || !end) {
      errors.lodgings = '숙소가 없는 당일 여행은 도착·출발 항공편이 필요합니다.';
      return null;
    }
    const count = mealCountForSlots(setting?.mealSlots ?? input.mealSlots);
    if (count === null) errors[`daySettings.${date}.mealSlots`] = '끼니는 없음, 점심, 점심·저녁, 아침·점심·저녁 중 하나여야 합니다.';
    const day: DayPlan = { date, start, end, mealCount: count ?? 0, activity };
    if (!tonight && !lastNight) day.luggage = 'ALL_LEGS';
    if (first && arrival) {
      day.arrival = { airport: arrival.airport, localDateTime: arrival.localDateTime, instant: arrivalInstant, immigrationMinutes: input.arrivalBufferMinutes,
        ...(start.id === arrival.airport.id ? {} : { transferTo: start }) };
    }
    if (last && departure) {
      day.departure = { airport: departure.airport, localDateTime: departure.localDateTime, instant: departureInstant, bufferMinutes: input.departureBufferMinutes,
        ...(end.id === departure.airport.id ? {} : { transferFrom: end }) };
      if (end.id === departure.airport.id && lastNight) day.luggage = 'INTO_END';
    }
    return day;
  });
  if (Object.keys(errors).length) throw new ItineraryInputError(errors);
  return days as DayPlan[];
}
