import { authorizeTrip } from '../lib/auth/authorization';
import { isCrossSiteRequest, privateJson } from '../lib/http';
import { PlaceProviderError } from '../places';
import type { SharingService } from '../services/sharing';
import { isShareToken, ShareUnavailableError } from './model';

function json(body: unknown, status = 200) {
  const response = privateJson(body, status);
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return response;
}
const missing = () => json({ error: '공유 링크가 유효하지 않거나 만료되었습니다.' }, 404);
type Dependencies = {
  userId(): Promise<string | undefined>; findOwner(id: string): Promise<string | null>;
  service(): Pick<SharingService, 'read' | 'rotate'>;
};
export function sharingHandlers(deps: Dependencies) {
  return {
    async rotate(request: Request, id: string) {
      try {
        if (request.method !== 'POST') return json({ error: '허용되지 않은 메서드입니다.' }, 405);
        if (isCrossSiteRequest(request)) return json({ error: '허용되지 않은 요청입니다.' }, 403);
        const owner = await deps.userId();
        const access = await authorizeTrip(owner, id, deps.findOwner);
        if (access !== 200) return json({ error: access === 401 ? '로그인 후 다시 시도해 주세요.' : '여행에 접근할 수 없습니다.' }, access);
        const token = await deps.service().rotate(id, owner!);
        return token ? json({ path: `/share/${token}` }) : missing();
      } catch { return json({ error: '공유 링크를 만들지 못했습니다. 다시 시도해 주세요.' }, 500); }
    },
    async read(request: Request, token: string) {
      if (request.method !== 'GET') return json({ error: '공유 일정은 읽기 전용입니다.' }, 405);
      if (!isShareToken(token)) return missing();
      try {
        const shared = await deps.service().read(token);
        return shared ? json(shared) : missing();
      } catch (error) {
        if (error instanceof ShareUnavailableError) return json({ error: '공유할 최신 일정이 없습니다. 소유자가 동선을 재생성해야 합니다.' }, 409);
        if (error instanceof PlaceProviderError) return json({ error: '장소 정보를 불러오지 못했습니다. 다시 시도해 주세요.' }, error.kind === 'UNAVAILABLE' ? 503 : 502);
        return json({ error: '공유 일정을 불러오지 못했습니다. 다시 시도해 주세요.' }, 500);
      }
    },
  };
}
