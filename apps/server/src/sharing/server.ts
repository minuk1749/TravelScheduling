import { requestAuthenticator } from '../lib/auth/server';
import { tripOwner } from '../lib/auth/store';
import { createDatabasePool } from '../lib/db';
import { placeProvider } from '../places/server';
import { PostgresShareRepository } from '../repositories/sharing';
import { SharingService } from '../services/sharing';
import { sharingHandlers } from './http';

let pool: ReturnType<typeof createDatabasePool> | undefined;
export const handlers = sharingHandlers({
  userId: request => requestAuthenticator.userId(request), findOwner: tripOwner,
  service: () => new SharingService(new PostgresShareRepository(pool ??= createDatabasePool()), placeProvider),
});
