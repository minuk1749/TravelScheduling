import { accessError, apiError, privateJson as json, hasForeignOrigin } from '../lib/http';
import { authorizeTrip } from '../lib/auth/authorization';
import type { CityProfile } from '../fare';
import { parseTripDraft, TripInputError, type TripDraft } from './input';

type UserId = { userId(request: Request): Promise<string | undefined> };
type Dependencies = UserId & {
  create(ownerId: string, input: TripDraft): Promise<string>;
  profile(cityCode: string): Promise<CityProfile | null>;
};
export function tripHandlers(deps: Dependencies) {
  const handle = async (request: Request, action: (userId: string) => Promise<Response>) => {
    try {
      const userId = await deps.userId(request);
      if (!userId) return apiError(401, 'UNAUTHENTICATED', '로그인 후 다시 시도해 주세요.');
      return await action(userId);
    } catch (error) {
      if (error instanceof TripInputError) return apiError(400, 'INVALID_INPUT', error.message, error.fields);
      return apiError(500, 'INTERNAL', '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    }
  };
  return {
    create: (request: Request) => handle(request, async userId => {
      if (hasForeignOrigin(request)) return apiError(403, 'FORBIDDEN', '허용되지 않은 요청입니다.');
      if (!request.headers.get('content-type')?.startsWith('application/json')) return apiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'JSON 입력이 필요합니다.');
      const body = await request.text();
      if (body.length > 100_000) return apiError(413, 'PAYLOAD_TOO_LARGE', '입력 크기를 줄여 주세요.');
      let raw: unknown;
      try { raw = JSON.parse(body); } catch { return apiError(400, 'INVALID_JSON', '올바른 JSON 입력이 필요합니다.'); }
      const input = parseTripDraft(raw);
      return json({ id: await deps.create(userId, input) }, 201);
    }),
    profile: (request: Request) => handle(request, async () => {
      const code = new URL(request.url).searchParams.get('cityCode')?.trim();
      if (!code || code.length > 80) return apiError(400, 'INVALID_INPUT', '도시를 선택해 주세요.');
      return json({ profile: await deps.profile(code), recommendedPolicy: 'WHEN_NEEDED' });
    }),
  };
}

/** GET /api/trips/{id}: ownership probe. */
export function tripAccessHandler(deps: UserId & { findOwner(id: string): Promise<string | null> }) {
  return async (request: Request, id: string): Promise<Response> => {
    try {
      const status = await authorizeTrip(await deps.userId(request), id, deps.findOwner);
      return status === 200 ? json({ id }) : accessError(status, '접근할 수 없습니다.');
    } catch {
      return apiError(500, 'INTERNAL', '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    }
  };
}
