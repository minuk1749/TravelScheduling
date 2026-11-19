import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Text } from 'react-native';
import type { ResultView } from '@travel/core/contracts/results/model';
import { useTripApi, verifyRevision, type GeneratedTrip } from '../../api/trips';
import { ActionButton } from '../../components/action-button';
import { FormCard, FormError, FormScreen } from '../../components/input/form-layout';
import { useResultMap } from '../../map/provider';
import { colors, text } from '../../theme';
import { CapacityFlow } from '../capacity/capacity-flow';
import { errorMessage } from '../trip-input/presentation';
import { ResultScreen } from './result-screen';
import { useItinerary } from './use-itinerary';

type FlowProps = { tripId: string; back(): void; editConditions(): void };
type Load = { status: 'loading' } | { status: 'ready'; view: ResultView; result: GeneratedTrip } | { status: 'error'; message: string };

function ResultEditor({ tripId, view, result, back, editConditions, overCapacity }: FlowProps & {
  view: ResultView; result: GeneratedTrip; overCapacity(result: GeneratedTrip): void;
}) {
  const itinerary = useItinerary({ tripId, view, result, overCapacity });
  const map = useResultMap();
  return <ResultScreen tripId={tripId} itinerary={itinerary} map={map} back={back} editConditions={editConditions} />;
}

/**
 * Opens a calculated result: reuses the in-memory response when its input hash matches the saved
 * input (GET constraints), otherwise recalculates once. Over-capacity results go to selection.
 */
export function ResultFlow({ tripId, initial, view, back, editConditions, overCapacity }: FlowProps & {
  initial: GeneratedTrip; view?: ResultView; overCapacity(result: GeneratedTrip): void;
}) {
  const api = useTripApi();
  const [load, setLoad] = useState<Load>(view ? { status: 'ready', view, result: initial } : { status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (view && !attempt) return;
    const request = new AbortController();
    const read = async () => {
      const saved = await api.savedInput(tripId, request.signal);
      const result = saved.revision === initial.inputHash ? initial : await api.generate(tripId, request.signal);
      verifyRevision(result, saved.revision);
      return { view: saved, result };
    };
    read().then(loaded => {
      if (request.signal.aborted) return;
      if (loaded.result.status === 'OVER_CAPACITY') overCapacity(loaded.result);
      else setLoad({ status: 'ready', ...loaded });
    }, error => { if (!request.signal.aborted) setLoad({ status: 'error', message: errorMessage(error) }); });
    return () => request.abort();
  }, [api, tripId, initial, view, attempt, overCapacity]);

  if (load.status === 'ready') return <ResultEditor tripId={tripId} view={load.view} result={load.result}
    back={back} editConditions={editConditions} overCapacity={overCapacity} />;
  return <FormScreen title="동선 결과" back={back} footer={load.status === 'error' && <ActionButton label="다시 불러오기"
    onPress={() => { setLoad({ status: 'loading' }); setAttempt(value => value + 1); }} />}>
    <FormCard>
      {load.status === 'error' ? <FormError message={load.message} /> : <>
        <ActivityIndicator color={colors.sky.primary} />
        <Text accessibilityLiveRegion="polite" style={text.body}>동선을 불러오는 중</Text>
      </>}
    </FormCard>
  </FormScreen>;
}

type Phase = { key: number } & ({ kind: 'capacity'; result: GeneratedTrip } | { kind: 'result'; result: GeneratedTrip; view?: ResultView });

/** After a calculation: the result screen (OK/CONFLICT) or required-place selection (OVER_CAPACITY), in memory. */
export function OutcomeFlow({ tripId, initial, back, editConditions }: FlowProps & { initial: GeneratedTrip }) {
  const [phase, setPhase] = useState<Phase>(() => ({ key: 0, kind: initial.status === 'OVER_CAPACITY' ? 'capacity' : 'result', result: initial }));
  const showCapacity = useCallback((result: GeneratedTrip) => setPhase(value => ({ key: value.key + 1, kind: 'capacity', result })), []);
  const showResult = useCallback((view: ResultView, result: GeneratedTrip) =>
    setPhase(value => ({ key: value.key + 1, kind: 'result', result, view })), []);
  if (phase.kind === 'capacity') return <CapacityFlow key={phase.key} tripId={tripId} initial={phase.result}
    back={back} editConditions={editConditions} viewResult={showResult} />;
  return <ResultFlow key={phase.key} tripId={tripId} initial={phase.result} view={phase.view}
    back={back} editConditions={editConditions} overCapacity={showCapacity} />;
}
