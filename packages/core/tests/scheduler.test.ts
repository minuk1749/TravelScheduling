import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateDayWindow, mealSlotsForCount, type DayWindowInput } from '../src/scheduler/index';

const day: DayWindowInput = { date: '2026-05-01', timeZone: 'Asia/Tokyo', activity: { start: '09:00', end: '20:00' }, mealCount: 3 };

test('meal counts map to the configured slots and windows are clipped to activity', () => {
  assert.deepEqual([0, 1, 2, 3].map(n => mealSlotsForCount(n as 0 | 1 | 2 | 3)), [[], ['LUNCH'], ['LUNCH', 'DINNER'], ['BREAKFAST', 'LUNCH', 'DINNER']]);
  const result = calculateDayWindow(day);
  assert.deepEqual(result.available, { start: '2026-05-01T00:00:00Z', end: '2026-05-01T11:00:00Z' });
  assert.deepEqual(result.meals.map(m => m.window), [
    { start: '2026-05-01T00:00:00Z', end: '2026-05-01T00:30:00Z' },
    { start: '2026-05-01T02:30:00Z', end: '2026-05-01T05:00:00Z' },
    { start: '2026-05-01T08:30:00Z', end: '2026-05-01T11:00:00Z' },
  ]);
});

test('airport buffers and lodging transfers constrain the same day', () => {
  const result = calculateDayWindow({ ...day, arrival: { localDateTime: '2026-05-01T08:00', travelMinutes: 60, viaLodging: true }, departure: { localDateTime: '2026-05-01T22:00', travelMinutes: 60, viaLodging: true } });
  assert.deepEqual(result.available, { start: '2026-05-01T01:30:00Z', end: '2026-05-01T09:30:00Z' });
  assert.deepEqual(result.airportTransfers, [
    { direction: 'arrival', start: '2026-05-01T00:30:00Z', end: '2026-05-01T01:30:00Z', viaLodging: true },
    { direction: 'departure', start: '2026-05-01T09:30:00Z', end: '2026-05-01T10:30:00Z', viaLodging: true },
  ]);
  assert.equal(result.meals[0].window, null);
});

test('direct airport transfer, custom buffers and meal windows are respected', () => {
  const result = calculateDayWindow({ ...day, mealCount: 1, mealWindows: { BREAKFAST: { start: '07:00', end: '08:00' }, LUNCH: { start: '10:00', end: '12:00' }, DINNER: { start: '18:00', end: '19:00' } }, arrival: { localDateTime: '2026-05-01T09:00', immigrationMinutes: 30, travelMinutes: 60, viaLodging: false } });
  assert.deepEqual(result.meals[0], { slot: 'LUNCH', window: { start: '2026-05-01T01:30:00Z', end: '2026-05-01T03:00:00Z' } });
  assert.equal(result.airportTransfers[0].viaLodging, false);
});

test('infeasible windows remain empty and invalid local times are rejected', () => {
  const result = calculateDayWindow({ ...day, arrival: { localDateTime: '2026-05-01T19:00', travelMinutes: 60, viaLodging: true } });
  assert.equal(result.available, null);
  assert.ok(result.meals.every(m => m.window === null));
  assert.throws(() => calculateDayWindow({ ...day, timeZone: 'America/New_York', date: '2026-03-08', activity: { start: '02:30', end: '05:00' } }), RangeError);
  assert.throws(() => calculateDayWindow({ ...day, arrival: { localDateTime: '2026-05-02T08:00', travelMinutes: 0, viaLodging: true } }), RangeError);
  assert.throws(() => calculateDayWindow({ ...day, departure: { localDateTime: '2026-05-01T22:00', travelMinutes: -1, viaLodging: false } }), RangeError);
});
