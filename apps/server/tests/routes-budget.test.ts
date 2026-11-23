import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { CachedTravelTimeProvider } from '../src/travel-time/cache';
import { GoogleTravelTimeProvider } from '../src/travel-time/google';
import { GoogleRouteShapeProvider } from '../src/travel-time/google-shapes';
import { sampleTrip } from './fixtures/itinerary';
import { service } from './helpers/itinerary-service';
import { leg, setup } from './helpers/travel-time';

test('two simultaneous itineraries share the Google HTTP budget and preserve the Tokyo result', async t => {
  const upstream = setup();
  let active = 0, peak = 0, totalHttpMs = 0;
  const fetcher: typeof fetch = async (...args) => {
    const sent = performance.now();
    active++;
    peak = Math.max(peak, active);
    try {
      await delay(5);
      return await upstream.fetcher(...args);
    } finally {
      totalHttpMs += performance.now() - sent;
      active--;
    }
  };
  const generate = async () => {
    const travel = new CachedTravelTimeProvider(new GoogleTravelTimeProvider('fixture', fetcher));
    try { return await service({ travel }).service.compute(sampleTrip()); }
    finally { travel.dispose(); }
  };
  const start = performance.now();
  const [first, second] = await Promise.all([generate(), generate()]);
  const elapsedMs = Math.round(performance.now() - start);
  const digest = createHash('sha256').update(JSON.stringify(first)).digest('hex');
  const calls = upstream.calls.length;
  const meanHttpMs = Number((totalHttpMs / calls).toFixed(1));
  t.diagnostic(JSON.stringify({ calls, peak, meanHttpMs, elapsedMs, digest }));
  assert.equal(peak, 4);
  assert.equal(calls, 84);
  // Full result captured on develop before introducing the budget.
  assert.equal(digest, 'c5226b8805b1ada57ccc6917b5ff5e7febaf3b349441c02a55a40669279c6dd1');
  assert.equal(first.status, 'OK');
  assert.deepEqual(second, first);
});

test('a slot stays occupied through the response body and is released on failure', async () => {
  const bodies = Array.from({ length: 4 }, () => Promise.withResolvers<string>());
  const full = Promise.withResolvers<void>();
  let started = 0;
  const fetcher: typeof fetch = async () => {
    const body = bodies[started++];
    if (started === 4) full.resolve();
    if (!body) return Response.json({ routes: [] });
    return new Response(new ReadableStream({
      async start(controller) {
        controller.enqueue(new TextEncoder().encode(await body.promise));
        controller.close();
      },
    }));
  };
  const provider = new GoogleTravelTimeProvider('fixture', fetcher);
  const route = () => provider.route({ ...leg, modes: ['WALK'] });
  const pending = Promise.allSettled(Array.from({ length: 4 }, route));
  await full.promise;
  const shapes = new GoogleRouteShapeProvider('fixture', fetcher);
  const queued = shapes.shape({
    from: leg.from.coordinates, to: leg.to.coordinates, departure: leg.departure, timeZone: leg.timeZone, mode: 'WALK',
  });
  try {
    await delay(0);
    assert.equal(started, 4);
    bodies[0].resolve('{');
    assert.equal(await queued, null);
  } finally {
    for (const body of bodies) body.resolve('{"routes":[]}');
  }
  const [failed, ...rest] = await pending;
  assert.equal(failed.status, 'rejected');
  assert.ok(rest.every(result => result.status === 'fulfilled'));
  assert.equal(started, 5);
});
