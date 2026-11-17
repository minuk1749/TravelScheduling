import { auth } from '../auth';
import { CachedPlaceProvider } from './cache';
import { GooglePlaceProvider } from './google';
import { placeHandlers } from './http';

let provider: CachedPlaceProvider | undefined;
export const handlers = placeHandlers({
  userId: async () => (await auth())?.user?.id,
  // Lazy creation keeps build/import independent of credentials and network access.
  provider: () => provider ??= new CachedPlaceProvider(new GooglePlaceProvider(process.env.GOOGLE_PLACES_API_KEY ?? '')),
});
