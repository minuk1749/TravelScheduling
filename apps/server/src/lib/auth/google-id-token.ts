import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { GoogleIdentity, GoogleIdTokenVerifier } from './ports';

export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];
const CLOCK_TOLERANCE_SECONDS = 60;

export type { GoogleIdentity, GoogleIdTokenVerifier } from './ports';

export class GoogleKeysUnavailableError extends Error {
  constructor(options?: ErrorOptions) { super('Google 서명 키를 가져오지 못했습니다.', options); }
}

/** Failures that describe the presented token rather than the key source. */
const TOKEN_ERRORS = [
  errors.JWTExpired, errors.JWTClaimValidationFailed, errors.JWTInvalid, errors.JWSInvalid,
  errors.JWSSignatureVerificationFailed, errors.JOSEAlgNotAllowed, errors.JOSENotSupported,
  errors.JWKSNoMatchingKey, errors.JWKSMultipleMatchingKeys,
];

/** Google ID token check: RS256 signature from Google's JWKS, issuer, audience list, expiry and verified email. */
export class JoseGoogleIdTokenVerifier implements GoogleIdTokenVerifier {
  private readonly audiences: string[];

  /** `keys` defaults to Google's remote JWKS; tests inject a local key set or a custom fetch. */
  constructor(audiences: readonly string[], private readonly keys: JWTVerifyGetKey = createRemoteJWKSet(new URL(GOOGLE_JWKS_URL))) {
    this.audiences = audiences.filter(Boolean);
  }

  async verify(idToken: string): Promise<GoogleIdentity | null> {
    // Without configured client IDs no audience can match; never accept tokens minted for other apps.
    if (!this.audiences.length) return null;
    let payload;
    try {
      ({ payload } = await jwtVerify(idToken, this.keys, {
        algorithms: ['RS256'], issuer: GOOGLE_ISSUERS, audience: this.audiences,
        clockTolerance: CLOCK_TOLERANCE_SECONDS, requiredClaims: ['exp', 'sub'],
      }));
    } catch (error) {
      if (TOKEN_ERRORS.some(type => error instanceof type)) return null;
      throw new GoogleKeysUnavailableError({ cause: error });
    }
    const { sub, email, email_verified: verified } = payload;
    if (typeof sub !== 'string' || !sub || typeof email !== 'string' || !email || verified !== true) return null;
    return { googleId: sub, email };
  }
}

/** `GOOGLE_MOBILE_CLIENT_IDS`: comma-separated iOS/Android OAuth client IDs accepted as `aud`. */
export const mobileClientIds = (value: string | undefined): string[] =>
  (value ?? '').split(',').map(id => id.trim()).filter(Boolean);
