import { useEffect, useState } from 'react';
import { useTripApi, type GeneratedTrip } from '../../api/trips';
import { decodePolyline, roadShapeKey } from '../../map/geometry';
import type { LatLng } from '../../map/types';
import { legKey } from '../../result/days';

type Loaded = { tripId: string; inputHash: string; itineraryId: string; shapes: ReadonlyMap<string, readonly LatLng[]>; failed: boolean };
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
  const inputHash = result?.comparisons.length ? result.inputHash : null;
  const itineraryId = result?.itineraryId;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!inputHash || !itineraryId) return;
    const key = { tripId, inputHash, itineraryId };
    const request = new AbortController();
    void api.shapes(tripId, inputHash, itineraryId, request.signal).then(legs => {
      if (request.signal.aborted) return;
      const shapes = new Map<string, readonly LatLng[]>();
      for (const leg of legs) {
        const points = leg.shape.status === 'OK' ? decoded(leg.shape.encodedPolyline) : null;
        if (points) shapes.set(roadShapeKey(legKey(leg), leg.mode), points);
      }
      setLoaded({ ...key, shapes, failed: false });
    }).catch(() => {
      if (!request.signal.aborted) setLoaded({ ...key, shapes: NONE, failed: true });
    });
    return () => request.abort();
  }, [api, tripId, inputHash, itineraryId, attempt]);
  const current = loaded?.tripId === tripId && loaded.inputHash === inputHash && loaded.itineraryId === itineraryId ? loaded : null;
  return { shapes: current?.shapes ?? NONE, failed: !!current?.failed, retry: () => setAttempt(value => value + 1) };
}
