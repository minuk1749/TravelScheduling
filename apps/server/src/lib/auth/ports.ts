/** Authentication ports (docs/architecture.md §13.3). Implementations live beside this file; this module has no runtime code. */

/** Resolves the signed-in application user of a request; `undefined` means unauthenticated (401). */
export interface RequestAuthenticator { userId(request: Request): Promise<string | undefined> }

export type GoogleIdentity = { googleId: string; email: string };
/** Application user rows keyed by the verified Google account; returns the user ID (SQL: `store.ts`). */
export interface GoogleUserStore { upsertGoogleUser(googleId: string, email: string): Promise<string> }
/** `null`: the token itself is unacceptable (401). Throws when Google's keys cannot be read (503). */
export interface GoogleIdTokenVerifier { verify(idToken: string): Promise<GoogleIdentity | null> }

/** Persistence for opaque app session tokens; only SHA-256 hashes are passed in. */
export interface MobileSessionStore {
  /** Also removes the same user's already expired sessions. `expiresAt` is an ISO-8601 UTC instant. */
  issue(userId: string, tokenHash: string, expiresAt: string): Promise<void>;
  /** `null` for unknown, expired or revoked tokens. */
  userIdFor(tokenHash: string): Promise<string | null>;
  /** Idempotent: an unknown hash is not an error. */
  revoke(tokenHash: string): Promise<void>;
}

export type IssuedSession = { token: string; expiresAt: string };
