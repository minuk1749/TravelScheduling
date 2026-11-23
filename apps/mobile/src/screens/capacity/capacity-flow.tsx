import { useCallback, useEffect, useRef, useState, type ComponentRef } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { parseConstraints } from '@travel/core/contracts/results/input';
import { constraintsFrom, type ResultView, type VisitEdit } from '@travel/core/contracts/results/model';
import { placeName } from '@travel/core/presentation';
import { useItineraryGeneration } from '../../api/itinerary-generation';
import { isStaleInput, useTripApi, type GeneratedTrip } from '../../api/trips';
import { ActionButton } from '../../components/action-button';
import { FormCard, FormError, FormScreen, form } from '../../components/input/form-layout';
import { colors, text } from '../../theme';
import { useReducedMotion } from '../../theme/use-reduced-motion';
import { errorMessage, fieldErrors, titleForTrip } from '../trip-input/presentation';
import { useTripResource } from '../trip-input/use-trip-resource';
import { Candidates, RemoveFixedSheet, type Candidate } from './candidates';
import { fixedConditions, selectionIssues } from './selection';
import { FeasibleStatus, SelectionStatus } from './selection-status';

const title = '필수 장소 선택';

/** `viewResult` opens the verified result (T22 result screen) from memory without recalculating. */
type FlowProps = {
  tripId: string; initial: GeneratedTrip; back(): void; editConditions(): void;
  viewResult(view: ResultView, result: GeneratedTrip): void;
};
type Selection = { view: ResultView; result: GeneratedTrip };

export function CapacityFlow({ tripId, initial, view: initialView, back, editConditions, viewResult }: FlowProps & { view?: ResultView }) {
  const api = useTripApi();
  const calculation = useItineraryGeneration(tripId);
  const pendingView = useRef(initialView);
  const load = useCallback(async (signal: AbortSignal): Promise<Selection> => {
    const view = pendingView.current ?? await api.savedInput(tripId, signal);
    signal.throwIfAborted();
    // Keep the places while this calculation is pending. A later editor reload reads fresh input.
    pendingView.current = view;
    try {
      const result = view.revision === initial.inputHash ? initial : await calculation.runVerified(signal, view.revision);
      signal.throwIfAborted();
      pendingView.current = undefined;
      return { view, result };
    } catch (failure) {
      if (!signal.aborted && isStaleInput(failure)) pendingView.current = undefined;
      throw failure;
    }
  }, [api, calculation, initial, tripId]);
  const { state, retry } = useTripResource(load);
  if (state.status === 'ready') return <SelectionEditor tripId={tripId} initial={state.data}
    back={back} editConditions={editConditions} reload={retry} viewResult={viewResult} />;
  return <FormScreen title={title} back={back}
    footer={state.status === 'error' && <ActionButton label="다시 불러오기" onPress={retry} />}>
    <FormCard>
      {state.status === 'error' ? <FormError message={state.error} /> : <>
        <ActivityIndicator color={colors.sky.primary} />
        <Text accessibilityLiveRegion="polite" style={text.body}>장소를 불러오는 중</Text>
      </>}
    </FormCard>
  </FormScreen>;
}

