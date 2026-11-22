import type { ComponentProps } from 'react';
import { PixelRatio, Platform, processColor } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { GoogleResultMap } from '../src/map/google-result-map';
import type { MapRouteSpec } from '../src/map/types';
import { colors } from '../src/theme';

jest.mock('../src/map/config', () => ({ isMapConfigured: () => true }));
jest.mock('react-native-maps', () => {
  const { useRef } = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { __esModule: true, default: View, PROVIDER_GOOGLE: 'google',
    Marker: (props: ComponentProps<typeof View>) => <View {...props} testID="arrow" />,
    Polyline: ({ lineDashPattern, ...props }: ComponentProps<typeof View> & { lineDashPattern?: number[] }) => {
      // Both Google adapters leave their installed pattern in place when the prop is removed.
      const pattern = useRef(lineDashPattern);
      if (lineDashPattern) pattern.current = lineDashPattern;
      return <View {...{ ...props, lineDashPattern: pattern.current }} testID="line" />;
    } };
});

const points = [{ latitude: 35.68, longitude: 139.76 }, { latitude: 35.69, longitude: 139.78 }];
const road: MapRouteSpec = { id: 'lodging-museum', order: 1, mode: 'TRANSIT', color: '#5B9BE0', emphasis: 'STRONG',
  line: 'SOLID', path: { kind: 'ROAD', points } };
const draw = (route: MapRouteSpec, dimmed = false) => <GoogleResultMap focusDate="2026-12-03" markers={[]} focusIds={[]}
  routes={[route]} selectedId={null} topInset={70} bottomInset={250} locateRequest={0} dimmed={dimmed} onSelectMarker={() => {}} />;
const lines = () => screen.getAllByTestId('line').map(line => line.props);

afterEach(() => jest.restoreAllMocks());

test('the road stroke, white outline and direction arrow follow selection and previous-result dimming together', async () => {
  const rendered = await render(draw(road));
  for (const [emphasis, failed, alpha, arrowOpacity] of [
    ['DIM', false, '40', 0.25], ['STRONG', false, 'FF', 1], ['STRONG', true, '40', 0.25], ['STRONG', false, 'FF', 1],
  ] as const) {
    await rendered.rerender(draw({ ...road, emphasis }, failed));
    const [outline, ink] = lines();
    expect(processColor(outline!.strokeColor)).toBe(processColor(colors.card + alpha));
    expect(processColor(ink!.strokeColor)).toBe(processColor(road.color + alpha));
    expect(outline!.strokeWidth).toBeGreaterThan(ink!.strokeWidth);
    expect(outline!.zIndex).toBeLessThan(ink!.zIndex);
    expect(screen.getByTestId('arrow')).toHaveProp('opacity', arrowOpacity);
    expect(screen.getByText('▲')).toHaveStyle({ color: road.color });
  }
});

test.each(['ios', 'android'] as const)('both walking strokes keep the same visible gaps and return to solid after an edit (%s)', async os => {
  jest.replaceProperty(Platform, 'OS', os);
  jest.spyOn(PixelRatio, 'get').mockReturnValue(3);
  const rendered = await render(draw({ ...road, mode: 'WALK', line: 'DOTTED' }));
  const [outline, ink] = lines();
  expect(outline!.lineDashPattern).toEqual(ink!.lineDashPattern);
  expect(outline!.lineCap).toBe('round');
  expect(ink!.lineCap).toBe('round');
  expect(outline!.lineDashPattern[1]).toBeGreaterThan(outline!.strokeWidth * (os === 'android' ? 3 : 1));
  await rendered.rerender(draw(road));
  expect(lines().map(line => line.lineDashPattern)).toEqual([undefined, undefined]);
});

test('a floating arc dims its shadow and arrow with the route and keeps the conflict leg red', async () => {
  const floating: MapRouteSpec = { ...road, line: 'FLOATING' };
  const rendered = await render(draw(floating));
  for (const [emphasis, failed, rgb, alpha, shadowAlpha, arrowOpacity] of [
    ['STRONG', false, road.color, 'FF', '1F', 1], ['DIM', false, road.color, '40', '08', 0.25],
    ['STRONG', true, road.color, '40', '08', 0.25], ['CONFLICT', false, colors.red.text, 'FF', '1F', 1],
  ] as const) {
    await rendered.rerender(draw({ ...floating, emphasis }, failed));
    const [ground, arc] = lines();
    expect(processColor(ground!.strokeColor)).toBe(processColor(colors.gray.text + shadowAlpha));
    expect(processColor(arc!.strokeColor)).toBe(processColor(rgb + alpha));
    expect(ground!.coordinates).toEqual(points);
    expect(arc!.lineDashPattern).toBeDefined();
    expect(ground!.zIndex).toBeLessThan(arc!.zIndex);
    expect(screen.getByTestId('arrow')).toHaveProp('opacity', arrowOpacity);
    expect(screen.getByText('▲')).toHaveStyle({ color: rgb });
  }
});
