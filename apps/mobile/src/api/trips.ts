import { useMemo } from 'react';
import type { CityProfile } from '@travel/core/fare';
import type { ItineraryResult } from '@travel/core/contracts/itinerary';
import type { PlaceLocation, PlaceSummary } from '@travel/core/contracts/places';
import type { Constraints, ConstraintWriteOptions, ResultSnapshot, ResultView } from '@travel/core/contracts/results/model';
import type { RouteShapesResponse } from '@travel/core/contracts/route-shapes';
import type { LivingSettings, SettingsView } from '@travel/core/contracts/settings/model';
import type { TripCreation, TripSummary } from '@travel/core/contracts/trips/create';
import { useRuntime } from '../auth/provider';
import { ApiFailure, type ApiClient } from './client';
import { validGeneratedTrip, validResultView, validRouteShapes, validSnapshot } from './result-response';

const trips = '/api/trips';
const trip = (id: string) => `${trips}/${encodeURIComponent(id)}`;
const place = (id: string) => `/api/places/${encodeURIComponent(id)}`;
const json = (method: 'POST' | 'PUT', body: unknown) => ({
  method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

export type ProfileView = { profile: CityProfile | null; recommendedPolicy: LivingSettings['taxiPolicy'] };
export type GeneratedTrip = ItineraryResult & { itineraryId: string; inputHash: string };

/** A calculation is only shown for the input revision it was made from (T23·T22 shared rule). */
export function verifyRevision(result: GeneratedTrip, revision: string) {
  if (result.inputHash !== revision) {
    throw new ApiFailure(409, 'STALE_INPUT', '여행 정보가 바뀌었어요. 저장된 설정을 다시 불러와 주세요.');
  }
}

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
  savedInput(id: string, signal: AbortSignal, operationId?: string) {
    const query = operationId ? `?${new URLSearchParams({ operationId })}` : '';
    return this.api.request<ResultView>(`${trip(id)}/constraints${query}`, { signal, validate: validResultView });
  }
  saveConstraints(id: string, revision: string, constraints: Constraints, signal: AbortSignal,
    operation?: ConstraintWriteOptions) {
    return this.api.request<ResultSnapshot>(`${trip(id)}/constraints`, {
      ...json('PUT', { revision, constraints, ...operation }), signal, validate: validSnapshot,
    });
  }
  settings(id: string, signal: AbortSignal) {
    return this.api.request<SettingsView>(`${trip(id)}/settings`, { signal });
  }
  saveSettings(id: string, revision: string, settings: LivingSettings, signal?: AbortSignal) {
    return this.api.request<SettingsView>(`${trip(id)}/settings`, { ...json('PUT', { revision, settings }), signal });
  }
  generate(id: string, signal?: AbortSignal) {
    return this.api.request<GeneratedTrip>(`${trip(id)}/itinerary`, { method: 'POST', signal, validate: validGeneratedTrip });
  }
  /** T19 road shapes for the saved result; kept in memory only (never persisted). */
  async shapes(id: string, inputHash: string, itineraryId: string, signal: AbortSignal) {
    const query = new URLSearchParams({ inputHash, itineraryId });
    const response = await this.api.request<RouteShapesResponse>(`${trip(id)}/itinerary/shapes?${query}`, { signal, validate: validRouteShapes });
    if (response.inputHash !== inputHash || response.itineraryId !== itineraryId) {
      throw new ApiFailure(409, 'RESULT_UNAVAILABLE', '표시 중인 일정의 경로를 확인할 수 없어요.');
    }
    return response.legs;
  }
}

export function useTripApi() {
  const { api } = useRuntime();
  return useMemo(() => new TripApi(api), [api]);
}
