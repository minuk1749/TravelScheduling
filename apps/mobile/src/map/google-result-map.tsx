import { useEffect, useMemo, useRef, useState, type RefObject, type ComponentRef } from 'react';
import { PermissionsAndroid, Platform, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { colors, radius, result, shadows, size, spacing, text } from '../theme';
import { useReducedMotion } from '../theme/use-reduced-motion';
import { PlacedMapMarker } from './placed-map-marker';
import { isMapConfigured } from './config';
import { arcPoints, midpointHeading, offscreenSide, withAlpha } from './geometry';
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
    {route.path.kind === 'ROAD' && route.line !== 'FLOATING' && <Polyline coordinates={points} strokeWidth={OUTLINE} strokeColor={colors.card} zIndex={z} />}
    <Polyline coordinates={points} strokeWidth={ROUTE_WIDTH} strokeColor={color} zIndex={z} lineCap="round"
      lineDashPattern={route.line === 'SOLID' ? undefined : [...DASHES[route.line]]} />
    {arrow && <Marker coordinate={arrow.point} rotation={arrow.heading} flat anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
      <Text style={[text.tiny, { color }]}>▲</Text>
    </Marker>}
  </>;
}

function MarkerBody({ marker, selected }: { marker: MapMarkerSpec; selected: boolean }) {
  if (marker.kind === 'WISH') {
    return <View style={[styles.wish, selected && styles.selectedWish]}>
      <Text style={[text.tinyStrong, { color: colors.peach.text }]}>{ICONS.WISH} {marker.label}</Text>
    </View>;
  }
  return <View style={[styles.endpoint, marker.kind === 'AIRPORT' && styles.airport]}>
    <Text style={[text.tinyStrong, { color: colors.card }]}>{marker.kind === 'AIRPORT' ? ICONS.AIRPORT : ICONS.LODGING}</Text>
  </View>;
}

type MapSize = { width: number; height: number };

function AirportIndicator({ map, marker, viewport, topInset, bottomInset }: {
  map: RefObject<ComponentRef<typeof MapView> | null>; marker: MapMarkerSpec; viewport: MapSize;
  topInset: number; bottomInset: number;
}) {
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const { latitude, longitude } = marker.coordinate;
  useEffect(() => {
    let current = true;
    void map.current?.pointForCoordinate({ latitude, longitude }).then(
      projected => { if (current) setPoint(projected); },
      () => { if (current) setPoint(null); },
    );
    return () => { current = false; };
  }, [map, latitude, longitude]);
  const bottom = viewport.height - bottomInset;
  const side = point && offscreenSide(point, viewport.width, topInset, bottom);
  if (!side) return null;
  const middle = (topInset + bottom) / 2;
  const position = side === 'TOP' ? { top: topInset, alignSelf: 'center' as const }
    : side === 'BOTTOM' ? { bottom: bottomInset, alignSelf: 'center' as const }
      : side === 'LEFT' ? { left: 0, top: middle } : { right: 0, top: middle };
  return <View testID={`airport-edge-${marker.id}`} pointerEvents="none" style={[styles.edge, position]}>
    <Text style={text.tiny}>{ICONS.AIRPORT} {marker.label} · 화면 밖</Text>
  </View>;
}

export function GoogleResultMap(props: ResultMapProps) {
  if (!isMapConfigured()) {
    return <View style={[StyleSheet.absoluteFill, styles.unavailable, { paddingBottom: props.bottomInset }]}>
      <Text style={[text.secondary, { color: colors.gray.secondary }]}>지도를 표시할 수 없어요</Text>
    </View>;
  }
  return <ConfiguredMap {...props} />;
}

async function requestLocation(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const { ACCESS_COARSE_LOCATION: coarse, ACCESS_FINE_LOCATION: fine } = PermissionsAndroid.PERMISSIONS;
  const grants = await PermissionsAndroid.requestMultiple([coarse, fine]);
  return grants[coarse] === PermissionsAndroid.RESULTS.GRANTED || grants[fine] === PermissionsAndroid.RESULTS.GRANTED;
}

