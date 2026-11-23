import { useState, type ReactNode } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View, type LayoutChangeEvent } from 'react-native';
import type { LegEdit } from '@travel/core/contracts/results/model';
import type { ResultMap } from '../../map/provider';
import { ActionButton } from '../../components/action-button';
import { colors, layout, radius, result, shadows, size, spacing, text } from '../../theme';
import { pagerState } from '../../map/selection';
import type { CardModel, DayModel } from '../../result/days';
import { dateTitle, durationLabel, timeRange } from '../../result/format';
import { CardRow, PlaceCard } from './place-cards';
import { ConflictActions, EmptyDay, FailureBlock, PreviousBadge, type ConflictStatus } from './panel-states';

export type PanelStatus =
  | { kind: 'READY' }
  | { kind: 'CALCULATING' }
  | ConflictStatus
  | { kind: 'FAILED'; message: string; hasPrevious: boolean }
  | { kind: 'PREVIOUS' };

export type PanelActions = {
  onIndex(index: number): void; onSchedule(): void; onEdit(card: CardModel): void; onSwap(card: CardModel): void;
  onReleaseMode(leg: LegEdit): void; onAddWish(): void; onShowPrevious(): void; onRetry(): void; onRevert(): void; onEditConditions(): void;
};

function summary(day: DayModel) {
  const window = day.start && day.end ? `${timeRange(day.start, day.end, day.timeZone)} · ` : '';
  const placed = day.cards.filter(card => card.start).length;
  return `${window}장소 ${placed}곳 · 이동 ${durationLabel(day.travelMinutes)}`;
}

function CalculationSummary({ label }: { label: string }) {
  return <View accessibilityLiveRegion="polite" style={styles.inline}>
    <ActivityIndicator color={colors.sky.primary} />
    <Text style={styles.summary}>{label}</Text>
  </View>;
}

/** The content of the panel never determines how much of the map it covers. */
export function usePanelLayout(topInset = 0) {
  const window = useWindowDimensions();
  const [parentHeight, setParentHeight] = useState<number | null>(null);
  const height = parentHeight ?? window.height;
  const target = height * result.panel.ratio;
  // On short parents keep the date chips and the current-location button in separate touch regions.
  const available = height - topInset - result.locate.offset - result.locate.size;
  const panelHeight = topInset ? Math.min(target, Math.max(size.touch, available)) : target;
  return { panelHeight, onLayout: (event: LayoutChangeEvent) => setParentHeight(event.nativeEvent.layout.height) };
}

function PanelFrame({ id, height, page, children }: { id: string; height: number; page?: string; children: ReactNode }) {
  const safe = useSafeAreaInsets();
  return <View testID={id} style={[styles.panel, { height }]}>
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.handle} />
    <ScrollView key={page} testID={id + '-scroll'} style={styles.scroll} directionalLockEnabled
      contentInsetAdjustmentBehavior="never" contentContainerStyle={[styles.content, {
        paddingLeft: safe.left, paddingRight: safe.right, paddingBottom: safe.bottom + spacing.section,
      }]}>
      {children}
    </ScrollView>
  </View>;
}

/** No completed day, place cards or legs are available before the first successful generation. */
export function InitialResult({ map: Map, back, failure }: {
  map: ResultMap; back(): void; failure?: { message: string; retry(): void; editConditions(): void };
}) {
  const { panelHeight, onLayout } = usePanelLayout();
  return <View style={layout.screen} onLayout={onLayout}>
    <Map markers={[]} routes={[]} selectedId={null} focusDate={null} focusIds={[]} topInset={0} bottomInset={panelHeight}
      dimmed={false} locateRequest={0} onSelectMarker={() => {}} />
    <PanelFrame id="initial-place-panel" height={panelHeight}>
      <View style={styles.dateRow}>
        <View style={styles.flex}>
          <Text accessibilityRole="header" style={text.title}>동선 만들기</Text>
          {!failure && <CalculationSummary label="동선을 만드는 중" />}
        </View>
      </View>
      {failure && <FailureBlock message={failure.message} onRetry={failure.retry} onEditConditions={failure.editConditions} />}
      <ActionButton label="저장한 여행 보기" secondary onPress={back} />
    </PanelFrame>
  </View>;
}

function DateRow({ day, status, onSchedule }: { day: DayModel; status: PanelStatus; onSchedule(): void }) {
  return <View style={styles.dateRow}>
    <View style={styles.flex}>
      <Text accessibilityRole="header" style={text.title}>{dateTitle(day.date)}</Text>
      {status.kind === 'CALCULATING' ? <CalculationSummary label="다시 계산 중" /> : status.kind === 'CONFLICT' ? <Text accessibilityRole="alert" style={[styles.summary, styles.conflict]}>
        ⚠ 고정 조건 충돌 {status.count}건
      </Text> : <Text style={styles.summary}>{summary(day)}</Text>}
    </View>
    {(status.kind !== 'FAILED' || status.hasPrevious) &&
      <Pressable accessibilityRole="button" accessibilityLabel="전체 일정" onPress={onSchedule} style={styles.textButton}>
        <Text style={[text.secondary, styles.link]}>☰ 전체 일정</Text>
      </Pressable>}
  </View>;
}

