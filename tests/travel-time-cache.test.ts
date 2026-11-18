import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { TravelProviderError, type RouteRequest, type TravelAlternatives, type TravelTimeProvider } from '../src/travel-time';
import { CachedTravelTimeProvider } from '../src/travel-time/cache';
import { createGoogleTravelTimeProvider } from '../src/travel-time/server';
import { locations } from './fixtures/routes';
import { request, leg, setup } from './helpers/travel-time';

test('T9 permitted cache: repeated matrix/route calls make zero extra external calls, including canonical equivalent inputs', async () => {
  const s = setup();
  try {
    const first = await s.cache.matrix(request);
    const second = await s.cache.matrix({ ...request, locations: [...locations].reverse(), modes: ['DRIVE', 'WALK', 'TRANSIT', 'WALK'], departure: '2026-11-23T00:00:00Z' });
    assert.deepEqual(first, second);
    assert.equal(s.calls.length, 3);
    first.get('hotel')!.get('museum')!.TRANSIT!.fare!.amount = 999;
    assert.equal(second.get('hotel')!.get('museum')!.TRANSIT!.fare!.amount, 210.5);
    const route = await s.cache.route(leg);
    assert.equal(s.calls.length, 6, 'leg query must not silently reuse the representative matrix');
    route.TRANSIT!.fare!.amount = 999;
    assert.equal((await s.cache.route(leg)).TRANSIT!.fare!.amount, 210.5);
    assert.equal(s.calls.length, 6);
    s.advance(999);
    await s.cache.matrix(request);
    assert.equal(s.calls.length, 6);
    s.advance(1);
    await s.cache.matrix(request);
    assert.equal(s.calls.length, 9, 'exact expiration is a cache miss');
  } finally { s.cache.dispose(); }
});

test('cache keys distinguish exact departure, timezone, modes, direction, IDs and coordinates', async () => {
  const s = setup(32); // Keep the original cached throughout: eviction must not hide key collisions.
  try {
    await s.cache.route(leg);
    const variations: RouteRequest[] = [
      { ...leg, departure: '2026-11-23T09:00:00.000000001+09:00' },
      { ...leg, timeZone: 'Asia/Seoul' },
      { ...leg, modes: ['WALK'] },
      { ...leg, from: leg.to, to: leg.from },
      { ...leg, from: { ...leg.from, id: 'another' } },
      { ...leg, to: { ...leg.to, coordinates: { ...leg.to.coordinates, longitude: 140 } } },
    ];
    for (const value of variations) {
      const count = s.calls.length;
      await s.cache.route(value);
      assert.equal(s.calls.length - count, value.modes.length);
    }
    await s.cache.matrix(request);
    for (const value of [
      { ...request, locations: [locations[0]] },
      { ...request, locations: [locations[0], { ...locations[1], coordinates: { latitude: 36, longitude: 140 } }] },
    ]) {
      const count = s.calls.length;
      await s.cache.matrix(value);
      assert.equal(s.calls.length - count, 3);
    }
  } finally { s.cache.dispose(); }
});

test('cache merges concurrent calls, isolates each result, evicts bounded entries and retries failures', async () => {
  const s = setup();
  try {
    const [a, b] = await Promise.all([s.cache.route(leg), s.cache.route(leg)]);
    assert.equal(s.calls.length, 3);
    a.TRANSIT!.durationSeconds = 0;
    assert.equal(b.TRANSIT!.durationSeconds, 600.5);
    await s.cache.route({ ...leg, departure: '2026-11-23T10:00:00+09:00' });
    await s.cache.route({ ...leg, departure: '2026-11-23T11:00:00+09:00' });
    await s.cache.route(leg);
    assert.equal(s.calls.length, 12, 'oldest of three entries evicted at capacity two');
    s.advance(1000);
    s.reply({ error: { message: 'fixture-secret' } }, 429);
    const failures = await Promise.allSettled([s.cache.route(leg), s.cache.route(leg)]);
    assert.ok(failures.every(value => value.status === 'rejected' && value.reason instanceof TravelProviderError));
    assert.equal(s.calls.length, 13);
    s.reset();
    await s.cache.route(leg);
    assert.equal(s.calls.length, 16);
  } finally { s.cache.dispose(); }
});

test('default Google cache combines only in-flight calls and retains no completed responses', async () => {
  const s = setup(), provider = new CachedTravelTimeProvider(s.google);
  try {
    await Promise.all([provider.route(leg), provider.route(leg)]);
    assert.equal(s.calls.length, 3);
    await provider.route(leg);
    assert.equal(s.calls.length, 6);
    const originalFetch = globalThis.fetch;
    const originalKey = process.env.GOOGLE_ROUTES_API_KEY;
    let calls = 0;
    globalThis.fetch = async () => { calls++; return Response.json({ routes: [] }); };
    process.env.GOOGLE_ROUTES_API_KEY = 'fixture-secret';
    const server = createGoogleTravelTimeProvider();
    try {
      await server.route(leg);
      await server.route(leg);
      assert.equal(calls, 6);
    } finally {
      server.dispose(); globalThis.fetch = originalFetch;
      if (originalKey === undefined) delete process.env.GOOGLE_ROUTES_API_KEY;
      else process.env.GOOGLE_ROUTES_API_KEY = originalKey;
    }
  } finally { provider.dispose(); }
});

test('cache expires without reads, does not retain a slow result past its TTL, and cannot repopulate after disposal', async () => {
  let calls = 0, now = 0;
  let resolve!: (value: TravelAlternatives) => void;
  const upstream: TravelTimeProvider = {
    matrix: async () => new Map(),
    route: () => { calls++; return new Promise(done => { resolve = done; }); },
  };
  const provider = new CachedTravelTimeProvider(upstream, { ttlMs: 10 }, () => now);
  const first = provider.route(leg);
  await Promise.resolve();
  now = 10; resolve({}); await first;
  const second = provider.route(leg);
  await Promise.resolve();
  assert.equal(calls, 2, 'slow first response has already expired');
  resolve({}); await second;
  await delay(30);
  const third = provider.route(leg);
  await Promise.resolve();
  assert.equal(calls, 3, 'timer removed completed entry even with a stationary clock');
  provider.dispose(); resolve({}); await third;
  await assert.rejects(provider.route(leg), /disposed/);
});

