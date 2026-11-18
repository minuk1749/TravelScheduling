import type { LegComparison } from '../../services/itinerary/types';
import type { Constraints, ItineraryDisplayResult, ResultDisplayView } from '../../results/model';
import { displayedSchedule, localDateTime, localTime, MEALS, MODES, money, minutes, placeName, visitName } from '../../results/presentation';

function LegCard({ leg, view, constraints, change, currency }: { currency: string | null; leg: LegComparison; view: ResultDisplayView; constraints?: Constraints; change?: (next: Constraints) => void }) {
  const fixed = constraints?.legModes.find(l => l.date === leg.date && l.from === leg.from && l.to === leg.to);
  const label = `${leg.date} ${placeName(view, leg.from)} → ${placeName(view, leg.to)}`;
  return <article className="result-leg"><h4>{placeName(view, leg.from)} → {placeName(view, leg.to)}</h4>
    <p>{localDateTime(leg.departure, view.input.timeZone)} 출발 · {MODES[leg.selected.mode]} {minutes(leg.selected.minutes)}{leg.selected.fixed && ' · 수단 고정'}</p>
    <dl className="result-comparison">{(['TRANSIT', 'TAXI', 'WALK'] as const).map(mode => <div key={mode}><dt>{MODES[mode]}</dt><dd>{leg.alternatives[mode] ? `${minutes(leg.alternatives[mode]!.minutes)} · ${money(leg.alternatives[mode]!.fare, currency)}` : '경로 없음'}</dd></div>)}</dl>
    {constraints && change && <label>{label} 이동수단<select value={fixed?.mode ?? ''} onChange={event => {
      const rest = constraints.legModes.filter(l => !(l.date === leg.date && l.from === leg.from && l.to === leg.to));
      const mode = event.target.value;
      change({ ...constraints, legModes: mode === 'TRANSIT' || mode === 'TAXI' || mode === 'WALK' ? [...rest, { date: leg.date, from: leg.from, to: leg.to, mode }] : rest });
    }}><option value="">정책에 따라 자동</option>{Object.entries(MODES).map(([mode, name]) => <option key={mode} value={mode}>{name}</option>)}</select></label>}
  </article>;
}

export function Timeline({ result, view, constraints, change }: { result: ItineraryDisplayResult; view: ResultDisplayView; constraints?: Constraints; change?: (next: Constraints) => void }) {
  const schedule = displayedSchedule(result);
  if (!schedule) return null;
  return <section aria-label="날짜별 타임라인"><h2>날짜별 타임라인</h2>{result.status === 'OVER_CAPACITY' && <p>아래 일정은 추천 조합의 미리보기입니다.{change && ' 필수 장소를 선택하고 재검증하세요.'}</p>}
    {schedule.days.map(day => {
      const stops = day.stops.map((stop, index) => ({ at: stop.start, key: `stop-${index}`, node: <p className="result-stop">{localTime(stop.start, day.timeZone)}–{localTime(stop.end, day.timeZone)} <strong>{stop.kind === 'VISIT' ? visitName(view, stop.visitId) : `${MEALS[stop.slot]} 식사`}</strong></p> }));
      const legs = result.comparisons.filter(l => l.date === day.date).map((leg, index) => ({ at: leg.departure, key: `leg-${index}`, node: <LegCard leg={leg} view={view} currency={result.efficiency?.currency ?? null} constraints={constraints} change={change} /> }));
      return <section className="result-day" key={day.date}><h3>{day.date}</h3>{[...stops, ...legs].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).map(item => <div key={item.key}>{item.node}</div>)}{!stops.length && !legs.length && <p>일정 없음</p>}</section>;
    })}
  </section>;
}
export function Efficiency({ result }: { result: ItineraryDisplayResult }) {
  const summary = result.efficiency;
  if (!summary) return null;
  return <section className="profile-card" aria-label="여행 전체 효율"><h2>여행 전체 이동 비교</h2><p>같은 구간의 대중교통·도보 기준과 선택 경로를 비교합니다. 요금은 추정치입니다.</p><dl>
    <dt>대중교통·도보 기준</dt><dd>{minutes(summary.transitMinutes)} · {money(summary.transitFare, summary.currency)}</dd>
    <dt>선택한 이동수단</dt><dd>{minutes(summary.selectedMinutes)} · {money(summary.selectedFare, summary.currency)}</dd>
  </dl></section>;
}
