import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ResultView } from '@travel/core/contracts/results/model';
import { PlaceCredits } from '../../components/input/place-search';
import type { EfficiencySummary } from '@travel/core/contracts/itinerary';
import { localTime, MEALS } from '@travel/core/presentation';
import { FormSheet } from '../../components/input/form-layout';
import { colors, radius, size, spacing, text } from '../../theme';
import type { DayModel, LegModel, TimelineRow } from '../../result/days';
import { dateTitle, durationLabel, legLabel, moneyLabel, timeRange } from '../../result/format';
import { kindLabels } from '../trip-input/presentation';
import { SwapChip } from './swap-chip';
import { ENDPOINT_ICONS, ENDPOINT_LABELS, MODE_ICONS } from './icons';

const COMPARED_MODES = ['TRANSIT', 'TAXI', 'WALK'] as const;

function Row({ row, zone, currency, select, onSwap }: {
  row: TimelineRow; zone: string; currency: string | null; select(visitId: string): void; onSwap?(leg: LegModel, mode: LegModel['mode']): void;
}) {
  const time = <Text style={styles.time}>{localTime(row.at, zone)}</Text>;
  if (row.kind === 'LEG') {
    const { leg } = row;
    return <View testID={'schedule-leg-' + leg.key} style={styles.row}>
      <View style={[styles.tile, { backgroundColor: leg.color }]}><Text style={[text.tinyStrong, styles.tileText]}>{leg.order}</Text></View>
      <Text importantForAccessibility="no" style={[text.secondary, { color: leg.color }]}>{MODE_ICONS[leg.mode]}</Text>
      <View style={styles.flex}>
        <Text style={text.secondary}>{timeRange(leg.departure, leg.arrival, zone)}</Text>
        <Text style={text.secondary}>{leg.fromName} → {leg.toName}</Text>
        <Text style={styles.move}>{legLabel(leg.mode, leg.minutes, leg.fare, currency)}{leg.outside ? ' · 도심 밖' : ''}</Text>
        <View style={styles.alternatives}>
          {COMPARED_MODES.filter(mode => mode !== leg.mode && (mode !== 'WALK' || leg.alternatives.WALK)).map(mode =>
            <SwapChip key={mode} swap={{ mode, estimate: leg.alternatives[mode] ?? null }} currency={currency}
              active={!!onSwap} onPress={() => onSwap?.(leg, mode)} />)}
        </View>
      </View>
    </View>;
  }
  if (row.kind === 'ENDPOINT') {
    return <View style={styles.row}>{time}
      <Text style={text.body}>{ENDPOINT_ICONS[row.role]} {ENDPOINT_LABELS[row.role]} · {row.name}</Text>
    </View>;
  }
  if (row.kind === 'MEAL') return <View style={styles.row}>{time}<Text style={text.body}>{MEALS[row.slot]} 식사</Text></View>;
  const { card } = row;
  return <Pressable accessibilityRole="button" accessibilityLabel={`${localTime(row.at, zone)} ${card.name}`}
    onPress={() => select(card.visitId)} style={styles.row}>
    {time}
    <View style={styles.flex}>
      <Text style={text.place}>{card.name}</Text>
      <Text style={styles.move}>{kindLabels[card.kind]} · {durationLabel(card.stay)}{card.fixed ? ` · 🔒 ${card.fixed}` : ''}</Text>
    </View>
  </Pressable>;
}

/** Trip-wide efficiency: the transit/walk-only baseline against the selected modes (T12 summary). */
export function EfficiencyRows({ summary, estimated }: { summary: EfficiencySummary; estimated: boolean }) {
  const total = (minutes: number | null) => minutes === null ? '시간 —' : durationLabel(minutes);
  const saved = summary.transitMinutes !== null ? Math.ceil(summary.transitMinutes) - Math.ceil(summary.selectedMinutes) : null;
  return <View testID="trip-efficiency" style={styles.efficiency}>
    <Text accessibilityRole="header" style={text.place}>여행 전체 이동</Text>
    <Text style={text.secondary}>대중교통·도보만 · {total(summary.transitMinutes)} · {moneyLabel(summary.transitFare, summary.currency)}</Text>
    <Text style={text.secondary}>선택한 이동 · {total(summary.selectedMinutes)} · {moneyLabel(summary.selectedFare, summary.currency, estimated)}</Text>
    {saved !== null && saved > 0 && <Text style={[text.secondary, styles.saved]}>{durationLabel(saved)} 단축</Text>}
  </View>;
}

/** 3-2: the whole day as one list; pressing a place closes the sheet and selects its card. */
export function ScheduleSheet({ day, places, currency, efficiency, estimated, close, select, onSwap }: {
  day: DayModel; places: ResultView['places']; currency: string | null; efficiency: EfficiencySummary | null; estimated: boolean;
  close(): void; select(visitId: string): void; onSwap?(leg: LegModel, mode: LegModel['mode']): void;
}) {
  const placeIds = new Set([...day.cards.map(card => card.placeId), ...day.legs.flatMap(leg => [leg.from, leg.to])]);
  return <FormSheet title={`${dateTitle(day.date)} 전체 일정`} close={close}>
    {day.rows.length === 0 && <Text style={text.body}>배치된 장소 없음</Text>}
    {day.rows.map((row, index) => <Row key={index} row={row} zone={day.timeZone} currency={currency} select={select} onSwap={onSwap} />)}
    {efficiency && <EfficiencyRows summary={efficiency} estimated={estimated} />}
    <Text style={text.secondary}>장소 정보 · Google Maps</Text>
    {[...placeIds].map(id => {
      const place = places[id];
      return place?.attributions.length ? <View key={id}>
        <Text style={text.secondary}>{place.name}</Text>
        <PlaceCredits place={place} />
      </View> : null;
    })}
  </FormSheet>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  alternatives: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.cardGap },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.cardGap, minHeight: size.touch },
  time: { ...text.secondary, width: size.iconTile + spacing.cardGap, color: colors.gray.secondary },
  tile: { width: size.iconTile, height: size.iconTile / 2, borderRadius: radius.small, alignItems: 'center', justifyContent: 'center' },
  tileText: { color: colors.card },
  move: { ...text.secondary, color: colors.gray.description, flexShrink: 1 },
  efficiency: { gap: spacing.steps[0], paddingTop: spacing.cardGap, borderTopWidth: 1, borderTopColor: colors.gray.divider },
  saved: { color: colors.sky.text },
});
