import { fireEvent, screen, waitFor, within } from 'expo-router/testing-library';
import { constraintsFrom } from '@travel/core/contracts/results/model';
import { colors } from '../src/theme';
import { json } from './helpers';
import { conflictTrip, D1, openResult, place, resultFixture, routes, trip, view } from './result-fixture';

const press = (name: string) => fireEvent.press(screen.getByRole('button', { name }));
const sheet = () => within(screen.getByTestId('form-sheet'));

async function moveMarketFirst(f: ReturnType<typeof resultFixture>) {
  await press('다음 장소');
  await press('이 장소 수정');
  await fireEvent(sheet().getByLabelText('날짜 고정'), 'valueChange', true);
  await fireEvent(sheet().getByLabelText('순서 고정'), 'valueChange', true);
  await fireEvent.press(sheet().getByRole('button', { name: '순서 앞당기기' }));
  await fireEvent.press(sheet().getByRole('button', { name: '적용하고 다시 계산' }));
  await waitFor(() => expect(f.generate).toHaveBeenCalledTimes(2));
}

test('3-8: a conflicting fix selects the cause card, fades every leg, draws the failed leg in red and can be cancelled', async () => {
  const f = resultFixture();
  await openResult(f);
  f.generate.mockImplementationOnce(async () => json(conflictTrip(f.current().revision)));
  await moveMarketFirst(f);

  expect(await screen.findByText('⚠ 고정 조건 충돌 2건')).toHaveStyle({ color: colors.red.text });
  expect(screen.queryByText(/장소 2곳 · 이동/)).toBeNull();
  expect(screen.getByRole('button', { name: '2번 아메요코 시장, 13:20부터 14:05까지', selected: true })).toBeVisible();
  expect(screen.getByText('⚠ 고정 순서 충돌')).toBeVisible();
  expect(screen.getByText('⚠ 도쿄 국립박물관 → 아메요코 시장 · 이동 불가')).toBeVisible();
  expect(screen.getByText('고정된 장소는 자동으로 옮기지 않아요')).toBeVisible();
  expect(screen.queryByRole('button', { name: '다음 장소' })).toBeNull();
  expect(Object.values(routes()).filter(route => / (STRONG|DIM) /.test(route)).every(route => / DIM /.test(route))).toBe(true);
  expect(routes()['conflict:1']).toBe(`2 TRANSIT FLOATING CONFLICT ${colors.red.text} STRAIGHT`);
  expect(screen.queryByTestId('result-toast')).toBeNull();

  await press('아메요코 시장 고정 수정');
  expect(sheet().getByRole('header', { name: '아메요코 시장' })).toBeVisible();
  expect(sheet().getByLabelText('순서 고정')).toHaveProp('value', true);
  await fireEvent.press(sheet().getByRole('button', { name: '취소' }));

  await press('변경 취소');
  await waitFor(() => expect(f.generate).toHaveBeenCalledTimes(3));
  expect(JSON.parse(String(f.save.mock.calls[1][0].body)).constraints).toEqual(constraintsFrom(view.input));
  expect(await screen.findByText('08:30 – 14:35 · 장소 2곳 · 이동 1시간 55분')).toBeVisible();
  expect(screen.queryByText(/고정 조건 충돌/)).toBeNull();
});

test('3-9: a failed recalculation keeps the saved change, can show the previous result faded and retries only POST', async () => {
  const f = resultFixture();
  await openResult(f);
  f.generate.mockResolvedValueOnce(json({ code: 'PROVIDER_UNAVAILABLE', error: '이동 정보를 불러오지 못했어요.' }, 503));
  await press('택시 14분 약 ¥2,300로 바꾸기');

  expect(await screen.findByText('⚠ 동선을 계산하지 못했어요')).toBeVisible();
  expect(screen.getByText('입력한 장소와 고정 조건은 그대로 있어요')).toBeVisible();
  expect(screen.getByText('이동 정보를 불러오지 못했어요.')).toBeVisible();
  expect(screen.queryByTestId('place-card-row')).toBeNull();
  expect(screen.getByTestId('map-state')).toHaveTextContent(/^dimmed/);
  expect(f.current().input.legModes).toEqual([{ date: D1, from: place('hotel'), to: place('museum'), mode: 'TAXI' }]);

  await press('이전 일정 보기');
  expect(screen.getByText('이전 계산 결과 · 갱신 실패')).toBeVisible();
  expect(screen.getByRole('button', { name: '1번 도쿄 국립박물관, 11:00부터 12:00까지', selected: true })).toBeVisible();
  expect(screen.getByRole('button', { name: '택시 14분 약 ¥2,300로 바꾸기' })).toBeDisabled();
  expect(Object.values(routes()).every(route => / DIM /.test(route))).toBe(true);

  f.generate.mockResolvedValueOnce(json({ code: 'PROVIDER_UNAVAILABLE', error: '다시 실패했어요.' }, 503));
  await press('다시 계산');
  expect(await screen.findByText('다시 실패했어요.')).toBeVisible();
  expect(screen.queryByText('이전 계산 결과 · 갱신 실패')).toBeNull();
  await press('다시 계산');
  expect(await screen.findByText('다시 계산했어요')).toBeVisible();
  expect(f.save).toHaveBeenCalledTimes(1);
  expect(f.generate).toHaveBeenCalledTimes(4);
  expect(screen.getByTestId('map-state')).toHaveTextContent(/^clear/);
  expect(screen.queryByText('이전 계산 결과 · 갱신 실패')).toBeNull();
});

test('a result for another input revision is stale; retry re-reads the input before recalculating', async () => {
  const f = resultFixture();
  await openResult(f);
  f.generate.mockImplementationOnce(async () => json(trip('c'.repeat(64))));
  await press('택시 14분 약 ¥2,300로 바꾸기');
  expect(await screen.findByText(/여행 정보가 바뀌었어요/)).toBeVisible();
  await press('다시 계산');
  expect(await screen.findByText('다시 계산했어요')).toBeVisible();
  expect(f.read).toHaveBeenCalledTimes(2);
  expect(f.save).toHaveBeenCalledTimes(1);
});

test('opening a result whose input changed elsewhere recalculates once; a calculation error can be reloaded', async () => {
  const f = resultFixture();
  f.generate.mockResolvedValueOnce(json(trip('d'.repeat(64))));
  await openResult(f);
  expect(f.generate).toHaveBeenCalledTimes(2);
  expect(f.read).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: '1번 도쿄 국립박물관, 11:00부터 12:00까지', selected: true })).toBeVisible();
  await press('뒤로');
  expect(await screen.findByText('저장한 여행')).toBeVisible();
});

test('the conditions action leaves for living settings; a CONFLICT first calculation opens on its cause', async () => {
  const f = resultFixture();
  f.generate.mockImplementationOnce(async () => json(conflictTrip(view.revision)));
  await openResult(f);
  expect(screen.getByText('⚠ 고정 조건 충돌 2건')).toBeVisible();
  expect(screen.getByRole('button', { name: '아메요코 시장, 배치되지 않음', selected: true })).toBeVisible();
  expect(screen.getByText('이동 정보 없음')).toBeVisible();
  expect(screen.queryByRole('button', { name: '변경 취소' })).toBeNull();
  expect(routes()).toEqual({ 'conflict:1': `2 TRANSIT FLOATING CONFLICT ${colors.red.text} STRAIGHT` });
  expect(f.shapes).not.toHaveBeenCalled();
  await press('여행 조건 수정');
  expect(screen).toHavePathname('/trips/trip/settings');
});
