import { act, fireEvent, screen, waitFor } from 'expo-router/testing-library';
import { constraintsFrom } from '@travel/core/contracts/results/model';
import { colors, layout } from '../src/theme';
import { button, capacityFixture, checkbox, conflict, excess, initialView, openCapacity, press, success, toggle } from './capacity-fixture';
import { generationKeys, deferred, json } from './helpers';

test('4-1 and 4-2: opens on over-capacity, keeps the saved priorities and updates the count and color', async () => {
  const f = capacityFixture();
  await openCapacity(f);
  expect(await screen.findByRole('header', { name: '필수 장소 선택' })).toBeVisible();
  expect(await screen.findByText('시간이 부족해요')).toBeVisible();
  expect(screen.getByText('추천 최대 필수 2곳 (추정)')).toBeVisible();
  expect(screen.getByText('2곳 이하여도 배치되지 않을 수 있어요.')).toBeVisible();
  expect(screen.getByText('현재 선택 3곳')).toHaveStyle({ color: colors.amber.text });
  expect(checkbox('해변')).toHaveProp('accessibilityState', expect.objectContaining({ checked: true }));
  expect(checkbox('카페')).toHaveProp('accessibilityState', expect.objectContaining({ checked: false }));

  await toggle('해변');
  expect(screen.getByText('현재 선택 2곳')).toHaveStyle({ color: colors.sky.text });
  expect(checkbox('해변')).toHaveProp('accessibilityState', expect.objectContaining({ checked: false }));
  expect(screen.getAllByText('☆ 희망')).toHaveLength(2);
  await toggle('카페');
  expect(screen.getByText('현재 선택 3곳')).toHaveStyle({ color: colors.amber.text });
  expect(f.save).not.toHaveBeenCalled();
  expect(f.generate).toHaveBeenCalledTimes(1);
});

test('4-3: confirms every fixed condition and clears only that visit when saving as a wish', async () => {
  const f = capacityFixture();
  await openCapacity(f);
  await screen.findByText('시간이 부족해요');
  await toggle('도쿄 미술관');
  expect(screen.getByText('고정 조건을 해제할까요?')).toBeVisible();
  expect(screen.getByText('🔒 날짜 고정 · 2026-12-01')).toBeVisible();
  expect(screen.getByText('🔒 시각 고정 · 11:00')).toBeVisible();
  expect(screen.getByText('🔒 순서 고정 · 1번째')).toBeVisible();

  await press('필수로 유지');
  expect(checkbox('도쿄 미술관')).toHaveProp('accessibilityState', expect.objectContaining({ checked: true }));
  expect(screen.getByText('현재 선택 3곳')).toBeVisible();
  await toggle('도쿄 미술관');
  await press('고정 해제하고 희망으로');
  expect(checkbox('도쿄 미술관')).toHaveProp('accessibilityState', expect.objectContaining({ checked: false }));
  expect(screen.getByText('현재 선택 2곳')).toBeVisible();
  expect(f.save).not.toHaveBeenCalled();

  await press('선택한 2곳으로 다시 계산');
  await waitFor(() => expect(f.generate).toHaveBeenCalledTimes(2));
  const original = constraintsFrom(initialView.input);
  expect(JSON.parse(String(f.save.mock.calls[0][0].body))).toEqual({
    revision: 'original', constraints: { ...original, visits: [
      { id: 'museum', priority: 'WISH', fixedDate: null, fixedTime: null, fixedOrder: null }, ...original.visits.slice(1),
    ] },
  });
});

