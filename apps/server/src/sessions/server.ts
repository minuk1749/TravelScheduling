import { JoseGoogleIdTokenVerifier, mobileClientIds } from '../lib/auth/google-id-token';
import { MobileSessionService } from '../lib/auth/mobile-sessions';
import { mobileSessionStore, requestAuthenticator } from '../lib/auth/server';
import { deleteUser, upsertGoogleUser } from '../lib/auth/store';
import { accountHandlers, sessionHandlers } from './http';

let service: MobileSessionService | undefined;
/** Built on first use: the remote JWKS and client ID list are read lazily, keeping build/import offline. */
const sessionService = () => service ??= new MobileSessionService(
  new JoseGoogleIdTokenVerifier(mobileClientIds(process.env.GOOGLE_MOBILE_CLIENT_IDS)),
  mobileSessionStore,
  { upsertGoogleUser },
);

export const sessions = sessionHandlers({ service: sessionService });
export const account = accountHandlers({ authenticator: requestAuthenticator, deleteUser });
