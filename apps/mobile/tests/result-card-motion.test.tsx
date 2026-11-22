import { Animated } from 'react-native';
import { fireEvent, screen } from 'expo-router/testing-library';
import { motion, result } from '../src/theme';
import { useReducedMotion } from '../src/theme/use-reduced-motion';
import { openResult, resultFixture } from './result-fixture';

jest.mock('../src/theme/use-reduced-motion', () => ({ useReducedMotion: jest.fn() }));

test.each([true, false])('card selection with reduced motion %s keeps the selected card and animates the requested property', async reduced => {
  jest.mocked(useReducedMotion).mockReturnValue(reduced);
  await openResult(resultFixture());
  const timing = jest.mocked(Animated.timing);
  timing.mockClear();
  await fireEvent.press(screen.getByRole('button', { name: '다음 장소' }));
  const transitions = timing.mock.calls.map(([, config]) => config).filter(config => config.duration === motion.panel.duration);
  const destination = -(result.cardRow.width + result.cardRow.gap);
  expect(transitions.map(config => config.toValue)).toContain(reduced ? 1 : destination);
  if (reduced) expect(transitions.map(config => config.toValue)).not.toContain(destination);
  expect(screen.getByRole('button', { name: '지도 아메요코 시장', selected: true })).toBeVisible();
});
