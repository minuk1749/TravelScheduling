import { fireEvent, screen, within } from 'expo-router/testing-library';
import { constraintsFrom, type LegEdit } from '@travel/core/contracts/results/model';
import { json } from './helpers';
import { at, conflictTrip, D1, D2, D3, openResult, place, plan, resultFixture, trip, view } from './result-fixture';

const all = '여행 전체 이동수단 고정 보기', title = '선택한 날짜의 활동 시간을 제한한 공항 이동';
const press = (name: string) => fireEvent.press(screen.getByRole('button', { name }));
const sheet = () => within(screen.getByTestId('form-sheet'));

test.each(['departure', 'arrival', 'legacy'] as const)('an overnight %s transfer is releasable from the booking date using the saved flight-date key', async scenario => {
  const arrival = scenario === 'arrival', legacy = scenario === 'legacy';
  const flightDate = arrival ? D1 : D3, time = arrival ? '02:00' : '19:30', endTime = arrival ? '02:50' : '20:20';
  const fix: LegEdit = { date: flightDate, from: place(arrival ? 'airport' : 'hotel'), to: place(arrival ? 'hotel' : 'airport'), mode: 'WALK' };
  const keep = { ...fix, date: D2 };
  const opposite = { ...fix, from: fix.to, to: fix.from };
  const airport = view.input.flights[0].airport;
  const initial = { ...view, input: { ...view.input, flights: [
    { direction: 'ARRIVAL' as const, airport, localDateTime: `${D1}T${arrival ? '23:00' : '08:00'}` },
    { direction: 'DEPARTURE' as const, airport, localDateTime: `${D3}T${arrival ? '18:00' : '00:30'}` },
  ], visits: view.input.visits.map(visit => visit.id === 'shrine' ? { ...visit, fixedDate: D2, fixedTime: time } : visit),
  daySettings: [{ date: D2, departureTime: arrival ? '00:00' : '09:00', returnTime: arrival ? '09:00' : '23:00', mealSlots: [] }],
  legModes: [keep, opposite, fix] } };
  const f = resultFixture(initial);
  f.generate.mockImplementation(async () => {
    const { input, revision } = f.current();
    if (input.legModes?.some(leg => leg.date === fix.date && leg.from === fix.from && leg.to === fix.to)) {
      const conflict = conflictTrip(revision);
      conflict.capacity.issues = [];
      conflict.capacity.unplaced = [{ visitId: 'shrine', reason: 'TIME_WINDOW', fixed: true }];
      if (!legacy) conflict.airportTransferLimits = [{ ...fix, affectedDate: D2,
        start: at(D2, arrival ? '00:30' : '19:09'), end: at(D2, arrival ? '03:21' : '22:00') }];
      return json(conflict);
    }
    const data = plan();
    data.stops[D2] = [{ kind: 'VISIT', visitId: 'shrine', start: at(D2, time), end: at(D2, endTime) }];
    return json(trip(revision, data));
  });
  await openResult(f);
  expect(screen.getByRole('button', { name: '2일 12.4', selected: true })).toBeVisible();
  await press(all);
  expect(sheet().getAllByRole('button', { name: /해제하고 다시 계산/ })).toHaveLength(3);
  const date = arrival ? '12월 3일 목요일' : '12월 5일 토요일';
  const interval = arrival ? '00:30 – 03:21' : '19:09 – 22:00';
  const route = arrival ? '하네다 공항 → 도쿄 호텔' : '도쿄 호텔 → 하네다 공항';
  const label = `고정 기준일 ${date}${legacy ? '' : ' · 공항 이동 12월 4일 금요일 ' + interval} · ${route} · 도보 고정 해제하고 다시 계산`;
  if (legacy) expect(sheet().queryByText(title)).toBeNull();
  else {
    expect(sheet().getByText(title)).toBeVisible();
    expect(sheet().getAllByRole('button', { name: /해제하고 다시 계산/ })[0]).toBe(sheet().getByRole('button', { name: label }));
  }
  await fireEvent.press(sheet().getByRole('button', { name: '취소' }));
  expect(f.save).not.toHaveBeenCalled();
  await press(arrival ? '1일 12.3' : '3일 12.5');
  await press(all);
  expect(sheet().queryByText(title)).toBeNull();
  await fireEvent.press(sheet().getByRole('button', { name: '취소' }));
  await press('2일 12.4');
  await press(all);
  await fireEvent.press(sheet().getByRole('button', { name: label }));
  expect(await screen.findByText('이동수단 고정을 해제하고 다시 계산했어요')).toBeVisible();
  expect(f.save).toHaveBeenCalledTimes(1);
  const expected = { ...constraintsFrom(initial.input), legModes: [keep, opposite] };
  expect(JSON.parse(String(f.save.mock.calls[0][0].body))).toEqual({ revision: view.revision, constraints: expected });
  expect(constraintsFrom(f.current().input)).toEqual(expected);
  expect(f.generate).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('button', { name: `1번 메이지 신궁, ${time}부터 ${endTime}까지`, selected: true })).toBeVisible();
});
