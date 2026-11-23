import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, result, shadows, size, spacing, text } from '../../theme';
import type { DayModel } from '../../result/days';
import { dateChipLabel } from '../../result/format';

/** §7 floating top bar: back, trip name + "기간 · 숙소 지역", 여행 조건 수정. */
export function TopBar({ title, subtitle, back, edit, disabled }: {
  title: string; subtitle: string; back(): void; edit(): void; disabled: boolean;
}) {
  return <View style={styles.bar}>
    <Pressable accessibilityRole="button" accessibilityLabel="뒤로" onPress={back} style={styles.icon}>
      <Text style={text.date}>‹</Text>
    </Pressable>
    <View style={styles.title}>
      <Text accessibilityRole="header" numberOfLines={1} style={text.name}>{title}</Text>
      <Text numberOfLines={1} style={styles.subtitle}>{subtitle}</Text>
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel="여행 조건 수정" accessibilityState={{ disabled }}
      disabled={disabled} onPress={edit} style={styles.icon}>
      <Text style={[text.place, disabled && { color: colors.gray.disabled }]}>⚙</Text>
    </Pressable>
  </View>;
}

/** §7 date chips ("2일 12.4"); the selected chip uses the filter-chip selected style. */
export function DateChips({ days, selected, onSelect }: { days: readonly DayModel[]; selected: string; onSelect(date: string): void }) {
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
    {days.map(day => {
      const active = day.date === selected;
      return <Pressable key={day.date} accessibilityRole="button" accessibilityState={{ selected: active }}
        onPress={() => onSelect(day.date)} style={[styles.chip, active && styles.activeChip]}>
        <Text style={[text.secondary, styles.chipLabel, active && styles.activeLabel]}>{dateChipLabel(day.date, day.number)}</Text>
      </Pressable>;
    })}
  </ScrollView>;
}

const styles = StyleSheet.create({
  bar: { marginTop: result.topBar.top, marginHorizontal: result.topBar.inset, height: result.topBar.height,
    borderRadius: result.topBar.radius, backgroundColor: colors.card, flexDirection: 'row', alignItems: 'center', ...shadows.floating },
  icon: { width: size.back, height: size.touch, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1 },
  subtitle: { ...text.secondary, color: colors.gray.description },
  chips: { gap: result.dateChips.gap, paddingHorizontal: result.dateChips.inset,
    paddingTop: result.dateChips.top - result.topBar.top - result.topBar.height, paddingBottom: spacing.steps[1] },
  chip: { height: result.dateChips.height, borderRadius: result.dateChips.radius, paddingHorizontal: spacing.cardInside,
    justifyContent: 'center', backgroundColor: colors.card, borderWidth: size.focusBorder, borderColor: colors.card, ...shadows.floating },
  activeChip: { backgroundColor: colors.sky.surface, borderColor: colors.sky.primary },
  chipLabel: { color: colors.gray.secondary },
  activeLabel: { color: colors.sky.text, fontFamily: text.place.fontFamily },
});
