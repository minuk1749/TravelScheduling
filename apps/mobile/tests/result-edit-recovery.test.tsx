import { fireEvent, screen, within } from 'expo-router/testing-library';
import { constraintsFrom } from '@travel/core/contracts/results/model';
import { json } from './helpers';
import { conflictTrip, D1, openResult, place, resultFixture, trip } from './result-fixture';

const press = (name: string) => fireEvent.press(screen.getByRole('button', { name }));
const swap = () => press('택시 14분 약 ¥2,300로 바꾸기');
const taxi = { date: D1, from: place('hotel'), to: place('museum'), mode: 'TAXI' } as const;

test('retry reads the saved revision, resubmits an unsaved edit, then generates from the new input', async () => {
  const f = resultFixture();
  await openResult(f);
  f.save.mockRejectedValueOnce(new Error('connection lost before save'));
  await swap();
  expect(await screen.findByText('⚠ 동선을 계산하지 못했어요')).toBeVisible();
  expect(f.generate).toHaveBeenCalledTimes(1);
  expect(f.current().input.legModes).toEqual([]);

  let generatedModes;
  f.generate.mockImplementationOnce(async () => {
    generatedModes = f.current().input.legModes;
    return json(trip(f.current().revision));
  });
  await press('다시 계산');
  expect(await screen.findByText('택시로 바꾸고 다시 계산했어요')).toBeVisible();
  expect(f.read).toHaveBeenCalledTimes(2);
  expect(f.save).toHaveBeenCalledTimes(2);
  expect(f.save.mock.calls[1][0].body).toEqual(f.save.mock.calls[0][0].body);
  expect(generatedModes).toEqual([taxi]);
});

test('when the PUT response is lost after commit, retry observes the saved edit and generates without another PUT', async () => {
  const f = resultFixture();
  const persist = f.save.getMockImplementation()!;
  await openResult(f);
  f.save.mockImplementationOnce(async options => {
    await persist(options);
    throw new Error('connection lost after save');
  });
  await swap();
  expect(await screen.findByText('⚠ 동선을 계산하지 못했어요')).toBeVisible();
  expect(f.current().input.legModes).toEqual([taxi]);
  await press('다시 계산');
  expect(await screen.findByText('택시로 바꾸고 다시 계산했어요')).toBeVisible();
  expect(f.read).toHaveBeenCalledTimes(2);
  expect(f.save).toHaveBeenCalledTimes(1);
  expect(f.generate).toHaveBeenCalledTimes(2);
});

test('an uncertain save with a conflicting remote edit is never replayed against a newer revision', async () => {
  const f = resultFixture();
  const persist = f.save.getMockImplementation()!;
  await openResult(f);
  f.save.mockRejectedValueOnce(new Error('connection lost'));
  await swap();
  expect(await screen.findByText('⚠ 동선을 계산하지 못했어요')).toBeVisible();
  const changed = { ...taxi, mode: 'WALK' };
  await persist({ body: JSON.stringify({ revision: f.current().revision, constraints: { ...constraintsFrom(f.current().input), legModes: [changed] } }) });
  await press('다시 계산');
  expect(await screen.findByText(/다른 기기에서 여행 정보가 바뀌었어요/)).toBeVisible();
  expect(f.generate).toHaveBeenCalledTimes(1);
  await press('다시 계산');
  expect(await screen.findByText('다시 계산했어요')).toBeVisible();
  expect(f.current().input.legModes).toEqual([changed]);
  expect(f.save).toHaveBeenCalledTimes(1);
});

test('a stale result cannot edit through a wish marker or undo an older revision; new edits preserve remote changes', async () => {
  const f = resultFixture();
  const persist = f.save.getMockImplementation()!;
  const changed = { ...taxi, mode: 'WALK' };
  await openResult(f);
  f.generate.mockImplementationOnce(async () => {
    const constraints = { ...constraintsFrom(f.current().input), legModes: [changed] };
    await persist({ body: JSON.stringify({ revision: f.current().revision, constraints }) });
    return json(trip(f.current().revision));
  });
  await swap();
  expect(await screen.findByText(/여행 정보가 바뀌었어요/)).toBeVisible();
  await press('지도 아사쿠사 카페');
  expect(screen.queryByTestId('form-sheet')).toBeNull();

  f.generate.mockImplementationOnce(async () => json(conflictTrip(f.current().revision)));
  await press('다시 계산');
  expect(await screen.findByText('⚠ 고정 조건 충돌 2건')).toBeVisible();
  expect(screen.queryByRole('button', { name: '변경 취소' })).toBeNull();
  await press('지도 아사쿠사 카페');
  await fireEvent.press(within(screen.getByTestId('form-sheet')).getByRole('button', { name: '1일차에 추가하고 다시 계산' }));
  expect(await screen.findByText('1일차에 추가하고 다시 계산했어요')).toBeVisible();
  expect(f.current().input.legModes).toEqual([changed]);
  expect(f.current().input.visits.find(item => item.id === 'cafe')?.fixedDate).toBe(D1);
});
