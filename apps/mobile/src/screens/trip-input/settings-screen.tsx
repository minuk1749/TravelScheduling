import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Keyboard, Text, View } from 'react-native';
import type { ItineraryResult } from '@travel/core/contracts/itinerary';
import { calculateSettings } from '@travel/core/contracts/settings/calculate';
import { parseSettings } from '@travel/core/contracts/settings/input';
import type { SettingsView } from '@travel/core/contracts/settings/model';
import { REASONS } from '@travel/core/presentation';
import { useTripApi, type GeneratedTrip } from '../../api/trips';
import { ActionButton } from '../../components/action-button';
import { SmallButton, type Errors, type FocusRequest } from '../../components/input/fields';
import { FormCard, FormError, FormScreen, form } from '../../components/input/form-layout';
import { colors, text } from '../../theme';
import { OutcomeFlow } from '../result/result-flow';
import { LivingFields, TaxiFields } from './living-fields';
import { errorMessage, fieldErrors } from './presentation';
import { useTripResource } from './use-trip-resource';

type Operation = { status: 'idle' | 'saving' | 'calculating' }
  | { status: 'calculated' | 'viewing'; result: GeneratedTrip }
  | { status: 'calculation-error'; message: string };

export function SettingsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const api = useTripApi();
  const { state, retry } = useTripResource(useCallback(signal => api.settings(id, signal), [api, id]));
  const openTrip = () => router.dismissTo({ pathname: '/trips/[id]', params: { id } });
  if (state.status === 'ready') return <SettingsEditor tripId={id} initial={state.data} back={openTrip} reload={retry} />;
  return <FormScreen title="하루 생활" back={openTrip}>
    {state.status === 'loading' ? <Text style={text.body}>생활 설정을 불러오는 중</Text>
      : <><FormError message={state.error} /><SmallButton label="다시 불러오기" onPress={retry} /></>}
  </FormScreen>;
}

