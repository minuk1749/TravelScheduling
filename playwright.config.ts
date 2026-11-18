import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', fullyParallel: false, workers: 1,
  use: { serviceWorkers: 'block', baseURL: 'http://127.0.0.1:3210', viewport: { width: 375, height: 812 }, trace: 'retain-on-failure' },
  webServer: { command: 'npm run start -- --hostname 127.0.0.1 --port 3210', url: 'http://127.0.0.1:3210/trips/new', reuseExistingServer: false },
});
