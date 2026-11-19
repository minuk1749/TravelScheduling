import { useCallback, useMemo, useRef, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Keyboard, Text, View } from 'react-native';
import { calculateSettings } from '@travel/core/contracts/settings/calculate';
import { parseSettings } from '@travel/core/contracts/settings/input';
import type { SettingsView } from '@travel/core/contracts/settings/model';
import { useTripApi } from '../../api/trips';
import { ActionButton } from '../../components/action-button';
import { SmallButton, type Errors, type FocusRequest } from '../../components/input/fields';
import { FormCard, FormError, FormScreen, form } from '../../components/input/form-layout';
import { text } from '../../theme';
import { LivingFields, TaxiFields } from './living-fields';
import { errorMessage, fieldErrors } from './presentation';
import { useTripResource } from './use-trip-resource';

export function SettingsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const api = useTripApi();
  const { state, retry } = useTripResource(useCallback(signal => api.settings(id, signal), [api, id]));
  if (state.status === 'ready') return <SettingsEditor tripId={id} initial={state.data} back={() => router.back()} reload={retry} />;
  return <FormScreen title="하루 생활" back={() => router.back()}>
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
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const evaluation = useMemo(() => {
    try { return { preview: calculateSettings(snapshot, parseSettings(draft, snapshot)), errors: {} as Errors }; }
    catch (error) { return { preview: null, errors: fieldErrors(error) }; }
  }, [draft, snapshot]);
  function update(settings: typeof draft) {
    setDraft(settings);
    setSaved(false);
    setError('');
    setErrors(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => evaluation.errors[key])));
  }
  const visibleErrors = Object.fromEntries(Object.entries(errors).filter(([key]) => error || evaluation.errors[key]));
  async function save() {
    if (saving.current) return;
    setError('');
    try {
      const settings = parseSettings(draft, snapshot);
      saving.current = true;
      Keyboard.dismiss();
      setBusy(true);
      const result = await api.saveSettings(tripId, snapshot.revision, settings);
      setSnapshot(result.snapshot);
      setDraft(result.snapshot.settings);
      setErrors({});
      setSaved(true);
    } catch (failure) {
      const fields = fieldErrors(failure);
      const first = Object.keys(fields)[0];
      setErrors(fields);
      if (first) setFocus({ field: first });
      setError(first ? fields[first] : errorMessage(failure));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return <FormScreen title="하루 생활" subtitle={snapshot.timeZone} back={busy ? () => {} : back} footer={<>
    {saved && <Text accessibilityLiveRegion="polite" style={text.body}>✓ 생활 설정을 저장했어요</Text>}
    <FormError message={error} />
    <ActionButton busy={busy} label={busy ? '저장 중' : '설정 저장'} onPress={() => { void save(); }} />
  </>}>
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
