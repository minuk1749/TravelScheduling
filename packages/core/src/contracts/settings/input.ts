import { Temporal } from '@js-temporal/polyfill';
import { mealCountForSlots, mealSlotsForCount, type MealSlot, type MealWindows } from '../../scheduler';
import { TripInputError } from '../trips/input';
import type { LivingSettings, MealCount } from './model';

const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export const mealLabels = { BREAKFAST: '아침', LUNCH: '점심', DINNER: '저녁' } as const;
export const mealCounts: readonly MealCount[] = [0, 1, 2, 3];
export function countForSlots(value: unknown): MealCount {
  const count = Array.isArray(value) ? mealCountForSlots(value) : null;
  if (count === null) throw new RangeError('지원하지 않는 식사 슬롯 조합입니다.');
  return count;
}
export function tripDates(start: string, end: string): string[] {
  const first = Temporal.PlainDate.from(start), last = Temporal.PlainDate.from(end);
  const length = first.until(last).days + 1;
  if (length < 1 || length > 31) throw new RangeError('여행 기간은 1–31일이어야 합니다.');
  return Array.from({ length }, (_, i) => first.add({ days: i }).toString());
}

/** Shared UI/API validation; dates and time zone come from the authorized trip, never the request. */
export function parseSettings(raw: unknown, context: { startDate: string; endDate: string; timeZone: string }): LivingSettings {
  const data = object(raw), fields: Record<string, string> = {};
  const time = (value: unknown, key: string): string => {
    if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
      fields[key] = '시각은 HH:mm 형식으로 입력해 주세요.'; return '';
    }
    return value;
  };
  const slots = (value: unknown, key: string): MealSlot[] => {
    try { return mealSlotsForCount(countForSlots(value)); }
    catch { fields[key] = '끼니 수는 0–3끼(점심 → 저녁 → 아침)를 선택해 주세요.'; return []; }
  };
  const departureTime = time(data.departureTime, 'departureTime'), returnTime = time(data.returnTime, 'returnTime');
  const mealSlots = slots(data.mealSlots, 'mealSlots');
  const windows = object(data.mealWindows);
  const mealWindows = Object.fromEntries(Object.keys(mealLabels).map(slot => {
    const window = object(windows[slot]);
    const start = time(window.start, `mealWindows.${slot}.start`), end = time(window.end, `mealWindows.${slot}.end`);
    if (start && end && start >= end) fields[`mealWindows.${slot}`] = `${mealLabels[slot as MealSlot]} 종료는 시작 이후여야 합니다.`;
    return [slot, { start, end }];
  })) as MealWindows;
  const taxiPolicy = data.taxiPolicy;
  if (!['NEVER', 'WHEN_NEEDED', 'PREFER'].includes(taxiPolicy as string)) fields.taxiPolicy = '택시 정책을 선택해 주세요.';
  const dates = tripDates(context.startDate, context.endDate);
  const rows = Array.isArray(data.days) && data.days.length <= 31 ? data.days : [];
  if (!Array.isArray(data.days) || data.days.length > 31) fields.days = '날짜별 설정은 최대 31일입니다.';
  const seen = new Set<string>();
  const days = rows.map((raw, i) => {
    const row = object(raw), key = `days.${i}`, date = typeof row.date === 'string' ? row.date : '';
    if (!dates.includes(date) || seen.has(date)) fields[`${key}.date`] = '여행 기간 내 날짜를 중복 없이 지정해 주세요.';
    seen.add(date);
    return { date, departureTime: row.departureTime === null ? null : time(row.departureTime, `${key}.departureTime`),
      returnTime: row.returnTime === null ? null : time(row.returnTime, `${key}.returnTime`),
      mealSlots: row.mealSlots === null ? null : slots(row.mealSlots, `${key}.mealSlots`) };
  });
  if (departureTime && returnTime && departureTime >= returnTime) fields.returnTime = '들어오는 시각은 나가는 시각 이후여야 합니다 (같은 날짜).';
  const overrides = new Map(days.map(day => [day.date, day]));
  for (const date of dates) {
    const day = overrides.get(date), start = day?.departureTime ?? departureTime, end = day?.returnTime ?? returnTime;
    if (start && end && start >= end) fields[date] = `${date}: 들어오는 시각은 나가는 시각 이후여야 합니다.`;
    const values = [start, end, ...Object.values(mealWindows).flatMap(window => [window.start, window.end])];
    for (const value of values.filter(Boolean)) {
      try { Temporal.PlainDate.from(date).toPlainDateTime(value).toZonedDateTime(context.timeZone, { disambiguation: 'reject' }); }
      catch { fields[date] = `${date}: 시간대 ${context.timeZone}에서 존재하지 않거나 중복되는 시각입니다.`; }
    }
  }
  if (Object.keys(fields).length) throw new TripInputError(fields);
  return { departureTime, returnTime, mealSlots, mealWindows, taxiPolicy: taxiPolicy as LivingSettings['taxiPolicy'], days };
}
