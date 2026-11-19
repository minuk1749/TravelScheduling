import { useCallback, useMemo, useRef, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { parseTripCreation } from '@travel/core/contracts/trips/create';
import { parseTripDraft } from '@travel/core/contracts/trips/input';
import { useTripApi } from '../../api/trips';
import { ActionButton } from '../../components/action-button';
import { type Errors, type FocusRequest } from '../../components/input/fields';
import { FormCard, FormError, FormScreen } from '../../components/input/form-layout';
import { CityTransport } from './city-profile';
import { flightFacts, initialDraft, validateForm, type DraftVisit, type TripFormDraft } from './draft';
import { LivingFields, TaxiFields } from './living-fields';
import { PlacesStep } from './places-step';
import { errorMessage, fieldErrors } from './presentation';
import { TripFields } from './trip-fields';

export function CreateTripScreen() {
  const router = useRouter();
  const api = useTripApi();
  const [draft, setDraft] = useState(initialDraft);
  const [trip, setTrip] = useState<ReturnType<typeof parseTripDraft>>();
  const [visits, setVisits] = useState<DraftVisit[]>([]);
  const [invalidFields, setInvalidFields] = useState<string[]>([]);
  const [serverErrors, setServerErrors] = useState<Errors>({});
  const [focus, setFocus] = useState<FocusRequest>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const active = useRef(false);
  useFocusEffect(useCallback(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []));
  const validation = useMemo(() => validateForm(draft), [draft]);
  const errors = { ...Object.fromEntries(Object.entries(validation.errors).filter(([field]) => invalidFields.includes(field))), ...serverErrors };
  const livingErrors = Object.fromEntries(Object.entries(errors).flatMap(([field, message]) =>
    field.startsWith('settings.') ? [[field.slice('settings.'.length), message]] : []));
  const livingFocus = useMemo(() => focus?.field.startsWith('settings.')
    ? { field: focus.field.slice('settings.'.length) } : undefined, [focus]);

  function change(patch: Partial<TripFormDraft>) {
    setDraft(value => ({ ...value, ...patch }));
    setServerErrors({});
    setError('');
  }

  function openPlaces() {
    if (Object.keys(validation.errors).length) {
      setInvalidFields(Object.keys(validation.errors));
      setFocus({ field: Object.keys(validation.errors)[0] });
      return;
    }
    setInvalidFields([]);
    setServerErrors({});
    setFocus(undefined);
    setTrip(parseTripDraft(validation.input, 2));
  }

  async function save() {
    if (!trip || saving.current) return;
    setError('');
    try {
      const input = parseTripCreation({ ...trip, settings: draft.settings, visits });
      saving.current = true;
      setBusy(true);
      const { id } = await api.create(input);
      if (active.current) router.replace({ pathname: '/trips/[id]/generate', params: { id } });
    } catch (failure) {
      const fields = fieldErrors(failure);
      const first = Object.keys(fields)[0];
      if (first && !first.startsWith('visits')) {
        setServerErrors(fields);
        setFocus({ field: first });
        setTrip(undefined);
      }
      setError(Object.values(fields)[0] ?? errorMessage(failure));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  if (trip) return <PlacesStep trip={trip} visits={visits} change={value => { setVisits(value); setError(''); }}
    back={() => { setTrip(undefined); setError(''); }} generate={() => { void save(); }} busy={busy} error={error} />;

  const issues = Object.keys(validation.errors).length;
  return <FormScreen title="여행 만들기" subtitle={issues ? `확인할 항목 ${issues}개` : '✓ 입력 완료'}
    back={() => router.back()} footer={<><FormError message={error} /><ActionButton label="장소 추가하기" onPress={openPlaces} /></>}>
    <TripFields draft={draft} errors={errors} focus={focus} change={change} />
    <LivingFields settings={draft.settings} period={draft} flights={flightFacts(draft)}
      errors={livingErrors} focus={livingFocus} onChange={settings => change({ settings })} />
    <FormCard title="이동">
      <TaxiFields value={draft.settings.taxiPolicy}
        onChange={taxiPolicy => change({ settings: { ...draft.settings, taxiPolicy } })} />
      <CityTransport key={draft.cityCode.trim()} cityCode={draft.cityCode.trim()} />
    </FormCard>
  </FormScreen>;
}
