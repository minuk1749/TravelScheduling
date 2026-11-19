import { auth } from '../../auth';
import { createDatabasePool } from '../db';
import { PostgresMobileSessionStore } from './session-store';
import { SessionRequestAuthenticator } from './request-authenticator';

let pool: ReturnType<typeof createDatabasePool> | undefined;

/** Composition root for request authentication. Nothing connects at import. */
export const mobileSessionStore = new PostgresMobileSessionStore(() => pool ??= createDatabasePool());

/** Every user API: Bearer session when `Authorization` is present, otherwise the Auth.js cookie (removed in T25). */
export const requestAuthenticator = new SessionRequestAuthenticator(mobileSessionStore, async () => (await auth())?.user?.id);

/** App-only endpoints (`/api/session`, `/api/account`) accept Bearer sessions alone. */
export const bearerAuthenticator = new SessionRequestAuthenticator(mobileSessionStore);
