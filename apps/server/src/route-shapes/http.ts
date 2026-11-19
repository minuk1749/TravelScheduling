import { privateJson as json } from '../lib/http';
import { authorizeTrip } from '../lib/auth/authorization';
import { PlaceProviderError } from '../places';
import { TravelProviderError } from '../travel-time';
import type { ShapeOutcome } from '../services/route-shapes';

type Dependencies = {
  userId(request: Request): Promise<string | undefined>;
  findOwner(tripId: string): Promise<string | null>;
  service(): { read(tripId: string, ownerId: string, inputHash: string): Promise<ShapeOutcome> };
};
const ACCESS = {
  401: { code: 'UNAUTHENTICATED', error: '로그인 후 다시 시도해 주세요.' },
  403: { code: 'FORBIDDEN', error: '접근할 수 없습니다.' },
  404: { code: 'NOT_FOUND', error: '여행을 찾을 수 없습니다.' },
} as const;

export function routeShapeHandlers(deps: Dependencies) {
  return {
    get: async (request: Request, tripId: string): Promise<Response> => {
      try {
        const ownerId = await deps.userId(request);
        const access = await authorizeTrip(ownerId, tripId, deps.findOwner);
        if (access !== 200) return json(ACCESS[access], access);
        const hashes = new URL(request.url).searchParams.getAll('inputHash');
        if (hashes.length !== 1 || !/^[a-f0-9]{64}$/.test(hashes[0])) {
          return json({ code: 'INVALID_INPUT', error: '동선의 입력 해시가 올바르지 않습니다.' }, 400);
        }
        const outcome = await deps.service().read(tripId, ownerId!, hashes[0]);
        switch (outcome.status) {
          case 'OK': return json(outcome.response);
          case 'NOT_FOUND': return json(ACCESS[404], 404);
          case 'STALE_INPUT': return json({ code: outcome.status, error: '여행 정보가 바뀌었습니다. 동선을 다시 생성해 주세요.' }, 409);
          case 'RESULT_UNAVAILABLE': return json({ code: outcome.status, error: '동선을 먼저 생성해 주세요.' }, 409);
        }
      } catch (error) {
        if (error instanceof PlaceProviderError || error instanceof TravelProviderError) {
          return json({ code: `PROVIDER_${error.kind}`, error: '지도 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.' },
            error.kind === 'UNAVAILABLE' ? 503 : 502);
        }
        return json({ code: 'INTERNAL', error: '경로 모양을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' }, 500);
      }
    },
  };
}
