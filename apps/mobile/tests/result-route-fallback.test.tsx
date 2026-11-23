import { act, fireEvent, screen, waitFor } from 'expo-router/testing-library';
import { deferred, json } from './helpers';
import { at, conflictTrip, D1, D2, D3, ITINERARY_A, legId, openResult, place, resultFixture, REVISION, ROAD, routes, trip, view } from './result-fixture';

const location = (id: string) => JSON.parse(screen.getByTestId('coordinate-' + id).props.children);
const straight = (id: string) => JSON.parse(screen.getByTestId('straight-' + id).props.children);

test('each leg keeps its own mode and falls back independently when a shape is unusable', async () => {
  const f = resultFixture();
  f.shapes.mockImplementationOnce(async url => json({
    inputHash: REVISION, itineraryId: url.searchParams.get('itineraryId'),
    legs: trip(REVISION).comparisons.map(leg => ({
      date: leg.date, kind: leg.kind, from: leg.from, to: leg.to,
      mode: leg.to === place('museum') ? 'TAXI' : leg.selected.mode,
      shape: { status: 'OK', encodedPolyline: leg.kind === 'AIRPORT' ? '!!!!' : leg.from === place('market') ? '??' : ROAD },
    })),
  }));
  await openResult(f);
  await waitFor(() => expect(routes()[legId(D1, 'museum', 'market')]).toMatch(/TAXI SOLID .* ROAD$/));
  expect(routes()[legId(D1, 'airport', 'hotel', 'AIRPORT')]).toMatch(/TRANSIT DOTTED .* STRAIGHT$/);
  expect(routes()[legId(D1, 'hotel', 'museum')]).toMatch(/TRANSIT DOTTED .* STRAIGHT$/);
  expect(routes()[legId(D1, 'market', 'hotel')]).toMatch(/WALK DOTTED .* STRAIGHT$/);
  expect(screen.queryByRole('button', { name: '경로 모양 다시 불러오기' })).toBeNull();
});

// Haneda to the lodging is about 15 km. The lodging to the museum is under 4 km.
function tokyoShapes(additionalRoads: Record<string, string> = {}) {
  const result = trip(REVISION);
  const destinations: Record<string, string> = { [place('museum')]: 'o~wxEkgatYgbC{JwrAka@', ...additionalRoads };
  return { inputHash: REVISION, itineraryId: result.itineraryId, legs: result.comparisons.map(leg => {
    const encoded = leg.kind === 'AIRPORT' ? 'wf~wEwvctY_xNvhAw}HrD' : destinations[leg.to];
    return { date: leg.date, kind: leg.kind, from: leg.from, to: leg.to, mode: leg.selected.mode,
      shape: encoded ? { status: 'OK', encodedPolyline: encoded } : { status: 'NONE' } };
  }) };
}

test('scheduled legs use their road shapes even when one or both place lookups returned null', async () => {
  const f = resultFixture({ ...view, places: { ...view.places, [place('airport')]: null, [place('hotel')]: null } });
  const airportLeg = legId(D1, 'airport', 'hotel', 'AIRPORT'), museumLeg = legId(D1, 'hotel', 'museum');
  const marketLeg = legId(D1, 'museum', 'market'), walkBack = legId(D1, 'market', 'hotel');
  f.shapes.mockResolvedValueOnce(json(tokyoShapes()));
  await openResult(f);
  await waitFor(() => expect(routes()[airportLeg]).toMatch(/TRANSIT FLOATING DIM .* ROAD$/));
  expect(JSON.parse(screen.getByTestId('points-' + airportLeg).props.children)).toContainEqual({ latitude: 35.6302, longitude: 139.768 });
  expect(routes()[museumLeg]).toMatch(/TRANSIT SOLID STRONG .* ROAD$/);
  expect(JSON.parse(screen.getByTestId('points-' + museumLeg).props.children)).toContainEqual({ latitude: 35.7022, longitude: 139.769 });
  expect(routes()[marketLeg]).toMatch(/TAXI DOTTED DIM .* STRAIGHT$/);
  expect(routes()[walkBack]).toMatch(/WALK DOTTED DIM .* STRAIGHT$/);
  expect(straight(walkBack)).toEqual([location('market'), location('lodging:' + place('hotel'))]);
  await fireEvent.press(screen.getByRole('button', { name: '전체 일정' }));
  expect(screen.getByTestId('schedule-leg-' + airportLeg)).toHaveTextContent(/40분.*도심 밖/);
  expect(screen.getByTestId('schedule-leg-' + museumLeg)).toHaveTextContent(/10:30.*10:55/);
  expect(screen.getByTestId('schedule-leg-' + museumLeg)).not.toHaveTextContent(/도심 밖/);
  expect(screen.getByTestId('schedule-leg-' + walkBack)).toHaveTextContent(/도보 30분/);
});

const historicalAirport = legId(D1, 'airport', 'hotel', 'AIRPORT');
const conflictId = 'd6e9d669-28eb-4675-bbd4-dfcb08bb8938';
const missingTransferPlaces = () => resultFixture({ ...view, places: { ...view.places, [place('airport')]: null, [place('hotel')]: null } });

