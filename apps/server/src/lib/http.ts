/** Authenticated API responses must never be stored by browser or shared caches. */
export const privateJson = (body: unknown, status = 200): Response =>
  Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });

/** Missing Origin is allowed for non-browser callers; handlers retain their own auth checks. */
export function hasForeignOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  return origin !== null && origin !== '' && origin !== new URL(request.url).origin;
}

/** Stricter write check (settings, sharing): also rejects a browser-declared cross-site fetch. */
export const isCrossSiteRequest = (request: Request): boolean =>
  hasForeignOrigin(request) || request.headers.get('sec-fetch-site') === 'cross-site';
