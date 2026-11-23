import type { ReactNode, Ref } from 'react';
import { PermissionsAndroid, Platform, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { GoogleResultMap } from '../src/map/google-result-map';
import { InitialResult } from '../src/screens/result/place-panel';
import type { ResultMapProps } from '../src/map/types';
import { colors, result, spacing } from '../src/theme';
import { deferred, json } from './helpers';
import { D2, openResult, plan, resultFixture, trip, REVISION } from './result-fixture';

const mockFit = jest.fn(), mockAnimate = jest.fn();
jest.mock('./fake-result-map', () => ({ FakeResultMap: jest.requireActual('../src/map/google-result-map').GoogleResultMap }));
jest.mock('../src/map/config', () => ({ isMapConfigured: () => true }));
jest.mock('react-native-maps', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { __esModule: true, PROVIDER_GOOGLE: 'google', Marker: View, Polyline: View,
    default: function NativeMap({ ref, ...props }: {
      ref: Ref<{ fitToCoordinates: typeof mockFit; animateCamera: typeof mockAnimate }>; children: ReactNode;
    }) {
      React.useImperativeHandle(ref, () => ({ fitToCoordinates: mockFit, animateCamera: mockAnimate }));
      return <View testID="map" {...props} />;
    } };
});
const coordinate = { latitude: 35.68, longitude: 139.76 };
const props: ResultMapProps = {
  markers: [{ id: 'visit', kind: 'PLACED', order: 1, label: '방문지', coordinate }], routes: [], focusDate: '2026-12-03', focusIds: ['visit'],
  selectedId: null, topInset: 70, bottomInset: 250, locateRequest: 0, dimmed: false, onSelectMarker() {},
};
const map = () => screen.getByTestId('map');
const layout = (width: number, height: number) => fireEvent(map(), 'layout', { nativeEvent: { layout: { width, height } } });
const ready = () => fireEvent(map(), 'mapReady');
const location = () => fireEvent(map(), 'userLocationChange', { nativeEvent: { coordinate } });

afterEach(() => { jest.restoreAllMocks(); jest.clearAllMocks(); });

test('keeps native Google attribution above the panel even when there is no camera fit', async () => {
  const empty = { ...props, markers: [], focusIds: [], overlay: { left: 34, right: 12, controls: [] } };
  const rendered = await render(<GoogleResultMap {...empty} />);
  const insets = { top: 70, bottom: 250, left: 34, right: 12 };
  expect(map().props.mapPadding?.bottom ?? 0).toBe(250);
  expect(map()).toHaveProp('mapPadding', insets);
  await layout(400, 800);
  await ready();
  await fireEvent(map(), 'regionChangeComplete');
  expect(map()).toHaveProp('mapPadding', insets);
  await rendered.rerender(<GoogleResultMap {...empty} bottomInset={120} />);
  expect(map()).toHaveProp('mapPadding', { ...insets, bottom: 120 });
  expect(mockFit).not.toHaveBeenCalled();
});

test('opening the full schedule covers every map pixel until the normal credit strip is restored', async () => {
  await openResult(resultFixture());
  const ordinary = map().props.mapPadding;
  await fireEvent.press(screen.getByRole('button', { name: '전체 일정' }));
  expect(screen.getByTestId('expanded-sheet')).toBeOnTheScreen();
  expect(screen.getByTestId('result-map-cover')).toHaveStyle({
    position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: colors.background,
  });
  await fireEvent.press(screen.getByRole('button', { name: '닫기' }));
  expect(screen.queryByTestId('result-map-cover')).toBeNull();
  expect(map()).toHaveProp('mapPadding', ordinary);
});

