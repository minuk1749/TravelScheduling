import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GoogleRouteShapeProvider, SHAPE_FIELDS } from '../src/travel-time/google-shapes';
import { TravelInputError, TravelProviderError } from '../src/travel-time';
import type { RouteShapeRequest } from '../src/travel-time/shapes';
import { createGoogleRouteShapeProvider } from '../src/travel-time/server';
import { encodedPolyline, noShapeResponse, shapeResponse } from './fixtures/route-shapes';

const request: RouteShapeRequest = {
  from: { latitude: 35, longitude: 139 }, to: { latitude: 36, longitude: 140 },
  mode: 'TRANSIT', departure: '2026-12-01T10:00:00+09:00', timeZone: 'Asia/Tokyo',
};

test('T19 Google shapes request only encoded geometry with selected mode, actual instant, no cache', async () => {
  const calls: RequestInit[] = [];
  const provider = new GoogleRouteShapeProvider('fixture-key', async (url, init) => {
    assert.equal(url, 'https://routes.googleapis.com/directions/v2:computeRoutes');
    assert.ok(init); calls.push(init);
    return Response.json(shapeResponse);
  });
  for (const mode of ['TRANSIT', 'WALK', 'DRIVE'] as const) {
    assert.deepEqual(await provider.shape({ ...request, mode }), { encodedPolyline });
    const init = calls.at(-1)!;
    assert.equal(new Headers(init.headers).get('X-Goog-FieldMask'), SHAPE_FIELDS);
    assert.equal(SHAPE_FIELDS, 'routes.polyline.encodedPolyline');
    assert.equal(init.cache, 'no-store');
    assert.equal(init.redirect, 'error');
    assert.ok(init.signal);
    assert.equal(init.method, 'POST');
    assert.deepEqual(JSON.parse(String(init.body)), {
      origin: { location: { latLng: request.from } }, destination: { location: { latLng: request.to } },
      travelMode: mode, languageCode: 'ko', units: 'METRIC', computeAlternativeRoutes: false,
      polylineEncoding: 'ENCODED_POLYLINE', polylineQuality: 'HIGH_QUALITY',
      ...(mode === 'TRANSIT' ? { departureTime: '2026-12-01T01:00:00Z' } : {}),
      ...(mode === 'DRIVE' ? { routingPreference: 'TRAFFIC_UNAWARE' } : {}),
    });
  }
  await provider.shape(request);
  assert.equal(calls.length, 4, 'completed response is never reused');
  assert.ok(createGoogleRouteShapeProvider() instanceof GoogleRouteShapeProvider, 'factory has no caching decorator');
});

test('T19 no-route is null; malformed or empty geometry is a provider error', async () => {
  for (const response of [noShapeResponse, {}]) {
    const provider = new GoogleRouteShapeProvider('fixture', async () => Response.json(response));
    assert.equal(await provider.shape(request), null);
  }
  for (const response of [null, [], { error: {} }, { routes: null }, { routes: {} }, { routes: [null] },
    { routes: [{}] }, { routes: [{ polyline: {} }] }, { routes: [{ polyline: { encodedPolyline: '' } }] },
    { routes: [{ polyline: { encodedPolyline: 42 } }] }, { routes: [{ polyline: { encodedPolyline: ' ' } }] }]) {
    const provider = new GoogleRouteShapeProvider('fixture', async () => Response.json(response));
    await assert.rejects(provider.shape(request), { name: 'Error', kind: 'INVALID_RESPONSE' });
  }
  const provider = new GoogleRouteShapeProvider('fixture', async () => new Response('{'));
  await assert.rejects(provider.shape(request), TravelProviderError);
});

for (const geometry of ['_', '?', '??_', '?_', '_?', encodedPolyline.slice(0, -1), `${encodedPolyline}?`]) {
  test(`T19 incomplete polyline ${JSON.stringify(geometry)} is INVALID_RESPONSE`, async () => {
    const provider = new GoogleRouteShapeProvider('fixture', async () =>
      Response.json({ routes: [{ polyline: { encodedPolyline: geometry } }] }));
    await assert.rejects(provider.shape(request), error => error instanceof TravelProviderError
      && error.kind === 'INVALID_RESPONSE');
  });
}

test('T19 complete coordinate pairs preserve zero deltas and multi-chunk components', async () => {
  for (const geometry of ['??', '????', '?^', '_@?', encodedPolyline]) {
    const provider = new GoogleRouteShapeProvider('fixture', async () =>
      Response.json({ routes: [{ polyline: { encodedPolyline: geometry } }] }));
    assert.deepEqual(await provider.shape(request), { encodedPolyline: geometry });
  }
});

test('T19 quotas, HTTP and network failures are typed errors, never missing shapes', async () => {
  for (const status of [400, 403, 429, 500, 503]) {
    const provider = new GoogleRouteShapeProvider('fixture', async () => new Response('private detail', { status }));
    await assert.rejects(provider.shape(request), error => error instanceof TravelProviderError
      && error.kind === 'UNAVAILABLE' && !error.message.includes('private detail'));
  }
  for (const error of [new TypeError('network'), new DOMException('timeout', 'TimeoutError')]) {
    const provider = new GoogleRouteShapeProvider('fixture', async () => { throw error; });
    await assert.rejects(provider.shape(request), { kind: 'UNAVAILABLE' });
  }
  const missingKey = new GoogleRouteShapeProvider('', async () => assert.fail('must not call Google'));
  await assert.rejects(missingKey.shape(request), { kind: 'UNAVAILABLE' });
});

test('T19 shapes use existing instant/timezone/coordinate validation before network access', async () => {
  const provider = new GoogleRouteShapeProvider('fixture', async () => assert.fail('invalid input must not call Google'));
  for (const change of [{ departure: '2026-12-01T10:00:00' }, { timeZone: '+09:00' },
    { timeZone: 'Not/AZone' }, { from: { latitude: 91, longitude: 0 } }]) {
    await assert.rejects(provider.shape({ ...request, ...change }), TravelInputError);
  }
});
