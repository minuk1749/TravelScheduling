import { useCallback, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Text } from 'react-native';
import type { PlaceSummary } from '@travel/core/contracts/places';
import { useTripApi } from '../../api/trips';
import { ActionButton } from '../../components/action-button';
import { SmallButton } from '../../components/input/fields';
import { FormCard, FormError, FormScreen, form } from '../../components/input/form-layout';
import { PlaceCredits } from '../../components/input/place-search';
import { text } from '../../theme';
import type { DraftVisit } from './draft';
import { useTripResource } from './use-trip-resource';
import { titleForTrip } from './presentation';
import { VisitCounts, VisitList } from './visit-list';

export function SavedTripScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const api = useTripApi();
  const { state, retry } = useTripResource(useCallback(signal => api.savedInput(id, signal), [api, id]));
  const [filter, setFilter] = useState<'ALL' | DraftVisit['kind']>('ALL');
  const data = state.status === 'ready' ? state.data : undefined;
  const visits: DraftVisit[] = data?.input.visits.map(({ place, fixedDate, fixedTime, fixedOrder, ...visit }) => ({
    ...visit, googlePlaceId: place.googlePlaceId, place: data.places[place.id] ?? missing(place.googlePlaceId),
    fixedDate: fixedDate ?? null, fixedTime: fixedTime ?? null, fixedOrder: fixedOrder ?? null,
  })) ?? [];
  return <FormScreen title="저장한 여행" subtitle={data && titleForTrip(data.input)} back={() => router.back()}
    footer={data && <><VisitCounts visits={visits} /><ActionButton label="동선 만들기"
      onPress={() => router.push({ pathname: '/trips/[id]/generate', params: { id } })} /></>}>
    {state.status === 'loading' && <Text style={text.body}>여행을 불러오는 중</Text>}
    {state.status === 'error' && <><FormError message={state.error} /><SmallButton label="다시 불러오기" onPress={retry} /></>}
    {data && <>
      <FormCard title="항공편">{data.input.flights.map(flight => {
        const place = data.places[flight.airport.id] ?? missing(flight.airport.googlePlaceId);
        return <Text key={flight.direction} style={text.body}>
          {flight.direction === 'ARRIVAL' ? '도착' : '출발'} · {place.name} · {flight.localDateTime.replace('T', ' ')}
          {' '}<PlaceCredits place={place} />
        </Text>;
      })}<Text style={form.secondary}>{data.input.timeZone} · Google Maps</Text></FormCard>
      <FormCard title="숙소">{data.input.lodgings.length ? data.input.lodgings.map(lodging => {
        const place = data.places[lodging.place.id] ?? missing(lodging.place.googlePlaceId);
        return <Text key={lodging.checkIn} style={text.body}>{place.name} · {lodging.checkIn}–{lodging.checkOut}
          {' '}<PlaceCredits place={place} /></Text>;
      }) : <Text style={text.body}>당일 여행</Text>}
      <Text style={text.body}>{data.input.luggageOption === 'DIRECT_TO_AIRPORT' ? '공항으로 바로 이동' : '숙소 경유'}</Text></FormCard>
      <SmallButton label="하루 생활 수정" onPress={() => router.push({ pathname: '/trips/[id]/settings', params: { id } })} />
      <VisitList visits={visits} filter={filter} onFilter={setFilter} />
    </>}
  </FormScreen>;
}

function missing(googlePlaceId: string): PlaceSummary {
  return { googlePlaceId, name: '장소 정보 없음', attributions: [] };
}
