import type { PlaceProvider, PlaceLocation } from '../places';
import type { RouteShapeProvider } from '../travel-time/shapes';
import type { LegShape, RouteShapeRepository, SavedRouteShapesResponse, ShapeLoad } from '../route-shapes/model';
import { tripPlaceRefs } from './itinerary/display-places';

export const SHAPE_CONCURRENCY = 4;
export type ShapeOutcome = Exclude<ShapeLoad, { status: 'READY' }> | { status: 'OK'; response: SavedRouteShapesResponse };

/** Only selected saved legs are queried. A failure rejects the entire request. */
export class RouteShapeService {
  constructor(
    private readonly repository: RouteShapeRepository,
    private readonly places: Pick<PlaceProvider, 'location'>,
    private readonly provider: RouteShapeProvider,
  ) {}

  async read(tripId: string, ownerId: string, inputHash: string, itineraryId?: string): Promise<ShapeOutcome> {
    const loaded = await this.repository.load(tripId, ownerId, inputHash, itineraryId);
    if (loaded.status !== 'READY') return loaded;
    const { input, comparisons } = loaded.snapshot;
    const refs = new Map(tripPlaceRefs(input).map(ref => [ref.id, ref.googlePlaceId]));
    // Deduplicate coordinates only, never route shapes. Uses the existing permitted location cache.
    const locations = new Map<string, Promise<PlaceLocation | null>>();
    const locate = (id: string) => {
      const googleId = refs.get(id);
      if (!googleId) throw new Error('Saved leg references an unknown place.');
      let pending = locations.get(googleId);
      if (!pending) { pending = this.places.location(googleId); locations.set(googleId, pending); }
      return pending;
    };
    const legs: LegShape[] = new Array(comparisons.length);
    let next = 0, failed = false;
    const worker = async () => {
      while (!failed && next < comparisons.length) {
        const index = next++, leg = comparisons[index];
        try {
          const [from, to] = await Promise.all([locate(leg.from), locate(leg.to)]);
          if (failed) return;
          const shape = from && to ? await this.provider.shape({
            from: from.coordinates, to: to.coordinates, mode: leg.selected.mode === 'TAXI' ? 'DRIVE' : leg.selected.mode,
            departure: leg.departure, timeZone: input.timeZone,
          }) : null;
          legs[index] = { date: leg.date, kind: leg.kind, from: leg.from, to: leg.to, mode: leg.selected.mode,
            shape: shape ? { status: 'OK', encodedPolyline: shape.encodedPolyline } : { status: 'NONE' } };
        } catch (error) { failed = true; throw error; }
      }
    };
    // Drain in-flight workers on failure; do not dispatch further legs or return partial success.
    const results = await Promise.allSettled(Array.from({ length: Math.min(SHAPE_CONCURRENCY, comparisons.length) }, worker));
    for (const result of results) if (result.status === 'rejected') throw result.reason;
    return { status: 'OK', response: { inputHash, itineraryId: loaded.snapshot.itineraryId, legs } };
  }
}
