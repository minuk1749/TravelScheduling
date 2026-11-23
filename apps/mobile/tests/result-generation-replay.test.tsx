import { fireEvent, screen } from 'expo-router/testing-library';
import { constraintsFrom } from '@travel/core/contracts/results/model';
import type { GeneratedTrip } from '../src/api/trips';
import { excess, initialView, success } from './capacity-fixture';
import { generationKeys, json } from './helpers';
import { openResult, plan, renderResult, resultFixture, trip } from './result-fixture';

type Fixture = ReturnType<typeof resultFixture>;
const press = (name: string) => fireEvent.press(screen.getByRole('button', { name }));
const lost = /서버 응답을 확인하지 못했어요/;

function loseGenerationResponse(f: Fixture, calculate: () => GeneratedTrip) {
  const committed = new Map<string, GeneratedTrip>();
  const post = async () => {
    const key = generationKeys(f).at(-1)!;
    const saved = committed.get(key);
    if (saved) return json(saved);
    committed.set(key, calculate());
    return new Response('{', { status: 200 });
  };
  f.generate.mockImplementationOnce(post).mockImplementationOnce(post);
}

async function changeReservationElsewhere(f: Fixture, visitId: string) {
  const { revision, input } = f.current();
  const constraints = constraintsFrom(input);
  const visits = constraints.visits.map(v => v.id === visitId ? { ...v, fixedDate: input.startDate, fixedTime: '13:10' } : v);
  const response = await f.save.getMockImplementation()!({ body: JSON.stringify({ revision, constraints: { ...constraints, visits } }) });
  expect(response.status).toBe(200);
  expect(f.current().revision).not.toBe(revision);
}

function expectReplay(f: Fixture) {
  const [initial, calculation, recovered] = generationKeys(f);
  expect(calculation).not.toBe(initial);
  expect(recovered).toBe(calculation);
  expect(f.read.mock.invocationCallOrder.at(-1)).toBeGreaterThan(f.generate.mock.invocationCallOrder.at(-1)!);
}

test('opening a recovered calculation requires the current reservation before displaying the itinerary', async () => {
  const f = resultFixture();
  f.generate.mockResolvedValueOnce(json(trip('outdated')));
  loseGenerationResponse(f, () => trip(f.current().revision));
  await renderResult(f);
  await screen.findByText(lost);
  await changeReservationElsewhere(f, 'market');
  await press('다시 계산');
  expect(await screen.findByText(/계산 중 여행 정보가 바뀌었어요/)).toBeVisible();
  expect(screen.queryByTestId('place-card-row')).toBeNull();
  expect(f.shapes).not.toHaveBeenCalled();
  expectReplay(f);

  f.generate.mockResolvedValueOnce(json(trip(f.current().revision, plan({ marketStart: '13:10' }))));
  await press('다시 계산');
  await fireEvent.press(await screen.findByRole('button', { name: '다음 장소' }));
  expect(screen.getByRole('button', { name: '2번 아메요코 시장, 13:10부터 13:55까지', selected: true })).toBeVisible();
  expect(screen.getByText('🔒 13:10 예약 고정')).toBeVisible();
  expect(generationKeys(f)[3]).not.toBe(generationKeys(f)[2]);
});

test('a recovered edit cannot replace the shown result after another device changes a reservation', async () => {
  const f = resultFixture();
  await openResult(f);
  loseGenerationResponse(f, () => trip(f.current().revision));
  await press('택시 14분 약 ¥2,300로 바꾸기');
  await screen.findByText(lost);
  await changeReservationElsewhere(f, 'market');
  await press('다시 계산');
  expect(await screen.findByText(/여행 정보가 바뀌었어요/)).toBeVisible();
  expect(screen.queryByTestId('result-toast')).toBeNull();
  expect(screen.queryByRole('button', { name: '되돌리기' })).toBeNull();
  expect(f.save).toHaveBeenCalledTimes(1);
  expectReplay(f);
});

test('required-place selection rejects a recovered feasible result for a superseded reservation', async () => {
  const f = resultFixture(initialView);
  f.generate.mockResolvedValueOnce(json(excess));
  loseGenerationResponse(f, () => ({ ...success, inputHash: f.current().revision }));
  await renderResult(f);
  await screen.findByText('시간이 부족해요');
  await fireEvent.press(screen.getByRole('checkbox', { name: '해변 필수' }));
  await press('선택한 2곳으로 다시 계산');
  await screen.findByText(lost);
  await changeReservationElsewhere(f, 'museum');
  await press('선택한 2곳으로 다시 계산');
  expect(await screen.findByRole('button', { name: '저장된 설정 다시 불러오기' })).toBeVisible();
  expect(screen.queryByRole('header', { name: '배치 가능' })).toBeNull();
  expect(screen.queryByRole('button', { name: '동선 보기' })).toBeNull();
  expect(f.save).toHaveBeenCalledTimes(1);
  expectReplay(f);
});