async function openHistoricalAirportTimeline(f: ReturnType<typeof resultFixture>) {
  await fireEvent.press(screen.getByRole('button', { name: '이 장소 수정' }));
  await fireEvent.changeText(screen.getByLabelText('고정 시각'), '09:00');
  f.generate.mockImplementationOnce(async () => {
    const conflict = conflictTrip(f.current().revision);
    conflict.capacity.unplaced = [{ visitId: 'museum', reason: 'TIME_WINDOW', fixed: true }];
    conflict.capacity.issues = [];
    return json({ ...conflict, itineraryId: conflictId });
  });
  await fireEvent.press(screen.getByRole('button', { name: '적용하고 다시 계산' }));
  await screen.findByRole('button', { name: '도쿄 국립박물관 고정 수정' });
  await fireEvent.press(screen.getByRole('button', { name: '전체 일정' }));
  expect(screen.getByText('⚠ 고정 조건 충돌 · 이전 계산 결과')).toBeVisible();
}

test.each(['before conflict', 'with the conflict timeline open'])(
  'historical map and timeline classify the airport transfer together when verified road endpoints arrive %s', async when => {
    const f = missingTransferPlaces(), response = deferred<Response>();
    f.shapes.mockReturnValueOnce(response.promise);
    await openResult(f);
    if (when === 'before conflict') await act(async () => response.resolve(json(tokyoShapes())));
    await openHistoricalAirportTimeline(f);
    const row = () => screen.getByTestId('schedule-leg-' + historicalAirport);
    if (when === 'with the conflict timeline open') {
      expect(routes()[historicalAirport]).toBeUndefined();
      expect(row()).not.toHaveTextContent(/도심 밖/);
      await act(async () => response.resolve(json(tokyoShapes())));
    }
    expect(routes()[historicalAirport]).toMatch(/TRANSIT FLOATING DIM .* ROAD$/);
    expect(location('airport:' + place('airport'))).toEqual({ latitude: 35.5494, longitude: 139.7798 });
    expect(row()).toHaveTextContent(/대중교통 40분 · ¥500 · 도심 밖/);
    expect(screen.getByTestId('schedule-leg-' + legId(D1, 'hotel', 'museum'))).not.toHaveTextContent(/도심 밖/);
    expect(f.shapes.mock.calls.map(([url]) => [url.searchParams.get('itineraryId'), url.searchParams.get('inputHash')]))
      .toEqual([[ITINERARY_A, REVISION]]);
  },
);

test.each([['conflict ID', conflictId], ['legacy response without an ID', undefined]])(
  'historical map and timeline discard road endpoints from a %s even when its input hash matches', async (_label, itineraryId) => {
    const f = missingTransferPlaces(), response = deferred<Response>();
    f.shapes.mockReturnValueOnce(response.promise);
    await openResult(f);
    await openHistoricalAirportTimeline(f);
    await act(async () => response.resolve(json({ ...tokyoShapes(), itineraryId })));
    expect(routes()[historicalAirport]).toBeUndefined();
    expect(screen.queryByTestId('coordinate-airport:' + place('airport'))).toBeNull();
    const row = screen.getByTestId('schedule-leg-' + historicalAirport);
    expect(row).toHaveTextContent(/대중교통 40분 · ¥500/);
    expect(row).not.toHaveTextContent(/도심 밖/);
    expect(f.shapes).toHaveBeenCalledTimes(1);
  },
);

test('matching roads restore missing visit, lodging and airport markers on their day and keep selection in sync', async () => {
  const lodging = view.input.lodgings[0]!.place;
  const f = resultFixture({ ...view, places: { ...view.places, [place('airport')]: null, [lodging.id]: null, [place('museum')]: null },
    input: { ...view.input, visits: view.input.visits.map(visit => visit.id === 'cafe' ? { ...visit, place: lodging } : visit) } });
  const response = deferred<Response>();
  f.shapes.mockReturnValueOnce(response.promise);
  await openResult(f);
  expect(screen.queryByTestId('marker-museum')).toBeNull();
  expect(screen.queryByTestId('marker-lodging:' + lodging.id)).toBeNull();
  await act(async () => response.resolve(json(tokyoShapes({
    [place('market')]: 'cv~xEsubtYja@oA', [place('shrine')]: 'c_xxE_hatYr]jgL',
  }))));
  const marker = (id: string) => screen.getByTestId('marker-' + id);
  const card = (name: RegExp, selected?: boolean) => screen.getByRole('button', { name, selected });
  expect(location('airport:' + place('airport'))).toEqual({ latitude: 35.5494, longitude: 139.7798 });
  expect(location('lodging:' + lodging.id)).toEqual({ latitude: 35.6812, longitude: 139.7671 });
  expect(location('cafe')).toEqual(location('lodging:' + lodging.id));
  expect(location('museum')).toEqual({ latitude: 35.7156, longitude: 139.7745 });
  expect(location('market')).toEqual(view.places[place('market')]!.coordinates);
  expect(marker('airport:' + place('airport'))).toHaveProp('accessibilityLabel', '지도 장소 정보 없음');
  expect(marker('museum')).toHaveProp('accessibilityState', expect.objectContaining({ selected: true }));
  expect(marker('museum')).toHaveTextContent('PLACED 1');
  expect(card(/^1번 장소 정보 없음,/, true)).toBeVisible();
  await fireEvent.press(card(/^2번 아메요코 시장,/));
  expect(marker('market')).toHaveProp('accessibilityState', expect.objectContaining({ selected: true }));
  await fireEvent.press(marker('museum'));
  expect(card(/^1번 장소 정보 없음,/, true)).toBeVisible();
  expect(routes()[legId(D1, 'hotel', 'museum')]).toMatch(/STRONG/);
  await fireEvent.press(screen.getByRole('button', { name: '2일 12.4' }));
  expect(screen.queryByTestId('marker-museum')).toBeNull();
  expect(location('lodging:' + lodging.id)).toEqual({ latitude: 35.6813, longitude: 139.7672 });
  expect(screen.queryByTestId('marker-airport:' + place('airport'))).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: '3일 12.5' }));
  expect(location('lodging:' + lodging.id)).toEqual({ latitude: 35.6812, longitude: 139.7671 });
  expect(screen.queryByTestId('marker-shrine')).toBeNull();
  expect(screen.queryByTestId('marker-airport:' + place('airport'))).toBeNull();
});

