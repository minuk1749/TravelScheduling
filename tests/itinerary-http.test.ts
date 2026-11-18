import assert from 'node:assert/strict';
import { test } from 'node:test';
import { itineraryHandlers, type ItineraryGenerator } from '../src/itineraries/http';
import { PlaceProviderError } from '../src/places';
import { ItineraryInputError, ItineraryService, type GenerateOutcome } from '../src/services/itinerary';
import { TravelInputError, TravelProviderError } from '../src/travel-time';
import { cityProfile } from './fixtures/trip-input';
import { FixturePlaces, FixtureTravel, sampleTrip } from './fixtures/itinerary';

const url = 'https://app.example.test/api/trips/trip-1/itinerary';
const post = (headers: Record<string, string> = {}) => new Request(url, { method: 'POST', headers });

function setup(options: { userId?: string; owner?: string | null; generate?: ItineraryGenerator['generate'] } = {}) {
  const calls = { created: 0, disposed: 0 };
  const handlers = itineraryHandlers({
    userId: async () => 'userId' in options ? options.userId : 'user-1',
    findOwner: async () => 'owner' in options ? options.owner! : 'user-1',
    generator: () => {
      calls.created++;
      return { generator: { generate: options.generate ?? (async () => ({ status: 'STALE' })) }, dispose: () => { calls.disposed++; } };
    },
  });
  return { calls, generate: (request = post()) => handlers.generate(request, 'trip-1') };
}

test('T12 itinerary API authorizes before creating providers', async () => {
  for (const [options, status] of [[{ userId: undefined }, 401], [{ owner: 'someone-else' }, 403], [{ owner: null }, 404]] as const) {
    const { calls, generate } = setup(options);
    const response = await generate();
    assert.equal(response.status, status);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(calls.created, 0);
  }
  const { calls, generate } = setup();
  assert.equal((await generate(post({ origin: 'https://evil.example.test' }))).status, 403);
  assert.equal(calls.created, 0);
});

test('T12 itinerary API returns OK / OVER_CAPACITY / CONFLICT results with 200 and efficiency', async () => {
  const travel = new FixtureTravel();
  const service = new ItineraryService({
    repository: {
      loadInputs: async () => ({ status: 'READY', input: sampleTrip(), inputHash: 'hash' }),
      saveItinerary: async () => ({ status: 'SAVED', itineraryId: 'itinerary-1' }),
    },
    profiles: { findByCityCode: async () => cityProfile }, places: new FixturePlaces(), travel,
  });
  const { calls, generate } = setup({ generate: tripId => service.generate(tripId) });
  const response = await generate(post({ origin: 'https://app.example.test' }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.itineraryId, 'itinerary-1');
  assert.equal(body.status, 'OK');
  assert.equal(body.efficiency.currency, 'JPY');
  assert.ok(body.comparisons.length > 0 && body.capacity.recommendation.schedule.days.length === 3);
  assert.deepEqual(calls, { created: 1, disposed: 1 });

  for (const status of ['OVER_CAPACITY', 'CONFLICT'] as const) {
    const outcome = { status: 'SAVED', itineraryId: 'x', result: { status } } as unknown as GenerateOutcome;
    const response = await setup({ generate: async () => outcome }).generate();
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, status);
  }
});

test('T12 itinerary API maps incomplete/stale inputs to 409 and provider failures to 503/502', async () => {
  const cases: [ItineraryGenerator['generate'], number, Record<string, unknown>?][] = [
    [async () => ({ status: 'INCOMPLETE', fields: ['cityCode'] }), 409, { fields: ['cityCode'] }],
    [async () => ({ status: 'STALE' }), 409],
    [async () => ({ status: 'NOT_FOUND' }), 404],
    [async () => { throw new ItineraryInputError({ lodgings: '숙소' }); }, 409, { fields: { lodgings: '숙소' } }],
    [async () => { throw new TravelInputError('행렬은 최대 100개 장소를 지원합니다.'); }, 400],
    [async () => { throw new TravelProviderError('UNAVAILABLE'); }, 503],
    [async () => { throw new TravelProviderError('INVALID_RESPONSE'); }, 502],
    [async () => { throw new PlaceProviderError('UNAVAILABLE'); }, 503],
    [async () => { throw new PlaceProviderError('INVALID_RESPONSE'); }, 502],
    [async () => { throw new Error('relation "trips" password=secret'); }, 500],
  ];
  for (const [generateImpl, status, expected] of cases) {
    const { calls, generate } = setup({ generate: generateImpl });
    const response = await generate();
    assert.equal(response.status, status);
    const body = await response.json();
    for (const [key, value] of Object.entries(expected ?? {})) assert.deepEqual(body[key], value);
    assert.ok(typeof body.error === 'string' && !/secret|relation/.test(body.error));
    assert.deepEqual(calls, { created: 1, disposed: 1 }, 'providers are disposed on every path');
  }
});
