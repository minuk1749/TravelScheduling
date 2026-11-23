import { Children, type ComponentProps, type ReactElement, type Ref } from 'react';
import { Animated, Easing, Platform, StyleSheet, View } from 'react-native';
import { act, render } from '@testing-library/react-native';
import { GoogleResultMap } from '../src/map/google-result-map';
import { motion, result, size } from '../src/theme';

const mockRedraw = jest.fn();
let mockReduced = false;
jest.mock('../src/theme/use-reduced-motion', () => ({ useReducedMotion: () => mockReduced }));
jest.mock('../src/map/config', () => ({ isMapConfigured: () => true }));
let mockMarker: { identifier: string; tracksViewChanges: boolean; zIndex: number; children: ReactElement<ComponentProps<typeof View>> };
jest.mock('react-native-maps', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { View: NativeView } = jest.requireActual<typeof import('react-native')>('react-native');
  return { __esModule: true, default: NativeView, Polyline: NativeView, Marker: (props: typeof mockMarker & { ref: Ref<{ redraw: typeof mockRedraw }> }) => {
    mockMarker = props;
    React.useImperativeHandle(props.ref, () => ({ redraw: mockRedraw }));
    return <NativeView>{props.children}</NativeView>;
  } };
});
const marker = { id: 'visit', kind: 'PLACED' as const, order: 1, label: '방문', coordinate: { latitude: 35, longitude: 139 } };
const draw = (selected: boolean) => <GoogleResultMap markers={[marker]} routes={[]} selectedId={selected ? marker.id : null}
  focusDate="2026-12-01" focusIds={[marker.id]} topInset={0} bottomInset={0} locateRequest={0} dimmed={false} onSelectMarker={() => {}} />;
function layers() {
  const frame = mockMarker.children;
  const children = Children.toArray(frame.props.children) as ReactElement<ComponentProps<typeof View>>[];
  const selected = Children.only(children[1].props.children) as ReactElement<ComponentProps<typeof View>>;
  return { frame: StyleSheet.flatten(frame.props.style) ?? {}, selected: StyleSheet.flatten(selected.props.style) ?? {},
    base: StyleSheet.flatten(children[0].props.style) ?? {}, ring: StyleSheet.flatten(children[1].props.style) ?? {} };
}
afterEach(() => { jest.restoreAllMocks(); mockRedraw.mockClear(); });

test.each([false, true])('Android marker samples selection and deselection within fixed bounds (reduce motion %s)', async reduced => {
  mockReduced = reduced;
  jest.replaceProperty(Platform, 'OS', 'android');
  const animate = jest.spyOn(Animated, 'timing').mockImplementation(() => ({ start() {}, stop() {}, reset() {} }));
  const rendered = await render(draw(false));
  expect(animate).not.toHaveBeenCalled();
  expect(mockMarker.tracksViewChanges).toBe(false);
  const diameter = size.checkbox + 2;
  const frameSize = Math.ceil(diameter * result.marker.selectedScale + 2 * result.marker.ring);
  expect(layers().frame).toMatchObject({ width: frameSize, height: frameSize });
  expect(layers().ring.opacity).toBe(0);

  await rendered.rerender(draw(true));
  expect(mockMarker.tracksViewChanges).toBe(true);
  expect(mockMarker.zIndex).toBe(10);
  const [value, timing] = animate.mock.calls[0];
  expect(timing).toMatchObject({ duration: motion.panel.duration, useNativeDriver: false, toValue: 1 });
  expect(timing.easing?.(0.35)).toBeCloseTo(Easing.bezier(...motion.panel.bezier)(0.35));
  const sample = async (fraction: number) => { await act(async () => { (value as Animated.Value).setValue(fraction); }); };
  mockRedraw.mockClear();
  await sample(0.5);
  const halfway = layers();
  expect(halfway.ring.opacity).toBe(0.5);
  const scale = reduced ? result.marker.selectedScale : (1 + result.marker.selectedScale) / 2;
  expect(halfway.ring.width).toBeCloseTo(diameter * scale + 2 * result.marker.ring);
  expect(halfway.selected.transform).toEqual([{ scale }]);
  expect(halfway.base.transform).toEqual(reduced ? undefined : [{ scale }]);
  expect(mockRedraw).toHaveBeenCalled();
  await sample(1);
  expect(layers().selected.transform).toEqual([{ scale: result.marker.selectedScale }]);
  expect(mockMarker.tracksViewChanges).toBe(false);
  expect(layers().frame).toMatchObject({ width: frameSize, height: frameSize });

  await rendered.rerender(draw(false));
  expect(mockMarker.tracksViewChanges).toBe(true);
  expect(animate.mock.calls[1][1]).toMatchObject({ duration: motion.panel.duration, toValue: 0 });
  mockRedraw.mockClear();
  await sample(0.25);
  expect(layers().ring.opacity).toBe(0.25);
  if (reduced) expect(layers().selected.transform).toEqual([{ scale: result.marker.selectedScale }]);
  await sample(0);
  expect(layers().ring.opacity).toBe(0);
  expect(mockMarker.tracksViewChanges).toBe(false);
  expect(mockRedraw).toHaveBeenCalled();
  expect(mockMarker.zIndex).toBe(5);
});
