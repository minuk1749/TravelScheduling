import { auth } from '../auth';
import { tripOwner } from '../lib/auth/store';
import { createDatabasePool } from '../lib/db';
import { placeProvider } from '../places/server';
import { PostgresRouteShapeRepository } from '../repositories/route-shapes';
import { RouteShapeService } from '../services/route-shapes';
import { createGoogleRouteShapeProvider } from '../travel-time/server';
import { routeShapeHandlers } from './http';

let pool: ReturnType<typeof createDatabasePool> | undefined;
const db = () => pool ??= createDatabasePool();

export const handlers = routeShapeHandlers({
  // T18 will supply RequestAuthenticator here. Do not fall back to cookies for a supplied Bearer.
  userId: async request => request.headers.has('authorization') ? undefined : (await auth())?.user?.id,
  findOwner: tripOwner,
  service: () => new RouteShapeService(new PostgresRouteShapeRepository(db()), placeProvider(), createGoogleRouteShapeProvider()),
});
