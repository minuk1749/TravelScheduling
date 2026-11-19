import { useMemo } from 'react';
import type { CityProfile } from '@travel/core/fare';
import type { ItineraryResult } from '@travel/core/contracts/itinerary';
import type { PlaceLocation, PlaceSummary } from '@travel/core/contracts/places';
import type { Constraints, ResultSnapshot, ResultView } from '@travel/core/contracts/results/model';
import type { LivingSettings, SettingsView } from '@travel/core/contracts/settings/model';
import type { TripCreation, TripSummary } from '@travel/core/contracts/trips/create';
import { useRuntime } from '../auth/provider';
import type { ApiClient } from './client';

const trips = '/api/trips';
const trip = (id: string) => `${trips}/${encodeURIComponent(id)}`;
const place = (id: string) => `/api/places/${encodeURIComponent(id)}`;
const json = (method: 'POST' | 'PUT', body: unknown) => ({
  method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

export type ProfileView = { profile: CityProfile | null; recommendedPolicy: LivingSettings['taxiPolicy'] };
export type GeneratedTrip = ItineraryResult & { itineraryId: string; inputHash: string };

class TripApi {
  constructor(private readonly api: Pick<ApiClient, 'request'>) {}

  list(signal: AbortSignal) { return this.api.request<{ trips: TripSummary[] }>(trips, { signal }); }
  create(input: TripCreation) { return this.api.request<{ id: string }>(trips, json('POST', input)); }
  profile(cityCode: string, signal: AbortSignal) {
    return this.api.request<ProfileView>(`/api/city-profiles?${new URLSearchParams({ cityCode })}`, { signal });
  }
  search(query: string, regionCode: string | undefined, signal: AbortSignal) {
    return this.api.request<{ places: PlaceSummary[]; attribution: string }>(
      `/api/places?${new URLSearchParams({ query, ...(regionCode && { regionCode }) })}`, { signal });
  }
  location(id: string, signal: AbortSignal) {
    return this.api.request<{ place: PlaceLocation }>(`${place(id)}?fields=location`, { signal });
  }
  savedInput(id: string, signal: AbortSignal) {
    return this.api.request<ResultView>(`${trip(id)}/constraints`, { signal });
  }
  saveConstraints(id: string, revision: string, constraints: Constraints, signal: AbortSignal) {
    return this.api.request<ResultSnapshot>(`${trip(id)}/constraints`, { ...json('PUT', { revision, constraints }), signal });
  }
  settings(id: string, signal: AbortSignal) {
    return this.api.request<SettingsView>(`${trip(id)}/settings`, { signal });
  }
  saveSettings(id: string, revision: string, settings: LivingSettings) {
    return this.api.request<SettingsView>(`${trip(id)}/settings`, json('PUT', { revision, settings }));
  }
  generate(id: string, signal?: AbortSignal) {
    return this.api.request<GeneratedTrip>(`${trip(id)}/itinerary`, { method: 'POST', signal });
  }
}

export function useTripApi() {
  const { api } = useRuntime();
  return useMemo(() => new TripApi(api), [api]);
}
