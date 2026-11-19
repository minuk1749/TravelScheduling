import { parseFixedVisit, type FixedVisit } from '../results/fixed-visit';
import { parseSettings } from '../settings/input';
import type { LivingSettings } from '../settings/model';
import { parseTripDraft, TripInputError, type TripDraft } from './input';

type TripVisit = TripDraft['visits'][number];
export type TripCreation = Omit<TripDraft, 'visits'> & {
  visits: (TripVisit & Partial<FixedVisit>)[];
  settings?: LivingSettings;
};
export type TripSummary = Pick<TripDraft, 'cityCode' | 'startDate' | 'endDate'> & { id: string };

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function parseTripCreation(value: unknown): TripCreation {
  const draft = parseTripDraft(value);
  const body = record(value);
  const fields: Record<string, string> = {};
  const collect = (error: unknown, prefix: string) => {
    if (!(error instanceof TripInputError)) throw error;
    for (const [key, message] of Object.entries(error.fields)) fields[`${prefix}.${key}`] = message;
  };
  const visits = draft.visits.map((visit, index) => {
    const row = record((body.visits as unknown[])[index]);
    const fixed = {
      fixedDate: row.fixedDate === undefined ? null : row.fixedDate,
      fixedTime: row.fixedTime === undefined ? null : row.fixedTime,
      fixedOrder: row.fixedOrder === undefined ? null : row.fixedOrder,
    };
    if (Object.values(fixed).every(value => value === null)) return visit;
    try { return { ...visit, ...parseFixedVisit(fixed, draft, draft.visits.length) }; }
    catch (error) { collect(error, `visits.${index}`); return visit; }
  });
  let settings: LivingSettings | undefined;
  if (body.settings !== undefined) {
    try { settings = parseSettings({ ...record(body.settings), taxiPolicy: draft.taxiPolicy }, draft); }
    catch (error) { collect(error, 'settings'); }
  }
  if (Object.keys(fields).length) throw new TripInputError(fields);
  return { ...draft, visits, ...(settings && { settings }) };
}