function Pager({ index, count, disabled, onIndex, onEdit }: {
  index: number; count: number; disabled: boolean; onIndex(index: number): void; onEdit(): void;
}) {
  const pager = pagerState(index, count);
  const arrow = (label: string, glyph: string, enabled: boolean, target: number) =>
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !enabled }}
      disabled={!enabled} onPress={() => onIndex(target)} style={styles.arrow}>
      <Text style={[text.title, { color: enabled ? colors.gray.secondary : result.pager.disabled }]}>{glyph}</Text>
    </Pressable>;
  return <View style={styles.pager}>
    {arrow('이전 장소', '‹', pager.previous, index - 1)}
    <Text style={text.secondary}><Text style={styles.position}>{pager.position}</Text> / {pager.count}</Text>
    {arrow('다음 장소', '›', pager.next, index + 1)}
    <View style={styles.flex} />
    <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onEdit}
      style={[styles.edit, disabled && styles.editDisabled]}>
      <Text style={[text.secondary, { color: disabled ? colors.gray.disabled : colors.gray.secondary }]}>이 장소 수정</Text>
    </Pressable>
  </View>;
}

/** §7 fixed place panel. The handle is decorative because the panel height does not change by dragging. */
export function PlacePanel({ day, index, status, currency, freeTime, canAddWish, height, actions }: {
  day: DayModel; index: number; status: PanelStatus; currency: string | null; freeTime: string; canAddWish: boolean;
  height: number; actions: PanelActions;
}) {
  const busy = status.kind === 'CALCULATING';
  const interactive = status.kind === 'READY';
  const selected = day.cards[index] ?? null;
  return <PanelFrame id="place-panel" height={height} page={day.date}>
    <DateRow day={day} status={status} onSchedule={actions.onSchedule} />
    {status.kind === 'PREVIOUS' && <PreviousBadge onRetry={actions.onRetry} />}
    {status.kind === 'FAILED' ? <FailureBlock message={status.message}
      onShowPrevious={status.hasPrevious ? actions.onShowPrevious : undefined} onRetry={actions.onRetry} />
      : day.cards.length === 0 ? (status.kind === 'CONFLICT'
        ? <ConflictActions status={status} onEdit={actions.onEdit} onReleaseMode={actions.onReleaseMode}
          onRevert={actions.onRevert} onEditConditions={actions.onEditConditions} />
        : <EmptyDay freeTime={freeTime} canAddWish={canAddWish && interactive} onAddWish={actions.onAddWish} />)
      : <>
        <View testID="place-card-row" style={busy && { opacity: result.overlay.busy }} pointerEvents={busy ? 'none' : 'auto'}>
          <CardRow cards={day.cards} index={index} onIndex={actions.onIndex}>
            {(card, position) => <PlaceCard card={card} selected={position === index} zone={day.timeZone} currency={currency}
              interactive={interactive} onSelect={() => actions.onIndex(position)} onSwap={actions.onSwap} />}
          </CardRow>
        </View>
        {status.kind === 'CONFLICT'
          ? <ConflictActions status={status} onEdit={actions.onEdit} onReleaseMode={actions.onReleaseMode}
            onRevert={actions.onRevert} onEditConditions={actions.onEditConditions} />
          : <Pager index={index} count={day.cards.length} disabled={!interactive || !selected?.start}
            onIndex={actions.onIndex} onEdit={() => { if (selected) actions.onEdit(selected); }} />}
      </>}
  </PanelFrame>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  panel: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.card,
    borderTopLeftRadius: radius.panel, borderTopRightRadius: radius.panel, ...shadows.panel },
  scroll: { flex: 1 },
  content: { gap: spacing.cardGap, paddingTop: spacing.cardGap },
  handle: { alignSelf: 'center', marginTop: spacing.steps[1], width: size.handle.width, height: size.handle.height,
    borderRadius: radius.small, backgroundColor: colors.gray.line },
  dateRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.screen, gap: spacing.steps[1] },
  inline: { flexDirection: 'row', alignItems: 'center', gap: spacing.steps[1] },
  summary: { ...text.secondary, color: colors.gray.description },
  conflict: { color: colors.red.text },
  textButton: { minHeight: size.touch, justifyContent: 'center' },
  link: { color: colors.sky.text, fontFamily: text.place.fontFamily },
  pager: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.screen, gap: spacing.steps[1] },
  arrow: { width: size.touch, height: size.touch, alignItems: 'center', justifyContent: 'center' },
  position: { fontFamily: text.place.fontFamily, color: colors.gray.text },
  edit: { minHeight: size.touch, paddingHorizontal: spacing.cardInside, justifyContent: 'center',
    borderRadius: result.pager.editRadius, backgroundColor: colors.gray.button },
  editDisabled: { backgroundColor: colors.gray.disabledButton },
});
