import type { ItineraryPlaces, TripLoad } from './types';
import type { Constraints, ResultSnapshot, ResultView } from '../../results/model';
import { parseConstraints } from '../../results/input';
import { TripInputError } from '../../trips/input';

export interface ConstraintRepository {
  loadInputs(tripId: string): Promise<TripLoad | null>;
  save(tripId: string, ownerId: string, revision: string, constraints: Constraints): Promise<ResultSnapshot | null>;
}
export class ResultEditService {
  constructor(private readonly repository: ConstraintRepository, private readonly places: ItineraryPlaces) {}
  async load(tripId: string): Promise<ResultView> {
    const loaded = await this.repository.loadInputs(tripId);
    if (loaded?.status !== 'READY') throw new ResultUnavailableError();
    const { input, inputHash: revision } = loaded;
    const refs = new Map([...input.visits.map(v => v.place), ...input.flights.map(f => f.airport), ...input.lodgings.map(l => l.place)].map(p => [p.id, p]));
    // Fresh display metadata only: names and attributions never enter the database.
    const entries = await Promise.all([...refs.values()].map(async ref => {
      const place = await this.places.details({ googlePlaceId: ref.googlePlaceId, language: 'ko', timeZone: input.timeZone, dates: [input.startDate] });
      return [ref.id, place && { googlePlaceId: place.googlePlaceId, name: place.name, coordinates: place.coordinates, attributions: place.attributions }] as const;
    }));
    return { input, revision, places: Object.fromEntries(entries) };
  }
  async save(tripId: string, ownerId: string, body: unknown): Promise<ResultSnapshot> {
    const loaded = await this.repository.loadInputs(tripId);
    if (loaded?.status !== 'READY') throw new ResultUnavailableError();
    const row = body !== null && typeof body === 'object' ? body as Record<string, unknown> : {};
    if (typeof row.revision !== 'string') throw new TripInputError({ revision: '다시 불러온 후 저장해 주세요.' });
    if (row.revision !== loaded.inputHash) throw new ResultStaleError();
    const constraints = parseConstraints(row.constraints, loaded.input);
    const saved = await this.repository.save(tripId, ownerId, row.revision, constraints);
    if (!saved) throw new ResultStaleError();
    return saved;
  }
}
export class ResultUnavailableError extends Error {}
export class ResultStaleError extends Error {}
