import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { RouteShapesResponse } from '@travel/core/contracts/route-shapes';
import { encode } from 'next-auth/jwt';
import { PostgresMobileSessionStore } from '../../src/lib/auth/session-store';
import { createDatabasePool } from '../../src/lib/db';
import { migrate } from '../../src/lib/migrations';
import { hashOpaqueToken, newOpaqueToken } from '../../src/lib/opaque-token';
import { saveItinerary } from '../../src/repositories/itineraries';
import { insertTrip } from '../../src/repositories/trip-inputs';
import { loadTripInputs } from '../../src/repositories/trip-snapshot';
import { sampleDraft } from '../fixtures/itinerary';
import { encodedPolyline } from '../fixtures/route-shapes';
import { service } from '../helpers/itinerary-service';

const pool = createDatabasePool();
const owner = randomUUID(), visitor = randomUUID();
const ownerToken = newOpaqueToken(), visitorToken = newOpaqueToken(), expiredToken = newOpaqueToken();
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
let path: string, inputHash: string, legCount: number;

test.beforeAll(async () => {
  const client = await pool.connect();
  try {
    await migrate(client);
    await client.query(`INSERT INTO users (id, google_id, email)
      SELECT id, id::text, 'shapes@example.test' FROM unnest($1::uuid[]) AS u(id)`, [[owner, visitor]]);
    const sessions = new PostgresMobileSessionStore(() => client);
    const future = new Date(Date.now() + 86_400_000).toISOString();
    await sessions.issue(owner, hashOpaqueToken(ownerToken), future);
    await sessions.issue(visitor, hashOpaqueToken(visitorToken), future);
    await sessions.issue(owner, hashOpaqueToken(expiredToken), new Date(0).toISOString());

    const trip = await insertTrip(client, owner, sampleDraft());
    const loaded = await loadTripInputs(client, trip);
    assert.ok(loaded?.status === 'READY');
    const result = await service().service.compute(loaded.input);
    inputHash = loaded.inputHash;
    legCount = result.comparisons.length;
    assert.ok(legCount > 0);
    assert.equal((await saveItinerary(client, trip, inputHash, result)).status, 'SAVED');
    path = `/api/trips/${trip}/itinerary/shapes?inputHash=${inputHash}`;
  } finally { client.release(); }
});

test.afterAll(async () => {
  try { await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[owner, visitor]]); }
  finally { await pool.end(); }
});

test('the owner’s mobile session reads the saved itinerary shapes', async ({ request }) => {
  const response = await request.get(path, { headers: bearer(ownerToken) });
  expect(response.status()).toBe(200);
  const body: RouteShapesResponse = await response.json();
  expect(body.inputHash).toBe(inputHash);
  expect(body.legs).toHaveLength(legCount);
  for (const leg of body.legs) expect(leg.shape).toEqual({ status: 'OK', encodedPolyline });
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

test('an owner cookie authenticates only when Authorization is absent', async ({ request }, testInfo) => {
  const secret = testInfo.config.webServer?.env?.AUTH_SECRET;
  assert.ok(secret);
  const name = 'authjs.session-token';
  const jwt = await encode({ secret, salt: name, token: { userId: owner } });
  const cookie = `${name}=${jwt}`;
  const valid = await request.get(path, { headers: { cookie } });
  expect(valid.status()).toBe(200);
  const invalid = await request.get(path, { headers: { cookie, ...bearer(expiredToken) } });
  expect(invalid.status()).toBe(401);
  expect((await invalid.json()).code).toBe('UNAUTHENTICATED');
});
