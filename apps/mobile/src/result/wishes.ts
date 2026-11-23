import type { ItineraryResult } from '@travel/core/contracts/itinerary';
import type { ResultView } from '@travel/core/contracts/results/model';
import type { DayModel } from './days';

/** Visits with a scheduled stop on any date in the displayed itinerary. */
export const placedVisitIds = (days: readonly DayModel[]) =>
  new Set(days.flatMap(day => day.cards.filter(item => item.start).map(item => item.visitId)));

/** A current rejection makes a wish editable even when the map still shows its last successful stop. */
export function unplacedWishes(view: ResultView, days: readonly DayModel[], current?: ItineraryResult) {
  const placed = placedVisitIds(days);
  if (current?.status === 'CONFLICT') {
    for (const { visitId } of current.capacity.unplaced) placed.delete(visitId);
  }
  return view.input.visits.filter(visit => visit.priority === 'WISH' && !placed.has(visit.id));
}
