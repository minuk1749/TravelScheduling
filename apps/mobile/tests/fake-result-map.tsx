import { Pressable, Text, View } from 'react-native';
import type { ResultMapProps } from '../src/map/types';

/**
 * Test double of the result map adapter (architecture §13.5). Markers are buttons named "지도 {label}"
 * whose text shows kind/order; every route renders "order mode line emphasis color pathKind".
 */
export function FakeResultMap({ markers, routes, selectedId, dimmed, focusIds, onSelectMarker }: ResultMapProps) {
  return <View testID="result-map">
    <Text testID="map-state">{`${dimmed ? 'dimmed' : 'clear'} focus:${focusIds.join(',')}`}</Text>
    {markers.map(marker => <Pressable key={marker.id} testID={`marker-${marker.id}`} accessibilityRole="button"
      accessibilityLabel={`지도 ${marker.label}`} accessibilityState={{ selected: marker.id === selectedId }}
      onPress={() => onSelectMarker(marker.id)}>
      <Text>{`${marker.kind} ${marker.order ?? '-'}`}</Text>
    </Pressable>)}
    {markers.map(marker => <Text key={marker.id} testID={`coordinate-${marker.id}`}>{JSON.stringify(marker.coordinate)}</Text>)}
    {routes.map(route => <View key={route.id}>
      <Text testID={`route-${route.id}`}>{`${route.order} ${route.mode} ${route.line} ${route.emphasis} ${route.color} ${route.path.kind}`}</Text>
      {route.path.kind === 'ROAD' ? <Text testID={`points-${route.id}`}>{JSON.stringify(route.path.points)}</Text>
        : <Text testID={`straight-${route.id}`}>{JSON.stringify([route.path.from, route.path.to])}</Text>}
    </View>)}
  </View>;
}
