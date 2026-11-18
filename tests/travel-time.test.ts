import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TravelInputError, TravelProviderError, type MatrixRequest, type ProviderMode } from '../src/travel-time';
import { CachedTravelTimeProvider } from '../src/travel-time/cache';
import { GoogleTravelTimeProvider, MATRIX_FIELDS, ROUTE_FIELDS } from '../src/travel-time/google';
import { locations, routeFixture } from './fixtures/routes';
import { request, leg, setup } from './helpers/travel-time';

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
