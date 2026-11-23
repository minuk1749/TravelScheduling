import { validGeneratedTrip, validResultView, validRouteShapes, validSnapshot } from '../src/api/result-response';
import { conflictTrip, D1, REVISION, trip, view } from './result-fixture';

const ok = trip(REVISION);
const ready = ok.capacity.recommendation!;

test.each([
  {}, { ...ok, status: 'PENDING' }, { ...ok, inputHash: 12 }, { ...ok, itineraryId: '' },
  { ...ok, comparisons: 'unknown' }, { ...ok, comparisons: [null] },
  { ...ok, comparisons: [{ ...ok.comparisons[0], departure: 'invalid-instant' }] },
  { ...ok, verification: { verified: 'true', attempts: 2 } }, { ...ok, verification: { verified: false, attempts: 3 } },
  { ...ok, capacity: { ...ok.capacity, recommendation: null } },
  { ...ok, capacity: { ...ok.capacity, recommendation: { ...ready, schedule: { ...ready.schedule, days: [null] } } } },
  { ...ok, availableByDate: { [D1]: [] } },
])('rejects an incomplete or malformed calculated itinerary (%#)', value => {
  expect(validGeneratedTrip(value)).toBe(false);
});

test('accepts historical windows omitted, nullable current windows, recommendations and independent transfer conflicts', () => {
  expect(ok.availableByDate).toBeUndefined();
  expect(validGeneratedTrip(ok)).toBe(true);
  expect(validGeneratedTrip({ ...ok, availableByDate: { [D1]: null } })).toBe(true);
  expect(validGeneratedTrip({ ...ok, status: 'CONFLICT', transferIssues: [
    { reason: 'NO_ROUTE', direction: 'ARRIVAL', date: D1, from: 'airport', to: 'hotel' },
  ] })).toBe(true);
  expect(validGeneratedTrip(conflictTrip(REVISION))).toBe(true);
  expect(validGeneratedTrip({ ...ok, status: 'OVER_CAPACITY', capacity: { ...ok.capacity, status: 'OVER_CAPACITY' } })).toBe(true);
});

test('acknowledging a save needs a full input and revision while a read additionally needs the place map', () => {
  const snapshot = { input: { ...view.input, legModes: undefined }, revision: view.revision };
  expect(validSnapshot(snapshot)).toBe(true);
  expect(validResultView(snapshot)).toBe(false);
  expect(validResultView({ ...snapshot, places: {} })).toBe(false);
  expect(validResultView({ ...snapshot, places: { ...view.places, unknown: null } })).toBe(true);
  for (const value of [{}, { revision: view.revision }, { input: view.input, revision: 42 },
    { ...snapshot, input: { ...view.input, visits: [null] } }, { ...snapshot, input: { ...view.input, timeZone: 'Bad/Zone' } },
    { ...snapshot, input: { ...view.input, endDate: '2025-12-01' } }, { ...snapshot, input: { ...view.input, flights: {} } }]) expect(validSnapshot(value)).toBe(false);
});

test('cross-date airport limits are optional and require a saved leg, a different affected date and an ordered interval', () => {
  const result = conflictTrip(REVISION);
  const fix = { date: '2026-12-05', affectedDate: '2026-12-04', from: 'hotel', to: 'airport', mode: 'WALK',
    start: '2026-12-04T10:09:00Z', end: '2026-12-04T13:00:00Z' };
  expect(validGeneratedTrip(result)).toBe(true);
  expect(validGeneratedTrip({ ...result, airportTransferLimits: [fix] })).toBe(true);
  for (const invalid of [{}, null, [null], [{ ...fix, affectedDate: 'invalid' }], [{ ...fix, date: fix.affectedDate }], [{ ...fix, date: '2026-12-05T00:30' }],
    [{ ...fix, start: fix.end }], [{ ...fix, end: 'not an instant' }], [{ ...fix, mode: 'BUS' }]]) {
    expect(validGeneratedTrip({ ...result, airportTransferLimits: invalid })).toBe(false);
  }
});

test('the shapes contract permits an empty list, explicit NONE and legacy hash-only responses', () => {
  const leg = { date: D1, kind: 'DAY', from: 'hotel', to: 'museum', mode: 'TRANSIT', shape: { status: 'NONE' } };
  expect(validRouteShapes({ inputHash: REVISION, legs: [] })).toBe(true);
  expect(validRouteShapes({ inputHash: REVISION, legs: [leg] })).toBe(true);
  const valid = { inputHash: REVISION, itineraryId: ok.itineraryId };
  for (const legs of [undefined, null, {}, [null], [{ ...leg, from: undefined }], [{ ...leg, mode: 'CAR' }],
    [{ ...leg, shape: { status: 'FAILED' } }], [{ ...leg, shape: { status: 'OK' } }],
    [{ ...leg, shape: { status: 'OK', encodedPolyline: 123 } }]]) {
    expect(validRouteShapes({ ...valid, legs })).toBe(false);
  }
});
