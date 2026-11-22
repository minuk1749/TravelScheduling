import type { ReactNode, Ref } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { GoogleResultMap } from '../src/map/google-result-map';
import type { ResultMapProps } from '../src/map/types';
import { spacing } from '../src/theme';
import { deferred } from './helpers';

const mockFit = jest.fn(), mockAnimate = jest.fn();
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
  markers: [{ id: 'visit', kind: 'PLACED', order: 1, label: '방문지', coordinate }], routes: [], focusIds: ['visit'],
  selectedId: null, topInset: 70, bottomInset: 250, locateRequest: 0, dimmed: false, onSelectMarker() {},
};
const map = () => screen.getByTestId('map');
const layout = (width: number, height: number) => fireEvent(map(), 'layout', { nativeEvent: { layout: { width, height } } });
const ready = () => fireEvent(map(), 'mapReady');
const location = () => fireEvent(map(), 'userLocationChange', { nativeEvent: { coordinate } });

afterEach(() => { jest.restoreAllMocks(); jest.clearAllMocks(); });

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
    expect(mockFit).not.toHaveBeenCalled();
    await layout(400, 800);
  }
  expect(mockFit).toHaveBeenCalledTimes(1);
  expect(mockFit).toHaveBeenLastCalledWith([coordinate], { animated: true, edgePadding: {
    top: 70 + spacing.section, bottom: 250 + spacing.section, left: 2 * spacing.section, right: 2 * spacing.section,
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
