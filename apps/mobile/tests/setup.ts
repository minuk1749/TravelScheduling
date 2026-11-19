import mockSafeAreaContext from 'react-native-safe-area-context/jest/mock';
import { Animated } from 'react-native';

jest.mock('react-native-safe-area-context', () => mockSafeAreaContext);
// Complete native-driver animations deterministically in the JS renderer.
jest.spyOn(Animated, 'timing').mockImplementation((value, config) => ({
  start: complete => {
    if (!(value instanceof Animated.Value) || typeof config.toValue !== 'number') {
      throw new Error('The native animation fixture expects a scalar value');
    }
    value.setValue(config.toValue);
    complete?.({ finished: true });
  },
  stop() {}, reset() {},
}));
// A repeating animation stays mounted while its loading state is rendered.
jest.spyOn(Animated, 'loop').mockReturnValue({ start() {}, stop() {}, reset() {} });
