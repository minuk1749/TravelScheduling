import { createPrivateKey, createPublicKey, createSign, generateKeyPairSync, type JsonWebKey } from 'node:crypto';

/**
 * One fake Google signing key per e2e run. playwright.config.ts creates it in the runner process; the Next server
 * (which serves its public half as Google's JWKS through google-doubles.mjs) and the test workers inherit it through
 * the environment, so the test can mint ID tokens the real `JoseGoogleIdTokenVerifier` accepts. No real Google key.
 */
const SIGNING_KEY_ENV = 'E2E_GOOGLE_SIGNING_KEY';
const KEY_ID = 'e2e-google-key';
/** Accepted `aud` (the server's GOOGLE_MOBILE_CLIENT_IDS) standing in for the iOS/Android app client IDs. */
export const E2E_MOBILE_CLIENT = 'e2e-ios.apps.googleusercontent.com';

export function ensureSigningKey(): void {
  process.env[SIGNING_KEY_ENV] ??= JSON.stringify(generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'jwk' }));
}

function privateKey() {
  const value = process.env[SIGNING_KEY_ENV];
  if (!value) throw new Error(`${SIGNING_KEY_ENV} is not set; run e2e through playwright.config.ts`);
  return createPrivateKey({ key: JSON.parse(value) as JsonWebKey, format: 'jwk' });
}

/** The JWKS Google would publish at https://www.googleapis.com/oauth2/v3/certs for this run. */
export function publicJwks() {
  return { keys: [{ ...createPublicKey(privateKey()).export({ format: 'jwk' }), kid: KEY_ID, alg: 'RS256', use: 'sig' }] };
}

const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
/** What the native Google Sign-In SDK hands the app: an RS256 ID token for the app's client ID. */
export function googleIdToken(claims: { sub: string; email: string } & Record<string, unknown>): string {
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64({ alg: 'RS256', typ: 'JWT', kid: KEY_ID })}.${b64({
    iss: 'https://accounts.google.com', aud: E2E_MOBILE_CLIENT, email_verified: true, iat: now, exp: now + 3600, ...claims,
  })}`;
  return `${body}.${createSign('RSA-SHA256').update(body).sign(privateKey(), 'base64url')}`;
}
