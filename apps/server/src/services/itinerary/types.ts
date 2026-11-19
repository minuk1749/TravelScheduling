import type { CityProfile } from '../../fare';
import type { PlaceProvider } from '../../places';
import type { TravelTimeProvider } from '../../travel-time';
import type { TripInputs, ItineraryResult } from '@travel/core/contracts/itinerary';
export type * from '@travel/core/contracts/itinerary';

export type TripLoad =
  | { status: 'READY'; input: TripInputs; inputHash: string }
  | { status: 'INCOMPLETE'; fields: readonly string[] };

export type SaveOutcome = { status: 'SAVED'; itineraryId: string } | { status: 'STALE' };

export interface ItineraryRepository {
  loadInputs(tripId: string): Promise<TripLoad | null>;
  /** Must lock the trip and re-check the input hash; returns STALE when inputs changed. */
  saveItinerary(tripId: string, inputHash: string, result: ItineraryResult): Promise<SaveOutcome>;
}

export interface CityProfileSource {
  findByCityCode(cityCode: string): Promise<CityProfile | null>;
}

export type ItineraryPlaces = Pick<PlaceProvider, 'details' | 'location'>;

export interface ItineraryDependencies {
  repository: ItineraryRepository;
  profiles: CityProfileSource;
  places: ItineraryPlaces;
  travel: TravelTimeProvider;
}

export type GenerateOutcome =
  | { status: 'NOT_FOUND' }
  | { status: 'INCOMPLETE'; fields: readonly string[] }
  | { status: 'STALE' }
  | { status: 'SAVED'; itineraryId: string; inputHash: string; result: ItineraryResult };

/** The stored trip cannot be scheduled until the listed fields are corrected. */
export class ItineraryInputError extends Error {
  constructor(readonly fields: Record<string, string>) {
    super('일정을 만들 수 없는 입력이 있습니다. 여행 정보를 확인해 주세요.');
  }
}
