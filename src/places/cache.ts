import type { PlaceDetailsRequest, PlaceLocation, PlaceProvider, PlaceSearchRequest } from './index';
import { placeId } from './validation';

const DAY = 86_400_000;
type Entry = { value: PlaceLocation; expires: number; timer: ReturnType<typeof setTimeout> };

/** Bounded, process-local coordinate cache. Names, types, hours and search results never enter it. */
export class CachedPlaceProvider implements PlaceProvider {
  private readonly entries = new Map<string, Entry>();
  private readonly pending = new Map<string, Promise<PlaceLocation | null>>();

  constructor(
    private readonly upstream: PlaceProvider,
    private readonly now: () => number = Date.now,
    private readonly ttlMs = DAY,
    private readonly maxEntries = 1000,
  ) {
    // A shorter than 30-day ceiling also stays within Node's timer range.
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > 7 * DAY ||
        !Number.isSafeInteger(maxEntries) || maxEntries < 1) throw new RangeError('Invalid place cache limits');
  }

  search(input: PlaceSearchRequest) { return this.upstream.search(input); }
  async details(input: PlaceDetailsRequest) {
    const startedAt = this.now();
    const result = await this.upstream.details(input);
    if (result) this.remember(this.key(input.googlePlaceId), result, startedAt);
    return result;
  }

  private key(googlePlaceId: string): string { return `google:v1:${googlePlaceId}:id,location`; }

  async location(googlePlaceId: string): Promise<PlaceLocation | null> {
    placeId(googlePlaceId);
    const key = this.key(googlePlaceId);
    const cached = this.entries.get(key);
    if (cached && cached.expires > this.now()) return structuredClone(cached.value);
    if (cached) this.remove(key);
    let promise = this.pending.get(key);
    if (!promise) {
      promise = this.load(key, googlePlaceId);
      this.pending.set(key, promise);
    }
    try { return structuredClone(await promise); }
    finally { if (this.pending.get(key) === promise) this.pending.delete(key); }
  }

  private async load(key: string, googlePlaceId: string): Promise<PlaceLocation | null> {
    const startedAt = this.now();
    const result = await this.upstream.location(googlePlaceId);
    if (!result) return null;
    return this.remember(key, result, startedAt);
  }

  private remember(key: string, result: PlaceLocation, startedAt: number): PlaceLocation {
    // Explicit projection prevents accidental storage of newly added upstream fields.
    const expires = startedAt + this.ttlMs;
    const value: PlaceLocation = {
      googlePlaceId: result.googlePlaceId,
      coordinates: { latitude: result.coordinates.latitude, longitude: result.coordinates.longitude },
      cacheExpiresAt: new Date(expires).toISOString(),
    };
    if (expires > this.now()) {
      this.remove(key);
      while (this.entries.size >= this.maxEntries) this.remove(this.entries.keys().next().value!);
      const timer = setTimeout(() => this.remove(key), expires - this.now());
      timer.unref();
      this.entries.set(key, { value, expires, timer });
    }
    return value;
  }

  private remove(key: string): void {
    const entry = this.entries.get(key);
    if (entry) clearTimeout(entry.timer);
    this.entries.delete(key);
  }

  dispose(): void {
    for (const key of this.entries.keys()) this.remove(key);
  }
}
