import type { Location, ProviderMode } from '../../src/travel-time';

export const locations: Location[] = [
  { id: 'hotel', coordinates: { latitude: 35.68, longitude: 139.76 } },
  { id: 'museum', coordinates: { latitude: 35.71, longitude: 139.78 } },
];

/** Synthetic Google-shaped fixtures; no API credentials, calls, or retained Google content. */
export function routeFixture(mode: ProviderMode, reverse = false) {
  return {
    duration: mode === 'TRANSIT' ? (reverse ? '720s' : '600.5s') : mode === 'WALK' ? '900s' : '300s',
    distanceMeters: reverse ? 2200 : 2000,
    ...(mode === 'TRANSIT' && !reverse ? {
      travelAdvisory: { transitFare: { currencyCode: 'JPY', units: '210', nanos: 500_000_000 } },
    } : {}),
  };
}
