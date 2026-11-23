import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { withDatabase } from './helpers/database';
import { migrate, readMigrations } from '../src/lib/migrations';
import { insertTrip } from '../src/repositories/trip-inputs';
import { loadTripInputs } from '../src/repositories/trip-snapshot';
import { loadConstraintInputs, saveConstraints } from '../src/repositories/itinerary-constraints';
import { saveItinerary } from '../src/repositories/itineraries';
import { constraintsFrom } from '../src/results/model';
import { sampleDraft } from './fixtures/itinerary';
import { service } from './helpers/itinerary-service';

test('T13 SQL constraints persist across generation; stale/foreign writes are atomic and hash protects generation', async () => {
  await withDatabase(async client => {
    await migrate(client);
    const user = randomUUID();
    await client.query("INSERT INTO users (id, google_id, email) VALUES ($1, $2, 't13@example.test')", [user, user]);
    const id = await insertTrip(client, user, sampleDraft());
    const loaded = await loadTripInputs(client, id); assert.ok(loaded?.status === 'READY');
    const originalResult = await service().service.compute(loaded.input);
    const draft = constraintsFrom(loaded.input);
    const wish = loaded.input.visits.find(v => v.priority === 'WISH')!;
    Object.assign(draft.visits.find(v => v.id === wish.id)!, { fixedDate: '2026-12-02', fixedTime: '15:00', fixedOrder: 1 });
    const airport = loaded.input.flights[0].airport.id, hotel = loaded.input.lodgings[0].place.id;
    draft.legModes = [{ date: loaded.input.startDate, from: airport, to: hotel, mode: 'TRANSIT' }];
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

test('only the current operation can prove its commit, including a retry or undo after an equal-hash write', async () => {
  await withDatabase(async (client, schema, pool) => {
    const migrations = await readMigrations();
    await migrate(client, migrations.slice(0, 7));
    const owner = randomUUID();
    await client.query("INSERT INTO users (id,google_id,email) VALUES ($1,$2,'receipt@example.test')", [owner, owner]);
    const id = await insertTrip(client, owner, sampleDraft());
    const legacy = await loadTripInputs(client, id);
    assert.ok(legacy?.status === 'READY');
    await migrate(client);
    const read = (operationId?: string) => loadConstraintInputs(client, id, owner, operationId);
    const initial = await read();
    assert.ok(initial?.status === 'READY' && initial.writeVersion);
    assert.equal(initial.inputHash, legacy.inputHash);
    assert.equal(initial.receipt, undefined);
    const original = constraintsFrom(initial.input), change = structuredClone(original);
    change.visits[0].fixedDate = initial.input.startDate;
    const a = randomUUID(), b = randomUUID();
    const first = await saveConstraints(client, id, owner, initial.inputHash, change, { operationId: a, expectedWriteVersion: initial.writeVersion });
    assert.ok(first?.writeVersion);
    assert.notEqual(first.writeVersion, initial.writeVersion);
    assert.deepEqual(first.receipt, { operationId: a, revision: first.revision });
    assert.deepEqual((await read(a))?.receipt, first.receipt);
    assert.equal((await read(b))?.receipt, undefined);
    assert.equal((await read())?.receipt, undefined);
    for (const operation of [undefined, a]) {
      assert.equal(await loadConstraintInputs(client, id, randomUUID(), operation), null);
      assert.equal(await loadConstraintInputs(client, randomUUID(), owner, operation), null);
    }
    const otherTrip = await insertTrip(client, owner, sampleDraft());
    assert.equal((await loadConstraintInputs(client, otherTrip, owner, a))?.receipt, undefined);
    await saveItinerary(client, id, first.revision, await service().service.compute(first.input));
    await client.query('UPDATE trips SET share_token=$2 WHERE id=$1', [id, randomUUID()]);
    assert.deepEqual((await read(a))?.receipt, first.receipt, 'sharing and generation preserve the evidence');

    const same = await saveConstraints(client, id, owner, first.revision, change, { operationId: b, expectedWriteVersion: first.writeVersion });
    assert.ok(same?.writeVersion);
    assert.equal(same.revision, first.revision);
    assert.equal((await read(a))?.receipt, undefined);
    assert.deepEqual((await read(b))?.receipt, same.receipt);
    assert.equal(await saveConstraints(client, id, owner, same.revision, original, { expectedOperationId: a }), null);
    assert.equal(await saveConstraints(client, id, owner, same.revision, original, { expectedWriteVersion: first.writeVersion }), null);
    const restored = await saveConstraints(client, id, owner, same.revision, original, { operationId: randomUUID(), expectedOperationId: b });
    assert.ok(restored?.writeVersion);
    assert.equal(restored.revision, initial.inputHash);
    assert.equal(await saveConstraints(client, id, owner, initial.inputHash, change, { operationId: a, expectedWriteVersion: initial.writeVersion }), null);

    // Even with unchanged inputs, queued writers cannot both claim the generation they first observed.
    const second = await pool.connect();
    try {
      await second.query(`SET search_path TO ${schema}`);
      const results = await Promise.all([client, second].map(connection => saveConstraints(connection, id, owner, restored.revision, original,
        { operationId: randomUUID(), expectedWriteVersion: restored.writeVersion })));
      const winner = results.find(result => result !== null);
      assert.ok(winner?.receipt);
      assert.equal(results.filter(result => result !== null).length, 1);
      assert.deepEqual((await read(winner.receipt.operationId))?.receipt, winner.receipt);
      // A legacy constraints writer cannot acknowledge its predecessor, even when it saved identical values.
      const oldClient = await saveConstraints(client, id, owner, winner.revision, original);
      assert.ok(oldClient?.writeVersion);
      assert.notEqual(oldClient.writeVersion, winner.writeVersion);
      assert.equal((await read(winner.receipt.operationId))?.receipt, undefined);
    } finally { second.release(); }
    const settingsProof = randomUUID();
    const beforeSettings = await saveConstraints(client, id, owner, restored.revision, original, { operationId: settingsProof });
    assert.ok(beforeSettings);
    await client.query('UPDATE trips SET default_departure_time=default_departure_time WHERE id=$1', [id]);
    const afterSettings = await read(settingsProof);
    assert.equal(afterSettings?.receipt, undefined);
    assert.notEqual(afterSettings?.writeVersion, beforeSettings.writeVersion);
  });
});
