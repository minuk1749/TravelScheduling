import { act, fireEvent, screen, waitFor, within } from 'expo-router/testing-library';
import { constraintsFrom } from '@travel/core/contracts/results/model';
import { result } from '../src/theme';
import { deferred, json } from './helpers';
import { D1, D3, legId, openResult, place, plan, resultFixture, routes, trip, view } from './result-fixture';

const press = (name: string) => fireEvent.press(screen.getByRole('button', { name }));
const sheet = () => within(screen.getByTestId('form-sheet'));
const body = (f: ReturnType<typeof resultFixture>, call = 0) => JSON.parse(String(f.save.mock.calls[call][0].body));
const original = constraintsFrom(view.input);

test('3-5 and toast: switching a leg to taxi saves the leg mode, hides only that leg while recalculating, then can be undone', async () => {
  const f = resultFixture();
  await openResult(f);
  const calculation = deferred<Response>();
  f.generate.mockReturnValueOnce(calculation.promise);
  await press('택시 14분 약 ¥2,300로 바꾸기');

  await waitFor(() => expect(f.save).toHaveBeenCalledTimes(1));
  expect(body(f)).toEqual({ operationId: expect.any(String), expectedWriteVersion: view.writeVersion, revision: view.revision, constraints: { ...original,
    legModes: [{ date: D1, from: place('hotel'), to: place('museum'), mode: 'TAXI' }] } });
  expect(await screen.findByText('다시 계산 중')).toBeVisible();
  expect(screen.getByTestId('place-card-row')).toHaveStyle({ opacity: result.overlay.busy });
  expect(screen.getByRole('button', { name: '이 장소 수정' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '여행 조건 수정' })).toBeDisabled();
  expect(routes()[legId(D1, 'hotel', 'museum')]).toBeUndefined();
  expect(routes()[legId(D1, 'museum', 'market')]).toMatch(/ STRONG /);
  expect(routes()[legId(D1, 'airport', 'hotel', 'AIRPORT')]).toMatch(/ STRONG /);

  await act(async () => { calculation.resolve(json(trip(f.current().revision, plan({ museumLeg: 'TAXI', marketStart: '13:10' })))); });
  const toast = within(await screen.findByTestId('result-toast'));
  expect(toast.getByText('택시로 바꾸고 다시 계산했어요')).toBeVisible();
  expect(toast.getByText('아메요코 시장 10분 당겨짐 · 고정 예약은 그대로예요')).toBeVisible();
  expect(screen.getByText('택시 14분 · 약 ¥2,300')).toBeVisible();
  expect(screen.getByText('오는 길 · 도쿄 호텔 · 직접 지정 · 대기 16분')).toBeVisible();
  expect(screen.getByRole('button', { name: '1번 도쿄 국립박물관, 11:00부터 12:00까지', selected: true })).toBeVisible();
  await press('다음 장소');
  expect(screen.getByText(' · 10분 당겨짐')).toBeVisible();
  expect(screen.getByText('13:10 – 13:55')).toBeVisible();

  await fireEvent.press(toast.getByRole('button', { name: '되돌리기' }));
  await waitFor(() => expect(f.generate).toHaveBeenCalledTimes(3));
  expect(body(f, 1)).toEqual({ revision: '1'.padStart(64, 'b'), constraints: original, operationId: expect.any(String),
    expectedWriteVersion: expect.any(String), expectedOperationId: body(f).operationId });
  expect(await screen.findByText('되돌리고 다시 계산했어요')).toBeVisible();
  expect(screen.queryByRole('button', { name: '되돌리기' })).toBeNull();
});

