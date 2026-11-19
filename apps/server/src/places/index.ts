import type { PlaceSearchRequest, PlaceDetailsRequest, PlaceSummary, PlaceDetails, PlaceLocation } from '@travel/core/contracts/places';
export type * from '@travel/core/contracts/places';

export interface PlaceProvider {
  search(input: PlaceSearchRequest): Promise<readonly PlaceSummary[]>;
  details(input: PlaceDetailsRequest): Promise<PlaceDetails | null>;
  location(googlePlaceId: string): Promise<PlaceLocation | null>;
}

export class PlaceInputError extends Error {}
export class PlaceProviderError extends Error {
  constructor(readonly kind: 'UNAVAILABLE' | 'INVALID_RESPONSE') {
    super('장소 제공자 요청에 실패했습니다.');
  }
}
