import { Dimensions, PanResponder, StyleSheet } from 'react-native';
import { act, fireEvent, screen, waitFor, within } from 'expo-router/testing-library';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FakeResultMap } from './fake-result-map';
import { result, size, spacing } from '../src/theme';
import { conflictTrip, D1, openResult, place, resultFixture, view } from './result-fixture';
import { json } from './helpers';

const press = (name: string) => fireEvent.press(screen.getByRole('button', { name }));
const layout = (id: string, width: number, height: number) =>
  fireEvent(screen.getByTestId(id), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width, height } } });
const legs = [['hotel', 'museum'], ['museum', 'market'], ['market', 'shrine'], ['shrine', 'cafe'], ['cafe', 'hotel']] as const;

test('a long conflict stays inside the measured panel; dates, map controls and the last release remain accessible', async () => {
  const fixes = legs.map(([from, to]) => ({ date: D1, from: place(from), to: place(to), mode: 'TRANSIT' as const }));
  const fixture = resultFixture({ ...view, input: { ...view.input, legModes: fixes } });
  const conflict = conflictTrip(view.revision);
  conflict.capacity.unplaced = [];
  conflict.capacity.issues = fixes.map(({ date, from, to }) => ({ date, from, to, reason: 'UNREACHABLE' }));
  fixture.generate.mockResolvedValueOnce(json(conflict));
  const map = jest.fn(FakeResultMap);
  await openResult(fixture, map);
  const panel = () => screen.getByTestId('place-panel');
  await layout('result-screen', 390, 844);
  await layout('result-top-controls', 390, 170);
  expect(panel()).toHaveStyle({ height: 844 * result.panel.ratio, bottom: 0, left: 0, right: 0 });
  const list = () => screen.getByTestId('place-panel-scroll');
  expect(list()).toHaveStyle({ flex: 1 });
  expect(list()).toHaveProp('directionalLockEnabled', true);
  const last = '아사쿠사 카페 → 도쿄 호텔 · 대중교통 고정 해제하고 다시 계산';
  expect(within(list()).getByRole('button', { name: last })).toBeOnTheScreen();

  // A short landscape parent can be smaller than the OS window (navigation/split view).
  await layout('result-screen', 750, 320);
  await layout('result-top-controls', 750, 125);
  const expected = 320 - 125 - result.locate.offset - size.touch - result.mapAttributionHeight;
  expect(panel()).toHaveStyle({ height: expected });
  expect(map.mock.lastCall?.[0]).toMatchObject({ bottomInset: expected, topInset: 125 });
  expect(screen.getByRole('button', { name: '현재 위치' })).toHaveStyle({ bottom: expected + result.mapAttributionHeight + result.locate.offset });
  expect(within(list()).queryByRole('button', { name: '2일 12.4' })).toBeNull();
  await press('2일 12.4');
  expect(screen.queryByRole('button', { name: last })).toBeNull();
  await press('현재 위치');
  expect(map.mock.lastCall?.[0].locateRequest).toBe(1);
  await press('1일 12.3');
  await fireEvent.scroll(list(), { nativeEvent: { contentOffset: { x: 0, y: 1000 },
    contentSize: { width: 750, height: 1150 }, layoutMeasurement: { width: 750, height: expected } } });
  await fireEvent.press(within(list()).getByRole('button', { name: last }));
  await waitFor(() => expect(fixture.save).toHaveBeenCalledTimes(1));
  expect(fixture.current().input.legModes).toEqual(fixes.slice(0, -1));
  expect(fixture.generate).toHaveBeenCalledTimes(2);
});

test('the panel scrolls vertically at larger system text sizes and keeps horizontal card paging', async () => {
  const originalWindow = Dimensions.get('window'), originalScreen = Dimensions.get('screen');
  const responder = jest.spyOn(PanResponder, 'create');
  const safe = jest.mocked(useSafeAreaInsets);
  const originalInsets = safe.getMockImplementation();
  safe.mockReturnValue({ top: 0, bottom: 21, left: 47, right: 34 });
  try {
    Dimensions.set({ window: { ...originalWindow, width: 844, height: 390, fontScale: 2 },
      screen: { ...originalScreen, width: 844, height: 390, fontScale: 2 } });
    await openResult(resultFixture());
    await layout('result-screen', 780, 370);
    await layout('result-top-controls', 780, 131);
    expect(StyleSheet.flatten(screen.getByTestId('place-panel').props.style).height).toBe(370 - 131 - result.locate.offset - size.touch - result.mapAttributionHeight);
    const list = screen.getByTestId('place-panel-scroll');
    expect(within(list).getByTestId('place-card-row')).toBeOnTheScreen();
    expect(within(list).getByTestId('place-card-museum')).toHaveStyle({ width: result.cardRow.width });
    const handlers = responder.mock.calls.at(-1)![0];
    const event = {} as Parameters<NonNullable<typeof handlers.onPanResponderRelease>>[0];
    const drag = { dx: -100, dy: 3, vx: -1 } as Parameters<NonNullable<typeof handlers.onPanResponderRelease>>[1];
    expect(handlers.onMoveShouldSetPanResponder!(event, { ...drag, dx: 2, dy: 85 })).toBe(false);
    expect(handlers.onMoveShouldSetPanResponder!(event, drag)).toBe(true);
    await act(async () => handlers.onPanResponderRelease!(event, drag));
    expect(screen.getByRole('button', { name: '지도 아메요코 시장', selected: true })).toBeVisible();
    expect(StyleSheet.flatten(list.props.contentContainerStyle)).toMatchObject({ paddingLeft: 47, paddingRight: 34,
      paddingBottom: 21 + spacing.section });
    expect(screen.getByTestId('result-map-controls')).toHaveStyle({ left: 47, right: 34 });
  } finally {
    responder.mockRestore();
    if (originalInsets) safe.mockImplementation(originalInsets);
    await act(async () => Dimensions.set({ window: originalWindow, screen: originalScreen }));
  }
});
