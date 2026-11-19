import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseTripDraft, TripInputError } from '../src/trips/input';
import { tripHandlers } from '../src/trips/http';
import { cityProfileRepository } from '../src/repositories/city-profiles';
import { tripDraft, cityProfile } from './fixtures/trip-input';
import type { Pool } from 'pg';

const request = (input: unknown = tripDraft, headers = {}) => new Request('https://app.test/api/trips', {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(input),
});
test('T10 valid input accepts multiple lodgings, restaurants, wish places and manual policy; strips untrusted fields', () => {
  assert.deepEqual(parseTripDraft({ ...tripDraft, ownerId: 'forged', name: 'Google detail' }), tripDraft);
  assert.equal(parseTripDraft({ ...tripDraft, taxiPolicy: 'NEVER' }).taxiPolicy, 'NEVER');
  assert.equal(parseTripDraft({ ...tripDraft, taxiPolicy: 'PREFER', luggageOption: 'DIRECT_TO_AIRPORT' }).luggageOption, 'DIRECT_TO_AIRPORT');
  const dayTrip = structuredClone(tripDraft);
  dayTrip.endDate = dayTrip.startDate; dayTrip.flights[1].localDateTime = '2026-12-01T18:00'; dayTrip.lodgings = [];
  assert.doesNotThrow(() => parseTripDraft(dayTrip));
});
test('T10 rejects malformed dates, zones, flight times, lodging gaps/overlaps, invalid duration, enum and duplicates', () => {
  const mutations: ((draft: typeof tripDraft) => void)[] = [
    d => { d.cityCode = ''; }, d => { d.timeZone = '+09:00'; }, d => { d.timeZone = 'Asia/Seoul'; },
    d => { d.timeZone = 'Europe/Paris'; }, d => { d.startDate = '2026-02-30'; },
    d => { d.startDate = '0000-01-01'; }, d => { d.endDate = '2026-11-30'; }, d => { d.endDate = '2027-01-01'; },
    d => { d.flights[0].localDateTime = '2026-12-02T10:00'; },
    d => { d.flights[0].localDateTime = '2026-12-01T25:00'; },
    d => { d.flights[0].googlePlaceId = ''; }, d => { d.flights.pop(); },
    d => { d.flights[1].direction = 'ARRIVAL'; },
    d => { d.lodgings = []; }, d => { d.lodgings[0].checkOut = '2026-12-03'; },
    d => { d.lodgings[1].checkIn = '2026-12-03'; }, d => { d.lodgings[0].checkIn = '2026-11-30'; },
    d => { d.visits[0].minutes = 0; }, d => { d.visits[0].minutes = 1.5; },
    d => { d.visits[0].minutes = NaN; }, d => { d.visits[0].minutes = 1441; },
    d => { d.visits[0].googlePlaceId = '../invalid'; }, d => { d.visits.push(d.visits[0]); },
    d => { d.visits = []; }, d => { Object.assign(d, { taxiPolicy: 'AUTO' }); },
    d => { Object.assign(d.visits[0], { kind: 'AIRPORT' }); }, d => { Object.assign(d.visits[0], { priority: 'AUTO' }); },
    d => { Object.assign(d, { luggageOption: 'UNKNOWN' }); },
  ];
  for (const mutate of mutations) {
    const value = structuredClone(tripDraft); mutate(value);
    assert.throws(() => parseTripDraft(value), TripInputError, mutate.toString());
  }
  for (const raw of [null, [], 'trip', {}, { ...tripDraft, flights: null }, { ...tripDraft, visits: Array(101).fill(tripDraft.visits[0]) }]) assert.throws(() => parseTripDraft(raw), TripInputError);
});
test('T10 rejects nonexistent and ambiguous DST local times with the trip IANA zone', () => {
  for (const [date, time] of [['2026-03-29', '02:30'], ['2026-10-25', '02:30']]) {
    const value = structuredClone(tripDraft);
    Object.assign(value, { cityCode: 'PARIS', timeZone: 'Europe/Paris', startDate: date, endDate: date, lodgings: [] });
    value.flights[0].localDateTime = `${date}T${time}`; value.flights[1].localDateTime = `${date}T18:00`;
    assert.throws(() => parseTripDraft(value), TripInputError);
  }
});
test('T10 create API authenticates, validates, binds session owner, rejects cross-origin and hides internal errors', async () => {
  const session: { user?: string } = {}; let writes = 0;
  const handlers = tripHandlers({ userId: async () => session.user, profile: async () => null, create: async (owner, input) => {
    writes++; assert.equal(owner, 'session-user'); assert.deepEqual(input, tripDraft); return 'trip-id';
  } });
  assert.equal((await handlers.create(request())).status, 401); assert.equal(writes, 0);
  assert.equal((await handlers.profile(new Request('https://app.test/api/city-profiles?cityCode=TOKYO'))).status, 401);
  session.user = 'session-user';
  assert.equal((await handlers.create(request(tripDraft, { origin: 'https://evil.test' }))).status, 403);
  assert.equal((await handlers.create(request(tripDraft, { 'content-type': 'text/plain' }))).status, 415);
  assert.equal((await handlers.create(new Request('https://app.test/api/trips', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' }))).status, 400);
  const invalid = await handlers.create(request({ ...tripDraft, visits: [] }));
  assert.equal(invalid.status, 400); assert.ok((await invalid.json()).fields.visits); assert.equal(writes, 0);
  assert.equal((await handlers.create(request({ ...tripDraft, extra: 'x'.repeat(100_001) }))).status, 413);
  const response = await handlers.create(request({ ...tripDraft, ownerId: 'forged' }, { origin: 'https://app.test' }));
  assert.equal(response.status, 201); assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await response.json(), { id: 'trip-id' }); assert.equal(writes, 1);
  const broken = tripHandlers({ userId: async () => session.user, profile: async () => null, create: async () => { throw Error('secret SQL'); } });
  const failure = await broken.create(request()); assert.equal(failure.status, 500); assert.doesNotMatch(await failure.text(), /secret|SQL/);
});
test('T10 profile endpoint returns sourced profile, recommendation and explicit missing information', async () => {
  const handlers = tripHandlers({ userId: async () => 'user', create: async () => '', profile: async code => code === 'TOKYO' ? cityProfile : null });
  const get = (code: string) => handlers.profile(new Request(`https://app.test/api/city-profiles?cityCode=${code}`));
  assert.deepEqual(await (await get('TOKYO')).json(), { profile: cityProfile, recommendedPolicy: 'WHEN_NEEDED' });
  assert.deepEqual(await (await get('OTHER')).json(), { profile: null, recommendedPolicy: 'WHEN_NEEDED' });
  assert.equal((await get('')).status, 400);
});
test('T10 profile repository normalizes SQL numeric, JSON, time and instant fields', async () => {
  const row = { city_code: 'TOKYO', country: 'JP', currency: 'JPY', transit_coverage: 'テスト', transit_hours: null,
    taxi_base_fare: '100.25', taxi_fare_per_km: '20', taxi_fare_per_minute: null, night_surcharge: '0.2',
    night_start: '22:00:00', night_end: '05:00:00', call_buffer_minutes: 10, efficiency_threshold: '30',
    ride_hailing_apps: ['test'], source: 'https://example.test', updated_at: new Date('2026-11-18T00:00:00Z') };
  const db = { query: async (_sql: string, values: string[]) => ({ rows: values[0] === 'TOKYO' ? [row] : [] }) } as unknown as Pick<Pool, 'query'>;
  const repository = cityProfileRepository(db);
  const profile = await repository.findByCityCode('TOKYO');
  assert.equal(profile?.taxiBaseFare, 100.25); assert.equal(profile?.nightStart, '22:00'); assert.equal(profile?.taxiFarePerMinute, null);
  assert.equal(await repository.findByCityCode('UNKNOWN'), null);
  row.taxi_base_fare = 'NaN'; await assert.rejects(repository.findByCityCode('TOKYO'));
  row.taxi_base_fare = '100'; row.night_start = '22:00:01'; await assert.rejects(repository.findByCityCode('TOKYO'));
});
