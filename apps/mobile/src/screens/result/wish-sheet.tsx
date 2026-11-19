import { useState } from 'react';
import { Text, View } from 'react-native';
import { ActionButton } from '../../components/action-button';
import { Choice } from '../../components/input/fields';
import { FormSheet, form } from '../../components/input/form-layout';
import { text } from '../../theme';
import type { DayModel } from '../../result/days';
import { dayNumberLabel } from '../../result/format';
import { dayOptions } from './edit-sheet';

export type Wish = { visitId: string; name: string };

/**
 * 3-4: add a wish place to a date ("N일차에 추가하고 다시 계산"). Opened from a wish marker the
 * place is fixed; from an empty day ("희망 장소에서 추가") the date is preset and a wish is chosen.
 */
export function WishSheet({ wishes, visitId, date, days, close, apply }: {
  wishes: readonly Wish[]; visitId: string | null; date: string; days: readonly DayModel[];
  close(): void; apply(visitId: string, date: string): void;
}) {
  const [chosen, setChosen] = useState(visitId ?? wishes[0]?.visitId ?? '');
  const [target, setTarget] = useState(date);
  const fixed = wishes.find(wish => wish.visitId === visitId);
  const number = days.find(day => day.date === target)?.number ?? 1;
  return <FormSheet title={fixed ? `★ ${fixed.name}` : '희망 장소 추가'} close={close} footer={<>
    <View style={form.flex}><ActionButton label="취소" secondary onPress={close} /></View>
    <View style={{ flex: 2 }}><ActionButton label={`${dayNumberLabel(number)}에 추가하고 다시 계산`} disabled={!chosen}
      onPress={() => apply(chosen, target)} /></View>
  </>}>
    {!fixed && <>
      <Text style={text.place}>희망 장소</Text>
      <Choice value={chosen} options={wishes.map(wish => ({ value: wish.visitId, label: `★ ${wish.name}` }))}
        onChange={value => setChosen(value)} />
    </>}
    <Text style={text.place}>추가할 날짜</Text>
    <Choice value={target} options={dayOptions(days)} onChange={value => setTarget(value)} />
  </FormSheet>;
}
