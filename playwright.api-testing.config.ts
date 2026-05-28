import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/api-testing',
  fullyParallel: false,
  forbidOnly: false,
  retries: 0,
  workers: 1,
  timeout: 60_000,

  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report-api', open: 'never' }],
    ['json', { outputFile: 'results/api-test-results.json' }],
  ],

  use: {
    baseURL: 'http://localhost:3003',
    ignoreHTTPSErrors: true,
    screenshot: 'only-on-failure',
    video: 'off',
    trace: 'off',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
});