function SettingsEditor({ tripId, initial, back, reload }: { tripId: string; initial: SettingsView; back(): void; reload(): void }) {
  const api = useTripApi();
  const [snapshot, setSnapshot] = useState(initial.snapshot);
  const [draft, setDraft] = useState(snapshot.settings);
  const [errors, setErrors] = useState<Errors>({});
  const [focus, setFocus] = useState<FocusRequest>();
  const [error, setError] = useState('');
  const [operation, setOperation] = useState<Operation>({ status: 'idle' });
  const inFlight = useRef<AbortController | null>(null);
  useEffect(() => () => inFlight.current?.abort(), []);
  const busy = operation.status === 'saving' || operation.status === 'calculating';
  const saved = operation.status !== 'idle' && operation.status !== 'saving';
  const pendingLabel = operation.status === 'saving' ? '저장 중' : '전체 동선 재계산 중';
  const evaluation = useMemo(() => {
    try { return { preview: calculateSettings(snapshot, parseSettings(draft, snapshot)), errors: {} as Errors }; }
    catch (error) { return { preview: null, errors: fieldErrors(error) }; }
  }, [draft, snapshot]);
  function update(settings: typeof draft) {
    if (inFlight.current) return;
    setDraft(settings);
    setOperation({ status: 'idle' });
    setError('');
    setErrors(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => evaluation.errors[key])));
  }
  const visibleErrors = Object.fromEntries(Object.entries(errors).filter(([key]) => error || evaluation.errors[key]));

  function startRequest() {
    if (inFlight.current) return null;
    const request = new AbortController();
    inFlight.current = request;
    return request;
  }

  async function recalculate(request: AbortController) {
    setOperation({ status: 'calculating' });
    try {
      const result = await api.generate(tripId, request.signal);
      if (!request.signal.aborted) setOperation({ status: 'calculated', result });
    } catch (failure) {
      if (!request.signal.aborted) setOperation({ status: 'calculation-error', message: errorMessage(failure) });
    } finally {
      inFlight.current = null;
    }
  }

  function retryCalculation() {
    const request = startRequest();
    if (request) void recalculate(request);
  }

  async function save() {
    const request = startRequest();
    if (!request) return;
    setOperation({ status: 'saving' });
    setError('');
    try {
      const settings = parseSettings(draft, snapshot);
      Keyboard.dismiss();
      const result = await api.saveSettings(tripId, snapshot.revision, settings, request.signal);
      if (request.signal.aborted) return;
      setSnapshot(result.snapshot);
      setDraft(result.snapshot.settings);
      setErrors({});
    } catch (failure) {
      inFlight.current = null;
      if (request.signal.aborted) return;
      setOperation({ status: 'idle' });
      const fields = fieldErrors(failure);
      const first = Object.keys(fields)[0];
      setErrors(fields);
      if (first) setFocus({ field: first });
      setError(first ? fields[first] : errorMessage(failure));
      return;
    }
    await recalculate(request);
  }
  if (operation.status === 'viewing' || (operation.status === 'calculated' && operation.result.status === 'OVER_CAPACITY')) {
    return <OutcomeFlow tripId={tripId} initial={operation.result}
      back={operation.result.status === 'OVER_CAPACITY' ? reload : back} editConditions={reload} />;
  }
  return <FormScreen title="하루 생활" subtitle={snapshot.timeZone} back={back} backDisabled={busy} footer={<>
    {saved && <Text accessibilityLiveRegion="polite" style={text.body}>✓ 생활 설정을 저장했어요</Text>}
    <FormError message={error} />
    {operation.status === 'calculated' && <RecalculationSummary status={operation.result.status} />}
    {operation.status === 'calculation-error' ? <>
      <FormError message={`전체 동선을 재계산하지 못했어요. ${operation.message}`} />
      <ActionButton label="전체 동선 다시 계산" onPress={retryCalculation} />
    </> : operation.status === 'calculated' ? <ActionButton label="동선 보기"
      onPress={() => setOperation({ status: 'viewing', result: operation.result })} />
      : <ActionButton busy={busy} label={busy ? pendingLabel : '설정 저장'} onPress={() => { void save(); }} />}
  </>}>
    {operation.status === 'calculated' && operation.result.status !== 'OK' && <RecalculationIssues result={operation.result} />}
    <View style={form.stack} pointerEvents={busy ? 'none' : 'auto'}>
      <LivingFields settings={draft} period={snapshot} flights={snapshot.flights} errors={visibleErrors} focus={focus} onChange={update} />
      <FormCard title="이동"><TaxiFields value={draft.taxiPolicy}
        onChange={taxiPolicy => update({ ...draft, taxiPolicy })} /></FormCard>
    </View>
    {evaluation.preview?.conflicts.map((conflict, index) => <FormError key={index}
      message={[conflict.date, conflict.message].filter(Boolean).join(' · ')} />)}
    {error && !busy && <SmallButton label="저장된 설정 다시 불러오기" onPress={reload} />}
  </FormScreen>;
}

function RecalculationSummary({ status }: { status: ItineraryResult['status'] }) {
  if (status === 'CONFLICT') return <FormError message="고정 항목이나 이동 조건이 충돌해요. 고정 조건은 유지했어요." />;
  return <Text accessibilityLiveRegion="polite" style={[text.body, { color: colors.green.text }]}>
    ✓ 이동시간과 영업시간까지 검증했어요
  </Text>;
}

function RecalculationIssues({ result }: { result: ItineraryResult }) {
  const reasons = new Set([
    ...result.capacity.unplaced.map(({ reason }) => REASONS[reason]),
    ...result.capacity.issues.map(({ date, reason }) => `${date} · ${REASONS[reason]}`),
    ...result.transferIssues.map(({ date, reason }) => `${date} · ${REASONS[reason]}`),
    ...result.flightConflicts.map(({ date }) => `${date} · 입국 완료와 출국 이동 시각 충돌`),
  ]);
  if (!result.verification.verified) reasons.add('실제 출발 시각의 이동시간 검증을 완료하지 못했어요.');
  return [...reasons].map(reason => <FormError key={reason} message={reason} />);
}
