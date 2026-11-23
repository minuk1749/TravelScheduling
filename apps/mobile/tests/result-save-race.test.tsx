import { act, fireEvent, screen, waitFor } from 'expo-router/testing-library';
import { constraintsFrom } from '@travel/core/contracts/results/model';
import { deferred, json } from './helpers';
import { conflictTrip, D1, openResult, place, resultFixture, trip, view } from './result-fixture';

const press = (name: string) => fireEvent.press(screen.getByRole('button', { name }));
const swap = () => press('택시 14분 약 ¥2,300로 바꾸기');
const taxi = { date: D1, from: place('hotel'), to: place('museum'), mode: 'TAXI' } as const;

async function loseSaveResponse(f = resultFixture()) {
  await openResult(f);
  const original = constraintsFrom(f.current().input);
  const persist = f.save.getMockImplementation()!;
  f.save.mockRejectedValueOnce(new TypeError('connection lost while the transaction is in flight'));
  await swap();
  await screen.findByText('⚠ 동선을 계산하지 못했어요');
  expect(f.generate).toHaveBeenCalledTimes(1);
  return { f, original, persist, first: f.save.mock.calls[0][0] };
}

test.each([
  ['OK', 'complete'], ['CONFLICT', 'complete'], ['OK', 'truncated'],
] as const)('a late commit before the replay PUT recovers the saved change and undo on %s with a %s replay 409', async (outcome, body) => {
  const existing = { ...taxi, from: place('airport'), to: place('hotel'), mode: 'TRANSIT' as const };
  const { f, original, persist, first } = await loseSaveResponse(resultFixture({ ...view,
    input: { ...view.input, legModes: [existing] } }));
  const read = f.read.getMockImplementation()!;
  // The retry first reads the original revision. Only then does the original request commit.
  f.read.mockImplementationOnce(read).mockImplementationOnce(operationId => {
    const current = f.current();
    return json({ ...current, receipt: { operationId, revision: current.revision }, input: { ...current.input, visits: [...current.input.visits].reverse(),
      legModes: [...current.input.legModes ?? []].reverse() } });
  });
  f.save.mockImplementationOnce(async replay => {
    expect(f.read).toHaveBeenCalledTimes(2);
    expect(replay.body).toEqual(first.body);
    expect((await persist(first)).status).toBe(200);
    const rejected = await persist(replay);
    expect(rejected.status).toBe(409);
    return body === 'complete' ? rejected : truncated(rejected);
  });
  f.generate.mockImplementationOnce(async () => json(outcome === 'OK' ? trip(f.current().revision) : conflictTrip(f.current().revision)));

  await press('다시 계산');
  const undo = outcome === 'OK' ? '되돌리기' : '변경 취소';
  expect(await screen.findByRole('button', { name: undo })).toBeVisible();
  expect(f.read).toHaveBeenCalledTimes(3);
  expect(f.save).toHaveBeenCalledTimes(2);
  expect(f.generate).toHaveBeenCalledTimes(2);
  expect(f.current().input.legModes).toEqual([existing, taxi]);
  await press(undo);
  expect(await screen.findByText('되돌리고 다시 계산했어요')).toBeVisible();
  expect(JSON.parse(String(f.save.mock.calls[2][0].body)).constraints).toEqual(original);
  expect(constraintsFrom(f.current().input)).toEqual(original);
});

test('a different saved constraint between the retry read and replay is preserved', async () => {
  const { f, original, persist, first } = await loseSaveResponse();
  const remote = { ...original, visits: original.visits.map(v => v.id === 'museum' ? { ...v, fixedTime: '15:00' } : v), legModes: [taxi] };
  f.save.mockImplementationOnce(async replay => {
    await persist({ body: JSON.stringify({ revision: JSON.parse(String(first.body)).revision, constraints: remote }) });
    return persist(replay);
  });
  await press('다시 계산');
  expect(await screen.findByText(/다른 기기에서 여행 정보가 바뀌었어요/)).toBeVisible();
  expect(f.generate).toHaveBeenCalledTimes(1);
  expect(f.save).toHaveBeenCalledTimes(2);
  await press('다시 계산');
  expect(await screen.findByText('다시 계산했어요')).toBeVisible();
  expect(f.save).toHaveBeenCalledTimes(2);
  expect(constraintsFrom(f.current().input)).toEqual(remote);
  expect(screen.queryByRole('button', { name: '되돌리기' })).toBeNull();
});

