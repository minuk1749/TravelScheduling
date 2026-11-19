import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import MapView, { PROVIDER_GOOGLE, type LatLng } from 'react-native-maps';
import type { PlaceSummary } from '@travel/core/contracts/places';
import { useTripApi } from '../../api/trips';
import { FormError, FormSheet } from '../../components/input/form-layout';
import { Skeleton } from '../../components/input/skeleton';
import { spacing, text } from '../../theme';

function isMapConfigured() {
  return Platform.OS === 'ios'
    ? process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_API_KEY
    : process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY;
}

export function LodgingMap({ city, region, select, close }: {
  city: string; region?: string; select(place: PlaceSummary): void; close(): void;
}) {
  return <FormSheet title="지도에서 위치 선택" close={close}>
    {isMapConfigured() ? <MapPicker city={city} region={region} select={select} />
      : <FormError message="지도를 사용할 수 없어요. 주소 직접 입력을 이용해 주세요." />}
  </FormSheet>;
}

function MapPicker({ city, region, select }: { city: string; region?: string; select(place: PlaceSummary): void }) {
  const api = useTripApi();
  const [coordinates, setCoordinates] = useState<LatLng | null>(null);
  useEffect(() => {
    const request = new AbortController();
    async function locate() {
      try {
        const { places } = await api.search(city, region, request.signal);
        if (places.length) {
          const { place } = await api.location(places[0].googlePlaceId, request.signal);
          if (!request.signal.aborted) { setCoordinates(place.coordinates); return; }
        }
      } catch { /* The user can still navigate the map. */ }
      if (!request.signal.aborted) setCoordinates({ latitude: 0, longitude: 0 });
    }
    void locate();
    return () => request.abort();
  }, [api, city, region]);
  if (!coordinates) return <Skeleton />;
  return <View style={styles.picker}>
    <Text style={text.body}>지도에서 숙소 이름을 눌러 주세요.</Text>
    <MapView testID="lodging-map" style={styles.map} provider={PROVIDER_GOOGLE}
      initialRegion={{ ...coordinates, latitudeDelta: 0.08, longitudeDelta: 0.08 }}
      onPoiClick={({ nativeEvent }) => {
        if (nativeEvent.placeId && nativeEvent.name) select({
          googlePlaceId: nativeEvent.placeId, name: nativeEvent.name, attributions: [],
        });
      }} />
  </View>;
}

const styles = StyleSheet.create({
  picker: { gap: spacing.cardGap },
  map: { height: spacing.section * 12 },
});
