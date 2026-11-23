import { useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { PermissionsAndroid, PixelRatio, Platform, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { colors, radius, result, size, spacing, text } from '../theme';
import { useReducedMotion } from '../theme/use-reduced-motion';
import { AirportEdgeIndicators } from './airport-edge-indicators';
import { PlacedMapMarker } from './placed-map-marker';
import { isMapConfigured } from './config';
import { arcPoints, midpointHeading, withAlpha } from './geometry';
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

/** Google Maps on Android takes pattern lengths in screen pixels and stroke widths in dp. */
function dashPattern(line: MapRouteSpec['line']) {
  if (line === 'SOLID') return undefined;
  const scale = Platform.OS === 'android' ? PixelRatio.get() : 1;
  return DASHES[line].map(length => length * scale);
}

/** Legs follow the road with a white outline; floating legs are a dashed arc over a ground shadow (§6). */
function Route({ route, dimmed }: { route: MapRouteSpec; dimmed: boolean }) {
  const points = pathPoints(route) as LatLng[];
  const opacity = dimmed || route.emphasis === 'DIM' ? result.route.dimOpacity : 1;
  const color = route.emphasis === 'CONFLICT' ? colors.red.text : route.color;
  const arrow = midpointHeading(points);
  // Explicit overlay order keeps the ink above its outline and selected roads above dimmed roads.
  const baseZ = route.emphasis === 'DIM' ? 0 : route.emphasis === 'CONFLICT' ? 4 : 2;
  const pattern = dashPattern(route.line);
  const ground = route.path.kind === 'ROAD' ? [...route.path.points] : [route.path.from, route.path.to];
  return <>
    {route.line === 'FLOATING' && <Polyline coordinates={ground} strokeWidth={ROUTE_WIDTH}
      strokeColor={withAlpha(colors.gray.text, 0.12 * opacity)} zIndex={baseZ} />}
    {route.path.kind === 'ROAD' && route.line !== 'FLOATING' && <Polyline coordinates={points} strokeWidth={OUTLINE}
      strokeColor={withAlpha(colors.card, opacity)} zIndex={baseZ} lineCap="round" lineDashPattern={pattern} />}
    <Polyline coordinates={points} strokeWidth={ROUTE_WIDTH} strokeColor={withAlpha(color, opacity)} zIndex={baseZ + 1}
      lineCap={route.line === 'FLOATING' ? 'butt' : 'round'} lineDashPattern={pattern} />
    {arrow && <Marker key={color} coordinate={arrow.point} rotation={arrow.heading} flat opacity={opacity}
      anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
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
      {/* Removing a dash pattern leaves cached strokes on both native Google adapters. */}
      {routes.map(route => <Route key={`${route.id}:${route.line}`} route={route} dimmed={dimmed} />)}
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
    {mapReady && viewport.width > 0 && viewport.height > 0 && <AirportEdgeIndicators map={map} markers={markers}
      viewport={viewport} focusDate={focusDate} cameraVersion={cameraVersion} topInset={topInset} bottomInset={bottomInset} />}
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
});
