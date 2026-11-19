import { hashOpaqueToken, newOpaqueToken } from '../opaque-token';
import type { AuthStore } from './callbacks';
import type { GoogleIdTokenVerifier, IssuedSession, MobileSessionStore } from './ports';

export type { IssuedSession, MobileSessionStore } from './ports';
export const SESSION_LIFETIME_DAYS = 30;
const DAY_MS = 86_400_000;

/** Google ID token → application user → fixed 30-day session; logout deletes the session row. */
export class MobileSessionService {
  constructor(
    private readonly verifier: GoogleIdTokenVerifier,
    private readonly sessions: Pick<MobileSessionStore, 'issue' | 'revoke'>,
    private readonly users: Pick<AuthStore, 'upsertGoogleUser'>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** `null` when Google does not vouch for the token; key-source failures propagate. */
  async signIn(idToken: string): Promise<IssuedSession | null> {
    const identity = await this.verifier.verify(idToken);
    if (!identity) return null;
    const userId = await this.users.upsertGoogleUser(identity.googleId, identity.email);
    const token = newOpaqueToken();
    const expiresAt = new Date(this.now().getTime() + SESSION_LIFETIME_DAYS * DAY_MS).toISOString();
    await this.sessions.issue(userId, hashOpaqueToken(token), expiresAt);
    return { token, expiresAt };
  }

  signOut(token: string): Promise<void> {
    return this.sessions.revoke(hashOpaqueToken(token));
  }
}
