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
  return committed;
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
  const keys = generationKeys(f);
  expect(keys).toHaveLength(3);
  const [initial, calculation, recovered] = keys;
  expect(calculation).not.toBe(initial);
  expect(recovered).toBe(calculation);
  expect(f.readRevision).toHaveBeenCalledTimes(1);
  expect(f.readRevision.mock.invocationCallOrder[0]).toBeGreaterThan(f.generate.mock.invocationCallOrder.at(-1)!);
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

test.each([false, true])('the editor checks a recovered result during a Places outage (reservation changed: %s)', async changed => {
  const f = resultFixture();
  await openResult(f);
  const committed = loseGenerationResponse(f, () => trip(f.current().revision, plan({ museumLeg: 'TAXI', marketStart: '13:10' })));
  await press('택시 14분 약 ¥2,300로 바꾸기');
  await screen.findByText(lost);
  f.read.mockImplementation(() => json({ code: 'PROVIDER_UNAVAILABLE', error: '장소 조회 실패' }, 503));
  if (changed) await changeReservationElsewhere(f, 'market');
  await press('다시 계산');
  if (changed) {
    expect(await screen.findByText(/여행 정보가 바뀌었어요/)).toBeVisible();
    expect(screen.queryByTestId('place-card-row')).toBeNull();
    expect(screen.queryByTestId('result-toast')).toBeNull();
    expect(screen.queryByRole('button', { name: '되돌리기' })).toBeNull();
  } else {
    await fireEvent.press(await screen.findByRole('button', { name: '다음 장소' }));
    expect(screen.getByRole('button', { name: '2번 아메요코 시장, 13:10부터 13:55까지', selected: true })).toBeVisible();
  }
  expect(committed.size).toBe(1);
  expect(f.read).toHaveBeenCalledTimes(1);
  expect(f.save).toHaveBeenCalledTimes(1);
  expectReplay(f);
});

test('a recovered over-capacity edit opens the named candidates during a Places outage', async () => {
  const f = resultFixture(initialView);
  f.generate.mockResolvedValueOnce(json({ ...success, inputHash: initialView.revision }));
  await openResult(f);
  const committed = loseGenerationResponse(f, () => ({ ...excess, inputHash: f.current().revision }));
  await press('지도 카페');
  await press('1일차에 추가하고 다시 계산');
  await screen.findByText(lost);
  f.read.mockImplementation(() => json({ code: 'PROVIDER_UNAVAILABLE', error: '장소 조회 실패' }, 503));

  await press('다시 계산');
  const cafe = await screen.findByRole('checkbox', { name: '카페 필수', checked: false });
  expect(cafe).toBeVisible();
  expect(cafe).toHaveProp('accessibilityHint', expect.stringContaining(`날짜 고정 · ${initialView.input.startDate}`));
  expect(f.read).toHaveBeenCalledTimes(1);
  expect(f.save).toHaveBeenCalledTimes(1);
  expect(committed.size).toBe(1);
  expectReplay(f);
});

test.each([false, true])('capacity opening reuses the view after a lost recalculation (reservation changed: %s)', async changed => {
  const f = resultFixture(initialView);
  f.generate.mockResolvedValueOnce(json({ ...excess, inputHash: 'outdated' }));
  const committed = loseGenerationResponse(f, () => ({ ...excess, inputHash: f.current().revision }));
  await renderResult(f);
  await screen.findByText(lost);
  const readInput = f.read.getMockImplementation()!;
  f.read.mockImplementation(() => json({ code: 'PROVIDER_UNAVAILABLE', error: '장소 조회 실패' }, 503));
  if (changed) await changeReservationElsewhere(f, 'museum');

  await press('다시 불러오기');
  if (changed) {
    expect(await screen.findByText(/여행 정보가 바뀌었어요/)).toBeVisible();
    expect(screen.queryByRole('checkbox')).toBeNull();
  } else {
    expect(await screen.findByRole('checkbox', { name: '도쿄 미술관 필수', checked: true })).toBeVisible();
  }
  expect(committed.size).toBe(1);
  expect(f.read).toHaveBeenCalledTimes(1);
  expect(f.save).not.toHaveBeenCalled();
  expectReplay(f);

  if (changed) {
    f.read.mockImplementation(readInput);
    f.generate.mockResolvedValueOnce(json({ ...excess, inputHash: f.current().revision }));
    await press('다시 불러오기');
    expect(await screen.findByText(/13:10/)).toBeVisible();
    expect(f.read).toHaveBeenCalledTimes(2);
    expect(generationKeys(f)[3]).not.toBe(generationKeys(f)[2]);
  }
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
