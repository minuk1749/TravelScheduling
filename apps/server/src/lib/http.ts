import type { ApiError, ApiErrorCode, ApiErrorFields } from '@travel/core/contracts/errors';

const PRIVATE = { 'Cache-Control': 'private, no-store' } as const;

/** Authenticated API responses must never be stored by browser or shared caches. */
export const privateJson = (body: unknown, status = 200): Response =>
  Response.json(body, { status, headers: PRIVATE });

/** Empty success (204) with the same cache policy. */
export const privateNoContent = (): Response => new Response(null, { status: 204, headers: PRIVATE });

/** Error body `{ code, error, fields? }` (docs/architecture.md §13.2). Existing `error`/`fields`/status stay as they were. */
export function apiError(status: number, code: ApiErrorCode, error: string, fields?: ApiErrorFields): Response {
  const body: ApiError = fields === undefined ? { code, error } : { code, error, fields };
  return privateJson(body, status);
}

const ACCESS_CODES = { 401: 'UNAUTHENTICATED', 403: 'FORBIDDEN', 404: 'NOT_FOUND' } as const;
/** Error for an `authorizeTrip` result; each handler keeps its own wording. */
export const accessError = (status: 401 | 403 | 404, error: string): Response => apiError(status, ACCESS_CODES[status], error);

/** Places/Routes outage is 503, an unusable provider answer 502. */
export const providerError = (kind: 'UNAVAILABLE' | 'INVALID_RESPONSE', error: string): Response =>
  kind === 'UNAVAILABLE' ? apiError(503, 'PROVIDER_UNAVAILABLE', error) : apiError(502, 'PROVIDER_INVALID_RESPONSE', error);

/** Missing Origin is allowed for non-browser callers; handlers retain their own auth checks. */
export function hasForeignOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  return origin !== null && origin !== '' && origin !== new URL(request.url).origin;
}

/** Stricter write check (settings, sharing): also rejects a browser-declared cross-site fetch. */
export const isCrossSiteRequest = (request: Request): boolean =>
  hasForeignOrigin(request) || request.headers.get('sec-fetch-site') === 'cross-site';
