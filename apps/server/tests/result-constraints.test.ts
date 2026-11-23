import assert from 'node:assert/strict';
import { test } from 'node:test';
import { constraintsFrom } from '../src/results/model';
import { parseConstraints } from '../src/results/input';
import { TripInputError } from '../src/trips/input';
import { sampleTrip, FixturePlaces, okVisits } from './fixtures/itinerary';
import { service } from './helpers/itinerary-service';
import { ResultEditService, ResultStaleError, type ConstraintRepository } from '../src/services/itinerary/editing';
import { mapMarkers, localDateTime, localTime, money } from '../src/results/presentation';
import { inputHash } from '../src/repositories/trip-snapshot';
import { applyEdits } from './helpers/result';

test('T13 constraints reject foreign/duplicate IDs, dates, invalid order, DST and modes', () => {
  const input = sampleTrip(), valid = constraintsFrom(input);
  assert.deepEqual(parseConstraints(valid, input), valid);
  const bad = (value: unknown, trip = input) => assert.throws(() => parseConstraints(value, trip), TripInputError);
  bad({ ...valid, visits: [] }); bad({ ...valid, visits: valid.visits.map(v => ({ ...v, id: 'foreign' })) });
  for (const edit of [{ fixedDate: '2026-11-30' }, { fixedDate: '2026-12-02', fixedTime: '25:00' }, { fixedTime: '12:00' }, { fixedOrder: -1 }, { fixedDate: '2026-12-02', fixedOrder: .5 }]) {
    bad({ ...valid, visits: valid.visits.map((v, i) => i ? v : { ...v, ...edit }) });
  }
  for (const edit of [{ mode: 'FLY' }, { mode: ['TAXI'] }, { to: 'foreign' }, { date: '2026-12-05' }]) bad({ ...valid, legModes: [{ date: input.startDate, from: 'place-hotel', to: 'place-tower', mode: 'WALK', ...edit }] });
  const dst = { ...input, timeZone: 'America/New_York', startDate: '2026-11-01', endDate: '2026-11-03' };
  bad({ ...valid, visits: valid.visits.map((v, i) => i ? v : { ...v, fixedDate: dst.startDate, fixedTime: '01:30' }) }, dst);
});

test('T13 overflow → selection → real scheduler revalidation and pinned wish survive repeated calculations', async () => {
  const input = sampleTrip(okVisits.map(v => ({ ...v, minutes: 300 })));
  const compute = service().service;
  const over = await compute.compute(input);
  assert.equal(over.status, 'OVER_CAPACITY');
  const ids = new Set(over.capacity.recommendation!.requiredVisitIds);
  let draft = constraintsFrom(input);
  draft.visits = draft.visits.map(v => ({ ...v, priority: ids.has(v.id) ? 'REQUIRED' : 'WISH' }));
  assert.equal((await compute.compute(applyEdits(input, parseConstraints(draft, input)))).status, 'OK');

  const normal = sampleTrip(); draft = constraintsFrom(normal);
  draft.visits = draft.visits.map(v => v.id === 'visit-teamlab' ? { ...v, fixedDate: '2026-12-02', fixedTime: '15:00', fixedOrder: 1 } : v);
  const changed = applyEdits(normal, parseConstraints(draft, normal));
  const first = await compute.compute(changed);
  assert.equal(first.status, 'OK');
  const day = first.capacity.recommendation!.schedule.days.find(d => d.date === '2026-12-02')!;
  const orderedVisit = day.stops.filter(s => s.kind === 'VISIT')[1];
  assert.equal(orderedVisit.visitId, 'visit-teamlab');
  const stop = day.stops.find(s => s.kind === 'VISIT' && s.visitId === 'visit-teamlab')!;
  assert.equal(localTime(stop.start, changed.timeZone), '15:00');
  const daily = first.comparisons.find(l => l.kind === 'DAY' && l.date === day.date)!;
  changed.legModes = [{ date: daily.date, from: daily.from, to: daily.to, mode: 'TAXI' },
    { date: normal.startDate, from: 'place-airport', to: 'place-hotel', mode: 'TRANSIT' }];
  const second = await compute.compute(changed), third = await compute.compute(changed);
  assert.equal(second.status, 'OK'); assert.deepEqual(third, second);
  for (const fixed of changed.legModes) {
    const leg = second.comparisons.find(l => l.date === fixed.date && l.from === fixed.from && l.to === fixed.to)!;
    assert.equal(leg.selected.mode, fixed.mode); assert.equal(leg.selected.fixed, true);
  }
  assert.notEqual(inputHash(normal), inputHash(changed));
});

test('T13 editor service deduplicates metadata, keeps it transient and rejects stale saves', async () => {
  let input = sampleTrip();
  const repository: ConstraintRepository = {
    loadInputs: async () => ({ status: 'READY', input, inputHash: inputHash(input) }),
    save: async (_id, _owner, revision, changes) => {
      assert.equal(revision, inputHash(input)); input = applyEdits(input, changes);
      return { input, revision: inputHash(input) };
    },
  };
  const places = new FixturePlaces(), editor = new ResultEditService(repository, places);
  const view = await editor.load(input.id, 'owner');
  assert.equal(new Set(places.detailCalls).size, places.detailCalls.length);
  const result = await service().service.compute(input);
  const markers = mapMarkers(view, result);
  assert.equal(markers.find(m => m.id === 'visit-teamlab')?.state, 'WISH');
  assert.ok(markers.some(m => m.state === 'PLACED'));
  assert.equal(money(null, 'JPY'), '요금 정보 없음');
  assert.equal(localTime('2026-12-01T01:00:00Z', 'America/New_York'), '20:00');
  assert.equal(localDateTime('2026-12-01T01:00:00Z', 'America/New_York'), '2026-11-30 20:00');
  const draft = constraintsFrom(input); draft.visits[0].fixedDate = '2026-12-02';
  const saved = await editor.save(input.id, 'owner', { revision: view.revision, constraints: draft });
  assert.notEqual(saved.revision, view.revision); assert.equal('places' in saved, false);
  assert.equal((await editor.load(input.id, 'owner')).input.visits[0].fixedDate, '2026-12-02');
  await assert.rejects(editor.save(input.id, 'owner', { revision: view.revision, constraints: draft }), ResultStaleError);
  repository.save = async () => null;
  await assert.rejects(editor.save(input.id, 'owner', { revision: saved.revision, constraints: draft }), ResultStaleError);
});
