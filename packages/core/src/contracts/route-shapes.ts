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

/** Display only: do not persist shapes on the client. */
export type RouteShapesResponse = { inputHash: string; legs: LegShape[] };
