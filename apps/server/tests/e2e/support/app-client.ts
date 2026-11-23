import { randomUUID } from 'node:crypto';
import { expect, type APIRequestContext, type APIResponse } from '@playwright/test';
import { ITINERARY_REQUEST_HEADER, type ItineraryResult } from '@travel/core/contracts/itinerary';
import type { Constraints, ResultSnapshot, ResultView } from '@travel/core/contracts/results/model';
import type { SavedRouteShapesResponse } from '@travel/core/contracts/route-shapes';
import type { LivingSettings, SettingsView } from '@travel/core/contracts/settings/model';
import type { TripCreation, TripSummary } from '@travel/core/contracts/trips/create';
import type { PlaceSummary } from '@travel/core/contracts/places';
import type { Pool } from 'pg';
import { cityProfile } from '../../fixtures/trip-input';
import { googleIdToken } from './google-key';

export type Generated = ItineraryResult & { itineraryId: string; inputHash: string };

/** Asserts the status (and the error `code` for failures) and returns the parsed body. */
export async function expectJson<T>(response: APIResponse | Promise<APIResponse>, status: number, code?: string): Promise<T> {
  const settled = await response;
  const body = settled.status() === 204 ? undefined : await settled.json();
  expect(settled.status(), JSON.stringify(body)).toBe(status);
  if (code) expect(body.code).toBe(code);
  return body as T;
}

/** Signs in exactly as the app does: the native Google SDK's ID token → POST /api/session → opaque Bearer token. */
export async function signIn(request: APIRequestContext, sub: string, email: string) {
  const session = await expectJson<{ token: string; expiresAt: string }>(
    request.post('/api/session', { data: { idToken: googleIdToken({ sub, email }) } }), 201);
  return new AppClient(request, session.token);
}

/** The HTTP calls of apps/mobile/src/api (trips.ts, itinerary-generation.ts, sharing.ts) with one Bearer session. */
export class AppClient {
  constructor(private readonly request: APIRequestContext, readonly token: string) {}

  private get headers() { return { Authorization: `Bearer ${this.token}` }; }
  get(path: string) { return this.request.get(path, { headers: this.headers }); }
  post(path: string, data?: unknown, headers: Record<string, string> = {}) {
    return this.request.post(path, { headers: { ...this.headers, ...headers }, ...data === undefined ? {} : { data } });
  }
  put(path: string, data: unknown) { return this.request.put(path, { headers: this.headers, data }); }
  delete(path: string) { return this.request.delete(path, { headers: this.headers }); }

  async placeId(query: string): Promise<string> {
    const { places } = await expectJson<{ places: PlaceSummary[] }>(this.get(`/api/places?${new URLSearchParams({ query, regionCode: 'JP' })}`), 200);
    expect(places.map(place => place.name)).toContain(query);
    return places.find(place => place.name === query)!.googlePlaceId;
  }
  list() { return expectJson<{ trips: TripSummary[] }>(this.get('/api/trips'), 200); }
  createTrip(trip: TripCreation) { return expectJson<{ id: string }>(this.post('/api/trips', trip), 201); }
  settings(id: string) { return expectJson<SettingsView>(this.get(`/api/trips/${id}/settings`), 200); }
  saveSettings(id: string, revision: string, settings: LivingSettings) {
    return expectJson<SettingsView>(this.put(`/api/trips/${id}/settings`, { revision, settings }), 200);
  }
  savedInput(id: string) { return expectJson<ResultView>(this.get(`/api/trips/${id}/constraints`), 200); }
  saveConstraints(id: string, revision: string, constraints: Constraints) {
    return expectJson<ResultSnapshot>(this.put(`/api/trips/${id}/constraints`, { revision, constraints }), 200);
  }
  /** The app sends a fresh Idempotency-Key per generation and reuses it only to retry the same request (T27). */
  generate(id: string, key: string = randomUUID()) {
    return expectJson<Generated>(this.post(`/api/trips/${id}/itinerary`, undefined, { [ITINERARY_REQUEST_HEADER]: key }), 200);
  }
  shapes(id: string, { inputHash, itineraryId }: Generated) {
    return expectJson<SavedRouteShapesResponse>(this.get(`/api/trips/${id}/itinerary/shapes?${new URLSearchParams({ inputHash, itineraryId })}`), 200);
  }
  share(id: string) { return expectJson<{ path: string }>(this.post(`/api/trips/${id}/share`), 200); }
}

/** Synthetic TOKYO fare profile (tests/fixtures/trip-input.ts), upserted so the e2e database can price taxis. */
export async function upsertCityProfile(pool: Pool) {
  const p = cityProfile;
  await pool.query(`INSERT INTO city_profiles (city_code, country, currency, transit_coverage, transit_hours, taxi_base_fare, taxi_fare_per_km,
      taxi_fare_per_minute, night_surcharge, night_start, night_end, call_buffer_minutes, efficiency_threshold, ride_hailing_apps, source, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
    ON CONFLICT (city_code) DO UPDATE SET country = EXCLUDED.country, currency = EXCLUDED.currency, transit_coverage = EXCLUDED.transit_coverage,
      transit_hours = EXCLUDED.transit_hours, taxi_base_fare = EXCLUDED.taxi_base_fare, taxi_fare_per_km = EXCLUDED.taxi_fare_per_km,
      taxi_fare_per_minute = EXCLUDED.taxi_fare_per_minute, night_surcharge = EXCLUDED.night_surcharge, night_start = EXCLUDED.night_start,
      night_end = EXCLUDED.night_end, call_buffer_minutes = EXCLUDED.call_buffer_minutes, efficiency_threshold = EXCLUDED.efficiency_threshold,
      ride_hailing_apps = EXCLUDED.ride_hailing_apps, source = EXCLUDED.source, updated_at = EXCLUDED.updated_at`,
  [p.cityCode, p.country, p.currency, p.transitCoverage, p.transitHours, p.taxiBaseFare, p.taxiFarePerKm, p.taxiFarePerMinute,
    p.nightSurcharge, p.nightStart, p.nightEnd, p.callBufferMinutes, p.efficiencyThreshold, JSON.stringify(p.rideHailingApps), p.source, p.updatedAt]);
}
