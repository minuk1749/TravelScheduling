import type { Constraints, VisitEdit } from '@travel/core/contracts/results/model';
import type { TravelModeName } from '../map/types';
import type { DayModel } from './days';
import { shiftLabel } from './format';

/** What the user changed; also tells the map which legs are being recalculated (3-5). */
export type Change =
  | { kind: 'MODE'; leg: { key: string; date: string; from: string; to: string }; mode: TravelModeName }
  | { kind: 'VISIT'; visitId: string; date?: string | null; previousDate?: string | null }
  | { kind: 'WISH'; visitId: string; date: string; previousDate?: string | null }
  | { kind: 'UNDO'; of: Change }
  | { kind: 'RETRY' };

export const sameConstraints = (a: Constraints, b: Constraints) => JSON.stringify(a) === JSON.stringify(b);

/** Fixes one leg's mode, replacing an earlier fix of the same date and direction. */
export function withLegMode(constraints: Constraints, leg: { date: string; from: string; to: string }, mode: TravelModeName): Constraints {
  const rest = constraints.legModes.filter(row => !(row.date === leg.date && row.from === leg.from && row.to === leg.to));
  return { ...constraints, legModes: [...rest, { date: leg.date, from: leg.from, to: leg.to, mode }] };
}

export function withVisit(constraints: Constraints, edit: VisitEdit): Constraints {
  return { ...constraints, visits: constraints.visits.map(visit => visit.id === edit.id ? edit : visit) };
}

/** "희망으로 바꾸기": the visit leaves the schedule and its fixed conditions are cleared. */
export const asWish = (edit: VisitEdit): VisitEdit => ({ ...edit, priority: 'WISH', fixedDate: null, fixedTime: null, fixedOrder: null });

/** 3-4: a wish is added to a date by fixing only that date; it stays a wish. */
export const onDate = (edit: VisitEdit, date: string): VisitEdit => ({ ...edit, fixedDate: date, fixedTime: null, fixedOrder: null });

/** Toast detail after a recalculation: the first moved places, e.g. "도쿄 타워 15분 늦춰짐 외 1곳". */
export function movedSummary(days: readonly DayModel[]): string | null {
  const moved = days.flatMap(day => day.cards.filter(card => card.shift !== 0));
  if (!moved.length) return null;
  const shown = moved.slice(0, 2).map(card => `${card.name} ${shiftLabel(card.shift)}`).join(', ');
  return moved.length > 2 ? `${shown} 외 ${moved.length - 2}곳` : shown;
}
