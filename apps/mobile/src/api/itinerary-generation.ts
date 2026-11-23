import { uuid } from 'expo';
import { useMemo } from 'react';
import { useTripApi, type GeneratedTrip } from './trips';

/** Each screen owns its pending generation. A transport error, incomplete body or cancelled
 * effect leaves its key available for retry. A new edit or completed generation starts afresh. */
class ItineraryGeneration {
  private pending?: { revision?: string; id: string };

  constructor(private readonly post: (signal: AbortSignal, key: string) => Promise<GeneratedTrip>) {}

  reset() { this.pending = undefined; }

  async run(signal: AbortSignal, revision?: string): Promise<GeneratedTrip> {
    if (!this.pending || this.pending.revision !== revision) this.pending = { revision, id: uuid.v4() };
    const attempt = this.pending;
    const result = await this.post(signal, attempt.id);
    if (!signal.aborted && this.pending === attempt) this.reset();
    return result;
  }
}

export function useItineraryGeneration(tripId: string) {
  const api = useTripApi();
  return useMemo(() => new ItineraryGeneration((signal, key) => api.generate(tripId, signal, key)), [api, tripId]);
}
