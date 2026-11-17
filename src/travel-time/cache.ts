import type { MatrixRequest, RouteRequest, TravelAlternatives, TravelMatrix, TravelTimeProvider } from './index';
import { matrixRequest, routeRequest } from './validation';

type Value = TravelMatrix | TravelAlternatives;
type Entry = { value: Value; expires: number; timer: ReturnType<typeof setTimeout> };

/** Enable completed-response storage only for an upstream whose terms permit it (ADR 0005).
 * The default only combines in-flight identical requests. Cache scope is this provider instance.
 */
export class CachedTravelTimeProvider implements TravelTimeProvider {
  private readonly entries = new Map<string, Entry>();
  private readonly pending = new Map<string, Promise<Value>>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private disposed = false;

  constructor(
    private readonly upstream: TravelTimeProvider,
    options: { ttlMs?: number; maxEntries?: number } = {},
    private readonly now: () => number = Date.now,
  ) {
    this.ttlMs = options.ttlMs ?? 0;
    this.maxEntries = options.maxEntries ?? 32;
    if (!Number.isSafeInteger(this.ttlMs) || this.ttlMs < 0 || this.ttlMs > 86_400_000 ||
        !Number.isSafeInteger(this.maxEntries) || this.maxEntries < 1) throw new RangeError('Invalid travel cache limits');
  }

  async matrix(input: MatrixRequest): Promise<TravelMatrix> {
    const normalized = matrixRequest(input);
    // A matrix contains both directions; ordering the input list does not change its ID-keyed result.
    normalized.locations = [...normalized.locations].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    return this.load(`matrix:v1:${JSON.stringify(normalized)}`, () => this.upstream.matrix(normalized));
  }

  async route(input: RouteRequest): Promise<TravelAlternatives> {
    const normalized = routeRequest(input);
    // Separate from matrix data: route() is an explicit leg re-query, not an approximate matrix lookup.
    return this.load(`route:v1:${JSON.stringify(normalized)}`, () => this.upstream.route(normalized));
  }

  private async load<T extends Value>(key: string, fetchValue: () => Promise<T>): Promise<T> {
    if (this.disposed) throw new Error('Travel cache has been disposed');
    const cached = this.entries.get(key);
    if (cached && cached.expires > this.now()) return structuredClone(cached.value) as T;
    if (cached) this.remove(key);
    let promise = this.pending.get(key);
    if (!promise) {
      const startedAt = this.now();
      promise = Promise.resolve().then(fetchValue).then(value => {
        const expires = startedAt + this.ttlMs;
        if (!this.disposed && expires > this.now()) {
          while (this.entries.size >= this.maxEntries) this.remove(this.entries.keys().next().value!);
          const timer = setTimeout(() => this.remove(key), expires - this.now());
          timer.unref();
          this.entries.set(key, { value: structuredClone(value), expires, timer });
        }
        return value;
      });
      this.pending.set(key, promise);
    }
    try { return structuredClone(await promise) as T; }
    finally { if (this.pending.get(key) === promise) this.pending.delete(key); }
  }

  private remove(key: string): void {
    const entry = this.entries.get(key);
    if (entry) clearTimeout(entry.timer);
    this.entries.delete(key);
  }

  dispose(): void {
    this.disposed = true;
    for (const key of this.entries.keys()) this.remove(key);
    this.pending.clear();
  }
}
