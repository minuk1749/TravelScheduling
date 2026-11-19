import { useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { PermissionsAndroid, Platform, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, type Region as MapRegion } from 'react-native-maps';
import { colors, radius, result, shadows, size, spacing, text } from '../theme';
import { isMapConfigured } from './config';
import { arcPoints, midpointHeading, offscreenSide, withAlpha, type EdgeSide, type Region } from './geometry';
import type { LatLng, MapMarkerSpec, MapRouteSpec, ResultMapProps } from './types';

const ROUTE_WIDTH = spacing.steps[0] + 1;
const OUTLINE = ROUTE_WIDTH + 3;
const DASHES = { DOTTED: [1, ROUTE_WIDTH * 2], FLOATING: [ROUTE_WIDTH * 2, ROUTE_WIDTH * 1.5] } as const;
const MARKER = size.checkbox + 2;
const ICONS = { LODGING: '⌂', AIRPORT: '✈', WISH: '★' } as const;

function pathPoints(route: MapRouteSpec): readonly LatLng[] {
  const ends = route.path.kind === 'ROAD' ? [route.path.points[0], route.path.points.at(-1)!] : [route.path.from, route.path.to];
  if (route.line === 'FLOATING') return arcPoints(ends[0], ends[1]);
  return route.path.kind === 'ROAD' ? route.path.points : ends;
}

function strokeColor(route: MapRouteSpec, dimmed: boolean) {
  if (route.emphasis === 'CONFLICT') return colors.red.text;
  return route.emphasis === 'DIM' || dimmed ? withAlpha(route.color, result.route.dimOpacity) : route.color;
}

/** Legs follow the road with a white outline; floating legs are a dashed arc over a ground shadow (§6). */
function Route({ route, dimmed }: { route: MapRouteSpec; dimmed: boolean }) {
  const points = pathPoints(route) as LatLng[];
  const color = strokeColor(route, dimmed);
  const arrow = midpointHeading(points);
  const z = route.emphasis === 'DIM' ? 1 : 2;
  const ground = route.path.kind === 'ROAD' ? [...route.path.points] : [route.path.from, route.path.to];
  return <>
    {route.line === 'FLOATING' && <Polyline coordinates={ground} strokeWidth={ROUTE_WIDTH}
      strokeColor={withAlpha(colors.gray.text, 0.12)} zIndex={z} />}
    {route.line !== 'FLOATING' && <Polyline coordinates={points} strokeWidth={OUTLINE} strokeColor={colors.card} zIndex={z} />}
    <Polyline coordinates={points} strokeWidth={ROUTE_WIDTH} strokeColor={color} zIndex={z} lineCap="round"
      lineDashPattern={route.line === 'SOLID' ? undefined : [...DASHES[route.line]]} />
    {arrow && <Marker coordinate={arrow.point} rotation={arrow.heading} flat anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
      <Text style={[text.tiny, { color }]}>▲</Text>
    </Marker>}
  </>;
}

function MarkerBody({ marker, selected }: { marker: MapMarkerSpec; selected: boolean }) {
  if (marker.kind === 'PLACED') {
    return <View style={[styles.ring, selected && styles.selectedRing]}>
      <View style={[styles.placed, selected && styles.selectedPlaced]}>
        <Text style={[text.tinyStrong, { color: selected ? colors.card : colors.sky.text }]}>{marker.order ?? '!'}</Text>
      </View>
    </View>;
  }
  if (marker.kind === 'WISH') {
    return <View style={[styles.wish, selected && styles.selectedWish]}>
      <Text style={[text.tinyStrong, { color: colors.peach.text }]}>{ICONS.WISH} {marker.label}</Text>
    </View>;
  }
  return <View style={[styles.endpoint, marker.kind === 'AIRPORT' && styles.airport]}>
    <Text style={[text.tinyStrong, { color: colors.card }]}>{ICONS[marker.kind]}</Text>
  </View>;
}

const EDGE: Record<EdgeSide, object> = {
  TOP: { top: 0, alignSelf: 'center' }, BOTTOM: { bottom: 0, alignSelf: 'center' },
  LEFT: { left: 0, top: '45%' }, RIGHT: { right: 0, top: '45%' },
};

export function GoogleResultMap(props: ResultMapProps) {
  if (!isMapConfigured()) {
    return <View style={[StyleSheet.absoluteFill, styles.unavailable, { paddingBottom: props.bottomInset }]}>
      <Text style={[text.secondary, { color: colors.gray.secondary }]}>지도를 표시할 수 없어요</Text>
    </View>;
  }
  return <ConfiguredMap {...props} />;
}

function ConfiguredMap({ markers, routes, selectedId, focusIds, topInset, bottomInset, dimmed, locateRequest, onSelectMarker }: ResultMapProps) {
  const map = useRef<ComponentRef<typeof MapView>>(null);
  const [region, setRegion] = useState<Region | null>(null);
  const [showUser, setShowUser] = useState(false);
  const user = useRef<LatLng | null>(null);
  // A primitive key refits the camera only when the day's places change, not on every selection.
  const focusKey = useMemo(() => JSON.stringify(markers.filter(marker => focusIds.includes(marker.id))
    .map(marker => marker.coordinate)), [markers, focusIds]);

  useEffect(() => {
    const focus: LatLng[] = JSON.parse(focusKey);
    if (!focus.length) return;
    const edgePadding = { top: topInset + spacing.section, bottom: bottomInset + spacing.section, left: spacing.section * 2, right: spacing.section * 2 };
    map.current?.fitToCoordinates(focus, { edgePadding, animated: true });
  }, [focusKey, topInset, bottomInset]);

  useEffect(() => {
    if (!locateRequest) return;
    let active = true;
    const permitted = Platform.OS === 'android'
      ? PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION).then(value => value === PermissionsAndroid.RESULTS.GRANTED)
      : Promise.resolve(true);
    void permitted.then(granted => {
      if (!active || !granted) return;
      setShowUser(true);
      if (user.current) map.current?.animateCamera({ center: user.current });
    });
    return () => { active = false; };
  }, [locateRequest]);

  const offscreen = region ? markers.filter(marker => marker.kind === 'AIRPORT').flatMap(marker => {
    const side = offscreenSide(region, marker.coordinate);
    return side ? [{ marker, side }] : [];
  }) : [];

  return <View style={StyleSheet.absoluteFill}>
    <MapView ref={map} style={StyleSheet.absoluteFill} provider={PROVIDER_GOOGLE} showsUserLocation={showUser}
      showsMyLocationButton={false} toolbarEnabled={false}
      onRegionChangeComplete={(next: MapRegion) => setRegion(next)}
      onUserLocationChange={event => {
        const coordinate = event.nativeEvent.coordinate;
        const first = !user.current;
        if (coordinate) user.current = { latitude: coordinate.latitude, longitude: coordinate.longitude };
        if (first && user.current && showUser) map.current?.animateCamera({ center: user.current });
      }}>
      {routes.map(route => <Route key={route.id} route={route} dimmed={dimmed} />)}
      {markers.map(marker => {
        const selected = marker.id === selectedId;
        const opacity = (dimmed ? result.route.dimOpacity * 2 : 1) * (marker.kind === 'WISH' && !selected ? result.marker.wishOpacity : 1);
        return <Marker key={marker.id} identifier={marker.id} coordinate={marker.coordinate} anchor={{ x: 0.5, y: 0.5 }}
          zIndex={selected ? 10 : marker.kind === 'PLACED' ? 5 : 3} opacity={opacity} tracksViewChanges={selected}
          onPress={() => { if (marker.kind === 'PLACED' || marker.kind === 'WISH') onSelectMarker(marker.id); }}>
          <MarkerBody marker={marker} selected={selected} />
        </Marker>;
      })}
    </MapView>
    {offscreen.map(({ marker, side }) => <View key={marker.id} pointerEvents="none"
      style={[styles.edge, EDGE[side], side === 'TOP' && { top: topInset }, side === 'BOTTOM' && { bottom: bottomInset }]}>
      <Text style={text.tiny}>{ICONS.AIRPORT} {marker.label} · 화면 밖</Text>
    </View>)}
  </View>;
}

