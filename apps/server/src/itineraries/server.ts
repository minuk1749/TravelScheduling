import { requestAuthenticator } from '../lib/auth/server';
import { tripOwner } from '../lib/auth/store';
import { createDatabasePool } from '../lib/db';
import { placeProvider } from '../places/server';
import { PostgresItineraryRequests } from '../repositories/itinerary-requests';
import { ItineraryService } from '../services/itinerary';
import { createGoogleTravelTimeProvider } from '../travel-time/server';
import { itineraryHandlers } from './http';

let requests: PostgresItineraryRequests | undefined;
const itineraryRequests = () => requests ??= new PostgresItineraryRequests(createDatabasePool());

/** Composition root. Nothing connects at import; providers are built per authorized request. */
export const handlers = itineraryHandlers({
  userId: request => requestAuthenticator.userId(request),
  findOwner: tripOwner,
  generator: (ownerId, requestId) => {
    const travel = createGoogleTravelTimeProvider();
    return {
      generator: { generate: tripId => itineraryRequests().run(tripId, ownerId, requestId, (repository, profiles) =>
        new ItineraryService({ repository, profiles, places: placeProvider(), travel }).generate(tripId)) },
      dispose: () => travel.dispose(),
    };
  },
});
