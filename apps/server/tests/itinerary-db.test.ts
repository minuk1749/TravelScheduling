import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Pool, type PoolClient } from 'pg';
import { migrate } from '../src/lib/migrations';
import { PostgresItineraryRepository, saveItinerary } from '../src/repositories/itineraries';
import { insertTrip } from '../src/repositories/trip-inputs';
import { loadTripInputs } from '../src/repositories/trip-snapshot';
import { ItineraryService, type ItineraryRepository } from '../src/services/itinerary';
import type { TripDraft } from '../src/trips/input';
import { cityProfile } from './fixtures/trip-input';
import { FixturePlaces, FixtureTravel, okVisits, samplePlaces } from './fixtures/itinerary';
import { seedTravelGraph, withDatabase } from './helpers/database';

/** The Tokyo sample entered through the T10 creation path. */
const draft: TripDraft = {
  cityCode: 'TOKYO', timeZone: 'Asia/Tokyo', startDate: '2026-12-01', endDate: '2026-12-03',
  taxiPolicy: 'WHEN_NEEDED', luggageOption: 'VIA_LODGING',
  flights: [
    { direction: 'ARRIVAL', googlePlaceId: samplePlaces.airport.googlePlaceId, localDateTime: '2026-12-01T09:00' },
    { direction: 'DEPARTURE', googlePlaceId: samplePlaces.airport.googlePlaceId, localDateTime: '2026-12-03T18:00' },
  ],
  lodgings: [{ googlePlaceId: samplePlaces.hotel.googlePlaceId, checkIn: '2026-12-01', checkOut: '2026-12-03' }],
  visits: okVisits.map(visit => ({
    googlePlaceId: samplePlaces[visit.key].googlePlaceId, kind: visit.key === 'tsukiji' ? 'RESTAURANT' : 'ATTRACTION',
    minutes: visit.minutes, priority: visit.priority ?? 'REQUIRED',
  })),
};

async function seedTrip(client: PoolClient, changes: Partial<TripDraft> = {}) {
  const owner = randomUUID();
  await client.query("INSERT INTO users (id, google_id, email) VALUES ($1, $2, 't12@example.test')", [owner, owner]);
  return insertTrip(client, owner, { ...draft, ...changes });
}

const clientRepository = (client: PoolClient): ItineraryRepository => ({
  loadInputs: tripId => loadTripInputs(client, tripId),
  saveItinerary: (tripId, hash, result) => saveItinerary(client, tripId, hash, result),
});
const service = (repository: ItineraryRepository) => new ItineraryService({
  repository, profiles: { findByCityCode: async () => cityProfile }, places: new FixturePlaces(), travel: new FixtureTravel(),
});

test('T12 snapshot loader converts SQL rows and reports incomplete legacy trips', async () => {
  await withDatabase(async client => {
    await migrate(client);
    const tripId = await seedTrip(client);
    const load = await loadTripInputs(client, tripId);
    assert.equal(load?.status, 'READY');
    assert.ok(load.status === 'READY');
    const { input } = load;
    assert.deepEqual([input.activity, input.mealSlots, input.mealWindows.DINNER], [{ start: '09:00', end: '21:00' }, ['LUNCH', 'DINNER'], { start: '17:30', end: '20:30' }]);
    assert.deepEqual(input.flights.map(flight => [flight.direction, flight.localDateTime, flight.airport.googlePlaceId]), [
      ['ARRIVAL', '2026-12-01T09:00', samplePlaces.airport.googlePlaceId], ['DEPARTURE', '2026-12-03T18:00', samplePlaces.airport.googlePlaceId],
    ]);
    assert.equal(input.visits.find(visit => visit.place.googlePlaceId === samplePlaces.teamlab.googlePlaceId)?.priority, 'WISH');
    assert.equal((await loadTripInputs(client, tripId) as typeof load).inputHash, load.inputHash, 'stable hash');

    await client.query(`INSERT INTO day_settings (trip_id, date, departure_time, meal_slots) VALUES ($1, '2026-12-02', '10:00', '["BREAKFAST","LUNCH","DINNER"]')`, [tripId]);
    await client.query(`UPDATE trip_places SET fixed_date = '2026-12-02', fixed_time = '15:00', fixed_order = 0
      WHERE trip_id = $1 AND kind = 'RESTAURANT'`, [tripId]);
    const changed = await loadTripInputs(client, tripId);
    assert.ok(changed?.status === 'READY' && changed.inputHash !== load.inputHash);
    assert.deepEqual(changed.input.daySettings, [{ date: '2026-12-02', departureTime: '10:00', returnTime: null, mealSlots: ['BREAKFAST', 'LUNCH', 'DINNER'] }]);
    assert.deepEqual(changed.input.visits.filter(visit => visit.fixedDate).map(visit => [visit.fixedDate, visit.fixedTime, visit.fixedOrder]), [['2026-12-02', '15:00', 0]]);

    await client.query("UPDATE trip_places SET fixed_time = '15:00:30' WHERE trip_id = $1 AND kind = 'RESTAURANT'", [tripId]);
    const seconds = await loadTripInputs(client, tripId);
    assert.ok(seconds?.status === 'INCOMPLETE' && seconds.fields.length === 1 && seconds.fields[0].startsWith('visits.'));

    const legacy = await seedTravelGraph(client, false);
    const incomplete = await loadTripInputs(client, legacy.trip);
    assert.ok(incomplete?.status === 'INCOMPLETE');
    for (const field of ['cityCode', 'timeZone', 'startDate', 'activity', 'mealWindows', 'taxiPolicy', 'luggageOption']) {
      assert.ok(incomplete.fields.includes(field), field);
    }
    assert.equal(await loadTripInputs(client, randomUUID()), null);
  });
});

