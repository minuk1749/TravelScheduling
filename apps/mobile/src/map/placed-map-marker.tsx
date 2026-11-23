import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { Animated, Easing, Platform, StyleSheet, Text, useAnimatedValue, View } from 'react-native';
import { Marker } from 'react-native-maps';
import { colors, motion, result, size, text } from '../theme';
import { withAlpha } from './geometry';
import type { MapMarkerSpec } from './types';

const DIAMETER = size.checkbox + 2;
const FRAME = Math.ceil(DIAMETER * result.marker.selectedScale + 2 * result.marker.ring);
const easing = Easing.bezier(...motion.panel.bezier);

/** Google Maps snapshots the custom view into a bitmap. Keep its measured bounds fixed across both directions. */
export function PlacedMapMarker({ marker, selected, reduced, opacity, onPress }: {
  marker: MapMarkerSpec; selected: boolean; reduced: boolean; opacity: number; onPress(): void;
}) {
  const native = useRef<ComponentRef<typeof Marker>>(null);
  const progress = useAnimatedValue(selected ? 1 : 0);
  const [frame, setFrame] = useState(selected ? 1 : 0);
  const target = useRef(selected);
  useEffect(() => {
    if (target.current === selected) return;
    target.current = selected;
    const listener = progress.addListener(({ value }) => setFrame(value));
    // Apply each frame to the marker content before asking Android to refresh its bitmap.
    const animation = Animated.timing(progress, { toValue: selected ? 1 : 0,
      duration: motion.panel.duration, easing, useNativeDriver: false });
    animation.start();
    return () => { animation.stop(); progress.removeListener(listener); };
  }, [progress, selected]);

  const tracking = frame !== (selected ? 1 : 0);
  useEffect(() => {
    if (Platform.OS === 'android' || !tracking) native.current?.redraw?.();
  }, [frame, marker.order, reduced, tracking]);
  const scale = 1 + (result.marker.selectedScale - 1) * frame;
  const selectedScale = reduced ? result.marker.selectedScale : scale;
  const ring = DIAMETER * selectedScale + 2 * result.marker.ring;
  const number = marker.order ?? '!';
  return <Marker ref={native} identifier={marker.id} coordinate={marker.coordinate} anchor={{ x: 0.5, y: 0.5 }}
    zIndex={selected ? 10 : 5} opacity={opacity} tracksViewChanges={tracking} onPress={onPress}>
    <View collapsable={false} style={styles.frame} onLayout={() => native.current?.redraw?.()}>
      <View style={[styles.disc, !reduced && { transform: [{ scale }] }]}>
        <Text style={[text.tinyStrong, styles.label]}>{number}</Text>
      </View>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
        style={[styles.ring, { opacity: frame, width: ring, height: ring, borderRadius: ring / 2 }]}>
        <View style={[styles.disc, styles.selected, { transform: [{ scale: selectedScale }] }]}><Text style={[text.tinyStrong, styles.selectedLabel]}>{number}</Text></View>
      </View>
    </View>
  </Marker>;
}

const styles = StyleSheet.create({
  frame: { width: FRAME, height: FRAME, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute',
    backgroundColor: withAlpha(colors.sky.primary, 0.25), alignItems: 'center', justifyContent: 'center' },
  disc: { width: DIAMETER, height: DIAMETER, borderRadius: DIAMETER / 2, borderWidth: 2, borderColor: colors.sky.primary,
    backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  selected: { backgroundColor: colors.sky.primary, borderColor: colors.card },
  label: { color: colors.sky.text },
  selectedLabel: { color: colors.card },
});
