import type { MatrixRequest, RouteRequest, TravelMatrix, TravelAlternatives } from '@travel/core/contracts/travel-time';
export type * from '@travel/core/contracts/travel-time';

/** Largest `MatrixRequest.locations` a provider accepts; callers split larger sets. */
export const MAX_MATRIX_LOCATIONS = 100;

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
