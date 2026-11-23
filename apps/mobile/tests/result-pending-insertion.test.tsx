import { act, fireEvent, screen, waitFor, within } from 'expo-router/testing-library';
import { pendingLegKeys } from '../src/map/selection';
import { buildDays } from '../src/result/days';
import { deferred, json } from './helpers';
import { at, conflictTrip, D1, D2, legId, openResult, place, plan, resultFixture, routes, trip, view } from './result-fixture';

const press = (name: string) => fireEvent.press(screen.getByRole('button', { name }));

function withCafeBetweenVisits() {
  const data = plan();
  const old = data.comparisons.find(leg => leg.from === place('museum') && leg.to === place('market'))!;
  const first = { ...old, to: place('cafe'), selected: { ...old.selected, minutes: 10 } };
  const second = { ...first, from: place('cafe'), to: place('market'), departure: at(D1, '13:50') };
  data.comparisons = data.comparisons.flatMap(leg => leg === old ? [first, second]
    : [{ ...leg, departure: leg.from === place('market') ? at(D1, '14:45') : leg.departure }]);
  data.stops[D1] = [...data.stops[D1].filter(stop => stop.kind !== 'VISIT' || stop.visitId !== 'market'),
    { kind: 'VISIT', visitId: 'cafe', start: at(D1, '13:10'), end: at(D1, '13:50') },
    { kind: 'VISIT', visitId: 'market', start: at(D1, '14:00'), end: at(D1, '14:45') }];
  return data;
}

test('a wish insertion hides unconfirmed destination legs until the two replacement legs arrive', async () => {
  const f = resultFixture();
  await openResult(f);
  const old = legId(D1, 'museum', 'market'), airport = legId(D1, 'airport', 'hotel', 'AIRPORT');
  expect(routes()[old]).toBeDefined();
  const request = deferred<Response>();
  f.generate.mockReturnValueOnce(request.promise);
  await press('지도 아사쿠사 카페');
  await fireEvent.press(within(screen.getByTestId('form-sheet')).getByRole('button', { name: '1일차에 추가하고 다시 계산' }));
  await waitFor(() => expect(f.generate).toHaveBeenCalledTimes(2));
  expect(routes()[old]).toBeUndefined();
  expect(routes()[airport]).toMatch(/ STRONG /);
  await press('2일 12.4');
  expect(routes()[legId(D2, 'hotel', 'shrine')]).toMatch(/ STRONG /);
  await act(async () => request.resolve(json(trip(f.current().revision, withCafeBetweenVisits()))));
  expect(await screen.findByRole('button', { name: '지도 아사쿠사 카페', selected: true })).toBeVisible();
  const arriving = legId(D1, 'museum', 'cafe'), departing = legId(D1, 'cafe', 'market');
  expect(routes()[arriving]).toMatch(/ STRONG /);
  expect(routes()[departing]).toBeDefined();
  expect(routes()[old]).toBeUndefined();

  const undo = deferred<Response>();
  f.generate.mockReturnValueOnce(undo.promise);
  await press('되돌리기');
  await waitFor(() => expect(f.generate).toHaveBeenCalledTimes(3));
  expect(routes()[arriving]).toBeUndefined();
  expect(routes()[departing]).toBeUndefined();
  expect(routes()[legId(D1, 'hotel', 'museum')]).toMatch(/ STRONG /);
  await act(async () => undo.resolve(json(trip(f.current().revision))));
  expect(routes()[old]).toBeDefined();
});

test('moving a scheduled visit hides its source edges and potential insertion edges on the other date, including on undo', () => {
  const days = buildDays(view, trip(view.revision), null);
  const move = { kind: 'VISIT' as const, visitId: 'market', previousDate: D1, date: D2, placementOrder: { before: null, after: null } };
  const pending = pendingLegKeys(days, move);
  expect(pending).toEqual(new Set([legId(D1, 'museum', 'market'), legId(D1, 'market', 'hotel'),
    legId(D2, 'hotel', 'shrine'), legId(D2, 'shrine', 'hotel')]));
  // An undo is now removing a day-two visit and returning it to day one.
  const reverse = pendingLegKeys(days, { kind: 'UNDO', of: { ...move, visitId: 'shrine' } });
  expect(reverse).toEqual(new Set(days.flatMap(day => day.legs.filter(leg => leg.kind === 'DAY').map(leg => leg.key))));
});

