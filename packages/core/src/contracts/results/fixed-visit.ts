import { Temporal } from '@js-temporal/polyfill';
import { TripInputError } from '../trips/input';
import type { VisitEdit } from './model';

type TripPeriod = { startDate: string; endDate: string; timeZone: string };
export type FixedVisit = Pick<VisitEdit, 'fixedDate' | 'fixedTime' | 'fixedOrder'>;

export function validConstraintDate(value: unknown, input: Pick<TripPeriod, 'startDate' | 'endDate'>): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  try { return Temporal.PlainDate.from(value).toString() === value && value >= input.startDate && value <= input.endDate; }
  catch { return false; }
}

export function parseFixedVisit(
  row: Record<string, unknown>, trip: TripPeriod, visitCount: number,
): FixedVisit {
  const { fixedDate, fixedTime, fixedOrder } = row;
  const fields: Record<string, string> = {};
  if (fixedDate !== null && !validConstraintDate(fixedDate, trip)) fields.fixedDate = '여행 기간 안의 날짜를 선택해 주세요.';
  if (fixedTime !== null) {
    if (typeof fixedTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(fixedTime) || !validConstraintDate(fixedDate, trip)) {
      fields.fixedTime = '고정 시각에는 날짜와 유효한 시각이 필요합니다.';
    } else try {
      Temporal.PlainDateTime.from(`${fixedDate}T${fixedTime}`).toZonedDateTime(trip.timeZone, { disambiguation: 'reject' });
    } catch { fields.fixedTime = '시간대에서 존재하지 않거나 중복되는 시각입니다.'; }
  }
  if (fixedOrder !== null && (typeof fixedOrder !== 'number' || !Number.isSafeInteger(fixedOrder)
    || fixedOrder < 0 || fixedOrder >= visitCount || !validConstraintDate(fixedDate, trip))) {
    fields.fixedOrder = '고정 순서는 날짜와 0부터 시작하는 방문 위치가 필요합니다.';
  }
  if (Object.keys(fields).length) throw new TripInputError(fields);
  return { fixedDate, fixedTime, fixedOrder } as FixedVisit;
}
