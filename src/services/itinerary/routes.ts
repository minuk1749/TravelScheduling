import { estimateTaxiFare, type CityProfile } from '../../fare';
import type { RouteOptions } from '../../scheduler';
import type {
  Location, Money, ProviderMode, TravelAlternatives, TravelMatrix, TravelTimeProvider,
} from '../../travel-time';

export const PROVIDER_MODES: readonly ProviderMode[] = ['TRANSIT', 'WALK', 'DRIVE'];
export type RouteTable = ReadonlyMap<string, ReadonlyMap<string, RouteOptions>>;

/**
 * Converts provider units (seconds, meters, Money) into scheduler minutes and one comparison
 * currency. DRIVE becomes TAXI with an estimated fare at the departure instant; the pickup
 * wait is added later by `selectTravelMode`. Walking costs nothing, so its fare is 0.
 */
export class FareConverter {
  private observedCurrency: string | null;

  constructor(private readonly profile: CityProfile | null, private readonly timeZone: string) {
    this.observedCurrency = profile?.currency ?? null;
  }

  /** Without a city profile, the first transit fare currency becomes the comparison currency. */
  get currency(): string | null { return this.observedCurrency; }

  options(alternatives: TravelAlternatives, departure: string): RouteOptions {
    const options: RouteOptions = {};
    const { TRANSIT: transit, WALK: walk, DRIVE: drive } = alternatives;
    if (transit) options.TRANSIT = { minutes: transit.durationSeconds / 60, fare: this.transitFare(transit.fare) };
    if (walk) options.WALK = { minutes: walk.durationSeconds / 60, fare: 0 };
    if (drive) {
      const minutes = drive.durationSeconds / 60;
      const estimate = estimateTaxiFare(this.profile, drive.distanceMeters / 1000, minutes, new Date(departure), this.timeZone);
      options.TAXI = { minutes, fare: estimate.status === 'AVAILABLE' ? estimate.amount : null };
    }
    return options;
  }

  table(matrix: TravelMatrix, departure: string): RouteTable {
    return new Map([...matrix].map(([from, row]) =>
      [from, new Map([...row].map(([to, alternatives]) => [to, this.options(alternatives, departure)]))]));
  }

  private transitFare(fare: Money | null): number | null {
    if (!fare) return null;
    this.observedCurrency ??= fare.currency;
    // Fares in another currency are not comparable with taxi estimates or other legs.
    return fare.currency === this.observedCurrency ? fare.amount : null;
  }
}

/** Actual-departure route lookups for one computation. Identical queries reach the provider once. */
export class RouteBook {
  private readonly queries = new Map<string, Promise<RouteOptions>>();

  constructor(
    private readonly travel: TravelTimeProvider,
    private readonly fares: FareConverter,
    private readonly timeZone: string,
    private readonly locations: ReadonlyMap<string, Location>,
  ) {}

  location(id: string): Location {
    const location = this.locations.get(id);
    if (!location) throw new Error(`Unknown location ${id}`);
    return location;
  }

  route(from: string, to: string, departure: string): Promise<RouteOptions> {
    const key = `${from}\n${to}\n${departure}`;
    let query = this.queries.get(key);
    if (!query) {
      query = this.travel.route({
        from: this.location(from), to: this.location(to), departure, timeZone: this.timeZone, modes: PROVIDER_MODES,
      }).then(alternatives => this.fares.options(alternatives, departure));
      this.queries.set(key, query);
      // Do not keep a failed lookup; the error still propagates to the caller.
      query.catch(() => this.queries.delete(key));
    }
    return query;
  }

  async matrix(ids: readonly string[], departure: string): Promise<RouteTable> {
    const unique = [...new Set(ids)];
    if (unique.length < 2) return new Map();
    const matrix = await this.travel.matrix({
      locations: unique.map(id => this.location(id)), departure, timeZone: this.timeZone, modes: PROVIDER_MODES,
    });
    return this.fares.table(matrix, departure);
  }
}
