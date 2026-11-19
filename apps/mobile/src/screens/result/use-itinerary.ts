import { useCallback, useEffect, useRef, useState } from 'react';
import { parseConstraints } from '@travel/core/contracts/results/input';
import { constraintsFrom, type Constraints, type ResultView } from '@travel/core/contracts/results/model';
import { ApiFailure } from '../../api/client';
import { useTripApi, verifyRevision, type GeneratedTrip } from '../../api/trips';
import { buildDays } from '../../result/days';
import { dayNumberLabel } from '../../result/format';
import { movedSummary, sameConstraints, type Change } from '../../result/edits';
import { errorMessage, fieldErrors } from '../trip-input/presentation';

export type Phase =
  | { kind: 'idle' }
  | { kind: 'calculating'; change: Change }
  | { kind: 'failed'; change: Change; message: string; stale: boolean };
export type Notice = { id: number; title: string; detail: string | null; undo: boolean };

type State = {
  view: ResultView;
  /** Latest calculation for the saved input (OK or CONFLICT). */
  shown: GeneratedTrip;
  /** Last OK calculation, kept under a conflict or failure (3-8/3-9 "이전 일정"). */
  base: GeneratedTrip | null;
  /** OK calculation before `base`; drives "N분 당겨짐/늦춰짐". */
  previous: GeneratedTrip | null;
  /** Visit to select after the calculation (the edited or added place). */
  focusVisit: string | null;
  phase: Phase;
  notice: Notice | null;
};

const SWITCHED = { TAXI: '택시로', TRANSIT: '대중교통으로', WALK: '도보로' } as const;

function noticeTitle(change: Change, view: ResultView): string {
  if (change.kind === 'MODE') return `${SWITCHED[change.mode]} 바꾸고 다시 계산했어요`;
  if (change.kind === 'WISH') {
    const number = Math.round((Date.parse(change.date) - Date.parse(view.input.startDate)) / 86_400_000) + 1;
    return `${dayNumberLabel(number)}에 추가하고 다시 계산했어요`;
  }
  if (change.kind === 'UNDO') return '되돌리고 다시 계산했어요';
  if (change.kind === 'RETRY') return '다시 계산했어요';
  return '수정하고 다시 계산했어요';
}

function notice(id: number, change: Change, view: ResultView, result: GeneratedTrip, base: GeneratedTrip | null): Notice | null {
  if (result.status !== 'OK') return null;
  const moved = movedSummary(buildDays(view, result, base));
  const reserved = view.input.visits.some(visit => visit.fixedTime) ? '고정 예약은 그대로예요' : null;
  const detail = [moved, reserved].filter(Boolean).join(' · ') || null;
  return { id, title: noticeTitle(change, view), detail, undo: change.kind !== 'UNDO' && change.kind !== 'RETRY' };
}

/**
 * Result editing state: save constraints (T13 PUT) → recalculate (T12 POST) → check the input hash.
 * A saved change keeps its "before" constraints for 변경 취소/되돌리기; a failed POST keeps the saved
 * input and only recalculates on retry. OVER_CAPACITY leaves for the T23 selection flow.
 */
export function useItinerary({ tripId, view, result, overCapacity }: {
  tripId: string; view: ResultView; result: GeneratedTrip; overCapacity(result: GeneratedTrip): void;
}) {
  const api = useTripApi();
  const [state, setState] = useState<State>(() => ({
    view, shown: result, base: result.status === 'OK' ? result : null, previous: null,
    focusVisit: null, phase: { kind: 'idle' }, notice: null,
  }));
  const undo = useRef<{ constraints: Constraints; change: Change } | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const notices = useRef(0);
  useEffect(() => () => pending.current?.abort(), []);
  /** Stable so the toast's auto-dismiss timer is not restarted by unrelated renders. */
  const dismissNotice = useCallback(() => setState(value => ({ ...value, notice: null })), []);

  async function run(change: Change, next: Constraints | null) {
    if (pending.current) return;
    const request = new AbortController();
    pending.current = request;
    const reload = state.phase.kind === 'failed' && state.phase.stale;
    setState(current => ({ ...current, phase: { kind: 'calculating', change }, notice: null }));
    try {
      let current = reload ? await api.savedInput(tripId, request.signal) : state.view;
      if (request.signal.aborted) return;
      const before = constraintsFrom(current.input);
      if (next && !sameConstraints(next, before)) {
        const saved = await api.saveConstraints(tripId, current.revision, parseConstraints(next, current.input), request.signal);
        if (request.signal.aborted) return;
        current = { ...current, ...saved };
        undo.current = change.kind === 'UNDO' ? null : { constraints: before, change };
        setCanUndo(!!undo.current);
      }
      setState(value => ({ ...value, view: current }));
      const generated = await api.generate(tripId, request.signal);
      if (request.signal.aborted) return;
      verifyRevision(generated, current.revision);
      if (generated.status === 'OVER_CAPACITY') { overCapacity(generated); return; }
      const visit = change.kind === 'VISIT' || change.kind === 'WISH' ? change.visitId : null;
      setState(value => {
        const base = generated.status === 'OK' ? generated : value.base;
        const previous = generated.status === 'OK' ? value.base : value.previous;
        return { ...value, view: current, shown: generated, base, previous, focusVisit: visit, phase: { kind: 'idle' },
          notice: notice(++notices.current, change, current, generated, value.base) };
      });
    } catch (failure) {
      if (request.signal.aborted) return;
      const fields = Object.values(fieldErrors(failure));
      const stale = failure instanceof ApiFailure && failure.code === 'STALE_INPUT';
      setState(value => ({ ...value, phase: { kind: 'failed', change, stale,
        message: fields.length ? fields.join(' ') : errorMessage(failure) } }));
    } finally {
      if (pending.current === request) pending.current = null;
    }
  }

  return {
    ...state, canUndo,
    /** Save `next` (when it differs from the saved input) and recalculate. */
    apply: (change: Change, next: Constraints) => { void run(change, next); },
    /** 3-9 "다시 계산": POST only, after re-reading the input when it changed elsewhere. */
    retry: () => { void run({ kind: 'RETRY' }, null); },
    /** 3-8 "변경 취소" / toast "되돌리기": restore the constraints saved before the last change. */
    revert: () => { if (undo.current) void run({ kind: 'UNDO', of: undo.current.change }, undo.current.constraints); },
    dismissNotice,
  };
}
