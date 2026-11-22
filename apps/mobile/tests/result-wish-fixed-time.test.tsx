import { useState } from 'react';
import { render } from '@testing-library/react-native';
import { fireEvent, screen, within } from 'expo-router/testing-library';
import { Temporal } from '@js-temporal/polyfill';
import { constraintsFrom, type ResultView } from '@travel/core/contracts/results/model';
import { buildDays } from '../src/result/days';
import { fixedVisitError, onDate } from '../src/result/edits';
import { WishSheet } from '../src/screens/result/wish-sheet';
import { json } from './helpers';
import { conflictTrip, openResult, place, resultFixture, trip, view } from './result-fixture';

const zone = 'Europe/Paris';
const dstError = '⚠ 시간대에서 존재하지 않거나 중복되는 시각입니다.';
const sheet = () => within(screen.getByTestId('form-sheet'));
const press = (name: string) => fireEvent.press(screen.getByRole('button', { name }));
const inSheet = (name: string) => fireEvent.press(sheet().getByRole('button', { name }));

function parisView(start: string, end: string): ResultView {
  return { ...view, places: {
    [place('cafe')]: { ...view.places[place('cafe')]!, name: '파리 카페', coordinates: { latitude: 48.85, longitude: 2.35 } },
    [place('hotel')]: { ...view.places[place('hotel')]!, name: '파리 숙소', coordinates: { latitude: 48.85, longitude: 2.36 } },
  }, input: { ...view.input, cityCode: 'PARIS', timeZone: zone, startDate: start, endDate: end,
    flights: [], mealSlots: [], activity: { start: '01:00', end: '11:00' },
    lodgings: [{ ...view.input.lodgings[0], checkIn: start, checkOut: end }],
    visits: [{ ...view.input.visits[3], fixedDate: start, fixedTime: '02:30', fixedOrder: 0 }],
  } };
}

function dayConflict(revision: string, date: string) {
  const result = conflictTrip(revision);
  result.capacity.unplaced = [];
  result.capacity.issues = [{ reason: 'TIME_WINDOW', date }];
  return result;
}

function bookedResult(revision: string, dates: string[]) {
  const result = trip(revision);
  const target = dates[2];
  const at = Temporal.PlainDateTime.from(target + 'T02:30').toZonedDateTime(zone).toInstant();
  const schedule = { days: dates.map(date => ({ date, timeZone: zone, legs: [], stops: date === target ? [
    { kind: 'VISIT' as const, visitId: 'cafe', start: at.toString(), end: at.add({ minutes: 40 }).toString() },
  ] : [] })), issues: [], unplaced: [] };
  return { ...result, comparisons: [], efficiency: null, capacity: { ...result.capacity,
    recommendation: { requiredCount: 0, requiredVisitIds: [], schedule } } };
}

test.each([
  ['spring gap', '2026-03-28', '2026-03-29', '2026-03-30', '3.29', '3.30'],
  ['autumn overlap', '2026-10-24', '2026-10-25', '2026-10-26', '10.25', '10.26'],
])('a Paris 02:30 wish stays editable across the %s and undo restores its original booking', async (_season, start, dst, end, dstLabel, endLabel) => {
  const saved = parisView(start, end), before = constraintsFrom(saved.input);
  const f = resultFixture(saved);
  f.generate.mockResolvedValueOnce(json(dayConflict(saved.revision, start)));
  await openResult(f);
  await press('지도 파리 카페');
  await inSheet('2일차 ' + dstLabel);
  expect(sheet().getByText(dstError)).toBeVisible();
  expect(sheet().getByRole('button', { name: '2일차에 추가하고 다시 계산' })).toBeDisabled();
  await inSheet('2일차에 추가하고 다시 계산');
  expect(screen.getByTestId('form-sheet')).toBeVisible();
  expect(screen.queryByText('⚠ 동선을 계산하지 못했어요')).toBeNull();
  expect(f.save).not.toHaveBeenCalled();
  expect(f.generate).toHaveBeenCalledTimes(1);

  await inSheet('3일차 ' + endLabel);
  expect(sheet().queryByText(dstError)).toBeNull();
  expect(sheet().getByRole('button', { name: '3일차에 추가하고 다시 계산' })).toBeEnabled();
  f.generate.mockImplementationOnce(async () => json(bookedResult(f.current().revision, [start, dst, end])));
  await inSheet('3일차에 추가하고 다시 계산');
  expect(await screen.findByText('3일차에 추가하고 다시 계산했어요')).toBeVisible();
  expect(screen.getByRole('button', { name: '1번 파리 카페, 02:30부터 03:10까지', selected: true })).toBeVisible();
  expect(constraintsFrom(f.current().input)).toEqual({ ...before, visits: [{ ...before.visits[0], fixedDate: end }] });
  f.generate.mockImplementationOnce(async () => json(dayConflict(f.current().revision, start)));
  await press('되돌리기');
  await screen.findByText('⚠ 고정 조건 충돌 1건');
  expect(constraintsFrom(f.current().input)).toEqual(before);
  expect(f.save).toHaveBeenCalledTimes(2);
});

test('changing the chosen wish updates its validation on the same destination date', async () => {
  const saved = parisView('2026-03-28', '2026-03-30');
  const booked = saved.input.visits[0];
  const input = { ...saved.input, visits: [booked, { ...booked, id: 'late', fixedTime: '04:30' }] };
  const edits = constraintsFrom(input).visits;
  const wishes = [{ visitId: booked.id, name: '새벽 예약' }, { visitId: 'late', name: '다음 예약' }];
  const days = buildDays(saved, null, null), apply = jest.fn();
  function Picker() {
    const [chosen, setChosen] = useState(booked.id);
    return <WishSheet current={edits.find(edit => edit.id === chosen)!} wishes={wishes} input={input}
      days={days} date="2026-03-29" close={jest.fn()} apply={apply} onChoose={setChosen} />;
  }
  await render(<Picker />);
  expect(sheet().getByText(dstError)).toBeVisible();
  await inSheet('★ 다음 예약');
  expect(sheet().queryByText(dstError)).toBeNull();
  expect(sheet().getByRole('button', { name: '2일차 3.29', selected: true })).toBeVisible();
  await inSheet('★ 새벽 예약');
  expect(sheet().getByText(dstError)).toBeVisible();
  await inSheet('★ 다음 예약');
  await inSheet('2일차에 추가하고 다시 계산');
  expect(apply).toHaveBeenCalledWith({ ...edits[1], fixedDate: '2026-03-29' });
});

test('the destination proposal validates its retained order and the trip period with the shared fixed-visit rules', () => {
  const { input } = parisView('2026-03-28', '2026-03-30');
  const visit = constraintsFrom(input).visits[0];
  expect(fixedVisitError(onDate(visit, '2026-03-31'), input)).toBe('여행 기간 안의 날짜를 선택해 주세요.');
  expect(fixedVisitError(onDate({ ...visit, fixedOrder: 1 }, '2026-03-30'), input))
    .toBe('고정 순서는 날짜와 0부터 시작하는 방문 위치가 필요합니다.');
});