test('a persistent replay conflict at the original revision is bounded to one write per user retry', async () => {
  const { f, original } = await loseSaveResponse();
  f.save.mockImplementation(async () => json({ code: 'STALE_INPUT', error: '저장 충돌' }, 409));
  for (const attempt of [1, 2]) {
    await press('다시 계산');
    expect(await screen.findByText('⚠ 동선을 계산하지 못했어요')).toBeVisible();
    expect(f.save).toHaveBeenCalledTimes(1 + attempt);
    expect(f.read).toHaveBeenCalledTimes(1 + 2 * attempt);
    expect(f.generate).toHaveBeenCalledTimes(1);
    expect(constraintsFrom(f.current().input)).toEqual(original);
  }
});

async function truncated(response: Response) {
  const body = await response.text();
  return new Response(body.slice(0, -1), { status: response.status, headers: response.headers });
}

test.each(['complete', 'truncated', 'empty'] as const)(
  'a fresh 409 with a %s body never creates an undo for a matching change made by another device', async body => {
    const f = resultFixture();
    await openResult(f);
    const persist = f.save.getMockImplementation()!;
    f.save.mockImplementationOnce(async fresh => {
      // The other device commits independently; the actual local PUT uses the original revision and is rejected.
      expect((await persist(fresh)).status).toBe(200);
      const rejected = await persist(fresh);
      expect(rejected.status).toBe(409);
      if (body === 'truncated') return truncated(rejected);
      if (body === 'empty') return new Response(null, { status: rejected.status });
      return rejected;
    });
    await swap();
    expect(await screen.findByText('⚠ 동선을 계산하지 못했어요')).toBeVisible();
    expect(f.read).toHaveBeenCalledTimes(1);
    expect(f.generate).toHaveBeenCalledTimes(1);
    expect(f.current().input.legModes).toEqual([taxi]);
    await press('다시 계산');
    expect(await screen.findByTestId('result-toast')).toBeVisible();
    expect(f.read).toHaveBeenCalledTimes(2);
    expect(f.generate).toHaveBeenCalledTimes(2);
    expect(f.save).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: '되돌리기' })).toBeNull();
    expect(f.current().input.legModes).toEqual([taxi]);
  },
);

test.each([
  [400, 'INVALID_JSON', '올바른 JSON을 보내 주세요.'],
  [400, 'INVALID_INPUT', '고정 날짜를 확인해 주세요.'],
  [403, 'FORBIDDEN', '접근할 수 없습니다.'],
  [404, 'NOT_FOUND', '여행을 찾을 수 없습니다.'],
  [409, 'RESULT_UNAVAILABLE', '여행 입력 정보를 먼저 완성해 주세요.'],
] as const)('a fresh constraint PUT rejected with HTTP %d preserves the error and cannot acquire a remote undo', async (status, code, error) => {
  const f = resultFixture();
  await openResult(f);
  const persist = f.save.getMockImplementation()!;
  const body = code === 'INVALID_INPUT' ? { code, error: '입력 내용을 확인해 주세요.', fields: { fixedDate: error } } : { code, error };
  f.save.mockResolvedValueOnce(json(body, status));
  await swap();
  expect(await screen.findByText(error)).toBeVisible();
  expect(f.current().input.legModes).toEqual([]);
  // A different device subsequently saves the same edit before this device retries.
  await persist(f.save.mock.calls[0][0]);
  await press('다시 계산');
  expect(await screen.findByTestId('result-toast')).toBeVisible();
  expect(f.save).toHaveBeenCalledTimes(1);
  expect(f.current().input.legModes).toEqual([taxi]);
  expect(screen.queryByRole('button', { name: '되돌리기' })).toBeNull();
});

