import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTaxiFareEstimator, estimateTaxiFare } from '../src/fare';
import { FareConverter } from '../src/services/itinerary/routes';
import type { TravelAlternatives, TravelMatrix } from '../src/travel-time';
import { cityProfile } from './fixtures/trip-input';

const alternatives: TravelAlternatives[] = [
  {}, { WALK: { durationSeconds: 0, distanceMeters: 0, fare: null } },
  { TRANSIT: { durationSeconds: 100, distanceMeters: 200, fare: null } },
  { TRANSIT: { durationSeconds: 120, distanceMeters: 300, fare: { amount: 0, currency: 'JPY' } },
    DRIVE: { durationSeconds: 90, distanceMeters: 1000, fare: null } },
  { TRANSIT: { durationSeconds: 200, distanceMeters: 300, fare: { amount: 10, currency: 'EUR' } },
    DRIVE: { durationSeconds: 130.5, distanceMeters: 4500, fare: null } },
];
const matrix: TravelMatrix = new Map(alternatives.map((_, i) => [String(i),
  new Map(alternatives.map((value, j) => [String(j), value]))]));

test('matrix fare preparation preserves scalar results, currency order and input immutability', () => {
  const before = structuredClone(matrix);
  for (const profile of [cityProfile, null, { ...cityProfile, taxiBaseFare: null }]) {
    for (const [zone, departure] of [
      ['Asia/Tokyo', '2026-12-01T12:59:00Z'], ['Asia/Tokyo', '2026-12-01T13:00:00Z'],
      ['Asia/Tokyo', '2026-12-01T20:00:00Z'], ['America/New_York', '2026-11-01T05:30:00Z'],
      ['America/New_York', '2026-11-01T06:30:00Z'],
    ]) {
      const scalar = new FareConverter(profile, zone), batch = new FareConverter(profile, zone);
      const expected = new Map([...matrix].map(([from, row]) => [from,
        new Map([...row].map(([to, options]) => [to, scalar.options(options, departure)]))]));
      assert.deepEqual(batch.table(matrix, departure), expected);
      assert.equal(batch.currency, scalar.currency);
    }
  }
  assert.deepEqual(matrix, before);
});

test('matrix constructs one timezone formatter, separate departures re-evaluate the surcharge', t => {
  const original = Intl.DateTimeFormat;
  let calls = 0;
  t.mock.method(Intl, 'DateTimeFormat', function (...args: ConstructorParameters<typeof Intl.DateTimeFormat>) {
    calls++;
    return new original(...args);
  });
  const converter = new FareConverter(cityProfile, 'Asia/Tokyo');
  converter.table(matrix, '2026-12-01T12:59:00Z');
  assert.equal(calls, 1);
  converter.table(matrix, '2026-12-01T13:00:00Z');
  assert.equal(calls, 2);
  converter.options(alternatives[3], '2026-12-01T14:00:00Z');
  assert.equal(calls, 3);
  new FareConverter(null, 'Asia/Tokyo').table(matrix, '2026-12-01T14:00:00Z');
  assert.equal(calls, 4, 'unavailable fare context is also reused');
});

test('prepared fares retain validation on every leg, unknown fares and lazy no-drive behavior', () => {
  const estimate = createTaxiFareEstimator(cityProfile, new Date('2026-12-01T13:00:00Z'), 'Asia/Tokyo');
  assert.deepEqual(estimate(1, 2), estimateTaxiFare(cityProfile, 1, 2, new Date('2026-12-01T13:00:00Z'), 'Asia/Tokyo'));
  for (const [distance, duration] of [[-1, 2], [1, NaN], [Infinity, 0]]) assert.throws(() => estimate(distance, duration), RangeError);
  assert.throws(() => estimate(Number.MAX_VALUE, Number.MAX_VALUE), RangeError);
  for (const profile of [cityProfile, null]) {
    assert.throws(() => createTaxiFareEstimator(profile, new Date(NaN), 'Asia/Tokyo')(1, 2), RangeError);
    assert.throws(() => createTaxiFareEstimator(profile, new Date(0), 'invalid')(1, 2), RangeError);
  }
  assert.throws(() => createTaxiFareEstimator({ ...cityProfile, nightEnd: null }, new Date(0), 'Asia/Tokyo')(1, 2), RangeError);
  const converter = new FareConverter(cityProfile, 'invalid');
  assert.deepEqual(converter.table(new Map(), 'invalid'), new Map());
  assert.deepEqual(converter.options(alternatives[1], 'invalid'), { WALK: { minutes: 0, fare: 0 } });
});
