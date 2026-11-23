import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Text } from 'react-native';
import type { ResultView } from '@travel/core/contracts/results/model';
import { useItineraryGeneration } from '../../api/itinerary-generation';
import { useTripApi, type GeneratedTrip } from '../../api/trips';
import { ActionButton } from '../../components/action-button';
import { FormCard, FormError, FormScreen } from '../../components/input/form-layout';
import { useResultMap } from '../../map/provider';
import { colors, text } from '../../theme';
import { CapacityFlow } from '../capacity/capacity-flow';
import { errorMessage } from '../trip-input/presentation';
import { InitialResult } from './place-panel';
import { ResultScreen } from './result-screen';
import { useItinerary } from './use-itinerary';

type FlowProps = { tripId: string; back(): void; editConditions(): void };
type Load =
  | { status: 'read'; result: GeneratedTrip; source: 'initial' | 'calculation'; cachedView?: ResultView; error?: string }
  | { status: 'calculate'; view: ResultView; error?: string }
  | { status: 'ready'; view: ResultView; result: GeneratedTrip };

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
  const calculation = useItineraryGeneration(tripId);
  const map = useResultMap();
  const [load, setLoad] = useState<Load>(() => view
    ? { status: 'ready', view, result: initial }
    : { status: 'read', result: initial, source: 'initial' });

  useEffect(() => {
    if (load.status === 'ready' || load.error !== undefined) return;
    const request = new AbortController();
    function open(saved: ResultView, result: GeneratedTrip) {
      if (result.status === 'OVER_CAPACITY') overCapacity(result);
      else setLoad({ status: 'ready', view: saved, result });
    }
    const run = async () => {
      if (load.status === 'read') {
        // A matching in-memory view already has the places needed to display a replay.
        const saved = load.cachedView ?? await api.savedInput(tripId, request.signal);
        const { revision } = load.cachedView ? await api.savedRevision(tripId, request.signal) : saved;
        if (request.signal.aborted) return;
        if (revision === load.result.inputHash) open(saved, load.result);
        else if (load.source === 'initial') setLoad({ status: 'calculate', view: saved });
        else setLoad({ status: 'calculate', view: saved, error: '계산 중 여행 정보가 바뀌었어요. 다시 계산해 주세요.' });
        return;
      }
      const { result, retried } = await calculation.run(request.signal, load.view.revision);
      if (request.signal.aborted) return;
      const cachedView = result.inputHash === load.view.revision ? load.view : undefined;
      if (!retried && cachedView) open(cachedView, result);
      else setLoad({ status: 'read', result, source: 'calculation', cachedView });
    };
    void run().catch(error => {
      if (!request.signal.aborted) setLoad({ ...load, error: errorMessage(error) });
    });
    return () => request.abort();
  }, [api, calculation, tripId, load, overCapacity]);

  if (load.status === 'ready') return <ResultEditor tripId={tripId} view={load.view} result={load.result}
    back={back} editConditions={editConditions} overCapacity={overCapacity} />;
  const retry = () => setLoad({ ...load, error: undefined });
  if (load.status === 'calculate') return <InitialResult map={map} back={back}
    failure={load.error === undefined ? undefined : { message: load.error, retry, editConditions }} />;
  return <FormScreen title="동선 결과" back={back} footer={load.error !== undefined && <ActionButton label="다시 불러오기" onPress={retry} />}>
    <FormCard>
      {load.error !== undefined ? <FormError message={load.error} /> : <>
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
