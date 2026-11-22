import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { localTime } from '@travel/core/presentation';
import { kindLabels } from '../trip-input/presentation';
import { colors, motion, result, spacing, text } from '../../theme';
import { useReducedMotion } from '../../theme/use-reduced-motion';
import { swipeTarget } from '../../map/selection';
import type { CardModel } from '../../result/days';
import { durationLabel, legLabel, shiftLabel, timeRange } from '../../result/format';
import { SwapChip } from './swap-chip';
import { MODE_ICONS } from './icons';

const STRIDE = result.cardRow.width + result.cardRow.gap;

export function cardLabel(card: CardModel, zone: string) {
  if (!card.start || !card.end) return `${card.name}, 배치되지 않음`;
  return `${card.number}번 ${card.name}, ${localTime(card.start, zone)}부터 ${localTime(card.end, zone)}까지`;
}

function ArrivalRows({ card, currency, zone, active, onSwap }: {
  card: CardModel; currency: string | null; zone: string; active: boolean; onSwap(card: CardModel): void;
}) {
  const leg = card.arrival;
  if (!leg) return <Text style={styles.via}>오는 길 정보 없음</Text>;
  const notes = [`오는 길 · ${leg.fromName}`, leg.fixed && '직접 지정', card.wait > 0 && `대기 ${durationLabel(card.wait)}`,
    card.returnAt && `숙소 복귀 ${localTime(card.returnAt, zone)}`].filter(Boolean).join(' · ');
  const swap = leg.swap;
  return <>
    <Text numberOfLines={1} style={styles.via}>{notes}</Text>
    <View style={styles.modeRow}>
      <Text importantForAccessibility="no" style={styles.modeIcon}>{MODE_ICONS[leg.mode]}</Text>
      <Text style={[text.secondary, styles.modeText]} numberOfLines={1}>{legLabel(leg.mode, leg.minutes, leg.fare, currency)}</Text>
      {swap && <SwapChip swap={swap} currency={currency} active={active} onPress={() => onSwap(card)} />}
    </View>
  </>;
}

export function PlaceCard({ card, selected, zone, currency, interactive, onSelect, onSwap }: {
  card: CardModel; selected: boolean; zone: string; currency: string | null; interactive: boolean;
  onSelect(): void; onSwap(card: CardModel): void;
}) {
  const times = card.start && card.end ? timeRange(card.start, card.end, zone) : '배치되지 않음';
  const shift = shiftLabel(card.shift);
  return <View testID={`place-card-${card.visitId}`} style={[styles.card, selected && styles.selected]}>
    <Pressable accessibilityRole="button" accessibilityLabel={cardLabel(card, zone)} accessibilityState={{ selected }} onPress={onSelect}>
      <View style={styles.nameRow}>
        <View style={[styles.number, card.issue && styles.issueNumber]}>
          <Text style={[text.tinyStrong, { color: colors.card }]}>{card.number ?? '!'}</Text>
        </View>
        <Text numberOfLines={1} style={[text.name, styles.flex]}>{card.name}</Text>
      </View>
      <Text numberOfLines={1} style={[text.secondary, styles.detail]}>
        <Text style={[styles.strong, card.changed && styles.changed]}>{times}</Text>
        {` · ${kindLabels[card.kind]} · ${durationLabel(card.stay)}`}
        {shift ? <Text style={[styles.strong, styles.changed]}>{` · ${shift}`}</Text> : null}
      </Text>
      {card.issue ? <Text numberOfLines={1} style={[text.tiny, styles.issue]}>⚠ {card.issue}</Text>
        : <Text numberOfLines={1} style={[text.tiny, styles.fixed]}>{card.fixed ? `🔒 ${card.fixed}` : ' '}</Text>}
    </Pressable>
    <View style={styles.divider} />
    {card.start ? <ArrivalRows card={card} currency={currency} zone={zone} active={selected && interactive} onSwap={onSwap} />
      : <Text style={styles.via}>이동 정보 없음</Text>}
    {!selected && <Pressable testID="place-card-veil" accessible={false} importantForAccessibility="no-hide-descendants"
      onPress={onSelect} style={styles.veil} />}
  </View>;
}

