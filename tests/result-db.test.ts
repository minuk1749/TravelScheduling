import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { withDatabase } from './helpers/database';
import { migrate } from '../src/lib/migrations';
import { insertTrip } from '../src/repositories/trip-inputs';
import { loadTripInputs } from '../src/repositories/trip-snapshot';
import { saveConstraints } from '../src/repositories/itinerary-constraints';
import { saveItinerary } from '../src/repositories/itineraries';
import { constraintsFrom } from '../src/results/model';
import { sampleTrip } from './fixtures/itinerary';
import { service } from './helpers/itinerary-service';

test('T13 SQL constraints persist across generation; stale/foreign writes are atomic and hash protects generation', async () => {
  await withDatabase(async client => {
    await migrate(client);
    const user = randomUUID();
    await client.query("INSERT INTO users (id, google_id, email) VALUES ($1, $1, 't13@example.test')", [user]);
    const input = sampleTrip();
    const id = await insertTrip(client, user, { ...input,
      flights: input.flights.map(f => ({ direction: f.direction, localDateTime: f.localDateTime, googlePlaceId: f.airport.googlePlaceId })),
      lodgings: input.lodgings.map(l => ({ checkIn: l.checkIn, checkOut: l.checkOut, googlePlaceId: l.place.googlePlaceId })),
      visits: input.visits.map(v => ({ googlePlaceId: v.place.googlePlaceId, kind: v.kind, minutes: v.minutes, priority: v.priority })),
    });
    const loaded = await loadTripInputs(client, id); assert.ok(loaded?.status === 'READY');
    const originalResult = await service().service.compute(loaded.input);
    const draft = constraintsFrom(loaded.input);
    const wish = loaded.input.visits.find(v => v.priority === 'WISH')!;
    Object.assign(draft.visits.find(v => v.id === wish.id)!, { fixedDate: '2026-12-02', fixedTime: '15:00', fixedOrder: 1 });
    const airport = loaded.input.flights[0].airport.id, hotel = loaded.input.lodgings[0].place.id;
    draft.legModes = [{ date: input.startDate, from: airport, to: hotel, mode: 'TRANSIT' }];
    assert.equal(await saveConstraints(client, id, randomUUID(), loaded.inputHash, draft), null);
    const saved = await saveConstraints(client, id, user, loaded.inputHash, draft); assert.ok(saved);
    assert.notEqual(saved.revision, loaded.inputHash);
    assert.equal(await saveConstraints(client, id, user, loaded.inputHash, constraintsFrom(loaded.input)), null);
    assert.deepEqual(await saveItinerary(client, id, loaded.inputHash, originalResult), { status: 'STALE' });
    for (let i = 0; i < 2; i++) {
      const current = await loadTripInputs(client, id); assert.ok(current?.status === 'READY');
      assert.deepEqual(constraintsFrom(current.input), draft);
      const result = await service().service.compute(current.input);
      assert.equal(result.status, 'OK');
      assert.equal((await saveItinerary(client, id, current.inputHash, result)).status, 'SAVED');
      assert.ok(result.comparisons.some(l => l.from === airport && l.selected.mode === 'TRANSIT' && l.selected.fixed));
    }
    const malicious = structuredClone(draft); malicious.visits[0].id = randomUUID();
    await assert.rejects(saveConstraints(client, id, user, saved.revision, malicious));
    const after = await loadTripInputs(client, id); assert.ok(after?.status === 'READY');
    assert.deepEqual(constraintsFrom(after.input), draft);
  });
});
