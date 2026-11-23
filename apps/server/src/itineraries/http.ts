import { ITINERARY_REQUEST_HEADER } from '@travel/core/contracts/itinerary';
import { canonicalUuidOrNull } from '../lib/db';
import { accessError, apiError, privateJson as json, hasForeignOrigin, providerError } from '../lib/http';
import { authorizeTrip } from '../lib/auth/authorization';
import { PlaceInputError, PlaceProviderError } from '../places';
import { ItineraryInputError, type GenerateOutcome } from '../services/itinerary/types';
import { TravelInputError, TravelProviderError } from '../travel-time';

export interface ItineraryGenerator {
  generate(tripId: string): Promise<GenerateOutcome>;
}

type Dependencies = {
  userId(request: Request): Promise<string | undefined>;
  findOwner(tripId: string): Promise<string | null>;
  /** Created only after authorization; `dispose` releases per-request provider resources. */
  generator(ownerId: string, requestId: string | null): { generator: ItineraryGenerator; dispose(): void };
};

const ACCESS_ERRORS = { 401: '로그인 후 다시 시도해 주세요.', 403: '접근할 수 없습니다.', 404: '여행을 찾을 수 없습니다.' } as const;
const INCOMPLETE = '일정을 만들기 전에 여행 정보를 보완해 주세요.';

function errorResponse(error: unknown): Response {
  if (error instanceof ItineraryInputError) return apiError(409, 'INCOMPLETE_TRIP', INCOMPLETE, error.fields);
  if (error instanceof PlaceInputError || error instanceof TravelInputError) return apiError(400, 'INVALID_INPUT', error.message);
  if (error instanceof PlaceProviderError || error instanceof TravelProviderError) {
    return providerError(error.kind, '지도 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }
  return apiError(500, 'INTERNAL', '일정을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.');
}

/** POST /api/trips/{id}/itinerary: authorize, generate, save; domain statuses stay in a 200 body. */
export function itineraryHandlers(deps: Dependencies) {
  return {
    generate: async (request: Request, tripId: string): Promise<Response> => {
      try {
        if (hasForeignOrigin(request)) return apiError(403, 'FORBIDDEN', '허용되지 않은 요청입니다.');
        const ownerId = await deps.userId(request);
        const access = await authorizeTrip(ownerId, tripId, deps.findOwner);
        if (access !== 200) return accessError(access, ACCESS_ERRORS[access]);
        const requestId = request.headers.get(ITINERARY_REQUEST_HEADER);
        if (requestId !== null && !canonicalUuidOrNull(requestId)) {
          return apiError(400, 'INVALID_INPUT', '일정 생성 요청 식별자를 확인해 주세요.');
        }
        const { generator, dispose } = deps.generator(ownerId!, requestId);
        let outcome: GenerateOutcome;
        try { outcome = await generator.generate(tripId); } finally { dispose(); }
        switch (outcome.status) {
          case 'NOT_FOUND': return accessError(404, ACCESS_ERRORS[404]);
          case 'INCOMPLETE': return apiError(409, 'INCOMPLETE_TRIP', INCOMPLETE, outcome.fields);
          case 'STALE': return apiError(409, 'STALE_INPUT', '계산 중 여행 정보가 바뀌었습니다. 다시 생성해 주세요.');
          case 'SAVED': return json({ itineraryId: outcome.itineraryId, inputHash: outcome.inputHash, ...outcome.result });
        }
      } catch (error) {
        return errorResponse(error);
      }
    },
  };
}
