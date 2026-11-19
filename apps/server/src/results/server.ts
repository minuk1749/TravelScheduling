import { requestAuthenticator } from '../lib/auth/server';
import { tripOwner } from '../lib/auth/store';
import { createDatabasePool } from '../lib/db';
import { placeProvider } from '../places/server';
import { PostgresConstraintRepository } from '../repositories/itinerary-constraints';
import { ResultEditService } from '../services/itinerary/editing';
import { constraintHandlers } from './http';
let pool: ReturnType<typeof createDatabasePool> | undefined;
export const handlers = constraintHandlers({
  userId: request => requestAuthenticator.userId(request), findOwner: tripOwner,
  service: () => new ResultEditService(new PostgresConstraintRepository(pool ??= createDatabasePool()), placeProvider()),
});
