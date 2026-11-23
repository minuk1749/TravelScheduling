import type { ComponentProps, ReactNode, Ref } from 'react';
import { processColor } from 'react-native';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { GoogleResultMap } from '../src/map/google-result-map';
import type { LatLng, ResultMapProps } from '../src/map/types';
import { colors } from '../src/theme';
import { deferred, json } from './helpers';
import { conflictTrip, D1, D3, openResult, place, resultFixture, view } from './result-fixture';

const mockProject = jest.fn<Promise<{ x: number; y: number }>, [LatLng]>();
const mockFit = jest.fn();
jest.mock('./fake-result-map', () => ({ FakeResultMap: jest.requireActual('../src/map/google-result-map').GoogleResultMap }));
jest.mock('../src/map/config', () => ({ isMapConfigured: () => true }));
jest.mock('react-native-maps', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    __esModule: true, PROVIDER_GOOGLE: 'google',
    Marker: (props: ComponentProps<typeof View> & { identifier?: string }) => <View {...props} testID={props.identifier} />,
    Polyline: (props: ComponentProps<typeof View>) => <View {...props} testID="polyline" />,
    default: function TestMap({ ref, ...props }: {
      ref: Ref<{ pointForCoordinate: typeof mockProject; fitToCoordinates: typeof mockFit }>; children: ReactNode; onMapReady(): void; onRegionChangeComplete(): void;
    }) {
      React.useImperativeHandle(ref, () => ({ pointForCoordinate: mockProject, fitToCoordinates: mockFit }));
      return <View testID="native-map" {...props} />;
    },
  };
});

beforeEach(() => { mockProject.mockReset(); mockFit.mockClear(); });

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
  expect(within(screen.getByTestId('airport-edge-BOTTOM')).getByText(label)).toBeVisible();
  expect(screen.getByTestId('airport-edges')).toHaveStyle({ bottom: 350 });
  await rendered.rerender(<GoogleResultMap {...props} />);
  expect(screen.queryByText(label)).toBeNull();
  expect(mockProject).toHaveBeenCalledTimes(1);

  const stale = deferred<{ x: number; y: number }>();
  mockProject.mockReturnValueOnce(stale.promise).mockResolvedValueOnce({ x: 200, y: 50 });
  await fireEvent(map, 'regionChangeComplete');
  await fireEvent(map, 'regionChangeComplete');
  expect(screen.getByText(label)).toBeVisible();
  expect(within(screen.getByTestId('airport-edge-TOP')).getByText(label)).toBeVisible();
  expect(screen.getByTestId('airport-edges')).toHaveStyle({ top: 80 });
  await act(async () => { stale.resolve({ x: 200, y: 350 }); });
  expect(screen.getByText(label)).toBeVisible();
  await rendered.rerender(<GoogleResultMap {...props} topInset={20} />);
  expect(screen.queryByText(label)).toBeNull();
});

