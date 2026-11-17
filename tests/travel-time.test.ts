import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import {
  TravelInputError, TravelProviderError, type Location, type MatrixRequest,
  type ProviderMode, type RouteRequest, type TravelAlternatives, type TravelTimeProvider,
} from '../src/travel-time';
import { CachedTravelTimeProvider } from '../src/travel-time/cache';
import { GoogleTravelTimeProvider, MATRIX_FIELDS, ROUTE_FIELDS } from '../src/travel-time/google';
import { createGoogleTravelTimeProvider } from '../src/travel-time/server';
import { locations, routeFixture } from './fixtures/routes';

const request: MatrixRequest = {
  departure: '2026-11-23T09:00:00+09:00', timeZone: 'Asia/Tokyo', modes: ['TRANSIT', 'WALK', 'DRIVE'], locations,
};
const leg: RouteRequest = { ...request, from: locations[0], to: locations[1] };
type Waypoint = { location: { latLng: Location['coordinates'] } };
type Body = {
  travelMode: ProviderMode; departureTime?: string; routingPreference?: string;
  origins: { waypoint: Waypoint }[]; destinations: { waypoint: Waypoint }[];
  origin: Waypoint; destination: Waypoint; languageCode: string; units: string;
};

function setup(maxEntries = 2) {
  const calls: { url: string; init: RequestInit; body: Body }[] = [];
  let override: ((body: Body, matrix: boolean) => unknown) | undefined;
  let status = 200, now = 0;
  const fetcher: typeof fetch = async (url, init) => {
    assert.ok(init);
    const body: Body = JSON.parse(init.body as string), matrix = String(url).includes('computeRouteMatrix');
    calls.push({ url: String(url), init, body });
    const value = override ? override(body, matrix) : matrix
      ? body.origins.flatMap((from, i) => body.destinations.map((to, j) => ({
        ...(i ? { originIndex: i } : {}), ...(j ? { destinationIndex: j } : {}), status: {}, condition: 'ROUTE_EXISTS',
        ...routeFixture(body.travelMode, from.waypoint.location.latLng.latitude > to.waypoint.location.latLng.latitude),
      }))).reverse() // Responses need not arrive in row order; zero-valued indexes may be omitted.
      : { routes: [routeFixture(body.travelMode)] };
    return Response.json(value, { status });
  };
  const google = new GoogleTravelTimeProvider('fixture-secret', fetcher);
  const cache = new CachedTravelTimeProvider(google, { ttlMs: 1000, maxEntries }, () => now);
  return {
    calls, google, cache,
    reply: (value: unknown, code = 200) => { override = () => value; status = code; },
    respond: (fn: NonNullable<typeof override>) => { override = fn; status = 200; },
    reset: () => { override = undefined; status = 200; },
    advance: (ms: number) => { now += ms; },
  };
}

test('T9 returns directed TRANSIT/WALK/DRIVE matrices and transit fare or null without live credentials', async () => {
  const s = setup();
  const matrix = await s.google.matrix(request);
  assert.equal(matrix.size, 2);
  for (const row of matrix.values()) assert.equal(row.size, 2);
  assert.deepEqual(matrix.get('hotel')!.get('museum'), {
    TRANSIT: { durationSeconds: 600.5, distanceMeters: 2000, fare: { amount: 210.5, currency: 'JPY' } },
    WALK: { durationSeconds: 900, distanceMeters: 2000, fare: null },
    DRIVE: { durationSeconds: 300, distanceMeters: 2000, fare: null },
  });
  assert.deepEqual(matrix.get('museum')!.get('hotel')!.TRANSIT, { durationSeconds: 720, distanceMeters: 2200, fare: null });
  assert.equal(s.calls.length, 3);
  for (const { url, init, body } of s.calls) {
    assert.equal(url, 'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix');
    const headers = new Headers(init.headers);
    assert.equal(headers.get('X-Goog-FieldMask'), MATRIX_FIELDS);
    assert.equal(headers.get('X-Goog-Api-Key'), 'fixture-secret');
    assert.equal(init.cache, 'no-store');
    assert.equal(init.redirect, 'error');
    assert.ok(init.signal);
    assert.equal(body.languageCode, 'ko');
    assert.equal(body.units, 'METRIC');
    assert.deepEqual(body.origins[0].waypoint.location.latLng, locations[0].coordinates);
    assert.equal(body.departureTime, body.travelMode === 'TRANSIT' ? '2026-11-23T00:00:00Z' : undefined);
    assert.equal(body.routingPreference, body.travelMode === 'DRIVE' ? 'TRAFFIC_UNAWARE' : undefined);
  }
});

