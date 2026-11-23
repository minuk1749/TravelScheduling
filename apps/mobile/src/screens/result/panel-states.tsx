import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { LegEdit } from '@travel/core/contracts/results/model';
import { FormSheet } from '../../components/input/form-layout';
import type { ConflictModeFix, ConflictModeFixes } from '../../result/conflicts';
import { dateTitle } from '../../result/format';
import { colors, radius, size, spacing, text } from '../../theme';
import type { CardModel } from '../../result/days';

function Button({ label, onPress, primary = false }: { label: string; onPress(): void; primary?: boolean }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={[styles.button, primary && styles.primary]}>
    <Text style={[text.secondary, styles.buttonLabel, primary && styles.primaryLabel]}>{label}</Text>
  </Pressable>;
}

/** 3-6: no visit on the date; the pager is hidden. */
export function EmptyDay({ freeTime, canAddWish, onAddWish }: { freeTime: string; canAddWish: boolean; onAddWish(): void }) {
  return <View style={styles.block}>
    <Text style={text.name}>배치된 장소 없음</Text>
    <Text style={styles.secondary}>{freeTime}</Text>
    {canAddWish && <View style={styles.row}><Button label="희망 장소에서 추가" onPress={onAddWish} /></View>}
  </View>;
}

/** 3-9: the calculation failed; saved places and fixed conditions remain. */
export function FailureBlock({ message, onShowPrevious, onRetry, onEditConditions }: {
  message: string; onShowPrevious?(): void; onRetry(): void; onEditConditions?(): void;
}) {
  return <View style={styles.block}>
    <Text accessibilityRole="alert" style={text.name}>⚠ 동선을 계산하지 못했어요</Text>
    <Text style={styles.secondary}>입력한 장소와 고정 조건은 그대로 있어요</Text>
    <Text style={[text.tiny, { color: colors.gray.description }]}>{message}</Text>
    <View style={styles.row}>
      {onShowPrevious && <Button label="이전 일정 보기" onPress={onShowPrevious} />}
      {onEditConditions && <Button label="여행 조건 수정" onPress={onEditConditions} />}
      <Button label="다시 계산" primary onPress={onRetry} />
    </View>
  </View>;
}

/** 3-9 with the last result shown: faded map and this mark. */
export function PreviousBadge({ onRetry }: { onRetry?(): void }) {
  return <View style={[styles.row, styles.badgeRow]}>
    <Text accessibilityLiveRegion="polite" style={[text.tiny, styles.badge]}>이전 계산 결과 · 갱신 실패</Text>
    {onRetry && <Button label="다시 계산" onPress={onRetry} />}
  </View>;
}

/** 3-8: fixed places are never moved automatically; offer to edit the cause or undo the change. */
export type ConflictStatus = {
  kind: 'CONFLICT'; count: number; messages: readonly string[]; target: CardModel | null; canUndo: boolean;
  modeFixes: ConflictModeFixes;
};

export function ConflictActions({ status, onEdit, onReleaseMode, onRevert, onEditConditions }: {
  status: ConflictStatus;
  onEdit(card: CardModel): void; onReleaseMode(leg: LegEdit): void; onRevert(): void; onEditConditions(): void;
}) {
  const target = status.target;
  const { matched, review } = status.modeFixes;
  const [reviewOpen, setReviewOpen] = useState(false);
  const releaseButton = ({ fix, label }: ConflictModeFix) =>
    <Button key={JSON.stringify([fix.date, fix.from, fix.to])} label={label}
      onPress={() => { setReviewOpen(false); onReleaseMode(fix); }} />;
  return <View style={styles.block}>
    {status.messages.map(message => <Text key={message} style={[text.tiny, { color: colors.red.text }]}>⚠ {message}</Text>)}
    <Text style={styles.secondary}>고정된 장소는 자동으로 옮기지 않아요</Text>
    <View style={styles.row}>
      {matched.map(releaseButton)}
      {review.length > 0 && <Button label={matched.length ? '같은 날짜의 다른 이동수단 고정 검토' : '이 날짜의 이동수단 고정 검토'}
        onPress={() => setReviewOpen(true)} />}
      {target ? <Button label={`${target.name} 고정 수정`} onPress={() => onEdit(target)} />
        : <Button label="여행 조건 수정" onPress={onEditConditions} />}
      {status.canUndo && <Button label="변경 취소" primary onPress={onRevert} />}
    </View>
    {reviewOpen && review.length > 0 && <FormSheet title={`${dateTitle(review[0].fix.date)} 이동수단 고정`}
      close={() => setReviewOpen(false)} footer={<Button label="취소" onPress={() => setReviewOpen(false)} />}>
      {review.map(releaseButton)}
    </FormSheet>}
  </View>;
}

const styles = StyleSheet.create({
  block: { paddingHorizontal: spacing.screen, gap: spacing.steps[1] },
  secondary: { ...text.secondary, color: colors.gray.secondary },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.steps[1] },
  badgeRow: { paddingHorizontal: spacing.screen, alignItems: 'center' },
  badge: { color: colors.amber.text, backgroundColor: colors.amber.surface, borderRadius: radius.small,
    paddingHorizontal: spacing.steps[1], paddingVertical: spacing.steps[0], overflow: 'hidden' },
  button: { minHeight: size.touch, paddingHorizontal: spacing.cardInside, borderRadius: radius.small,
    backgroundColor: colors.gray.button, justifyContent: 'center' },
  primary: { backgroundColor: colors.sky.primary },
  buttonLabel: { color: colors.gray.secondary },
  primaryLabel: { color: colors.card, fontFamily: text.place.fontFamily },
});
