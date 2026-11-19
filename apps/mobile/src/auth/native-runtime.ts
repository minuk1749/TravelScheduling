import { NativeGoogleIdentity } from './google-identity';
import { SecureSessionStorage } from './secure-storage';
import { createRuntime } from './runtime';

/** Created by the root layout, never as a module-level singleton. */
export function createNativeRuntime() {
  return createRuntime({
    storage: new SecureSessionStorage(),
    google: new NativeGoogleIdentity({
      webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
      iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    }),
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? '',
  });
}
