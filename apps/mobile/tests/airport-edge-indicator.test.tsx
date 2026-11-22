import type { ReactNode, Ref } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { GoogleResultMap } from '../src/map/google-result-map';
import type { LatLng, ResultMapProps } from '../src/map/types';
import { deferred } from './helpers';

const mockProject = jest.fn<Promise<{ x: number; y: number }>, [LatLng]>();
jest.mock('../src/map/config', () => ({ isMapConfigured: () => true }));
jest.mock('react-native-maps', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    __esModule: true, Marker: View, Polyline: View, PROVIDER_GOOGLE: 'google',
    default: function TestMap({ ref, ...props }: {
      ref: Ref<{ pointForCoordinate: typeof mockProject }>; children: ReactNode; onMapReady(): void; onRegionChangeComplete(): void;
    }) {
      React.useImperativeHandle(ref, () => ({ pointForCoordinate: mockProject }));
      return <View testID="native-map" {...props} />;
    },
  };
});

test('projects the airport into visible map space, updates when the panel moves, and ignores stale camera projections', async () => {
  const coordinate = { latitude: 35.55, longitude: 139.78 };
  const props: ResultMapProps = {
    markers: [{ id: 'airport', kind: 'AIRPORT', order: null, label: '하네다', coordinate }], routes: [], focusDate: '2026-12-03', focusIds: [],
    selectedId: null, topInset: 80, bottomInset: 120, dimmed: false, locateRequest: 0, onSelectMarker() {},
  };
  mockProject.mockResolvedValueOnce({ x: 200, y: 500 });
  const rendered = await render(<GoogleResultMap {...props} />);
  const map = screen.getByTestId('native-map');
  await fireEvent(map, 'layout', { nativeEvent: { layout: { width: 400, height: 800 } } });
  await fireEvent(map, 'mapReady');
  expect(mockProject).toHaveBeenCalledWith(coordinate);
  const label = '✈ 하네다 · 화면 밖';
  expect(screen.queryByText(label)).toBeNull();

  await rendered.rerender(<GoogleResultMap {...props} bottomInset={350} />);
  expect(screen.getByText(label)).toBeVisible();
  expect(screen.getByTestId('airport-edge-airport')).toHaveStyle({ bottom: 350 });
  await rendered.rerender(<GoogleResultMap {...props} />);
  expect(screen.queryByText(label)).toBeNull();
  expect(mockProject).toHaveBeenCalledTimes(1);

  const stale = deferred<{ x: number; y: number }>();
  mockProject.mockReturnValueOnce(stale.promise).mockResolvedValueOnce({ x: 200, y: 50 });
  await fireEvent(map, 'regionChangeComplete');
  await fireEvent(map, 'regionChangeComplete');
  expect(screen.getByText(label)).toBeVisible();
  expect(screen.getByTestId('airport-edge-airport')).toHaveStyle({ top: 80 });
  await act(async () => { stale.resolve({ x: 200, y: 350 }); });
  expect(screen.getByText(label)).toBeVisible();
  await rendered.rerender(<GoogleResultMap {...props} topInset={20} />);
  expect(screen.queryByText(label)).toBeNull();
});
