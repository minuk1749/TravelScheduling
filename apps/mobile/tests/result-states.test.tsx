import { act, fireEvent, screen, waitFor, within } from 'expo-router/testing-library';
import { constraintsFrom } from '@travel/core/contracts/results/model';
import { colors } from '../src/theme';
import { generationKeys, deferred, json } from './helpers';
import { conflictTrip, D1, legId, openResult, place, resultFixture, routes, trip, view } from './result-fixture';

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

  await press('지도 도쿄 국립박물관');
  expect(screen.getByRole('button', { name: '지도 도쿄 국립박물관', selected: true })).toBeVisible();
  expect(screen.getByRole('button', { name: '1번 도쿄 국립박물관, 11:00부터 12:00까지', selected: true })).toBeVisible();
  await press('아메요코 시장 고정 수정');
  expect(sheet().getByRole('header', { name: '아메요코 시장' })).toBeVisible();
  expect(sheet().getByLabelText('순서 고정')).toHaveProp('value', true);
  expect(screen.getByRole('button', { name: '2번 아메요코 시장, 13:20부터 14:05까지', selected: true })).toBeVisible();
  expect(screen.getByRole('button', { name: '지도 아메요코 시장', selected: true })).toBeVisible();
  expect(Object.entries(routes()).filter(([, route]) => / STRONG /.test(route)).map(([id]) => id)).toEqual([
    legId(D1, 'museum', 'market'), legId(D1, 'market', 'hotel'),
  ]);
  expect(routes()['conflict:1']).toBeUndefined();
  await fireEvent.press(sheet().getByRole('button', { name: '취소' }));
  expect(screen.getByRole('button', { name: '1번 도쿄 국립박물관, 11:00부터 12:00까지', selected: true })).toBeVisible();
  expect(screen.getByRole('button', { name: '지도 도쿄 국립박물관', selected: true })).toBeVisible();
  expect(routes()['conflict:1']).toMatch(/ CONFLICT /);
  expect(Object.values(routes()).some(route => / STRONG /.test(route))).toBe(false);

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
  const [initial, edit, firstRetry, secondRetry] = generationKeys(f);
  expect(edit).not.toBe(initial);
  expect([firstRetry, secondRetry]).toEqual([edit, edit]);
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


test('a conflict-only wish card falls back to the same visible card and marker in the previous schedule', async () => {
  const f = resultFixture();
  await openResult(f);
  await press('지도 아사쿠사 카페');
  f.generate.mockImplementationOnce(async () => {
    const conflict = conflictTrip(f.current().revision);
    conflict.capacity.unplaced = [{ visitId: 'cafe', reason: 'TIME_WINDOW', fixed: true }];
    return json(conflict);
  });
  await fireEvent.press(sheet().getByRole('button', { name: '1일차에 추가하고 다시 계산' }));
  await screen.findByRole('button', { name: '아사쿠사 카페 고정 수정' });
  expect(screen.getByRole('button', { name: '지도 아사쿠사 카페', selected: true })).toBeVisible();
  await press('지도 도쿄 국립박물관');
  expect(screen.getByRole('button', { name: '지도 도쿄 국립박물관', selected: true })).toBeVisible();
  await press('지도 아사쿠사 카페');
  expect(sheet().getByText('★ 아사쿠사 카페')).toBeVisible();
  await fireEvent.press(sheet().getByRole('button', { name: '취소' }));
  await press('아사쿠사 카페, 배치되지 않음');
  expect(screen.getByRole('button', { name: '아사쿠사 카페, 배치되지 않음', selected: true })).toBeVisible();
  expect(screen.getByRole('button', { name: '지도 아사쿠사 카페', selected: true })).toHaveTextContent('WISH -');
  await press('아사쿠사 카페 고정 수정');
  await fireEvent(sheet().getByLabelText('순서 고정'), 'valueChange', true);
  f.generate.mockRejectedValueOnce(new Error('offline'));
  await fireEvent.press(sheet().getByRole('button', { name: '적용하고 다시 계산' }));
  await screen.findByText('⚠ 동선을 계산하지 못했어요');
  await press('이전 일정 보기');
  expect(screen.getByRole('button', { name: '2번 아메요코 시장, 13:20부터 14:05까지', selected: true })).toBeVisible();
  expect(screen.getByRole('button', { name: '지도 아메요코 시장', selected: true })).toBeVisible();
  expect(screen.getByText('2 / 2')).toBeVisible();
  expect(screen.getByRole('button', { name: '다음 장소' })).toBeDisabled();
  await press('이전 장소');
  expect(screen.getByRole('button', { name: '지도 도쿄 국립박물관', selected: true })).toBeVisible();
});

test('the last OK timeline keeps its matched road geometry during a conflict and subsequent failed calculation', async () => {
  const f = resultFixture();
  const museum = legId(D1, 'hotel', 'museum'), points = 'points-' + museum;
  const road = JSON.stringify([{ latitude: 38.5, longitude: -120.2 }, { latitude: 40.7, longitude: -120.95 }]);
  await openResult(f);
  expect(await screen.findByTestId(points)).toHaveTextContent(road);
  f.generate.mockImplementationOnce(async () => json({ ...conflictTrip(f.current().revision),
    itineraryId: '3f6291ea-888b-41ff-b5b9-845fa2ab8a44' }));
  await moveMarketFirst(f);
  await screen.findByText('⚠ 고정 조건 충돌 2건');
  expect(screen.getByTestId(points)).toHaveTextContent(road);
  expect(routes()[museum]).toMatch(/ DIM .* ROAD$/);
  expect(Object.entries(routes()).filter(([, line]) => / CONFLICT /.test(line)).map(([id]) => id)).toEqual(['conflict:1']);

  f.generate.mockResolvedValueOnce(json({ code: 'PROVIDER_UNAVAILABLE', error: '계산 실패' }, 503));
  await press('변경 취소');
  await screen.findByText('계산 실패');
  await press('이전 일정 보기');
  expect(screen.getByText('이전 계산 결과 · 갱신 실패')).toBeVisible();
  expect(screen.getByTestId(points)).toHaveTextContent(road);
  expect(routes()[museum]).toMatch(/ DIM .* ROAD$/);
  expect(routes()['conflict:1']).toBeUndefined();
  expect(f.shapes).toHaveBeenCalledTimes(1);

  // Generating a new OK result after the recovery immediately stops showing the old geometry.
  const nextId = 'acb2f5ce-e627-4539-85eb-0b70fa4cedbb';
  const nextShapes = deferred<Response>();
  f.generate.mockImplementationOnce(async () => json({ ...trip(f.current().revision), itineraryId: nextId }));
  f.shapes.mockReturnValueOnce(nextShapes.promise);
  await press('다시 계산');
  await waitFor(() => expect(f.shapes).toHaveBeenCalledTimes(2));
  const [url] = f.shapes.mock.calls[1];
  expect(url.searchParams.get('itineraryId')).toBe(nextId);
  expect(screen.queryByTestId(points)).toBeNull();
  expect(routes()[museum]).toMatch(/ STRAIGHT$/);
  await act(async () => nextShapes.resolve(json({
    inputHash: f.current().revision, itineraryId: nextId,
    legs: trip(f.current().revision).comparisons.map(leg => ({
      date: leg.date, kind: leg.kind, from: leg.from, to: leg.to, mode: leg.selected.mode,
      shape: { status: 'OK', encodedPolyline: '??_ibE_ibE' },
    })),
  })));
  expect(await screen.findByTestId(points)).toHaveTextContent(JSON.stringify([
    { latitude: 0, longitude: 0 }, { latitude: 1, longitude: 1 },
  ]));
});
