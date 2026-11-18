import type { ItineraryDisplayResult, ResultDisplayView } from '../results/model';
import type { TripInputs } from '../services/itinerary/types';

export type SharedItinerary = { view: ResultDisplayView; result: ItineraryDisplayResult };
/** Stored state behind a share link; the service narrows `input` before anything leaves the server. */
export type SharedSnapshot = { input: TripInputs; result: ItineraryDisplayResult };
export interface ShareRepository {
  rotate(tripId: string, ownerId: string, tokenHash: string): Promise<boolean>;
  load(tokenHash: string): Promise<SharedSnapshot | 'UNAVAILABLE' | null>;
  isActive(tokenHash: string): Promise<boolean>;
}
export class ShareUnavailableError extends Error {}
export const isShareToken = (token: string) => /^[A-Za-z0-9_-]{43}$/.test(token);
