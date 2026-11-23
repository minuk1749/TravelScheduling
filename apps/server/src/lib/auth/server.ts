import { createDatabasePool } from '../db';
import { PostgresMobileSessionStore } from './session-store';
import { SessionRequestAuthenticator } from './request-authenticator';

let pool: ReturnType<typeof createDatabasePool> | undefined;

/** Composition root for request authentication. Nothing connects at import. */
export const mobileSessionStore = new PostgresMobileSessionStore(() => pool ??= createDatabasePool());

/** Every user API (including `/api/session` logout and `/api/account`) accepts Bearer app sessions only (T25). */
export const requestAuthenticator = new SessionRequestAuthenticator(mobileSessionStore);
