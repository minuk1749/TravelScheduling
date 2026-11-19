import { privateJson as json, hasForeignOrigin } from '../lib/http';
import { authorizeTrip } from '../lib/auth/authorization';
import { PlaceProviderError } from '../places';
import { ResultStaleError, ResultUnavailableError, type ResultEditService } from '../services/itinerary/editing';
import { TripInputError } from '../trips/input';

type Dependencies = {
  userId(): Promise<string | undefined>; findOwner(id: string): Promise<string | null>;
  service(): Pick<ResultEditService, 'load' | 'save'>;
};
export function constraintHandlers(deps: Dependencies) {
  const handle = async (request: Request, id: string, write: boolean) => {
    try {
      if (write && hasForeignOrigin(request)) return json({ error: '허용되지 않은 요청입니다.' }, 403);
      const userId = await deps.userId();
      const access = await authorizeTrip(userId, id, deps.findOwner);
      if (access !== 200) return json({ error: access === 401 ? '로그인 후 다시 시도해 주세요.' : access === 404 ? '여행을 찾을 수 없습니다.' : '접근할 수 없습니다.' }, access);
      if (!write) return json(await deps.service().load(id));
      let body: unknown;
      try { body = await request.json(); } catch { return json({ error: '올바른 JSON을 보내 주세요.' }, 400); }
      return json(await deps.service().save(id, userId!, body));
    } catch (error) {
      if (error instanceof TripInputError) return json({ error: '입력 내용을 확인해 주세요.', fields: error.fields }, 400);
      if (error instanceof ResultStaleError) return json({ error: '다른 곳에서 여행 정보가 바뀌었습니다. 다시 불러온 후 수정해 주세요.' }, 409);
      if (error instanceof ResultUnavailableError) return json({ error: '여행 입력 정보를 먼저 완성해 주세요.' }, 409);
      if (error instanceof PlaceProviderError) return json({ error: '장소를 불러오지 못했습니다. 다시 시도해 주세요.' }, error.kind === 'UNAVAILABLE' ? 503 : 502);
      return json({ error: '요청을 처리하지 못했습니다. 다시 시도해 주세요.' }, 500);
    }
  };
  return { get: (request: Request, id: string) => handle(request, id, false), put: (request: Request, id: string) => handle(request, id, true) };
}
