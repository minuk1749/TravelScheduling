import { useEffect, useState } from 'react';
import { useTripApi, type GeneratedTrip } from '../../api/trips';
import { decodePolyline } from '../../map/geometry';
import type { LatLng } from '../../map/types';
import { legKey } from '../../result/days';

type Loaded = { hash: string; shapes: ReadonlyMap<string, readonly LatLng[]>; failed: boolean };
const NONE: ReadonlyMap<string, readonly LatLng[]> = new Map();

function decoded(encoded: string): LatLng[] | null {
  try { return decodePolyline(encoded); } catch { return null; }
}

/**
 * Road shapes (T19) for the result being shown, held only in memory. Legs without a shape, with an
 * unreadable polyline, or after a failed request are drawn as straight dashed lines; `retry` re-requests.
 */
export function useRouteShapes(tripId: string, result: GeneratedTrip | null) {
  const api = useTripApi();
  const hash = result && result.comparisons.length ? result.inputHash : null;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!hash) return;
    const request = new AbortController();
    api.shapes(tripId, hash, request.signal).then(response => {
      if (request.signal.aborted || response.inputHash !== hash) return;
      const shapes = new Map<string, readonly LatLng[]>();
      for (const leg of response.legs) {
        const points = leg.shape.status === 'OK' ? decoded(leg.shape.encodedPolyline) : null;
        if (points) shapes.set(legKey(leg), points);
      }
      setLoaded({ hash, shapes, failed: false });
    }, () => { if (!request.signal.aborted) setLoaded({ hash, shapes: NONE, failed: true }); });
    return () => request.abort();
  }, [api, tripId, hash, attempt]);
  const current = loaded?.hash === hash ? loaded : null;
  return { shapes: current?.shapes ?? NONE, failed: !!current?.failed, retry: () => setAttempt(value => value + 1) };
}
