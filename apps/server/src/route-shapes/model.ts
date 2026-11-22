import type { LegComparison, TripInputs } from '../services/itinerary/types';
export type { LegShape, RouteShapesResponse, SavedRouteShapesResponse } from '@travel/core/contracts/route-shapes';

export type ShapeSnapshot = { itineraryId: string; input: TripInputs; comparisons: readonly LegComparison[] };
export type ShapeLoad =
  | { status: 'READY'; snapshot: ShapeSnapshot }
  | { status: 'NOT_FOUND' | 'STALE_INPUT' | 'RESULT_UNAVAILABLE' };

export interface RouteShapeRepository {
  load(tripId: string, ownerId: string, inputHash: string, itineraryId?: string): Promise<ShapeLoad>;
}
