import { fireEvent, screen, within } from 'expo-router/testing-library';
import { buildDays } from '../src/result/days';
import { findVisit, initialSelection, reconcileSelection } from '../src/map/selection';
import { json } from './helpers';
import { conflictTrip, D1, D2, openResult, resultFixture, REVISION, routes, trip, view } from './result-fixture';

const press = (name: string) => fireEvent.press(screen.getByRole('button', { name }));
const sheet = () => within(screen.getByTestId('form-sheet'));

test('moving day-one market to a conflicting day-two fix opens its unplaced card, marker and editor on day two', async () => {
  const f = resultFixture();
  await openResult(f);
  await press('다음 장소');
  await press('이 장소 수정');
  await fireEvent(sheet().getByLabelText('날짜 고정'), 'valueChange', true);
  await fireEvent.press(sheet().getByRole('button', { name: '2일차 12.4' }));
  f.generate.mockImplementationOnce(async () => json(conflictTrip(f.current().revision)));
  await fireEvent.press(sheet().getByRole('button', { name: '적용하고 다시 계산' }));
  await screen.findByRole('button', { name: '아메요코 시장 고정 수정' });
  expect(f.current().input.visits.find(v => v.id === 'market')?.fixedDate).toBe(D2);
  expect(screen.getByRole('button', { name: '2일 12.4', selected: true })).toBeVisible();
  expect(screen.getByRole('button', { name: '아메요코 시장, 배치되지 않음', selected: true })).toBeVisible();
  expect(screen.getByRole('button', { name: '지도 아메요코 시장', selected: true })).toBeVisible();
  await press('아메요코 시장 고정 수정');
  expect(sheet().getByRole('button', { name: '2일차 12.4', selected: true })).toBeVisible();
  // Re-enabling the fix defaults to the editor's actual day, independent of the stored fixedDate.
  await fireEvent(sheet().getByLabelText('날짜 고정'), 'valueChange', false);
  await fireEvent(sheet().getByLabelText('날짜 고정'), 'valueChange', true);
  expect(sheet().getByRole('button', { name: '2일차 12.4', selected: true })).toBeVisible();
  expect(Object.values(routes()).some(route => / STRONG /.test(route))).toBe(false);
  await fireEvent.press(sheet().getByRole('button', { name: '취소' }));

  await press('1일 12.3');
  await press('전체 일정');
  await fireEvent.press(sheet().getByRole('button', { name: '13:20 아메요코 시장' }));
  expect(screen.getByRole('button', { name: '1일 12.3', selected: true })).toBeVisible();
  expect(screen.getByRole('button', { name: '지도 아메요코 시장', selected: true })).toBeVisible();
  expect(screen.getByRole('button', { name: '2번 아메요코 시장, 13:20부터 14:05까지', selected: true })).toBeVisible();
  expect(screen.queryByRole('button', { name: '아메요코 시장 고정 수정' })).toBeNull();
  await press('2일 12.4');
  await press('지도 아메요코 시장');
  expect(screen.getByRole('button', { name: '아메요코 시장, 배치되지 않음', selected: true })).toBeVisible();
  await press('변경 취소');
  await screen.findByText('되돌리고 다시 계산했어요');
  expect(screen.queryByRole('button', { name: '아메요코 시장, 배치되지 않음' })).toBeNull();
});

test('a day-two visit conflicting on day one distinguishes a historical placement from its cause on either date', () => {
  const cause = { visitId: 'shrine', date: D1, message: '고정 순서 충돌', leg: null };
  const days = buildDays(view, trip(REVISION), null, [cause]);
  expect(initialSelection(days, [cause])).toEqual({ date: D1, index: 2 });
  expect(findVisit(days, 'shrine')).toEqual({ date: D2, index: 0 });
  expect(reconcileSelection(days, { date: D2, index: 0 }, 'shrine')).toEqual({ date: D2, index: 0 });
  expect(reconcileSelection(days, { date: D1, index: 2 }, 'shrine')).toEqual({ date: D1, index: 2 });
  expect(days[1].cards[0].issue).toBeNull();
});
