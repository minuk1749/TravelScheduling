import { Temporal } from '@js-temporal/polyfill';
import type { TripInputs } from '../services/itinerary/types';
import { TripInputError } from '../trips/input';
import type { Constraints, LegEdit, VisitEdit } from './model';

const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
function validConstraintDate(value: unknown, input: TripInputs): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  try { return Temporal.PlainDate.from(value).toString() === value && value >= input.startDate && value <= input.endDate; } catch { return false; }
}

export function parseConstraints(value: unknown, input: TripInputs): Constraints {
  const raw = record(value), fields: Record<string, string> = {};
  const fail = (key: string, message: string) => { fields[key] = message; };
  const date = (value: unknown): value is string => validConstraintDate(value, input);
  const ids = new Set(input.visits.map(visit => visit.id)), seen = new Set<string>();
  const visits: VisitEdit[] = [];
  if (!Array.isArray(raw.visits) || raw.visits.length !== ids.size) fail('visits', '모든 장소의 설정을 보내 주세요.');
  else for (const item of raw.visits) {
    const row = record(item), key = `visits.${String(row.id)}`;
    if (typeof row.id !== 'string' || !ids.has(row.id) || seen.has(row.id)) { fail('visits', '여행에 속한 장소를 중복 없이 선택해 주세요.'); continue; }
    seen.add(row.id);
    if (row.priority !== 'REQUIRED' && row.priority !== 'WISH') fail(key, '필수 또는 희망을 선택해 주세요.');
    if (row.fixedDate !== null && !date(row.fixedDate)) fail(key, '여행 기간 안의 날짜를 선택해 주세요.');
    if (row.fixedTime !== null) {
      if (typeof row.fixedTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(row.fixedTime) || !date(row.fixedDate)) fail(key, '고정 시각에는 날짜와 유효한 시각이 필요합니다.');
      else try { Temporal.PlainDateTime.from(`${row.fixedDate}T${row.fixedTime}`).toZonedDateTime(input.timeZone, { disambiguation: 'reject' }); }
      catch { fail(key, '시간대에서 존재하지 않거나 중복되는 시각입니다.'); }
    }
    if (row.fixedOrder !== null && (typeof row.fixedOrder !== 'number' || !Number.isSafeInteger(row.fixedOrder) || row.fixedOrder < 0 || row.fixedOrder >= ids.size || !date(row.fixedDate))) fail(key, '고정 순서는 날짜와 0부터 시작하는 방문 위치가 필요합니다.');
    visits.push(row as VisitEdit);
  }
  let legs: LegEdit[] = [];
  try { legs = parseLegModes(raw.legModes, input); }
  catch (error) { if (!(error instanceof TripInputError)) throw error; Object.assign(fields, error.fields); }
  if (Object.keys(fields).length) throw new TripInputError(fields);
  return { visits: visits.map(v => ({ id: v.id, priority: v.priority, fixedDate: v.fixedDate, fixedTime: v.fixedTime, fixedOrder: v.fixedOrder })), legModes: legs };
}

export function parseLegModes(value: unknown, input: TripInputs): LegEdit[] {
  const fields: Record<string, string> = {};
  const fail = (key: string, message: string) => { fields[key] = message; };
  const date = (value: unknown): value is string => validConstraintDate(value, input);
  const places = new Set([...input.visits.map(v => v.place.id), ...input.flights.map(f => f.airport.id), ...input.lodgings.map(l => l.place.id)]);
  const legs: LegEdit[] = [], legKeys = new Set<string>();
  if (!Array.isArray(value) || value.length > 1000) fail('legModes', '이동수단 설정이 올바르지 않습니다.');
  else for (const item of value) {
    const row = record(item), key = JSON.stringify([row.date, row.from, row.to]);
    if (!date(row.date) || typeof row.from !== 'string' || !places.has(row.from) || typeof row.to !== 'string' || !places.has(row.to) || typeof row.mode !== 'string' || !['TRANSIT', 'WALK', 'TAXI'].includes(row.mode) || legKeys.has(key)) fail('legModes', '날짜·구간·이동수단을 확인해 주세요.');
    legKeys.add(key); legs.push(row as LegEdit);
  }
  if (Object.keys(fields).length) throw new TripInputError(fields);
  return legs.map(l => ({ date: l.date, from: l.from, to: l.to, mode: l.mode }));
}
