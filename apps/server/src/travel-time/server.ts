import { CachedTravelTimeProvider } from './cache';
import { GoogleTravelTimeProvider } from './google';

/** T12 must call this only after authentication/ownership checks. No work at module import. */
export function createGoogleTravelTimeProvider(): CachedTravelTimeProvider {
  // Completed Google responses are not cached: see ADR 0005. No deployment toggle bypasses this default.
  return new CachedTravelTimeProvider(new GoogleTravelTimeProvider(process.env.GOOGLE_ROUTES_API_KEY ?? ''));
}
