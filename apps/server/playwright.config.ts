import { defineConfig } from '@playwright/test';
import { E2E_MOBILE_CLIENT, ensureSigningKey } from './tests/e2e/support/google-key';

const origin = 'http://localhost:3210';
// Created once in the runner process; the server and the test workers inherit it (see tests/e2e/support/google-key.ts).
ensureSigningKey();
// Fake credentials only: Google signing keys, Places and Routes are answered by tests/e2e/support/google-doubles.mjs
// and the Maps JavaScript API on the share page by a browser stub, so the build must embed (fake) NEXT_PUBLIC_* Maps settings.
const env = {
  ...process.env as Record<string, string>,
  GOOGLE_MOBILE_CLIENT_IDS: E2E_MOBILE_CLIENT,
  GOOGLE_PLACES_API_KEY: 'e2e-places-key', GOOGLE_ROUTES_API_KEY: 'e2e-routes-key',
  NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: 'e2e-maps-key', NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID: 'e2e-map-id',
};
export default defineConfig({
  testDir: './tests/e2e', fullyParallel: false, workers: 1,
  use: { serviceWorkers: 'block', baseURL: origin, viewport: { width: 375, height: 812 }, trace: 'retain-on-failure' },
  webServer: {
    // Rebuild so the fake Maps settings are inlined; the server then starts with the Google doubles preloaded.
    // Ready check: an unauthenticated API call answers 401 (there is no web home page any more).
    command: 'npm run build && NODE_OPTIONS="--import ./tests/e2e/support/google-doubles.mjs" npm run start -- --hostname localhost --port 3210',
    url: `${origin}/api/trips`, reuseExistingServer: false, timeout: 480_000, env,
  },
});
