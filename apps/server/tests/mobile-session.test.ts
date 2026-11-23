import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLocalJWKSet } from 'jose';
import { GoogleKeysUnavailableError, JoseGoogleIdTokenVerifier, mobileClientIds } from '../src/lib/auth/google-id-token';
import { MobileSessionService, SESSION_LIFETIME_DAYS } from '../src/lib/auth/mobile-sessions';
import { readBearer, SessionRequestAuthenticator } from '../src/lib/auth/request-authenticator';
import { hashOpaqueToken } from '../src/lib/opaque-token';
import { accountHandlers, sessionHandlers } from '../src/sessions/http';
import { ANDROID_CLIENT, fixtureJwks, googleIdToken, googleJwks, IOS_CLIENT, MemorySessionStore } from './helpers/google-id-tokens';

// T18: Google ID token → opaque session token, Bearer authentication, logout and withdrawal.
const audiences = [IOS_CLIENT, ANDROID_CLIENT];
const verifier = () => new JoseGoogleIdTokenVerifier(audiences, fixtureJwks().keys);
const users = () => {
  const ids = new Map<string, string>();
  return { ids, upsertGoogleUser: async (googleId: string) => { if (!ids.has(googleId)) ids.set(googleId, `user-${ids.size + 1}`); return ids.get(googleId)!; } };
};
const login = (body: unknown, headers: Record<string, string> = { 'content-type': 'application/json' }) =>
  new Request('https://api.example.test/api/session', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
const withBearer = (path: string, method: string, authorization?: string) =>
  new Request(`https://api.example.test${path}`, { method, headers: authorization === undefined ? {} : { authorization } });

test('verifier accepts Google-signed tokens for each configured mobile client and either Google issuer', async () => {
  const check = verifier();
  for (const claims of [{}, { aud: ANDROID_CLIENT }, { iss: 'accounts.google.com' }]) {
    assert.deepEqual(await check.verify(await googleIdToken({ claims })), { googleId: 'google-user-1', email: 'traveler@example.test' });
  }
  // Within the 60-second clock tolerance.
  assert.ok(await check.verify(await googleIdToken({ expiresIn: -30 })));
});

test('verifier rejects bad signature, issuer, audience, expiry, unverified email and malformed tokens as invalid (null)', async () => {
  const check = verifier();
  const now = Math.floor(Date.now() / 1000);
  const invalid: [string, Promise<string> | string][] = [
    ['signature from a key Google did not publish', googleIdToken({ signer: 'stranger' })],
    ['unknown key id', googleIdToken({ signer: 'stranger', kid: 'other-key' })],
    ['foreign issuer', googleIdToken({ claims: { iss: 'https://evil.example.test' } })],
    ['web/other client audience', googleIdToken({ claims: { aud: 'someone-else.apps.googleusercontent.com' } })],
    ['expired beyond tolerance', googleIdToken({ expiresIn: -120 })],
    ['missing exp', googleIdToken({ claims: { exp: undefined } })],
    ['not yet valid', googleIdToken({ claims: { nbf: now + 600 } })],
    ['email not verified', googleIdToken({ claims: { email_verified: false } })],
    ['email verification as a string', googleIdToken({ claims: { email_verified: 'true' } })],
    ['missing email', googleIdToken({ claims: { email: undefined } })],
    ['tampered payload', googleIdToken().then(token => {
      const [header, , signature] = token.split('.');
      const payload = Buffer.from(JSON.stringify({ iss: 'https://accounts.google.com', aud: IOS_CLIENT, sub: 'attacker', email: 'a@example.test', email_verified: true, exp: now + 3600 })).toString('base64url');
      return `${header}.${payload}.${signature}`;
    })],
    ['unsigned token', `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify({ iss: 'https://accounts.google.com', aud: IOS_CLIENT, sub: 's', email: 'e@example.test', email_verified: true, exp: now + 3600 })).toString('base64url')}.`],
    ['not a JWT', 'not-a-token'],
  ];
  for (const [name, token] of invalid) assert.equal(await check.verify(await token), null, name);
});

test('verifier rejects everything when no mobile client ID is configured and parses the client ID list', async () => {
  assert.deepEqual(mobileClientIds(` ${IOS_CLIENT}, ,${ANDROID_CLIENT} `), audiences);
  assert.deepEqual(mobileClientIds(undefined), []);
  assert.equal(await new JoseGoogleIdTokenVerifier([], fixtureJwks().keys).verify(await googleIdToken()), null);
});

test('verifier reports JWKS outages (network error, non-200, bad JSON) as provider errors, not invalid tokens', async () => {
  const outages: (() => Promise<Response>)[] = [
    async () => { throw new TypeError('fetch failed'); },
    async () => new Response('busy', { status: 503 }),
    async () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }),
  ];
  for (const respond of outages) {
    const jwks = fixtureJwks(respond);
    await assert.rejects(new JoseGoogleIdTokenVerifier(audiences, jwks.keys).verify(await googleIdToken()), GoogleKeysUnavailableError);
    assert.deepEqual(jwks.requests, ['https://www.googleapis.com/oauth2/v3/certs']);
  }
  const local = new JoseGoogleIdTokenVerifier(audiences, createLocalJWKSet(await googleJwks()));
  assert.ok(await local.verify(await googleIdToken()));
});

