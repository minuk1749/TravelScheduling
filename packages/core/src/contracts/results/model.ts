import type { PlaceDetails } from '../places';
import type { CapacityRecommendation, ScheduleResult, TravelMode } from '../../scheduler';
import type { ItineraryResult, TripInputs } from '../itinerary';

export type VisitEdit = {
  id: string; priority: 'REQUIRED' | 'WISH';
  fixedDate: string | null; fixedTime: string | null; fixedOrder: number | null;
};
export type LegEdit = { date: string; from: string; to: string; mode: TravelMode };
export type Constraints = { visits: VisitEdit[]; legModes: LegEdit[] };
export type ConstraintWriteOptions = { operationId?: string; expectedWriteVersion?: string; expectedOperationId?: string };
export type ConstraintReceipt = { operationId: string; revision: string };
export type ResultRevision = { revision: string };
export function isResultRevision(value: unknown): value is ResultRevision {
  return typeof value === 'object' && value !== null && 'revision' in value &&
    typeof value.revision === 'string' && value.revision.length > 0;
}
export type ResultSnapshot = ResultRevision & {
  input: TripInputs;
  /** Opaque generation of the saved input. Older servers omit this field. */
  writeVersion?: string;
  /** Returned only to the caller who presents the operation ID for the current write. */
  receipt?: ConstraintReceipt;
};
export type ResultView = ResultSnapshot & { places: Record<string, Pick<PlaceDetails, 'googlePlaceId' | 'name' | 'coordinates' | 'attributions'> | null> };
/** Only fields needed to display a result; no owner, revision or editable settings. */
export type ResultDisplayView = {
  input: Pick<TripInputs, 'startDate' | 'endDate' | 'timeZone'> & {
    visits: readonly Pick<TripInputs['visits'][number], 'id' | 'place' | 'priority'>[];
  };
  places: ResultView['places'];
};
/** Display needs the witness's days; full-request failures remain in capacity.unplaced/issues. */
export type ItineraryDisplayResult = Omit<ItineraryResult, 'capacity'> & {
  capacity: Omit<ItineraryResult['capacity'], 'recommendation'> & {
    recommendation: (Omit<CapacityRecommendation, 'schedule'> & { schedule: Pick<ScheduleResult, 'days'> }) | null;
  };
};
/** Narrows stored inputs to the display fields, so read-only views never carry owner settings. */
export function displayInput(input: TripInputs): ResultDisplayView['input'] {
  return { startDate: input.startDate, endDate: input.endDate, timeZone: input.timeZone,
    visits: input.visits.map(({ id, place, priority }) => ({ id, place, priority })) };
}
export function constraintsFrom(input: TripInputs): Constraints {
  return {
    visits: input.visits.map(visit => ({ id: visit.id, priority: visit.priority,
      fixedDate: visit.fixedDate ?? null, fixedTime: visit.fixedTime ?? null, fixedOrder: visit.fixedOrder ?? null })),
    legModes: [...input.legModes ?? []],
  };
}
