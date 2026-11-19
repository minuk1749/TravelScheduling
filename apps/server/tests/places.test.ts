import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CachedPlaceProvider } from '../src/places/cache';
import { DETAIL_FIELDS, GooglePlaceProvider, LOCATION_FIELDS, SEARCH_FIELDS } from '../src/places/google';
import { placeHandlers } from '../src/places/http';
import { PlaceProviderError, type PlaceDetailsRequest } from '../src/places';
import { openingWindows } from '../src/places/opening-hours';
import { detailsRequest, placeId, searchRequest } from '../src/places/validation';
import { koreanPlace } from './fixtures/places';

const epoch = Date.parse('2026-11-18T00:00:00Z');
const details: PlaceDetailsRequest = {
  googlePlaceId: koreanPlace.id, language: 'ko', dates: ['2026-11-23'], timeZone: 'Asia/Tokyo',
};
function setup() {
  const calls: { url: string; init?: RequestInit }[] = [];
  let body: unknown = koreanPlace, status = 200, now = epoch;
  const fetcher: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json(body, { status });
  };
  const google = new GooglePlaceProvider('fixture-secret', fetcher, () => now);
  const cache = new CachedPlaceProvider(google, () => now, 1000, 2);
  const handlers = placeHandlers({ userId: async () => 'user', provider: () => cache });
  return {
    calls, google, cache, handlers,
    reply: (value: unknown, code = 200) => { body = value; status = code; },
    advance: (ms: number) => { now += ms; },
  };
}

test('T8 Korean search passes normalized Korean query and region to Google through authenticated proxy', async () => {
  const s = setup();
  s.reply({ places: [koreanPlace, { ...koreanPlace, id: 'local', displayName: { text: '東京' } }] });
  const response = await s.handlers.search(new Request('https://app.test/api/places?query=%20도쿄%20%20전망대%20&regionCode=jp'));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { places: [
    { googlePlaceId: koreanPlace.id, name: '도쿄 전망대', attributions: koreanPlace.attributions },
    { googlePlaceId: 'local', name: '東京', attributions: koreanPlace.attributions },
  ], attribution: 'Google Maps' });
  assert.equal(s.calls[0].url, 'https://places.googleapis.com/v1/places:searchText');
  assert.deepEqual(JSON.parse(s.calls[0].init!.body as string), {
    textQuery: '도쿄 전망대', languageCode: 'ko', regionCode: 'JP', pageSize: 20,
  });
  const headers = new Headers(s.calls[0].init!.headers);
  assert.equal(headers.get('X-Goog-FieldMask'), SEARCH_FIELDS);
  assert.equal(headers.get('X-Goog-Api-Key'), 'fixture-secret');
  assert.equal(s.calls[0].init!.cache, 'no-store');
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  s.reply({});
  assert.deepEqual(await s.google.search({ query: '없는 장소', language: 'ko' }), []);
});

test('T8 same place location within TTL makes zero additional external calls, then refreshes at expiry', async () => {
  const s = setup();
  const request = new Request('https://app.test/api/places/fixture-tower?fields=location');
  try {
    const first = await (await s.handlers.details(request, koreanPlace.id)).json();
    assert.equal(s.calls.length, 1);
    s.advance(999);
    assert.deepEqual(await (await s.handlers.details(request, koreanPlace.id)).json(), first);
    assert.equal(s.calls.length, 1, 'cache hit must not call Google');
    assert.equal(new Headers(s.calls[0].init!.headers).get('X-Goog-FieldMask'), LOCATION_FIELDS);
    assert.deepEqual(Object.keys(first.place).sort(), ['cacheExpiresAt', 'coordinates', 'googlePlaceId']);
    s.advance(1);
    await s.handlers.details(request, koreanPlace.id);
    assert.equal(s.calls.length, 2, 'expiry boundary is a miss');
    s.reply({ ...koreanPlace, id: 'other' });
    await s.cache.location('other');
    assert.equal(s.calls.length, 3, 'different place must not reuse coordinates');
  } finally { s.cache.dispose(); }
});

