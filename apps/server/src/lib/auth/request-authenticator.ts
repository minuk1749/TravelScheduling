import { hashOpaqueToken, isOpaqueToken } from '../opaque-token';
import type { MobileSessionStore, RequestAuthenticator } from './ports';

export type { RequestAuthenticator } from './ports';

/** NONE: no `Authorization` header; INVALID: present but not a well-formed Bearer session token. */
export type BearerHeader = { kind: 'NONE' } | { kind: 'INVALID' } | { kind: 'TOKEN'; token: string };

/** Any `Authorization` header counts as an attempt; only `Bearer <43-char token>` is well formed. */
export function readBearer(request: Request): BearerHeader {
  const header = request.headers.get('authorization');
  if (header === null) return { kind: 'NONE' };
  const match = /^Bearer +([^\s]+)$/i.exec(header.trim());
  return match && isOpaqueToken(match[1]) ? { kind: 'TOKEN', token: match[1] } : { kind: 'INVALID' };
}

/** Only a live Bearer app session authenticates; cookies are never read (the web login was removed in T25). */
export class SessionRequestAuthenticator implements RequestAuthenticator {
  constructor(private readonly sessions: Pick<MobileSessionStore, 'userIdFor'>) {}

  async userId(request: Request): Promise<string | undefined> {
    const bearer = readBearer(request);
    if (bearer.kind !== 'TOKEN') return undefined;
    return (await this.sessions.userIdFor(hashOpaqueToken(bearer.token))) ?? undefined;
  }
}
