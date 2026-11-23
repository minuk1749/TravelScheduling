import { fireEvent, screen, waitFor, within } from 'expo-router/testing-library';
import type { LegComparison } from '@travel/core/contracts/itinerary';
import { json } from './helpers';
import { D1, legId, openResult, place, plan, resultFixture, trip, view } from './result-fixture';

const press = (name: string) => fireEvent.press(screen.getByRole('button', { name }));
const museumLeg = legId(D1, 'hotel', 'museum');

async function openWithModes(selected: LegComparison['selected']['mode'], alternatives: LegComparison['alternatives']) {
  const f = resultFixture();
  const data = plan(), arrival = data.comparisons.find(leg => leg.to === place('museum'))!;
  arrival.selected = { mode: selected, fixed: true, ...alternatives[selected]! };
  arrival.alternatives = alternatives;
  f.generate.mockResolvedValueOnce(json(trip(view.revision, data)));
  await openResult(f);
  return f;
}

const alternatives = { WALK: { minutes: 12, fare: 0 }, TRANSIT: { minutes: 20, fare: 180 }, TAXI: { minutes: 13, fare: 1850 } };

test.each([
  ['WALK', 'TAXI', '택시 13분 약 ¥1,850로 바꾸기', '대중교통 20분 ¥180로 바꾸기', '도보 12분'],
  ['TRANSIT', 'WALK', '도보 12분으로 바꾸기', '택시 13분 약 ¥1,850로 바꾸기', '대중교통 20분 · ¥180'],
  ['TAXI', 'TRANSIT', '대중교통 20분 ¥180로 바꾸기', '도보 12분으로 바꾸기', '택시 13분 · 약 ¥1,850'],
] as const)('sheet compares each offered mode and saves %s → %s', async (selected, target, label, other, current) => {
  const f = await openWithModes(selected, alternatives);
  if (selected === 'WALK') {
    const card = within(screen.getByTestId('place-card-museum'));
    expect(card.queryByRole('button', { name: /로 바꾸기$/ })).toBeNull();
  }
  await press('전체 일정');
  const row = within(screen.getByTestId('schedule-leg-' + museumLeg));
  expect(row.getByText(current)).toBeVisible();
  expect(row.getByRole('button', { name: other })).toBeEnabled();
  await fireEvent.press(row.getByRole('button', { name: label }));
  await waitFor(() => expect(f.generate).toHaveBeenCalledTimes(2));
  expect(f.current().input.legModes).toEqual([{ date: D1, from: place('hotel'), to: place('museum'), mode: target }]);
});

test('the fixture’s walking return shows transit and explicitly disables the missing taxi alternative', async () => {
  const f = resultFixture();
  await openResult(f);
  await press('전체 일정');
  const row = within(screen.getByTestId('schedule-leg-' + legId(D1, 'market', 'hotel')));
  expect(row.getByText('도보 30분')).toBeVisible();
  expect(row.getByRole('button', { name: '대중교통 20분 ¥180로 바꾸기' })).toBeEnabled();
  const unavailable = row.getByRole('button', { name: '택시 정보 없음' });
  expect(unavailable).toBeDisabled();
  await fireEvent.press(unavailable);
  expect(f.save).not.toHaveBeenCalled();
});

test('the previous schedule still displays comparable routes, without applying edits to a stale result', async () => {
  const data = { WALK: alternatives.WALK, TAXI: { minutes: 13, fare: null } };
  const f = await openWithModes('WALK', data);
  f.generate.mockRejectedValueOnce(new Error('offline'));
  await press('지도 아사쿠사 카페');
  await press('1일차에 추가하고 다시 계산');
  await screen.findByText('⚠ 동선을 계산하지 못했어요');
  await press('이전 일정 보기');
  await press('전체 일정');
  const row = within(screen.getByTestId('schedule-leg-' + museumLeg));
  expect(row.getByText('도보 12분')).toBeVisible();
  expect(row.getByRole('button', { name: '대중교통 정보 없음' })).toBeDisabled();
  const taxi = row.getByRole('button', { name: /택시 13분 요금 —/ });
  expect(taxi).toBeDisabled();
  await fireEvent.press(taxi);
  expect(f.save).toHaveBeenCalledTimes(1); // Original wish edit only.
  expect(f.current().input.legModes).toEqual([]);
});