test('POST /api/session issues a 43-char opaque token with a fixed 30-day expiry and stores only its hash', async () => {
  const store = new MemorySessionStore();
  const accounts = users();
  const now = new Date('2026-11-19T00:00:00.000Z');
  const handlers = sessionHandlers({ service: () => new MobileSessionService(verifier(), store, accounts, () => now) });
  const response = await handlers.create(login({ idToken: await googleIdToken() }));
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  const body = await response.json() as { token: string; expiresAt: string };
  assert.deepEqual(Object.keys(body).sort(), ['expiresAt', 'token']);
  assert.match(body.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(body.expiresAt, new Date(now.getTime() + SESSION_LIFETIME_DAYS * 86_400_000).toISOString());
  assert.equal(body.expiresAt, '2026-12-19T00:00:00.000Z');
  assert.deepEqual([...store.rows.keys()], [hashOpaqueToken(body.token)]);
  assert.ok(![...store.rows.keys()].includes(body.token));
  assert.equal(store.rows.get(hashOpaqueToken(body.token))?.userId, 'user-1');
  // The same Google account maps to the same user; each login is a new, distinct session.
  const second = await (await handlers.create(login({ idToken: await googleIdToken() }))).json() as { token: string };
  assert.notEqual(second.token, body.token);
  assert.equal(store.rows.get(hashOpaqueToken(second.token))?.userId, 'user-1');
});

test('POST /api/session maps input, token and provider failures to the documented statuses and codes', async () => {
  const handlers = (service: Partial<MobileSessionService> = new MobileSessionService(verifier(), new MemorySessionStore(), users())) =>
    sessionHandlers({ service: () => service as MobileSessionService });
  const expect = async (response: Response, status: number, code: string) => {
    assert.equal(response.status, status, code);
    const body = await response.json() as { code: string; error: string };
    assert.equal(body.code, code);
    assert.equal(typeof body.error, 'string');
    assert.doesNotMatch(JSON.stringify(body), /secret|stack|jwks/i);
  };
  await expect(await handlers().create(login({ idToken: 'x' }, { 'content-type': 'text/plain' })), 415, 'UNSUPPORTED_MEDIA_TYPE');
  await expect(await handlers().create(login({ idToken: 'x'.repeat(20_000) })), 413, 'PAYLOAD_TOO_LARGE');
  await expect(await handlers().create(login('{')), 400, 'INVALID_JSON');
  for (const body of [{}, { idToken: '' }, { idToken: 42 }, [], null, { idToken: 'x'.repeat(8_193) }]) {
    await expect(await handlers().create(login(body)), 400, 'INVALID_INPUT');
  }
  await expect(await handlers().create(login({ idToken: await googleIdToken({ expiresIn: -3600 }) })), 401, 'INVALID_GOOGLE_TOKEN');
  await expect(await handlers().create(login({ idToken: await googleIdToken({ signer: 'stranger' }) })), 401, 'INVALID_GOOGLE_TOKEN');
  const down = new MobileSessionService(new JoseGoogleIdTokenVerifier(audiences, fixtureJwks(async () => new Response('', { status: 500 })).keys), new MemorySessionStore(), users());
  await expect(await handlers(down).create(login({ idToken: await googleIdToken() })), 503, 'PROVIDER_UNAVAILABLE');
  await expect(await handlers({ signIn: async () => { throw new Error('secret SQL'); } }).create(login({ idToken: 'token' })), 500, 'INTERNAL');
});

test('Bearer authenticator: valid → user; malformed, unknown, expired, revoked and missing → unauthenticated', async () => {
  const store = new MemorySessionStore();
  const service = new MobileSessionService(verifier(), store, users());
  const authenticator = new SessionRequestAuthenticator(store);
  const { token } = (await service.signIn(await googleIdToken()))!;
  const request = (authorization?: string) => withBearer('/api/trips', 'GET', authorization);

  assert.equal(await authenticator.userId(request(`Bearer ${token}`)), 'user-1');
  assert.equal(await authenticator.userId(request(`bearer  ${token}`)), 'user-1');
  for (const header of ['', 'Bearer', `Basic ${token}`, `Bearer ${token}x`, `Bearer ${token} extra`, 'Bearer ' + 'a'.repeat(43)]) {
    assert.equal(await authenticator.userId(request(header)), undefined, header);
  }
  store.now = () => new Date(Date.now() + 31 * 86_400_000);
  assert.equal(await authenticator.userId(request(`Bearer ${token}`)), undefined, 'expired');
  store.now = () => new Date();
  await service.signOut(token);
  assert.equal(await authenticator.userId(request(`Bearer ${token}`)), undefined, 'revoked');
  assert.equal(await authenticator.userId(request()), undefined, 'no Authorization header (T25: no cookie session)');
  assert.deepEqual(readBearer(request()), { kind: 'NONE' });
});

test('DELETE /api/session revokes only that token, is idempotent, and requires a well-formed Bearer header', async () => {
  const store = new MemorySessionStore();
  const service = new MobileSessionService(verifier(), store, users());
  const handlers = sessionHandlers({ service: () => service });
  const first = (await service.signIn(await googleIdToken()))!;
  const second = (await service.signIn(await googleIdToken()))!;
  const logout = (authorization?: string) => handlers.delete(withBearer('/api/session', 'DELETE', authorization));
  const response = await logout(`Bearer ${first.token}`);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(await store.userIdFor(hashOpaqueToken(first.token)), null);
  assert.equal(await store.userIdFor(hashOpaqueToken(second.token)), 'user-1', 'other devices stay signed in');
  assert.equal((await logout(`Bearer ${first.token}`)).status, 204, 'already revoked');
  for (const header of [undefined, 'Bearer short', 'Basic abc']) {
    const failure = await logout(header);
    assert.equal(failure.status, 401);
    assert.equal((await failure.json()).code, 'UNAUTHENTICATED');
  }
  const broken = sessionHandlers({ service: () => ({ signIn: async () => null, signOut: async () => { throw new Error('secret'); } }) });
  const failure = await broken.delete(withBearer('/api/session', 'DELETE', `Bearer ${second.token}`));
  assert.equal(failure.status, 500);
  assert.equal((await failure.json()).code, 'INTERNAL');
});

test('DELETE /api/account deletes the Bearer user; invalid tokens are 401 and never delete', async () => {
  const store = new MemorySessionStore();
  const service = new MobileSessionService(verifier(), store, users());
  const deleted: string[] = [];
  const handlers = accountHandlers({ authenticator: new SessionRequestAuthenticator(store), deleteUser: async id => { deleted.push(id); } });
  const { token } = (await service.signIn(await googleIdToken()))!;
  for (const header of [undefined, 'Bearer ' + 'b'.repeat(43), 'Bearer nope']) {
    const response = await handlers.delete(withBearer('/api/account', 'DELETE', header));
    assert.equal(response.status, 401);
    assert.equal((await response.json()).code, 'UNAUTHENTICATED');
  }
  assert.deepEqual(deleted, []);
  const response = await handlers.delete(withBearer('/api/account', 'DELETE', `Bearer ${token}`));
  assert.equal(response.status, 204);
  assert.deepEqual(deleted, ['user-1']);
  const failing = accountHandlers({ authenticator: new SessionRequestAuthenticator(store), deleteUser: async () => { throw new Error('secret SQL'); } });
  const failure = await failing.delete(withBearer('/api/account', 'DELETE', `Bearer ${token}`));
  assert.equal(failure.status, 500);
  assert.doesNotMatch(await failure.text(), /secret|SQL/);
});
