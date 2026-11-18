import { createHash, randomBytes } from 'node:crypto';
import { isShareToken, ShareUnavailableError, type ShareRepository, type SharedItinerary } from '../sharing/model';
import { displayInput } from '../results/model';
import type { ItineraryPlaces } from './itinerary/types';
import { displayPlaces, tripPlaceRefs } from './itinerary/display-places';

export const hashShareToken = (token: string) => createHash('sha256').update(token).digest('hex');

export class SharingService {
  constructor(private readonly repository: ShareRepository, private readonly places: () => Pick<ItineraryPlaces, 'details'>) {}

  async rotate(tripId: string, ownerId: string): Promise<string | null> {
    const token = randomBytes(32).toString('base64url');
    return await this.repository.rotate(tripId, ownerId, hashShareToken(token)) ? token : null;
  }

  async read(token: string): Promise<SharedItinerary | null> {
    if (!isShareToken(token)) return null;
    const hash = hashShareToken(token);
    const snapshot = await this.repository.load(hash);
    if (!snapshot) return null;
    if (snapshot === 'UNAVAILABLE') throw new ShareUnavailableError();
    const { input, result } = snapshot;
    const places = await displayPlaces(this.places(), tripPlaceRefs(input), input.timeZone, input.startDate);
    // Rotation during a slow provider call must not return the old capability's data.
    if (!await this.repository.isActive(hash)) return null;
    return { view: { input: displayInput(input), places }, result };
  }
}
