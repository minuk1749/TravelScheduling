import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { SavedRouteShapesResponse } from '@travel/core/contracts/route-shapes';
import { PostgresMobileSessionStore } from '../../src/lib/auth/session-store';
import { hashOpaqueToken, newOpaqueToken } from '../../src/lib/opaque-token';
import { saveItinerary } from '../../src/repositories/itineraries';
import { insertTrip } from '../../src/repositories/trip-inputs';
import { loadTripInputs } from '../../src/repositories/trip-snapshot';
import { FixtureTravel, sampleDraft, sampleTrip } from '../fixtures/itinerary';
import { encodedPolyline } from '../fixtures/route-shapes';
import { service } from '../helpers/itinerary-service';
import { openRunDatabase } from './support/database';

// Registered first, so the schema check runs before the seeding below; the seeded rows go with the run's schema.
const pool = openRunDatabase(test);
const owner = randomUUID(), visitor = randomUUID();
const ownerToken = newOpaqueToken(), visitorToken = newOpaqueToken(), expiredToken = newOpaqueToken();
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
let path: string, inputHash: string, firstId: string, latestId: string, legCount: number;

test.beforeAll(async () => {
  const client = await pool.connect();
  try {
    await client.query(`INSERT INTO users (id, google_id, email)
      SELECT id, id::text, 'shapes@example.test' FROM unnest($1::uuid[]) AS u(id)`, [[owner, visitor]]);
    const sessions = new PostgresMobileSessionStore(() => client);
    const future = new Date(Date.now() + 86_400_000).toISOString();
    await sessions.issue(owner, hashOpaqueToken(ownerToken), future);
    await sessions.issue(visitor, hashOpaqueToken(visitorToken), future);
    await sessions.issue(owner, hashOpaqueToken(expiredToken), new Date(0).toISOString());

    const trip = await insertTrip(client, owner, sampleDraft(sampleTrip([{ key: 'tsukiji', minutes: 30 }])));
    const loaded = await loadTripInputs(client, trip);
    assert.ok(loaded?.status === 'READY');
    inputHash = loaded.inputHash;
    const first = await saveItinerary(client, trip, inputHash, await service().service.compute(loaded.input));
    assert.ok(first.status === 'SAVED');
    const travel = new FixtureTravel(({ mode }) => mode === 'WALK' ? 3_600 : 0);
    const result = await service({ travel }).service.compute(loaded.input);
    legCount = result.comparisons.length;
    assert.ok(legCount > 0);
    const latest = await saveItinerary(client, trip, inputHash, result);
    assert.ok(latest.status === 'SAVED');
    firstId = first.itineraryId;
    latestId = latest.itineraryId;
    path = `/api/trips/${trip}/itinerary/shapes?inputHash=${inputHash}`;
  } finally { client.release(); }
});

test('the owner’s mobile session reads the latest itinerary by ID or hash and gets 409 for its predecessor', async ({ request }) => {
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
  const response = await request.get(path, { headers: bearer(visitorToken) });
  expect(response.status()).toBe(403);
  expect((await response.json()).code).toBe('FORBIDDEN');
});

test('expired, unknown and malformed mobile tokens are unauthenticated', async ({ request }) => {
  for (const token of [expiredToken, newOpaqueToken(), 'invalid']) {
    const response = await request.get(path, { headers: bearer(token) });
    expect(response.status()).toBe(401);
    expect((await response.json()).code).toBe('UNAUTHENTICATED');
  }
});

test('T25: without a Bearer session the request is unauthenticated, whatever cookies it carries', async ({ request }) => {
  const variants: Record<string, string>[] = [{}, { cookie: 'authjs.session-token=legacy; __Secure-authjs.session-token=legacy' }];
  for (const headers of variants) {
    const response = await request.get(path, { headers });
    expect(response.status()).toBe(401);
    expect((await response.json()).code).toBe('UNAUTHENTICATED');
  }
});
