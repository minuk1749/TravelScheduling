import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isApiErrorCode } from '@travel/core/contracts/errors';
import { itineraryHandlers } from '../src/itineraries/http';
import { JoseGoogleIdTokenVerifier } from '../src/lib/auth/google-id-token';
import { MobileSessionService } from '../src/lib/auth/mobile-sessions';
import { SessionRequestAuthenticator } from '../src/lib/auth/request-authenticator';
import { placeHandlers } from '../src/places/http';
import { constraintHandlers } from '../src/results/http';
import { settingsHandlers } from '../src/settings/http';
import { SettingsError } from '../src/settings/model';
import { sharingHandlers } from '../src/sharing/http';
import { tripAccessHandler, tripHandlers } from '../src/trips/http';
import { sampleTrip } from './fixtures/itinerary';
import type { PlaceProvider } from '../src/places';
import { tripDraft } from './fixtures/trip-input';
import { fixtureJwks, googleIdToken, IOS_CLIENT, MemorySessionStore } from './helpers/google-id-tokens';

// T18 (requirements §5 note): every existing 401/403 ownership check also runs through real Bearer sessions.
const OWNER = 'user-owner', INTRUDER = 'user-intruder', TRIP = 'trip-1';
const findOwner = async (id: string) => id === TRIP ? OWNER : null;
const places: PlaceProvider = {
  search: async () => [], details: async () => null,
  location: async googlePlaceId => ({ googlePlaceId, coordinates: { latitude: 35.6586, longitude: 139.7454 }, cacheExpiresAt: '2026-12-01T00:00:00Z' }),
};

async function sessions() {
  const store = new MemorySessionStore();
  const service = new MobileSessionService(new JoseGoogleIdTokenVerifier([IOS_CLIENT], fixtureJwks().keys), store,
    { upsertGoogleUser: async googleId => googleId === 'g-owner' ? OWNER : INTRUDER });
  const issue = async (sub: string) => (await service.signIn(await googleIdToken({ claims: { sub } })))!.token;
  const owner = await issue('g-owner'), intruder = await issue('g-intruder');
  const revoked = await issue('g-owner'); await service.signOut(revoked);
  const expired = await issue('g-owner');
  const expiredHash = [...store.rows.keys()].at(-1)!;
  store.rows.set(expiredHash, { userId: OWNER, expiresAt: new Date(Date.now() - 1000).toISOString() });
  let cookieReads = 0;
  const authenticator = new SessionRequestAuthenticator(store, async () => { cookieReads++; return OWNER; });
  return { owner, intruder, revoked, expired, authenticator, cookieReads: () => cookieReads };
}

type Call = (userId: (request: Request) => Promise<string | undefined>, authorization: string) => Promise<Response>;
const req = (path: string, authorization: string, init: RequestInit = {}) =>
  new Request(`https://api.example.test${path}`, { ...init, headers: { authorization, 'content-type': 'application/json', ...init.headers as Record<string, string> } });

