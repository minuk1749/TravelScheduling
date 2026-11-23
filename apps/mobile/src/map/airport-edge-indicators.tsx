import { useEffect, useRef, useState, type ComponentRef, type RefObject } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type MapView from 'react-native-maps';
import { colors, radius, shadows, spacing, text } from '../theme';
import { offscreenSide, type EdgeSide } from './geometry';
import type { MapMarkerSpec, ResultMapProps } from './types';

type Props = Pick<ResultMapProps, 'markers' | 'focusDate' | 'topInset' | 'bottomInset'> & {
  map: RefObject<ComponentRef<typeof MapView> | null>;
  viewport: { width: number; height: number };
  cameraVersion: number;
};
type Point = { x: number; y: number };

export function AirportEdgeIndicators({ markers, focusDate, cameraVersion, ...props }: Props) {
  const airports = markers.filter(marker => marker.kind === 'AIRPORT');
  if (!airports.length) return null;
  const coordinates = airports.map(({ coordinate }) => [coordinate.latitude, coordinate.longitude]);
  // A different day, camera or native map size invalidates even an identical airport coordinate.
  const key = JSON.stringify([focusDate, cameraVersion, props.viewport.width, props.viewport.height, coordinates]);
  return <ProjectedEdges key={key} {...props} airports={airports} />;
}

function ProjectedEdges({ map, airports, viewport, topInset, bottomInset }: Pick<Props, 'map' | 'viewport' | 'topInset' | 'bottomInset'> & {
  airports: MapMarkerSpec[];
}) {
  // The parent remounts this projection batch when any coordinate changes. Labels can change independently.
  const sources = useRef(airports);
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

  const groups = new Map<EdgeSide, string[]>();
  airports.forEach(({ label }, index) => {
    const point = points.get(index);
    const edge = point && offscreenSide(point, viewport.width, topInset, viewport.height - bottomInset);
    if (edge) {
      const group = groups.get(edge) ?? [];
      group.push(label);
      groups.set(edge, group);
    }
  });
  if (!groups.size) return null;
  const bothSides = groups.has('LEFT') && groups.has('RIGHT');
  return <View pointerEvents="none" testID="airport-edges" style={[StyleSheet.absoluteFill, { top: topInset, bottom: bottomInset }]}>
    {[...groups].map(([edge, labels]) => <View key={edge} testID={`airport-edge-${edge}`}
      style={[StyleSheet.absoluteFill, styles.layer, styles[edge]]}>
      <View style={[styles.badge, bothSides && (edge === 'LEFT' || edge === 'RIGHT') && styles.sideBadge]}>
        <Text style={text.tiny}>✈ {labels.join(' · ')} · 화면 밖</Text>
      </View>
    </View>)}
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
});
