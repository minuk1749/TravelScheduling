import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeItineraryDetails } from '../src/repositories/itinerary-details';
import { ItineraryInputError, type TripInputs } from '../src/services/itinerary';
import { FixturePlaces, samplePlaces, sampleTrip, type Sample } from './fixtures/itinerary';
import { schedule, service } from './helpers/itinerary-service';

// T28: an unpinned wish with no place details is skipped; fixed and required places still need correction.
// Opening hours: known (checked), closed (`[]`, rejected) and unknown (`undefined`, scheduled and flagged).

const placed = (result: Awaited<ReturnType<ReturnType<typeof service>['service']['compute']>>) =>
  schedule(result).days.flatMap(day => day.stops.flatMap(stop => stop.kind === 'VISIT' ? [stop.visitId] : []));
const noDetails = (key: keyof typeof samplePlaces) => new FixturePlaces(new Set([samplePlaces[key].googlePlaceId]));
const withVisit = (extra: Partial<TripInputs['visits'][number]> & { key: keyof typeof samplePlaces }): TripInputs['visits'][number] => {
  const { key, ...visit } = extra;
  return { ...sampleTrip().visits.find(row => row.id === `visit-${key}`)!, ...visit };
};
/** Replaces one sample visit; every other visit keeps the Tokyo OK sample's definition. */
const tripWith = (replacement: TripInputs['visits'][number]): TripInputs => {
  const base = sampleTrip();
  return { ...base, visits: base.visits.map(visit => visit.id === replacement.id ? replacement : visit) };
};

test('T28 an unpinned wish without place details is skipped and the itinerary is still generated', async () => {
  const baseline = await service().service.compute(sampleTrip());
  const places = noDetails('teamlab');
  const result = await service({ places }).service.compute(sampleTrip());
  assert.ok(places.detailCalls.includes(samplePlaces.teamlab.googlePlaceId));
  assert.equal(result.status, 'OK');
  assert.ok(result.verification.verified);
  assert.deepEqual(placed(result), placed(baseline));
  assert.ok(!placed(result).includes('visit-teamlab'));
  assert.deepEqual(result.capacity.unplaced, []);
  assert.deepEqual(result.openingHoursUnknown, []);
});

test('T28 a required place without details is still an input error', async () => {
  await assert.rejects(service({ places: noDetails('tower') }).service.compute(sampleTrip()),
    (error: unknown) => error instanceof ItineraryInputError && Object.keys(error.fields).join() === `places.${samplePlaces.tower.googlePlaceId}`);
});

test('T28 a pinned wish without details is still an input error', async () => {
  const pins = [{ fixedDate: '2026-12-02' }, { fixedDate: '2026-12-02', fixedTime: '15:00' }, { fixedOrder: 0 }];
  for (const pin of pins) {
    await assert.rejects(service({ places: noDetails('teamlab') }).service.compute(tripWith(withVisit({ key: 'teamlab', ...pin }))),
      (error: unknown) => error instanceof ItineraryInputError && `places.${samplePlaces.teamlab.googlePlaceId}` in error.fields, JSON.stringify(pin));
  }
});

test('T28 a place shared with a required visit or an anchor is not skipped', async () => {
  const hotelWish = { ...withVisit({ key: 'teamlab' }), place: sampleTrip().lodgings[0].place };
  await assert.rejects(service({ places: noDetails('hotel') }).service.compute(tripWith(hotelWish)),
    (error: unknown) => error instanceof ItineraryInputError && `places.${samplePlaces.hotel.googlePlaceId}` in error.fields);
  const duplicate = { ...withVisit({ key: 'teamlab' }), id: 'visit-teamlab-again', place: sampleTrip().visits.find(row => row.id === 'visit-tower')!.place };
  const base = sampleTrip();
  await assert.rejects(service({ places: noDetails('tower') }).service.compute({ ...base, visits: [...base.visits, duplicate] }),
    (error: unknown) => error instanceof ItineraryInputError);
});

