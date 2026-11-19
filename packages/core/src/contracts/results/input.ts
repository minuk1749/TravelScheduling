import type { TripInputs } from '../itinerary';
import { TripInputError } from '../trips/input';
import { parseFixedVisit, validConstraintDate } from './fixed-visit';
import type { Constraints, LegEdit, VisitEdit } from './model';

const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export function parseConstraints(value: unknown, input: TripInputs): Constraints {
  const raw = record(value), fields: Record<string, string> = {};
  const fail = (key: string, message: string) => { fields[key] = message; };
  const ids = new Set(input.visits.map(visit => visit.id)), seen = new Set<string>();
  const visits: VisitEdit[] = [];
  if (!Array.isArray(raw.visits) || raw.visits.length !== ids.size) fail('visits', '모든 장소의 설정을 보내 주세요.');
  else for (const item of raw.visits) {
    const row = record(item), key = `visits.${String(row.id)}`;
    if (typeof row.id !== 'string' || !ids.has(row.id) || seen.has(row.id)) { fail('visits', '여행에 속한 장소를 중복 없이 선택해 주세요.'); continue; }
    seen.add(row.id);
    if (row.priority !== 'REQUIRED' && row.priority !== 'WISH') fail(key, '필수 또는 희망을 선택해 주세요.');
    try { parseFixedVisit(row, input, ids.size); }
    catch (error) {
      if (!(error instanceof TripInputError)) throw error;
      fail(key, Object.values(error.fields).at(-1)!);
    }
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
