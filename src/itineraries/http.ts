import { authorizeTrip } from '../lib/auth/authorization';
import { PlaceInputError, PlaceProviderError } from '../places';
import { ItineraryInputError, type GenerateOutcome } from '../services/itinerary/types';
import { TravelInputError, TravelProviderError } from '../travel-time';

export interface ItineraryGenerator {
  generate(tripId: string): Promise<GenerateOutcome>;
}

type Dependencies = {
  userId(): Promise<string | undefined>;
  findOwner(tripId: string): Promise<string | null>;
  /** Created only after authorization; `dispose` releases per-request provider resources. */
  generator(): { generator: ItineraryGenerator; dispose(): void };
};

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
const ACCESS_ERRORS = { 401: '로그인 후 다시 시도해 주세요.', 403: '접근할 수 없습니다.', 404: '여행을 찾을 수 없습니다.' } as const;
const INCOMPLETE = '일정을 만들기 전에 여행 정보를 보완해 주세요.';

function errorResponse(error: unknown): Response {
  if (error instanceof ItineraryInputError) return json({ error: INCOMPLETE, fields: error.fields }, 409);
  if (error instanceof PlaceInputError || error instanceof TravelInputError) return json({ error: error.message }, 400);
  if (error instanceof PlaceProviderError || error instanceof TravelProviderError) {
    return json({ error: '지도 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.' }, error.kind === 'UNAVAILABLE' ? 503 : 502);
  }
  return json({ error: '일정을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.' }, 500);
}

/** POST /api/trips/{id}/itinerary: authorize, generate, save; domain statuses stay in a 200 body. */
export function itineraryHandlers(deps: Dependencies) {
  return {
    generate: async (request: Request, tripId: string): Promise<Response> => {
      try {
        const origin = request.headers.get('origin');
        if (origin && origin !== new URL(request.url).origin) return json({ error: '허용되지 않은 요청입니다.' }, 403);
        const access = await authorizeTrip(await deps.userId(), tripId, deps.findOwner);
        if (access !== 200) return json({ error: ACCESS_ERRORS[access] }, access);
        const { generator, dispose } = deps.generator();
        let outcome: GenerateOutcome;
        try { outcome = await generator.generate(tripId); } finally { dispose(); }
        switch (outcome.status) {
          case 'NOT_FOUND': return json({ error: ACCESS_ERRORS[404] }, 404);
          case 'INCOMPLETE': return json({ error: INCOMPLETE, fields: outcome.fields }, 409);
          case 'STALE': return json({ error: '계산 중 여행 정보가 바뀌었습니다. 다시 생성해 주세요.' }, 409);
          case 'SAVED': return json({ itineraryId: outcome.itineraryId, ...outcome.result });
        }
      } catch (error) {
        return errorResponse(error);
      }
    },
  };
}
