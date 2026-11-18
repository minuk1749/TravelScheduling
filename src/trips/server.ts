import { auth } from '../auth';
import { createDatabasePool } from '../lib/db';
import { cityProfileRepository } from '../repositories/city-profiles';
import { tripInputRepository } from '../repositories/trip-inputs';
import { tripHandlers } from './http';
let pool: ReturnType<typeof createDatabasePool> | undefined;
const db = () => pool ??= createDatabasePool();
export const handlers = tripHandlers({
  userId: async () => (await auth())?.user?.id,
  create: (ownerId, input) => tripInputRepository(db()).create(ownerId, input),
  profile: code => cityProfileRepository(db()).findByCityCode(code),
});
