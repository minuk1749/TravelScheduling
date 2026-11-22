import { legColors } from '@travel/design-tokens';
import {
  arcPoints, CITY_CENTRES, decodePolyline, distanceKm, isOutsideCityCentre, legColor, midpointHeading, offscreenSide, withAlpha,
} from '../src/map/geometry';

const hotel = { latitude: 35.6812, longitude: 139.7671 };
const ueno = { latitude: 35.7156, longitude: 139.7745 };
const meiji = { latitude: 35.6764, longitude: 139.6993 };
const narita = { latitude: 35.772, longitude: 140.3929 };

test('decodes Google encoded polylines and rejects truncated input', () => {
  expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual([
    { latitude: 38.5, longitude: -120.2 }, { latitude: 40.7, longitude: -120.95 }, { latitude: 43.252, longitude: -126.453 },
  ]);
  expect(decodePolyline('')).toEqual([]);
  expect(() => decodePolyline('!!!!')).toThrow('Invalid polyline');
  expect(() => decodePolyline('~~~~~~~??')).toThrow('Invalid polyline');
  expect(() => decodePolyline('_p~iF~ps|U_')).toThrow('Truncated polyline');
});

test('leg colours follow the six design colours and interpolate beyond six legs', () => {
  expect(Array.from({ length: 6 }, (_, index) => legColor(index, 6))).toEqual([...legColors]);
  expect(legColor(0, 3)).toBe(legColors[0]);
  expect(legColor(9, 3)).toBe(legColors[5]);
  const eleven = Array.from({ length: 11 }, (_, index) => legColor(index, 11));
  expect(eleven[0]).toBe(legColors[0]);
  expect(eleven[10]).toBe(legColors[5]);
  expect(eleven[2]).toBe(legColors[1]);
  expect(eleven[1]).toBe('#5591DD');
  expect(new Set(eleven).size).toBe(11);
  expect(withAlpha('#2A64A8', 0.25)).toBe('rgba(42,100,168,0.25)');
});

test('outside the city centre: never walking, 4 km straight distance, or an end outside the centre circle', () => {
  const tokyo = CITY_CENTRES.TOKYO;
  expect(distanceKm(hotel, ueno)).toBeCloseTo(3.88, 1);
  expect(isOutsideCityCentre({ mode: 'TRANSIT', from: hotel, to: ueno }, tokyo)).toBe(false);
  expect(isOutsideCityCentre({ mode: 'TRANSIT', from: hotel, to: meiji }, tokyo)).toBe(true);
  expect(isOutsideCityCentre({ mode: 'WALK', from: hotel, to: meiji }, tokyo)).toBe(false);
  expect(isOutsideCityCentre({ mode: 'TAXI', from: narita, to: { latitude: 35.775, longitude: 140.39 } }, tokyo)).toBe(true);
  expect(isOutsideCityCentre({ mode: 'TAXI', from: narita, to: { latitude: 35.775, longitude: 140.39 } }, undefined)).toBe(false);
  expect(isOutsideCityCentre({ mode: 'TRANSIT', from: hotel, to: ueno }, tokyo, 3)).toBe(true);
  expect(Object.keys(CITY_CENTRES)).toEqual(['TOKYO', 'OSAKA', 'FUKUOKA', 'TAIPEI', 'HONG_KONG', 'BANGKOK', 'DA_NANG', 'SINGAPORE', 'PARIS', 'LONDON']);
});

test('floating arcs keep both ends and lift the middle; arrows sit mid-path with a compass heading', () => {
  const arc = arcPoints(hotel, meiji, 8);
  expect(arc).toHaveLength(9);
  expect(arc[0]).toEqual(hotel);
  expect(arc[8].latitude).toBeCloseTo(meiji.latitude, 10);
  expect(arc[4].latitude).toBeLessThan((hotel.latitude + meiji.latitude) / 2);
  const north = midpointHeading([{ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 }]);
  expect(north?.heading).toBeCloseTo(0);
  expect(north?.point).toEqual({ latitude: 0.5, longitude: 0 });
  expect(midpointHeading([{ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 }])?.heading).toBeCloseTo(90);
  expect(midpointHeading([hotel])).toBeNull();
});

test('airport edge labels use map points and exclude the top bar and bottom panel', () => {
  const side = (x: number, y: number) => offscreenSide({ x, y }, 400, 80, 450);
  expect(side(200, 600)).toBe('BOTTOM');
  expect(side(200, 79)).toBe('TOP');
  expect(side(200, 80)).toBeNull();
  expect(side(200, 450)).toBeNull();
  expect(side(200, 451)).toBe('BOTTOM');
  expect(side(-1, 200)).toBe('LEFT');
  expect(side(401, 200)).toBe('RIGHT');
  expect(offscreenSide({ x: 200, y: 200 }, 400, 80, 80)).toBeNull();
});

test('arrow follows half of the traveled distance even when the first turns have many points', () => {
  const route = [
    { latitude: 0, longitude: 0 }, { latitude: 0.01, longitude: 0 },
    { latitude: 0.02, longitude: 0 }, { latitude: 0.03, longitude: 0 },
    { latitude: 0.03, longitude: 0 }, { latitude: 0.03, longitude: 1 },
  ];
  const forward = midpointHeading(route), reverse = midpointHeading([...route].reverse());
  expect(forward?.point.latitude).toBeCloseTo(0.03, 4);
  expect(forward?.point.longitude).toBeCloseTo(0.485, 4);
  expect(forward?.heading).toBeCloseTo(90, 2);
  expect(reverse?.point.longitude).toBeCloseTo(0.485, 4);
  expect(reverse?.heading).toBeCloseTo(270, 2);
});

test('a turn across the date line stays on that side of the globe; stationary paths have no arrow', () => {
  const crossing = midpointHeading([{ latitude: 0, longitude: 179 }, { latitude: 0, longitude: -179 }]);
  expect(Math.abs(crossing!.point.longitude)).toBeCloseTo(180);
  expect(crossing?.heading).toBeCloseTo(90);
  expect(midpointHeading([hotel, hotel, hotel])).toBeNull();
});
