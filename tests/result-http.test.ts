import assert from 'node:assert/strict';
import { test } from 'node:test';
import { constraintHandlers } from '../src/results/http';
import { ResultStaleError, ResultUnavailableError } from '../src/services/itinerary/editing';
import { TripInputError } from '../src/trips/input';
import { PlaceProviderError } from '../src/places';
import { sampleTrip } from './fixtures/itinerary';
const url = 'https://app.example.test/api/trips/trip/constraints';
test('T13 read/write authenticate and authorize before providers, guard origin and JSON', async () => {
  for (const write of [false, true]) {
    for (const [user, owner, status] of [[undefined, 'owner', 401], ['owner', 'other', 403], ['owner', null, 404], ['owner', 'owner', 200]] as const) {
      let calls = 0;
      const handlers = constraintHandlers({ userId: async () => user, findOwner: async () => owner,
        service: () => { calls++; return { load: async () => ({ input: sampleTrip(), revision: 'r', places: {} }), save: async () => ({ input: sampleTrip(), revision: 'r2' }) }; } });
      const response = await (write ? handlers.put(new Request(url, { method: 'PUT', body: '{}' }), 'trip') : handlers.get(new Request(url), 'trip'));
      assert.equal(response.status, status); assert.equal(calls, status === 200 ? 1 : 0);
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
    }
  }
  const handlers = constraintHandlers({ userId: async () => 'owner', findOwner: async () => 'owner', service: () => assert.fail('must not create') });
  assert.equal((await handlers.put(new Request(url, { method: 'PUT', body: '{}', headers: { origin: 'https://evil.test' } }), 'trip')).status, 403);
  assert.equal((await handlers.put(new Request(url, { method: 'PUT', body: 'invalid' }), 'trip')).status, 400);
});
test('T13 errors distinguish stale, validation, missing input, provider and internal failures', async () => {
  for (const [error, status] of [[new ResultStaleError(), 409], [new ResultUnavailableError(), 409], [new TripInputError({ date: '날짜 오류' }), 400], [new PlaceProviderError('UNAVAILABLE'), 503], [new PlaceProviderError('INVALID_RESPONSE'), 502], [new Error('secret SQL'), 500]] as const) {
    const fail = async (): Promise<never> => { throw error; };
    const handlers = constraintHandlers({ userId: async () => 'owner', findOwner: async () => 'owner', service: () => ({ load: fail, save: fail }) });
    const response = await handlers.put(new Request(url, { method: 'PUT', body: '{}' }), 'trip');
    assert.equal(response.status, status); assert.doesNotMatch(await response.text(), /secret SQL/);
  }
});
