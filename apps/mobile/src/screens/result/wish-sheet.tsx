import { useState } from 'react';
import { Text, View } from 'react-native';
import type { TripInputs } from '@travel/core/contracts/itinerary';
import type { VisitEdit } from '@travel/core/contracts/results/model';
import { ActionButton } from '../../components/action-button';
import { Choice } from '../../components/input/fields';
import { FormError, FormSheet, form } from '../../components/input/form-layout';
import { text } from '../../theme';
import type { DayModel } from '../../result/days';
import { fixedVisitError, onDate } from '../../result/edits';
import { dayNumberLabel } from '../../result/format';
import { dayOptions } from './edit-sheet';

export type Wish = { visitId: string; name: string };

/**
 * 3-4: add a wish place to a date ("N일차에 추가하고 다시 계산"). Opened from a wish marker the
 * place is fixed; from an empty day ("희망 장소에서 추가") the date is preset and a wish is chosen.
 */
export function WishSheet({ wishes, current, input, date, days, onChoose, close, apply }: {
  wishes: readonly Wish[]; current: VisitEdit; input: TripInputs; date: string; days: readonly DayModel[];
  onChoose?(visitId: string): void; close(): void; apply(edit: ReturnType<typeof onDate>): void;
}) {
  const [target, setTarget] = useState(date);
  const chosen = wishes.find(wish => wish.visitId === current.id);
  const edit = onDate(current, target);
  const error = fixedVisitError(edit, input);
  const number = days.find(day => day.date === target)?.number ?? 1;
  return <FormSheet title={!onChoose && chosen ? `★ ${chosen.name}` : '희망 장소 추가'} close={close} footer={<>
    <View style={form.flex}><ActionButton label="취소" secondary onPress={close} /></View>
    <View style={{ flex: 2 }}><ActionButton label={`${dayNumberLabel(number)}에 추가하고 다시 계산`} disabled={!chosen || !!error}
      onPress={() => apply(edit)} /></View>
  </>}>
    {onChoose && <>
      <Text style={text.place}>희망 장소</Text>
      <Choice value={current.id} options={wishes.map(wish => ({ value: wish.visitId, label: `★ ${wish.name}` }))}
        onChange={onChoose} />
    </>}
    <Text style={text.place}>추가할 날짜</Text>
    <Choice value={target} options={dayOptions(days)} onChange={value => setTarget(value)} />
    <FormError message={error} />
  </FormSheet>;
}
