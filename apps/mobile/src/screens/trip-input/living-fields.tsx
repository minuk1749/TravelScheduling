import { useState } from 'react';
import { Text, View } from 'react-native';
import { mealSlotsForCount, type MealSlot } from '@travel/core/scheduler';
import { countForSlots, mealCounts, mealLabels, parseSettings, tripDates } from '@travel/core/contracts/settings/input';
import type { LivingSettings, MealCount, SettingsContext } from '@travel/core/contracts/settings/model';
import { ActionButton } from '../../components/action-button';
import { Choice, EditField, SmallButton, type Errors, type FocusRequest } from '../../components/input/fields';
import { FormCard, FormError, FormSheet, form } from '../../components/input/form-layout';
import { text } from '../../theme';
import { fieldErrors, taxiLabels } from './presentation';

type Period = Pick<SettingsContext, 'startDate' | 'endDate' | 'timeZone'>;
type Day = LivingSettings['days'][number];
const mealOptions = mealCounts.map(count => ({ value: count, label: `${count}끼` }));
const slots = Object.keys(mealLabels) as MealSlot[];

export function datesIn(period: Period) {
  try { return tripDates(period.startDate, period.endDate); } catch { return []; }
}

export function TaxiFields({ value, onChange }: { value: LivingSettings['taxiPolicy']; onChange(value: LivingSettings['taxiPolicy']): void }) {
  const options = (Object.keys(taxiLabels) as (keyof typeof taxiLabels)[]).map(value => ({ value, label: taxiLabels[value] }));
  return <><Text style={text.body}>택시 정책</Text><Choice options={options} value={value} onChange={onChange} /></>;
}

export function LivingFields({ settings, period, flights, errors, focus, onChange }: {
  settings: LivingSettings; period: Period; flights: SettingsContext['flights']; errors: Errors; focus?: FocusRequest;
  onChange(settings: LivingSettings, field: string): void;
}) {
  const [editingDay, setEditingDay] = useState<string | null>(null);
  const overrides = new Map(settings.days.map(day => [day.date, day]));
  const dates = datesIn(period);
  const selectedDay = editingDay && dates.includes(editingDay) ? editingDay : null;
  return <FormCard title="하루 생활">
    <View style={form.row}>{(['departureTime', 'returnTime'] as const).map((name, index) => <View key={name} style={form.flex}>
      <EditField name={name} errors={errors} focus={focus} label={index ? '기본 귀가 시각' : '기본 외출 시각'}
        placeholder="HH:mm" inputMode="text" maxLength={5} value={settings[name]}
        onChangeText={value => onChange({ ...settings, [name]: value }, name)} />
    </View>)}</View>
    <Text style={text.body}>기본 끼니 수</Text>
    <MealChoice mealSlots={settings.mealSlots} change={mealSlots => onChange({ ...settings, mealSlots }, 'mealSlots')} />
    {slots.map(slot => <View key={slot} style={form.stack}>
      <View style={form.row}>{(['start', 'end'] as const).map(edge => {
        const name = `mealWindows.${slot}.${edge}`;
        return <View key={edge} style={form.flex}><EditField name={name} focus={focus} errors={errors}
          label={`${mealLabels[slot]} ${edge === 'start' ? '시작' : '종료'}`} placeholder="HH:mm"
          maxLength={5} value={settings.mealWindows[slot][edge]} onChangeText={value =>
            onChange({ ...settings, mealWindows: { ...settings.mealWindows, [slot]: { ...settings.mealWindows[slot], [edge]: value } } }, name)} />
        </View>;
      })}</View>
      <FormError message={errors[`mealWindows.${slot}`]} />
    </View>)}
    <Text style={text.body}>날짜별 변경</Text>
    {dates.map(date => {
      const day = overrides.get(date);
      return <View key={date} style={form.stack}>
        <View style={form.row}>
          <View style={form.flex}>
            <Text style={text.place}>{date}</Text>
            <Text style={form.secondary}>{day
              ? `${day.departureTime ?? settings.departureTime}–${day.returnTime ?? settings.returnTime} · ${countForSlots(day.mealSlots ?? settings.mealSlots)}끼`
              : '기본값 사용'}</Text>
          </View>
          <SmallButton label={`${date} 수정`} onPress={() => setEditingDay(date)} />
        </View>
        <FormError message={errors[date]} />
      </View>;
    })}
    {dates.length > 0 && settings.days.filter(day => !dates.includes(day.date)).map(day => <View key={day.date} style={form.row}>
      <View style={form.flex}><FormError message={`${day.date} · 여행 기간 밖의 설정이에요.`} /></View>
      <SmallButton label={`${day.date} 설정 삭제`} onPress={() =>
        onChange({ ...settings, days: settings.days.filter(row => row.date !== day.date) }, 'days')} />
    </View>)}
    {selectedDay && <DaySheet key={selectedDay} date={selectedDay} current={overrides.get(selectedDay)} settings={settings}
      period={period} flights={flights} close={() => setEditingDay(null)} save={days => {
        onChange({ ...settings, days }, selectedDay);
        setEditingDay(null);
      }} />}
  </FormCard>;
}

