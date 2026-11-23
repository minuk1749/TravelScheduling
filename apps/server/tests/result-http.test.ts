import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { constraintHandlers } from '../src/results/http';
import { ResultEditService, ResultStaleError, ResultUnavailableError } from '../src/services/itinerary/editing';
import { TripInputError } from '../src/trips/input';
import { PlaceProviderError } from '../src/places';
import { FixturePlaces, sampleTrip } from './fixtures/itinerary';
import { constraintsFrom } from '../src/results/model';
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

test('authenticated clients can request their specific receipt; old and malformed requests cannot obtain it', async () => {
  const owner = randomUUID(), operation = randomUUID(), version = randomUUID(), original = randomUUID(), input = sampleTrip();
  const revision = 'a'.repeat(64), receipt = { operationId: operation, revision };
  const repo = new ResultEditService({
    loadInputs: async (id, lookup) => {
      assert.equal(id, input.id);
      return { status: 'READY', input, inputHash: revision, writeVersion: version,
        ...(lookup?.ownerId === owner && lookup.operationId === operation ? { receipt } : {}) };
    },
    save: async (id, user, hash, constraints, options) => {
      assert.equal(id, input.id); assert.equal(user, owner); assert.equal(hash, revision);
      assert.deepEqual(constraints, constraintsFrom(input));
      assert.deepEqual(options, { operationId: operation, expectedWriteVersion: version, expectedOperationId: original });
      return { input, revision, writeVersion: version, receipt };
    },
  }, new FixturePlaces());
  const handlers = constraintHandlers({ userId: async () => owner, findOwner: async () => owner, service: () => repo });
  const lookup = (query: string) => handlers.get(new Request(url + query), input.id);
  const save = (extra: object) => handlers.put(new Request(url, { method: 'PUT',
    body: JSON.stringify({ revision, constraints: constraintsFrom(input), ...extra }) }), input.id);
  const matching = await (await lookup('?operationId=' + operation)).json();
  assert.deepEqual(matching.receipt, receipt); assert.equal(matching.writeVersion, version);
  for (const query of ['', '?operationId=' + randomUUID()]) assert.equal('receipt' in await (await lookup(query)).json(), false);
  assert.equal((await lookup('?operationId=')).status, 400);
  assert.equal((await save({ operationId: operation, expectedOperationId: original, expectedWriteVersion: version })).status, 200);
  for (const input of [{ operationId: null }, { expectedOperationId: 'bad' }, { expectedWriteVersion: 42 }]) {
    const bad = await save(input); assert.equal(bad.status, 400); assert.equal((await bad.json()).code, 'INVALID_INPUT');
  }
});
test('T13 errors distinguish stale, validation, missing input, provider and internal failures', async () => {
  for (const [error, status] of [[new ResultStaleError(), 409], [new ResultUnavailableError(), 409], [new TripInputError({ date: '날짜 오류' }), 400], [new PlaceProviderError('UNAVAILABLE'), 503], [new PlaceProviderError('INVALID_RESPONSE'), 502], [new Error('secret SQL'), 500]] as const) {
    const fail = async (): Promise<never> => { throw error; };
    const handlers = constraintHandlers({ userId: async () => 'owner', findOwner: async () => 'owner', service: () => ({ load: fail, save: fail }) });
    const response = await handlers.put(new Request(url, { method: 'PUT', body: '{}' }), 'trip');
    assert.equal(response.status, status); assert.doesNotMatch(await response.text(), /secret SQL/);
  }
});
