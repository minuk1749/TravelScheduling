const MAX_CONCURRENT_REQUESTS = 4;

/** Slots are shared by the Google Routes clients in this server runtime. */
export class RoutesRequestBudget {
  private active = 0;
  private readonly waiting = new Set<() => void>();

  async run<T>(request: () => Promise<T>): Promise<T> {
    if (this.active < MAX_CONCURRENT_REQUESTS) this.active++;
    else await new Promise<void>(resolve => this.waiting.add(resolve));
    try {
      return await request();
    } finally {
      const next = this.waiting.values().next().value;
      if (next) {
        // Hand the occupied slot directly to the oldest waiter.
        this.waiting.delete(next);
        next();
      } else {
        this.active--;
      }
    }
  }
}
