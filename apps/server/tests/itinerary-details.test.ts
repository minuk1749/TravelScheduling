import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeItineraryDetails, isCompleteItineraryDetails } from '../src/repositories/itinerary-details';
import { sampleTrip } from './fixtures/itinerary';
import { service } from './helpers/itinerary-service';

// T15A: writer (saveItinerary) and reader (shared result) share one `itineraries.details` definition.

test('T15A details codec: stored JSON is complete for the reader and keeps only airport legs', async () => {
  const result = await service().service.compute(sampleTrip());
  assert.equal(result.status, 'OK');
  const stored = JSON.parse(JSON.stringify(encodeItineraryDetails(result, result.capacity.recommendation!.schedule)));
  assert.ok(isCompleteItineraryDetails(stored));
  assert.equal(stored.schedule, 'FULL');
  assert.deepEqual(stored.transfers, result.comparisons.filter(leg => leg.kind === 'AIRPORT'));
  assert.ok(stored.transfers.length > 0 && result.comparisons.some(leg => leg.kind === 'DAY'));
  assert.deepEqual(stored.recommendation, { requiredCount: result.capacity.recommendation!.requiredCount,
    requiredVisitIds: result.capacity.recommendation!.requiredVisitIds });
  assert.equal(encodeItineraryDetails(result, null).schedule, null);
});

test('T15A details codec: legacy rows missing any T12 field are rejected', async () => {
  const result = await service().service.compute(sampleTrip());
  const stored = encodeItineraryDetails(result, null);
  for (const key of ['time', 'issues', 'verification', 'transfers', 'transferIssues', 'flightConflicts', 'skippedMeals'] as const) {
    const legacy: Partial<typeof stored> = { ...stored };
    delete legacy[key];
    assert.equal(isCompleteItineraryDetails(legacy), false, key);
  }
  assert.equal(isCompleteItineraryDetails({}), false);
});

test('T28 details codec: new rows keep an empty unknown-hours list; pre-T28 rows without the field stay readable and unrecorded', async () => {
  const result = await service().service.compute(sampleTrip());
  const stored = JSON.parse(JSON.stringify(encodeItineraryDetails(result, result.capacity.recommendation!.schedule)));
  assert.ok(isCompleteItineraryDetails(stored));
  assert.deepEqual(stored.openingHoursUnknown, []);
  const legacy = { ...stored };
  delete legacy.openingHoursUnknown;
  assert.ok(isCompleteItineraryDetails(legacy), 'the field is optional for older rows');
  assert.equal('openingHoursUnknown' in legacy, false);
});
