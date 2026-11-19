export type Session = { token: string; expiresAt: string };

export interface SessionStorage {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
  clear(): Promise<void>;
}

export interface GoogleIdentityProvider {
  signIn(): Promise<string | null>;
  signOut(): Promise<void>;
}

export interface SessionApi {
  create(idToken: string): Promise<unknown>;
  revoke(): Promise<void>;
}

export interface ApiSession {
  accessToken(): Promise<string | null>;
  invalidate(token: string): Promise<void>;
}

export function parseSession(value: unknown): Session | null {
  if (!value || typeof value !== 'object') return null;
  const { token, expiresAt } = value as Partial<Session>;
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)
    || typeof expiresAt !== 'string' || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(expiresAt)
    || !Number.isFinite(Date.parse(expiresAt))) return null;
  return { token, expiresAt };
}
