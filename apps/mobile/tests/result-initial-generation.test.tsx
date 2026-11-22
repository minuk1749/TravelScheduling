import { act, fireEvent, screen, waitFor, within } from 'expo-router/testing-library';
import { deferred, json } from './helpers';
import { renderResult, resultFixture, trip } from './result-fixture';

test('the first calculation shows progress over an empty map, then opens the saved result', async () => {
  const f = resultFixture();
  const pending = deferred<Response>();
  f.generate.mockReturnValueOnce(pending.promise);
  await renderResult(f);
  const panel = within(await screen.findByTestId('initial-place-panel'));
  expect(panel.getByText('동선을 만드는 중')).toBeVisible();
  expect(panel.getByRole('button', { name: '저장한 여행 보기' })).toBeVisible();
  expect(screen.getByTestId('result-map')).toBeVisible();
  expect(screen.queryAllByTestId(/^route-|^marker-/)).toHaveLength(0);
  expect(screen.queryByTestId('place-card-row')).toBeNull();
  expect(f.shapes).not.toHaveBeenCalled();
  expect(f.read).not.toHaveBeenCalled();

  await act(async () => pending.resolve(json(trip(f.current().revision))));
  expect(await screen.findByTestId('place-card-row')).toBeVisible();
  expect(screen.queryByTestId('initial-place-panel')).toBeNull();
  expect(f.generate).toHaveBeenCalledTimes(1);
});

const failure = (error: string) => json({ code: 'PROVIDER_UNAVAILABLE', error }, 503);
const press = (name: string) => fireEvent.press(screen.getByRole('button', { name }));

test('an initial error stays on the empty map, keeps the saved input and retries only the generation', async () => {
  const f = resultFixture();
  const saved = f.current();
  const retry = deferred<Response>();
  f.generate.mockResolvedValueOnce(failure('경로 제공자 오류')).mockReturnValueOnce(retry.promise);
  await renderResult(f);
  await screen.findByText(/경로 제공자 오류/);
  const panel = within(screen.getByTestId('initial-place-panel'));
  expect(panel.getByText('⚠ 동선을 계산하지 못했어요')).toBeVisible();
  expect(panel.getByText('입력한 장소와 고정 조건은 그대로 있어요')).toBeVisible();
  expect(panel.getByText('경로 제공자 오류')).toBeVisible();
  expect(panel.getByRole('button', { name: '저장한 여행 보기' })).toBeVisible();
  expect(panel.queryByRole('button', { name: '이전 일정 보기' })).toBeNull();
  expect(screen.getByTestId('result-map')).toBeVisible();
  expect(screen.queryAllByTestId(/^route-|^marker-/)).toHaveLength(0);
  expect(screen.queryByTestId('place-card-row')).toBeNull();
  await press('다시 계산');
  await waitFor(() => expect(f.generate).toHaveBeenCalledTimes(2));
  expect(panel.getByText('동선을 만드는 중')).toBeVisible();
  expect(panel.queryByRole('button', { name: '다시 계산' })).toBeNull();
  await act(async () => retry.resolve(failure('재시도 경로 오류')));
  expect(panel.getByText('재시도 경로 오류')).toBeVisible();
  expect(panel.queryByText('경로 제공자 오류')).toBeNull();
  expect(f.read).not.toHaveBeenCalled();
  expect(f.shapes).not.toHaveBeenCalled();
  await press('다시 계산');
  expect(await screen.findByTestId('place-card-row')).toBeVisible();
  expect(screen.queryByText('재시도 경로 오류')).toBeNull();
  expect(f.generate).toHaveBeenCalledTimes(3);
  expect(f.save).not.toHaveBeenCalled();
  expect(f.current()).toEqual(saved);
});

test('an initial error can open the conditions of the existing trip', async () => {
  const f = resultFixture();
  f.generate.mockResolvedValueOnce(failure('경로 제공자 오류'));
  await renderResult(f);
  await screen.findByText(/경로 제공자 오류/);
  await press('여행 조건 수정');
  expect(screen).toHavePathname('/trips/trip/settings');
  expect(f.generate).toHaveBeenCalledTimes(1);
  expect(f.save).not.toHaveBeenCalled();
});

test('leaving during a retry cancels the request and a late success cannot reopen the result', async () => {
  const f = resultFixture();
  const pending = deferred<Response>();
  f.generate.mockResolvedValueOnce(failure('경로 제공자 오류')).mockReturnValueOnce(pending.promise);
  await renderResult(f);
  await screen.findByText(/경로 제공자 오류/);
  await press('다시 계산');
  await waitFor(() => expect(f.generate).toHaveBeenCalledTimes(2));
  const request = f.transport.mock.calls.filter(([url]) => String(url).endsWith('/itinerary'))[1][1]!;
  expect(request.signal?.aborted).toBe(false);
  await press('저장한 여행 보기');
  expect(await screen.findByText('저장한 여행')).toBeVisible();
  expect(request.signal?.aborted).toBe(true);
  await act(async () => pending.resolve(json(trip(f.current().revision))));
  expect(screen).toHavePathname('/trips/trip');
  expect(screen.queryByTestId('result-map')).toBeNull();
  expect(f.read).not.toHaveBeenCalled();
  expect(f.shapes).not.toHaveBeenCalled();
});
