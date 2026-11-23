import { expect, test } from '@playwright/test';
import type { SavedRouteShapesResponse } from '@travel/core/contracts/route-shapes';
import { newOpaqueToken } from '../../src/lib/opaque-token';
import { encodedPolyline } from '../fixtures/route-shapes';
import { registerRouteShapesSeed } from './support/route-shapes-seed';

// The spec's only database setup (no other hook writes): the seed runs after the schema check, and e2e-database.test.ts
// runs this same registration against another schema. The seeded rows go with the run's schema when global teardown
// drops it (no cleanup query here).
const seeded = registerRouteShapesSeed(test);
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

test('the owner’s mobile session reads the latest itinerary by ID or hash and gets 409 for its predecessor', async ({ request }) => {
  const { ownerToken, path, inputHash, firstId, latestId, legCount } = seeded();
  const options = { headers: bearer(ownerToken) };
  const response = await request.get(`${path}&itineraryId=${latestId}`, options);
  expect(response.status()).toBe(200);
  const body: SavedRouteShapesResponse = await response.json();
  expect(body.itineraryId).toBe(latestId);
  expect(body.inputHash).toBe(inputHash);
  expect(body.legs).toHaveLength(legCount);
  expect(body.legs.filter(leg => leg.kind === 'DAY').map(leg => leg.mode)).toEqual(['TRANSIT', 'TRANSIT']);
  for (const leg of body.legs) expect(leg.shape).toEqual({ status: 'OK', encodedPolyline });
  const unpinned = await request.get(path, options);
  expect(unpinned.status()).toBe(200);
  expect(await unpinned.json()).toEqual(body);
  const superseded = await request.get(`${path}&itineraryId=${firstId}`, options);
  expect(superseded.status()).toBe(409);
  const error = await superseded.json();
  expect(error.code).toBe('RESULT_UNAVAILABLE');
  expect(error).not.toHaveProperty('legs');
});

test('another valid mobile session is forbidden', async ({ request }) => {
  const seed = seeded();
  const response = await request.get(seed.path, { headers: bearer(seed.visitorToken) });
  expect(response.status()).toBe(403);
  expect((await response.json()).code).toBe('FORBIDDEN');
});

test('expired, unknown and malformed mobile tokens are unauthenticated', async ({ request }) => {
  const seed = seeded();
  for (const token of [seed.expiredToken, newOpaqueToken(), 'invalid']) {
    const response = await request.get(seed.path, { headers: bearer(token) });
    expect(response.status()).toBe(401);
    expect((await response.json()).code).toBe('UNAUTHENTICATED');
  }
});

test('T25: without a Bearer session the request is unauthenticated, whatever cookies it carries', async ({ request }) => {
  const seed = seeded();
  const variants: Record<string, string>[] = [{}, { cookie: 'authjs.session-token=legacy; __Secure-authjs.session-token=legacy' }];
  for (const headers of variants) {
    const response = await request.get(seed.path, { headers });
    expect(response.status()).toBe(401);
    expect((await response.json()).code).toBe('UNAUTHENTICATED');
  }
});
