import assert from 'node:assert/strict';
import { test } from 'node:test';
import { routeShapeHandlers } from '../src/route-shapes/http';
import type { ShapeOutcome } from '../src/services/route-shapes';
import { TravelProviderError } from '../src/travel-time';
import { PlaceProviderError } from '../src/places';
import { encodedPolyline } from './fixtures/route-shapes';

const inputHash = 'a'.repeat(64), url = 'https://app.example.test/api/trips/trip/itinerary/shapes';
const request = (query = `inputHash=${inputHash}`) => new Request(`${url}?${query}`);
const success: ShapeOutcome = { status: 'OK', response: { inputHash, legs: [{
  date: '2026-12-01', kind: 'DAY', from: 'a', to: 'b', mode: 'TRANSIT', shape: { status: 'OK', encodedPolyline },
}] } };

function setup(options: { user?: string; owner?: string | null; read?: () => Promise<ShapeOutcome> } = {}) {
  let created = 0;
  const calls: unknown[] = [];
  const handlers = routeShapeHandlers({
    userId: async request => { calls.push(request); return 'user' in options ? options.user : 'owner'; },
    findOwner: async () => 'owner' in options ? options.owner! : 'owner',
    service: () => {
      created++;
      return { read: async (...args) => { calls.push(args); return options.read ? options.read() : success; } };
    },
  });
  return { handlers, calls, created: () => created };
}

test('T19 HTTP ownership and authentication precede input/service/provider access', async () => {
  for (const [options, status, code] of [
    [{ user: undefined }, 401, 'UNAUTHENTICATED'], [{ owner: 'other' }, 403, 'FORBIDDEN'], [{ owner: null }, 404, 'NOT_FOUND'],
  ] as const) {
    const s = setup(options), response = await s.handlers.get(request(), 'trip');
    assert.equal(response.status, status);
    assert.equal((await response.json()).code, code);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(s.created(), 0);
  }
});

test('T19 HTTP requires exactly one SHA-256 input hash; request is passed to authenticator', async () => {
  for (const query of ['', 'inputHash=', 'inputHash=abc', `inputHash=${'A'.repeat(64)}`,
    `inputHash=${inputHash}&inputHash=${inputHash}`, `inputHash=${'a'.repeat(65)}`]) {
    const s = setup(), response = await s.handlers.get(request(query), 'trip');
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, 'INVALID_INPUT');
    assert.equal(s.created(), 0);
  }
  const s = setup(), req = request(), response = await s.handlers.get(req, 'trip');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), success.response);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(s.calls[0], req);
  assert.deepEqual(s.calls[1], ['trip', 'owner', inputHash]);
});

test('T19 HTTP distinguishes stale/unavailable and never returns a partial result on failure', async () => {
  for (const status of ['NOT_FOUND', 'STALE_INPUT', 'RESULT_UNAVAILABLE'] as const) {
    const response = await setup({ read: async () => ({ status }) }).handlers.get(request(), 'trip');
    assert.equal(response.status, status === 'NOT_FOUND' ? 404 : 409);
    assert.equal((await response.json()).code, status);
  }
  for (const [error, status, code] of [
    [new TravelProviderError('UNAVAILABLE'), 503, 'PROVIDER_UNAVAILABLE'],
    [new TravelProviderError('INVALID_RESPONSE'), 502, 'PROVIDER_INVALID_RESPONSE'],
    [new PlaceProviderError('UNAVAILABLE'), 503, 'PROVIDER_UNAVAILABLE'],
    [new PlaceProviderError('INVALID_RESPONSE'), 502, 'PROVIDER_INVALID_RESPONSE'],
    [new Error('private secret'), 500, 'INTERNAL'],
  ] as const) {
    const response = await setup({ read: async () => { throw error; } }).handlers.get(request(), 'trip');
    assert.equal(response.status, status);
    const body = await response.json();
    assert.equal(body.code, code);
    assert.equal(body.legs, undefined);
    assert.ok(!JSON.stringify(body).includes('private secret'));
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
  }
});
