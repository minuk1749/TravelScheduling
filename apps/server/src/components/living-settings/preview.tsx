import { Temporal } from '@js-temporal/polyfill';
import { mealLabels } from '../../settings/input';
import type { SettingsCalculation, SettingsSnapshot } from '../../settings/model';
export function SettingsPreview({ calculation, snapshot }: { calculation: SettingsCalculation; snapshot: SettingsSnapshot }) {
  const local = (instant: string) => Temporal.Instant.from(instant).toZonedDateTimeISO(snapshot.timeZone).toPlainTime().toString({ smallestUnit: 'minute' });
  const range = (window: { start: string; end: string } | null) => window ? `${local(window.start)}–${local(window.end)}` : '가능한 시간 없음';
  return <section aria-label="시간창 재계산 결과" aria-live="polite">
    <h2>시간창 미리보기</h2>
    <p className="field-hint">활동·식사 시간과 공항 버퍼를 반영합니다. 저장하면 공항 이동시간·영업시간·이동수단을 포함한 전체 동선을 별도로 재계산합니다. 충돌이 없어도 일정 배치를 보장하지 않습니다.</p>
    {calculation.conflicts.length > 0 && <div className="form-errors" role="alert"><h3>설정 충돌</h3><p>고정 항목은 이동하거나 해제하지 않았습니다. 설정을 조정해 주세요.</p><ul>{calculation.conflicts.map((conflict, i) => <li key={i}>{conflict.date ?? '날짜 미지정'} · {conflict.visitId && `고정 장소 ${conflict.visitId} · `}{conflict.message}</li>)}</ul></div>}
    {calculation.days.map(day => <div className="entry" key={day.date}><h3>{day.date}</h3><p>활동 가능 시간: {range(day.result.available)}</p><ul>{day.result.meals.map(meal => <li key={meal.slot}>{mealLabels[meal.slot]}: {range(meal.window)}</li>)}</ul>{day.result.meals.length === 0 && <p>식사 없음</p>}</div>)}
  </section>;
}
