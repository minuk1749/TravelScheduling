'use client';
import { mealSlotsForCount } from '../../scheduler';
import { countForSlots, mealCounts, mealLabels, tripDates } from '../../settings/input';
import type { LivingSettings, MealCount, SettingsSnapshot } from '../../settings/model';
import { errorProps, FieldError, FieldRow, FormCard } from '../form-rows';

const errorId = (key: string) => `settings-error-${key.replaceAll('.', '-')}`;

export function SettingsFields({ settings, snapshot, errors = {}, onChange }: {
  settings: LivingSettings; snapshot: SettingsSnapshot; errors?: Record<string, string>; onChange(settings: LivingSettings): void;
}) {
  const set = <K extends keyof LivingSettings>(key: K, value: LivingSettings[K]) => onChange({ ...settings, [key]: value });
  const dayMap = new Map(settings.days.map(day => [day.date, day]));
  const dayIndex = new Map(settings.days.map((day, i) => [day.date, i]));
  const changeDay = (date: string, patch: Partial<LivingSettings['days'][number]>) => {
    const day = { date, departureTime: null, returnTime: null, mealSlots: null, ...dayMap.get(date), ...patch };
    set('days', [...settings.days.filter(row => row.date !== date), day].sort((a, b) => a.date.localeCompare(b.date)));
  };
  const row = (key: string) => ({ error: errors[key], errorId: errorId(key) });
  const control = (key: string) => errorProps(errors[key], errorId(key));
  const dayKey = (date: string, field: string) => `days.${dayIndex.get(date) ?? -1}.${field}`;
  const countOptions = mealCounts.map(count => <option key={count} value={count}>{count}끼{count ? ` · ${mealSlotsForCount(count).map(slot => mealLabels[slot]).join('·')}` : ' · 식사 없음'}</option>);
  return <>
    <FormCard title="하루 생활">
      <FieldRow icon="clock" label="기본 나가는 시각" {...row('departureTime')}><input type="time" value={settings.departureTime} {...control('departureTime')} onChange={e => set('departureTime', e.target.value)} /></FieldRow>
      <FieldRow icon="clock" label="기본 들어오는 시각" {...row('returnTime')}><input type="time" value={settings.returnTime} {...control('returnTime')} onChange={e => set('returnTime', e.target.value)} /></FieldRow>
      <FieldRow icon="meal" label="기본 끼니 수" {...row('mealSlots')}><select value={countForSlots(settings.mealSlots)} {...control('mealSlots')} onChange={e => set('mealSlots', mealSlotsForCount(Number(e.target.value) as MealCount))}>{countOptions}</select></FieldRow>
    </FormCard>
    <FormCard title="식사 시간대">
      {Object.entries(mealLabels).map(([key, label]) => {
        const slot = key as keyof typeof mealLabels, pairKey = `mealWindows.${slot}`;
        return <div key={slot}>
          <div className="field-pair">{(['start', 'end'] as const).map(edge => {
            const edgeKey = `${pairKey}.${edge}`, hasError = errors[edgeKey] ?? errors[pairKey];
            return <FieldRow key={edge} icon="meal" label={`${label} ${edge === 'start' ? '시작' : '종료'}`} {...row(edgeKey)}><input type="time" value={settings.mealWindows[slot][edge]} {...errorProps(hasError, errors[edgeKey] ? errorId(edgeKey) : errorId(pairKey))} onChange={e => set('mealWindows', { ...settings.mealWindows, [slot]: { ...settings.mealWindows[slot], [edge]: e.target.value } })} /></FieldRow>;
          })}</div>
          {errors[pairKey] && <FieldError id={errorId(pairKey)} message={errors[pairKey]} />}
        </div>;
      })}
    </FormCard>
    <FormCard title="날짜별 변경">
      {tripDates(snapshot.startDate, snapshot.endDate).map(date => {
        const day = dayMap.get(date), departure = dayKey(date, 'departureTime'), back = dayKey(date, 'returnTime'), meals = dayKey(date, 'mealSlots');
        return <div className="form-entry" key={date} aria-label={`${date} 설정`} role="group">
          <div className="form-entry-head"><h4>{date}</h4><button type="button" className="secondary small" aria-label={`${date} 기본값으로 되돌리기`} onClick={() => set('days', settings.days.filter(row => row.date !== date))}>기본값으로 되돌리기</button></div>
          <FieldRow icon="clock" label={`${date} 나가는 시각`} note={`기본 ${settings.departureTime}`} {...row(departure)}><input type="time" value={day?.departureTime ?? ''} {...errorProps(errors[departure] ?? errors[date], errors[departure] ? errorId(departure) : errorId(date))} onChange={e => changeDay(date, { departureTime: e.target.value || null })} /></FieldRow>
          <FieldRow icon="clock" label={`${date} 들어오는 시각`} note={`기본 ${settings.returnTime}`} {...row(back)}><input type="time" value={day?.returnTime ?? ''} {...errorProps(errors[back] ?? errors[date], errors[back] ? errorId(back) : errorId(date))} onChange={e => changeDay(date, { returnTime: e.target.value || null })} /></FieldRow>
          <FieldRow icon="meal" label={`${date} 끼니 수`} {...row(meals)}><select value={day?.mealSlots == null ? 'inherit' : countForSlots(day.mealSlots)} {...control(meals)} onChange={e => changeDay(date, { mealSlots: e.target.value === 'inherit' ? null : mealSlotsForCount(Number(e.target.value) as MealCount) })}><option value="inherit">기본값 사용 ({countForSlots(settings.mealSlots)}끼)</option>{countOptions}</select></FieldRow>
          {errors[date] && <FieldError id={errorId(date)} message={errors[date]} />}
        </div>;
      })}
    </FormCard>
    <FormCard title="이동">
      <FieldRow icon="car" label="택시 정책" {...row('taxiPolicy')}><select value={settings.taxiPolicy} {...control('taxiPolicy')} onChange={e => set('taxiPolicy', e.target.value as LivingSettings['taxiPolicy'])}><option value="NEVER">사용 안 함</option><option value="WHEN_NEEDED">필요할 때만</option><option value="PREFER">선호</option></select></FieldRow>
    </FormCard>
  </>;
}
