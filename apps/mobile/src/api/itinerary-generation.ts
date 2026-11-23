import { uuid } from 'expo';
import { useMemo } from 'react';
import { useTripApi, verifyRevision } from './trips';

/** Each screen owns its pending generation. A transport error, incomplete body or cancelled
 * effect leaves its key available for retry. A new edit or completed generation starts afresh. */
class ItineraryGeneration {
  private pending?: { revision?: string; id: string };

  constructor(private readonly api: ReturnType<typeof useTripApi>, private readonly tripId: string) {}

  reset() { this.pending = undefined; }

  /** Opening flows pair the response with a saved input in their own read/retry phase. */
  run(signal: AbortSignal, revision?: string) {
    return this.request(signal, revision, false);
  }

  /** Editors display the response directly, so a recovered result needs a fresh input check. */
  async runVerified(signal: AbortSignal, revision?: string) {
    const { result } = await this.request(signal, revision, true);
    if (revision !== undefined) verifyRevision(result, revision);
    return result;
  }

  private async request(signal: AbortSignal, revision: string | undefined, checkRecovered: boolean) {
    const previous = this.pending;
    const attempt = previous && previous.revision === revision ? previous : { revision, id: uuid.v4() };
    this.pending = attempt;
    const retried = attempt === previous;
    const result = await this.api.generate(this.tripId, signal, attempt.id);
    const saved = retried && checkRecovered && !signal.aborted ? await this.api.savedRevision(this.tripId, signal) : undefined;
    if (!signal.aborted && this.pending === attempt) this.reset();
    if (saved) verifyRevision(result, saved.revision);
    return { result, retried };
  }
}

export function useItineraryGeneration(tripId: string) {
  const api = useTripApi();
  return useMemo(() => new ItineraryGeneration(api, tripId), [api, tripId]);
}
