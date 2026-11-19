import { useCallback } from 'react';
import { useRouter } from 'expo-router';
import { Text } from 'react-native';
import { useTripApi } from '../../api/trips';
import { ActionButton } from '../../components/action-button';
import { SmallButton } from '../../components/input/fields';
import { FormCard, FormError } from '../../components/input/form-layout';
import { text } from '../../theme';
import { titleForTrip } from './presentation';
import { useTripResource } from './use-trip-resource';

export function TripList() {
  const router = useRouter();
  const api = useTripApi();
  const { state, retry } = useTripResource(useCallback(signal => api.list(signal), [api]));
  return <FormCard title="내 여행">
    <ActionButton label="여행 만들기" onPress={() => router.push('/trips/new')} />
    {state.status === 'loading' && <Text style={text.body}>여행 목록을 불러오는 중</Text>}
    {state.status === 'error' && <><FormError message={state.error} /><SmallButton label="목록 다시 불러오기" onPress={retry} /></>}
    {state.status === 'ready' && (state.data?.trips?.length ? state.data.trips.map(trip => <SmallButton key={trip.id}
      label={titleForTrip(trip)} onPress={() => router.push({ pathname: '/trips/[id]', params: { id: trip.id } })} />)
      : <Text style={text.body}>저장한 여행이 없어요</Text>)}
  </FormCard>;
}