test('T9 actual-departure leg re-query uses computeRoutes, propagates transit fares, and omits unreachable modes', async () => {
  const s = setup();
  s.respond(body => body.travelMode === 'WALK' ? {} : { routes: [routeFixture(body.travelMode)] });
  const result = await s.google.route({ ...leg, departure: '2026-11-23T10:35:00+09:00' });
  assert.equal(result.WALK, undefined);
  assert.deepEqual(result.TRANSIT?.fare, { amount: 210.5, currency: 'JPY' });
  assert.equal(result.DRIVE?.durationSeconds, 300, 'taxi waiting buffer belongs to scheduler');
  assert.equal(result.DRIVE?.fare, null, 'taxi fare belongs to FareProvider');
  assert.equal(s.calls.length, 3);
  for (const call of s.calls) {
    assert.equal(call.url, 'https://routes.googleapis.com/directions/v2:computeRoutes');
    assert.equal(new Headers(call.init.headers).get('X-Goog-FieldMask'), ROUTE_FIELDS);
    assert.deepEqual(call.body.origin.location.latLng, leg.from.coordinates);
    assert.deepEqual(call.body.destination.location.latLng, leg.to.coordinates);
  }
  assert.equal(s.calls[0].body.departureTime, '2026-11-23T01:35:00Z');
});

test('matrix tiling respects 100/625-element limits and maps tile-local indexes to the correct location IDs', async () => {
  const s = setup();
  const points = Array.from({ length: 26 }, (_, i) => ({ id: `p${i}`, coordinates: { latitude: i, longitude: i } }));
  s.respond((body) => body.origins.flatMap((from, i) => body.destinations.map((to, j) => ({
    originIndex: i, destinationIndex: j, condition: 'ROUTE_EXISTS', status: {},
    duration: `${from.waypoint.location.latLng.latitude * 100 + to.waypoint.location.latLng.latitude}s`,
  }))).reverse());
  const matrix = await s.google.matrix({ ...request, locations: points });
  assert.equal(s.calls.length, 17); // 3x3 transit tiles + 2x2 walk + 2x2 drive.
  for (const { body } of s.calls) assert.ok(body.origins.length * body.destinations.length <= (body.travelMode === 'TRANSIT' ? 100 : 625));
  for (let i = 0; i < 26; i++) for (let j = 0; j < 26; j++) for (const mode of request.modes) {
    assert.deepEqual(matrix.get(`p${i}`)?.get(`p${j}`)?.[mode], { durationSeconds: i * 100 + j, distanceMeters: 0, fare: null });
  }
  s.calls.length = 0;
  assert.equal((await s.google.matrix({ ...request, locations: [] })).size, 0);
  assert.equal(s.calls.length, 0);
});

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

test('valid no-route results omit only that mode; free transit is distinct from unknown fare', async () => {
  const s = setup();
  s.respond(body => body.origins.flatMap((_, i) => body.destinations.map((_, j) => ({
    originIndex: i, destinationIndex: j, condition: 'ROUTE_NOT_FOUND', status: {},
  }))));
  const empty = await s.google.matrix(request);
  assert.deepEqual(empty.get('hotel')!.get('museum'), {});
  for (const money of [{ currencyCode: 'JPY' }, { currencyCode: 'USD', units: '0', nanos: 250_000_000 }]) {
    s.reply({ routes: [{ duration: '0s', travelAdvisory: { transitFare: money } }] });
    const result = await s.google.route({ ...leg, modes: ['TRANSIT'] });
    assert.deepEqual(result.TRANSIT?.fare, { amount: 'nanos' in money ? 0.25 : 0, currency: money.currencyCode });
  }
  s.reply({ routes: [{ duration: '1s' }] });
  assert.equal((await s.google.route({ ...leg, modes: ['TRANSIT'] })).TRANSIT?.fare, null);
});

