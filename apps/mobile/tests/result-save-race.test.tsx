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

test.each(['OK', 'CONFLICT'] as const)('a late commit before the replay PUT recovers the saved change and undo on %s', async outcome => {
  const existing = { ...taxi, from: place('airport'), to: place('hotel'), mode: 'TRANSIT' as const };
  const { f, original, persist, first } = await loseSaveResponse(resultFixture({ ...view,
    input: { ...view.input, legModes: [existing] } }));
  const read = f.read.getMockImplementation()!;
  // The retry first reads the original revision. Only then does the original request commit.
  f.read.mockImplementationOnce(read).mockImplementationOnce(() => {
    const current = f.current();
    return json({ ...current, input: { ...current.input, visits: [...current.input.visits].reverse(),
      legModes: [...current.input.legModes ?? []].reverse() } });
  });
  f.save.mockImplementationOnce(async replay => {
    expect(f.read).toHaveBeenCalledTimes(2);
    expect(replay.body).toEqual(first.body);
    expect((await persist(first)).status).toBe(200);
    const rejected = await persist(replay);
    expect(rejected.status).toBe(409);
    return rejected;
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

test('a definitive 409 on a fresh edit does not claim an already matching edit made by another device', async () => {
  const f = resultFixture();
  await openResult(f);
  const persist = f.save.getMockImplementation()!;
  f.save.mockImplementationOnce(async fresh => {
    await persist(fresh);
    return persist(fresh);
  });
  await swap();
  expect(await screen.findByText('⚠ 동선을 계산하지 못했어요')).toBeVisible();
  expect(f.read).toHaveBeenCalledTimes(1);
  await press('다시 계산');
  expect(await screen.findByText('다시 계산했어요')).toBeVisible();
  expect(f.save).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('button', { name: '되돌리기' })).toBeNull();
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
    if (String(url).endsWith('/constraints') && !options?.method && f.save.mock.calls.length === 2) return verify(options);
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
