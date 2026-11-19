import { Temporal } from '@js-temporal/polyfill';
import { calculateDayWindow } from '../../scheduler';
import { countForSlots, tripDates, mealLabels } from './input';
import type { LivingSettings, SettingsCalculation, SettingsContext } from './model';

/** Preliminary window check only. Route times, opening hours and full placement belong to T12. */
export function calculateSettings(context: SettingsContext, settings: LivingSettings): SettingsCalculation {
  const overrides = new Map(settings.days.map(day => [day.date, day]));
  const days = tripDates(context.startDate, context.endDate).map(date => {
    const day = overrides.get(date);
    const arrival = context.flights.find(f => f.direction === 'ARRIVAL' && f.localDateTime.slice(0, 10) === date);
    const departure = context.flights.find(f => f.direction === 'DEPARTURE' && f.localDateTime.slice(0, 10) === date);
    return { date, result: calculateDayWindow({ date, timeZone: context.timeZone,
      activity: { start: day?.departureTime ?? settings.departureTime, end: day?.returnTime ?? settings.returnTime },
      mealCount: countForSlots(day?.mealSlots ?? settings.mealSlots), mealWindows: settings.mealWindows,
      arrival: arrival && { localDateTime: arrival.localDateTime, travelMinutes: 0, immigrationMinutes: arrival.bufferMinutes, viaLodging: false },
      departure: departure && { localDateTime: departure.localDateTime, travelMinutes: 0, airportBufferMinutes: departure.bufferMinutes, viaLodging: false },
    }) };
  });
  const conflicts: SettingsCalculation['conflicts'] = [];
  for (const day of days) {
    if (!day.result.available) conflicts.push({ date: day.date, message: '활동 시간과 항공편 제약이 겹치지 않습니다.' });
    for (const meal of day.result.meals) if (!meal.window) conflicts.push({ date: day.date, message: `${mealLabels[meal.slot]} 식사 시간대가 활동 시간 밖입니다.` });
  }
  const byDate = new Map(days.map(day => [day.date, day.result.available]));
  for (const visit of context.fixedVisits) {
    const fail = (message: string) => conflicts.push({ date: visit.date, visitId: visit.id, message });
    if (!visit.date) { fail('고정 시각·순서에 날짜가 필요합니다.'); continue; }
    const window = byDate.get(visit.date);
    if (!window) { fail('고정 날짜에 활동 가능한 시간이 없습니다.'); continue; }
    const availableStart = Temporal.Instant.from(window.start), availableEnd = Temporal.Instant.from(window.end);
    if (!visit.time) {
      if (availableStart.add({ minutes: visit.minutes }).epochMilliseconds > availableEnd.epochMilliseconds) fail('고정 방문의 체류시간이 활동 시간을 초과합니다.');
      continue;
    }
    try {
      const start = Temporal.PlainDate.from(visit.date).toPlainDateTime(visit.time).toZonedDateTime(context.timeZone, { disambiguation: 'reject' }).toInstant();
      const end = start.add({ minutes: visit.minutes });
      if (start.epochMilliseconds < availableStart.epochMilliseconds || end.epochMilliseconds > availableEnd.epochMilliseconds) fail('고정 방문 시각·체류시간이 활동 시간 또는 항공편 제약과 충돌합니다.');
    } catch { fail('고정 시각이 여행 시간대에서 유효하지 않습니다.'); }
  }
  return { scope: 'TIME_WINDOWS', taxiPolicy: settings.taxiPolicy, days, conflicts };
}
