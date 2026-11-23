import { screen, waitFor } from 'expo-router/testing-library';
import { buildDays } from '../src/result/days';
import { json } from './helpers';
import { D1, legId, openResult, place, resultFixture, REVISION, routes, trip, view } from './result-fixture';

const hotel = place('hotel'), museum = place('museum');
// A short leg in Yokohama, outside Tokyo's registered centre circle. The other airport leg exceeds 4 km.
const places = { ...view.places,
  [hotel]: { ...view.places[hotel]!, coordinates: { latitude: 35.464, longitude: 139.62 } },
  [museum]: { ...view.places[museum]!, coordinates: { latitude: 35.456, longitude: 139.63 } },
};
const cityView = (cityCode: string) => ({ ...view, input: { ...view.input, cityCode }, places });

test.each([['요코하마', false], ['constructor', false], ['TOKYO', true]] as const)(
  'uses only a registered centre for %s and still builds the visiting cards and long airport leg', (city, outside) => {
    const [day] = buildDays(cityView(city), trip(REVISION), null);
    expect(day.cards[0]).toMatchObject({ visitId: 'museum', arrival: { from: hotel, to: museum, mode: 'TRANSIT', outside } });
    expect(day.legs.find(leg => leg.kind === 'AIRPORT')).toMatchObject({ mode: 'TRANSIT', outside: true });
  });

test('opens a directly entered city whose name matches a built-in property, retains its name and displays fares in the supplied currency', async () => {
  const f = resultFixture(cityView('constructor'));
  const computed = trip(REVISION);
  computed.efficiency = { ...computed.efficiency!, currency: 'CHF' };
  f.generate.mockResolvedValueOnce(json(computed));
  await openResult(f);
  expect(screen.getByRole('header', { name: 'constructor' })).toBeVisible();
  expect(screen.getByRole('button', { name: '지도 도쿄 국립박물관', selected: true })).toBeVisible();
  expect(screen.getByText('대중교통 25분 · 240 CHF')).toBeVisible();
  await waitFor(() => expect(routes()[legId(D1, 'hotel', 'museum')]).toMatch(/TRANSIT SOLID STRONG/));
});
