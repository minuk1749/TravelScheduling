import { fireEvent, screen, within } from 'expo-router/testing-library';
import { constraintsFrom, type LegEdit } from '@travel/core/contracts/results/model';
import { conflictCauses, conflictingModeFixes } from '../src/result/conflicts';
import { json } from './helpers';
import { at, conflictTrip, D1, D2, D3, openResult, place, plan, resultFixture, trip, view } from './result-fixture';

const connected = '충돌 방문과 연결된 이동수단 고정 검토', other = '같은 날짜의 다른 이동수단 고정 검토';
const press = (name: string) => fireEvent.press(screen.getByRole('button', { name }));
const sheet = () => within(screen.getByTestId('form-sheet'));
const walk = (date: string, from: Parameters<typeof place>[0], to: Parameters<typeof place>[0]): LegEdit =>
  ({ date, from: place(from), to: place(to), mode: 'WALK' });
const inbound = walk(D2, 'hotel', 'shrine'), outbound = walk(D2, 'shrine', 'hotel');
const elsewhere = walk(D2, 'museum', 'market'), prior = { ...inbound, date: D1 };
const booked = { ...view, input: { ...view.input,
  visits: view.input.visits.map(visit => visit.id === 'shrine' ? { ...visit, fixedDate: D2, fixedTime: '09:30' } : visit),
  legModes: [elsewhere, outbound, prior, inbound],
} };
function timingConflict(revision: string) {
  const result = conflictTrip(revision);
  result.capacity.issues = [];
  result.capacity.unplaced = [{ visitId: 'shrine', reason: 'TIME_WINDOW', fixed: true }];
  return result;
}

test('reopen a visit-only timing conflict and release its incoming walk without changing the booking or any other saved leg', async () => {
  const f = resultFixture(booked);
  f.generate.mockImplementation(async () => {
    const { input, revision } = f.current();
    if (input.legModes?.some(fix => fix.date === D2 && fix.from === inbound.from && fix.to === inbound.to)) return json(timingConflict(revision));
    const schedule = plan();
    schedule.comparisons = schedule.comparisons.map(leg => leg.date === D2 && leg.to === outbound.to
      ? { ...leg, selected: { mode: 'WALK', minutes: 60, fare: 0, fixed: true }, alternatives: { WALK: { minutes: 60, fare: 0 } } } : leg);
    return json(trip(revision, schedule));
  });
  await openResult(f);
  expect(screen.getByRole('button', { name: '메이지 신궁 고정 수정' })).toBeVisible();
  expect(screen.queryByRole('button', { name: '변경 취소' })).toBeNull();
  await press(other);
  expect(sheet().getAllByRole('button', { name: /해제하고 다시 계산/ })).toHaveLength(1);
  expect(sheet().getByRole('button', { name: '도쿄 국립박물관 → 아메요코 시장 · 도보 고정 해제하고 다시 계산' })).toBeVisible();
  await fireEvent.press(sheet().getByRole('button', { name: '취소' }));
  expect(f.save).not.toHaveBeenCalled();
  await press(connected);
  expect(sheet().getAllByRole('button', { name: /해제하고 다시 계산/ })).toHaveLength(2);
  expect(sheet().getByRole('button', { name: '메이지 신궁 → 도쿄 호텔 · 도보 고정 해제하고 다시 계산' })).toBeVisible();
  await fireEvent.press(sheet().getByRole('button', { name: '도쿄 호텔 → 메이지 신궁 · 도보 고정 해제하고 다시 계산' }));
  expect(await screen.findByText('이동수단 고정을 해제하고 다시 계산했어요')).toBeVisible();
  expect(f.generate).toHaveBeenCalledTimes(2);
  const expected = { ...constraintsFrom(booked.input), legModes: [elsewhere, outbound, prior] };
  expect(f.save).toHaveBeenCalledTimes(1);
  expect(JSON.parse(String(f.save.mock.calls[0][0].body))).toEqual({ revision: view.revision, constraints: expected });
  expect(constraintsFrom(f.current().input)).toEqual(expected);
  expect(screen.getByRole('button', { name: '1번 메이지 신궁, 09:30부터 10:20까지', selected: true })).toBeVisible();
});

test.each([[D1, 'ARRIVAL'], [D3, 'DEPARTURE']] as const)('a lodging transfer can be reviewed explicitly for an indirect visit-only conflict on %s', async (date, direction) => {
  const arriving = direction === 'ARRIVAL';
  const fix = arriving ? walk(date, 'airport', 'hotel') : walk(date, 'hotel', 'airport');
  const initial = { ...booked, input: { ...booked.input,
    flights: [...booked.input.flights, { ...booked.input.flights[0], direction: 'DEPARTURE' as const, localDateTime: `${D3}T18:00` }],
    visits: booked.input.visits.map(visit => visit.id === 'shrine' ? { ...visit, fixedDate: date, fixedTime: '12:00' } : visit),
    legModes: [fix, inbound],
  } };
  const f = resultFixture(initial);
  f.generate.mockImplementation(async () => {
    const { input, revision } = f.current();
    if (input.legModes?.some(leg => leg.date === date)) return json(timingConflict(revision));
    const data = plan();
    data.stops[D2] = [];
    data.stops[date] = [{ kind: 'VISIT', visitId: 'shrine', start: at(date, '12:00'), end: at(date, '12:50') }];
    return json(trip(revision, data));
  });
  await openResult(f);
  expect(screen.queryByRole('button', { name: connected })).toBeNull();
  await press(other);
  const buttons = sheet().getAllByRole('button', { name: /해제하고 다시 계산/ });
  expect(buttons).toHaveLength(1);
  const route = arriving ? '하네다 공항 → 도쿄 호텔' : '도쿄 호텔 → 하네다 공항';
  await fireEvent.press(sheet().getByRole('button', { name: `${route} · 도보 고정 해제하고 다시 계산` }));
  expect(await screen.findByText('이동수단 고정을 해제하고 다시 계산했어요')).toBeVisible();
  expect(constraintsFrom(f.current().input)).toEqual({ ...constraintsFrom(initial.input), legModes: [inbound] });
  expect(f.generate).toHaveBeenCalledTimes(2);
});

test('date-only visit pins use the rejected visit ID; undated, order-only and other dates do not infer a cause', () => {
  const shrine = booked.input.visits.find(visit => visit.id === 'shrine')!;
  const initial = { ...booked, input: { ...booked.input, visits: [
    { ...shrine, id: 'earlier-occurrence', fixedTime: undefined, fixedDate: D1 },
    { ...shrine, fixedTime: undefined }, { ...shrine, id: 'free', fixedTime: undefined, fixedDate: undefined },
  ] } };
  const result = timingConflict(view.revision);
  result.capacity.unplaced.push({ visitId: 'earlier-occurrence', fixed: true, reason: 'FIXED_ORDER' },
    { visitId: 'free', fixed: false, reason: 'TIME_WINDOW' });
  result.capacity.issues = [{ date: D2, from: inbound.from, to: inbound.to, reason: 'UNREACHABLE' }];
  const causes = conflictCauses(initial, result);
  const fixes = conflictingModeFixes(initial, D2, causes);
  expect(fixes.matched.map(row => row.fix)).toEqual([inbound]);
  expect(fixes.connected.map(row => row.fix)).toEqual([outbound]);
  expect(fixes.review.map(row => row.fix)).toEqual([elsewhere]);
  expect(conflictingModeFixes(initial, D1, causes)).toEqual({ matched: [], connected: [], review: [] });
});
