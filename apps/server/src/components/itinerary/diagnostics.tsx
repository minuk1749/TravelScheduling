import type { ItineraryDisplayResult, ResultDisplayView } from '../../results/model';
import { MEALS, minutes, REASONS, visitName } from '../../results/presentation';
export function Diagnostics({ result, view, readOnly = false }: { result: ItineraryDisplayResult; view: ResultDisplayView; readOnly?: boolean }) {
  return <section aria-label="동선 검증 결과"><h2>{result.status === 'OK' ? '일정을 만들었습니다' : result.status === 'OVER_CAPACITY' ? '필수 장소가 너무 많습니다' : '고정 항목이나 이동 조건에 충돌이 있습니다'}</h2>
    {result.status === 'OVER_CAPACITY' && <p>추천 최대 필수 개수 {result.capacity.recommendation?.requiredCount}개: 실제 배치에 성공한 조합의 개수이며 최적값은 아닙니다. 다른 조합은 다시 검증해야 합니다.</p>}
    <p>가용 {minutes(result.capacity.time.availableMinutes)} · 필요 시간 하한 {minutes(result.capacity.time.requiredMinutesLowerBound)}</p>
    {result.status === 'CONFLICT' && <p role="alert">고정 제약을 자동으로 바꾸지 않았습니다. {readOnly ? '소유자의 일정 수정이 필요합니다.' : '날짜·시각·순서·이동수단 또는 생활 설정을 조정해 주세요.'}</p>}
    {!result.verification.verified && <p role="alert">실제 출발 시각의 이동시간 검증을 완료하지 못했습니다.</p>}
    {!!result.openingHoursUnknown?.length && <p>영업시간을 확인하지 못한 장소(방문 전 확인 필요): {result.openingHoursUnknown.map(id => visitName(view, id)).join(', ')}</p>}
    <ul>{result.capacity.unplaced.map(v => <li key={v.visitId}>{visitName(view, v.visitId)}: {REASONS[v.reason]}{v.fixed && ' (고정)'}</li>)}
      {result.capacity.issues.map((issue, i) => <li key={`issue-${i}`}>{issue.date}: {REASONS[issue.reason]}{'slot' in issue && ` (${MEALS[issue.slot]})`}</li>)}
      {result.transferIssues.map((issue, i) => <li key={`transfer-${i}`}>{issue.date}: {REASONS[issue.reason]}</li>)}
      {result.flightConflicts.map((issue, i) => <li key={`flight-${i}`}>{issue.date}: 입국 완료와 출국 이동 시각 충돌</li>)}
      {result.skippedMeals.map((meal, i) => <li key={`meal-${i}`}>{meal.date}: 항공 일정으로 {MEALS[meal.slot]} 생략</li>)}
    </ul>
  </section>;
}
