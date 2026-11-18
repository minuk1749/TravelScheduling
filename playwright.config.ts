import { defineConfig } from '@playwright/test';

// `localhost` (not 127.0.0.1): Next's own redirects after the Auth.js callback use it, and session cookies are per host.
const origin = 'http://localhost:3210';
// Fake credentials only: Google OAuth/Places/Routes are answered by tests/e2e/support/google-doubles.mjs
// and the Maps JavaScript API by a browser stub, so the build must embed (fake) NEXT_PUBLIC_* Maps settings.
const env = {
  ...process.env as Record<string, string>,
  AUTH_SECRET: 'e2e-secret-e2e-secret-e2e-secret-00', AUTH_TRUST_HOST: 'true', AUTH_URL: origin,
  AUTH_GOOGLE_ID: 'e2e-client', AUTH_GOOGLE_SECRET: 'e2e-client-secret',
  GOOGLE_PLACES_API_KEY: 'e2e-places-key', GOOGLE_ROUTES_API_KEY: 'e2e-routes-key',
  NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: 'e2e-maps-key', NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID: 'e2e-map-id',
};
export default defineConfig({
  testDir: './tests/e2e', fullyParallel: false, workers: 1,
  use: { serviceWorkers: 'block', baseURL: origin, viewport: { width: 375, height: 812 }, trace: 'retain-on-failure' },
  webServer: {
    // Rebuild so the fake Maps settings are inlined; the server then starts with the Google doubles preloaded.
    command: 'npm run build && NODE_OPTIONS="--import ./tests/e2e/support/google-doubles.mjs" npm run start -- --hostname localhost --port 3210',
    url: `${origin}/`, reuseExistingServer: false, timeout: 480_000, env,
  },
});