test('provider failures, invalid JSON and corrupt route fields never become no-route or unknown fare', async () => {
  const s = setup();
  for (const status of [400, 403, 429, 500]) {
    s.reply({ error: { message: 'fixture-secret' } }, status);
    await assert.rejects(s.google.route(leg), (error: unknown) => error instanceof TravelProviderError && error.kind === 'UNAVAILABLE' && !error.message.includes('fixture-secret'));
  }
  for (const fetcher of [
    async () => { throw new Error('fixture-secret'); },
    async () => { throw new DOMException('timeout', 'TimeoutError'); },
  ]) await assert.rejects(new GoogleTravelTimeProvider('fixture-secret', fetcher).route(leg), { kind: 'UNAVAILABLE' });
  await assert.rejects(new GoogleTravelTimeProvider('fixture-secret', async () => new Response('not json')).route(leg), { kind: 'INVALID_RESPONSE' });
  await assert.rejects(new GoogleTravelTimeProvider('', async () => { assert.fail('must not call'); }).route(leg), { kind: 'UNAVAILABLE' });
  const invalidRoutes: unknown[] = [
    null, [], { error: {} }, { routes: {} }, { routes: [null] },
    ...[{}, { duration: '-1s' }, { duration: 'NaNs' }, { duration: '1.1234567890s' },
      { duration: '1s', distanceMeters: -1 }, { duration: '1s', distanceMeters: 0.5 },
      ...[{ currencyCode: 'JPY', units: '-1' }, { currencyCode: 'JPY', units: '9007199254740992' },
        { currencyCode: 'JPY', nanos: 1e9 }, { currencyCode: 'JPY', nanos: -1 },
        { currencyCode: 'JPY', units: 1 }, { currencyCode: 'bad' }, {}]
        .map(money => ({ duration: '1s', travelAdvisory: { transitFare: money } })),
    ].map(route => ({ routes: [route] })),
  ];
  for (const value of invalidRoutes) {
    s.reply(value);
    await assert.rejects(s.google.route(leg), { kind: 'INVALID_RESPONSE' });
  }
});

test('matrix rejects missing/duplicate/out-of-range elements and element errors instead of inventing reachability', async () => {
  const s = setup();
  const element = { originIndex: 0, destinationIndex: 0, status: {}, condition: 'ROUTE_EXISTS', duration: '1s' };
  for (const value of [null, {}, [], [element, element, element, element]]) {
    s.reply(value);
    await assert.rejects(s.google.matrix(request), { kind: 'INVALID_RESPONSE' });
  }
  for (const bad of [
    { ...element, originIndex: 1 }, { ...element, destinationIndex: -1 },
    { ...element, originIndex: 0.5 }, { ...element, condition: 'UNSPECIFIED' },
    { ...element, status: { code: '0' } }, { ...element, duration: 'invalid' },
  ]) {
    s.reply([bad]);
    await assert.rejects(s.google.matrix({ ...request, locations: [locations[0]] }), { kind: 'INVALID_RESPONSE' });
  }
  s.reply([{ ...element, condition: 'ROUTE_NOT_FOUND', status: { code: 8, message: 'fixture-secret' } }]);
  await assert.rejects(s.google.matrix({ ...request, locations: [locations[0]] }), { kind: 'UNAVAILABLE' });
});

test('invalid timezones, instants, modes and locations fail before external calls or cache access', async () => {
  const s = setup();
  const bad: MatrixRequest[] = [
    { ...request, departure: '2026-11-23T09:00:00' }, { ...request, departure: '2026-02-30T09:00:00Z' },
    { ...request, timeZone: '+09:00' }, { ...request, timeZone: 'invalid' },
    { ...request, modes: [] }, { ...request, modes: ['TAXI' as ProviderMode] },
    { ...request, locations: [locations[0], locations[0]] },
    { ...request, locations: Array.from({ length: 101 }, (_, i) => ({ ...locations[0], id: `${i}` })) },
    ...[NaN, Infinity, 91].map(latitude => ({ ...request, locations: [{ id: 'x', coordinates: { latitude, longitude: 0 } }] })),
    { ...request, locations: [{ id: '', coordinates: { latitude: 0, longitude: 0 } }] },
    { ...request, locations: [{ id: 'x', coordinates: { latitude: 0, longitude: -181 } }] },
  ];
  try {
    for (const input of bad) {
      await assert.rejects(s.google.matrix(input), TravelInputError);
      await assert.rejects(s.cache.matrix(input), TravelInputError);
    }
    await assert.rejects(s.cache.route({ ...leg, to: { ...leg.to, id: leg.from.id } }), TravelInputError);
    assert.equal(s.calls.length, 0);
    for (const options of [{ ttlMs: -1 }, { ttlMs: 86_400_001 }, { ttlMs: NaN }, { maxEntries: 0 }, { maxEntries: 1.5 }]) {
      assert.throws(() => new CachedTravelTimeProvider(s.google, options), RangeError);
    }
  } finally { s.cache.dispose(); }
});
