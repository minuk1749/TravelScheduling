import { fireEvent, screen, waitFor, within } from 'expo-router/testing-library';
import { json } from './helpers';
import { conflictTrip, D1, D2, openResult, place, plan, resultFixture, trip, view } from './result-fixture';

const press = (name: string) => fireEvent.press(screen.getByRole('button', { name }));
const sheet = () => within(screen.getByTestId('form-sheet'));
const pressInSheet = (name: string) => fireEvent.press(sheet().getByRole('button', { name }));
const toggle = (name: string) => fireEvent(sheet().getByLabelText(name), 'valueChange', true);

test.each([
  [D1, 'airport', 'hotel', '하네다 공항 → 도쿄 호텔', 35, '9,000', '대중교통 40분 · ¥500'],
  [D2, 'shrine', 'hotel', '메이지 신궁 → 도쿄 호텔', 12, '2,500', '대중교통 30분 · ¥200'],
  [D2, 'hotel', 'airport', '도쿄 호텔 → 하네다 공항', 38, '8,000', '대중교통 50분 · ¥700'],
] as const)('compares fares and saves a mode for the full-schedule leg %s %s → %s', async (date, from, to, title, minutes, fare, selected) => {
  const f = resultFixture();
  const data = plan();
  const back = data.comparisons.find(leg => leg.date === D2 && leg.from === place('shrine'))!;
  back.alternatives = { ...back.alternatives, TAXI: { minutes: 12, fare: 2500 } };
  const airport = data.comparisons[0];
  data.comparisons.push({ ...airport, date: D2, from: place('hotel'), to: place('airport'), departure: '2026-12-04T04:00:00Z',
    selected: { ...airport.selected, minutes: 50, fare: 700 }, alternatives: { TRANSIT: { minutes: 50, fare: 700 }, TAXI: { minutes: 38, fare: 8000 } } });
  f.generate.mockImplementationOnce(async () => json(trip(view.revision, data)));
  await openResult(f);
  if (date === D2) await press('2일 12.4');
  await press('전체 일정');
  expect(sheet().getByText(title)).toBeVisible();
  expect(sheet().getByText(selected, { exact: false })).toBeVisible();
  await pressInSheet(`택시 ${minutes}분 약 ¥${fare}로 바꾸기`);
  await waitFor(() => expect(f.generate).toHaveBeenCalledTimes(2));
  expect(f.current().input.legModes).toEqual([{ date, from: place(from), to: place(to), mode: 'TAXI' }]);
  expect(f.save.mock.invocationCallOrder[0]).toBeLessThan(f.generate.mock.invocationCallOrder[1]);
});

test('moving a visit to another day offers all insertion positions on the destination', async () => {
  const f = resultFixture();
  await openResult(f);
  await press('2일 12.4');
  await press('이 장소 수정');
  await toggle('날짜 고정');
  await toggle('순서 고정');
  expect(sheet().getByRole('button', { name: '순서 늦추기' })).toBeDisabled();
  await pressInSheet('1일차 12.3');
  await pressInSheet('순서 늦추기');
  await pressInSheet('순서 늦추기');
  expect(sheet().getByText('3번째')).toBeVisible();
  expect(sheet().getByRole('button', { name: '순서 늦추기' })).toBeDisabled();
  await pressInSheet('적용하고 다시 계산');
  await waitFor(() => expect(f.generate).toHaveBeenCalledTimes(2));
  expect(f.current().input.visits.find(row => row.id === 'shrine')).toMatchObject({ fixedDate: D1, fixedOrder: 2 });
});

test('an initial conflict without a schedule permits the full range accepted by fixed-visit validation', async () => {
  const f = resultFixture();
  f.generate.mockImplementationOnce(async () => json(conflictTrip(view.revision)));
  await openResult(f);
  await press('아메요코 시장 고정 수정');
  await toggle('날짜 고정');
  await toggle('순서 고정');
  for (let position = 1; position < view.input.visits.length; position++) await pressInSheet('순서 늦추기');
  expect(sheet().getByText(`${view.input.visits.length}번째`)).toBeVisible();
  expect(sheet().getByRole('button', { name: '순서 늦추기' })).toBeDisabled();
  await pressInSheet('적용하고 다시 계산');
  await waitFor(() => expect(f.generate).toHaveBeenCalledTimes(2));
  expect(f.current().input.visits.find(row => row.id === 'market')).toMatchObject({ fixedDate: D1, fixedOrder: view.input.visits.length - 1 });
});
