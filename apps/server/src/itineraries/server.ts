import { auth } from '../auth';
import { tripOwner } from '../lib/auth/store';
import { createDatabasePool } from '../lib/db';
import { placeProvider } from '../places/server';
import { cityProfileRepository } from '../repositories/city-profiles';
import { PostgresItineraryRepository } from '../repositories/itineraries';
import { ItineraryService } from '../services/itinerary';
import { createGoogleTravelTimeProvider } from '../travel-time/server';
import { itineraryHandlers } from './http';

let pool: ReturnType<typeof createDatabasePool> | undefined;
const db = () => pool ??= createDatabasePool();

/** Composition root. Nothing connects at import; providers are built per authorized request. */
export const handlers = itineraryHandlers({
  userId: async () => (await auth())?.user?.id,
  findOwner: tripOwner,
  generator: () => {
    const travel = createGoogleTravelTimeProvider();
    const generator = new ItineraryService({
      repository: new PostgresItineraryRepository(db()),
      profiles: cityProfileRepository(db()),
      places: placeProvider(),
      travel,
    });
    return { generator, dispose: () => travel.dispose() };
  },
});
