import { TravelProviderError, type Location, type ProviderMode } from './index';

export function invalid(): never { throw new TravelProviderError('INVALID_RESPONSE'); }
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}

export function waypoint(location: Location) { return { location: { latLng: location.coordinates } }; }
export function options(mode: ProviderMode, departure: string) {
  return {
    travelMode: mode, languageCode: 'ko', units: 'METRIC',
    // WALK and traffic-unaware DRIVE do not depend on a timetable.
    ...(mode === 'TRANSIT' ? { departureTime: departure } : {}),
    ...(mode === 'DRIVE' ? { routingPreference: 'TRAFFIC_UNAWARE' } : {}),
  };
}

/** Shared Google transport; never persists responses or includes provider bodies in errors. */
export class GoogleRoutesClient {
  constructor(private readonly apiKey: string, private readonly fetcher: typeof fetch = fetch) {}

  async request(path: string, fields: string, body: unknown): Promise<unknown> {
    if (!this.apiKey) throw new TravelProviderError('UNAVAILABLE');
    try {
      const response = await this.fetcher(`https://routes.googleapis.com/${path}`, {
        method: 'POST', body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': this.apiKey, 'X-Goog-FieldMask': fields },
        cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new TravelProviderError('UNAVAILABLE');
      try { return await response.json(); }
      catch { return invalid(); }
    } catch (error) {
      if (error instanceof TravelProviderError) throw error;
      throw new TravelProviderError('UNAVAILABLE');
    }
  }
}