test.each(['이 장소 수정', '희망 장소 추가, 1곳 중 선택'])('keeps native credits above the measured sheet opened by %s', async button => {
  await openResult(resultFixture());
  const resize = (id: string, y: number, height: number) => act(async () => {
    screen.getByTestId(id).props.onLayout?.({ nativeEvent: { layout: { x: 0, y, width: 400, height } } });
  });
  await resize('result-screen', 0, 800);
  await resize('result-top-controls', 0, 125);
  const ordinary = map().props.mapPadding;
  await fireEvent.press(screen.getByRole('button', { name: button }));
  await resize('form-sheet', 250, 550);
  expect(map().props.mapPadding.bottom).toBe(550);
  expect(screen.getByTestId('result-shade-above-credits')).toHaveStyle({ bottom: 550 + result.mapAttributionHeight });
  expect(screen.getByTestId('result-shade-below-credits')).toHaveStyle({ height: 550, bottom: 0 });
  expect(screen.queryByTestId('result-map-cover')).toBeNull();
  expect(screen.queryByTestId('map-legend')).toBeNull();
  // The keyboard can move the sheet above the map's remaining legal attribution area.
  await resize('form-sheet', 125 + result.mapAttributionHeight - 1, 480);
  expect(screen.getByTestId('result-map-cover')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '취소' }));
  expect(screen.queryByTestId('result-map-cover')).toBeNull();
  expect(map()).toHaveProp('mapPadding', ordinary);
});

test('the first calculation respects the panel and landscape safe area before any map coordinates exist', async () => {
  const safe = jest.mocked(useSafeAreaInsets);
  const initial = safe.getMockImplementation();
  safe.mockReturnValue({ top: 12, bottom: 21, left: 47, right: 34 });
  try {
    await render(<InitialResult map={GoogleResultMap} back={() => {}} />);
    const height = StyleSheet.flatten(screen.getByTestId('initial-place-panel').props.style).height;
    expect(height).toBeGreaterThan(0);
    expect(map()).toHaveProp('mapPadding', { top: 12, bottom: height, left: 47, right: 34 });
    expect(mockFit).not.toHaveBeenCalled();
  } finally {
    if (initial) safe.mockImplementation(initial);
  }
});

test.each(['layout first', 'ready first'])('fits after layout and map readiness (%s); a pan preserves the camera', async order => {
  const rendered = await render(<GoogleResultMap {...props} />);
  expect(mockFit).not.toHaveBeenCalled();
  if (order === 'layout first') {
    await layout(400, 800);
    await fireEvent(map(), 'regionChangeComplete');
    expect(mockFit).not.toHaveBeenCalled();
    await ready();
  } else {
    await ready();
    await layout(0, 800);
    await layout(400, 330);
    expect(mockFit).not.toHaveBeenCalled();
    await layout(400, 800);
  }
  expect(mockFit).toHaveBeenCalledTimes(1);
  expect(mockFit).toHaveBeenLastCalledWith([coordinate], { animated: true, edgePadding: {
    top: spacing.section, bottom: spacing.section, left: 2 * spacing.section, right: 2 * spacing.section,
  } });
  await fireEvent(map(), 'regionChangeComplete');
  await rendered.rerender(<GoogleResultMap {...props} selectedId="visit" />);
  await layout(400, 800);
  expect(mockFit).toHaveBeenCalledTimes(1);
  await layout(500, 900);
  expect(mockFit).toHaveBeenCalledTimes(2);
  await rendered.rerender(<GoogleResultMap {...props} bottomInset={200} />);
  expect(mockFit).toHaveBeenCalledTimes(3);
  const other = { latitude: 35, longitude: 139 };
  await rendered.rerender(<GoogleResultMap {...props} bottomInset={200} markers={[{ ...props.markers[0]!, coordinate: other }]} />);
  expect(mockFit).toHaveBeenCalledTimes(4);
  expect(mockFit).toHaveBeenLastCalledWith([other], expect.anything());
});

