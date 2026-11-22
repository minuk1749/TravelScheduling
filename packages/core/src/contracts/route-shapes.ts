import type { TravelMode } from '../scheduler';

export type LegShape = {
  date: string;
  kind: 'DAY' | 'AIRPORT';
  /** Internal place IDs, matching itinerary comparisons. */
  from: string;
  to: string;
  mode: TravelMode;
  shape: { status: 'OK'; encodedPolyline: string } | { status: 'NONE' };
};

/** Without an itineraryId, the query reads the latest saved result for the input hash. */
export type RouteShapesQuery = { inputHash: string; itineraryId?: string };

/** Keep shapes in memory. Older servers' hash-only responses may omit the saved itinerary ID. */
export type RouteShapesResponse = RouteShapesQuery & { legs: LegShape[] };

/** Every successful response from the current server identifies the row that supplied its legs. */
export type SavedRouteShapesResponse = RouteShapesResponse & { itineraryId: string };