function ConfiguredMap({ markers, routes, selectedId, focusDate, focusIds, topInset, bottomInset, dimmed, locateRequest, onSelectMarker }: ResultMapProps) {
  const map = useRef<ComponentRef<typeof MapView>>(null);
  const [mapReady, setMapReady] = useState(false);
  const [cameraVersion, setCameraVersion] = useState(0);
  const [viewport, setViewport] = useState<MapSize>({ width: 0, height: 0 });
  const reduced = useReducedMotion();
  const [showUser, setShowUser] = useState(false);
  const user = useRef<LatLng | null>(null);
  const permission = useRef<Promise<boolean> | null>(null);
  // Card selections keep the user's camera position within the same day.
  const focusKey = useMemo(() => JSON.stringify(markers.filter(marker => focusIds.includes(marker.id))
    .map(marker => marker.coordinate)), [markers, focusIds]);

  useEffect(() => {
    const focus: LatLng[] = JSON.parse(focusKey);
    if (!mapReady || !focus.length) return;
    const edgePadding = { top: topInset + spacing.section, bottom: bottomInset + spacing.section, left: spacing.section * 2, right: spacing.section * 2 };
    if (viewport.width <= edgePadding.left + edgePadding.right || viewport.height <= edgePadding.top + edgePadding.bottom) return;
    map.current?.fitToCoordinates(focus, { edgePadding, animated: true });
  }, [focusDate, focusKey, topInset, bottomInset, mapReady, viewport.width, viewport.height]);

  useEffect(() => {
    if (!locateRequest) return;
    let active = true;
    permission.current ??= requestLocation().catch(() => false).finally(() => { permission.current = null; });
    void permission.current.then(granted => {
      if (!active) return;
      setShowUser(granted);
      if (!granted) user.current = null;
      else if (user.current) map.current?.animateCamera({ center: user.current });
    });
    return () => { active = false; };
  }, [locateRequest]);

  return <View style={StyleSheet.absoluteFill}>
    <MapView ref={map} style={StyleSheet.absoluteFill} provider={PROVIDER_GOOGLE} showsUserLocation={showUser}
      showsMyLocationButton={false} toolbarEnabled={false}
      onLayout={event => {
        const { width, height } = event.nativeEvent.layout;
        setViewport({ width, height });
      }}
      onMapReady={() => { setMapReady(true); setCameraVersion(version => version + 1); }}
      onRegionChangeComplete={() => setCameraVersion(version => version + 1)}
      onUserLocationChange={event => {
        const coordinate = event.nativeEvent.coordinate;
        if (!showUser || !coordinate) return;
        const first = !user.current;
        user.current = { latitude: coordinate.latitude, longitude: coordinate.longitude };
        if (first) map.current?.animateCamera({ center: user.current });
      }}>
      {routes.map(route => <Route key={route.id} route={route} dimmed={dimmed} />)}
      {markers.map(marker => {
        const selected = marker.id === selectedId;
        const opacity = (dimmed ? result.route.dimOpacity * 2 : 1) * (marker.kind === 'WISH' && !selected ? result.marker.wishOpacity : 1);
        if (marker.kind === 'PLACED') return <PlacedMapMarker key={marker.id} marker={marker} selected={selected}
          reduced={reduced} opacity={opacity} onPress={() => onSelectMarker(marker.id)} />;
        return <Marker key={marker.id} identifier={marker.id} coordinate={marker.coordinate} anchor={{ x: 0.5, y: 0.5 }}
          zIndex={selected ? 10 : 3} opacity={opacity} tracksViewChanges={selected}
          onPress={() => { if (marker.kind === 'WISH') onSelectMarker(marker.id); }}>
          <MarkerBody marker={marker} selected={selected} />
        </Marker>;
      })}
    </MapView>
    {mapReady && viewport.width > 0 && viewport.height > 0 && markers.filter(marker => marker.kind === 'AIRPORT').map(marker =>
      <AirportIndicator key={`${marker.id}:${marker.coordinate.latitude}:${marker.coordinate.longitude}:${cameraVersion}:${viewport.width}:${viewport.height}`}
        marker={marker} map={map} viewport={viewport} topInset={topInset} bottomInset={bottomInset} />)}
  </View>;
}

const styles = StyleSheet.create({
  unavailable: { backgroundColor: colors.gray.divider, alignItems: 'center', justifyContent: 'center' },
  wish: { flexDirection: 'row', paddingHorizontal: spacing.steps[1], paddingVertical: spacing.steps[0], borderRadius: radius.small,
    borderWidth: size.focusBorder, borderStyle: 'dashed', borderColor: colors.peach.marker, backgroundColor: colors.card },
  selectedWish: { backgroundColor: colors.peach.surface, borderStyle: 'solid' },
  endpoint: { width: MARKER, height: MARKER, borderRadius: spacing.steps[0], backgroundColor: colors.gray.text,
    alignItems: 'center', justifyContent: 'center' },
  airport: { backgroundColor: colors.gray.secondary },
  edge: { position: 'absolute', margin: spacing.steps[1], paddingHorizontal: spacing.cardGap, paddingVertical: spacing.steps[0],
    borderRadius: radius.chip, backgroundColor: colors.card, ...shadows.floating },
});