/**
 * §7 card row: cards 300 wide with a 12 gap, snapped to the left inset. Swipes use the release
 * velocity; reduced motion changes the selection in place and fades the new card in.
 */
export function CardRow({ cards, index, onIndex, children }: {
  cards: readonly CardModel[]; index: number; onIndex(index: number): void;
  children(card: CardModel, position: number): ReactNode;
}) {
  const reduced = useReducedMotion();
  const [offset] = useState(() => new Animated.Value(-index * STRIDE));
  const [opacity] = useState(() => new Animated.Value(1));
  const lastIndex = useRef(index);
  const count = cards.length;
  useEffect(() => {
    const toValue = -index * STRIDE;
    const changed = index !== lastIndex.current;
    lastIndex.current = index;
    if (!changed || reduced) offset.setValue(toValue);
    if (!changed) { opacity.setValue(1); return; }
    if (reduced) opacity.setValue(0);
    else opacity.setValue(1);
    const animation = Animated.timing(reduced ? opacity : offset, {
      toValue: reduced ? 1 : toValue, duration: motion.panel.duration,
      easing: Easing.bezier(...motion.panel.bezier), useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [index, offset, opacity, reduced]);
  const responder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > spacing.steps[1] && Math.abs(gesture.dx) > Math.abs(gesture.dy),
    onPanResponderMove: (_, gesture) => { if (!reduced) offset.setValue(-index * STRIDE + gesture.dx); },
    onPanResponderRelease: (_, gesture) => {
      const target = swipeTarget(index, gesture.dx, gesture.vx, count, STRIDE);
      if (target !== index) onIndex(target);
      else if (!reduced) Animated.timing(offset, { toValue: -index * STRIDE, duration: motion.panel.duration,
        easing: Easing.bezier(...motion.panel.bezier), useNativeDriver: true }).start();
    },
    onPanResponderTerminate: () => offset.setValue(-index * STRIDE),
  }), [index, count, onIndex, offset, reduced]);
  return <View style={styles.viewport} {...responder.panHandlers}>
    <Animated.View testID="place-cards" style={[styles.track, { opacity, transform: [{ translateX: offset }] }]}>
      {cards.map((card, position) => <View key={card.visitId}>{children(card, position)}</View>)}
    </Animated.View>
  </View>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  viewport: { overflow: 'hidden' },
  track: { flexDirection: 'row', gap: result.cardRow.gap, paddingHorizontal: result.cardRow.inset },
  card: { width: result.cardRow.width, padding: result.card.padding, borderRadius: result.card.radius,
    backgroundColor: result.card.surface, borderWidth: result.card.border, borderColor: result.card.surface, gap: spacing.steps[0] },
  selected: { borderColor: colors.sky.primary },
  veil: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, borderRadius: result.card.radius, backgroundColor: colors.card, opacity: result.overlay.unselected },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.steps[1] },
  number: { width: result.number.size, height: result.number.size, borderRadius: result.number.size / 2,
    backgroundColor: colors.sky.primary, alignItems: 'center', justifyContent: 'center' },
  issueNumber: { backgroundColor: colors.red.text },
  detail: { color: colors.gray.description, marginTop: spacing.steps[0] },
  strong: { fontFamily: text.place.fontFamily, color: colors.gray.secondary },
  changed: { color: colors.sky.text },
  fixed: { color: colors.gray.secondary, marginTop: spacing.steps[0] },
  issue: { color: colors.red.text, marginTop: spacing.steps[0] },
  divider: { height: result.card.dividerWidth, backgroundColor: result.card.divider, marginVertical: spacing.steps[1] },
  via: { ...text.tiny, color: colors.gray.description },
  modeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.steps[1] },
  modeIcon: { ...text.secondary, color: colors.sky.primary },
  modeText: { flex: 1 },
});
