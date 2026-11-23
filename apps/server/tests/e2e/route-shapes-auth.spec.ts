import { expect, test } from '@playwright/test';
import type { SavedRouteShapesResponse } from '@travel/core/contracts/route-shapes';
import { newOpaqueToken } from '../../src/lib/opaque-token';
import { encodedPolyline } from '../fixtures/route-shapes';
import { openRunDatabase } from './support/database';
import { seedRouteShapes, type RouteShapesSeed } from './support/route-shapes-seed';

// The whole seed is openRunDatabase's prepare step, so it runs only after the schema check succeeds; the seeded rows go
// with the run's schema when global teardown drops it (no cleanup query here).
let seed: RouteShapesSeed;
openRunDatabase(test, async pool => { seed = await seedRouteShapes(pool); });
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

test('the owner’s mobile session reads the latest itinerary by ID or hash and gets 409 for its predecessor', async ({ request }) => {
  const { ownerToken, path, inputHash, firstId, latestId, legCount } = seed;
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
  const response = await request.get(seed.path, { headers: bearer(seed.visitorToken) });
  expect(response.status()).toBe(403);
  expect((await response.json()).code).toBe('FORBIDDEN');
});

test('expired, unknown and malformed mobile tokens are unauthenticated', async ({ request }) => {
  for (const token of [seed.expiredToken, newOpaqueToken(), 'invalid']) {
    const response = await request.get(seed.path, { headers: bearer(token) });
    expect(response.status()).toBe(401);
    expect((await response.json()).code).toBe('UNAUTHENTICATED');
  }
});

test('T25: without a Bearer session the request is unauthenticated, whatever cookies it carries', async ({ request }) => {
  const variants: Record<string, string>[] = [{}, { cookie: 'authjs.session-token=legacy; __Secure-authjs.session-token=legacy' }];
  for (const headers of variants) {
    const response = await request.get(seed.path, { headers });
    expect(response.status()).toBe(401);
    expect((await response.json()).code).toBe('UNAUTHENTICATED');
  }
});
