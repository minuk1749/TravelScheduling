import { StyleSheet, Text, View } from 'react-native';
import { SmallButton } from '../../components/input/fields';
import { FormCard, FormError, form } from '../../components/input/form-layout';
import { colors, radius, size, spacing, text } from '../../theme';

export function SelectionStatus({ maximum, count, failed, messages, jump, busy }: {
  maximum?: number; count: number; failed: boolean; messages: string[]; jump?: () => void; busy: boolean;
}) {
  const over = maximum !== undefined && count > maximum;
  return <FormCard>
    <View style={form.row}>
      <View style={[styles.tile, failed ? styles.errorSurface : styles.warningSurface]}>
        <Text accessible={false} style={[text.place, failed ? styles.errorText : styles.warningText]}>{failed ? '⚠' : '◷'}</Text>
      </View>
      <View style={styles.details}>
        <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={text.place}>
          {failed ? '선택한 장소를 배치할 수 없어요' : '시간이 부족해요'}
        </Text>
        <Text style={text.description}>{failed ? '장소 선택이나 여행 조건을 바꿔 주세요.' : '꼭 방문할 장소를 선택해 주세요.'}</Text>
      </View>
    </View>
    <Text style={text.body}>추천 최대 필수 {maximum === undefined ? '—' : `${maximum}곳 (추정)`}</Text>
    <Text accessibilityLiveRegion="polite" style={[styles.count, over ? styles.over : styles.within]}>
      현재 선택 {count}곳
    </Text>
    {!failed && maximum !== undefined && <Text style={styles.warningText}>{maximum}곳 이하여도 배치되지 않을 수 있어요.</Text>}
    {messages.map(message => <FormError key={message} message={message} />)}
    {jump && <SmallButton label="문제 장소로 이동" disabled={busy} onPress={jump} />}
  </FormCard>;
}

export function FeasibleStatus({ count }: { count: number }) {
  return <FormCard>
    <View style={form.row}>
      <View style={[styles.tile, styles.successSurface]}><Text accessible={false} style={styles.successText}>✓</Text></View>
      <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={[text.place, styles.successText]}>배치 가능</Text>
    </View>
    <Text style={text.body}>선택한 필수 장소 {count}곳을 검증했어요.</Text>
  </FormCard>;
}

const styles = StyleSheet.create({
  tile: { width: size.iconTile, height: size.iconTile, borderRadius: radius.tile, alignItems: 'center', justifyContent: 'center' },
  details: { flex: 1, gap: spacing.steps[0] },
  count: { ...text.place, alignSelf: 'flex-start', borderRadius: radius.small,
    paddingVertical: spacing.steps[0], paddingHorizontal: spacing.steps[1] },
  over: { backgroundColor: colors.amber.surface, color: colors.amber.text },
  within: { backgroundColor: colors.sky.surface, color: colors.sky.text },
  warningSurface: { backgroundColor: colors.amber.surface },
  warningText: { ...text.description, color: colors.amber.text },
  errorSurface: { backgroundColor: colors.red.surface },
  errorText: { color: colors.red.text },
  successSurface: { backgroundColor: colors.green.surface },
  successText: { ...text.place, color: colors.green.text },
});
