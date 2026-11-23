import { fireEvent, screen, within } from 'expo-router/testing-library';
import { Temporal } from '@js-temporal/polyfill';
import { buildDays } from '../src/result/days';
import { movedSummary } from '../src/result/edits';
import { json } from './helpers';
import { D1, D2, D3, REVISION, leg, openResult, plan, resultFixture, stop, trip, view, type Plan } from './result-fixture';

const press = (name: string) => fireEvent.press(screen.getByRole('button', { name }));

// The shrine closes at 15:05. Taking transit to the market adds ten minutes and misses its last entry on day one.
function marketAndShrine(transit: boolean): Plan {
  const data = plan();
  const day = transit ? D2 : D1;
  const marketStart = transit ? '13:30' : '13:20';
  const marketEnd = transit ? '14:15' : '14:05';
  const marketLeg = data.comparisons[2];
  if (transit) marketLeg.selected = { mode: 'TRANSIT', minutes: 30, fare: 200, fixed: true };
  const shrine = stop(day, 'shrine', '14:15', '15:05');
  return {
    comparisons: [
      ...data.comparisons.slice(0, 3),
      ...(transit ? [leg(D1, 'DAY', 'market', 'hotel', marketEnd, 'WALK', 30, 0, { WALK: { minutes: 30, fare: 0 } })] : []),
      transit ? leg(D2, 'DAY', 'hotel', 'shrine', '13:45', 'TRANSIT', 30, 200, { TRANSIT: { minutes: 30, fare: 200 } })
        : leg(D1, 'DAY', 'market', 'shrine', marketEnd, 'WALK', 10, 0, { WALK: { minutes: 10, fare: 0 } }),
      leg(day, 'DAY', 'shrine', 'hotel', '15:05', 'TRANSIT', 30, 200, { TRANSIT: { minutes: 30, fare: 200 } }),
    ],
    stops: { [D1]: [...data.stops[D1].slice(0, 2), stop(D1, 'market', marketStart, marketEnd), ...(transit ? [] : [shrine])],
      [D2]: transit ? [shrine] : [], [D3]: [] },
  };
}

test('changing transport moves a visit one day later and undo moves it back on both the card and the toast', async () => {
  const f = resultFixture();
  f.generate.mockImplementation(async () => json(trip(f.current().revision,
    marketAndShrine(f.current().input.legModes?.some(row => row.mode === 'TRANSIT') ?? false))));
  await openResult(f);
  await press('다음 장소');
  await press('대중교통 30분 ¥200로 바꾸기');
  const toast = within(await screen.findByTestId('result-toast'));
  expect(toast.getByText('대중교통으로 바꾸고 다시 계산했어요')).toBeVisible();
  expect(toast.getByText('아메요코 시장 10분 늦춰짐, 메이지 신궁 24시간 늦춰짐 · 고정 예약은 그대로예요')).toBeVisible();
  await press('2일 12.4');
  const moved = within(screen.getByTestId('place-card-shrine'));
  expect(moved.getByText('14:15 – 15:05')).toBeVisible();
  expect(moved.getByText(' · 24시간 늦춰짐')).toBeVisible();

  await press('되돌리기');
  expect(await screen.findByText('되돌리고 다시 계산했어요')).toBeVisible();
  expect(within(screen.getByTestId('result-toast'))
    .getByText('아메요코 시장 10분 당겨짐, 메이지 신궁 24시간 당겨짐 · 고정 예약은 그대로예요')).toBeVisible();
  await press('1일 12.3');
  await press('지도 메이지 신궁');
  const restored = within(screen.getByTestId('place-card-shrine'));
  expect(restored.getByText('14:15 – 15:05')).toBeVisible();
  expect(restored.getByText(' · 24시간 당겨짐')).toBeVisible();
  expect(f.current().input.legModes).toEqual([]);
  expect(f.generate).toHaveBeenCalledTimes(3);
});

test.each([
  ['2026-03-28', '2026-03-29', '23시간'],
  ['2026-10-24', '2026-10-25', '25시간'],
  ['2026-03-27', '2026-03-29', '47시간'],
])('the same local hour on %s and %s compares the actual instants', (from, to, duration) => {
  const zone = 'Europe/Paris';
  const localView = { ...view, input: { ...view.input, cityCode: 'PARIS', timeZone: zone,
    startDate: from, endDate: to, flights: [], lodgings: [], visits: [view.input.visits[2]] } };
  function resultOn(date: string) {
    const start = Temporal.PlainDate.from(date).toPlainDateTime('10:00').toZonedDateTime(zone).toInstant();
    const result = trip(REVISION);
    result.comparisons = [];
    result.capacity.recommendation!.schedule.days = [{ date, timeZone: zone, legs: [],
      stops: [{ kind: 'VISIT', visitId: 'shrine', start: start.toString(), end: start.add({ minutes: 50 }).toString() }] }];
    return result;
  }
  const earlier = resultOn(from), later = resultOn(to);
  expect(movedSummary(buildDays(localView, later, earlier))).toBe(`메이지 신궁 ${duration} 늦춰짐`);
  expect(movedSummary(buildDays(localView, earlier, later))).toBe(`메이지 신궁 ${duration} 당겨짐`);
});

test('a newly placed or removed wish has no before-and-after start time to report', () => {
  const without = trip(REVISION), withWish = trip(REVISION, plan({ cafeOnDay3: true }));
  const added = buildDays(view, withWish, without);
  expect(added[2].cards[0]).toMatchObject({ visitId: 'cafe', changed: true, shift: 0 });
  expect(movedSummary(added)).toBeNull();
  const removed = buildDays(view, without, withWish);
  expect(removed[2].cards).toEqual([]);
  expect(movedSummary(removed)).toBeNull();
});
