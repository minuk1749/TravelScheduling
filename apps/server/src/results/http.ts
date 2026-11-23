import { accessError, apiError, privateJson as json, hasForeignOrigin, providerError } from '../lib/http';
import { authorizeTrip } from '../lib/auth/authorization';
import { PlaceProviderError } from '../places';
import { ResultStaleError, ResultTripNotFoundError, ResultUnavailableError, type ResultEditService } from '../services/itinerary/editing';
import { TripInputError } from '../trips/input';

type Dependencies = {
  userId(request: Request): Promise<string | undefined>; findOwner(id: string): Promise<string | null>;
  service(): Pick<ResultEditService, 'load' | 'save'>;
};
const ACCESS_ERRORS = { 401: '로그인 후 다시 시도해 주세요.', 403: '접근할 수 없습니다.', 404: '여행을 찾을 수 없습니다.' } as const;
export function constraintHandlers(deps: Dependencies) {
  const handle = async (request: Request, id: string, write: boolean) => {
    try {
      if (write && hasForeignOrigin(request)) return apiError(403, 'FORBIDDEN', '허용되지 않은 요청입니다.');
      const userId = await deps.userId(request);
      const access = await authorizeTrip(userId, id, deps.findOwner);
      if (access !== 200) return accessError(access, ACCESS_ERRORS[access]);
      if (!write) {
        const operationId = new URL(request.url).searchParams.get('operationId');
        return json(await deps.service().load(id, userId!, operationId ?? undefined));
      }
      let body: unknown;
      try { body = await request.json(); } catch { return apiError(400, 'INVALID_JSON', '올바른 JSON을 보내 주세요.'); }
      return json(await deps.service().save(id, userId!, body));
    } catch (error) {
      if (error instanceof TripInputError) return apiError(400, 'INVALID_INPUT', '입력 내용을 확인해 주세요.', error.fields);
      if (error instanceof ResultTripNotFoundError) return accessError(404, ACCESS_ERRORS[404]);
      if (error instanceof ResultStaleError) return apiError(409, 'STALE_INPUT', '다른 곳에서 여행 정보가 바뀌었습니다. 다시 불러온 후 수정해 주세요.');
      if (error instanceof ResultUnavailableError) return apiError(409, 'RESULT_UNAVAILABLE', '여행 입력 정보를 먼저 완성해 주세요.');
      if (error instanceof PlaceProviderError) return providerError(error.kind, '장소를 불러오지 못했습니다. 다시 시도해 주세요.');
      return apiError(500, 'INTERNAL', '요청을 처리하지 못했습니다. 다시 시도해 주세요.');
    }
  };
  return { get: (request: Request, id: string) => handle(request, id, false), put: (request: Request, id: string) => handle(request, id, true) };
}
