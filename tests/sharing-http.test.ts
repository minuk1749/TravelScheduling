import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sharingHandlers } from '../src/sharing/http';
import { SharingService, hashShareToken } from '../src/services/sharing';
import { PlaceProviderError } from '../src/places';
import { ShareUnavailableError } from '../src/sharing/model';
import { constraintHandlers } from '../src/results/http';
import { itineraryHandlers } from '../src/itineraries/http';
import { settingsHandlers } from '../src/settings/http';
import { FixturePlaces } from './fixtures/itinerary';
import { MemoryShares, sharedSnapshot } from './helpers/sharing';

const origin = 'https://app.example.test';
const issue = () => new Request(`${origin}/api/trips/trip/share`, { method: 'POST' });

test('T14 anonymous read, random hashed tokens, rotation invalidates old link and response excludes private inputs', async () => {
  const repo = new MemoryShares(await sharedSnapshot()), places = new FixturePlaces();
  const service = new SharingService(repo, () => places);
  const first = await service.rotate('trip', 'owner'); assert.ok(first);
  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(await repo.load(first), null, 'raw token is not stored');
  assert.ok(await repo.load(hashShareToken(first)));
  const handlers = sharingHandlers({ userId: async () => assert.fail('public read must not use session'),
    findOwner: async () => assert.fail('not an owner read'), service: () => service });
  const response = await handlers.read(new Request(`${origin}/api/share/${first}`), first);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
  const body = await response.json();
  assert.equal(body.result.status, 'OK');
  assert.equal(body.view.input.timeZone, 'Asia/Tokyo');
  // T15A: the repository returns full inputs; the service narrows them to the display fields.
  assert.deepEqual(Object.keys(body.view.input).sort(), ['endDate', 'startDate', 'timeZone', 'visits']);
  for (const visit of body.view.input.visits) assert.deepEqual(Object.keys(visit).sort(), ['id', 'place', 'priority']);
  const { input } = await sharedSnapshot();
  assert.deepEqual(Object.keys(body.view.places).sort(),
    [...new Set([...input.visits.map(v => v.place.id), ...input.flights.map(f => f.airport.id), ...input.lodgings.map(l => l.place.id)])].sort());
  assert.ok(body.result.comparisons.length && body.result.efficiency);
  assert.doesNotMatch(JSON.stringify(body), /ownerId|email|revision|share_token|inputHash|mealWindows|localDateTime/);
  assert.equal(places.detailCalls.length, new Set(places.detailCalls).size);
  const second = await service.rotate('trip', 'owner'); assert.ok(second && second !== first);
  assert.equal((await handlers.read(new Request(origin), first)).status, 404);
  assert.equal((await handlers.read(new Request(origin), second)).status, 200);
  const calls = places.detailCalls.length;
  for (const token of ['', 'invalid', 'a'.repeat(43)]) assert.equal((await handlers.read(new Request(origin), token)).status, 404);
  assert.equal(places.detailCalls.length, calls, 'invalid tokens never reach providers');
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.equal((await handlers.read(new Request(origin, { method }), second)).status, 405);
  }
});

test('T14 issuing/rotating requires ownership, guards cross-origin, does not invoke unauthorized service', async () => {
  for (const [user, owner, status] of [[undefined, 'owner', 401], ['visitor', 'owner', 403], ['owner', null, 404], ['owner', 'owner', 200]] as const) {
    let calls = 0;
    const handlers = sharingHandlers({ userId: async () => user, findOwner: async () => owner,
      service: () => { calls++; return { read: async () => null, rotate: async (id, actor) => { assert.equal(id, 'trip'); assert.equal(actor, 'owner'); return 'a'.repeat(43); } }; } });
    assert.equal((await handlers.rotate(issue(), 'trip')).status, status);
    assert.equal(calls, status === 200 ? 1 : 0);
  }
  const handlers = sharingHandlers({ userId: async () => assert.fail('unauthorized'), findOwner: async () => null, service: () => assert.fail('unauthorized') });
  for (const headers of [new Headers({ origin: 'https://evil.test' }), new Headers({ 'sec-fetch-site': 'cross-site' })]) {
    assert.equal((await handlers.rotate(new Request(issue(), { headers }), 'trip')).status, 403);
  }
  assert.equal((await handlers.rotate(new Request(origin), 'trip')).status, 405);
});

test('T14 bearer share token never authorizes existing modification APIs', async () => {
  const token = 'a'.repeat(43), userId = async () => undefined, fail = () => assert.fail('write service must not run');
  const auth = { userId, findOwner: async () => assert.fail('anonymous'), service: fail };
  const request = (path: string, method: string) => new Request(`${origin}/api/trips/trip/${path}?shareToken=${token}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ token }),
  });
  assert.equal((await constraintHandlers(auth).put(request('constraints', 'PUT'), 'trip')).status, 401);
  assert.equal((await itineraryHandlers({ ...auth, generator: fail }).generate(request('itinerary', 'POST'), 'trip')).status, 401);
  assert.equal((await settingsHandlers({ userId, service: { load: fail, save: fail } })(request('settings', 'PUT'), 'trip')).status, 401);
  assert.equal((await sharingHandlers(auth).rotate(request('share', 'POST'), 'trip')).status, 401);
});

test('T14 rotation during metadata fetch suppresses the old response; missing schedule and errors are safe', async () => {
  const repo = new MemoryShares(await sharedSnapshot());
  const places = new FixturePlaces();
  const service = new SharingService(repo, () => ({ details: async request => {
    await repo.rotate('trip', 'owner', 'new-hash'); return places.details(request);
  } }));
  const token = await service.rotate('trip', 'owner'); assert.ok(token);
  assert.equal(await service.read(token), null);
  assert.equal(await service.rotate('trip', 'visitor'), null);
  const unavailable = new SharingService(new MemoryShares('UNAVAILABLE'), () => assert.fail('no schedule'));
  const pending = await unavailable.rotate('trip', 'owner'); assert.ok(pending);
  await assert.rejects(unavailable.read(pending), ShareUnavailableError);
  for (const [error, status] of [[new ShareUnavailableError(), 409], [new PlaceProviderError('UNAVAILABLE'), 503], [new PlaceProviderError('INVALID_RESPONSE'), 502], [new Error('secret SQL'), 500]] as const) {
    const handlers = sharingHandlers({ userId: async () => undefined, findOwner: async () => null,
      service: () => ({ rotate: async () => null, read: async () => { throw error; } }) });
    const response = await handlers.read(new Request(origin), 'a'.repeat(43));
    assert.equal(response.status, status); assert.doesNotMatch(await response.text(), /secret SQL/);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
  }
});
