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
  | { kind: 'failed'; change: Change; message: string; reload: boolean; draft: Constraints | null };
export type Notice = { id: number; title: string; detail: string | null; undo: boolean };

type Calculation = { view: ResultView; result: GeneratedTrip };
type Undo = { revision: string; constraints: Constraints; change: Change };

type State = {
  view: ResultView;
  /** Latest calculation for the saved input (OK or CONFLICT). */
  shown: Calculation;
  /** Last OK calculation, kept under a conflict or failure (3-8/3-9 "이전 일정"). */
  base: Calculation | null;
  /** OK calculation before `base`; drives "N분 당겨짐/늦춰짐". */
  previous: GeneratedTrip | null;
  /** Visit to select after the calculation (the edited or added place). */
  focusVisit: string | null;
  phase: Phase;
  notice: Notice | null;
  undo: Undo | null;
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

function notice(id: number, change: Change, view: ResultView, result: GeneratedTrip, base: GeneratedTrip | null, canUndo: boolean): Notice | null {
  if (result.status !== 'OK') return null;
  const moved = movedSummary(buildDays(view, result, base));
  const reserved = view.input.visits.some(visit => visit.fixedTime) ? '고정 예약은 그대로예요' : null;
  const detail = [moved, reserved].filter(Boolean).join(' · ') || null;
  return { id, title: noticeTitle(change, view), detail, undo: canUndo };
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
  const [state, setState] = useState<State>(() => {
    const shown = { view, result };
    return { view, shown, base: result.status === 'OK' ? shown : null, previous: null,
      focusVisit: null, phase: { kind: 'idle' }, notice: null, undo: null };
  });
  const { undo } = state;
  const canUndo = undo !== null && undo.revision === state.view.revision;
  const pending = useRef<AbortController | null>(null);
  const notices = useRef(0);
  useEffect(() => () => pending.current?.abort(), []);
  /** Stable so the toast's auto-dismiss timer is not restarted by unrelated renders. */
  const dismissNotice = useCallback(() => setState(value => ({ ...value, notice: null })), []);

  async function run(change: Change, next: Constraints | null) {
    if (pending.current) return;
    const request = new AbortController();
    pending.current = request;
    let reload = state.phase.kind === 'failed' && state.phase.reload;
    let draft = next;
    // Only a retry of this operation may inherit its saved edit. A new no-op has nothing to undo.
    let restore = state.phase.kind === 'failed' ? undo : null;
    setState(current => ({ ...current, phase: { kind: 'calculating', change }, notice: null }));
    try {
      const original = state.view;
      let current = reload ? await api.savedInput(tripId, request.signal) : original;
      if (request.signal.aborted) return;
      reload = false;
      if (current.revision !== original.revision) restore = null;
      if (draft) {
        const before = constraintsFrom(original.input);
        if (!sameConstraints(draft, constraintsFrom(current.input))) {
          // Only the revision against which the draft was prepared can accept a full replacement.
          if (current.revision !== original.revision) {
            throw new ApiFailure(409, 'STALE_INPUT', '다른 기기에서 여행 정보가 바뀌었어요. 다시 계산한 뒤 변경을 적용해 주세요.');
          }
          const saved = await api.saveConstraints(tripId, original.revision, parseConstraints(draft, current.input), request.signal);
          if (request.signal.aborted) return;
          current = { ...current, ...saved };
        }
        if (!sameConstraints(draft, before)) {
          restore = change.kind === 'UNDO' ? null : { revision: current.revision, constraints: before, change };
        }
        // Acknowledged PUT or observed the desired saved state after an ambiguous failure.
        draft = null;
      }
      setState(value => ({ ...value, view: current, undo: restore }));
      const generated = await api.generate(tripId, request.signal);
      if (request.signal.aborted) return;
      verifyRevision(generated, current.revision);
      if (generated.status === 'OVER_CAPACITY') { overCapacity(generated); return; }
      const edit = change.kind === 'RETRY' ? restore?.change : change;
      const visit = edit?.kind === 'VISIT' || edit?.kind === 'WISH' ? edit.visitId : null;
      setState(value => {
        const shown = { result: generated, view: current };
        const base = generated.status === 'OK' ? shown : value.base;
        const previous = generated.status === 'OK' ? value.base?.result ?? null : value.previous;
        return { ...value, view: current, shown, base, previous, focusVisit: visit, phase: { kind: 'idle' },
          notice: notice(++notices.current, change, current, generated, value.base?.result ?? null, restore !== null) };
      });
    } catch (failure) {
      if (request.signal.aborted) return;
      const fields = Object.values(fieldErrors(failure));
      const stale = failure instanceof ApiFailure && failure.code === 'STALE_INPUT';
      setState(value => ({ ...value, undo: stale ? null : restore, phase: { kind: 'failed', change, reload: reload || stale || !!draft, draft: stale ? null : draft,
        message: fields.length ? fields.join(' ') : errorMessage(failure) } }));
    } finally {
      if (pending.current === request) pending.current = null;
    }
  }

  return {
    ...state, canUndo,
    /** Save `next` (when it differs from the saved input) and recalculate. */
    apply: (change: Change, next: Constraints) => { if (state.phase.kind === 'idle') void run(change, next); },
    retry: () => {
      if (state.phase.kind !== 'failed') return;
      const { change, draft } = state.phase;
      void run(draft ? change : { kind: 'RETRY' }, draft);
    },
    /** 3-8 "변경 취소" / toast "되돌리기": restore the constraints saved before the last change. */
    revert: () => { if (canUndo && state.phase.kind === 'idle') void run({ kind: 'UNDO', of: undo.change }, undo.constraints); },
    dismissNotice,
  };
}
