import type { Visit } from '../scheduler';

export type PlaceSummary = {
  googlePlaceId: string;
  name: string;
  attributions: readonly { provider: string; providerUri: string }[];
};
export type PlaceSearchRequest = { query: string; language: 'ko'; regionCode?: string };
export type PlaceDetailsRequest = {
  googlePlaceId: string; language: 'ko'; dates: readonly string[]; timeZone: string;
};
export type PlaceLocation = {
  googlePlaceId: string;
  coordinates: Visit['coordinates'];
  cacheExpiresAt: string;
};
export type PlaceDetails = PlaceSummary & PlaceLocation & {
  openingHours?: Visit['openingHours'];
  types: readonly string[];
};

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
