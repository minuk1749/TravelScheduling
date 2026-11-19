import { isApiErrorCode, type ApiErrorCode, type ApiErrorFields } from '@travel/core/contracts/errors';
import type { ApiSession } from '../auth/ports';

export class ApiFailure extends Error {
  constructor(
    readonly status: number, readonly code: ApiErrorCode, message: string,
    readonly fields?: ApiErrorFields,
  ) { super(message); }
}

function errorBody(raw: unknown, status: number): ApiFailure {
  if (raw && typeof raw === 'object') {
    const value = raw as Record<string, unknown>;
    if (isApiErrorCode(value.code) && typeof value.error === 'string') {
      const fields = value.fields;
      const validFields = Array.isArray(fields) ? fields.every(v => typeof v === 'string')
        : fields && typeof fields === 'object' && Object.values(fields).every(v => typeof v === 'string');
      return new ApiFailure(status, value.code, value.error,
        validFields ? fields as ApiErrorFields : undefined);
    }
  }
  return new ApiFailure(status, status === 401 ? 'UNAUTHENTICATED' : 'INTERNAL',
    status === 401 ? '다시 로그인해 주세요.' : '서버 응답을 확인하지 못했어요. 다시 시도해 주세요.');
}

export class ApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly session: ApiSession,
    private readonly transport: typeof fetch = fetch,
  ) {}

  async request<T>(path: string, options: RequestInit = {}, authenticated = true): Promise<T> {
    let base: URL;
    try { base = new URL(this.baseUrl); } catch {
      throw new Error('서버 주소 설정을 확인해 주세요.');
    }
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password
      || base.pathname !== '/' || base.search || base.hash || !path.startsWith('/api/')) {
      throw new Error('서버 주소 설정을 확인해 주세요.');
    }
    const url = new URL(path, base);
    if (url.origin !== base.origin || !url.pathname.startsWith('/api/')) throw new Error('잘못된 API 경로입니다.');
    const token = authenticated ? await this.session.accessToken() : null;
    if (authenticated && !token) throw errorBody(null, 401);
    const headers = new Headers(options.headers);
    headers.set('Accept', 'application/json');
    headers.delete('Authorization');
    if (token) headers.set('Authorization', `Bearer ${token}`);
    let response: Response;
    try {
      response = await this.transport(url.toString(), {
        ...options, headers, credentials: 'omit', cache: 'no-store', redirect: 'error',
        signal: options.signal ?? AbortSignal.timeout(15_000),
      });
    } catch {
      throw new Error('서버에 연결하지 못했어요. 연결을 확인하고 다시 시도해 주세요.');
    }
    // Clear credentials before reading the body, including malformed/empty 401 responses.
    if (response.status === 401 && token) await this.session.invalidate(token);
    if (response.status === 204) return undefined as T;
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) throw errorBody(body, response.status);
    return body as T;
  }
}