/** Ownership-checked endpoints: owner passes, another user's valid token is 403. */
const owned: [string, number, Call][] = [
  ['GET /api/trips/[id]', 200, (userId, auth) => tripAccessHandler({ userId, findOwner })(req(`/api/trips/${TRIP}`, auth), TRIP)],
  ['POST /api/trips/[id]/itinerary', 409, (userId, auth) => itineraryHandlers({ userId, findOwner,
    generator: () => ({ generator: { generate: async () => ({ status: 'STALE' }) }, dispose: () => undefined }) })
    .generate(req(`/api/trips/${TRIP}/itinerary`, auth, { method: 'POST' }), TRIP)],
  ...(['get', 'put'] as const).map((method): [string, number, Call] => [`${method.toUpperCase()} /api/trips/[id]/constraints`, 200,
    (userId, auth) => constraintHandlers({ userId, findOwner, service: () => ({
      load: async () => ({ input: sampleTrip(), revision: 'r', places: {} }), loadRevision: assert.fail,
      save: async () => ({ input: sampleTrip(), revision: 'r2' }) }) })
      [method](req(`/api/trips/${TRIP}/constraints`, auth, method === 'put' ? { method: 'PUT', body: '{}' } : {}), TRIP)]),
  ['POST /api/trips/[id]/share', 200, (userId, auth) => sharingHandlers({ userId, findOwner,
    service: () => ({ read: async () => null, rotate: async () => 'a'.repeat(43) }) })
    .rotate(req(`/api/trips/${TRIP}/share`, auth, { method: 'POST' }), TRIP)],
  ...(['GET', 'PUT'] as const).map((method): [string, number, Call] => [`${method} /api/trips/[id]/settings`, 200,
    (userId, auth) => {
      // Mirrors LivingSettingsRepository: the owner check happens with the authenticated user ID.
      const check = async (id: string, owner: string) => { if (owner !== OWNER) throw new SettingsError(403, '접근할 수 없습니다.'); return { id } as never; };
      return settingsHandlers({ userId, service: { load: check, save: check } })(
        req(`/api/trips/${TRIP}/settings`, auth, method === 'PUT' ? { method, body: '{}' } : {}), TRIP);
    }]),
];

/** Signed-in-only endpoints without a trip owner. */
const signedIn: [string, number, Call][] = [
  ['POST /api/trips', 201, (userId, auth) => tripHandlers({ userId, create: async owner => { assert.ok([OWNER, INTRUDER].includes(owner)); return 'trip-new'; }, profile: async () => null })
    .create(req('/api/trips', auth, { method: 'POST', body: JSON.stringify(tripDraft) }))],
  ['GET /api/city-profiles', 200, (userId, auth) => tripHandlers({ userId, create: async () => '', profile: async () => null })
    .profile(req('/api/city-profiles?cityCode=TOKYO', auth))],
  ['GET /api/places', 200, (userId, auth) => placeHandlers({ userId, provider: () => places })
    .search(req('/api/places?query=tower', auth))],
  ['GET /api/places/[id]', 200, (userId, auth) => placeHandlers({ userId, provider: () => places })
    .details(req('/api/places/sample-tokyo-tower?fields=location', auth), 'sample-tokyo-tower')],
];

async function expectError(response: Response, status: number, code: string, name: string) {
  assert.equal(response.status, status, name);
  const body = await response.json() as { code: unknown };
  assert.equal(body.code, code, name);
  assert.ok(isApiErrorCode(body.code), name);
}

test('Bearer owner reaches each ownership-checked API; another user is 403 FORBIDDEN', async () => {
  const s = await sessions();
  const userId = (request: Request) => s.authenticator.userId(request);
  for (const [name, success, call] of owned) {
    assert.equal((await call(userId, `Bearer ${s.owner}`)).status, success, `${name} owner`);
    await expectError(await call(userId, `Bearer ${s.intruder}`), 403, 'FORBIDDEN', `${name} other user`);
  }
  assert.equal(s.cookieReads(), 0);
});

test('every user API answers 401 UNAUTHENTICATED for malformed, unknown, expired and revoked Bearer tokens', async () => {
  const s = await sessions();
  const userId = (request: Request) => s.authenticator.userId(request);
  const bad = { malformed: 'Bearer not-a-session', unknown: `Bearer ${'z'.repeat(43)}`, expired: `Bearer ${s.expired}`,
    revoked: `Bearer ${s.revoked}`, scheme: `Basic ${s.owner}`, empty: 'Bearer ' };
  for (const [name, success, call] of [...owned, ...signedIn]) {
    for (const [kind, header] of Object.entries(bad)) await expectError(await call(userId, header), 401, 'UNAUTHENTICATED', `${name} ${kind}`);
    if (!owned.some(([owned]) => owned === name)) assert.equal((await call(userId, `Bearer ${s.intruder}`)).status, success, name);
  }
  assert.equal(s.cookieReads(), 0, 'a rejected Bearer header never falls back to the cookie session');
});