test('T12 Tokyo sample is generated and saved with day plans, stops and compared legs', async () => {
  await withDatabase(async client => {
    await migrate(client);
    const tripId = await seedTrip(client);
    const outcome = await service(clientRepository(client)).generate(tripId);
    assert.equal(outcome.status, 'SAVED');
    assert.ok(outcome.status === 'SAVED');
    assert.equal(outcome.result.status, 'OK');
    const itinerary = (await client.query('SELECT * FROM itineraries WHERE id = $1', [outcome.itineraryId])).rows[0];
    assert.equal(itinerary.status, 'OK');
    assert.equal(itinerary.efficiency_summary.currency, 'JPY');
    assert.equal(itinerary.details.schedule, 'FULL');
    assert.equal(itinerary.details.verification.verified, true);
    assert.equal(itinerary.details.transfers.length, 2);
    const stops = (await client.query(`SELECT s.* FROM stops s JOIN day_plans d ON d.id = s.day_plan_id
      WHERE d.itinerary_id = $1 ORDER BY d.date, s.position`, [outcome.itineraryId])).rows;
    const visits = stops.filter(stop => stop.kind === 'VISIT');
    assert.equal(visits.length, 6);
    assert.ok(visits.every(stop => stop.trip_place_id && stop.place_id && stop.meal_slot === null && stop.arrival_time < stop.departure_time));
    assert.ok(stops.some(stop => stop.kind === 'MEAL' && stop.meal_slot === 'LUNCH' && stop.trip_place_id === null));
    const legs = (await client.query(`SELECT l.* FROM legs l JOIN day_plans d ON d.id = l.day_plan_id WHERE d.itinerary_id = $1`, [outcome.itineraryId])).rows;
    assert.equal(legs.length, outcome.result.comparisons.filter(leg => leg.kind === 'DAY').length);
    assert.ok(legs.every(leg => leg.from_place_id && leg.to_place_id && leg.departure_time <= leg.arrival_time && leg.alternatives.options.TAXI));
    assert.equal((await client.query('SELECT * FROM day_plans WHERE itinerary_id = $1', [outcome.itineraryId])).rowCount, 3);

    // Over-capacity and conflict results are saved too; only verified plans get day rows.
    await client.query("UPDATE trip_places SET duration_minutes = 300 WHERE trip_id = $1", [tripId]);
    const over = await service(clientRepository(client)).generate(tripId);
    assert.ok(over.status === 'SAVED' && over.result.status === 'OVER_CAPACITY');
    const overRow = (await client.query('SELECT * FROM itineraries WHERE id = $1', [over.itineraryId])).rows[0];
    assert.equal(overRow.details.schedule, 'RECOMMENDATION');
    assert.ok(overRow.unplaced.length > 0 && overRow.details.recommendation.requiredCount < 6);
    await client.query(`UPDATE trip_places tp SET duration_minutes = 90, fixed_date = '2026-12-02', fixed_time = '19:00'
      FROM places p WHERE p.id = tp.place_id AND tp.trip_id = $1 AND p.google_place_id = $2`, [tripId, samplePlaces.sensoji.googlePlaceId]);
    const conflict = await service(clientRepository(client)).generate(tripId);
    assert.ok(conflict.status === 'SAVED' && conflict.result.status === 'CONFLICT');
    assert.equal((await client.query('SELECT * FROM day_plans WHERE itinerary_id = $1', [conflict.itineraryId])).rowCount, 0);
    const latest = (await client.query('SELECT id FROM itineraries WHERE trip_id = $1 ORDER BY generation DESC LIMIT 1', [tripId])).rows[0];
    assert.equal(latest.id, conflict.itineraryId);
  });
});

test('T12 saving after the inputs changed returns STALE and writes nothing', async () => {
  await withDatabase(async client => {
    await migrate(client);
    const tripId = await seedTrip(client);
    const load = await loadTripInputs(client, tripId);
    assert.ok(load?.status === 'READY');
    const result = await service(clientRepository(client)).compute(load.input);
    await client.query("INSERT INTO day_settings (trip_id, date, return_time) VALUES ($1, '2026-12-02', '19:00')", [tripId]);
    assert.deepEqual(await saveItinerary(client, tripId, load.inputHash, result), { status: 'STALE' });
    assert.deepEqual(await saveItinerary(client, randomUUID(), load.inputHash, result), { status: 'STALE' });
    assert.equal((await client.query('SELECT * FROM itineraries')).rowCount, 0);
    const fresh = await loadTripInputs(client, tripId);
    assert.ok(fresh?.status === 'READY');
    assert.equal((await saveItinerary(client, tripId, fresh.inputHash, await service(clientRepository(client)).compute(fresh.input))).status, 'SAVED');
  });
});

test('T12 pooled repository loads a consistent snapshot and saves through its own connections', async () => {
  await withDatabase(async (client, schema) => {
    await migrate(client);
    const tripId = await seedTrip(client);
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema}`, max: 2 });
    try {
      const outcome = await service(new PostgresItineraryRepository(pool)).generate(tripId);
      assert.ok(outcome.status === 'SAVED' && outcome.result.status === 'OK');
      assert.equal((await client.query('SELECT * FROM itineraries WHERE trip_id = $1', [tripId])).rowCount, 1);
    } finally {
      await pool.end();
    }
  });
});
