import { act, fireEvent, screen, waitFor } from 'expo-router/testing-library';
import { constraintsFrom } from '@travel/core/contracts/results/model';
import { generationKeys, deferred, json } from './helpers';
import { excess, initialView } from './capacity-fixture';
import { D1, plan, renderResult, resultFixture, trip } from './result-fixture';

const press = (name: string) => fireEvent.press(screen.getByRole('button', { name }));
const failure = (error: string) => json({ code: 'PROVIDER_UNAVAILABLE', error }, 503);
const outdated = () => json(trip('d'.repeat(64)));

test('opening a stale result recalculates on an empty map and recovers from a 503 without resaving the input', async () => {
  const f = resultFixture();
  const saved = f.current();
  const pending = deferred<Response>();
  f.generate.mockResolvedValueOnce(outdated()).mockReturnValueOnce(pending.promise);
  await renderResult(f);
  await waitFor(() => expect(f.generate).toHaveBeenCalledTimes(2));
  expect(screen.getByText('동선을 만드는 중')).toBeVisible();
  expect(screen.getByTestId('result-map')).toBeVisible();
  expect(screen.queryAllByTestId(/^route-|^marker-/)).toHaveLength(0);
  expect(screen.queryByTestId('place-card-row')).toBeNull();
  expect(screen.queryByText('동선을 불러오는 중')).toBeNull();
  await act(async () => pending.resolve(failure('경로 제공자가 응답하지 않았어요.')));
  expect(await screen.findByText('⚠ 동선을 계산하지 못했어요')).toBeVisible();
  expect(screen.getByText('경로 제공자가 응답하지 않았어요.')).toBeVisible();
  expect(screen.getByText('입력한 장소와 고정 조건은 그대로 있어요')).toBeVisible();
  expect(screen.queryByRole('button', { name: '이전 일정 보기' })).toBeNull();
  expect(f.shapes).not.toHaveBeenCalled();
  await press('다시 계산');
  expect(await screen.findByTestId('place-card-row')).toBeVisible();
  expect(f.current()).toEqual(saved);
  expect(f.read).toHaveBeenCalledTimes(1);
  expect(f.generate).toHaveBeenCalledTimes(3);
  const [initial, recalculated, retried] = generationKeys(f);
  expect(recalculated).not.toBe(initial);
  expect(retried).toBe(recalculated);
  expect(f.save).not.toHaveBeenCalled();
});

test('a remote edit during retry pairs the new result with the new reservation, even if reading that input needs a retry', async () => {
  const f = resultFixture();
  const retry = deferred<Response>();
  f.generate.mockResolvedValueOnce(outdated()).mockResolvedValueOnce(failure('첫 계산 실패')).mockReturnValueOnce(retry.promise);
  await renderResult(f);
  await screen.findByText('첫 계산 실패');
  await press('다시 계산');
  await waitFor(() => expect(f.generate).toHaveBeenCalledTimes(3));
  expect(screen.getByText('동선을 만드는 중')).toBeVisible();

  const constraints = constraintsFrom(f.current().input);
  const visits = constraints.visits.map(visit => visit.id === 'market' ? { ...visit, fixedDate: D1, fixedTime: '13:10' } : visit);
  const response = await f.save.getMockImplementation()!({ body: JSON.stringify({
    revision: f.current().revision, constraints: { ...constraints, visits },
  }) });
  expect(response.status).toBe(200);
  f.read.mockImplementationOnce(() => failure('최신 입력 조회 실패'));
  await act(async () => retry.resolve(json(trip(f.current().revision, plan({ marketStart: '13:10' })))));
  expect(await screen.findByText('⚠ 최신 입력 조회 실패')).toBeVisible();
  expect(screen.queryByTestId('place-card-row')).toBeNull();
  expect(f.shapes).not.toHaveBeenCalled();
  await press('다시 불러오기');
  expect(await screen.findByTestId('place-card-row')).toBeVisible();
  await press('다음 장소');
  expect(screen.getByRole('button', { name: '2번 아메요코 시장, 13:10부터 13:55까지', selected: true })).toBeVisible();
  expect(screen.getByText('🔒 13:10 예약 고정')).toBeVisible();
  expect(f.shapes.mock.calls[0][0].searchParams.get('inputHash')).toBe(f.current().revision);
  expect(f.read).toHaveBeenCalledTimes(3);
  expect(f.generate).toHaveBeenCalledTimes(3);
  expect(f.save).not.toHaveBeenCalled();
});

test('an input that changes again before verification does not trigger an automatic calculation loop', async () => {
  const f = resultFixture();
  f.generate.mockResolvedValueOnce(outdated()).mockResolvedValueOnce(json(trip('e'.repeat(64))));
  await renderResult(f);
  expect(await screen.findByText('계산 중 여행 정보가 바뀌었어요. 다시 계산해 주세요.')).toBeVisible();
  expect(screen.queryByTestId('place-card-row')).toBeNull();
  expect(f.shapes).not.toHaveBeenCalled();
  expect(f.read).toHaveBeenCalledTimes(2);
  expect(f.generate).toHaveBeenCalledTimes(2);
  await press('다시 계산');
  expect(await screen.findByTestId('place-card-row')).toBeVisible();
  expect(f.read).toHaveBeenCalledTimes(2);
  expect(f.generate).toHaveBeenCalledTimes(3);
  expect(f.save).not.toHaveBeenCalled();
});

test('an opening lookup failure retries only the lookup when the already generated result matches', async () => {
  const f = resultFixture();
  f.read.mockImplementationOnce(() => failure('입력을 불러오지 못했어요.'));
  await renderResult(f);
  expect(await screen.findByText('⚠ 입력을 불러오지 못했어요.')).toBeVisible();
  expect(screen.queryByRole('button', { name: '다시 계산' })).toBeNull();
  await press('다시 불러오기');
  expect(await screen.findByTestId('place-card-row')).toBeVisible();
  expect(f.read).toHaveBeenCalledTimes(2);
  expect(f.generate).toHaveBeenCalledTimes(1);
});

test('leaving during the opening recalculation aborts it and ignores a late success', async () => {
  const f = resultFixture();
  const pending = deferred<Response>();
  f.generate.mockResolvedValueOnce(outdated()).mockReturnValueOnce(pending.promise);
  await renderResult(f);
  await waitFor(() => expect(f.generate).toHaveBeenCalledTimes(2));
  const request = f.transport.mock.calls.filter(([url]) => String(url).endsWith('/itinerary'))[1][1]!;
  await press('저장한 여행 보기');
  expect(await screen.findByText('저장한 여행')).toBeVisible();
  expect(request.signal?.aborted).toBe(true);
  await act(async () => pending.resolve(json(trip(f.current().revision))));
  expect(screen).toHavePathname('/trips/trip');
  expect(screen.queryByTestId('result-map')).toBeNull();
  expect(f.read).toHaveBeenCalledTimes(1);
  expect(f.shapes).not.toHaveBeenCalled();
});

test('an over-capacity recalculation opens required-place selection without another calculation', async () => {
  const f = resultFixture(initialView);
  f.generate.mockResolvedValueOnce(outdated()).mockResolvedValueOnce(json(excess));
  await renderResult(f);
  expect(await screen.findByText('시간이 부족해요')).toBeVisible();
  expect(screen.getByRole('header', { name: '필수 장소 선택' })).toBeVisible();
  expect(f.generate).toHaveBeenCalledTimes(2);
  expect(f.save).not.toHaveBeenCalled();
  expect(f.shapes).not.toHaveBeenCalled();
});
