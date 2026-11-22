import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ResultView, VisitEdit } from '@travel/core/contracts/results/model';
import { localTime } from '@travel/core/presentation';
import { ActionButton } from '../../components/action-button';
import { Choice, Field, Toggle } from '../../components/input/fields';
import { FormError, FormSheet, form } from '../../components/input/form-layout';
import { colors, size, spacing, text } from '../../theme';
import type { CardModel, DayModel } from '../../result/days';
import { asWish, fixedVisitError } from '../../result/edits';
import { dayOptionLabel } from '../../result/format';

/** Day chips shared by the edit and wish sheets: "1일차 12.3". */
export const dayOptions = (days: readonly DayModel[]) =>
  days.map(day => ({ value: day.date, label: dayOptionLabel(day.date, day.number) }));

/**
 * 3-3 place edit: date/time/order fixes, visit position and "희망으로 바꾸기". Rules come from the
 * shared `parseFixedVisit`; "적용하고 다시 계산" saves through the existing constraints API.
 */
export function EditSheet({ view, card, day, days, current, close, apply }: {
  view: ResultView; card: CardModel; day: DayModel; days: readonly DayModel[]; current: VisitEdit;
  close(): void; apply(edit: VisitEdit): void;
}) {
  const [draft, setDraft] = useState(current);
  const [wish, setWish] = useState(false);
  const edit = wish ? asWish(draft) : draft;
  const error = fixedVisitError(edit, view.input);
  const update = (value: Partial<VisitEdit>) => setDraft(previous => ({ ...previous, ...value }));
  const start = card.start ? localTime(card.start, day.timeZone) : view.input.activity.start;
  const hasPlacements = days.some(row => row.cards.some(item => item.start !== null));
  const lastPositionOn = (date: string) => {
    if (!hasPlacements) return view.input.visits.length - 1;
    const target = days.find(row => row.date === date);
    return target?.cards.filter(item => item.start !== null && item.visitId !== card.visitId).length ?? 0;
  };
  const lastPosition = lastPositionOn(edit.fixedDate ?? day.date);
  const order = edit.fixedOrder ?? 0;
  const unchanged = JSON.stringify(edit) === JSON.stringify(current);
  return <FormSheet title={card.name} close={close} footer={<>
    <View style={form.flex}><ActionButton label="취소" secondary onPress={close} /></View>
    <View style={styles.primary}><ActionButton label="적용하고 다시 계산" disabled={!!error || unchanged}
      onPress={() => apply(edit)} /></View>
  </>}>
    <Toggle label="날짜 고정" value={edit.fixedDate !== null} disabled={wish}
      onChange={on => update(on ? { fixedDate: day.date } : { fixedDate: null, fixedTime: null, fixedOrder: null })} />
    {edit.fixedDate !== null && <Choice value={edit.fixedDate} options={dayOptions(days)} onChange={fixedDate =>
      update({ fixedDate, fixedOrder: edit.fixedOrder === null ? null : Math.min(edit.fixedOrder, lastPositionOn(fixedDate)) })} />}
    <Toggle label="시각 고정" value={edit.fixedTime !== null} disabled={wish || edit.fixedDate === null}
      onChange={on => update({ fixedTime: on ? start : null })} />
    {edit.fixedTime !== null && <Field label="고정 시각" value={edit.fixedTime} keyboardType="numbers-and-punctuation"
      onChangeText={fixedTime => update({ fixedTime })} />}
    <Toggle label="순서 고정" value={edit.fixedOrder !== null} disabled={wish || edit.fixedDate === null}
      onChange={on => update({ fixedOrder: on ? Math.min((card.number ?? 1) - 1, lastPosition) : null })} />
    {edit.fixedOrder !== null && <View style={styles.stepper}>
      <Text style={text.body}>방문 순서</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="순서 앞당기기" accessibilityState={{ disabled: order <= 0 }}
        disabled={order <= 0} onPress={() => update({ fixedOrder: order - 1 })} style={styles.step}>
        <Text style={text.title}>−</Text>
      </Pressable>
      <Text style={text.place}>{order + 1}번째</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="순서 늦추기" accessibilityState={{ disabled: order >= lastPosition }}
        disabled={order >= lastPosition} onPress={() => update({ fixedOrder: order + 1 })} style={styles.step}>
        <Text style={text.title}>+</Text>
      </Pressable>
    </View>}
    <Toggle label="희망으로 바꾸기" value={wish} onChange={setWish} />
    <FormError message={error} />
  </FormSheet>;
}

const styles = StyleSheet.create({
  primary: { flex: 2 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.steps[1], minHeight: size.touch },
  step: { width: size.touch, height: size.touch, alignItems: 'center', justifyContent: 'center',
    borderRadius: size.touch / 2, backgroundColor: colors.gray.button },
});