test('T28 a provider failure for a wish is not hidden as a skipped place', async () => {
  const places = new FixturePlaces();
  places.details = async () => { throw new Error('UNAVAILABLE'); };
  await assert.rejects(service({ places }).service.compute(sampleTrip()), /UNAVAILABLE/);
});

const synthetic = (id: string, extra: Partial<Sample> = {}): Sample => ({
  googlePlaceId: `synthetic-${id}`, latitude: 35.68, longitude: 139.76, ...extra,
});
const syntheticVisit = (id: string, priority: 'REQUIRED' | 'WISH' = 'REQUIRED') => ({
  id: `visit-${id}`, place: { id: `place-${id}`, googlePlaceId: `synthetic-${id}` }, kind: 'ATTRACTION' as const, minutes: 30, priority,
});

test('T28 known hours are checked, closed places are rejected, and unknown hours are scheduled and flagged', async () => {
  const unknown = synthetic('unknown'), closed = synthetic('closed', { closed: true });
  const normal = synthetic('normal', { hours: ['10:00', '20:00'] });
  const places = new FixturePlaces(new Set(), new Map([unknown, closed, normal].map(place => [place.googlePlaceId, place])));
  const base = sampleTrip();
  const input = { ...base, visits: [...base.visits, syntheticVisit('unknown'), syntheticVisit('closed'), syntheticVisit('normal')] };
  const result = await service({ places }).service.compute(input);

  const scheduled = placed(result);
  assert.ok(scheduled.includes('visit-unknown'), 'unknown hours do not block placement');
  assert.ok(scheduled.includes('visit-normal'));
  assert.ok(!scheduled.includes('visit-closed'));
  assert.deepEqual(result.capacity.unplaced.filter(item => item.visitId === 'visit-closed'),
    [{ visitId: 'visit-closed', reason: 'TIME_WINDOW', fixed: false }]);
  // Only the unknown place is flagged; closed and checked places are not.
  assert.deepEqual(result.openingHoursUnknown, ['visit-unknown']);
  // The travel-time verification is a separate statement and still holds.
  assert.ok(result.verification.verified);
  assert.notEqual(result.status, 'CONFLICT');
});

test('T28 unknown hours are separate from the travel-time verification result', async () => {
  const unknown = synthetic('unknown');
  const places = new FixturePlaces(new Set(), new Map([[unknown.googlePlaceId, unknown]]));
  const base = sampleTrip();
  const input = { ...base, visits: [...base.visits, syntheticVisit('unknown')] };
  const result = await service({ places }).service.compute(input);
  assert.equal(result.status, 'OK');
  assert.ok(result.verification.verified);
  assert.deepEqual(result.openingHoursUnknown, ['visit-unknown']);

  // Verification failure does not mention hours, and the schedule-less conflict carries no hours claim.
  const unverified = await service({ places, maxAttempts: 1 }).service.compute(input);
  assert.equal(unverified.status, 'CONFLICT');
  assert.equal(unverified.verification.verified, false);
  assert.deepEqual(unverified.openingHoursUnknown, []);

  // Stored with the itinerary, so reopening the result tells the same story.
  const stored = JSON.parse(JSON.stringify(encodeItineraryDetails(result, schedule(result))));
  assert.deepEqual(stored.openingHoursUnknown, ['visit-unknown']);
  assert.deepEqual(encodeItineraryDetails(unverified, null).openingHoursUnknown, []);
});

test('T28 a trip whose hours are all known reports no unknown hours', async () => {
  const result = await service().service.compute(sampleTrip());
  // New results record "checked, none unknown" as an empty array, distinct from a pre-T28 row without the field.
  assert.deepEqual(result.openingHoursUnknown, []);
  const stored = JSON.parse(JSON.stringify(encodeItineraryDetails(result, schedule(result))));
  assert.deepEqual(stored.openingHoursUnknown, []);
});
