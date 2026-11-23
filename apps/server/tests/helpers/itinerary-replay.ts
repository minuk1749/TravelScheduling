import assert from 'node:assert/strict';
import { inputHash } from '../../src/repositories/trip-snapshot';
import { sampleTrip } from '../fixtures/itinerary';
import { service } from './itinerary-service';

/** The first POST commits an OK result before its response body is lost. */
export function itineraryReplay() {
  let input = sampleTrip([{ key: 'sensoji', minutes: 30 }]);
  const stored = new Map<string, string>();
  const keys: string[] = [];
  let placeReads = 0;
  let placesAvailable = true;
  const fetch: typeof globalThis.fetch = async (url, options) => {
    if (String(url) === '/api/trips/trip/constraints?fields=revision') return Response.json({ revision: inputHash(input) });
    if (String(url) === '/api/trips/trip/constraints') {
      assert.equal(options?.method ?? 'GET', 'GET');
      placeReads++;
      if (!placesAvailable) return Response.json({ error: '장소 조회 실패' }, { status: 503 });
      return Response.json({ input, revision: inputHash(input), places: {} });
    }
    assert.equal(String(url), '/api/trips/trip/itinerary');
    assert.equal(options?.method, 'POST');
    const key = new Headers(options.headers).get('Idempotency-Key');
    assert.ok(key);
    keys.push(key);
    if (!stored.has(key)) {
      const result = await service().service.compute(input);
      assert.equal(result.status, 'OK');
      stored.set(key, JSON.stringify({ ...result, itineraryId: key, inputHash: inputHash(input) }));
    }
    if (keys.length === 1) {
      return new Response(new ReadableStream({ start(controller) { controller.error(new Error('응답 본문 유실')); } }));
    }
    return new Response(stored.get(key));
  };
  return {
    fetch, keys,
    setPlacesAvailable(value: boolean) { placesAvailable = value; },
    counts: () => ({ placeReads, saved: stored.size }),
    changeReservation() {
      input = { ...input, visits: input.visits.map(v => ({ ...v, fixedDate: '2026-12-02', fixedTime: '10:00' })) };
    },
  };
}
