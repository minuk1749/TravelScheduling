import { act, fireEvent, screen, waitFor, within } from 'expo-router/testing-library';
import { pendingLegKeys } from '../src/map/selection';
import { buildDays } from '../src/result/days';
import { deferred, json } from './helpers';
import { at, D1, D2, D3, legId, openResult, place, plan, resultFixture, routes, trip, view } from './result-fixture';

const press = (name: string) => fireEvent.press(screen.getByRole('button', { name }));

test('switch and undo hide both airport and visit legs sharing the saved transport constraint', async () => {
  const airport = view.input.flights[0].airport;
  const visits = view.input.visits.map(visit => visit.id === 'market' ? { ...visit, place: airport } : visit);
  const f = resultFixture({ ...view, input: { ...view.input, visits } });
  const data = plan();
  data.comparisons = data.comparisons.map(row => ({ ...row, from: row.from === place('market') ? airport.id : row.from,
    to: row.to === place('market') ? airport.id : row.to }));
  f.generate.mockResolvedValueOnce(json(trip(view.revision, data)));
  await openResult(f);
  const transfer = legId(D1, 'airport', 'hotel', 'AIRPORT'), returning = legId(D1, 'airport', 'hotel');
  expect(routes()[transfer]).toMatch(/ TRANSIT /);
  expect(routes()[returning]).toMatch(/ WALK /);
  const request = deferred<Response>();
  f.generate.mockReturnValueOnce(request.promise);
  await press('전체 일정');
  await fireEvent.press(within(screen.getByTestId('form-sheet')).getByRole('button', { name: '택시 35분 약 ¥9,000로 바꾸기' }));
  await waitFor(() => expect(f.generate).toHaveBeenCalledTimes(2));
  expect(f.current().input.legModes).toEqual([{ date: D1, from: airport.id, to: place('hotel'), mode: 'TAXI' }]);
  const expectOnlyMatchingRoutesHidden = () => {
    expect(routes()[transfer]).toBeUndefined();
    expect(routes()[returning]).toBeUndefined();
    expect(routes()[legId(D1, 'hotel', 'museum')]).toMatch(/ STRONG /);
    expect(routes()[legId(D1, 'museum', 'airport')]).toMatch(/ STRONG /);
  };
  expectOnlyMatchingRoutesHidden();
  const updated = { ...data, comparisons: data.comparisons.map(row => row.from === airport.id && row.to === place('hotel')
    ? { ...row, selected: { ...row.selected, mode: 'TAXI' as const, fixed: true } } : row) };
  await act(async () => request.resolve(json(trip(f.current().revision, updated))));
  expect(routes()[transfer]).toMatch(/ TAXI /);
  expect(routes()[returning]).toMatch(/ TAXI /);

  const undo = deferred<Response>();
  f.generate.mockReturnValueOnce(undo.promise);
  await press('되돌리기');
  await waitFor(() => expect(f.generate).toHaveBeenCalledTimes(3));
  expectOnlyMatchingRoutesHidden();
  await act(async () => undo.resolve(json(trip(f.current().revision, data))));
  expect(routes()[transfer]).toMatch(/ TRANSIT /);
  expect(routes()[returning]).toMatch(/ WALK /);
});

test('overnight transfer uses the saved flight date, not its displayed date or the reverse direction', () => {
  const data = plan();
  const from = place('hotel'), to = place('airport');
  data.comparisons.push({ ...data.comparisons[0], date: D3, departure: at(D2, '21:10'), from, to },
    { ...data.comparisons[1], date: D2, departure: at(D2, '09:30'), from, to },
    { ...data.comparisons[1], date: D2, departure: at(D2, '13:00'), from: to, to: from });
  const days = buildDays(view, trip(view.revision, data), null);
  const transfer = legId(D3, 'hotel', 'airport', 'AIRPORT');
  const day = days.find(row => row.date === D2)!;
  expect(day.legs.map(leg => leg.key)).toEqual(expect.arrayContaining([transfer, legId(D2, 'hotel', 'airport'), legId(D2, 'airport', 'hotel')]));
  const change = { kind: 'MODE' as const, leg: { date: D3, from, to }, mode: 'TAXI' as const };
  expect(pendingLegKeys(days, change)).toEqual(new Set([transfer]));
  expect(pendingLegKeys(days, { kind: 'UNDO', of: change })).toEqual(new Set([transfer]));
});