test('fallback endpoints use the displayed local day before other days of the same result, including overnight airport transfers', async () => {
  const airport = place('airport'), hotel = place('hotel');
  const f = resultFixture({ ...view, places: { ...view.places, [airport]: null, [hotel]: null },
    input: { ...view.input, flights: [...view.input.flights, { direction: 'DEPARTURE', airport: view.input.flights[0]!.airport,
      localDateTime: D3 + 'T03:00' }] } });
  const generated = trip(REVISION);
  const returnLeg = { ...generated.comparisons[0]!, date: D3, from: hotel, to: airport, departure: at(D2, '23:40') };
  f.generate.mockResolvedValueOnce(json({ ...generated, comparisons: [...generated.comparisons, returnLeg] }));
  const response = tokyoShapes();
  response.legs = response.legs.map(leg => leg.kind === 'AIRPORT' ? { ...leg, shape: { status: 'NONE' } } : leg);
  response.legs.push({ date: D3, kind: 'AIRPORT', from: hotel, to: airport, mode: 'TRANSIT',
    shape: { status: 'OK', encodedPolyline: 'w_xxEshatY~wXcmA' } });
  f.shapes.mockResolvedValueOnce(json(response));
  await openResult(f);
  const outbound = legId(D1, 'airport', 'hotel', 'AIRPORT');
  await waitFor(() => expect(routes()[outbound]).toMatch(/TRANSIT DOTTED DIM .* STRAIGHT$/));
  expect(straight(outbound)).toEqual([location('airport:' + airport), location('lodging:' + hotel)]);
  expect(location('lodging:' + hotel)).toEqual({ latitude: 35.6812, longitude: 139.7671 });
  await fireEvent.press(screen.getByRole('button', { name: '전체 일정' }));
  expect(screen.getByTestId('schedule-leg-' + outbound)).toHaveTextContent(/40분.*도심 밖/);
  await fireEvent.press(screen.getByRole('button', { name: '닫기' }));
  await fireEvent.press(screen.getByRole('button', { name: '2일 12.4' }));
  expect(location('lodging:' + hotel)).toEqual({ latitude: 35.6814, longitude: 139.7673 });
  expect(straight(legId(D2, 'shrine', 'hotel'))).toEqual([location('shrine'), location('lodging:' + hotel)]);
  const overnight = legId(D3, 'hotel', 'airport', 'AIRPORT');
  expect(routes()[overnight]).toMatch(/ROAD$/);
  expect(JSON.parse(screen.getByTestId('points-' + overnight).props.children)).toEqual([
    { latitude: 35.6814, longitude: 139.7673 }, { latitude: 35.5494, longitude: 139.7798 },
  ]);
  await fireEvent.press(screen.getByRole('button', { name: '3일 12.5' }));
  expect(routes()[overnight]).toBeUndefined();
});

test('missing place details and no usable road endpoint leave that place and its incident lines absent', async () => {
  const f = resultFixture({ ...view, places: { ...view.places, [place('market')]: null, [place('hotel')]: null } });
  f.shapes.mockResolvedValueOnce(json(tokyoShapes({ [place('market')]: '??' })));
  await openResult(f);
  await screen.findByTestId('points-' + legId(D1, 'hotel', 'museum'));
  expect(screen.queryByTestId('marker-market')).toBeNull();
  expect(routes()[legId(D1, 'museum', 'market')]).toBeUndefined();
  const walk = legId(D1, 'market', 'hotel');
  expect(routes()[walk]).toBeUndefined();
  await fireEvent.press(screen.getByRole('button', { name: '전체 일정' }));
  expect(screen.getByTestId('schedule-leg-' + walk)).toHaveTextContent(/도보 30분/);
});
