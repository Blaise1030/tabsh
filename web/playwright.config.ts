import { defineConfig } from '@playwright/test';

// The e2e specs drive a real daemon (see e2e/daemon.ts) and the daemon's own
// copy of the app page, so they run in chromium only, one worker at a time;
// parallel workers are a later slice.
export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    browserName: 'chromium',
  },
});
