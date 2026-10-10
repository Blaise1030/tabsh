import { defineConfig } from '@playwright/test';

// The busy-tabs benchmark (bench/README.md): its own config so it never runs
// in the e2e job. One worker, one daemon, chromium, scenarios in order.
export default defineConfig({
  testDir: 'bench',
  testMatch: '*.bench.ts',
  timeout: 15 * 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results/bench',
  use: { browserName: 'chromium' },
});