test('both airports share one readable edge notice, then follow rotation, map motion and the selected day', async () => {
  const haneda = { id: 'HND', kind: 'AIRPORT' as const, order: null, label: '하네다', coordinate: { latitude: 35.55, longitude: 139.78 } };
  const narita = { ...haneda, id: 'NRT', label: '나리타', coordinate: { latitude: 35.77, longitude: 140.39 } };
  const props: ResultMapProps = {
    markers: [haneda, narita], routes: [], selectedId: null, focusDate: D1, focusIds: [],
    topInset: 76, bottomInset: 150, dimmed: false, locateRequest: 0, onSelectMarker() {},
  };
  const rendered = await render(<GoogleResultMap {...props} />);
  const map = screen.getByTestId('native-map');
  const firstAirport = deferred<{ x: number; y: number }>();
  mockProject.mockReturnValueOnce(firstAirport.promise).mockResolvedValueOnce({ x: 710, y: 310 });
  await fireEvent(map, 'layout', { nativeEvent: { layout: { width: 390, height: 844 } } });
  await fireEvent(map, 'mapReady');
  expect(screen.getByText('✈ 나리타 · 화면 밖')).toBeVisible();
  await act(async () => { firstAirport.resolve({ x: 650, y: 280 }); });
  const combined = '✈ 하네다 · 나리타 · 화면 밖';
  expect(within(screen.getByTestId('airport-edge-RIGHT')).getByText(combined)).toBeVisible();
  expect(screen.getByTestId('airport-edge-RIGHT')).toHaveStyle({ alignItems: 'flex-end', justifyContent: 'center' });
  expect(screen.getByTestId('airport-edges')).toHaveStyle({ top: 76, bottom: 150 });

  mockProject.mockResolvedValueOnce({ x: 390, y: 130 }).mockResolvedValueOnce({ x: -80, y: 160 });
  await fireEvent(map, 'layout', { nativeEvent: { layout: { width: 844, height: 390 } } });
  expect(screen.queryByText(combined)).toBeNull();
  expect(screen.queryByTestId('airport-edge-RIGHT')).toBeNull();
  expect(within(screen.getByTestId('airport-edge-LEFT')).getByText('✈ 나리타 · 화면 밖')).toBeVisible();

  const oldNarita = deferred<{ x: number; y: number }>();
  mockProject.mockResolvedValueOnce({ x: 370, y: 300 }).mockReturnValueOnce(oldNarita.promise);
  await fireEvent(map, 'regionChangeComplete');
  expect(within(screen.getByTestId('airport-edge-BOTTOM')).getByText('✈ 하네다 · 화면 밖')).toBeVisible();
  // A selected date can retain the same airport IDs while the map is fitting a different area.
  mockProject.mockResolvedValueOnce({ x: 420, y: -80 }).mockRejectedValueOnce(new Error('no projection'));
  await rendered.rerender(<GoogleResultMap {...props} focusDate={D3} />);
  expect(within(screen.getByTestId('airport-edge-TOP')).getByText('✈ 하네다 · 화면 밖')).toBeVisible();
  await act(async () => { oldNarita.resolve({ x: 415, y: -80 }); });
  expect(screen.queryByText(combined)).toBeNull();
  expect(screen.queryByText('✈ 나리타 · 화면 밖')).toBeNull();
  expect(screen.queryByTestId('airport-edge-BOTTOM')).toBeNull();
});

test('an initial conflict projects the airport of each local transfer day while fitting the camera to the lodging', async () => {
  const airportId = place('airport'), hotelId = place('hotel');
  const airport = view.places[airportId]!.coordinates, lodging = view.places[hotelId]!.coordinates;
  const airportRef = view.input.flights[0]!.airport;
  const f = resultFixture({ ...view, input: { ...view.input, flights: [
    { direction: 'ARRIVAL', airport: airportRef, localDateTime: `${D1}T00:10` },
    { direction: 'DEPARTURE', airport: airportRef, localDateTime: `${D3}T07:00` },
  ] } });
  const initial = conflictTrip(view.revision);
  initial.capacity.unplaced = [];
  initial.capacity.issues = [];
  initial.transferIssues = [
    { date: D1, direction: 'ARRIVAL', from: airportId, to: hotelId, reason: 'NO_ROUTE' },
    { date: D3, direction: 'DEPARTURE', from: hotelId, to: airportId, reason: 'NO_ROUTE' },
  ];
  f.generate.mockResolvedValueOnce(json(initial));
  mockProject.mockResolvedValue({ x: 425, y: 150 });
  await openResult(f);
  const map = screen.getByTestId('native-map');
  await fireEvent(map, 'layout', { nativeEvent: { layout: { width: 390, height: 844 } } });
  await fireEvent(map, 'mapReady');
  const label = '✈ 하네다 공항 · 화면 밖';
  const airportMarker = 'airport:' + airportId;
  function checkTransfer(from: LatLng, to: LatLng) {
    const redArcs = screen.getAllByTestId('polyline').filter(line =>
      processColor(line.props.strokeColor) === processColor(colors.red.text));
    expect(redArcs).toHaveLength(1);
    const coordinates = redArcs[0]!.props.coordinates;
    expect(coordinates.length).toBeGreaterThan(2);
    expect(coordinates[0]).toEqual(from);
    expect(coordinates.at(-1)).toEqual(to);
    expect(screen.getAllByTestId(airportMarker)).toHaveLength(1);
    expect(screen.getByTestId(airportMarker)).toHaveProp('coordinate', airport);
    expect(screen.getByText(label)).toBeVisible();
    expect(mockProject).toHaveBeenLastCalledWith(airport);
    expect(mockFit).toHaveBeenLastCalledWith([lodging], expect.anything());
  }
  checkTransfer(airport, lodging);
  await fireEvent.press(screen.getByRole('button', { name: '2일 12.4' }));
  expect(screen.queryByTestId(airportMarker)).toBeNull();
  expect(screen.queryByTestId('polyline')).toBeNull();
  expect(screen.queryByText(label)).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: '3일 12.5' }));
  checkTransfer(lodging, airport);
});
