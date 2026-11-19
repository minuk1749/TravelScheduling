import type { Location, ProviderMode } from './index';

export type RouteShapeRequest = {
  from: Location['coordinates']; to: Location['coordinates'];
  mode: ProviderMode; departure: string; timeZone: string;
};

/** Separate from duration/fare lookup; null means no route, failures throw TravelProviderError. */
export interface RouteShapeProvider {
  shape(request: RouteShapeRequest): Promise<{ encodedPolyline: string } | null>;
}
