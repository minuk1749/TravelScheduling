import type { ConflictCause } from '../result/conflicts';
import type { CardModel, DayModel } from '../result/days';
import type { Change } from '../result/edits';
import type { MapRouteEmphasis } from './types';

/** The selected date and card index. Card, marker and highlighted legs always derive from it. */
export type Selection = { date: string; index: number };

/**
 * BROWSE 3-1, EDIT 3-3 (edited place's legs), CALCULATING 3-5 (pending legs hidden),
 * CONFLICT 3-8 (all faded + red cause legs), PREVIOUS 3-9 (last result faded).
 */
export type MapFocus = 'BROWSE' | 'EDIT' | 'CALCULATING' | 'CONFLICT' | 'PREVIOUS';
export type LegEmphasis = MapRouteEmphasis | 'HIDDEN';

export const clampIndex = (index: number, count: number) => count ? Math.min(Math.max(Math.round(index), 0), count - 1) : 0;

export function dayOf(days: readonly DayModel[], selection: Selection): DayModel | undefined {
  return days.find(day => day.date === selection.date) ?? days[0];
}

export function selectedCard(days: readonly DayModel[], selection: Selection): CardModel | null {
  const day = dayOf(days, selection);
  return day?.cards[clampIndex(selection.index, day.cards.length)] ?? null;
}

/** Previous/next buttons stay inside the day. */
export function stepSelection(days: readonly DayModel[], selection: Selection, delta: -1 | 1): Selection {
  const count = dayOf(days, selection)?.cards.length ?? 0;
  return { ...selection, index: clampIndex(selection.index + delta, count) };
}

/** "N / 전체" and whether 이전·다음 are enabled. */
export function pagerState(index: number, count: number) {
  const position = clampIndex(index, count);
  return { position: count ? position + 1 : 0, count, previous: position > 0, next: position < count - 1 };
}

/**
 * Card index after a horizontal swipe. The release velocity (pt/ms) projects the throw; a drag
 * over a quarter card moves at least one card in its direction.
 */
export function swipeTarget(index: number, distance: number, velocity: number, count: number, stride: number): number {
  const projected = distance + velocity * 200;
  let delta = Math.round(-projected / stride);
  if (delta === 0 && Math.abs(distance) > stride / 4) delta = distance < 0 ? 1 : -1;
  return clampIndex(index + delta, count);
}

export function findVisit(days: readonly DayModel[], visitId: string): Selection | null {
  for (const day of days) {
    const index = day.cards.findIndex(card => card.visitId === visitId);
    if (index >= 0) return { date: day.date, index };
  }
  return null;
}

/** "날짜를 바꾸면 그날 첫 장소 카드를 선택한다." */
export const selectDate = (date: string): Selection => ({ date, index: 0 });

/** 3-1 starts at the first date's first card; 3-8 starts at the first cause's card or date. */
export function initialSelection(days: readonly DayModel[], causes: readonly ConflictCause[] = []): Selection {
  for (const cause of causes) {
    const found = cause.visitId ? findVisit(days, cause.visitId) : null;
    if (found) return found;
  }
  const date = causes.find(cause => cause.date && days.some(day => day.date === cause.date))?.date;
  return selectDate(date ?? days[0]?.date ?? '');
}

/** After a recalculation keep the same visit selected when it still exists, else the same date. */
export function reconcileSelection(days: readonly DayModel[], previous: Selection, visitId: string | null): Selection {
  const found = visitId ? findVisit(days, visitId) : null;
  if (found) return found;
  const day = dayOf(days, previous);
  return day ? { date: day.date, index: clampIndex(previous.index, day.cards.length) } : previous;
}

/** Only the placed visit's arrival and departure belong to that edit, even if a lodging shares its place ID. */
function visitLegKeys(card: CardModel | null | undefined): Set<string> {
  const keys = new Set<string>();
  if (card?.arrival) keys.add(card.arrival.key);
  if (card?.departure) keys.add(card.departure.key);
  return keys;
}

export function pendingLegKeys(days: readonly DayModel[], change: Change | null, reversing = false): Set<string> {
  if (!change) return new Set();
  if (change.kind === 'UNDO') return pendingLegKeys(days, change.of, !reversing);
  if (change.kind === 'RETRY') return new Set(days.flatMap(day => day.legs.map(leg => leg.key)));
  if (change.kind === 'MODE') return new Set([change.leg.key]);
  const placed = findVisit(days, change.visitId);
  const card = placed && selectedCard(days, placed);
  const keys = visitLegKeys(card);
  const destination = reversing ? change.previousDate : change.date;
  if (destination && !(card?.start && placed?.date === destination)) {
    // The scheduler chooses the insertion point. The day's visit legs may change, while
    // airport transfers are calculated separately from the day's place order.
    const target = days.find(day => day.date === destination);
    for (const leg of target?.legs ?? []) if (leg.kind === 'DAY') keys.add(leg.key);
  }
  return keys;
}

/** §6 state table: how each leg of the selected day is drawn. */
export function legEmphasis(day: DayModel | undefined, card: CardModel | null, focus: MapFocus,
  pending: ReadonlySet<string> = new Set()): Map<string, LegEmphasis> {
  const emphasis = new Map<string, LegEmphasis>();
  const editing = focus === 'EDIT' ? visitLegKeys(card) : null;
  for (const leg of day?.legs ?? []) {
    let value: LegEmphasis = 'DIM';
    if (focus === 'CALCULATING') value = pending.has(leg.key) ? 'HIDDEN' : 'STRONG';
    else if (focus === 'BROWSE') value = card?.arrival?.key === leg.key ? 'STRONG' : 'DIM';
    else if (editing?.has(leg.key)) value = 'STRONG';
    emphasis.set(leg.key, value);
  }
  return emphasis;
}
