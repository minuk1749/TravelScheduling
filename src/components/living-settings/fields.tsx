'use client';
import { mealSlotsForCount } from '../../scheduler';
import { countForSlots, mealCounts, mealLabels, tripDates } from '../../settings/input';
import type { LivingSettings, MealCount, SettingsSnapshot } from '../../settings/model';

export function SettingsFields({ settings, snapshot, onChange }: { settings: LivingSettings; snapshot: SettingsSnapshot; onChange(settings: LivingSettings): void }) {
  const set = <K extends keyof LivingSettings>(key: K, value: LivingSettings[K]) => onChange({ ...settings, [key]: value });
  const dayMap = new Map(settings.days.map(day => [day.date, day]));
  const changeDay = (date: string, patch: Partial<LivingSettings['days'][number]>) => {
    const day = { date, departureTime: null, returnTime: null, mealSlots: null, ...dayMap.get(date), ...patch };
    set('days', [...settings.days.filter(row => row.date !== date), day].sort((a, b) => a.date.localeCompare(b.date)));
  };
  const countOptions = mealCounts.map(count => <option key={count} value={count}>{count}끼{count ? ` · ${mealSlotsForCount(count).map(slot => mealLabels[slot]).join('·')}` : ' · 식사 없음'}</option>);
  return <>
    <h2>여행 기본 설정</h2>
    <div className="field-grid">
      <label>기본 나가는 시각<input type="time" value={settings.departureTime} onChange={e => set('departureTime', e.target.value)} /></label>
      <label>기본 들어오는 시각<input type="time" value={settings.returnTime} onChange={e => set('returnTime', e.target.value)} /></label>
    </div>
    <label>기본 끼니 수<select value={countForSlots(settings.mealSlots)} onChange={e => set('mealSlots', mealSlotsForCount(Number(e.target.value) as MealCount))}>{countOptions}</select></label>
    <label>택시 정책<select value={settings.taxiPolicy} onChange={e => set('taxiPolicy', e.target.value as LivingSettings['taxiPolicy'])}><option value="NEVER">사용 안 함</option><option value="WHEN_NEEDED">필요할 때만</option><option value="PREFER">선호</option></select></label>
    <h2>식사 시간대</h2>
    <p className="field-hint">여행 전체에 적용합니다. 날짜별 끼니 수에 따라 필요한 시간대만 사용합니다.</p>
    {Object.entries(mealLabels).map(([key, label]) => {
      const slot = key as keyof typeof mealLabels;
      return <div className="field-grid" key={slot}>{(['start', 'end'] as const).map(edge => <label key={edge}>{label} {edge === 'start' ? '시작' : '종료'}<input type="time" value={settings.mealWindows[slot][edge]} onChange={e => set('mealWindows', { ...settings.mealWindows, [slot]: { ...settings.mealWindows[slot], [edge]: e.target.value } })} /></label>)}</div>;
    })}
    <h2>날짜별 설정</h2>
    <p className="field-hint">빈 시각은 기본값을 따릅니다. 0끼는 식사 없음이며 기본값 상속과 다릅니다.</p>
    {tripDates(snapshot.startDate, snapshot.endDate).map(date => {
      const day = dayMap.get(date);
      return <section className="entry" key={date} aria-label={`${date} 설정`}><h3>{date}</h3>
        <div className="field-grid">
          <div><label>{date} 나가는 시각<input type="time" value={day?.departureTime ?? ''} onChange={e => changeDay(date, { departureTime: e.target.value || null })} /></label><small>기본 {settings.departureTime}</small></div>
          <div><label>{date} 들어오는 시각<input type="time" value={day?.returnTime ?? ''} onChange={e => changeDay(date, { returnTime: e.target.value || null })} /></label><small>기본 {settings.returnTime}</small></div>
        </div>
        <label>{date} 끼니 수<select value={day?.mealSlots == null ? 'inherit' : countForSlots(day.mealSlots)} onChange={e => changeDay(date, { mealSlots: e.target.value === 'inherit' ? null : mealSlotsForCount(Number(e.target.value) as MealCount) })}><option value="inherit">기본값 사용 ({countForSlots(settings.mealSlots)}끼)</option>{countOptions}</select></label>
        <button type="button" className="secondary" onClick={() => set('days', settings.days.filter(row => row.date !== date))}>{date} 기본값으로 되돌리기</button>
      </section>;
    })}
  </>;
}
