import { useEffect, useRef, useState, type ComponentRef, type RefObject } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import type MapView from 'react-native-maps';
import { colors, radius, shadows, spacing, text } from '../theme';
import { placeEdgeBadge } from './edge-layout';
import { offscreenSide, type EdgeSide } from './geometry';
import type { MapMarkerSpec, MapRect, ResultMapProps } from './types';

type Props = Pick<ResultMapProps, 'markers' | 'focusDate' | 'topInset' | 'bottomInset' | 'overlay'> & {
  map: RefObject<ComponentRef<typeof MapView> | null>;
  viewport: { width: number; height: number };
  cameraVersion: number;
};
type Size = Pick<MapRect, 'width' | 'height'>;
const EMPTY = { left: 0, right: 0, controls: [], awaitingLayout: false };
type Point = { x: number; y: number };

export function AirportEdgeIndicators({ markers, focusDate, cameraVersion, ...props }: Props) {
  const airports = markers.filter(marker => marker.kind === 'AIRPORT');
  if (!airports.length) return null;
  const coordinates = airports.map(({ coordinate }) => [coordinate.latitude, coordinate.longitude]);
  // A different day, camera or native map size invalidates even an identical airport coordinate.
  const key = JSON.stringify([focusDate, cameraVersion, props.viewport.width, props.viewport.height, coordinates]);
  return <ProjectedEdges key={key} {...props} airports={airports} />;
}

function ProjectedEdges({ map, airports, viewport, topInset, bottomInset, overlay = EMPTY }: Pick<Props, 'map' | 'viewport' | 'topInset' | 'bottomInset' | 'overlay'> & {
  airports: MapMarkerSpec[];
}) {
  // The parent remounts this projection batch when any coordinate changes. Labels can change independently.
  const sources = useRef(airports);
  const [sizes, setSizes] = useState<Partial<Record<EdgeSide, Size>>>({});
  const [points, setPoints] = useState<ReadonlyMap<number, Point>>(() => new Map());
  useEffect(() => {
    let current = true;
    sources.current.forEach(({ coordinate }, index) => {
      void map.current?.pointForCoordinate(coordinate).then(point => {
        if (current) setPoints(previous => new Map(previous).set(index, point));
      }, () => { /* Other airports can still be projected. */ });
    });
    return () => { current = false; };
  }, [map]);

  const { left, right, controls } = overlay;
  const bounds = { x: left, y: topInset, width: viewport.width - left - right, height: viewport.height - topInset - bottomInset };
  const groups = new Map<EdgeSide, string[]>();
  airports.forEach(({ label }, index) => {
    const point = points.get(index);
    if (!point) return;
    const covered = controls.some(rect => point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height);
    const edge = offscreenSide({ x: point.x - left, y: point.y }, bounds.width, topInset, viewport.height - bottomInset, covered);
    if (edge) {
      const group = groups.get(edge) ?? [];
      group.push(label);
      groups.set(edge, group);
    }
  });
  if (!groups.size) return null;
  const bothSides = groups.has('LEFT') && groups.has('RIGHT');
  const blocked = [...controls];
  const measure = (side: EdgeSide) => (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSizes(previous => previous[side]?.width === width && previous[side]?.height === height ? previous : { ...previous, [side]: { width, height } });
  };
  return <View pointerEvents="none" testID="airport-edges" style={[StyleSheet.absoluteFill, { left, right, top: topInset, bottom: bottomInset }]}>
    {[...groups].map(([edge, labels]) => {
      const size = sizes[edge];
      const placement = size && placeEdgeBadge(edge, size, bounds, blocked, spacing.steps[1]);
      const position = placement ? { transform: [{ translateX: placement.translateX }, { translateY: placement.translateY }] }
        : blocked.length ? styles.measuring : undefined;
      if (placement) blocked.push(placement.rect);
      return <View key={edge} testID={`airport-edge-${edge}`} style={[StyleSheet.absoluteFill, styles.layer, styles[edge]]}>
        <View onLayout={measure(edge)} style={[styles.badge, bothSides && (edge === 'LEFT' || edge === 'RIGHT') && styles.sideBadge, position, overlay.awaitingLayout && styles.measuring]}>
          <Text style={text.tiny}>✈ {labels.join(' · ')} · 화면 밖</Text>
        </View>
      </View>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  layer: { padding: spacing.steps[1] },
  TOP: { alignItems: 'center', justifyContent: 'flex-start' },
  BOTTOM: { alignItems: 'center', justifyContent: 'flex-end' },
  LEFT: { alignItems: 'flex-start', justifyContent: 'center' },
  RIGHT: { alignItems: 'flex-end', justifyContent: 'center' },
  badge: { maxWidth: '100%', paddingHorizontal: spacing.cardGap, paddingVertical: spacing.steps[0],
    borderRadius: radius.chip, backgroundColor: colors.card, ...shadows.floating },
  sideBadge: { maxWidth: '50%' },
  measuring: { opacity: 0 },
});