function MealChoice({ mealSlots, change }: { mealSlots: MealSlot[]; change(value: MealSlot[]): void }) {
  return <Choice<MealCount> options={mealOptions} value={countForSlots(mealSlots)} onChange={count => change(mealSlotsForCount(count))} />;
}

function DaySheet({ date, current, settings, period, flights, close, save }: {
  date: string; current?: Day; settings: LivingSettings; period: Period; flights: SettingsContext['flights'];
  close(): void; save(days: Day[]): void;
}) {
  const [day, setDay] = useState<Day>(current ?? { date, departureTime: null, returnTime: null, mealSlots: null });
  const [errors, setErrors] = useState<Errors>({});
  const [focus, setFocus] = useState<FocusRequest>();
  const others = settings.days.filter(row => row.date !== date);
  const arrival = flights.find(flight => flight.direction === 'ARRIVAL' && flight.localDateTime.slice(0, 10) === date);
  function apply() {
    const days = [...others, day].sort((a, b) => a.date.localeCompare(b.date));
    try { save(parseSettings({ ...settings, days }, period).days); }
    catch (error) {
      const messages = fieldErrors(error);
      const key = `days.${days.indexOf(day)}`;
      setErrors({
        departureTime: messages[`${key}.departureTime`],
        returnTime: messages[`${key}.returnTime`] ?? messages[date],
        general: Object.entries(messages).find(([field]) => !field.startsWith(`${key}.`) && field !== date)?.[1] ?? '',
      });
      if (messages[`${key}.departureTime`] || messages[`${key}.returnTime`] || messages[date]) {
        setFocus({ field: messages[`${key}.departureTime`] ? 'departureTime' : 'returnTime' });
      }
    }
  }
  return <FormSheet title={`${date} 하루 생활`} close={close} footer={<>
    <View style={form.flex}><ActionButton label="기본값으로" secondary onPress={() => save(others)} /></View>
    <View style={{ flex: 2 }}><ActionButton label="저장" onPress={apply} /></View>
  </>}>
    {arrival && <Text style={text.body}>✈ 도착 {arrival.localDateTime.slice(11, 16)} · 입국 {arrival.bufferMinutes}분</Text>}
    {(['departureTime', 'returnTime'] as const).map((name, index) =>
      <EditField key={name} name={name} label={index ? '이날 귀가 시각' : '이날 외출 시각'}
        errors={errors} focus={focus} maxLength={5} placeholder={`기본 ${settings[name]}`}
        value={day[name] ?? ''} onChangeText={value => { setErrors({}); setDay({ ...day, [name]: value || null }); }} />)}
    <Text style={text.body}>이날 끼니 수</Text>
    <MealChoice mealSlots={day.mealSlots ?? settings.mealSlots} change={mealSlots => setDay({ ...day, mealSlots })} />
    <FormError message={errors.general} />
  </FormSheet>;
}
