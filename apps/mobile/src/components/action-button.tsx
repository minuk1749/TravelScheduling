import { useState } from 'react';
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text } from 'react-native';
import { colors, motion, radius, size, spacing, text } from '../theme';
import { useReducedMotion } from '../theme/use-reduced-motion';

export function ActionButton({ label, busy = false, disabled = false, secondary = false, onPress }: {
  label: string; busy?: boolean; disabled?: boolean; secondary?: boolean; onPress(): void;
}) {
  const [scale] = useState(() => new Animated.Value(1));
  const reduced = useReducedMotion();
  const unavailable = busy || disabled;
  const animate = (toValue: number) => Animated.timing(scale, {
    toValue: reduced ? 1 : toValue, duration: motion.press.duration, useNativeDriver: true,
  }).start();
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: unavailable, busy }}
        disabled={unavailable} onPress={onPress} onPressIn={() => animate(motion.press.scale)} onPressOut={() => animate(1)}
        style={[styles.button, secondary && styles.secondary, unavailable && styles.disabled]}>
        {busy && <ActivityIndicator color={colors.gray.disabled} />}
        <Text style={[styles.label, secondary && styles.secondaryLabel, unavailable && styles.disabledLabel]}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: size.button, borderRadius: radius.button, backgroundColor: colors.sky.primary,
    paddingHorizontal: spacing.cardInside, paddingVertical: spacing.steps[1],
    alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: spacing.steps[1] },
  secondary: { backgroundColor: colors.card }, disabled: { backgroundColor: colors.gray.disabledButton },
  label: { ...text.place, color: colors.card }, secondaryLabel: { color: colors.gray.secondary },
  disabledLabel: { color: colors.gray.disabled },
});
