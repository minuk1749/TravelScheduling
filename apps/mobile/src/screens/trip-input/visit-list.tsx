import { StyleSheet, Text, View } from 'react-native';
import { FormCard, form } from '../../components/input/form-layout';
import { Choice, SmallButton } from '../../components/input/fields';
import { PlaceCredits } from '../../components/input/place-search';
import { colors, radius, size, spacing, text } from '../../theme';
import type { DraftVisit } from './draft';
import { kindLabels } from './presentation';

type Filter = DraftVisit['kind'] | 'ALL';

export function VisitList({ visits, filter, onFilter, edit }: {
  visits: DraftVisit[]; filter: Filter; onFilter(value: Filter): void; edit?: (visit: DraftVisit) => void;
}) {
  const attractions = visits.filter(visit => visit.kind === 'ATTRACTION').length;
  const filtered = filter === 'ALL' ? visits : visits.filter(visit => visit.kind === filter);
  return <>
    <Choice<Filter> value={filter} onChange={onFilter} options={[
      { value: 'ALL', label: `전체 ${visits.length}` },
      { value: 'ATTRACTION', label: `명소 ${attractions}` },
      { value: 'RESTAURANT', label: `식당 ${visits.length - attractions}` },
    ]} />
    <FormCard>
      {filtered.length === 0 && <Text style={text.body}>{visits.length ? '이 유형으로 추가한 장소가 없어요' : '추가한 장소가 없어요'}</Text>}
      {filtered.map((visit, index) => <View key={visit.googlePlaceId} style={[styles.row, index + 1 < filtered.length && styles.divider]}>
        <View style={styles.icon}><Text accessible={false} style={text.place}>{visit.kind === 'RESTAURANT' ? '♨' : '◇'}</Text></View>
        <View style={styles.details}>
          <Text style={text.place}>{visit.place.name}</Text>
          <Text style={form.secondary}>{kindLabels[visit.kind]} · {visit.minutes}분</Text>
          {visit.priority === 'WISH' ? <Text style={styles.wish}>☆ 희망 · 지도에만 표시</Text> : <Text style={text.body}>필수</Text>}
          {visit.fixedDate && <Text style={form.secondary}>🔒 고정 · {visit.fixedDate}
            {visit.fixedTime && ` ${visit.fixedTime}`}
            {visit.fixedOrder !== null && ` · ${visit.fixedOrder + 1}번째`}</Text>}
          <PlaceCredits place={visit.place} />
        </View>
        {edit && <SmallButton label={`${visit.place.name} 설정`} onPress={() => edit(visit)} />}
      </View>)}
      {filtered.length > 0 && <Text style={form.secondary}>Google Maps</Text>}
    </FormCard>
  </>;
}

export function VisitCounts({ visits }: { visits: readonly DraftVisit[] }) {
  const required = visits.filter(visit => visit.priority === 'REQUIRED').length;
  return <Text style={text.body}>필수 {required}곳 · 희망 {visits.length - required}곳</Text>;
}

const styles = StyleSheet.create({
  row: { ...form.row, alignItems: 'flex-start', paddingBottom: spacing.steps[1] },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.gray.divider },
  icon: { width: size.iconTile, height: size.iconTile, borderRadius: radius.tile, backgroundColor: colors.gray.button,
    alignItems: 'center', justifyContent: 'center' },
  details: { flex: 1, gap: spacing.steps[0] },
  wish: { ...text.body, color: colors.peach.text },
});