test('a gateway error with an unknown save outcome still permits verification and undo of a committed edit', async () => {
  const f = resultFixture();
  await openResult(f);
  const persist = f.save.getMockImplementation()!;
  f.save.mockImplementationOnce(async request => {
    await persist(request);
    return new Response(null, { status: 502 });
  });
  await swap();
  await screen.findByText('⚠ 동선을 계산하지 못했어요');
  await press('다시 계산');
  expect(await screen.findByRole('button', { name: '되돌리기' })).toBeVisible();
  expect(f.save).toHaveBeenCalledTimes(1);
  expect(f.current().input.legModes).toEqual([taxi]);
  await press('되돌리기');
  expect(await screen.findByText('되돌리고 다시 계산했어요')).toBeVisible();
  expect(f.current().input.legModes).toEqual([]);
});

test('a 409 from generation after an acknowledged PUT cannot reject that earlier save', async () => {
  const f = resultFixture();
  await openResult(f);
  f.generate.mockResolvedValueOnce(new Response('{', { status: 409 }));
  await swap();
  await screen.findByText('⚠ 동선을 계산하지 못했어요');
  await press('다시 계산');
  expect(await screen.findByRole('button', { name: '되돌리기' })).toBeVisible();
  expect(f.read).toHaveBeenCalledTimes(1);
  expect(f.readRevision).toHaveBeenCalledTimes(1);
  expect(f.readRevision.mock.invocationCallOrder[0]).toBeGreaterThan(f.generate.mock.invocationCallOrder[2]);
  expect(f.save).toHaveBeenCalledTimes(1);
  expect(f.current().input.legModes).toEqual([taxi]);
});

test('an interrupted undo and failed confirmation can be retried without another write or a new undo', async () => {
  const f = resultFixture();
  const persist = f.save.getMockImplementation()!;
  const original = constraintsFrom(f.current().input);
  await openResult(f);
  await swap();
  await screen.findByRole('button', { name: '되돌리기' });
  f.save.mockRejectedValueOnce(new TypeError('undo response lost'));
  await press('되돌리기');
  await screen.findByText('⚠ 동선을 계산하지 못했어요');
  const attemptedUndo = f.save.mock.calls[1][0];
  f.save.mockImplementationOnce(async replay => {
    await persist(attemptedUndo);
    return persist(replay);
  });
  f.read.mockImplementationOnce(f.read.getMockImplementation()!).mockImplementationOnce(() => { throw new Error('offline'); });
  await press('다시 계산');
  await screen.findByText('⚠ 동선을 계산하지 못했어요');
  expect(f.read).toHaveBeenCalledTimes(3);
  expect(f.generate).toHaveBeenCalledTimes(2);
  expect(constraintsFrom(f.current().input)).toEqual(original);
  await press('다시 계산');
  expect(await screen.findByText('되돌리고 다시 계산했어요')).toBeVisible();
  expect(f.read).toHaveBeenCalledTimes(4);
  expect(f.save).toHaveBeenCalledTimes(3);
  expect(f.generate).toHaveBeenCalledTimes(3);
  expect(screen.queryByRole('button', { name: '되돌리기' })).toBeNull();
});

test('leaving while the late commit is being checked cancels the read and never starts a calculation', async () => {
  const { f, first, persist } = await loseSaveResponse();
  f.save.mockImplementationOnce(async replay => { await persist(first); return persist(replay); });
  const confirmation = deferred<Response>();
  const verify = jest.fn<Promise<Response>, [RequestInit?]>().mockReturnValue(confirmation.promise);
  const transport = f.transport.getMockImplementation()!;
  f.transport.mockImplementation((url, options) => {
    if (new URL(String(url)).pathname.endsWith('/constraints') && !options?.method && f.save.mock.calls.length === 2) return verify(options);
    return transport(url, options);
  });
  await press('다시 계산');
  await waitFor(() => expect(verify).toHaveBeenCalledTimes(1));
  await press('뒤로');
  expect(await screen.findByText('저장한 여행')).toBeVisible();
  expect(verify.mock.calls[0][0]?.signal?.aborted).toBe(true);
  await act(async () => confirmation.resolve(json(f.current())));
  expect(f.generate).toHaveBeenCalledTimes(1);
  expect(f.save).toHaveBeenCalledTimes(2);
});