test('4-4 and 4-5: disables editing through save and verification, then opens the same verified result', async () => {
  const f = capacityFixture();
  const save = deferred<Response>();
  const checked = deferred<Response>();
  const persist = f.save.getMockImplementation()!;
  f.save.mockReturnValueOnce(save.promise);
  f.generate.mockResolvedValueOnce(json(excess)).mockReturnValueOnce(checked.promise);
  await openCapacity(f);
  await screen.findByText('시간이 부족해요');
  await toggle('해변');
  await press('선택한 2곳으로 다시 계산');

  expect(screen.getByRole('button', { name: '다시 확인 중', busy: true })).toBeDisabled();
  expect(screen.getByTestId('capacity-candidates')).toHaveStyle(layout.dimmed);
  expect(checkbox('해변')).toBeDisabled();
  expect(button('여행 조건 수정')).toBeDisabled();
  await toggle('해변');
  await press('다시 확인 중');
  expect(f.save).toHaveBeenCalledTimes(1);
  expect(f.generate).toHaveBeenCalledTimes(1);

  const saved = await persist(f.save.mock.calls[0][0]);
  await act(async () => { save.resolve(saved); });
  expect(screen.getByRole('button', { name: '다시 확인 중', busy: true })).toBeDisabled();
  expect(checkbox('해변')).toHaveProp('accessibilityState', expect.objectContaining({ checked: false, disabled: true }));
  expect(f.generate).toHaveBeenCalledTimes(2);

  await act(async () => { checked.resolve(json(success)); });
  expect(await screen.findByRole('header', { name: '배치 가능' })).toBeVisible();
  await press('동선 보기');
  expect(await screen.findByRole('header', { name: '도쿄' })).toBeVisible();
  expect(screen.getByRole('button', { name: '1번 도쿄 미술관, 11:00부터 12:00까지', selected: true })).toBeVisible();
  expect(screen.getByRole('button', { name: '2번 사찰, 12:30부터 13:30까지', selected: false })).toBeVisible();
  expect(screen.getByRole('button', { name: '지도 해변' })).toHaveTextContent('WISH -');
  expect(screen.queryByText(/해변/)).toBeNull();
  expect(f.generate).toHaveBeenCalledTimes(2);
  expect(f.read).toHaveBeenCalledTimes(1);
});

test('4-6: a different selection at N can fail, with named problem places above the remaining candidates', async () => {
  const f = capacityFixture();
  f.generate.mockResolvedValueOnce(json(excess)).mockResolvedValueOnce(json(conflict));
  await openCapacity(f);
  await screen.findByText('시간이 부족해요');
  await toggle('사찰');
  await press('선택한 2곳으로 다시 계산');

  expect(await screen.findByText('선택한 장소를 배치할 수 없어요')).toBeVisible();
  expect(screen.getByText(/도쿄 미술관 → 해변 · 이동 불가/)).toBeVisible();
  expect(screen.getAllByRole('checkbox').map(row => row.props.accessibilityLabel)).toEqual([
    '도쿄 미술관 필수', '해변 필수', '사찰 필수', '카페 필수',
  ]);
  expect(checkbox('해변')).toHaveProp('accessibilityHint', expect.stringContaining('이동 불가'));
  expect(screen.queryByRole('button', { name: '동선 보기' })).toBeNull();
  await press('문제 장소로 이동');
  await toggle('해변');
  expect(screen.getByText('현재 선택 1곳')).toBeVisible();
  expect(screen.queryByText('문제가 된 장소')).toBeNull();
});

test('updates the estimate after another over-capacity response and permits rechecking above the estimate', async () => {
  const f = capacityFixture();
  f.generate.mockResolvedValueOnce(json(excess)).mockResolvedValueOnce(json({
    ...excess, capacity: { ...excess.capacity,
      recommendation: { ...excess.capacity.recommendation, requiredCount: 1, requiredVisitIds: ['museum'] } },
  }));
  await openCapacity(f);
  await screen.findByText('시간이 부족해요');
  await press('선택한 3곳으로 다시 계산');
  expect(await screen.findByText('추천 최대 필수 1곳 (추정)')).toBeVisible();
  expect(screen.getByText('문제가 된 장소')).toBeVisible();
  expect(f.save).not.toHaveBeenCalled();
});