test('moving the third visit to first hides the old first arrival and restores the old schedule on undo', async () => {
  const initial = withCafeBetweenVisits();
  const f = resultFixture();
  f.generate.mockResolvedValueOnce(json(trip(view.revision, initial)));
  await openResult(f);
  const oldFirst = legId(D1, 'hotel', 'museum'), unchanged = legId(D1, 'museum', 'cafe');
  const airport = legId(D1, 'airport', 'hotel', 'AIRPORT');
  await press('지도 아메요코 시장');
  await press('이 장소 수정');
  const sheet = within(screen.getByTestId('form-sheet'));
  await fireEvent(sheet.getByLabelText('날짜 고정'), 'valueChange', true);
  await fireEvent(sheet.getByLabelText('순서 고정'), 'valueChange', true);
  await fireEvent.press(sheet.getByRole('button', { name: '순서 앞당기기' }));
  await fireEvent.press(sheet.getByRole('button', { name: '순서 앞당기기' }));
  expect(sheet.getByText('1번째')).toBeVisible();
  const request = deferred<Response>();
  f.generate.mockReturnValueOnce(request.promise);
  await fireEvent.press(sheet.getByRole('button', { name: '적용하고 다시 계산' }));
  await waitFor(() => expect(f.generate).toHaveBeenCalledTimes(2));
  expect(routes()[oldFirst]).toBeUndefined();
  expect(routes()[legId(D1, 'cafe', 'market')]).toBeUndefined();
  expect(routes()[legId(D1, 'market', 'hotel')]).toBeUndefined();
  expect(routes()[unchanged]).toMatch(/ STRONG /);
  expect(routes()[airport]).toMatch(/ STRONG /);
  await press('2일 12.4');
  expect(routes()[legId(D2, 'hotel', 'shrine')]).toMatch(/ STRONG /);

  const moved = withCafeBetweenVisits();
  moved.comparisons = moved.comparisons.map(leg => {
    if (leg.from === place('hotel') && leg.to === place('museum')) return { ...leg, to: place('market'), departure: at(D1, '09:15') };
    if (leg.from === place('market')) return { ...leg, to: place('museum'), departure: at(D1, '10:30') };
    if (leg.to === place('market')) return { ...leg, to: place('hotel') };
    return leg;
  });
  moved.stops[D1] = [{ kind: 'VISIT', visitId: 'market', start: at(D1, '09:40'), end: at(D1, '10:25') },
    ...moved.stops[D1].filter(stop => stop.kind !== 'VISIT' || stop.visitId !== 'market')];
  await act(async () => request.resolve(json(trip(f.current().revision, moved))));
  expect(await screen.findByRole('button', { name: '1번 아메요코 시장, 09:40부터 10:25까지', selected: true })).toBeVisible();
  expect(routes()[legId(D1, 'hotel', 'market')]).toMatch(/ STRONG /);
  expect(routes()[legId(D1, 'market', 'museum')]).toBeDefined();
  expect(routes()[oldFirst]).toBeUndefined();

  const undo = deferred<Response>();
  f.generate.mockReturnValueOnce(undo.promise);
  await press('되돌리기');
  await waitFor(() => expect(f.generate).toHaveBeenCalledTimes(3));
  expect(routes()[legId(D1, 'cafe', 'hotel')]).toBeUndefined();
  expect(routes()[airport]).toMatch(/ STRONG /);
  await act(async () => undo.resolve(json(trip(f.current().revision, initial))));
  expect(routes()[oldFirst]).toBeDefined();
});

test('undoing a same-day reorder uses the previous fixed slot; releasing the slot leaves the destination open', () => {
  const days = buildDays(view, trip(view.revision, withCafeBetweenVisits()), null);
  const marketThird = { kind: 'VISIT' as const, visitId: 'market', date: D1, previousDate: D1,
    placementOrder: { before: 0, after: 2 } };
  const restoreFirst = pendingLegKeys(days, { kind: 'UNDO', of: marketThird });
  expect(restoreFirst).toEqual(new Set([legId(D1, 'cafe', 'market'), legId(D1, 'market', 'hotel'), legId(D1, 'hotel', 'museum')]));
  const release = pendingLegKeys(days, { ...marketThird, date: null, placementOrder: { before: 2, after: null } });
  expect(release).toEqual(new Set(days[0].legs.filter(leg => leg.kind === 'DAY').map(leg => leg.key)));
});

test('changing only a reservation time and undoing it keep unrelated routes visible while the POST is pending', async () => {
  const f = resultFixture();
  await openResult(f);
  await press('이 장소 수정');
  const sheet = within(screen.getByTestId('form-sheet'));
  await fireEvent.changeText(sheet.getByLabelText('고정 시각'), '11:15');
  const change = deferred<Response>();
  f.generate.mockReturnValueOnce(change.promise);
  await fireEvent.press(sheet.getByRole('button', { name: '적용하고 다시 계산' }));
  await waitFor(() => expect(f.generate).toHaveBeenCalledTimes(2));
  const expectUnaffectedReturn = () => {
    expect(routes()[legId(D1, 'hotel', 'museum')]).toBeUndefined();
    expect(routes()[legId(D1, 'museum', 'market')]).toBeUndefined();
    expect(routes()[legId(D1, 'market', 'hotel')]).toMatch(/ STRONG /);
    expect(routes()[legId(D1, 'airport', 'hotel', 'AIRPORT')]).toMatch(/ STRONG /);
  };
  expectUnaffectedReturn();
  await act(async () => change.resolve(json(conflictTrip(f.current().revision))));
  const undo = deferred<Response>();
  f.generate.mockReturnValueOnce(undo.promise);
  await press('변경 취소');
  await waitFor(() => expect(f.generate).toHaveBeenCalledTimes(3));
  expectUnaffectedReturn();
  await act(async () => undo.resolve(json(trip(f.current().revision))));
  expect(f.current().input.visits.find(v => v.id === 'museum')?.fixedTime).toBe('11:00');
});
