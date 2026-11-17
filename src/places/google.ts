import {
  PlaceProviderError, type PlaceDetails, type PlaceDetailsRequest, type PlaceLocation,
  type PlaceProvider, type PlaceSearchRequest, type PlaceSummary,
} from './index';
import { object, openingWindows } from './opening-hours';
import { detailsRequest, placeId, searchRequest } from './validation';

export const SEARCH_FIELDS = 'places.id,places.displayName,places.attributions';
export const DETAIL_FIELDS = 'id,displayName,location,regularOpeningHours,types,attributions,businessStatus';
export const LOCATION_FIELDS = 'id,location';

function text(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new PlaceProviderError('INVALID_RESPONSE');
  return value;
}

function summary(value: unknown): PlaceSummary {
  const data = object(value);
  const attributions = data.attributions ?? [];
  if (!Array.isArray(attributions)) throw new PlaceProviderError('INVALID_RESPONSE');
  return {
    googlePlaceId: text(data.id), name: text(object(data.displayName).text),
    attributions: attributions.map(value => {
      const attribution = object(value);
      return { provider: text(attribution.provider), providerUri: text(attribution.providerUri) };
    }),
  };
}

function coordinates(value: unknown): PlaceLocation['coordinates'] {
  const data = object(value);
  const latitude = data.latitude ?? 0, longitude = data.longitude ?? 0;
  if (typeof latitude !== 'number' || !Number.isFinite(latitude) || Math.abs(latitude) > 90 ||
      typeof longitude !== 'number' || !Number.isFinite(longitude) || Math.abs(longitude) > 180) {
    throw new PlaceProviderError('INVALID_RESPONSE');
  }
  return { latitude, longitude };
}

/** Server-side adapter. No full Google response is cached, including by Next's fetch cache. */
export class GooglePlaceProvider implements PlaceProvider {
  constructor(
    private readonly apiKey: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  private async request(path: string, fields: string, body?: unknown): Promise<unknown | null> {
    if (!this.apiKey) throw new PlaceProviderError('UNAVAILABLE');
    try {
      const response = await this.fetcher(`https://places.googleapis.com/v1/${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': this.apiKey, 'X-Goog-FieldMask': fields },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        cache: 'no-store', signal: AbortSignal.timeout(10_000), redirect: 'error',
      });
      if (response.status === 404 && body === undefined) return null;
      if (!response.ok) throw new PlaceProviderError('UNAVAILABLE');
      try { return object(await response.json()); }
      catch { throw new PlaceProviderError('INVALID_RESPONSE'); }
    } catch (error) {
      if (error instanceof PlaceProviderError) throw error;
      throw new PlaceProviderError('UNAVAILABLE');
    }
  }

  async search(input: PlaceSearchRequest): Promise<readonly PlaceSummary[]> {
    const normalized = searchRequest(input);
    const data = object(await this.request('places:searchText', SEARCH_FIELDS, {
      textQuery: normalized.query, languageCode: normalized.language,
      ...(normalized.regionCode ? { regionCode: normalized.regionCode } : {}), pageSize: 20,
    }));
    const places = data.places ?? [];
    if (!Array.isArray(places)) throw new PlaceProviderError('INVALID_RESPONSE');
    return places.map(summary);
  }

  async details(input: PlaceDetailsRequest): Promise<PlaceDetails | null> {
    const normalized = detailsRequest(input);
    const result = await this.request(`places/${encodeURIComponent(normalized.googlePlaceId)}?languageCode=ko`, DETAIL_FIELDS);
    if (result === null) return null;
    const data = object(result);
    if (data.id !== normalized.googlePlaceId) throw new PlaceProviderError('INVALID_RESPONSE');
    const types = data.types ?? [];
    if (!Array.isArray(types) || !types.every(type => typeof type === 'string')) throw new PlaceProviderError('INVALID_RESPONSE');
    const openingHours = data.businessStatus === 'CLOSED_PERMANENTLY' || data.businessStatus === 'CLOSED_TEMPORARILY'
      ? [] : openingWindows(data.regularOpeningHours, normalized.dates, normalized.timeZone);
    return {
      ...summary(data), coordinates: coordinates(data.location), types,
      ...(openingHours === undefined ? {} : { openingHours }),
      // Names/types/hours have no general caching permission. This snapshot expires immediately.
      cacheExpiresAt: new Date(this.now()).toISOString(),
    };
  }

  async location(googlePlaceId: string): Promise<PlaceLocation | null> {
    placeId(googlePlaceId);
    const result = await this.request(`places/${encodeURIComponent(googlePlaceId)}`, LOCATION_FIELDS);
    if (result === null) return null;
    const data = object(result);
    if (data.id !== googlePlaceId) throw new PlaceProviderError('INVALID_RESPONSE');
    return { googlePlaceId, coordinates: coordinates(data.location), cacheExpiresAt: new Date(this.now()).toISOString() };
  }
}
