import type { PlaceDetails } from '../places';
import type { TravelMode } from '../scheduler';
import type { TripInputs } from '../services/itinerary/types';

export type VisitEdit = {
  id: string; priority: 'REQUIRED' | 'WISH';
  fixedDate: string | null; fixedTime: string | null; fixedOrder: number | null;
};
export type LegEdit = { date: string; from: string; to: string; mode: TravelMode };
export type Constraints = { visits: VisitEdit[]; legModes: LegEdit[] };
export type ResultSnapshot = { input: TripInputs; revision: string };
export type ResultView = ResultSnapshot & { places: Record<string, Pick<PlaceDetails, 'googlePlaceId' | 'name' | 'coordinates' | 'attributions'> | null> };
export function constraintsFrom(input: TripInputs): Constraints {
  return {
    visits: input.visits.map(visit => ({ id: visit.id, priority: visit.priority,
      fixedDate: visit.fixedDate ?? null, fixedTime: visit.fixedTime ?? null, fixedOrder: visit.fixedOrder ?? null })),
    legModes: [...input.legModes ?? []],
  };
}
