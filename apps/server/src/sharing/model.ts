import type { ItineraryDisplayResult } from '../results/model';
import type { TripInputs } from '../services/itinerary/types';
export { isShareToken, type SharedItinerary } from '@travel/core/contracts/sharing';

/** Stored state behind a share link; the service narrows `input` before anything leaves the server. */
export type SharedSnapshot = { input: TripInputs; result: ItineraryDisplayResult };
export interface ShareRepository {
  rotate(tripId: string, ownerId: string, tokenHash: string): Promise<boolean>;
  load(tokenHash: string): Promise<SharedSnapshot | 'UNAVAILABLE' | null>;
  isActive(tokenHash: string): Promise<boolean>;
}
export class ShareUnavailableError extends Error {}
