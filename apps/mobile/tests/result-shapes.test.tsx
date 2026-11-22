import { act, fireEvent, screen, waitFor } from 'expo-router/testing-library';
import type { SavedRouteShapesResponse } from '@travel/core/contracts/route-shapes';
import type { GeneratedTrip } from '../src/api/trips';
import * as geometry from '../src/map/geometry';
import { deferred, json } from './helpers';
import { D1, ITINERARY_A, legId, openResult, plan, resultFixture, REVISION, ROAD, routes, trip, view } from './result-fixture';

const itineraryB = '24542ffe-2457-4ccf-894b-7b0e46d25b87';
const commonLeg = legId(D1, 'museum', 'market'); // TAXI in both results, with different road coordinates.
const museumLeg = legId(D1, 'hotel', 'museum'); // TRANSIT in A, TAXI in B.
const press = (name: string) => fireEvent.press(screen.getByRole('button', { name }));

function shapes(result: GeneratedTrip, encodedPolyline: string): SavedRouteShapesResponse {
  return { itineraryId: result.itineraryId, inputHash: result.inputHash, legs: result.comparisons.map(leg => ({
    date: leg.date, kind: leg.kind, from: leg.from, to: leg.to, mode: leg.selected.mode,
    shape: { status: 'OK', encodedPolyline },
  })) };
}

test.each(['cached', 'in flight', 'malformed and in flight'])('same-input retry displays B when A’s road shapes are %s', async stateOfA => {
  // Re-selecting the wish's existing date recalculates without changing any saved constraints.
  const f = resultFixture({ ...view, input: { ...view.input, visits: view.input.visits.map(visit =>
    visit.id === 'cafe' ? { ...visit, fixedDate: D1 } : visit) } });
  const a = trip(REVISION);
  const b = { ...trip(REVISION, plan({ museumLeg: 'TAXI', marketStart: '13:10' })), itineraryId: itineraryB };
  f.generate.mockResolvedValueOnce(json(a)).mockResolvedValueOnce(json({ code: 'PROVIDER_UNAVAILABLE', error: '계산 실패' }, 503))
    .mockResolvedValueOnce(json(b));
  const first = deferred<Response>(), second = deferred<Response>();
  f.shapes.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  await openResult(f);
  await waitFor(() => expect(f.shapes).toHaveBeenCalledTimes(1));
  if (stateOfA === 'cached') {
    await act(async () => first.resolve(json(shapes(a, ROAD))));
    expect(await screen.findByTestId(`points-${commonLeg}`)).toHaveTextContent(JSON.stringify([
      { latitude: 38.5, longitude: -120.2 }, { latitude: 40.7, longitude: -120.95 },
    ]));
  }

  await press('지도 아사쿠사 카페');
  await press('1일차에 추가하고 다시 계산');
  await screen.findByText('계산 실패');
  await press('다시 계산');
  expect(await screen.findByText('택시 14분 · 약 ¥2,300')).toBeVisible();
  expect(f.save).not.toHaveBeenCalled();
  expect(routes()[museumLeg]).toMatch(/TAXI .* STRAIGHT$/);
  expect(screen.queryByTestId(`points-${commonLeg}`)).toBeNull();
  await waitFor(() => expect(f.shapes).toHaveBeenCalledTimes(2));
  expect(f.shapes.mock.calls.map(([url]) => [url.searchParams.get('inputHash'), url.searchParams.get('itineraryId')]))
    .toEqual([[REVISION, ITINERARY_A], [REVISION, itineraryB]]);
  const firstRequest = f.transport.mock.calls.find(([url]) => url === f.shapes.mock.calls[0][0].href);
  expect(firstRequest?.[1]?.signal?.aborted).toBe(true);

  await act(async () => second.resolve(json(shapes(b, '??_ibE_ibE'))));
  const bPoints = JSON.stringify([{ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 1 }]);
  expect(await screen.findByTestId(`points-${commonLeg}`)).toHaveTextContent(bPoints);
  if (stateOfA !== 'cached') {
    // A superseded request can deliver a success or an unreadable response after the newer geometry.
    const response = stateOfA === 'in flight' ? shapes(a, ROAD) : { ...shapes(a, ROAD), legs: null };
    await act(async () => first.resolve(json(response)));
  }
  expect(screen.getByTestId(`points-${commonLeg}`)).toHaveTextContent(bPoints);
  expect(screen.getByTestId(`points-${museumLeg}`)).toHaveTextContent(bPoints);
  await press('다음 장소');
  expect(screen.getByText('13:10 – 13:55')).toBeVisible();
  expect(screen.getByTestId(`points-${commonLeg}`)).toHaveTextContent(bPoints);
});

test.each([
  ['wrong ID', { itineraryId: itineraryB }], ['missing ID', { itineraryId: undefined }], ['wrong hash', { inputHash: 'b'.repeat(64) }],
])('a shape response with %s falls back and can be retried', async (_name, change) => {
  const f = resultFixture(), a = trip(REVISION);
  f.shapes.mockResolvedValueOnce(json({ ...shapes(a, ROAD), ...change }));
  await openResult(f);
  const retry = await screen.findByRole('button', { name: '경로 모양 다시 불러오기' });
  expect(routes()[museumLeg]).toMatch(/ STRAIGHT$/);
  await fireEvent.press(retry);
  await waitFor(() => expect(routes()[museumLeg]).toMatch(/ ROAD$/));
});

const leg = shapes(trip(REVISION), ROAD).legs[0];
test.each([
  ['missing legs', undefined], ['null shape', [{ ...leg, shape: null }]],
])('matching identifiers with %s shows fallback and retries only the shapes GET', async (_label, legs) => {
  const f = resultFixture();
  f.shapes.mockResolvedValueOnce(json({ itineraryId: ITINERARY_A, inputHash: REVISION, legs }));
  await openResult(f);
  expect(await screen.findByRole('button', { name: '경로 모양 다시 불러오기' })).toBeVisible();
  expect(routes()[museumLeg]).toMatch(/TRANSIT DOTTED STRONG .* STRAIGHT$/);
  expect(screen.queryByTestId(`points-${museumLeg}`)).toBeNull();
  await press('경로 모양 다시 불러오기');
  expect(await screen.findByTestId(`points-${museumLeg}`)).toBeVisible();
  expect(screen.queryByRole('button', { name: '경로 모양 다시 불러오기' })).toBeNull();
  expect(f.shapes).toHaveBeenCalledTimes(2);
  expect(f.generate).toHaveBeenCalledTimes(1);
});

test('an unexpected error preparing a valid road shape reaches the same recoverable fallback', async () => {
  const f = resultFixture(), first = deferred<Response>();
  f.shapes.mockReturnValueOnce(first.promise);
  await openResult(f);
  await waitFor(() => expect(f.shapes).toHaveBeenCalledTimes(1));
  const key = jest.spyOn(geometry, 'roadShapeKey').mockImplementationOnce(() => { throw new Error('cannot prepare shape'); });
  try {
    await act(async () => first.resolve(json(shapes(trip(REVISION), ROAD))));
    expect(await screen.findByRole('button', { name: '경로 모양 다시 불러오기' })).toBeVisible();
    expect(routes()[museumLeg]).toMatch(/ STRAIGHT$/);
    await press('경로 모양 다시 불러오기');
    expect(await screen.findByTestId(`points-${museumLeg}`)).toBeVisible();
  } finally { key.mockRestore(); }
});
