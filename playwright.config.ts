import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';

dotenv.config();

const isCI = !!process.env.CI; // Set to 'true' automatically in Azure DevOps

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,       // Sequential by default — change per suite if needed
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: isCI ? 2 : 1,
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
    screenshot: (process.env.SCREENSHOT_MODE as 'always' | 'only-on-failure' | 'off') || 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
    slowMo: isCI ? 0 : 300,
    actionTimeout: 15000,
    navigationTimeout: 30000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  outputDir: 'test-results/',
});
