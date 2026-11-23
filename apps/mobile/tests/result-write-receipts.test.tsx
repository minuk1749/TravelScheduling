import { fireEvent, screen } from 'expo-router/testing-library';
import { constraintsFrom, type Constraints } from '@travel/core/contracts/results/model';
import { json } from './helpers';
import { D1, openResult, place, resultFixture, view } from './result-fixture';

const press = (name: string) => fireEvent.press(screen.getByRole('button', { name }));
const swap = () => press('택시 14분 약 ¥2,300로 바꾸기');
const taxi = { date: D1, from: place('hotel'), to: place('museum'), mode: 'TAXI' } as const;
const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const otherId = 'bca72d98-f715-4197-8a9f-f465730d2bf2';
type Fixture = ReturnType<typeof resultFixture>;

const requestBody = (f: Fixture, index = 0) => JSON.parse(String(f.save.mock.calls[index][0].body));
async function remoteSave(f: Fixture, constraints: Constraints) {
  const response = await f.save.getMockImplementation()!({ body: JSON.stringify({
    revision: f.current().revision, operationId: otherId, constraints,
  }) });
  expect(response.status).toBe(200);
}
async function interruptedEdit(f: Fixture, committed: boolean) {
  await openResult(f);
  const persist = f.save.getMockImplementation()!;
  f.save.mockImplementationOnce(async request => {
    if (committed) await persist(request);
    throw new TypeError('connection lost');
  });
  await swap();
  await screen.findByText('⚠ 동선을 계산하지 못했어요');
}

test.each(['before the retry GET', 'between GET and replay'])(
  'only another device saved the same taxi choice %s: calculate without claiming its edit', async when => {
    const f = resultFixture();
    await interruptedEdit(f, false);
    const attempted = requestBody(f);
    expect(attempted.operationId).toMatch(uuidV4);
    expect(attempted.expectedWriteVersion).toBe(view.writeVersion);
    if (when === 'before the retry GET') await remoteSave(f, attempted.constraints);
    else {
      const persist = f.save.getMockImplementation()!;
      f.save.mockImplementationOnce(async replay => {
        expect(JSON.parse(String(replay.body))).toEqual(attempted);
        await remoteSave(f, attempted.constraints);
        return persist(replay);
      });
    }
    await press('다시 계산');
    expect(await screen.findByText('다시 계산했어요')).toBeVisible();
    expect(f.current().input.legModes).toEqual([taxi]);
    expect(f.save).toHaveBeenCalledTimes(when === 'before the retry GET' ? 1 : 2);
    expect(f.generate).toHaveBeenCalledTimes(2);
    const lookups = f.read.mock.calls.map(([id]) => id);
    expect(lookups).toEqual(when === 'before the retry GET'
      ? [null, attempted.operationId] : [null, attempted.operationId, attempted.operationId]);
    expect(screen.queryByRole('button', { name: '되돌리기' })).toBeNull();
  },
);

test.each(['wrong operation', 'wrong revision', 'missing receipt'])('a matching value with %s cannot confirm an ambiguous save', async proof => {
  const f = resultFixture();
  await interruptedEdit(f, false);
  const attempted = requestBody(f);
  await remoteSave(f, attempted.constraints);
  f.read.mockImplementationOnce(() => json({ ...f.current(), receipt: proof === 'missing receipt' ? undefined : {
    operationId: proof === 'wrong operation' ? otherId : attempted.operationId,
    revision: proof === 'wrong revision' ? view.revision : f.current().revision,
  } }));
  await press('다시 계산');
  await screen.findByTestId('result-toast');
  expect(screen.queryByRole('button', { name: '되돌리기' })).toBeNull();
  expect(screen.getByText('다시 계산했어요')).toBeVisible();
  expect(f.save).toHaveBeenCalledTimes(1);
});

test('an ambiguous edit on a legacy server can reuse matching inputs but has no receipt for undo', async () => {
  const f = resultFixture(view, { legacy: true });
  await interruptedEdit(f, true);
  await press('다시 계산');
  expect(await screen.findByText('다시 계산했어요')).toBeVisible();
  expect(f.current().input.legModes).toEqual([taxi]);
  expect(f.save).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('button', { name: '되돌리기' })).toBeNull();
});

test('without a write version an ambiguous legacy PUT cannot be replayed against an unchanged content hash', async () => {
  const f = resultFixture(view, { legacy: true });
  await interruptedEdit(f, false);
  await press('다시 계산');
  await screen.findByText(/이전 저장을 확인할 수 없어요/);
  await press('다시 계산');
  await screen.findByText('다시 계산했어요');
  expect(f.save).toHaveBeenCalledTimes(1);
  expect(f.current().input.legModes).toEqual([]);
  expect(screen.queryByRole('button', { name: '되돌리기' })).toBeNull();
});

test('a legacy 2xx saves and calculates normally but cannot guard undo against later writes with the same hash', async () => {
  const f = resultFixture(view, { legacy: true });
  await openResult(f);
  await swap();
  expect(await screen.findByText('택시로 바꾸고 다시 계산했어요')).toBeVisible();
  expect(f.current().input.legModes).toEqual([taxi]);
  expect(f.save).toHaveBeenCalledTimes(1);
  expect(f.generate).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('button', { name: '되돌리기' })).toBeNull();
});

test.each(['before the retry GET', 'between GET and replay'])(
  'the first edit committed and another device reverted it %s: its original input hash cannot authorize replay', async when => {
    const f = resultFixture(), original = constraintsFrom(view.input);
    await interruptedEdit(f, when === 'before the retry GET');
    if (when === 'before the retry GET') await remoteSave(f, original);
    else {
      const persist = f.save.getMockImplementation()!, first = f.save.mock.calls[0][0];
      f.save.mockImplementationOnce(async replay => {
        await persist(first);
        await remoteSave(f, original);
        return persist(replay);
      });
    }
    await press('다시 계산');
    expect(await screen.findByText(/다른 기기에서 여행 정보가 바뀌었어요/)).toBeVisible();
    expect(f.current().revision).toBe(view.revision);
    expect(f.current().writeVersion).not.toBe(view.writeVersion);
    await press('다시 계산');
    await screen.findByText('다시 계산했어요');
    expect(f.current().input.legModes).toEqual([]);
    expect(f.save).toHaveBeenCalledTimes(when === 'before the retry GET' ? 1 : 2);
    expect(screen.queryByRole('button', { name: '되돌리기' })).toBeNull();
  },
);

test('undo is a new operation and its precondition protects a matching edit saved after the toast appeared', async () => {
  const f = resultFixture();
  await openResult(f);
  await swap();
  await screen.findByRole('button', { name: '되돌리기' });
  const acknowledged = f.current(), edit = requestBody(f);
  await remoteSave(f, edit.constraints);
  expect(f.current().revision).toBe(acknowledged.revision);
  expect(f.current().writeVersion).not.toBe(acknowledged.writeVersion);
  await press('되돌리기');
  await screen.findByText('⚠ 동선을 계산하지 못했어요');
  const undo = requestBody(f, 1);
  expect(undo.operationId).toMatch(uuidV4);
  expect(undo.operationId).not.toBe(edit.operationId);
  expect(undo.expectedOperationId).toBe(edit.operationId);
  expect(undo.expectedWriteVersion).toBe(acknowledged.writeVersion);
  await press('다시 계산');
  expect(await screen.findByText('다시 계산했어요')).toBeVisible();
  expect(f.current().input.legModes).toEqual([taxi]);
  expect(f.save).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('button', { name: '되돌리기' })).toBeNull();
});
