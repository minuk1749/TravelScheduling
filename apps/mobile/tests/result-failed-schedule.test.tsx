import { act, fireEvent, screen, waitFor, within } from 'expo-router/testing-library';
import { deferred, json } from './helpers';
import { conflictTrip, openResult, plan, resultFixture, trip, view } from './result-fixture';

const press = (name: string) => fireEvent.press(screen.getByRole('button', { name }));
const sheet = () => within(screen.getByTestId('form-sheet'));
const staleLabel = '이전 계산 결과 · 갱신 실패';
const failure = () => json({ code: 'PROVIDER_UNAVAILABLE', error: '계산 실패' }, 503);

test.each(['after failure', 'while calculating', 'from previous schedule'])(
  'opening the timeline %s labels the last successful schedule and opens its selected card', async when => {
    const f = resultFixture();
    await openResult(f);
    const pending = deferred<Response>();
    f.generate.mockReturnValueOnce(pending.promise);
    await press('택시 14분 약 ¥2,300로 바꾸기');
    await waitFor(() => expect(f.generate).toHaveBeenCalledTimes(2));
    if (when === 'while calculating') {
      await press('전체 일정');
      expect(sheet().queryByText(staleLabel)).toBeNull();
    }
    await act(async () => pending.resolve(failure()));
    if (when !== 'while calculating') {
      await screen.findByText('계산 실패');
      if (when === 'from previous schedule') await press('이전 일정 보기');
      await press('전체 일정');
    }
    expect(sheet().getByText(staleLabel)).toBeVisible();
    expect(sheet().getByRole('button', { name: '택시 14분 약 ¥2,300로 바꾸기' })).toBeDisabled();
    await fireEvent.press(sheet().getByRole('button', { name: '13:20 아메요코 시장' }));
    expect(screen.queryByTestId('form-sheet')).toBeNull();
    expect(screen.getByText(staleLabel)).toBeVisible();
    expect(screen.getByRole('button', { name: '2번 아메요코 시장, 13:20부터 14:05까지', selected: true })).toBeVisible();
    expect(screen.getByRole('button', { name: '지도 아메요코 시장', selected: true })).toBeVisible();
    expect(screen.getByRole('button', { name: '이 장소 수정' })).toBeDisabled();

    f.generate.mockImplementationOnce(async () => json(trip(f.current().revision, plan({ marketStart: '13:10' }))));
    await press('다시 계산');
    await screen.findByText('다시 계산했어요');
    await press('전체 일정');
    expect(sheet().queryByText(staleLabel)).toBeNull();
    expect(sheet().queryByRole('button', { name: '13:20 아메요코 시장' })).toBeNull();
    expect(sheet().getByRole('button', { name: '13:10 아메요코 시장' })).toBeVisible();
    expect(f.save).toHaveBeenCalledTimes(1);
  },
);

test('a failed first conflict edit closes the open timeline when there is no successful result to browse', async () => {
  const f = resultFixture();
  f.generate.mockResolvedValueOnce(json(conflictTrip(view.revision)));
  await openResult(f);
  await press('아메요코 시장 고정 수정');
  await fireEvent(sheet().getByLabelText('날짜 고정'), 'valueChange', true);
  const pending = deferred<Response>();
  f.generate.mockReturnValueOnce(pending.promise);
  await fireEvent.press(sheet().getByRole('button', { name: '적용하고 다시 계산' }));
  await waitFor(() => expect(f.generate).toHaveBeenCalledTimes(2));
  await press('전체 일정');
  expect(sheet().getByText('장소 정보 · Google Maps')).toBeVisible();
  await act(async () => pending.resolve(failure()));
  expect(screen.getByText('계산 실패')).toBeVisible();
  expect(screen.queryByTestId('form-sheet')).toBeNull();
  expect(screen.queryByRole('button', { name: '전체 일정' })).toBeNull();
  expect(screen.queryByRole('button', { name: '이전 일정 보기' })).toBeNull();
  expect(screen.queryByText(staleLabel)).toBeNull();
  await press('다시 계산');
  await screen.findByText('다시 계산했어요');
  expect(screen.queryByTestId('form-sheet')).toBeNull();
  await press('전체 일정');
  expect(sheet().getByRole('button', { name: '13:20 아메요코 시장' })).toBeVisible();
});
