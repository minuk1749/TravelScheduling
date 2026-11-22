import { act, fireEvent, screen, waitFor, within } from 'expo-router/testing-library';
import { pendingLegKeys } from '../src/map/selection';
import { buildDays } from '../src/result/days';
import { deferred, json } from './helpers';
import { at, D1, D2, legId, openResult, place, plan, resultFixture, routes, trip, view } from './result-fixture';

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
  const move = { kind: 'VISIT' as const, visitId: 'market', previousDate: D1, date: D2 };
  const pending = pendingLegKeys(days, move);
  expect(pending).toEqual(new Set([legId(D1, 'museum', 'market'), legId(D1, 'market', 'hotel'),
    legId(D2, 'hotel', 'shrine'), legId(D2, 'shrine', 'hotel')]));
  // An undo is now removing a day-two visit and returning it to day one.
  const reverse = pendingLegKeys(days, { kind: 'UNDO', of: { ...move, visitId: 'shrine' } });
  expect(reverse).toEqual(new Set(days.flatMap(day => day.legs.filter(leg => leg.kind === 'DAY').map(leg => leg.key))));
});
