import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateSettings } from '../src/settings/calculate';
import { countForSlots, parseSettings } from '../src/settings/input';
import { TripInputError } from '../src/trips/input';
import { mealSlotsForCount } from '../src/scheduler';
import { settingsSnapshot as initial } from './fixtures/living-settings';

test('T11 settings changes recalculate activity, meals, null inheritance, explicit zero and airport buffers', () => {
  const settings = structuredClone(initial.settings);
  settings.days = [
    { date: '2026-12-01', departureTime: null, returnTime: null, mealSlots: [] },
    { date: '2026-12-02', departureTime: '08:00', returnTime: '19:00', mealSlots: ['BREAKFAST', 'LUNCH', 'DINNER'] },
    { date: '2026-12-03', departureTime: null, returnTime: null, mealSlots: null },
  ];
  const calculated = calculateSettings(initial, parseSettings(settings, initial));
  assert.deepEqual(calculated.days[0].result.available, { start: '2026-12-01T01:30:00Z', end: '2026-12-01T12:00:00Z' });
  assert.deepEqual(calculated.days[0].result.meals, []);
  assert.deepEqual(calculated.days[1].result.available, { start: '2026-12-01T23:00:00Z', end: '2026-12-02T10:00:00Z' });
  assert.deepEqual(calculated.days[1].result.meals.map(meal => meal.slot), ['BREAKFAST', 'LUNCH', 'DINNER']);
  assert.equal(calculated.days[2].result.available?.end, '2026-12-03T06:30:00Z');
  assert.deepEqual(calculated.days[2].result.meals.map(meal => meal.slot), ['LUNCH', 'DINNER']);
  settings.mealWindows.LUNCH = { start: '12:00', end: '13:00' };
  const changed = calculateSettings(initial, parseSettings(settings, initial));
  assert.deepEqual(changed.days[1].result.meals[1].window, { start: '2026-12-02T03:00:00Z', end: '2026-12-02T04:00:00Z' });
  for (const policy of ['NEVER', 'WHEN_NEEDED', 'PREFER'] as const) {
    settings.taxiPolicy = policy;
    assert.equal(calculateSettings(initial, parseSettings(settings, initial)).taxiPolicy, policy);
  }
  for (const count of [0, 1, 2, 3] as const) assert.equal(countForSlots(mealSlotsForCount(count)), count);
});

test('T11 fixed time/duration conflict appears on edit, disappears on correction, and never moves fixed items', () => {
  const context = structuredClone(initial), before = structuredClone(context);
  const settings = structuredClone(context.settings);
  const fixedConflicts = () => calculateSettings(context, parseSettings(settings, context)).conflicts.filter(issue => issue.visitId);
  assert.equal(fixedConflicts().length, 0);
  settings.days = [{ date: '2026-12-02', departureTime: '10:01', returnTime: null, mealSlots: null }];
  assert.equal(fixedConflicts()[0].visitId, 'fixed-museum');
  settings.days[0].departureTime = '10:00'; settings.days[0].returnTime = '10:59';
  assert.equal(fixedConflicts().length, 1);
  settings.days[0].returnTime = '11:00';
  assert.equal(fixedConflicts().length, 0); // exact boundary is permitted
  assert.deepEqual(context, before);
  settings.days = []; settings.departureTime = '11:00';
  assert.equal(fixedConflicts().length, 1); // changing inherited defaults also checks fixed times
});

test('T11 invalid times, dates, unsupported slot sets, forged context and DST are rejected', () => {
  const invalid = (patch: object) => assert.throws(() => parseSettings({ ...initial.settings, ...patch }, initial), TripInputError);
  for (const value of ['24:00', '9:00', '', null, '09:00:30']) invalid({ departureTime: value });
  invalid({ returnTime: '08:00' }); invalid({ taxiPolicy: 'FREE' }); invalid({ mealSlots: ['DINNER'] });
  invalid({ mealSlots: ['LUNCH', 'LUNCH'] }); invalid({ days: null });
  invalid({ days: [{ date: '2027-01-01', departureTime: null, returnTime: null, mealSlots: null }] });
  const day = { date: '2026-12-02', departureTime: null, returnTime: null, mealSlots: null };
  invalid({ days: [day, day] }); invalid({ days: [{ ...day, returnTime: '08:00' }] });
  invalid({ mealWindows: { ...initial.settings.mealWindows, LUNCH: { start: '14:00', end: '11:00' } } });
  const clean = parseSettings({ ...initial.settings, ownerId: 'attacker', timeZone: 'UTC', fixedVisits: [] }, initial);
  assert.deepEqual(clean, initial.settings);
  for (const date of ['2026-03-29', '2026-10-25']) {
    assert.throws(() => parseSettings({ ...initial.settings, departureTime: '02:30' }, { startDate: date, endDate: date, timeZone: 'Europe/Paris' }), TripInputError);
  }
});

test('T11 fixed missing dates, out-of-trip dates, insufficient duration and DST fixed times are explicit conflicts', () => {
  const context = structuredClone(initial);
  context.fixedVisits = [
    { id: 'missing', date: null, time: '10:00', minutes: 60, order: null },
    { id: 'outside', date: '2026-12-05', time: null, minutes: 60, order: null },
    { id: 'long', date: '2026-12-02', time: null, minutes: 800, order: 0 },
  ];
  assert.deepEqual(calculateSettings(context, context.settings).conflicts.filter(c => c.visitId).map(c => c.visitId), ['missing', 'outside', 'long']);
  context.timeZone = 'Europe/Paris'; context.startDate = context.endDate = '2026-10-25'; context.flights = [];
  context.fixedVisits = [{ id: 'dst', date: context.startDate, time: '02:30', minutes: 60, order: null }];
  assert.match(calculateSettings(context, context.settings).conflicts.find(c => c.visitId === 'dst')!.message, /유효하지/);
});
