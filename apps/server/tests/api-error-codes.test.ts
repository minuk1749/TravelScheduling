import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isApiErrorCode } from '@travel/core/contracts/errors';
import { PlaceInputError, PlaceProviderError, type PlaceProvider } from '../src/places';
import { placeHandlers } from '../src/places/http';
import { constraintHandlers } from '../src/results/http';
import { ResultStaleError, ResultUnavailableError } from '../src/services/itinerary/editing';
import { settingsHandlers } from '../src/settings/http';
import { SettingsError } from '../src/settings/model';
import { sharingHandlers } from '../src/sharing/http';
import { ShareUnavailableError } from '../src/sharing/model';
import { TripInputError } from '../src/trips/input';
import { tripHandlers } from '../src/trips/http';

// T18: `code` lets the app tell apart failures that share a status (docs/architecture.md §13.2).
const user = async () => 'owner';
const owner = async () => 'owner';
const url = 'https://api.example.test';
const json = (path: string, method: string, body: string, headers: Record<string, string> = { 'content-type': 'application/json' }) =>
  new Request(`${url}${path}`, { method, headers, body });

async function expectCode(response: Response, status: number, code: string, name: string) {
  assert.equal(response.status, status, name);
  const body = await response.json() as { code: unknown; error: unknown };
  assert.equal(body.code, code, name);
  assert.ok(isApiErrorCode(body.code), name);
  assert.equal(typeof body.error, 'string', name);
}

test('constraints: stale, missing result, validation, JSON, provider and internal codes', async () => {
  const failing = (error: unknown) => constraintHandlers({ userId: user, findOwner: owner,
    service: () => ({ load: async () => { throw error; }, save: async () => { throw error; } }) });
  const put = (error: unknown, body = '{}') => failing(error).put(json('/api/trips/t/constraints', 'PUT', body), 't');
  await expectCode(await put(new ResultStaleError()), 409, 'STALE_INPUT', 'stale');
  await expectCode(await put(new ResultUnavailableError()), 409, 'RESULT_UNAVAILABLE', 'unavailable');
  await expectCode(await put(new TripInputError({ visits: '확인' })), 400, 'INVALID_INPUT', 'input');
  await expectCode(await put(null, '{'), 400, 'INVALID_JSON', 'json');
  await expectCode(await put(new PlaceProviderError('UNAVAILABLE')), 503, 'PROVIDER_UNAVAILABLE', 'outage');
  await expectCode(await put(new PlaceProviderError('INVALID_RESPONSE')), 502, 'PROVIDER_INVALID_RESPONSE', 'bad provider');
  await expectCode(await put(new Error('secret')), 500, 'INTERNAL', 'internal');
  await expectCode(await failing(null).put(new Request(`${url}/x`, { method: 'PUT', body: '{}', headers: { origin: 'https://evil.test' } }), 't'), 403, 'FORBIDDEN', 'origin');
  await expectCode(await constraintHandlers({ userId: user, findOwner: async () => null, service: () => assert.fail() }).get(new Request(url), 't'), 404, 'NOT_FOUND', 'missing trip');
});

test('settings: a concurrent edit is STALE_INPUT while an unreadable trip stays INCOMPLETE_TRIP', async () => {
  const handle = (error: unknown) => settingsHandlers({ userId: user, service: { load: async () => { throw error; }, save: async () => { throw error; } } });
  const put = (error: unknown, request = json('/api/trips/t/settings', 'PUT', '{}')) => handle(error)(request, 't');
  await expectCode(await put(new SettingsError(409, '변경 충돌', 'STALE_INPUT')), 409, 'STALE_INPUT', 'stale');
  await expectCode(await handle(new SettingsError(409, '여행 기본 정보'))(new Request(`${url}/s`), 't'), 409, 'INCOMPLETE_TRIP', 'incomplete');
  await expectCode(await handle(new SettingsError(404, '없음'))(new Request(`${url}/s`), 't'), 404, 'NOT_FOUND', 'missing');
  await expectCode(await put(null, json('/s', 'DELETE', '{}')), 405, 'METHOD_NOT_ALLOWED', 'method');
  await expectCode(await put(null, json('/s', 'PUT', '{}', { 'content-type': 'text/plain' })), 415, 'UNSUPPORTED_MEDIA_TYPE', 'media');
  await expectCode(await put(null, json('/s', 'PUT', 'x'.repeat(30_001))), 413, 'PAYLOAD_TOO_LARGE', 'size');
  await expectCode(await put(null, json('/s', 'PUT', '{')), 400, 'INVALID_JSON', 'json');
  await expectCode(await put(new TripInputError({ departureTime: '시각' })), 400, 'INVALID_INPUT', 'input');
  await expectCode(await settingsHandlers({ userId: async () => undefined, service: { load: assert.fail, save: assert.fail } })(new Request(`${url}/s`), 't'), 401, 'UNAUTHENTICATED', 'anonymous');
});

test('sharing, places and trip creation codes', async () => {
  const share = (error: unknown) => sharingHandlers({ userId: user, findOwner: owner,
    service: () => ({ read: async () => { throw error; }, rotate: async () => null }) });
  const token = 'a'.repeat(43);
  await expectCode(await share(new ShareUnavailableError()).read(new Request(url), token), 409, 'RESULT_UNAVAILABLE', 'share unavailable');
  await expectCode(await share(new PlaceProviderError('UNAVAILABLE')).read(new Request(url), token), 503, 'PROVIDER_UNAVAILABLE', 'share provider');
  await expectCode(await share(null).read(new Request(url), 'short'), 404, 'NOT_FOUND', 'share token');
  await expectCode(await share(null).read(new Request(url, { method: 'POST' }), token), 405, 'METHOD_NOT_ALLOWED', 'share method');
  const shareFailure = await share(null).read(new Request(url), 'short');
  assert.equal(shareFailure.headers.get('referrer-policy'), 'no-referrer');
  await expectCode(await share(null).rotate(new Request(url, { method: 'POST' }), 't'), 404, 'NOT_FOUND', 'rotate without result');

  const provider = (error: unknown): PlaceProvider => ({ search: async () => { throw error; }, details: async () => null, location: async () => null });
  const search = (error: unknown) => placeHandlers({ userId: user, provider: () => provider(error) }).search(new Request(`${url}/api/places?query=tower`));
  await expectCode(await search(new PlaceInputError('검색어')), 400, 'INVALID_INPUT', 'place input');
  await expectCode(await search(new PlaceProviderError('INVALID_RESPONSE')), 502, 'PROVIDER_INVALID_RESPONSE', 'place provider');
  await expectCode(await placeHandlers({ userId: user, provider: () => provider(null) }).details(new Request(`${url}/api/places/p?fields=location`), 'sample-place'), 404, 'NOT_FOUND', 'place missing');

  const trips = tripHandlers({ userId: user, create: async () => 'id', profile: async () => null });
  await expectCode(await trips.create(json('/api/trips', 'POST', '{}', { 'content-type': 'text/plain' })), 415, 'UNSUPPORTED_MEDIA_TYPE', 'trip media');
  await expectCode(await trips.create(json('/api/trips', 'POST', 'x'.repeat(100_001))), 413, 'PAYLOAD_TOO_LARGE', 'trip size');
  await expectCode(await trips.create(json('/api/trips', 'POST', '{')), 400, 'INVALID_JSON', 'trip json');
  await expectCode(await trips.create(json('/api/trips', 'POST', '{}')), 400, 'INVALID_INPUT', 'trip input');
  await expectCode(await trips.profile(new Request(`${url}/api/city-profiles`)), 400, 'INVALID_INPUT', 'profile');
});
