import { Temporal } from '@js-temporal/polyfill';
import { TravelInputError, type Location, type MatrixRequest, type ProviderMode, type RouteRequest, type TravelRequest } from './index';

const MODES: readonly ProviderMode[] = ['TRANSIT', 'WALK', 'DRIVE'];

function request(input: TravelRequest): TravelRequest {
  try {
    if (typeof input.departure !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(input.departure) ||
        typeof input.timeZone !== 'string' || !input.timeZone || /^[+-]/.test(input.timeZone) ||
        !Array.isArray(input.modes) || input.modes.length === 0 || input.modes.some(mode => !MODES.includes(mode))) {
      throw new RangeError();
    }
    const departure = Temporal.Instant.from(input.departure);
    departure.toZonedDateTimeISO(input.timeZone);
    return { departure: departure.toString(), timeZone: input.timeZone, modes: MODES.filter(mode => input.modes.includes(mode)) };
  } catch {
    throw new TravelInputError('출발 instant, IANA 시간대와 이동수단이 올바르지 않습니다.');
  }
}

function location(value: Location): Location {
  if (!value || typeof value.id !== 'string' || !value.id.trim() || value.id.length > 255 ||
      !value.coordinates || !Number.isFinite(value.coordinates.latitude) || Math.abs(value.coordinates.latitude) > 90 ||
      !Number.isFinite(value.coordinates.longitude) || Math.abs(value.coordinates.longitude) > 180) {
    throw new TravelInputError('장소 ID와 좌표가 올바르지 않습니다.');
  }
  return { id: value.id, coordinates: { latitude: value.coordinates.latitude, longitude: value.coordinates.longitude } };
}

export function matrixRequest(input: MatrixRequest): MatrixRequest {
  const normalized = request(input);
  if (!Array.isArray(input.locations) || input.locations.length > 100) {
    throw new TravelInputError('행렬은 최대 100개 장소를 지원합니다.');
  }
  const locations = input.locations.map(location);
  if (new Set(locations.map(value => value.id)).size !== locations.length) {
    throw new TravelInputError('행렬의 장소 ID가 중복되었습니다.');
  }
  return { ...normalized, locations };
}

export function routeRequest(input: RouteRequest): RouteRequest {
  const normalized = request(input);
  const from = location(input.from), to = location(input.to);
  if (from.id === to.id && (from.coordinates.latitude !== to.coordinates.latitude || from.coordinates.longitude !== to.coordinates.longitude)) {
    throw new TravelInputError('동일한 장소 ID의 좌표가 서로 다릅니다.');
  }
  return { ...normalized, from, to };
}
