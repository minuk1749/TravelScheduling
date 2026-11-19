import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { VisitEdit } from '@travel/core/contracts/results/model';
import type { PlaceSummary } from '@travel/core/contracts/places';
import { ActionButton } from '../../components/action-button';
import { FormCard, FormError, FormSheet, form } from '../../components/input/form-layout';
import { PlaceCredits } from '../../components/input/place-search';
import { colors, layout, radius, size, spacing, text } from '../../theme';
import { kindLabels } from '../trip-input/presentation';
import { fixedConditions } from './selection';

export type Candidate = {
  visit: VisitEdit; name: string; place: PlaceSummary | null;
  kind: keyof typeof kindLabels; minutes: number; reason?: string;
};

export function Candidates({ title, candidates, busy, toggle }: {
  title: string; candidates: Candidate[]; busy: boolean; toggle(candidate: Candidate): void;
}) {
  return <FormCard title={title}>
    <View testID="capacity-candidates" style={busy && layout.dimmed} accessibilityState={{ busy }}>
      {candidates.map((candidate, index) => <View key={candidate.visit.id}
        style={[styles.row, index + 1 < candidates.length && styles.divider]}>
        <CandidateRow candidate={candidate} busy={busy} toggle={toggle} />
        {candidate.place && <PlaceCredits place={candidate.place} />}
      </View>)}
    </View>
  </FormCard>;
}

function CandidateRow({ candidate, busy, toggle }: {
  candidate: Candidate; busy: boolean; toggle(candidate: Candidate): void;
}) {
  const checked = candidate.visit.priority === 'REQUIRED';
  const conditions = fixedConditions(candidate.visit);
  const priority = checked ? '필수' : '☆ 희망';
  return <Pressable accessibilityRole="checkbox" accessibilityLabel={`${candidate.name} 필수`}
    accessibilityState={{ checked, disabled: busy }} disabled={busy}
    accessibilityHint={[priority, ...conditions, candidate.reason].filter(Boolean).join(' · ')}
    style={styles.selectable} onPress={() => toggle(candidate)}>
    <View style={styles.tile}><Text accessible={false} style={text.place}>{candidate.kind === 'RESTAURANT' ? '♨' : '◇'}</Text></View>
    <View style={styles.details}>
      <Text style={text.place}>{candidate.name}</Text>
      <Text style={form.secondary}>{kindLabels[candidate.kind]} · {candidate.minutes}분</Text>
      <Text style={checked ? text.body : styles.wish}>{priority}</Text>
      {conditions.length > 0 && <Text style={form.secondary}>🔒 {conditions.join(' · ')}</Text>}
      <FormError message={candidate.reason} />
    </View>
    <View style={[styles.circle, checked && styles.checked]}>{checked && <Text accessible={false} style={styles.tick}>✓</Text>}</View>
  </Pressable>;
}

export function RemoveFixedSheet({ candidate, cancel, confirm }: { candidate: Candidate; cancel(): void; confirm(): void }) {
  return <FormSheet title="고정 조건을 해제할까요?" close={cancel} footer={<>
    <View style={form.flex}><ActionButton label="필수로 유지" secondary onPress={cancel} /></View>
    <View style={styles.confirm}><ActionButton label="고정 해제하고 희망으로" onPress={confirm} /></View>
  </>}>
    <Text style={text.place}>{candidate.name}</Text>
    {fixedConditions(candidate.visit).map(condition => <Text key={condition} style={text.body}>🔒 {condition}</Text>)}
  </FormSheet>;
}

const styles = StyleSheet.create({
  row: { paddingVertical: spacing.steps[1], gap: spacing.steps[0] },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.gray.divider },
  selectable: { ...form.row, minHeight: size.touch },
  details: { flex: 1, gap: spacing.steps[0] },
  tile: { width: size.iconTile, height: size.iconTile, borderRadius: radius.tile, backgroundColor: colors.gray.button,
    alignItems: 'center', justifyContent: 'center' },
  wish: { ...text.body, color: colors.peach.text },
  circle: { width: size.checkbox, height: size.checkbox, borderRadius: size.checkbox / 2,
    borderWidth: size.checkboxBorder, borderColor: colors.gray.line, backgroundColor: colors.card,
    justifyContent: 'center', alignItems: 'center' },
  checked: { backgroundColor: colors.sky.primary, borderColor: colors.sky.primary },
  tick: { ...text.place, color: colors.card },
  confirm: { flex: 2 },
});
