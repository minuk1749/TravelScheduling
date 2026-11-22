import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { LegComparison } from '../src/services/itinerary';
import { RouteShapeService, SHAPE_CONCURRENCY } from '../src/services/route-shapes';
import type { ShapeLoad, ShapeSnapshot } from '../src/route-shapes/model';
import { TravelProviderError } from '../src/travel-time';
import { PlaceProviderError } from '../src/places';
import type { RouteShapeProvider, RouteShapeRequest } from '../src/travel-time/shapes';
import { FixturePlaces, sampleTrip } from './fixtures/itinerary';
import { encodedPolyline } from './fixtures/route-shapes';

const inputHash = 'a'.repeat(64);
const itineraryId = 'itinerary-from-storage';
const comparison = (mode: LegComparison['selected']['mode'], index: number): LegComparison => ({
  date: '2026-12-01', kind: index === 0 ? 'AIRPORT' : 'DAY',
  from: index === 0 ? 'place-airport' : 'place-hotel', to: 'place-sensoji',
  departure: `2026-12-01T0${index % 10}:00:00Z`, selected: { mode, fixed: false, minutes: 30, fare: null },
  baseline: null, alternatives: {},
});
const snapshot: ShapeSnapshot = { itineraryId, input: sampleTrip(), comparisons: ['TAXI', 'WALK', 'TRANSIT'].map((mode, i) =>
  comparison(mode as LegComparison['selected']['mode'], i)) };
const repository = (value: ShapeLoad = { status: 'READY', snapshot }) => ({ load: async () => value });

test('T19 all DAY/AIRPORT comparisons preserve keys/order, actual departure, TAXI maps to DRIVE and NONE is explicit', async () => {
  const calls: RouteShapeRequest[] = [], places = new FixturePlaces();
  const provider: RouteShapeProvider = { shape: async request => {
    calls.push(request);
    return request.mode === 'WALK' ? null : { encodedPolyline };
  } };
  const service = new RouteShapeService(repository(), places, provider);
  const result = await service.read('trip', 'owner', inputHash);
  assert.equal(result.status, 'OK');
  if (result.status !== 'OK') return;
  assert.deepEqual(result.response, { inputHash, itineraryId, legs: snapshot.comparisons.map(leg => ({
    date: leg.date, kind: leg.kind, from: leg.from, to: leg.to, mode: leg.selected.mode,
    shape: leg.selected.mode === 'WALK' ? { status: 'NONE' } : { status: 'OK', encodedPolyline },
  })) });
  assert.deepEqual(calls.map(call => call.mode), ['DRIVE', 'WALK', 'TRANSIT']);
  assert.deepEqual(calls.map(call => call.departure), snapshot.comparisons.map(leg => leg.departure));
  assert.ok(calls.every(call => call.timeZone === 'Asia/Tokyo'));
  assert.equal(places.locationCalls.length, 3, 'same place is looked up once per request');
  assert.equal(places.detailCalls.length, 0, 'only coordinates needed');
  await service.read('trip', 'owner', inputHash);
  assert.equal(calls.length, 6, 'no shape cache between requests');
});

test('T19 stale/missing results do not query providers; no selected legs yields a valid empty list', async () => {
  const unused = { shape: async () => assert.fail('must not query'), location: async () => assert.fail('must not query') };
  for (const status of ['STALE_INPUT', 'RESULT_UNAVAILABLE', 'NOT_FOUND'] as const) {
    assert.deepEqual(await new RouteShapeService(repository({ status }), unused, unused).read('t', 'u', inputHash), { status });
  }
  const empty = new RouteShapeService(repository({ status: 'READY', snapshot: { ...snapshot, comparisons: [] } }), unused, unused);
  assert.deepEqual(await empty.read('t', 'u', inputHash), { status: 'OK', response: { inputHash, itineraryId, legs: [] } });
});

test('T19 missing coordinates explicitly yield NONE, while Places failures propagate', async () => {
  const missing = new FixturePlaces(new Set(['sample-sensoji']));
  const service = new RouteShapeService(repository(), missing, { shape: async () => assert.fail('no coordinates') });
  const result = await service.read('t', 'u', inputHash);
  assert.ok(result.status === 'OK');
  assert.ok(result.response.legs.every(leg => leg.shape.status === 'NONE'));
  const failing = new RouteShapeService(repository(), { location: async () => { throw new PlaceProviderError('UNAVAILABLE'); } },
    { shape: async () => assert.fail('no coordinates') });
  await assert.rejects(failing.read('t', 'u', inputHash), PlaceProviderError);
});

test('T19 bounds concurrent shape calls, preserves order on out-of-order completion, drains/stops on failure', async () => {
  const comparisons = Array.from({ length: 12 }, (_, i) => comparison('WALK', i));
  const repo = repository({ status: 'READY', snapshot: { ...snapshot, comparisons } });
  let active = 0, max = 0, calls = 0;
  const waiting: (() => void)[] = [];
  const provider: RouteShapeProvider = { shape: async request => {
    calls++; active++; max = Math.max(max, active);
    await new Promise<void>(resolve => waiting.push(resolve));
    active--;
    return { encodedPolyline: request.departure };
  } };
  const pending = new RouteShapeService(repo, new FixturePlaces(), provider).read('t', 'u', inputHash);
  while (calls < comparisons.length) {
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(active <= SHAPE_CONCURRENCY);
    waiting.splice(0).reverse().forEach(resolve => resolve());
  }
  const result = await pending;
  assert.ok(result.status === 'OK');
  assert.equal(max, SHAPE_CONCURRENCY);
  assert.deepEqual(result.response.legs.map(leg => leg.shape), comparisons.map(leg => ({ status: 'OK', encodedPolyline: leg.departure })));
  calls = 0; active = 0;
  const failure = new TravelProviderError('UNAVAILABLE');
  const failing: RouteShapeProvider = { shape: async () => {
    const index = calls++; active++;
    try {
      if (index === 0) throw failure;
      await new Promise(resolve => setImmediate(resolve));
      return { encodedPolyline };
    } finally { active--; }
  } };
  await assert.rejects(new RouteShapeService(repo, new FixturePlaces(), failing).read('t', 'u', inputHash), error => error === failure);
  assert.ok(calls <= SHAPE_CONCURRENCY, 'no dispatch after failure');
  assert.equal(active, 0, 'all in-flight workers finished before rejection');
});
