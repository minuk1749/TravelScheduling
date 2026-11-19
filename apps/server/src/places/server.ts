import { requestAuthenticator } from '../lib/auth/server';
import { CachedPlaceProvider } from './cache';
import { GooglePlaceProvider } from './google';
import { placeHandlers } from './http';

let provider: CachedPlaceProvider | undefined;
/** Process-wide coordinate cache shared by the places API and itinerary generation. */
export const placeProvider = (): CachedPlaceProvider =>
  // Lazy creation keeps build/import independent of credentials and network access.
  provider ??= new CachedPlaceProvider(new GooglePlaceProvider(process.env.GOOGLE_PLACES_API_KEY ?? ''));
export const handlers = placeHandlers({
  userId: request => requestAuthenticator.userId(request),
  provider: placeProvider,
});
