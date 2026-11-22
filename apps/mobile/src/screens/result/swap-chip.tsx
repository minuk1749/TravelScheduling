import { Pressable, StyleSheet, Text } from 'react-native';
import type { RouteEstimate, TravelMode } from '@travel/core/scheduler';
import { swapLabel } from '../../result/format';
import { colors, result, size, spacing, text } from '../../theme';

export function SwapChip({ swap, currency, active, onPress }: {
  swap: { mode: TravelMode; estimate: RouteEstimate | null }; currency: string | null; active: boolean; onPress(): void;
}) {
  const label = swapLabel(swap, currency);
  const disabled = !swap.estimate || !active;
  return <Pressable accessibilityRole="button" accessibilityLabel={swap.estimate ? `${label}${swap.mode === 'WALK' ? '으로' : '로'} 바꾸기` : label}
    accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={styles.chipTouch}>
    <Text style={[text.tinyStrong, styles.chip, !swap.estimate && styles.chipDisabled]}>
      {swap.estimate ? '⇄ ' : ''}{label}
    </Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  chipTouch: { minHeight: size.touch, justifyContent: 'center' },
  chip: { height: result.switchChip.height, lineHeight: result.switchChip.height, borderRadius: result.switchChip.height / 2,
    paddingHorizontal: spacing.cardGap, backgroundColor: colors.gray.button, color: colors.gray.secondary, overflow: 'hidden' },
  chipDisabled: { color: colors.gray.disabled },
});
