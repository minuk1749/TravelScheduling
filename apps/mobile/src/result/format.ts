import { Temporal } from '@js-temporal/polyfill';
import type { TripInputs } from '@travel/core/contracts/itinerary';
import { localTime, MODES } from '@travel/core/presentation';
import type { TimeWindow } from '@travel/core/scheduler';
import type { TravelModeName } from '../map/types';

const SYMBOLS: Readonly<Record<string, string>> = {
  JPY: '¥', KRW: '₩', USD: '$', EUR: '€', GBP: '£', TWD: 'NT$', HKD: 'HK$', SGD: 'S$', THB: '฿', VND: '₫',
};
const WEEKDAYS = ['월요일', '화요일', '수요일', '목요일', '금요일', '토요일', '일요일'] as const;

/** "45분", "1시간", "2시간 15분". Fractional minutes round up like the scheduler's reserved time. */
export function durationLabel(minutes: number): string {
  const total = Math.ceil(minutes);
  const hours = Math.floor(total / 60), rest = total % 60;
  if (!hours) return `${rest}분`;
  return rest ? `${hours}시간 ${rest}분` : `${hours}시간`;
}

/** §5: estimated fares start with "약", unknown fares are "—". */
export function moneyLabel(amount: number | null, currency: string | null, estimated = false): string {
  if (amount === null || !currency) return '요금 —';
  const value = Math.round(amount).toLocaleString('ko-KR');
  const symbol = SYMBOLS[currency];
  return `${estimated ? '약 ' : ''}${symbol ? `${symbol}${value}` : `${value} ${currency}`}`;
}

const estimated = (mode: TravelModeName) => mode === 'TAXI';

/** Card row 5 / full-schedule move row: "대중교통 25분 · ¥240", "택시 14분 · 약 ¥2,300", "도보 12분". */
export function legLabel(mode: TravelModeName, minutes: number, fare: number | null, currency: string | null): string {
  if (mode === 'WALK') return `${MODES.WALK} ${durationLabel(minutes)}`;
  return `${MODES[mode]} ${durationLabel(minutes)} · ${moneyLabel(fare, currency, estimated(mode))}`;
}

/** Switch chip: "택시 14분 약 ¥2,300", or "택시 정보 없음" when that mode has no route. */
export function swapLabel(swap: { mode: TravelModeName; estimate: { minutes: number; fare: number | null } | null }, currency: string | null): string {
  if (!swap.estimate) return `${MODES[swap.mode]} 정보 없음`;
  return `${MODES[swap.mode]} ${durationLabel(swap.estimate.minutes)} ${moneyLabel(swap.estimate.fare, currency, estimated(swap.mode))}`;
}

/** Panel date title: "12월 3일 목요일". */
export function dateTitle(date: string): string {
  const day = Temporal.PlainDate.from(date);
  return `${day.month}월 ${day.day}일 ${WEEKDAYS[day.dayOfWeek - 1]}`;
}

const monthDay = (date: string) => {
  const day = Temporal.PlainDate.from(date);
  return `${day.month}.${day.day}`;
};

/** Date chip: "2일 12.4" (trip day number, month.day). */
export const dateChipLabel = (date: string, number: number) => `${number}일 ${monthDay(date)}`;
export const dayNumberLabel = (number: number) => `${number}일차`;
/** Sheet date option: "2일차 12.4". */
export const dayOptionLabel = (date: string, number: number) => `${dayNumberLabel(number)} ${monthDay(date)}`;

export const periodLabel = (input: Pick<TripInputs, 'startDate' | 'endDate'>) =>
  `${monthDay(input.startDate)} – ${monthDay(input.endDate)}`;

export function timeRange(start: string, end: string, zone: string): string {
  const startDate = Temporal.Instant.from(start).toZonedDateTimeISO(zone).toPlainDate();
  const endDate = Temporal.Instant.from(end).toZonedDateTimeISO(zone).toPlainDate();
  const endDay = startDate.equals(endDate) ? '' : `${endDate.month}월 ${endDate.day}일 `;
  return `${localTime(start, zone)} – ${endDay}${localTime(end, zone)}`;
}

export const minutesBetween = (start: string, end: string) =>
  (Temporal.Instant.from(end).epochMilliseconds - Temporal.Instant.from(start).epochMilliseconds) / 60_000;

/** "15분 늦춰짐" / "10분 당겨짐"; empty when unchanged. */
export function shiftLabel(shift: number): string {
  if (!shift) return '';
  return `${durationLabel(Math.abs(shift))} ${shift > 0 ? '늦춰짐' : '당겨짐'}`;
}

/** Card row 3: "15:00 예약 고정", "2번째 순서 고정", "날짜 고정". */
export function fixedLabel(visit: Pick<TripInputs['visits'][number], 'fixedDate' | 'fixedTime' | 'fixedOrder'>): string | null {
  const parts = [
    visit.fixedTime && `${visit.fixedTime} 예약 고정`,
    visit.fixedOrder !== undefined && visit.fixedOrder !== null && `${visit.fixedOrder + 1}번째 순서 고정`,
  ].filter((part): part is string => !!part);
  if (!parts.length && visit.fixedDate) parts.push('날짜 고정');
  return parts.length ? parts.join(' · ') : null;
}

/** Display the same instant bounds the scheduler used after applying flights and airport transfers. */
export function freeTime(window: TimeWindow | null | undefined, zone: string): string {
  if (window === undefined) return '여유 시간 정보 없음';
  if (window === null) return '여유 시간 없음';
  return `여유 시간 ${timeRange(window.start, window.end, zone)} · ${durationLabel(minutesBetween(window.start, window.end))}`;
}
