import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { colors, radius, result, shadows, size, spacing, text } from '../../theme';
import type { MapRect } from '../../map/types';
import type { Notice } from './use-itinerary';

type Control = 'legend' | 'retry' | 'locate' | 'toast';
type Measured = { inPanel?: boolean; onLayout?(event: LayoutChangeEvent): void };

export function useMapControls(left: number, right: number, notice: Notice | null, retry: boolean) {
  const [frames, setFrames] = useState<Partial<Record<Control, { rect: MapRect; noticeId?: number }>>>({});
  const measure = (id: Control) => (event: LayoutChangeEvent) => {
    const rect = event.nativeEvent.layout;
    const noticeId = id === 'toast' ? notice?.id : undefined;
    setFrames(previous => {
      const entry = previous[id], last = entry?.rect;
      if (entry?.noticeId === noticeId && last && last.x === rect.x && last.y === rect.y
        && last.width === rect.width && last.height === rect.height) return previous;
      return { ...previous, [id]: { rect, noticeId } };
    });
  };
  const active: Control[] = notice ? ['toast', 'locate'] : retry ? ['legend', 'retry', 'locate'] : ['legend', 'locate'];
  const controls = active.flatMap(id => {
    const rect = frames[id]?.rect;
    // Child layout is local to the horizontally safe controls container.
    return rect ? [{ ...rect, x: rect.x + left }] : [];
  });
  const toast = notice && frames.toast?.noticeId === notice.id ? frames.toast.rect : null;
  return { measure, toastHeight: toast?.height ?? 0, overlay: { left, right, controls, awaitingLayout: !!notice && !toast } };
}

/** §6 legend pill above the panel: 이동 · 도보 · 도심 밖 · 희망 N. */
export function Legend({ inPanel, wishes, bottom, onAddWish, onLayout }: Measured & { wishes: number; bottom: number; onAddWish?: () => void }) {
  const count = <Text style={[text.tiny, styles.legendText, wishes > 0 && onAddWish && styles.wishLink]}>
    <Text style={{ color: colors.peach.marker }}>★</Text> 희망 {wishes}
  </Text>;
  return <View testID="map-legend" onLayout={onLayout} style={[styles.legend, { bottom: bottom + spacing.cardGap }, inPanel && styles.inPanel]}>
    <Text style={[text.tiny, styles.legendText]}>
      <Text style={{ color: colors.sky.primary }}>━</Text> 이동 · <Text style={{ color: colors.sky.primary }}>┈</Text> 도보 ·{' '}
      <Text style={{ color: colors.sky.primary }}>⌒</Text> 도심 밖 ·{' '}
    </Text>
    {wishes > 0 ? <Pressable accessibilityRole="button" accessibilityLabel={`희망 장소 추가, ${wishes}곳 중 선택`}
      disabled={!onAddWish} accessibilityState={{ disabled: !onAddWish }} onPress={onAddWish} style={styles.wishButton}>
      {count}
    </Pressable> : count}
  </View>;
}

/** §7 current-location button: 56 above the panel, right 12, white circle 44. */
export function LocateButton({ inPanel, bottom, offset, onPress, onLayout }: Measured & { bottom: number; offset: number; onPress(): void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel="현재 위치" onPress={onPress} onLayout={onLayout}
    style={[styles.locate, { bottom: bottom + offset }, inPanel && styles.inPanel]}>
    <Text style={[text.place, { color: colors.sky.primary }]}>◎</Text>
  </Pressable>;
}

/** Shapes are optional; after a failed request legs are straight lines until this retries. */
export function ShapeRetry({ inPanel, bottom, onPress, onLayout }: Measured & { bottom: number; onPress(): void }) {
  return <Pressable accessibilityRole="button" onPress={onPress} onLayout={onLayout}
    style={[styles.retry, { bottom: bottom + result.locate.offset }, inPanel && styles.inPanel]}>
    <Text style={[text.tiny, styles.legendText]}>경로 모양 다시 불러오기</Text>
  </Pressable>;
}

/** §5 toast right above the panel: icon tile, one line (+ moved places), gray "되돌리기". */
export function Toast({ inPanel, notice, bottom, onUndo, onClose, onLayout, wide }: Measured & { wide: boolean; notice: Notice; bottom: number; onUndo(): void; onClose(): void }) {
  return <View accessibilityLiveRegion="polite" testID="result-toast" onLayout={onLayout} style={[styles.toast, wide && styles.wideToast, { bottom: bottom + spacing.cardGap }, inPanel && [styles.inPanel, styles.panelToast]]}>
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
  legend: { ...floating, left: result.locate.inset, flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.cardGap, minHeight: size.touch, borderRadius: radius.chip },
  wishButton: { minHeight: size.touch, minWidth: size.touch, justifyContent: 'center' },
  wishLink: { color: colors.sky.text, textDecorationLine: 'underline' },
  legendText: { color: colors.gray.secondary },
  locate: { ...floating, right: result.locate.inset, width: result.locate.size, height: result.locate.size,
    borderRadius: result.locate.size / 2, alignItems: 'center', justifyContent: 'center' },
  retry: { ...floating, left: result.locate.inset, minHeight: size.touch, justifyContent: 'center',
    paddingHorizontal: spacing.cardGap, borderRadius: radius.chip },
  toast: { position: 'absolute', left: result.locate.inset, right: result.locate.inset, flexDirection: 'row', alignItems: 'center',
    gap: spacing.cardGap, padding: spacing.cardGap, borderRadius: radius.toast, backgroundColor: colors.card, ...shadows.toast },
  // A short landscape map needs an open side for the airport notice and location control.
  inPanel: { position: 'relative', left: 0, right: 0, bottom: 0 },
  panelToast: { width: '100%' },
  wideToast: { right: undefined, width: '50%' },
  tile: { width: size.iconTile, height: size.iconTile, borderRadius: radius.tile, backgroundColor: colors.green.surface,
    alignItems: 'center', justifyContent: 'center' },
  message: { flex: 1 },
  detail: { color: colors.gray.description },
  undo: { minHeight: size.touch, paddingHorizontal: spacing.cardGap, borderRadius: radius.small,
    backgroundColor: colors.gray.button, justifyContent: 'center' },
  undoLabel: { color: colors.gray.secondary },
});
