import { defineConfig } from '@playwright/test';

/**
 * E2E runs drive the pre-packaging Electron build (`dist/`), so they are serial
 * and never share a user-data directory. Retries are disabled: a flaky pass
 * would be recorded as Gate 3 evidence without being reproducible.
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e-results.json' }]],
  outputDir: 'test-results/e2e-artifacts',
});
