import { hashOpaqueToken, isOpaqueToken } from '../opaque-token';
import type { MobileSessionStore, RequestAuthenticator } from './ports';

export type { RequestAuthenticator } from './ports';

/** NONE: no `Authorization` header (cookie path); INVALID: present but not a well-formed Bearer session token. */
export type BearerHeader = { kind: 'NONE' } | { kind: 'INVALID' } | { kind: 'TOKEN'; token: string };

/** Any `Authorization` header counts as an attempt; only `Bearer <43-char token>` is well formed. */
export function readBearer(request: Request): BearerHeader {
  const header = request.headers.get('authorization');
  if (header === null) return { kind: 'NONE' };
  const match = /^Bearer +([^\s]+)$/i.exec(header.trim());
  return match && isOpaqueToken(match[1]) ? { kind: 'TOKEN', token: match[1] } : { kind: 'INVALID' };
}

/**
 * With an `Authorization` header only the Bearer session decides (no cookie fallback, so a bad token is 401).
 * Without one, the optional cookie session (Auth.js, until T25) is used.
 */
export class SessionRequestAuthenticator implements RequestAuthenticator {
  constructor(
    private readonly sessions: Pick<MobileSessionStore, 'userIdFor'>,
    private readonly cookieUserId: () => Promise<string | undefined> = async () => undefined,
  ) {}

  async userId(request: Request): Promise<string | undefined> {
    const bearer = readBearer(request);
    if (bearer.kind === 'NONE') return this.cookieUserId();
    if (bearer.kind === 'INVALID') return undefined;
    return (await this.sessions.userIdFor(hashOpaqueToken(bearer.token))) ?? undefined;
  }
}
