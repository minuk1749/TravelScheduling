import { readJsonBody } from '../lib/json-body';
import { GoogleKeysUnavailableError } from '../lib/auth/google-id-token';
import type { MobileSessionService } from '../lib/auth/mobile-sessions';
import { readBearer, type RequestAuthenticator } from '../lib/auth/request-authenticator';
import { apiError, privateJson, privateNoContent } from '../lib/http';

const MAX_ID_TOKEN = 8_192;
const UNAUTHENTICATED = '로그인 후 다시 시도해 주세요.';

type SessionDependencies = { service(): Pick<MobileSessionService, 'signIn' | 'signOut'> };

function idTokenOf(raw: unknown): string | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const { idToken } = raw as { idToken?: unknown };
  return typeof idToken === 'string' && idToken.length > 0 && idToken.length <= MAX_ID_TOKEN ? idToken : null;
}

/** POST /api/session (Google ID token → session token) and DELETE /api/session (logout). */
export function sessionHandlers(deps: SessionDependencies) {
  return {
    async create(request: Request): Promise<Response> {
      try {
        if (!request.headers.get('content-type')?.startsWith('application/json')) return apiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'JSON 입력이 필요합니다.');
        const body = await readJsonBody(request, 16_384);
        if ('error' in body) return body.error;
        const idToken = idTokenOf(body.value);
        if (!idToken) return apiError(400, 'INVALID_INPUT', 'Google 로그인 정보가 필요합니다.', { idToken: 'Google ID 토큰을 보내 주세요.' });
        const session = await deps.service().signIn(idToken);
        if (!session) return apiError(401, 'INVALID_GOOGLE_TOKEN', 'Google 로그인을 확인하지 못했습니다. 다시 로그인해 주세요.');
        return privateJson(session, 201);
      } catch (error) {
        if (error instanceof GoogleKeysUnavailableError) return apiError(503, 'PROVIDER_UNAVAILABLE', 'Google 로그인 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');
        return apiError(500, 'INTERNAL', '로그인을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
      }
    },
    async delete(request: Request): Promise<Response> {
      const bearer = readBearer(request);
      if (bearer.kind !== 'TOKEN') return apiError(401, 'UNAUTHENTICATED', UNAUTHENTICATED);
      try {
        await deps.service().signOut(bearer.token);
        return privateNoContent();
      } catch {
        return apiError(500, 'INTERNAL', '로그아웃을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
      }
    },
  };
}

/** DELETE /api/account: deleting the user cascades to trips and every session. */
export function accountHandlers(deps: { authenticator: RequestAuthenticator; deleteUser(id: string): Promise<void> }) {
  return {
    async delete(request: Request): Promise<Response> {
      try {
        const userId = await deps.authenticator.userId(request);
        if (!userId) return apiError(401, 'UNAUTHENTICATED', UNAUTHENTICATED);
        await deps.deleteUser(userId);
        return privateNoContent();
      } catch {
        return apiError(500, 'INTERNAL', '탈퇴를 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
      }
    },
  };
}
