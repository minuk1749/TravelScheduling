import { buildDays } from '../src/result/days';
import { D2, place, REVISION, trip, view } from './result-fixture';

test('a luggage pickup shows lodging arrival and departure before the final airport transfer', () => {
  const original = trip(REVISION);
  const transfer = { ...original.comparisons[0], date: D2, from: place('hotel'), to: place('airport'),
    departure: '2026-12-04T03:00:00Z' };
  const input = { ...view.input, flights: [...view.input.flights, { direction: 'DEPARTURE' as const,
    airport: view.input.flights[0].airport, localDateTime: D2 + 'T16:00' }] };
  const result = { ...original, comparisons: [...original.comparisons, transfer] };
  const day = buildDays({ ...view, input }, result, null)[1];
  expect(day.rows.map(row => row.kind === 'ENDPOINT' ? row.role : row.kind)).toEqual([
    'LODGING_OUT', 'LEG', 'VISIT', 'LEG', 'LODGING_IN', 'LODGING_OUT', 'LEG', 'AIRPORT_DEPARTURE',
  ]);
  expect(day.rows.slice(-4).map(row => row.at)).toEqual([
    '2026-12-04T01:50:00Z', '2026-12-04T03:00:00Z', '2026-12-04T03:00:00Z', '2026-12-04T07:00:00Z',
  ]);
});
