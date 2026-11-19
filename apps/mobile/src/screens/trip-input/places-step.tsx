import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import type { PlaceSummary } from '@travel/core/contracts/places';
import type { TripDraft } from '@travel/core/contracts/trips/input';
import { ActionButton } from '../../components/action-button';
import { SmallButton } from '../../components/input/fields';
import { FormCard, FormError, FormScreen, form } from '../../components/input/form-layout';
import { PlaceCredits, SearchBox, usePlaceSearch } from '../../components/input/place-search';
import { Skeleton } from '../../components/input/skeleton';
import { text } from '../../theme';
import { regionFor, type DraftVisit } from './draft';
import { titleForTrip } from './presentation';
import { VisitCounts, VisitList } from './visit-list';
import { VisitSheet } from './visit-sheet';

export function PlacesStep({ trip, visits, change, back, generate, busy, error }: {
  trip: TripDraft; visits: DraftVisit[]; change(visits: DraftVisit[]): void;
  back(): void; generate(): void; busy: boolean; error: string;
}) {
  const search = usePlaceSearch(regionFor(trip.cityCode));
  const [filter, setFilter] = useState<'ALL' | DraftVisit['kind']>('ALL');
  const [editing, setEditing] = useState<DraftVisit | null>(null);
  const [toast, setToast] = useState(0);
  const ids = new Set(visits.map(visit => visit.googlePlaceId));
  const { state } = search;
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(0), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  function add(place: PlaceSummary) {
    if (ids.has(place.googlePlaceId)) { setToast(value => value + 1); return; }
    setEditing({ googlePlaceId: place.googlePlaceId, place, kind: 'ATTRACTION', minutes: 60, priority: 'REQUIRED',
      fixedDate: null, fixedTime: null, fixedOrder: null });
  }

  return <FormScreen title="장소 추가" subtitle={titleForTrip(trip)} back={busy ? () => {} : back} footer={<>
    {toast > 0 && <FormCard><View style={form.row}>
      <Text accessibilityLiveRegion="polite" style={[text.body, form.flex]}>✓ 이미 추가한 장소예요</Text>
      <SmallButton label="닫기" onPress={() => setToast(0)} />
    </View></FormCard>}
    <VisitCounts visits={visits} />
    <FormError message={error} />
    <ActionButton label={busy ? '여행 저장 중' : '동선 만들기'} busy={busy} onPress={generate} />
  </>}>
    <SearchBox label="장소 검색" search={search} />
    {state.status === 'loading' && <Skeleton />}
    {state.status === 'error' && <FormError message={state.error} />}
    {state.status === 'results' && <FormCard>
      {state.places.length ? <>
        {state.places.map(place => <View key={place.googlePlaceId} style={form.row}>
          <View style={form.flex}><Text style={text.place}>{place.name}</Text><PlaceCredits place={place} /></View>
          <SmallButton label={ids.has(place.googlePlaceId) ? '추가됨' : `${place.name} 추가`} disabled={busy} onPress={() => add(place)} />
        </View>)}
        <Text style={form.secondary}>{state.attribution}</Text>
      </> : <>
        <Text style={text.body} accessibilityLiveRegion="polite">검색 결과가 없어요</Text>
        <SmallButton label="검색어 지우기" onPress={() => search.change('')} />
      </>}
    </FormCard>}
    <VisitList visits={visits} filter={filter} onFilter={setFilter} edit={busy ? undefined : setEditing} />
    {editing && <VisitSheet trip={trip} current={visits} selected={editing} close={() => setEditing(null)}
      remove={ids.has(editing.googlePlaceId) ? () => {
        change(visits.filter(visit => visit.googlePlaceId !== editing.googlePlaceId)); setEditing(null);
      } : undefined}
      save={visit => {
        change(ids.has(visit.googlePlaceId)
          ? visits.map(old => old.googlePlaceId === visit.googlePlaceId ? visit : old) : [...visits, visit]);
        setEditing(null);
      }} />}
  </FormScreen>;
}
