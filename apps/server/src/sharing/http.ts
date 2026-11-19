import type { ApiErrorCode } from '@travel/core/contracts/errors';
import { authorizeTrip } from '../lib/auth/authorization';
import { accessError, apiError, isCrossSiteRequest, privateJson, providerError } from '../lib/http';
import { PlaceProviderError } from '../places';
import type { SharingService } from '../services/sharing';
import { isShareToken, ShareUnavailableError } from './model';

function shareHeaders(response: Response) {
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return response;
}
const json = (body: unknown) => shareHeaders(privateJson(body));
const failure = (status: number, code: ApiErrorCode, error: string) => shareHeaders(apiError(status, code, error));
const missing = () => failure(404, 'NOT_FOUND', '공유 링크가 유효하지 않거나 만료되었습니다.');
type Dependencies = {
  userId(request: Request): Promise<string | undefined>; findOwner(id: string): Promise<string | null>;
  service(): Pick<SharingService, 'read' | 'rotate'>;
};
export function sharingHandlers(deps: Dependencies) {
  return {
    async rotate(request: Request, id: string) {
      try {
        if (request.method !== 'POST') return failure(405, 'METHOD_NOT_ALLOWED', '허용되지 않은 메서드입니다.');
        if (isCrossSiteRequest(request)) return failure(403, 'FORBIDDEN', '허용되지 않은 요청입니다.');
        const owner = await deps.userId(request);
        const access = await authorizeTrip(owner, id, deps.findOwner);
        if (access !== 200) return shareHeaders(accessError(access, access === 401 ? '로그인 후 다시 시도해 주세요.' : '여행에 접근할 수 없습니다.'));
        const token = await deps.service().rotate(id, owner!);
        return token ? json({ path: `/share/${token}` }) : missing();
      } catch { return failure(500, 'INTERNAL', '공유 링크를 만들지 못했습니다. 다시 시도해 주세요.'); }
    },
    async read(request: Request, token: string) {
      if (request.method !== 'GET') return failure(405, 'METHOD_NOT_ALLOWED', '공유 일정은 읽기 전용입니다.');
      if (!isShareToken(token)) return missing();
      try {
        const shared = await deps.service().read(token);
        return shared ? json(shared) : missing();
      } catch (error) {
        if (error instanceof ShareUnavailableError) return failure(409, 'RESULT_UNAVAILABLE', '공유할 최신 일정이 없습니다. 소유자가 동선을 재생성해야 합니다.');
        if (error instanceof PlaceProviderError) return shareHeaders(providerError(error.kind, '장소 정보를 불러오지 못했습니다. 다시 시도해 주세요.'));
        return failure(500, 'INTERNAL', '공유 일정을 불러오지 못했습니다. 다시 시도해 주세요.');
      }
    },
  };
}
