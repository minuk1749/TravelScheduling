import type { ItineraryResult } from '@travel/core/contracts/itinerary';
import type { LegEdit, ResultView } from '@travel/core/contracts/results/model';
import { MEALS, MODES, placeName, REASONS } from '@travel/core/presentation';
import { sameModeConstraint } from './edits';
import { periodLabel } from './format';

/** One line of "고정 조건 충돌 N건": a visit that could not be placed, or a day/leg-level problem. */
export type ConflictCause = {
  visitId: string | null;
  date: string | null;
  message: string;
  /** Place of a date-fixed visit rejected for time. The scheduler does not identify a failing leg. */
  timeWindowPlaceId?: string;
  /** The leg drawn as a red curve on the map. */
  leg: { date: string; from: string; to: string } | null;
};

/** Saved leg keys identify places. Their input roles still identify the endpoints if details are missing or names coincide. */
function endpointContext(view: ResultView, date: string, id: string): string {
  const anchors = [
    ...view.input.lodgings.flatMap((stay, index) => stay.place.id !== id ? [] : [{
      onDate: stay.checkIn <= date && date <= stay.checkOut,
      label: `숙소 ${index + 1} · ${periodLabel({ startDate: stay.checkIn, endDate: stay.checkOut })}`,
    }]),
    ...view.input.flights.filter(flight => flight.airport.id === id).map(flight => ({
      onDate: flight.localDateTime.slice(0, 10) === date,
      label: flight.direction === 'ARRIVAL' ? '도착 공항' : '출발 공항',
    })),
  ];
  const active = anchors.filter(anchor => anchor.onDate);
  if (active.length) return active.map(anchor => anchor.label).join(' / ');
  const visits = view.input.visits.flatMap((visit, index) => visit.place.id === id ? [index + 1] : []);
  if (visits.length) return `방문 장소 ${visits.join(', ')}`;
  return anchors.map(anchor => anchor.label).join(' / ') || placeName(view, id);
}

function conflictRouteLabels(view: ResultView) {
  const names = new Set<string>(), duplicates = new Set<string>();
  for (const place of Object.values(view.places)) {
    if (!place?.name) continue;
    if (names.has(place.name)) duplicates.add(place.name);
    names.add(place.name);
  }
  const label = (date: string, id: string) => {
    const name = view.places[id]?.name;
    if (!name) return endpointContext(view, date, id);
    return duplicates.has(name) ? `${name} (${endpointContext(view, date, id)})` : name;
  };
  return (date: string, from: string, to: string) => `${label(date, from)} → ${label(date, to)}`;
}

/** 3-8 causes in display order: fixed visits first, then other visits, day issues, airport and flight issues. */
export function conflictCauses(view: ResultView, result: ItineraryResult | null): ConflictCause[] {
  if (!result || result.status !== 'CONFLICT') return [];
  const route = conflictRouteLabels(view);
  const visits = new Map(view.input.visits.map(visit => [visit.id, visit]));
  const unplaced = result.capacity.unplaced.filter(visit => visit.reason !== 'WISH')
    .sort((a, b) => Number(b.fixed) - Number(a.fixed));
  const causes: ConflictCause[] = unplaced.map(rejection => {
    const visit = visits.get(rejection.visitId);
    return { visitId: rejection.visitId, date: visit?.fixedDate ?? null, message: REASONS[rejection.reason], leg: null,
      ...(rejection.reason === 'TIME_WINDOW' && rejection.fixed && visit?.fixedDate ? { timeWindowPlaceId: visit.place.id } : {}) };
  });
  for (const issue of result.capacity.issues) {
    if (issue.reason === 'UNREACHABLE') {
      causes.push({ visitId: null, date: issue.date, message: `${route(issue.date, issue.from, issue.to)} · ${REASONS.UNREACHABLE}`,
        leg: { date: issue.date, from: issue.from, to: issue.to } });
    } else {
      const meal = issue.reason === 'MEAL_UNAVAILABLE' ? `${MEALS[issue.slot]} · ` : '';
      causes.push({ visitId: null, date: issue.date, message: `${meal}${REASONS[issue.reason]}`, leg: null });
    }
  }
  for (const issue of result.transferIssues) {
    causes.push({ visitId: null, date: issue.date, message: `${route(issue.date, issue.from, issue.to)} · ${REASONS[issue.reason]}`,
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
export type ConflictModeFixes = { matched: ConflictModeFix[]; connected: ConflictModeFix[]; review: ConflictModeFix[] };

/** A reported leg is exact. Visit timing can depend on either adjacent leg or on travel elsewhere that day. */
export function conflictingModeFixes(view: ResultView, date: string, causes: readonly ConflictCause[]): ConflictModeFixes {
  const dayCauses = causes.filter(cause => cause.date === date);
  const route = conflictRouteLabels(view);
  const hasDayIssue = dayCauses.some(cause => cause.visitId === null && cause.leg === null);
  const timedPlaces = new Set(dayCauses.flatMap(cause => cause.timeWindowPlaceId ? [cause.timeWindowPlaceId] : []));
  const result: ConflictModeFixes = { matched: [], connected: [], review: [] };
  for (const fix of view.input.legModes ?? []) {
    if (fix.date !== date) continue;
    const matched = dayCauses.some(cause => cause.leg && sameModeConstraint(cause.leg, fix));
    if (!matched && !hasDayIssue && !timedPlaces.size) continue;
    const connected = timedPlaces.has(fix.from) || timedPlaces.has(fix.to);
    const group = matched ? result.matched : connected ? result.connected : result.review;
    group.push({ fix, label: `${route(date, fix.from, fix.to)} · ${MODES[fix.mode]} 고정 해제하고 다시 계산` });
  }
  return result;
}
