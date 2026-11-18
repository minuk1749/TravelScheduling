import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Pool } from 'pg';
import { withDatabase } from './helpers/database';
import { migrate } from '../src/lib/migrations';
import { insertTrip } from '../src/repositories/trip-inputs';
import { LivingSettingsRepository } from '../src/repositories/living-settings';
import { LivingSettingsService } from '../src/settings/service';
import { SettingsError } from '../src/settings/model';
import { tripDraft } from './fixtures/trip-input';

test('T11 DB round trip, atomic rollback, ownership, stale update and fixed constraint preservation', async () => {
  await withDatabase(async (client, schema) => {
    await migrate(client);
    const owner = randomUUID();
    await client.query('INSERT INTO users (id,google_id,email) VALUES ($1,$1,$2)', [owner, 'settings@example.test']);
    const id = await insertTrip(client, owner, tripDraft);
    await client.query(`UPDATE trip_places SET fixed_date='2026-12-02', fixed_time='10:00', fixed_order=0 WHERE trip_id=$1 AND kind='ATTRACTION'`, [id]);
    const fixedBefore = (await client.query('SELECT * FROM trip_places WHERE trip_id=$1 ORDER BY id', [id])).rows;
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema}` });
    try {
      const repository = new LivingSettingsRepository(pool), service = new LivingSettingsService(repository);
      const initial = (await service.load(id, owner)).snapshot;
      assert.equal(initial.settings.departureTime, '09:00'); assert.equal(initial.fixedVisits.length, 1);
      const draft = structuredClone(initial.settings);
      draft.taxiPolicy = 'NEVER'; draft.departureTime = '10:00';
      draft.days = [
        { date: '2026-12-01', departureTime: null, returnTime: null, mealSlots: [] },
        { date: '2026-12-02', departureTime: '11:00', returnTime: null, mealSlots: null },
      ];
      const saved = await service.save(id, owner, { revision: initial.revision, settings: draft });
      assert.ok(saved.calculation.conflicts.some(conflict => conflict.visitId === initial.fixedVisits[0].id));
      assert.deepEqual((await service.load(id, owner)).snapshot, saved.snapshot);
      const storedDays = (await client.query('SELECT meal_slots, created_at FROM day_settings WHERE trip_id=$1 ORDER BY date', [id])).rows;
      assert.deepEqual(storedDays.map(row => row.meal_slots), [[], null]);
      assert.deepEqual((await client.query('SELECT * FROM trip_places WHERE trip_id=$1 ORDER BY id', [id])).rows, fixedBefore);
      const denied = (status: number) => (error: unknown) => error instanceof SettingsError && error.status === status;
      await assert.rejects(repository.load(id, 'other'), denied(403));
      await assert.rejects(repository.load('not-a-uuid', owner), denied(404));
      await assert.rejects(repository.save(id, 'other', saved.snapshot.revision, draft), denied(403));
      await assert.rejects(repository.save(id, owner, initial.revision, draft), denied(409));
      const invalid = structuredClone(draft); invalid.taxiPolicy = 'PREFER'; invalid.days.push(invalid.days[0]);
      await assert.rejects(repository.save(id, owner, saved.snapshot.revision, invalid));
      assert.deepEqual((await repository.load(id, owner)), saved.snapshot); // parent + children rolled back
      draft.days[1].departureTime = null;
      const restored = await repository.save(id, owner, saved.snapshot.revision, draft);
      const created = (await client.query('SELECT created_at FROM day_settings WHERE trip_id=$1 ORDER BY date', [id])).rows;
      assert.deepEqual(created.map(row => row.created_at), storedDays.map(row => row.created_at));
      assert.equal(restored.settings.days[1].departureTime, null);
      // Only one concurrent edit based on the same revision may win.
      const results = await Promise.allSettled([
        repository.save(id, owner, restored.revision, { ...draft, taxiPolicy: 'PREFER' }),
        repository.save(id, owner, restored.revision, { ...draft, taxiPolicy: 'WHEN_NEEDED' }),
      ]);
      assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
      const rejected = results.find(result => result.status === 'rejected');
      assert.ok(rejected?.status === 'rejected' && denied(409)(rejected.reason));
      const latest = await repository.load(id, owner);
      await repository.save(id, owner, latest.revision, { ...draft, days: [] });
      assert.equal((await client.query('SELECT * FROM day_settings WHERE trip_id=$1', [id])).rowCount, 0);
      // Normalize legacy window arrays, but never reinterpret arbitrary slot sets as meal counts.
      await client.query(`UPDATE trips SET meal_windows=jsonb_set(meal_windows, '{LUNCH}', '["11:30","14:00"]') WHERE id=$1`, [id]);
      assert.deepEqual((await repository.load(id, owner)).settings.mealWindows.LUNCH, { start: '11:30', end: '14:00' });
      await client.query(`UPDATE trips SET default_meal_slots='["DINNER"]' WHERE id=$1`, [id]);
      await assert.rejects(repository.load(id, owner), denied(409));
    } finally { await pool.end(); }
  });
});
