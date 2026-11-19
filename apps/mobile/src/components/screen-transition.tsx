import { useEffect, useState, type PropsWithChildren } from 'react';
import { Animated, Easing } from 'react-native';
import { layout, motion } from '../theme';
import { useReducedMotion } from '../theme/use-reduced-motion';

export function ScreenTransition({ children }: PropsWithChildren) {
  const [progress] = useState(() => new Animated.Value(0));
  const reduced = useReducedMotion();
  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: 1, duration: motion.screen.duration, easing: Easing.out(Easing.ease), useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [progress]);
  return <Animated.View style={[layout.screen, {
    opacity: progress,
    transform: [{ translateX: reduced ? 0 : progress.interpolate({ inputRange: [0, 1], outputRange: [motion.screen.translateX, 0] }) }],
  }]}>{children}</Animated.View>;
}
