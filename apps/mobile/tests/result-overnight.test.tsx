import { fireEvent, screen, waitFor, within } from 'expo-router/testing-library';
import { legEmphasis, pendingLegKeys } from '../src/map/selection';
import { mapScene } from '../src/map/scene';
import { buildDays, unplacedWishes } from '../src/result/days';
import { timeRange } from '../src/result/format';
import { json } from './helpers';
import { D1, D3, legId, openResult, place, plan, resultFixture, REVISION, routes, trip, view } from './result-fixture';

const press = (name: string) => fireEvent.press(screen.getByRole('button', { name }));
const sheet = () => within(screen.getByTestId('form-sheet'));

test('00:30 departure has a flight on day 3 and a previous-night transfer editable from day 2 with the saved date', async () => {
  const input = { ...view.input, flights: [...view.input.flights, { direction: 'DEPARTURE' as const,
    airport: view.input.flights[0].airport, localDateTime: D3 + 'T00:30' }] };
  const airport = place('airport');
  const f = resultFixture({ ...view, input, places: { ...view.places, [airport]: { ...view.places[airport]!,
    attributions: [{ provider: 'Haneda Airport', providerUri: 'https://example.org/airport' }] } } });
  const data = plan();
  data.comparisons.push({ ...data.comparisons[0], date: D3, departure: '2026-12-04T12:10:00Z',
    from: place('hotel'), to: place('airport') });
  f.generate.mockResolvedValueOnce(json(trip(REVISION, data)));
  const key = legId(D3, 'hotel', 'airport', 'AIRPORT');
  await openResult(f);
  await press('3일 12.5');
  expect(routes()[key]).toBeUndefined();
  expect(screen.getByRole('button', { name: '지도 하네다 공항' })).toBeVisible();
  await press('전체 일정');
  expect(sheet().getByText('00:30')).toBeVisible();
  expect(sheet().getByText('✈ 공항 출발 · 하네다 공항')).toBeVisible();
  expect(sheet().getByRole('link', { name: 'Haneda Airport' })).toBeVisible();
  expect(sheet().queryByText('도쿄 호텔 → 하네다 공항')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: '닫기', includeHiddenElements: true }));
  await press('2일 12.4');
  expect(routes()[key]).toMatch(/TRANSIT/);
  await press('전체 일정');
  expect(sheet().getByText('21:10 – 21:50')).toBeVisible();
  expect(sheet().getByText('도쿄 호텔 → 하네다 공항')).toBeVisible();
  expect(sheet().getByRole('link', { name: 'Haneda Airport' })).toBeVisible();
  expect(sheet().queryByText('✈ 공항 출발 · 하네다 공항')).toBeNull();
  await fireEvent.press(sheet().getByRole('button', { name: '택시 35분 약 ¥9,000로 바꾸기' }));
  await waitFor(() => expect(f.save).toHaveBeenCalledTimes(1));
  expect(f.current().input.legModes).toEqual([{ date: D3, from: place('hotel'), to: place('airport'), mode: 'TAXI' }]);
});

test('late arrival and transfer appear on their local dates; an arrival exactly at midnight belongs to the new day', () => {
  const localView = { ...view, input: { ...view.input, flights: [{ ...view.input.flights[0], localDateTime: D1 + 'T23:00' }] } };
  const key = legId(D1, 'airport', 'hotel', 'AIRPORT');
  const result = trip(REVISION);
  const arrival = { ...result.comparisons[0], departure: '2026-12-03T15:30:00Z' }; // 00:30, Tokyo day 2.
  const days = buildDays(localView, { ...result, comparisons: [arrival] }, null);
  const scene = (day: typeof days[number]) => mapScene({ view: localView, day, card: null, focus: 'BROWSE',
    pending: new Set(), wishes: unplacedWishes(localView, days), causes: [] });
  expect(days[0].rows).toContainEqual(expect.objectContaining({ role: 'AIRPORT_ARRIVAL', at: '2026-12-03T14:00:00Z' }));
  expect(scene(days[0]).routes).toHaveLength(0);
  expect(scene(days[1]).routes.map(route => route.id)).toEqual([key]);
  expect(days[1].rows).toContainEqual(expect.objectContaining({ role: 'LODGING_IN', at: '2026-12-03T16:10:00Z' }));

  const crossing = { ...arrival, departure: '2026-12-03T14:20:00Z' };
  const [first, second] = buildDays(localView, { ...result, comparisons: [crossing] }, null);
  expect(timeRange(first.legs[0].departure, first.legs[0].arrival, first.timeZone)).toBe('23:20 – 12월 4일 00:00');
  expect(first.rows.some(row => row.kind === 'ENDPOINT' && row.role === 'LODGING_IN')).toBe(false);
  expect(second.rows).toContainEqual(expect.objectContaining({ role: 'LODGING_IN', at: '2026-12-03T15:00:00Z' }));
});

