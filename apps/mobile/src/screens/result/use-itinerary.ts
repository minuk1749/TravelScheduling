import { uuid } from 'expo';
import { useCallback, useEffect, useRef, useState } from 'react';
import { parseConstraints } from '@travel/core/contracts/results/input';
import { constraintsFrom, type Constraints, type ConstraintWriteOptions, type ResultView } from '@travel/core/contracts/results/model';
import { ApiFailure } from '../../api/client';
import { useTripApi, verifyRevision, type GeneratedTrip } from '../../api/trips';
import { buildDays } from '../../result/days';
import { dayNumberLabel } from '../../result/format';
import { movedSummary, reservationSummary, sameConstraints, type Change } from '../../result/edits';
import { errorMessage, fieldErrors } from '../trip-input/presentation';

type Draft = ConstraintWriteOptions & { constraints: Constraints; operationId: string };

export type Phase =
  | { kind: 'idle' }
  | { kind: 'calculating'; change: Change }
  | { kind: 'failed'; change: Change; message: string; reload: boolean; draft: Draft | null };
export type Notice = { id: number; title: string; detail: string | null; undo: boolean };

type Calculation = { view: ResultView; result: GeneratedTrip };
type Undo = { revision: string; constraints: Constraints; change: Change; operationId?: string; writeVersion?: string };

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
  /** Keeps an acknowledged edit for post-retry focus. Undo additionally needs a server-side write precondition. */
  undo: Undo | null;
};

const SWITCHED = { TAXI: '택시로', TRANSIT: '대중교통으로', WALK: '도보로' } as const;

// The constraints endpoint returns these statuses only when access, validation or revision checks reject the write.
const REJECTED_SAVE_STATUSES = new Set([400, 401, 403, 404, 409]);
const isStale = (failure: unknown) => failure instanceof ApiFailure && failure.code === 'STALE_INPUT';
const changedElsewhere = () => new ApiFailure(409, 'STALE_INPUT', '다른 기기에서 여행 정보가 바뀌었어요. 다시 계산한 뒤 변경을 적용해 주세요.');

const hasReceipt = (view: ResultView, operationId: string) =>
  view.receipt?.operationId === operationId && view.receipt.revision === view.revision;

function canRestore(undo: Undo | null, view: ResultView): undo is Undo {
  return !!undo && (undo.writeVersion !== undefined || undo.operationId !== undefined)
    && undo.revision === view.revision && undo.writeVersion === view.writeVersion;
}

function noticeTitle(change: Change, view: ResultView): string {
  if (change.kind === 'MODE') return change.mode === null
    ? '이동수단 고정을 해제하고 다시 계산했어요' : `${SWITCHED[change.mode]} 바꾸고 다시 계산했어요`;
  if (change.kind === 'WISH') {
    const number = Math.round((Date.parse(change.date) - Date.parse(view.input.startDate)) / 86_400_000) + 1;
    return `${dayNumberLabel(number)}에 추가하고 다시 계산했어요`;
  }
  if (change.kind === 'UNDO') return '되돌리고 다시 계산했어요';
  if (change.kind === 'RETRY') return '다시 계산했어요';
  return '수정하고 다시 계산했어요';
}

