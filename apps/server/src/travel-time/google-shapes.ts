import { GoogleRoutesClient, invalid, object, options, waypoint } from './google-client';
import type { RouteShapeProvider, RouteShapeRequest } from './shapes';
import { routeRequest } from './validation';

export const SHAPE_FIELDS = 'routes.polyline.encodedPolyline';

function isCompletePolyline(value: unknown): value is string {
  if (typeof value !== 'string' || !value.length) return false;
  let components = 0, continued = false;
  for (let index = 0; index < value.length; index++) {
    const chunk = value.charCodeAt(index) - 63;
    if (chunk < 0 || chunk > 63) return false;
    // Each component ends when bit 0x20 clears; each point needs latitude and longitude.
    continued = (chunk & 0x20) !== 0;
    if (!continued) components++;
  }
  return !continued && components % 2 === 0;
}

/** No cache wrapper: every call fetches a fresh display-only polyline. */
export class GoogleRouteShapeProvider implements RouteShapeProvider {
  private readonly client: GoogleRoutesClient;
  constructor(apiKey: string, fetcher: typeof fetch = fetch) {
    this.client = new GoogleRoutesClient(apiKey, fetcher);
  }

  async shape(input: RouteShapeRequest): Promise<{ encodedPolyline: string } | null> {
    const { from, to, departure } = routeRequest({
      from: { id: 'origin', coordinates: input.from }, to: { id: 'destination', coordinates: input.to },
      modes: [input.mode], departure: input.departure, timeZone: input.timeZone,
    });
    const data = object(await this.client.request('directions/v2:computeRoutes', SHAPE_FIELDS, {
      origin: waypoint(from), destination: waypoint(to), ...options(input.mode, departure),
      computeAlternativeRoutes: false, polylineEncoding: 'ENCODED_POLYLINE', polylineQuality: 'HIGH_QUALITY',
    }));
    if (data.error !== undefined) return invalid();
    // Proto JSON omits empty repeated fields. Explicit null or malformed routes are errors.
    const routes = data.routes === undefined ? [] : data.routes;
    if (!Array.isArray(routes)) return invalid();
    if (!routes.length) return null;
    const encodedPolyline = object(object(routes[0]).polyline).encodedPolyline;
    if (!isCompletePolyline(encodedPolyline)) return invalid();
    return { encodedPolyline };
  }
}
