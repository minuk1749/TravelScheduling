import { requestAuthenticator } from '../lib/auth/server';
import { tripOwner } from '../lib/auth/store';
import { createDatabasePool } from '../lib/db';
import { cityProfileRepository } from '../repositories/city-profiles';
import { tripInputRepository } from '../repositories/trip-inputs';
import { tripAccessHandler, tripHandlers } from './http';
let pool: ReturnType<typeof createDatabasePool> | undefined;
const db = () => pool ??= createDatabasePool();
const userId = (request: Request) => requestAuthenticator.userId(request);
export const handlers = tripHandlers({
  userId,
  create: (ownerId, input) => tripInputRepository(db()).create(ownerId, input),
  profile: code => cityProfileRepository(db()).findByCityCode(code),
});
export const access = tripAccessHandler({ userId, findOwner: tripOwner });
