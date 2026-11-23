import { act, fireEvent, screen, waitFor, within } from 'expo-router/testing-library';
import { constraintsFrom, type LegEdit } from '@travel/core/contracts/results/model';
import { conflictCauses, conflictingModeFixes } from '../src/result/conflicts';
import { deferred, json } from './helpers';
import { at, conflictTrip, D1, D2, D3, openResult, place, plan, resultFixture, trip, view } from './result-fixture';

const hotel = place('hotel'), east = { id: 'east-hotel', googlePlaceId: 'google-east-hotel' };
const slow: LegEdit = { date: D2, from: hotel, to: east.id, mode: 'WALK' };
const reverse: LegEdit = { date: D2, from: east.id, to: hotel, mode: 'TAXI' };
const priorDate = { ...slow, date: D1 };
const saved = { ...view, places: { ...view.places,
  [east.id]: { ...view.places[hotel]!, googlePlaceId: east.googlePlaceId, name: '동쪽 숙소' },
}, input: { ...view.input, lodgings: [
  { ...view.input.lodgings[0], checkOut: D2 }, { place: east, checkIn: D2, checkOut: D3 },
], daySettings: [{ date: D2, departureTime: '09:00', returnTime: '09:30', mealSlots: [] }],
legModes: [priorDate, reverse, slow] } };
const review = '이 날짜의 이동수단 고정 검토';
const releaseSlow = '도쿄 호텔 → 동쪽 숙소 · 도보 고정 해제하고 다시 계산';
const releaseReverse = '동쪽 숙소 → 도쿄 호텔 · 택시 고정 해제하고 다시 계산';
const press = (name: string) => fireEvent.press(screen.getByRole('button', { name }));
const sheet = () => within(screen.getByTestId('form-sheet'));

// An overlong transfer between the two lodgings yields just TIME_WINDOW on the changeover date.
function lodgingConflict() {
  const result = conflictTrip(view.revision);
  result.capacity.unplaced = [];
  result.capacity.issues = [{ date: D2, reason: 'TIME_WINDOW' }];
  return result;
}

test('reopening a date-only conflict lets the traveler review and remove one saved mode before recalculation', async () => {
  const f = resultFixture(saved), before = constraintsFrom(saved.input);
  f.generate.mockResolvedValueOnce(json(lodgingConflict()));
  await openResult(f);
  expect(screen.getByRole('button', { name: '2일 12.4', selected: true })).toBeVisible();
  expect(screen.queryByRole('button', { name: '변경 취소' })).toBeNull();
  expect(screen.queryByRole('button', { name: releaseSlow })).toBeNull();
  await press('1일 12.3');
  expect(screen.queryByRole('button', { name: review })).toBeNull();
  await press('2일 12.4');
  await press(review);
  expect(sheet().getAllByRole('button', { name: /고정 해제하고 다시 계산/ })).toHaveLength(2);
  expect(sheet().getByRole('button', { name: releaseReverse })).toBeVisible();
  await fireEvent.press(sheet().getByRole('button', { name: '취소' }));
  expect(screen.queryByTestId('form-sheet')).toBeNull();
  expect(f.save).not.toHaveBeenCalled();
  expect(f.generate).toHaveBeenCalledTimes(1);

  await press(review);
  const pending = deferred<void>(), persist = f.save.getMockImplementation()!;
  f.save.mockImplementationOnce(async options => { await pending.promise; return persist(options); });
  const data = plan();
  data.comparisons = [...data.comparisons.filter(leg => leg.date !== D2), {
    date: D2, kind: 'DAY', from: hotel, to: east.id, departure: at(D2, '09:00'),
    selected: { mode: 'TRANSIT', minutes: 23, fare: 360, fixed: false },
    baseline: { mode: 'TRANSIT', minutes: 23, fare: 360 }, alternatives: { TRANSIT: { minutes: 23, fare: 360 } },
  }];
  data.stops[D2] = [];
  f.generate.mockImplementationOnce(async () => json(trip(f.current().revision, data)));
  await fireEvent.press(sheet().getByRole('button', { name: releaseSlow }));
  await waitFor(() => expect(f.save).toHaveBeenCalledTimes(1));
  expect(f.generate).toHaveBeenCalledTimes(1);
  const expected = { ...before, legModes: [priorDate, reverse] };
  expect(JSON.parse(String(f.save.mock.calls[0][0].body))).toEqual({ revision: view.revision, constraints: expected });
  await act(async () => pending.resolve());
  expect(await screen.findByText('이동수단 고정을 해제하고 다시 계산했어요')).toBeVisible();
  expect(constraintsFrom(f.current().input)).toEqual(expected);
  expect(f.generate).toHaveBeenCalledTimes(2);
  expect(screen.queryByTestId('form-sheet')).toBeNull();
  await press('전체 일정');
  expect(sheet().getByText('도쿄 호텔 → 동쪽 숙소')).toBeVisible();
  expect(sheet().getByText('대중교통 23분 · ¥360')).toBeVisible();
});

test('day candidates exclude directly matched legs and never come from a visit-specific or undated warning', () => {
  const result = lodgingConflict();
  result.capacity.issues.push({ date: D2, reason: 'UNREACHABLE', from: reverse.from, to: reverse.to },
    { date: D2, reason: 'MEAL_UNAVAILABLE', slot: 'LUNCH' });
  result.capacity.unplaced = [{ visitId: 'museum', fixed: true, reason: 'TIME_WINDOW' }];
  result.verification = { attempts: 5, verified: false };
  const causes = conflictCauses(saved, result);
  const mixed = conflictingModeFixes(saved, D2, causes);
  expect(mixed.matched.map(row => row.fix)).toEqual([reverse]);
  expect(mixed.review.map(row => row.fix)).toEqual([slow]);
  expect(conflictingModeFixes(saved, D1, causes)).toEqual({ matched: [], review: [] });
});

test.each(['meal', 'flight'])('a %s timing issue offers the fixes saved on its reported date for review', issue => {
  const result = lodgingConflict();
  result.capacity.issues = issue === 'meal' ? [{ date: D2, reason: 'MEAL_UNAVAILABLE', slot: 'LUNCH' }] : [];
  if (issue === 'flight') result.flightConflicts = [
    { date: D2, arrivalReadyAt: at(D2, '09:20'), departureStartBy: at(D2, '09:00') },
  ];
  const causes = conflictCauses(saved, result);
  const fixes = conflictingModeFixes(saved, D2, causes);
  expect(fixes.matched).toEqual([]);
  expect(fixes.review.map(row => row.fix)).toEqual([reverse, slow]);
  expect(conflictingModeFixes(saved, D1, causes).review).toEqual([]);
});
