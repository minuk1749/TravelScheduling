import type { Visit } from '../scheduler';

export type Money = { amount: number; currency: string };
export type Location = { id: string; coordinates: Visit['coordinates'] };
export type ProviderMode = 'TRANSIT' | 'WALK' | 'DRIVE';
export type TravelEstimate = { durationSeconds: number; distanceMeters: number; fare: Money | null };
/** An absent mode means no route; null fare means an otherwise usable route has no known fare. */
export type TravelAlternatives = Partial<Record<ProviderMode, TravelEstimate>>;
export type TravelRequest = {
  departure: string;
  timeZone: string;
  modes: readonly ProviderMode[];
};
export type MatrixRequest = TravelRequest & { locations: readonly Location[] };
export type RouteRequest = TravelRequest & { from: Location; to: Location };
export type TravelMatrix = ReadonlyMap<string, ReadonlyMap<string, TravelAlternatives>>;

export interface TravelTimeProvider {
  matrix(input: MatrixRequest): Promise<TravelMatrix>;
  route(input: RouteRequest): Promise<TravelAlternatives>;
}

export class TravelInputError extends Error {}
export class TravelProviderError extends Error {
  constructor(readonly kind: 'UNAVAILABLE' | 'INVALID_RESPONSE') {
    super('이동시간 제공자 요청에 실패했습니다.');
  }
}
