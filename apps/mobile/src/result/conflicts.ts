import type { ItineraryResult } from '@travel/core/contracts/itinerary';
import type { LegEdit, ResultView } from '@travel/core/contracts/results/model';
import { MEALS, MODES, placeName, REASONS } from '@travel/core/presentation';
import { sameModeConstraint } from './edits';

/** One line of "고정 조건 충돌 N건": a visit that could not be placed, or a day/leg-level problem. */
export type ConflictCause = {
  visitId: string | null;
  date: string | null;
  message: string;
  /** The leg drawn as a red curve on the map. */
  leg: { date: string; from: string; to: string } | null;
};

const route = (view: ResultView, from: string, to: string) => `${placeName(view, from)} → ${placeName(view, to)}`;

/** 3-8 causes in display order: fixed visits first, then other visits, day issues, airport and flight issues. */
export function conflictCauses(view: ResultView, result: ItineraryResult | null): ConflictCause[] {
  if (!result || result.status !== 'CONFLICT') return [];
  const visits = new Map(view.input.visits.map(visit => [visit.id, visit]));
  const unplaced = result.capacity.unplaced.filter(visit => visit.reason !== 'WISH')
    .sort((a, b) => Number(b.fixed) - Number(a.fixed));
  const causes: ConflictCause[] = unplaced.map(visit => ({
    visitId: visit.visitId, date: visits.get(visit.visitId)?.fixedDate ?? null, message: REASONS[visit.reason], leg: null,
  }));
  for (const issue of result.capacity.issues) {
    if (issue.reason === 'UNREACHABLE') {
      causes.push({ visitId: null, date: issue.date, message: `${route(view, issue.from, issue.to)} · ${REASONS.UNREACHABLE}`,
        leg: { date: issue.date, from: issue.from, to: issue.to } });
    } else {
      const meal = issue.reason === 'MEAL_UNAVAILABLE' ? `${MEALS[issue.slot]} · ` : '';
      causes.push({ visitId: null, date: issue.date, message: `${meal}${REASONS[issue.reason]}`, leg: null });
    }
  }
  for (const issue of result.transferIssues) {
    causes.push({ visitId: null, date: issue.date, message: `${route(view, issue.from, issue.to)} · ${REASONS[issue.reason]}`,
      leg: { date: issue.date, from: issue.from, to: issue.to } });
  }
  for (const issue of result.flightConflicts) {
    causes.push({ visitId: null, date: issue.date, message: '입국 완료와 출국 이동 시각 충돌', leg: null });
  }
  if (!result.verification.verified) {
    causes.push({ visitId: null, date: null, message: '실제 출발 시각의 이동시간 검증을 완료하지 못했어요', leg: null });
  }
  return causes;
}

export type ConflictModeFix = { fix: LegEdit; label: string };
export type ConflictModeFixes = { matched: ConflictModeFix[]; review: ConflictModeFix[] };

/** Exact leg issues identify a fix. An issue reported only for the day warrants reviewing its other fixes. */
export function conflictingModeFixes(view: ResultView, date: string, causes: readonly ConflictCause[]): ConflictModeFixes {
  const dayCauses = causes.filter(cause => cause.date === date);
  const hasDayIssue = dayCauses.some(cause => cause.visitId === null && cause.leg === null);
  const result: ConflictModeFixes = { matched: [], review: [] };
  for (const fix of view.input.legModes ?? []) {
    if (fix.date !== date) continue;
    const matched = dayCauses.some(cause => cause.leg && sameModeConstraint(cause.leg, fix));
    if (!matched && !hasDayIssue) continue;
    const group = matched ? result.matched : result.review;
    group.push({ fix, label: `${route(view, fix.from, fix.to)} · ${MODES[fix.mode]} 고정 해제하고 다시 계산` });
  }
  return result;
}
