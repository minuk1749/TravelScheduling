import { legColors, result } from '@travel/design-tokens';
import type { LatLng, TravelModeName } from './types';

/** Road geometry is specific to the travel mode, even when two legs share endpoints. */
export const roadShapeKey = (legKey: string, mode: TravelModeName) => [legKey, mode].join('|');

/** Google encoded polyline (precision 5) → coordinates. Reject malformed or out-of-bounds points. */
export function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let index = 0, latitude = 0, longitude = 0;
  const next = () => {
    let shift = 0, value = 0, byte: number;
    do {
      if (index >= encoded.length) throw new Error('Truncated polyline');
      byte = encoded.charCodeAt(index++) - 63;
      if (byte < 0 || byte > 63 || shift > 25) throw new Error('Invalid polyline');
      value |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return value & 1 ? ~(value >> 1) : value >> 1;
  };
  while (index < encoded.length) {
    latitude += next();
    longitude += next();
    if (Math.abs(latitude) > 90e5 || Math.abs(longitude) > 180e5) throw new Error('Invalid polyline coordinates');
    points.push({ latitude: latitude / 1e5, longitude: longitude / 1e5 });
  }
  return points;
}

const channels = (hex: string) => [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16));
const toHex = (values: readonly number[]) => `#${values.map(value => Math.round(value).toString(16).padStart(2, '0')).join('').toUpperCase()}`;

/** §2 sequence colour for leg `index` (0-based) of `total`; beyond six legs the six colours are interpolated. */
export function legColor(index: number, total: number): string {
  if (total <= legColors.length) return legColors[Math.min(Math.max(index, 0), legColors.length - 1)];
  const position = (Math.min(Math.max(index, 0), total - 1) / (total - 1)) * (legColors.length - 1);
  const lower = Math.floor(position), upper = Math.min(lower + 1, legColors.length - 1), weight = position - lower;
  const [a, b] = [channels(legColors[lower]), channels(legColors[upper])];
  return toHex(a.map((value, channel) => value + (b[channel] - value) * weight));
}

/** `#RRGGBB` → `rgba()` with the given opacity (route dimming, translucent rings). */
export function withAlpha(hex: string, alpha: number): string {
  return `rgba(${channels(hex).join(',')},${alpha})`;
}

const EARTH_RADIUS_KM = 6371;
const radians = (degrees: number) => (degrees * Math.PI) / 180;

/** Great-circle (haversine) distance in kilometres. */
export function distanceKm(a: LatLng, b: LatLng): number {
  const dLat = radians(b.latitude - a.latitude), dLng = radians(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** City centre circle. Values are adjustable defaults (§6), e.g. Osaka ≈ inside the Loop Line. */
export type CityCentre = { centre: LatLng; radiusKm: number };
export const CITY_CENTRES: Readonly<Record<string, CityCentre>> = {
  TOKYO: { centre: { latitude: 35.684, longitude: 139.737 }, radiusKm: 5 },
  OSAKA: { centre: { latitude: 34.676, longitude: 135.502 }, radiusKm: 3.2 },
  FUKUOKA: { centre: { latitude: 33.5902, longitude: 130.41 }, radiusKm: 3 },
  TAIPEI: { centre: { latitude: 25.0478, longitude: 121.5319 }, radiusKm: 4 },
  HONG_KONG: { centre: { latitude: 22.2988, longitude: 114.1722 }, radiusKm: 4 },
  BANGKOK: { centre: { latitude: 13.7466, longitude: 100.5393 }, radiusKm: 5 },
  DA_NANG: { centre: { latitude: 16.0544, longitude: 108.2022 }, radiusKm: 4 },
  SINGAPORE: { centre: { latitude: 1.2903, longitude: 103.852 }, radiusKm: 4 },
  PARIS: { centre: { latitude: 48.8566, longitude: 2.3522 }, radiusKm: 5 },
  LONDON: { centre: { latitude: 51.5072, longitude: -0.1276 }, radiusKm: 6 },
};

/**
 * §6 default: a non-walking leg is "outside the city centre" when its straight distance is at
 * least `thresholdKm`, or when either end lies outside the city's centre circle. Cities without
 * a centre use the distance rule only.
 */
export function isOutsideCityCentre(
  leg: { mode: TravelModeName; from: LatLng; to: LatLng },
  centre: CityCentre | undefined,
  thresholdKm: number = result.route.outsideKm,
): boolean {
  if (leg.mode === 'WALK') return false;
  if (distanceKm(leg.from, leg.to) >= thresholdKm) return true;
  return !!centre && [leg.from, leg.to].some(point => distanceKm(point, centre.centre) > centre.radiusKm);
}

/** Quadratic arc lifted to the left of the travel direction; used for floating (outside-centre) legs. */
export function arcPoints(from: LatLng, to: LatLng, segments = 24, lift = 0.2): LatLng[] {
  const control = {
    latitude: (from.latitude + to.latitude) / 2 + (to.longitude - from.longitude) * lift,
    longitude: (from.longitude + to.longitude) / 2 - (to.latitude - from.latitude) * lift,
  };
  return Array.from({ length: segments + 1 }, (_, step) => {
    const t = step / segments, u = 1 - t;
    return {
      latitude: u * u * from.latitude + 2 * u * t * control.latitude + t * t * to.latitude,
      longitude: u * u * from.longitude + 2 * u * t * control.longitude + t * t * to.longitude,
    };
  });
}

/** Middle point of a path and its heading in degrees clockwise from north (direction arrow). */
export function midpointHeading(points: readonly LatLng[]): { point: LatLng; heading: number } | null {
  if (points.length < 2) return null;
  const middle = Math.min(Math.floor((points.length - 1) / 2), points.length - 2);
  const [a, b] = [points[middle], points[middle + 1]];
  const y = Math.sin(radians(b.longitude - a.longitude)) * Math.cos(radians(b.latitude));
  const x = Math.cos(radians(a.latitude)) * Math.sin(radians(b.latitude))
    - Math.sin(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.cos(radians(b.longitude - a.longitude));
  const heading = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return { point: { latitude: (a.latitude + b.latitude) / 2, longitude: (a.longitude + b.longitude) / 2 }, heading };
}

export type EdgeSide = 'TOP' | 'BOTTOM' | 'LEFT' | 'RIGHT';

/** Compare native map projection (layout points) to the unobscured part of the map. */
export function offscreenSide(point: { x: number; y: number }, width: number, top: number, bottom: number): EdgeSide | null {
  if (width <= 0 || bottom <= top) return null;
  const dx = 2 * point.x / width - 1;
  const dy = 2 * (point.y - top) / (bottom - top) - 1;
  if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) return null;
  if (Math.abs(dy) >= Math.abs(dx)) return dy < 0 ? 'TOP' : 'BOTTOM';
  return dx < 0 ? 'LEFT' : 'RIGHT';
}
