import { fireEvent, screen, within } from 'expo-router/testing-library';
import { moneyLabel } from '../src/result/format';
import { json } from './helpers';
import { openResult, place, plan, resultFixture, trip, view } from './result-fixture';

test.each([
  { currency: 'EUR', transit: 2.50, taxi: 12.35, total: 1012.75, transitText: '€2.50', taxiText: '약 €12.35', totalText: '약 €1,012.75' },
  { currency: 'JPY', transit: 250, taxi: 1235, total: 101275, transitText: '¥250', taxiText: '약 ¥1,235', totalText: '약 ¥101,275' },
])('the card, alternative and trip summary show fares in $currency', async ({ currency, transit, taxi, total, transitText, taxiText, totalText }) => {
  const f = resultFixture();
  const data = plan();
  const arrival = data.comparisons.find(leg => leg.to === place('museum'))!;
  arrival.selected = { ...arrival.selected, fare: transit };
  arrival.alternatives = { TRANSIT: { minutes: 25, fare: transit }, TAXI: { minutes: 14, fare: taxi } };
  const itinerary = trip(view.revision, data);
  f.generate.mockResolvedValueOnce(json({ ...itinerary, efficiency: {
    ...itinerary.efficiency, currency, transitFare: transit, selectedFare: total,
  } }));
  await openResult(f);
  expect(screen.getByText(`대중교통 25분 · ${transitText}`)).toBeVisible();
  expect(screen.getByRole('button', { name: `택시 14분 ${taxiText}로 바꾸기` })).toBeEnabled();
  await fireEvent.press(screen.getByRole('button', { name: '전체 일정' }));
  const summary = within(screen.getByTestId('trip-efficiency'));
  expect(summary.getByText(`대중교통·도보만 · 3시간 25분 · ${transitText}`)).toBeVisible();
  expect(summary.getByText(`선택한 이동 · 2시간 55분 · ${totalText}`)).toBeVisible();
});

test('rounds subunit precision per currency while retaining currency-code fallback', () => {
  expect(moneyLabel(2.509, 'EUR')).toBe('€2.51');
  expect(moneyLabel(250.6, 'JPY')).toBe('¥251');
  expect(moneyLabel(0.1259, 'KWD')).toBe('0.126 KWD');
});
