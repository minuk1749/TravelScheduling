import { useEffect, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { colors, motion, radius, spacing, size } from '../../theme';
import { useReducedMotion } from '../../theme/use-reduced-motion';

export function Skeleton() {
  const reduced = useReducedMotion();
  const [opacity] = useState(() => new Animated.Value(1));
  useEffect(() => {
    const phase = motion.skeleton.duration / 2;
    const cycle = Animated.loop(Animated.sequence([
      Animated.timing(opacity, { toValue: reduced ? 0.75 : 0.5, duration: phase, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: phase, useNativeDriver: true }),
    ]));
    cycle.start();
    return () => cycle.stop();
  }, [opacity, reduced]);
  return <Animated.View accessible accessibilityLabel="검색 중" accessibilityRole="progressbar" style={[styles.rows, { opacity }]}>
    {[1, 2, 3].map(row => <View key={row} style={styles.bar} />)}
  </Animated.View>;
}

const styles = StyleSheet.create({
  rows: { gap: spacing.cardGap },
  bar: { height: size.iconTile, borderRadius: radius.small, backgroundColor: colors.gray.disabledButton },
});
