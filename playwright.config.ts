import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';

dotenv.config();

const isCI = !!process.env.CI; // Set to 'true' automatically in Azure DevOps

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,        // Enable parallel execution across browsers/suites
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: isCI ? 2 : undefined, // 'undefined' lets Playwright automatically scale based on local CPU cores
  timeout: Number(process.env.DEFAULT_TIMEOUT) || 30000,

  reporter: [
    ['list'],
    ['html',  { outputFolder: 'playwright-report', open: 'never' }],
    ['json',  { outputFile: 'results/playwright-results.json' }],
    ['junit', { outputFile: 'results/junit-results.xml' }],
  ],

  use: {
    baseURL: process.env.APP_BASE_URL,
    headless: isCI ? true : process.env.HEADLESS === 'true',
    screenshot: (process.env.SCREENSHOT_MODE as 'on' | 'only-on-failure' | 'off') || 'on',
    video: 'on',
    trace: 'on',
    slowMo: isCI ? 0 : 300,
    actionTimeout: 15000,
    navigationTimeout: 30000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],

  // PW_OUTPUT_DIR is injected per-run by the server (test-results/<runId>).
  // This isolates each run's artifacts so they are never wiped by a subsequent run.
  outputDir: process.env.PW_OUTPUT_DIR || 'test-results',
});