function SelectionEditor({ tripId, initial, back, editConditions, reload, viewResult }: Omit<FlowProps, 'initial'> & {
  initial: Selection; reload(): void;
}) {
  const api = useTripApi();
  const calculation = useItineraryGeneration(tripId);
  const reduced = useReducedMotion();
  const [view, setView] = useState(initial.view);
  const [draft, setDraft] = useState(() => constraintsFrom(initial.view.input));
  const [result, setResult] = useState<GeneratedTrip | null>(initial.result.status === 'OVER_CAPACITY' ? null : initial.result);
  const [maximum, setMaximum] = useState(initial.result.capacity.recommendation?.requiredCount);
  const [confirm, setConfirm] = useState<Candidate | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; stale: boolean }>();
  const pending = useRef<AbortController | null>(null);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const issueOffset = useRef(0);
  useEffect(() => () => pending.current?.abort(), []);

  const count = draft.visits.filter(visit => visit.priority === 'REQUIRED').length;
  function change(next: VisitEdit) {
    calculation.reset();
    setDraft(previous => ({ ...previous, visits: previous.visits.map(visit => visit.id === next.id ? next : visit) }));
    setResult(null);
    setError(previous => previous?.stale ? previous : undefined);
  }
  function toggle(candidate: Candidate) {
    if (pending.current) return;
    const { visit } = candidate;
    if (visit.priority === 'WISH') change({ ...visit, priority: 'REQUIRED' });
    else if (fixedConditions(visit).length) setConfirm(candidate);
    else change({ ...visit, priority: 'WISH' });
  }
  function confirmRemoval() {
    if (!confirm) return;
    change({ id: confirm.visit.id, priority: 'WISH', fixedDate: null, fixedTime: null, fixedOrder: null });
    setConfirm(null);
  }

  async function revalidate() {
    if (pending.current || error?.stale) return;
    const request = new AbortController();
    pending.current = request;
    setBusy(true);
    setError(undefined);
    try {
      const constraints = parseConstraints(draft, view.input);
      let revision = view.revision;
      if (JSON.stringify(constraints) !== JSON.stringify(constraintsFrom(view.input))) {
        const saved = await api.saveConstraints(tripId, revision, constraints, request.signal);
        if (request.signal.aborted) return;
        revision = saved.revision;
        setView({ ...view, ...saved });
        setDraft(constraintsFrom(saved.input));
      }
      const checked = await calculation.runVerified(request.signal, revision);
      if (request.signal.aborted) return;
      if (checked.status === 'OVER_CAPACITY') setMaximum(checked.capacity.recommendation?.requiredCount);
      setResult(checked);
    } catch (failure) {
      if (!request.signal.aborted) {
        const fields = Object.values(fieldErrors(failure));
        setError({ message: fields.length ? fields.join(' ') : errorMessage(failure),
          stale: isStaleInput(failure) });
      }
    } finally {
      pending.current = null;
      if (!request.signal.aborted) setBusy(false);
    }
  }

  if (result?.status === 'OK') {
    return <FormScreen title={title} back={back} subtitle={titleForTrip(view.input)}
      footer={<ActionButton label="동선 보기" onPress={() => viewResult(view, result)} />}>
      <FeasibleStatus count={count} />
    </FormScreen>;
  }

  const issues = result && selectionIssues(result, view);
  const visits = new Map(view.input.visits.map(visit => [visit.id, visit]));
  const problems: Candidate[] = [];
  const other: Candidate[] = [];
  for (const visit of draft.visits) {
    const { place, kind, minutes } = visits.get(visit.id)!;
    const reason = issues?.byVisit.get(visit.id);
    const candidate = { visit, kind, minutes, reason, name: placeName(view, place.id), place: view.places[place.id] ?? null };
    (reason ? problems : other).push(candidate);
  }

  return <FormScreen title={title} subtitle={titleForTrip(view.input)} back={back} backDisabled={busy}
    scrollRef={scroll} footer={<>
      {error?.stale && <ActionButton label="저장된 설정 다시 불러오기" onPress={reload} />}
      <ActionButton label="여행 조건 수정" secondary disabled={busy} onPress={editConditions} />
      <ActionButton label={busy ? '다시 확인 중' : `선택한 ${count}곳으로 다시 계산`} busy={busy} disabled={error?.stale}
        onPress={() => { void revalidate(); }} />
    </>}>
    <SelectionStatus maximum={maximum} count={count} failed={!!result} messages={issues?.general ?? []} busy={busy}
      jump={problems.length ? () => scroll.current?.scrollTo({ y: issueOffset.current, animated: !reduced }) : undefined} />
    <FormError message={error?.message} />
    {!!problems.length && <View onLayout={event => { issueOffset.current = event.nativeEvent.layout.y; }}>
      <Candidates title="문제가 된 장소" candidates={problems} busy={busy} toggle={toggle} />
    </View>}
    {!!other.length && <Candidates title="후보 장소" candidates={other} busy={busy} toggle={toggle} />}
    <Text style={form.secondary}>장소 정보 · Google Maps</Text>
    {confirm && <RemoveFixedSheet candidate={confirm} cancel={() => setConfirm(null)} confirm={confirmRemoval} />}
  </FormScreen>;
}