test('3-3: the edit sheet highlights the edited place\'s legs and saves order fixes through the constraints API', async () => {
  const f = resultFixture();
  await openResult(f);
  await press('다음 장소');
  await press('이 장소 수정');
  expect(sheet().getByRole('header', { name: '아메요코 시장' })).toBeVisible();
  expect(routes()[legId(D1, 'museum', 'market')]).toMatch(/ STRONG /);
  expect(routes()[legId(D1, 'market', 'hotel')]).toMatch(/ STRONG /);
  expect(routes()[legId(D1, 'hotel', 'museum')]).toMatch(/ DIM /);
  expect(sheet().getByRole('button', { name: '적용하고 다시 계산' })).toBeDisabled();
  expect(sheet().getByLabelText('시각 고정')).toHaveProp('disabled', true);

  await fireEvent(sheet().getByLabelText('날짜 고정'), 'valueChange', true);
  expect(sheet().getByRole('button', { name: '1일차 12.3', selected: true })).toBeVisible();
  await fireEvent(sheet().getByLabelText('순서 고정'), 'valueChange', true);
  expect(sheet().getByText('2번째')).toBeVisible();
  expect(sheet().getByRole('button', { name: '순서 늦추기' })).toBeDisabled();
  await fireEvent.press(sheet().getByRole('button', { name: '순서 앞당기기' }));
  expect(sheet().getByText('1번째')).toBeVisible();
  await fireEvent(sheet().getByLabelText('시각 고정'), 'valueChange', true);
  expect(sheet().getByLabelText('고정 시각')).toHaveDisplayValue('13:20');
  await fireEvent.changeText(sheet().getByLabelText('고정 시각'), '25:00');
  expect(sheet().getByText(/고정 시각에는 날짜와 유효한 시각이 필요합니다/)).toBeVisible();
  expect(sheet().getByRole('button', { name: '적용하고 다시 계산' })).toBeDisabled();
  await fireEvent(sheet().getByLabelText('시각 고정'), 'valueChange', false);
  await fireEvent.press(sheet().getByRole('button', { name: '적용하고 다시 계산' }));

  await waitFor(() => expect(f.generate).toHaveBeenCalledTimes(2));
  expect(body(f).constraints.visits[1]).toEqual({ id: 'market', priority: 'REQUIRED', fixedDate: D1, fixedTime: null, fixedOrder: 0 });
  expect(await screen.findByText('수정하고 다시 계산했어요')).toBeVisible();
  expect(screen.getByRole('button', { name: '2번 아메요코 시장, 13:20부터 14:05까지', selected: true })).toBeVisible();
  expect(screen.getByText('🔒 1번째 순서 고정')).toBeVisible();
});

test('3-3: "희망으로 바꾸기" clears the fixed conditions and saves the place as a wish', async () => {
  const f = resultFixture();
  await openResult(f);
  await press('이 장소 수정');
  expect(sheet().getByLabelText('날짜 고정')).toHaveProp('value', true);
  expect(sheet().getByLabelText('시각 고정')).toHaveProp('value', true);
  await fireEvent(sheet().getByLabelText('희망으로 바꾸기'), 'valueChange', true);
  expect(sheet().getByLabelText('날짜 고정')).toHaveProp('disabled', true);
  await fireEvent.press(sheet().getByRole('button', { name: '적용하고 다시 계산' }));
  await waitFor(() => expect(f.generate).toHaveBeenCalledTimes(2));
  expect(body(f).constraints.visits[0]).toEqual({ id: 'museum', priority: 'WISH', fixedDate: null, fixedTime: null, fixedOrder: null });
  expect(await screen.findByText('수정하고 다시 계산했어요')).toBeVisible();
});

test('3-4: pressing a wish marker opens the date sheet and adds the wish to that day', async () => {
  const f = resultFixture();
  await openResult(f);
  f.generate.mockImplementationOnce(async () => json(trip(f.current().revision, plan({ cafeOnDay3: true }))));
  await fireEvent.press(screen.getByRole('button', { name: '지도 아사쿠사 카페' }));
  expect(sheet().getByRole('header', { name: '★ 아사쿠사 카페' })).toBeVisible();
  expect(screen.getByRole('button', { name: '지도 아사쿠사 카페', selected: true })).toBeVisible();
  expect(sheet().getByRole('button', { name: '1일차에 추가하고 다시 계산' })).toBeVisible();
  await fireEvent.press(sheet().getByRole('button', { name: '3일차 12.5' }));
  await fireEvent.press(sheet().getByRole('button', { name: '3일차에 추가하고 다시 계산' }));

  await waitFor(() => expect(f.generate).toHaveBeenCalledTimes(2));
  expect(body(f).constraints.visits[3]).toEqual({ id: 'cafe', priority: 'WISH', fixedDate: D3, fixedTime: null, fixedOrder: null });
  expect(await screen.findByText('3일차에 추가하고 다시 계산했어요')).toBeVisible();
  expect(screen.getByRole('button', { name: '3일 12.5', selected: true })).toBeVisible();
  expect(screen.getByRole('button', { name: '1번 아사쿠사 카페, 10:20부터 11:00까지', selected: true })).toBeVisible();
  expect(screen.getByText('🔒 날짜 고정')).toBeVisible();
  expect(screen.getByRole('button', { name: '지도 아사쿠사 카페' })).toHaveTextContent('PLACED 1');
});

test('3-6 → 3-4: "희망 장소에서 추가" presets the empty date and lists the wishes', async () => {
  const f = resultFixture();
  await openResult(f);
  await press('3일 12.5');
  await press('희망 장소에서 추가');
  expect(sheet().getByRole('header', { name: '희망 장소 추가' })).toBeVisible();
  expect(sheet().getByRole('button', { name: '★ 아사쿠사 카페', selected: true })).toBeVisible();
  expect(sheet().getByRole('button', { name: '3일차 12.5', selected: true })).toBeVisible();
  await fireEvent.press(sheet().getByRole('button', { name: '취소' }));
  expect(screen.queryByTestId('form-sheet')).toBeNull();
  expect(f.save).not.toHaveBeenCalled();
});