const styles = StyleSheet.create({
  unavailable: { backgroundColor: colors.gray.divider, alignItems: 'center', justifyContent: 'center' },
  ring: { padding: result.marker.ring, borderRadius: MARKER },
  selectedRing: { backgroundColor: withAlpha(colors.sky.primary, 0.25), transform: [{ scale: result.marker.selectedScale }] },
  placed: { width: MARKER, height: MARKER, borderRadius: MARKER / 2, borderWidth: 2, borderColor: colors.sky.primary,
    backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  selectedPlaced: { backgroundColor: colors.sky.primary, borderColor: colors.card },
  wish: { flexDirection: 'row', paddingHorizontal: spacing.steps[1], paddingVertical: spacing.steps[0], borderRadius: radius.small,
    borderWidth: size.focusBorder, borderStyle: 'dashed', borderColor: colors.peach.marker, backgroundColor: colors.card },
  selectedWish: { backgroundColor: colors.peach.surface, borderStyle: 'solid' },
  endpoint: { width: MARKER, height: MARKER, borderRadius: spacing.steps[0], backgroundColor: colors.gray.text,
    alignItems: 'center', justifyContent: 'center' },
  airport: { backgroundColor: colors.gray.secondary },
  edge: { position: 'absolute', margin: spacing.steps[1], paddingHorizontal: spacing.cardGap, paddingVertical: spacing.steps[0],
    borderRadius: radius.chip, backgroundColor: colors.card, ...shadows.floating },
});
