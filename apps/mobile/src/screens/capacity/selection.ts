import type { ItineraryResult } from '@travel/core/contracts/itinerary';
import type { ResultView, VisitEdit } from '@travel/core/contracts/results/model';
import { MEALS, REASONS, placeName } from '@travel/core/presentation';

export function fixedConditions(visit: VisitEdit) {
  const conditions: string[] = [];
  if (visit.fixedDate !== null) conditions.push(`날짜 고정 · ${visit.fixedDate}`);
  if (visit.fixedTime !== null) conditions.push(`시각 고정 · ${visit.fixedTime}`);
  if (visit.fixedOrder !== null) conditions.push(`순서 고정 · ${visit.fixedOrder + 1}번째`);
  return conditions;
}

export function selectionIssues(result: ItineraryResult, view: ResultView) {
  const byVisit = new Map<string, string>(result.capacity.unplaced
    .filter(({ reason }) => reason !== 'WISH')
    .map(({ visitId, reason }) => [visitId, REASONS[reason]]));
  const byPlace = new Map<string, string>();
  const general = new Set<string>();

  for (const issue of result.capacity.issues) {
    const reason = REASONS[issue.reason];
    if (issue.reason === 'UNREACHABLE') {
      byPlace.set(issue.from, reason);
      byPlace.set(issue.to, reason);
      general.add(`${issue.date} · ${placeName(view, issue.from)} → ${placeName(view, issue.to)} · ${reason}`);
    } else {
      general.add([issue.date, reason, 'slot' in issue ? MEALS[issue.slot] : null].filter(Boolean).join(' · '));
    }
  }
  for (const visit of view.input.visits) {
    const reason = byPlace.get(visit.place.id);
    if (reason && !byVisit.has(visit.id) && (visit.priority === 'REQUIRED' || visit.fixedDate)) byVisit.set(visit.id, reason);
  }
  for (const issue of result.transferIssues) {
    general.add(`${issue.date} · ${placeName(view, issue.from)} → ${placeName(view, issue.to)} · ${REASONS[issue.reason]}`);
  }
  for (const issue of result.flightConflicts) general.add(`${issue.date} · 입국 완료와 출국 이동 시각 충돌`);
  if (!result.verification.verified) general.add('실제 출발 시각의 이동시간을 확인하지 못했어요.');

  return { byVisit, general: [...general] };
}
