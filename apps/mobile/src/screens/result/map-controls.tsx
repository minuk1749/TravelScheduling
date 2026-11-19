import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, result, shadows, size, spacing, text } from '../../theme';
import type { Notice } from './use-itinerary';

/** §6 legend pill above the panel: 이동 · 도보 · 도심 밖 · 희망 N. */
export function Legend({ wishes, bottom }: { wishes: number; bottom: number }) {
  return <View testID="map-legend" style={[styles.legend, { bottom: bottom + spacing.cardGap }]}>
    <Text style={[text.tiny, styles.legendText]}>
      <Text style={{ color: colors.sky.primary }}>━</Text> 이동 · <Text style={{ color: colors.sky.primary }}>┈</Text> 도보 ·{' '}
      <Text style={{ color: colors.sky.primary }}>⌒</Text> 도심 밖 · <Text style={{ color: colors.peach.marker }}>★</Text> 희망 {wishes}
    </Text>
  </View>;
}

/** §7 current-location button: 56 above the panel, right 12, white circle 44. */
export function LocateButton({ bottom, onPress }: { bottom: number; onPress(): void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel="현재 위치" onPress={onPress}
    style={[styles.locate, { bottom: bottom + result.locate.offset }]}>
    <Text style={[text.place, { color: colors.sky.primary }]}>◎</Text>
  </Pressable>;
}

/** Shapes are optional; after a failed request legs are straight lines until this retries. */
export function ShapeRetry({ bottom, onPress }: { bottom: number; onPress(): void }) {
  return <Pressable accessibilityRole="button" onPress={onPress}
    style={[styles.retry, { bottom: bottom + result.locate.offset }]}>
    <Text style={[text.tiny, styles.legendText]}>경로 모양 다시 불러오기</Text>
  </Pressable>;
}

/** §5 toast right above the panel: icon tile, one line (+ moved places), gray "되돌리기". */
export function Toast({ notice, bottom, onUndo, onClose }: { notice: Notice; bottom: number; onUndo(): void; onClose(): void }) {
  return <View accessibilityLiveRegion="polite" testID="result-toast" style={[styles.toast, { bottom: bottom + spacing.cardGap }]}>
    <View style={styles.tile}><Text style={[text.place, { color: colors.green.text }]}>✓</Text></View>
    <Pressable accessibilityRole="button" accessibilityLabel="알림 닫기" onPress={onClose} style={styles.message}>
      <Text style={text.body}>{notice.title}</Text>
      {notice.detail && <Text style={[text.secondary, styles.detail]}>{notice.detail}</Text>}
    </Pressable>
    {notice.undo && <Pressable accessibilityRole="button" onPress={onUndo} style={styles.undo}>
      <Text style={[text.secondary, styles.undoLabel]}>되돌리기</Text>
    </Pressable>}
  </View>;
}

const floating = { position: 'absolute' as const, backgroundColor: colors.card, ...shadows.floating };
const styles = StyleSheet.create({
  legend: { ...floating, left: result.locate.inset, paddingHorizontal: spacing.cardGap, paddingVertical: spacing.steps[0],
    borderRadius: radius.chip },
  legendText: { color: colors.gray.secondary },
  locate: { ...floating, right: result.locate.inset, width: result.locate.size, height: result.locate.size,
    borderRadius: result.locate.size / 2, alignItems: 'center', justifyContent: 'center' },
  retry: { ...floating, left: result.locate.inset, minHeight: size.touch, justifyContent: 'center',
    paddingHorizontal: spacing.cardGap, borderRadius: radius.chip },
  toast: { position: 'absolute', left: result.locate.inset, right: result.locate.inset, flexDirection: 'row', alignItems: 'center',
    gap: spacing.cardGap, padding: spacing.cardGap, borderRadius: radius.toast, backgroundColor: colors.card, ...shadows.toast },
  tile: { width: size.iconTile, height: size.iconTile, borderRadius: radius.tile, backgroundColor: colors.green.surface,
    alignItems: 'center', justifyContent: 'center' },
  message: { flex: 1 },
  detail: { color: colors.gray.description },
  undo: { minHeight: size.touch, paddingHorizontal: spacing.cardGap, borderRadius: radius.small,
    backgroundColor: colors.gray.button, justifyContent: 'center' },
  undoLabel: { color: colors.gray.secondary },
});