function notice(id: number, change: Change, next: Calculation, previous: State, canUndo: boolean): Notice | null {
  const { view, result } = next;
  if (result.status !== 'OK') return null;
  const moved = movedSummary(buildDays(view, result, previous.base?.result ?? null));
  const reserved = reservationSummary(previous.shown.view.input.visits, view.input.visits);
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
  const canUndo = canRestore(undo, state.view);
  const pending = useRef<AbortController | null>(null);
  const notices = useRef(0);
  useEffect(() => () => pending.current?.abort(), []);
  /** Stable so the toast's auto-dismiss timer is not restarted by unrelated renders. */
  const dismissNotice = useCallback(() => setState(value => ({ ...value, notice: null })), []);

  async function saveDraft(current: ResultView, draft: Draft, signal: AbortSignal, retrying: boolean) {
    const constraints = parseConstraints(draft.constraints, current.input);
    const { operationId, expectedOperationId, expectedWriteVersion } = draft;
    try {
      const saved = await api.saveConstraints(tripId, current.revision, constraints, signal, { operationId, expectedOperationId, expectedWriteVersion });
      const view = { ...saved, places: current.places };
      if (!sameConstraints(constraints, constraintsFrom(saved.input))) throw changedElsewhere();
      // Legacy servers can acknowledge this PUT directly. A later GET alone cannot identify that writer.
      return { view, confirmed: saved.receipt === undefined || hasReceipt(view, operationId) };
    } catch (failure) {
      if (!retrying || signal.aborted || !(failure instanceof ApiFailure && failure.status === 409)) throw failure;
      // A late commit and another device's matching edit both allow generation, but only our receipt allows undo.
      const latest = await api.savedInput(tripId, signal, operationId);
      if (sameConstraints(constraints, constraintsFrom(latest.input))) return { view: latest, confirmed: hasReceipt(latest, operationId) };
      if (latest.revision !== current.revision || latest.writeVersion !== expectedWriteVersion || expectedOperationId) throw changedElsewhere();
      throw new Error('저장 결과를 확인하지 못했어요. 다시 계산해 주세요.');
    }
  }

  async function run(change: Change, next: Draft | null) {
    if (pending.current) return;
    const request = new AbortController();
    pending.current = request;
    const failed = state.phase.kind === 'failed' ? state.phase : null;
    let reload = failed?.reload ?? false;
    let draft = next;
    let appliedChange = change;
    // Only a retry of this operation may inherit its saved edit. A new no-op has nothing to undo.
    let restore = failed ? undo : null;
    setState(current => ({ ...current, phase: { kind: 'calculating', change }, notice: null }));
    try {
      const original = state.view;
      let current = reload ? await api.savedInput(tripId, request.signal, draft?.operationId) : original;
      if (request.signal.aborted) return;
      reload = false;
      if (current.revision !== original.revision || current.writeVersion !== original.writeVersion) restore = null;
      if (draft) {
        const before = constraintsFrom(original.input);
        let confirmed = hasReceipt(current, draft.operationId);
        if (!sameConstraints(draft.constraints, constraintsFrom(current.input))) {
          // Only the revision against which the draft was prepared can accept a full replacement.
          if (current.revision !== original.revision || (failed && current.writeVersion !== draft.expectedWriteVersion)) throw changedElsewhere();
          if (failed && !draft.expectedWriteVersion) {
            throw new ApiFailure(409, 'STALE_INPUT', '이전 저장을 확인할 수 없어요. 다시 계산한 뒤 변경을 적용해 주세요.');
          }
          const saved = await saveDraft(current, draft, request.signal, !!failed);
          if (request.signal.aborted) return;
          current = saved.view;
          confirmed = saved.confirmed;
        }
        const changed = !sameConstraints(draft.constraints, before);
        if (!confirmed && changed) appliedChange = { kind: 'RETRY' };
        restore = confirmed && changed && change.kind !== 'UNDO' ? {
          revision: current.revision, writeVersion: current.writeVersion, constraints: before, change,
          operationId: hasReceipt(current, draft.operationId) ? draft.operationId : undefined,
        } : null;
        draft = null;
      }
      setState(value => ({ ...value, view: current, undo: restore }));
      const generated = await api.generate(tripId, request.signal);
      if (request.signal.aborted) return;
      verifyRevision(generated, current.revision);
      if (generated.status === 'OVER_CAPACITY') { overCapacity(generated); return; }
      const edit = appliedChange.kind === 'RETRY' ? restore?.change : appliedChange;
      const visit = edit?.kind === 'VISIT' || edit?.kind === 'WISH' ? edit.visitId : null;
      setState(value => {
        const shown = { result: generated, view: current };
        const base = generated.status === 'OK' ? shown : value.base;
        const previous = generated.status === 'OK' ? value.base?.result ?? null : value.previous;
        return { ...value, view: current, shown, base, previous, focusVisit: visit, phase: { kind: 'idle' },
          notice: notice(++notices.current, appliedChange, shown, value, canRestore(restore, current)) };
      });
    } catch (failure) {
      if (request.signal.aborted) return;
      const fields = Object.values(fieldErrors(failure));
      // A rejected first PUT cannot own a matching remote change. Replays may still have an unacknowledged first PUT.
      const rejected = !!draft && !failed && failure instanceof ApiFailure && REJECTED_SAVE_STATUSES.has(failure.status);
      const discardEdit = rejected || isStale(failure);
      setState(value => ({ ...value, undo: discardEdit ? null : restore, phase: { kind: 'failed', change,
        reload: reload || discardEdit || !!draft, draft: discardEdit ? null : draft,
        message: fields.length ? fields.join(' ') : errorMessage(failure) } }));
    } finally {
      if (pending.current === request) pending.current = null;
    }
  }

  return {
    ...state, canUndo,
    /** Save `next` (when it differs from the saved input) and recalculate. */
    apply: (change: Change, constraints: Constraints) => {
      if (state.phase.kind === 'idle') void run(change, { constraints, operationId: uuid.v4(), expectedWriteVersion: state.view.writeVersion });
    },
    retry: () => {
      if (state.phase.kind !== 'failed') return;
      const { change, draft } = state.phase;
      void run(draft ? change : { kind: 'RETRY' }, draft);
    },
    /** 3-8 "변경 취소" / toast "되돌리기": restore the constraints saved before the last change. */
    revert: () => {
      if (canUndo && state.phase.kind === 'idle') void run({ kind: 'UNDO', of: undo.change }, {
        constraints: undo.constraints, operationId: uuid.v4(), expectedWriteVersion: undo.writeVersion, expectedOperationId: undo.operationId,
      });
    },
    dismissNotice,
  };
}
