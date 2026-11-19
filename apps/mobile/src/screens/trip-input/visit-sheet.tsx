import { useState } from 'react';
import { Text, View } from 'react-native';
import { parseFixedVisit } from '@travel/core/contracts/results/fixed-visit';
import { parseTripDraft, visitDurationMinutes, type TripDraft } from '@travel/core/contracts/trips/input';
import { ActionButton } from '../../components/action-button';
import { Choice, EditField, SmallButton, Toggle, type Errors, type FocusRequest } from '../../components/input/fields';
import { FormError, FormSheet, form } from '../../components/input/form-layout';
import { PlaceCredits } from '../../components/input/place-search';
import { text } from '../../theme';
import { datesIn } from './living-fields';
import { fieldErrors, kindLabels } from './presentation';
import type { DraftVisit } from './draft';

export function VisitSheet({ trip, selected, current, save, remove, close }: {
  trip: TripDraft; selected: DraftVisit; current: DraftVisit[]; save(visit: DraftVisit): void;
  remove?: () => void; close(): void;
}) {
  const [visit, setVisit] = useState(selected);
  const [fixDate, setFixDate] = useState(selected.fixedDate !== null);
  const [fixTime, setFixTime] = useState(selected.fixedTime !== null);
  const [fixOrder, setFixOrder] = useState(selected.fixedOrder !== null);
  const [time, setTime] = useState(selected.fixedTime ?? '');
  const [order, setOrder] = useState(selected.fixedOrder === null ? '' : String(selected.fixedOrder + 1));
  const [minutes, setMinutes] = useState(String(selected.minutes));
  const [errors, setErrors] = useState<Errors>({});
  const [focus, setFocus] = useState<FocusRequest>();
  const dates = datesIn(trip);
  const wish = visit.priority === 'WISH';
  function update<K extends keyof DraftVisit>(key: K, value: DraftVisit[K]) {
    setVisit({ ...visit, [key]: value });
    setErrors({});
  }
  function apply() {
    const next = { ...visit, minutes: Number(minutes) };
    const rows = current.some(row => row.googlePlaceId === visit.googlePlaceId)
      ? current.map(row => row.googlePlaceId === visit.googlePlaceId ? next : row) : [...current, next];
    const index = rows.indexOf(next);
    try {
      parseTripDraft({ ...trip, visits: rows });
      const fixed = parseFixedVisit({
        fixedDate: !wish && fixDate ? visit.fixedDate ?? '' : null,
        fixedTime: !wish && fixTime ? time : null,
        fixedOrder: !wish && fixOrder ? Number(order) - 1 : null,
      }, trip, rows.length);
      save({ ...next, ...fixed });
    } catch (error) {
      const messages = fieldErrors(error);
      setErrors({ ...messages, minutes: messages[`visits.${index}.minutes`] });
      const field = ['minutes', 'fixedTime', 'fixedOrder'].find(name => messages[name] || messages[`visits.${index}.${name}`]);
      if (field) setFocus({ field });
    }
  }
  function step(delta: number) {
    setErrors({});
    const { min, max } = visitDurationMinutes;
    setMinutes(String(Math.min(max, Math.max(min, (Number(minutes) || 0) + delta))));
  }
  return <FormSheet title="장소 설정" close={close} footer={<>
    <View style={form.flex}>{remove ? <ActionButton label="삭제" secondary onPress={remove} />
      : <ActionButton label="취소" secondary onPress={close} />}</View>
    <View style={{ flex: 2 }}><ActionButton label="저장" onPress={apply} /></View>
  </>}>
    <Text style={text.place}>{visit.place.name}</Text>
    <PlaceCredits place={visit.place} />
    <Text style={form.secondary}>Google Maps</Text>
    <Choice options={[{ value: 'REQUIRED', label: '필수' }, { value: 'WISH', label: '☆ 희망 · 지도에만 표시' }]}
      value={visit.priority} onChange={priority => update('priority', priority)} />
    <Choice options={[{ value: 'ATTRACTION', label: kindLabels.ATTRACTION }, { value: 'RESTAURANT', label: kindLabels.RESTAURANT }]}
      value={visit.kind} onChange={kind => update('kind', kind)} />
    <View style={form.row}>
      <SmallButton label="−15분" onPress={() => step(-15)} />
      <View style={form.flex}><EditField name="minutes" label="체류시간 (분)" errors={errors} focus={focus}
        inputMode="numeric" value={minutes} onChangeText={value => { setErrors({}); setMinutes(value); }} /></View>
      <SmallButton label="+15분" onPress={() => step(15)} />
    </View>
    <Toggle label="날짜 고정" value={!wish && fixDate} disabled={wish} onChange={value => { setFixDate(value); setErrors({}); }} />
    {!wish && fixDate && <Choice options={dates.map(date => ({ value: date, label: date }))}
      value={visit.fixedDate ?? ''} onChange={value => update('fixedDate', value)} />}
    <FormError message={errors.fixedDate} />
    <Toggle label="시각 고정" value={!wish && fixTime} disabled={wish} onChange={value => { setFixTime(value); setErrors({}); }} />
    {!wish && fixTime && <EditField name="fixedTime" label="고정 시각" errors={errors} focus={focus}
      placeholder="HH:mm" maxLength={5} value={time} onChangeText={value => { setErrors({}); setTime(value); }} />}
    <Toggle label="순서 고정" value={!wish && fixOrder} disabled={wish} onChange={value => { setFixOrder(value); setErrors({}); }} />
    {!wish && fixOrder && <EditField name="fixedOrder" label="고정 순서 (1부터)" errors={errors} focus={focus}
      inputMode="numeric" value={order} onChangeText={value => { setErrors({}); setOrder(value); }} />}
    <FormError message={errors.visits} />
  </FormSheet>;
}
