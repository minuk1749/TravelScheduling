import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Pool } from 'pg';
import { defaultLivingSettings } from '@travel/core/contracts/settings/defaults';
import { migrate } from '../src/lib/migrations';
import { LivingSettingsRepository } from '../src/repositories/living-settings';
import { tripInputRepository } from '../src/repositories/trip-inputs';
import { tripHandlers, tripListHandler } from '../src/trips/http';
import { tripDraft } from './fixtures/trip-input';
import { withDatabase } from './helpers/database';

const url = 'https://travel.example.test/api/trips';
const post = (body: unknown) => new Request(url, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

test('initial settings and constraints persist atomically, and the trip list is scoped to its session', async () => {
  await withDatabase(async (client, schema) => {
    await migrate(client);
    const owner = randomUUID(), other = randomUUID();
    await client.query("INSERT INTO users (id,google_id,email) VALUES ($1,'t21-owner','owner@test.example'),($2,'t21-other','other@test.example')", [owner, other]);
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema}` });
    try {
      const repository = tripInputRepository(pool);
      const auth = {
        userId: async (request: Request) => {
          const header = request.headers.get('Authorization');
          return header === 'Bearer owner' ? owner : header === 'Bearer other' ? other : undefined;
        },
      };
      const handlers = tripHandlers({ userId: async () => owner, create: repository.create, profile: async () => null });
      const list = tripListHandler({ ...auth, list: repository.list });
      const settings = { ...defaultLivingSettings('PREFER'), departureTime: '09:30', days: [
        { date: '2026-12-02', departureTime: '10:00', returnTime: null, mealSlots: [] },
      ] };
      const visits = [{ ...tripDraft.visits[0], fixedDate: '2026-12-02', fixedTime: '13:00', fixedOrder: 0,
        place: { name: 'discard provider metadata' } }, tripDraft.visits[1]];
      const input = { ...tripDraft, taxiPolicy: 'PREFER', settings, visits };
      const invalid = await handlers.create(post({ ...input, visits: [{ ...visits[0], fixedDate: null }, visits[1]] }));
      assert.equal(invalid.status, 400);
      const { fields } = await invalid.json();
      assert.ok(fields['visits.0.fixedTime']);
      assert.equal((await client.query('SELECT * FROM trips')).rowCount, 0);

      const response = await handlers.create(post(input));
      assert.equal(response.status, 201);
      const { id } = await response.json();
      const snapshot = await new LivingSettingsRepository(pool).load(id, owner);
      assert.deepEqual(snapshot.settings, settings);
      assert.deepEqual(snapshot.fixedVisits.map(({ date, time, order, minutes }) => ({ date, time, order, minutes })),
        [{ date: '2026-12-02', time: '13:00', order: 0, minutes: 90 }]);
      const places = await client.query('SELECT name FROM places');
      assert.ok(places.rows.every(row => row.name === null));

      await repository.create(other, tripDraft);
      assert.equal((await list(new Request(url))).status, 401);
      const ownerList = await list(new Request(url, { headers: { Authorization: 'Bearer owner' } }));
      assert.equal(ownerList.headers.get('Cache-Control'), 'private, no-store');
      assert.deepEqual(await ownerList.json(), { trips: [{ id, cityCode: 'TOKYO', startDate: '2026-12-01', endDate: '2026-12-03' }] });
    } finally { await pool.end(); }
  });
});
