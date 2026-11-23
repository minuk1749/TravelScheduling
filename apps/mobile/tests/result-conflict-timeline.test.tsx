import { act, fireEvent, screen, waitFor, within } from 'expo-router/testing-library';
import { deferred, json } from './helpers';
import { at, conflictTrip, D1, openResult, plan, resultFixture, trip, view } from './result-fixture';

const press = (name: string) => fireEvent.press(screen.getByRole('button', { name }));
const sheet = () => within(screen.getByTestId('form-sheet'));
const previous = '⚠ 고정 조건 충돌 · 이전 계산 결과';
const noPrevious = '⚠ 고정 조건 충돌 · 이 날짜에 이전 계산 결과가 없어요';

function conflict(revision: string) {
  const result = conflictTrip(revision);
  result.capacity.unplaced = [{ visitId: 'museum', reason: 'TIME_WINDOW', fixed: true }];
  result.capacity.issues = [];
  return json(result);
}

function expectOriginalSchedule() {
  const museum = sheet().getByRole('button', { name: '11:00 도쿄 국립박물관' });
  expect(within(museum).getByText('명소 · 1시간 · 🔒 11:00 예약 고정')).toBeVisible();
  expect(within(sheet().getByTestId('trip-efficiency')).getByText('30분 단축')).toBeVisible();
  expect(sheet().getByRole('button', { name: '택시 14분 약 ¥2,300로 바꾸기' })).toBeDisabled();
}

test('each new conflict closes a timeline opened during calculation; reopening it shows one coherent successful snapshot', async () => {
  const f = resultFixture();
  await openResult(f);
  for (const [i, time] of ['15:00', '15:10'].entries()) {
    const pending = deferred<Response>();
    f.generate.mockReturnValueOnce(pending.promise);
    await press(i === 0 ? '이 장소 수정' : '도쿄 국립박물관 고정 수정');
    await fireEvent.changeText(sheet().getByLabelText('고정 시각'), time);
    await fireEvent.press(sheet().getByRole('button', { name: '적용하고 다시 계산' }));
    await waitFor(() => expect(f.generate).toHaveBeenCalledTimes(i + 2));
    expect(f.current().input.visits[0].fixedTime).toBe(time);
    await press('전체 일정');
    expectOriginalSchedule();
    await act(async () => pending.resolve(conflict(f.current().revision)));
    expect(screen.queryByTestId('form-sheet')).toBeNull();
    expect(screen.getByText('⚠ 고정 조건 충돌 1건')).toBeVisible();
    expect(screen.getByRole('button', { name: '도쿄 국립박물관 고정 수정' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '지도 도쿄 국립박물관', selected: true })).toBeVisible();
    await press('전체 일정');
    expect(sheet().getByRole('alert', { name: previous })).toBeVisible();
    expectOriginalSchedule();
    expect(sheet().queryByText(new RegExp(time + ' 예약 고정'))).toBeNull();
    await fireEvent.press(sheet().getByRole('button', { name: '11:00 도쿄 국립박물관' }));
  }
  await press('도쿄 국립박물관 고정 수정');
  expect(sheet().getByLabelText('고정 시각')).toHaveDisplayValue('15:10');
  await fireEvent.changeText(sheet().getByLabelText('고정 시각'), '10:55');
  const pending = deferred<Response>();
  f.generate.mockReturnValueOnce(pending.promise);
  await fireEvent.press(sheet().getByRole('button', { name: '적용하고 다시 계산' }));
  await waitFor(() => expect(f.generate).toHaveBeenCalledTimes(4));
  await press('전체 일정');
  expect(sheet().getByText(previous)).toBeVisible();
  await act(async () => pending.resolve(json({ code: 'PROVIDER_UNAVAILABLE', error: '계산 실패' }, 503)));
  expect(sheet().queryByText(previous)).toBeNull();
  expect(sheet().getByText('이전 계산 결과 · 갱신 실패')).toBeVisible();
  expectOriginalSchedule();
  await fireEvent.press(sheet().getByRole('button', { name: '닫기' }));
  f.generate.mockImplementationOnce(async () => {
    const data = plan();
    data.stops[D1][0] = { ...data.stops[D1][0], start: at(D1, '10:55'), end: at(D1, '11:55') };
    return json(trip(f.current().revision, data));
  });
  await press('다시 계산');
  await screen.findByText('다시 계산했어요');
  await press('전체 일정');
  const corrected = sheet().getByRole('button', { name: '10:55 도쿄 국립박물관' });
  expect(within(corrected).getByText('명소 · 1시간 · 🔒 10:55 예약 고정')).toBeVisible();
  expect(sheet().queryByText(previous)).toBeNull();
  expect(sheet().getByRole('button', { name: '택시 14분 약 ¥2,300로 바꾸기' })).toBeEnabled();
});

test('without a successful calculation the conflict timeline explains why there are no historical visits or totals', async () => {
  const f = resultFixture();
  f.generate.mockResolvedValueOnce(conflict(view.revision));
  await openResult(f);
  await press('전체 일정');
  expect(sheet().getByRole('alert', { name: noPrevious })).toBeVisible();
  expect(sheet().queryByText('배치된 장소 없음')).toBeNull();
  expect(sheet().queryByTestId('trip-efficiency')).toBeNull();
  expect(sheet().queryByRole('button', { name: /도쿄 국립박물관/ })).toBeNull();
  await fireEvent.press(sheet().getByRole('button', { name: '닫기' }));
  expect(screen.getByRole('button', { name: '도쿄 국립박물관 고정 수정' })).toBeEnabled();
});

test('the timeline on the original date keeps its reservation when the new fixed date conflicts', async () => {
  const f = resultFixture();
  await openResult(f);
  await press('이 장소 수정');
  await fireEvent.press(sheet().getByRole('button', { name: '2일차 12.4' }));
  f.generate.mockImplementationOnce(async () => conflict(f.current().revision));
  await fireEvent.press(sheet().getByRole('button', { name: '적용하고 다시 계산' }));
  await screen.findByRole('button', { name: '도쿄 국립박물관 고정 수정' });
  expect(screen.getByRole('button', { name: '2일 12.4', selected: true })).toBeVisible();
  await press('전체 일정');
  expect(sheet().getByText(previous)).toBeVisible();
  expect(sheet().getByRole('button', { name: '09:30 메이지 신궁' })).toBeVisible();
  expect(sheet().queryByRole('button', { name: /도쿄 국립박물관/ })).toBeNull();
  await fireEvent.press(sheet().getByRole('button', { name: '닫기' }));
  await press('1일 12.3');
  await press('전체 일정');
  expectOriginalSchedule();
});
