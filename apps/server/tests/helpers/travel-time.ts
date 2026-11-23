import assert from 'node:assert/strict';
import type { Location, MatrixRequest, ProviderMode, RouteRequest } from '../../src/travel-time';
import { CachedTravelTimeProvider } from '../../src/travel-time/cache';
import { GoogleTravelTimeProvider } from '../../src/travel-time/google';
import { locations, routeFixture } from '../fixtures/routes';

export const request: MatrixRequest = {
  departure: '2026-11-23T09:00:00+09:00', timeZone: 'Asia/Tokyo', modes: ['TRANSIT', 'WALK', 'DRIVE'], locations,
};
export const leg: RouteRequest = { ...request, from: locations[0], to: locations[1] };
type Waypoint = { location: { latLng: Location['coordinates'] } };
type Body = {
  travelMode: ProviderMode; departureTime?: string; routingPreference?: string;
  origins: { waypoint: Waypoint }[]; destinations: { waypoint: Waypoint }[];
  origin: Waypoint; destination: Waypoint; languageCode: string; units: string;
};

export function setup(maxEntries = 2) {
  const calls: { url: string; init: RequestInit; body: Body }[] = [];
  let override: ((body: Body, matrix: boolean) => unknown) | undefined;
  let status = 200, now = 0;
  const fetcher: typeof fetch = async (url, init) => {
    assert.ok(init);
    const body: Body = JSON.parse(init.body as string), matrix = String(url).includes('computeRouteMatrix');
    calls.push({ url: String(url), init, body });
    const value = override ? override(body, matrix) : matrix
      ? body.origins.flatMap((from, i) => body.destinations.map((to, j) => ({
        ...(i ? { originIndex: i } : {}), ...(j ? { destinationIndex: j } : {}), status: {}, condition: 'ROUTE_EXISTS',
        ...routeFixture(body.travelMode, from.waypoint.location.latLng.latitude > to.waypoint.location.latLng.latitude),
      }))).reverse() // Responses need not arrive in row order; zero-valued indexes may be omitted.
      : { routes: [routeFixture(body.travelMode)] };
    return Response.json(value, { status });
  };
  const google = new GoogleTravelTimeProvider('fixture-secret', fetcher);
  const cache = new CachedTravelTimeProvider(google, { ttlMs: 1000, maxEntries }, () => now);
  return {
    fetcher, calls, google, cache,
    reply: (value: unknown, code = 200) => { override = () => value; status = code; },
    respond: (fn: NonNullable<typeof override>) => { override = fn; status = 200; },
    reset: () => { override = undefined; status = 200; },
    advance: (ms: number) => { now += ms; },
  };
}

