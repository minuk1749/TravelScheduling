import { requestAuthenticator } from '../lib/auth/server';
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
  userId: request => requestAuthenticator.userId(request),
  findOwner: tripOwner,
  service: () => new RouteShapeService(new PostgresRouteShapeRepository(db()), placeProvider(), createGoogleRouteShapeProvider()),
});
