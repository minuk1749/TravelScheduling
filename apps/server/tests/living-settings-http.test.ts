import assert from 'node:assert/strict';
import { test } from 'node:test';
import { settingsHandlers } from '../src/settings/http';
import { LivingSettingsService } from '../src/settings/service';
import { SettingsError, type LivingSettings, type SettingsSnapshot } from '../src/settings/model';
import type { LivingSettingsStore } from '../src/repositories/living-settings';
import { settingsSnapshot } from './fixtures/living-settings';

class MemorySettingsStore implements LivingSettingsStore {
  private snapshot = structuredClone(settingsSnapshot);
  writes = 0;
  async load(id: string, owner: string): Promise<SettingsSnapshot> {
    if (id !== 'trip') throw new SettingsError(404, '여행 없음');
    if (owner !== 'owner') throw new SettingsError(403, '접근 불가');
    return structuredClone(this.snapshot);
  }
  async save(id: string, owner: string, expected: string, settings: LivingSettings) {
    const current = await this.load(id, owner);
    if (current.revision !== expected) throw new SettingsError(409, '변경 충돌', 'STALE_INPUT');
    this.snapshot = { ...current, settings: structuredClone(settings), revision: String(++this.writes) };
    return structuredClone(this.snapshot);
  }
}
const request = (body?: unknown, headers: Record<string, string> = {}) => new Request('http://localhost/api/trips/trip/settings',
  body === undefined ? {} : { method: 'PUT', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('T11 authenticated settings round trip returns recalculated conflicts, retains fixed visits, rejects stale edits', async () => {
  const store = new MemorySettingsStore(), service = new LivingSettingsService(store);
  const handle = settingsHandlers({ userId: async () => 'owner', service });
  const get = await handle(request(), 'trip'); assert.equal(get.status, 200); assert.equal(get.headers.get('cache-control'), 'private, no-store');
  const loaded = await get.json();
  loaded.snapshot.settings.days = [{ date: '2026-12-02', departureTime: '11:00', returnTime: null, mealSlots: [] }];
  const body = { revision: loaded.snapshot.revision, settings: loaded.snapshot.settings, ownerId: 'forged', fixedVisits: [] };
  const saved = await handle(request(body), 'trip'); assert.equal(saved.status, 200);
  const result = await saved.json(); assert.equal(result.calculation.conflicts.find((c: { visitId?: string }) => c.visitId)?.visitId, 'fixed-museum');
  assert.deepEqual(result.snapshot.fixedVisits, settingsSnapshot.fixedVisits);
  assert.deepEqual((await (await handle(request(), 'trip')).json()).snapshot, result.snapshot);
  // T18: the real service's revision check (not the store) rejects the stale edit with STALE_INPUT before writing.
  const stale = await handle(request(body), 'trip');
  assert.equal(stale.status, 409); assert.equal((await stale.json()).code, 'STALE_INPUT'); assert.equal(store.writes, 1);
  result.snapshot.settings.days = [];
  const corrected = await handle(request({ revision: result.snapshot.revision, settings: result.snapshot.settings }), 'trip');
  assert.equal((await corrected.json()).calculation.conflicts.filter((c: { visitId?: string }) => c.visitId).length, 0);
});

test('T11 HTTP blocks anonymous/foreign writes, invalid input/JSON/CSRF and masks internal failures', async () => {
  const store = new MemorySettingsStore(), service = new LivingSettingsService(store);
  let owner: string | undefined;
  const handle = settingsHandlers({ userId: async () => owner, service });
  const body = { revision: 'initial', settings: settingsSnapshot.settings };
  assert.equal((await handle(request(body), 'trip')).status, 401);
  owner = 'intruder'; assert.equal((await handle(request(), 'trip')).status, 403); assert.equal((await handle(request(body), 'trip')).status, 403);
  owner = 'owner'; assert.equal((await handle(request(), 'missing')).status, 404);
  assert.equal((await handle(request(body, { Origin: 'https://evil.example' }), 'trip')).status, 403);
  assert.equal((await handle(request(body, { 'Sec-Fetch-Site': 'cross-site' }), 'trip')).status, 403);
  assert.equal((await handle(request(body, { 'Content-Type': 'text/plain' }), 'trip')).status, 415);
  assert.equal((await handle(request({ ...body, settings: { ...body.settings, returnTime: '01:00' } }), 'trip')).status, 400);
  assert.equal((await handle(request({}), 'trip')).status, 400);
  assert.equal((await handle(request('x'.repeat(30_001)), 'trip')).status, 413);
  const badJson = new Request(request().url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{' });
  assert.equal((await handle(badJson, 'trip')).status, 400); assert.equal(store.writes, 0);
  const unavailable = settingsHandlers({ userId: async () => { throw new Error('secret DB details'); }, service });
  const failure = await unavailable(request(), 'trip'); assert.equal(failure.status, 500); assert.doesNotMatch(await failure.text(), /secret/);
});