test('retains saved selections and retries only POST after a provider error', async () => {
  const f = capacityFixture();
  f.generate.mockResolvedValueOnce(json(excess))
    .mockResolvedValueOnce(json({ code: 'PROVIDER_UNAVAILABLE', error: '지도 서비스 연결을 확인해 주세요.' }, 503))
    .mockResolvedValueOnce(json(success));
  await openCapacity(f);
  await screen.findByText('시간이 부족해요');
  await toggle('해변');
  await press('선택한 2곳으로 다시 계산');
  expect(await screen.findByText(/지도 서비스 연결을 확인해 주세요/)).toBeVisible();
  expect(checkbox('해변')).toHaveProp('accessibilityState', expect.objectContaining({ checked: false }));
  expect(f.current().input.visits.find(row => row.id === 'coast')?.priority).toBe('WISH');

  await press('선택한 2곳으로 다시 계산');
  expect(await screen.findByRole('header', { name: '배치 가능' })).toBeVisible();
  expect(f.save).toHaveBeenCalledTimes(1);
  expect(f.generate).toHaveBeenCalledTimes(3);
  const [initial, selection, retry] = generationKeys(f);
  expect(selection).not.toBe(initial);
  expect(retry).toBe(selection);
});

test('blocks verification after a stale save and reloads the stored selection on request', async () => {
  const f = capacityFixture();
  f.save.mockResolvedValueOnce(json({ code: 'STALE_INPUT', error: '저장된 설정을 다시 불러와 주세요.' }, 409));
  await openCapacity(f);
  await screen.findByText('시간이 부족해요');
  await toggle('해변');
  await press('선택한 2곳으로 다시 계산');
  expect(await screen.findByText(/저장된 설정을 다시 불러와 주세요/)).toBeVisible();
  expect(button('선택한 2곳으로 다시 계산')).toBeDisabled();
  expect(f.generate).toHaveBeenCalledTimes(1);
  await press('저장된 설정 다시 불러오기');
  expect(await screen.findByText('현재 선택 3곳')).toBeVisible();
  expect(f.read).toHaveBeenCalledTimes(2);
});

test('rejects a calculated result for a different input revision', async () => {
  const f = capacityFixture();
  f.generate.mockResolvedValueOnce(json(excess)).mockResolvedValueOnce(json({ ...success, inputHash: 'other' }));
  await openCapacity(f);
  await screen.findByText('시간이 부족해요');
  await toggle('해변');
  await press('선택한 2곳으로 다시 계산');
  expect(await screen.findByText(/여행 정보가 바뀌었어요/)).toBeVisible();
  expect(screen.queryByRole('button', { name: '동선 보기' })).toBeNull();
  expect(button('저장된 설정 다시 불러오기')).toBeVisible();
});

test('revalidates the current input when a concurrent edit preceded the candidate load', async () => {
  const f = capacityFixture();
  f.read.mockReturnValueOnce(json({ ...initialView, revision: 'new-input' }));
  f.generate.mockResolvedValueOnce(json(excess)).mockResolvedValueOnce(json({
    ...excess, inputHash: 'new-input', capacity: { ...excess.capacity,
      recommendation: { ...excess.capacity.recommendation, requiredCount: 1, requiredVisitIds: ['museum'] } },
  }));
  await openCapacity(f);
  expect(await screen.findByText('추천 최대 필수 1곳 (추정)')).toBeVisible();
  expect(screen.queryByText('추천 최대 필수 2곳 (추정)')).toBeNull();
  expect(f.generate).toHaveBeenCalledTimes(2);
  expect(f.save).not.toHaveBeenCalled();
});

test('opens living settings from the conditions action and offers selection after a settings save', async () => {
  const f = capacityFixture();
  await openCapacity(f);
  await screen.findByText('시간이 부족해요');
  await press('여행 조건 수정');
  expect(screen).toHavePathname('/trips/trip/settings');
  await fireEvent.press(await screen.findByRole('button', { name: '설정 저장' }));
  expect(await screen.findByText('시간이 부족해요')).toBeVisible();
  expect(screen.getByText('현재 선택 3곳')).toBeVisible();
  expect(f.generate).toHaveBeenCalledTimes(2);
  await press('여행 조건 수정');
  expect(await screen.findByRole('button', { name: '설정 저장' })).toBeVisible();
  expect(f.settings.mock.calls.map(([options]) => options.method ?? 'GET')).toEqual(['GET', 'PUT', 'GET']);
});