test('choosing another empty day restores its lodging after panning away even when its coordinates match', async () => {
  const fixture = resultFixture();
  const data = plan();
  data.stops[D2] = [];
  data.comparisons = data.comparisons.filter(leg => leg.date !== D2);
  fixture.generate.mockResolvedValueOnce(json(trip(REVISION, data)));
  await openResult(fixture);
  await fireEvent.press(screen.getByRole('button', { name: '2일 12.4' }));
  await layout(400, 800);
  await ready();
  expect(mockFit).toHaveBeenCalledTimes(1);
  const [lodging, padding] = mockFit.mock.calls[0];
  expect(lodging).toHaveLength(1);
  await fireEvent(map(), 'regionChangeComplete');
  expect(mockFit).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByRole('button', { name: '3일 12.5' }));
  expect(mockFit).toHaveBeenCalledTimes(2);
  expect(mockFit).toHaveBeenLastCalledWith(lodging, padding);
});

const { ACCESS_COARSE_LOCATION: coarse, ACCESS_FINE_LOCATION: fine } = PermissionsAndroid.PERMISSIONS;
type Grants = Awaited<ReturnType<typeof PermissionsAndroid.requestMultiple>>;
const grants = (approximate: boolean, precise: boolean): Grants => ({
  [coarse]: approximate ? 'granted' : 'denied', [fine]: precise ? 'granted' : 'denied',
} as Grants);

test.each([[true, true], [true, false], [false, false]])('uses Android location grants (coarse %s, fine %s)', async (approximate, precise) => {
  jest.replaceProperty(Platform, 'OS', 'android');
  const request = jest.spyOn(PermissionsAndroid, 'requestMultiple').mockResolvedValue(grants(approximate, precise));
  const rendered = await render(<GoogleResultMap {...props} />);
  expect(request).not.toHaveBeenCalled();
  await rendered.rerender(<GoogleResultMap {...props} locateRequest={1} />);
  expect(request).toHaveBeenCalledWith(expect.arrayContaining([coarse, fine]));
  expect(map()).toHaveProp('showsUserLocation', approximate || precise);
  await location();
  if (approximate || precise) expect(mockAnimate).toHaveBeenCalledWith({ center: coordinate });
  else expect(mockAnimate).not.toHaveBeenCalled();
});

test('rapid locate taps share an outstanding Android prompt; unmounting ignores its resolution', async () => {
  jest.replaceProperty(Platform, 'OS', 'android');
  const waiting = deferred<Grants>();
  const request = jest.spyOn(PermissionsAndroid, 'requestMultiple').mockReturnValue(waiting.promise);
  const rendered = await render(<GoogleResultMap {...props} locateRequest={1} />);
  await rendered.rerender(<GoogleResultMap {...props} locateRequest={2} />);
  expect(request).toHaveBeenCalledTimes(1);
  await rendered.unmount();
  await act(async () => { waiting.resolve(grants(true, false)); });
  expect(mockAnimate).not.toHaveBeenCalled();
});

test('a second locate recenters once using the latest position; a revoked grant clears it', async () => {
  jest.replaceProperty(Platform, 'OS', 'android');
  const waiting = deferred<Grants>();
  const request = jest.spyOn(PermissionsAndroid, 'requestMultiple')
    .mockResolvedValueOnce(grants(true, false)).mockReturnValueOnce(waiting.promise).mockRejectedValueOnce(new Error('permission unavailable'));
  const rendered = await render(<GoogleResultMap {...props} locateRequest={1} />);
  await ready();
  await location();
  const next = { latitude: 35.7, longitude: 139.8 };
  await fireEvent(map(), 'userLocationChange', { nativeEvent: { coordinate: next } });
  expect(mockAnimate).toHaveBeenCalledTimes(1);
  await rendered.rerender(<GoogleResultMap {...props} locateRequest={2} />);
  await rendered.rerender(<GoogleResultMap {...props} locateRequest={3} />);
  expect(request).toHaveBeenCalledTimes(2);
  await act(async () => { waiting.resolve(grants(true, false)); });
  expect(mockAnimate).toHaveBeenCalledTimes(2);
  expect(mockAnimate).toHaveBeenLastCalledWith({ center: next });
  await rendered.rerender(<GoogleResultMap {...props} locateRequest={4} />);
  expect(map()).toHaveProp('showsUserLocation', false);
  await location();
  expect(mockAnimate).toHaveBeenCalledTimes(2);
});
