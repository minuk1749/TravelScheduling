import {
  TravelProviderError, type MatrixRequest, type ProviderMode,
  type RouteRequest, type TravelAlternatives, type TravelEstimate, type TravelMatrix, type TravelTimeProvider,
} from './index';
import { matrixRequest, routeRequest } from './validation';
import { GoogleRoutesClient, invalid, object, options, waypoint } from './google-client';

export const MATRIX_FIELDS = 'originIndex,destinationIndex,status,condition,duration,distanceMeters,travelAdvisory.transitFare';
export const ROUTE_FIELDS = 'routes.duration,routes.distanceMeters,routes.travelAdvisory.transitFare';

function estimate(data: Record<string, unknown>, mode: ProviderMode): TravelEstimate {
  if (typeof data.duration !== 'string' || !/^\d+(?:\.\d{1,9})?s$/.test(data.duration)) return invalid();
  const durationSeconds = Number(data.duration.slice(0, -1));
  // Proto JSON may omit a scalar whose value is zero.
  const distanceMeters = data.distanceMeters ?? 0;
  if (!Number.isFinite(durationSeconds) || durationSeconds > Number.MAX_SAFE_INTEGER ||
      typeof distanceMeters !== 'number' || !Number.isSafeInteger(distanceMeters) || distanceMeters < 0) return invalid();
  let fare: TravelEstimate['fare'] = null;
  if (mode === 'TRANSIT' && data.travelAdvisory != null) {
    const raw = object(data.travelAdvisory).transitFare;
    if (raw != null) {
      const money = object(raw), units = money.units ?? '0', nanos = money.nanos ?? 0;
      if (typeof money.currencyCode !== 'string' || !/^[A-Z]{3}$/.test(money.currencyCode) ||
          typeof units !== 'string' || !/^\d+$/.test(units) || !Number.isSafeInteger(Number(units)) ||
          typeof nanos !== 'number' || !Number.isInteger(nanos) || nanos < 0 || nanos > 999_999_999) return invalid();
      fare = { amount: Number(units) + nanos / 1e9, currency: money.currencyCode };
    }
  }
  return { durationSeconds, distanceMeters, fare };
}

/** Server-only Routes adapter. No response persistence; fetcher injection keeps tests offline. */
export class GoogleTravelTimeProvider implements TravelTimeProvider {
  private readonly client: GoogleRoutesClient;
  constructor(apiKey: string, fetcher: typeof fetch = fetch) {
    this.client = new GoogleRoutesClient(apiKey, fetcher);
  }

  async matrix(input: MatrixRequest): Promise<TravelMatrix> {
    const { locations, modes, departure } = matrixRequest(input);
    const result = new Map(locations.map(from => [from.id,
      new Map(locations.map(to => [to.id, {} as TravelAlternatives])),
    ]));
    // Transit allows 100 elements/request, other requested modes 625. Indexes are local to each tile.
    // Sequential tiles also bound external concurrency instead of flooding the API for large matrices.
    for (const mode of modes) {
      const size = mode === 'TRANSIT' ? 10 : 25;
      for (let row = 0; row < locations.length; row += size) {
        const origins = locations.slice(row, row + size);
        for (let column = 0; column < locations.length; column += size) {
          const destinations = locations.slice(column, column + size);
          const data = await this.client.request('distanceMatrix/v2:computeRouteMatrix', MATRIX_FIELDS, {
            origins: origins.map(value => ({ waypoint: waypoint(value) })),
            destinations: destinations.map(value => ({ waypoint: waypoint(value) })),
            ...options(mode, departure),
          });
          if (!Array.isArray(data) || data.length !== origins.length * destinations.length) return invalid();
          const seen = new Set<string>();
          for (const raw of data) {
            const element = object(raw);
            const originIndex = element.originIndex ?? 0, destinationIndex = element.destinationIndex ?? 0;
            if (typeof originIndex !== 'number' || !Number.isInteger(originIndex) || originIndex < 0 || originIndex >= origins.length ||
                typeof destinationIndex !== 'number' || !Number.isInteger(destinationIndex) || destinationIndex < 0 || destinationIndex >= destinations.length) return invalid();
            const key = `${originIndex}:${destinationIndex}`;
            if (seen.has(key)) return invalid();
            seen.add(key);
            const status = object(element.status ?? {}), code = status.code ?? 0;
            if (typeof code !== 'number' || !Number.isInteger(code) || code < 0) return invalid();
            if (code !== 0) throw new TravelProviderError('UNAVAILABLE');
            if (element.condition === 'ROUTE_NOT_FOUND') continue;
            if (element.condition !== 'ROUTE_EXISTS') return invalid();
            result.get(origins[originIndex].id)!.get(destinations[destinationIndex].id)![mode] = estimate(element, mode);
          }
        }
      }
    }
    return result;
  }

  async route(input: RouteRequest): Promise<TravelAlternatives> {
    const { from, to, modes, departure } = routeRequest(input);
    const result: TravelAlternatives = {};
    for (const mode of modes) {
      const data = object(await this.client.request('directions/v2:computeRoutes', ROUTE_FIELDS, {
        origin: waypoint(from), destination: waypoint(to), ...options(mode, departure), computeAlternativeRoutes: false,
      }));
      if (data.error !== undefined) return invalid();
      const routes = data.routes ?? [];
      if (!Array.isArray(routes)) return invalid();
      if (routes.length) result[mode] = estimate(object(routes[0]), mode);
    }
    return result;
  }
}