test('simultaneous location requests share one call, results are isolated, and failures are retried', async () => {
  const s = setup();
  try {
    const [a, b] = await Promise.all([s.cache.location(koreanPlace.id), s.cache.location(koreanPlace.id)]);
    assert.equal(s.calls.length, 1);
    a!.coordinates.latitude = 0;
    assert.equal(b!.coordinates.latitude, koreanPlace.location.latitude);
    assert.equal((await s.cache.location(koreanPlace.id))!.coordinates.latitude, koreanPlace.location.latitude);
    s.advance(1000);
    s.reply({ error: { message: 'fixture-secret' } }, 429);
    await assert.rejects(s.cache.location(koreanPlace.id), PlaceProviderError);
    s.reply(koreanPlace);
    await s.cache.location(koreanPlace.id);
    assert.equal(s.calls.length, 3);
  } finally { s.cache.dispose(); }
});

test('coordinate cache is bounded and actively deletes idle expired entries', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: epoch });
  const s = setup();
  const cache = new CachedPlaceProvider(s.google, Date.now, 1000, 1);
  try {
    await cache.location(koreanPlace.id);
    s.reply({ ...koreanPlace, id: 'other' });
    await cache.location('other');
    s.reply(koreanPlace);
    await cache.location(koreanPlace.id);
    assert.equal(s.calls.length, 3, 'capacity evicts oldest entry');
    t.mock.timers.tick(1000);
    // Rewind the injected clock: only active timer deletion, not read-time expiry, can cause this miss.
    t.mock.timers.setTime(epoch);
    await cache.location(koreanPlace.id);
    assert.equal(s.calls.length, 4);
  } finally { cache.dispose(); }
  assert.throws(() => new CachedPlaceProvider(s.google, Date.now, 30 * 86_400_000), RangeError);
});

test('full details and search content are never cached; details preserve Korean name, types, attribution and hours', async () => {
  const s = setup();
  const result = await s.cache.details(details);
  assert.equal(result!.name, '도쿄 전망대');
  assert.deepEqual(result!.types, koreanPlace.types);
  assert.deepEqual(result!.attributions, koreanPlace.attributions);
  assert.deepEqual(result!.openingHours, [{ start: '2026-11-23T00:00:00.000Z', end: '2026-11-23T09:00:00.000Z' }]);
  assert.equal(Date.parse(result!.cacheExpiresAt), epoch);
  assert.match(s.calls[0].url, /languageCode=ko$/);
  assert.equal(new Headers(s.calls[0].init!.headers).get('X-Goog-FieldMask'), DETAIL_FIELDS);
  await s.cache.details(details);
  assert.equal(s.calls.length, 2);
  const nextDay = await s.cache.details({ ...details, dates: ['2026-11-24'] });
  assert.deepEqual(nextDay!.openingHours, [], 'closed is distinct from unknown');
  s.reply({ ...koreanPlace, regularOpeningHours: undefined });
  assert.equal((await s.cache.details(details))!.openingHours, undefined);
  s.reply({ ...koreanPlace, businessStatus: 'CLOSED_TEMPORARILY' });
  assert.deepEqual((await s.cache.details(details))!.openingHours, []);
  s.reply({ places: [koreanPlace] });
  await s.cache.search({ query: '도쿄', language: 'ko' });
  await s.cache.search({ query: '도쿄', language: 'ko' });
  assert.equal(s.calls.length, 7);
  s.cache.dispose();
});

test('detail response seeds only coordinates for subsequent routing queries', async () => {
  const s = setup();
  try {
    await s.cache.details(details);
    const location = await s.cache.location(koreanPlace.id);
    assert.equal(s.calls.length, 1);
    assert.deepEqual(location, {
      googlePlaceId: koreanPlace.id, coordinates: koreanPlace.location,
      cacheExpiresAt: new Date(epoch + 1000).toISOString(),
    });
  } finally { s.cache.dispose(); }
});

