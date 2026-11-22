import { AccessibilityInfo, Animated, Dimensions, StyleSheet } from 'react-native';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { buildDays } from '../src/result/days';
import { ScheduleSheet } from '../src/screens/result/schedule-sheet';
import { motion, result } from '../src/theme';
import { at, D1, REVISION, trip, view } from './result-fixture';

const days = buildDays(view, trip(REVISION), null);
// An all-day itinerary with thirty distinct short visits gives the scroll view more rows than the viewport.
const [day] = days;
const stops = Array.from({ length: 30 }, (_, index) => {
  const minutes = 20 * index;
  const start = at(D1, `${String(8 + Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`);
  const card = { ...day.cards[0]!, visitId: `visit-${index}`, name: `장소 ${index + 1}`, start, stay: 15, number: index + 1 };
  return { kind: 'VISIT' as const, at: start, card };
});
const longDay = { ...day, cards: stops.map(stop => stop.card), rows: stops };
const safe = { top: 48, bottom: 30, left: 8, right: 10 };
const top = safe.top + result.topBar.top + result.topBar.height;

test.each([false, true])('full-day sheet anchors below the trip bar for both short and long lists, reduce motion = %s', async reduced => {
  const preference = jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(reduced);
  const close = jest.fn(), select = jest.fn();
  const frame = (day: typeof days[number]) => <SafeAreaInsetsContext.Provider value={safe}>
    <ScheduleSheet day={day} places={view.places} currency="JPY" efficiency={null} estimated={false}
      previous={false} close={close} select={select} />
  </SafeAreaInsetsContext.Provider>;
  const timing = jest.mocked(Animated.timing);
  timing.mockClear();
  // Pause the animation halfway to distinguish translation from opacity; RN itself supplies the native driver.
  timing.mockImplementationOnce((value, config) => ({
    start() { if (value instanceof Animated.Value && config.toValue === 1) value.setValue(0.5); },
    stop() {}, reset() {},
  }));
  try {
    const rendered = await render(frame(days[2]));
    await waitFor(() => expect(timing).toHaveBeenCalledWith(expect.any(Animated.Value),
      expect.objectContaining({ duration: motion.sheet.duration, toValue: 1, useNativeDriver: true })));
    const sheet = () => screen.getByTestId('expanded-sheet');
    expect(sheet()).toHaveStyle({ top, bottom: 0, left: safe.left, right: safe.right });
    const mid = StyleSheet.flatten(sheet().props.style);
    if (reduced) {
      expect(mid.opacity).toBe(0.5);
      expect(mid.transform).toBeUndefined();
    } else {
      expect(mid.transform).toEqual([{ translateY: (Dimensions.get('window').height - top) / 2 }]);
    }
    expect(screen.getByText('배치된 장소 없음')).toBeOnTheScreen();

    await rendered.rerender(frame(longDay));
    expect(sheet()).toHaveStyle({ top, bottom: 0, left: safe.left, right: safe.right });
    const list = screen.getByTestId('expanded-sheet-list');
    expect(list).toHaveStyle({ flex: 1 });
    await fireEvent.scroll(list, { nativeEvent: { contentOffset: { x: 0, y: 200 } } });
    await fireEvent.press(within(list).getByRole('button', { name: '17:40 장소 30' }));
    expect(select).toHaveBeenCalledWith('visit-29');
    await fireEvent.press(screen.getByRole('button', { name: '닫기' }));
    expect(close).toHaveBeenCalledTimes(1);
  } finally { preference.mockRestore(); }
});
