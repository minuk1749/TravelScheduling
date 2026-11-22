import { act, fireEvent, screen, within } from 'expo-router/testing-library';
import { constraintsFrom } from '@travel/core/contracts/results/model';
import { GoogleResultMap } from '../src/map/google-result-map';
import { FakeResultMap } from './fake-result-map';
import { deferred, json } from './helpers';
import { at, conflictTrip, D2, openResult, place, plan, resultFixture, trip, view } from './result-fixture';

jest.mock('react-native-maps', () => ({}));
jest.mock('../src/map/config', () => ({ isMapConfigured: () => false }));

const press = (name: string) => fireEvent.press(screen.getByRole('button', { name }));
const sheet = () => within(screen.getByTestId('form-sheet'));
const wishAction = (count: number) => screen.getByRole('button', { name: `희망 장소 추가, ${count}곳 중 선택` });

test.each([
  ['missing coordinates', FakeResultMap],
  ['the map-key fallback', GoogleResultMap],
] as const)('a fully occupied itinerary can schedule a wish through the legend with %s', async (_case, map) => {
  const annex = { ...view.input.visits[3], id: 'annex', kind: 'ATTRACTION' as const, minutes: 30,
    place: { id: 'annex-place', googlePlaceId: 'google-annex' } };
  const garden = { ...annex, id: 'garden', minutes: 45, place: { id: 'garden-place', googlePlaceId: 'google-garden' } };
  const f = resultFixture({ ...view, input: { ...view.input, visits: [...view.input.visits, annex, garden] },
    places: { ...view.places, [annex.place.id]: null, [garden.place.id]: null } });
  const itinerary = plan({ cafeOnDay3: true });
  f.generate.mockResolvedValueOnce(json(trip(view.revision, itinerary)));
  await openResult(f, map);
  if (map === GoogleResultMap) expect(screen.getByText('지도를 표시할 수 없어요')).toBeVisible();
  else expect(screen.getByTestId('marker-museum')).toBeVisible();
  expect(screen.queryByTestId('marker-annex')).toBeNull();
  expect(screen.queryByTestId('marker-garden')).toBeNull();
  for (const day of ['3일 12.5', '2일 12.4', '1일 12.3']) {
    await press(day);
    expect(screen.getByTestId('place-card-row')).toBeVisible();
    expect(screen.queryByRole('button', { name: '희망 장소에서 추가' })).toBeNull();
  }

  await fireEvent.press(wishAction(2));
  expect(sheet().getByRole('button', { name: '★ 희망 장소 1 · 명소 · 30분', selected: true })).toBeVisible();
  await fireEvent.press(sheet().getByRole('button', { name: '★ 희망 장소 2 · 명소 · 45분' }));
  await fireEvent.press(sheet().getByRole('button', { name: '2일차 12.4' }));
  const expected = constraintsFrom(f.current().input);
  expected.visits = expected.visits.map(visit => visit.id === garden.id ? { ...visit, fixedDate: D2 } : visit);
  f.generate.mockImplementationOnce(async () => {
    const back = itinerary.comparisons.find(leg => leg.date === D2 && leg.to === place('hotel'))!;
    itinerary.comparisons = itinerary.comparisons.filter(leg => leg !== back).concat(
      { ...back, to: garden.place.id }, { ...back, from: garden.place.id, departure: at(D2, '11:35') });
    itinerary.stops[D2].push({ kind: 'VISIT', visitId: garden.id, start: at(D2, '10:50'), end: at(D2, '11:35') });
    return json(trip(f.current().revision, itinerary));
  });
  await fireEvent.press(sheet().getByRole('button', { name: '2일차에 추가하고 다시 계산' }));
  expect(await screen.findByText('2일차에 추가하고 다시 계산했어요')).toBeVisible();
  expect(f.save).toHaveBeenCalledTimes(1);
  expect(JSON.parse(String(f.save.mock.calls[0][0].body))).toEqual({ revision: view.revision, constraints: expected });
  expect(f.generate).toHaveBeenCalledTimes(2);
  expect(f.save.mock.invocationCallOrder[0]).toBeLessThan(f.generate.mock.invocationCallOrder[1]);
  expect(screen.getByRole('button', { name: '2일 12.4', selected: true })).toBeVisible();
  expect(screen.getByRole('button', { name: '2번 장소 정보 없음, 10:50부터 11:35까지', selected: true })).toBeVisible();
});

test('the wish action stays disabled during recalculation, failure and previous viewing, and conflict editing remains available', async () => {
  const f = resultFixture();
  const next = deferred<Response>();
  await openResult(f);
  f.generate.mockReturnValueOnce(next.promise);
  await press('택시 14분 약 ¥2,300로 바꾸기');
  expect(wishAction(1)).toBeDisabled();
  await act(async () => next.resolve(json({ code: 'PROVIDER_UNAVAILABLE', error: '재계산 실패' }, 503)));
  await screen.findByText('⚠ 동선을 계산하지 못했어요');
  expect(wishAction(1)).toBeDisabled();
  await press('이전 일정 보기');
  expect(wishAction(1)).toBeDisabled();
  await fireEvent.press(wishAction(1));
  expect(screen.queryByTestId('form-sheet')).toBeNull();
  f.generate.mockImplementationOnce(async () => json(conflictTrip(f.current().revision)));
  await press('다시 계산');
  await screen.findByText('⚠ 고정 조건 충돌 2건');
  await fireEvent.press(wishAction(1));
  expect(sheet().getByRole('header', { name: '희망 장소 추가' })).toBeVisible();
  await fireEvent.press(sheet().getByRole('button', { name: '취소' }));
  await press('아메요코 시장 고정 수정');
  expect(sheet().getByRole('header', { name: '아메요코 시장' })).toBeVisible();
  expect(f.save).toHaveBeenCalledTimes(1);
});