test('weekly hours handle overnight week rollover, unknown/closed, 24h and DST without host time zone', () => {
  assert.deepEqual(openingWindows(koreanPlace.regularOpeningHours, ['2026-11-21', '2026-11-22'], 'Asia/Tokyo'), [
    { start: '2026-11-21T13:00:00.000Z', end: '2026-11-21T17:00:00.000Z' },
  ]);
  assert.equal(openingWindows(undefined, details.dates, details.timeZone), undefined);
  assert.equal(openingWindows({}, details.dates, details.timeZone), undefined);
  assert.deepEqual(openingWindows({ periods: [] }, details.dates, details.timeZone), []);
  assert.deepEqual(openingWindows({ periods: [{ open: {} }] }, ['2026-03-08'], 'America/New_York'), [
    { start: '2026-03-08T05:00:00.000Z', end: '2026-03-09T04:00:00.000Z' },
  ]);
  assert.deepEqual(openingWindows({ periods: [{ open: { day: 1, hour: 18 }, close: { day: 1, hour: 10 } }] },
    ['2026-11-23'], 'Asia/Tokyo'), [
    { start: '2026-11-22T15:00:00.000Z', end: '2026-11-23T01:00:00.000Z' },
    { start: '2026-11-23T09:00:00.000Z', end: '2026-11-23T15:00:00.000Z' },
  ]);
  assert.throws(() => openingWindows({ periods: [{ open: { day: 0, hour: 2, minute: 30 }, close: { day: 0, hour: 4 } }] },
    ['2026-03-08'], 'America/New_York'), PlaceProviderError);
  assert.throws(() => openingWindows({ periods: [{ open: { day: 9 } }] }, details.dates, details.timeZone), PlaceProviderError);
});

test('authentication and invalid input prevent paid calls; validation keeps time zone and date contracts', async () => {
  const s = setup();
  const anonymous = placeHandlers({ userId: async () => undefined, provider: () => { throw new Error('must not create provider'); } });
  assert.equal((await anonymous.search(new Request('https://app.test/api/places?query=도쿄'))).status, 401);
  assert.equal((await anonymous.details(new Request('https://app.test/api/places/id?fields=location'), 'id')).status, 401);
  for (const query of ['', '?query=%20', '?query=a&regionCode=Japan', `?query=${'a'.repeat(201)}`]) {
    assert.equal((await s.handlers.search(new Request(`https://app.test/api/places${query}`))).status, 400);
  }
  for (const query of ['', '?timeZone=Nope', '?timeZone=Asia/Tokyo&date=2026-02-30', '?fields=*']) {
    assert.equal((await s.handlers.details(new Request(`https://app.test/api/places/id${query}`), 'id')).status, 400);
  }
  assert.equal(s.calls.length, 0);
  assert.throws(() => placeId('../bad?key=x'));
  assert.throws(() => searchRequest({ query: '도쿄', language: 'en' as 'ko' }));
  assert.throws(() => detailsRequest({ ...details, timeZone: '+09:00' }));
  assert.throws(() => detailsRequest({ ...details, dates: Array(32).fill('2026-11-23') }));
  assert.deepEqual(detailsRequest({ ...details, dates: ['2026-11-24', '2026-11-23', '2026-11-23'] }).dates,
    ['2026-11-23', '2026-11-24']);
});

test('upstream errors are sanitized, malformed data is 502, absence is 404 and failures are not cached', async () => {
  const s = setup();
  const request = new Request('https://app.test/api/places/id?fields=location');
  for (const status of [401, 403, 429, 500, 503]) {
    s.reply({ error: { message: 'fixture-secret' } }, status);
    const response = await s.handlers.details(request, koreanPlace.id);
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /fixture-secret/);
  }
  for (const body of [{ id: 'different', location: {} }, { id: koreanPlace.id, location: { latitude: 91 } }, null]) {
    s.reply(body);
    assert.equal((await s.handlers.details(request, koreanPlace.id)).status, 502);
  }
  s.reply({}, 404);
  assert.equal((await s.handlers.details(request, koreanPlace.id)).status, 404);
  assert.equal(await s.google.details(details), null);
  s.reply(koreanPlace);
  assert.equal((await s.handlers.details(request, koreanPlace.id)).status, 200);
  s.cache.dispose();
  const broken = new GooglePlaceProvider('fixture-secret', async () => { throw new Error('fixture-secret'); });
  await assert.rejects(broken.location('id'), error => error instanceof PlaceProviderError && !error.message.includes('fixture-secret'));
  const malformed = new GooglePlaceProvider('fixture-secret', async () => new Response('{'));
  await assert.rejects(malformed.location('id'), error => error instanceof PlaceProviderError && error.kind === 'INVALID_RESPONSE');
  const noKey = new GooglePlaceProvider('', async () => { throw new Error('must not call'); });
  await assert.rejects(noKey.location('id'), PlaceProviderError);
  const failure = placeHandlers({ userId: async () => { throw new Error('SQL secret'); }, provider: () => s.cache });
  const response = await failure.search(new Request('https://app.test/api/places?query=도쿄'));
  assert.equal(response.status, 500);
  assert.doesNotMatch(await response.text(), /SQL secret/);
});