test('a wish alias for a lodging preserves both marker roles, actual lodging rows and return time', () => {
  const lodging = view.input.lodgings[0].place;
  const visits = view.input.visits.map(v => v.id === 'cafe' ? { ...v, place: lodging } : v);
  const alias = { ...view, input: { ...view.input, visits } };
  const days = buildDays(alias, trip(REVISION), null), day = days[0];
  expect(day.cards.at(-1)?.returnAt).toBe('2026-12-03T05:35:00Z');
  expect(day.rows.filter(row => row.kind === 'ENDPOINT').map(row => row.role))
    .toEqual(['AIRPORT_ARRIVAL', 'LODGING_IN', 'LODGING_OUT', 'LODGING_IN']);
  const map = mapScene({ view: alias, day, card: null, focus: 'BROWSE', pending: new Set(), wishes: unplacedWishes(alias, days),
    causes: [] });
  expect(map.markers.map(m => m.id)).toEqual(expect.arrayContaining(['lodging:' + lodging.id, 'cafe']));
  const pending = pendingLegKeys(days, { kind: 'WISH', visitId: 'cafe', date: D1 });
  expect(pending).toEqual(new Set(day.legs.filter(leg => leg.kind === 'DAY').map(leg => leg.key)));
  expect(pending.has(legId(D1, 'airport', 'hotel', 'AIRPORT'))).toBe(false);
});

test('a scheduled visit at the lodging uses the leg before that visit and preserves later lodging anchors', () => {
  // Market is at the hotel. The timed hotel visit is distinct from the earlier airport → hotel transfer.
  const hotel = view.input.lodgings[0].place;
  const alias = { ...view, input: { ...view.input, visits: view.input.visits.map(v => v.id === 'market' ? { ...v, place: hotel } : v) } };
  const data = plan();
  data.comparisons = data.comparisons.filter(leg => leg.from !== place('market')).map(leg =>
    leg.to === place('market') ? { ...leg, to: hotel.id } : leg);
  const days = buildDays(alias, trip(REVISION, data), null);
  const [first, second] = days;
  const visit = first.cards.find(card => card.visitId === 'market')!;
  expect(visit.arrival).toMatchObject({ from: place('museum'), to: hotel.id, arrival: '2026-12-03T04:20:00Z' });
  expect(visit.departure).toBeNull();
  const affected = legId(D1, 'museum', 'hotel');
  const transfer = legId(D1, 'airport', 'hotel', 'AIRPORT');
  const edit = legEmphasis(first, visit, 'EDIT');
  expect([...edit].filter(([, emphasis]) => emphasis === 'STRONG').map(([key]) => key)).toEqual([affected]);
  expect(edit.get(transfer)).toBe('DIM');
  const pending = pendingLegKeys(days, { kind: 'VISIT', visitId: 'market' });
  expect([...pending]).toEqual([affected]);
  expect(legEmphasis(first, visit, 'CALCULATING', pending).get(transfer)).toBe('STRONG');
  expect([...legEmphasis(second, null, 'CALCULATING', pending).values()]).toEqual(['STRONG', 'STRONG']);
  expect(first.rows.filter(row => row.kind === 'ENDPOINT').map(row => row.role))
    .toEqual(['AIRPORT_ARRIVAL', 'LODGING_IN', 'LODGING_OUT', 'LODGING_IN']);
});
