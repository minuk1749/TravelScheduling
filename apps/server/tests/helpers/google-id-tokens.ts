import { createRemoteJWKSet, customFetch, exportJWK, generateKeyPair, SignJWT, type JWTPayload } from 'jose';
import { GOOGLE_JWKS_URL } from '../../src/lib/auth/google-id-token';
import type { MobileSessionStore } from '../../src/lib/auth/mobile-sessions';

/** Test-only Google signing keys: a fake RS256 key published through a JWKS fixture (no real Google keys). */
export const IOS_CLIENT = 'ios-client.apps.googleusercontent.com';
export const ANDROID_CLIENT = 'android-client.apps.googleusercontent.com';

type Key = Awaited<ReturnType<typeof generateKeyPair>>;
const google = generateKeyPair('RS256', { extractable: true });
const stranger = generateKeyPair('RS256', { extractable: true });

export async function googleJwks(): Promise<{ keys: object[] }> {
  const { publicKey } = await google;
  return { keys: [{ ...await exportJWK(publicKey), kid: 'test-google-key', alg: 'RS256', use: 'sig' }] };
}

type TokenOptions = { claims?: JWTPayload; signer?: 'google' | 'stranger'; kid?: string; expiresIn?: number };
/** Valid by default; override claims or the signing key to produce each failure. */
export async function googleIdToken(options: TokenOptions = {}): Promise<string> {
  const key: Key = await (options.signer === 'stranger' ? stranger : google);
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    iss: 'https://accounts.google.com', aud: IOS_CLIENT, sub: 'google-user-1', email: 'traveler@example.test',
    email_verified: true, iat: now, exp: now + (options.expiresIn ?? 3600), ...options.claims,
  }).setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: options.kid ?? 'test-google-key' }).sign(key.privateKey);
}

/** The production remote JWKS loader, answered by a fetch fixture instead of googleapis.com. */
export function fixtureJwks(respond: () => Promise<Response> = async () => Response.json(await googleJwks())) {
  const requests: string[] = [];
  const keys = createRemoteJWKSet(new URL(GOOGLE_JWKS_URL), {
    [customFetch]: async (url: string) => { requests.push(url); return respond(); },
  });
  return { keys, requests };
}

/** In-memory `MobileSessionStore` with a controllable clock; mirrors the SQL contract. */
export class MemorySessionStore implements MobileSessionStore {
  readonly rows = new Map<string, { userId: string; expiresAt: string }>();
  now = () => new Date();
  async issue(userId: string, tokenHash: string, expiresAt: string) {
    for (const [hash, row] of this.rows) if (row.userId === userId && Date.parse(row.expiresAt) <= this.now().getTime()) this.rows.delete(hash);
    this.rows.set(tokenHash, { userId, expiresAt });
  }
  async userIdFor(tokenHash: string) {
    const row = this.rows.get(tokenHash);
    return row && Date.parse(row.expiresAt) > this.now().getTime() ? row.userId : null;
  }
  async revoke(tokenHash: string) { this.rows.delete(tokenHash); }
}
