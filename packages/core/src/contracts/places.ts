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

