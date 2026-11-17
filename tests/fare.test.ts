import assert from 'node:assert/strict';
import { test } from 'node:test';
import { estimateTaxiFare, type CityProfile } from '../src/fare';

const fixture: CityProfile = {
  cityCode: 'TEST', country: 'Test', currency: 'TST', transitCoverage: 'wide', transitHours: 'daily',
  taxiBaseFare: 100, taxiFarePerKm: 20, taxiFarePerMinute: 2,
  nightSurcharge: 0.2, nightStart: '22:00', nightEnd: '05:00',
  callBufferMinutes: 10, efficiencyThreshold: 5, rideHailingApps: ['Fixture'],
  source: 'https://example.test/fares', updatedAt: '2026-11-18T00:00:00Z',
};
const estimate = (instant: string) => estimateTaxiFare(fixture, 5, 10, new Date(instant), 'Asia/Tokyo');

test('calculates estimated local currency fare and preserves provenance', () => {
  assert.deepEqual(estimate('2026-01-01T03:00:00Z'), {
    status: 'AVAILABLE', amount: 220, currency: 'TST', source: fixture.source, updatedAt: fixture.updatedAt, estimated: true,
  });
});

test('applies night surcharge in local time across midnight with inclusive start and exclusive end', () => {
  for (const [instant, amount] of [
    ['2026-01-01T12:59:00Z', 220], ['2026-01-01T13:00:00Z', 264],
    ['2026-01-01T15:00:00Z', 264], ['2026-01-01T19:59:00Z', 264], ['2026-01-01T20:00:00Z', 220],
  ] as const) {
    const result = estimate(instant);
    assert.equal(result.status, 'AVAILABLE');
    if (result.status === 'AVAILABLE') assert.equal(result.amount, amount);
  }
});

test('returns information unavailable for a missing profile or missing rates', () => {
  for (const profile of [null, undefined, { ...fixture, taxiFarePerKm: null }]) {
    assert.deepEqual(estimateTaxiFare(profile, 5, 10, new Date(), 'Asia/Tokyo'), { status: 'UNAVAILABLE', message: '정보 없음' });
  }
});

test('validates inputs and incomplete night configuration', () => {
  assert.throws(() => estimateTaxiFare(fixture, -1, 10, new Date(), 'Asia/Tokyo'), RangeError);
  assert.throws(() => estimateTaxiFare({ ...fixture, nightEnd: null }, 1, 1, new Date(), 'Asia/Tokyo'), RangeError);
  assert.throws(() => estimateTaxiFare(fixture, 1, 1, new Date(), 'invalid'), RangeError);
});
