import { useState } from 'react';
import { Text, View } from 'react-native';
import type { PlaceSummary } from '@travel/core/contracts/places';
import { SmallButton, type FocusRequest } from '../../components/input/fields';
import { FormError, form } from '../../components/input/form-layout';
import { PlaceCredits, SearchBox, usePlaceSearch } from '../../components/input/place-search';
import { Skeleton } from '../../components/input/skeleton';
import { text } from '../../theme';
import { LodgingMap } from './lodging-map';

export function PlacePicker({ label, region, value, onChange, error, focus, lodgingCity }: {
  label: string; region?: string; value?: PlaceSummary; onChange(value?: PlaceSummary): void;
  error?: string; focus?: FocusRequest; lodgingCity?: string;
}) {
  const search = usePlaceSearch(region);
  const { state } = search;
  const [mode, setMode] = useState<'name' | 'address' | 'map'>('name');
  const choose = (place: PlaceSummary) => {
    onChange(place);
    search.change('');
    setMode('name');
  };
  return <View style={form.stack}>
    <Text style={text.body}>{label}</Text>
    {value && <View style={form.stack}>
      <Text style={text.place}>{value.name}</Text>
      <PlaceCredits place={value} />
      <Text style={form.secondary}>Google Maps</Text>
      <SmallButton label={`${label} 변경`} onPress={() => onChange(undefined)} />
    </View>}
    {!value && <SearchBox label={mode === 'address' ? `${label} 주소` : `${label} 검색`} search={search} focus={focus} />}
    <FormError message={error} />
    {state.status === 'loading' && <Skeleton />}
    {state.status === 'error' && <FormError message={state.error} />}
    {state.status === 'results' && <View style={form.stack}>
      {state.places.length ? state.places.map(place => <View key={place.googlePlaceId}>
        <SmallButton label={place.name} onPress={() => choose(place)} />
        <PlaceCredits place={place} />
      </View>) : <>
        <Text accessibilityLiveRegion="polite" style={text.body}>검색 결과가 없어요</Text>
        {lodgingCity !== undefined && <View style={form.wrap}>
          <SmallButton label="지도에서 위치 선택" onPress={() => setMode('map')} />
          <SmallButton label="주소 직접 입력" onPress={() => { setMode('address'); search.change(''); }} />
        </View>}
      </>}
      {state.places.length > 0 && <Text style={form.secondary}>{state.attribution}</Text>}
    </View>}
    {mode === 'map' && <LodgingMap city={lodgingCity ?? ''} region={region} select={choose} close={() => setMode('name')} />}
  </View>;
}
